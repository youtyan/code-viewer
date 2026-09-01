export const WORD_CHAR_RE = /[\p{L}\p{N}_]/u;

export function isWordBoundary(
  line: string,
  start: number,
  end: number,
): boolean {
  const before = start > 0 ? line[start - 1] : "";
  const after = end < line.length ? line[end] : "";
  return !WORD_CHAR_RE.test(before) && !WORD_CHAR_RE.test(after);
}

export function expandWordAt(
  text: string,
  offset: number,
): { word: string; start: number; end: number } | null {
  if (!Number.isInteger(offset) || offset < 0 || offset > text.length) {
    return null;
  }

  let cursor = offset;
  if (!WORD_CHAR_RE.test(text[cursor] ?? "")) {
    cursor--;
    if (cursor < 0 || !WORD_CHAR_RE.test(text[cursor] ?? "")) return null;
  }

  let start = cursor;
  while (start > 0 && WORD_CHAR_RE.test(text[start - 1])) start--;
  let end = cursor + 1;
  while (end < text.length && WORD_CHAR_RE.test(text[end])) end++;
  return { word: text.slice(start, end), start, end };
}
