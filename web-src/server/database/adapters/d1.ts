// Cloudflare D1 アダプタ。D1 は SQLite なので発行する SQL は
// adapters/sqlite.ts と同じ (adapters/sqlite-introspection.ts に集約)。違うのは
// 実行経路だけで、ローカルの同期ドライバではなく Cloudflare REST API へ
// HTTPS POST する。
//
//   POST /accounts/{accountId}/d1/database/{databaseId}/raw
//   Authorization: Bearer <API token>
//   { "sql": "...", "params": [...] }
//
// /query ではなく /raw を使う: /query は行をオブジェクトで返すため 0 行の
// ときに列名が失われるが、/raw は { columns, rows } を返すので空結果でも
// グリッドのヘッダを描ける。
//
// 書き込みは実装しない (applyMutations 未定義)。閲覧専用の接続として扱う。

import type {
  DbColumn,
  DbForeignKey,
  DbIndexInfo,
  DbOrder,
  DbTableInfo,
  DbValue,
} from "../../../core/database/types";
import type { RawDbValue } from "../serialize";
import {
  buildRowKeyJson,
  computeRowHash,
  rowToPayloadJson,
  SQL_SNAPSHOT_BATCH_SIZE,
} from "../sources/sql-snapshot";
import type { SnapshotItem } from "../sources/types";
import {
  buildFilterWhere,
  buildOrderClause,
  filterExactColumns,
  filterGroupedColumns,
  filterOrderByColumns,
  sanitizeIdentifier,
} from "../sql-utils";
import { isAbortLikeError } from "./abort";
import { recordSql } from "./sql-capture";
import {
  assertReadonlySqliteStatement,
  SQLITE_INTROSPECTION_SQL,
  type SqlitePragmaColumnRow,
  sqliteColumnFromPragmaRow,
  sqliteForeignKeyListSql,
  sqliteIndexInfoSql,
  sqliteIndexListSql,
  sqliteRowCountSql,
  sqliteRowCountUnionSql,
  sqliteTableInfoFromRow,
  sqliteTableInfoSql,
  stripTrailingSemicolon,
} from "./sqlite-introspection";
import { createTableMetaCache } from "./table-meta-cache";
import type {
  DatabaseAdapter,
  QueryResult,
  TablePageMeta,
  TriggerInfo,
} from "./types";

export type D1Config = {
  accountId: string;
  databaseId: string;
  apiToken: string;
  // Cloudflare API のベース URL。テストでローカルスタブを差すためだけの口で、
  // 通常は既定値を使う。
  apiBaseUrl?: string;
};

export type D1Source = DatabaseAdapter & {
  readonly kind: "d1";
  readonly model: "sql";
  readonly capabilities: { snapshot: true };
  iterateForSnapshot(
    table: string,
    signal?: AbortSignal,
  ): AsyncIterable<SnapshotItem>;
  listSnapshotContainers(): Promise<Array<{ id: string; label: string }>>;
};

const DEFAULT_D1_API_BASE_URL = "https://api.cloudflare.com/client/v4";

// D1 は `_cf_KV` のような内部テーブルを sqlite_master / PRAGMA table_list に
// 見せる一方、読み取りは authorizer が拒否する (not authorized: SQLITE_AUTH)。
// 一覧に混ぜると COUNT(*) や PRAGMA で全体が落ちるので最初から除外する。
const D1_INTERNAL_NAME_RE = /^_cf_/i;

function isD1InternalName(name: string): boolean {
  return D1_INTERNAL_NAME_RE.test(name);
}

// Cloudflare へのラウンドトリップ + D1 側のクエリ実行時間。ローカル DB より
// 明確に遅いので、s3/dynamodb アダプタの 5s より長めに取る。
const DEFAULT_D1_REQUEST_TIMEOUT_MS = 20_000;

let d1RequestTimeoutMs = DEFAULT_D1_REQUEST_TIMEOUT_MS;
// 既定では呼び出しのたびに globalThis.fetch を引く (差し替えられた global fetch
// を尊重するため)。テストだけが明示的に上書きする。
let d1FetchOverride: typeof fetch | null = null;

export function __setD1FetchForTest(fetchForTest: typeof fetch | null): void {
  d1FetchOverride = fetchForTest;
}

