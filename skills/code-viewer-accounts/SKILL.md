---
name: code-viewer-accounts
description: Use when the human wants to add, register, sign in, rename, or remove a Claude Code or Codex account in code-viewer, or run several accounts side by side, through the `code-viewer accounts` CLI instead of clicking through Settings > Accounts. Triggers on "アカウントを追加", "アカウント追加したい", "アカウントを増やしたい", "claudeのアカウント", "codexのアカウント", "複数アカウント", "別アカウントでログイン", "アカウントを削除", "アカウントを外す", "アカウント名を変更", "add an account", "rename account", "remove account", "add another claude account", "second codex account", "multiple accounts", "sign in another account".
---

# code-viewer accounts

Add Claude Code / Codex accounts for the human and get each one signed in.
An account is its own settings directory (`CLAUDE_CONFIG_DIR` for claude,
`CODEX_HOME` for codex), so sign-ins, history and usage stay apart. The CLI
calls the same server routes as Settings > Accounts; the server enforces what
may be shared and refuses two accounts on one directory.

## Requirements

- code-viewer must already be running (the human starts it with: `code-viewer`,
  in any repository, and leaves it running). The CLI never starts code-viewer
  itself.
- tmux must be installed: the sign-in command runs in a new tmux window.
- If `code-viewer` is not on PATH, prefix every command with
  `npx -y @youtyan/code-viewer`.

## What you must never do

- Never ask for, read, copy, or type passwords, API keys, tokens, or one-time
  codes. Approving a sign-in is the human's step, in their browser.
- Never edit `accounts.json` or files inside a settings directory yourself.
  The CLI is the contract.
- Never delete a settings directory, even when the human removes the account.
  `remove` only takes it off the list; deleting the sign-in and history is the
  human's call, done by hand.

## 1. Ask, then check what exists

Ask the human, in one message: which service (claude, codex, or both), how many
accounts, and a display name for each (for example `work`, `personal`). Ask
whether any of them already has a settings directory they signed in with
before; those are registered instead of created.

```sh
code-viewer accounts list --json
```

`list` includes the default accounts (`claude:default`, `codex:default`,
which use `~/.claude` / `~/.codex`). Pick names that no other account of the
same service uses, and not `Default` / `既定`: creating does not refuse a
repeated name yet, and the lists would show two rows the human cannot tell
apart.

## 2. Create (or register) each account

To see what creating would do before doing it:

```sh
code-viewer accounts plan --agent claude --name work
```

Create it. The entries the official documentation calls user settings
(for claude `settings.json`, `CLAUDE.md`, `skills`, `commands`, `agents`…; for
codex `config.toml`, `AGENTS.md`, `hooks.json`…) are linked from the default
account, so the human's settings, hooks and usage status line carry over. Sign-in
data, history and sessions are never linked.

```sh
code-viewer accounts create --agent claude --name work --json
code-viewer accounts create --agent codex --name work --json
```

Anything else in the default directory (plugins, scripts the human keeps
there) is listed by `plan` as optional and is not linked. Only when the human
asks for one, add it by the name `plan` printed:

```sh
code-viewer accounts create --agent claude --name work --share plugins --json
```

For a directory that already exists:

```sh
code-viewer accounts register --agent claude --name old-laptop --config-dir /path/to/dir --json
```

Keep the `id` each command prints; the next steps take it.

If a command fails, show the human its error text as it is (it names the
reason: the name is taken, the directory is already registered, and so on) and
ask how to proceed. Do not retry with a changed name on your own.

## 3. Sign in, one account at a time

```sh
code-viewer accounts login --account <id> --json
```

This opens the official sign-in command (`claude auth login` / `codex login`)
for that account in a new tmux window and prints its `paneId`. Read what the
window shows:

```sh
code-viewer terminal capture --target <paneId>
```

Then tell the human:

- Approve it in the browser. If a URL is shown instead of a browser opening,
  give them that URL.
- **Before approving, make sure the browser is signed in to the account they
  want this one to be.** For a second account of the same service, they switch
  the browser's account first (or open the URL in another browser profile).
  Otherwise the approval goes to the account already signed in, and both
  entries end up as the same person.
- If the window asks something you cannot answer from its text, relay the
  question. They can answer it in code-viewer (the window appears in the
  agents list) or with `tmux attach -t code-viewer-login`.

Wait for it to finish:

```sh
code-viewer accounts wait --account <id>
```

`wait` asks the CLI for the sign-in state every few seconds and prints the
email it answered. Tell the human which email the account signed in as, so they
can catch a wrong-account approval right away. If `wait` times out, capture the
window again and report what it shows.

Do the next account only after this one is signed in.

## 4. Finish

```sh
code-viewer accounts list
```

Report each account's name, service, and signed-in email. To start an agent
with one of them, the human uses "New agent" in code-viewer and picks the
account.

## Rename or remove

Only the display name can change. The service and the settings directory
cannot; for those, remove the account and register the directory again.

```sh
code-viewer accounts rename --account <id> --name personal
```

Confirm with the human before removing, naming the account and its email from
`list`. Removing takes it off the list only: the settings directory (sign-in,
history) stays, running agents keep running, and `register` brings it back.

```sh
code-viewer accounts remove --account <id>
```

The default accounts (`claude:default`, `codex:default`) cannot be renamed or
removed.

## Full reference

```sh
code-viewer accounts help
code-viewer accounts agent-help
```
