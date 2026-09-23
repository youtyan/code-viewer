import { describe, expect, test } from "vitest";
import {
  bootFileListFold,
  fileListAction,
  listColumnBodyWidth,
} from "../core/panel-column-policy";

// ファイル一覧を自動で畳むか・開くか (core/panel-column-policy.ts)。畳むのは
// 頭の下の一覧だけで、頭の行 (#panel-head) は同じ幅で残る。幅が足りなければ畳み
// (core/list-column.ts の listColumnLayout が filesFolded)、足りるようになったら
// 自動で畳んだものだけ開く。利用者が自分で畳んだものは触らない。
describe("fileListAction", () => {
  test.each([
    {
      name: "足りない・開いている",
      folded: true,
      autoHidden: false,
      userHidden: false,
      action: "collapse",
    },
    {
      name: "足りない・もう自動で畳んだ",
      folded: true,
      autoHidden: true,
      userHidden: false,
      action: "keep",
    },
    {
      name: "足りる・自動で畳んでいた",
      folded: false,
      autoHidden: true,
      userHidden: false,
      action: "restore",
    },
    {
      name: "足りる・開いている",
      folded: false,
      autoHidden: false,
      userHidden: false,
      action: "keep",
    },
    {
      name: "足りない・利用者が畳んだ",
      folded: true,
      autoHidden: false,
      userHidden: true,
      action: "keep",
    },
    {
      name: "足りる・利用者が畳んだ",
      folded: false,
      autoHidden: false,
      userHidden: true,
      action: "keep",
    },
  ] as const)("$name → $action", ({ name: _name, action, ...state }) => {
    expect(fileListAction(state)).toBe(action);
  });
});

// 一覧の列が本文の横に取る幅。本文の幅 (2 面の面の幅) は一覧の列が出している幅
// で数える (頭の行はタブ列の行にあり数えない)。電話の幅では一覧の列は重ねて出す
// 面なので、これまでどおり頭の実幅を引く (2 面を出さない)。
describe("listColumnBodyWidth", () => {
  test.each([
    { name: "ファイル一覧だけ", shown: 240, overlaid: false, width: 240 },
    {
      name: "History (ファイル一覧・一覧・帯)",
      shown: 508,
      overlaid: false,
      width: 508,
    },
    { name: "全部畳んだ", shown: 0, overlaid: false, width: 0 },
    { name: "電話・ファイル一覧だけ", shown: 240, overlaid: true, width: 390 },
    { name: "電話・全部畳んだ", shown: 0, overlaid: true, width: 390 },
  ])("$name → $width", ({ shown, overlaid, width }) => {
    expect(listColumnBodyWidth({ shown, overlaid, headWidth: 390 })).toBe(
      width,
    );
  });
});

// 起動の途中で、早いスクリプトが付けた畳みを外さずに引き継ぐ。外すと、設定を読む
// までの間ファイル一覧が開いて描かれ、設定を読んでまた畳んだとき本文が 240px
// 動いた (読み込みの CLS 0.38 / 0.14。1600 / 1280)。
describe("bootFileListFold", () => {
  test.each([
    {
      name: "畳んで描いていない",
      bodyHidden: false,
      early: true,
      user: false,
      auto: false,
    },
    {
      name: "利用者の畳み (控え)",
      bodyHidden: true,
      early: true,
      user: true,
      auto: false,
    },
    {
      name: "幅による畳み",
      bodyHidden: true,
      early: false,
      user: false,
      auto: true,
    },
    {
      name: "控えが読めない",
      bodyHidden: true,
      early: null,
      user: false,
      auto: true,
    },
  ])("$name → 利用者 $user・自動 $auto", ({
    bodyHidden,
    early,
    user,
    auto,
  }) => {
    expect(bootFileListFold({ bodyHidden, earlyUserHidden: early })).toEqual({
      userHidden: user,
      autoHidden: auto,
    });
  });
});
