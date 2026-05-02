import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
