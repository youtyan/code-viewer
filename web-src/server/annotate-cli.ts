import { readFileSync } from "node:fs";
import type {
  AnnotationDatabaseTab,
  AnnotationEntry,
  AnnotationLineRange,
  AnnotationSession,
  AnnotationsState,
} from "../core/types";
import { normalizeDatabaseTab, parseAnnotationLine } from "./annotations";
import { ensureServerUrl, resolveRepoRoot, takeValue } from "./cli-helpers";

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
      before?: string;
      after?: string;
      position?: number;
    }
  | {
      kind: "add-db";
      db?: string;
      table?: string;
      tab?: AnnotationDatabaseTab;
      gridSearch?: string;
      filters?: Array<{ column: string; value: string }>;
      sort?: { column: string; direction: "asc" | "desc" };
      row?: number;
      sql?: string;
      sqlFile?: string;
      queryMode?: "run" | "explain";
      queryAutoRun?: boolean;
      searchTerm?: string;
      includeNonText?: boolean;
      searchAutoRun?: boolean;
      title?: string;
      session?: string;
      sessionTitle?: string;
      body?: string;
      bodyFile?: string;
      before?: string;
      after?: string;
      position?: number;
    }
  | { kind: "rename"; id: string; title: string }
  | {
      kind: "edit";
      id: string;
      title?: string;
      body?: string;
      bodyFile?: string;
    }
  | {
      kind: "move";
      id: string;
      before?: string;
      after?: string;
      position?: number;
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
      [--before <id> | --after <id> | --position <n>]
      [--body <markdown> | --body-file <path>]   (or pipe body via stdin)
  code-viewer annotate add-db --db <id> [--table <name>] [--tab <tab>]
      [--grid-search <text>] [--filter <column=value>] [--sort <column:asc|desc>]
      [--sql <text> | --sql-file <path>] [--query-mode <run|explain>] [--run-query]
      [--search-term <text>] [--include-non-text] [--run-search]
      [--title <text>] [--session <id>]
      [--before <id> | --after <id> | --position <n>]
      [--body <markdown> | --body-file <path>]   (or pipe body via stdin)
  code-viewer annotate rename <session-id> --title <text>
  code-viewer annotate edit <id> [--title <text>]
      [--body <markdown> | --body-file <path>]   (or pipe body via stdin)
  code-viewer annotate move <id> [--before <id> | --after <id> | --position <n>]
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
  code-viewer annotate add-db --db app.db --table users --tab schema \\
      --body "This schema note explains how users relate to orders."
  code-viewer annotate add-db --db app.db --table orders --tab data \\
      --grid-search failed --sort created_at:desc --body "Filtered failure rows."
  code-viewer annotate add-db --db app.db --tab query \\
      --sql "select * from users where role = 'admin'" --run-query \\
      --body "This result shows the admin accounts."
  code-viewer annotate move a-123 --before a-456
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
   To insert or reorder later:
     code-viewer annotate add --after a-123 --file src/cache.ts --line 150 \\
         --body "This follow-up belongs here."
     code-viewer annotate move a-999 --before a-123
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
- add --before/--after <id> → targets the anchor annotation's session.
  If --session points at another session, the command is rejected.
- The human can share a walkthrough as a URL; one session = one shareable
  walkthrough. Do not mix unrelated topics in one session.

## Fixing mistakes and follow-ups

- The human may paste a reference block copied from the viewer that starts
  with "code-viewer のコード注釈について依頼があります" and lists the
  annotation id, location, and session, followed by their question.
  Read the current body first: code-viewer annotate list --json
- Revise a wrong annotation IN PLACE (do not delete + re-add; the id and
  its position in the walkthrough are preserved):
    code-viewer annotate edit <id> --body "<corrected markdown>"
    (long bodies: --body-file <path> or pipe via stdin; --title also works)
- Post a follow-up answer next to the original instead of replacing it:
    code-viewer annotate add --session <session-id> --file <path> --line <n> \
        --title "回答: ..." --body "<markdown>"
- Rename a session: code-viewer annotate rename <session-id> --title <text>
- Move an annotation without changing its id:
    code-viewer annotate move <id> --before <other-id>
    code-viewer annotate move <id> --after <other-id>
    code-viewer annotate move <id> --position <1-based-index>
- Annotate the Database screen:
    code-viewer annotate add-db --db <db-id> --table <table> --tab schema \\
        --title "Why this table matters" --body "<markdown>"
  Data/search/query state can be captured explicitly:
    code-viewer annotate add-db --db app.db --table orders --tab data \\
        --grid-search failed --filter status=failed --sort created_at:desc \\
        --title "Failed orders" --body "<markdown>"
    code-viewer annotate add-db --db app.db --tab query \\
        --sql "select * from orders where status = 'failed'" --run-query \\
        --title "Query result" --body "<markdown>"
    code-viewer annotate add-db --db app.db --tab search --search-term failed \\
        --include-non-text --run-search \
        --title "Global search result" --body "<markdown>"

## Cleanup

- delete <id> removes one annotation or a whole session by its id.
- clear removes everything. Ask the human before clearing state you did
  not create.
`;

function parsePosition(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : Number.NaN;
}

function parseFilter(value: string): { column: string; value: string } | null {
  const idx = value.indexOf("=");
  if (idx <= 0) return null;
  const column = value.slice(0, idx).trim();
  const filterValue = value.slice(idx + 1).trim();
  return column && filterValue ? { column, value: filterValue } : null;
}

function parseSort(
  value: string | undefined,
): { column: string; direction: "asc" | "desc" } | undefined | null {
  if (value === undefined) return undefined;
  const idx = value.lastIndexOf(":");
  if (idx <= 0) return null;
  const column = value.slice(0, idx).trim();
  const direction = value.slice(idx + 1).trim();
  return column && (direction === "asc" || direction === "desc")
    ? { column, direction }
    : null;
}

export function parseAnnotateArgs(argv: string[]): AnnotateParseResult {
  const rest: string[] = [];
  let cwd: string | undefined;
  let server: string | undefined;
  const options = new Map<string, string>();
  const multiOptions = new Map<string, string[]>();
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
    "--before",
    "--after",
    "--position",
    "--db",
    "--table",
    "--tab",
    "--grid-search",
    "--filter",
    "--sort",
    "--row",
    "--sql",
    "--sql-file",
    "--query-mode",
    "--search-term",
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
      const values = multiOptions.get(arg) || [];
      values.push(taken.value);
      multiOptions.set(arg, values);
      i = taken.next;
    } else if (
      arg === "--json" ||
      arg === "--run-query" ||
      arg === "--run-search" ||
      arg === "--include-non-text"
    ) {
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
    const position = parsePosition(options.get("--position"));
    if (Number.isNaN(position))
      return { ok: false, error: "--position must be a positive integer" };
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
          before: options.get("--before"),
          after: options.get("--after"),
          position,
        },
        cwd,
        server,
      },
    };
  }
  if (subcommand === "add-db") {
    if (!options.get("--db"))
      return { ok: false, error: "add-db requires --db <id>" };
    const body = options.get("--body");
    const bodyFile = options.get("--body-file");
    if (body !== undefined && bodyFile !== undefined)
      return { ok: false, error: "use either --body or --body-file" };
    const position = parsePosition(options.get("--position"));
    if (Number.isNaN(position))
      return { ok: false, error: "--position must be a positive integer" };
    const rawTab = options.get("--tab");
    const tab = normalizeDatabaseTab(rawTab);
    if (rawTab !== undefined && tab === undefined)
      return {
        ok: false,
        error: "--tab must be one of data, query, schema, er, search, snapshot",
      };
    const filters: Array<{ column: string; value: string }> = [];
    for (const raw of multiOptions.get("--filter") || []) {
      const parsed = parseFilter(raw);
      if (!parsed)
        return { ok: false, error: "--filter must be <column=value>" };
      filters.push(parsed);
    }
    const sort = parseSort(options.get("--sort"));
    if (sort === null)
      return { ok: false, error: "--sort must be <column:asc|desc>" };
    const row = parsePosition(options.get("--row"));
    if (Number.isNaN(row))
      return { ok: false, error: "--row must be a positive integer" };
    const sql = options.get("--sql");
    const sqlFile = options.get("--sql-file");
    if (sql !== undefined && sqlFile !== undefined)
      return { ok: false, error: "use either --sql or --sql-file" };
    const rawQueryMode = options.get("--query-mode");
    const queryMode =
      rawQueryMode === undefined || rawQueryMode === "run"
        ? "run"
        : rawQueryMode === "explain"
          ? "explain"
          : null;
    if (queryMode === null)
      return { ok: false, error: "--query-mode must be run or explain" };
    const hasDataState =
      options.has("--grid-search") ||
      filters.length > 0 ||
      sort !== undefined ||
      row !== undefined;
    const hasQueryState =
      sql !== undefined || sqlFile !== undefined || flags.has("--run-query");
    const hasSearchState =
      options.has("--search-term") ||
      flags.has("--include-non-text") ||
      flags.has("--run-search");
    if (hasDataState && !options.get("--table")) {
      return {
        ok: false,
        error: "data grid annotations require --table",
      };
    }
    if (tab === "data" && (hasQueryState || hasSearchState)) {
      return {
        ok: false,
        error: "--tab data cannot be combined with query or search options",
      };
    }
    if (tab === "query" && (hasDataState || hasSearchState)) {
      return {
        ok: false,
        error: "--tab query cannot be combined with data or search options",
      };
    }
    if (tab === "search" && (hasDataState || hasQueryState)) {
      return {
        ok: false,
        error: "--tab search cannot be combined with data or query options",
      };
    }
    return {
      ok: true,
      args: {
        command: {
          kind: "add-db",
          db: options.get("--db"),
          table: options.get("--table"),
          tab,
          gridSearch: options.get("--grid-search"),
          filters,
          sort: sort || undefined,
          row,
          sql,
          sqlFile,
          queryMode,
          queryAutoRun: flags.has("--run-query"),
          searchTerm: options.get("--search-term"),
          includeNonText: flags.has("--include-non-text") || undefined,
          searchAutoRun: flags.has("--run-search"),
          title: options.get("--title"),
          session: options.get("--session"),
          sessionTitle: options.get("--session-title"),
          body,
          bodyFile,
          before: options.get("--before"),
          after: options.get("--after"),
          position,
        },
        cwd,
        server,
      },
    };
  }
  if (subcommand === "rename") {
    const id = rest[1];
    if (!id) return { ok: false, error: "rename requires a session id" };
    const title = options.get("--title");
    if (!title) return { ok: false, error: "rename requires --title <text>" };
    return {
      ok: true,
      args: { command: { kind: "rename", id, title }, cwd, server },
    };
  }
  if (subcommand === "edit") {
    const id = rest[1];
    if (!id) return { ok: false, error: "edit requires an annotation id" };
    const body = options.get("--body");
    const bodyFile = options.get("--body-file");
    if (body !== undefined && bodyFile !== undefined)
      return { ok: false, error: "use either --body or --body-file" };
    return {
      ok: true,
      args: {
        command: {
          kind: "edit",
          id,
          title: options.get("--title"),
          body,
          bodyFile,
        },
        cwd,
        server,
      },
    };
  }
  if (subcommand === "move") {
    const id = rest[1];
    if (!id) return { ok: false, error: "move requires an annotation id" };
    const position = parsePosition(options.get("--position"));
    if (Number.isNaN(position))
      return { ok: false, error: "--position must be a positive integer" };
    if (
      !options.get("--before") &&
      !options.get("--after") &&
      position === undefined
    )
      return {
        ok: false,
        error: "move requires --before, --after, or --position",
      };
    return {
      ok: true,
      args: {
        command: {
          kind: "move",
          id,
          before: options.get("--before"),
          after: options.get("--after"),
          position,
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

async function annotationBodyFromCommand(command: {
  body?: string;
  bodyFile?: string;
}): Promise<string> {
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
  return body;
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
  const serverUrl = await ensureServerUrl(root, server, "/_annotations");

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
    const body = await annotationBodyFromCommand(command);
    const result = (await request(serverUrl, "POST", {
      action: "add",
      session_id: command.session,
      session_title: command.sessionTitle,
      path: command.file,
      line: command.line,
      range: { from: command.from, to: command.to },
      title: command.title,
      body,
      before_id: command.before,
      after_id: command.after,
      position: command.position,
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
  if (command.kind === "add-db") {
    const body = await annotationBodyFromCommand(command);
    let sql = command.sql;
    if (sql === undefined && command.sqlFile !== undefined) {
      try {
        sql = readFileSync(command.sqlFile, "utf8");
      } catch {
        console.error(`could not read --sql-file: ${command.sqlFile}`);
        process.exit(1);
      }
    }
    const dataState =
      command.gridSearch ||
      (command.filters && command.filters.length > 0) ||
      command.sort ||
      command.row
        ? {
            search: command.gridSearch,
            filters: command.filters,
            sort: command.sort,
            row: command.row,
          }
        : undefined;
    const queryState =
      sql || command.queryAutoRun
        ? {
            sql,
            mode: command.queryMode,
            autoRun: command.queryAutoRun,
          }
        : undefined;
    const searchState =
      command.searchTerm || command.includeNonText
        ? {
            term: command.searchTerm,
            includeNonText: command.includeNonText,
            autoRun: command.searchAutoRun,
          }
        : undefined;
    const inferredTab =
      command.tab ||
      (queryState
        ? "query"
        : searchState
          ? "search"
          : dataState
            ? "data"
            : undefined);
    const result = (await request(serverUrl, "POST", {
      action: "add",
      session_id: command.session,
      session_title: command.sessionTitle,
      target: {
        kind: "database",
        db: command.db,
        table: command.table,
        tab: inferredTab,
        data: dataState,
        query: queryState,
        search: searchState,
      },
      title: command.title,
      body,
      before_id: command.before,
      after_id: command.after,
      position: command.position,
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
      `annotated ${result.entry.path} ` +
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
  if (command.kind === "rename") {
    await request(serverUrl, "POST", {
      action: "rename",
      id: command.id,
      title: command.title,
    });
    console.log(`renamed session ${command.id} to "${command.title}"`);
    return;
  }
  if (command.kind === "edit") {
    let bodyText = command.body;
    if (command.bodyFile !== undefined)
      bodyText = readFileSync(command.bodyFile, "utf8");
    if (bodyText === undefined) {
      const stdin = await readStdin();
      if (stdin.trim()) bodyText = stdin;
    }
    if (bodyText === undefined && command.title === undefined) {
      console.error("edit requires --title, --body, --body-file, or stdin");
      process.exit(1);
    }
    const result = (await request(serverUrl, "POST", {
      action: "update",
      id: command.id,
      title: command.title,
      body: bodyText,
    })) as { entry: AnnotationEntry };
    console.log(
      `updated annotation ${result.entry.id} (${result.entry.path}${formatLine(result.entry.line)})`,
    );
    return;
  }
  if (command.kind === "move") {
    const result = (await request(serverUrl, "POST", {
      action: "move",
      id: command.id,
      before_id: command.before,
      after_id: command.after,
      position: command.position,
    })) as { entry: AnnotationEntry; session_id: string };
    console.log(
      `moved annotation ${result.entry.id} to session ${result.session_id}`,
    );
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
