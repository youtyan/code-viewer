import { hasControlCharacter } from "../../core/control-chars";
import type {
  DbColumn,
  DbFilesResponse,
  DbKind,
  DbMutateResponse,
  DbOrder,
  DbQueryResponse,
  DbSchemaResponse,
  DbSchemasResponse,
  DbTableDataResponse,
  QueryHistoryEntry,
  RowMutation,
} from "../../core/database/types";
import { makeId } from "../../core/id";
import { loadDbUiState, patchDbUiState } from "../state-store";
import { isAbortLikeError } from "./adapters/abort";
import { asAsync } from "./adapters/async-facade";
import {
  listDockerDatabasesAsync,
  listDockerSchemasAsync,
  openDockerAdapterAsync,
} from "./adapters/docker";
import { isDockerComposeServiceUnavailableError } from "./adapters/docker-utils";
import { captureSql } from "./adapters/sql-capture";
import { sqliteAdapterFactory } from "./adapters/sqlite";
import type { DatabaseAdapter } from "./adapters/types";
import {
  closeConnection,
  getConnection,
  setAdapterFactory,
} from "./connection-pool";
import {
  type DockerDbInfo,
  type DockerDiscoveryResult,
  discoverDockerDatabasesAsync,
  discoverSqliteFilesAsync,
  findDockerServiceByDbIdAsync,
  parseDockerDbId,
  validateDbPath,
} from "./discovery";
import {
  getPrimaryKeyColumnsFromColumns,
  searchTableAsync,
} from "./global-search";
import { closeElasticsearchAdapter } from "./handle-elasticsearch";
import { closeRedisAdapter } from "./handle-redis";
import { closeS3Adapter } from "./handle-s3";
import {
  createDockerAdapterCache,
  dispatchRoutes,
  handleError,
  json,
  jsonLoadResponse,
  logResponseWithReason,
  parseBoundedJsonBody,
  parsePostJsonBody,
  textError,
} from "./handle-shared";
import {
  addQueryHistoryEntry,
  clearQueryHistory,
  deleteQueryHistoryEntry,
  loadQueryHistoryAsync,
  updateQueryHistoryAsync,
} from "./query-history";
import { serializeDbRows } from "./serialize";
import { runSnapshot } from "./snapshot-runner";
import {
  computeDiffRows,
  computeDiffTables,
  deleteSnapshot,
  listSnapshots,
  updateSnapshotNote,
} from "./snapshot-store";
import { loadTabsAsync, saveTabsAsync } from "./tabs-store";

let initialized = false;

function ensureInit() {
  if (initialized) return;
  setAdapterFactory(sqliteAdapterFactory);
  initialized = true;
}

const dockerAdapterCache = createDockerAdapterCache<DatabaseAdapter>();

async function getAdapter(
  r: ResolvedDb,
  _cwd: string,
  signal?: AbortSignal,
): Promise<DatabaseAdapter> {
  if (r.docker) {
    const docker = r.docker;
    const cacheKey = r.schema ? `${r.dbId}\0schema=${r.schema}` : r.dbId;
    return dockerAdapterCache.getOrOpenAsync(cacheKey, () =>
      // recursive discovery により compose は subdir に置けるので、
      // `docker compose ps` の cwd は r.docker.composeDir に固定する。
      openDockerAdapterAsync(
        docker.serviceName,
        docker.kind as "postgresql" | "mysql",
        docker.env,
        docker.composeDir,
        docker.database,
        r.schema,
        signal,
      ),
    );
  }
  return getConnection(r.resolved);
}

