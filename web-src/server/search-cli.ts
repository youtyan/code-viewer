// `code-viewer search` subcommand. Thin CLI veneer over the running server's
// /_grep endpoint: the same engine that powers the browser's Ctrl+G palette,
// just exposed to AI agents / shell scripts. No new grep implementation is
// introduced — `web-src/server/preview.ts:handleGrep` and
// `web-src/server/search.ts` remain the single source of truth.

import {
  type FuzzyRange,
  isGlobPathQuery,
  rankPathMatches,
} from "../core/fuzzy-search";
import type { FileSearchListResponse, GrepResponse } from "../core/types";
import {
  ensureServerUrl,
  requestJson,
  resolveRepoRoot,
  takeValue,
} from "./cli-helpers";
import {
  configureExternalCommands,
  type ExternalCommandOverride,
  parseExternalCommandOverride,
} from "./command-resolver";
import {
  FILE_SEARCH_ABSOLUTE_MAX,
  GREP_ABSOLUTE_MAX,
  GREP_DEFAULT_MAX,
} from "./search";

export const FILE_NAME_SEARCH_DEFAULT_MAX = 50;

export type SearchCommand =
  | { kind: "help" }
  | { kind: "agent-help" }
  | {
      kind: "code";
      term: string;
      ref?: string;
      paths: string[];
      regex: boolean;
      max?: number;
      json: boolean;
    }
  // Sibling to `search code`: fetch the ref's file list from /_files, then
  // rank paths locally with the same matcher used by the browser palette.
  | {
      kind: "files";
      term: string;
      ref?: string;
      max: number;
      json: boolean;
    };

// JSON output for `search files`. The raw FileSearchListResponse can contain
// up to the server cap, so the CLI emits a ranked and sliced shape instead.
export type FileNameSearchJsonResult = {
  ref: string;
  generation: number;
  query: string;
  mode: "fuzzy" | "glob";
  truncated: boolean;
  candidateTruncated: boolean;
  totalCandidates: number;
  totalMatches: number;
  matches: Array<{
    path: string;
    score: number;
    ranges: FuzzyRange[];
  }>;
};

export type SearchArgs = {
  command: SearchCommand;
  cwd?: string;
  server?: string;
  commandOverrides?: ExternalCommandOverride[];
};

export type SearchParseResult =
  | { ok: true; args: SearchArgs }
  | { ok: false; error: string };

export const SEARCH_HELP = `code-viewer search — text and filename search across the worktree or a git ref

Usage:
  code-viewer search code --term <text> [--ref <ref>] [--path <path>...]
                          [--regex] [--max <n>] [--json]
                          [--cwd <dir>] [--server <url>] [--bin <name>=<path>]
  code-viewer search files --term <pattern> [--ref <ref>] [--max <n>] [--json]
                           [--cwd <dir>] [--server <url>] [--bin <name>=<path>]
  code-viewer search --help
  code-viewer search agent-help

Common options:
  --term <text>     Search term (required). Single line.
  --ref <ref>       Git ref to search (default: worktree). Branch / commit / tag.
  --max <n>         Maximum results.
                    code:  default ${GREP_DEFAULT_MAX}, hard cap ${GREP_ABSOLUTE_MAX}.
                    files: default ${FILE_NAME_SEARCH_DEFAULT_MAX}, hard cap ${FILE_SEARCH_ABSOLUTE_MAX}.
  --json            Emit a structured JSON payload instead of plain lines.
  --cwd <dir>       Repository to target (default: process.cwd()).
  --server <url>    code-viewer server URL (default: auto-discover).
  --bin git=<p>     Override the CLI-side git path used for server discovery.
                    Server-side rg/docker paths are set when starting code-viewer.
  --help, -h        Show this help.

search code only:
  --path <path>     Restrict the search to a sub-path. Repeatable.
  --regex           Treat --term as an extended regex instead of a fixed string.

search files:
  --term auto-switches between fuzzy and glob matching:
    fuzzy: bare words / camelCase fragments (e.g. "auth", "userId").
    glob:  patterns containing * or ? (e.g. "src/**/*.test.ts", "*.md").
  The mode used is reported in --json as "mode": "fuzzy" | "glob".

Default output:
  search code:  path:line:column\\tpreview (one line per match).
                Empty result prints "no matches" to stderr and exits 0.
  search files: path (one line per ranked match, best first).
                Empty result prints "no matching files" to stderr and exits 0.

Run "code-viewer search agent-help" for an AI-agent oriented guide.

Exit codes:
  0  search completed (may be 0 matches)
  1  parse error, unreachable server, or HTTP failure
`;

