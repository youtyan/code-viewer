import { join } from "node:path";
import type {
  AnnotationDatabaseDataState,
  AnnotationDatabaseQueryState,
  AnnotationDatabaseSearchState,
  AnnotationDatabaseSnapshotState,
  AnnotationDatabaseTab,
  AnnotationEntry,
  AnnotationLineRange,
  AnnotationSession,
  AnnotationsState,
  AnnotationTarget,
} from "../core/types";
import { createJsonFileStore } from "./json-store";

export const CODE_VIEWER_DIR = ".code-viewer";
export const ANNOTATIONS_FILE_NAME = "annotations.json";
export const ANNOTATION_BODY_MAX_BYTES = 64 * 1024;
export const ANNOTATION_TITLE_MAX_CHARS = 300;
const MAX_ANNOTATIONS_JSON_BYTES = 5_000_000;

// ai-dup-check: allow -- exported test helper for this concrete JSON store.
export function annotationsFilePath(root: string): string {
  return join(root, CODE_VIEWER_DIR, ANNOTATIONS_FILE_NAME);
}

export function emptyAnnotationsState(): AnnotationsState {
  return { version: 1, sessions: [] };
}

// ai-dup-check: allow -- annotation ids keep their historical prefix/time format.
export function makeAnnotationId(prefix: string): string {
  const random = Math.random().toString(36).slice(2, 8);
  const time = Date.now().toString(36);
  return `${prefix}-${time}${random}`;
}

function normalizeLineRange(raw: unknown): AnnotationLineRange | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const start = (raw as { start?: unknown }).start;
  const end = (raw as { end?: unknown }).end;
  if (!Number.isInteger(start) || (start as number) < 1) return undefined;
  const endValue =
    Number.isInteger(end) && (end as number) >= (start as number)
      ? (end as number)
      : (start as number);
  return { start: start as number, end: endValue };
}

export function parseAnnotationLine(
  raw: string,
): AnnotationLineRange | undefined {
  const range = /^(\d+)-(\d+)$/.exec(raw);
  if (range) {
    const a = Number(range[1]);
    const b = Number(range[2]);
    const start = Math.min(a, b);
    const end = Math.max(a, b);
    return start > 0 ? { start, end } : undefined;
  }
  const line = Number(raw);
  return Number.isInteger(line) && line > 0
    ? { start: line, end: line }
    : undefined;
}

function normalizeRange(raw: unknown): { from: string; to: string } {
  const from =
    raw &&
    typeof raw === "object" &&
    typeof (raw as { from?: unknown }).from === "string"
      ? (raw as { from: string }).from || "HEAD"
      : "HEAD";
  const to =
    raw &&
    typeof raw === "object" &&
    typeof (raw as { to?: unknown }).to === "string"
      ? (raw as { to: string }).to || "worktree"
      : "worktree";
  return { from, to };
}

function normalizeDatabaseTab(raw: unknown): AnnotationDatabaseTab | undefined {
  return raw === "data" ||
    raw === "query" ||
    raw === "schema" ||
    raw === "er" ||
    raw === "search" ||
    raw === "snapshot"
    ? raw
    : undefined;
}

function normalizeDatabaseDataState(
  raw: unknown,
): AnnotationDatabaseDataState | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as Record<string, unknown>;
  const state: AnnotationDatabaseDataState = {};
  if (typeof value.search === "string" && value.search)
    state.search = value.search;
  if (Array.isArray(value.filters)) {
    const filters = value.filters
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const filter = item as Record<string, unknown>;
        return typeof filter.column === "string" &&
          filter.column &&
          typeof filter.value === "string" &&
          filter.value
          ? { column: filter.column, value: filter.value }
          : null;
      })
      .filter((item): item is { column: string; value: string } => !!item);
    if (filters.length) state.filters = filters;
  }
  if (value.sort && typeof value.sort === "object") {
    const sort = value.sort as Record<string, unknown>;
    if (
      typeof sort.column === "string" &&
      sort.column &&
      (sort.direction === "asc" || sort.direction === "desc")
    ) {
      state.sort = { column: sort.column, direction: sort.direction };
    }
  }
  if (Number.isInteger(value.row) && (value.row as number) > 0)
    state.row = value.row as number;
  return Object.keys(state).length ? state : undefined;
}

