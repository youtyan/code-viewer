export const JOURNAL_TASK_STATUSES = [
  "draft",
  "todo",
  "doing",
  "blocked",
  "done",
] as const;

export type JournalTaskStatus = (typeof JOURNAL_TASK_STATUSES)[number];

export const JOURNAL_TASK_PRIORITIES = ["p0", "p1", "p2", "p3"] as const;

export type JournalTaskPriority = (typeof JOURNAL_TASK_PRIORITIES)[number];

export const JOURNAL_LABEL_MAX_CHARS = 48;
export const JOURNAL_MAX_LABELS = 24;

export type JournalEntrySource = "user" | "ai" | "imported";

export type DailyJournalEntry = {
  id: string;
  date: string;
  title?: string;
  body: string;
  labels: string[];
  source: JournalEntrySource;
  created_at: string;
  updated_at: string;
};

export type DailyJournalState = {
  version: 1;
  entries: DailyJournalEntry[];
};

export type JournalTaskClaim = {
  by: string;
  claimed_at: string;
  lease_expires_at: string;
};

export type JournalTaskNote = {
  id: string;
  at: string;
  body: string;
  source: JournalEntrySource;
};

export type JournalTask = {
  id: string;
  title: string;
  body: string;
  status: JournalTaskStatus;
  priority: JournalTaskPriority;
  labels: string[];
  created_at: string;
  updated_at: string;
  due_date?: string;
  source_date?: string;
  journal_entry_id?: string;
  completed_at?: string;
  claim?: JournalTaskClaim;
  notes?: JournalTaskNote[];
};

export type JournalTaskState = {
  version: 1;
  tasks: JournalTask[];
};

export type JournalDataResponse = {
  generation?: number;
  journal: DailyJournalState;
  tasks: JournalTaskState;
  labels: string[];
};

export type JournalTaskFilter = {
  status?: JournalTaskStatus | JournalTaskStatus[];
  labels?: string[];
  includeClaimed?: boolean;
  now?: number;
};

const PRIORITY_SCORE: Record<JournalTaskPriority, number> = {
  p0: 0,
  p1: 1,
  p2: 2,
  p3: 3,
};

export function isJournalTaskStatus(
  value: unknown,
): value is JournalTaskStatus {
  return JOURNAL_TASK_STATUSES.includes(value as JournalTaskStatus);
}

export function isJournalTaskPriority(
  value: unknown,
): value is JournalTaskPriority {
  return JOURNAL_TASK_PRIORITIES.includes(value as JournalTaskPriority);
}

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

export function todayIsoDate(now = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const date = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${date}`;
}

export function taskClaimActive(task: JournalTask, now = Date.now()): boolean {
  if (!task.claim) return false;
  const expires = Date.parse(task.claim.lease_expires_at);
  return Number.isFinite(expires) && expires > now;
}

export function normalizeJournalLabel(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const label = value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}._:-]+/gu, "")
    .slice(0, JOURNAL_LABEL_MAX_CHARS)
    .replace(/^[-_.:]+|[-_.:]+$/g, "");
  return label || null;
}

export function normalizeJournalLabels(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const labels: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const label = normalizeJournalLabel(item);
    if (!label || seen.has(label)) continue;
    seen.add(label);
    labels.push(label);
    if (labels.length >= JOURNAL_MAX_LABELS) break;
  }
  return labels;
}

export function journalIssueLabel(issueNumber: number): string {
  return `issue-${issueNumber}`;
}

export function journalIssueRepoLabel(repo: unknown): string | null {
  if (typeof repo !== "string") return null;
  return normalizeJournalLabel(`repo-${repo.replace(/[\\/]+/g, "-")}`);
}

export function collectJournalLabels(
  journal: DailyJournalState,
  tasks: JournalTaskState,
): string[] {
  const labels = new Set<string>();
  for (const entry of journal.entries) {
    for (const label of entry.labels) labels.add(label);
  }
  for (const task of tasks.tasks) {
    for (const label of task.labels) labels.add(label);
  }
  return [...labels].sort((a, b) => a.localeCompare(b));
}

export function filterJournalTasks(
  state: JournalTaskState,
  filter: JournalTaskFilter = {},
): JournalTask[] {
  const statuses = Array.isArray(filter.status)
    ? filter.status
    : filter.status
      ? [filter.status]
      : undefined;
  const labels = filter.labels?.filter(Boolean) || [];
  return state.tasks.filter((task) => {
    if (statuses && !statuses.includes(task.status)) return false;
    if (
      labels.length &&
      !labels.every((label) => task.labels.includes(label))
    ) {
      return false;
    }
    if (!filter.includeClaimed && taskClaimActive(task, filter.now))
      return false;
    return true;
  });
}

export function selectNextJournalTasks(
  state: JournalTaskState,
  filter: JournalTaskFilter = {},
  limit = 1,
): JournalTask[] {
  const status = filter.status || "todo";
  const indexed = filterJournalTasks(state, { ...filter, status }).map(
    (task, index) => ({ task, index }),
  );
  indexed.sort((a, b) => {
    const priority =
      PRIORITY_SCORE[a.task.priority] - PRIORITY_SCORE[b.task.priority];
    if (priority !== 0) return priority;
    if (a.index !== b.index) return a.index - b.index;
    return a.task.created_at.localeCompare(b.task.created_at);
  });
  return indexed.slice(0, Math.max(0, limit)).map((item) => item.task);
}
