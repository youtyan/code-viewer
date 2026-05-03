import { describe, expect, test } from 'bun:test';
import { fuzzyMatchPath, rankFuzzyPaths } from '../fuzzy-search';

describe('fuzzyMatchPath', () => {
  test('prefers basename matches over directory-only matches', () => {
    const basename = fuzzyMatchPath('app', 'web-src/app.ts');
    const directory = fuzzyMatchPath('app', 'app/server/index.ts');

    expect(basename === null).toBe(false);
    expect(directory === null).toBe(false);
    expect(basename!.score > directory!.score).toBe(true);
  });

  test('matches subsequences and returns matched ranges', () => {
    const result = fuzzyMatchPath('fts', 'web-src/file-tree-search.ts');

    expect(result === null).toBe(false);
    expect(result!.ranges.length > 0).toBe(true);
  });

  test('returns null when query characters are missing', () => {
    expect(fuzzyMatchPath('zzq', 'web-src/app.ts')).toBeNull();
  });
});

describe('rankFuzzyPaths', () => {
  test('returns matches sorted by score with ranges attached', () => {
    const ranked = rankFuzzyPaths('app', [
      { path: 'src/application.ts' },
      { path: 'web-src/app.ts' },
      { path: 'README.md' },
    ]);

    expect(ranked.map(item => item.item.path)).toEqual(['web-src/app.ts', 'src/application.ts']);
    expect(ranked[0].ranges.length > 0).toBe(true);
  });
});