function sanitizeFilename(name: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional control char stripping for HTTP header safety
  return name.replace(/["\\\r\n\x00-\x1f]/g, "_");
}

type ResolvedDb = {
  resolved: string;
  dbId: string;
  docker?: DockerDbInfo;
  schema?: string;
};

export type DockerDatabaseLister = (
  serviceName: string,
  kind: "postgresql" | "mysql",
  env: Record<string, string>,
  cwd: string,
  signal?: AbortSignal,
) => Promise<string[]>;

export type DbFileDiscoveryDeps = {
  discoverSqliteFiles: typeof discoverSqliteFilesAsync;
  discoverDockerDatabases: typeof discoverDockerDatabasesAsync;
  listDockerDatabases: DockerDatabaseLister;
};

const DEFAULT_DB_FILE_DISCOVERY_DEPS: DbFileDiscoveryDeps = {
  discoverSqliteFiles: discoverSqliteFilesAsync,
  discoverDockerDatabases: discoverDockerDatabasesAsync,
  listDockerDatabases: listDockerDatabasesAsync,
};

const MAX_SCHEMA_NAME_LEN = 1024;

function normalizeSchemaParam(
  value: string | null | undefined,
): string | Response | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (value.length > MAX_SCHEMA_NAME_LEN) {
    return textError("invalid schema parameter", 400);
  }
  if (hasControlCharacter(value)) {
    return textError("invalid schema parameter", 400);
  }
  return value;
}

async function resolvePostgresSchema(
  info: DockerDbInfo,
  requestedSchema: string | undefined,
  signal?: AbortSignal,
): Promise<string | Response | undefined> {
  if (info.kind !== "postgresql") return undefined;
  if (requestedSchema) return requestedSchema;
  const schemas = await listDockerSchemasAsync(
    info.serviceName,
    "postgresql",
    info.env,
    info.composeDir,
    info.database,
    signal,
  );
  if (schemas.includes("public")) return "public";
  return schemas[0] || "public";
}

async function resolveDb(
  cwd: string,
  dbParam: string | null,
  omitDirNames?: string[],
  schemaParam?: string | null,
  signal?: AbortSignal,
): Promise<ResolvedDb | Response> {
  if (!dbParam) return textError("missing db parameter", 400);
  if (dbParam.startsWith("docker:")) {
    const parsed = parseDockerDbId(dbParam);
    if (!parsed) return textError("invalid docker db id", 400);
    const info = await findDockerServiceByDbIdAsync(
      cwd,
      dbParam,
      undefined,
      omitDirNames,
      signal,
    );
    if (!info) return textError("docker service not found", 404);
    if (info.kind === "redis") {
      return textError("redis services must use the /_db/redis/* routes", 400);
    }
    if (info.kind === "elasticsearch") {
      return textError(
        "elasticsearch services must use the /_db/elasticsearch/* routes",
        400,
      );
    }
    if (info.kind === "s3") {
      return textError("s3 services must use the /_db/s3/* routes", 400);
    }
    const resolved = parsed.database
      ? { ...info, database: parsed.database }
      : info;
    const requestedSchema = normalizeSchemaParam(schemaParam);
    if (requestedSchema instanceof Response) return requestedSchema;
    const schema = await resolvePostgresSchema(
      resolved,
      requestedSchema,
      signal,
    );
    if (schema instanceof Response) return schema;
    return {
      resolved: dbParam,
      dbId: dbParam,
      docker: resolved,
      ...(schema ? { schema } : {}),
    };
  }
  const resolved = validateDbPath(cwd, dbParam);
  if (!resolved) return textError("invalid database path", 400);
  return { resolved, dbId: dbParam };
}

function toFileInfo(entry: {
  id: string;
  path: string;
  name: string;
  sizeBytes: number;
  kind: import("../../core/database/types").DbKind;
}): import("../../core/database/types").DbFileInfo {
  return {
    id: entry.id,
    path: entry.path,
    name: entry.name,
    sizeBytes: entry.sizeBytes,
    kind: entry.kind,
  };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function expandDockerServicesForFiles(
  dockerServices: DockerDiscoveryResult,
  listDockerDatabases: DockerDatabaseLister,
  signal?: AbortSignal,
): Promise<{ entries: DockerDbInfo[]; errors: string[] }> {
  const chunks = await Promise.all(
    dockerServices.map(async (svc) => {
      if (
        svc.kind === "redis" ||
        svc.kind === "elasticsearch" ||
        svc.kind === "s3"
      ) {
        return { entries: [svc], errors: [] };
      }
      let dbs: string[];
      try {
        dbs = await listDockerDatabases(
          svc.serviceName,
          svc.kind as "postgresql" | "mysql",
          svc.env,
          svc.composeDir,
          signal,
        );
      } catch (err) {
        if (isAbortLikeError(err, signal)) throw err;
        return {
          entries: [svc],
          errors: [`${svc.serviceName}: ${errorMessage(err)}`],
        };
      }
      if (dbs.length <= 1) {
        return { entries: [svc], errors: [] };
      }
      return {
        entries: dbs.map((db) => ({
          ...svc,
          id: `${svc.id}:${db}`,
          name: svc.name.replace(/\)$/, ` / ${db})`),
          database: db,
        })),
        errors: [],
      };
    }),
  );
  return {
    entries: chunks.flatMap((chunk) => chunk.entries),
    errors: chunks.flatMap((chunk) => chunk.errors),
  };
}

export async function createDbFilesResponse(
  cwd: string,
  omitDirNames: string[],
  signal?: AbortSignal,
  deps: DbFileDiscoveryDeps = DEFAULT_DB_FILE_DISCOVERY_DEPS,
): Promise<DbFilesResponse> {
  const [sqliteSettled, dockerSettled] = await Promise.allSettled([
    deps.discoverSqliteFiles(cwd, omitDirNames, signal),
    deps.discoverDockerDatabases(cwd, omitDirNames, signal),
  ]);
  if (sqliteSettled.status === "rejected") {
    throw sqliteSettled.reason;
  }
  if (
    dockerSettled.status === "rejected" &&
    isAbortLikeError(dockerSettled.reason, signal)
  ) {
    throw dockerSettled.reason;
  }
  const sqliteFiles = sqliteSettled.value;
  const dockerServices =
    dockerSettled.status === "fulfilled"
      ? dockerSettled.value
      : ([] as DockerDiscoveryResult);
  const dockerErrors: string[] = [];
  if (dockerSettled.status === "rejected") {
    dockerErrors.push(errorMessage(dockerSettled.reason));
  }
  const dockerTruncated = dockerServices.truncated === true;
  const { entries: dockerEntries, errors: listingErrors } =
    await expandDockerServicesForFiles(
      dockerServices,
      deps.listDockerDatabases,
      signal,
    );
  dockerErrors.push(...listingErrors);
  // Strip env / serviceName / database from the response — these contain
  // credentials and internal state that the browser must not see.
  return {
    files: [
      ...sqliteFiles.map((f) => ({
        id: f.path,
        path: f.path,
        name: f.name,
        sizeBytes: f.sizeBytes,
        kind: "sqlite" as const,
      })),
      ...dockerEntries.map(toFileInfo),
    ],
    ...(dockerTruncated ? { truncated: true } : {}),
    ...(dockerErrors.length > 0
      ? { dockerError: dockerErrors.join("; ") }
      : {}),
  };
}

async function handleFiles(
  cwd: string,
  omitDirNames: string[],
  signal?: AbortSignal,
): Promise<Response> {
  return json(await createDbFilesResponse(cwd, omitDirNames, signal));
}

async function handleSchemas(
  cwd: string,
  url: URL,
  omitDirNames?: string[],
  signal?: AbortSignal,
): Promise<Response> {
  const r = await resolveDb(
    cwd,
    url.searchParams.get("db"),
    omitDirNames,
    url.searchParams.get("schema"),
    signal,
  );
  if (r instanceof Response) return r;
  if (!r.docker || r.docker.kind !== "postgresql") {
    const body: DbSchemasResponse = { dbId: r.dbId, schemas: [] };
    return json(body);
  }
  const docker = r.docker;
  const { result: schemas, executedSql } = await captureSql(() =>
    listDockerSchemasAsync(
      docker.serviceName,
      "postgresql",
      docker.env,
      docker.composeDir,
      docker.database,
      signal,
    ),
  );
  const body: DbSchemasResponse = {
    dbId: r.dbId,
    schemas: schemas.map((name) => ({ name })),
    selectedSchema: r.schema,
    executedSql,
  };
  return json(body);
}

async function handleSchema(
  cwd: string,
  url: URL,
  omitDirNames?: string[],
  signal?: AbortSignal,
): Promise<Response> {
  const r = await resolveDb(
    cwd,
    url.searchParams.get("db"),
    omitDirNames,
    url.searchParams.get("schema"),
    signal,
  );
  if (r instanceof Response) return r;
  const includeColumns = url.searchParams.get("includeColumns") === "1";
  const linkedAbort = createLinkedAbortController(signal);
  try {
    const adapter = await getAdapter(r, cwd, signal);
    const { result, executedSql } = await captureSql(async () => {
      const db = asAsync(adapter);
      const tables = await db.tables(linkedAbort.signal);
      const tableNames = tables
        .filter((t) => t.type === "table")
        .map((t) => t.name);
      const countMapPromise = db.tableRowCounts(tableNames, linkedAbort.signal);
      const indexesPromise = db.indexes(linkedAbort.signal);
      const foreignKeysPromise = db.foreignKeys(linkedAbort.signal);
      const columnsMapPromise = includeColumns
        ? db.columnsMulti(tableNames, linkedAbort.signal)
        : Promise.resolve(null);
      const schemaPromises = [
        countMapPromise,
        indexesPromise,
        foreignKeysPromise,
        columnsMapPromise,
      ] as const;
      const [countMap, indexes, foreignKeys, colsMap] = await Promise.all(
        schemaPromises,
      ).catch(async (err) => {
        linkedAbort.abort();
        await Promise.allSettled(schemaPromises);
        throw err;
      });
      return { tables, countMap, indexes, foreignKeys, colsMap };
    });
    const tablesWithCount = result.tables.map((t) => ({
      ...t,
      rowCount: t.type === "table" ? (result.countMap.get(t.name) ?? 0) : null,
    }));
    const body: DbSchemaResponse = {
      dbId: r.dbId,
      ...(r.schema ? { schema: r.schema } : {}),
      tables: tablesWithCount,
      indexes: result.indexes,
      foreignKeys: result.foreignKeys,
      executedSql,
    };
    if (result.colsMap) {
      body.columnsMap = Object.fromEntries(result.colsMap);
    }
    return json(body);
  } catch (err) {
    linkedAbort.abort();
    return handleError("database", "read schema", err, signal);
  } finally {
    linkedAbort.cleanup();
  }
}

// 条件の個数・列名/値長の上限。巨大な WHERE 生成や export 経由の DoS を防ぐ。
const MAX_COLUMN_VALUE_PAIRS = 64;
const MAX_FILTER_COLUMN_LEN = 128;
const MAX_FILTER_VALUE_LEN = 4096;

function parseColumnValuePairs(
  url: URL,
  param: string,
): { column: string; value: string }[] {
  const raw = url.searchParams.get(param);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (f: unknown): f is { column: string; value: string } =>
          !!f &&
          typeof f === "object" &&
          typeof (f as Record<string, unknown>).column === "string" &&
          typeof (f as Record<string, unknown>).value === "string",
      )
      .filter(
        (f) =>
          f.column.length <= MAX_FILTER_COLUMN_LEN &&
          f.value.length <= MAX_FILTER_VALUE_LEN,
      )
      .slice(0, MAX_COLUMN_VALUE_PAIRS);
  } catch {
    return [];
  }
}

