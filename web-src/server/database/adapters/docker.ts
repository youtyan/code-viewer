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
import {
  buildFilterWhere,
  escapeSqlString,
  filterExactColumns,
  filterGroupedColumns,
  filterOrderByColumns,
  sanitizeIdentifier,
} from "../sql-utils";
import { abortError, isAbortLikeError, throwIfAborted } from "./abort";
import {
  resolveRunningComposeContainerNameAsync,
  resolveRunningComposeContainerNameOrThrowAsync,
} from "./docker-utils";
import { spawnTextAsync } from "./spawn-runner";
import type {
  DatabaseAdapter,
  QueryResult,
  TablePageMeta,
  TriggerInfo,
} from "./types";

// adapters は SqlSource & SnapshotIterable を満たす形を返す。
// DockerSource は DatabaseAdapter の上位互換なので、既存 caller の型は維持される。
type DockerSource = DatabaseAdapter & {
  readonly model: "sql";
  readonly capabilities: { snapshot: true };
  getTablesAsync(signal?: AbortSignal): Promise<DbTableInfo[]>;
  getColumnsAsync(table: string, signal?: AbortSignal): Promise<DbColumn[]>;
  getTablePageAsync(
    table: string,
    options: { offset: number; limit: number; orderBy?: DbOrder[] },
    signal?: AbortSignal,
  ): Promise<QueryResult>;
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
  schema?: string;
};

type ExecResult = { stdout: string; stderr: string; code: number };

type BunSpawnResult = {
  kill(signal?: string): void;
  exited: Promise<number>;
  stdout?: ReadableStream<Uint8Array>;
  stderr?: ReadableStream<Uint8Array>;
};

type BunSpawnFn = (
  args: string[],
  opts?: Record<string, unknown>,
) => BunSpawnResult;

type DockerDatabasesCacheEntry = {
  value: string[];
  expiresAt: number;
};

const COLUMNS_TTL_MS = 30_000;
const ROWCOUNT_TTL_MS = 15_000;
const DOCKER_DATABASES_POSITIVE_TTL_MS = 15_000;
const DOCKER_DATABASES_NEGATIVE_TTL_MS = 3_000;
const dockerDatabasesCache = new Map<string, DockerDatabasesCacheEntry>();
const dockerSchemasCache = new Map<string, DockerDatabasesCacheEntry>();

let spawnSyncImpl = spawnSync;

function dockerDatabasesCacheKey(
  serviceName: string,
  kind: "postgresql" | "mysql",
  cwd: string,
): string {
  return `${serviceName}\0${kind}\0${cwd}`;
}

function dockerSchemasCacheKey(
  serviceName: string,
  kind: "postgresql" | "mysql",
  cwd: string,
  database: string,
): string {
  return `${serviceName}\0${kind}\0${cwd}\0${database}`;
}

function setDockerDatabasesCache(
  key: string,
  value: string[],
  ttlMs: number,
  now = Date.now(),
): string[] {
  const cachedValue = [...value];
  dockerDatabasesCache.set(key, {
    value: cachedValue,
    expiresAt: now + ttlMs,
  });
  return [...cachedValue];
}

function setDockerSchemasCache(
  key: string,
  value: string[],
  ttlMs: number,
  now = Date.now(),
): string[] {
  const cachedValue = [...value];
  dockerSchemasCache.set(key, {
    value: cachedValue,
    expiresAt: now + ttlMs,
  });
  return [...cachedValue];
}

function fallbackDockerDatabases(defaultDb: string): string[] {
  return defaultDb ? [defaultDb] : [];
}

export function __clearDockerDatabaseListCacheForTest(): void {
  dockerDatabasesCache.clear();
}

export function __clearDockerSchemaListCacheForTest(): void {
  dockerSchemasCache.clear();
}

export function __setDockerSpawnSyncForTest(
  spawnSyncForTest: typeof spawnSync | null,
): void {
  spawnSyncImpl = spawnSyncForTest ?? spawnSync;
}

