import { describe, expect, test } from "vitest";
import {
  type ListColumnKind,
  listColumnDrag,
  listColumnKindFor,
  listColumnLayout,
  restoredListWidth,
} from "../core/list-column";
import { HISTORY_WIDTH } from "../core/panel-sizes";
import { DIFF_SCREEN_TEXT } from "../views/diff-view-i18n";

// 一覧の列の決まり (core/list-column.ts)。本文 = room − ファイル一覧 − 一覧 −
// 変更ファイルの一覧。本文が need に足りなければ、(1) 一覧を詰めた幅 (240) に
// し、(2) 変更ファイルの一覧を帯 (28) に畳み、(3) ファイル一覧を畳む。利用者が
// 手で開いた列は畳まない。境目は既定の密度・左のサイドバー 280・ファイル一覧
// 240 のとき room = 窓 − 280。
describe("listColumnLayout", () => {
  const base = {
    files: 240,
    filesRail: 40,
    filesKeptOpen: false,
    preferred: 320,
    compact: 240,
    tree: 240,
    treeRail: 28,
    treeKeptOpen: false,
  };
  type Row = {
    name: string;
    room: number;
    need: number;
    input?: Partial<typeof base>;
    width: number;
    tree: number;
    filesFolded: boolean;
  };
  const rows: Row[] = [
    // 1 面の History (need 480): 窓 1560 から全幅、1480 から詰め、1268 から変更
    // ファイルの一覧を畳み、それ未満はファイル一覧も畳む
    {
      name: "1 面 History 1560",
      room: 1280,
      need: 480,
      width: 320,
      tree: 240,
      filesFolded: false,
    },
    {
      name: "1 面 History 1559",
      room: 1279,
      need: 480,
      width: 240,
      tree: 240,
      filesFolded: false,
    },
    {
      name: "1 面 History 1480",
      room: 1200,
      need: 480,
      width: 240,
      tree: 240,
      filesFolded: false,
    },
    {
      name: "1 面 History 1479",
      room: 1199,
      need: 480,
      width: 240,
      tree: 28,
      filesFolded: false,
    },
    {
      name: "1 面 History 1280",
      room: 1000,
      need: 480,
      width: 240,
      tree: 28,
      filesFolded: false,
    },
    {
      name: "1 面 History 1268",
      room: 988,
      need: 480,
      width: 240,
      tree: 28,
      filesFolded: false,
    },
    {
      name: "1 面 History 1267",
      room: 987,
      need: 480,
      width: 240,
      tree: 28,
      filesFolded: true,
    },
    // 2 面の History (need 961): 2041 から全幅、1961 から詰め、1749 から畳み、
    // それ未満はファイル一覧も畳む (右の面を預けるかは main-tabs-view)
    {
      name: "2 面 History 2041",
      room: 1761,
      need: 961,
      width: 320,
      tree: 240,
      filesFolded: false,
    },
    {
      name: "2 面 History 2040",
      room: 1760,
      need: 961,
      width: 240,
      tree: 240,
      filesFolded: false,
    },
    {
      name: "2 面 History 1961",
      room: 1681,
      need: 961,
      width: 240,
      tree: 240,
      filesFolded: false,
    },
    {
      name: "2 面 History 1960",
      room: 1680,
      need: 961,
      width: 240,
      tree: 28,
      filesFolded: false,
    },
    {
      name: "2 面 History 1749",
      room: 1469,
      need: 961,
      width: 240,
      tree: 28,
      filesFolded: false,
    },
    {
      name: "2 面 History 1748",
      room: 1468,
      need: 961,
      width: 240,
      tree: 28,
      filesFolded: true,
    },
    {
      name: "2 面 History 1600",
      room: 1320,
      need: 961,
      width: 240,
      tree: 28,
      filesFolded: true,
    },
    {
      name: "2 面 History 1280",
      room: 1000,
      need: 961,
      width: 240,
      tree: 28,
      filesFolded: true,
    },
    // 利用者が手で開いた列は、足りなくても畳まない
    {
      name: "2 面 History 1600・変更ファイルの一覧を開いた",
      room: 1320,
      need: 961,
      input: { treeKeptOpen: true },
      width: 240,
      tree: 240,
      filesFolded: true,
    },
    {
      name: "2 面 History 1600・ファイル一覧を開いた",
      room: 1320,
      need: 961,
      input: { filesKeptOpen: true },
      width: 240,
      tree: 28,
      filesFolded: false,
    },
    // 利用者がファイル一覧を畳んでいる (files 0): 畳むものは無い
    {
      name: "2 面 History 1280・ファイル一覧を利用者が畳んだ",
      room: 1000,
      need: 961,
      input: { files: 0 },
      width: 240,
      tree: 28,
      filesFolded: false,
    },
    // 利用者が畳んだファイル一覧も画面の入口の縦の帯 (40) は取る: 帯を数えなければ
    // 全幅の一覧が入る幅でも、帯の分だけ詰める。
    {
      name: "1 面 History・ファイル一覧を利用者が畳んだ・帯の分だけ詰める",
      room: 1060,
      need: 480,
      input: { files: 0 },
      width: 240,
      tree: 240,
      filesFolded: false,
    },
    // Diff は一覧が変更ファイルの一覧 (その右の列は無い): 1 面は 1320 から全幅、
    // 1240 から詰め、それ未満はファイル一覧を畳む。2 面は 1801・1721
    {
      name: "1 面 Diff 1320",
      room: 1040,
      need: 480,
      input: { tree: 0 },
      width: 320,
      tree: 0,
      filesFolded: false,
    },
    {
      name: "1 面 Diff 1319",
      room: 1039,
      need: 480,
      input: { tree: 0 },
      width: 240,
      tree: 0,
      filesFolded: false,
    },
    {
      name: "1 面 Diff 1240",
      room: 960,
      need: 480,
      input: { tree: 0 },
      width: 240,
      tree: 0,
      filesFolded: false,
    },
    {
      name: "1 面 Diff 1239",
      room: 959,
      need: 480,
      input: { tree: 0 },
      width: 240,
      tree: 0,
      filesFolded: true,
    },
    {
      name: "2 面 Diff 1801",
      room: 1521,
      need: 961,
      input: { tree: 0 },
      width: 320,
      tree: 0,
      filesFolded: false,
    },
    {
      name: "2 面 Diff 1721",
      room: 1441,
      need: 961,
      input: { tree: 0 },
      width: 240,
      tree: 0,
      filesFolded: false,
    },
    {
      name: "2 面 Diff 1720",
      room: 1440,
      need: 961,
      input: { tree: 0 },
      width: 240,
      tree: 0,
      filesFolded: true,
    },
    // 一覧の無い画面 (Files など): 2 面は 1481 からファイル一覧を出したまま
    {
      name: "2 面 Files 1481",
      room: 1201,
      need: 961,
      input: { preferred: 0, tree: 0 },
      width: 0,
      tree: 0,
      filesFolded: false,
    },
    {
      name: "2 面 Files 1480",
      room: 1200,
      need: 961,
      input: { preferred: 0, tree: 0 },
      width: 0,
      tree: 0,
      filesFolded: true,
    },
    {
      name: "1 面 Files 1280",
      room: 1000,
      need: 480,
      input: { preferred: 0, tree: 0 },
      width: 0,
      tree: 0,
      filesFolded: false,
    },
    // 利用者が一覧を畳んだ (帯 28 の幅で渡す): 詰めない
    {
      name: "一覧を畳んだ 2 面 History 1600",
      room: 1320,
      need: 961,
      input: { preferred: 28 },
      width: 28,
      tree: 28,
      filesFolded: false,
    },
    // 利用者が広げた幅・詰めた幅と同じ幅
    {
      name: "利用者 560・1 面 History 1800",
      room: 1520,
      need: 480,
      input: { preferred: 560 },
      width: 560,
      tree: 240,
      filesFolded: false,
    },
    {
      name: "利用者 240・狭い",
      room: 760,
      need: 480,
      input: { preferred: 240 },
      width: 240,
      tree: 28,
      filesFolded: true,
    },
  ];
  test.each(
    rows,
  )("$name → 一覧 $width・変更ファイルの一覧 $tree・ファイル一覧を畳む $filesFolded", ({
    room,
    need,
    input: extra,
    width,
    tree,
    filesFolded,
  }) => {
    const input = { ...base, ...extra, room, need };
    expect(listColumnLayout(input)).toEqual({
      width,
      compact: width !== input.preferred,
      tree,
      treeFolded: input.tree > 0 && tree !== input.tree,
      filesFolded,
    });
  });
});

