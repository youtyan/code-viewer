import type { FileSearchListResponse, GrepMatch } from "../core/types";
import type { GitTreeEntry } from "./git";
import { compileNamePatterns } from "./name-pattern";

export const GREP_DEFAULT_MAX = 200;
export const GREP_ABSOLUTE_MAX = 500;
export const GREP_MAX_FILE_BYTES = 2 * 1024 * 1024;
export const FILE_SEARCH_ABSOLUTE_MAX = 50000;
export const DEFAULT_EXCLUDE_NAMES = [".DS_Store"];

export function normalizeGrepMax(value: string | null): number {
  const parsed = Number(value || "");
  if (!Number.isInteger(parsed) || parsed <= 0) return GREP_DEFAULT_MAX;
  return Math.min(parsed, GREP_ABSOLUTE_MAX);
}

export function isSkippableSearchPath(
  path: string,
  omitDirNames: string[] = [],
  excludeNames: string[] = [],
): boolean {
  const omitDirs = compileNamePatterns(omitDirNames);
  const excluded = compileNamePatterns(excludeNames);
  return path.split(/[\\/]+/).some((part) => {
    const lower = part.toLowerCase();
    return (
      lower === ".git" ||
      lower === ".code-viewer" ||
      omitDirs.matches(part) ||
      excluded.matches(part)
    );
  });
}

export function fixedStringLineMatches(
  path: string,
  text: string,
  query: string,
  max: number,
): GrepMatch[] {
  const needle = query.toLowerCase();
  if (!needle) return [];
  const matches: GrepMatch[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length && matches.length < max; i++) {
    const line = lines[i];
    const column = line.toLowerCase().indexOf(needle);
    if (column < 0) continue;
    matches.push({
      path,
      line: i + 1,
      column: column + 1,
      preview: line.slice(0, 500),
    });
  }
  return matches;
}

export function buildFileSearchList(
  ref: string,
  generation: number,
  entries: GitTreeEntry[],
): FileSearchListResponse {
  const files = entries
    .filter(
      (entry): entry is GitTreeEntry & { type: "blob" | "commit" } =>
        entry.type === "blob" || entry.type === "commit",
    )
    .slice(0, FILE_SEARCH_ABSOLUTE_MAX)
    .map((entry) => ({ path: entry.path, type: entry.type }));
  return {
    ref,
    generation,
    files,
    truncated: entries.length > FILE_SEARCH_ABSOLUTE_MAX,
  };
}

export function buildRgArgs(
  query: string,
  max: number,
  paths: string[],
  regex = false,
  omitDirNames: string[] = [],
  excludeNames: string[] = [],
): string[] {
  const safePaths = paths.length ? paths : ["."];
  const omitGlobs = omitDirNames.flatMap((name) => [
    "--glob",
    `!${name}/**`,
    "--glob",
    `!**/${name}/**`,
  ]);
  const excludeGlobs = excludeNames.flatMap((name) => [
    "--glob",
    `!${name}`,
    "--glob",
    `!**/${name}`,
  ]);
  const matchMode = regex ? [] : ["--fixed-strings"];
  const args = [
    "rg",
    "--no-config",
    "--line-number",
    "--column",
    "--no-heading",
    "--with-filename",
    "--color",
    "never",
    "--smart-case",
    ...matchMode,
    "--max-count",
    String(max),
    "--max-filesize",
    "2M",
    ...omitGlobs,
    ...excludeGlobs,
    "-e",
    query,
    "--",
    ...safePaths,
  ];
  return args;
}

export function parseRgOutput(
  stdout: string,
  max: number,
  omitDirNames: string[] = [],
  excludeNames: string[] = [],
): GrepMatch[] {
  const matches: GrepMatch[] = [];
  for (const line of stdout.split("\n")) {
    if (!line) continue;
    if (matches.length >= max) break;
    const parsed = /^(.*?):(\d+):(\d+):(.*)$/.exec(line);
    if (!parsed) continue;
    const path = parsed[1];
    const lineNo = Number(parsed[2]);
    const column = Number(parsed[3]);
    const preview = parsed[4];
    if (
      !path ||
      !lineNo ||
      !column ||
      isSkippableSearchPath(path, omitDirNames, excludeNames)
    )
      continue;
    matches.push({
      path,
      line: lineNo,
      column,
      preview: preview.slice(0, 500),
    });
  }
  return matches;
}

export function parseGitGrepOutput(
  stdout: string,
  ref: string,
  max: number,
  omitDirNames: string[] = [],
  excludeNames: string[] = [],
): GrepMatch[] {
  const prefix = `${ref}:`;
  const normalized = stdout
    .split("\n")
    .map((line) => (line.startsWith(prefix) ? line.slice(prefix.length) : line))
    .join("\n");
  return parseRgOutput(normalized, max, omitDirNames, excludeNames);
}
