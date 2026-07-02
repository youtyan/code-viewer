# Project Instructions

## Branch And PR Strategy

- Treat `main` as the protected integration branch.
- Do not push work directly to `main`.
- Make changes on a topic branch named by purpose, for example `chore/npm-publish-procedure` or `fix/diff-rendering`.
- Do not switch branches on your own. Running `git checkout <branch>`, `git switch <branch>`, or moving to a detached `HEAD` is allowed only when the user explicitly asks for that exact branch change.
- Open a pull request for every change that should enter `main`.
- Merge through GitHub after review/verification, even when the branch contains a single commit.
- Keep commits meaningful. Avoid noisy checkpoint commits, vague messages, or unrelated file churn.
- Do not use `git push --force`, `git push --force-with-lease`, `git commit --amend`, or `git stash`.

## Release Strategy

- npm package: `@youtyan/code-viewer`.
- Normal releases are made from GitHub Releases, not local `npm publish`.
- The release tag must match `package.json` exactly as `v${version}`.
- `.github/workflows/publish.yml` publishes to npm through Trusted Publisher/OIDC.
- Use local `npm publish --access public --provenance=false` only for first-publish recovery or other explicitly approved exceptional recovery work.

## Publish Procedure Reference

- For npm publish, first-publish, Trusted Publisher, OTP, provenance, or registry visibility issues, read:
  `.agents/skills/my-npm-publish-procedure/SKILL.md`

## Required Verification

Before opening a PR or reporting release readiness, run:

```sh
bun run verify
npm pack --dry-run
```

For release-related work, also confirm:

```sh
gh repo view youtyan/code-viewer --json defaultBranchRef,url
git ls-remote --heads origin main
```

Do not run local npm authentication/registry commands such as `npm whoami`,
`npm access list packages`, `npm view`, or `npm publish` for normal release
readiness. Normal releases publish through GitHub Releases and Trusted
Publisher/OIDC. Use local npm auth commands only for first-publish recovery,
Trusted Publisher setup verification, or npm-specific troubleshooting.

## UI Component Reuse

- When adding new buttons or UI elements, do not write custom CSS from scratch. Find and reuse existing patterns first.
- For buttons in the global header, use the `global-icon-action` class. For text buttons, keep changes limited to overrides such as `width: auto; padding: 0 8px;`.
- For toggle buttons in the topbar, follow the existing `.controls > button` pattern used by `#ignore-ws` and `#hide-tests`.
- For segmented buttons, use the `.seg` pattern.
- Interactive controls must keep stable box dimensions across idle, hover, focus, loading, success, warning, disabled, and updated states. Never change button labels, padding, borders, or result text in a way that shifts the clickable target after the user acts. Reserve fixed space up front or use icon-only state indicators.
- Add new UI patterns only when they are truly necessary. First verify that existing classes cannot solve the requirement in combination.

## Desktop-Only UI Scope

- This app is a local desktop tool. Do not spend implementation effort on phone or narrow mobile layouts unless the user explicitly asks for mobile support in that specific task.
- Prefer dense desktop workflows, resizable panels, stable table/board dimensions, keyboard and pointer ergonomics, and wide-screen information layout over mobile stacking.

## Design Reuse Discipline

- Before designing a change, thoroughly inspect the existing codebase for reusable modules, components, helpers, styles, route patterns, rendering utilities, and tests.
- Prefer extending or composing existing code over introducing parallel implementations.
- In design notes or implementation summaries, call out the existing code that was considered for reuse and explain why any new abstraction is necessary.

## Public Repository Data Hygiene

- Treat this repository as public. Never copy real project names, customer names, organization names, product names, external service account names, campaign names, table values, domain names, URLs, or other proper nouns observed from a local database, browser screenshot, API response, log, or developer environment into source code, tests, comments, documentation, snapshots, fixtures, or commit messages.
- Local app data and screenshots are evidence for debugging only. They are not acceptable fixture content. When a test needs realistic data, replace it with neutral generic placeholders such as `sample_table`, `sample_column`, `example status`, or `Japanese column description`.
- Do not preserve a real proper noun just because it is not a credential. Public repository hygiene covers business context and implementation context as well as secrets.
- Before reporting completion, scan newly added or edited tests, docs, comments, and fixtures for proper nouns that came from observed runtime data. If any slipped in, replace them before handing off.

## Request Lifecycle Discipline (Anti-Stuck)

Never reintroduce the "stuck UI / stale response wins" regression. Read this section before writing any new API handler, fetch call, or view-switch hook. **Reuse the existing primitives by name. Do not invent new wrappers, new deps, or new server-generation accessors.**

