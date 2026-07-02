import { join } from "node:path";
import type {
  DailyJournalEntry,
  DailyJournalState,
  JournalEntrySource,
  JournalTask,
  JournalTaskNote,
  JournalTaskPriority,
  JournalTaskState,
  JournalTaskStatus,
} from "../core/journal";
import {
  isIsoDate,
  isJournalTaskPriority,
  isJournalTaskStatus,
  journalIssueLabel,
  journalIssueRepoLabel,
  normalizeJournalLabels,
} from "../core/journal";
import { CODE_VIEWER_DIR } from "./annotations";
import { createJsonFileStore } from "./json-store";

export const DAILY_JOURNAL_FILE_NAME = "daily-journal.json";
export const JOURNAL_TASKS_FILE_NAME = "tasks.json";
export const JOURNAL_ENTRY_BODY_MAX_BYTES = 128 * 1024;
export const JOURNAL_TASK_BODY_MAX_BYTES = 128 * 1024;
export const JOURNAL_TASK_NOTE_MAX_BYTES = 64 * 1024;
export const JOURNAL_TITLE_MAX_CHARS = 200;

const MAX_DAILY_JOURNAL_JSON_BYTES = 8_000_000;
const MAX_JOURNAL_TASKS_JSON_BYTES = 8_000_000;
const MAX_ENTRIES = 2000;
const MAX_TASKS = 2000;
const MAX_NOTES_PER_TASK = 100;

export function dailyJournalFilePath(root: string): string {
  return join(root, CODE_VIEWER_DIR, DAILY_JOURNAL_FILE_NAME);
}

export function journalTasksFilePath(root: string): string {
  return join(root, CODE_VIEWER_DIR, JOURNAL_TASKS_FILE_NAME);
}

export function emptyDailyJournalState(): DailyJournalState {
  return { version: 1, entries: [] };
}

export function emptyJournalTaskState(): JournalTaskState {
  return { version: 1, tasks: [] };
}

export function makeJournalId(prefix: string): string {
  const random = Math.random().toString(36).slice(2, 8);
  const time = Date.now().toString(36);
  return `${prefix}-${time}${random}`;
}

function optionalString(value: unknown, maxLen: number): string | undefined {
  if (typeof value !== "string") return undefined;
  if (value.includes("\0")) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, maxLen);
}

function optionalBody(value: unknown, maxBytes: number): string | undefined {
  if (typeof value !== "string") return undefined;
  if (value.includes("\0")) return undefined;
  if (Buffer.byteLength(value, "utf8") > maxBytes) return undefined;
  return value;
}

function normalizeSource(value: unknown): JournalEntrySource {
  return value === "ai" || value === "imported" ? value : "user";
}

function normalizeJournalEntry(raw: unknown): DailyJournalEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const entry = raw as Record<string, unknown>;
  const id = optionalString(entry.id, 128);
  const date = isIsoDate(entry.date) ? entry.date : undefined;
  const body = optionalBody(entry.body, JOURNAL_ENTRY_BODY_MAX_BYTES);
  if (!id || !date || body === undefined) return null;
  const title = optionalString(entry.title, JOURNAL_TITLE_MAX_CHARS);
  return {
    id,
    date,
    ...(title ? { title } : {}),
    body,
    labels: normalizeJournalLabels(entry.labels),
    source: normalizeSource(entry.source),
    created_at:
      optionalString(entry.created_at, 64) ?? new Date(0).toISOString(),
    updated_at:
      optionalString(entry.updated_at, 64) ?? new Date(0).toISOString(),
  };
}

export function normalizeDailyJournalState(raw: unknown): DailyJournalState {
  if (!raw || typeof raw !== "object") return emptyDailyJournalState();
  const entriesRaw = (raw as { entries?: unknown }).entries;
  if (!Array.isArray(entriesRaw)) return emptyDailyJournalState();
  const entries: DailyJournalEntry[] = [];
  for (const rawEntry of entriesRaw) {
    if (entries.length >= MAX_ENTRIES) break;
    const entry = normalizeJournalEntry(rawEntry);
    if (entry) entries.push(entry);
  }
  entries.sort((a, b) => a.date.localeCompare(b.date));
  return { version: 1, entries };
}