export const SEARCH_AGENT_HELP = `code-viewer search — agent guide

You are an AI coding agent. Use this command to grep the repository through
the running code-viewer server. The search uses ripgrep when available and
falls back to git grep / fixed-string scanning, so output is stable across
environments. Results are NOT persisted on the server; this is a pure read.

## When to use

- Locate a definition, caller, identifier, or string literal without
  shelling out to ripgrep yourself.
- Honour the same scope rules the browser UI uses (.git / .code-viewer /
  scope-omit directories are filtered out automatically).
- Search a git ref (a branch / commit / tag) without setting up a worktree.

## Requirements

- A code-viewer server must already be running for the repository.
- Run from inside the repository, or pass --cwd <repo>.
- If "code-viewer" is not on PATH (the human runs it via npx), invoke as:
    npx -y @youtyan/code-viewer search code --term "..."

## How to call

  code-viewer search code --term "TODO"
  code-viewer search code --term "TODO" --json
  code-viewer search code --term "fn handler" --regex --json
  code-viewer search code --term "config" --path src --path tests --json
  code-viewer search code --term "release" --ref main --json

  code-viewer search files --term "sample"
  code-viewer search files --term "userId" --json
  code-viewer search files --term "src/**/*.test.ts" --max 200 --json
  code-viewer search files --term "config" --ref main --json

## Output contract

search code --json prints the GrepResponse verbatim (see core/types.ts):

  {
    "ref": "worktree" | "<git-ref>",
    "engine": "rg" | "git" | "fallback",
    "truncated": boolean,        // true when matches.length reaches --max
    "matches": [
      { "path": string, "line": number, "column": number, "preview": string }
    ]
  }

search code default text output is one line per match:

  path:line:column<TAB>preview

When there are zero matches the command exits 0 and writes "no matches"
to stderr.

search files --json prints a CLI-specific ranked payload:

  {
    "ref": "worktree" | "<git-ref>",
    "generation": number,         // monotonic server tree generation
    "query": "<your --term>",
    "mode": "fuzzy" | "glob",
    "truncated": boolean,         // true when totalMatches > --max
    "candidateTruncated": boolean,// true when /_files hit its server cap
    "totalCandidates": number,    // file count returned by /_files for <ref>
    "totalMatches": number,       // ranking hits before slicing to --max
    "matches": [
      { "path": string, "score": number, "ranges": [ { "start": n, "end": n } ] }
    ]
  }

search files default text output is one path per line, best first.
Empty result prints "no matching files" to stderr and exits 0.

Parse failures and unreachable servers exit 1.

## Tips

- Prefer --json. For "code", line / column / engine / truncated drive
  follow-up scans. For "files", score / mode / ranges let you reason
  about why a match ranked where it did before opening it.
- search code: truncated=true means more matches exist beyond --max.
  Re-run with a tighter --path or a higher --max (capped at ${GREP_ABSOLUTE_MAX}).
- search code: engine=fallback with regex=true returns zero matches by
  design — the fallback path does not support regex. Install ripgrep or
  use a fixed string instead.
- search files: --term containing * or ? triggers glob mode (e.g.
  "src/**/*.test.ts"). Bare words use fuzzy ranking (e.g. "auth",
  "userId"). The /_files list is shared with the browser Ctrl+K palette,
  so .git / .code-viewer / scope-omit directories are filtered out the
  same way.
- search files truncated=true on the response means the ranking pool
  had more hits than --max; widen --max (hard cap ${FILE_SEARCH_ABSOLUTE_MAX}) or
  tighten --term to surface fewer candidates.
`;

const VALUE_FLAGS = new Set(["--term", "--ref", "--max"]);
const REPEATABLE_VALUE_FLAGS = new Set(["--path"]);
const BOOL_FLAGS = new Set(["--regex", "--json"]);

