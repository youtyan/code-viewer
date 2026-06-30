---
name: code-viewer-snapshot
description: Use when taking database snapshots before/after an operation to verify what changed, diffing two points in time, or confirming a migration/test/feature modified the expected tables and rows. Triggers on "snapshot", "diff", "スナップショット", "差分", "before/after", "DBの変更を確認", "マイグレーション検証", "テスト前後の比較".
---

# code-viewer snapshot

Take point-in-time snapshots of database tables and diff them to see
exactly what changed — inserted, updated, and deleted rows with full
before/after values. Use it to verify migrations, test runs, or any
operation that should modify the database in a predictable way.

## When to use

- Verifying a migration added/removed the expected rows
- Confirming a test correctly modifies the database
- Debugging "what did that operation actually change?"
- Auditing data changes before and after a deploy or script

## Requirements

- A code-viewer server must already be running for the repository
  (the human starts it with: `code-viewer`). The CLI never starts one.
- Run from inside the repository, or pass `--cwd <repo>`.
- If `code-viewer` is not on PATH, prefix every command with
  `npx -y @youtyan/code-viewer`.

## Workflow

### 1. Take a "before" snapshot

Specify which database and tables to capture. Always use `--tables` to
avoid scanning unnecessary tables.

Add `--wait --json` so the CLI blocks until the snapshot finishes and
returns the final metadata as JSON. This lets an AI agent grab the
snapshot id from the `id` field without a separate
`snapshot list` poll. Default `--timeout` is 120 seconds; on timeout the
running snapshot is cancelled and the CLI exits 1.

```sh
code-viewer query snapshot create --db app.db \
    --tables users,orders \
    --note "Before running user registration test" \
    --wait --json
```

The ack-only form (no `--wait`) returns immediately with
`{ ok, message, snapshotId, pollCommand }` and the scan runs in the
background; use `snapshot list` (or paste `pollCommand` verbatim) to
confirm completion before diffing.

### 2. Perform the operation

The human (or a test runner, migration script, etc.) modifies the database.

### 3. Take an "after" snapshot

```sh
code-viewer query snapshot create --db app.db \
    --tables users,orders \
    --note "After running user registration test" \
    --wait --json
```

### 4. Get snapshot IDs

`--wait --json` already prints the `id` for each created snapshot. If you
took the snapshots without `--wait`, list them to find the IDs:

```sh
code-viewer query snapshot list --db app.db
```

`snapshot create` (no-wait) also prints a paste-safe poll command that
pins `--server '<url>'` and single-quotes db/schema, so copying it never
silently falls back to auto-discovery. The same string is available as
the `pollCommand` field in `--json` ack output.

`snapshot list --json` enriches each `snapshots[]` element with paste-safe
`deleteCommand` and `noteCommand` fields. Each pins `--server '<url>'` and
single-quotes the snapshot id; `noteCommand` also quotes the current note
as-is so you can paste the line and edit the value to update. Use these
when you want to drop or re-label snapshots without rebuilding the call.

### 5. View the diff

Compare table-level summary (which tables changed and how many rows):

```sh
code-viewer query diff tables --before snap-abc123 --after snap-def456
```

Each table summary line is followed by a paste-safe
`# diff rows: code-viewer query --server '<url>' diff rows --before '<id>'
--after '<id>' --table '<table>' --json` comment line, so you can copy the
exact next command per table without rebuilding it. With `--json`, the same
literal is exposed as a `diffRowsCommand` field on each `tables[]` element.

Drill into row-level changes for a specific table:

```sh
code-viewer query diff rows --before snap-abc123 --after snap-def456 \
    --table users
```

The human can also view all snapshots and diffs in the browser's
Database > Snapshot tab.

## PostgreSQL (multi-schema)

For PostgreSQL with multiple schemas, pass `--schema <name>` to BOTH
`snapshot create` and the matching `snapshot list`. Snapshot create binds
the snapshot to that schema, the polling lookup performed during `--wait`
re-uses it, and `snapshot list --schema` filters to the same scope so the
before/after pair stays consistent. Without `--schema`, snapshot create
infers the schema (`public` or the first available) and `snapshot list`
returns every snapshot for the database id.

```sh
code-viewer query snapshot create --db docker:pg-svc --schema analytics \
    --tables events \
    --note "Before backfill" \
    --wait --json

code-viewer query snapshot list --db docker:pg-svc --schema analytics --json
```

SQLite / MySQL / Redis / S3 do not need `--schema` (single namespace).

## Managing snapshots

```sh
# Update a snapshot's note
code-viewer query snapshot note --id snap-abc123 --note "Updated note"

# Delete a snapshot
code-viewer query snapshot delete --id snap-abc123
```

## Guidelines

- Always specify `--tables` — snapshotting every table wastes time.
- Write meaningful `--note` values — the human uses them to tell
  snapshots apart.
- Take both snapshots against the same `--db` and `--tables`.
- For large tables, the snapshot captures all rows — be mindful of
  database size.
- The diff is computed on demand, not stored — you can diff any two
  snapshots of the same database.
- Prefer `--wait --json` when you want to chain the next command on the
  resulting snapshot id. Tune `--timeout <sec>` (default 120) for very
  large tables.

## Full reference

```sh
code-viewer query agent-help
```
