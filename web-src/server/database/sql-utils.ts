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
