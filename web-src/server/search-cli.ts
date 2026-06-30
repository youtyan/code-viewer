// `code-viewer search` subcommand. Thin CLI veneer over the running server's
// /_grep endpoint: the same engine that powers the browser's Ctrl+G palette,
// just exposed to AI agents / shell scripts. No new grep implementation is
// introduced — `web-src/server/preview.ts:handleGrep` and
// `web-src/server/search.ts` remain the single source of truth.

import type { GrepResponse } from "../core/types";
import {
  ensureServerUrl,
  requestJson,
  resolveRepoRoot,
  takeValue,
} from "./cli-helpers";
import { GREP_ABSOLUTE_MAX, GREP_DEFAULT_MAX } from "./search";

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
    };

export type SearchArgs = {
  command: SearchCommand;
  cwd?: string;
  server?: string;
};

export type SearchParseResult =
  | { ok: true; args: SearchArgs }
  | { ok: false; error: string };

export const SEARCH_HELP = `code-viewer search — code text search across the worktree or a git ref

Usage:
  code-viewer search code --term <text> [--ref <ref>] [--path <path>...]
                          [--regex] [--max <n>] [--json]
                          [--cwd <dir>] [--server <url>]
  code-viewer search --help
  code-viewer search agent-help

Options:
  --term <text>     Search term (required for "search code"). Single line.
  --ref <ref>       Git ref to search (default: worktree). Branch / commit / tag.
  --path <path>     Restrict the search to a sub-path. Repeatable.
  --regex           Treat --term as an extended regex instead of a fixed string.
  --max <n>         Maximum matches (default: ${GREP_DEFAULT_MAX}, hard cap: ${GREP_ABSOLUTE_MAX}).
  --json            Emit the raw GrepResponse JSON instead of plain lines.
  --cwd <dir>       Repository to target (default: process.cwd()).
  --server <url>    code-viewer server URL (default: auto-discover).
  --help, -h        Show this help.

Default output (one line per match):
  path:line:column\\tpreview
An empty result prints "no matches" to stderr and exits 0.

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

## Output contract

--json prints the GrepResponse verbatim (see core/types.ts):

  {
    "ref": "worktree" | "<git-ref>",
    "engine": "rg" | "git" | "fallback",
    "truncated": boolean,        // true when matches.length reaches --max
    "matches": [
      { "path": string, "line": number, "column": number, "preview": string }
    ]
  }

Default text output is one line per match:

  path:line:column<TAB>preview

When there are zero matches the command exits 0 and writes "no matches"
to stderr. Parse failures and unreachable servers exit 1.

## Tips

- Prefer --json. line / column / engine / truncated are all required to
  decide whether you need a follow-up scan.
- truncated=true means more matches exist beyond --max. Re-run with a
  tighter --path or a higher --max (capped at ${GREP_ABSOLUTE_MAX}).
- --regex uses extended regex (rg / git grep -E semantics). Anchor with
  ^ / $ and escape literal metacharacters as needed.
- engine=fallback with regex=true returns zero matches by design — the
  fallback path does not support regex. Install ripgrep or use a fixed
  string instead.
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

  if (subcommand !== "code") {
    return { ok: false, error: `unknown search subcommand: ${subcommand}` };
  }
  if (rest.length > 1) {
    return {
      ok: false,
      error: `search code does not accept positional argument: ${rest[1]}`,
    };
  }

  const term = options.get("--term") ?? "";
  if (!term) {
    return { ok: false, error: "search code requires --term <text>" };
  }
  if (/[\r\n]/.test(term)) {
    return { ok: false, error: "--term must be a single line" };
  }

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
  const { command, cwd, server } = parsed.args;
  if (command.kind === "help") {
    console.log(SEARCH_HELP);
    return;
  }
  if (command.kind === "agent-help") {
    console.log(SEARCH_AGENT_HELP);
    return;
  }
  const root = resolveRepoRoot(cwd);
  const serverUrl = await ensureServerUrl(root, server, "/");
  if (command.kind === "code") return runCode(serverUrl, command);
}