function parseFilters(url: URL): { column: string; value: string }[] {
  return parseColumnValuePairs(url, "filters");
}

/** `eq` パラメータ: カラム完全一致条件（FK 参照の WHERE 用）。 */
function parseExactConditions(url: URL): { column: string; value: string }[] {
  return parseColumnValuePairs(url, "eq");
}

function groupFiltersByValue(
  filters: { column: string; value: string }[],
): Map<string, string[]> {
  const grouped = new Map<string, string[]>();
  for (const filter of filters) {
    const existing = grouped.get(filter.value) || [];
    existing.push(filter.column);
    grouped.set(filter.value, existing);
  }
  return grouped;
}

async function handleTable(
  cwd: string,
  url: URL,
  omitDirNames?: string[],
  signal?: AbortSignal,
): Promise<Response> {
  const r = await resolveDb(
    cwd,
    url.searchParams.get("db"),
    omitDirNames,
    url.searchParams.get("schema"),
    signal,
  );
  if (r instanceof Response) return r;
  const table = url.searchParams.get("table");
  if (!table) return textError("missing table parameter", 400);
  const offset = Math.max(
    0,
    Number(url.searchParams.get("offset") || "0") || 0,
  );
  const limit = Math.min(
    1000,
    Math.max(1, Number(url.searchParams.get("limit") || "200") || 200),
  );
  let orderBy: DbOrder[] | undefined;
  const sortCol = url.searchParams.get("sort");
  const sortDir = url.searchParams.get("dir");
  if (sortCol) {
    orderBy = [
      {
        column: sortCol,
        direction: sortDir === "desc" ? "desc" : "asc",
      },
    ];
  }
  const filters = parseFilters(url);
  const exact = parseExactConditions(url);
  try {
    const adapter = await getAdapter(r, cwd, signal);
    const { result: meta, executedSql } = await captureSql(() =>
      filters.length > 0 || exact.length > 0
        ? adapter.getFilteredTablePageWithMeta(
            table,
            {
              offset,
              limit,
              orderBy,
              grouped: groupFiltersByValue(filters),
              ...(exact.length > 0 ? { exact } : {}),
            },
            signal,
          )
        : adapter.getTablePageWithMeta(
            table,
            {
              offset,
              limit,
              orderBy,
            },
            signal,
          ),
    );
    const colNames = new Set(meta.columns.map((c) => c.name));
    if (sortCol && !colNames.has(sortCol)) {
      return textError(`invalid sort column: ${sortCol}`, 400);
    }
    const body: DbTableDataResponse = {
      dbId: r.dbId,
      ...(r.schema ? { schema: r.schema } : {}),
      table,
      columns: meta.columns,
      rows: serializeDbRows(meta.rows),
      totalRows: meta.totalRows,
      offset,
      limit,
      hasMore: offset + meta.rowCount < meta.totalRows,
      executedSql,
    };
    return json(body);
  } catch (err) {
    return handleError("database", "read table", err, signal);
  }
}

function makeHistoryId(): string {
  return makeId("qh");
}

function createLinkedAbortController(parent?: AbortSignal): {
  signal: AbortSignal;
  abort(): void;
  cleanup(): void;
} {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (parent?.aborted) {
    controller.abort();
  } else {
    parent?.addEventListener("abort", abort, { once: true });
  }
  return {
    signal: controller.signal,
    abort,
    cleanup() {
      parent?.removeEventListener("abort", abort);
    },
  };
}

function unquoteSqlIdentifier(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/""/g, '"');
  }
  if (trimmed.startsWith("`") && trimmed.endsWith("`")) {
    return trimmed.slice(1, -1).replace(/``/g, "`");
  }
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed.slice(1, -1).replace(/]]/g, "]");
  }
  return trimmed;
}

export type ParsedSelectAllTable = { schema?: string; table: string };

export function parseSelectAllTable(sql: string): ParsedSelectAllTable | null {
  const identifier =
    '(?:"(?:[^"]|"")+"|`(?:[^`]|``)+`|\\[(?:[^\\]]|\\]\\])+\\]|[A-Za-z_][\\w$]*)';
  const match = sql
    .trim()
    .replace(/;\s*$/, "")
    .match(
      new RegExp(
        String.raw`^SELECT\s+\*\s+FROM\s+(${identifier})(?:\s*\.\s*(${identifier}))?\s*$`,
        "i",
      ),
    );
  if (!match) return null;
  return {
    ...(match[2] ? { schema: unquoteSqlIdentifier(match[1]) } : {}),
    table: unquoteSqlIdentifier(match[2] || match[1]),
  };
}

async function inferEmptyQueryColumns(
  adapter: DatabaseAdapter,
  sql: string,
  selectedSchema?: string,
  signal?: AbortSignal,
): Promise<DbColumn[]> {
  const parsed = parseSelectAllTable(sql);
  if (!parsed) return [];
  if (
    parsed.schema &&
    parsed.schema !== (selectedSchema || "public") &&
    parsed.schema !== "main"
  ) {
    return [];
  }
  try {
    return await asAsync(adapter).columns(parsed.table, signal);
  } catch (err) {
    if (isAbortLikeError(err, signal)) throw err;
    return [];
  }
}

