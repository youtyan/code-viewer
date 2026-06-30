import { ensureServerUrl, resolveRepoRoot, takeValue } from "./cli-helpers";

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
      kind: "snapshot-create";
      db: string;
      tables?: string[];
      note: string;
    }
  | { kind: "snapshot-list"; db?: string; json: boolean }
  | { kind: "snapshot-delete"; id: string }
  | { kind: "snapshot-note"; id: string; note: string }
  // server の snapshot diff は on-demand 計算なので "stored diff" は存在しない。
  // CLI も before/after の snapshot id を毎回受ける形にしておく。
  | { kind: "diff-tables"; before: string; after: string; json: boolean }
  | {
      kind: "diff-rows";
      before: string;
      after: string;
      table: string;
      limit?: number;
      offset?: number;
      json: boolean;
    }
  // /_db/search/{start,status,cancel} を CLI に薄く被せたもの。
  // server 側は long-running job + polling 形で、UI と同じ endpoint を使う。
  | {
      kind: "search";
      db: string;
      term: string;
      tables?: string[];
      schema?: string;
      includeNonText: boolean;
      maxHits?: number;
      timeoutSec: number;
      json: boolean;
    };

export type QueryArgs = {
  command: QueryCommand;
  cwd?: string;
  server?: string;
};

export type QueryParseResult =
  | { ok: true; args: QueryArgs }
  | { ok: false; error: string };

export const QUERY_HELP = `code-viewer query — execute read-only SQL queries and inspect snapshots

Usage:
  code-viewer query exec --db <path> --sql <sql> [--title <text>] [--body <markdown>] [--no-save] [--max-rows <n>]
  code-viewer query list [--json] [--db <path>]
  code-viewer query clear [--db <path>]
  code-viewer query snapshot create --db <path> [--tables t1,t2,...] [--note <text>]
  code-viewer query snapshot list [--json] [--db <path>]
  code-viewer query snapshot delete --id <snapshot-id>
  code-viewer query snapshot note --id <snapshot-id> --note <text>
  code-viewer query diff tables --before <id> --after <id> [--json]
  code-viewer query diff rows --before <id> --after <id> --table <name> [--limit <n>] [--offset <n>] [--json]
  code-viewer query search --db <path> --term <text> [--tables t1,t2,...] [--include-non-text] [--max-hits <n>] [--schema <name>] [--timeout <sec>] [--json]
  code-viewer query agent-help

Global options:
  --cwd <dir>      repository directory (default: current directory)
  --server <url>   code-viewer server URL (default: auto-discovered)

Examples:
  code-viewer query exec --db data.sqlite3 --sql "SELECT * FROM users LIMIT 10"
  code-viewer query snapshot create --db app.db --tables users,orders --note "Before migration"
  code-viewer query snapshot list --db app.db --json
  code-viewer query diff tables --before snap-abc123 --after snap-def456
  code-viewer query diff rows --before snap-abc123 --after snap-def456 --table users
  code-viewer query search --db app.db --term "sample@example.com" --tables users,orders --max-hits 20
`;

