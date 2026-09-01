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
//   - git.ts and spawn-runner own async process execution.
//
// What we add here is only the orchestration that previously read closure
// state — turned into pure functions that take `SearchEnv`.

import { existsSync, realpathSync } from "node:fs";
import { lstat, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { isTestFilePath } from "../core/file-filter";
import { globMatchPath, isGlobPathQuery } from "../core/fuzzy-search";
import type {
  FileSearchListResponse,
  GrepMatch,
  GrepResponse,
} from "../core/types";
import { commandForExternal } from "./command-resolver";
import { throwIfAborted } from "./database/adapters/abort";
import { spawnTextAsync } from "./database/adapters/spawn-runner";
import * as git from "./git";
import { compileNamePatterns } from "./name-pattern";
import {
  buildFileSearchList,
  buildRgArgs,
  fixedStringLineMatches,
  GREP_MAX_FILE_BYTES,
  type GrepMatchOptions,
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
  // Repo-relative files / directories, or globs ("src/**/*.ts"). Globs are
  // routed to the engine's include filter; plain paths to its positional
  // arguments. Unsafe entries are dropped.
  paths: string[];
  regex: boolean;
  max: number;
  excludeTests?: boolean;
  caseSensitive?: boolean;
  wholeWord?: boolean;
  // Lets a handler stop the external process when the client goes away.
  signal?: AbortSignal;
};

export type GrepRunResult =
  | { ok: true; value: GrepResponse }
  | { ok: false; error: string; status?: number };

export type FileListResult =
  | { ok: true; value: FileSearchListResponse }
  | { ok: false; error: string; status?: number };

type GrepEngineFailure = { error: string; status: 500 };

// rg availability does not depend on cwd in practice (it is a PATH
// question), so we keep a single boolean cache shared by every call.
// `resetRgAvailableCache` exists so tests can re-probe between runs.
let rgAvailableCache: boolean | null = null;

export async function rgAvailableAsync(cwd: string): Promise<boolean> {
  if (rgAvailableCache !== null) return rgAvailableCache;
  const proc = await spawnTextAsync({
    command: commandForExternal("rg"),
    args: ["--version"],
    cwd,
    timeoutMs: 5000,
    abortMessage: "rg version aborted",
    timeoutMessage: "rg version timed out after 5000ms",
    rejectOnError: false,
  });
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
  const excluded = compileNamePatterns(excludeNames);
  return path.split(/[\\/]+/).some((part) => excluded.matches(part));
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
function filterCallerPaths(
  env: SearchEnv,
  paths: string[],
  excludeTests: boolean,
): string[] {
  return paths.filter(
    (path) =>
      isSafePath(path) &&
      !git.isGitInternalPath(path) &&
      !isSkippableSearchPath(path, env.omitDirNames, env.excludeNames) &&
      (!excludeTests || !isTestFilePath(path)),
  );
}

// Caller paths come in two shapes: concrete files / directories, and glob
// patterns. Engines treat them differently, so split once here.
function splitCallerPaths(
  env: SearchEnv,
  paths: string[],
  excludeTests: boolean,
): { plain: string[]; globs: string[] } {
  const plain: string[] = [];
  const globs: string[] = [];
  for (const path of paths) {
    if (!isSafePath(path) || git.isGitInternalPath(path)) continue;
    if (isGlobPathQuery(path)) {
      globs.push(path);
      continue;
    }
    if (
      isSkippableSearchPath(path, env.omitDirNames, env.excludeNames) ||
      (excludeTests && isTestFilePath(path))
    )
      continue;
    plain.push(path);
  }
  return { plain, globs };
}

function matchesAnyGlob(path: string, globs: string[]): boolean {
  return (
    globs.length === 0 || globs.some((glob) => !!globMatchPath(glob, path))
  );
}

// Expand caller directories into their files so the fallback scanner can
// walk them like rg / git grep do with positional directory arguments.
async function fallbackCandidatePaths(
  env: SearchEnv,
  paths: string[],
): Promise<string[]> {
  if (paths.length === 0) {
    const tree = await git.listTreeAsync("worktree", "", env.cwd, {
      recursive: true,
      omitDirNames: env.omitDirNames,
      excludeNames: env.excludeNames,
    });
    return tree.entries.map((entry) => entry.path);
  }
  const candidates: string[] = [];
  for (const path of paths) {
    const full = safeWorktreePath(env, path);
    if (!full) continue;
    let stat: Awaited<ReturnType<typeof lstat>>;
    try {
      stat = await lstat(full);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) {
      candidates.push(path);
      continue;
    }
    const tree = await git.listTreeAsync("worktree", path, env.cwd, {
      recursive: true,
      omitDirNames: env.omitDirNames,
      excludeNames: env.excludeNames,
    });
    for (const entry of tree.entries) {
      if (entry.type === "blob") candidates.push(entry.path);
    }
  }
  return candidates;
}

async function grepWorktreeFallback(
  env: SearchEnv,
  query: string,
  max: number,
  paths: string[],
  globs: string[],
  excludeTests: boolean,
  options: GrepMatchOptions,
  signal?: AbortSignal,
): Promise<GrepMatch[]> {
  const candidates = await fallbackCandidatePaths(env, paths);
  const matches: GrepMatch[] = [];
  for (const path of candidates) {
    if (matches.length >= max) break;
    throwIfAborted(signal, "grep aborted");
    if (
      !isSafePath(path) ||
      git.isGitInternalPath(path) ||
      isSkippableSearchPath(path, env.omitDirNames, env.excludeNames) ||
      (excludeTests && isTestFilePath(path)) ||
      !matchesAnyGlob(path, globs)
    )
      continue;
    const full = safeWorktreePath(env, path);
    if (!full) continue;
    let stat: Awaited<ReturnType<typeof lstat>>;
    try {
      stat = await lstat(full);
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
      data = await readFile(full);
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
        options,
      ),
    );
  }
  return matches;
}

function matchOptions(req: GrepRequest): GrepMatchOptions {
  return {
    caseSensitive: req.caseSensitive === true,
    wholeWord: req.wholeWord === true,
  };
}

async function grepWorktreeAsync(
  env: SearchEnv,
  req: GrepRequest,
): Promise<GrepResponse | GrepEngineFailure> {
  const excludeTests = req.excludeTests === true;
  const { plain, globs } = splitCallerPaths(env, req.paths, excludeTests);
  const paths = filterCallerPaths(env, plain, excludeTests);
  if (req.paths.length > 0 && paths.length === 0 && globs.length === 0) {
    return {
      ref: "worktree",
      engine: "fallback",
      truncated: false,
      matches: [],
    };
  }
  if (await rgAvailableAsync(env.cwd)) {
    const safePaths = paths.filter((path) => safeWorktreePath(env, path));
    if (plain.length > 0 && safePaths.length === 0) {
      return {
        ref: "worktree",
        engine: "rg",
        truncated: false,
        matches: [],
      };
    }
    const args = buildRgArgs(
      req.query,
      req.max,
      safePaths,
      req.regex,
      env.omitDirNames,
      env.excludeNames,
      excludeTests,
      { ...matchOptions(req), pathGlobs: globs },
    );
    const proc = await spawnTextAsync({
      command: commandForExternal("rg"),
      args: args.slice(1),
      cwd: env.cwd,
      timeoutMs: 5000,
      signal: req.signal,
      abortMessage: "grep aborted",
      timeoutMessage: "grep timed out after 5000ms",
      rejectOnError: false,
    });
    if (proc.code > 1) {
      const fallback = `rg grep failed with exit code ${proc.code}`;
      const error = proc.stderr.trim() || fallback;
      console.error(`[code-viewer] ${fallback}: ${error}`);
      return { error, status: 500 };
    }
    const matches = parseRgOutput(
      proc.stdout,
      req.max,
      env.omitDirNames,
      env.excludeNames,
      excludeTests ? (path) => !isTestFilePath(path) : undefined,
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
  const matches = await grepWorktreeFallback(
    env,
    req.query,
    req.max,
    paths,
    globs,
    excludeTests,
    matchOptions(req),
    req.signal,
  );
  return {
    ref: "worktree",
    engine: "fallback",
    truncated: matches.length >= req.max,
    matches,
  };
}

async function grepTreeRefAsync(
  env: SearchEnv,
  req: GrepRequest,
): Promise<GrepResponse | GrepEngineFailure> {
  const excludeTests = req.excludeTests === true;
  const { plain, globs } = splitCallerPaths(env, req.paths, excludeTests);
  const safePaths = filterCallerPaths(env, plain, excludeTests);
  if (req.paths.length > 0 && safePaths.length === 0 && globs.length === 0) {
    return {
      ref: req.ref,
      engine: "git",
      truncated: false,
      matches: [],
    };
  }
  const options = matchOptions(req);
  // ":(glob)" gives git the "**" reading rg uses for --glob ("a/**/b" also
  // matches "a/b"). Under that magic a slash-less pattern such as "*.ts"
  // would only match at the top level, so it is widened with a leading
  // "**/" — the any-depth meaning gitignore and rg give it.
  const pathspecs = [
    ...safePaths,
    ...globs.map((glob) =>
      glob.includes("/") ? `:(glob)${glob}` : `:(glob)**/${glob}`,
    ),
  ];
  const args = [
    "-c",
    "core.quotepath=false",
    "grep",
    "-n",
    "--column",
    ...(options.caseSensitive ? [] : ["-i"]),
    ...(options.wholeWord ? ["-w"] : []),
    req.regex ? "-E" : "-F",
    "--no-color",
    "-e",
    req.query,
    req.ref,
    "--",
    ...pathspecs,
  ];
  const proc = await spawnTextAsync({
    command: commandForExternal("git"),
    args,
    cwd: env.cwd,
    timeoutMs: 5000,
    signal: req.signal,
    abortMessage: "git grep aborted",
    timeoutMessage: "git grep timed out after 5000ms",
    rejectOnError: false,
  });
  if (proc.code !== 0 && proc.code !== 1) {
    return {
      error: git.gitFailureMessage(proc, "git grep failed"),
      status: 500,
    };
  }
  const matches = parseGitGrepOutput(
    proc.stdout,
    req.ref,
    req.max,
    env.omitDirNames,
    env.excludeNames,
    excludeTests ? (path) => !isTestFilePath(path) : undefined,
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
export async function grepRepoAsync(
  env: SearchEnv,
  req: GrepRequest,
): Promise<GrepRunResult> {
  const isWorktree = req.ref === "worktree" || req.ref === "";
  if (!isWorktree) {
    const refCheck = await git.verifyTreeRefResultAsync(req.ref, env.cwd);
    if (refCheck.ok !== true) {
      return {
        ok: false,
        error: refCheck.error,
        status: refCheck.status,
      };
    }
  }
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
  if (isWorktree) {
    const result = await grepWorktreeAsync(env, req);
    return "error" in result
      ? { ok: false, ...result }
      : { ok: true, value: result };
  }
  const result = await grepTreeRefAsync(env, req);
  return "error" in result
    ? { ok: false, ...result }
    : { ok: true, value: result };
}

// List every blob/commit entry under `ref`. Used by /_files (with a
// per-generation cache layered on top in preview.ts) and by the MCP
// `code_viewer_search_files` tool (always fresh per call).
export async function listRepoFilesAsync(
  env: SearchEnv,
  ref: string,
  generation: number,
): Promise<FileListResult> {
  if (ref !== "worktree" && ref !== "") {
    const refCheck = await git.verifyTreeRefResultAsync(ref, env.cwd);
    if (refCheck.ok !== true) {
      return {
        ok: false,
        error: refCheck.error,
        status: refCheck.status,
      };
    }
  }
  const effectiveRef = ref || "worktree";
  const tree = await git.listTreeResultAsync(effectiveRef, "", env.cwd, {
    recursive: true,
    omitDirNames: env.omitDirNames,
    excludeNames: env.excludeNames,
  });
  if (tree.error) {
    return { ok: false, error: tree.error, status: tree.status };
  }
  const entries = tree.entries.filter(
    (entry) => !isExcludedScopePath(entry.path, env.excludeNames),
  );
  return {
    ok: true,
    value: buildFileSearchList(effectiveRef, generation, entries),
  };
}
