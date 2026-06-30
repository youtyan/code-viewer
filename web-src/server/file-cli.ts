// `code-viewer file` subcommand. Thin CLI veneer over the existing
// per-file git inspection helpers in `web-src/server/git.ts`:
//
//   blame   → git.blame   (uses git.normalizeBlameRef for ref/base handling)
//   history → git.commitHistory
//   show    → worktree read or git.show for committed refs
//
// No new git command is constructed here — committed reads still go through
// `git.ts`, so this CLI can never drift from the browser's blame / history /
// source views.

import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import {
  resolveRepoRoot,
  takeValue,
  validateRefValue,
  validateRepoRelativePathValue,
} from "./cli-helpers";
import {
  BLAME_ZERO_SHA,
  blame,
  commitHistory,
  type GitBlameBase,
  type GitBlameLine,
  type GitBlameResult,
  type GitHistoryCommit,
  show,
} from "./git";

export type FileBlameCommand = {
  kind: "blame";
  path: string;
  ref: string;
  base: GitBlameBase;
  json: boolean;
};

export type FileHistoryCommand = {
  kind: "history";
  path: string;
  ref: string;
  limit: number;
  skip: number;
  query?: string;
  json: boolean;
};

export type FileShowCommand = {
  kind: "show";
  path: string;
  ref: string;
  start?: number;
  end?: number;
  json: boolean;
};

export type FileCommand =
  | { kind: "help" }
  | { kind: "agent-help" }
  | FileBlameCommand
  | FileHistoryCommand
  | FileShowCommand;

export type FileArgs = {
  command: FileCommand;
  cwd?: string;
};

export type FileParseResult =
  | { ok: true; args: FileArgs }
  | { ok: false; error: string };

export const FILE_DEFAULT_HISTORY_LIMIT = 20;
export const FILE_HISTORY_HARD_CAP = 200;

export const FILE_HELP = `code-viewer file — inspect a path's blame, history, or contents

Usage:
  code-viewer file blame   --path <path> [--ref <ref>] [--base <worktree|HEAD>] [--json] [--cwd <dir>]
  code-viewer file history --path <path> [--ref <ref>] [--limit <n>] [--skip <n>] [--query <text>] [--json] [--cwd <dir>]
  code-viewer file show    --path <path> [--ref <ref>] [--start <line>] [--end <line>] [--json] [--cwd <dir>]
  code-viewer file --help
  code-viewer file agent-help

Common options:
  --path <path>   Required. Repo-relative path. Single-line, no NUL, no "..",
                  no leading "-", and no internal metadata path.
  --ref <ref>     Git ref. blame/show default to worktree; history defaults to
                  HEAD. Single-line, no NUL, no leading "-". blame/show accept
                  the literal "worktree" to mean the working tree.
  --cwd <dir>     Repository to target (default: process.cwd()).
  --json          Emit a structured JSON payload instead of plain text.
  --help, -h      Show this help.

blame options:
  --base <b>      "worktree" (default) keeps uncommitted edits visible as the
                  zero sha; "HEAD" forces a committed-only blame against --ref
                  (or HEAD when omitted).
history options:
  --limit <n>     1..${FILE_HISTORY_HARD_CAP} (default: ${FILE_DEFAULT_HISTORY_LIMIT}).
  --skip <n>      Non-negative. Used to paginate.
  --query <text>  git log filter passed verbatim to git.commitHistory
                  (supports the "author:" / "path:" prefixes the browser uses).

show options:
  --start <line>  1-indexed start line (inclusive). Requires --end.
  --end <line>    1-indexed end line (inclusive). Requires --start.
                  --start / --end must satisfy 1 <= start <= end.

Run "code-viewer file agent-help" for an AI-agent oriented guide.

Exit codes:
  0  command completed (history may emit "no history" with exit 0)
  1  parse error, unsafe argument, or git failure
`;

