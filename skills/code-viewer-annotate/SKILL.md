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

## Full reference

Before composing annotations, read the complete agent guide (all commands,
options, body formatting rules):

```sh
code-viewer annotate agent-help
```
