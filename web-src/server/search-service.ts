// Search service shared between the HTTP routes (`/_files`, `/_grep`) and
// the MCP tools (`code_viewer_search_files`, `code_viewer_search_code`).
//
// Background: grepWorktree / grepTreeRef / grepWorktreeFallback /
// rgAvailable / parseGrepPaths used to live inside preview.ts and depend
// on the server-process closure (`cwd`, `scopeOmitDirNames`,
// `scopeExcludeNames`, the rg-version cache). Moving them here lets MCP
// tools call the same engine with a different repo root (`--cwd`) and
// guarantees the AI agent sees identical results to the browser.
//
// Reuse:
//   - search.ts owns the pure helpers (buildRgArgs / parseRgOutput /
//     parseGitGrepOutput / fixedStringLineMatches / buildFileSearchList /
//     isSkippableSearchPath / size constants). Nothing is duplicated.
//   - git.ts owns listTree / verifyTreeRef / isGitInternalPath / show.
//   - runtime.runSync is the existing process-spawn helper.
//
// What we add here is only the orchestration that previously read closure
// state — turned into pure functions that take `SearchEnv`.

import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { join, relative } from "node:path";
import type {
  FileSearchListResponse,
  GrepMatch,
  GrepResponse,
} from "../core/types";
import * as git from "./git";
import { runSync } from "./runtime";
import {
  buildFileSearchList,
  buildRgArgs,
  fixedStringLineMatches,
  GREP_MAX_FILE_BYTES,
  isSkippableSearchPath,
  parseGitGrepOutput,
  parseRgOutput,
} from "./search";

export type SearchEnv = {
  cwd: string;
  omitDirNames: string[];
  excludeNames: string[];
};

export type GrepRequest = {
  query: string;
  ref: string; // "worktree" or a git ref
  paths: string[];
  regex: boolean;
  max: number;
};

export type GrepRunResult =
  | { ok: true; value: GrepResponse }
  | { ok: false; error: string };

export type FileListResult =
  | { ok: true; value: FileSearchListResponse }
  | { ok: false; error: string };

// rg availability does not depend on cwd in practice (it is a PATH
// question), so we keep a single boolean cache shared by every call.
// `resetRgAvailableCache` exists so tests can re-probe between runs.
let rgAvailableCache: boolean | null = null;

export function rgAvailable(cwd: string): boolean {
  if (rgAvailableCache !== null) return rgAvailableCache;
  const proc = runSync(["rg", "--version"], cwd);
  rgAvailableCache = proc.code === 0;
  return rgAvailableCache;
}

export function resetRgAvailableCache(): void {
  rgAvailableCache = null;
}

export function isExcludedScopePath(
  path: string,
  excludeNames: string[],
): boolean {
  return path
    .split(/[\\/]+/)
    .some((part) =>
      excludeNames.some((name) => part.toLowerCase() === name.toLowerCase()),
    );
}

export function isSafePath(path: string): boolean {
  if (
    !path ||
    path.startsWith("/") ||
    path.startsWith("\\") ||
    path.includes("\0")
  )
    return false;
  return !path.split(/[\\/]+/).includes("..");
}

// Resolve a repo-relative path to its absolute worktree path, rejecting
// symlink escapes and missing files. Same gate the closure-bound version
// in preview.ts used; pulled out so MCP tools share it.
export function safeWorktreePath(env: SearchEnv, path: string): string | null {
  if (!isSafePath(path)) return null;
  if (git.isGitInternalPath(path)) return null;
  const full = join(env.cwd, path);
  if (!existsSync(full)) return null;
  let realCwd: string;
  let realFull: string;
  try {
    realCwd = realpathSync(env.cwd);
    realFull = realpathSync(full);
  } catch {
    return null;
  }
  const rel = relative(realCwd, realFull);
  if (
    rel === "" ||
    rel.startsWith("..") ||
    rel.startsWith("/") ||
    rel.startsWith("\\")
  )
    return null;
  if (git.isGitInternalPath(rel)) return null;
  return realFull;
}

// Drop the first-layer unsafe paths the way the old `parseGrepPaths` in
// preview.ts did. The grep engines (rg + git grep + fallback) still
// re-filter via safeWorktreePath afterwards, so this just removes the
// obviously-wrong inputs early.
function filterCallerPaths(env: SearchEnv, paths: string[]): string[] {
  return paths.filter(
    (path) =>
      isSafePath(path) &&
      !git.isGitInternalPath(path) &&
      !isSkippableSearchPath(path, env.omitDirNames, env.excludeNames),
  );
}

