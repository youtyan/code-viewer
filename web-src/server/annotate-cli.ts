import { readFileSync, realpathSync } from "node:fs";
import type {
  AnnotationEntry,
  AnnotationLineRange,
  AnnotationSession,
  AnnotationsState,
} from "../core/types";
import { parseAnnotationLine } from "./annotations";
import * as git from "./git";
import { readServerRegistry } from "./server-registry";

export type AnnotateCommand =
  | { kind: "help" }
  | { kind: "agent-help" }
  | { kind: "start"; title: string }
  | {
      kind: "add";
      file: string;
      line?: AnnotationLineRange;
      from?: string;
      to?: string;
      title?: string;
      session?: string;
      sessionTitle?: string;
      body?: string;
      bodyFile?: string;
    }
  | { kind: "list"; json: boolean }
  | { kind: "delete"; id: string }
  | { kind: "clear" };

export type AnnotateArgs = {
  command: AnnotateCommand;
  cwd?: string;
  server?: string;
};

export type AnnotateParseResult =
  | { ok: true; args: AnnotateArgs }
  | { ok: false; error: string };

export const ANNOTATE_HELP = `code-viewer annotate — attach explanations to code locations

The annotations show up live in the code-viewer browser UI and are stored
in <repo>/.code-viewer/annotations.json. A running code-viewer server for
the repository is required: start one with "code-viewer" before using
annotate (or point at one explicitly with --server).

Run "code-viewer annotate agent-help" for an AI-agent oriented guide
(workflow, conventions, and pitfalls for writing good walkthroughs).

Usage:
  code-viewer annotate start [--title <text>]
  code-viewer annotate add --file <path> [--line <n>|<n>-<m>]
      [--from <ref>] [--to <ref>] [--title <text>] [--session <id>]
      [--body <markdown> | --body-file <path>]   (or pipe body via stdin)
  code-viewer annotate list [--json]
  code-viewer annotate delete <id>
  code-viewer annotate clear

Global options:
  --cwd <dir>      repository to annotate (default: current directory)
  --server <url>   code-viewer server URL (default: auto-discovered)

Examples:
  code-viewer annotate start --title "How SSE updates work"
  code-viewer annotate add --file web-src/server/preview.ts --line 2220-2250 \\
      --body "This endpoint keeps one SSE stream per browser tab."
  git diff HEAD~1 | code-viewer annotate add --file src/app.ts --line 10 \\
      --from HEAD~1 --to worktree --body "The fix moves the guard up here."
`;

export const ANNOTATE_AGENT_HELP = `code-viewer annotate — agent guide

You are an AI coding agent. Use this tool to walk a human through code in
their browser: each annotation jumps every open code-viewer tab to a file
location and renders your explanation directly under the annotated lines.

## When to use

- Explaining a change you just made (per-file, per-hunk commentary)
- Guiding a code review: point at the risky lines, in reading order
- Onboarding walkthroughs: "how does feature X flow through the code"

## Requirements

- A code-viewer server must already be running for the repository
  (the human starts it with: code-viewer). This command never starts one.
- Run from inside the repository, or pass --cwd <repo>.
- If "code-viewer" is not on PATH (e.g. the human runs it via npx), invoke
  every command below as: npx -y @youtyan/code-viewer annotate ...

## Workflow

1. Start a session per walkthrough topic. The title is shown to the human:
     code-viewer annotate start --title "How the cache invalidation works"
2. Add annotations in READING ORDER (the order you want the human to
   follow). Each add without --session appends to the most recent session:
     code-viewer annotate add --file src/cache.ts --line 120-145 \\
         --title "Entry point" --body "Writes land here first. ..."
3. Verify what you posted:
     code-viewer annotate list

## Conventions for good walkthroughs

- One idea per annotation. Prefer 5-10 focused annotations over 2 huge ones.
- Always pass --line. Use the smallest range that covers the idea; the
  body is rendered inline directly under the LAST line of the range.
- Line numbers must match the "to" side of the range (default: the current
  worktree state of the file). When annotating a diff against another ref,
  pass --from/--to and use NEW-side line numbers.
- The body is Markdown. Code spans, fenced blocks, and links work. Long
  bodies: use --body-file <path> or pipe via stdin instead of --body.
- Give every annotation a short --title; it becomes the inline heading.
- Annotating unchanged code is fine: the viewer auto-expands diff context
  or falls back to the full source view.

## Sessions

- add (no --session) → appends to the most recent session.
- annotate start      → begins a NEW session; later adds go there.
- add --session <id>  → targets a specific session (ids: annotate list).
- The human can share a walkthrough as a URL; one session = one shareable
  walkthrough. Do not mix unrelated topics in one session.

## Cleanup

- delete <id> removes one annotation or a whole session by its id.
- clear removes everything. Ask the human before clearing state you did
  not create.
`;

