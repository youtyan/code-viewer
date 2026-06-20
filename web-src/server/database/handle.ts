import { randomBytes } from "node:crypto";
import type {
  DbFilesResponse,
  DbOrder,
  DbQueryResponse,
  DbSchemaResponse,
  DbTableDataResponse,
  QueryHistoryEntry,
} from "../../core/database/types";
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
  validateDbPath,
} from "./discovery";
import {
  addQueryHistoryEntry,
  clearQueryHistory,
  deleteQueryHistoryEntry,
  loadQueryHistory,
  saveQueryHistory,
} from "./query-history";

let initialized = false;

function ensureInit() {
  if (initialized) return;
  setAdapterFactory(sqliteAdapterFactory);
  initialized = true;
}

const dockerAdapterCache = new Map<string, DatabaseAdapter>();

async function getAdapter(
  r: ResolvedDb,
  cwd: string,
): Promise<DatabaseAdapter> {
  if (r.docker) {
    const key = r.dbId;
    const cached = dockerAdapterCache.get(key);
    if (cached) return cached;
    const adapter = openDockerAdapter(
      r.docker.serviceName,
      r.docker.kind as "postgresql" | "mysql",
      r.docker.env,
      cwd,
      r.docker.database,
    );
    dockerAdapterCache.set(key, adapter);
    return adapter;
  }
  return getConnection(r.resolved);
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function textError(message: string, status: number): Response {
  return new Response(message, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

type ResolvedDb = { resolved: string; dbId: string; docker?: DockerDbInfo };

let cachedDockerDbs: DockerDbInfo[] | null = null;
let cachedDockerCwd: string | null = null;

function getDockerDbs(cwd: string): DockerDbInfo[] {
  if (cachedDockerCwd === cwd && cachedDockerDbs) return cachedDockerDbs;
  cachedDockerDbs = discoverDockerDatabases(cwd);
  cachedDockerCwd = cwd;
  return cachedDockerDbs;
}

function resolveDb(cwd: string, dbParam: string | null): ResolvedDb | Response {
  if (!dbParam) return textError("missing db parameter", 400);
  if (dbParam.startsWith("docker:")) {
    const rest = dbParam.slice(7);
    const colonIdx = rest.indexOf(":");
    const serviceName = colonIdx >= 0 ? rest.slice(0, colonIdx) : rest;
    const dbName = colonIdx >= 0 ? rest.slice(colonIdx + 1) : undefined;
    const dockerDbs = getDockerDbs(cwd);
    const info = dockerDbs.find((d) => d.serviceName === serviceName);
    if (!info) return textError("docker service not found", 404);
    const resolved = dbName ? { ...info, database: dbName } : info;
    return { resolved: dbParam, dbId: dbParam, docker: resolved };
  }
  const resolved = validateDbPath(cwd, dbParam);
  if (!resolved) return textError("invalid database path", 400);
  return { resolved, dbId: dbParam };
}

function handleFiles(cwd: string, omitDirNames: string[]): Response {
  const sqliteFiles = discoverSqliteFiles(cwd, omitDirNames);
  const dockerServices = discoverDockerDatabases(cwd);
  const dockerEntries: typeof dockerServices = [];
  for (const svc of dockerServices) {
    const dbs = listDockerDatabases(
      svc.serviceName,
      svc.kind as "postgresql" | "mysql",
      svc.env,
      cwd,
    );
    if (dbs.length <= 1) {
      dockerEntries.push(svc);
    } else {
      for (const db of dbs) {
        dockerEntries.push({
          ...svc,
          id: `docker:${svc.serviceName}:${db}`,
          name: svc.name.replace(/\)$/, ` / ${db})`),
          database: db,
        });
      }
    }
  }
  const body: DbFilesResponse = {
    files: [
      ...sqliteFiles.map((f) => ({
        id: f.path,
        path: f.path,
        name: f.name,
        sizeBytes: f.sizeBytes,
        kind: "sqlite" as const,
      })),
      ...dockerEntries,
    ],
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
    console.error(
      "[code-viewer] database error:",
      err instanceof Error ? err.message : String(err),
    );
    return textError(
      `failed to read schema: ${err instanceof Error ? err.message : String(err)}`,
      500,
    );
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

    if (filters.length > 0) {
      const validFilters = filters.filter((f) => colNames.has(f.column));
      if (validFilters.length > 0) {
        const grouped = new Map<string, string[]>();
        for (const f of validFilters) {
          const existing = grouped.get(f.value) || [];
          existing.push(f.column);
          grouped.set(f.value, existing);
        }
        const k = adapter.kind;
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
          rows: dataResult.rows,
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
      rows: result.rows,
      totalRows,
      offset,
      limit,
      hasMore: offset + result.rowCount < totalRows,
    };
    return json(body);
  } catch (err) {
    console.error(
      "[code-viewer] database error:",
      err instanceof Error ? err.message : String(err),
    );
    return textError(
      `failed to read table: ${err instanceof Error ? err.message : String(err)}`,
      500,
    );
  }
}

function makeHistoryId(): string {
  return `qh-${randomBytes(8).toString("hex")}`;
}

async function handleQuery(
  cwd: string,
  req: Request,
  sendSse?: (event: string, data?: string) => void,
): Promise<Response> {
  if (req.method !== "POST") return textError("method not allowed", 405);
  let body: {
    db?: string;
    sql?: string;
    maxRows?: number;
    saveHistory?: boolean;
    title?: string;
    body?: string;
    executedBy?: "user" | "ai";
    source?: "cli" | "browser";
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return textError("invalid JSON body", 400);
  }
  if (!body.db || !body.sql) return textError("missing db or sql", 400);
  const r = resolveDb(cwd, body.db);
  if (r instanceof Response) return r;
  const maxRows = Math.min(10000, Math.max(1, body.maxRows || 1000));
  const start = Date.now();
  try {
    const adapter = await getAdapter(r, cwd);
    const result = adapter.executeReadonlyQuery(body.sql, undefined, maxRows);
    const elapsed = Date.now() - start;
    const response: DbQueryResponse = {
      dbId: body.db,
      columns: result.columns,
      columnTypes: result.columnTypes,
      rows: result.rows,
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
        columns: result.columns,
        rowsPreview: result.rows,
        rowCount: result.rowCount,
        savedRows: result.rows.length,
        truncated: result.rowCount >= maxRows,
        elapsedMs: elapsed,
        executedAt: new Date().toISOString(),
        executedBy: body.executedBy || "user",
        source: body.source || "browser",
      };
      const state = loadQueryHistory(cwd);
      const updated = addQueryHistoryEntry(state, entry);
      saveQueryHistory(cwd, updated);
      sendSse?.("db-query", JSON.stringify({ action: "add", id: entry.id }));
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
  if (req.method !== "POST") return textError("method not allowed", 405);
  let body: { id?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return textError("invalid JSON body", 400);
  }
  if (!body.id) return textError("missing id", 400);
  const state = loadQueryHistory(cwd);
  const updated = deleteQueryHistoryEntry(state, body.id);
  saveQueryHistory(cwd, updated);
  sendSse?.("db-query", JSON.stringify({ action: "delete", id: body.id }));
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
  sendSse?.("db-query", JSON.stringify({ action: "clear" }));
  return json({ ok: true });
}

const EXPORT_MAX_ROWS = 100_000;

function formatCsvField(value: unknown): string {
  if (value === null || value === undefined) return "";
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
    let rows: import("../../core/database/types").DbValue[][];

    if (filters.length > 0) {
      const validFilters = filters.filter((f) => colNameSet.has(f.column));
      if (validFilters.length > 0) {
        const grouped = new Map<string, string[]>();
        for (const f of validFilters) {
          const existing = grouped.get(f.value) || [];
          existing.push(f.column);
          grouped.set(f.value, existing);
        }
        const k = adapter.kind;
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
        rows = result.rows;
      } else {
        const result = adapter.getTablePage(table, {
          offset: 0,
          limit: EXPORT_MAX_ROWS,
          orderBy,
        });
        rows = result.rows;
      }
    } else {
      const result = adapter.getTablePage(table, {
        offset: 0,
        limit: EXPORT_MAX_ROWS,
        orderBy,
      });
      rows = result.rows;
    }

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
          "Content-Disposition": `attachment; filename="${table}.csv"`,
          "Cache-Control": "no-store",
        },
      });
    }

    const objects = rows.map((row) => {
      const obj: Record<string, unknown> = {};
      for (let i = 0; i < colNames.length; i++) {
        const val = row[i];
        obj[colNames[i]] =
          val instanceof Uint8Array ? `<blob ${val.byteLength} bytes>` : val;
      }
      return obj;
    });
    const body = JSON.stringify(objects, null, 2);
    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${table}.json"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error(
      "[code-viewer] database error:",
      err instanceof Error ? err.message : String(err),
    );
    return textError(
      `failed to export table: ${err instanceof Error ? err.message : String(err)}`,
      500,
    );
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
    console.error(
      "[code-viewer] database error:",
      err instanceof Error ? err.message : String(err),
    );
    return textError(
      `failed to get columns: ${err instanceof Error ? err.message : String(err)}`,
      500,
    );
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
    console.error(
      "[code-viewer] database error:",
      err instanceof Error ? err.message : String(err),
    );
    return textError(
      `failed to get DDL: ${err instanceof Error ? err.message : String(err)}`,
      500,
    );
  }
}

