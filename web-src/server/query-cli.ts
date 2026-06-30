import type {
  DbColumn,
  DbFilesResponse,
  DbSchemaResponse,
  DbSchemasResponse,
} from "../core/database/types";
import { ensureServerUrl, resolveRepoRoot, takeValue } from "./cli-helpers";

export type QueryCommand =
  | { kind: "help" }
  | { kind: "agent-help" }
  | {
      kind: "exec";
      db: string;
      sql: string;
      schema?: string;
      title?: string;
      body?: string;
      save: boolean;
      maxRows?: number;
    }
  | { kind: "list"; json: boolean; db?: string; schema?: string }
  | { kind: "clear"; db?: string; schema?: string }
  // /_db/files をそのまま薄く CLI 化したもの。AI agent が DB ID を発見する
  // ためのエントリポイント。server には新 endpoint を作らず discovery を流用。
  | { kind: "sources"; json: boolean }
  // 以下4つは /_db/schemas /_db/schema /_db/columns /_db/ddl を薄く CLI 化。
  // table/column を方言なしで覗ける AI 用 introspection。
  | { kind: "schemas"; db: string; json: boolean }
  | {
      kind: "schema";
      db: string;
      schema?: string;
      withColumns: boolean;
      json: boolean;
    }
  | {
      kind: "columns";
      db: string;
      schema?: string;
      table: string;
      json: boolean;
    }
  | {
      kind: "ddl";
      db: string;
      schema?: string;
      table: string;
      json: boolean;
    }
  | {
      kind: "snapshot-create";
      db: string;
      tables?: string[];
      note: string;
      schema?: string;
      wait: boolean;
      timeoutSec: number;
      json: boolean;
    }
  | { kind: "snapshot-list"; db?: string; schema?: string; json: boolean }
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
  code-viewer query sources [--json]
  code-viewer query schemas --db <path> [--json]
  code-viewer query schema --db <path> [--schema <name>] [--with-columns] [--json]
  code-viewer query columns --db <path> [--schema <name>] --table <name> [--json]
  code-viewer query ddl --db <path> [--schema <name>] --table <name> [--json]
  code-viewer query exec --db <path> [--schema <name>] --sql <sql> [--title <text>] [--body <markdown>] [--no-save] [--max-rows <n>]
  code-viewer query list [--json] [--db <path> [--schema <name>]]
  code-viewer query clear [--db <path> [--schema <name>]]
  code-viewer query snapshot create --db <path> [--tables t1,t2,...] [--note <text>] [--schema <name>] [--wait] [--timeout <sec>] [--json]
  code-viewer query snapshot list [--json] [--db <path>] [--schema <name>]
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
  code-viewer query sources --json
  code-viewer query schemas --db docker:pg-svc --json
  code-viewer query schema --db app.db --json
  code-viewer query columns --db docker:pg-svc --schema analytics --table events --json
  code-viewer query ddl --db app.db --table users
  code-viewer query exec --db docker:pg-svc --schema analytics --sql "SELECT * FROM events LIMIT 10"
  code-viewer query exec --db data.sqlite3 --sql "SELECT * FROM users LIMIT 10"
  code-viewer query list --db docker:pg-svc --schema analytics --json
  code-viewer query clear --db docker:pg-svc --schema analytics
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

1. Discover datastore IDs without opening the browser. This lists every
   SQLite / PostgreSQL / MySQL / Redis / Elasticsearch / S3 source the
   running server has discovered, with credentials stripped. Use the id
   field as --db on the following commands:
   code-viewer query sources --json
2. Introspect schema/tables/columns/DDL without writing dialect-specific
   SQL. These wrap the same endpoints the browser uses, so you can answer
   "what tables are in this DB?" / "what columns are in this table?"
   without guessing whether the engine is SQLite, PostgreSQL, or MySQL:
   code-viewer query schemas --db docker:pg-svc --json
   code-viewer query schema  --db app.db --json
   code-viewer query schema  --db docker:pg-svc --schema analytics --with-columns --json
   code-viewer query columns --db app.db --table users --json
   code-viewer query ddl     --db app.db --table users --json
3. (For saved query history, not discovery) code-viewer query list shows
   what you have previously executed. For PostgreSQL multi-schema history,
   use --schema together with --db:
   code-viewer query list --db docker:pg-svc --schema analytics --json
   code-viewer query clear --db docker:pg-svc --schema analytics