export const QUERY_AGENT_HELP = `code-viewer query — agent guide

You are an AI coding agent. Use this tool to investigate database contents
and verify DB-changing actions. Results are saved to the project's
.code-viewer/ store and appear in the browser's Database tab, so the human
can review what you queried.

## When to use

- Answering "what does this data look like?"
- Checking schema, row counts, sample data
- Investigating data quality or anomalies
- Taking snapshots before/after a test to verify DB changes

## Requirements

- A code-viewer server must be running for the repository.
- Only SELECT, PRAGMA, EXPLAIN, WITH queries are allowed (for exec).
- Results are persisted and visible to the human.

## Workflow: SQL Query

1. Identify which database file or datastore id to query from the browser's
   Database tab, the current route, or project fixtures. code-viewer query
   list shows saved query history; it does not discover databases.
2. Execute:
   code-viewer query exec --db data.sqlite3 --sql "SELECT * FROM users LIMIT 10" \\
       --title "Sample user data" --body "Checking what user records look like."
3. The human sees results in the browser's Database > Query History tab.

## Workflow: Snapshot & Diff (for testing)

Use this to verify that a feature test correctly modifies the expected DB tables.
Snapshot diffs are computed on demand from the (before, after) pair — there is
no separate stored diff entity, so you always pass both snapshot ids.

1. Take a "before" snapshot:
   code-viewer query snapshot create --db app.db --tables users,orders \\
       --note "Before running user registration test"

2. (The human or test runner performs the action.)

3. Take an "after" snapshot:
   code-viewer query snapshot create --db app.db --tables users,orders \\
       --note "After running user registration test"

4. List snapshots to get IDs:
   code-viewer query snapshot list --db app.db --json

5. View the diff (per-table summary, then per-row detail):
   code-viewer query diff tables --before snap-abc123 --after snap-def456 --json
   code-viewer query diff rows  --before snap-abc123 --after snap-def456 \\
       --table users --json

The human can also view all snapshots in the browser's Database > Snapshot tab.

## Workflow: Global table search

Use this to locate a value (an email, a foreign key, a free-text fragment)
when you do not yet know which table or column holds it. Mirrors the
browser's Database > Search tab.

1. Run search. It blocks until the server finishes scanning or --timeout
   expires (default 60s); on timeout the job is cancelled and exit is 1.
   code-viewer query search --db app.db --term "sample@example.com" \\
       --tables users,orders --max-hits 20 --json

2. Inspect hits in the output. Each hit names a table, column, row preview,
   and (for SQL stores with a primary key) a JSON-serialized rowKey suitable
   for a follow-up WHERE clause via query exec.

## Output contract

- exec / diff-rows: pretty JSON on stdout, exit 0 on success.
- snapshot list / diff tables: human-readable table (default), or pretty JSON with --json.
- snapshot create: prints "snapshot started" immediately. The server runs the
  scan in the background and emits "db-snapshot" SSE events; use snapshot list
  to confirm completion before diffing.
- snapshot delete / note / clear: prints a single status line.
- search: blocks until done; prints hit lines (default) or full status JSON
  (--json) on stdout. Empty result is a clean exit 0.
- Any error: stderr + non-zero exit. Reasons from the server arrive verbatim
  (text/plain or {error:...} JSON, whichever the server sent).

## Guidelines

- Always use LIMIT in --sql. The server caps rows but be explicit.
- Write --title for the human, not for yourself.
- Use --body to explain why the query matters.
- Do not query broad PII or secrets unless explicitly asked.
- Use --no-save for exploratory queries that should not remain in history.
- Prefer specific columns over SELECT *.
- For snapshots, always specify --tables to avoid scanning unnecessary tables.
- Write meaningful --note values — the human uses them to understand context.
- After snapshot create, briefly wait or re-poll snapshot list before diffing;
  the scan is asynchronous.
- For search, prefer --tables when you already know which tables to scan, and
  --max-hits to keep large hit sets bounded. Without --include-non-text the
  server only scans text-like columns (faster, cheaper).
`;

const VALUE_FLAGS = new Set([
  "--db",
  "--sql",
  "--title",
  "--body",
  "--max-rows",
  "--tables",
  "--note",
  "--id",
  "--before",
  "--after",
  "--table",
  "--limit",
  "--offset",
  "--term",
  "--schema",
  "--max-hits",
  "--timeout",
]);

const BOOL_FLAGS = new Set(["--json", "--no-save", "--include-non-text"]);

const DEFAULT_SEARCH_TIMEOUT_SEC = 60;

function parseCommaList(raw: string | undefined): string[] | undefined {
  if (raw === undefined) return undefined;
  const parts = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts : undefined;
}

function parsePositiveInt(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) return undefined;
  return n;
}

function parseNonNegativeInt(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) return undefined;
  return n;
}

