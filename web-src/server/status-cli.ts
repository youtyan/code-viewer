// `code-viewer status` — local "orient me" snapshot for the current repo.
//
// Mirrors the data the browser home page already shows (changed files vs
// HEAD + recent commits + current branch + remote URL) so that an AI
// coding agent can pull the same state from a single CLI call.
//
// Pattern parity with `file-cli.ts`:
//   - No HTTP fetch, no SQLite preflight, no running server required.
//   - All git plumbing reuses helpers from `./git`; this module never
//     spawns its own `git` subprocess.
//   - nextCommands optionally pin `--server '<url>'` via
//     readServerRegistry when a server is registered for this repo.
//     Falls through cleanly when no server is registered.

import {
  resolveRepoRoot,
  shellSingleQuote,
  takeValue,
  validateRefValue,
  validateRepoRelativePathValue,
} from "./cli-helpers";
import {
  configureExternalCommands,
  type ExternalCommandOverride,
  parseExternalCommandOverride,
} from "./command-resolver";
import {
  commitHistory,
  currentBranch,
  fileMetaResult,
  type GitFileMeta,
  type GitHistoryCommit,
  remoteWebUrl,
} from "./git";
import { readServerRegistry } from "./server-registry";

export const STATUS_DEFAULT_LIMIT = 10;
export const STATUS_HARD_CAP_LIMIT = 100;
export const STATUS_DEFAULT_REF = "HEAD";

export const STATUS_HELP = `code-viewer status — snapshot the current repo for AI agents

Usage:
  code-viewer status [--cwd <repo>] [--bin git=<path>] [--ref <ref>] [--limit <N>] [--json]
  code-viewer status agent-help

Options:
  --cwd <repo>    Repository to inspect (default: current directory).
  --bin git=<p>   Override git executable path.
  --ref <ref>     Ref to read recent commits from (default: ${STATUS_DEFAULT_REF}).
  --limit <N>     Recent commits to include (default: ${STATUS_DEFAULT_LIMIT}, max ${STATUS_HARD_CAP_LIMIT}).
  --json          Emit a structured JSON payload instead of plain text.
  --help, -h      Show this help.

Run "code-viewer status agent-help" for an AI-agent oriented guide.

Examples:
  code-viewer status
  code-viewer status --json
  code-viewer status --ref main --limit 20 --json
  code-viewer status --cwd /path/to/repo --json
`;

export const STATUS_AGENT_HELP = `code-viewer status — agent guide

You are an AI coding agent. Run this command as the FIRST step when you
open a repository so you can orient yourself without firing five separate
shell commands. It is a thin local wrapper over the same git helpers the
browser home page uses — no server, no SQLite, no docker required.

## What it tells you

- repoRoot / branch / remoteWebUrl: where you are.
- changed: every file that differs from HEAD (staged + unstaged + new),
  with status / additions / deletions. This is the diff a user would see
  in the browser's home page.
- staged: the subset of those changes that is already in the index, so
  you can decide whether to extend a commit or start a fresh one.
- recentCommits: the most recent commits on --ref (default HEAD), so you
  can summarise context without reading git log yourself.
- nextCommands: a paste-safe shortlist of follow-up CLI calls based on
  what you just saw. Server-backed commands pin --server '<url>' when a
  code-viewer server is registered for this repo; local commands stay
  bare because they do not accept --server.

## Output contract

- default text: one section per topic. Each section is human-readable
  AND grep-able (no JSON parsing required for casual triage).
- --json: a single JSON object with these keys, all always present:
  { repoRoot, branch, remoteWebUrl, changed, staged, recentCommits,
    nextCommands }
  changed / staged share shape { files: GitFileMeta[], totals: { files,
  additions, deletions }, error? } so AI can iterate both the same way.
  recentCommitsError is present when --ref cannot resolve; the command
  still emits changed / staged / nextCommands and exits 0.
- exit 0 on success. exit 1 on argument errors, when --cwd does not
  resolve to a directory, or when changed / staged git collection fails.

## Suggested usage

1. code-viewer status --json        # orient
2. read changed[] / nextCommands[]  # decide what to do
3. paste a nextCommands line        # drill in via file/search/query
`;