function normalizeDatabaseQueryState(
  raw: unknown,
): AnnotationDatabaseQueryState | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as Record<string, unknown>;
  const state: AnnotationDatabaseQueryState = {};
  if (typeof value.sql === "string" && value.sql) state.sql = value.sql;
  if (value.mode === "run" || value.mode === "explain") state.mode = value.mode;
  if (typeof value.autoRun === "boolean") state.autoRun = value.autoRun;
  return Object.keys(state).length ? state : undefined;
}

function normalizeDatabaseSearchState(
  raw: unknown,
): AnnotationDatabaseSearchState | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as Record<string, unknown>;
  const state: AnnotationDatabaseSearchState = {};
  if (typeof value.term === "string" && value.term) state.term = value.term;
  if (typeof value.includeNonText === "boolean")
    state.includeNonText = value.includeNonText;
  if (typeof value.autoRun === "boolean") state.autoRun = value.autoRun;
  return Object.keys(state).length ? state : undefined;
}

function normalizeDatabaseSnapshotState(
  raw: unknown,
): AnnotationDatabaseSnapshotState | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as Record<string, unknown>;
  const state: AnnotationDatabaseSnapshotState = {};
  if (typeof value.fromSnapshotId === "string" && value.fromSnapshotId)
    state.fromSnapshotId = value.fromSnapshotId;
  if (typeof value.toSnapshotId === "string" && value.toSnapshotId)
    state.toSnapshotId = value.toSnapshotId;
  if (typeof value.table === "string" && value.table) state.table = value.table;
  return Object.keys(state).length ? state : undefined;
}

export function normalizeAnnotationTarget(
  raw: unknown,
): AnnotationTarget | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const target = raw as Record<string, unknown>;
  if (target.kind === "database") {
    const db =
      typeof target.db === "string" && target.db ? target.db : undefined;
    const table =
      typeof target.table === "string" && target.table
        ? target.table
        : undefined;
    const tab = normalizeDatabaseTab(target.tab);
    const data = normalizeDatabaseDataState(target.data);
    const query = normalizeDatabaseQueryState(target.query);
    const search = normalizeDatabaseSearchState(target.search);
    const snapshot = normalizeDatabaseSnapshotState(target.snapshot);
    return {
      kind: "database",
      ...(db ? { db } : {}),
      ...(table ? { table } : {}),
      ...(tab ? { tab } : {}),
      ...(data ? { data } : {}),
      ...(query ? { query } : {}),
      ...(search ? { search } : {}),
      ...(snapshot ? { snapshot } : {}),
    };
  }
  if (target.kind === "code") {
    const path =
      typeof target.path === "string"
        ? target.path.replace(/^\/+|\/+$/g, "")
        : "";
    if (!path) return undefined;
    const line = normalizeLineRange(target.line);
    return {
      kind: "code",
      path,
      range: normalizeRange(target.range),
      ...(line ? { line } : {}),
    };
  }
  return undefined;
}

function databaseTargetPath(
  target: Extract<AnnotationTarget, { kind: "database" }>,
): string {
  const labelPart = (value: string, max = 48): string =>
    value
      .replace(/[^A-Za-z0-9._=-]+/g, "_")
      .slice(0, max)
      .replace(/^_+|_+$/g, "");
  const parts = ["database"];
  if (target.db) parts.push(labelPart(target.db));
  if (target.table) parts.push(labelPart(target.table));
  if (target.tab) parts.push(target.tab);
  if (target.data?.search)
    parts.push(`search=${labelPart(target.data.search, 32)}`);
  if (target.query?.sql) parts.push("query");
  if (target.search?.term)
    parts.push(`global-search=${labelPart(target.search.term, 32)}`);
  if (target.snapshot?.fromSnapshotId || target.snapshot?.toSnapshotId)
    parts.push("snapshot-diff");
  return parts.join(":");
}