export function __setD1RequestTimeoutMsForTest(timeoutMs: number | null): void {
  d1RequestTimeoutMs = timeoutMs ?? DEFAULT_D1_REQUEST_TIMEOUT_MS;
}

class D1HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function isD1HttpError(err: unknown): err is D1HttpError {
  return err instanceof D1HttpError;
}

type D1RawResult = {
  results?: { columns?: unknown; rows?: unknown };
  success?: boolean;
};

type D1ApiEnvelope = {
  success?: boolean;
  result?: D1RawResult[];
  errors?: Array<{ code?: number; message?: string }>;
};

// Cloudflare は失敗時も 200 + success:false を返すことがあるので、
// HTTP status と envelope.errors の両方を見る。D1 の authorizer 拒否
// (not authorized: SQLITE_AUTH) は文だけ見ても原因が分からないので、
// どの SQL で落ちたかを必ず添える。
function d1ErrorMessage(
  envelope: D1ApiEnvelope,
  status: number,
  sql: string,
): string {
  const first = envelope.errors?.find((entry) => entry?.message);
  const detail = first?.message?.replace(/\s+/g, " ").trim().slice(0, 240);
  const statement = sql.replace(/\s+/g, " ").trim().slice(0, 160);
  return `${detail || `D1 HTTP ${status}`} (sql: ${statement})`;
}

// D1 の JSON 値を DbValue に落とす。BLOB は byte 値の配列で返るので
// Uint8Array にする (グリッド側の binary 表示に合わせる)。
function toDbValue(value: unknown): RawDbValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" || typeof value === "string") return value;
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    return value.every((byte) => typeof byte === "number")
      ? new Uint8Array(value as number[])
      : JSON.stringify(value);
  }
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function parseRawResult(result: D1RawResult | undefined): QueryResult {
  const columns = Array.isArray(result?.results?.columns)
    ? (result.results.columns as unknown[]).map((name) => String(name))
    : [];
  const rawRows = Array.isArray(result?.results?.rows)
    ? (result.results.rows as unknown[])
    : [];
  const rows = rawRows.map((row) =>
    Array.isArray(row) ? row.map(toDbValue) : [],
  );
  return {
    columns,
    columnTypes: columns.map(() => "TEXT"),
    rows,
    rowCount: rows.length,
  };
}