const VALUE_FLAGS = new Set(["--ref", "--limit"]);
const BOOL_FLAGS = new Set(["--json"]);

export type StatusCommand =
  | { kind: "help" }
  | { kind: "agent-help" }
  | {
      kind: "run";
      ref: string;
      limit: number;
      json: boolean;
    };

export type StatusArgs = {
  command: StatusCommand;
  cwd?: string;
  commandOverrides?: ExternalCommandOverride[];
};

export type StatusParseResult =
  | { ok: true; args: StatusArgs }
  | { ok: false; error: string };

function parseLimit(raw: string): { value: number } | { error: string } {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > STATUS_HARD_CAP_LIMIT) {
    return {
      error: `--limit must be an integer in [1, ${STATUS_HARD_CAP_LIMIT}] (got ${raw})`,
    };
  }
  return { value: n };
}

export function parseStatusArgs(argv: string[]): StatusParseResult {
  let cwd: string | undefined;
  const options = new Map<string, string>();
  const flags = new Set<string>();
  const positional: string[] = [];
  const commandOverrides: ExternalCommandOverride[] = [];

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
    } else if (arg === "--bin") {
      const taken = takeValue(argv, i, arg);
      if ("error" in taken) return { ok: false, error: taken.error };
      const parsed = parseExternalCommandOverride(taken.value, "--bin", [
        "git",
      ]);
      if (parsed.ok === false) return { ok: false, error: parsed.error };
      commandOverrides.push(parsed.override);
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
      positional.push(arg);
    }
  }

  if (positional.length > 0) {
    const head = positional[0];
    if (head === "agent-help") {
      if (positional.length > 1 || options.size > 0 || flags.size > 0) {
        return {
          ok: false,
          error: "agent-help does not accept arguments",
        };
      }
      return { ok: true, args: { command: { kind: "agent-help" } } };
    }
    return {
      ok: false,
      error: `status does not accept positional argument: ${head}`,
    };
  }

  const ref = options.get("--ref") ?? STATUS_DEFAULT_REF;
  const refError = validateRefValue(ref, "--ref");
  if (refError) return { ok: false, error: refError };

  let limit = STATUS_DEFAULT_LIMIT;
  if (options.has("--limit")) {
    const parsed = parseLimit(options.get("--limit") ?? "");
    if ("error" in parsed) return { ok: false, error: parsed.error };
    limit = parsed.value;
  }

  return {
    ok: true,
    args: {
      command: {
        kind: "run",
        ref,
        limit,
        json: flags.has("--json"),
      },
      cwd,
      ...(commandOverrides.length ? { commandOverrides } : {}),
    },
  };
}

export type StatusGroup = {
  files: GitFileMeta[];
  totals: { files: number; additions: number; deletions: number };
  error?: string;
};

// JSON output shape AI agents consume (mirrors the CLI's `--json` payload).
// Keep the field set 1:1 with STATUS_AGENT_HELP so the CLI guide and the
// MCP tool guide stay in sync without duplicate documentation.
export type StatusReport = {
  repoRoot: string;
  branch: string | null;
  remoteWebUrl: string | null;
  changed: StatusGroup;
  staged: StatusGroup;
  recentCommits: GitHistoryCommit[];
  recentCommitsError?: string;
  nextCommands: string[];
};

function sumTotals(files: GitFileMeta[]): StatusGroup["totals"] {
  let additions = 0;
  let deletions = 0;
  for (const file of files) {
    additions += file.additions || 0;
    deletions += file.deletions || 0;
  }
  return { files: files.length, additions, deletions };
}

function buildGroup(files: GitFileMeta[], error?: string): StatusGroup {
  // Sort by path so AI gets a stable order regardless of git output order.
  const sorted = [...files].sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  );
  return {
    files: sorted,
    totals: sumTotals(sorted),
    ...(error ? { error } : {}),
  };
}

function metaPathKey(file: GitFileMeta): string {
  return `${file.old_path || ""}\0${file.path}`;
}