Existing primitives (do not duplicate):

- `let SERVER_GENERATION = 0` in `app.ts` (around line 1956) — the single authoritative server-generation counter. Bumped from one place in `app.ts`. Reused by every consumer.
- `NETWORK_ACTIVITY.installFetch(window)` in `app.ts` (around line 148) — wraps every `fetch` in an `AbortController`. Already global, do not bypass.
- `trackLoad<T>(promise): Promise<T>` in `app.ts` (around line 1960) — registers a promise so it participates in `cancelInFlightRequests`. View modules receive it as `deps.trackLoad`. **Always use this name.**
- `cancelInFlightRequests()` in `app.ts` (around line 164) — aborts every tracked fetch. Invoke this on user-initiated navigation cancellations.
- `handleFileDiff` in `preview.ts` (the `generation` field around line 1378) — the reference server-handler pattern. New handlers include `generation` in their JSON response, taken from the same module-level counter `generation` in `preview.ts`.
- `history-view.ts` — the reference for client-side generation discarding. Bump a local `generation`, compare to the response, drop stale results.

Rules:

- Every `fetch` is already wrapped by `installFetch`. Do not bypass it with raw `XMLHttpRequest`, worker-side fetch, or hand-rolled `AbortController`.
- Every new fetch call goes through `deps.trackLoad(fetch(url)...)`. Do not invent a new deps name (`fetchWithCancel`, `loadGuarded`, etc.). The name is `trackLoad`.
- Server handlers that can race with themselves or be re-entered include `generation` in the JSON response. Do not invent a new field name or wrap it under a sub-object.
- The client checks `response.generation === myGeneration` before mounting the result. Do not add a new `getServerGeneration` / `setServerGeneration` accessor — view modules already track their own generation counter. The shared `SERVER_GENERATION` in `app.ts` is for SSE / diff-pipeline coordination; do not multiply it into per-view deps.
- View-switch / enter functions (`enterHistory`, `renderBlamePage`, `applySourceRouteToShell`, etc.) must be idempotent.
  - Re-invoking with the same parameters while the latest generation is already mounted is a no-op.
  - Never bump generation without scheduling the matching refetch — that leaves the panel blank.
- Every loading state must have a terminator. If you set `setStatusText("loading...")`, every code path (success, failure, cancellation, early `return`) clears it.
- On SPA navigation (tab click, popstate, `setRoute`) cancel in-flight fetches via `cancelInFlightRequests` or invalidate them with the local generation counter. Never let a previous-view response overwrite the next view.
- Implementations that skip these rules — or invent parallel primitives — are forbidden because they bring back the "stuck UI" regression. Reviewers must verify every new fetch / handler / view-switch against this section.

## UI/Test Discipline

- Useless tests waste both time and tokens. Never write tests that only prove an implementation contains a string, selector, function name, class name, or other incidental detail without verifying the user-visible behavior or the real contract.
- Do not write or update tests before the intended behavior is clearly understood.
- Do not use string-presence tests such as `source.includes(...)` to bless UI behavior or layout. They are acceptable only for narrow guardrails where DOM/browser verification is unnecessary and the assertion cannot mask a wrong specification.
- For UI changes, verify the actual rendered screen with Browser Pilot before claiming the behavior is correct. Compare the relevant DOM structure and visual placement against the requested existing screen or component.
- If the user points to an existing UI as the reference, inspect that reference implementation first and match its DOM/CSS structure instead of inventing a parallel layout.
- Never adjust tests to match an implementation when the implementation is still disputed. Fix the implementation first, then add behavior-level tests that would fail for the wrong UI.
- Do not put verbose transient status text in narrow chrome such as global headers, sidebars, topbars, compact toolbars, table filter rows, or beside small icon buttons. In constrained areas prefer icon-only buttons, dots, `aria-label`/`title`, disabled/busy states, or a reserved-width status slot that cannot move controls. Text like "no changes", "updated", or row-count deltas belongs in a wider content area only when it is genuinely useful. Even in wider areas, transient status text must not live inside a clickable control's own label; put it in a separate, non-interactive slot so the button hit target never moves.

## Desktop Viewport Scope

- This app is a local desktop workflow. Smartphone viewport support is not required for any screen unless the user explicitly requests it.
- For UI work, prioritize desktop layouts, pointer/drag interactions, dense information display, and efficient local-tool workflows. Do not spend default verification effort optimizing or reworking smartphone layouts.