export function parseQueryArgs(argv: string[]): QueryParseResult {
  const rest: string[] = [];
  let cwd: string | undefined;
  let server: string | undefined;
  const options = new Map<string, string>();
  const flags = new Set<string>();

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

  const globalArgs = { cwd, server };

  if (subcommand === "agent-help") {
    return { ok: true, args: { command: { kind: "agent-help" } } };
  }
  if (subcommand === "exec") {
    const db = options.get("--db");
    if (!db) return { ok: false, error: "exec requires --db <path>" };
    const sql = options.get("--sql");
    if (!sql) return { ok: false, error: "exec requires --sql <sql>" };
    const maxRowsRaw = options.get("--max-rows");
    const maxRows = parsePositiveInt(maxRowsRaw);
    if (maxRowsRaw !== undefined && maxRows === undefined) {
      return { ok: false, error: "--max-rows must be a positive integer" };
    }
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
        ...globalArgs,
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
        ...globalArgs,
      },
    };
  }
  if (subcommand === "clear") {
    return {
      ok: true,
      args: {
        command: { kind: "clear", db: options.get("--db") },
        ...globalArgs,
      },
    };
  }
  if (subcommand === "snapshot") {
    return parseSnapshotSubcommand(rest, options, flags, globalArgs);
  }
  if (subcommand === "diff") {
    return parseDiffSubcommand(rest, options, flags, globalArgs);
  }
  if (subcommand === "search") {
    return parseSearchCommand(options, flags, globalArgs);
  }
  return { ok: false, error: `unknown query command: ${subcommand}` };
}

function parseSearchCommand(
  options: Map<string, string>,
  flags: Set<string>,
  globalArgs: { cwd?: string; server?: string },
): QueryParseResult {
  const db = options.get("--db");
  if (!db) return { ok: false, error: "search requires --db <path>" };
  const term = options.get("--term");
  if (!term) return { ok: false, error: "search requires --term <text>" };
  const tables = parseCommaList(options.get("--tables"));
  const schema = options.get("--schema");
  const maxHitsRaw = options.get("--max-hits");
  const maxHits = parsePositiveInt(maxHitsRaw);
  if (maxHitsRaw !== undefined && maxHits === undefined) {
    return { ok: false, error: "--max-hits must be a positive integer" };
  }
  const timeoutRaw = options.get("--timeout");
  const timeoutSec =
    timeoutRaw === undefined
      ? DEFAULT_SEARCH_TIMEOUT_SEC
      : parsePositiveInt(timeoutRaw);
  if (timeoutSec === undefined) {
    return { ok: false, error: "--timeout must be a positive integer (sec)" };
  }
  return {
    ok: true,
    args: {
      command: {
        kind: "search",
        db,
        term,
        tables,
        schema,
        includeNonText: flags.has("--include-non-text"),
        maxHits,
        timeoutSec,
        json: flags.has("--json"),
      },
      ...globalArgs,
    },
  };
}

function parseSnapshotSubcommand(
  rest: string[],
  options: Map<string, string>,
  flags: Set<string>,
  globalArgs: { cwd?: string; server?: string },
): QueryParseResult {
  const action = rest[1];
  if (!action) {
    return {
      ok: false,
      error: "snapshot requires a subcommand (create|list|delete|note)",
    };
  }
  if (action === "create") {
    const db = options.get("--db");
    if (!db)
      return { ok: false, error: "snapshot create requires --db <path>" };
    const tables = parseCommaList(options.get("--tables"));
    const note = options.get("--note") ?? "";
    return {
      ok: true,
      args: {
        command: { kind: "snapshot-create", db, tables, note },
        ...globalArgs,
      },
    };
  }
  if (action === "list") {
    return {
      ok: true,
      args: {
        command: {
          kind: "snapshot-list",
          db: options.get("--db"),
          json: flags.has("--json"),
        },
        ...globalArgs,
      },
    };
  }
  if (action === "delete") {
    const id = options.get("--id");
    if (!id)
      return {
        ok: false,
        error: "snapshot delete requires --id <snapshot-id>",
      };
    return {
      ok: true,
      args: { command: { kind: "snapshot-delete", id }, ...globalArgs },
    };
  }
  if (action === "note") {
    const id = options.get("--id");
    if (!id)
      return { ok: false, error: "snapshot note requires --id <snapshot-id>" };
    const note = options.get("--note");
    if (note === undefined) {
      return { ok: false, error: "snapshot note requires --note <text>" };
    }
    return {
      ok: true,
      args: { command: { kind: "snapshot-note", id, note }, ...globalArgs },
    };
  }
  return { ok: false, error: `unknown snapshot subcommand: ${action}` };
}

