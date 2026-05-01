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
npm access list packages youtyan --json
gh repo view youtyan/code-viewer --json defaultBranchRef,url
git ls-remote --heads origin main
```

