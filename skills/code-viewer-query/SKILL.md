---
name: code-viewer-query
description: Use when investigating database contents, checking schema, running SQL queries, locating a value across many tables, or answering questions about data in SQLite/MySQL/PostgreSQL databases visible to code-viewer. Triggers on "query", "SQL", "database", "search", "find value", "locate column", "テーブル", "データベース", "クエリ", "スキーマ", "DB", "全文検索", "横断検索", "どのテーブルに".
---

# code-viewer query

Execute read-only SQL queries — and run global table-wide searches —
against databases discovered by code-viewer. Query results are saved to
query history; search results are returned by the CLI and mirror the
browser's Database > Search tab, so the human can review the same workflow.

## When to use

- Answering "what does this data look like?"
- Checking schema, row counts, sample data
- Investigating data quality or anomalies
- Exploring table relationships
- Locating where a specific value (an email, an id, a free-text fragment)
  appears when you do not yet know the table or column — use the global
  search workflow below.

## When NOT to use this skill

- Capturing a database snapshot or diffing two snapshots before/after an
  operation → use the `code-viewer-snapshot` skill instead. That skill owns
  `snapshot create / list / note / delete` and `diff tables / diff rows`.

## Requirements

- A code-viewer server must already be running for the repository
  (the human starts it with: `code-viewer`). The CLI never starts one.
- Run from inside the repository, or pass `--cwd <repo>`.
- If `code-viewer` is not on PATH, prefix every command with
  `npx -y @youtyan/code-viewer`.

## Workflow: Run a query

1. Discover the datastore ids the running server has detected. This is the
   AI-friendly equivalent of opening the browser's Database tab and reading
   the sidebar — it lists every SQLite file plus PostgreSQL / MySQL / Redis
   / Elasticsearch / S3 service that any nearby `docker-compose` exposes.
   Use the printed `id` as `--db` on every other command. Credentials and
   internal config are stripped server-side.

   ```sh
   code-viewer query sources --json
   ```

   Default (no `--json`) output is one source per line as
   `<id>\t<kind>\t<name>`, with any `truncated` or `dockerError` notice
   appended as `# ...` comment lines so the AI can copy ids without
   stripping JSON.

   To skip the per-SQL-source "what command should I run next?" step, use
   `--commands`. For SQLite / PostgreSQL / MySQL sources it prints a small
   block of shell-pasteable next-step commands (`schema --with-columns
   --json`, an `exec` example with `SELECT 1 --no-save`, plus `schemas` for
   PostgreSQL), followed by paste-safe `list --db <id> --json` and
   `snapshot list --db <id> --json` so you can step into the existing query
   history and snapshot store without rebuilding those commands. For Redis
   sources it prints `redis databases / redis keys` lines, for Elasticsearch
   sources it prints `elasticsearch indices / elasticsearch docs` lines, and
   for S3 sources it prints a browser Datastores pane hint
   (S3 has no read-only CLI yet). Every emitted SQL command line pins
   `--server '<url>'` to the same server URL this invocation resolved, so
   pasting them into a different shell never silently falls back to
   auto-discovery. Every `--db` value and the server URL are wrapped in
   POSIX single-quotes so paths or URLs with spaces or `'` paste safely.
   Notice/comment metadata is collapsed to one line so copied command blocks
   stay intact.
   `--json` and `--commands` are mutually exclusive.

   ```sh
   code-viewer query sources --commands
   ```

2. Inspect tables, columns, and DDL without writing dialect-specific SQL.
   These commands wrap the same schema endpoints as the browser, so use them
   before guessing table names or engine-specific catalog queries.

   ```sh
   code-viewer query schemas --db docker:pg-svc --json
   code-viewer query schema --db app.db --json
   code-viewer query schema --db docker:pg-svc --schema analytics --with-columns --json
   code-viewer query columns --db app.db --table users --json
   code-viewer query ddl --db app.db --table users
   ```

   Default output is tab-separated and human-readable. Pass `--json` when the
   next agent step should parse the full endpoint response. `query schema
   --json` adds paste-safe `columnsCommand` and `ddlCommand` fields to every
   `tables[]` element — each pins `--server '<url>'` and single-quotes the
   `--db` / `--schema` / `--table` arguments — so you can step into a single
   table without rebuilding the call. Default (non-JSON) mode prints only
   `<table>\t<type>\t<rowCount>` lines, unchanged.

