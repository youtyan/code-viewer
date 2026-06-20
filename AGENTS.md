# Project Instructions

## Branch And PR Strategy

- Treat `main` as the protected integration branch.
- Do not push work directly to `main`.
- Make changes on a topic branch named by purpose, for example `chore/npm-publish-procedure` or `fix/diff-rendering`.
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

- 新しいボタンやUI要素を追加するとき、独自のCSSスタイルを一から書くな。既存のパターンを探して使い回せ。
- グローバルヘッダー内のボタン → `global-icon-action` クラスを使う。テキスト付きなら `width: auto; padding: 0 8px;` を上書きする程度に留める。
- topbar内のトグルボタン → `.controls > button` の既存パターン（`#ignore-ws`, `#hide-tests` 参照）を踏襲する。
- セグメントボタン → `.seg` パターンを使う。
- 新規パターンが本当に必要な場合のみ、最小限の差分CSSを書く。既存クラスの組み合わせで解決できないか必ず先に検討すること。

## UI/Test Discipline

- Useless tests waste both time and tokens. Never write tests that only prove an implementation contains a string, selector, function name, class name, or other incidental detail without verifying the user-visible behavior or the real contract.
- Do not write or update tests before the intended behavior is clearly understood.
- Do not use string-presence tests such as `source.includes(...)` to bless UI behavior or layout. They are acceptable only for narrow guardrails where DOM/browser verification is unnecessary and the assertion cannot mask a wrong specification.
- For UI changes, verify the actual rendered screen with Browser Pilot before claiming the behavior is correct. Compare the relevant DOM structure and visual placement against the requested existing screen or component.
- If the user points to an existing UI as the reference, inspect that reference implementation first and match its DOM/CSS structure instead of inventing a parallel layout.
- Never adjust tests to match an implementation when the implementation is still disputed. Fix the implementation first, then add behavior-level tests that would fail for the wrong UI.