function mergeMissingByPath(
  primary: GitFileMeta[],
  fallback: GitFileMeta[],
): GitFileMeta[] {
  const seen = new Set(primary.map(metaPathKey));
  const merged = [...primary];
  for (const file of fallback) {
    const key = metaPathKey(file);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(file);
  }
  return merged;
}

function isMissingDiffBaseError(error: string | undefined): boolean {
  return (
    !!error && /ambiguous argument 'HEAD'|bad revision 'HEAD'/i.test(error)
  );
}

// Compose a paste-safe `code-viewer <subcommand>` line.
//   - server URL is optional. When present, --server '<url>' is pinned
//     so paste-into-another-shell does not silently fall back to
//     auto-discovery (mirrors the query CLI's --commands behaviour).
//   - every variable segment is wrapped in shellSingleQuote so paths
//     with spaces / quotes / `$` survive bash and zsh paste.
function joinCli(parts: string[], serverUrl: string | null): string {
  const head = parts[0];
  const tail = parts.slice(1).join(" ");
  if (serverUrl) {
    return `${head} --server ${shellSingleQuote(serverUrl)} ${tail}`;
  }
  return `${head} ${tail}`;
}

function buildNextCommands(
  changed: StatusGroup,
  staged: StatusGroup,
  serverUrl: string | null,
): string[] {
  const cmds: string[] = [];
  // Pick the first changed path (if any) as a paste-safe drill-down hint
  // for file history. We deliberately do NOT enumerate every changed
  // file — the list is meant to spark next moves, not exhaustively cover
  // them. AI / human will paste-and-edit the path when needed.
  const sampleChanged =
    [...staged.files, ...changed.files].find(
      (file) => !validateRepoRelativePathValue(file.path, "--path"),
    )?.path ?? null;
  if (sampleChanged) {
    cmds.push(
      joinCli(
        [
          "code-viewer file history",
          `--path ${shellSingleQuote(sampleChanged)}`,
          "--limit 10",
          "--json",
        ],
        null,
      ),
    );
  }
  // search code is the canonical "look across the repo" hint and is
  // always useful regardless of git state — surface a TODO scan as the
  // most generic default. AI can edit --term freely.
  cmds.push(
    joinCli(["code-viewer search code", "--term 'TODO'", "--json"], serverUrl),
  );
  // query sources discovers SQLite / docker compose datastores. This is
  // the entry point for the entire query CLI (--commands then emits per
  // source paste-safe lines). It needs a running server, so emit it only
  // when one is registered for this repo.
  if (serverUrl) {
    cmds.push(joinCli(["code-viewer query sources", "--commands"], serverUrl));
  }
  return cmds;
}

function statusGlyph(file: GitFileMeta): string {
  if (file.untracked) return "??";
  const code = file.status?.[0] ?? "?";
  // nameStatus() normalizes rename/copy statuses to their first letter, so
  // every tracked glyph is one char. Pad it to align with "??".
  return `${code} `;
}

function formatChangedLine(file: GitFileMeta): string {
  const glyph = statusGlyph(file);
  const adds = file.additions || 0;
  const dels = file.deletions || 0;
  const tag = file.binary
    ? "binary"
    : file.untracked
      ? "untracked"
      : `+${adds} / -${dels}`;
  const path = file.old_path ? `${file.old_path} -> ${file.path}` : file.path;
  return `  ${glyph} ${path}\t${tag}`;
}

function formatGroupText(label: string, group: StatusGroup): string[] {
  const lines: string[] = [];
  const totals = group.totals;
  const summary =
    totals.files === 0
      ? `${label}: 0 files`
      : `${label}: ${totals.files} files (+${totals.additions} / -${totals.deletions})`;
  lines.push(summary);
  if (group.error) lines.push(`  # error: ${group.error}`);
  for (const file of group.files) lines.push(formatChangedLine(file));
  return lines;
}

function formatRecentText(commits: GitHistoryCommit[]): string[] {
  if (commits.length === 0) return ["recent commits: (none)"];
  const lines: string[] = [`recent commits: ${commits.length}`];
  for (const c of commits) {
    lines.push(`  ${c.sha.slice(0, 8)}\t${c.when}\t${c.author}\t${c.subject}`);
  }
  return lines;
}

