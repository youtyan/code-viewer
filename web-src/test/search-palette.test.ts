import { describe, expect, test } from "vitest";
import {
  buildGrepRequestParams,
  limitPaletteResults,
  movePaletteSelection,
  PALETTE_RESULT_LIMIT,
  parseGrepQuery,
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

describe("parseGrepQuery", () => {
  test.each([
    { name: "plain text", raw: "needle", term: "needle", paths: [] },
    {
      name: "multiple words collapse to one phrase",
      raw: "  foo   bar ",
      term: "foo bar",
      paths: [],
    },
    {
      name: "a leading path: scope",
      raw: "path:src/ needle",
      term: "needle",
      paths: ["src/"],
    },
    {
      name: "a trailing path: scope",
      raw: "needle path:lib/a.ts",
      term: "needle",
      paths: ["lib/a.ts"],
    },
    {
      name: "several scopes, in order",
      raw: "path:src path:*.md needle",
      term: "needle",
      paths: ["src", "*.md"],
    },
    {
      name: "scope only leaves an empty term",
      raw: "path:src/",
      term: "",
      paths: ["src/"],
    },
    {
      name: "a bare path: is dropped, not searched",
      raw: "path: needle",
      term: "needle",
      paths: [],
    },
    {
      name: "path: inside a word is ordinary text",
      raw: "urlpath:foo",
      term: "urlpath:foo",
      paths: [],
    },
    { name: "empty input", raw: "", term: "", paths: [] },
  ])("$name", ({ raw, term, paths }) => {
    expect(parseGrepQuery(raw)).toEqual({ term, paths });
  });
});

describe("buildGrepRequestParams", () => {
  test.each([
    {
      name: "plain defaults send only ref / q / max",
      options: {
        regex: false,
        caseSensitive: false,
        wholeWord: false,
        hideTests: false,
      },
      expected: "ref=worktree&q=needle&max=200",
    },
    {
      name: "every flag on",
      options: {
        regex: true,
        caseSensitive: true,
        wholeWord: true,
        hideTests: true,
      },
      expected:
        "ref=worktree&q=needle&max=200&regex=1&case=1&word=1&exclude_tests=1",
    },
    {
      name: "only match case",
      options: {
        regex: false,
        caseSensitive: true,
        wholeWord: false,
        hideTests: false,
      },
      expected: "ref=worktree&q=needle&max=200&case=1",
    },
  ])("$name", ({ options, expected }) => {
    expect(
      buildGrepRequestParams({
        term: "needle",
        ref: "worktree",
        max: 200,
        ...options,
      }).toString(),
    ).toBe(expected);
  });
});