function normalizeTaskNote(raw: unknown): JournalTaskNote | null {
  if (!raw || typeof raw !== "object") return null;
  const note = raw as Record<string, unknown>;
  const id = optionalString(note.id, 128);
  const body = optionalBody(note.body, JOURNAL_TASK_NOTE_MAX_BYTES);
  if (!id || body === undefined) return null;
  return {
    id,
    at: optionalString(note.at, 64) ?? new Date(0).toISOString(),
    body,
    source: normalizeSource(note.source),
  };
}

function normalizeTaskClaim(raw: unknown): JournalTask["claim"] | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const claim = raw as Record<string, unknown>;
  const by = optionalString(claim.by, 128);
  const claimedAt = optionalString(claim.claimed_at, 64);
  const leaseExpiresAt = optionalString(claim.lease_expires_at, 64);
  if (!by || !claimedAt || !leaseExpiresAt) return undefined;
  return {
    by,
    claimed_at: claimedAt,
    lease_expires_at: leaseExpiresAt,
  };
}

function normalizeJournalTask(raw: unknown): JournalTask | null {
  if (!raw || typeof raw !== "object") return null;
  const task = raw as Record<string, unknown>;
  const id = optionalString(task.id, 128);
  const title = optionalString(task.title, JOURNAL_TITLE_MAX_CHARS);
  if (!id || !title) return null;
  const status = isJournalTaskStatus(task.status) ? task.status : "todo";
  const priority = isJournalTaskPriority(task.priority) ? task.priority : "p2";
  const body = optionalBody(task.body, JOURNAL_TASK_BODY_MAX_BYTES) ?? "";
  const dueDate = isIsoDate(task.due_date) ? task.due_date : undefined;
  const sourceDate = isIsoDate(task.source_date) ? task.source_date : undefined;
  const journalEntryId = optionalString(task.journal_entry_id, 128);
  const completedAt = optionalString(task.completed_at, 64);
  const notes = Array.isArray(task.notes)
    ? task.notes
        .slice(0, MAX_NOTES_PER_TASK)
        .map(normalizeTaskNote)
        .filter((note): note is JournalTaskNote => note !== null)
    : [];
  const claim = normalizeTaskClaim(task.claim);
  return {
    id,
    title,
    body,
    status,
    priority,
    labels: normalizeJournalLabels(task.labels),
    created_at:
      optionalString(task.created_at, 64) ?? new Date(0).toISOString(),
    updated_at:
      optionalString(task.updated_at, 64) ?? new Date(0).toISOString(),
    ...(dueDate ? { due_date: dueDate } : {}),
    ...(sourceDate ? { source_date: sourceDate } : {}),
    ...(journalEntryId ? { journal_entry_id: journalEntryId } : {}),
    ...(completedAt ? { completed_at: completedAt } : {}),
    ...(claim ? { claim } : {}),
    ...(notes.length ? { notes } : {}),
  };
}

export function normalizeJournalTaskState(raw: unknown): JournalTaskState {
  if (!raw || typeof raw !== "object") return emptyJournalTaskState();
  const tasksRaw = (raw as { tasks?: unknown }).tasks;
  if (!Array.isArray(tasksRaw)) return emptyJournalTaskState();
  const tasks: JournalTask[] = [];
  for (const rawTask of tasksRaw) {
    if (tasks.length >= MAX_TASKS) break;
    const task = normalizeJournalTask(rawTask);
    if (task) tasks.push(task);
  }
  return { version: 1, tasks };
}

const dailyJournalStore = createJsonFileStore<DailyJournalState>({
  filePath: dailyJournalFilePath,
  empty: emptyDailyJournalState,
  sanitize: normalizeDailyJournalState,
  maxBytes: MAX_DAILY_JOURNAL_JSON_BYTES,
  backupSuffix: "corrupt",
  sizeErrorMessage: "daily journal state too large",
});

const journalTaskStore = createJsonFileStore<JournalTaskState>({
  filePath: journalTasksFilePath,
  empty: emptyJournalTaskState,
  sanitize: normalizeJournalTaskState,
  maxBytes: MAX_JOURNAL_TASKS_JSON_BYTES,
  backupSuffix: "corrupt",
  sizeErrorMessage: "journal task state too large",
});

