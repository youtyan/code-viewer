import { describe, expect, test } from 'bun:test';
import { truncateToNHunks } from '../server/git';

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
