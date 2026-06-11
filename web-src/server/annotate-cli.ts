import { readFileSync, realpathSync } from "node:fs";
import type {
  AnnotationEntry,
  AnnotationLineRange,
  AnnotationSession,
  AnnotationsState,
} from "../types";
import { parseAnnotationLine } from "./annotations";
import * as git from "./git";
import { readServerRegistry } from "./server-registry";

export type AnnotateCommand =
  | { kind: "help" }
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
in <repo>/.code-viewer/annotations.json. A code-viewer server must be
running for the same repository.

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

function discoverServerUrl(root: string, override?: string): string {
  if (override) return override.replace(/\/+$/, "");
  const entry = readServerRegistry(root);
  if (entry) return entry.url.replace(/\/+$/, "");
  console.error(
    "no running code-viewer server found for this repository.\n" +
      `Start one first (from ${root}):\n` +
      "  code-viewer\n" +
      "or pass --server <url> explicitly.",
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
    console.error(
      `could not reach the code-viewer server at ${serverUrl}.\n` +
        "Start one first with: code-viewer",
    );
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
  const root = resolveRepoRoot(cwd);
  const serverUrl = discoverServerUrl(root, server);

  if (command.kind === "start") {
    const result = (await request(serverUrl, "POST", {
      action: "start",
      title: command.title,
    })) as { session: AnnotationSession };
    console.log(`session ${result.session.id}  ${result.session.title}`);
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
    })) as { session_id: string; entry: AnnotationEntry };
    console.log(
      `annotated ${result.entry.path}${formatLine(result.entry.line)} ` +
        `[${result.entry.id}] in session ${result.session_id}`,
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