export async function loadDailyJournalState(
  root: string,
): Promise<DailyJournalState> {
  return dailyJournalStore.load(root);
}

export async function loadJournalTaskState(
  root: string,
): Promise<JournalTaskState> {
  return journalTaskStore.load(root);
}

export async function updateDailyJournalState<R>(
  root: string,
  updater: (
    state: DailyJournalState,
  ) =>
    | { state: DailyJournalState; result: R }
    | Promise<{ state: DailyJournalState; result: R }>,
): Promise<R> {
  return dailyJournalStore.update(root, updater);
}

export async function updateJournalTaskState<R>(
  root: string,
  updater: (
    state: JournalTaskState,
  ) =>
    | { state: JournalTaskState; result: R }
    | Promise<{ state: JournalTaskState; result: R }>,
): Promise<R> {
  return journalTaskStore.update(root, updater);
}

export type JournalEntryInput = {
  date: string;
  title?: string;
  body: string;
  labels?: unknown;
  source?: JournalEntrySource;
};

export type JournalTaskInput = {
  title: string;
  body?: string;
  status?: JournalTaskStatus;
  priority?: JournalTaskPriority;
  labels?: unknown;
  due_date?: string;
  source_date?: string;
  journal_entry_id?: string;
  before_id?: string;
  after_id?: string;
  position?: number;
};

export type JournalIssueLinkInput = {
  issue_number: number;
  repo?: string;
  title?: string;
  url?: string;
  memo_label?: string;
  status?: JournalTaskStatus;
  priority?: JournalTaskPriority;
  labels?: unknown;
  before_id?: string;
  after_id?: string;
  position?: number;
};

export type JournalTaskPatch = {
  title?: string;
  body?: string;
  status?: JournalTaskStatus;
  priority?: JournalTaskPriority;
  labels?: unknown;
  due_date?: string | null;
  source_date?: string | null;
  journal_entry_id?: string | null;
};

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

function taskInsertIndex(
  tasks: JournalTask[],
  status: JournalTaskStatus,
  input: InsertOptions,
): { ok: true; index: number } | { ok: false; error: string } {
  if (insertOptionCount(input) > 1)
    return { ok: false, error: "use only one of before, after, or position" };
  if (input.before_id || input.after_id) {
    const anchorId = input.before_id || input.after_id || "";
    const anchorIndex = tasks.findIndex((task) => task.id === anchorId);
    const anchor = tasks[anchorIndex];
    if (!anchor) return { ok: false, error: "anchor task not found" };
    if (anchor.status !== status)
      return { ok: false, error: "anchor task belongs to another column" };
    return {
      ok: true,
      index: input.before_id ? anchorIndex : anchorIndex + 1,
    };
  }
  const statusIndexes = tasks
    .map((task, index) => ({ task, index }))
    .filter((item) => item.task.status === status)
    .map((item) => item.index);
  if (input.position !== undefined) {
    if (!Number.isInteger(input.position) || input.position < 1)
      return { ok: false, error: "position must be a positive integer" };
    if (input.position > statusIndexes.length + 1)
      return { ok: false, error: "position is out of range" };
    if (input.position <= statusIndexes.length)
      return { ok: true, index: statusIndexes[input.position - 1] };
  }
  const last = statusIndexes[statusIndexes.length - 1];
  return { ok: true, index: last === undefined ? tasks.length : last + 1 };
}

function validateEntryInput(
  input: JournalEntryInput,
): { ok: true } | { ok: false; error: string } {
  if (!isIsoDate(input.date))
    return { ok: false, error: "date must be YYYY-MM-DD" };
  if (optionalBody(input.body, JOURNAL_ENTRY_BODY_MAX_BYTES) === undefined)
    return { ok: false, error: "body is required or too large" };
  if (!input.body.trim()) return { ok: false, error: "body is required" };
  return { ok: true };
}

