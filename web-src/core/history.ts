// Commit history screen logic that does not touch the DOM.

import type { DiffRange } from "./routes";

export type HistoryCommit = {
  sha: string;
  subject: string;
  author: string;
  when: string;
  parents: string[];
};

export type HistoryLogResponse = {
  commits: HistoryCommit[];
  hasMore: boolean;
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
