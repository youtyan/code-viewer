---
name: code-viewer-annotate
description: Use when walking a human through code in their browser with code-viewer annotations - explaining changes you just made, guiding a code review in reading order, or onboarding walkthroughs. Triggers on "annotate", "ウォークスルー", "コードを説明して", "変更を解説して", "レビューを案内して", "walkthrough", "explain this change in the browser".
---

# code-viewer annotate

Create browser walkthroughs for a human: each annotation jumps every open
code-viewer tab to a file location and renders your explanation directly
under the annotated lines. The human can also replay a session with
text-to-speech playback.

## When to use

- Explaining a change you just made (per-file, per-hunk commentary)
- Guiding a code review: point at the risky lines, in reading order
- Onboarding walkthroughs: "how does feature X flow through the code"

## Requirements

- A code-viewer server must already be running for the repository
  (the human starts it with: `code-viewer`). The CLI never starts one.
- Run from inside the repository, or pass `--cwd <repo>`.
- If `code-viewer` is not on PATH, prefix every command with
  `npx -y @youtyan/code-viewer`.

## Workflow

1. Start a session per walkthrough topic (the title is shown to the human):

   ```sh
   code-viewer annotate start --title "How the cache invalidation works"
   ```

2. Add annotations in READING ORDER (the order the human should follow):

   ```sh
   code-viewer annotate add --file src/cache.ts --line 42-58 --body "..."
   ```

3. Fix ordering without deleting stable ids:

   ```sh
   code-viewer annotate add --after a-existing --file src/cache.ts --line 80 --body "..."
   code-viewer annotate move a-late --before a-early
   ```

4. Annotate the Database screen when the explanation is about data, schema,
   query behavior, ER diagrams, global search, or snapshots:

   ```sh
   code-viewer annotate add-db --db app.db --table users --tab schema --body "..."
   code-viewer annotate add-db --db app.db --table orders --tab data \
     --grid-search failed --filter status=failed --sort created_at:desc \
     --body "..."
   code-viewer annotate add-db --db app.db --tab query \
     --sql "select * from orders where status = 'failed'" --run-query \
     --body "..."
   code-viewer annotate add-db --db app.db --tab search --search-term failed \
     --include-non-text --run-search --body "..."
   ```

   If the browser is already on the exact Database state, use the annotations
   panel pin button to capture the current data grid, query editor, or global
   search state instead of reconstructing it by hand.

## Full reference

Before composing annotations, read the complete agent guide (all commands,
options, body formatting rules):

```sh
code-viewer annotate agent-help
```