export function addDailyJournalEntry(
  state: DailyJournalState,
  input: JournalEntryInput,
  now: string,
  makeId: (prefix: string) => string = makeJournalId,
):
  | { ok: true; state: DailyJournalState; entry: DailyJournalEntry }
  | {
      ok: false;
      error: string;
    } {
  const valid = validateEntryInput(input);
  if (valid.ok === false) return valid;
  const title = optionalString(input.title, JOURNAL_TITLE_MAX_CHARS);
  const entry: DailyJournalEntry = {
    id: makeId("j"),
    date: input.date,
    ...(title ? { title } : {}),
    body: input.body,
    labels: normalizeJournalLabels(input.labels),
    source: input.source || "user",
    created_at: now,
    updated_at: now,
  };
  return {
    ok: true,
    state: { version: 1, entries: [...state.entries, entry] },
    entry,
  };
}

export function updateDailyJournalEntry(
  state: DailyJournalState,
  id: string,
  patch: Partial<JournalEntryInput>,
  now: string,
):
  | { ok: true; state: DailyJournalState; entry: DailyJournalEntry }
  | {
      ok: false;
      error: string;
    } {
  const entry = state.entries.find((item) => item.id === id);
  if (!entry) return { ok: false, error: "journal entry not found" };
  const next: DailyJournalEntry = {
    ...entry,
    updated_at: now,
  };
  if (patch.date !== undefined) {
    if (!isIsoDate(patch.date))
      return { ok: false, error: "date must be YYYY-MM-DD" };
    next.date = patch.date;
  }
  if (patch.title !== undefined) {
    const title = optionalString(patch.title, JOURNAL_TITLE_MAX_CHARS);
    if (title) next.title = title;
    else delete next.title;
  }
  if (patch.body !== undefined) {
    const body = optionalBody(patch.body, JOURNAL_ENTRY_BODY_MAX_BYTES);
    if (body === undefined || !body.trim())
      return { ok: false, error: "body is required or too large" };
    next.body = body;
  }
  if (patch.labels !== undefined)
    next.labels = normalizeJournalLabels(patch.labels);
  if (patch.source !== undefined) next.source = patch.source;
  return {
    ok: true,
    state: {
      version: 1,
      entries: state.entries.map((item) => (item.id === id ? next : item)),
    },
    entry: next,
  };
}

export function deleteDailyJournalEntry(
  state: DailyJournalState,
  id: string,
): { state: DailyJournalState; removed: boolean } {
  const entries = state.entries.filter((entry) => entry.id !== id);
  return {
    state: { version: 1, entries },
    removed: entries.length !== state.entries.length,
  };
}

function validateTaskInput(
  input: JournalTaskInput,
): { ok: true } | { ok: false; error: string } {
  if (!optionalString(input.title, JOURNAL_TITLE_MAX_CHARS))
    return { ok: false, error: "title is required" };
  if (
    input.body !== undefined &&
    optionalBody(input.body, JOURNAL_TASK_BODY_MAX_BYTES) === undefined
  )
    return { ok: false, error: "body is too large" };
  if (input.due_date !== undefined && !isIsoDate(input.due_date))
    return { ok: false, error: "due date must be YYYY-MM-DD" };
  if (input.source_date !== undefined && !isIsoDate(input.source_date))
    return { ok: false, error: "source date must be YYYY-MM-DD" };
  return { ok: true };
}

function completedAtForStatus(
  status: JournalTaskStatus,
  previous: string | undefined,
  now: string,
): string | undefined {
  return status === "done" ? previous || now : undefined;
}

function githubIssueTaskBody(
  issueNumber: number,
  issueUrl: string | undefined,
  memoLabel: string | undefined,
): string {
  return [
    `GitHub issue #${issueNumber}`,
    ...(issueUrl ? [issueUrl] : []),
    "",
    memoLabel || "Memo:",
  ].join("\n");
}

function githubIssueRequiredLabels(
  issueNumber: number,
  repo: string | undefined,
  labels: unknown,
): string[] {
  const repoLabel = journalIssueRepoLabel(repo);
  return normalizeJournalLabels([
    "github",
    journalIssueLabel(issueNumber),
    ...(repoLabel ? [repoLabel] : []),
    ...(Array.isArray(labels) ? labels : []),
  ]);
}

function taskHasPlacement(
  input: InsertOptions & { status?: JournalTaskStatus },
  currentStatus?: JournalTaskStatus,
) {
  return (
    (!!input.status && input.status !== currentStatus) ||
    !!input.before_id ||
    !!input.after_id ||
    input.position !== undefined
  );
}

