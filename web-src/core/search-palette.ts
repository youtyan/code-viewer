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
