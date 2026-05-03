import type { FileSearchListResponse, GrepMatch } from '../types';
import type { GitTreeEntry } from './git';

export const GREP_DEFAULT_MAX = 200;
export const GREP_ABSOLUTE_MAX = 500;
export const GREP_MAX_FILE_BYTES = 2 * 1024 * 1024;
export const FILE_SEARCH_ABSOLUTE_MAX = 50000;

export function normalizeGrepMax(value: string | null): number {
  const parsed = Number(value || '');
  if (!Number.isInteger(parsed) || parsed <= 0) return GREP_DEFAULT_MAX;
  return Math.min(parsed, GREP_ABSOLUTE_MAX);
}

export function isSkippableSearchPath(path: string): boolean {
  return path.split(/[\\/]+/).some(part => {
    const lower = part.toLowerCase();
    return lower === '.git' || lower === 'node_modules';
  });
}

export function fixedStringLineMatches(path: string, text: string, query: string, max: number): GrepMatch[] {
  const needle = query.toLowerCase();
  if (!needle) return [];
  const matches: GrepMatch[] = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length && matches.length < max; i++) {
    const line = lines[i];
    const column = line.toLowerCase().indexOf(needle);
    if (column < 0) continue;
    matches.push({
      path,
      line: i + 1,
      column: column + 1,
      preview: line.slice(0, 500),
    });
  }
  return matches;
}

export function buildFileSearchList(ref: string, generation: number, entries: GitTreeEntry[]): FileSearchListResponse {
  const files = entries
    .filter((entry): entry is GitTreeEntry & { type: 'blob' | 'commit' } => entry.type === 'blob' || entry.type === 'commit')
    .slice(0, FILE_SEARCH_ABSOLUTE_MAX)
    .map(entry => ({ path: entry.path, type: entry.type }));
  return {
    ref,
    generation,
    files,
    truncated: entries.length > FILE_SEARCH_ABSOLUTE_MAX,
  };
}

export function buildRgArgs(query: string, max: number, paths: string[]): string[] {
  return [
    'rg',
    '--line-number',
    '--column',
    '--no-heading',
    '--color',
    'never',
    '--smart-case',
    '--max-count',
    String(max),
    '--max-filesize',
    '2M',
    '-e',
    query,
    '--',
    ...paths,
  ];
}

export function parseRgOutput(stdout: string, max: number): GrepMatch[] {
  const matches: GrepMatch[] = [];
  for (const line of stdout.split('\n')) {
    if (!line || matches.length >= max) continue;
    const parts = line.split(':');
    if (parts.length < 4) continue;
    const path = parts.shift() || '';
    const lineNo = Number(parts.shift() || '0');
    const column = Number(parts.shift() || '0');
    const preview = parts.join(':');
    if (!path || !lineNo || !column || isSkippableSearchPath(path)) continue;
    matches.push({ path, line: lineNo, column, preview: preview.slice(0, 500) });
  }
  return matches;
}

export function parseGitGrepOutput(stdout: string, ref: string, max: number): GrepMatch[] {
  const prefix = ref + ':';
  const normalized = stdout
    .split('\n')
    .map(line => line.startsWith(prefix) ? line.slice(prefix.length) : line)
    .join('\n');
  return parseRgOutput(normalized, max);
}
