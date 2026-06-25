import { join } from "node:path";
import type {
  DbValue,
  QueryHistoryEntry,
  QueryHistoryState,
} from "../../core/database/types";
import { createJsonFileStore } from "../json-store";

const CODE_VIEWER_DIR = ".code-viewer";
const HISTORY_FILE_NAME = "query-history.json";
const MAX_ENTRIES = 200;
const MAX_PREVIEW_ROWS = 100;
const MAX_JSON_BYTES = 1_000_000;
const MAX_ID_LEN = 128;
const MAX_DB_ID_LEN = 2048;
const MAX_SCHEMA_LEN = 512;
const MAX_SQL_LEN = 64_000;
const MAX_TEXT_LEN = 64_000;
const MAX_COLUMN_LEN = 512;
const MAX_COLUMNS = 500;

function historyFilePath(root: string): string {
  return join(root, CODE_VIEWER_DIR, HISTORY_FILE_NAME);
}

function emptyState(): QueryHistoryState {
  return { version: 1, entries: [] };
}

function serializeHistoryState(state: QueryHistoryState): string {
  const normalized: QueryHistoryState = {
    version: 1,
    entries: Array.isArray(state.entries) ? [...state.entries] : [],
  };
  let content = `${JSON.stringify(normalized, null, 2)}\n`;
  while (
    normalized.entries.length > 1 &&
    Buffer.byteLength(content, "utf8") > MAX_JSON_BYTES
  ) {
    normalized.entries.pop();
    content = `${JSON.stringify(normalized, null, 2)}\n`;
  }
  return content;
}

function optionalString(value: unknown, maxLen: number): string | undefined {
  if (typeof value !== "string") return undefined;
  if (!value || value.length > maxLen || value.includes("\0")) return undefined;
  return value;
}

function finiteNumber(value: unknown, min = 0): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.max(min, Math.round(value));
}

function sanitizeDbValue(value: unknown): DbValue | null {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value as DbValue;
  }
  return null;
}

function sanitizeRows(raw: unknown): DbValue[][] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, MAX_PREVIEW_ROWS).map((row) => {
    if (!Array.isArray(row)) return [];
    return row.map(sanitizeDbValue);
  });
}

function sanitizeEntry(raw: unknown): QueryHistoryEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const entry = raw as Record<string, unknown>;
  const id = optionalString(entry.id, MAX_ID_LEN);
  const dbId = optionalString(entry.dbId, MAX_DB_ID_LEN);
  const sql = optionalString(entry.sql, MAX_SQL_LEN);
  if (!id || !dbId || !sql) return null;
  const columns = Array.isArray(entry.columns)
    ? entry.columns
        .filter((col): col is string => typeof col === "string" && !!col)
        .map((col) => col.slice(0, MAX_COLUMN_LEN))
        .slice(0, MAX_COLUMNS)
    : [];
  const rowsPreview = sanitizeRows(entry.rowsPreview);
  const schema = optionalString(entry.schema, MAX_SCHEMA_LEN);
  const title = optionalString(entry.title, MAX_TEXT_LEN);
  const body = optionalString(entry.body, MAX_TEXT_LEN);
  return {
    id,
    dbId,
    ...(schema ? { schema } : {}),
    sql,
    ...(title ? { title } : {}),
    ...(body ? { body } : {}),
    columns,
    rowsPreview,
    rowCount: finiteNumber(entry.rowCount) ?? rowsPreview.length,
    savedRows: finiteNumber(entry.savedRows) ?? rowsPreview.length,
    truncated: typeof entry.truncated === "boolean" ? entry.truncated : false,
    elapsedMs: finiteNumber(entry.elapsedMs) ?? 0,
    executedAt:
      optionalString(entry.executedAt, 64) ?? new Date(0).toISOString(),
    executedBy: entry.executedBy === "ai" ? "ai" : "user",
    source: entry.source === "cli" ? "cli" : "browser",
  };
}

function sanitizeHistoryState(raw: unknown): QueryHistoryState {
  if (!raw || typeof raw !== "object") return emptyState();
  const entriesRaw = (raw as { entries?: unknown }).entries;
  if (!Array.isArray(entriesRaw)) return emptyState();
  const entries: QueryHistoryEntry[] = [];
  for (const entry of entriesRaw) {
    if (entries.length >= MAX_ENTRIES) break;
    const normalized = sanitizeEntry(entry);
    if (normalized) entries.push(normalized);
  }
  return { version: 1, entries };
}

const historyStore = createJsonFileStore<QueryHistoryState>({
  filePath: historyFilePath,
  empty: emptyState,
  sanitize: sanitizeHistoryState,
  maxBytes: MAX_JSON_BYTES,
  backupSuffix: "corrupt",
  serialize: serializeHistoryState,
});

export async function loadQueryHistoryAsync(
  cwd: string,
): Promise<QueryHistoryState> {
  return historyStore.load(cwd);
}

export async function saveQueryHistoryAsync(
  cwd: string,
  state: QueryHistoryState,
): Promise<void> {
  return historyStore.save(cwd, state);
}

export async function updateQueryHistoryAsync<T>(
  cwd: string,
  updater: (
    state: QueryHistoryState,
  ) =>
    | { state: QueryHistoryState; result: T }
    | Promise<{ state: QueryHistoryState; result: T }>,
): Promise<T> {
  return historyStore.update(cwd, updater);
}

function clampPreviewRows(rows: DbValue[][]): DbValue[][] {
  return rows.slice(0, MAX_PREVIEW_ROWS);
}

export function addQueryHistoryEntry(
  state: QueryHistoryState,
  entry: QueryHistoryEntry,
): QueryHistoryState {
  const clamped: QueryHistoryEntry = {
    ...entry,
    rowsPreview: clampPreviewRows(entry.rowsPreview),
    savedRows: Math.min(entry.rowsPreview.length, MAX_PREVIEW_ROWS),
  };
  const entries = [clamped, ...state.entries];
  if (entries.length > MAX_ENTRIES) entries.length = MAX_ENTRIES;
  return { version: 1, entries };
}

export function deleteQueryHistoryEntry(
  state: QueryHistoryState,
  id: string,
): QueryHistoryState {
  return {
    version: 1,
    entries: state.entries.filter((e) => e.id !== id),
  };
}

export function clearQueryHistory(
  state: QueryHistoryState,
  dbId?: string,
  schema?: string,
): QueryHistoryState {
  if (!dbId) return emptyState();
  return {
    version: 1,
    entries: state.entries.filter((e) => {
      if (e.dbId !== dbId) return true;
      if (schema === undefined) return false;
      return (e.schema || "public") !== schema;
    }),
  };
}