async function handleClose(cwd: string, req: Request): Promise<Response> {
  if (req.method !== "POST") return textError("method not allowed", 405);
  let body: { db?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return textError("invalid JSON body", 400);
  }
  if (!body.db) return textError("missing db", 400);
  const r = resolveDb(cwd, body.db);
  if (r instanceof Response) return r;
  if (r.docker) {
    const cached = dockerAdapterCache.get(r.dbId);
    if (cached) {
      cached.close();
      dockerAdapterCache.delete(r.dbId);
    }
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
  const path = url.pathname;
  const start = Date.now();
  const method = req.method;
  const qs = url.search ? url.search.slice(0, 120) : "";
  const log = (status: number) => {
    const ms = Date.now() - start;
    console.log(`[code-viewer] ${method} ${path}${qs} ${status} ${ms}ms`);
  };
  const wrapResponse = async (
    handler: Response | Promise<Response | null>,
  ): Promise<Response | null> => {
    const res = await handler;
    if (res) log(res.status);
    return res;
  };
  if (path === "/_db/files")
    return wrapResponse(handleFiles(cwd, omitDirNames));
  if (path === "/_db/schema") return wrapResponse(handleSchema(cwd, url));
  if (path === "/_db/table") return wrapResponse(handleTable(cwd, url));
  if (path === "/_db/columns") return wrapResponse(handleColumns(cwd, url));
  if (path === "/_db/export") return wrapResponse(handleExport(cwd, url));
  if (path === "/_db/ddl") return wrapResponse(handleDdl(cwd, url));
  if (path === "/_db/query") {
    if (!sideEffectAllowed(req)) {
      log(403);
      return textError("forbidden", 403);
    }
    return wrapResponse(handleQuery(cwd, req, sendSse));
  }
  if (path === "/_db/close") {
    if (!sideEffectAllowed(req)) {
      log(403);
      return textError("forbidden", 403);
    }
    return wrapResponse(handleClose(cwd, req));
  }
  if (path === "/_db/history") return wrapResponse(handleHistory(cwd, url));
  if (path === "/_db/history/delete") {
    if (!sideEffectAllowed(req)) {
      log(403);
      return textError("forbidden", 403);
    }
    return wrapResponse(handleHistoryDelete(cwd, req, sendSse));
  }
  if (path === "/_db/history/clear") {
    if (!sideEffectAllowed(req)) {
      log(403);
      return textError("forbidden", 403);
    }
    return wrapResponse(handleHistoryClear(cwd, req, sendSse));
  }
  return null;
}