function normalizeEntry(raw: unknown): AnnotationEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const entry = raw as Record<string, unknown>;
  if (typeof entry.id !== "string" || !entry.id) return null;
  if (typeof entry.body !== "string" || !entry.body) return null;
  const target = normalizeAnnotationTarget(entry.target);
  const path =
    typeof entry.path === "string" && entry.path
      ? entry.path
      : target?.kind === "database"
        ? databaseTargetPath(target)
        : "";
  if (!path) return null;
  const normalized: AnnotationEntry = {
    id: entry.id,
    created_at: typeof entry.created_at === "string" ? entry.created_at : "",
    path,
    range: normalizeRange(entry.range),
    body: entry.body,
  };
  const line = normalizeLineRange(entry.line);
  if (line) normalized.line = line;
  if (target) normalized.target = target;
  if (typeof entry.title === "string" && entry.title)
    normalized.title = entry.title;
  return normalized;
}

function normalizeSession(raw: unknown): AnnotationSession | null {
  if (!raw || typeof raw !== "object") return null;
  const session = raw as Record<string, unknown>;
  if (typeof session.id !== "string" || !session.id) return null;
  const entries = Array.isArray(session.entries)
    ? session.entries
        .map(normalizeEntry)
        .filter((entry): entry is AnnotationEntry => entry !== null)
    : [];
  return {
    id: session.id,
    title:
      typeof session.title === "string" && session.title
        ? session.title
        : "Untitled session",
    created_at:
      typeof session.created_at === "string" ? session.created_at : "",
    entries,
  };
}

export function normalizeAnnotationsState(raw: unknown): AnnotationsState {
  if (!raw || typeof raw !== "object") return emptyAnnotationsState();
  const sessions = (raw as { sessions?: unknown }).sessions;
  if (!Array.isArray(sessions)) return emptyAnnotationsState();
  return {
    version: 1,
    sessions: sessions
      .map(normalizeSession)
      .filter((session): session is AnnotationSession => session !== null),
  };
}

const annotationsStore = createJsonFileStore<AnnotationsState>({
  filePath: annotationsFilePath,
  empty: emptyAnnotationsState,
  sanitize: normalizeAnnotationsState,
  maxBytes: MAX_ANNOTATIONS_JSON_BYTES,
  backupSuffix: "corrupt",
  sizeErrorMessage: "annotations state too large",
});

export async function loadAnnotationsState(
  root: string,
): Promise<AnnotationsState> {
  return annotationsStore.load(root);
}

export async function saveAnnotationsState(
  root: string,
  state: AnnotationsState,
): Promise<void> {
  return annotationsStore.save(root, state);
}

export function startAnnotationSession(
  state: AnnotationsState,
  title: string,
  now: string,
  id = makeAnnotationId("s"),
): { state: AnnotationsState; session: AnnotationSession } {
  const session: AnnotationSession = {
    id,
    title:
      title.trim().slice(0, ANNOTATION_TITLE_MAX_CHARS) || "Untitled session",
    created_at: now,
    entries: [],
  };
  return {
    state: { version: 1, sessions: [...state.sessions, session] },
    session,
  };
}

export type NewAnnotationEntryInput = {
  session_id?: string;
  session_title?: string;
  path?: string;
  line?: AnnotationLineRange;
  range?: { from?: string; to?: string };
  target?: AnnotationTarget;
  title?: string;
  body: string;
  before_id?: string;
  after_id?: string;
  position?: number;
};

export type AddAnnotationResult =
  | {
      ok: true;
      state: AnnotationsState;
      session: AnnotationSession;
      entry: AnnotationEntry;
      created_session: boolean;
    }
  | { ok: false; error: string };

type InsertOptions = {
  before_id?: string;
  after_id?: string;
  position?: number;
};

function insertOptionCount(input: InsertOptions): number {
  return (
    (input.before_id ? 1 : 0) +
    (input.after_id ? 1 : 0) +
    (input.position !== undefined ? 1 : 0)
  );
}

function entryInsertIndex(
  entries: AnnotationEntry[],
  input: InsertOptions,
): { ok: true; index: number } | { ok: false; error: string } {
  if (insertOptionCount(input) > 1)
    return { ok: false, error: "use only one of before, after, or position" };
  if (input.before_id) {
    const index = entries.findIndex((entry) => entry.id === input.before_id);
    if (index < 0) return { ok: false, error: "anchor annotation not found" };
    return { ok: true, index };
  }
  if (input.after_id) {
    const index = entries.findIndex((entry) => entry.id === input.after_id);
    if (index < 0) return { ok: false, error: "anchor annotation not found" };
    return { ok: true, index: index + 1 };
  }
  if (input.position !== undefined) {
    if (!Number.isInteger(input.position) || input.position < 1)
      return { ok: false, error: "position must be a positive integer" };
    if (input.position > entries.length + 1)
      return { ok: false, error: "position is out of range" };
    return { ok: true, index: input.position - 1 };
  }
  return { ok: true, index: entries.length };
}

