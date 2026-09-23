// ?pane=right は、URL の path と route が右の面のファイルを指していること。
// 右の面にフォーカスがあり前面がファイルのとき、URL はそのファイルの route に
// これを足したもの。route の読みはこの印で変わらない (面を決めるのは app)。

import { describe, expect, test } from "vitest";
import { parsePaneOverlay, parseRoute, withPaneOverlay } from "../core/routes";

const RANGE = { from: "HEAD", to: "worktree" };

describe("pane overlay query", () => {
  test.each([
    { search: "?path=src%2Fsample.ts&pane=right", expected: "right" },
    { search: "?pane=left", expected: null },
    { search: "?pane=", expected: null },
    { search: "?path=src%2Fsample.ts", expected: null },
    { search: "", expected: null },
  ])("parsePaneOverlay($search) is $expected", ({ search, expected }) => {
    expect(parsePaneOverlay(search)).toBe(expected);
  });

  test.each([
    {
      url: "/file?path=src%2Fsample.ts&target=worktree",
      side: "right" as const,
      expected: "/file?path=src%2Fsample.ts&target=worktree&pane=right",
    },
    {
      url: "/file?path=src%2Fsample.ts&pane=right",
      side: null,
      expected: "/file?path=src%2Fsample.ts",
    },
    { url: "/file?pane=right", side: null, expected: "/file" },
  ])("withPaneOverlay($url, $side)", ({ url, side, expected }) => {
    expect(withPaneOverlay(url, side)).toBe(expected);
  });

  test("the marker does not change the parsed file route", () => {
    const search = "?path=src%2Fsample.ts&target=worktree&view=blob&line=12";
    expect(
      parseRoute("/file", withPaneOverlay(search, "right"), RANGE),
    ).toEqual(parseRoute("/file", search, RANGE));
  });
});
