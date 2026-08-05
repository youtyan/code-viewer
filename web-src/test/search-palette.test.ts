import { describe, expect, test } from "vitest";
import {
  limitPaletteResults,
  movePaletteSelection,
  PALETTE_RESULT_LIMIT,
  rankGrepResultsByHistory,
  rememberGrepSelection,
} from "../core/search-palette";

describe("limitPaletteResults", () => {
  test("keeps only the first palette result window", () => {
    const items = Array.from(
      { length: PALETTE_RESULT_LIMIT + 2 },
      (_, index) => index,
    );
    expect(limitPaletteResults(items).length).toBe(PALETTE_RESULT_LIMIT);
  });
});

describe("movePaletteSelection", () => {
  test.each([
    {
      name: "down starts at the first item when there is no selection",
      index: -1,
      count: 3,
      direction: 1 as const,
      expected: 0,
    },
    {
      name: "up starts at the last item when there is no selection",
      index: -1,
      count: 3,
      direction: -1 as const,
      expected: 2,
    },
    {
      name: "down moves to the next item",
      index: 1,
      count: 3,
      direction: 1 as const,
      expected: 2,
    },
    {
      name: "up moves to the previous item",
      index: 1,
      count: 3,
      direction: -1 as const,
      expected: 0,
    },
    {
      name: "down stops at the last item",
      index: 2,
      count: 3,
      direction: 1 as const,
      expected: 2,
    },
    {
      name: "up stops at the first item",
      index: 0,
      count: 3,
      direction: -1 as const,
      expected: 0,
    },
    {
      name: "a single item remains selected in either direction",
      index: 0,
      count: 1,
      direction: 1 as const,
      expected: 0,
    },
  ])("$name", ({ index, count, direction, expected }) => {
    expect(movePaletteSelection(index, count, direction)).toBe(expected);
  });

  test("returns -1 for empty results", () => {
    expect(movePaletteSelection(0, 0, 1)).toBe(-1);
  });
});

describe("grep selection history", () => {
  test("moves a repeated path to the most-recent end", () => {
    expect(
      rememberGrepSelection(["src/old.ts", "src/recent.ts"], "src/old.ts"),
    ).toEqual(["src/recent.ts", "src/old.ts"]);
  });

  test("prioritizes recent paths while preserving server order within a path", () => {
    const results = [
      { path: "src/plain.ts", line: 1 },
      { path: "src/recent.ts", line: 8 },
      { path: "src/older.ts", line: 3 },
      { path: "src/recent.ts", line: 12 },
    ];
    expect(
      rankGrepResultsByHistory(results, ["src/older.ts", "src/recent.ts"]),
    ).toEqual([
      { path: "src/recent.ts", line: 8 },
      { path: "src/recent.ts", line: 12 },
      { path: "src/older.ts", line: 3 },
      { path: "src/plain.ts", line: 1 },
    ]);
  });
});
