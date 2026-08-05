---
name: code-viewer-journal
description: Use when reading, creating, updating, claiming, completing, or linking code-viewer Work Log tasks through the `code-viewer journal` CLI. Triggers on "work log", "journal task", "task queue", "AI task", "GitHub Issue", "ワークログ", "タスク管理", "タスク一覧", "Issue紐づけ".
---

# code-viewer journal

Operate code-viewer Work Log tasks through the CLI. The CLI is the contract;
do not edit `.code-viewer/daily-journal.json` or `.code-viewer/tasks.json`
directly.

## Requirements

- A code-viewer server must already be running for the repository
  (the human starts it with: `code-viewer`). The journal CLI never starts one.
- Run from inside the repository, or pass `--cwd <repo>`.
- If `code-viewer` is not on PATH, prefix every command with
  `npx -y @youtyan/code-viewer`.
- For GitHub Issue listing or linking, `gh` must be installed. Check with:

  ```sh
  code-viewer doctor --json
  ```

  The `github.gh` row reports whether `gh --version` works. Doctor does not
  inspect GitHub auth metadata.

## Read tasks

Use JSON whenever another agent step will parse the result:

```sh
code-viewer journal tasks --json
code-viewer journal tasks --status todo --label ai-ready --json
code-viewer journal task-next --label ai-ready --limit 5 --json
```

Guidelines:

- Use `task-next` for execution order; do not invent your own sort unless the
  human asked for it.
- Treat labels as filters, priority as importance, and board order as human
  ordering.
- Do not process `draft` tasks unless the human explicitly asked for drafts.

## Create tasks

Create local tasks through `task-add`:

```sh
code-viewer journal task-add \
  --title "Implement example workflow" \
  --status todo \
  --priority p1 \
  --label ai-ready \
  --label backend \
  --body "Acceptance criteria and notes."
```

Use `--dry-run` before generated or bulk task creation:

```sh
code-viewer journal task-add --title "Check task shape" --label ai-ready --dry-run
```

## Update tasks

Use `task-update` for title, status, priority, labels, due/source dates, and
body changes:

```sh
code-viewer journal task-update <task-id> --status doing
code-viewer journal task-update <task-id> --priority p0 --label ai-ready --label ui
code-viewer journal task-update <task-id> --title "New title" --body "Updated notes."
```

When replacing labels, pass every label that should remain. Use
`--clear-labels` only when the task should end with no labels.

## Claim and finish

Claim exactly one task before editing code:

```sh
code-viewer journal task-claim <task-id> --by agent --wip-limit 1
```

Mark the task done with a concrete verification note:

```sh
code-viewer journal task-done <task-id> --by agent --note "Implemented and verified with pnpm test."
```

## GitHub Issues

List GitHub Issues read-only:

```sh
code-viewer journal github-issues --repo owner/repo --json
```

Link an issue to the local board without updating GitHub:

```sh
code-viewer journal task-link-issue 123 --repo owner/repo --status draft --label ai-ready
```

Rules:

- Never copy the GitHub Issue body into a local task.
- `task-link-issue` reads only metadata needed for the local link.
- The local task receives `github` and `issue-<number>` labels automatically.
- Put private planning notes in the local task body or a later
  `task-update`, not in GitHub.

## Daily entries

Use daily entries for work not already represented by a task:

```sh
code-viewer journal add --date today --label ai --body "..."
code-viewer journal list --limit 7 --json
```

## Full reference

Before composing non-trivial commands, read the complete agent guide:

```sh
code-viewer journal agent-help
```
