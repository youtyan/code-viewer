import type {
  DbFilesResponse,
  DbOrder,
  DbQueryResponse,
  DbSchemaResponse,
  DbTableDataResponse,
} from "../../core/database/types";
import { sqliteAdapterFactory } from "./adapters/sqlite";
import {
  closeConnection,
  getConnection,
  setAdapterFactory,
} from "./connection-pool";
import {
  discoverDockerDatabases,
  discoverSqliteFiles,
  validateDbPath,
} from "./discovery";

let initialized = false;

function ensureInit() {
  if (initialized) return;
  setAdapterFactory(sqliteAdapterFactory);
  initialized = true;
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

type ResolvedDb = { resolved: string; dbId: string };

function resolveDb(cwd: string, dbParam: string | null): ResolvedDb | Response {
  if (!dbParam) return textError("missing db parameter", 400);
  const resolved = validateDbPath(cwd, dbParam);
  if (!resolved) return textError("invalid database path", 400);
  return { resolved, dbId: dbParam };
}

function handleFiles(cwd: string, omitDirNames: string[]): Response {
  const sqliteFiles = discoverSqliteFiles(cwd, omitDirNames);
  const dockerDbs = discoverDockerDatabases(cwd);
  const body: DbFilesResponse = {
    files: [
      ...sqliteFiles.map((f) => ({
        id: f.path,
        path: f.path,
        name: f.name,
        sizeBytes: f.sizeBytes,
        kind: "sqlite" as const,
      })),
      ...dockerDbs,
    ],
  };
  return json(body);
}

async function handleSchema(cwd: string, url: URL): Promise<Response> {
  const r = resolveDb(cwd, url.searchParams.get("db"));
  if (r instanceof Response) return r;
  try {
    const adapter = await getConnection(r.resolved);
    const tables = adapter.getTables();
    const tablesWithCount = tables.map((t) => ({
      ...t,
      rowCount: t.type === "table" ? adapter.getTableRowCount(t.name) : null,
    }));
    const indexes = adapter.getIndexes();
    const foreignKeys = adapter.getForeignKeys();
    const body: DbSchemaResponse = {
      dbId: r.dbId,
      tables: tablesWithCount,
      indexes,
      foreignKeys,
    };
    return json(body);
  } catch (err) {
    return textError(
      `failed to read schema: ${err instanceof Error ? err.message : String(err)}`,
      500,
    );
  }
}

function sanitizeIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
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
    const adapter = await getConnection(r.resolved);
    const columns = adapter.getColumns(table);
    const colNames = new Set(columns.map((c) => c.name));

    if (filters.length > 0) {
      const validFilters = filters.filter((f) => colNames.has(f.column));
      if (validFilters.length > 0) {
        const whereParts: string[] = [];
        const params: string[] = [];
        const grouped = new Map<string, string[]>();
        for (const f of validFilters) {
          const existing = grouped.get(f.value) || [];
          existing.push(f.column);
          grouped.set(f.value, existing);
        }
        for (const [value, cols] of grouped) {
          if (cols.length === 1) {
            whereParts.push(
              `CAST(${sanitizeIdentifier(cols[0])} AS TEXT) LIKE ?`,
            );
            params.push(`%${value}%`);
          } else {
            const orParts = cols.map(
              (c) => `CAST(${sanitizeIdentifier(c)} AS TEXT) LIKE ?`,
            );
            whereParts.push(`(${orParts.join(" OR ")})`);
            for (let i = 0; i < cols.length; i++) params.push(`%${value}%`);
          }
        }
        const where = whereParts.join(" AND ");
        const order = orderBy
          ? ` ORDER BY ${sanitizeIdentifier(orderBy[0].column)} ${orderBy[0].direction === "desc" ? "DESC" : "ASC"}`
          : "";
        const countSql = `SELECT COUNT(*) AS cnt FROM ${sanitizeIdentifier(table)} WHERE ${where}`;
        const dataSql = `SELECT * FROM ${sanitizeIdentifier(table)} WHERE ${where}${order} LIMIT ? OFFSET ?`;
        const countResult = adapter.executeReadonlyQuery(countSql, params);
        const totalRows =
          countResult.rows.length > 0 ? Number(countResult.rows[0][0]) || 0 : 0;
        const dataResult = adapter.executeReadonlyQuery(dataSql, [
          ...params,
          limit,
          offset,
        ]);
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
    const totalRows = adapter.getTableRowCount(table);
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
    return textError(
      `failed to read table: ${err instanceof Error ? err.message : String(err)}`,
      500,
    );
  }
}

async function handleQuery(cwd: string, req: Request): Promise<Response> {
  if (req.method !== "POST") return textError("method not allowed", 405);
  let body: { db?: string; sql?: string; maxRows?: number };
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
    const adapter = await getConnection(r.resolved);
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
    return json(response);
  } catch (err) {
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
    const adapter = await getConnection(r.resolved);
    const columns = adapter.getColumns(table);
    const colNames = columns.map((c) => c.name);
    const colNameSet = new Set(colNames);
    let rows: import("../../core/database/types").DbValue[][];

    if (filters.length > 0) {
      const validFilters = filters.filter((f) => colNameSet.has(f.column));
      if (validFilters.length > 0) {
        const whereParts: string[] = [];
        const params: string[] = [];
        const grouped = new Map<string, string[]>();
        for (const f of validFilters) {
          const existing = grouped.get(f.value) || [];
          existing.push(f.column);
          grouped.set(f.value, existing);
        }
        for (const [value, cols] of grouped) {
          if (cols.length === 1) {
            whereParts.push(
              `CAST(${sanitizeIdentifier(cols[0])} AS TEXT) LIKE ?`,
            );
            params.push(`%${value}%`);
          } else {
            const orParts = cols.map(
              (c) => `CAST(${sanitizeIdentifier(c)} AS TEXT) LIKE ?`,
            );
            whereParts.push(`(${orParts.join(" OR ")})`);
            for (let i = 0; i < cols.length; i++) params.push(`%${value}%`);
          }
        }
        const where = whereParts.join(" AND ");
        const order = orderBy
          ? ` ORDER BY ${sanitizeIdentifier(orderBy[0].column)} ${orderBy[0].direction === "desc" ? "DESC" : "ASC"}`
          : "";
        const dataSql = `SELECT * FROM ${sanitizeIdentifier(table)} WHERE ${where}${order} LIMIT ? OFFSET ?`;
        const result = adapter.executeReadonlyQuery(dataSql, [
          ...params,
          EXPORT_MAX_ROWS,
          0,
        ]);
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
    return textError(
      `failed to export table: ${err instanceof Error ? err.message : String(err)}`,
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
  closeConnection(r.resolved);
  return json({ ok: true });
}

export async function handleDatabaseRoute(
  req: Request,
  url: URL,
  cwd: string,
  omitDirNames: string[],
  sideEffectAllowed: (req: Request) => boolean,
): Promise<Response | null> {
  ensureInit();
  const path = url.pathname;
  if (path === "/_db/files") return handleFiles(cwd, omitDirNames);
  if (path === "/_db/schema") return handleSchema(cwd, url);
  if (path === "/_db/table") return handleTable(cwd, url);
  if (path === "/_db/export") return handleExport(cwd, url);
  if (path === "/_db/query") {
    if (!sideEffectAllowed(req)) return textError("forbidden", 403);
    return handleQuery(cwd, req);
  }
  if (path === "/_db/close") {
    if (!sideEffectAllowed(req)) return textError("forbidden", 403);
    return handleClose(cwd, req);
  }
  return null;
}