function parseDiffSubcommand(
  rest: string[],
  options: Map<string, string>,
  flags: Set<string>,
  globalArgs: { cwd?: string; server?: string },
): QueryParseResult {
  const action = rest[1];
  if (!action) {
    return { ok: false, error: "diff requires a subcommand (tables|rows)" };
  }
  if (action === "tables") {
    const before = options.get("--before");
    const after = options.get("--after");
    if (!before || !after) {
      return {
        ok: false,
        error: "diff tables requires --before <id> and --after <id>",
      };
    }
    return {
      ok: true,
      args: {
        command: {
          kind: "diff-tables",
          before,
          after,
          json: flags.has("--json"),
        },
        ...globalArgs,
      },
    };
  }
  if (action === "rows") {
    const before = options.get("--before");
    const after = options.get("--after");
    const table = options.get("--table");
    if (!before || !after || !table) {
      return {
        ok: false,
        error: "diff rows requires --before <id>, --after <id>, --table <name>",
      };
    }
    const limitRaw = options.get("--limit");
    const offsetRaw = options.get("--offset");
    const limit = parsePositiveInt(limitRaw);
    if (limitRaw !== undefined && limit === undefined) {
      return { ok: false, error: "--limit must be a positive integer" };
    }
    const offset = parseNonNegativeInt(offsetRaw);
    if (offsetRaw !== undefined && offset === undefined) {
      return { ok: false, error: "--offset must be a non-negative integer" };
    }
    return {
      ok: true,
      args: {
        command: {
          kind: "diff-rows",
          before,
          after,
          table,
          limit,
          offset,
          json: flags.has("--json"),
        },
        ...globalArgs,
      },
    };
  }
  return { ok: false, error: `unknown diff subcommand: ${action}` };
}

// サーバが 4xx / 5xx を返したときは text/plain で body を返す経路がある
// (handle.ts の textError 等)。`res.json()` を盲目的に呼ぶと SyntaxError で
// クラッシュして本当のエラー理由が消える。Content-Type で振り分けて
// text を保持し、失敗時は action 名とともに stderr に出して exit 1。
// 成功時のみ JSON parse 済みの data を返す。
async function request(
  serverUrl: string,
  path: string,
  method: "GET" | "POST",
  body: unknown,
  action: string,
): Promise<unknown> {
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
  const ctype = (res.headers.get("content-type") || "").toLowerCase();
  const isJson = ctype.includes("json");
  if (!res.ok) {
    const text = await res.text();
    const detail = text.trim() || `HTTP ${res.status}`;
    console.error(`${action} failed (${res.status}): ${detail}`);
    process.exit(1);
  }
  if (!isJson) {
    // unexpected for 2xx — surface as opaque text
    return await res.text();
  }
  return await res.json();
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
  const serverUrl = await ensureServerUrl(root, server, "/_db/files");

  if (command.kind === "exec") return runExec(serverUrl, command);
  if (command.kind === "list") return runList(serverUrl, command);
  if (command.kind === "clear") return runClear(serverUrl, command);
  if (command.kind === "snapshot-create")
    return runSnapshotCreate(serverUrl, command);
  if (command.kind === "snapshot-list")
    return runSnapshotList(serverUrl, command);
  if (command.kind === "snapshot-delete")
    return runSnapshotDelete(serverUrl, command);
  if (command.kind === "snapshot-note")
    return runSnapshotNote(serverUrl, command);
  if (command.kind === "diff-tables") return runDiffTables(serverUrl, command);
  if (command.kind === "diff-rows") return runDiffRows(serverUrl, command);
  if (command.kind === "search") return runSearch(serverUrl, command);
}

