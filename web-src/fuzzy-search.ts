export type FuzzyRange = {
  start: number;
  end: number;
};

export type FuzzyMatch = {
  score: number;
  ranges: FuzzyRange[];
};

export type RankedFuzzyPath<T extends { path: string }> = {
  item: T;
  score: number;
  ranges: FuzzyRange[];
};

export type RankedPathMatch<T extends { path: string }> = RankedFuzzyPath<T> & {
  mode: 'fuzzy' | 'glob';
};

function basenameStart(path: string): number {
  const slash = path.lastIndexOf('/');
  return slash < 0 ? 0 : slash + 1;
}

function isBoundary(path: string, index: number): boolean {
  if (index <= 0) return true;
  const prev = path[index - 1];
  return prev === '/' || prev === '-' || prev === '_' || prev === '.' || prev === ' ';
}

function toRanges(indices: number[]): FuzzyRange[] {
  const ranges: FuzzyRange[] = [];
  for (const index of indices) {
    const last = ranges[ranges.length - 1];
    if (last && last.end === index) {
      last.end = index + 1;
    } else {
      ranges.push({ start: index, end: index + 1 });
    }
  }
  return ranges;
}

export function fuzzyMatchPath(query: string, path: string): FuzzyMatch | null {
  const q = query.trim().toLowerCase();
  if (!q) return { score: 0, ranges: [] };
  const lowerPath = path.toLowerCase();
  const baseStart = basenameStart(path);
  const indices: number[] = [];
  let from = 0;
  let score = 0;

  for (const ch of q) {
    const index = lowerPath.indexOf(ch, from);
    if (index < 0) return null;
    indices.push(index);
    score += 10;
    if (index >= baseStart) score += 8;
    if (isBoundary(path, index)) score += 6;
    const prev = indices[indices.length - 2];
    if (prev != null && prev + 1 === index) score += 12;
    from = index + 1;
  }

  const first = indices[0] || 0;
  score -= Math.min(first, 40);
  if (indices[0] >= baseStart) score += 20;
  const basename = lowerPath.slice(baseStart);
  if (basename.startsWith(q)) score += 30;
  if (basename === q || basename.startsWith(q + '.')) score += 25;
  if (lowerPath.endsWith(q)) score += 15;

  return { score, ranges: toRanges(indices) };
}

export function rankFuzzyPaths<T extends { path: string }>(query: string, items: T[]): RankedFuzzyPath<T>[] {
  return items
    .map(item => {
      const match = fuzzyMatchPath(query, item.path);
      return match ? { item, score: match.score, ranges: match.ranges } : null;
    })
    .filter((item): item is RankedFuzzyPath<T> => item !== null)
    .sort((a, b) => b.score - a.score || a.item.path.localeCompare(b.item.path));
}

export function isGlobPathQuery(query: string): boolean {
  return /[*?]/.test(query.trim());
}

function escapeRegexChar(ch: string): string {
  return /[\\^$+?.()|{}]/.test(ch) ? '\\' + ch : ch;
}

export function globToRegExp(query: string): RegExp | null {
  const pattern = query.trim();
  if (!pattern) return null;
  let source = '^';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '*') {
      if (pattern[i + 1] === '*') {
        source += '.*';
        i++;
      } else {
        source += '[^/]*';
      }
    } else if (ch === '?') {
      source += '[^/]';
    } else if (ch === '[') {
      const close = pattern.indexOf(']', i + 1);
      if (close < 0) {
        source += '\\[';
      } else {
        const body = pattern.slice(i + 1, close).replace(/\\/g, '\\\\');
        source += '[' + body + ']';
        i = close;
      }
    } else {
      source += escapeRegexChar(ch);
    }
  }
  source += '$';
  try {
    return new RegExp(source, 'i');
  } catch {
    return null;
  }
}

export function globMatchPath(query: string, path: string): FuzzyMatch | null {
  const regex = globToRegExp(query);
  const baseStart = basenameStart(path);
  const basename = path.slice(baseStart);
  if (!regex || (!regex.test(path) && (query.includes('/') || !regex.test(basename)))) return null;
  const literal = query.replace(/[*?[\]]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  const ranges: FuzzyRange[] = [];
  const lowerPath = path.toLowerCase();
  for (const part of literal) {
    const start = lowerPath.indexOf(part.toLowerCase());
    if (start >= 0) ranges.push({ start, end: start + part.length });
  }
  ranges.sort((a, b) => a.start - b.start || a.end - b.end);
  const mergedRanges: FuzzyRange[] = [];
  for (const range of ranges) {
    const last = mergedRanges[mergedRanges.length - 1];
    if (last && last.end >= range.start) {
      last.end = Math.max(last.end, range.end);
    } else {
      mergedRanges.push({ ...range });
    }
  }
  const score = 1000
    - Math.min(path.length, 200)
    + (path.slice(baseStart).toLowerCase().endsWith(query.replace(/^\*+/, '').toLowerCase()) ? 50 : 0);
  return { score, ranges: mergedRanges };
}

export function rankPathMatches<T extends { path: string }>(query: string, items: T[]): RankedPathMatch<T>[] {
  if (isGlobPathQuery(query)) {
    return items
      .map((item): RankedPathMatch<T> | null => {
        const match = globMatchPath(query, item.path);
        return match ? { item, score: match.score, ranges: match.ranges, mode: 'glob' as const } : null;
      })
      .filter((item): item is RankedPathMatch<T> => item !== null)
      .sort((a, b) => b.score - a.score || a.item.path.localeCompare(b.item.path));
  }
  return rankFuzzyPaths(query, items).map(item => ({ ...item, mode: 'fuzzy' as const }));
}