4. Execute:
   code-viewer query exec --db data.sqlite3 --sql "SELECT * FROM users LIMIT 10" \\
       --title "Sample user data" --body "Checking what user records look like."
   For PostgreSQL multi-schema databases, pass --schema with the same schema
   you inspected:
   code-viewer query exec --db docker:pg-svc --schema analytics \\
       --sql "SELECT * FROM events LIMIT 10"
5. The human sees results in the browser's Database > Query History tab.

## Workflow: Snapshot & Diff (for testing)

Use this to verify that a feature test correctly modifies the expected DB tables.
Snapshot diffs are computed on demand from the (before, after) pair — there is
no separate stored diff entity, so you always pass both snapshot ids.

1. Take a "before" snapshot. With --wait the CLI blocks until the snapshot
   finishes and exits 0 on done, 1 on error/timeout; the JSON response is
   the final snapshot meta, so use its id field without polling snapshot list:
   code-viewer query snapshot create --db app.db --tables users,orders \\
       --note "Before running user registration test" --wait --json

2. (The human or test runner performs the action.)

3. Take an "after" snapshot the same way (--wait + --json):
   code-viewer query snapshot create --db app.db --tables users,orders \\
       --note "After running user registration test" --wait --json

4. (If you skipped --wait) list snapshots to get IDs:
   code-viewer query snapshot list --db app.db --json

5. View the diff (per-table summary, then per-row detail):
   code-viewer query diff tables --before snap-abc123 --after snap-def456 --json
   code-viewer query diff rows  --before snap-abc123 --after snap-def456 \\
       --table users --json

The human can also view all snapshots in the browser's Database > Snapshot tab.

PostgreSQL (multi-schema): pass --schema <name> to snapshot create AND to
the matching snapshot list so the before/after pair, the polling lookup
during --wait, and the listing all stay scoped to the same schema. Without
--schema, snapshot create infers the schema (public or first available)
and snapshot list returns every snapshot for the database id.

   code-viewer query snapshot create --db docker:pg-svc --schema analytics \\
       --tables events --note "Before backfill" --wait --json
   code-viewer query snapshot list --db docker:pg-svc --schema analytics --json

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

- sources: human-readable id/kind/name lines on stdout (default), or pretty
  JSON of the full /_db/files response with --json. truncated and
  dockerError, if present, are appended to stdout as comment-prefixed lines
  (default) or kept as JSON fields (--json).
- schemas: human-readable schema-name-per-line (default), or pretty JSON of
  the full /_db/schemas response with --json. SQLite/MySQL/Redis/ES/S3
  return an empty list (no multi-schema concept).
- schema: human-readable "<table>\\t<type>\\t<rowCount>" lines (default), or
  pretty JSON of the full /_db/schema response with --json. With
  --with-columns the JSON includes columnsMap; default-mode output still
  prints only one line per table to keep stdout AI-parseable.
- columns: human-readable "<name>\\t<type>\\t<NULL|NOT NULL>\\t<PK|-> \\t<default>"
  lines (default), or pretty JSON of the full /_db/columns response with --json.
- ddl: raw CREATE statement on stdout (default), or pretty JSON of the full
  /_db/ddl response (sql + triggers + executedSql) with --json.
- exec: pretty JSON on stdout, exit 0 on success. The output
  contains dbId, columns, columnTypes, rows, rowCount, truncated, elapsedMs,
  and optional schema and executedSql fields. Use truncated to
  decide whether to re-issue with a larger --max-rows, columnTypes to build
  follow-up WHERE/CAST clauses, schema to confirm the resolved schema, and
  executedSql to log the exact SQL the server ran.
- diff-rows: pretty JSON on stdout, exit 0 on success.
- snapshot list / diff tables: human-readable table (default), or pretty JSON with --json.
- snapshot create: prints "snapshot started" immediately with the snapshotId.
  Add --wait to block until the snapshot finishes (default --timeout 120s);
  done → exit 0 with final meta (use its id field), error/timeout → stderr + exit 1.
  Without --wait the scan continues in the background (SSE event "db-snapshot");
  use snapshot list to confirm completion before diffing.
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
  the scan is asynchronous. Pass --wait to skip the poll entirely.
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

const BOOL_FLAGS = new Set([
  "--json",
  "--no-save",
  "--include-non-text",
  "--wait",
  "--with-columns",
]);

