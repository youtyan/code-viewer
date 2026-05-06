import { describe, expect, test } from "bun:test";
import { isWhitespaceOnlyInlineHighlight } from "../ws-highlight";

describe("isWhitespaceOnlyInlineHighlight", () => {
  test("matches spaces and tabs but not text changes", () => {
    expect(isWhitespaceOnlyInlineHighlight("  ")).toBe(true);
    expect(isWhitespaceOnlyInlineHighlight("\t")).toBe(true);
    expect(isWhitespaceOnlyInlineHighlight(" name")).toBe(false);
    expect(isWhitespaceOnlyInlineHighlight("")).toBe(false);
    expect(isWhitespaceOnlyInlineHighlight(null)).toBe(false);
  });
});