// 呼び出し元の signal と要求タイムアウトのどちらでも中断できるようにする。
async function d1Fetch(
  url: string,
  init: RequestInit,
  signal: AbortSignal | undefined,
): Promise<Response> {
  if (signal?.aborted) throw new D1HttpError(503, "D1 request aborted");
  const controller = new AbortController();
  const onParentAbort = () => controller.abort();
  signal?.addEventListener("abort", onParentAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), d1RequestTimeoutMs);
  try {
    const d1FetchImpl = d1FetchOverride ?? globalThis.fetch;
    return await d1FetchImpl(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (signal?.aborted) throw new D1HttpError(503, "D1 request aborted");
    if (controller.signal.aborted) {
      throw new D1HttpError(
        503,
        `D1 request timed out after ${d1RequestTimeoutMs}ms`,
      );
    }
    throw new D1HttpError(
      503,
      `D1 request failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onParentAbort);
  }
}

export function createD1Adapter(config: D1Config): D1Source {
  const baseUrl = (config.apiBaseUrl || DEFAULT_D1_API_BASE_URL).replace(
    /\/$/,
    "",
  );
  const rawUrl = `${baseUrl}/accounts/${encodeURIComponent(config.accountId)}/d1/database/${encodeURIComponent(config.databaseId)}/raw`;
  const tableMetaCache = createTableMetaCache();

  async function runSql(
    sql: string,
    params: DbValue[] = [],
    signal?: AbortSignal,
  ): Promise<QueryResult> {
    // 資格情報はリポジトリ配下に書かず、OS キーチェーン (使えない環境では
    // プロセス内メモリのみ) で保持する。空のまま投げると Cloudflare からは
    // 素の "Authentication error" が返って原因が分からないので、ここで
    // 入れ直しを促す。
    if (!config.apiToken) {
      throw new D1HttpError(
        401,
        "D1 API token is missing. Reopen the connection dialog and enter the API token again (credentials are never stored in the repository).",
      );
    }
    recordSql(sql);
    const res = await d1Fetch(
      rawUrl,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiToken}`,
        },
        body: JSON.stringify({ sql, params }),
      },
      signal,
    );
    let envelope: D1ApiEnvelope;
    try {
      envelope = (await res.json()) as D1ApiEnvelope;
    } catch {
      throw new D1HttpError(res.status, `D1 HTTP ${res.status}: invalid JSON`);
    }
    if (!res.ok || envelope.success === false) {
      // Cloudflare が 200 + success:false を返すクエリエラーは、クライアントへは
      // 400 として扱う。メッセージ側にも同じ status を使う (res.status の 200 を
      // 埋め込むと "D1 HTTP 200" という食い違った文面になる)。
      const status = res.ok ? 400 : res.status;
      throw new D1HttpError(status, d1ErrorMessage(envelope, status, sql));
    }
    return parseRawResult(envelope.result?.[0]);
  }

  // sqlite_master / PRAGMA の結果を列名でオブジェクト化する。/raw は
  // { columns, rows } を返すので、行オブジェクトはここで組み立てる。
  async function runSqlRecords<T>(
    sql: string,
    params: DbValue[] = [],
    signal?: AbortSignal,
  ): Promise<T[]> {
    const result = await runSql(sql, params, signal);
    return result.rows.map((row) => {
      const record: Record<string, RawDbValue> = {};
      result.columns.forEach((column, index) => {
        record[column] = row[index] ?? null;
      });
      return record as T;
    });
  }

  async function loadColumns(
    table: string,
    signal?: AbortSignal,
  ): Promise<DbColumn[]> {
    const rows = await runSqlRecords<SqlitePragmaColumnRow>(
      sqliteTableInfoSql(table),
      [],
      signal,
    );
    return rows.map(sqliteColumnFromPragmaRow);
  }

  function getColumnsAsync(
    table: string,
    signal?: AbortSignal,
  ): Promise<DbColumn[]> {
    return tableMetaCache.getColumns(table, () => loadColumns(table, signal));
  }

  async function countRows(
    table: string,
    signal?: AbortSignal,
  ): Promise<number> {
    const result = await runSql(sqliteRowCountSql(table), [], signal);
    return Number(result.rows[0]?.[0] ?? 0);
  }

  async function selectPage(
    table: string,
    columns: DbColumn[],
    options: {
      offset: number;
      limit: number;
      orderBy?: DbOrder[];
      where?: string;
      params?: DbValue[];
    },
    signal?: AbortSignal,
  ): Promise<QueryResult> {
    const order = buildOrderClause(
      filterOrderByColumns(
        options.orderBy,
        columns.map((column) => column.name),
      ),
    );
    const whereClause = options.where ? ` WHERE ${options.where}` : "";
    return runSql(
      `SELECT * FROM ${sanitizeIdentifier(table)}${whereClause}${order} LIMIT ? OFFSET ?`,
      [...(options.params ?? []), options.limit, options.offset],
      signal,
    );
  }

  const adapter: D1Source = {
    kind: "d1",
    model: "sql",
    capabilities: { snapshot: true },

    async getTablesAsync(signal?: AbortSignal): Promise<DbTableInfo[]> {
      const rows = await runSqlRecords<{ name: string; type: string }>(
        SQLITE_INTROSPECTION_SQL.listTables,
        [],
        signal,
      );
      return rows
        .filter((row) => !isD1InternalName(row.name))
        .map(sqliteTableInfoFromRow);
    },

    getColumnsAsync,

    async getColumnsMultiAsync(
      tables: string[],
      signal?: AbortSignal,
    ): Promise<Map<string, DbColumn[]>> {
      const entries = await Promise.all(
        tables.map(
          async (table) =>
            [table, await getColumnsAsync(table, signal)] as const,
        ),
      );
      return new Map(entries);
    },

    async getIndexesAsync(signal?: AbortSignal): Promise<DbIndexInfo[]> {
      const indexes = await runSqlRecords<{ name: string; tbl_name: string }>(
        SQLITE_INTROSPECTION_SQL.listIndexes,
        [],
        signal,
      );
      const described = await Promise.all(
        indexes
          .filter(
            (index) =>
              !isD1InternalName(index.name) &&
              !isD1InternalName(index.tbl_name),
          )
          .map(async (index) => {
            try {
              const [info, indexList] = await Promise.all([
                runSqlRecords<{ name: string }>(
                  sqliteIndexInfoSql(index.name),
                  [],
                  signal,
                ),
                runSqlRecords<{ name: string; unique: number }>(
                  sqliteIndexListSql(index.tbl_name),
                  [],
                  signal,
                ),
              ]);
              const entry = indexList.find((row) => row.name === index.name);
              return {
                name: index.name,
                table: index.tbl_name,
                columns: info.map((row) => row.name),
                unique: entry ? Number(entry.unique) === 1 : false,
              };
            } catch (err) {
              // 中断は握り潰さない。握り潰すと「一部のインデックスが欠けた
              // スキーマ」を成功として返してしまう。
              if (isAbortLikeError(err, signal)) throw err;
              // 1 つのインデックスが内省できなくてもスキーマ全体は返す。
              return null;
            }
          }),
      );
      return described.filter((index): index is DbIndexInfo => index !== null);
    },

    async getForeignKeysAsync(signal?: AbortSignal): Promise<DbForeignKey[]> {
      const tables = await runSqlRecords<{ name: string }>(
        SQLITE_INTROSPECTION_SQL.listForeignKeyTables,
        [],
        signal,
      );
      const perTable = await Promise.all(
        tables
          .filter((table) => !isD1InternalName(table.name))
          .map(async (table) => {
            try {
              const rows = await runSqlRecords<{
                table: string;
                from: string;
                to: string;
              }>(sqliteForeignKeyListSql(table.name), [], signal);
              return rows.map((row) => ({
                fromTable: table.name,
                fromColumn: row.from,
                toTable: row.table,
                toColumn: row.to,
              }));
            } catch (err) {
              // 中断は握り潰さない (欠けた FK 一覧を成功として返さない)。
              if (isAbortLikeError(err, signal)) throw err;
              // 仮想テーブル等は PRAGMA foreign_key_list に応えない。
              return [];
            }
          }),
      );
      return perTable.flat();
    },

    getTableRowCountAsync(
      table: string,
      signal?: AbortSignal,
    ): Promise<number> {
      return tableMetaCache.getRowCount(table, () => countRows(table, signal));
    },

    async getTableRowCountsAsync(
      tables: string[],
      signal?: AbortSignal,
    ): Promise<Map<string, number>> {
      const result = new Map<string, number>();
      const countable = tables.filter((table) => !isD1InternalName(table));
      if (countable.length === 0) return result;
      try {
        const rows = await runSqlRecords<{ tbl: string; cnt: number }>(
          sqliteRowCountUnionSql(countable),
          [],
          signal,
        );
        for (const row of rows) result.set(String(row.tbl), Number(row.cnt));
        return result;
      } catch {
        // UNION ALL が長すぎる / 1 テーブルが読めない等で失敗したら
        // テーブル単位に落とす。読めない 1 つのために全体を落とさない
        // (件数が取れなかったテーブルは呼び出し側で 0 として扱われる)。
        for (const table of countable) {
          try {
            result.set(table, await countRows(table, signal));
          } catch (err) {
            if (isAbortLikeError(err, signal)) throw err;
          }
        }
        return result;
      }
    },

    async getTablePageAsync(
      table: string,
      options: { offset: number; limit: number; orderBy?: DbOrder[] },
      signal?: AbortSignal,
    ): Promise<QueryResult> {
      const columns = await getColumnsAsync(table, signal);
      return selectPage(table, columns, options, signal);
    },

    async getTablePageWithMeta(
      table: string,
      options: { offset: number; limit: number; orderBy?: DbOrder[] },
      signal?: AbortSignal,
    ): Promise<TablePageMeta> {
      const columns = await getColumnsAsync(table, signal);
      const [page, totalRows] = await Promise.all([
        selectPage(table, columns, options, signal),
        countRows(table, signal),
      ]);
      return {
        columns,
        rows: page.rows,
        rowCount: page.rowCount,
        totalRows,
      };
    },

    async getFilteredTablePageWithMeta(
      table: string,
      options: {
        offset: number;
        limit: number;
        orderBy?: DbOrder[];
        grouped: Map<string, string[]>;
        exact?: { column: string; value: string }[];
      },
      signal?: AbortSignal,
    ): Promise<TablePageMeta> {
      const columns = await getColumnsAsync(table, signal);
      const columnNames = columns.map((column) => column.name);
      const filter = buildFilterWhere(
        filterGroupedColumns(options.grouped, columnNames),
        "sqlite",
        filterExactColumns(options.exact, columnNames),
      );
      const whereClause = filter.where ? ` WHERE ${filter.where}` : "";
      const [page, countResult] = await Promise.all([
        selectPage(
          table,
          columns,
          { ...options, where: filter.where, params: filter.params },
          signal,
        ),
        runSql(
          `SELECT COUNT(*) AS cnt FROM ${sanitizeIdentifier(table)}${whereClause}`,
          filter.params,
          signal,
        ),
      ]);
      return {
        columns,
        rows: page.rows,
        rowCount: page.rowCount,
        totalRows: Number(countResult.rows[0]?.[0] ?? 0),
      };
    },

    async executeReadonlyQueryAsync(
      sql: string,
      params?: DbValue[],
      maxRows = 1000,
      signal?: AbortSignal,
    ): Promise<QueryResult> {
      assertReadonlySqliteStatement(sql);
      const limited = stripTrailingSemicolon(sql);
      let result: QueryResult;
      try {
        result = await runSql(
          `SELECT * FROM (${limited}) LIMIT ${maxRows + 1}`,
          params,
          signal,
        );
      } catch (wrapErr) {
        // PRAGMA / EXPLAIN はサブクエリに包めないので素の文へ落とす。
        try {
          result = await runSql(
            `${limited} LIMIT ${maxRows + 1}`,
            params,
            signal,
          );
        } catch {
          throw wrapErr;
        }
      }
      return result.rows.length > maxRows
        ? { ...result, rows: result.rows.slice(0, maxRows), rowCount: maxRows }
        : result;
    },

    invalidateTableMetaCache(table?: string): void {
      tableMetaCache.invalidate(table);
    },

    async getCreateStatementAsync(
      table: string,
      signal?: AbortSignal,
    ): Promise<string> {
      const rows = await runSqlRecords<{ sql: string | null }>(
        SQLITE_INTROSPECTION_SQL.createStatement,
        [table],
        signal,
      );
      return rows[0]?.sql ?? "";
    },

    async getTriggersAsync(
      table: string,
      signal?: AbortSignal,
    ): Promise<TriggerInfo[]> {
      const rows = await runSqlRecords<{ name: string; sql: string | null }>(
        SQLITE_INTROSPECTION_SQL.triggers,
        [table],
        signal,
      );
      return rows.map((row) => ({ name: row.name, sql: row.sql ?? "" }));
    },

    close(): void {
      // HTTP なので保持する接続は無い。
    },

    async *iterateForSnapshot(
      table: string,
      signal?: AbortSignal,
    ): AsyncIterable<SnapshotItem> {
      const columns = await adapter.getColumnsAsync(table, signal);
      const colNames = columns.map((column) => column.name);
      const pkColumns = columns
        .filter((column) => column.primaryKey)
        .map((column) => column.name);
      let offset = 0;
      let rowIndex = 0;
      for (;;) {
        if (signal?.aborted) return;
        const result = await adapter.getTablePageAsync(
          table,
          { offset, limit: SQL_SNAPSHOT_BATCH_SIZE },
          signal,
        );
        if (result.rows.length === 0) return;
        for (const row of result.rows) {
          yield {
            keyJson: buildRowKeyJson(pkColumns, colNames, row, rowIndex),
            rowHash: computeRowHash(colNames, row),
            payloadJson: rowToPayloadJson(colNames, row),
          };
          rowIndex++;
        }
        offset += result.rows.length;
        if (result.rows.length < SQL_SNAPSHOT_BATCH_SIZE) return;
      }
    },

    async listSnapshotContainers(): Promise<
      Array<{ id: string; label: string }>
    > {
      const tables = await adapter.getTablesAsync();
      return tables
        .filter((table) => table.type === "table")
        .map((table) => ({ id: table.name, label: table.name }));
    },
  };
  return adapter;
}
