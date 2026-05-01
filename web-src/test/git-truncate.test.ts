import { describe, expect, test } from 'bun:test';
import { treeEntries, truncateToNHunks, verifyTreeRef, worktreeEntries } from '../server/git';

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

  test('validates tree refs and lists direct git tree entries', () => {
    expect(verifyTreeRef('HEAD', process.cwd())).toBe(true);
    expect(verifyTreeRef('--upload-pack=bad', process.cwd())).toBe(false);
    const result = treeEntries('HEAD', '', process.cwd());
    expect(result.code).toBe(0);
    expect(result.entries.some(entry => entry.path === 'web-src' && entry.type === 'tree')).toBe(true);
  });
});
