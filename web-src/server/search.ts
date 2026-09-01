import type { FileSearchListResponse, GrepMatch } from "../core/types";
import { isWordBoundary } from "../core/word-boundary";
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

// Shared by the rg / git grep / fallback engines so the three agree on what
// "match case" and "whole word" mean. Defaults (both off) are the
// case-insensitive substring search the palette always had.
export type GrepMatchOptions = {
  caseSensitive?: boolean;
  wholeWord?: boolean;
};

// First occurrence of `needle` in `line` that satisfies the word rule, or -1.
export function fixedStringColumn(
  line: string,
  query: string,
  options: GrepMatchOptions = {},
): number {
  if (!query) return -1;
  const haystack = options.caseSensitive ? line : line.toLowerCase();
  const needle = options.caseSensitive ? query : query.toLowerCase();
  let from = 0;
  for (;;) {
    const column = haystack.indexOf(needle, from);
    if (column < 0) return -1;
    if (
      !options.wholeWord ||
      isWordBoundary(line, column, column + needle.length)
    )
      return column;
    from = column + 1;
  }
}

export function fixedStringLineMatches(
  path: string,
  text: string,
  query: string,
  max: number,
  options: GrepMatchOptions = {},
): GrepMatch[] {
  if (!query) return [];
  const matches: GrepMatch[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length && matches.length < max; i++) {
    const line = lines[i];
    const column = fixedStringColumn(line, query, options);
    if (column < 0) continue;
    matches.push({
      path,
      line: i + 1,
      column: column + 1,
      preview: line.slice(0, 500),
      matchText: line.slice(column, column + query.length),
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
  excludeTests = false,
  options: GrepMatchOptions & { pathGlobs?: string[] } = {},
): string[] {
  const safePaths = paths.length ? paths : ["."];
  // "path:src/**/*.ts" scopes arrive as include globs; rg's positional
  // arguments only take real files / directories.
  const includeGlobs = (options.pathGlobs ?? []).flatMap((pattern) => [
    "--glob",
    pattern,
  ]);
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
  const testGlobs = excludeTests
    ? [
        "test",
        "spec",
        "__tests__",
        "test.*",
        "spec.*",
        "test_*",
        "spec_*",
        "*.test",
        "*.spec",
        "*.test.*",
        "*.spec.*",
        "*_test",
        "*_spec",
        "*_test.*",
        "*_spec.*",
      ].flatMap((pattern) => [
        "--glob",
        `!${pattern}`,
        "--glob",
        `!**/${pattern}`,
        "--glob",
        `!${pattern}/**`,
        "--glob",
        `!**/${pattern}/**`,
      ])
    : [];
  const args = [
    "rg",
    "--no-config",
    "--json",
    "--line-number",
    "--column",
    "--no-heading",
    "--with-filename",
    "--color",
    "never",
    options.caseSensitive ? "--case-sensitive" : "--ignore-case",
    ...(options.wholeWord ? ["--word-regexp"] : []),
    ...matchMode,
    "--max-count",
    String(max),
    "--max-filesize",
    "2M",
    ...includeGlobs,
    ...omitGlobs,
    ...excludeGlobs,
    ...testGlobs,
    "-e",
    query,
    "--",
    ...safePaths,
  ];
  return args;
}

function normalizeRgPath(path: string): string {
  return path.replace(/^(?:\.\/)+/, "");
}

export function parseRgOutput(
  stdout: string,
  max: number,
  omitDirNames: string[] = [],
  excludeNames: string[] = [],
  includePath: (path: string) => boolean = () => true,
): GrepMatch[] {
  const matches: GrepMatch[] = [];
  for (const line of stdout.split("\n")) {
    if (!line) continue;
    if (matches.length >= max) break;
    if (line.startsWith("{")) {
      const event = JSON.parse(line) as {
        type?: unknown;
        data?: {
          path?: { text?: unknown };
          lines?: { text?: unknown };
          line_number?: unknown;
          submatches?: Array<{
            match?: { text?: unknown };
            start?: unknown;
          }>;
        };
      };
      if (event.type !== "match") continue;
      const rawPath = event.data?.path?.text;
      const lineText = event.data?.lines?.text;
      const lineNo = event.data?.line_number;
      const submatch = event.data?.submatches?.[0];
      const matchText = submatch?.match?.text;
      const byteStart = submatch?.start;
      if (
        typeof rawPath !== "string" ||
        typeof lineText !== "string" ||
        typeof lineNo !== "number" ||
        typeof matchText !== "string" ||
        typeof byteStart !== "number"
      )
        continue;
      const path = normalizeRgPath(rawPath);
      const preview = lineText.replace(/\r?\n$/, "");
      const column =
        Buffer.from(preview).subarray(0, byteStart).toString("utf8").length + 1;
      if (
        !path ||
        !lineNo ||
        !column ||
        isSkippableSearchPath(path, omitDirNames, excludeNames) ||
        !includePath(path)
      )
        continue;
      matches.push({
        path,
        line: lineNo,
        column,
        preview: preview.slice(0, 500),
        matchText,
      });
      continue;
    }
    const parsed = /^(.*?):(\d+):(\d+):(.*)$/.exec(line);
    if (!parsed) continue;
    const path = normalizeRgPath(parsed[1]);
    const lineNo = Number(parsed[2]);
    const column = Number(parsed[3]);
    const preview = parsed[4];
    if (
      !path ||
      !lineNo ||
      !column ||
      isSkippableSearchPath(path, omitDirNames, excludeNames) ||
      !includePath(path)
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
  includePath: (path: string) => boolean = () => true,
): GrepMatch[] {
  const prefix = `${ref}:`;
  const normalized = stdout
    .split("\n")
    .map((line) => (line.startsWith(prefix) ? line.slice(prefix.length) : line))
    .join("\n");
  return parseRgOutput(
    normalized,
    max,
    omitDirNames,
    excludeNames,
    includePath,
  );
}
