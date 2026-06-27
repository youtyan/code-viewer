// Commit history screen logic that does not touch the DOM.

import type { DiffRange } from "./routes";

export type HistoryCommit = {
  sha: string;
  subject: string;
  author: string;
  when: string;
  parents: string[];
  body: string;
};

export type HistoryLogResponse = {
  commits: HistoryCommit[];
  hasMore: boolean;
  generation?: number;
  hasWorktree?: boolean;
};

// git's well-known empty tree object: diff target for root commits.
export const EMPTY_TREE_SHA = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

export const HISTORY_PAGE_SIZE = 50;
export const HISTORY_AUTO_LOAD_MAX_PAGES = 20;

export function commitDiffRange(commit: {
  sha: string;
  parents: string[];
}): DiffRange {
  return { from: commit.parents[0] || EMPTY_TREE_SHA, to: commit.sha };
}

export function shouldContinueAutoLoad(state: {
  pagesLoaded: number;
  found: boolean;
  hasMore: boolean;
}): boolean {
  if (state.found) return false;
  if (!state.hasMore) return false;
  return state.pagesLoaded < HISTORY_AUTO_LOAD_MAX_PAGES;
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const DAY_MS = 24 * 60 * 60 * 1000;

// Section label used to group the commit list by age. Future timestamps
// (clock skew across machines) fold into "Today".
export function historyGroupLabel(whenIso: string, now: Date): string {
  const t = Date.parse(whenIso);
  if (!Number.isFinite(t)) return "Unknown date";
  const dayStart = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();
  if (t >= dayStart) return "Today";
  if (t >= dayStart - DAY_MS) return "Yesterday";
  if (t >= dayStart - 6 * DAY_MS) return "This week";
  const d = new Date(t);
  if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth())
    return "This month";
  return `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
}
