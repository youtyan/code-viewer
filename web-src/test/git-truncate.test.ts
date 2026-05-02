import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import { listTree, treeEntries, truncateToNHunks, verifyTreeRef, worktreeEntries } from '../server/git';

function git(cwd: string, args: string[]) {
  const proc = Bun.spawnSync(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' });
  expect(proc.exitCode).toBe(0);
}

describe('truncateToNHunks', () => {
  test('preserves newlines between rendered hunks', () => {
    const diff = [
      'diff --git a/file.ts b/file.ts',
      '--- a/file.ts',
      '+++ b/file.ts',
      '@@ -1,2 +1,2 @@',
      ' line one',
      '-old one',
      '+new one',
      '@@ -10,2 +10,2 @@',
      ' line ten',
      '-old ten',
      '+new ten',
      '',
    ].join('\n');

    const result = truncateToNHunks(diff, 2).text;

    expect(result.includes('+new one\n@@ -10,2 +10,2 @@')).toBe(true);
    expect(result.includes('+new one@@ -10,2 +10,2 @@')).toBe(false);
  });

  test('caps preview output by line count even when a single hunk is huge', () => {
    const diff = [
      'diff --git a/generated.js b/generated.js',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/generated.js',
      '@@ -0,0 +1,5000 @@',
      ...Array.from({ length: 5000 }, (_, index) => '+line ' + index),
      '',
    ].join('\n');

    const result = truncateToNHunks(diff, 3, 100);

    expect(result.lineTruncated).toBe(true);
    expect(result.renderedHunks).toBe(1);
    expect(result.lineCount <= 100).toBe(true);
    expect(result.text.includes('+line 4999')).toBe(false);
  });

  test('counts inserted separators when capping multi-hunk preview lines', () => {
    const hunk = (offset: number) => [
      '@@ -' + offset + ',4 +' + offset + ',4 @@',
      ' context ' + offset,
      '-old ' + offset,
      '+new ' + offset,
      ' tail ' + offset,
    ].join('\n');
    const diff = [
      'diff --git a/file.ts b/file.ts',
      '--- a/file.ts',
      '+++ b/file.ts',
      hunk(1),
      hunk(20),
      hunk(40),
      '',
    ].join('\n');

    const result = truncateToNHunks(diff, 3, 14);

    expect(result.lineTruncated).toBe(true);
    expect(result.lineCount <= 14).toBe(true);
    expect(result.text.includes('@@ -40,4 +40,4 @@')).toBe(false);
  });

  test('server preview keeps medium and large files eligible for split layout', () => {
    const server = readFileSync('web-src/server/preview.ts', 'utf8');

    expect(server.includes("const previewUrl = sizeClass !== 'small'")).toBe(true);
    expect(server.includes("force_layout: sizeClass === 'huge' ? 'line-by-line' : undefined")).toBe(true);
    expect(server.includes("force_layout: sizeClass === 'large' || sizeClass === 'huge'")).toBe(false);
    expect(server.includes("force_layout: sizeClass !== 'small'")).toBe(false);
  });
});

describe('repository tree helpers', () => {
  test('lists only direct worktree children', () => {
    const entries = worktreeEntries(process.cwd(), '');
    expect(entries.some(entry => entry.path === 'web-src' && entry.type === 'tree')).toBe(true);
    expect(entries.some(entry => entry.path === 'web-src/app.ts')).toBe(false);
  });

  test('lists ignored filesystem directories in worktree view', () => {
    const dir = mkdtempSync(join(tmpdir(), 'code-viewer-tree-'));
    try {
      writeFileSync(join(dir, '.gitignore'), 'ignored-dir/\n');
      mkdirSync(join(dir, 'ignored-dir'));
      writeFileSync(join(dir, 'ignored-dir', 'cache.txt'), 'cache');

      const entries = worktreeEntries(dir, '');

      expect(entries.some(entry =>
        entry.name === 'ignored-dir' && entry.path === 'ignored-dir' && entry.type === 'tree',
      )).toBe(true);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('includes ignored filesystem directories in recursive worktree tree data', () => {
    const dir = mkdtempSync(join(tmpdir(), 'code-viewer-recursive-tree-'));
    try {
      git(dir, ['init']);
      writeFileSync(join(dir, '.gitignore'), 'ignored-dir/\n');
      mkdirSync(join(dir, 'ignored-dir'));
      writeFileSync(join(dir, 'ignored-dir', 'cache.txt'), 'cache');
      writeFileSync(join(dir, 'ignored-root.log'), 'log');

      const result = listTree('worktree', '', dir, { recursive: true });

      expect(result.entries.some(entry =>
        entry.name === 'ignored-dir' && entry.path === 'ignored-dir' && entry.type === 'tree',
      )).toBe(true);
      expect(result.entries.find(entry => entry.path === 'ignored-dir')?.children_omitted).toBe(true);
      expect(result.entries.some(entry =>
        entry.name === 'ignored-root.log' && entry.path === 'ignored-root.log' && entry.type === 'blob',
      )).toBe(true);

      const direct = listTree('worktree', '', dir);
      expect(direct.entries.find(entry => entry.path === 'ignored-dir')?.children_omitted).toBe(true);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('does not mark empty worktree directories as omitted', () => {
    const dir = mkdtempSync(join(tmpdir(), 'code-viewer-empty-tree-'));
    try {
      mkdirSync(join(dir, 'empty-dir'));

      const result = listTree('worktree', '', dir, { recursive: true });

      expect(result.entries.find(entry => entry.path === 'empty-dir')?.children_omitted).toBe(undefined);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('does not mark metadata-only untracked directories as omitted', () => {
    const dir = mkdtempSync(join(tmpdir(), 'code-viewer-metadata-tree-'));
    try {
      git(dir, ['init']);
      mkdirSync(join(dir, 'metadata-dir'));
      writeFileSync(join(dir, 'metadata-dir', '.DS_Store'), 'metadata');

      const result = listTree('worktree', '', dir, { recursive: true });

      expect(result.entries.find(entry => entry.path === 'metadata-dir')?.children_omitted).toBe(undefined);
      expect(result.entries.some(entry => entry.path === 'metadata-dir/.DS_Store')).toBe(true);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('does not mark listed worktree child directories as omitted', () => {
    const dir = mkdtempSync(join(tmpdir(), 'code-viewer-listed-tree-'));
    try {
      git(dir, ['init']);
      mkdirSync(join(dir, 'tracked-dir'));
      writeFileSync(join(dir, 'tracked-dir', 'file.txt'), 'content');
      git(dir, ['add', 'tracked-dir/file.txt']);

      const result = listTree('worktree', '', dir, { recursive: true });

      expect(result.entries.find(entry => entry.path === 'tracked-dir')?.children_omitted).toBe(undefined);
      expect(result.entries.some(entry => entry.path === 'tracked-dir/file.txt')).toBe(true);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('does not mark gitlink-like worktree directories as omitted', () => {
    const dir = mkdtempSync(join(tmpdir(), 'code-viewer-gitlink-tree-'));
    try {
      mkdirSync(join(dir, 'submodule-ish'));
      writeFileSync(join(dir, 'submodule-ish', '.git'), 'gitdir: ../.git/modules/submodule-ish\n');

      const result = listTree('worktree', '', dir, { recursive: true });
      const entry = result.entries.find(entry => entry.path === 'submodule-ish');

      expect(entry?.type).toBe('commit');
      expect(entry?.children_omitted).toBe(undefined);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test('validates tree refs and lists direct git tree entries', () => {
    expect(verifyTreeRef('HEAD', process.cwd())).toBe(true);
    expect(verifyTreeRef('--upload-pack=bad', process.cwd())).toBe(false);
    const result = treeEntries('HEAD', '', process.cwd());
    expect(result.code).toBe(0);
    expect(result.entries.some(entry => entry.path === 'web-src' && entry.type === 'tree')).toBe(true);
  });

  test('uses the same direct-child ordering for recursive git tree data', () => {
    const direct = treeEntries('HEAD', '', process.cwd()).entries;
    const recursive = listTree('HEAD', '', process.cwd(), { recursive: true }).entries;
    const firstBlob = recursive.findIndex(entry => entry.type === 'blob');
    let lastTree = -1;
    recursive.forEach((entry, index) => {
      if (entry.type === 'tree') lastTree = index;
    });

    expect(recursive.slice(0, direct.length).map(entry => entry.path))
      .toEqual(direct.map(entry => entry.path));
    expect(firstBlob > 0).toBe(true);
    expect(lastTree < firstBlob).toBe(true);
    expect(recursive.some(entry => entry.path === '.gitignore' && entry.type === 'blob')).toBe(true);
    expect(recursive.some(entry => entry.children_omitted)).toBe(false);
  });
});
