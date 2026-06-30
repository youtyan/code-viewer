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

1. Identify the database path or datastore id from the browser's Database tab,
   current route, project fixtures, or the user's instruction.

   To inspect saved query history, run:

   ```sh
   code-viewer query list --json
   ```

2. Execute a query:

   ```sh
   code-viewer query exec --db data.db --sql "SELECT * FROM users LIMIT 10" \
       --title "Sample user data" --body "Checking what user records look like."
   ```

3. The human sees results in the browser's Database > Query History panel.

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
