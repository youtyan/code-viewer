// Commit history screen logic that does not touch the DOM.

import type { DiffRange } from "./routes";

// One decoration from `git log --format=%D`: a branch / tag pointing at the
// commit. `head` marks the branch HEAD is on; kind "head" is a detached HEAD.
export type HistoryCommitRef = {
  name: string;
  kind: "branch" | "tag" | "head";
  head?: true;
};

export type HistoryCommit = {
  sha: string;
  subject: string;
  author: string;
  when: string;
  parents: string[];
  body: string;
  refs?: HistoryCommitRef[];
};

export type HistoryLogResponse = {
  commits: HistoryCommit[];
  hasMore: boolean;
  generation?: number;
  hasWorktree?: boolean;
};

export type HistoryAuthor = { name: string; count: number };

export type HistoryAuthorsResponse = {
  authors: HistoryAuthor[];
  generation?: number;
};

// ---- filter query syntax (shared by the history view, the file history
// tab, `code-viewer file history --query`, and the MCP tool) ----
//
//   free words            message text (one phrase; "quoted text" keeps spaces)
//   author:<name>         author contains (repeatable, OR)
//   path:<part>           touched path contains (repeatable, OR)
//   since:<date> after:   committed on / after that date (git date syntax)
//   until:<date> before:  committed on / before that date
//   code:<text>           added / removed lines contain (git log -S)
//   merges:no | no-merges hide merge commits;  merges:only  show only them
//
// Different kinds combine with AND. A 4-40 hex word on its own also tries a
// sha prefix. Unknown prefixes ("fix:", "http://...") stay ordinary text.
export type HistoryQueryToken =
  | { kind: "text"; value: string }
  | { kind: "author" | "path" | "since" | "until" | "code"; value: string }
  | { kind: "merges"; value: "no" | "only" };

export const HISTORY_QUERY_PREFIXES = [
  "author",
  "path",
  "since",
  "after",
  "until",
  "before",
  "code",
  "merges",
] as const;

export function tokenizeHistoryQuery(raw: string): HistoryQueryToken[] {
  const tokens: HistoryQueryToken[] = [];
  const known = new Set<string>(HISTORY_QUERY_PREFIXES);
  for (const match of raw
    .trim()
    .matchAll(/(?:([A-Za-z-]+):)?("([^"]*)"|(\S+))/g)) {
    const prefix = (match[1] || "").toLowerCase();
    const value = match[3] !== undefined ? match[3] : (match[4] ?? "");
    if (!prefix) {
      if (value === "no-merges") {
        tokens.push({ kind: "merges", value: "no" });
        continue;
      }
      // "author:" with nothing after it is an unfinished prefix, not text.
      if (value.endsWith(":") && known.has(value.slice(0, -1).toLowerCase()))
        continue;
      if (value) tokens.push({ kind: "text", value });
      continue;
    }
    if (!known.has(prefix)) {
      tokens.push({ kind: "text", value: `${match[1]}:${value}` });
      continue;
    }
    if (!value) continue;
    switch (prefix) {
      case "author":
      case "path":
      case "code":
        tokens.push({ kind: prefix, value });
        break;
      case "since":
      case "after":
        tokens.push({ kind: "since", value });
        break;
      case "until":
      case "before":
        tokens.push({ kind: "until", value });
        break;
      case "merges":
        if (value === "no" || value === "only")
          tokens.push({ kind: "merges", value });
        else tokens.push({ kind: "text", value: `merges:${value}` });
        break;
    }
  }
  return tokens;
}

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
