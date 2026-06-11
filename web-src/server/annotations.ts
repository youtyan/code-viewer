import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type {
  AnnotationEntry,
  AnnotationLineRange,
  AnnotationSession,
  AnnotationsState,
} from "../types";

export const CODE_VIEWER_DIR = ".code-viewer";
export const ANNOTATIONS_FILE_NAME = "annotations.json";
export const ANNOTATION_BODY_MAX_BYTES = 64 * 1024;
export const ANNOTATION_TITLE_MAX_CHARS = 300;

export function annotationsFilePath(root: string): string {
  return join(root, CODE_VIEWER_DIR, ANNOTATIONS_FILE_NAME);
}

export function emptyAnnotationsState(): AnnotationsState {
  return { version: 1, sessions: [] };
}

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

function normalizeEntry(raw: unknown): AnnotationEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const entry = raw as Record<string, unknown>;
  if (typeof entry.id !== "string" || !entry.id) return null;
  if (typeof entry.path !== "string" || !entry.path) return null;
  if (typeof entry.body !== "string" || !entry.body) return null;
  const normalized: AnnotationEntry = {
    id: entry.id,
    created_at: typeof entry.created_at === "string" ? entry.created_at : "",
    path: entry.path,
    range: normalizeRange(entry.range),
    body: entry.body,
  };
  const line = normalizeLineRange(entry.line);
  if (line) normalized.line = line;
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

export function loadAnnotationsState(root: string): AnnotationsState {
  const file = annotationsFilePath(root);
  if (!existsSync(file)) return emptyAnnotationsState();
  try {
    return normalizeAnnotationsState(JSON.parse(readFileSync(file, "utf8")));
  } catch {
    return emptyAnnotationsState();
  }
}

export function saveAnnotationsState(
  root: string,
  state: AnnotationsState,
): void {
  const dir = join(root, CODE_VIEWER_DIR);
  mkdirSync(dir, { recursive: true });
  const file = annotationsFilePath(root);
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  renameSync(tmp, file);
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
  path: string;
  line?: AnnotationLineRange;
  range?: { from?: string; to?: string };
  title?: string;
  body: string;
};

export type AddAnnotationResult =
  | {
      ok: true;
      state: AnnotationsState;
      session: AnnotationSession;
      entry: AnnotationEntry;
    }
  | { ok: false; error: string };

export function addAnnotationEntry(
  state: AnnotationsState,
  input: NewAnnotationEntryInput,
  now: string,
  makeId: (prefix: string) => string = makeAnnotationId,
): AddAnnotationResult {
  const path = input.path.replace(/^\/+|\/+$/g, "");
  if (!path) return { ok: false, error: "path is required" };
  const body = input.body;
  if (!body.trim()) return { ok: false, error: "body is required" };
  if (Buffer.byteLength(body, "utf8") > ANNOTATION_BODY_MAX_BYTES)
    return { ok: false, error: "body is too large" };
  const line = input.line ? normalizeLineRange(input.line) : undefined;
  if (input.line && !line) return { ok: false, error: "invalid line" };

  let sessions = state.sessions;
  let session: AnnotationSession | undefined;
  if (input.session_id) {
    session = sessions.find((s) => s.id === input.session_id);
    if (!session) return { ok: false, error: "session not found" };
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
  }

  const entry: AnnotationEntry = {
    id: makeId("a"),
    created_at: now,
    path,
    range: normalizeRange(input.range),
    body,
  };
  if (line) entry.line = line;
  const title = (input.title || "").trim();
  if (title) entry.title = title.slice(0, ANNOTATION_TITLE_MAX_CHARS);

  const updatedSession: AnnotationSession = {
    ...session,
    entries: [...session.entries, entry],
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
  };
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