async function handleQuery(
  cwd: string,
  req: Request,
  sendSse?: (event: string, data?: string) => void,
  omitDirNames?: string[],
): Promise<Response> {
  const body = await parsePostJsonBody<{
    db?: string;
    schema?: string;
    sql?: string;
    maxRows?: number;
    saveHistory?: boolean;
    title?: string;
    body?: string;
    executedBy?: "user" | "ai";
    source?: "cli" | "browser";
  }>(req);
  if (body instanceof Response) return body;
  if (!body.db || !body.sql) return textError("missing db or sql", 400);
  const r = await resolveDb(
    cwd,
    body.db,
    omitDirNames,
    body.schema,
    req.signal,
  );
  if (r instanceof Response) return r;
  const maxRows = Math.min(10000, Math.max(1, body.maxRows || 1000));
  const start = Date.now();
  try {
    const adapter = await getAdapter(r, cwd, req.signal);
    const { result, executedSql } = await captureSql(() =>
      asAsync(adapter).readonlyQuery(
        body.sql ?? "",
        undefined,
        maxRows,
        req.signal,
      ),
    );
    const elapsed = Date.now() - start;
    const serializedRows = serializeDbRows(result.rows);
    const inferredColumns =
      result.columns.length === 0 && result.rows.length === 0
        ? await inferEmptyQueryColumns(adapter, body.sql, r.schema, req.signal)
        : [];
    const columns =
      inferredColumns.length > 0
        ? inferredColumns.map((col) => col.name)
        : result.columns;
    const columnTypes =
      inferredColumns.length > 0
        ? inferredColumns.map((col) => col.type)
        : result.columnTypes;
    const response: DbQueryResponse = {
      dbId: body.db,
      ...(r.schema ? { schema: r.schema } : {}),
      columns,
      columnTypes,
      rows: serializedRows,
      rowCount: result.rowCount,
      truncated: result.rowCount >= maxRows,
      elapsedMs: elapsed,
      executedSql,
    };
    if (body.saveHistory) {
      const entry: QueryHistoryEntry = {
        id: makeHistoryId(),
        dbId: body.db,
        ...(r.schema ? { schema: r.schema } : {}),
        sql: body.sql,
        title: body.title,
        body: body.body,
        columns,
        rowsPreview: serializedRows,
        rowCount: result.rowCount,
        savedRows: serializedRows.length,
        truncated: result.rowCount >= maxRows,
        elapsedMs: elapsed,
        executedAt: new Date().toISOString(),
        executedBy: body.executedBy || "user",
        source: body.source || "browser",
      };
      await updateQueryHistoryAsync(cwd, (state) => ({
        state: addQueryHistoryEntry(state, entry),
        result: undefined,
      }));
      sendSse?.(
        "db-query",
        JSON.stringify({
          action: "add",
          dbId: body.db,
          schema: r.schema,
          id: entry.id,
        }),
      );
    }
    return json(response);
  } catch (err) {
    // クライアント起因の中断はサーバ障害として記録しない。
    if (isAbortLikeError(err, req.signal)) {
      return textError("query aborted", 503);
    }
    if (isDockerComposeServiceUnavailableError(err)) {
      return handleError("database", "execute query", err);
    }
    console.error(
      "[code-viewer] database error:",
      err instanceof Error ? err.message : String(err),
    );
    const elapsed = Date.now() - start;
    const response: DbQueryResponse = {
      dbId: body.db,
      ...(r.schema ? { schema: r.schema } : {}),
      columns: [],
      columnTypes: [],
      rows: [],
      rowCount: 0,
      truncated: false,
      elapsedMs: elapsed,
      error: err instanceof Error ? err.message : String(err),
    };
    return json(response, 400);
  }
}

async function handleHistory(cwd: string, url: URL): Promise<Response> {
  const dbId = url.searchParams.get("db") || undefined;
  const schema = normalizeSchemaParam(url.searchParams.get("schema"));
  if (schema instanceof Response) return schema;
  const state = await loadQueryHistoryAsync(cwd);
  if (dbId) {
    return json({
      version: 1,
      entries: state.entries.filter((e) => {
        if (e.dbId !== dbId) return false;
        if (schema === undefined) return true;
        return (e.schema || "public") === schema;
      }),
    });
  }
  return json(state);
}

async function handleHistoryDelete(
  cwd: string,
  req: Request,
  sendSse?: (event: string, data?: string) => void,
): Promise<Response> {
  const body = await parsePostJsonBody<{ id?: string }>(req);
  if (body instanceof Response) return body;
  if (!body.id) return textError("missing id", 400);
  const deleted = await updateQueryHistoryAsync(cwd, (state) => ({
    state: deleteQueryHistoryEntry(state, body.id || ""),
    result: state.entries.find((entry) => entry.id === body.id),
  }));
  sendSse?.(
    "db-query",
    JSON.stringify({
      action: "delete",
      dbId: deleted?.dbId,
      schema: deleted?.schema,
      id: body.id,
    }),
  );
  return json({ ok: true });
}

async function handleHistoryClear(
  cwd: string,
  req: Request,
  sendSse?: (event: string, data?: string) => void,
): Promise<Response> {
  if (req.method !== "POST") return textError("method not allowed", 405);
  let body: { db?: string; schema?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    body = {};
  }
  const schema = normalizeSchemaParam(body.schema);
  if (schema instanceof Response) return schema;
  await updateQueryHistoryAsync(cwd, (state) => ({
    state: clearQueryHistory(state, body.db, schema),
    result: undefined,
  }));
  sendSse?.(
    "db-query",
    JSON.stringify({ action: "clear", dbId: body.db, schema }),
  );
  return json({ ok: true });
}

const EXPORT_MAX_ROWS = 100_000;
const MAX_TABS_BODY_BYTES = 1_000_000;
const MAX_DB_UI_BODY_BYTES = 1_000_000;
const MAX_SNAPSHOT_TABLES = 512;
const MAX_SNAPSHOT_TABLE_NAME_LEN = 1024;

function formatCsvField(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Uint8Array) return `<blob ${value.byteLength} bytes>`;
  const str = typeof value === "object" ? JSON.stringify(value) : String(value);
  if (
    str.includes(",") ||
    str.includes('"') ||
    str.includes("\n") ||
    str.includes("\r")
  ) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

async function handleExport(
  cwd: string,
  url: URL,
  omitDirNames?: string[],
  signal?: AbortSignal,
): Promise<Response> {
  const r = await resolveDb(
    cwd,
    url.searchParams.get("db"),
    omitDirNames,
    url.searchParams.get("schema"),
    signal,
  );
  if (r instanceof Response) return r;
  const table = url.searchParams.get("table");
  if (!table) return textError("missing table parameter", 400);
  const format = url.searchParams.get("format");
  if (format !== "csv" && format !== "json")
    return textError("format must be csv or json", 400);

  let orderBy: DbOrder[] | undefined;
  const sortCol = url.searchParams.get("sort");
  const sortDir = url.searchParams.get("dir");
  if (sortCol) {
    orderBy = [
      {
        column: sortCol,
        direction: sortDir === "desc" ? "desc" : "asc",
      },
    ];
  }
  const filters = parseFilters(url);
  const exact = parseExactConditions(url);

  try {
    const adapter = await getAdapter(r, cwd, signal);
    const db = asAsync(adapter);
    const columns = await db.columns(table, signal);
    const colNames = columns.map((c) => c.name);
    const colNameSet = new Set(colNames);
    if (sortCol && !colNameSet.has(sortCol)) {
      return textError(`invalid sort column: ${sortCol}`, 400);
    }
    let rawRows: import("./serialize").RawDbValue[][];

    if (filters.length > 0 || exact.length > 0) {
      const meta = await adapter.getFilteredTablePageWithMeta(
        table,
        {
          offset: 0,
          limit: EXPORT_MAX_ROWS,
          orderBy,
          grouped: groupFiltersByValue(filters),
          ...(exact.length > 0 ? { exact } : {}),
        },
        signal,
      );
      rawRows = meta.rows;
    } else {
      const meta = await adapter.getTablePageWithMeta(
        table,
        {
          offset: 0,
          limit: EXPORT_MAX_ROWS,
          orderBy,
        },
        signal,
      );
      rawRows = meta.rows;
    }
    const rows = serializeDbRows(rawRows);

    if (format === "csv") {
      const lines: string[] = [colNames.map(formatCsvField).join(",")];
      for (const row of rows) {
        lines.push(row.map(formatCsvField).join(","));
      }
      const body = lines.join("\n");
      return new Response(body, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${sanitizeFilename(table)}.csv"`,
          "Cache-Control": "no-store",
        },
      });
    }

    const objects = rows.map((row) => {
      const obj: Record<string, unknown> = {};
      for (let i = 0; i < colNames.length; i++) {
        obj[colNames[i]] = row[i];
      }
      return obj;
    });
    const body = JSON.stringify(objects, null, 2);
    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${sanitizeFilename(table)}.json"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return handleError("database", "export table", err, signal);
  }
}