function buildExecArgs(config: DockerDbConfig, sql: string): string[] {
  if (config.kind === "postgresql") {
    return [
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
  }
  return [
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
    "--default-character-set=utf8mb4",
    "-e",
    sql,
  ];
}

function execInContainer(
  config: DockerDbConfig,
  sql: string,
  timeoutMs = 10000,
): ExecResult {
  const args = buildExecArgs(config, sql);
  const proc = spawnSyncImpl(args[0], args.slice(1), {
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

async function readStreamText(
  stream?: ReadableStream<Uint8Array>,
): Promise<string> {
  if (!stream) return "";
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  return text;
}

async function execWithBunSpawn(
  spawnFn: BunSpawnFn,
  args: string[],
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<ExecResult> {
  throwIfAborted(signal, "query aborted");
  const proc = spawnFn(args, {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  let timedOut = false;
  let aborted = false;
  const abort = () => {
    aborted = true;
    proc.kill("SIGKILL");
  };
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill("SIGKILL");
  }, timeoutMs);
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  try {
    const [code, stdout, stderr] = await Promise.all([
      proc.exited,
      readStreamText(proc.stdout),
      readStreamText(proc.stderr),
    ]);
    if (code === 0 && !timedOut) {
      return { code, stdout, stderr };
    }
    if (aborted) throw abortError("query aborted");
    return {
      code: timedOut || aborted ? 1 : code,
      stdout,
      stderr: timedOut
        ? `${stderr}${stderr ? "\n" : ""}query timed out`
        : stderr,
    };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

function execWithNodeSpawn(
  args: string[],
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<ExecResult> {
  return spawnTextAsync({
    command: args[0],
    args: args.slice(1),
    timeoutMs,
    signal,
    killSignal: "SIGKILL",
    abortMessage: "query aborted",
    timeoutMessage: "query timed out",
    rejectOnError: false,
  });
}

async function execInContainerAsync(
  config: DockerDbConfig,
  sql: string,
  timeoutMs = 10000,
  signal?: AbortSignal,
): Promise<ExecResult> {
  if (spawnSyncImpl !== spawnSync)
    return execInContainer(config, sql, timeoutMs);
  const args = buildExecArgs(config, sql);
  const bunSpawn = (globalThis as unknown as { Bun?: { spawn?: BunSpawnFn } })
    .Bun?.spawn;
  if (bunSpawn) return execWithBunSpawn(bunSpawn, args, timeoutMs, signal);
  return execWithNodeSpawn(args, timeoutMs, signal);
}

function stripFinalLineBreak(text: string): string {
  if (text.endsWith("\r\n")) return text.slice(0, -2);
  if (text.endsWith("\n") || text.endsWith("\r")) return text.slice(0, -1);
  return text;
}

function appendReadonlyLimit(sql: string, firstWord: string, maxRows: number) {
  const stripped = sql.replace(/;\s*$/, "");
  if (firstWord === "SHOW" || firstWord === "DESCRIBE") return stripped;
  if (/\bLIMIT\s+\d+(?:\s+OFFSET\s+\d+)?\s*$/i.test(stripped)) {
    return stripped;
  }
  return `${stripped} LIMIT ${maxRows}`;
}

function decodeMysqlBatchField(value: string): string {
  let out = "";
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch !== "\\" || i + 1 >= value.length) {
      out += ch;
      continue;
    }
    const next = value[++i];
    switch (next) {
      case "0":
        out += "\0";
        break;
      case "b":
        out += "\b";
        break;
      case "n":
        out += "\n";
        break;
      case "r":
        out += "\r";
        break;
      case "t":
        out += "\t";
        break;
      case "Z":
        out += "\x1a";
        break;
      case "\\":
        out += "\\";
        break;
      default:
        out += `\\${next}`;
        break;
    }
  }
  return out;
}

function splitTsvLine(line: string, decodeFields: boolean): string[] {
  const fields = line.split("\t");
  return decodeFields ? fields.map(decodeMysqlBatchField) : fields;
}

function parseTsvOutput(
  stdout: string,
  hasHeader: boolean,
): { columns: string[]; rows: string[][] } {
  const text = stripFinalLineBreak(stdout);
  if (text.length === 0) return { columns: [], rows: [] };
  const lines = text.split(/\r?\n/);
  if (lines.length === 0) return { columns: [], rows: [] };
  if (hasHeader) {
    const columns = splitTsvLine(lines[0], true);
    const rows = lines.slice(1).map((line) => splitTsvLine(line, true));
    return { columns, rows };
  }
  const rows = lines.map((line) => splitTsvLine(line, false));
  return { columns: [], rows };
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

const MYSQL_SPATIAL_TYPES = new Set([
  "geometry",
  "point",
  "linestring",
  "polygon",
  "multipoint",
  "multilinestring",
  "multipolygon",
  "geometrycollection",
  "geomcollection",
]);

function isMysqlSpatialType(type: string): boolean {
  const baseType = type.trim().toLowerCase().split(/[\s(]/, 1)[0];
  return MYSQL_SPATIAL_TYPES.has(baseType);
}

function buildTableSelectList(
  columns: DbColumn[],
  kind: "postgresql" | "mysql",
): string {
  if (kind !== "mysql") return "*";
  let hasSpatialColumn = false;
  const parts = columns.map((column) => {
    const columnId = sanitizeIdentifier(column.name, kind);
    if (!isMysqlSpatialType(column.type)) return columnId;
    hasSpatialColumn = true;
    return `ST_AsText(${columnId}) AS ${columnId}`;
  });
  return hasSpatialColumn ? parts.join(", ") : "*";
}

function createTableMetaCache(now = () => Date.now()) {
  const columns = new Map<string, { value: DbColumn[]; expires: number }>();
  const rowCounts = new Map<string, { value: number; expires: number }>();
  return {
    async getColumns(
      table: string,
      fetch: () => DbColumn[] | Promise<DbColumn[]>,
    ): Promise<DbColumn[]> {
      const cached = columns.get(table);
      const current = now();
      if (cached && cached.expires > current) return cached.value;
      const value = await fetch();
      columns.set(table, { value, expires: now() + COLUMNS_TTL_MS });
      return value;
    },

    async getRowCount(
      table: string,
      fetch: () => number | Promise<number>,
    ): Promise<number> {
      const cached = rowCounts.get(table);
      const current = now();
      if (cached && cached.expires > current) return cached.value;
      const value = await fetch();
      rowCounts.set(table, { value, expires: now() + ROWCOUNT_TTL_MS });
      return value;
    },

    invalidate(table?: string): void {
      if (table) {
        columns.delete(table);
        rowCounts.delete(table);
        return;
      }
      columns.clear();
      rowCounts.clear();
    },
  };
}

// A prefetch query may reject before later Promise.all joins it.
function observeBackgroundRejection<T>(promise: Promise<T>): Promise<T> {
  void promise.catch(() => {});
  return promise;
}

export function createDockerAdapter(config: DockerDbConfig): DockerSource {
  async function execAsync(
    sql: string,
    signal?: AbortSignal,
  ): Promise<{ columns: string[]; rows: string[][] }> {
    const result = await execInContainerAsync(config, sql, 10000, signal);
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
  const tableMetaCache = createTableMetaCache();

  function currentPostgresSchema(): string {
    return config.schema || "public";
  }

  function postgresSchemaLiteral(): string {
    return escapeSqlString(currentPostgresSchema());
  }

  function tableIdentifier(table: string): string {
    if (config.kind === "postgresql") {
      return `${sanitizeIdentifier(currentPostgresSchema(), config.kind)}.${sanitizeIdentifier(table, config.kind)}`;
    }
    return sanitizeIdentifier(table, config.kind);
  }

  function postgresRegclassLiteral(table: string): string {
    return escapeSqlString(
      `${sanitizeIdentifier(currentPostgresSchema(), "postgresql")}.${sanitizeIdentifier(table, "postgresql")}`,
    );
  }

  function buildColumnsSql(table: string): string {
    const tableLiteral = table.replace(/'/g, "''");
    if (config.kind === "postgresql") {
      const schemaLiteral = postgresSchemaLiteral();
      return `SELECT c.column_name, c.data_type, c.is_nullable, c.column_default, CASE WHEN pk.column_name IS NULL THEN 'NO' ELSE 'YES' END FROM information_schema.columns c LEFT JOIN (SELECT kcu.column_name FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema AND tc.table_name = kcu.table_name WHERE tc.table_schema = ${schemaLiteral} AND tc.table_name = '${tableLiteral}' AND tc.constraint_type = 'PRIMARY KEY') pk ON pk.column_name = c.column_name WHERE c.table_schema = ${schemaLiteral} AND c.table_name = '${tableLiteral}' ORDER BY c.ordinal_position`;
    }
    return `SELECT column_name, column_type, is_nullable, column_default, column_key FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = '${tableLiteral}' ORDER BY ordinal_position`;
  }

  function columnsFromInfoRows(rows: string[][]): DbColumn[] {
    if (config.kind === "postgresql") {
      return rows.map((row: string[]) => ({
        name: row[0],
        type: row[1],
        nullable: row[2] === "YES",
        primaryKey: row[4] === "YES",
        defaultValue: row[3] === "" ? null : row[3],
      }));
    }
    return rows.map((row: string[]) => ({
      name: row[0],
      type: row[1],
      nullable: row[2] === "YES",
      primaryKey: row[4] === "PRI",
      defaultValue: row[3] === "NULL" ? null : row[3],
    }));
  }

  async function fetchColumnsAsyncUncached(
    table: string,
    signal?: AbortSignal,
  ): Promise<DbColumn[]> {
    const result = await execAsync(buildColumnsSql(table), signal);
    return columnsFromInfoRows(result.rows);
  }

  function tablePageMetaFromResults(
    columns: DbColumn[],
    dataResult: { columns: string[]; rows: string[][] },
    totalRows: number,
  ): TablePageMeta {
    return {
      columns,
      rows: dataResult.rows.map((row) => row.map(toDbValue)),
      rowCount: dataResult.rows.length,
      totalRows,
    };
  }

  function rowCountFromResult(countResult: { rows: string[][] }): number {
    return countResult.rows.length > 0
      ? Number(countResult.rows[0][0]) || 0
      : 0;
  }

  const adapter: DockerSource = {
    kind: config.kind,
    model: "sql",
    capabilities: { snapshot: true },

    async getTablesAsync(signal?: AbortSignal): Promise<DbTableInfo[]> {
      let sql: string;
      if (config.kind === "postgresql") {
        sql = `SELECT table_name, table_type FROM information_schema.tables WHERE table_schema = ${postgresSchemaLiteral()} ORDER BY table_name`;
      } else {
        sql = `SELECT table_name, table_type FROM information_schema.tables WHERE table_schema = DATABASE() ORDER BY table_name`;
      }
      const result = await execAsync(sql, signal);
      return result.rows.map((row) => ({
        name: row[0],
        type: (row[1] === "VIEW" ? "view" : "table") as "table" | "view",
        rowCount: null,
      }));
    },

    async getColumnsAsync(
      table: string,
      signal?: AbortSignal,
    ): Promise<DbColumn[]> {
      const cached = columnCache.get(table);
      if (cached) return cached;
      const cols = await fetchColumnsAsyncUncached(table, signal);
      columnCache.set(table, cols);
      return cols;
    },

    async getIndexesAsync(signal?: AbortSignal): Promise<DbIndexInfo[]> {
      let sql: string;
      if (config.kind === "postgresql") {
        sql = `SELECT indexname, tablename FROM pg_indexes WHERE schemaname = ${postgresSchemaLiteral()} AND indexname NOT LIKE 'pg_%' ORDER BY indexname`;
      } else {
        sql = `SELECT DISTINCT index_name, table_name, non_unique FROM information_schema.statistics WHERE table_schema = DATABASE() ORDER BY index_name`;
      }
      const result = await execAsync(sql, signal);
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

    async getForeignKeysAsync(signal?: AbortSignal): Promise<DbForeignKey[]> {
      let sql: string;
      if (config.kind === "postgresql") {
        sql = `SELECT tc.table_schema, tc.table_name, kcu.column_name, ccu.table_schema, ccu.table_name, ccu.column_name FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = ${postgresSchemaLiteral()}`;
      } else {
        sql = `SELECT table_name, column_name, referenced_table_name, referenced_column_name FROM information_schema.key_column_usage WHERE table_schema = DATABASE() AND referenced_table_name IS NOT NULL`;
      }
      try {
        const result = await execAsync(sql, signal);
        return result.rows.map((row) =>
          config.kind === "postgresql"
            ? {
                fromSchema: row[0],
                fromTable: row[1],
                fromColumn: row[2],
                toSchema: row[3],
                toTable: row[4],
                toColumn: row[5],
              }
            : {
                fromTable: row[0],
                fromColumn: row[1],
                toTable: row[2],
                toColumn: row[3],
              },
        );
      } catch {
        return [];
      }
    },

    async getColumnsMultiAsync(
      tables: string[],
      signal?: AbortSignal,
    ): Promise<Map<string, DbColumn[]>> {
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
        sql = `SELECT table_name, column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = ${postgresSchemaLiteral()} AND table_name IN (${inList}) ORDER BY table_name, ordinal_position`;
      } else {
        const inList = uncached
          .map((t) => `'${t.replace(/'/g, "''")}'`)
          .join(",");
        sql = `SELECT table_name, column_name, column_type, is_nullable, column_default, column_key FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name IN (${inList}) ORDER BY table_name, ordinal_position`;
      }
      try {
        const queryResult = await execAsync(sql, signal);
        const grouped = new Map<string, string[][]>();
        for (const row of queryResult.rows) {
          const tbl = row[0];
          const existing = grouped.get(tbl) || [];
          existing.push(row);
          grouped.set(tbl, existing);
        }
        const pkMap = new Map<string, Set<string>>();
        if (config.kind === "postgresql") {
          try {
            const pkInList = uncached
              .map((t) => `'${t.replace(/'/g, "''")}'`)
              .join(",");
            const pkResult = await execAsync(
              `SELECT c.relname, a.attname FROM pg_index i JOIN pg_class c ON c.oid = i.indrelid JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey) WHERE i.indisprimary AND n.nspname = ${postgresSchemaLiteral()} AND c.relname IN (${pkInList})`,
              signal,
            );
            for (const row of pkResult.rows) {
              const existing = pkMap.get(row[0]) || new Set<string>();
              existing.add(row[1]);
              pkMap.set(row[0], existing);
            }
          } catch (err) {
            if (isAbortLikeError(err, signal)) throw err;
            throw err;
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
      } catch (err) {
        if (isAbortLikeError(err, signal)) throw err;
        const fallbackPromises = uncached.map(async (t) => {
          const cols = await fetchColumnsAsyncUncached(t, signal);
          columnCache.set(t, cols);
          result.set(t, cols);
        });
        const fallbackResults = await Promise.allSettled(fallbackPromises);
        const rejected = fallbackResults.find(
          (entry): entry is PromiseRejectedResult =>
            entry.status === "rejected",
        );
        if (rejected) throw rejected.reason;
      }
      return result;
    },

    async getTableRowCountAsync(
      table: string,
      signal?: AbortSignal,
    ): Promise<number> {
      const id = tableIdentifier(table);
      const result = await execAsync(`SELECT COUNT(*) FROM ${id}`, signal);
      return result.rows.length > 0 ? Number(result.rows[0][0]) || 0 : 0;
    },

    async getTableRowCountsAsync(
      tables: string[],
      signal?: AbortSignal,
    ): Promise<Map<string, number>> {
      const result = new Map<string, number>();
      if (tables.length === 0) return result;
      const parts = tables.map((t) => {
        const id = tableIdentifier(t);
        return `SELECT '${t.replace(/'/g, "''")}' AS tbl, COUNT(*) AS cnt FROM ${id}`;
      });
      const sql = parts.join(" UNION ALL ");
      try {
        const queryResult = await execAsync(sql, signal);
        for (const row of queryResult.rows) {
          result.set(row[0], Number(row[1]) || 0);
        }
      } catch (err) {
        if (isAbortLikeError(err, signal)) throw err;
        const fallbackPromises = tables.map(async (t) => {
          const id = tableIdentifier(t);
          try {
            const r = await execAsync(`SELECT COUNT(*) FROM ${id}`, signal);
            result.set(t, r.rows.length > 0 ? Number(r.rows[0][0]) || 0 : 0);
          } catch (innerErr) {
            if (isAbortLikeError(innerErr, signal)) throw innerErr;
            result.set(t, 0);
          }
        });
        const fallbackResults = await Promise.allSettled(fallbackPromises);
        const rejected = fallbackResults.find(
          (entry): entry is PromiseRejectedResult =>
            entry.status === "rejected",
        );
        if (rejected) throw rejected.reason;
      }
      return result;
    },

    async getTablePageWithMeta(
      table: string,
      options: { offset: number; limit: number; orderBy?: DbOrder[] },
      signal?: AbortSignal,
    ): Promise<TablePageMeta> {
      const id = tableIdentifier(table);
      const countSql = `SELECT COUNT(*) AS cnt FROM ${id}`;
      const columnsPromise = tableMetaCache.getColumns(table, () =>
        fetchColumnsAsyncUncached(table, signal),
      );
      const totalRowsPromise = observeBackgroundRejection(
        tableMetaCache.getRowCount(table, async () =>
          rowCountFromResult(await execAsync(countSql, signal)),
        ),
      );
      let columns: DbColumn[];
      try {
        columns = await columnsPromise;
      } catch (err) {
        await Promise.allSettled([totalRowsPromise]);
        throw err;
      }
      const order = buildOrderClause(
        filterOrderByColumns(
          options.orderBy,
          columns.map((column) => column.name),
        ),
        config.kind,
      );
      const selectList = buildTableSelectList(columns, config.kind);
      const dataSql = `SELECT ${selectList} FROM ${id}${order} LIMIT ${options.limit} OFFSET ${options.offset}`;
      const dataPromise = execAsync(dataSql, signal);
      let dataResult: { columns: string[]; rows: string[][] };
      let totalRows: number;
      try {
        [dataResult, totalRows] = await Promise.all([
          dataPromise,
          totalRowsPromise,
        ]);
      } catch (err) {
        await Promise.allSettled([dataPromise, totalRowsPromise]);
        throw err;
      }
      return tablePageMetaFromResults(columns, dataResult, totalRows);
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
      const id = tableIdentifier(table);
      const columnsPromise = tableMetaCache.getColumns(table, () =>
        fetchColumnsAsyncUncached(table, signal),
      );
      let columns: DbColumn[];
      try {
        columns = await columnsPromise;
      } catch (err) {
        throw err;
      }
      const columnNames = columns.map((column) => column.name);
      const order = buildOrderClause(
        filterOrderByColumns(options.orderBy, columnNames),
        config.kind,
      );
      const where = buildFilterWhere(
        filterGroupedColumns(options.grouped, columnNames),
        config.kind,
        filterExactColumns(options.exact, columnNames),
      ).where;
      const whereClause = where ? ` WHERE ${where}` : "";
      const countSql = `SELECT COUNT(*) AS cnt FROM ${id}${whereClause}`;
      const countResultPromise = execAsync(countSql, signal);
      const selectList = buildTableSelectList(columns, config.kind);
      const dataSql = `SELECT ${selectList} FROM ${id}${whereClause}${order} LIMIT ${options.limit} OFFSET ${options.offset}`;
      const dataPromise = execAsync(dataSql, signal);
      let dataResult: { columns: string[]; rows: string[][] };
      let countResult: { columns: string[]; rows: string[][] };
      try {
        [dataResult, countResult] = await Promise.all([
          dataPromise,
          countResultPromise,
        ]);
      } catch (err) {
        await Promise.allSettled([dataPromise, countResultPromise]);
        throw err;
      }
      return tablePageMetaFromResults(
        columns,
        dataResult,
        rowCountFromResult(countResult),
      );
    },

    async getTablePageAsync(
      table: string,
      options: { offset: number; limit: number; orderBy?: DbOrder[] },
      signal?: AbortSignal,
    ): Promise<QueryResult> {
      const id = tableIdentifier(table);
      const cols = await adapter.getColumnsAsync(table, signal);
      const order = buildOrderClause(
        filterOrderByColumns(
          options.orderBy,
          cols.map((column) => column.name),
        ),
        config.kind,
      );
      const selectList = buildTableSelectList(cols, config.kind);
      const sql = `SELECT ${selectList} FROM ${id}${order} LIMIT ${options.limit} OFFSET ${options.offset}`;
      const result = await execAsync(sql, signal);
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

    async executeReadonlyQueryAsync(
      sql: string,
      _params?: DbValue[],
      maxRows = 1000,
      signal?: AbortSignal,
    ): Promise<QueryResult> {
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
      const stripped = appendReadonlyLimit(trimmed, firstWord, maxRows);
      const limited =
        config.kind === "postgresql"
          ? `BEGIN TRANSACTION READ ONLY; SET LOCAL search_path = ${sanitizeIdentifier(currentPostgresSchema(), config.kind)}; ${stripped}; COMMIT`
          : `SET SESSION TRANSACTION READ ONLY; ${stripped}; SET SESSION TRANSACTION READ WRITE`;
      const result = await execAsync(limited, signal);
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

    invalidateTableMetaCache(table?: string): void {
      tableMetaCache.invalidate(table);
      if (table) {
        columnCache.delete(table);
      } else {
        columnCache.clear();
      }
    },

    async getCreateStatementAsync(
      table: string,
      signal?: AbortSignal,
    ): Promise<string> {
      if (config.kind === "mysql") {
        try {
          const result = await execAsync(
            `SHOW CREATE TABLE ${tableIdentifier(table)}`,
            signal,
          );
          return result.rows.length > 0 ? result.rows[0][1] || "" : "";
        } catch {
          return "";
        }
      }
      try {
        const result = await execAsync(
          `SELECT 'CREATE TABLE ' || ${escapeSqlString(tableIdentifier(table))} || ' (...)' AS ddl`,
          signal,
        );
        return result.rows.length > 0 ? result.rows[0][0] || "" : "";
      } catch {
        return "";
      }
    },

    async getTriggersAsync(
      table: string,
      signal?: AbortSignal,
    ): Promise<TriggerInfo[]> {
      let sql: string;
      if (config.kind === "mysql") {
        sql = `SELECT trigger_name, action_statement FROM information_schema.triggers WHERE event_object_schema = DATABASE() AND event_object_table = '${table.replace(/'/g, "''")}'`;
      } else {
        sql = `SELECT tgname, pg_get_triggerdef(oid) FROM pg_trigger WHERE tgrelid = ${postgresRegclassLiteral(table)}::regclass AND NOT tgisinternal`;
      }
      try {
        const result = await execAsync(sql, signal);
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
      tableMetaCache.invalidate();
    },

    async *iterateForSnapshot(
      table: string,
      signal?: AbortSignal,
    ): AsyncIterable<SnapshotItem> {
      const columns = await adapter.getColumnsAsync(table, signal);
      const pkColumns = columns.filter((c) => c.primaryKey).map((c) => c.name);
      const colNames = columns.map((c) => c.name);
      let offset = 0;
      let rowIndex = 0;
      for (;;) {
        if (signal?.aborted) return;
        const result = await adapter.getTablePageAsync(
          table,
          {
            offset,
            limit: SQL_SNAPSHOT_BATCH_SIZE,
          },
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
        .filter((t) => t.type === "table")
        .map((t) => ({ id: t.name, label: t.name }));
    },
  };
  return adapter;
}

export async function listDockerDatabasesAsync(
  serviceName: string,
  kind: "postgresql" | "mysql",
  env: Record<string, string>,
  cwd: string,
  signal?: AbortSignal,
): Promise<string[]> {
  const cacheKey = dockerDatabasesCacheKey(serviceName, kind, cwd);
  const now = Date.now();
  const cached = dockerDatabasesCache.get(cacheKey);
  if (cached && cached.expiresAt > now) return [...cached.value];

  const containerName = await resolveRunningComposeContainerNameAsync(
    serviceName,
    cwd,
    signal,
  );
  if (!containerName) {
    return setDockerDatabasesCache(
      cacheKey,
      [],
      DOCKER_DATABASES_NEGATIVE_TTL_MS,
      now,
    );
  }
  const user =
    env.POSTGRES_USER ||
    env.MYSQL_USER ||
    env.MARIADB_USER ||
    env.POSTGRES_USERNAME ||
    env.MYSQL_USERNAME ||
    env.USER ||
    "root";
  const password =
    env.POSTGRES_PASSWORD || env.MYSQL_PASSWORD || env.MARIADB_PASSWORD || "";
  const defaultDb =
    env.POSTGRES_DB ||
    env.MYSQL_DATABASE ||
    env.MARIADB_DATABASE ||
    env.DATABASE_NAME ||
    "";
  const config: DockerDbConfig = {
    kind,
    containerName,
    user,
    password,
    database:
      defaultDb || (kind === "postgresql" ? user || "postgres" : "mysql"),
  };
  try {
    let sql: string;
    if (kind === "postgresql") {
      sql = `SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname`;
    } else {
      sql = `SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT IN ('information_schema','performance_schema','mysql','sys') ORDER BY schema_name`;
    }
    const result = await execInContainerAsync(config, sql, 10000, signal);
    if (result.code !== 0) {
      const fallback = fallbackDockerDatabases(defaultDb);
      if (fallback.length > 0) return fallback;
      return setDockerDatabasesCache(
        cacheKey,
        [],
        DOCKER_DATABASES_NEGATIVE_TTL_MS,
        now,
      );
    }
    const parsed = parseTsvOutput(result.stdout, kind === "mysql");
    const dbs = parsed.rows.map((r) => r[0]).filter(Boolean);
    const value = dbs.length > 0 ? dbs : fallbackDockerDatabases(defaultDb);
    return setDockerDatabasesCache(
      cacheKey,
      value,
      value.length > 0
        ? DOCKER_DATABASES_POSITIVE_TTL_MS
        : DOCKER_DATABASES_NEGATIVE_TTL_MS,
      now,
    );
  } catch (err) {
    if (isAbortLikeError(err, signal)) throw err;
    const fallback = fallbackDockerDatabases(defaultDb);
    if (fallback.length > 0) return fallback;
    return setDockerDatabasesCache(
      cacheKey,
      [],
      DOCKER_DATABASES_NEGATIVE_TTL_MS,
      now,
    );
  }
}

export async function listDockerSchemasAsync(
  serviceName: string,
  kind: "postgresql" | "mysql",
  env: Record<string, string>,
  cwd: string,
  overrideDatabase?: string,
  signal?: AbortSignal,
): Promise<string[]> {
  if (kind !== "postgresql") return [];
  const user = env.POSTGRES_USER || env.POSTGRES_USERNAME || "postgres";
  const password = env.POSTGRES_PASSWORD || "";
  const database = overrideDatabase || env.POSTGRES_DB || "postgres";
  const cacheKey = dockerSchemasCacheKey(serviceName, kind, cwd, database);
  const now = Date.now();
  const cached = dockerSchemasCache.get(cacheKey);
  if (cached && cached.expiresAt > now) return [...cached.value];

  const containerName = await resolveRunningComposeContainerNameAsync(
    serviceName,
    cwd,
    signal,
  );
  if (!containerName) {
    return setDockerSchemasCache(
      cacheKey,
      [],
      DOCKER_DATABASES_NEGATIVE_TTL_MS,
      now,
    );
  }
  const config: DockerDbConfig = {
    kind,
    containerName,
    user,
    password,
    database,
  };
  try {
    const sql = `SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT IN ('pg_catalog', 'information_schema') AND schema_name NOT LIKE 'pg_toast%' AND schema_name NOT LIKE 'pg_temp_%' AND schema_name NOT LIKE 'pg_toast_temp_%' AND has_schema_privilege(schema_name, 'USAGE') ORDER BY CASE WHEN schema_name = 'public' THEN 0 ELSE 1 END, schema_name`;
    const result = await execInContainerAsync(config, sql, 10000, signal);
    if (result.code !== 0) {
      return setDockerSchemasCache(
        cacheKey,
        ["public"],
        DOCKER_DATABASES_NEGATIVE_TTL_MS,
        now,
      );
    }
    const parsed = parseTsvOutput(result.stdout, false);
    const schemas = parsed.rows.map((r) => r[0]).filter(Boolean);
    const value = schemas.length > 0 ? schemas : ["public"];
    return setDockerSchemasCache(
      cacheKey,
      value,
      DOCKER_DATABASES_POSITIVE_TTL_MS,
      now,
    );
  } catch (err) {
    if (isAbortLikeError(err, signal)) throw err;
    return setDockerSchemasCache(
      cacheKey,
      ["public"],
      DOCKER_DATABASES_NEGATIVE_TTL_MS,
      now,
    );
  }
}

export async function openDockerAdapterAsync(
  serviceName: string,
  kind: "postgresql" | "mysql",
  env: Record<string, string>,
  cwd: string,
  overrideDatabase?: string,
  schema?: string,
  signal?: AbortSignal,
): Promise<DatabaseAdapter> {
  const containerName = await resolveRunningComposeContainerNameOrThrowAsync(
    serviceName,
    cwd,
    signal,
  );
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
    ...(kind === "postgresql" && schema ? { schema } : {}),
  });
}