export function addJournalTask(
  state: JournalTaskState,
  input: JournalTaskInput,
  now: string,
  makeId: (prefix: string) => string = makeJournalId,
):
  | { ok: true; state: JournalTaskState; task: JournalTask }
  | {
      ok: false;
      error: string;
    } {
  const valid = validateTaskInput(input);
  if (valid.ok === false) return valid;
  const anchorId = input.before_id || input.after_id;
  const anchor = anchorId
    ? state.tasks.find((task) => task.id === anchorId)
    : undefined;
  if (anchorId && !anchor) return { ok: false, error: "anchor task not found" };
  const status = input.status || anchor?.status || "todo";
  const task: JournalTask = {
    id: makeId("t"),
    title:
      optionalString(input.title, JOURNAL_TITLE_MAX_CHARS) || "Untitled task",
    body: input.body || "",
    status,
    priority: input.priority || "p2",
    labels: normalizeJournalLabels(input.labels),
    created_at: now,
    updated_at: now,
    ...(input.due_date ? { due_date: input.due_date } : {}),
    ...(input.source_date ? { source_date: input.source_date } : {}),
    ...(input.journal_entry_id
      ? { journal_entry_id: input.journal_entry_id }
      : {}),
    ...(completedAtForStatus(status, undefined, now)
      ? { completed_at: now }
      : {}),
  };
  const insertAt = taskInsertIndex(state.tasks, status, input);
  if (insertAt.ok === false) return insertAt;
  const tasks = [...state.tasks];
  tasks.splice(insertAt.index, 0, task);
  return { ok: true, state: { version: 1, tasks }, task };
}

export function updateJournalTask(
  state: JournalTaskState,
  id: string,
  patch: JournalTaskPatch,
  now: string,
):
  | { ok: true; state: JournalTaskState; task: JournalTask }
  | {
      ok: false;
      error: string;
    } {
  const task = state.tasks.find((item) => item.id === id);
  if (!task) return { ok: false, error: "task not found" };
  const next: JournalTask = { ...task, updated_at: now };
  if (patch.title !== undefined) {
    const title = optionalString(patch.title, JOURNAL_TITLE_MAX_CHARS);
    if (!title) return { ok: false, error: "title is required" };
    next.title = title;
  }
  if (patch.body !== undefined) {
    const body = optionalBody(patch.body, JOURNAL_TASK_BODY_MAX_BYTES);
    if (body === undefined) return { ok: false, error: "body is too large" };
    next.body = body;
  }
  if (patch.status !== undefined) {
    next.status = patch.status;
    const completedAt = completedAtForStatus(
      patch.status,
      next.completed_at,
      now,
    );
    if (completedAt) next.completed_at = completedAt;
    else delete next.completed_at;
    if (patch.status !== "doing") delete next.claim;
  }
  if (patch.priority !== undefined) next.priority = patch.priority;
  if (patch.labels !== undefined)
    next.labels = normalizeJournalLabels(patch.labels);
  if (patch.due_date !== undefined) {
    if (patch.due_date === null || patch.due_date === "") delete next.due_date;
    else if (isIsoDate(patch.due_date)) next.due_date = patch.due_date;
    else return { ok: false, error: "due date must be YYYY-MM-DD" };
  }
  if (patch.source_date !== undefined) {
    if (patch.source_date === null || patch.source_date === "")
      delete next.source_date;
    else if (isIsoDate(patch.source_date)) next.source_date = patch.source_date;
    else return { ok: false, error: "source date must be YYYY-MM-DD" };
  }
  if (patch.journal_entry_id !== undefined) {
    const journalEntryId = optionalString(patch.journal_entry_id, 128);
    if (journalEntryId) next.journal_entry_id = journalEntryId;
    else delete next.journal_entry_id;
  }
  return {
    ok: true,
    state: {
      version: 1,
      tasks: state.tasks.map((item) => (item.id === id ? next : item)),
    },
    task: next,
  };
}

