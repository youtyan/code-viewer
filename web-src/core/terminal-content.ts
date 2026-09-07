import type { XtermBuffer } from "./xterm-loader";

export type TerminalLinkTarget = {
  kind: "path" | "url";
  value: string;
  line?: number;
};

export type TerminalTextLink = TerminalLinkTarget & {
  start: number;
  end: number;
};

/** Only explicit paths are links: ordinary prose and shell switches stay selectable. */
export function findTerminalLinks(text: string): TerminalTextLink[] {
  const candidates =
    /https?:\/\/[^\s<>"`]+|file:\/\/[^\s<>"`]+|(["'`])(?:\/|~\/|[A-Za-z]:[\\/])[^\r\n]*?\1(?::\d+(?::\d+)?)?|(?<![\w/:])(?:\/(?!\/)|~\/|[A-Za-z]:[\\/])[^\s<>"'`]+/gu;
  const links: TerminalTextLink[] = [];
  for (const match of text.matchAll(candidates)) {
    const raw = match[0];
    const quote = match[1];
    let value = raw;
    let start = match.index;
    let end = start + raw.length;
    if (quote) {
      const close = raw.lastIndexOf(quote);
      value = raw.slice(1, close) + raw.slice(close + 1);
      start += 1;
      if (close === raw.length - 1) end -= 1;
    } else {
      value = value.replace(/[.,;!?:]+$/, "");
      for (const [open, close] of [
        ["(", ")"],
        ["[", "]"],
        ["{", "}"],
      ]) {
        while (
          value.endsWith(close) &&
          value.split(close).length > value.split(open).length
        ) {
          value = value.slice(0, -1);
        }
      }
      end = start + value.length;
    }
    if (/^https?:\/\//i.test(value)) {
      links.push({ kind: "url", value, start, end });
      continue;
    }
    const location = /(?::(\d+)(?::\d+)?|#L(\d+)|\((\d+),\s*\d+\))$/.exec(
      value,
    );
    const line = location
      ? Number(location[1] ?? location[2] ?? location[3])
      : undefined;
    if (location) value = value.slice(0, location.index);
    if (!value || value === "/") continue;
    links.push({
      kind: "path",
      value,
      start,
      end,
      ...(line !== undefined && Number.isSafeInteger(line) && line > 0
        ? { line }
        : {}),
    });
  }
  return links;
}

/** UTF-16 text offsets are not terminal columns (CJK, emoji and combining marks). */
export function readTerminalLogicalLine(
  buffer: XtermBuffer,
  row: number,
  cols: number,
) {
  let first = row;
  while (first > 0 && buffer.getLine(first)?.isWrapped) first -= 1;
  let last = row;
  while (last + 1 < buffer.length && buffer.getLine(last + 1)?.isWrapped)
    last += 1;
  let text = "";
  const starts: number[] = [];
  const ends: number[] = [];
  for (let y = first; y <= last; y += 1) {
    const line = buffer.getLine(y);
    if (!line) break;
    const rowText = line.translateToString(y === last);
    let rowOffset = 0;
    for (let x = 0; x < cols && rowOffset < rowText.length; x += 1) {
      const cell = line.getCell(x);
      if (!cell || cell.getWidth() === 0) continue;
      const chars = cell.getChars() || " ";
      text += chars;
      for (let i = 0; i < chars.length; i += 1) {
        starts.push(y * cols + x);
        ends.push(y * cols + x + cell.getWidth());
      }
      rowOffset += chars.length;
    }
  }
  return { text, starts, ends, last };
}

export function searchTerminalBuffer(
  buffer: XtermBuffer,
  cols: number,
  query: string,
) {
  const matches: Array<{ row: number; col: number; length: number }> = [];
  if (!query) return matches;
  // Escaping keeps search literal; the regex reports offsets in the original text.
  const pattern = new RegExp(
    query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    "giu",
  );
  for (let row = 0; row < buffer.length; row += 1) {
    const line = readTerminalLogicalLine(buffer, row, cols);
    for (const match of line.text.matchAll(pattern)) {
      const start = line.starts[match.index];
      const end = line.ends[match.index + match[0].length - 1];
      matches.push({
        row: Math.floor(start / cols),
        col: start % cols,
        length: end - start,
      });
    }
    row = line.last;
  }
  return matches;
}