function takeValue(
  argv: string[],
  index: number,
  flag: string,
): { value: string; next: number } | { error: string } {
  const value = argv[index + 1];
  if (value === undefined) return { error: `${flag} requires a value` };
  return { value, next: index + 1 };
}

export function parseAnnotateArgs(argv: string[]): AnnotateParseResult {
  const rest: string[] = [];
  let cwd: string | undefined;
  let server: string | undefined;
  const options = new Map<string, string>();
  const flags = new Set<string>();
  const valueFlags = new Set([
    "--title",
    "--file",
    "--line",
    "--from",
    "--to",
    "--session",
    "--session-title",
    "--body",
    "--body-file",
  ]);

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h")
      return { ok: true, args: { command: { kind: "help" } } };
    if (arg === "--cwd" || arg === "--server") {
      const taken = takeValue(argv, i, arg);
      if ("error" in taken) return { ok: false, error: taken.error };
      if (arg === "--cwd") cwd = taken.value;
      else server = taken.value;
      i = taken.next;
    } else if (valueFlags.has(arg)) {
      const taken = takeValue(argv, i, arg);
      if ("error" in taken) return { ok: false, error: taken.error };
      options.set(arg, taken.value);
      i = taken.next;
    } else if (arg === "--json") {
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
    return { ok: true, args: { command: { kind: "agent-help" } } };
  }
  if (subcommand === "start") {
    return {
      ok: true,
      args: {
        command: { kind: "start", title: options.get("--title") || "" },
        cwd,
        server,
      },
    };
  }
  if (subcommand === "add") {
    const file = options.get("--file");
    if (!file) return { ok: false, error: "add requires --file <path>" };
    let line: AnnotationLineRange | undefined;
    const rawLine = options.get("--line");
    if (rawLine !== undefined) {
      line = parseAnnotationLine(rawLine);
      if (!line) return { ok: false, error: "--line must be <n> or <n>-<m>" };
    }
    const body = options.get("--body");
    const bodyFile = options.get("--body-file");
    if (body !== undefined && bodyFile !== undefined)
      return { ok: false, error: "use either --body or --body-file" };
    return {
      ok: true,
      args: {
        command: {
          kind: "add",
          file,
          line,
          from: options.get("--from"),
          to: options.get("--to"),
          title: options.get("--title"),
          session: options.get("--session"),
          sessionTitle: options.get("--session-title"),
          body,
          bodyFile,
        },
        cwd,
        server,
      },
    };
  }
  if (subcommand === "list") {
    return {
      ok: true,
      args: {
        command: { kind: "list", json: flags.has("--json") },
        cwd,
        server,
      },
    };
  }
  if (subcommand === "delete") {
    const id = rest[1];
    if (!id) return { ok: false, error: "delete requires an id" };
    return { ok: true, args: { command: { kind: "delete", id }, cwd, server } };
  }
  if (subcommand === "clear") {
    return { ok: true, args: { command: { kind: "clear" }, cwd, server } };
  }
  return { ok: false, error: `unknown annotate command: ${subcommand}` };
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function resolveRepoRoot(cwdOption: string | undefined): string {
  const base = cwdOption || process.cwd();
  try {
    return git.repoRoot(base) || realpathSync(base);
  } catch {
    console.error(`--cwd must point to an existing directory: ${base}`);
    process.exit(1);
  }
}

async function serverReachable(serverUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${serverUrl}/_annotations`, {
      signal: AbortSignal.timeout(1500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// Reuse a running server for this repository when one is registered and
// reachable. The CLI never starts a server itself — ask the user to run one.
async function ensureServerUrl(
  root: string,
  override?: string,
): Promise<string> {
  if (override) {
    const url = override.replace(/\/+$/, "");
    if (await serverReachable(url)) return url;
    console.error(`could not reach the code-viewer server at ${url}.`);
    process.exit(1);
  }
  const registered = readServerRegistry(root);
  if (registered) {
    const url = registered.url.replace(/\/+$/, "");
    if (await serverReachable(url)) return url;
  }
  console.error(
    "no running code-viewer server for this repository.\n" +
      `Start one manually (from ${root}):\n` +
      "  code-viewer",
  );
  process.exit(1);
}

async function request(
  serverUrl: string,
  method: "GET" | "POST",
  body?: unknown,
): Promise<unknown> {
  const url = `${serverUrl}/_annotations`;
  const origin = new URL(serverUrl).origin;
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers:
        method === "POST"
          ? {
              "Content-Type": "application/json",
              Origin: origin,
              "X-Code-Viewer-Action": "1",
            }
          : {},
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    console.error(`could not reach the code-viewer server at ${serverUrl}.`);
    process.exit(1);
  }
  if (!res.ok) {
    console.error(`server rejected the request: ${await res.text()}`);
    process.exit(1);
  }
  return res.json();
}

function formatLine(line?: AnnotationLineRange): string {
  if (!line) return "";
  return line.start === line.end
    ? `:${line.start}`
    : `:${line.start}-${line.end}`;
}

function printList(state: AnnotationsState): void {
  if (!state.sessions.length) {
    console.log("no annotations");
    return;
  }
  for (const session of state.sessions) {
    console.log(`session ${session.id}  ${session.title}`);
    session.entries.forEach((entry: AnnotationEntry, index: number) => {
      const location = `${entry.path}${formatLine(entry.line)}`;
      const summary = (entry.title || entry.body).split("\n")[0].slice(0, 80);
      console.log(`  ${index + 1}. [${entry.id}] ${location}  ${summary}`);
    });
  }
}

export async function runAnnotateCli(argv: string[]): Promise<void> {
  const parsed = parseAnnotateArgs(argv);
  if (parsed.ok === false) {
    console.error(parsed.error);
    console.error('Run "code-viewer annotate --help" for usage.');
    process.exit(1);
  }
  const { command, cwd, server } = parsed.args;
  if (command.kind === "help") {
    console.log(ANNOTATE_HELP);
    return;
  }
  if (command.kind === "agent-help") {
    console.log(ANNOTATE_AGENT_HELP);
    return;
  }
  const root = resolveRepoRoot(cwd);
  const serverUrl = await ensureServerUrl(root, server);

  if (command.kind === "start") {
    const result = (await request(serverUrl, "POST", {
      action: "start",
      title: command.title,
    })) as { session: AnnotationSession };
    console.log(`session ${result.session.id}  ${result.session.title}`);
    console.error(
      `view annotations at ${serverUrl}/ with the code annotations panel`,
    );
    return;
  }
  if (command.kind === "add") {
    let body = command.body;
    if (body === undefined && command.bodyFile !== undefined) {
      try {
        body = readFileSync(command.bodyFile, "utf8");
      } catch {
        console.error(`could not read --body-file: ${command.bodyFile}`);
        process.exit(1);
      }
    }
    if (body === undefined) body = await readStdin();
    if (!body.trim()) {
      console.error(
        "annotation body is empty. Pass --body, --body-file, or pipe stdin.",
      );
      process.exit(1);
    }
    const result = (await request(serverUrl, "POST", {
      action: "add",
      session_id: command.session,
      session_title: command.sessionTitle,
      path: command.file,
      line: command.line,
      range: { from: command.from, to: command.to },
      title: command.title,
      body,
    })) as {
      session_id: string;
      session_title?: string;
      created_session?: boolean;
      entry: AnnotationEntry;
    };
    if (result.created_session) {
      console.error(
        `created new annotation session ${result.session_id} (${result.session_title || "Untitled session"})`,
      );
    }
    console.log(
      `annotated ${result.entry.path}${formatLine(result.entry.line)} ` +
        `[${result.entry.id}] in session ${result.session_id} (${result.session_title || "Untitled session"})`,
    );
    console.error(
      `view annotations at ${serverUrl}/ with the code annotations panel`,
    );
    return;
  }
  if (command.kind === "list") {
    const state = (await request(serverUrl, "GET")) as AnnotationsState;
    if (command.json) console.log(JSON.stringify(state, null, 2));
    else printList(state);
    return;
  }
  if (command.kind === "delete") {
    const result = (await request(serverUrl, "POST", {
      action: "delete",
      id: command.id,
    })) as { removed: string | null };
    if (!result.removed) {
      console.error(`no annotation or session with id ${command.id}`);
      process.exit(1);
    }
    console.log(`deleted ${result.removed} ${command.id}`);
    return;
  }
  await request(serverUrl, "POST", { action: "clear" });
  console.log("cleared all annotations");
}