export function parseSearchArgs(argv: string[]): SearchParseResult {
  const rest: string[] = [];
  let cwd: string | undefined;
  let server: string | undefined;
  const options = new Map<string, string>();
  const paths: string[] = [];
  const flags = new Set<string>();
  const commandOverrides: ExternalCommandOverride[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      return { ok: true, args: { command: { kind: "help" } } };
    }
    if (arg === "--cwd" || arg === "--server") {
      const taken = takeValue(argv, i, arg);
      if ("error" in taken) return { ok: false, error: taken.error };
      if (arg === "--cwd") cwd = taken.value;
      else server = taken.value;
      i = taken.next;
    } else if (arg === "--bin") {
      const taken = takeValue(argv, i, arg);
      if ("error" in taken) return { ok: false, error: taken.error };
      const parsed = parseExternalCommandOverride(taken.value, "--bin", [
        "git",
      ]);
      if (parsed.ok === false) return { ok: false, error: parsed.error };
      commandOverrides.push(parsed.override);
      i = taken.next;
    } else if (REPEATABLE_VALUE_FLAGS.has(arg)) {
      const taken = takeValue(argv, i, arg);
      if ("error" in taken) return { ok: false, error: taken.error };
      paths.push(taken.value);
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

  if (subcommand !== "code" && subcommand !== "files") {
    return { ok: false, error: `unknown search subcommand: ${subcommand}` };
  }
  if (rest.length > 1) {
    return {
      ok: false,
      error: `search ${subcommand} does not accept positional argument: ${rest[1]}`,
    };
  }

  const term = options.get("--term") ?? "";
  if (!term) {
    return { ok: false, error: `search ${subcommand} requires --term <text>` };
  }
  if (/[\r\n]/.test(term)) {
    return { ok: false, error: "--term must be a single line" };
  }

  if (subcommand === "files") {
    // Reject code-only flags explicitly so command mix-ups are visible.
    if (flags.has("--regex")) {
      return {
        ok: false,
        error: "search files does not accept --regex",
      };
    }
    if (paths.length > 0) {
      return {
        ok: false,
        error: "search files does not accept --path",
      };
    }
    const maxRaw = options.get("--max");
    let max = FILE_NAME_SEARCH_DEFAULT_MAX;
    if (maxRaw !== undefined) {
      const n = Number(maxRaw);
      if (!Number.isInteger(n) || n <= 0) {
        return {
          ok: false,
          error: `--max must be a positive integer (got ${maxRaw})`,
        };
      }
      if (n > FILE_SEARCH_ABSOLUTE_MAX) {
        return {
          ok: false,
          error: `--max must be <= ${FILE_SEARCH_ABSOLUTE_MAX} (got ${n})`,
        };
      }
      max = n;
    }
    return {
      ok: true,
      args: {
        command: {
          kind: "files",
          term,
          ref: options.get("--ref"),
          max,
          json: flags.has("--json"),
        },
        cwd,
        server,
        ...(commandOverrides.length ? { commandOverrides } : {}),
      },
    };
  }

  // subcommand === "code"
  const maxRaw = options.get("--max");
  let max: number | undefined;
  if (maxRaw !== undefined) {
    const n = Number(maxRaw);
    if (!Number.isInteger(n) || n <= 0) {
      return {
        ok: false,
        error: `--max must be a positive integer (got ${maxRaw})`,
      };
    }
    if (n > GREP_ABSOLUTE_MAX) {
      return {
        ok: false,
        error: `--max must be <= ${GREP_ABSOLUTE_MAX} (got ${n})`,
      };
    }
    max = n;
  }

  return {
    ok: true,
    args: {
      command: {
        kind: "code",
        term,
        ref: options.get("--ref"),
        paths,
        regex: flags.has("--regex"),
        max,
        json: flags.has("--json"),
      },
      cwd,
      server,
      ...(commandOverrides.length ? { commandOverrides } : {}),
    },
  };
}

function buildGrepPath(
  command: Extract<SearchCommand, { kind: "code" }>,
): string {
  // /_grep の wire 契約: q=<term>&ref=<ref>&max=<n>&regex=1&path=<p>... (repeatable)。
  // URLSearchParams は同名キーの追加にも対応しているので、path もそこへ集約する。
  const params = new URLSearchParams();
  params.set("q", command.term);
  if (command.ref) params.set("ref", command.ref);
  if (command.max !== undefined) params.set("max", String(command.max));
  if (command.regex) params.set("regex", "1");
  for (const path of command.paths) params.append("path", path);
  return `/_grep?${params.toString()}`;
}

function formatMatchLine(match: {
  path: string;
  line: number;
  column: number;
  preview: string;
}): string {
  // 1 match = 1 行を維持するため、preview 中の改行は単一スペースに圧縮する。
  // server 側は行単位の match しか返さないので普段は no-op。
  const preview = match.preview.replace(/[\r\n]+/g, " ");
  return `${match.path}:${match.line}:${match.column}\t${preview}`;
}

function buildFilesPath(
  command: Extract<SearchCommand, { kind: "files" }>,
): string {
  // Do not send the term to /_files; ranking happens in this CLI with the
  // shared browser palette matcher.
  const params = new URLSearchParams();
  if (command.ref) params.set("ref", command.ref);
  const qs = params.toString();
  return qs ? `/_files?${qs}` : "/_files";
}

async function runFiles(
  serverUrl: string,
  command: Extract<SearchCommand, { kind: "files" }>,
): Promise<void> {
  const data = (await requestJson(
    serverUrl,
    buildFilesPath(command),
    "GET",
    undefined,
    "file name search",
  )) as FileSearchListResponse;

  const mode: "fuzzy" | "glob" = isGlobPathQuery(command.term)
    ? "glob"
    : "fuzzy";
  const ranked = rankPathMatches(command.term, data.files);
  const totalMatches = ranked.length;
  const truncated = ranked.length > command.max;
  const sliced = truncated ? ranked.slice(0, command.max) : ranked;

  if (command.json) {
    const payload: FileNameSearchJsonResult = {
      ref: data.ref,
      generation: data.generation,
      query: command.term,
      mode,
      truncated,
      candidateTruncated: data.truncated,
      totalCandidates: data.files.length,
      totalMatches,
      matches: sliced.map((m) => ({
        path: m.item.path,
        score: m.score,
        ranges: m.ranges,
      })),
    };
    console.log(JSON.stringify(payload, null, 2));
    return;
  }
  if (!sliced.length) {
    console.error("no matching files");
    return;
  }
  for (const m of sliced) {
    console.log(m.item.path);
  }
  if (truncated) {
    console.error(
      `truncated: showing the top ${sliced.length} of ${totalMatches} matches ` +
        `(re-run with --max <= ${FILE_SEARCH_ABSOLUTE_MAX} to widen).`,
    );
  }
  if (data.truncated) {
    console.error(
      `note: server file list was truncated at ${data.files.length} candidates; some paths may not appear.`,
    );
  }
}

async function runCode(
  serverUrl: string,
  command: Extract<SearchCommand, { kind: "code" }>,
): Promise<void> {
  const data = (await requestJson(
    serverUrl,
    buildGrepPath(command),
    "GET",
    undefined,
    "code search",
  )) as GrepResponse;

  if (command.json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  if (!data.matches.length) {
    console.error("no matches");
    return;
  }
  for (const match of data.matches) {
    console.log(formatMatchLine(match));
  }
  if (data.truncated) {
    console.error(
      `truncated: only the first ${data.matches.length} matches shown ` +
        `(re-run with a higher --max, capped at ${GREP_ABSOLUTE_MAX}).`,
    );
  }
}

export async function runSearchCli(argv: string[]): Promise<void> {
  const parsed = parseSearchArgs(argv);
  if (parsed.ok === false) {
    console.error(parsed.error);
    console.error('Run "code-viewer search --help" for usage.');
    process.exit(1);
  }
  const { command, cwd, server, commandOverrides = [] } = parsed.args;
  if (command.kind === "help") {
    console.log(SEARCH_HELP);
    return;
  }
  if (command.kind === "agent-help") {
    console.log(SEARCH_AGENT_HELP);
    return;
  }
  const commandConfig = configureExternalCommands({
    cwd: cwd || process.cwd(),
    cliOverrides: commandOverrides,
    allowedNames: ["git"],
  });
  if (commandConfig.ok === false) {
    console.error(commandConfig.error);
    process.exit(1);
  }
  const root = server ? cwd || process.cwd() : resolveRepoRoot(cwd);
  const serverUrl = await ensureServerUrl(root, server, "/");
  if (command.kind === "code") return runCode(serverUrl, command);
  if (command.kind === "files") return runFiles(serverUrl, command);
}
