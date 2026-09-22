import { describe, expect, test } from "vitest";
import { listColumnLayout, restoredListWidth } from "../core/list-column";
import { HISTORY_WIDTH } from "../core/panel-sizes";

// 一覧の列の決まり (core/list-column.ts)。本文 = room − 一覧 − 変更ファイルの木。
// 本文が need に足りなければ、一覧を詰めた幅 (240) にし、次に木を帯 (28) に畳む。
// 利用者が木を開いていれば畳まない。利用者の幅が詰めた幅以下なら詰めない。
// 境目は既定の密度・左のサイドバー 280・右の列の帯 28 のとき room = 窓 − 308。
describe("listColumnLayout", () => {
  const base = {
    preferred: 320,
    compact: 240,
    tree: 240,
    treeRail: 28,
    treeKeptOpen: false,
  };
  test.each([
    // 1 面の History (need 480): 窓 1348 から全幅、1268 から詰める、それ未満は木を畳む
    { name: "1 面 History 1348", room: 1040, need: 480, width: 320, tree: 240 },
    { name: "1 面 History 1347", room: 1039, need: 480, width: 240, tree: 240 },
    { name: "1 面 History 1268", room: 960, need: 480, width: 240, tree: 240 },
    { name: "1 面 History 1267", room: 959, need: 480, width: 240, tree: 28 },
    // 2 面の History (need 961): 1829 から全幅、1749 から詰める、それ未満は木を畳む
    { name: "2 面 History 1829", room: 1521, need: 961, width: 320, tree: 240 },
    { name: "2 面 History 1828", room: 1520, need: 961, width: 240, tree: 240 },
    { name: "2 面 History 1749", room: 1441, need: 961, width: 240, tree: 240 },
    { name: "2 面 History 1748", room: 1440, need: 961, width: 240, tree: 28 },
    { name: "2 面 History 1600", room: 1292, need: 961, width: 240, tree: 28 },
    // 木を開いたまま (利用者が開いた) なら、足りなくても畳まない
    {
      name: "2 面 History 1600・木を開いた",
      room: 1292,
      need: 961,
      treeKeptOpen: true,
      width: 240,
      tree: 240,
    },
    // Diff は木が無い
    {
      name: "1 面 Diff 1108",
      room: 800,
      need: 480,
      tree0: true,
      width: 320,
      tree: 0,
    },
    {
      name: "1 面 Diff 1107",
      room: 799,
      need: 480,
      tree0: true,
      width: 240,
      tree: 0,
    },
    {
      name: "2 面 Diff 1589",
      room: 1281,
      need: 961,
      tree0: true,
      width: 320,
      tree: 0,
    },
    {
      name: "2 面 Diff 1588",
      room: 1280,
      need: 961,
      tree0: true,
      width: 240,
      tree: 0,
    },
    // 一覧を隠している (preferred 0) ときも、木は畳む
    {
      name: "一覧を隠した 2 面 History 1280",
      room: 972,
      need: 961,
      preferred: 0,
      width: 0,
      tree: 28,
    },
    // 利用者が広げた幅・詰めた幅と同じ幅
    {
      name: "利用者 560・1 面 History 1600",
      room: 1292,
      need: 480,
      preferred: 560,
      width: 560,
      tree: 240,
    },
    {
      name: "利用者 240・狭い",
      room: 500,
      need: 480,
      preferred: 240,
      width: 240,
      tree: 28,
    },
  ])("$name → 一覧 $width・木 $tree", ({
    name: _name,
    room,
    need,
    width,
    tree,
    tree0,
    preferred,
    treeKeptOpen,
  }: {
    name: string;
    room: number;
    need: number;
    width: number;
    tree: number;
    tree0?: boolean;
    preferred?: number;
    treeKeptOpen?: boolean;
  }) => {
    const input = {
      ...base,
      room,
      need,
      ...(tree0 ? { tree: 0 } : {}),
      ...(preferred === undefined ? {} : { preferred }),
      ...(treeKeptOpen === undefined ? {} : { treeKeptOpen }),
    };
    expect(listColumnLayout(input)).toEqual({
      width,
      compact: width !== input.preferred,
      tree,
      treeFolded: input.tree > 0 && tree !== input.tree,
    });
  });
});

// 保存した一覧の列の幅の読み戻し。範囲 (240〜800) の中はそのまま、外は既定の 320
// (端へ寄せない)。
describe("restoredListWidth", () => {
  test.each([
    { value: 560, restored: 560 },
    { value: 320, restored: 320 },
    { value: 240, restored: 240 },
    { value: 800, restored: 800 },
    { value: 300.6, restored: 301 },
    { value: 239, restored: 320 },
    { value: 220, restored: 320 },
    { value: 801, restored: 320 },
    { value: Number.NaN, restored: 320 },
    { value: Number.POSITIVE_INFINITY, restored: 320 },
    { value: "560", restored: 320 },
    { value: null, restored: 320 },
    { value: undefined, restored: 320 },
  ])("$value → $restored", ({ value, restored }) => {
    expect(restoredListWidth(value, HISTORY_WIDTH)).toBe(restored);
  });
});