export const FILE_AGENT_HELP = `code-viewer file — agent guide

You are an AI coding agent. After locating a path with
"code-viewer search code" or by reading a diff, use this command to
investigate that path WITHOUT shelling out to git yourself. The CLI
reuses the same git/worktree read paths the browser uses, so blame /
history / show match the on-screen Blame, History, and Source tabs.

## When to use

- "Who wrote this line?" → file blame.
- "What changed on this path recently?" → file history.
- "Read the file (or a line range) as of a ref" → file show.
- Pre-flight for "code-viewer annotate add" — confirm the line range
  you are about to annotate is the one you mean.

## Requirements

- Run from inside the repository, or pass --cwd <repo>.
- No code-viewer server is required (this command reads git refs or the
  worktree directly).
- Git must be available on PATH.

## How to call

  code-viewer file blame --path src/sample.ts --json
  code-viewer file blame --path src/sample.ts --base HEAD --json
  code-viewer file history --path src/sample.ts --limit 10 --json
  code-viewer file history --path src/sample.ts --query "author:tester" --json
  code-viewer file show --path src/sample.ts --json
  code-viewer file show --path src/sample.ts --start 100 --end 150 --json
  code-viewer file show --path src/sample.ts --ref main --json

## Output contract

--json shapes (mirroring git.ts DTOs verbatim where possible):

  blame:
    {
      "path": string,
      "ref": string,         // the literal ref the CLI resolved to
      "base": "worktree"|"HEAD",
      "result": GitBlameResult   // { lines, commits, isUntracked?, isSynthetic?, error? }
    }
  history:
    {
      "path": string,
      "ref": string,
      "limit": number,
      "skip": number,
      "query"?: string,
      "result": { commits: GitHistoryCommit[], hasMore: boolean, error?: string }
    }
  show:
    {
      "path": string,
      "ref": string,
      "start"?: number,
      "end"?: number,
      "totalLines": number,    // total lines in the file at <ref>
      "complete": boolean,     // true when the returned text covers the whole file
      "text": string
    }

Default (non --json) output:

  blame:    one line per source line  →  <line><TAB><shortSha or "worktree"><TAB><summary>
            uncommitted edits show as "worktree" and "<uncommitted>".
  history:  one line per commit       →  <shortSha><TAB><whenISO><TAB><author><TAB><subject>
            0 commits prints "no history" to stderr, exit 0.
  show:     the file (or sliced lines) as text. 0-byte files succeed (exit 0).

## Tips

- Prefer --json. blame DTO carries author / authorMail / authorTime per
  commit; the plain-text format only shows summary.
- For huge files, slice with --start/--end before piping to a model
  context — "totalLines" / "complete" tell you what was dropped.
- file show reads the worktree by default. Pass --ref HEAD / --ref <branch>
  when you need a committed snapshot.
- A non-fatal git failure (e.g. unknown ref, unsafe path) returns the
  error string inside the JSON "result.error" / "error" field AND exits 1.
- Use "code-viewer search code" to discover the path first, then drill
  in with blame / history / show.
`;

const VALUE_FLAGS = new Set([
  "--path",
  "--ref",
  "--base",
  "--limit",
  "--skip",
  "--query",
  "--start",
  "--end",
]);
const BOOL_FLAGS = new Set(["--json"]);

const DEFAULT_BLAME_REF = "worktree";
const DEFAULT_BLAME_BASE: GitBlameBase = "worktree";
const DEFAULT_HISTORY_REF = "HEAD";
const DEFAULT_SHOW_REF = "worktree";

function validatePath(value: string): string | undefined {
  return validateRepoRelativePathValue(value, "--path");
}

function parseIntegerInRange(
  raw: string,
  flag: string,
  min: number,
  max: number,
): { value: number } | { error: string } {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    return {
      error: `${flag} must be an integer in [${min}, ${max}] (got ${raw})`,
    };
  }
  return { value: n };
}

