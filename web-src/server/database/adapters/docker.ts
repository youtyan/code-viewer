import { spawnSync } from "node:child_process";
import type {
  DbColumn,
  DbForeignKey,
  DbIndexInfo,
  DbOrder,
  DbTableInfo,
  DbValue,
} from "../../../core/database/types";
import {
  buildRowKeyJson,
  computeRowHash,
  rowToPayloadJson,
  SQL_SNAPSHOT_BATCH_SIZE,
} from "../sources/sql-snapshot";
import type { SnapshotItem } from "../sources/types";
import type { DatabaseAdapter, QueryResult, TriggerInfo } from "./types";

// adapters は SqlSource & SnapshotIterable を満たす形を返す。
// DockerSource は DatabaseAdapter の上位互換なので、既存 caller の型は維持される。
type DockerSource = DatabaseAdapter & {
  readonly model: "sql";
  readonly capabilities: { snapshot: true };
  iterateForSnapshot(
    table: string,
    signal?: AbortSignal,
  ): AsyncIterable<SnapshotItem>;
  listSnapshotContainers(): Promise<Array<{ id: string; label: string }>>;
};

type DockerDbConfig = {
  kind: "postgresql" | "mysql";
  containerName: string;
  user: string;
  password: string;
  database: string;
};

function execInContainer(
  config: DockerDbConfig,
  sql: string,
  timeoutMs = 10000,
): { stdout: string; stderr: string; code: number } {
  let args: string[];
  if (config.kind === "postgresql") {
    args = [
      "docker",
      "exec",
      "-i",
      "-e",
      `PGPASSWORD=${config.password}`,
      config.containerName,
      "psql",
      "-U",
      config.user,
      "-d",
      config.database,
      "-X",
      "-q",
      "-t",
      "-A",
      "-F",
      "\t",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      sql,
    ];
  } else {
    args = [
      "docker",
      "exec",
      "-i",
      "-e",
      `MYSQL_PWD=${config.password}`,
      config.containerName,
      "mysql",
      "-u",
      config.user,
      config.database,
      "--batch",
      "--raw",
      "--default-character-set=utf8mb4",
      "-e",
      sql,
    ];
  }
  const proc = spawnSync(args[0], args.slice(1), {
    encoding: "utf8",
    timeout: timeoutMs,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    stdout: proc.stdout || "",
    stderr: proc.stderr || "",
    code: proc.status ?? 1,
  };
}

function parseTsvOutput(
  stdout: string,
  hasHeader: boolean,
): { columns: string[]; rows: string[][] } {
  const lines = stdout.trim().split("\n").filter(Boolean);
  if (lines.length === 0) return { columns: [], rows: [] };
  if (hasHeader) {
    const columns = lines[0].split("\t");
    const rows = lines.slice(1).map((line) => line.split("\t"));
    return { columns, rows };
  }
  const rows = lines.map((line) => line.split("\t"));
  return { columns: [], rows };
}

function sanitizeIdentifier(
  name: string,
  kind: "postgresql" | "mysql",
): string {
  if (kind === "mysql") return `\`${name.replace(/`/g, "``")}\``;
  return `"${name.replace(/"/g, '""')}"`;
}

function buildOrderClause(
  orderBy: DbOrder[] | undefined,
  kind: "postgresql" | "mysql",
): string {
  if (!orderBy?.length) return "";
  const parts = orderBy.map(
    (o) =>
      `${sanitizeIdentifier(o.column, kind)} ${o.direction === "desc" ? "DESC" : "ASC"}`,
  );
  return ` ORDER BY ${parts.join(", ")}`;
}

