import { describe, expect, test } from "bun:test";
import {
  buildLineOffsetIndex,
  buildLineOffsetIndexFromStream,
  collectByteRangeFromStream,
  collectBytesWithLineOffsetIndexFromStream,
  collectLineRangeFromIndexedText,
  collectLineRangeFromStream,
  isSameWorktreeRange,
  lineByteRangeForIndex,
  parseHttpByteRange,
} from "../server/range";

function streamFromText(text: string): ReadableStream<Uint8Array> {
  const body = new Response(text).body;
  if (!body) throw new Error("Response body is unavailable");
  return body;
}

describe("isSameWorktreeRange", () => {
  test("treats explicit worktree to worktree as a no-op diff range", () => {
    expect(isSameWorktreeRange({ from: "worktree", to: "worktree" })).toBe(
      true,
    );
  });

  test("does not treat default or one-sided worktree ranges as no-op", () => {
    expect(isSameWorktreeRange({ from: "HEAD", to: "worktree" })).toBe(false);
    expect(isSameWorktreeRange({ from: "", to: "" })).toBe(false);
  });
});

describe("parseHttpByteRange", () => {
  test("parses a bounded byte range", () => {
    expect(parseHttpByteRange("bytes=2-5", 10)).toEqual({
      kind: "range",
      range: { start: 2, end: 5 },
    });
  });

  test("parses a suffix byte range", () => {
    expect(parseHttpByteRange("bytes=-4", 10)).toEqual({
      kind: "range",
      range: { start: 6, end: 9 },
    });
  });

  test("parses an open-ended byte range", () => {
    expect(parseHttpByteRange("bytes=2-", 10)).toEqual({
      kind: "range",
      range: { start: 2, end: 9 },
    });
  });

  test("rejects unsatisfiable or malformed byte ranges", () => {
    expect(parseHttpByteRange("bytes=10-12", 10)).toEqual({
      kind: "unsatisfiable",
    });
    expect(parseHttpByteRange("bytes=-0", 10)).toEqual({
      kind: "unsatisfiable",
    });
    expect(parseHttpByteRange("items=0-1", 10)).toEqual({ kind: "invalid" });
    expect(parseHttpByteRange("bytes=0-1,2-3", 10)).toEqual({
      kind: "invalid",
    });
    expect(parseHttpByteRange("bytes=5-2", 10)).toEqual({
      kind: "unsatisfiable",
    });
  });
});

describe("collectLineRangeFromStream", () => {
  test("collects only the requested 1-based line range from a stream", async () => {
    const result = await collectLineRangeFromStream(
      streamFromText("one\ntwo\nthree\nfour\n"),
      2,
      3,
    );
    expect(result).toEqual({
      lines: ["two", "three"],
      total: 4,
      complete: false,
    });
  });

  test("handles CRLF and files without a final newline", async () => {
    const result = await collectLineRangeFromStream(
      streamFromText("one\r\ntwo\r\nthree"),
      2,
      5,
    );
    expect(result).toEqual({
      lines: ["two", "three"],
      total: 3,
      complete: true,
    });
  });

  test("returns an empty complete result when the requested start is past EOF", async () => {
    const result = await collectLineRangeFromStream(
      streamFromText("one\ntwo\nthree"),
      10,
      12,
    );
    expect(result).toEqual({ lines: [], total: 3, complete: true });
  });

  test("distinguishes exact EOF from a following line after the requested range", async () => {
    expect(
      await collectLineRangeFromStream(streamFromText("one\ntwo\nthree"), 1, 3),
    ).toEqual({ lines: ["one", "two", "three"], total: 3, complete: true });
    expect(
      await collectLineRangeFromStream(
        streamFromText("one\ntwo\nthree\nfour"),
        1,
        3,
      ),
    ).toEqual({ lines: ["one", "two", "three"], total: 4, complete: false });
  });
});

