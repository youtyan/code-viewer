// _css-fixture.ts の読み方そのもの。選択子の並びを括弧の中のカンマで切らないこと、
// 詳細度を Selectors Level 4 のとおりに数えること (実際の要素でカスケードを解く
// テストがこれに頼る)。

import { expect, test } from "vitest";
import { parseCss } from "./_css-fixture";

test("a selector list is split only at top-level commas", () => {
  expect(
    parseCss('.a :is(h1, h2) .b, [title="x, y"], .c { color: red; }').map(
      (rule) => rule.selector,
    ),
  ).toEqual([".a :is(h1, h2) .b", '[title="x, y"]', ".c"]);
});

test.each([
  ["a:hover:focus", [0, 2, 1]],
  [".a::after", [0, 1, 1]],
  ["#topbar .controls > button:not(.seg button)", [1, 2, 2]],
  [".nav-head > :is(.nav-search, #x):focus-visible", [1, 2, 0]],
  [":where(.a) .b", [0, 1, 0]],
  ['input[type="checkbox"]:checked', [0, 2, 1]],
  ["li:nth-child(odd)", [0, 1, 1]],
  ["#filelist.tree .tree-file.active:focus-visible", [1, 4, 0]],
])("specificity of %s", (selector, expected) => {
  expect(parseCss(`${selector} { color: red; }`)[0].specificity).toEqual(
    expected,
  );
});
