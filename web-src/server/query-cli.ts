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
  | { kind: "clear"; db?: string };

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
  code-viewer query agent-help

Global options:
  --cwd <dir>      repository directory (default: current directory)
  --server <url>   code-viewer server URL (default: auto-discovered)

Examples:
  code-viewer query exec --db data.sqlite3 --sql "SELECT * FROM users LIMIT 10"
  code-viewer query exec --db app.db --sql "SELECT COUNT(*) FROM orders" \\
      --title "Order count" --body "Checking total orders."
  code-viewer query list --json
  code-viewer query clear --db data.sqlite3
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

## Requirements

- A code-viewer server must be running for the repository.
- Only SELECT, PRAGMA, EXPLAIN, WITH queries are allowed.
- Results are persisted and visible to the human.

## Workflow

1. Identify which database file to query (list with: code-viewer query list)
2. Execute:
   code-viewer query exec --db data.sqlite3 --sql "SELECT * FROM users LIMIT 10" \\
       --title "Sample user data" --body "Checking what user records look like."
3. The human sees results in the browser's Database > Query History tab.

## Guidelines

- Always use LIMIT. The server caps rows but be explicit.
- Write --title for the human, not for yourself.
- Use --body to explain why the query matters.
- Do not query broad PII or secrets unless explicitly asked.
- Use --no-save for exploratory queries that should not remain in history.
- Prefer specific columns over SELECT *.
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
