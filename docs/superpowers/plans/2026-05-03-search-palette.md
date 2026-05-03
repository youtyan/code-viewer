# Search Palette Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Alfred-style `Ctrl+K` file search and `Ctrl+G` grep palettes with strict diff-vs-repository scope separation.

**Architecture:** Keep reusable search logic in small TypeScript modules, add read-only server endpoints for repository file lists and grep, then wire a focused palette UI into `web-src/app.ts`. Existing sidebar filtering remains separate and focused by `/`.

**Tech Stack:** Bun, TypeScript, DOM APIs, existing local Bun HTTP server, `rg` when available, `git grep` for tree refs.

---

## File Structure

- Create `web-src/fuzzy-search.ts`: scoring and range calculation for file palette results.
- Create `web-src/search-palette.ts`: pure helpers for scope labels, keyboard movement, and result limiting.
- Create `web-src/server/search.ts`: server-side file list and grep helpers.
- Modify `web-src/types.ts`: add file list and grep response types.
- Modify `web-src/routes.ts`: add optional `line` to file routes.
- Modify `web-src/server/preview.ts`: expose `/_files` and `/_grep`.
- Modify `web-src/app.ts`: palette UI, shortcuts, client caches, navigation.
- Modify `web/style.css`: Alfred-style palette styling.
- Add tests under `web-src/test/`.

## Task 1: Fuzzy File Scoring

**Files:**
- Create: `web-src/fuzzy-search.ts`
- Test: `web-src/test/fuzzy-search.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, expect, test } from 'bun:test';
import { fuzzyMatchPath } from '../fuzzy-search';

describe('fuzzyMatchPath', () => {
  test('prefers basename matches over directory-only matches', () => {
    const app = fuzzyMatchPath('app', 'web-src/app.ts');
    const dir = fuzzyMatchPath('app', 'app/server/index.ts');
    expect(app?.score || 0).toBeGreaterThan(dir?.score || 0);
  });

  test('matches subsequences and returns matched ranges', () => {
    const result = fuzzyMatchPath('fts', 'web-src/file-tree-search.ts');
    expect(result).not.toBeNull();
    expect(result!.ranges.length).toBeGreaterThan(0);
  });

  test('returns null when characters are missing', () => {
    expect(fuzzyMatchPath('zzq', 'web-src/app.ts')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test web-src/test/fuzzy-search.test.ts`

Expected: import failure for `../fuzzy-search`.

- [ ] **Step 3: Implement minimal scoring**

Create `fuzzyMatchPath(query, path)` that lowercases inputs, performs subsequence matching, adds contiguous and segment-boundary bonuses, weights basename hits, and returns `{ score, ranges } | null`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test web-src/test/fuzzy-search.test.ts`

Expected: all tests pass.

- [ ] **Step 5: Commit**

Run: `git add web-src/fuzzy-search.ts web-src/test/fuzzy-search.test.ts && git commit -m "feat(search): ファジー検索スコアを追加"`

## Task 2: Route Line Support

**Files:**
- Modify: `web-src/routes.ts`
- Test: `web-src/test/routes.test.ts`

- [ ] **Step 1: Write failing route tests**

Add expectations that blob file routes parse and build `line`.

```ts
expect(buildRoute({ screen: 'file', path: 'README.md', ref: 'main', view: 'blob', line: 12, range }))
  .toBe('/file?path=README.md&target=main&line=12');
expect(parseRoute('/file', '?path=README.md&target=main&line=12', defaultRange))
  .toEqual({ screen: 'file', path: 'README.md', ref: 'main', view: 'blob', line: 12, range: defaultRange });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test web-src/test/routes.test.ts`

Expected: `line` is missing.

- [ ] **Step 3: Implement route support**

Add `line?: number` to file routes. Parse positive integer `line`; omit invalid values. Build `line` only when present.

- [ ] **Step 4: Run test**

Run: `bun test web-src/test/routes.test.ts`

Expected: pass.

- [ ] **Step 5: Commit**

Run: `git add web-src/routes.ts web-src/test/routes.test.ts && git commit -m "feat(search): ファイル行ルートを追加"`

## Task 3: Server Search Helpers

**Files:**
- Create: `web-src/server/search.ts`
- Modify: `web-src/types.ts`
- Test: `web-src/test/search-server.test.ts`

- [ ] **Step 1: Write helper tests**

Test result caps, fixed-string matching, binary skip behavior, and `normalizeGrepMax`.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test web-src/test/search-server.test.ts`

Expected: import failure for `../server/search`.

- [ ] **Step 3: Implement helpers**

Add:

```ts
export const GREP_DEFAULT_MAX = 200;
export const GREP_ABSOLUTE_MAX = 500;
export function normalizeGrepMax(value: string | null): number;
export function fixedStringLineMatches(text: string, query: string, max: number): GrepMatch[];
export function isSkippableSearchPath(path: string): boolean;
```

- [ ] **Step 4: Run test**

Run: `bun test web-src/test/search-server.test.ts`

Expected: pass.

- [ ] **Step 5: Commit**

Run: `git add web-src/server/search.ts web-src/types.ts web-src/test/search-server.test.ts && git commit -m "feat(search): grepヘルパーを追加"`

## Task 4: `/_files` Endpoint

**Files:**
- Modify: `web-src/server/preview.ts`
- Modify: `web-src/server/search.ts`
- Test: `web-src/test/search-server.test.ts`

- [ ] **Step 1: Add tests for file list shaping**

Assert that file-list helpers keep only `blob` and `commit` entries and preserve `generation`.

- [ ] **Step 2: Run test**

Run: `bun test web-src/test/search-server.test.ts`

Expected: failing helper assertion.

- [ ] **Step 3: Implement endpoint**

