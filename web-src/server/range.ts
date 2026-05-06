export type DiffRange = {
  from?: string;
  to?: string;
};

export type ByteRange = {
  start: number;
  end: number;
};

export type ByteRangeParseResult =
  | { kind: "range"; range: ByteRange }
  | { kind: "invalid" }
  | { kind: "unsatisfiable" };

export type LineRangeResult = {
  lines: string[];
  total: number;
  complete: boolean;
};

export type LineOffsetIndex = {
  size: number;
  total: number;
  newlines: Uint32Array | Float64Array;
};

export type IndexedLineByteRange = {
  start: number;
  endExclusive: number;
};

export type BytesWithLineOffsetIndex = {
  bytes: Uint8Array;
  index: LineOffsetIndex;
};

export function isSameWorktreeRange(range: DiffRange): boolean {
  return range.from === "worktree" && range.to === "worktree";
}

export function parseHttpByteRange(
  header: string | null,
  size: number,
): ByteRangeParseResult {
  if (!header) return { kind: "invalid" };
  if (size < 1) return { kind: "unsatisfiable" };
  const match = header.match(/^bytes=(\d*)-(\d*)$/);
  if (!match) return { kind: "invalid" };
  const [, rawStart, rawEnd] = match;
  if (!rawStart && !rawEnd) return { kind: "invalid" };
  let start: number;
  let end: number;
  if (!rawStart) {
    const suffixLength = Number(rawEnd);
    if (!Number.isSafeInteger(suffixLength) || suffixLength < 1)
      return { kind: "unsatisfiable" };
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd ? Number(rawEnd) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end))
      return { kind: "invalid" };
    if (end >= size) end = size - 1;
  }
  if (start < 0 || end < start || start >= size)
    return { kind: "unsatisfiable" };
  return { kind: "range", range: { start, end } };
}

export async function collectLineRangeFromStream(
  stream: ReadableStream<Uint8Array>,
  start: number,
  end: number,
): Promise<LineRangeResult> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const lines: string[] = [];
  let lineNo = 1;
  let pending = "";
  let hasMore = false;

  const pushLine = (line: string) => {
    if (line.endsWith("\r")) line = line.slice(0, -1);
    if (lineNo >= start && lineNo <= end) lines.push(line);
    else if (lineNo > end) hasMore = true;
    lineNo++;
  };

  while (!hasMore) {
    const chunk = await reader.read();
    if (chunk.done) break;
    pending += decoder.decode(chunk.value, { stream: true });
    let newline = pending.indexOf("\n");
    while (newline !== -1) {
      pushLine(pending.slice(0, newline));
      pending = pending.slice(newline + 1);
      if (hasMore) break;
      newline = pending.indexOf("\n");
    }
  }
  if (hasMore) {
    try {
      await reader.cancel();
    } catch {
      /* best effort */
    }
    return { lines, total: lineNo - 1, complete: false };
  }
  pending += decoder.decode();
  if (pending.length > 0) pushLine(pending);
  if (hasMore) return { lines, total: lineNo - 1, complete: false };
  return { lines, total: Math.max(0, lineNo - 1), complete: true };
}

export function buildLineOffsetIndex(bytes: Uint8Array): LineOffsetIndex {
  const builder = createLineOffsetIndexBuilder(bytes.length);
  for (let index = 0; index < bytes.length; index++) {
    if (bytes[index] === 10) builder.push(index);
  }
  const lastByte = bytes.length > 0 ? bytes[bytes.length - 1] : -1;
  return builder.finish(bytes.length, bytes.length > 0 && lastByte !== 10);
}

export async function buildLineOffsetIndexFromStream(
  stream: ReadableStream<Uint8Array>,
  size: number,
): Promise<LineOffsetIndex> {
  const reader = stream.getReader();
  const builder = createLineOffsetIndexBuilder(size);
  let offset = 0;
  let lastByte = -1;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    const bytes = chunk.value;
    for (let index = 0; index < bytes.length; index++) {
      const byte = bytes[index];
      if (byte === 10) builder.push(offset + index);
      lastByte = byte;
    }
    offset += bytes.length;
  }
  return builder.finish(offset, offset > 0 && lastByte !== 10);
}