const DEFAULT_SEARCH_TIMEOUT_SEC = 60;
const DEFAULT_SNAPSHOT_WAIT_TIMEOUT_SEC = 120;

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
  if (subcommand === "sources") {
    if (rest.length > 1) {
      return {
        ok: false,
        error: "sources does not accept positional arguments",
      };
    }
    const unusedOption = Array.from(options.keys())[0];
    if (unusedOption) {
      return { ok: false, error: `sources does not accept ${unusedOption}` };
    }
    const unusedFlag = Array.from(flags).find((flag) => flag !== "--json");
    if (unusedFlag) {
      return { ok: false, error: `sources does not accept ${unusedFlag}` };
    }
    return {
      ok: true,
      args: {
        command: { kind: "sources", json: flags.has("--json") },
        ...globalArgs,
      },
    };
  }
  if (
    subcommand === "schemas" ||
    subcommand === "schema" ||
    subcommand === "columns" ||
    subcommand === "ddl"
  ) {
    if (rest.length > 1) {
      return {
        ok: false,
        error: `${subcommand} does not accept positional arguments`,
      };
    }
    return parseIntrospectSubcommand(subcommand, options, flags, globalArgs);
  }
  if (subcommand === "exec") {
    const db = options.get("--db");
    if (!db) return { ok: false, error: "exec requires --db <path>" };
    const sql = options.get("--sql");
    if (!sql) return { ok: false, error: "exec requires --sql <sql>" };
    const schema = options.get("--schema");
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
          schema,
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
    const db = options.get("--db");
    const schema = options.get("--schema");
    if (schema && !db)
      return { ok: false, error: "list --schema requires --db <path>" };
    return {
      ok: true,
      args: {
        command: {
          kind: "list",
          json: flags.has("--json"),
          db,
          schema,
        },
        ...globalArgs,
      },
    };
  }
  if (subcommand === "clear") {
    const db = options.get("--db");
    const schema = options.get("--schema");
    if (schema && !db)
      return { ok: false, error: "clear --schema requires --db <path>" };
    return {
      ok: true,
      args: {
        command: { kind: "clear", db, schema },
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

function parseIntrospectSubcommand(
  subcommand: "schemas" | "schema" | "columns" | "ddl",
  options: Map<string, string>,
  flags: Set<string>,
  globalArgs: { cwd?: string; server?: string },
): QueryParseResult {
  const db = options.get("--db");
  if (!db) return { ok: false, error: `${subcommand} requires --db <path>` };
  const schema = options.get("--schema");
  const json = flags.has("--json");
  if (subcommand === "schemas") {
    const reject = rejectUnsupportedFlags(subcommand, options, flags, {
      allowSchema: false,
      allowTable: false,
      allowWithColumns: false,
    });
    if (reject) return reject;
    return {
      ok: true,
      args: { command: { kind: "schemas", db, json }, ...globalArgs },
    };
  }
  if (subcommand === "schema") {
    const reject = rejectUnsupportedFlags(subcommand, options, flags, {
      allowSchema: true,
      allowTable: false,
      allowWithColumns: true,
    });
    if (reject) return reject;
    return {
      ok: true,
      args: {
        command: {
          kind: "schema",
          db,
          schema,
          withColumns: flags.has("--with-columns"),
          json,
        },
        ...globalArgs,
      },
    };
  }
  // columns / ddl は --table 必須。
  const table = options.get("--table");
  if (!table)
    return { ok: false, error: `${subcommand} requires --table <name>` };
  const reject = rejectUnsupportedFlags(subcommand, options, flags, {
    allowSchema: true,
    allowTable: true,
    allowWithColumns: false,
  });
  if (reject) return reject;
  return {
    ok: true,
    args: {
      command:
        subcommand === "columns"
          ? { kind: "columns", db, schema, table, json }
          : { kind: "ddl", db, schema, table, json },
      ...globalArgs,
    },
  };
}

// introspection の各サブコマンドで「許す option / flag」を申告し、それ以外が
// 渡されたら明示的に reject。silent drop でユーザーが「--schema 指定したのに
// 効いてない」状態に陥らないようにする (exec の既存バグの再発防止)。
function rejectUnsupportedFlags(
  subcommand: string,
  options: Map<string, string>,
  flags: Set<string>,
  allow: {
    allowSchema: boolean;
    allowTable: boolean;
    allowWithColumns: boolean;
  },
): QueryParseResult | undefined {
  const allowedOptions = new Set<string>(["--db"]);
  if (allow.allowSchema) allowedOptions.add("--schema");
  if (allow.allowTable) allowedOptions.add("--table");
  for (const key of options.keys()) {
    if (!allowedOptions.has(key)) {
      return { ok: false, error: `${subcommand} does not accept ${key}` };
    }
  }
  const allowedFlags = new Set<string>(["--json"]);
  if (allow.allowWithColumns) allowedFlags.add("--with-columns");
  for (const flag of flags) {
    if (!allowedFlags.has(flag)) {
      return { ok: false, error: `${subcommand} does not accept ${flag}` };
    }
  }
  return undefined;
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
    const schema = options.get("--schema");
    const timeoutRaw = options.get("--timeout");
    const timeoutSec =
      timeoutRaw === undefined
        ? DEFAULT_SNAPSHOT_WAIT_TIMEOUT_SEC
        : parsePositiveInt(timeoutRaw);
    if (timeoutSec === undefined) {
      return { ok: false, error: "--timeout must be a positive integer (sec)" };
    }
    return {
      ok: true,
      args: {
        command: {
          kind: "snapshot-create",
          db,
          tables,
          note,
          schema,
          wait: flags.has("--wait"),
          timeoutSec,
          json: flags.has("--json"),
        },
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
          schema: options.get("--schema"),
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
    const detail = extractErrorDetail(text, isJson, res.status);
    console.error(`${action} failed (${res.status}): ${detail}`);
    process.exit(1);
  }
  if (!isJson) {
    // unexpected for 2xx — surface as opaque text
    return await res.text();
  }
  return await res.json();
}

function extractErrorDetail(
  rawBody: string,
  isJson: boolean,
  status: number,
): string {
  const trimmed = rawBody.trim();
  if (!trimmed) return `HTTP ${status}`;
  if (!isJson) return trimmed;
  try {
    const parsed = JSON.parse(trimmed);
    if (
      parsed &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      typeof (parsed as { error?: unknown }).error === "string"
    ) {
      return (parsed as { error: string }).error;
    }
  } catch {
    // Fall back to the raw body for malformed JSON.
  }
  return trimmed;
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
  const serverUrl = await ensureServerUrl(root, server, "/");

  if (command.kind === "sources") return runSources(serverUrl, command);
  if (command.kind === "schemas") return runSchemas(serverUrl, command);
  if (command.kind === "schema") return runSchema(serverUrl, command);
  if (command.kind === "columns") return runColumns(serverUrl, command);
  if (command.kind === "ddl") return runDdl(serverUrl, command);
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

async function runSources(
  serverUrl: string,
  command: Extract<QueryCommand, { kind: "sources" }>,
): Promise<void> {
  // /_db/files をそのまま叩く。server 側で env/credentials は剥がされている。
  const data = (await request(
    serverUrl,
    "/_db/files",
    "GET",
    undefined,
    "list sources",
  )) as DbFilesResponse;

  if (command.json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  if (!data.files.length) {
    console.log("no datastore sources discovered");
  } else {
    for (const f of data.files) {
      // AI が --db にコピペしやすい順: id / kind / name。tab 区切りで安定化。
      console.log(`${f.id}\t${f.kind}\t${f.name}`);
    }
  }
  // truncated / dockerError は stderr に出すと AI が拾い損ねるので
  // stdout の末尾にコメント風で明示する。
  if (data.truncated) {
    console.log(
      "# truncated: docker discovery hit the cap; some sources may be missing",
    );
  }
  if (data.dockerError) {
    console.log(`# dockerError: ${data.dockerError}`);
  }
}

function buildIntrospectPath(
  base: string,
  params: Record<string, string | undefined>,
): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) qs.set(key, value);
  }
  const s = qs.toString();
  return s ? `${base}?${s}` : base;
}

async function runSchemas(
  serverUrl: string,
  command: Extract<QueryCommand, { kind: "schemas" }>,
): Promise<void> {
  const path = buildIntrospectPath("/_db/schemas", { db: command.db });
  const data = (await request(
    serverUrl,
    path,
    "GET",
    undefined,
    "list schemas",
  )) as DbSchemasResponse;
  if (command.json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  if (!data.schemas.length) {
    console.log("no schemas (engine has no multi-schema concept)");
    return;
  }
  for (const s of data.schemas) {
    console.log(s.name);
  }
}

async function runSchema(
  serverUrl: string,
  command: Extract<QueryCommand, { kind: "schema" }>,
): Promise<void> {
  const path = buildIntrospectPath("/_db/schema", {
    db: command.db,
    schema: command.schema,
    includeColumns: command.withColumns ? "1" : undefined,
  });
  const data = (await request(
    serverUrl,
    path,
    "GET",
    undefined,
    "read schema",
  )) as DbSchemaResponse;
  if (command.json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  if (!data.tables.length) {
    console.log("no tables");
    return;
  }
  for (const t of data.tables) {
    const rowCount = t.rowCount === null ? "-" : String(t.rowCount);
    console.log(`${t.name}\t${t.type}\t${rowCount}`);
  }
}

async function runColumns(
  serverUrl: string,
  command: Extract<QueryCommand, { kind: "columns" }>,
): Promise<void> {
  const path = buildIntrospectPath("/_db/columns", {
    db: command.db,
    schema: command.schema,
    table: command.table,
  });
  const data = (await request(
    serverUrl,
    path,
    "GET",
    undefined,
    "get columns",
  )) as {
    dbId: string;
    schema?: string;
    table: string;
    columns: DbColumn[];
    executedSql?: string[];
  };
  if (command.json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  if (!data.columns.length) {
    console.log("no columns");
    return;
  }
  for (const c of data.columns) {
    const nullable = c.nullable ? "NULL" : "NOT NULL";
    const pk = c.primaryKey ? "PK" : "-";
    const def = c.defaultValue === null ? "-" : c.defaultValue;
    console.log(`${c.name}\t${c.type}\t${nullable}\t${pk}\t${def}`);
  }
}

async function runDdl(
  serverUrl: string,
  command: Extract<QueryCommand, { kind: "ddl" }>,
): Promise<void> {
  const path = buildIntrospectPath("/_db/ddl", {
    db: command.db,
    schema: command.schema,
    table: command.table,
  });
  const data = (await request(
    serverUrl,
    path,
    "GET",
    undefined,
    "get DDL",
  )) as {
    dbId: string;
    schema?: string;
    table: string;
    sql: string;
    triggers: Array<{ name: string; sql: string }>;
    executedSql?: string[];
  };
  if (command.json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  // 既定モードは "コピペで CREATE TABLE が取れる" を最優先。trigger は
  // 区切り行を入れて続ける。
  if (data.sql) console.log(data.sql);
  for (const trig of data.triggers ?? []) {
    if (trig.sql) {
      console.log("");
      console.log(trig.sql);
    }
  }
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
  if (command.schema) reqBody.schema = command.schema;
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
  // Keep the query metadata agents need for truncation checks and follow-up SQL.
  const out: Record<string, unknown> = {
    dbId: data.dbId,
    ...(data.schema !== undefined ? { schema: data.schema } : {}),
    columns: data.columns,
    columnTypes: data.columnTypes,
    rows: data.rows,
    rowCount: data.rowCount,
    truncated: data.truncated,
    elapsedMs: data.elapsedMs,
    ...(data.executedSql !== undefined
      ? { executedSql: data.executedSql }
      : {}),
  };
  console.log(JSON.stringify(out, null, 2));
}

async function runList(
  serverUrl: string,
  command: Extract<QueryCommand, { kind: "list" }>,
): Promise<void> {
  const searchParams = new URLSearchParams();
  if (command.db) searchParams.set("db", command.db);
  if (command.schema) searchParams.set("schema", command.schema);
  const params = searchParams.toString();
  const path = params ? `/_db/history?${params}` : "/_db/history";
  const state = (await request(
    serverUrl,
    path,
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
  if (command.schema) reqBody.schema = command.schema;
  await request(
    serverUrl,
    "/_db/history/clear",
    "POST",
    reqBody,
    "clear query history",
  );
  console.log("cleared query history");
}

type SnapshotMetaOut = {
  id: string;
  dbId: string;
  schema?: string;
  kind: string;
  note: string;
  createdAt: string;
  tables: string[];
  status: "running" | "done" | "error";
  errorMessage?: string;
};

// db / schema は両方とも省略可能なので URLSearchParams で組む。
// (db なし + schema あり) のケースもサーバ側 handleSnapshotList は受け付ける。
function buildSnapshotListPath(opts: { db?: string; schema?: string }): string {
  const params = new URLSearchParams();
  if (opts.db) params.set("db", opts.db);
  if (opts.schema) params.set("schema", opts.schema);
  const qs = params.toString();
  return qs ? `/_db/snapshot/list?${qs}` : "/_db/snapshot/list";
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
  if (command.schema) reqBody.schema = command.schema;
  // server は snapshot id 確定までは ack を保留してくれるので、ここで返る
  // snapshotId は metadata row 作成済みであることが保証されている。
  const data = (await request(
    serverUrl,
    "/_db/snapshot/create",
    "POST",
    reqBody,
    "snapshot create",
  )) as Record<string, unknown>;
  const message = typeof data.message === "string" ? data.message : "ok";
  const snapshotId =
    typeof data.snapshotId === "string" ? data.snapshotId : undefined;

  if (!command.wait) {
    if (command.json) {
      console.log(
        JSON.stringify({ ok: true, message, snapshotId: snapshotId ?? null }),
      );
      return;
    }
    const idSuffix = snapshotId ? ` [id=${snapshotId}]` : "";
    const schemaHint = command.schema ? ` --schema ${command.schema}` : "";
    console.log(
      `${message}${idSuffix}. Poll with: code-viewer query snapshot list --db ${command.db}${schemaHint} --json`,
    );
    return;
  }

  if (!snapshotId) {
    // --wait は完了待ちなので、server から id が返って来ないと先に進めない。
    // 古い server 相手なら no-wait を案内する。
    console.error(
      "snapshot create --wait: server did not return snapshotId (upgrade the running code-viewer server or omit --wait)",
    );
    process.exit(1);
  }

  const finalMeta = await waitForSnapshotDone(serverUrl, command, snapshotId);

  if (finalMeta.status === "error") {
    if (command.json) console.log(JSON.stringify(finalMeta, null, 2));
    console.error(
      `snapshot ${snapshotId} failed: ${finalMeta.errorMessage ?? "unknown error"}`,
    );
    process.exit(1);
  }

  if (command.json) {
    console.log(JSON.stringify(finalMeta, null, 2));
    return;
  }
  console.log(
    `snapshot ${snapshotId} done: ${finalMeta.tables.length} table(s)`,
  );
}

// snapshot id の最終 status (done|error) を取れるまで /_db/snapshot/list を
// polling する。timeout 時は best-effort で cancel を投げて exit 1。
async function waitForSnapshotDone(
  serverUrl: string,
  command: Extract<QueryCommand, { kind: "snapshot-create" }>,
  snapshotId: string,
): Promise<SnapshotMetaOut> {
  const pollIntervalMs = snapshotPollIntervalMs();
  const deadline = Date.now() + command.timeoutSec * 1000;
  while (true) {
    if (Date.now() >= deadline) {
      await cancelSnapshotBestEffort(serverUrl, snapshotId);
      console.error(
        `snapshot create timed out after ${command.timeoutSec}s (cancelled ${snapshotId})`,
      );
      process.exit(1);
    }
    const listBody = (await request(
      serverUrl,
      buildSnapshotListPath({ db: command.db, schema: command.schema }),
      "GET",
      undefined,
      "snapshot list",
    )) as { snapshots: SnapshotMetaOut[] };
    const meta = listBody.snapshots.find((s) => s.id === snapshotId);
    if (!meta) {
      console.error(
        `snapshot create --wait: snapshot ${snapshotId} disappeared from list`,
      );
      process.exit(1);
    }
    if (meta.status !== "running") return meta;
    await sleep(pollIntervalMs);
  }
}

// snapshot 専用の poll interval (search とは別 env var で独立に上書き可能)。
function snapshotPollIntervalMs(): number {
  const raw = process.env.CODE_VIEWER_SNAPSHOT_POLL_MS;
  if (raw === undefined) return 500;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 500;
  return n;
}

async function cancelSnapshotBestEffort(
  serverUrl: string,
  snapshotId: string,
): Promise<void> {
  try {
    await fetch(`${serverUrl}/_db/snapshot/cancel`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: new URL(serverUrl).origin,
        "X-Code-Viewer-Action": "1",
      },
      body: JSON.stringify({ id: snapshotId }),
    });
  } catch {
    // Timeout reporting is more useful than cancel failure details here.
  }
}

async function runSnapshotList(
  serverUrl: string,
  command: Extract<QueryCommand, { kind: "snapshot-list" }>,
): Promise<void> {
  const body = (await request(
    serverUrl,
    buildSnapshotListPath({ db: command.db, schema: command.schema }),
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
