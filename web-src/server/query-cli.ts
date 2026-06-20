import { realpathSync } from "node:fs";
import * as git from "./git";
import { readServerRegistry } from "./server-registry";

export type QueryCommand =
  | { kind: "help" }
  | { kind: "agent-help" }
  | {
      kind: "exec";
      db: string;
      sql: string;
      title?: string;
      body?: string;
      save: boolean;
      maxRows?: number;
    }
  | { kind: "list"; json: boolean; db?: string }
  | { kind: "clear"; db?: string }
  | {
      kind: "search";
      db: string;
      term: string;
      tables?: string[];
      includeNonText: boolean;
      maxHitsPerTable?: number;
    }
  | {
      kind: "snapshot-create";
      db: string;
      tables?: string[];
      note: string;
    }
  | { kind: "snapshot-list"; db?: string; json: boolean }
  | { kind: "snapshot-delete"; id: string }
  | { kind: "snapshot-note"; id: string; note: string }
  | {
      kind: "diff-create";
      beforeId: string;
      afterId: string;
      note: string;
    }
  | { kind: "diff-list"; db?: string; json: boolean }
  | { kind: "diff-tables"; id: string }
  | {
      kind: "diff-rows";
      id: string;
      table: string;
      type?: string;
      limit?: number;
    }
  | { kind: "diff-delete"; id: string };

export type QueryArgs = {
  command: QueryCommand;
  cwd?: string;
  server?: string;
};

export type QueryParseResult =
  | { ok: true; args: QueryArgs }
  | { ok: false; error: string };

export const QUERY_HELP = `code-viewer query — execute read-only SQL queries against local databases

Usage:
  code-viewer query exec --db <path> --sql <sql> [--title <text>] [--body <markdown>] [--no-save] [--max-rows <n>]
  code-viewer query list [--json] [--db <path>]
  code-viewer query clear [--db <path>]
  code-viewer query search --db <path> --term <text> [--tables t1,t2,...] [--include-non-text] [--max-hits <n>]
  code-viewer query snapshot create --db <path> [--tables t1,t2,...] [--note <text>]
  code-viewer query snapshot list [--json] [--db <path>]
  code-viewer query snapshot delete --id <snapshot-id>
  code-viewer query snapshot note --id <snapshot-id> --note <text>
  code-viewer query diff create --before <id> --after <id> [--note <text>]
  code-viewer query diff list [--json] [--db <path>]
  code-viewer query diff tables --id <diff-id>
  code-viewer query diff rows --id <diff-id> --table <name> [--type inserted|updated|deleted] [--limit <n>]
  code-viewer query diff delete --id <diff-id>
  code-viewer query agent-help

Global options:
  --cwd <dir>      repository directory (default: current directory)
  --server <url>   code-viewer server URL (default: auto-discovered)

Examples:
  code-viewer query exec --db data.sqlite3 --sql "SELECT * FROM users LIMIT 10"
  code-viewer query search --db app.db --term "john@example.com"
  code-viewer query snapshot create --db app.db --tables users,orders --note "Before migration"
  code-viewer query diff create --before snap-abc123 --after snap-def456
  code-viewer query diff rows --id diff-xyz789 --table users --type updated
`;