export async function collectByteRangeFromStream(
  stream: ReadableStream<Uint8Array>,
  start: number,
  endExclusive: number,
): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let offset = 0;
  let total = 0;
  while (offset < endExclusive) {
    const chunk = await reader.read();
    if (chunk.done) break;
    const chunkStart = offset;
    const chunkEnd = offset + chunk.value.byteLength;
    if (chunkEnd > start && chunkStart < endExclusive) {
      const sliceStart = Math.max(0, start - chunkStart);
      const sliceEnd = Math.min(
        chunk.value.byteLength,
        endExclusive - chunkStart,
      );
      const slice = chunk.value.subarray(sliceStart, sliceEnd);
      chunks.push(slice);
      total += slice.byteLength;
    }
    offset = chunkEnd;
  }
  try {
    await reader.cancel();
  } catch {
    /* best effort */
  }
  if (chunks.length === 1) return chunks[0];
  const bytes = new Uint8Array(total);
  let writeOffset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, writeOffset);
    writeOffset += chunk.byteLength;
  }
  return bytes;
}

export async function collectBytesWithLineOffsetIndexFromStream(
  stream: ReadableStream<Uint8Array>,
  sizeHint: number,
): Promise<BytesWithLineOffsetIndex> {
  const reader = stream.getReader();
  const builder = createLineOffsetIndexBuilder(sizeHint);
  const chunks: Uint8Array[] = [];
  let offset = 0;
  let lastByte = -1;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    const bytes = chunk.value;
    chunks.push(bytes);
    for (let index = 0; index < bytes.length; index++) {
      const byte = bytes[index];
      if (byte === 10) builder.push(offset + index);
      lastByte = byte;
    }
    offset += bytes.length;
  }
  const collected = new Uint8Array(offset);
  let writeOffset = 0;
  for (const chunk of chunks) {
    collected.set(chunk, writeOffset);
    writeOffset += chunk.byteLength;
  }
  return {
    bytes: collected,
    index: builder.finish(offset, offset > 0 && lastByte !== 10),
  };
}

function createLineOffsetIndexBuilder(size: number) {
  const useFloat64 = size > 0xffffffff;
  let capacity = 1024;
  let length = 0;
  let offsets: Uint32Array | Float64Array = useFloat64
    ? new Float64Array(capacity)
    : new Uint32Array(capacity);
  const grow = () => {
    capacity *= 2;
    const next = useFloat64
      ? new Float64Array(capacity)
      : new Uint32Array(capacity);
    next.set(offsets);
    offsets = next;
  };
  return {
    push(offset: number) {
      if (length >= capacity) grow();
      offsets[length++] = offset;
    },
    finish(totalSize: number, hasTrailingLine: boolean): LineOffsetIndex {
      return {
        size: totalSize,
        total: length + (hasTrailingLine ? 1 : 0),
        newlines: offsets.slice(0, length) as Uint32Array | Float64Array,
      };
    },
  };
}

export function lineByteRangeForIndex(
  index: LineOffsetIndex,
  start: number,
  end: number,
): IndexedLineByteRange | null {
  const normalizedStart = Math.max(1, Math.floor(start));
  const normalizedEnd = Math.max(normalizedStart, Math.floor(end));
  if (normalizedStart > index.total) return null;
  const lastLine = Math.min(normalizedEnd, index.total);
  const byteStart =
    normalizedStart <= 1 ? 0 : index.newlines[normalizedStart - 2] + 1;
  const byteEnd =
    lastLine <= index.newlines.length
      ? index.newlines[lastLine - 1]
      : index.size;
  return { start: byteStart, endExclusive: byteEnd };
}

export function collectLineRangeFromIndexedText(
  text: string,
  index: LineOffsetIndex,
  start: number,
  end: number,
): LineRangeResult {
  const normalizedStart = Math.max(1, Math.floor(start));
  const normalizedEnd = Math.max(normalizedStart, Math.floor(end));
  if (normalizedStart > index.total)
    return { lines: [], total: index.total, complete: true };
  const expectedLines =
    Math.min(normalizedEnd, index.total) - normalizedStart + 1;
  const lines = text.length
    ? text
        .split("\n")
        .map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line))
    : Array.from({ length: expectedLines }, () => "");
  return { lines, total: index.total, complete: end >= index.total };
}