function findSessionByEntryId(
  sessions: AnnotationSession[],
  entryId: string,
): AnnotationSession | undefined {
  return sessions.find((session) =>
    session.entries.some((entry) => entry.id === entryId),
  );
}

export function addAnnotationEntry(
  state: AnnotationsState,
  input: NewAnnotationEntryInput,
  now: string,
  makeId: (prefix: string) => string = makeAnnotationId,
): AddAnnotationResult {
  const target = normalizeAnnotationTarget(input.target);
  if (target?.kind === "database" && !target.db)
    return { ok: false, error: "database annotation requires db" };
  if (target?.kind === "database" && target.data && !target.table) {
    return {
      ok: false,
      error: "database data annotations require table",
    };
  }
  const path =
    target?.kind === "database"
      ? databaseTargetPath(target)
      : (input.path || "").replace(/^\/+|\/+$/g, "");
  if (!path) return { ok: false, error: "path is required" };
  const body = input.body;
  if (!body.trim()) return { ok: false, error: "body is required" };
  if (Buffer.byteLength(body, "utf8") > ANNOTATION_BODY_MAX_BYTES)
    return { ok: false, error: "body is too large" };
  const line = input.line ? normalizeLineRange(input.line) : undefined;
  if (input.line && !line) return { ok: false, error: "invalid line" };

  let sessions = state.sessions;
  let session: AnnotationSession | undefined;
  let createdSession = false;
  const anchorId = input.before_id || input.after_id;
  const anchorSession = anchorId
    ? findSessionByEntryId(sessions, anchorId)
    : undefined;
  if (anchorId && !anchorSession)
    return { ok: false, error: "anchor annotation not found" };
  if (input.session_id) {
    session = sessions.find((s) => s.id === input.session_id);
    if (!session) return { ok: false, error: "session not found" };
    if (anchorSession && anchorSession.id !== session.id)
      return {
        ok: false,
        error: "anchor annotation belongs to another session",
      };
  } else if (anchorSession) {
    session = anchorSession;
  } else {
    session = sessions[sessions.length - 1];
  }
  if (!session) {
    const started = startAnnotationSession(
      state,
      input.session_title || "",
      now,
      makeId("s"),
    );
    sessions = started.state.sessions;
    session = started.session;
    createdSession = true;
  }

  const entry: AnnotationEntry = {
    id: makeId("a"),
    created_at: now,
    path,
    range: normalizeRange(input.range),
    body,
  };
  if (line) entry.line = line;
  if (target) entry.target = target;
  const title = (input.title || "").trim();
  if (title) entry.title = title.slice(0, ANNOTATION_TITLE_MAX_CHARS);

  const insertAt = entryInsertIndex(session.entries, input);
  if (insertAt.ok === false) return { ok: false, error: insertAt.error };
  const entries = [...session.entries];
  entries.splice(insertAt.index, 0, entry);

  const updatedSession: AnnotationSession = {
    ...session,
    entries,
  };
  return {
    ok: true,
    state: {
      version: 1,
      sessions: sessions.map((s) =>
        s.id === updatedSession.id ? updatedSession : s,
      ),
    },
    session: updatedSession,
    entry,
    created_session: createdSession,
  };
}

export type MoveAnnotationResult =
  | {
      ok: true;
      state: AnnotationsState;
      session: AnnotationSession;
      entry: AnnotationEntry;
    }
  | { ok: false; error: string };