Add `handleFiles(url)` using existing `safeRepoPath`, `isGitInternalPath`, `git.verifyTreeRef`, and `git.listTree(target, '', cwd, { recursive: true })`. Cache by `ref` and `generation`. Return `FileSearchListResponse`.

- [ ] **Step 4: Run focused tests and typecheck**

Run: `bun test web-src/test/search-server.test.ts && bun run check`

Expected: pass.

- [ ] **Step 5: Commit**

Run: `git add web-src/server/preview.ts web-src/server/search.ts web-src/test/search-server.test.ts && git commit -m "feat(search): ファイル検索APIを追加"`

## Task 5: `/_grep` Endpoint

**Files:**
- Modify: `web-src/server/preview.ts`
- Modify: `web-src/server/search.ts`
- Test: `web-src/test/search-server.test.ts`

- [ ] **Step 1: Add grep API tests**

Test max clamping, empty query response, diff file path validation, and command argument construction for `rg` using `-e query --`.

- [ ] **Step 2: Run test**

Run: `bun test web-src/test/search-server.test.ts`

Expected: failures for missing grep helpers.

- [ ] **Step 3: Implement grep endpoint**

Add read-only `handleGrep(url)` with `requestAllowed`. For worktree, prefer `rg`; fallback to fixed-string file scanning. For refs, use `git grep` after `verifyTreeRef`. Enforce max results, timeout, no symlink following, no `.git`, no binary text forcing, and one active grep controller.

- [ ] **Step 4: Run focused tests and typecheck**

Run: `bun test web-src/test/search-server.test.ts && bun run check`

Expected: pass.

- [ ] **Step 5: Commit**

Run: `git add web-src/server/preview.ts web-src/server/search.ts web-src/test/search-server.test.ts && git commit -m "feat(search): grep検索APIを追加"`

## Task 6: Palette Pure Helpers

**Files:**
- Create: `web-src/search-palette.ts`
- Test: `web-src/test/search-palette.test.ts`

- [ ] **Step 1: Write tests**

Test result limiting to 50, selection movement wrapping/clamping behavior, and scope mode selection for `repo`, `diff`, and `file` routes.

- [ ] **Step 2: Run test**

Run: `bun test web-src/test/search-palette.test.ts`

Expected: import failure.

- [ ] **Step 3: Implement helpers**

Add pure helpers:

```ts
export const PALETTE_RESULT_LIMIT = 50;
export function limitPaletteResults<T>(items: T[]): T[];
export function movePaletteSelection(index: number, count: number, direction: 1 | -1): number;
export function isTextInputTarget(target: EventTarget | null): boolean;
```

- [ ] **Step 4: Run test**

Run: `bun test web-src/test/search-palette.test.ts`

Expected: pass.

- [ ] **Step 5: Commit**

Run: `git add web-src/search-palette.ts web-src/test/search-palette.test.ts && git commit -m "feat(search): パレット操作ヘルパーを追加"`

## Task 7: Palette UI Wiring

**Files:**
- Modify: `web-src/app.ts`
- Modify: `web/style.css`
- Modify: `web/index.html` only if a static mount point is cleaner than dynamic creation.
- Test: existing structural tests may be extended.

- [ ] **Step 1: Add structural tests**

Add tests that `app.ts` contains `openSearchPalette('file')`, `openSearchPalette('grep')`, `/` still calls `focusFileFilter`, and `Ctrl+K` no longer calls `focusFileFilter`.

- [ ] **Step 2: Run tests**

Run: `bun test web-src/test/open-path.test.ts`

Expected: new structural assertions fail.

- [ ] **Step 3: Implement palette DOM**

Add dynamic palette creation in `app.ts`: overlay, dialog, input, status, listbox, ARIA attributes, IME composition guard, `Esc` close, selection movement, and click selection.

- [ ] **Step 4: Implement file mode**

Diff mode uses `STATE.files` snapshot. Repository mode fetches `/_files` and caches by ref. Result selection navigates according to the spec.

- [ ] **Step 5: Implement grep mode**

Debounce 80 ms, use `AbortController`, call `/_grep`, render path/line/preview, and navigate according to the spec.

- [ ] **Step 6: Style the palette**

Add `.gdp-palette-*` styles to `web/style.css`: centered top dialog, large input, compact result rows, active row, muted path/preview text, dark theme compatibility.

- [ ] **Step 7: Run focused tests and build**

Run: `bun test web-src/test/open-path.test.ts && bun run build && bun run check:bundle`

Expected: pass.

- [ ] **Step 8: Commit**

Run: `git add web-src/app.ts web/style.css web/index.html web/app.js web-src/test/open-path.test.ts && git commit -m "feat(search): 検索パレットUIを追加"`

## Task 8: Verification and Claude Review

**Files:**
- No planned source changes unless review finds issues.

- [ ] **Step 1: Run local verification**

Run: `bun run verify`

Expected: pass.

- [ ] **Step 2: Run package dry run**

Run: `npm pack --dry-run`

Expected: package contents are listed successfully.

- [ ] **Step 3: Ask Claude for strict diff review**

Send Claude the goal, changed files, and verification results. Ask for file/line findings only.

- [ ] **Step 4: Verify Claude findings locally**

Open cited files, reproduce claims with tests or browser checks, then adopt or reject each finding.

- [ ] **Step 5: Run final verification**

Run: `bun run verify && npm pack --dry-run`

Expected: pass.

## Self-Review

- Spec coverage: shortcuts, scope rules, file API, grep API, fuzzy scoring, route line support, keyboard behavior, UI, tests, and Claude review all have tasks.
- Placeholder scan: no task contains undefined "later" work; hunk-level grep scrolling is intentionally excluded by the approved design.
- Type consistency: response type names match the design doc and are introduced before use.