export function moveJournalTask(
  state: JournalTaskState,
  id: string,
  input: InsertOptions & { status?: JournalTaskStatus },
  now: string,
):
  | { ok: true; state: JournalTaskState; task: JournalTask }
  | {
      ok: false;
      error: string;
    } {
  const source = state.tasks.find((task) => task.id === id);
  if (!source) return { ok: false, error: "task not found" };
  if (input.before_id === id || input.after_id === id)
    return { ok: false, error: "cannot move task relative to itself" };
  const tasksWithoutSource = state.tasks.filter((task) => task.id !== id);
  const anchorId = input.before_id || input.after_id;
  const anchor = anchorId
    ? tasksWithoutSource.find((task) => task.id === anchorId)
    : undefined;
  if (anchorId && !anchor) return { ok: false, error: "anchor task not found" };
  const status = input.status || anchor?.status || source.status;
  const moved: JournalTask = {
    ...source,
    status,
    updated_at: now,
  };
  const completedAt = completedAtForStatus(status, moved.completed_at, now);
  if (completedAt) moved.completed_at = completedAt;
  else delete moved.completed_at;
  if (status !== "doing") delete moved.claim;
  const insertAt = taskInsertIndex(tasksWithoutSource, status, input);
  if (insertAt.ok === false) return insertAt;
  const tasks = [...tasksWithoutSource];
  tasks.splice(insertAt.index, 0, moved);
  return { ok: true, state: { version: 1, tasks }, task: moved };
}

export function linkGithubIssueTask(
  state: JournalTaskState,
  input: JournalIssueLinkInput,
  now: string,
  makeId: (prefix: string) => string = makeJournalId,
):
  | {
      ok: true;
      state: JournalTaskState;
      task: JournalTask;
      created: boolean;
      moved: boolean;
    }
  | {
      ok: false;
      error: string;
    } {
  if (!Number.isInteger(input.issue_number) || input.issue_number < 1) {
    return { ok: false, error: "issue number must be a positive integer" };
  }
  const title =
    optionalString(input.title, JOURNAL_TITLE_MAX_CHARS) ||
    `GitHub issue #${input.issue_number}`;
  const repo = optionalString(input.repo, 120);
  const issueUrl = optionalString(input.url, 240);
  const memoLabel = optionalString(input.memo_label, 80);
  const requiredLabels = githubIssueRequiredLabels(
    input.issue_number,
    repo,
    input.labels,
  );
  const linkLabel = journalIssueLabel(input.issue_number);
  const repoLabel = journalIssueRepoLabel(repo);
  const linked = state.tasks.find(
    (task) =>
      task.labels.includes("github") &&
      task.labels.includes(linkLabel) &&
      (!repoLabel || task.labels.includes(repoLabel)),
  );
  if (!linked) {
    const hasAnchor = !!input.before_id || !!input.after_id;
    const result = addJournalTask(
      state,
      {
        title,
        body: githubIssueTaskBody(input.issue_number, issueUrl, memoLabel),
        status: input.status || (hasAnchor ? undefined : "draft"),
        priority: input.priority || "p2",
        labels: requiredLabels,
        before_id: input.before_id,
        after_id: input.after_id,
        position: input.position,
      },
      now,
      makeId,
    );
    if (result.ok === false) return result;
    return {
      ok: true,
      state: result.state,
      task: result.task,
      created: true,
      moved: false,
    };
  }

  let nextState = state;
  let task = linked;
  let moved = false;
  const placement = {
    status: input.status,
    before_id: input.before_id,
    after_id: input.after_id,
    position: input.position,
  };
  if (taskHasPlacement(placement, task.status)) {
    const result = moveJournalTask(nextState, task.id, placement, now);
    if (result.ok === false) return result;
    nextState = result.state;
    task = result.task;
    moved = true;
  }

  const labels = normalizeJournalLabels([...task.labels, ...requiredLabels]);
  const shouldUpdateLabels =
    labels.length !== task.labels.length ||
    labels.some((label, index) => label !== task.labels[index]);
  if (input.priority || shouldUpdateLabels) {
    const result = updateJournalTask(
      nextState,
      task.id,
      {
        ...(input.priority ? { priority: input.priority } : {}),
        ...(shouldUpdateLabels ? { labels } : {}),
      },
      now,
    );
    if (result.ok === false) return result;
    nextState = result.state;
    task = result.task;
  }
  return { ok: true, state: nextState, task, created: false, moved };
}

