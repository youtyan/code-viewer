import type { DbCellInput, DbOrder, DbValue } from "../../core/database/types";
import { coerceDbValue } from "./serialize";

export type SqlKind = "sqlite" | "postgresql" | "mysql";

export type FilterSql = {
  where: string;
  params: string[];
  useParams: boolean;
};

export function sanitizeIdentifier(
  name: string,
  kind: SqlKind = "sqlite",
): string {
  if (kind === "mysql") return `\`${name.replace(/`/g, "``")}\``;
  return `"${name.replace(/"/g, '""')}"`;
}

export function escapeSqlString(value: string, kind?: SqlKind): string {
  // MySQL は既定 (NO_BACKSLASH_ESCAPES 無効) でバックスラッシュをエスケープ
  // 文字として解釈するため、リテラルに含めるには二重化が必要。PostgreSQL は
  // standard_conforming_strings=on 既定でバックスラッシュは普通の文字なので
  // 触らない（二重化すると逆に値が変わってしまう）。
  const escaped =
    kind === "mysql"
      ? value.replace(/\\/g, "\\\\").replace(/'/g, "''")
      : value.replace(/'/g, "''");
  return `'${escaped}'`;
}

/** カラム単位の完全一致条件（外部キー参照などの WHERE に使う）。 */
export type ExactFilter = { column: string; value: string };

export function buildFilterWhere(
  grouped: Map<string, string[]>,
  kind: SqlKind,
  exact?: ExactFilter[],
): FilterSql {
  const whereParts: string[] = [];
  const params: string[] = [];
  const useParams = kind === "sqlite";
  const castOf = (column: string) =>
    kind === "mysql"
      ? `CAST(${sanitizeIdentifier(column, kind)} AS CHAR)`
      : `CAST(${sanitizeIdentifier(column, kind)} AS TEXT)`;
  for (const [value, cols] of grouped) {
    const likeVal = useParams ? "?" : escapeSqlString(`%${value}%`, kind);
    if (cols.length === 1) {
      whereParts.push(`${castOf(cols[0])} LIKE ${likeVal}`);
      if (useParams) params.push(`%${value}%`);
    } else {
      const orParts = cols.map((column) => `${castOf(column)} LIKE ${likeVal}`);
      whereParts.push(`(${orParts.join(" OR ")})`);
      if (useParams) {
        for (let i = 0; i < cols.length; i++) params.push(`%${value}%`);
      }
    }
  }
  // 完全一致条件は型差を避けるため TEXT/CHAR にキャストして比較する。
  for (const cond of exact ?? []) {
    const rhs = useParams ? "?" : escapeSqlString(cond.value, kind);
    whereParts.push(`${castOf(cond.column)} = ${rhs}`);
    if (useParams) params.push(cond.value);
  }
  return { where: whereParts.join(" AND "), params, useParams };
}

export function filterGroupedColumns(
  grouped: Map<string, string[]>,
  columnNames: Iterable<string>,
): Map<string, string[]> {
  const validColumns = new Set(columnNames);
  const filtered = new Map<string, string[]>();
  for (const [value, columns] of grouped) {
    const valid = columns.filter((column) => validColumns.has(column));
    if (valid.length > 0) filtered.set(value, valid);
  }
  return filtered;
}

export function filterExactColumns(
  exact: ExactFilter[] | undefined,
  columnNames: Iterable<string>,
): ExactFilter[] {
  if (!exact || exact.length === 0) return [];
  const validColumns = new Set(columnNames);
  return exact.filter((cond) => validColumns.has(cond.column));
}

export function filterOrderByColumns<T extends { column: string }>(
  orderBy: T[] | undefined,
  columnNames: Iterable<string>,
): T[] | undefined {
  if (!orderBy) return undefined;
  const validColumns = new Set(columnNames);
  const filtered = orderBy.filter((order) => validColumns.has(order.column));
  return filtered.length > 0 ? filtered : undefined;
}

// ORDER BY 句を組み立てる。orderBy が空/未指定なら空文字列。kind 省略時は
// sqlite 既定 (sanitizeIdentifier の方言切替に影響)。adapters/sqlite.ts と
// adapters/docker.ts の両方から使う。
export function buildOrderClause(
  orderBy: DbOrder[] | undefined,
  kind: SqlKind = "sqlite",
): string {
  if (!orderBy?.length) return "";
  const parts = orderBy.map(
    (o) =>
      `${sanitizeIdentifier(o.column, kind)} ${o.direction === "desc" ? "DESC" : "ASC"}`,
  );
  return ` ORDER BY ${parts.join(", ")}`;
}

// --- 書き込み (INSERT / UPDATE / DELETE) 用の SQL 生成 ---

export type WriteSql = { sql: string; params: DbValue[] };

// SQLite は ? パラメータバインドが使えるので useParams=true。
// PostgreSQL / MySQL は docker exec (CLI) 経由でパラメータバインドが使えない
// ため、値をリテラルとして埋め込む (buildFilterWhere と同じ方針)。
function useParamsFor(kind: SqlKind): boolean {
  return kind === "sqlite";
}

// coerce 済みの DbValue を、param バインド (? に push) するか、リテラル文字列に
// 変換して返す。
function placeValue(
  coerced: DbValue,
  kind: SqlKind,
  useParams: boolean,
  params: DbValue[],
): string {
  if (useParams) {
    // SQLite ドライバ (better-sqlite3 / bun:sqlite) は boolean のバインドを
    // 受け付けないことがあるので 0/1 に落とす。
    params.push(typeof coerced === "boolean" ? (coerced ? 1 : 0) : coerced);
    return "?";
  }
  if (coerced === null) return "NULL";
  if (typeof coerced === "number") return String(coerced);
  if (typeof coerced === "boolean") return coerced ? "TRUE" : "FALSE";
  // Uint8Array は書き込み入力には現れない (テキスト系のみ対象)。到達した場合は
  // 文字列化して安全側に倒す。
  const text =
    coerced instanceof Uint8Array
      ? new TextDecoder().decode(coerced)
      : String(coerced);
  return escapeSqlString(text, kind);
}

function coerceCell(cell: DbCellInput, columnType: string): DbValue {
  return coerceDbValue(cell.value, columnType);
}

function formatWriteComparisons(
  cells: DbCellInput[],
  columnTypes: Map<string, string>,
  kind: SqlKind,
  useParams: boolean,
  params: DbValue[],
  separator: string,
): string {
  return cells
    .map(
      (cell) =>
        `${sanitizeIdentifier(cell.column, kind)} = ${placeValue(
          coerceCell(cell, columnTypes.get(cell.column) ?? "TEXT"),
          kind,
          useParams,
          params,
        )}`,
    )
    .join(separator);
}

export function buildInsertSql(
  table: string,
  cells: DbCellInput[],
  columnTypes: Map<string, string>,
  kind: SqlKind,
): WriteSql {
  if (cells.length === 0) {
    throw new Error("insert requires at least one column value");
  }
  const useParams = useParamsFor(kind);
  const params: DbValue[] = [];
  const cols = cells.map((c) => sanitizeIdentifier(c.column, kind));
  const placeholders = cells.map((c) =>
    placeValue(
      coerceCell(c, columnTypes.get(c.column) ?? "TEXT"),
      kind,
      useParams,
      params,
    ),
  );
  const sql = `INSERT INTO ${sanitizeIdentifier(table, kind)} (${cols.join(
    ", ",
  )}) VALUES (${placeholders.join(", ")})`;
  return { sql, params };
}

export function buildUpdateSql(
  table: string,
  set: DbCellInput[],
  pk: DbCellInput[],
  columnTypes: Map<string, string>,
  kind: SqlKind,
): WriteSql {
  if (set.length === 0) {
    throw new Error("update requires at least one column to set");
  }
  if (pk.length === 0) {
    throw new Error("update requires a primary key condition");
  }
  const useParams = useParamsFor(kind);
  const params: DbValue[] = [];
  const setSql = formatWriteComparisons(
    set,
    columnTypes,
    kind,
    useParams,
    params,
    ", ",
  );
  const whereSql = formatWriteComparisons(
    pk,
    columnTypes,
    kind,
    useParams,
    params,
    " AND ",
  );
  const sql = `UPDATE ${sanitizeIdentifier(
    table,
    kind,
  )} SET ${setSql} WHERE ${whereSql}`;
  return { sql, params };
}

export function buildDeleteSql(
  table: string,
  pk: DbCellInput[],
  columnTypes: Map<string, string>,
  kind: SqlKind,
): WriteSql {
  if (pk.length === 0) {
    throw new Error("delete requires a primary key condition");
  }
  const useParams = useParamsFor(kind);
  const params: DbValue[] = [];
  const whereSql = formatWriteComparisons(
    pk,
    columnTypes,
    kind,
    useParams,
    params,
    " AND ",
  );
  const sql = `DELETE FROM ${sanitizeIdentifier(
    table,
    kind,
  )} WHERE ${whereSql}`;
  return { sql, params };
}
