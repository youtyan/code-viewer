import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
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
const historyWriteQueues = new Map<string, Promise<void>>();

function historyFilePath(root: string): string {
  return join(root, CODE_VIEWER_DIR, HISTORY_FILE_NAME);
}

function isEnoent(err: unknown): boolean {
  return (err as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
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

async function backupCorruptHistoryFileAsync(file: string): Promise<void> {
  try {
    await rename(file, `${file}.corrupt-${Date.now()}`);
  } catch {
    // best effort only
  }
}

export async function loadQueryHistoryAsync(
  cwd: string,
): Promise<QueryHistoryState> {
  const pendingWrite = historyWriteQueues.get(cwd);
  if (pendingWrite) {
    await pendingWrite.catch(() => {});
  }
  return loadQueryHistoryAsyncUnqueued(cwd);
}

async function loadQueryHistoryAsyncUnqueued(
  cwd: string,
): Promise<QueryHistoryState> {
  const file = historyFilePath(cwd);
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch (err) {
    if (isEnoent(err)) return emptyState();
    await backupCorruptHistoryFileAsync(file);
    return emptyState();
  }
  try {
    const parsed = JSON.parse(raw);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      parsed.version !== 1 ||
      !Array.isArray(parsed.entries)
    ) {
      await backupCorruptHistoryFileAsync(file);
      return emptyState();
    }
    return parsed as QueryHistoryState;
  } catch (err) {
    if (isEnoent(err)) return emptyState();
    await backupCorruptHistoryFileAsync(file);
    return emptyState();
  }
}

export async function saveQueryHistoryAsync(
  cwd: string,
  state: QueryHistoryState,
): Promise<void> {
  const dir = join(cwd, CODE_VIEWER_DIR);
  await mkdir(dir, { recursive: true });
  const file = historyFilePath(cwd);
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}`;
  const content = serializeHistoryState(state);
  await writeFile(tmp, content, "utf8");
  await rename(tmp, file);
}

export async function updateQueryHistoryAsync<T>(
  cwd: string,
  updater: (
    state: QueryHistoryState,
  ) =>
    | { state: QueryHistoryState; result: T }
    | Promise<{ state: QueryHistoryState; result: T }>,
): Promise<T> {
  const previous = historyWriteQueues.get(cwd) ?? Promise.resolve();
  const run = previous
    .catch(() => {})
    .then(async () => {
      const current = await loadQueryHistoryAsyncUnqueued(cwd);
      const updated = await updater(current);
      await saveQueryHistoryAsync(cwd, updated.state);
      return updated.result;
    });
  const queued = run.then(
    () => {},
    () => {},
  );
  historyWriteQueues.set(cwd, queued);
  try {
    return await run;
  } finally {
    if (historyWriteQueues.get(cwd) === queued) {
      historyWriteQueues.delete(cwd);
    }
  }
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
