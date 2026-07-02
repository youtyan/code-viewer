import {
  commandForExternal,
  commandNotFoundDetail,
  isCommandNotFoundResult,
} from "./command-resolver";
import { runSync } from "./runtime";

export type GithubIssueListState = "open" | "closed" | "all";

export type GithubIssueListItem = {
  number: number;
  title: string;
  state: string;
  url?: string;
  labels: string[];
};

export type GithubIssueListOptions = {
  cwd: string;
  repo?: string;
  labels?: string[];
  search?: string;
  state?: GithubIssueListState;
  limit?: number;
};

export type GithubIssueViewOptions = {
  cwd: string;
  number: number;
  repo?: string;
};

const GITHUB_ISSUE_LABEL_FILTER_LIMIT = 24;

export class GithubIssueListError extends Error {
  constructor(
    message: string,
    readonly status = 502,
  ) {
    super(message);
  }
}

export function normalizeGithubIssueListState(
  value: unknown,
): GithubIssueListState {
  return value === "closed" || value === "all" ? value : "open";
}

export function normalizeGithubIssueListLimit(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 1) {
    return 30;
  }
  return Math.min(Math.floor(value), 100);
}

export function singleLineGithubOption(
  value: string | undefined,
): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.includes("\0") || /[\r\n]/.test(trimmed)) {
    return undefined;
  }
  return trimmed.slice(0, 200);
}

export function githubSearchHasStateQualifier(
  value: string | undefined,
): boolean {
  const search = singleLineGithubOption(value);
  return !!search && /(^|\s)(is|state):(open|closed|all)(?=\s|$)/i.test(search);
}

function extractGithubIssueLabels(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const labels: string[] = [];
  for (const item of raw) {
    if (typeof item === "string") {
      const label = singleLineGithubOption(item);
      if (label) labels.push(label);
    } else if (item && typeof item === "object" && "name" in item) {
      const label = singleLineGithubOption(
        (item as { name?: unknown }).name as string | undefined,
      );
      if (label) labels.push(label);
    }
  }
  return labels.slice(0, 12);
}

export function normalizeGithubIssueListItem(
  raw: unknown,
): GithubIssueListItem | null {
  if (!raw || typeof raw !== "object") return null;
  const issue = raw as Record<string, unknown>;
  const number = issue.number;
  const title = issue.title;
  if (
    typeof number !== "number" ||
    !Number.isInteger(number) ||
    number <= 0 ||
    typeof title !== "string" ||
    !title.trim()
  ) {
    return null;
  }
  const url = singleLineGithubOption(issue.url as string | undefined);
  const state =
    typeof issue.state === "string" && issue.state.trim()
      ? issue.state.trim().toLowerCase()
      : "open";
  return {
    number,
    title: title.trim().slice(0, 200),
    state,
    ...(url ? { url } : {}),
    labels: extractGithubIssueLabels(issue.labels),
  };
}

export function parseGithubIssueListOutput(
  stdout: string,
): GithubIssueListItem[] {
  const parsed = JSON.parse(stdout);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map(normalizeGithubIssueListItem)
    .filter((issue): issue is GithubIssueListItem => issue !== null);
}

export function parseGithubIssueViewOutput(
  stdout: string,
): GithubIssueListItem {
  const issue = normalizeGithubIssueListItem(JSON.parse(stdout));
  if (!issue) throw new GithubIssueListError("failed to parse gh issue output");
  return issue;
}

export function buildGithubIssueListArgs(
  options: GithubIssueListOptions,
): string[] {
  const search = singleLineGithubOption(options.search);
  const args = [
    commandForExternal("gh"),
    "issue",
    "list",
    "--json",
    "number,title,state,labels,url",
    "--limit",
    String(normalizeGithubIssueListLimit(options.limit)),
    "--state",
    search && githubSearchHasStateQualifier(search)
      ? "all"
      : normalizeGithubIssueListState(options.state),
  ];
  const repo = singleLineGithubOption(options.repo);
  if (repo) args.push("--repo", repo);
  if (search) args.push("--search", search);
  const seenLabels = new Set<string>();
  for (const rawLabel of options.labels || []) {
    const label = singleLineGithubOption(rawLabel);
    if (!label || seenLabels.has(label)) continue;
    seenLabels.add(label);
    args.push("--label", label);
    if (seenLabels.size >= GITHUB_ISSUE_LABEL_FILTER_LIMIT) break;
  }
  return args;
}

export function buildGithubIssueViewArgs(
  options: GithubIssueViewOptions,
): string[] {
  const args = [
    commandForExternal("gh"),
    "issue",
    "view",
    String(options.number),
    "--json",
    "number,title,state,labels,url",
  ];
  const repo = singleLineGithubOption(options.repo);
  if (repo) args.push("--repo", repo);
  return args;
}

export function readGithubIssueList(
  options: GithubIssueListOptions,
): GithubIssueListItem[] {
  const proc = runSync(buildGithubIssueListArgs(options), options.cwd, {
    timeout: 30000,
  });
  if (proc.code !== 0) {
    const detail = isCommandNotFoundResult("gh", proc)
      ? commandNotFoundDetail("gh")
      : proc.stderr.trim() || `gh issue list exited with code ${proc.code}`;
    throw new GithubIssueListError(detail);
  }
  try {
    return parseGithubIssueListOutput(proc.stdout);
  } catch {
    throw new GithubIssueListError("failed to parse gh issue list output");
  }
}

export function readGithubIssue(
  options: GithubIssueViewOptions,
): GithubIssueListItem {
  const proc = runSync(buildGithubIssueViewArgs(options), options.cwd, {
    timeout: 30000,
  });
  if (proc.code !== 0) {
    const detail = isCommandNotFoundResult("gh", proc)
      ? commandNotFoundDetail("gh")
      : proc.stderr.trim() || `gh issue view exited with code ${proc.code}`;
    throw new GithubIssueListError(detail);
  }
  try {
    return parseGithubIssueViewOutput(proc.stdout);
  } catch (error) {
    if (error instanceof GithubIssueListError) throw error;
    throw new GithubIssueListError("failed to parse gh issue output");
  }
}