export function moveAnnotationEntry(
  state: AnnotationsState,
  id: string,
  input: InsertOptions,
): MoveAnnotationResult {
  if (insertOptionCount(input) !== 1)
    return { ok: false, error: "move requires before, after, or position" };
  const sourceSession = findSessionByEntryId(state.sessions, id);
  const entry = sourceSession?.entries.find((e) => e.id === id);
  if (!sourceSession || !entry)
    return { ok: false, error: "annotation not found" };
  if (input.before_id === id || input.after_id === id)
    return { ok: false, error: "cannot move annotation relative to itself" };

  const anchorId = input.before_id || input.after_id;
  const destinationSession = anchorId
    ? findSessionByEntryId(state.sessions, anchorId)
    : sourceSession;
  if (!destinationSession)
    return { ok: false, error: "anchor annotation not found" };
  if (destinationSession.id !== sourceSession.id)
    return { ok: false, error: "anchor annotation belongs to another session" };

  const sessionsWithoutEntry = state.sessions.map((session) =>
    session.id === sourceSession.id
      ? { ...session, entries: session.entries.filter((e) => e.id !== id) }
      : session,
  );
  const targetSession = sessionsWithoutEntry.find(
    (session) => session.id === destinationSession.id,
  );
  if (!targetSession)
    return { ok: false, error: "destination session not found" };
  const insertAt = entryInsertIndex(targetSession.entries, input);
  if (insertAt.ok === false) return { ok: false, error: insertAt.error };
  const movedEntries = [...targetSession.entries];
  movedEntries.splice(insertAt.index, 0, entry);
  const updatedSession = { ...targetSession, entries: movedEntries };
  return {
    ok: true,
    state: {
      version: 1,
      sessions: sessionsWithoutEntry.map((session) =>
        session.id === updatedSession.id ? updatedSession : session,
      ),
    },
    session: updatedSession,
    entry,
  };
}

export function renameAnnotationSession(
  state: AnnotationsState,
  id: string,
  title: string,
): { state: AnnotationsState; renamed: boolean } {
  const session = state.sessions.find((s) => s.id === id);
  if (!session) return { state, renamed: false };
  const next =
    title.trim().slice(0, ANNOTATION_TITLE_MAX_CHARS) || "Untitled session";
  return {
    state: {
      version: 1,
      sessions: state.sessions.map((s) =>
        s.id === id ? { ...s, title: next } : s,
      ),
    },
    renamed: true,
  };
}

export type UpdateAnnotationResult =
  | { ok: true; state: AnnotationsState; entry: AnnotationEntry }
  | { ok: false; error: string };

export function updateAnnotationEntry(
  state: AnnotationsState,
  id: string,
  patch: { title?: string; body?: string },
): UpdateAnnotationResult {
  const session = state.sessions.find((s) =>
    s.entries.some((e) => e.id === id),
  );
  if (!session) return { ok: false, error: "annotation not found" };
  if (patch.body !== undefined) {
    if (!patch.body.trim()) return { ok: false, error: "body is required" };
    if (Buffer.byteLength(patch.body, "utf8") > ANNOTATION_BODY_MAX_BYTES)
      return { ok: false, error: "body is too large" };
  }
  let updated: AnnotationEntry | null = null;
  const sessions = state.sessions.map((s) =>
    s.id === session.id
      ? {
          ...s,
          entries: s.entries.map((e) => {
            if (e.id !== id) return e;
            updated = {
              ...e,
              ...(patch.title !== undefined
                ? { title: patch.title.trim() || undefined }
                : {}),
              ...(patch.body !== undefined ? { body: patch.body } : {}),
            };
            return updated;
          }),
        }
      : s,
  );
  if (!updated) return { ok: false, error: "annotation not found" };
  return { ok: true, state: { version: 1, sessions }, entry: updated };
}

export function deleteAnnotationById(
  state: AnnotationsState,
  id: string,
): { state: AnnotationsState; removed: "entry" | "session" | null } {
  for (const session of state.sessions) {
    if (session.id === id) {
      return {
        state: {
          version: 1,
          sessions: state.sessions.filter((s) => s.id !== id),
        },
        removed: "session",
      };
    }
    if (session.entries.some((entry) => entry.id === id)) {
      return {
        state: {
          version: 1,
          sessions: state.sessions.map((s) =>
            s.id === session.id
              ? { ...s, entries: s.entries.filter((e) => e.id !== id) }
              : s,
          ),
        },
        removed: "entry",
      };
    }
  }
  return { state, removed: null };
}
