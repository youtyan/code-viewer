# Project Instructions

This file holds only two things: **invariants that are always true**, and **routing to the
skills that hold the actual rules**.

Implementation practice — UI, layout, server handlers, dependencies, diagnosis, tests — lives
in `.agents/skills/project-rules/`. "Read AGENTS.md and you know everything" is
deliberately given up: when a rule exists in two places, neither stays correct, and this
repository has already shipped accidents caused by a rule that was written somewhere the work
did not happen.

## Skills

| When | Read |
|---|---|
| Starting any implementation, investigation, or review in this repository | `.agents/skills/project-rules/SKILL.md` |
| npm publish, releases, Trusted Publisher, registry issues | `.agents/skills/project-npm-publish-procedure/SKILL.md` |

`project-rules` is the entry point; it routes to the area reference for the work at hand
(orientation / ui-layout / ui-surface / server / dependencies / diagnose / testing).
**Go through it before writing code.**

## Branch And PR Strategy

- Treat `main` as the protected integration branch.
- Do not push work directly to `main`.
- Make changes on a topic branch named by purpose, for example `chore/npm-publish-procedure` or `fix/diff-rendering`.
- Do not switch branches on your own. Running `git checkout <branch>`, `git switch <branch>`, or moving to a detached `HEAD` is allowed only when the user explicitly asks for that exact branch change.
- Open a pull request for every change that should enter `main`.
- Merge through GitHub after review/verification, even when the branch contains a single commit.
- Keep commits meaningful. Avoid noisy checkpoint commits, vague messages, or unrelated file churn.
- Do not use `git push --force`, `git push --force-with-lease`, `git commit --amend`, or `git stash`.

## Required Verification

Before opening a PR or reporting completion, run:

```sh
pnpm run verify
npm pack --dry-run
```

This project uses pnpm, not bun or npm. The pinned version is in `packageManager`.

## Public Repository Data Hygiene

- Treat this repository as public. Never copy real project names, customer names, organization names, product names, external service account names, campaign names, table values, domain names, URLs, or other proper nouns observed from a local database, browser screenshot, API response, log, or developer environment into source code, tests, comments, documentation, snapshots, fixtures, or commit messages.
- Local app data and screenshots are evidence for debugging only. They are not acceptable fixture content. Use neutral placeholders such as `sample_table`, `sample_column`, `example status`.
- Do not preserve a real proper noun just because it is not a credential. Public repository hygiene covers business and implementation context as well as secrets.
- Before reporting completion, scan newly added or edited tests, docs, comments, and fixtures for proper nouns that came from observed runtime data.

The identifier half of this is machine-checked by `web-src/test/public-repo-hygiene.test.ts`
(a ratchet over `web-src/test/`, `web/style.css`, `skills/`, and this file). It catches
database-shaped `snake_case` names that are not on the reviewed list; it does **not** catch
proper nouns that are not identifiers, or column values. A green run is not an audit.

This one stays here rather than in a skill because the failure is unrecoverable: it lands in
git history.

## Release Strategy

- npm package: `@youtyan/code-viewer`.
- Normal releases are made from GitHub Releases, not local `npm publish`. The release tag must match `package.json` exactly as `v${version}`.
- Do not run local npm authentication/registry commands (`npm whoami`, `npm access list packages`, `npm view`, `npm publish`) for normal release readiness.
- Everything else about releases is in `.agents/skills/project-npm-publish-procedure/SKILL.md`.

## Desktop-Only Scope

- This app is a local desktop tool. Do not spend implementation effort on phone or narrow mobile layouts unless the user explicitly asks for mobile support in that specific task.
- Prefer dense desktop workflows, resizable panels, stable dimensions, keyboard and pointer ergonomics, and wide-screen information layout.

## Request Lifecycle Discipline (Anti-Stuck)

Moved. The full rules — existing primitives (`trackLoad`, `cancelInFlightRequests`,
`SERVER_GENERATION`, `NETWORK_ACTIVITY.installFetch`, the `generation` response field),
idempotent view-switch functions, and loading-state terminators — now live in
`.agents/skills/project-rules/references/server.md`.

Source comments that say "see AGENTS.md Request Lifecycle Discipline" point there.

## How To Add A Rule

Try top to bottom. **Lower is weaker.**

| Condition | Where it goes |
|---|---|
| A machine can check it statically | a `biome.jsonc` rule, or a guard test in `web-src/test/` |
| Not checkable, but it is a fixed procedure | the matching file under `.agents/skills/project-rules/references/` |
| Not checkable, and it applies every turn because violating it is unrecoverable | this file, 1-2 lines |
| It is the reason for one specific line | a comment above that line |

"Writing a check is tedious, so I will write prose" is forbidden — that is the exact path that
produced accidents here.

Two derived prohibitions:

- **A comment in file A does not bind file B.** A rule meant to hold repository-wide cannot be
  expressed as a comment. Write a check, or put it in a reference.
- **Never write line numbers in prose.** Refer to symbol names plus file names. Line numbers go
  stale silently; every number that used to be in this file had drifted by hundreds of lines.
