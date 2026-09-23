import { describe, expect, test } from "vitest";
import {
  type ListColumnKind,
  listColumnDrag,
  listColumnLayout,
  restoredListWidth,
  sidebarTitle,
} from "../core/list-column";
import { HISTORY_WIDTH } from "../core/panel-sizes";
import { DIFF_SCREEN_TEXT } from "../views/diff-view-i18n";

// 一覧の列の決まり (core/list-column.ts)。本文 = room − 一覧 − 変更ファイルの木。
// 本文が need に足りなければ、一覧を詰めた幅 (240) にし、次に木を帯 (28) に畳む。
// 利用者が木を開いていれば畳まない。利用者の幅が詰めた幅以下なら詰めない。
// 境目は既定の密度・左のサイドバー 280 のとき room = 窓 − 280 (一覧の画面では
// 右の列の本体は畳んであり、頭の行は残るが本文の横には何も取らない)。
describe("listColumnLayout", () => {
  const base = {
    preferred: 320,
    compact: 240,
    tree: 240,
    treeRail: 28,
    treeKeptOpen: false,
  };
  test.each([
    // 1 面の History (need 480): 窓 1320 から全幅、1240 から詰める、それ未満は木を畳む
    { name: "1 面 History 1320", room: 1040, need: 480, width: 320, tree: 240 },
    { name: "1 面 History 1319", room: 1039, need: 480, width: 240, tree: 240 },
    { name: "1 面 History 1240", room: 960, need: 480, width: 240, tree: 240 },
    { name: "1 面 History 1239", room: 959, need: 480, width: 240, tree: 28 },
    // 2 面の History (need 961): 1801 から全幅、1721 から詰める、それ未満は木を畳む
    { name: "2 面 History 1801", room: 1521, need: 961, width: 320, tree: 240 },
    { name: "2 面 History 1800", room: 1520, need: 961, width: 240, tree: 240 },
    { name: "2 面 History 1721", room: 1441, need: 961, width: 240, tree: 240 },
    { name: "2 面 History 1720", room: 1440, need: 961, width: 240, tree: 28 },
    { name: "2 面 History 1600", room: 1320, need: 961, width: 240, tree: 28 },
    // 木を開いたまま (利用者が開いた) なら、足りなくても畳まない
    {
      name: "2 面 History 1600・木を開いた",
      room: 1320,
      need: 961,
      treeKeptOpen: true,
      width: 240,
      tree: 240,
    },
    // Diff は木が無い
    {
      name: "1 面 Diff 1080",
      room: 800,
      need: 480,
      tree0: true,
      width: 320,
      tree: 0,
    },
    {
      name: "1 面 Diff 1079",
      room: 799,
      need: 480,
      tree0: true,
      width: 240,
      tree: 0,
    },
    {
      name: "2 面 Diff 1561",
      room: 1281,
      need: 961,
      tree0: true,
      width: 320,
      tree: 0,
    },
    {
      name: "2 面 Diff 1560",
      room: 1280,
      need: 961,
      tree0: true,
      width: 240,
      tree: 0,
    },
    // 一覧を隠している (preferred 0) ときも、木は畳む
    {
      name: "一覧を隠した 2 面 History 1280",
      room: 1000,
      need: 961,
      preferred: 0,
      width: 0,
      tree: 28,
    },
    // 利用者が広げた幅・詰めた幅と同じ幅
    {
      name: "利用者 560・1 面 History 1600",
      room: 1320,
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

// 一覧の列の掴みの開始幅と上限 (core/list-column.ts の listColumnDrag)。開始は
// 見えている一覧の幅 (隣の変更ファイルの木を含めない)、上限は本文が要る幅を
// 保てる幅 (範囲 240〜800 の中)。
describe("listColumnDrag", () => {
  test.each([
    // 1600 の History 1 面: room 1292 − 木 240 − 本文 480 = 572 まで広げられる
    {
      name: "既定の幅から",
      shown: 320,
      preferred: 320,
      fits: 572,
      start: 320,
      max: 572,
    },
    // 詰めた幅で出ているときは、見えている 240 から掴む (保存した幅からではない)
    {
      name: "詰めた幅から",
      shown: 240,
      preferred: 500,
      fits: 252,
      start: 240,
      max: 252,
    },
    // 入る幅が下限より狭くても、下限までは掴める
    {
      name: "入る幅が下限より狭い",
      shown: 240,
      preferred: 320,
      fits: 100,
      start: 240,
      max: 240,
    },
    // 広い窓でも範囲の上限 800 まで
    {
      name: "広い窓",
      shown: 560,
      preferred: 560,
      fits: 1400,
      start: 560,
      max: 800,
    },
    // 一覧を隠しているときは保存した幅から
    {
      name: "一覧を隠している",
      shown: 0,
      preferred: 420,
      fits: 700,
      start: 420,
      max: 700,
    },
  ])("$name → 開始 $start・上限 $max", ({
    shown,
    preferred,
    fits,
    start,
    max,
  }) => {
    expect(
      listColumnDrag({ shown, preferred, fits, size: HISTORY_WIDTH }),
    ).toEqual({
      start,
      max,
    });
  });
});

// #sidebar の見出し。一覧の列を出す画面では #sidebar は変更ファイルなので
// 「Changed files / 変更ファイル」。Files の木のときだけ「Files」。History の
// 変更ファイルの列が「FILES」と出て、右の列の Files の木に見えたことがある。
describe("sidebarTitle", () => {
  const cases: Array<{ kind: ListColumnKind | null; changed: boolean }> = [
    { kind: null, changed: false },
    { kind: "sidebar", changed: true },
    { kind: "history", changed: true },
    { kind: "worktree", changed: true },
  ];
  for (const language of ["en", "ja"] as const) {
    const labels = {
      files: `files-${language}`,
      changedFiles: DIFF_SCREEN_TEXT[language].fileListLabel,
    };
    for (const { kind, changed } of cases) {
      test(`${language} ${kind ?? "no list column"}`, () => {
        expect(sidebarTitle(kind, labels)).toBe(
          changed ? labels.changedFiles : labels.files,
        );
      });
    }
  }

  test("the changed files label is the one the screens use", () => {
    expect(DIFF_SCREEN_TEXT.en.fileListLabel).toBe("Changed files");
    expect(DIFF_SCREEN_TEXT.ja.fileListLabel).toBe("変更ファイル");
  });
});
