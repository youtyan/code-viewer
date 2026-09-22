// パンくずの真ん中を「…」に畳む範囲 (core/breadcrumb-fit.ts)。先頭と末尾 2 段は
// 残し、入りきるまで先頭の次から順に畳む。
import { expect, test } from "vitest";
import { collapsedBreadcrumbRange } from "../core/breadcrumb-fit";

// 段の幅はどれも 50、区切り 10、「…」 12 とする。
// 9 段全部: 50 * 9 + 10 * 8 = 530
// [1, to) を畳むと: 段 (9 - (to - 1)) 個 + 「…」 + 区切り (段の数) 個
const nine = [50, 50, 50, 50, 50, 50, 50, 50, 50];

test.each([
  { name: "入りきる", parts: nine, available: 530, range: null },
  {
    name: "1 段畳めば入る",
    parts: nine,
    available: 492,
    range: { from: 1, to: 2 },
  },
  {
    name: "2 段畳めば入る",
    parts: nine,
    available: 432,
    range: { from: 1, to: 3 },
  },
  {
    name: "全部畳んでも足りない: 先頭と末尾 2 段は残す",
    parts: nine,
    available: 100,
    range: { from: 1, to: 7 },
  },
  {
    name: "ちょうど全部畳めば入る",
    parts: nine,
    available: 192,
    range: { from: 1, to: 7 },
  },
  {
    name: "3 段 (先頭と末尾 2 段) は畳めない",
    parts: [50, 50, 50],
    available: 60,
    range: null,
  },
  {
    name: "4 段なら真ん中 1 段だけ畳める",
    parts: [50, 50, 50, 50],
    available: 150,
    range: { from: 1, to: 2 },
  },
  { name: "空", parts: [], available: 0, range: null },
  // 長い段が真ん中にあると、そこまで畳めば入る
  {
    name: "長い段を畳む",
    parts: [40, 300, 40, 40, 80],
    available: 260,
    range: { from: 1, to: 2 },
  },
])("$name", ({ parts, available, range }) => {
  expect(
    collapsedBreadcrumbRange({ parts, separator: 10, ellipsis: 12, available }),
  ).toEqual(range);
});