// Pure assembly of the StatusReport that the CLI's --json output and the
// MCP `code_viewer_status` tool both emit. Reading from git/registry is
// allowed; throwing / process.exit / console.* are NOT — the caller
// decides how to surface results so this stays reusable.
export function buildStatusReport(opts: {
  root: string;
  ref: string;
  limit: number;
}): StatusReport {
  const { root, ref, limit } = opts;
  // `changed` = worktree vs HEAD (staged + unstaged + untracked). We pin
  // the explicit "HEAD" arg so the snapshot answers "what has moved
  // since the last commit?", which is the orient question. With no ref
  // arg, git diff is worktree-vs-index — that would silently miss
  // staged-only changes from the summary.
  const stagedResult = fileMetaResult(["--cached"], root, false);
  const changedResult = fileMetaResult(["HEAD"], root, true);
  const worktreeFallbackResult = isMissingDiffBaseError(changedResult.error)
    ? fileMetaResult([], root, true)
    : null;
  const stagedFiles = stagedResult.files;
  const changedFiles = changedResult.error
    ? worktreeFallbackResult
      ? mergeMissingByPath(worktreeFallbackResult.files, stagedFiles)
      : []
    : mergeMissingByPath(changedResult.files, stagedFiles);
  const changed = buildGroup(
    changedFiles,
    worktreeFallbackResult
      ? worktreeFallbackResult.error || stagedResult.error
      : changedResult.error || stagedResult.error,
  );
  const staged = buildGroup(stagedFiles, stagedResult.error);
  const history = commitHistory(root, { ref, skip: 0, limit });
  const branch = currentBranch(root);
  const remote = remoteWebUrl(root);
  const registry = readServerRegistry(root);
  const serverUrl = registry?.url ?? null;
  const nextCommands = buildNextCommands(changed, staged, serverUrl);
  return {
    repoRoot: root,
    branch,
    remoteWebUrl: remote,
    changed,
    staged,
    recentCommits: history.commits,
    ...(history.error ? { recentCommitsError: history.error } : {}),
    nextCommands,
  };
}

// Pure text formatting from a StatusReport. Same source-of-truth as
// buildStatusReport so the CLI text and any future MCP text-mode share one
// layout; tests pin both shapes here.
export function formatStatusReportText(report: StatusReport): string {
  const lines: string[] = [];
  lines.push(`repo:   ${report.repoRoot}`);
  lines.push(`branch: ${report.branch ?? "(detached)"}`);
  lines.push(`remote: ${report.remoteWebUrl ?? "(none)"}`);
  lines.push("");
  for (const l of formatGroupText("changed (worktree vs HEAD)", report.changed))
    lines.push(l);
  lines.push("");
  for (const l of formatGroupText("staged (index vs HEAD)", report.staged))
    lines.push(l);
  lines.push("");
  for (const l of formatRecentText(report.recentCommits)) lines.push(l);
  if (report.recentCommitsError)
    lines.push(`  # error: ${report.recentCommitsError}`);
  lines.push("");
  lines.push("next steps:");
  for (const cmd of report.nextCommands) lines.push(`  ${cmd}`);
  return lines.join("\n");
}

export function runStatusCli(argv: string[]): void {
  const parsed = parseStatusArgs(argv);
  if (parsed.ok === false) {
    console.error(parsed.error);
    console.error('Run "code-viewer status --help" for usage.');
    process.exit(1);
  }
  const { command, cwd, commandOverrides = [] } = parsed.args;
  if (command.kind === "help") {
    console.log(STATUS_HELP);
    return;
  }
  if (command.kind === "agent-help") {
    console.log(STATUS_AGENT_HELP);
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
  const root = resolveRepoRoot(cwd);
  const report = buildStatusReport({
    root,
    ref: command.ref,
    limit: command.limit,
  });

  if (command.json) {
    console.log(JSON.stringify(report, null, 2));
    if (report.changed.error || report.staged.error) process.exit(1);
    return;
  }

  console.log(formatStatusReportText(report));
  if (report.changed.error || report.staged.error) process.exit(1);
}
