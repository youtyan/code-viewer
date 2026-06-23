import type {
  DbColumn,
  DbFilesResponse,
  DbKind,
  DbOrder,
  DbQueryResponse,
  DbSchemaResponse,
  DbTableDataResponse,
  QueryHistoryEntry,
} from "../../core/database/types";
import { makeId } from "../../core/id";
import { listDockerDatabases, openDockerAdapter } from "./adapters/docker";
import { sqliteAdapterFactory } from "./adapters/sqlite";
import type { DatabaseAdapter } from "./adapters/types";
import {
  closeConnection,
  getConnection,
  setAdapterFactory,
} from "./connection-pool";
import {
  type DockerDbInfo,
  discoverDockerDatabases,
  discoverSqliteFiles,
  findDockerServiceByDbId,
  parseDockerDbId,
  validateDbPath,
} from "./discovery";
import { getPrimaryKeyColumns, searchTable } from "./global-search";
import {
  createDockerAdapterCache,
  dispatchRoutes,
  handleError,
  parsePostJsonBody,
} from "./handle-shared";
import {
  addQueryHistoryEntry,
  clearQueryHistory,
  deleteQueryHistoryEntry,
  loadQueryHistory,
  saveQueryHistory,
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
import { loadTabs, saveTabs } from "./tabs-store";

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
): Promise<DatabaseAdapter> {
  if (r.docker) {
    const docker = r.docker;
    return dockerAdapterCache.getOrOpen(r.dbId, () =>
      // recursive discovery により compose は subdir に置けるので、
      // `docker compose ps` の cwd は r.docker.composeDir に固定する。
      openDockerAdapter(
        docker.serviceName,
        docker.kind as "postgresql" | "mysql",
        docker.env,
        docker.composeDir,
        docker.database,
      ),
    );
  }
  return getConnection(r.resolved);
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

export function textError(message: string, status: number): Response {
  return new Response(message, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function sanitizeFilename(name: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional control char stripping for HTTP header safety
  return name.replace(/["\\\r\n\x00-\x1f]/g, "_");
}

type ResolvedDb = { resolved: string; dbId: string; docker?: DockerDbInfo };

function resolveDb(cwd: string, dbParam: string | null): ResolvedDb | Response {
  if (!dbParam) return textError("missing db parameter", 400);
  if (dbParam.startsWith("docker:")) {
    const parsed = parseDockerDbId(dbParam);
    if (!parsed) return textError("invalid docker db id", 400);
    const info = findDockerServiceByDbId(cwd, dbParam);
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
    const resolved = parsed.database
      ? { ...info, database: parsed.database }
      : info;
    return { resolved: dbParam, dbId: dbParam, docker: resolved };
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

function handleFiles(cwd: string, omitDirNames: string[]): Response {
  const sqliteFiles = discoverSqliteFiles(cwd, omitDirNames);
  const dockerServices = discoverDockerDatabases(cwd, omitDirNames);
  const dockerTruncated = dockerServices.truncated === true;
  const dockerEntries: typeof dockerServices = [];
  for (const svc of dockerServices) {
    if (svc.kind === "redis" || svc.kind === "elasticsearch") {
      dockerEntries.push(svc);
      continue;
    }
    const dbs = listDockerDatabases(
      svc.serviceName,
      svc.kind as "postgresql" | "mysql",
      svc.env,
      svc.composeDir,
    );
    if (dbs.length <= 1) {
      dockerEntries.push(svc);
    } else {
      for (const db of dbs) {
        // svc.id は subdir compose の場合 `docker:<svc>@<encoded>` 形式に
        // なっているので、それに `:<db>` を後ろから足すだけで一意になる。
        dockerEntries.push({
          ...svc,
          id: `${svc.id}:${db}`,
          name: svc.name.replace(/\)$/, ` / ${db})`),
          database: db,
        });
      }
    }
  }
  // Strip env / serviceName / database from the response — these contain
  // credentials and internal state that the browser must not see.
  const body: DbFilesResponse = {
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
  };
  return json(body);
}

async function handleSchema(cwd: string, url: URL): Promise<Response> {
  const r = resolveDb(cwd, url.searchParams.get("db"));
  if (r instanceof Response) return r;
  const includeColumns = url.searchParams.get("includeColumns") === "1";
  try {
    const adapter = await getAdapter(r, cwd);
    const tables = adapter.getTables();
    const tableNames = tables
      .filter((t) => t.type === "table")
      .map((t) => t.name);
    let countMap: Map<string, number>;
    if (adapter.getTableRowCounts) {
      countMap = adapter.getTableRowCounts(tableNames);
    } else {
      countMap = new Map();
      for (const name of tableNames) {
        countMap.set(name, adapter.getTableRowCount(name));
      }
    }
    const tablesWithCount = tables.map((t) => ({
      ...t,
      rowCount: t.type === "table" ? (countMap.get(t.name) ?? 0) : null,
    }));
    const indexes = adapter.getIndexes();
    const foreignKeys = adapter.getForeignKeys();
    const body: DbSchemaResponse = {
      dbId: r.dbId,
      tables: tablesWithCount,
      indexes,
      foreignKeys,
    };
    if (includeColumns) {
      let colsMap: Map<string, import("../../core/database/types").DbColumn[]>;
      if (adapter.getColumnsMulti) {
        colsMap = adapter.getColumnsMulti(tableNames);
      } else {
        colsMap = new Map();
        for (const name of tableNames) {
          colsMap.set(name, adapter.getColumns(name));
        }
      }
      body.columnsMap = Object.fromEntries(colsMap);
    }
    return json(body);
  } catch (err) {
    return handleError("database", "read schema", err);
  }
}

function sanitizeIdentifier(
  name: string,
  kind: "sqlite" | "postgresql" | "mysql" = "sqlite",
): string {
  if (kind === "mysql") return `\`${name.replace(/`/g, "``")}\``;
  return `"${name.replace(/"/g, '""')}"`;
}

function escapeSqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

type FilterSql = {
  where: string;
  params: string[];
  useParams: boolean;
};

function buildFilterWhere(
  grouped: Map<string, string[]>,
  kind: "sqlite" | "postgresql" | "mysql",
): FilterSql {
  const whereParts: string[] = [];
  const params: string[] = [];
  const useParams = kind === "sqlite";
  for (const [value, cols] of grouped) {
    const likeVal = useParams ? "?" : escapeSqlString(`%${value}%`);
    if (cols.length === 1) {
      const cast =
        kind === "mysql"
          ? `CAST(${sanitizeIdentifier(cols[0], kind)} AS CHAR)`
          : `CAST(${sanitizeIdentifier(cols[0], kind)} AS TEXT)`;
      whereParts.push(`${cast} LIKE ${likeVal}`);
      if (useParams) params.push(`%${value}%`);
    } else {
      const orParts = cols.map((c) => {
        const cast =
          kind === "mysql"
            ? `CAST(${sanitizeIdentifier(c, kind)} AS CHAR)`
            : `CAST(${sanitizeIdentifier(c, kind)} AS TEXT)`;
        return `${cast} LIKE ${likeVal}`;
      });
      whereParts.push(`(${orParts.join(" OR ")})`);
      if (useParams) {
        for (let i = 0; i < cols.length; i++) params.push(`%${value}%`);
      }
    }
  }
  return { where: whereParts.join(" AND "), params, useParams };
}

function parseFilters(url: URL): { column: string; value: string }[] {
  const raw = url.searchParams.get("filters");
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (f: unknown): f is { column: string; value: string } =>
        !!f &&
        typeof f === "object" &&
        typeof (f as Record<string, unknown>).column === "string" &&
        typeof (f as Record<string, unknown>).value === "string",
    );
  } catch {
    return [];
  }
}

async function handleTable(cwd: string, url: URL): Promise<Response> {
  const r = resolveDb(cwd, url.searchParams.get("db"));
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
  try {
    const adapter = await getAdapter(r, cwd);
    const columns = adapter.getColumns(table);
    const colNames = new Set(columns.map((c) => c.name));
    if (sortCol && !colNames.has(sortCol)) {
      return textError(`invalid sort column: ${sortCol}`, 400);
    }

    if (filters.length > 0) {
      const validFilters = filters.filter((f) => colNames.has(f.column));
      if (validFilters.length > 0) {
        const grouped = new Map<string, string[]>();
        for (const f of validFilters) {
          const existing = grouped.get(f.value) || [];
          existing.push(f.column);
          grouped.set(f.value, existing);
        }
        const k = adapter.kind as "sqlite" | "postgresql" | "mysql";
        const filter = buildFilterWhere(grouped, k);
        const order = orderBy
          ? ` ORDER BY ${sanitizeIdentifier(orderBy[0].column, k)} ${orderBy[0].direction === "desc" ? "DESC" : "ASC"}`
          : "";
        const tbl = sanitizeIdentifier(table, k);
        const countSql = `SELECT COUNT(*) AS cnt FROM ${tbl} WHERE ${filter.where}`;
        const limitOffset = filter.useParams
          ? "LIMIT ? OFFSET ?"
          : `LIMIT ${limit} OFFSET ${offset}`;
        const dataSql = `SELECT * FROM ${tbl} WHERE ${filter.where}${order} ${limitOffset}`;
        const countResult = adapter.executeReadonlyQuery(
          countSql,
          filter.useParams ? filter.params : undefined,
        );
        const totalRows =
          countResult.rows.length > 0 ? Number(countResult.rows[0][0]) || 0 : 0;
        const dataResult = adapter.executeReadonlyQuery(
          dataSql,
          filter.useParams ? [...filter.params, limit, offset] : undefined,
        );
        const body: DbTableDataResponse = {
          dbId: r.dbId,
          table,
          columns,
          rows: serializeDbRows(dataResult.rows),
          totalRows,
          offset,
          limit,
          hasMore: offset + dataResult.rowCount < totalRows,
        };
        return json(body);
      }
    }

    const result = adapter.getTablePage(table, { offset, limit, orderBy });
    const totalRows =
      result.rowCount < limit
        ? offset + result.rowCount
        : adapter.getTableRowCount(table);
    const body: DbTableDataResponse = {
      dbId: r.dbId,
      table,
      columns,
      rows: serializeDbRows(result.rows),
      totalRows,
      offset,
      limit,
      hasMore: offset + result.rowCount < totalRows,
    };
    return json(body);
  } catch (err) {
    return handleError("database", "read table", err);
  }
}

function makeHistoryId(): string {
  return makeId("qh");
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

export function parseSelectAllTable(sql: string): string | null {
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
  return unquoteSqlIdentifier(match[2] || match[1]);
}

function inferEmptyQueryColumns(
  adapter: DatabaseAdapter,
  sql: string,
): DbColumn[] {
  const table = parseSelectAllTable(sql);
  if (!table) return [];
  try {
    return adapter.getColumns(table);
  } catch {
    return [];
  }
}

async function handleQuery(
  cwd: string,
  req: Request,
  sendSse?: (event: string, data?: string) => void,
): Promise<Response> {
  const body = await parsePostJsonBody<{
    db?: string;
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
  const r = resolveDb(cwd, body.db);
  if (r instanceof Response) return r;
  const maxRows = Math.min(10000, Math.max(1, body.maxRows || 1000));
  const start = Date.now();
  try {
    const adapter = await getAdapter(r, cwd);
    const result = adapter.executeReadonlyQuery(body.sql, undefined, maxRows);
    const elapsed = Date.now() - start;
    const serializedRows = serializeDbRows(result.rows);
    const inferredColumns =
      result.columns.length === 0 && result.rows.length === 0
        ? inferEmptyQueryColumns(adapter, body.sql)
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
      columns,
      columnTypes,
      rows: serializedRows,
      rowCount: result.rowCount,
      truncated: result.rowCount >= maxRows,
      elapsedMs: elapsed,
    };
    if (body.saveHistory) {
      const entry: QueryHistoryEntry = {
        id: makeHistoryId(),
        dbId: body.db,
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
      const state = loadQueryHistory(cwd);
      const updated = addQueryHistoryEntry(state, entry);
      saveQueryHistory(cwd, updated);
      sendSse?.(
        "db-query",
        JSON.stringify({ action: "add", dbId: body.db, id: entry.id }),
      );
    }
    return json(response);
  } catch (err) {
    console.error(
      "[code-viewer] database error:",
      err instanceof Error ? err.message : String(err),
    );
    const elapsed = Date.now() - start;
    const response: DbQueryResponse = {
      dbId: body.db,
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

function handleHistory(cwd: string, url: URL): Response {
  const dbId = url.searchParams.get("db") || undefined;
  const state = loadQueryHistory(cwd);
  if (dbId) {
    return json({
      version: 1,
      entries: state.entries.filter((e) => e.dbId === dbId),
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
  const state = loadQueryHistory(cwd);
  const deleted = state.entries.find((entry) => entry.id === body.id);
  const updated = deleteQueryHistoryEntry(state, body.id);
  saveQueryHistory(cwd, updated);
  sendSse?.(
    "db-query",
    JSON.stringify({ action: "delete", dbId: deleted?.dbId, id: body.id }),
  );
  return json({ ok: true });
}

async function handleHistoryClear(
  cwd: string,
  req: Request,
  sendSse?: (event: string, data?: string) => void,
): Promise<Response> {
  if (req.method !== "POST") return textError("method not allowed", 405);
  let body: { db?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    body = {};
  }
  const state = loadQueryHistory(cwd);
  const updated = clearQueryHistory(state, body.db);
  saveQueryHistory(cwd, updated);
  sendSse?.("db-query", JSON.stringify({ action: "clear", dbId: body.db }));
  return json({ ok: true });
}

const EXPORT_MAX_ROWS = 100_000;
const MAX_TABS_BODY_BYTES = 1_000_000;
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

async function handleExport(cwd: string, url: URL): Promise<Response> {
  const r = resolveDb(cwd, url.searchParams.get("db"));
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

  try {
    const adapter = await getAdapter(r, cwd);
    const columns = adapter.getColumns(table);
    const colNames = columns.map((c) => c.name);
    const colNameSet = new Set(colNames);
    if (sortCol && !colNameSet.has(sortCol)) {
      return textError(`invalid sort column: ${sortCol}`, 400);
    }
    let rawRows: import("./serialize").RawDbValue[][];

    if (filters.length > 0) {
      const validFilters = filters.filter((f) => colNameSet.has(f.column));
      if (validFilters.length > 0) {
        const grouped = new Map<string, string[]>();
        for (const f of validFilters) {
          const existing = grouped.get(f.value) || [];
          existing.push(f.column);
          grouped.set(f.value, existing);
        }
        const k = adapter.kind as "sqlite" | "postgresql" | "mysql";
        const filter = buildFilterWhere(grouped, k);
        const order = orderBy
          ? ` ORDER BY ${sanitizeIdentifier(orderBy[0].column, k)} ${orderBy[0].direction === "desc" ? "DESC" : "ASC"}`
          : "";
        const tbl = sanitizeIdentifier(table, k);
        const limitOffset = filter.useParams
          ? "LIMIT ? OFFSET ?"
          : `LIMIT ${EXPORT_MAX_ROWS} OFFSET 0`;
        const dataSql = `SELECT * FROM ${tbl} WHERE ${filter.where}${order} ${limitOffset}`;
        const result = adapter.executeReadonlyQuery(
          dataSql,
          filter.useParams ? [...filter.params, EXPORT_MAX_ROWS, 0] : undefined,
        );
        rawRows = result.rows;
      } else {
        const result = adapter.getTablePage(table, {
          offset: 0,
          limit: EXPORT_MAX_ROWS,
          orderBy,
        });
        rawRows = result.rows;
      }
    } else {
      const result = adapter.getTablePage(table, {
        offset: 0,
        limit: EXPORT_MAX_ROWS,
        orderBy,
      });
      rawRows = result.rows;
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
    return handleError("database", "export table", err);
  }
}

async function handleColumns(cwd: string, url: URL): Promise<Response> {
  const r = resolveDb(cwd, url.searchParams.get("db"));
  if (r instanceof Response) return r;
  const table = url.searchParams.get("table");
  if (!table) return textError("missing table parameter", 400);
  try {
    const adapter = await getAdapter(r, cwd);
    const columns = adapter.getColumns(table);
    return json({ dbId: r.dbId, table, columns });
  } catch (err) {
    return handleError("database", "get columns", err);
  }
}

async function handleDdl(cwd: string, url: URL): Promise<Response> {
  const r = resolveDb(cwd, url.searchParams.get("db"));
  if (r instanceof Response) return r;
  const table = url.searchParams.get("table");
  if (!table) return textError("missing table parameter", 400);
  try {
    const adapter = await getAdapter(r, cwd);
    const sql = adapter.getCreateStatement(table);
    const triggers = adapter.getTriggers(table);
    return json({ dbId: r.dbId, table, sql, triggers });
  } catch (err) {
    return handleError("database", "get DDL", err);
  }
}

// --- Global Search ---

type SearchJob = {
  id: string;
  dbId: string;
  scannedTables: number;
  totalTables: number;
  currentTable?: string;
  hits: import("./global-search").SearchHit[];
  done: boolean;
  error?: string;
  abortController: AbortController;
};

const searchJobs = new Map<string, SearchJob>();

async function handleSearchStart(cwd: string, req: Request): Promise<Response> {
  const body = await parsePostJsonBody<{
    db?: string;
    term?: string;
    tables?: string[];
    maxHitsPerTable?: number;
    includeNonText?: boolean;
  }>(req);
  if (body instanceof Response) return body;
  if (!body.db || !body.term) return textError("missing db or term", 400);
  const r = resolveDb(cwd, body.db);
  if (r instanceof Response) return r;

  const jobId = makeId("search");
  const ac = new AbortController();
  const job: SearchJob = {
    id: jobId,
    dbId: body.db,
    scannedTables: 0,
    totalTables: 0,
    hits: [],
    done: false,
    abortController: ac,
  };
  searchJobs.set(jobId, job);
  setTimeout(() => searchJobs.delete(jobId), 5 * 60_000);

  const term = body.term;
  const maxHitsPerTable = body.maxHitsPerTable ?? 50;
  const includeNonText = body.includeNonText ?? false;
  const filterTables = body.tables;

  (async () => {
    try {
      const adapter = await getAdapter(r, cwd);
      let tables = adapter
        .getTables()
        .filter((t) => t.type === "table")
        .map((t) => t.name);
      if (filterTables && filterTables.length > 0) {
        const allowed = new Set(filterTables);
        tables = tables.filter((t) => allowed.has(t));
      }

      let countMap: Map<string, number>;
      if (adapter.getTableRowCounts) {
        countMap = adapter.getTableRowCounts(tables);
      } else {
        countMap = new Map();
        for (const t of tables) countMap.set(t, adapter.getTableRowCount(t));
      }
      tables.sort((a, b) => (countMap.get(a) ?? 0) - (countMap.get(b) ?? 0));
      job.totalTables = tables.length;

      for (const table of tables) {
        if (ac.signal.aborted) break;
        job.currentTable = table;
        const pkCols = getPrimaryKeyColumns(adapter, table);
        const columns = adapter.getColumns(table);
        const hits = searchTable(
          adapter,
          table,
          columns,
          term,
          maxHitsPerTable,
          includeNonText,
          pkCols,
        );
        job.hits.push(...hits);
        job.scannedTables++;
      }
      job.done = true;
      job.currentTable = undefined;
    } catch (err) {
      job.error = err instanceof Error ? err.message : String(err);
      job.done = true;
    }
  })();

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
    scannedTables: job.scannedTables,
    totalTables: job.totalTables,
    currentTable: job.currentTable,
    hits: job.hits,
    done: job.done,
    error: job.error,
  };
  if (job.done) {
    setTimeout(() => searchJobs.delete(jobId), 60_000);
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
) => Promise<SnapshotDockerSource>;

const snapshotJobs = new Map<string, SnapshotJob>();

const SNAPSHOT_DOCKER_SOURCE_REGISTRY: Partial<
  Record<DbKind, SnapshotDockerSourceFactory>
> = {
  redis: async (info, requestedContainers) => {
    const { openRedisExplorer, canonicalizeRedisSnapshotContainer } =
      await import("./adapters/redis");
    const containers =
      requestedContainers && requestedContainers.length > 0
        ? requestedContainers
        : ["*"];
    return {
      source: openRedisExplorer(info.serviceName, info.env, info.composeDir),
      containers: containers.map(canonicalizeRedisSnapshotContainer),
      closeAfterSnapshot: true,
    };
  },
  elasticsearch: async (info, requestedContainers) => {
    const { openElasticsearchAdapter, canonicalizeEsSnapshotContainer } =
      await import("./adapters/elasticsearch");
    const containers =
      requestedContainers && requestedContainers.length > 0
        ? requestedContainers
        : ["*"];
    return {
      source: openElasticsearchAdapter(
        info.serviceName,
        info.env,
        info.composeDir,
      ),
      containers: containers.map(canonicalizeEsSnapshotContainer),
      closeAfterSnapshot: true,
    };
  },
};

async function openRegisteredDockerSnapshotSource(
  info: DockerDbInfo,
  requestedContainers: string[] | undefined,
): Promise<SnapshotDockerSource | null> {
  const factory = SNAPSHOT_DOCKER_SOURCE_REGISTRY[info.kind];
  return factory ? factory(info, requestedContainers) : null;
}

async function handleSnapshotList(cwd: string, url: URL): Promise<Response> {
  const dbId = url.searchParams.get("db") || undefined;
  const snapshots = await listSnapshots(cwd, dbId);
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
): Promise<Response> {
  const body = await parsePostJsonBody<{
    db?: string;
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
  let source: SnapshotSource;
  let containers = requestedTables;
  let closeSourceAfterSnapshot = false;
  if (body.db.startsWith("docker:")) {
    const parsed = parseDockerDbId(body.db);
    if (!parsed) return textError("invalid docker db id", 400);
    const info = findDockerServiceByDbId(cwd, body.db);
    if (!info) return textError("docker service not found", 404);
    const registeredSource = await openRegisteredDockerSnapshotSource(
      info,
      requestedTables,
    );
    if (registeredSource) {
      source = registeredSource.source;
      containers = registeredSource.containers;
      closeSourceAfterSnapshot = registeredSource.closeAfterSnapshot;
    } else {
      const r = resolveDb(cwd, body.db);
      if (r instanceof Response) return r;
      source = await getAdapter(r, cwd);
    }
  } else {
    const r = resolveDb(cwd, body.db);
    if (r instanceof Response) return r;
    source = await getAdapter(r, cwd);
  }

  if (!containers || containers.length === 0) {
    // SQL pass: getTables() で table 一覧を default にする。
    const sqlAdapter = source as {
      getTables?: () => Array<{ name: string; type: string }>;
    };
    if (typeof sqlAdapter.getTables === "function") {
      containers = sqlAdapter
        .getTables()
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
        (table, done) => {
          sendSse?.(
            "db-snapshot",
            JSON.stringify({
              action: "progress",
              dbId: snapshotDbId,
              table,
              done,
            }),
          );
        },
        {
          signal: abortController.signal,
          onSnapshotId: (id) => {
            activeSnapshotId = id;
            snapshotJob.snapshotId = id;
            snapshotJobs.set(id, snapshotJob);
            sendSse?.(
              "db-snapshot",
              JSON.stringify({
                action: "started",
                dbId: snapshotDbId,
                id,
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
          id: snapshotId,
        }),
      );
    } catch (err) {
      console.error(
        "[code-viewer] snapshot error:",
        err instanceof Error ? err.message : String(err),
      );
      sendSse?.(
        "db-snapshot",
        JSON.stringify({
          action: "error",
          dbId: snapshotDbId,
          error: err instanceof Error ? err.message : String(err),
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

function handleTabsGet(cwd: string): Response {
  return json(loadTabs(cwd));
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
    saveTabs(cwd, body as import("../../core/database/types").TabsState);
    return json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === "tabs state too large") {
      return textError(message, 413);
    }
    return textError(`failed to save tabs: ${message}`, 500);
  }
}

async function handleClose(cwd: string, req: Request): Promise<Response> {
  const body = await parsePostJsonBody<{ db?: string }>(req);
  if (body instanceof Response) return body;
  if (!body.db) return textError("missing db", 400);
  if (body.db.startsWith("docker:")) {
    const parsed = parseDockerDbId(body.db);
    if (!parsed) return textError("invalid docker db id", 400);
    const info = findDockerServiceByDbId(cwd, body.db);
    if (!info) return textError("docker service not found", 404);
    if (info.kind === "redis") {
      const { closeRedisAdapter } = await import("./handle-redis");
      closeRedisAdapter(body.db);
      return json({ ok: true });
    }
    if (info.kind === "elasticsearch") {
      const { closeElasticsearchAdapter } = await import(
        "./handle-elasticsearch"
      );
      closeElasticsearchAdapter(body.db);
      return json({ ok: true });
    }
  }
  const r = resolveDb(cwd, body.db);
  if (r instanceof Response) return r;
  if (r.docker) {
    dockerAdapterCache.close(r.dbId);
  } else {
    closeConnection(r.resolved);
  }
  return json({ ok: true });
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
    return handleRedisRoute(req, url, cwd, sideEffectAllowed);
  }
  if (url.pathname.startsWith("/_db/elasticsearch/")) {
    const { handleElasticsearchRoute } = await import("./handle-elasticsearch");
    return handleElasticsearchRoute(req, url, cwd, sideEffectAllowed);
  }
  const path = url.pathname;
  const start = Date.now();
  const method = req.method;
  const qs = url.search ? url.search.slice(0, 120) : "";
  const log = (status: number) => {
    const ms = Date.now() - start;
    console.log(`[code-viewer] ${method} ${path}${qs} ${status} ${ms}ms`);
  };
  const wrapResponse = (res: Response): Response => {
    log(res.status);
    return res;
  };
  return dispatchRoutes(
    req,
    url,
    {
      "/_db/files": {
        methods: ["GET"],
        handler: () => handleFiles(cwd, omitDirNames),
      },
      "/_db/schema": {
        methods: ["GET"],
        handler: () => handleSchema(cwd, url),
      },
      "/_db/table": {
        methods: ["GET"],
        handler: () => handleTable(cwd, url),
      },
      "/_db/columns": {
        methods: ["GET"],
        handler: () => handleColumns(cwd, url),
      },
      "/_db/export": {
        methods: ["GET"],
        handler: () => handleExport(cwd, url),
      },
      "/_db/ddl": {
        methods: ["GET"],
        handler: () => handleDdl(cwd, url),
      },
      "/_db/query": {
        methods: ["POST"],
        sideEffect: true,
        handler: () => handleQuery(cwd, req, sendSse),
      },
      "/_db/close": {
        methods: ["POST"],
        sideEffect: true,
        handler: () => handleClose(cwd, req),
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
        handler: () => handleSearchStart(cwd, req),
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
        handler: () => handleSnapshotCreate(cwd, req, sendSse),
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
    },
    sideEffectAllowed,
    wrapResponse,
  );
}
