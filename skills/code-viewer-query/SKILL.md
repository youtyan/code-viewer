---
name: code-viewer-query
description: Use when investigating database contents, checking schema, running SQL queries, or answering questions about data in SQLite/MySQL/PostgreSQL databases visible to code-viewer. Triggers on "query", "SQL", "database", "テーブル", "データベース", "クエリ", "スキーマ", "DB".
---

# code-viewer query

Execute read-only SQL queries against databases discovered by code-viewer.
Results are saved to query history and appear in the browser's Database
view, so the human can review what you queried.

## When to use

- Answering "what does this data look like?"
- Checking schema, row counts, sample data
- Investigating data quality or anomalies
- Exploring table relationships

## Requirements

- A code-viewer server must already be running for the repository
  (the human starts it with: `code-viewer`). The CLI never starts one.
- Run from inside the repository, or pass `--cwd <repo>`.
- If `code-viewer` is not on PATH, prefix every command with
  `npx -y @youtyan/code-viewer`.

## Workflow

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

## Guidelines

- Always use LIMIT. The server caps rows but be explicit.
- Write --title for the human, not for yourself.
- Use --body to explain why the query matters.
- Do not query broad PII or secrets unless explicitly asked.
- Use --no-save for exploratory queries that should not remain in history.
- Prefer specific columns over SELECT *.

## Full reference

Before composing queries, read the complete agent guide:

```sh
code-viewer query agent-help
```