3. To inspect saved query history (separate from source discovery), run:

   ```sh
   code-viewer query list --json
   ```

   `list --json` enriches each `entries[]` element with a paste-safe
   `replayCommand` field — `code-viewer query --server '<url>' exec --db
   '<dbId>' [--schema '<schema>'] --sql '<sql>' [--title '<title>']
   --no-save` — so you can re-run any past query without rebuilding the
   call. `server URL / dbId / schema / sql / title` are POSIX single-quoted;
   `--title` is included only when the entry has one. `body` and
   `--max-rows` are intentionally omitted (re-author `body` per replay,
   and override `--max-rows` based on the entry's `truncated` flag).
   `--no-save` is fixed so replay does not re-pollute history; drop it
   manually if you want the replay saved. Default (non-JSON) mode prints
   only the existing summary lines.

   For PostgreSQL multi-schema query history, pass `--schema <name>` with
   `--db` so list/clear stays scoped to that schema:

   ```sh
   code-viewer query list --db docker:pg-svc --schema analytics --json
   code-viewer query clear --db docker:pg-svc --schema analytics
   ```

4. Execute a query against an id picked from step 1:

   ```sh
   code-viewer query exec --db data.db --sql "SELECT * FROM users LIMIT 10" \
       --title "Sample user data" --body "Checking what user records look like."
   code-viewer query exec --db docker:pg-svc --schema analytics \
       --sql "SELECT * FROM events LIMIT 10"
   ```

   `exec` prints pretty JSON with `dbId`, `columns`, `columnTypes`, `rows`,
   `rowCount`, `truncated`, `elapsedMs`, and optional `schema` /
   `executedSql`. Check `truncated` before treating the result as complete.

5. The human sees results in the browser's Database > Query History panel.

## Workflow: Find a value across all tables (global search)

Use this when you have a value (an email, a foreign key, a free-text
fragment) and do not yet know which table or column holds it. The CLI
mirrors the browser's Database > Search tab and blocks until the scan
finishes or `--timeout` expires.

```sh
code-viewer query search --db app.db --term "needle@example.com" --json
```

Narrow the scan when you already know the tables to look at, and bound the
hit set with `--max-hits` (per table):

```sh
code-viewer query search --db app.db --term "needle@example.com" \
    --tables users,orders --max-hits 20 --json
```

By default only text-like columns (TEXT/VARCHAR/CLOB/JSON/UUID/...) are
scanned. Add `--include-non-text` to also scan non-BLOB columns such as
numeric ids. BLOB/BYTEA columns are always skipped. Leave it off unless
the value might live outside text-like columns — the default is faster and
avoids noisy hits.

Each hit names the `table`, `column`, a `valuePreview`, and (for SQL stores
with a primary key) a JSON-serialized `rowKeyJson` you can feed into a
follow-up `query exec` with a matching `WHERE` clause.

The default output prints hit lines plus a summary; pass `--json` to get
the full status payload (hits + scan counts) for programmatic use. An
empty result is a clean exit 0 — `no hits (scanned N tables)` on stdout.

Tune `--timeout <sec>` (default 60) when scanning a large database.
On timeout the running job is cancelled and the CLI exits 1 with a
"search timed out after Ns" message.

PostgreSQL: pass `--schema <name>` to pin the search to one schema; without
it the server uses `public` (or the first available schema).

## Guidelines

- Always use LIMIT in `--sql`. The server caps rows but be explicit.
- Before writing schema-discovery SQL, prefer `query schema`, `query columns`,
  or `query ddl`; they work across SQLite, PostgreSQL, and MySQL through the
  server's existing introspection endpoints.
- When using PostgreSQL schemas, pass the same `--schema` to `query exec` that
  you used for introspection.
- Write `--title` for the human, not for yourself.
- Use `--body` to explain why the query matters.
- Do not query broad PII or secrets unless explicitly asked.
- Use `--no-save` for exploratory queries that should not remain in history.
- Prefer specific columns over `SELECT *`.
- For `search`, prefer `--tables` when you already know which tables to scan,
  and `--max-hits` to keep large hit sets bounded.
- For `search`, leave `--include-non-text` off unless the value can live in
  a non-text column such as a numeric id. BLOB/BYTEA are always skipped.

## Full reference

Before composing queries, read the complete agent guide:

```sh
code-viewer query agent-help
```