async function handleColumns(
  cwd: string,
  url: URL,
  omitDirNames?: string[],
  signal?: AbortSignal,
): Promise<Response> {
  const r = await resolveDb(
    cwd,
    url.searchParams.get("db"),
    omitDirNames,
    url.searchParams.get("schema"),
    signal,
  );
  if (r instanceof Response) return r;
  const table = url.searchParams.get("table");
  if (!table) return textError("missing table parameter", 400);
  try {
    const adapter = await getAdapter(r, cwd, signal);
    const { result: columns, executedSql } = await captureSql(() =>
      asAsync(adapter).columns(table, signal),
    );
    return json({
      dbId: r.dbId,
      ...(r.schema ? { schema: r.schema } : {}),
      table,
      columns,
      executedSql,
    });
  } catch (err) {
    return handleError("database", "get columns", err, signal);
  }
}

async function handleDdl(
  cwd: string,
  url: URL,
  omitDirNames?: string[],
  signal?: AbortSignal,
): Promise<Response> {
  const r = await resolveDb(
    cwd,
    url.searchParams.get("db"),
    omitDirNames,
    url.searchParams.get("schema"),
    signal,
  );
  if (r instanceof Response) return r;
  const table = url.searchParams.get("table");
  if (!table) return textError("missing table parameter", 400);
  try {
    const adapter = await getAdapter(r, cwd, signal);
    const { result, executedSql } = await captureSql(async () => {
      const db = asAsync(adapter);
      const [sql, triggers] = await Promise.all([
        db.createStatement(table, signal),
        db.triggers(table, signal),
      ]);
      return { sql, triggers };
    });
    return json({
      dbId: r.dbId,
      ...(r.schema ? { schema: r.schema } : {}),
      table,
      sql: result.sql,
      triggers: result.triggers,
      executedSql,
    });
  } catch (err) {
    return handleError("database", "get DDL", err, signal);
  }
}

// --- Global Search ---

type SearchJob = {
  id: string;
  dbId: string;
  schema?: string;
  scannedTables: number;
  totalTables: number;
  currentTable?: string;
  hits: import("./global-search").SearchHit[];
  done: boolean;
  error?: string;
  abortController: AbortController;
  cleanupTimer?: ReturnType<typeof setTimeout>;
  cleanupAt?: number;
};

const searchJobs = new Map<string, SearchJob>();

function scheduleSearchJobCleanup(jobId: string, delayMs: number): void {
  const job = searchJobs.get(jobId);
  if (!job) return;
  const cleanupAt = Date.now() + delayMs;
  if (job.cleanupTimer && job.cleanupAt && job.cleanupAt <= cleanupAt) return;
  if (job.cleanupTimer) clearTimeout(job.cleanupTimer);
  const timer = setTimeout(() => {
    searchJobs.delete(jobId);
  }, delayMs);
  timer.unref?.();
  job.cleanupTimer = timer;
  job.cleanupAt = cleanupAt;
}

async function handleSearchStart(
  cwd: string,
  req: Request,
  omitDirNames?: string[],
): Promise<Response> {
  const body = await parsePostJsonBody<{
    db?: string;
    schema?: string;
    term?: string;
    tables?: string[];
    maxHitsPerTable?: number;
    includeNonText?: boolean;
  }>(req);
  if (body instanceof Response) return body;
  if (!body.db || !body.term) return textError("missing db or term", 400);
  const r = await resolveDb(
    cwd,
    body.db,
    omitDirNames,
    body.schema,
    req.signal,
  );
  if (r instanceof Response) return r;

  const jobId = makeId("search");
  const ac = new AbortController();
  const job: SearchJob = {
    id: jobId,
    dbId: body.db,
    ...(r.schema ? { schema: r.schema } : {}),
    scannedTables: 0,
    totalTables: 0,
    hits: [],
    done: false,
    abortController: ac,
  };
  searchJobs.set(jobId, job);
  scheduleSearchJobCleanup(jobId, 5 * 60_000);

  const term = body.term;
  const maxHitsPerTable = body.maxHitsPerTable ?? 50;
  const includeNonText = body.includeNonText ?? false;
  const filterTables = body.tables;

  const runJob = async () => {
    try {
      const adapter = await getAdapter(r, cwd, ac.signal);
      const db = asAsync(adapter);
      let tables = (await db.tables(ac.signal))
        .filter((t) => t.type === "table")
        .map((t) => t.name);
      if (filterTables && filterTables.length > 0) {
        const allowed = new Set(filterTables);
        tables = tables.filter((t) => allowed.has(t));
      }

      const countMap = await db.tableRowCounts(tables, ac.signal);
      tables.sort((a, b) => (countMap.get(a) ?? 0) - (countMap.get(b) ?? 0));
      job.totalTables = tables.length;

      for (const table of tables) {
        if (ac.signal.aborted) break;
        job.currentTable = table;
        const columns = await db.columns(table, ac.signal);
        const pkCols = getPrimaryKeyColumnsFromColumns(columns);
        const hits = await searchTableAsync(
          adapter,
          table,
          columns,
          term,
          maxHitsPerTable,
          includeNonText,
          pkCols,
          ac.signal,
        );
        job.hits.push(
          ...hits.map((hit) => ({
            ...(r.schema ? { schema: r.schema } : {}),
            ...hit,
          })),
        );
        job.scannedTables++;
      }
      job.done = true;
      job.currentTable = undefined;
    } catch (err) {
      if (!isAbortLikeError(err, ac.signal)) {
        job.error = err instanceof Error ? err.message : String(err);
      }
      job.done = true;
      job.currentTable = undefined;
      scheduleSearchJobCleanup(job.id, 60_000);
    }
  };
  const timer = setTimeout(() => void runJob(), 0);
  timer.unref?.();

  return json({ jobId });
}

function handleSearchStatus(url: URL): Response {
  const jobId = url.searchParams.get("id");
  if (!jobId) return textError("missing id", 400);
  const job = searchJobs.get(jobId);
  if (!job) return textError("job not found", 404);
  const result = {
    jobId: job.id,
    dbId: job.dbId,
    schema: job.schema,
    scannedTables: job.scannedTables,
    totalTables: job.totalTables,
    currentTable: job.currentTable,
    hits: job.hits,
    done: job.done,
    error: job.error,
  };
  if (job.done) {
    scheduleSearchJobCleanup(jobId, 60_000);
  }
  return json(result);
}

async function handleSearchCancel(req: Request): Promise<Response> {
  const body = await parsePostJsonBody<{ id?: string }>(req);
  if (body instanceof Response) return body;
  if (!body.id) return textError("missing id", 400);
  const job = searchJobs.get(body.id);
  if (!job) return textError("job not found", 404);
  job.abortController.abort();
  job.done = true;
  job.currentTable = undefined;
  scheduleSearchJobCleanup(job.id, 60_000);
  return json({ ok: true });
}