export const QUERY_AGENT_HELP = `code-viewer query — execute read-only SQL queries against local databases

You are an AI coding agent. Use this tool to investigate database contents
when a human asks about their data. Results are saved to the project's
.code-viewer/query-history.json and appear in the browser's Database > Query
History tab, so the human can review what you queried.

## When to use

- Answering "what does this data look like?"
- Checking schema, row counts, sample data
- Investigating data quality or anomalies
- Searching for a value across all tables
- Taking snapshots before/after a test to verify DB changes

## Requirements

- A code-viewer server must be running for the repository.
- Only SELECT, PRAGMA, EXPLAIN, WITH queries are allowed (for exec).
- Results are persisted and visible to the human.

## Workflow: SQL Query

1. Identify which database file to query (list with: code-viewer query list)
2. Execute:
   code-viewer query exec --db data.sqlite3 --sql "SELECT * FROM users LIMIT 10" \\
       --title "Sample user data" --body "Checking what user records look like."
3. The human sees results in the browser's Database > Query History tab.

## Workflow: Global Search

Search for a string across all tables and all text columns:
  code-viewer query search --db app.db --term "john@example.com"

Options:
  --tables users,orders    Only search specific tables
  --include-non-text       Also search numeric/date columns
  --max-hits 20            Max hits per table (default: 50)

## Workflow: Snapshot & Diff (for testing)

Use this to verify that a feature test correctly modifies the expected DB tables.

1. Take a "before" snapshot:
   code-viewer query snapshot create --db app.db --tables users,orders \\
       --note "Before running user registration test"

2. (The human or test runner performs the action)

3. Take an "after" snapshot:
   code-viewer query snapshot create --db app.db --tables users,orders \\
       --note "After running user registration test"

4. List snapshots to get IDs:
   code-viewer query snapshot list --db app.db

5. Create a diff:
   code-viewer query diff create --before snap-abc123 --after snap-def456 \\
       --note "User registration test - expected 1 INSERT in users"

6. View the diff:
   code-viewer query diff tables --id diff-xyz789
   code-viewer query diff rows --id diff-xyz789 --table users --type inserted

The human can also view all diffs in the browser's Database > Snapshot tab.

## Guidelines

- Always use LIMIT. The server caps rows but be explicit.
- Write --title for the human, not for yourself.
- Use --body to explain why the query matters.
- Do not query broad PII or secrets unless explicitly asked.
- Use --no-save for exploratory queries that should not remain in history.
- Prefer specific columns over SELECT *.
- For snapshots, always specify --tables to avoid scanning unnecessary tables.
- Write meaningful --note values — the human uses them to understand context.
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

export function parseQueryArgs(argv: string[]): QueryParseResult {
  const rest: string[] = [];
  let cwd: string | undefined;
  let server: string | undefined;
  const options = new Map<string, string>();
  const flags = new Set<string>();
  const valueFlags = new Set([
    "--db",
    "--sql",
    "--title",
    "--body",
    "--max-rows",
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
    } else if (arg === "--json" || arg === "--no-save") {
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
  if (subcommand === "exec") {
    const db = options.get("--db");
    if (!db) return { ok: false, error: "exec requires --db <path>" };
    const sql = options.get("--sql");
    if (!sql) return { ok: false, error: "exec requires --sql <sql>" };
    const maxRowsRaw = options.get("--max-rows");
    const maxRows = maxRowsRaw ? Number(maxRowsRaw) || undefined : undefined;
    return {
      ok: true,
      args: {
        command: {
          kind: "exec",
          db,
          sql,
          title: options.get("--title"),
          body: options.get("--body"),
          save: !flags.has("--no-save"),
          maxRows,
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
        command: {
          kind: "list",
          json: flags.has("--json"),
          db: options.get("--db"),
        },
        cwd,
        server,
      },
    };
  }
  if (subcommand === "clear") {
    return {
      ok: true,
      args: {
        command: { kind: "clear", db: options.get("--db") },
        cwd,
        server,
      },
    };
  }
  return { ok: false, error: `unknown query command: ${subcommand}` };
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
    const res = await fetch(`${serverUrl}/_db/files`, {
      signal: AbortSignal.timeout(1500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

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
  path: string,
  method: "GET" | "POST",
  body?: unknown,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const url = `${serverUrl}${path}`;
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
  const data = await res.json();
  return { ok: res.ok, status: res.status, data };
}

export async function runQueryCli(argv: string[]): Promise<void> {
  const parsed = parseQueryArgs(argv);
  if (parsed.ok === false) {
    console.error(parsed.error);
    console.error('Run "code-viewer query --help" for usage.');
    process.exit(1);
  }
  const { command, cwd, server } = parsed.args;
  if (command.kind === "help") {
    console.log(QUERY_HELP);
    return;
  }
  if (command.kind === "agent-help") {
    console.log(QUERY_AGENT_HELP);
    return;
  }
  const root = resolveRepoRoot(cwd);
  const serverUrl = await ensureServerUrl(root, server);

  if (command.kind === "exec") {
    const reqBody: Record<string, unknown> = {
      db: command.db,
      sql: command.sql,
      saveHistory: command.save,
      executedBy: "ai",
      source: "cli",
    };
    if (command.title) reqBody.title = command.title;
    if (command.body) reqBody.body = command.body;
    if (command.maxRows) reqBody.maxRows = command.maxRows;
    const result = await request(serverUrl, "/_db/query", "POST", reqBody);
    const data = result.data as Record<string, unknown>;
    if (!result.ok || data.error) {
      console.error(
        `query error: ${typeof data.error === "string" ? data.error : JSON.stringify(data)}`,
      );
      process.exit(1);
    }
    console.log(
      JSON.stringify(
        {
          columns: data.columns,
          rows: data.rows,
          rowCount: data.rowCount,
          elapsedMs: data.elapsedMs,
        },
        null,
        2,
      ),
    );
    return;
  }
  if (command.kind === "list") {
    const params = command.db ? `?db=${encodeURIComponent(command.db)}` : "";
    const result = await request(serverUrl, `/_db/history${params}`, "GET");
    if (!result.ok) {
      console.error("failed to fetch query history");
      process.exit(1);
    }
    const state = result.data as { entries: Record<string, unknown>[] };
    if (command.json) {
      console.log(JSON.stringify(state, null, 2));
    } else {
      if (!state.entries.length) {
        console.log("no query history");
        return;
      }
      for (const entry of state.entries) {
        const by = entry.executedBy === "ai" ? "[AI]" : "";
        const title = entry.title ? ` ${entry.title}` : "";
        const sql =
          typeof entry.sql === "string"
            ? entry.sql.length > 80
              ? `${entry.sql.slice(0, 80)}...`
              : entry.sql
            : "";
        console.log(
          `${entry.executedAt}  ${by}${title}  ${entry.rowCount} rows (${entry.elapsedMs}ms)`,
        );
        console.log(`  ${sql}`);
      }
    }
    return;
  }
  if (command.kind === "clear") {
    const reqBody: Record<string, unknown> = {};
    if (command.db) reqBody.db = command.db;
    await request(serverUrl, "/_db/history/clear", "POST", reqBody);
    console.log("cleared query history");
    return;
  }
}
