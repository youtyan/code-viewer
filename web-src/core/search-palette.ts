export const PALETTE_RESULT_LIMIT = 50;

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
  return (index + direction + count) % count;
}

export function isTextInputTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || target.isContentEditable;
}
