import type {
  DbColumn,
  DbForeignKey,
  DbIndexInfo,
  DbOrder,
  DbTableInfo,
  DbValue,
  RowMutation,
} from "../../../core/database/types";
import { buildMutationStatements } from "../mutate";
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
import { loadSqliteClass } from "../sqlite-driver";
import { recordSql } from "./sql-capture";
import type {
  DatabaseAdapter,
  DatabaseAdapterFactory,
  MutationResult,
  QueryResult,
  TablePageMeta,
  TriggerInfo,
} from "./types";

// adapters は SqlSource & SnapshotIterable を実体として返す。
// 旧 DatabaseAdapter signature の caller 互換のため、返却型は
// `DatabaseAdapter` を満たす上位互換になっている。
type SqliteSource = DatabaseAdapter & {
  readonly model: "sql";
  readonly capabilities: { snapshot: true };
  iterateForSnapshot(
    table: string,
    signal?: AbortSignal,
  ): AsyncIterable<SnapshotItem>;
  listSnapshotContainers(): Promise<Array<{ id: string; label: string }>>;
} & SqliteSyncHelpers;

type SqliteSyncHelpers = {
  getTables(): DbTableInfo[];
  getColumns(table: string): DbColumn[];
  getIndexes(): DbIndexInfo[];
  getForeignKeys(): DbForeignKey[];
  getColumnsMulti(tables: string[]): Map<string, DbColumn[]>;
  getTableRowCount(table: string): number;
  getTableRowCounts(tables: string[]): Map<string, number>;
  getTablePage(
    table: string,
    options: { offset: number; limit: number; orderBy?: DbOrder[] },
  ): QueryResult;
  executeReadonlyQuery(
    sql: string,
    params?: DbValue[],
    maxRows?: number,
  ): QueryResult;
  getCreateStatement(table: string): string;
  getTriggers(table: string): TriggerInfo[];
};

type SqliteStmt = {
  all(...params: unknown[]): Record<string, unknown>[];
  get(...params: unknown[]): Record<string, unknown> | undefined;
  run(...params: unknown[]): { changes: number };
  columns?(): { name: string; type?: string }[];
  safeIntegers?(toggle: boolean): SqliteStmt;
};

type SqliteDb = {
  prepare(sql: string): SqliteStmt;
  close(): void;
  readonly?: boolean;
};

function safePrepare(db: SqliteDb, sql: string): SqliteStmt {
  const stmt = db.prepare(sql);
  if (typeof stmt.safeIntegers === "function") {
    try {
      stmt.safeIntegers(true);
    } catch {
      // some drivers reject for non-SELECT; ignore
    }
  }
  return stmt;
}

// 他プロセス (アプリ自体の Rails/Node サーバーなど) が同じファイルに書き込み中
// だと、readonly 接続でも SQLite はロック解放待ちで同期的にブロックする。
// bun:sqlite / better-sqlite3 とも既定の busy_timeout は 0 (即座に SQLITE_BUSY
// を返す) ではなくドライバ依存で無期限に近い待ちになり得るため、明示的に短い
// 上限を設定する。Bun はシングルスレッドなので、ここが長く詰まると DB と無関
// 係な他リクエストまで巻き込んで全体が固まる。
const SQLITE_BUSY_TIMEOUT_MS = 2000;

function applyBusyTimeout(db: SqliteDb): void {
  try {
    db.prepare(`PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`).get();
  } catch {
    // PRAGMA is best-effort; a driver that rejects it still opens the DB.
  }
}

function queryRowsToResult(
  rows: Record<string, DbValue>[],
  columns: DbColumn[],
): QueryResult {
  const columnNames =
    rows.length > 0 ? Object.keys(rows[0]) : columns.map((c) => c.name);
  const typeMap = new Map(columns.map((c) => [c.name, c.type]));
  return {
    columns: columnNames,
    columnTypes: columnNames.map((name) => typeMap.get(name) || "TEXT"),
    rows: rows.map((row) => columnNames.map((col) => row[col] as DbValue)),
    rowCount: rows.length,
  };
}

function queryColumns(db: SqliteDb, table: string): DbColumn[] {
  const rows = db
    .prepare(`PRAGMA table_info(${sanitizeIdentifier(table)})`)
    .all() as {
    name: string;
    type: string;
    notnull: number;
    dflt_value: string | null;
    pk: number;
  }[];
  return rows.map((row) => ({
    name: row.name,
    type: row.type || "TEXT",
    nullable: row.notnull === 0,
    primaryKey: row.pk > 0,
    defaultValue: row.dflt_value,
  }));
}