describe("collectByteRangeFromStream", () => {
  test("collects a byte slice across stream chunks", async () => {
    const bytes = await collectByteRangeFromStream(
      streamFromText("zero\none\ntwo\nthree"),
      5,
      12,
    );
    expect(new TextDecoder().decode(bytes)).toBe("one\ntwo");
  });
});

describe("line offset index", () => {
  test("maps a 1-based line range to the minimal byte slice", () => {
    const bytes = new TextEncoder().encode("one\ntwo\nthree\nfour");
    const index = buildLineOffsetIndex(bytes);
    expect(index.total).toBe(4);
    expect(lineByteRangeForIndex(index, 3, 3)).toEqual({
      start: 8,
      endExclusive: 13,
    });
  });

  test("builds the same line offset index from a stream without requiring a single byte array", async () => {
    const text = "one\ntwo\nthree\nfour";
    const bytes = new TextEncoder().encode(text);
    const index = await buildLineOffsetIndexFromStream(
      streamFromText(text),
      bytes.length,
    );
    expect(index).toEqual(buildLineOffsetIndex(bytes));
  });

  test("uses the actual stream byte count when it differs from the hinted size", async () => {
    const text = "one\ntwo";
    const index = await buildLineOffsetIndexFromStream(
      streamFromText(text),
      999,
    );
    expect(index.size).toBe(new TextEncoder().encode(text).byteLength);
    expect(index.total).toBe(2);
  });

  test("collects bytes and a line offset index from a stream in one pass", async () => {
    const text = "one\ntwo\nthree";
    const result = await collectBytesWithLineOffsetIndexFromStream(
      streamFromText(text),
      0,
    );
    expect(new TextDecoder().decode(result.bytes)).toBe(text);
    expect(result.index).toEqual(
      buildLineOffsetIndex(new TextEncoder().encode(text)),
    );
  });

  test("collects indexed lines with the same total and complete semantics as streams", async () => {
    const text = "one\r\ntwo\r\nthree\nfour";
    const bytes = new TextEncoder().encode(text);
    const index = buildLineOffsetIndex(bytes);
    const range = lineByteRangeForIndex(index, 2, 3);
    if (!range) throw new Error("expected indexed byte range");
    const indexed = collectLineRangeFromIndexedText(
      text.slice(range.start, range.endExclusive),
      index,
      2,
      3,
    );
    expect(indexed).toEqual({
      lines: ["two", "three"],
      total: 4,
      complete: false,
    });
    expect(indexed).toEqual(
      await collectLineRangeFromStream(streamFromText(text), 2, 3),
    );
  });

  test("returns empty complete indexed results past EOF", () => {
    const text = "one\ntwo\nthree";
    const index = buildLineOffsetIndex(new TextEncoder().encode(text));
    expect(lineByteRangeForIndex(index, 10, 12)).toBeNull();
    expect(collectLineRangeFromIndexedText("", index, 10, 12)).toEqual({
      lines: [],
      total: 3,
      complete: true,
    });
  });

  test("keeps empty lines when an indexed byte slice has zero length", async () => {
    const text = "\nnext";
    const bytes = new TextEncoder().encode(text);
    const index = buildLineOffsetIndex(bytes);
    const range = lineByteRangeForIndex(index, 1, 1);
    if (!range) throw new Error("expected indexed byte range");
    expect(range).toEqual({ start: 0, endExclusive: 0 });
    const indexed = collectLineRangeFromIndexedText(
      text.slice(range.start, range.endExclusive),
      index,
      1,
      1,
    );
    expect(indexed).toEqual(
      await collectLineRangeFromStream(streamFromText(text), 1, 1),
    );
  });

  test("sets indexed complete exactly at EOF boundaries", () => {
    const text = "one\ntwo\nthree";
    const index = buildLineOffsetIndex(new TextEncoder().encode(text));
    expect(
      collectLineRangeFromIndexedText("one\ntwo", index, 1, 2).complete,
    ).toBe(false);
    expect(
      collectLineRangeFromIndexedText("one\ntwo\nthree", index, 1, 3).complete,
    ).toBe(true);
  });
});
