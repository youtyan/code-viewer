export function nextVisibleFileIndex(currentIndex: number, itemCount: number, direction: 1 | -1): number {
  if (itemCount <= 0) return -1;
  if (currentIndex < 0) return direction > 0 ? 0 : itemCount - 1;
  return Math.max(0, Math.min(itemCount - 1, currentIndex + direction));
}