export function parseFileArgs(argv: string[]): FileParseResult {
  const rest: string[] = [];
  let cwd: string | undefined;
  const options = new Map<string, string>();
  const flags = new Set<string>();

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      return { ok: true, args: { command: { kind: "help" } } };
    }
    if (arg === "--cwd") {
      const taken = takeValue(argv, i, arg);
      if ("error" in taken) return { ok: false, error: taken.error };
      cwd = taken.value;
      i = taken.next;
    } else if (VALUE_FLAGS.has(arg)) {
      const taken = takeValue(argv, i, arg);
      if ("error" in taken) return { ok: false, error: taken.error };
      options.set(arg, taken.value);
      i = taken.next;
    } else if (BOOL_FLAGS.has(arg)) {
      flags.add(arg);
    } else if (arg.startsWith("-")) {
      return { ok: false, error: `unknown option: ${arg}` };
    } else {
      rest.push(arg);
    }
  }

  const subcommand = rest[0];
  if (!subcommand) return { ok: true, args: { command: { kind: "help" } } };

  if (subcommand === "agent-help") {
    if (rest.length > 1) {
      return { ok: false, error: "agent-help does not accept arguments" };
    }
    return { ok: true, args: { command: { kind: "agent-help" } } };
  }

  if (rest.length > 1) {
    return {
      ok: false,
      error: `file ${subcommand} does not accept positional argument: ${rest[1]}`,
    };
  }

  if (
    subcommand !== "blame" &&
    subcommand !== "history" &&
    subcommand !== "show"
  ) {
    return { ok: false, error: `unknown file subcommand: ${subcommand}` };
  }

  const path = options.get("--path") ?? "";
  const pathError = validatePath(path);
  if (pathError) return { ok: false, error: pathError };

  const rawRef = options.get("--ref");
  if (rawRef !== undefined) {
    const refError = validateRefValue(rawRef, "--ref");
    if (refError) return { ok: false, error: refError };
  }
  const json = flags.has("--json");

  if (subcommand === "blame") {
    const base = options.get("--base") ?? DEFAULT_BLAME_BASE;
    if (base !== "worktree" && base !== "HEAD") {
      return {
        ok: false,
        error: `--base must be worktree or HEAD (got ${base})`,
      };
    }
    return {
      ok: true,
      args: {
        command: {
          kind: "blame",
          path,
          ref: rawRef ?? DEFAULT_BLAME_REF,
          base,
          json,
        },
        cwd,
      },
    };
  }

  if (subcommand === "history") {
    let limit = FILE_DEFAULT_HISTORY_LIMIT;
    if (options.has("--limit")) {
      const parsed = parseIntegerInRange(
        options.get("--limit") ?? "",
        "--limit",
        1,
        FILE_HISTORY_HARD_CAP,
      );
      if ("error" in parsed) return { ok: false, error: parsed.error };
      limit = parsed.value;
    }
    let skip = 0;
    if (options.has("--skip")) {
      const parsed = parseIntegerInRange(
        options.get("--skip") ?? "",
        "--skip",
        0,
        Number.MAX_SAFE_INTEGER,
      );
      if ("error" in parsed) return { ok: false, error: parsed.error };
      skip = parsed.value;
    }
    const query = options.get("--query");
    if (query !== undefined && /[\r\n\0]/.test(query)) {
      return {
        ok: false,
        error: "--query must be single-line and must not contain NUL",
      };
    }
    return {
      ok: true,
      args: {
        command: {
          kind: "history",
          path,
          ref: rawRef ?? DEFAULT_HISTORY_REF,
          limit,
          skip,
          query,
          json,
        },
        cwd,
      },
    };
  }

  // subcommand === "show"
  const hasStart = options.has("--start");
  const hasEnd = options.has("--end");
  if (hasStart !== hasEnd) {
    return { ok: false, error: "--start and --end must be used together" };
  }
  let start: number | undefined;
  let end: number | undefined;
  if (hasStart && hasEnd) {
    const s = parseIntegerInRange(
      options.get("--start") ?? "",
      "--start",
      1,
      Number.MAX_SAFE_INTEGER,
    );
    if ("error" in s) return { ok: false, error: s.error };
    const e = parseIntegerInRange(
      options.get("--end") ?? "",
      "--end",
      1,
      Number.MAX_SAFE_INTEGER,
    );
    if ("error" in e) return { ok: false, error: e.error };
    if (s.value > e.value) {
      return {
        ok: false,
        error: `--start (${s.value}) must be <= --end (${e.value})`,
      };
    }
    start = s.value;
    end = e.value;
  }
  return {
    ok: true,
    args: {
      command: {
        kind: "show",
        path,
        ref: rawRef ?? DEFAULT_SHOW_REF,
        start,
        end,
        json,
      },
      cwd,
    },
  };
}

function shortSha(sha: string): string {
  return sha === BLAME_ZERO_SHA ? "worktree" : sha.slice(0, 8);
}