// db.prepare(sql) のたびに recordSql(sql) を呼ぶ Proxy。adapter 内で発行する
// SQL を 1 箇所で捕捉する (handler 側で captureSql で囲って response の
// executedSql に流すため)。capture context が無いときは recordSql が no-op
// なので副作用は無い。close は元の db に委譲。
function wrapDbWithSqlCapture(rawDb: SqliteDb): SqliteDb {
  return new Proxy(rawDb, {
    get(target, prop, receiver) {
      if (prop === "prepare") {
        return (sql: string) => {
          recordSql(sql);
          return target.prepare(sql);
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

function createSqliteAdapter(
  rawDb: SqliteDb,
  openRawWriteDb?: () => SqliteDb,
): SqliteSource {
  const db = wrapDbWithSqlCapture(rawDb);
  // 読み取り接続 (db) は readonly で開かれている。書き込みは別途 readonly:false
  // の接続を遅延生成して使い回す (既存の読み取りパスは一切触らない)。
  let writeDb: SqliteDb | null = null;
  const getWriteDb = (): SqliteDb => {
    if (!openRawWriteDb) {
      throw new Error("writes are not supported for this connection");
    }
    if (!writeDb) writeDb = wrapDbWithSqlCapture(openRawWriteDb());
    return writeDb;
  };
  const adapter: SqliteSource = {
    kind: "sqlite",
    model: "sql",
    capabilities: { snapshot: true },

    getTables(): DbTableInfo[] {
      const rows = db
        .prepare(
          "SELECT name, type FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY name",
        )
        .all() as { name: string; type: string }[];
      return rows.map((row) => ({
        name: row.name,
        type: row.type as "table" | "view",
        rowCount: null,
      }));
    },

    async getTablesAsync(): Promise<DbTableInfo[]> {
      return this.getTables();
    },

    getColumns(table: string): DbColumn[] {
      return queryColumns(db, table);
    },

    async getColumnsAsync(table: string): Promise<DbColumn[]> {
      return this.getColumns(table);
    },

    getIndexes(): DbIndexInfo[] {
      const rows = db
        .prepare(
          "SELECT name, tbl_name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        )
        .all() as { name: string; tbl_name: string }[];
      return rows.map((row) => {
        const info = db
          .prepare(`PRAGMA index_info(${sanitizeIdentifier(row.name)})`)
          .all() as { name: string }[];
        const indexList = db
          .prepare(`PRAGMA index_list(${sanitizeIdentifier(row.tbl_name)})`)
          .all() as { name: string; unique: number }[];
        const entry = indexList.find((i) => i.name === row.name);
        return {
          name: row.name,
          table: row.tbl_name,
          columns: info.map((i) => i.name),
          unique: entry ? entry.unique === 1 : false,
        };
      });
    },

    async getIndexesAsync(): Promise<DbIndexInfo[]> {
      return this.getIndexes();
    },

    getForeignKeys(): DbForeignKey[] {
      const tables = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND sql NOT LIKE '%VIRTUAL%' ORDER BY name",
        )
        .all() as { name: string }[];
      const fks: DbForeignKey[] = [];
      for (const t of tables) {
        try {
          const rows = db
            .prepare(`PRAGMA foreign_key_list(${sanitizeIdentifier(t.name)})`)
            .all() as { table: string; from: string; to: string }[];
          for (const row of rows) {
            fks.push({
              fromTable: t.name,
              fromColumn: row.from,
              toTable: row.table,
              toColumn: row.to,
            });
          }
        } catch {
          // virtual tables (FTS, etc.) may not support this PRAGMA
        }
      }
      return fks;
    },

    async getForeignKeysAsync(): Promise<DbForeignKey[]> {
      return this.getForeignKeys();
    },

    getColumnsMulti(tables: string[]): Map<string, DbColumn[]> {
      const result = new Map<string, DbColumn[]>();
      for (const t of tables) {
        result.set(t, queryColumns(db, t));
      }
      return result;
    },

    async getColumnsMultiAsync(
      tables: string[],
    ): Promise<Map<string, DbColumn[]>> {
      return this.getColumnsMulti(tables);
    },

    getTableRowCount(table: string): number {
      const row = db
        .prepare(`SELECT COUNT(*) AS cnt FROM ${sanitizeIdentifier(table)}`)
        .get() as { cnt: number } | undefined;
      return row?.cnt ?? 0;
    },

    async getTableRowCountAsync(table: string): Promise<number> {
      return this.getTableRowCount(table);
    },

    getTableRowCounts(tables: string[]): Map<string, number> {
      const result = new Map<string, number>();
      if (tables.length === 0) return result;
      const parts = tables.map(
        (t) =>
          `SELECT '${t.replace(/'/g, "''")}' AS tbl, COUNT(*) AS cnt FROM ${sanitizeIdentifier(t)}`,
      );
      const sql = parts.join(" UNION ALL ");
      try {
        const rows = db.prepare(sql).all() as { tbl: string; cnt: number }[];
        for (const row of rows) {
          result.set(row.tbl, row.cnt);
        }
      } catch {
        for (const t of tables) {
          const row = db
            .prepare(`SELECT COUNT(*) AS cnt FROM ${sanitizeIdentifier(t)}`)
            .get() as { cnt: number } | undefined;
          result.set(t, row?.cnt ?? 0);
        }
      }
      return result;
    },

    async getTableRowCountsAsync(
      tables: string[],
    ): Promise<Map<string, number>> {
      return this.getTableRowCounts(tables);
    },

    getTablePage(
      table: string,
      options: { offset: number; limit: number; orderBy?: DbOrder[] },
    ): QueryResult {
      const order = buildOrderClause(options.orderBy);
      const sql = `SELECT * FROM ${sanitizeIdentifier(table)}${order} LIMIT ? OFFSET ?`;
      const rows = safePrepare(db, sql).all(
        options.limit,
        options.offset,
      ) as Record<string, DbValue>[];
      const cols = queryColumns(db, table);
      return queryRowsToResult(rows, cols);
    },

    async getTablePageAsync(
      table: string,
      options: { offset: number; limit: number; orderBy?: DbOrder[] },
    ): Promise<QueryResult> {
      return this.getTablePage(table, options);
    },

    async getTablePageWithMeta(
      table: string,
      options: { offset: number; limit: number; orderBy?: DbOrder[] },
    ): Promise<TablePageMeta> {
      const columns = queryColumns(db, table);
      const orderBy = filterOrderByColumns(
        options.orderBy,
        columns.map((column) => column.name),
      );
      const order = buildOrderClause(orderBy);
      const sql = `SELECT * FROM ${sanitizeIdentifier(table)}${order} LIMIT ? OFFSET ?`;
      const rows = safePrepare(db, sql).all(
        options.limit,
        options.offset,
      ) as Record<string, DbValue>[];
      const result = queryRowsToResult(rows, columns);
      const totalRows = this.getTableRowCount(table);
      return {
        columns,
        rows: result.rows,
        rowCount: result.rowCount,
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
    ): Promise<TablePageMeta> {
      const columns = queryColumns(db, table);
      const columnNames = columns.map((column) => column.name);
      const filter = buildFilterWhere(
        filterGroupedColumns(options.grouped, columnNames),
        "sqlite",
        filterExactColumns(options.exact, columnNames),
      );
      const order = buildOrderClause(
        filterOrderByColumns(options.orderBy, columnNames),
      );
      const tableId = sanitizeIdentifier(table);
      const whereClause = filter.where ? ` WHERE ${filter.where}` : "";
      // safePrepare enables safeIntegers, so COUNT(*) comes back as a bigint.
      // totalRows is serialized straight into the JSON response (not via
      // serializeDbValue), so coerce it to a number here to avoid
      // "JSON.stringify cannot serialize BigInt".
      const countRow = safePrepare(
        db,
        `SELECT COUNT(*) AS cnt FROM ${tableId}${whereClause}`,
      ).get(...filter.params) as { cnt: number | bigint } | undefined;
      const rows = safePrepare(
        db,
        `SELECT * FROM ${tableId}${whereClause}${order} LIMIT ? OFFSET ?`,
      ).all(...filter.params, options.limit, options.offset) as Record<
        string,
        DbValue
      >[];
      const result = queryRowsToResult(rows, columns);
      return {
        columns,
        rows: result.rows,
        rowCount: result.rowCount,
        totalRows: Number(countRow?.cnt ?? 0),
      };
    },

    executeReadonlyQuery(
      sql: string,
      params?: DbValue[],
      maxRows = 1000,
    ): QueryResult {
      const trimmed = sql.trim();
      const upper = trimmed.toUpperCase();
      const firstWord = upper.split(/\s/)[0];
      if (
        firstWord !== "SELECT" &&
        firstWord !== "PRAGMA" &&
        firstWord !== "EXPLAIN" &&
        firstWord !== "WITH"
      ) {
        throw new Error(
          "Only SELECT, PRAGMA, EXPLAIN, and WITH queries are allowed",
        );
      }
      const BLOCKED_RE =
        /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|ATTACH|DETACH|REPLACE|VACUUM|REINDEX|LOAD_EXTENSION)\b/;
      if (BLOCKED_RE.test(upper)) {
        throw new Error("Query contains a disallowed statement keyword");
      }
      const limited = trimmed.replace(/;\s*$/, "");
      const wrappedSql = `SELECT * FROM (${limited}) LIMIT ${maxRows + 1}`;
      let rows: Record<string, DbValue>[];
      try {
        rows = safePrepare(db, wrappedSql).all(...(params || [])) as Record<
          string,
          DbValue
        >[];
      } catch (wrapErr) {
        const fallbackSql = `${limited} LIMIT ${maxRows + 1}`;
        try {
          rows = safePrepare(db, fallbackSql).all(...(params || [])) as Record<
            string,
            DbValue
          >[];
        } catch {
          throw wrapErr;
        }
      }
      const truncated = rows.length > maxRows;
      if (truncated) rows = rows.slice(0, maxRows);
      if (rows.length === 0) {
        return { columns: [], columnTypes: [], rows: [], rowCount: 0 };
      }
      const columnNames = Object.keys(rows[0]);
      return {
        columns: columnNames,
        columnTypes: columnNames.map(() => "TEXT"),
        rows: rows.map((row) => columnNames.map((col) => row[col] as DbValue)),
        rowCount: rows.length,
      };
    },

    async executeReadonlyQueryAsync(
      sql: string,
      params?: DbValue[],
      maxRows?: number,
    ): Promise<QueryResult> {
      return this.executeReadonlyQuery(sql, params, maxRows);
    },

    getCreateStatement(table: string): string {
      const row = db
        .prepare("SELECT sql FROM sqlite_master WHERE name = ?")
        .get(table) as { sql: string } | undefined;
      return row?.sql ?? "";
    },

    async getCreateStatementAsync(table: string): Promise<string> {
      return this.getCreateStatement(table);
    },

    getTriggers(table: string): TriggerInfo[] {
      const rows = db
        .prepare(
          "SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name = ?",
        )
        .all(table) as { name: string; sql: string }[];
      return rows.map((row) => ({ name: row.name, sql: row.sql ?? "" }));
    },

    async getTriggersAsync(table: string): Promise<TriggerInfo[]> {
      return this.getTriggers(table);
    },

    async applyMutations(
      table: string,
      mutations: RowMutation[],
    ): Promise<MutationResult> {
      const columns = queryColumns(db, table);
      if (columns.length === 0) {
        throw new Error(`unknown table: ${table}`);
      }
      const statements = buildMutationStatements(
        table,
        mutations,
        columns,
        "sqlite",
      );
      const wdb = getWriteDb();
      let affected = 0;
      wdb.prepare("BEGIN").run();
      try {
        for (const stmt of statements) {
          const result = wdb.prepare(stmt.sql).run(...stmt.params);
          affected += result.changes ?? 0;
        }
        wdb.prepare("COMMIT").run();
      } catch (err) {
        try {
          wdb.prepare("ROLLBACK").run();
        } catch {
          // ロールバック失敗は元のエラーを優先するため握りつぶす。
        }
        throw err;
      }
      return { affected };
    },

    close(): void {
      if (writeDb) {
        try {
          writeDb.close();
        } catch {
          // ignore
        }
        writeDb = null;
      }
      db.close();
    },

    async *iterateForSnapshot(
      table: string,
      signal?: AbortSignal,
    ): AsyncIterable<SnapshotItem> {
      const columns = await adapter.getColumnsAsync(table);
      const colNames = columns.map((c) => c.name);
      const pkColumns = columns.filter((c) => c.primaryKey).map((c) => c.name);
      let offset = 0;
      let rowIndex = 0;
      for (;;) {
        if (signal?.aborted) return;
        const result = await adapter.getTablePageAsync(table, {
          offset,
          limit: SQL_SNAPSHOT_BATCH_SIZE,
        });
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

export const sqliteAdapterFactory: DatabaseAdapterFactory = {
  async open(path: string): Promise<DatabaseAdapter> {
    const DbClass = await loadSqliteClass<SqliteDb>();
    const db = new DbClass(path, { readonly: true, create: false });
    applyBusyTimeout(db);
    // 書き込み用接続は実際に書き込みが要求されたときだけ遅延生成する。
    // 既定 (read-write) で開く: ここに到達した時点で readonly 接続が同じファイル
    // を開けているので必ず存在しており、create が走ることはない。driver 差
    // (bun:sqlite と better-sqlite3 で write+no-create のオプション表現が異なる)
    // を避けるためオプションは渡さない。
    const openWriteDb = () => {
      const wdb = new DbClass(path);
      applyBusyTimeout(wdb);
      return wdb;
    };
    return createSqliteAdapter(db, openWriteDb);
  },
};
