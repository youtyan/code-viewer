import { describe, expect, test } from 'bun:test';
import {
  GREP_ABSOLUTE_MAX,
  GREP_DEFAULT_MAX,
  buildFileSearchList,
  buildRgArgs,
  fixedStringLineMatches,
  isSkippableSearchPath,
  normalizeGrepMax,
} from '../server/search';
import { readFileSync } from 'node:fs';

describe('normalizeGrepMax', () => {
  test('defaults and clamps grep result limits', () => {
    expect(normalizeGrepMax(null)).toBe(GREP_DEFAULT_MAX);
    expect(normalizeGrepMax('0')).toBe(GREP_DEFAULT_MAX);
    expect(normalizeGrepMax('20')).toBe(20);
    expect(normalizeGrepMax('9999')).toBe(GREP_ABSOLUTE_MAX);
  });
});

describe('fixedStringLineMatches', () => {
  test('matches text case-insensitively with line and column', () => {
    const matches = fixedStringLineMatches('src/app.ts', 'Alpha\nbeta alpha\n', 'ALPHA', 10);
    expect(matches).toEqual([
      { path: 'src/app.ts', line: 1, column: 1, preview: 'Alpha' },
      { path: 'src/app.ts', line: 2, column: 6, preview: 'beta alpha' },
    ]);
  });

  test('respects max results', () => {
    const matches = fixedStringLineMatches('a.txt', 'x\nx\nx\n', 'x', 2);
    expect(matches.length).toBe(2);
  });
});

describe('search path filtering', () => {
  test('skips paths that should not be searched by fallback grep', () => {
    expect(isSkippableSearchPath('.git/config')).toBe(true);
    expect(isSkippableSearchPath('node_modules/pkg/index.js')).toBe(true);
    expect(isSkippableSearchPath('src/app.ts')).toBe(false);
  });
});

describe('buildFileSearchList', () => {
  test('keeps only searchable file entries', () => {
    const response = buildFileSearchList('worktree', 7, [
      { name: 'src', path: 'src', type: 'tree' },
      { name: 'app.ts', path: 'src/app.ts', type: 'blob' },
      { name: 'submodule', path: 'vendor/submodule', type: 'commit' },
    ]);

    expect(response).toEqual({
      ref: 'worktree',
      generation: 7,
      truncated: false,
      files: [
        { path: 'src/app.ts', type: 'blob' },
        { path: 'vendor/submodule', type: 'commit' },
      ],
    });
  });
});

describe('buildRgArgs', () => {
  test('passes query via -e before path arguments', () => {
    expect(buildRgArgs('needle', 20, ['src/app.ts'])).toEqual([
      'rg',
      '--line-number',
      '--column',
      '--no-heading',
      '--color',
      'never',
      '--smart-case',
      '--max-count',
      '20',
      '--max-filesize',
      '2M',
      '-e',
      'needle',
      '--',
      'src/app.ts',
    ]);
  });
});

describe('preview search endpoints', () => {
  const server = readFileSync('web-src/server/preview.ts', 'utf8');

  test('routes read-only file and grep search endpoints', () => {
    expect(server.includes("if (url.pathname === '/_files') return handleFiles(url)")).toBe(true);
    expect(server.includes("if (url.pathname === '/_grep') return handleGrep(url)")).toBe(true);
  });

  test('grep endpoint uses safe caps and argument-array ripgrep', () => {
    expect(server.includes('normalizeGrepMax(url.searchParams.get')).toBe(true);
    expect(server.includes('buildRgArgs(query, max')).toBe(true);
    expect(server.includes('Bun.spawnSync(args')).toBe(true);
    expect(server.includes('safeWorktreePath(path)')).toBe(true);
  });
});