function grepWorktreeFallback(
  env: SearchEnv,
  query: string,
  max: number,
  paths: string[],
): GrepMatch[] {
  const candidates = paths.length
    ? paths
    : git
        .listTree("worktree", "", env.cwd, {
          recursive: true,
          omitDirNames: env.omitDirNames,
          excludeNames: env.excludeNames,
        })
        .entries.map((entry) => entry.path);
  const matches: GrepMatch[] = [];
  for (const path of candidates) {
    if (matches.length >= max) break;
    if (
      !isSafePath(path) ||
      git.isGitInternalPath(path) ||
      isSkippableSearchPath(path, env.omitDirNames, env.excludeNames)
    )
      continue;
    const full = safeWorktreePath(env, path);
    if (!full) continue;
    let stat: ReturnType<typeof lstatSync>;
    try {
      stat = lstatSync(full);
    } catch {
      continue;
    }
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.size > GREP_MAX_FILE_BYTES
    )
      continue;
    let data: Buffer;
    try {
      data = readFileSync(full);
    } catch {
      continue;
    }
    if (data.subarray(0, 8192).includes(0)) continue;
    matches.push(
      ...fixedStringLineMatches(
        path,
        data.toString("utf8"),
        query,
        max - matches.length,
      ),
    );
  }
  return matches;
}

function grepWorktree(env: SearchEnv, req: GrepRequest): GrepResponse {
  const paths = filterCallerPaths(env, req.paths);
  if (rgAvailable(env.cwd)) {
    const safePaths = paths.filter((path) => safeWorktreePath(env, path));
    const args = buildRgArgs(
      req.query,
      req.max,
      safePaths,
      req.regex,
      env.omitDirNames,
      env.excludeNames,
    );
    const proc = runSync(args, env.cwd, { timeout: 5000 });
    const stdout = proc.stdout;
    const matches = parseRgOutput(
      stdout,
      req.max,
      env.omitDirNames,
      env.excludeNames,
    ).filter(
      (match) =>
        isSafePath(match.path) &&
        !git.isGitInternalPath(match.path) &&
        !isSkippableSearchPath(
          match.path,
          env.omitDirNames,
          env.excludeNames,
        ) &&
        !!safeWorktreePath(env, match.path),
    );
    return {
      ref: "worktree",
      engine: "rg",
      truncated: matches.length >= req.max,
      matches,
    };
  }
  if (req.regex) {
    return {
      ref: "worktree",
      engine: "fallback",
      truncated: false,
      matches: [],
    };
  }
  const matches = grepWorktreeFallback(env, req.query, req.max, paths);
  return {
    ref: "worktree",
    engine: "fallback",
    truncated: matches.length >= req.max,
    matches,
  };
}

function grepTreeRef(env: SearchEnv, req: GrepRequest): GrepResponse {
  const safePaths = filterCallerPaths(env, req.paths);
  const args = [
    "git",
    "-c",
    "core.quotepath=false",
    "grep",
    "-n",
    "--column",
    "-i",
    req.regex ? "-E" : "-F",
    "--no-color",
    "-e",
    req.query,
    req.ref,
    "--",
    ...safePaths,
  ];
  const proc = runSync(args, env.cwd, { timeout: 5000 });
  const stdout = proc.stdout;
  const matches = parseGitGrepOutput(
    stdout,
    req.ref,
    req.max,
    env.omitDirNames,
    env.excludeNames,
  ).slice(0, req.max);
  return {
    ref: req.ref,
    engine: "git",
    truncated: matches.length >= req.max,
    matches,
  };
}

// One entry point for /_grep and the MCP code-search tool. Empty queries
// return an empty result so callers don't have to special-case "no input
// yet" the way the browser palette does. Unknown refs are surfaced as
// errors; everything else returns a populated GrepResponse.
export function grepRepo(env: SearchEnv, req: GrepRequest): GrepRunResult {
  if (!req.query.trim()) {
    return {
      ok: true,
      value: {
        ref: req.ref,
        engine: req.ref === "worktree" ? "fallback" : "git",
        truncated: false,
        matches: [],
      },
    };
  }
  if (req.ref === "worktree" || req.ref === "") {
    return { ok: true, value: grepWorktree(env, req) };
  }
  if (!git.verifyTreeRef(req.ref, env.cwd)) {
    return { ok: false, error: "invalid target" };
  }
  return { ok: true, value: grepTreeRef(env, req) };
}

// List every blob/commit entry under `ref`. Used by /_files (with a
// per-generation cache layered on top in preview.ts) and by the MCP
// `code_viewer_search_files` tool (always fresh per call).
export function listRepoFiles(
  env: SearchEnv,
  ref: string,
  generation: number,
): FileListResult {
  if (ref !== "worktree" && !git.verifyTreeRef(ref, env.cwd)) {
    return { ok: false, error: "invalid target" };
  }
  const effectiveRef = ref || "worktree";
  const entries = git
    .listTree(effectiveRef, "", env.cwd, {
      recursive: true,
      omitDirNames: env.omitDirNames,
      excludeNames: env.excludeNames,
    })
    .entries.filter(
      (entry) => !isExcludedScopePath(entry.path, env.excludeNames),
    );
  return {
    ok: true,
    value: buildFileSearchList(effectiveRef, generation, entries),
  };
}