function blameSummary(result: GitBlameResult, line: GitBlameLine): string {
  if (line.isUncommitted) return "<uncommitted>";
  const commit = result.commits[line.sha];
  return commit?.summary ?? "";
}

function formatBlameText(result: GitBlameResult): string[] {
  const lines: string[] = [];
  for (const line of result.lines) {
    lines.push(
      `${line.lineNo}\t${shortSha(line.sha)}\t${blameSummary(result, line)}`,
    );
  }
  return lines;
}

function formatHistoryText(commits: GitHistoryCommit[]): string[] {
  return commits.map(
    (c) => `${c.sha.slice(0, 8)}\t${c.when}\t${c.author}\t${c.subject}`,
  );
}

// JSON shape `code-viewer file blame --json` emits, also returned verbatim
// by the MCP tool `code_viewer_file_blame`. Pure; never throws — git.blame
// already surfaces failures as `result.error`.
export type FileBlameReport = {
  path: string;
  ref: string;
  base: GitBlameBase;
  result: GitBlameResult;
};

export function buildFileBlameReport(
  root: string,
  command: FileBlameCommand,
): FileBlameReport {
  const result = blame(root, {
    path: command.path,
    ref: command.ref,
    base: command.base,
  });
  return {
    path: command.path,
    ref: command.ref,
    base: command.base,
    result,
  };
}

// JSON shape `code-viewer file history --json` emits, also returned
// verbatim by the MCP tool `code_viewer_file_history`. Pure; never throws.
export type FileHistoryReport = {
  path: string;
  ref: string;
  limit: number;
  skip: number;
  query?: string;
  result: { commits: GitHistoryCommit[]; hasMore: boolean; error?: string };
};

export function buildFileHistoryReport(
  root: string,
  command: FileHistoryCommand,
): FileHistoryReport {
  const result = commitHistory(root, {
    ref: command.ref,
    skip: command.skip,
    limit: command.limit,
    query: command.query,
    path: command.path,
  });
  return {
    path: command.path,
    ref: command.ref,
    limit: command.limit,
    skip: command.skip,
    ...(command.query !== undefined ? { query: command.query } : {}),
    result,
  };
}

function runBlame(root: string, command: FileBlameCommand): void {
  const report = buildFileBlameReport(root, command);
  if (command.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    for (const line of formatBlameText(report.result)) console.log(line);
  }
  if (report.result.error) {
    console.error(`blame failed: ${report.result.error}`);
    process.exit(1);
  }
}

function runHistory(root: string, command: FileHistoryCommand): void {
  const report = buildFileHistoryReport(root, command);
  if (command.json) {
    console.log(JSON.stringify(report, null, 2));
  } else if (report.result.commits.length === 0) {
    // history のデフォルト出力で 0 件は no history を stderr、stdout は空、exit 0。
    // (file blame と違って、commit が無い path は "失敗" ではない)
    if (!report.result.error) console.error("no history");
  } else {
    for (const line of formatHistoryText(report.result.commits)) {
      console.log(line);
    }
  }
  if (report.result.error) {
    console.error(`history failed: ${report.result.error}`);
    process.exit(1);
  }
}

// Slice a file's lines into [start..end] (1-indexed, inclusive). Returns
// the `total` line count of the FULL file (not the slice) plus a
// `complete` flag indicating whether the slice covers every line. Pure;
// reused by the CLI's `file show --json` output and by the MCP tool
// `code_viewer_file_show`.
export function sliceLines(
  text: string,
  start: number | undefined,
  end: number | undefined,
): { lines: string[]; total: number; complete: boolean } {
  // 空ファイルは split で [""] になるので total=0 として扱う。
  const all = text === "" ? [] : text.split("\n");
  // git show は末尾改行を 1 つ余分な空要素として返すので、末尾の空文字は drop。
  // ただし「末尾改行なしの最終行」を消さないよう、末尾 1 要素だけを見る。
  if (all.length > 0 && all[all.length - 1] === "") all.pop();
  const total = all.length;
  if (start === undefined || end === undefined) {
    return { lines: all, total, complete: true };
  }
  const sliced = all.slice(start - 1, end);
  return {
    lines: sliced,
    total,
    complete: start === 1 && end >= total,
  };
}

