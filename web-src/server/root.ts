import { existsSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

function findRoot(start: string): string {
  let current = start;
  for (let i = 0; i < 5; i++) {
    if (existsSync(join(current, 'package.json')) && existsSync(join(current, 'web'))) {
      return normalize(current);
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return normalize(join(start, '..', '..'));
}

export const ROOT = findRoot(dirname(fileURLToPath(import.meta.url)));