async function runExec(
  serverUrl: string,
  command: Extract<QueryCommand, { kind: "exec" }>,
): Promise<void> {
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
  const data = (await request(
    serverUrl,
    "/_db/query",
    "POST",
    reqBody,
    "query",
  )) as Record<string, unknown>;
  if (data.error) {
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
}

async function runList(
  serverUrl: string,
  command: Extract<QueryCommand, { kind: "list" }>,
): Promise<void> {
  const params = command.db ? `?db=${encodeURIComponent(command.db)}` : "";
  const state = (await request(
    serverUrl,
    `/_db/history${params}`,
    "GET",
    undefined,
    "list query history",
  )) as { entries: Record<string, unknown>[] };
  if (command.json) {
    console.log(JSON.stringify(state, null, 2));
    return;
  }
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

async function runClear(
  serverUrl: string,
  command: Extract<QueryCommand, { kind: "clear" }>,
): Promise<void> {
  const reqBody: Record<string, unknown> = {};
  if (command.db) reqBody.db = command.db;
  await request(
    serverUrl,
    "/_db/history/clear",
    "POST",
    reqBody,
    "clear query history",
  );
  console.log("cleared query history");
}

async function runSnapshotCreate(
  serverUrl: string,
  command: Extract<QueryCommand, { kind: "snapshot-create" }>,
): Promise<void> {
  const reqBody: Record<string, unknown> = {
    db: command.db,
    note: command.note,
  };
  if (command.tables) reqBody.tables = command.tables;
  // server は非同期で snapshot を回すので、ここでは ack のみ返ってくる。
  // AI agent 向けに後続 ID 取得手順を一緒に出す。
  const data = (await request(
    serverUrl,
    "/_db/snapshot/create",
    "POST",
    reqBody,
    "snapshot create",
  )) as Record<string, unknown>;
  const message = typeof data.message === "string" ? data.message : "ok";
  console.log(
    `${message}. Poll with: code-viewer query snapshot list --db ${command.db} --json`,
  );
}

async function runSnapshotList(
  serverUrl: string,
  command: Extract<QueryCommand, { kind: "snapshot-list" }>,
): Promise<void> {
  const params = command.db ? `?db=${encodeURIComponent(command.db)}` : "";
  const body = (await request(
    serverUrl,
    `/_db/snapshot/list${params}`,
    "GET",
    undefined,
    "snapshot list",
  )) as {
    snapshots: Array<{
      id: string;
      dbId: string;
      schema?: string;
      kind: string;
      note: string;
      createdAt: string;
      tables: string[];
      status: "running" | "done" | "error";
      errorMessage?: string;
    }>;
  };
  if (command.json) {
    console.log(JSON.stringify(body, null, 2));
    return;
  }
  if (!body.snapshots.length) {
    console.log("no snapshots");
    return;
  }
  for (const s of body.snapshots) {
    const schema = s.schema ? `/${s.schema}` : "";
    const note = s.note ? `  ${s.note}` : "";
    const err = s.errorMessage ? `  err: ${s.errorMessage}` : "";
    console.log(
      `${s.createdAt}  ${s.id}  [${s.status}] ${s.kind}:${s.dbId}${schema} (${s.tables.length} tables)${note}${err}`,
    );
  }
}

async function runSnapshotDelete(
  serverUrl: string,
  command: Extract<QueryCommand, { kind: "snapshot-delete" }>,
): Promise<void> {
  await request(
    serverUrl,
    "/_db/snapshot/delete",
    "POST",
    { id: command.id },
    "snapshot delete",
  );
  console.log(`deleted snapshot ${command.id}`);
}

async function runSnapshotNote(
  serverUrl: string,
  command: Extract<QueryCommand, { kind: "snapshot-note" }>,
): Promise<void> {
  await request(
    serverUrl,
    "/_db/snapshot/update-note",
    "POST",
    { id: command.id, note: command.note },
    "snapshot update-note",
  );
  console.log(`updated note for snapshot ${command.id}`);
}

async function runDiffTables(
  serverUrl: string,
  command: Extract<QueryCommand, { kind: "diff-tables" }>,
): Promise<void> {
  const qs = `?before=${encodeURIComponent(command.before)}&after=${encodeURIComponent(command.after)}`;
  const body = (await request(
    serverUrl,
    `/_db/snapshot/diff/tables${qs}`,
    "GET",
    undefined,
    "diff tables",
  )) as {
    beforeId: string;
    afterId: string;
    tables: Array<{
      tableName: string;
      insertedCount: number;
      updatedCount: number;
      deletedCount: number;
      unchangedCount: number;
      coverage: string;
      unsnapshottedRowCount?: number;
    }>;
  };
  if (command.json) {
    console.log(JSON.stringify(body, null, 2));
    return;
  }
  if (!body.tables.length) {
    console.log("no tables in diff");
    return;
  }
  for (const t of body.tables) {
    const cov = t.coverage === "both" ? "" : `  (${t.coverage})`;
    console.log(
      `${t.tableName}  +${t.insertedCount} ~${t.updatedCount} -${t.deletedCount} =${t.unchangedCount}${cov}`,
    );
  }
}

async function runDiffRows(
  serverUrl: string,
  command: Extract<QueryCommand, { kind: "diff-rows" }>,
): Promise<void> {
  const qs = new URLSearchParams({
    before: command.before,
    after: command.after,
    table: command.table,
  });
  if (command.limit !== undefined) qs.set("limit", String(command.limit));
  if (command.offset !== undefined) qs.set("offset", String(command.offset));
  // diff rows は構造化データなので AI 向けには常に JSON 出力するのが扱いやすい。
  // --json は indent 有無の hint としてだけ使う (圧縮 vs 整形)。
  const data = (await request(
    serverUrl,
    `/_db/snapshot/diff/rows?${qs.toString()}`,
    "GET",
    undefined,
    "diff rows",
  )) as Record<string, unknown>;
  console.log(JSON.stringify(data, null, command.json ? 2 : 0));
}

type SearchHitOut = {
  table: string;
  column: string;
  schema?: string;
  rowKeyJson?: string;
  valuePreview: string;
  rowPreview: unknown[];
};
type SearchStatus = {
  jobId: string;
  dbId: string;
  schema?: string;
  scannedTables: number;
  totalTables: number;
  currentTable?: string;
  hits: SearchHitOut[];
  done: boolean;
  error?: string;
};

// 単体テストでは polling 間隔を 0 にして同期的に進めたい。
// CLI 表面に出すと「裏技 flag」になるので環境変数経由で受ける。
function searchPollIntervalMs(): number {
  const raw = process.env.CODE_VIEWER_SEARCH_POLL_MS;
  if (raw === undefined) return 500;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 500;
  return n;
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function cancelSearchJobBestEffort(
  serverUrl: string,
  jobId: string,
): Promise<void> {
  try {
    await fetch(`${serverUrl}/_db/search/cancel`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: new URL(serverUrl).origin,
        "X-Code-Viewer-Action": "1",
      },
      body: JSON.stringify({ id: jobId }),
    });
  } catch {
    // Timeout reporting is more useful than cancel failure details here.
  }
}

async function runSearch(
  serverUrl: string,
  command: Extract<QueryCommand, { kind: "search" }>,
): Promise<void> {
  const startBody: Record<string, unknown> = {
    db: command.db,
    term: command.term,
    includeNonText: command.includeNonText,
  };
  if (command.schema) startBody.schema = command.schema;
  if (command.tables) startBody.tables = command.tables;
  if (command.maxHits !== undefined)
    startBody.maxHitsPerTable = command.maxHits;

  const startRes = (await request(
    serverUrl,
    "/_db/search/start",
    "POST",
    startBody,
    "search start",
  )) as { jobId?: string };
  const jobId = startRes.jobId;
  if (!jobId) {
    console.error("search start: server did not return a jobId");
    process.exit(1);
  }

  const pollIntervalMs = searchPollIntervalMs();
  const deadline = Date.now() + command.timeoutSec * 1000;
  let status: SearchStatus | undefined;
  while (true) {
    if (Date.now() >= deadline) {
      await cancelSearchJobBestEffort(serverUrl, jobId);
      console.error(
        `search timed out after ${command.timeoutSec}s (cancelled job ${jobId})`,
      );
      process.exit(1);
    }
    status = (await request(
      serverUrl,
      `/_db/search/status?id=${encodeURIComponent(jobId)}`,
      "GET",
      undefined,
      "search status",
    )) as SearchStatus;
    if (status.error) {
      console.error(`search error: ${status.error}`);
      process.exit(1);
    }
    if (status.done) break;
    await sleep(pollIntervalMs);
  }

  if (command.json) {
    console.log(JSON.stringify(status, null, 2));
    return;
  }
  if (status.hits.length === 0) {
    console.log(`no hits (scanned ${status.scannedTables} tables)`);
    return;
  }
  for (const hit of status.hits) {
    const schema = hit.schema ? `${hit.schema}.` : "";
    const key = hit.rowKeyJson ? `  key=${hit.rowKeyJson}` : "";
    console.log(
      `${schema}${hit.table}.${hit.column}${key}  ${hit.valuePreview}`,
    );
  }
  console.log(
    `# ${status.hits.length} hit(s) across ${status.scannedTables} table(s)`,
  );
}
