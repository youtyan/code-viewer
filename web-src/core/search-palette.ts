export const PALETTE_RESULT_LIMIT = 50;
export const GREP_SELECTION_HISTORY_LIMIT = 100;
export const MIN_GREP_PALETTE_WIDTH = 720;
export const MAX_GREP_PALETTE_WIDTH = 2_400;
export const MIN_GREP_PALETTE_HEIGHT = 420;
export const MAX_GREP_PALETTE_HEIGHT = 1_400;

export function limitPaletteResults<T>(items: T[]): T[] {
  return items.slice(0, PALETTE_RESULT_LIMIT);
}

export function movePaletteSelection(
  index: number,
  count: number,
  direction: 1 | -1,
): number {
  if (count <= 0) return -1;
  if (index < 0) return direction > 0 ? 0 : count - 1;
  return Math.max(0, Math.min(count - 1, index + direction));
}

export function rememberPaletteSelection(
  history: string[],
  path: string,
): string[] {
  const next = history.filter((entry) => entry !== path);
  next.push(path);
  return next.slice(-GREP_SELECTION_HISTORY_LIMIT);
}

export function rankPaletteResultsByHistory<T extends { path: string }>(
  items: T[],
  history: string[],
): T[] {
  const priority = new Map(history.map((path, index) => [path, index + 1]));
  return items
    .map((item, index) => ({ item, index }))
    .sort(
      (a, b) =>
        (priority.get(b.item.path) ?? 0) - (priority.get(a.item.path) ?? 0) ||
        a.index - b.index,
    )
    .map(({ item }) => item);
}

export const rememberGrepSelection = rememberPaletteSelection;
export const rankGrepResultsByHistory = rankPaletteResultsByHistory;

export function isTextInputTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || target.isContentEditable;
}

// Grep palette query syntax: "path:<file|dir|glob>" tokens narrow the
// search; everything else is the text to look for (joined back with single
// spaces, so "foo  bar" and "foo bar" search the same phrase). A bare
// "path:" with no value is ignored rather than treated as text.
export type ParsedGrepQuery = { term: string; paths: string[] };

export function parseGrepQuery(raw: string): ParsedGrepQuery {
  const paths: string[] = [];
  const words: string[] = [];
  for (const token of raw.trim().split(/\s+/)) {
    if (!token) continue;
    const scoped = /^path:(.*)$/.exec(token);
    if (scoped) {
      if (scoped[1]) paths.push(scoped[1]);
      continue;
    }
    words.push(token);
  }
  return { term: words.join(" "), paths };
}

// Wire parameters of /_grep shared by the palette and the results sheet, so
// both send the same flags for the same toggles. Scope params (omit dirs /
// exclude names) and path restrictions are appended by the caller.
export function buildGrepRequestParams(options: {
  term: string;
  ref: string;
  regex: boolean;
  caseSensitive: boolean;
  wholeWord: boolean;
  hideTests: boolean;
  max: number;
}): URLSearchParams {
  const params = new URLSearchParams();
  params.set("ref", options.ref);
  params.set("q", options.term);
  params.set("max", String(options.max));
  if (options.regex) params.set("regex", "1");
  if (options.caseSensitive) params.set("case", "1");
  if (options.wholeWord) params.set("word", "1");
  if (options.hideTests) params.set("exclude_tests", "1");
  return params;
}
