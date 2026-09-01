import { describe, expect, test } from "vitest";
import { expandWordAt, isWordBoundary } from "../core/word-boundary";

describe("expandWordAt", () => {
  test.each([
    {
      name: "inside a word",
      text: "const sampleValue = 1;",
      offset: 8,
      expected: { word: "sampleValue", start: 6, end: 17 },
    },
    {
      name: "at the first character",
      text: "sampleValue()",
      offset: 0,
      expected: { word: "sampleValue", start: 0, end: 11 },
    },
    {
      name: "at the word end",
      text: "sampleValue",
      offset: 11,
      expected: { word: "sampleValue", start: 0, end: 11 },
    },
    {
      name: "on punctuation immediately after a word",
      text: "sampleValue.otherValue",
      offset: 11,
      expected: { word: "sampleValue", start: 0, end: 11 },
    },
    {
      name: "on punctuation without a preceding word",
      text: ". sampleValue",
      offset: 0,
      expected: null,
    },
    {
      name: "at the line end after whitespace",
      text: "sampleValue ",
      offset: 12,
      expected: null,
    },
    {
      name: "with full-width letters",
      text: "const 変数名 = 1;",
      offset: 7,
      expected: { word: "変数名", start: 6, end: 9 },
    },
    {
      name: "with an underscore and number",
      text: "sample_value2",
      offset: 7,
      expected: { word: "sample_value2", start: 0, end: 13 },
    },
    {
      name: "with an out-of-range offset",
      text: "sampleValue",
      offset: 12,
      expected: null,
    },
  ])("returns the expected range $name", ({ text, offset, expected }) => {
    expect(expandWordAt(text, offset)).toEqual(expected);
  });
});

describe("isWordBoundary", () => {
  test.each([
    { line: "sample", start: 0, end: 6, expected: true },
    { line: "sample_value", start: 0, end: 6, expected: false },
    { line: "example sample", start: 8, end: 14, expected: true },
    { line: "例sample値", start: 1, end: 7, expected: false },
  ])("checks both sides of [$start,$end) in $line", ({
    line,
    start,
    end,
    expected,
  }) => {
    expect(isWordBoundary(line, start, end)).toBe(expected);
  });
});
