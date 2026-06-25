import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type {
  DbValue,
  QueryHistoryEntry,
  QueryHistoryState,
} from "../../core/database/types";

const CODE_VIEWER_DIR = ".code-viewer";
const HISTORY_FILE_NAME = "query-history.json";
const MAX_ENTRIES = 200;
const MAX_PREVIEW_ROWS = 100;
const MAX_JSON_BYTES = 1_000_000;

function historyFilePath(root: string): string {
  return join(root, CODE_VIEWER_DIR, HISTORY_FILE_NAME);
}

function emptyState(): QueryHistoryState {
  return { version: 1, entries: [] };
}

export function loadQueryHistory(cwd: string): QueryHistoryState {
  const file = historyFilePath(cwd);
  if (!existsSync(file)) return emptyState();
  try {
    const raw = readFileSync(file, "utf8");
    const parsed = JSON.parse(raw);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      parsed.version !== 1 ||
      !Array.isArray(parsed.entries)
    ) {
      return emptyState();
    }
    return parsed as QueryHistoryState;
  } catch {
    return emptyState();
  }
}

export function saveQueryHistory(cwd: string, state: QueryHistoryState): void {
  const dir = join(cwd, CODE_VIEWER_DIR);
  mkdirSync(dir, { recursive: true });
  const file = historyFilePath(cwd);
  const tmp = `${file}.tmp-${process.pid}`;
  let content = `${JSON.stringify(state, null, 2)}\n`;
  if (Buffer.byteLength(content, "utf8") > MAX_JSON_BYTES) {
    while (
      state.entries.length > 1 &&
      Buffer.byteLength(content, "utf8") > MAX_JSON_BYTES
    ) {
      state.entries.pop();
      content = `${JSON.stringify(state, null, 2)}\n`;
    }
  }
  writeFileSync(tmp, content, "utf8");
  renameSync(tmp, file);
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
