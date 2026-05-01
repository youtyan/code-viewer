---
name: my-npm-publish-procedure
description: Use when preparing, publishing, or troubleshooting npm releases for this project, especially first publishes, npm OTP, Trusted Publisher setup, GitHub Releases, or registry visibility issues.
---

# npm Publish Procedure

## Overview

This project publishes `@youtyan/code-viewer` to npm. Keep the first-publish path, Trusted Publisher setup, and release path separate; mixing repositories or package names is the main failure mode.

## When to Use

Use this when:
- preparing an npm release for `@youtyan/code-viewer`
- debugging `npm publish`, `EOTP`, `E404`, provenance, or Trusted Publisher errors
- creating GitHub Releases that should publish through `.github/workflows/publish.yml`
- checking whether npm and GitHub are aligned before a release

Do not use this for `@youtyan/browser-pilot`; that package has different scripts and release behavior.

## Preconditions

Confirm the working directory before running npm commands:

```sh
pwd
npm pkg get name version
```

Expected:

```json
{
  "name": "@youtyan/code-viewer",
  "version": "0.1.0"
}
```

Never continue if `npm pkg get name` returns another package, especially `@youtyan/browser-pilot`.

## First Publish

The first publish creates the npm package page. Trusted Publisher setup may not be available before this.

1. Confirm package and GitHub state:

```sh
cd /Users/youtyan/Project/code-viewer
npm pkg get name version
git status --short --branch
gh repo view youtyan/code-viewer --json defaultBranchRef,url
```

2. Confirm npm login:

```sh
npm whoami
```

3. Publish the first version locally without provenance:

```sh
npm publish --access public --provenance=false
```

If npm opens an auth URL or asks for OTP, use the browser/1Password flow. Do not paste OTPs into chat. If using a TTY, press Enter when npm asks to open the browser.

4. Verify package access:

```sh
npm access list packages youtyan --json
```

The output must include:

```json
"@youtyan/code-viewer": "read-write"
```

`npm view @youtyan/code-viewer` may return `E404` briefly after publish because registry metadata can lag. Treat the npm package page plus `npm access list packages` as stronger immediate evidence.

## Trusted Publisher Setup

After the package page exists, open:

```text
https://www.npmjs.com/package/@youtyan/code-viewer/access
```

In **Trusted Publisher**, choose **GitHub Actions** and set:

| Field | Value |
|---|---|
| Organization or user | `youtyan` |
| Repository | `code-viewer` |
| Workflow filename | `publish.yml` |
| Environment name | leave blank |

Submit with **Set up connection**. npm may ask for OTP. The success state shows a Trusted Publisher card for `youtyan/code-viewer` and `publish.yml`.

## Normal Release

After Trusted Publisher is configured, releases should go through GitHub Actions, not local `npm publish`.

1. Ensure `package.json` version is the version to release.
2. Ensure `main` contains `.github/workflows/publish.yml`.
3. Create a GitHub Release whose tag is exactly `v${package.json.version}`.
4. The release workflow verifies:
   - `bun install --frozen-lockfile`
   - `bun run verify`
   - tag version equals `package.json` version
   - `npm publish` with OIDC Trusted Publisher

The workflow needs:

```yaml
permissions:
  contents: read
  id-token: write
```

`publishConfig.provenance: true` in `package.json` relies on this OIDC path.

## Common Failures

| Symptom | Cause | Fix |
|---|---|---|
| `@youtyan/browser-pilot` appears in publish output | command was run in the wrong repository | stop; `cd /Users/youtyan/Project/code-viewer`; rerun `npm pkg get name version` |
| `Automatic provenance generation not supported for provider: null` | local publish used provenance outside GitHub Actions | first publish only: use `npm publish --access public --provenance=false` |
| `EOTP` | npm requires one-time auth for publish or settings changes | authenticate in the browser or rerun with local OTP; never expose OTP in chat |
| package access page says `Not Found` | package has not been published yet | perform first publish, then configure Trusted Publisher |
| `npm view` returns `E404` immediately after success | registry metadata lag or permission visibility delay | check npm package page and `npm access list packages youtyan --json`; retry later |
| GitHub Release workflow gets auth errors | Trusted Publisher mismatch | verify owner, repo, workflow filename, and blank environment on npm access page |

## Verification

Before reporting completion, verify the local package and remote package separately:

```sh
bun run verify
npm pack --dry-run
npm access list packages youtyan --json
gh repo view youtyan/code-viewer --json defaultBranchRef,url
git ls-remote --heads origin main
```

For a newly published package, also inspect the npm access page and confirm the Trusted Publisher card is visible.