// --- Snapshot ---

type SnapshotSource = Parameters<typeof runSnapshot>[1];
type SnapshotDockerSource = {
  source: SnapshotSource;
  containers: string[];
  closeAfterSnapshot: boolean;
};
type SnapshotJob = {
  abortController: AbortController;
  dbId: string;
  snapshotId?: string;
  done: boolean;
};

type SnapshotDockerSourceFactory = (
  info: DockerDbInfo,
  requestedContainers: string[] | undefined,
  signal?: AbortSignal,
) => Promise<SnapshotDockerSource>;
type DockerCloseHandler = (dbId: string) => void | Promise<void>;

const snapshotJobs = new Map<string, SnapshotJob>();

const DOCKER_CLOSE_REGISTRY: Partial<Record<DbKind, DockerCloseHandler>> = {
  postgresql: (dbId) => {
    dockerAdapterCache.close(dbId);
    dockerAdapterCache.closePrefix(`${dbId}\0`);
  },
  mysql: (dbId) => {
    dockerAdapterCache.close(dbId);
    dockerAdapterCache.closePrefix(`${dbId}\0`);
  },
  redis: closeRedisAdapter,
  elasticsearch: closeElasticsearchAdapter,
  s3: closeS3Adapter,
};

const SNAPSHOT_DOCKER_SOURCE_REGISTRY: Partial<
  Record<DbKind, SnapshotDockerSourceFactory>
> = {
  redis: async (info, requestedContainers, signal) => {
    const { openRedisExplorerAsync, canonicalizeRedisSnapshotContainer } =
      await import("./adapters/redis");
    const containers =
      requestedContainers && requestedContainers.length > 0
        ? requestedContainers
        : ["*"];
    return {
      source: await openRedisExplorerAsync(
        info.serviceName,
        info.env,
        info.composeDir,
        signal,
      ),
      containers: containers.map(canonicalizeRedisSnapshotContainer),
      closeAfterSnapshot: true,
    };
  },
  elasticsearch: async (info, requestedContainers, signal) => {
    const { openElasticsearchAdapterAsync, canonicalizeEsSnapshotContainer } =
      await import("./adapters/elasticsearch");
    const containers =
      requestedContainers && requestedContainers.length > 0
        ? requestedContainers
        : ["*"];
    return {
      source: await openElasticsearchAdapterAsync(
        info.serviceName,
        info.env,
        info.composeDir,
        signal,
      ),
      containers: containers.map(canonicalizeEsSnapshotContainer),
      closeAfterSnapshot: true,
    };
  },
};

async function openRegisteredDockerSnapshotSource(
  info: DockerDbInfo,
  requestedContainers: string[] | undefined,
  signal?: AbortSignal,
): Promise<SnapshotDockerSource | null> {
  const factory = SNAPSHOT_DOCKER_SOURCE_REGISTRY[info.kind];
  return factory ? factory(info, requestedContainers, signal) : null;
}

async function handleSnapshotList(cwd: string, url: URL): Promise<Response> {
  const dbId = url.searchParams.get("db") || undefined;
  const schema = normalizeSchemaParam(url.searchParams.get("schema"));
  if (schema instanceof Response) return schema;
  const snapshots = await listSnapshots(cwd, dbId, schema);
  return json({ snapshots });
}

function sanitizeSnapshotTables(tables: unknown): string[] | undefined | null {
  if (tables === undefined || tables === null) return undefined;
  if (!Array.isArray(tables)) return null;
  if (tables.length === 0) return undefined;
  const out: string[] = [];
  for (const table of tables) {
    if (out.length >= MAX_SNAPSHOT_TABLES) break;
    if (typeof table !== "string") return null;
    if (table.length === 0 || table.length > MAX_SNAPSHOT_TABLE_NAME_LEN) {
      return null;
    }
    out.push(table);
  }
  return out;
}

async function handleSnapshotCreate(
  cwd: string,
  req: Request,
  sendSse?: (event: string, data?: string) => void,
  omitDirNames?: string[],
): Promise<Response> {
  const body = await parsePostJsonBody<{
    db?: string;
    schema?: string;
    tables?: string[];
    note?: string;
  }>(req);
  if (body instanceof Response) return body;
  if (!body.db) return textError("missing db", 400);
  const requestedTables = sanitizeSnapshotTables(body.tables);
  if (requestedTables === null) {
    return textError("invalid tables", 400);
  }

  // Redis (KV) も snapshot を生成できるよう、resolveDb の SQL-only 制限を
  // 迂回して直接 source を引き出す。redis service なら RedisExplorer を、
  // それ以外 (sqlite / pg / mysql) は既存 getAdapter を使う。
  let source: SnapshotSource | null = null;
  let containers = requestedTables;
  let closeSourceAfterSnapshot = false;
  if (body.db.startsWith("docker:")) {
    const parsed = parseDockerDbId(body.db);
    if (!parsed) return textError("invalid docker db id", 400);
    const info = await findDockerServiceByDbIdAsync(
      cwd,
      body.db,
      undefined,
      omitDirNames,
      req.signal,
    );
    if (!info) return textError("docker service not found", 404);
    const registeredSource = await openRegisteredDockerSnapshotSource(
      info,
      requestedTables,
      req.signal,
    );
    if (registeredSource) {
      source = registeredSource.source;
      containers = registeredSource.containers;
      closeSourceAfterSnapshot = registeredSource.closeAfterSnapshot;
    }
  }
  if (!source) {
    const r = await resolveDb(
      cwd,
      body.db,
      omitDirNames,
      body.schema,
      req.signal,
    );
    if (r instanceof Response) return r;
    source = await getAdapter(r, cwd, req.signal);
    body.schema = r.schema;
  }

  if (!containers || containers.length === 0) {
    if ((source as { model?: string }).model === "sql") {
      containers = (await asAsync(source as DatabaseAdapter).tables(req.signal))
        .filter((t) => t.type === "table")
        .map((t) => t.name);
    }
  }
  if (!containers || containers.length === 0) {
    return textError(
      "missing tables/containers (Redis requires explicit key patterns)",
      400,
    );
  }

  const note = body.note ?? "";
  const snapshotDbId = body.db;
  const snapshotContainers = containers;
  const abortController = new AbortController();
  const snapshotJob: SnapshotJob = {
    abortController,
    dbId: snapshotDbId,
    done: false,
  };
  let activeSnapshotId: string | undefined;

  (async () => {
    try {
      const snapshotId = await runSnapshot(
        cwd,
        source,
        snapshotDbId,
        snapshotContainers,
        note,
        (progress) => {
          sendSse?.(
            "db-snapshot",
            JSON.stringify({
              action: "progress",
              dbId: snapshotDbId,
              schema: body.schema,
              id: activeSnapshotId,
              table: progress.container,
              done: progress.done,
              index: progress.index,
              total: progress.total,
            }),
          );
        },
        {
          signal: abortController.signal,
          schema: body.schema,
          onSnapshotId: (id) => {
            activeSnapshotId = id;
            snapshotJob.snapshotId = id;
            snapshotJobs.set(id, snapshotJob);
            sendSse?.(
              "db-snapshot",
              JSON.stringify({
                action: "started",
                dbId: snapshotDbId,
                schema: body.schema,
                id,
                total: snapshotContainers.length,
              }),
            );
          },
        },
      );
      sendSse?.(
        "db-snapshot",
        JSON.stringify({
          action: "created",
          dbId: snapshotDbId,
          schema: body.schema,
          id: snapshotId,
        }),
      );
    } catch (err) {
      const aborted = isAbortLikeError(err, abortController.signal);
      if (!aborted) {
        console.error(
          "[code-viewer] snapshot error:",
          err instanceof Error ? err.message : String(err),
        );
      }
      sendSse?.(
        "db-snapshot",
        JSON.stringify({
          action: aborted ? "aborted" : "error",
          dbId: snapshotDbId,
          schema: body.schema,
          id: activeSnapshotId,
          ...(aborted
            ? {}
            : { error: err instanceof Error ? err.message : String(err) }),
        }),
      );
    } finally {
      snapshotJob.done = true;
      if (activeSnapshotId) {
        setTimeout(() => snapshotJobs.delete(activeSnapshotId), 60_000).unref();
      }
      if (closeSourceAfterSnapshot) {
        try {
          (source as { close?: () => void }).close?.();
        } catch {
          // ignore close errors after snapshot completion
        }
      }
    }
  })();

  return json({ ok: true, message: "snapshot started" });
}