function createDockerAdapter(config: DockerDbConfig): DockerSource {
  function exec(sql: string): { columns: string[]; rows: string[][] } {
    const result = execInContainer(config, sql);
    if (result.code !== 0) {
      throw new Error(result.stderr.trim() || "query failed");
    }
    return parseTsvOutput(result.stdout, config.kind === "mysql");
  }

  function toDbValue(val: string): DbValue {
    if (val === "NULL" || val === "\\N") return null;
    return val;
  }

  const columnCache = new Map<string, DbColumn[]>();

  function fetchColumnsUncached(table: string): DbColumn[] {
    let sql: string;
    if (config.kind === "postgresql") {
      sql = `SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = '${table.replace(/'/g, "''")}' ORDER BY ordinal_position`;
    } else {
      sql = `SELECT column_name, column_type, is_nullable, column_default, column_key FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = '${table.replace(/'/g, "''")}' ORDER BY ordinal_position`;
    }
    const result = exec(sql);
    if (config.kind === "postgresql") {
      const pkSql = `SELECT a.attname FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey) WHERE i.indrelid = '${table.replace(/'/g, "''")}'::regclass AND i.indisprimary`;
      let pkCols: Set<string>;
      try {
        const pkResult = exec(pkSql);
        pkCols = new Set(pkResult.rows.map((r: string[]) => r[0]));
      } catch {
        pkCols = new Set();
      }
      return result.rows.map((row: string[]) => ({
        name: row[0],
        type: row[1],
        nullable: row[2] === "YES",
        primaryKey: pkCols.has(row[0]),
        defaultValue: row[3] === "" ? null : row[3],
      }));
    }
    return result.rows.map((row: string[]) => ({
      name: row[0],
      type: row[1],
      nullable: row[2] === "YES",
      primaryKey: row[4] === "PRI",
      defaultValue: row[3] === "NULL" ? null : row[3],
    }));
  }

  const adapter: DockerSource = {
    kind: config.kind,
    model: "sql",
    capabilities: { snapshot: true },

    getTables(): DbTableInfo[] {
      let sql: string;
      if (config.kind === "postgresql") {
        sql = `SELECT table_name, table_type FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`;
      } else {
        sql = `SELECT table_name, table_type FROM information_schema.tables WHERE table_schema = DATABASE() ORDER BY table_name`;
      }
      const result = exec(sql);
      return result.rows.map((row) => ({
        name: row[0],
        type: (row[1] === "VIEW" ? "view" : "table") as "table" | "view",
        rowCount: null,
      }));
    },

    getColumns(table: string): DbColumn[] {
      const cached = columnCache.get(table);
      if (cached) return cached;
      const cols = fetchColumnsUncached(table);
      columnCache.set(table, cols);
      return cols;
    },

    getIndexes(): DbIndexInfo[] {
      let sql: string;
      if (config.kind === "postgresql") {
        sql = `SELECT indexname, tablename FROM pg_indexes WHERE schemaname = 'public' AND indexname NOT LIKE 'pg_%' ORDER BY indexname`;
      } else {
        sql = `SELECT DISTINCT index_name, table_name, non_unique FROM information_schema.statistics WHERE table_schema = DATABASE() ORDER BY index_name`;
      }
      const result = exec(sql);
      if (config.kind === "postgresql") {
        return result.rows.map((row) => ({
          name: row[0],
          table: row[1],
          columns: [],
          unique: false,
        }));
      }
      return result.rows.map((row) => ({
        name: row[0],
        table: row[1],
        columns: [],
        unique: row[2] === "0",
      }));
    },

    getForeignKeys(): DbForeignKey[] {
      let sql: string;
      if (config.kind === "postgresql") {
        sql = `SELECT tc.table_name, kcu.column_name, ccu.table_name, ccu.column_name FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'`;
      } else {
        sql = `SELECT table_name, column_name, referenced_table_name, referenced_column_name FROM information_schema.key_column_usage WHERE table_schema = DATABASE() AND referenced_table_name IS NOT NULL`;
      }
      try {
        const result = exec(sql);
        return result.rows.map((row) => ({
          fromTable: row[0],
          fromColumn: row[1],
          toTable: row[2],
          toColumn: row[3],
        }));
      } catch {
        return [];
      }
    },

    getColumnsMulti(tables: string[]): Map<string, DbColumn[]> {
      const result = new Map<string, DbColumn[]>();
      const uncached = tables.filter((t) => {
        const c = columnCache.get(t);
        if (c) result.set(t, c);
        return !c;
      });
      if (uncached.length === 0) return result;
      let sql: string;
      if (config.kind === "postgresql") {
        const inList = uncached
          .map((t) => `'${t.replace(/'/g, "''")}'`)
          .join(",");
        sql = `SELECT table_name, column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name IN (${inList}) ORDER BY table_name, ordinal_position`;
      } else {
        const inList = uncached
          .map((t) => `'${t.replace(/'/g, "''")}'`)
          .join(",");
        sql = `SELECT table_name, column_name, column_type, is_nullable, column_default, column_key FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name IN (${inList}) ORDER BY table_name, ordinal_position`;
      }
      try {
        const queryResult = exec(sql);
        const grouped = new Map<string, string[][]>();
        for (const row of queryResult.rows) {
          const tbl = row[0];
          const existing = grouped.get(tbl) || [];
          existing.push(row);
          grouped.set(tbl, existing);
        }
        let pkMap = new Map<string, Set<string>>();
        if (config.kind === "postgresql") {
          try {
            const pkInList = uncached
              .map((t) => `'${t.replace(/'/g, "''")}'`)
              .join(",");
            const pkResult = exec(
              `SELECT c.relname, a.attname FROM pg_index i JOIN pg_class c ON c.oid = i.indrelid JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey) WHERE i.indisprimary AND c.relname IN (${pkInList})`,
            );
            for (const row of pkResult.rows) {
              const existing = pkMap.get(row[0]) || new Set<string>();
              existing.add(row[1]);
              pkMap.set(row[0], existing);
            }
          } catch {
            pkMap = new Map();
          }
        }
        for (const [tbl, rows] of grouped) {
          const pkCols = pkMap.get(tbl) || new Set<string>();
          let cols: DbColumn[];
          if (config.kind === "postgresql") {
            cols = rows.map((row: string[]) => ({
              name: row[1],
              type: row[2],
              nullable: row[3] === "YES",
              primaryKey: pkCols.has(row[1]),
              defaultValue: row[4] === "" ? null : row[4],
            }));
          } else {
            cols = rows.map((row: string[]) => ({
              name: row[1],
              type: row[2],
              nullable: row[3] === "YES",
              primaryKey: row[5] === "PRI",
              defaultValue: row[4] === "NULL" ? null : row[4],
            }));
          }
          columnCache.set(tbl, cols);
          result.set(tbl, cols);
        }
      } catch {
        for (const t of uncached) {
          const cols = fetchColumnsUncached(t);
          columnCache.set(t, cols);
          result.set(t, cols);
        }
      }
      return result;
    },

    getTableRowCount(table: string): number {
      const id = sanitizeIdentifier(table, config.kind);
      const result = exec(`SELECT COUNT(*) FROM ${id}`);
      return result.rows.length > 0 ? Number(result.rows[0][0]) || 0 : 0;
    },

    getTableRowCounts(tables: string[]): Map<string, number> {
      const result = new Map<string, number>();
      if (tables.length === 0) return result;
      const parts = tables.map((t) => {
        const id = sanitizeIdentifier(t, config.kind);
        return `SELECT '${t.replace(/'/g, "''")}' AS tbl, COUNT(*) AS cnt FROM ${id}`;
      });
      const sql = parts.join(" UNION ALL ");
      try {
        const queryResult = exec(sql);
        for (const row of queryResult.rows) {
          result.set(row[0], Number(row[1]) || 0);
        }
      } catch {
        for (const t of tables) {
          const id = sanitizeIdentifier(t, config.kind);
          try {
            const r = exec(`SELECT COUNT(*) FROM ${id}`);
            result.set(t, r.rows.length > 0 ? Number(r.rows[0][0]) || 0 : 0);
          } catch {
            result.set(t, 0);
          }
        }
      }
      return result;
    },

    getTablePage(
      table: string,
      options: { offset: number; limit: number; orderBy?: DbOrder[] },
    ): QueryResult {
      const id = sanitizeIdentifier(table, config.kind);
      const order = buildOrderClause(options.orderBy, config.kind);
      const sql = `SELECT * FROM ${id}${order} LIMIT ${options.limit} OFFSET ${options.offset}`;
      const result = exec(sql);
      const cols = this.getColumns(table);
      if (result.rows.length === 0) {
        return {
          columns: cols.map((c: DbColumn) => c.name),
          columnTypes: cols.map((c: DbColumn) => c.type),
          rows: [],
          rowCount: 0,
        };
      }
      const columnNames =
        config.kind === "mysql"
          ? result.columns
          : cols.map((c: DbColumn) => c.name);
      const typeMap = new Map(
        cols.map((c: DbColumn) => [c.name, c.type] as const),
      );
      return {
        columns: columnNames,
        columnTypes: columnNames.map((n: string) => typeMap.get(n) || "TEXT"),
        rows: result.rows.map((row) => row.map(toDbValue)),
        rowCount: result.rows.length,
      };
    },

    executeReadonlyQuery(
      sql: string,
      _params?: DbValue[],
      maxRows = 1000,
    ): QueryResult {
      const trimmed = sql.trim();
      const upper = trimmed.toUpperCase();
      const firstWord = upper.split(/\s/)[0];
      if (
        firstWord !== "SELECT" &&
        firstWord !== "EXPLAIN" &&
        firstWord !== "WITH" &&
        firstWord !== "SHOW" &&
        firstWord !== "DESCRIBE"
      ) {
        throw new Error(
          "Only SELECT, EXPLAIN, WITH, SHOW, and DESCRIBE queries are allowed",
        );
      }
      const BLOCKED_RE =
        /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|ATTACH|DETACH|REPLACE|VACUUM|TRUNCATE|GRANT|REVOKE)\b/;
      if (BLOCKED_RE.test(upper)) {
        throw new Error("Query contains a disallowed statement keyword");
      }
      const readOnlyPreamble =
        config.kind === "postgresql"
          ? "BEGIN TRANSACTION READ ONLY; "
          : "SET SESSION TRANSACTION READ ONLY; ";
      const readOnlyPostamble =
        config.kind === "postgresql"
          ? "; COMMIT"
          : "; SET SESSION TRANSACTION READ WRITE";
      const stripped = trimmed.replace(/;\s*$/, "");
      const limited = `${readOnlyPreamble}${stripped} LIMIT ${maxRows}${readOnlyPostamble}`;
      const result = exec(limited);
      const columnNames =
        config.kind === "mysql" && result.columns.length > 0
          ? result.columns
          : result.rows.length > 0
            ? Array.from(
                { length: result.rows[0].length },
                (_, i) => `col${i + 1}`,
              )
            : [];
      return {
        columns: columnNames,
        columnTypes: columnNames.map(() => "TEXT"),
        rows: result.rows.slice(0, maxRows).map((row) => row.map(toDbValue)),
        rowCount: Math.min(result.rows.length, maxRows),
      };
    },

    getCreateStatement(table: string): string {
      if (config.kind === "mysql") {
        try {
          const result = exec(
            `SHOW CREATE TABLE ${sanitizeIdentifier(table, config.kind)}`,
          );
          return result.rows.length > 0 ? result.rows[0][1] || "" : "";
        } catch {
          return "";
        }
      }
      try {
        const result = exec(
          `SELECT 'CREATE TABLE ' || '${table.replace(/'/g, "''")}' || ' (...)' AS ddl`,
        );
        return result.rows.length > 0 ? result.rows[0][0] || "" : "";
      } catch {
        return "";
      }
    },

    getTriggers(table: string): TriggerInfo[] {
      let sql: string;
      if (config.kind === "mysql") {
        sql = `SELECT trigger_name, action_statement FROM information_schema.triggers WHERE event_object_schema = DATABASE() AND event_object_table = '${table.replace(/'/g, "''")}'`;
      } else {
        sql = `SELECT tgname, pg_get_triggerdef(oid) FROM pg_trigger WHERE tgrelid = '${table.replace(/'/g, "''")}'::regclass AND NOT tgisinternal`;
      }
      try {
        const result = exec(sql);
        return result.rows.map((row) => ({
          name: row[0],
          sql: row[1] || "",
        }));
      } catch {
        return [];
      }
    },

    close(): void {
      columnCache.clear();
    },

    async *iterateForSnapshot(
      table: string,
      signal?: AbortSignal,
    ): AsyncIterable<SnapshotItem> {
      const columns = adapter.getColumns(table);
      const colNames = columns.map((c) => c.name);
      const pkColumns = columns.filter((c) => c.primaryKey).map((c) => c.name);
      let offset = 0;
      let rowIndex = 0;
      for (;;) {
        if (signal?.aborted) return;
        const result = adapter.getTablePage(table, {
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
      return adapter
        .getTables()
        .filter((t) => t.type === "table")
        .map((t) => ({ id: t.name, label: t.name }));
    },
  };
  return adapter;
}

function resolveContainerName(serviceName: string, cwd: string): string | null {
  const proc = spawnSync(
    "docker",
    ["compose", "ps", "--format", "json", "--status", "running"],
    { encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "pipe"], cwd },
  );
  if (proc.status !== 0) return null;
  try {
    const output = proc.stdout.trim();
    let containers: { Service?: string; Name?: string; State?: string }[];
    if (output.startsWith("[")) {
      containers = JSON.parse(output);
    } else {
      containers = output
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    }
    const match = containers.find(
      (c) => c.Service === serviceName && c.State === "running",
    );
    return match?.Name || null;
  } catch {
    return null;
  }
}

export function listDockerDatabases(
  serviceName: string,
  kind: "postgresql" | "mysql",
  env: Record<string, string>,
  cwd: string,
): string[] {
  const containerName = resolveContainerName(serviceName, cwd);
  if (!containerName) return [];
  const user =
    env.POSTGRES_USER ||
    env.MYSQL_USER ||
    env.MARIADB_USER ||
    (kind === "postgresql" ? "postgres" : "root");
  const password =
    env.POSTGRES_PASSWORD ||
    env.MYSQL_PASSWORD ||
    env.MYSQL_ROOT_PASSWORD ||
    env.MARIADB_PASSWORD ||
    env.MARIADB_ROOT_PASSWORD ||
    "";
  const defaultDb =
    env.POSTGRES_DB ||
    env.MYSQL_DATABASE ||
    env.MARIADB_DATABASE ||
    (kind === "postgresql" ? "postgres" : "");
  const config: DockerDbConfig = {
    kind,
    containerName,
    user,
    password,
    database: defaultDb || (kind === "postgresql" ? "postgres" : "mysql"),
  };
  try {
    let sql: string;
    if (kind === "postgresql") {
      sql = `SELECT datname FROM pg_database WHERE datistemplate = false AND datallowconn = true ORDER BY datname`;
    } else {
      sql = `SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT IN ('information_schema','performance_schema','mysql','sys') ORDER BY schema_name`;
    }
    const result = execInContainer(config, sql);
    if (result.code !== 0) return defaultDb ? [defaultDb] : [];
    const parsed = parseTsvOutput(result.stdout, kind === "mysql");
    const dbs = parsed.rows.map((r) => r[0]).filter(Boolean);
    return dbs.length > 0 ? dbs : defaultDb ? [defaultDb] : [];
  } catch {
    return defaultDb ? [defaultDb] : [];
  }
}

export function openDockerAdapter(
  serviceName: string,
  kind: "postgresql" | "mysql",
  env: Record<string, string>,
  cwd: string,
  overrideDatabase?: string,
): DatabaseAdapter {
  const containerName = resolveContainerName(serviceName, cwd);
  if (!containerName) {
    throw new Error(
      `Container for service "${serviceName}" is not running. Start it with: docker compose up -d ${serviceName}`,
    );
  }
  const user =
    env.POSTGRES_USER ||
    env.MYSQL_USER ||
    env.MARIADB_USER ||
    (kind === "postgresql" ? "postgres" : "root");
  const password =
    env.POSTGRES_PASSWORD ||
    env.MYSQL_PASSWORD ||
    env.MYSQL_ROOT_PASSWORD ||
    env.MARIADB_PASSWORD ||
    env.MARIADB_ROOT_PASSWORD ||
    "";
  const database =
    overrideDatabase ||
    env.POSTGRES_DB ||
    env.MYSQL_DATABASE ||
    env.MARIADB_DATABASE ||
    (kind === "postgresql" ? "postgres" : "");
  return createDockerAdapter({
    kind,
    containerName,
    user,
    password,
    database,
  });
}
