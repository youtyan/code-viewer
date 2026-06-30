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

## Output contract

- exec / diff-rows: pretty JSON on stdout, exit 0 on success.
- snapshot list / diff tables: human-readable table (default), or pretty JSON with --json.
- snapshot create: prints "snapshot started" immediately. The server runs the
  scan in the background and emits "db-snapshot" SSE events; use snapshot list
  to confirm completion before diffing.
- snapshot delete / note / clear: prints a single status line.
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

## Not yet wired in the CLI

- Global SQL-table search ("code-viewer query search …") is available in the
  browser's Database > Search tab but not via this CLI. Ask the human to run
  it in the UI when needed.
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
]);

const BOOL_FLAGS = new Set(["--json", "--no-save"]);

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
  return { ok: false, error: `unknown query command: ${subcommand}` };
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
