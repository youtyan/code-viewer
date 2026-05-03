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
