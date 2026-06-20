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

```sh
code-viewer query snapshot create --db app.db \
    --tables users,orders \
    --note "Before running user registration test"
```

### 2. Perform the operation

The human (or a test runner, migration script, etc.) modifies the database.

### 3. Take an "after" snapshot

```sh
code-viewer query snapshot create --db app.db \
    --tables users,orders \
    --note "After running user registration test"
```

### 4. Get snapshot IDs

```sh
code-viewer query snapshot list --db app.db
```

### 5. View the diff

Compare table-level summary (which tables changed and how many rows):

```sh
code-viewer query diff tables --before snap-abc123 --after snap-def456
```

Drill into row-level changes for a specific table:

```sh
code-viewer query diff rows --before snap-abc123 --after snap-def456 \
    --table users
```

The human can also view all snapshots and diffs in the browser's
Database > Snapshot tab.

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

## Full reference

```sh
code-viewer query agent-help
```
