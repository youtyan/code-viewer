// Wrap a character range of a rendered line in <mark>, even when the cell
// already holds syntax-highlight markup (the range may span several text
// nodes). Shared by the search palette's code preview and the source view's
// "hl=" target marking so both read the same way.

export function findTextRange(
  lineText: string,
  needle: string,
  options: { caseSensitive?: boolean; nearColumn?: number } = {},
): { start: number; end: number } | null {
  if (!needle) return null;
  const haystack = options.caseSensitive ? lineText : lineText.toLowerCase();
  const target = options.caseSensitive ? needle : needle.toLowerCase();
  const expectedStart = Math.max(0, (options.nearColumn ?? 1) - 1);
  let bestStart = -1;
  let cursor = haystack.indexOf(target);
  while (cursor >= 0) {
    if (
      bestStart < 0 ||
      Math.abs(cursor - expectedStart) < Math.abs(bestStart - expectedStart)
    )
      bestStart = cursor;
    cursor = haystack.indexOf(target, cursor + Math.max(1, target.length));
  }
  return bestStart < 0
    ? null
    : { start: bestStart, end: bestStart + needle.length };
}

export function markTextRange(
  cell: HTMLElement,
  start: number,
  end: number,
  className: string,
): void {
  if (end <= start) return;
  const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
  const parts: Array<{ node: Text; start: number; end: number }> = [];
  let offset = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const textNode = node as Text;
    const nextOffset = offset + textNode.data.length;
    const partStart = Math.max(start, offset);
    const partEnd = Math.min(end, nextOffset);
    if (partStart < partEnd)
      parts.push({
        node: textNode,
        start: partStart - offset,
        end: partEnd - offset,
      });
    offset = nextOffset;
  }
  for (const part of parts.reverse()) {
    const selected = part.node.splitText(part.start);
    selected.splitText(part.end - part.start);
    const mark = document.createElement("mark");
    mark.className = className;
    const parent = selected.parentNode;
    if (!parent) throw new Error("marked text is detached");
    parent.insertBefore(mark, selected);
    mark.appendChild(selected);
  }
}

// Convenience: mark the occurrence of `needle` in `lineText` closest to
// `nearColumn` (1-based) inside `cell`. No-op when absent.
export function markNeedleInCell(
  cell: HTMLElement,
  lineText: string,
  needle: string,
  className: string,
  options: { caseSensitive?: boolean; nearColumn?: number } = {},
): boolean {
  const range = findTextRange(lineText, needle, options);
  if (!range) return false;
  markTextRange(cell, range.start, range.end, className);
  return true;
}
