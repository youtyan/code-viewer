import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dir, '..', '..');

describe('node cli package metadata', () => {
  test('publishes Node executable bins for npx', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      bin: Record<string, string>;
      files: string[];
      engines?: Record<string, string>;
    };

    expect(pkg.bin['code-viewer']).toBe('dist/code-viewer.js');
    expect(pkg.bin['git-diff-preview']).toBe('dist/code-viewer.js');
    expect(pkg.files.includes('dist')).toBe(true);
    expect(typeof pkg.engines?.node).toBe('string');
  });

  test('production server entrypoints do not use Bun runtime globals directly', () => {
    const checkedFiles = productionServerFiles(join(root, 'web-src', 'server'));
    const offenders = checkedFiles.filter(path => readFileSync(path, 'utf8').includes('Bun.'));

    expect(offenders).toEqual([]);
  });
});

function productionServerFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) continue;
    if (!entry.endsWith('.ts')) continue;
    if (entry === 'dev.ts') continue;
    files.push(path);
  }
  return files;
}