// Resolve a repo-relative path against the worktree, rejecting paths that
// escape the repo via symlinks or "..". Returns the resolved absolute
// path or null when the path is unsafe / missing. Exported so MCP tools
// can perform the same gate (the closure-bound `safeWorktreePath` in
// preview.ts has the same intent but receives `cwd` differently).
export function safeWorktreePathFromRoot(
  root: string,
  path: string,
): string | null {
  if (validatePath(path)) return null;
  const full = join(root, path);
  if (!existsSync(full)) return null;
  try {
    const realRoot = realpathSync(root);
    const realFull = realpathSync(full);
    const rel = relative(realRoot, realFull);
    if (
      rel === "" ||
      rel.startsWith("..") ||
      rel.startsWith("/") ||
      rel.startsWith("\\")
    ) {
      return null;
    }
    if (validatePath(rel)) return null;
    return realFull;
  } catch {
    return null;
  }
}

// Read the requested ref's content. Worktree paths go through
// safeWorktreePathFromRoot; committed refs go through git.show. Exposed
// for `buildFileShowReport` and the MCP tool to share.
export function readShowText(
  root: string,
  command: FileShowCommand,
): { code: number; stdout: string; stderr: string } {
  if (command.ref !== "worktree" && command.ref !== "") {
    return show(command.ref, command.path, root);
  }
  const full = safeWorktreePathFromRoot(root, command.path);
  if (!full) {
    return {
      code: 1,
      stdout: "",
      stderr: "file not found or forbidden",
    };
  }
  try {
    const stat = statSync(full);
    if (!stat.isFile()) {
      return { code: 1, stdout: "", stderr: "not a file" };
    }
    return { code: 0, stdout: readFileSync(full, "utf8"), stderr: "" };
  } catch {
    return { code: 1, stdout: "", stderr: "file not readable" };
  }
}

// JSON shape `code-viewer file show --json` emits, also returned verbatim
// by the MCP tool `code_viewer_file_show`. Pure; never throws.
export type FileShowReport = {
  path: string;
  ref: string;
  start?: number;
  end?: number;
  totalLines: number;
  complete: boolean;
  text: string;
  error?: string;
};

export function buildFileShowReport(
  root: string,
  command: FileShowCommand,
): FileShowReport {
  const res = readShowText(root, command);
  if (res.code !== 0) {
    const detail = res.stderr.trim() || `git show exited with code ${res.code}`;
    return {
      path: command.path,
      ref: command.ref,
      ...(command.start !== undefined ? { start: command.start } : {}),
      ...(command.end !== undefined ? { end: command.end } : {}),
      totalLines: 0,
      complete: false,
      text: "",
      error: detail,
    };
  }
  const sliced = sliceLines(res.stdout, command.start, command.end);
  return {
    path: command.path,
    ref: command.ref,
    ...(command.start !== undefined ? { start: command.start } : {}),
    ...(command.end !== undefined ? { end: command.end } : {}),
    totalLines: sliced.total,
    complete: sliced.complete,
    text: sliced.lines.join("\n"),
  };
}

function runShow(root: string, command: FileShowCommand): void {
  const report = buildFileShowReport(root, command);
  if (report.error !== undefined) {
    if (command.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.error(`show failed: ${report.error}`);
    }
    process.exit(1);
  }
  if (command.json) {
    console.log(JSON.stringify(report, null, 2));
  } else if (report.text.length > 0) {
    // 1 行ずつ console.log で出すと、ファイル末尾以外でも改行が間に入って正しい。
    // 空 slice の場合は何も出さない (exit 0)。
    console.log(report.text);
  }
}

export async function runFileCli(argv: string[]): Promise<void> {
  const parsed = parseFileArgs(argv);
  if (parsed.ok === false) {
    console.error(parsed.error);
    console.error('Run "code-viewer file --help" for usage.');
    process.exit(1);
  }
  const { command, cwd } = parsed.args;
  if (command.kind === "help") {
    console.log(FILE_HELP);
    return;
  }
  if (command.kind === "agent-help") {
    console.log(FILE_AGENT_HELP);
    return;
  }
  const root = resolveRepoRoot(cwd);
  if (command.kind === "blame") return runBlame(root, command);
  if (command.kind === "history") return runHistory(root, command);
  if (command.kind === "show") return runShow(root, command);
}