async function handleSnapshotCancel(req: Request, url: URL): Promise<Response> {
  let id = url.searchParams.get("id") || "";
  if (!id) {
    const body = await parsePostJsonBody<{ id?: string }>(req);
    if (body instanceof Response) return body;
    id = body.id || "";
  }
  if (!id) return textError("missing id", 400);
  const job = snapshotJobs.get(id);
  if (!job) return textError("snapshot job not found", 404);
  if (!job.done) {
    job.abortController.abort();
  }
  return json({ ok: true });
}

async function handleSnapshotUpdateNote(
  cwd: string,
  req: Request,
): Promise<Response> {
  const body = await parsePostJsonBody<{ id?: string; note?: string }>(req);
  if (body instanceof Response) return body;
  if (!body.id) return textError("missing id", 400);
  await updateSnapshotNote(cwd, body.id, body.note ?? "");
  return json({ ok: true });
}

async function handleSnapshotDelete(
  cwd: string,
  req: Request,
): Promise<Response> {
  const body = await parsePostJsonBody<{ id?: string }>(req);
  if (body instanceof Response) return body;
  if (!body.id) return textError("missing id", 400);
  await deleteSnapshot(cwd, body.id);
  return json({ ok: true });
}

// --- Snapshot Diff (on-demand) ---

async function handleDiffTables(cwd: string, url: URL): Promise<Response> {
  const beforeId = url.searchParams.get("before");
  const afterId = url.searchParams.get("after");
  if (!beforeId || !afterId)
    return textError("missing before or after parameter", 400);
  try {
    const tables = await computeDiffTables(cwd, beforeId, afterId);
    return json({ beforeId, afterId, tables });
  } catch (err) {
    return handleError("database", "compute diff", err);
  }
}

async function handleDiffRows(cwd: string, url: URL): Promise<Response> {
  const beforeId = url.searchParams.get("before");
  const afterId = url.searchParams.get("after");
  const table = url.searchParams.get("table");
  if (!beforeId || !afterId || !table)
    return textError("missing before, after, or table parameter", 400);
  const offset = Math.max(
    0,
    Number(url.searchParams.get("offset") || "0") || 0,
  );
  const limit = Math.min(
    1000,
    Math.max(1, Number(url.searchParams.get("limit") || "200") || 200),
  );
  try {
    const result = await computeDiffRows(
      cwd,
      beforeId,
      afterId,
      table,
      offset,
      limit,
    );
    return json({ beforeId, afterId, table, ...result });
  } catch (err) {
    return handleError("database", "compute diff rows", err);
  }
}

// --- Tabs ---

async function handleTabsGet(cwd: string): Promise<Response> {
  return json(await loadTabsAsync(cwd));
}

async function handleTabsPut(cwd: string, req: Request): Promise<Response> {
  const contentLength = Number(req.headers.get("content-length") || "0");
  if (contentLength > MAX_TABS_BODY_BYTES) {
    return textError("tabs body too large", 413);
  }
  let body: unknown;
  try {
    const raw = await req.text();
    if (Buffer.byteLength(raw, "utf8") > MAX_TABS_BODY_BYTES) {
      return textError("tabs body too large", 413);
    }
    body = JSON.parse(raw);
  } catch {
    return textError("invalid JSON body", 400);
  }
  if (
    !body ||
    typeof body !== "object" ||
    (body as { version?: unknown }).version !== 1
  ) {
    return textError("invalid tabs version", 400);
  }
  try {
    await saveTabsAsync(
      cwd,
      body as import("../../core/database/types").TabsState,
    );
    return json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === "tabs state too large") {
      return textError(message, 413);
    }
    return textError(`failed to save tabs: ${message}`, 500);
  }
}

async function handleDbUiGet(cwd: string): Promise<Response> {
  return jsonLoadResponse(
    () => loadDbUiState(cwd),
    "db UI",
    "failed to load db UI state",
  );
}

async function handleDbUiPatch(cwd: string, req: Request): Promise<Response> {
  const body = await parseBoundedJsonBody(
    req,
    MAX_DB_UI_BODY_BYTES,
    "db UI body too large",
  );
  if (body instanceof Response) return body;
  try {
    return json(await patchDbUiState(cwd, body));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === "db UI state too large") return textError(message, 413);
    console.error("[code-viewer] db UI error:", err);
    return textError("failed to save db UI state", 500);
  }
}

async function handleClose(
  cwd: string,
  req: Request,
  omitDirNames?: string[],
): Promise<Response> {
  const body = await parsePostJsonBody<{ db?: string }>(req);
  if (body instanceof Response) return body;
  if (!body.db) return textError("missing db", 400);
  if (body.db.startsWith("docker:")) {
    const parsed = parseDockerDbId(body.db);
    if (!parsed) return textError("invalid docker db id", 400);
    const info = await findDockerServiceByDbIdAsync(
      cwd,
      body.db,
      undefined,
      omitDirNames,
      req.signal,
    );
    if (!info) {
      dockerAdapterCache.close(body.db);
      dockerAdapterCache.closePrefix(`${body.db}\0`);
      closeRedisAdapter(body.db);
      closeElasticsearchAdapter(body.db);
      closeS3Adapter(body.db);
      return json({ ok: true });
    }
    await DOCKER_CLOSE_REGISTRY[info.kind]?.(body.db);
    return json({ ok: true });
  }
  const r = await resolveDb(cwd, body.db, omitDirNames, undefined, req.signal);
  if (r instanceof Response) return r;
  if (r.docker) {
    dockerAdapterCache.close(r.dbId);
    dockerAdapterCache.closePrefix(`${r.dbId}\0`);
  } else {
    closeConnection(r.resolved);
  }
  return json({ ok: true });
}

