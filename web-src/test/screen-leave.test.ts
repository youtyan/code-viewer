// route を移るとき、離れる画面の後片付け (その画面が本文の面から外す自分の
// 箱・隠した #diff を戻す) が要るかどうか。setRoute (木・パレット・タブ) と
// URL からの移動 (戻る・進む) の両方がこの 1 つの判定を使う。Data から木の
// ファイルを押すと本文が Data のまま残った (setRoute の側に Data が無かった)。

import { describe, expect, test } from "vitest";
import { type AppRoute, screenToLeave } from "../core/routes";

const RANGE = { from: "HEAD", to: "worktree" };
const FILE: AppRoute = {
  screen: "file",
  path: "README.md",
  ref: "worktree",
  view: "blob",
  range: RANGE,
};

const PAGES: Array<{ name: string; route: AppRoute; leaves: string | null }> = [
  {
    name: "Data",
    route: { screen: "database", range: RANGE },
    leaves: "database",
  },
  {
    name: "Worktrees",
    route: { screen: "worktree", range: RANGE },
    leaves: "worktree",
  },
  {
    name: "Work log",
    route: { screen: "journal", range: RANGE },
    leaves: "journal",
  },
  {
    name: "Agents",
    route: { screen: "agents", range: RANGE },
    leaves: "agents",
  },
  // 設定とヘルプは本文 (#diff) を描き直すだけで、自分の箱を持たない。
  {
    name: "Help",
    route: { screen: "help", lang: "en", section: "overview", range: RANGE },
    leaves: null,
  },
  {
    name: "Settings",
    route: { screen: "settings", range: RANGE },
    leaves: null,
  },
];

describe("screenToLeave", () => {
  test.each(PAGES)("$name → a file leaves $leaves", ({ route, leaves }) => {
    expect(screenToLeave(route, FILE)).toBe(leaves);
  });

  test.each(PAGES)("$name → the same page leaves nothing", ({ route }) => {
    expect(screenToLeave(route, route)).toBeNull();
  });

  test.each([
    { name: "a file", route: FILE },
    { name: "the diff", route: { screen: "diff", range: RANGE } as AppRoute },
  ])("$name → Data leaves nothing", ({ route }) => {
    expect(screenToLeave(route, { screen: "database", range: RANGE })).toBe(
      null,
    );
  });
});