export function claimJournalTask(
  state: JournalTaskState,
  id: string,
  input: { by?: string; lease_minutes?: number; wip_limit?: number },
  now: string,
):
  | { ok: true; state: JournalTaskState; task: JournalTask }
  | {
      ok: false;
      error: string;
    } {
  const task = state.tasks.find((item) => item.id === id);
  if (!task) return { ok: false, error: "task not found" };
  const nowMs = Date.parse(now);
  const activeClaim =
    task.claim &&
    Number.isFinite(Date.parse(task.claim.lease_expires_at)) &&
    Date.parse(task.claim.lease_expires_at) > nowMs;
  if (activeClaim) return { ok: false, error: "task is already claimed" };
  if (task.status !== "todo" && task.status !== "doing")
    return {
      ok: false,
      error: "only todo or expired doing tasks can be claimed",
    };
  const by = optionalString(input.by, 128) || "ai";
  const wipLimit = input.wip_limit;
  if (wipLimit !== undefined && wipLimit > 0) {
    const activeDoing = state.tasks.filter((item) => {
      if (item.status !== "doing" || !item.claim) return false;
      if (item.claim.by !== by) return false;
      const expires = Date.parse(item.claim.lease_expires_at);
      return Number.isFinite(expires) && expires > nowMs;
    }).length;
    if (activeDoing >= wipLimit)
      return { ok: false, error: "WIP limit reached" };
  }
  const leaseMinutes =
    Number.isFinite(input.lease_minutes) && input.lease_minutes
      ? Math.min(1440, Math.max(1, Math.round(input.lease_minutes)))
      : 120;
  const leaseExpiresAt = new Date(nowMs + leaseMinutes * 60_000).toISOString();
  const next: JournalTask = {
    ...task,
    status: "doing",
    updated_at: now,
    claim: {
      by,
      claimed_at: now,
      lease_expires_at: leaseExpiresAt,
    },
  };
  return {
    ok: true,
    state: {
      version: 1,
      tasks: state.tasks.map((item) => (item.id === id ? next : item)),
    },
    task: next,
  };
}

export function completeJournalTask(
  state: JournalTaskState,
  id: string,
  input: { note?: string; source?: JournalEntrySource; by?: string },
  now: string,
  makeId: (prefix: string) => string = makeJournalId,
):
  | { ok: true; state: JournalTaskState; task: JournalTask }
  | {
      ok: false;
      error: string;
    } {
  const task = state.tasks.find((item) => item.id === id);
  if (!task) return { ok: false, error: "task not found" };
  if (task.status !== "doing")
    return { ok: false, error: "only doing tasks can be completed" };
  const nowMs = Date.parse(now);
  const activeClaim =
    task.claim &&
    Number.isFinite(Date.parse(task.claim.lease_expires_at)) &&
    Date.parse(task.claim.lease_expires_at) > nowMs;
  if (!activeClaim)
    return { ok: false, error: "task must be claimed before completion" };
  const by = optionalString(input.by, 128);
  if (!by) return { ok: false, error: "task completion requires claim owner" };
  if (task.claim?.by !== by)
    return { ok: false, error: "task claim belongs to another agent" };
  const notes = [...(task.notes || [])];
  if (input.note?.trim()) {
    const body = optionalBody(input.note, JOURNAL_TASK_NOTE_MAX_BYTES);
    if (body === undefined) return { ok: false, error: "note is too large" };
    notes.push({
      id: makeId("n"),
      at: now,
      body,
      source: input.source || "ai",
    });
    if (notes.length > MAX_NOTES_PER_TASK) {
      notes.splice(0, notes.length - MAX_NOTES_PER_TASK);
    }
  }
  const next: JournalTask = {
    ...task,
    status: "done",
    updated_at: now,
    completed_at: now,
    ...(notes.length ? { notes } : {}),
  };
  delete next.claim;
  return {
    ok: true,
    state: {
      version: 1,
      tasks: state.tasks.map((item) => (item.id === id ? next : item)),
    },
    task: next,
  };
}

export function deleteJournalTask(
  state: JournalTaskState,
  id: string,
): { state: JournalTaskState; removed: boolean } {
  const tasks = state.tasks.filter((task) => task.id !== id);
  return {
    state: { version: 1, tasks },
    removed: tasks.length !== state.tasks.length,
  };
}