// 行の編集 / 追加 / 削除を適用する。クライアントは生 SQL ではなく正規化された
// RowMutation[] を送り、SQL 生成と検証は adapter / mutate.ts 側で行う。
async function handleMutate(
  cwd: string,
  req: Request,
  omitDirNames?: string[],
): Promise<Response> {
  const parsed = await parseBoundedJsonBody(
    req,
    1024 * 1024,
    "payload too large",
  );
  if (parsed instanceof Response) return parsed;
  const body = parsed as {
    db?: unknown;
    schema?: unknown;
    table?: unknown;
    mutations?: unknown;
  };
  if (typeof body.db !== "string" || body.db === "") {
    return textError("missing db", 400);
  }
  if (typeof body.table !== "string" || body.table === "") {
    return textError("missing table", 400);
  }
  if (!Array.isArray(body.mutations) || body.mutations.length === 0) {
    return textError("missing mutations", 400);
  }
  const schemaParam = typeof body.schema === "string" ? body.schema : undefined;
  const r = await resolveDb(
    cwd,
    body.db,
    omitDirNames,
    schemaParam,
    req.signal,
  );
  if (r instanceof Response) return r;
  const adapter = await getAdapter(r, cwd, req.signal);
  if (!adapter.applyMutations) {
    return textError("writes are not supported for this datastore", 400);
  }
  try {
    const tableName = body.table;
    const { result, executedSql } = await captureSql(
      () =>
        adapter.applyMutations?.(
          tableName,
          body.mutations as RowMutation[],
          req.signal,
        ) ?? Promise.reject(new Error("applyMutations not supported")),
    );
    adapter.invalidateTableMetaCache?.(tableName);
    const response: DbMutateResponse = {
      dbId: r.dbId,
      ...(r.schema ? { schema: r.schema } : {}),
      table: tableName,
      affected: result.affected,
      executedSql,
    };
    return json(response);
  } catch (err) {
    if (isAbortLikeError(err, req.signal)) {
      return textError("mutation aborted", 503);
    }
    // 検証エラー (未知のカラム/主キー欠落等) や DB 制約違反はユーザーに見せる。
    const message = err instanceof Error ? err.message : String(err);
    return textError(message, 400);
  }
}

export async function handleDatabaseRoute(
  req: Request,
  url: URL,
  cwd: string,
  omitDirNames: string[],
  sideEffectAllowed: (req: Request) => boolean,
  sendSse?: (event: string, data?: string) => void,
): Promise<Response | null> {
  ensureInit();
  if (url.pathname.startsWith("/_db/redis/")) {
    const { handleRedisRoute } = await import("./handle-redis");
    return handleRedisRoute(req, url, cwd, sideEffectAllowed, omitDirNames);
  }
  if (url.pathname.startsWith("/_db/elasticsearch/")) {
    const { handleElasticsearchRoute } = await import("./handle-elasticsearch");
    return handleElasticsearchRoute(
      req,
      url,
      cwd,
      sideEffectAllowed,
      omitDirNames,
    );
  }
  if (url.pathname.startsWith("/_db/s3/")) {
    const { handleS3Route } = await import("./handle-s3");
    return handleS3Route(req, url, cwd, sideEffectAllowed, omitDirNames);
  }
  const start = Date.now();
  const method = req.method;
  const wrapResponse = (res: Response): Response => {
    logResponseWithReason("[code-viewer]", req, url, res, start, {
      qsLen: 120,
    });
    return res;
  };
  return dispatchRoutes(
    req,
    url,
    {
      "/_db/files": {
        methods: ["GET"],
        handler: () => handleFiles(cwd, omitDirNames, req.signal),
      },
      "/_db/schemas": {
        methods: ["GET"],
        handler: () => handleSchemas(cwd, url, omitDirNames, req.signal),
      },
      "/_db/schema": {
        methods: ["GET"],
        handler: () => handleSchema(cwd, url, omitDirNames, req.signal),
      },
      "/_db/table": {
        methods: ["GET"],
        handler: () => handleTable(cwd, url, omitDirNames, req.signal),
      },
      "/_db/columns": {
        methods: ["GET"],
        handler: () => handleColumns(cwd, url, omitDirNames, req.signal),
      },
      "/_db/export": {
        methods: ["GET"],
        handler: () => handleExport(cwd, url, omitDirNames, req.signal),
      },
      "/_db/ddl": {
        methods: ["GET"],
        handler: () => handleDdl(cwd, url, omitDirNames, req.signal),
      },
      "/_db/query": {
        methods: ["POST"],
        sideEffect: true,
        handler: () => handleQuery(cwd, req, sendSse, omitDirNames),
      },
      "/_db/mutate": {
        methods: ["POST"],
        sideEffect: true,
        handler: () => handleMutate(cwd, req, omitDirNames),
      },
      "/_db/close": {
        methods: ["POST"],
        sideEffect: true,
        handler: () => handleClose(cwd, req, omitDirNames),
      },
      "/_db/history": {
        methods: ["GET"],
        handler: () => handleHistory(cwd, url),
      },
      "/_db/history/delete": {
        methods: ["POST"],
        sideEffect: true,
        handler: () => handleHistoryDelete(cwd, req, sendSse),
      },
      "/_db/history/clear": {
        methods: ["POST"],
        sideEffect: true,
        handler: () => handleHistoryClear(cwd, req, sendSse),
      },
      "/_db/search/start": {
        methods: ["POST"],
        sideEffect: true,
        handler: () => handleSearchStart(cwd, req, omitDirNames),
      },
      "/_db/search/status": {
        methods: ["GET"],
        handler: () => handleSearchStatus(url),
      },
      "/_db/search/cancel": {
        methods: ["POST"],
        sideEffect: true,
        handler: () => handleSearchCancel(req),
      },
      "/_db/snapshot/list": {
        methods: ["GET"],
        handler: () => handleSnapshotList(cwd, url),
      },
      "/_db/snapshot/create": {
        methods: ["POST"],
        sideEffect: true,
        handler: () => handleSnapshotCreate(cwd, req, sendSse, omitDirNames),
      },
      "/_db/snapshot/cancel": {
        methods: ["POST"],
        sideEffect: true,
        handler: () => handleSnapshotCancel(req, url),
      },
      "/_db/snapshot/update-note": {
        methods: ["POST"],
        sideEffect: true,
        handler: () => handleSnapshotUpdateNote(cwd, req),
      },
      "/_db/snapshot/delete": {
        methods: ["POST"],
        sideEffect: true,
        handler: () => handleSnapshotDelete(cwd, req),
      },
      "/_db/snapshot/diff/tables": {
        methods: ["GET"],
        handler: () => handleDiffTables(cwd, url),
      },
      "/_db/snapshot/diff/rows": {
        methods: ["GET"],
        handler: () => handleDiffRows(cwd, url),
      },
      "/_db/tabs": {
        methods: ["GET", "PUT", "POST"],
        sideEffect: (m) => m !== "GET",
        handler: () =>
          method === "GET" ? handleTabsGet(cwd) : handleTabsPut(cwd, req),
      },
      "/_db/ui": {
        methods: ["GET", "PATCH"],
        sideEffect: (m) => m !== "GET",
        handler: () =>
          method === "GET" ? handleDbUiGet(cwd) : handleDbUiPatch(cwd, req),
      },
    },
    sideEffectAllowed,
    wrapResponse,
    (err) => handleError("database", "handle database request", err),
  );
}
