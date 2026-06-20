import type {
  DbColumn,
  DbForeignKey,
  DbIndexInfo,
  DbOrder,
  DbTableInfo,
  DbValue,
} from "../../../core/database/types";
import type {
  DatabaseAdapter,
  DatabaseAdapterFactory,
  QueryResult,
  TriggerInfo,
} from "./types";

type SqliteDb = {
  prepare(sql: string): {
    all(...params: unknown[]): Record<string, unknown>[];
    get(...params: unknown[]): Record<string, unknown> | undefined;
    run(...params: unknown[]): { changes: number };
    columns?(): { name: string; type?: string }[];
  };
  close(): void;
  readonly?: boolean;
};

type SqliteConstructor = new (
  path: string,
  options?: { readonly?: boolean; create?: boolean },
) => SqliteDb;

let cachedDbClass: SqliteConstructor | null = null;

async function getSqliteClass(): Promise<SqliteConstructor> {
  if (cachedDbClass) return cachedDbClass;
  try {
    const mod = await import("bun:sqlite");
    cachedDbClass = mod.Database as unknown as SqliteConstructor;
    return cachedDbClass;
  } catch {
    // not running in Bun
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = await (Function(
      'return import("better-sqlite3")',
    )() as Promise<{ default?: unknown }>);
    cachedDbClass = (mod.default || mod) as unknown as SqliteConstructor;
    return cachedDbClass;
  } catch {
    // not installed
  }
  throw new Error(
    "No SQLite driver available. Install better-sqlite3 or run with Bun.",
  );
}

function sanitizeIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function buildOrderClause(orderBy?: DbOrder[]): string {
  if (!orderBy?.length) return "";
  const parts = orderBy.map(
    (o) =>
      `${sanitizeIdentifier(o.column)} ${o.direction === "desc" ? "DESC" : "ASC"}`,
  );
  return ` ORDER BY ${parts.join(", ")}`;
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

function createSqliteAdapter(db: SqliteDb): DatabaseAdapter {
  return {
    kind: "sqlite",

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

    getColumns(table: string): DbColumn[] {
      return queryColumns(db, table);
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

    getColumnsMulti(tables: string[]): Map<string, DbColumn[]> {
      const result = new Map<string, DbColumn[]>();
      for (const t of tables) {
        result.set(t, queryColumns(db, t));
      }
      return result;
    },

    getTableRowCount(table: string): number {
      const row = db
        .prepare(`SELECT COUNT(*) AS cnt FROM ${sanitizeIdentifier(table)}`)
        .get() as { cnt: number } | undefined;
      return row?.cnt ?? 0;
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

    getTablePage(
      table: string,
      options: { offset: number; limit: number; orderBy?: DbOrder[] },
    ): QueryResult {
      const order = buildOrderClause(options.orderBy);
      const sql = `SELECT * FROM ${sanitizeIdentifier(table)}${order} LIMIT ? OFFSET ?`;
      const rows = db.prepare(sql).all(options.limit, options.offset) as Record<
        string,
        DbValue
      >[];
      const cols = queryColumns(db, table);
      if (rows.length === 0) {
        return {
          columns: cols.map((c) => c.name),
          columnTypes: cols.map((c) => c.type),
          rows: [],
          rowCount: 0,
        };
      }
      const columnNames = Object.keys(rows[0]);
      const typeMap = new Map(cols.map((c) => [c.name, c.type]));
      return {
        columns: columnNames,
        columnTypes: columnNames.map((n) => typeMap.get(n) || "TEXT"),
        rows: rows.map((row) => columnNames.map((col) => row[col] as DbValue)),
        rowCount: rows.length,
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
        rows = db.prepare(wrappedSql).all(...(params || [])) as Record<
          string,
          DbValue
        >[];
      } catch (wrapErr) {
        const fallbackSql = `${limited} LIMIT ${maxRows + 1}`;
        try {
          rows = db.prepare(fallbackSql).all(...(params || [])) as Record<
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

    getCreateStatement(table: string): string {
      const row = db
        .prepare("SELECT sql FROM sqlite_master WHERE name = ?")
        .get(table) as { sql: string } | undefined;
      return row?.sql ?? "";
    },

    getTriggers(table: string): TriggerInfo[] {
      const rows = db
        .prepare(
          "SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name = ?",
        )
        .all(table) as { name: string; sql: string }[];
      return rows.map((row) => ({ name: row.name, sql: row.sql ?? "" }));
    },

    close(): void {
      db.close();
    },
  };
}

export const sqliteAdapterFactory: DatabaseAdapterFactory = {
  async open(path: string): Promise<DatabaseAdapter> {
    const DbClass = await getSqliteClass();
    const db = new DbClass(path, { readonly: true, create: false });
    return createSqliteAdapter(db);
  },
};