// 一覧の列に出す一覧 (core/list-column.ts の listColumnKindFor)。列は前面の
// タブの画面で決める。端末・画像のタブが左の前面なら、背面の画面の印が残って
// いても一覧は出さない (History から端末を開くと、コミットと変更ファイルの一覧が
// 端末の左に残っていた)。
describe("listColumnKindFor", () => {
  const rows: Array<{
    name: string;
    classes: string[];
    overview?: boolean;
    front: "page" | "terminal";
    kind: ListColumnKind | null;
  }> = [
    {
      name: "Diff",
      classes: ["gdp-diff-page"],
      front: "page",
      kind: "sidebar",
    },
    {
      name: "History",
      classes: ["gdp-history-page"],
      front: "page",
      kind: "history",
    },
    {
      name: "History で開いたファイル",
      classes: ["gdp-history-page", "gdp-file-detail-page"],
      front: "page",
      kind: "history",
    },
    {
      name: "選んでいる作業ツリー",
      classes: ["gdp-worktree-page"],
      front: "page",
      kind: "worktree",
    },
    {
      name: "作業ツリーの一覧だけ",
      classes: ["gdp-worktree-page"],
      overview: true,
      front: "page",
      kind: null,
    },
    {
      name: "Diff から開いたファイルの詳細",
      classes: ["gdp-file-detail-page"],
      front: "page",
      kind: "sidebar",
    },
    {
      name: "ファイルのソース",
      classes: ["gdp-file-detail-page", "gdp-repo-blob-page"],
      front: "page",
      kind: null,
    },
    { name: "Files", classes: ["gdp-repo-page"], front: "page", kind: null },
    { name: "Data", classes: ["gdp-database-page"], front: "page", kind: null },
    {
      name: "History の上に端末",
      classes: ["gdp-history-page"],
      front: "terminal",
      kind: null,
    },
    {
      name: "Diff の上に端末",
      classes: ["gdp-diff-page"],
      front: "terminal",
      kind: null,
    },
    {
      name: "選んでいる作業ツリーの上に端末",
      classes: ["gdp-worktree-page"],
      front: "terminal",
      kind: null,
    },
    {
      name: "Files の上に端末",
      classes: ["gdp-repo-page"],
      front: "terminal",
      kind: null,
    },
  ];
  test.each(rows)("$name ($front) → $kind", ({
    classes,
    overview,
    front,
    kind,
  }) => {
    expect(
      listColumnKindFor({
        has: (pageClass) => classes.includes(pageClass),
        worktreeOverview: overview === true,
        leftFrontIsPage: front === "page",
      }),
    ).toBe(kind);
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
// 見えている一覧の幅 (隣の変更ファイルの一覧を含めない)、上限は本文が要る幅を
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

// 変更ファイルの一覧 (#sidebar) の見出し。ファイル一覧 (#file-list) の「Files」と
// 分けて、同時に出ていてもどちらの一覧か分かるようにする (app.ts の
// syncSidebarTitle が当てる)。
test("the changed files label is the one the screens use", () => {
  expect(DIFF_SCREEN_TEXT.en.fileListLabel).toBe("Changed files");
  expect(DIFF_SCREEN_TEXT.ja.fileListLabel).toBe("変更ファイル");
});
