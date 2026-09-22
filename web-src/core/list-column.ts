// 本文の左の一覧の列 (Diff の変更ファイル・History のコミット・選んでいる作業
// ツリー) の幅の決まり (ui-layout.md の「一覧の列と右の列」)。DOM に触らない。
// 配線は app.ts の syncListColumn。
//
// History と選んでいる作業ツリーは、一覧の右に変更ファイルの木 (#sidebar) の
// 列も並ぶ。一覧と木はどちらも面の外 (2 面でも本文全体の左)。本文 (1 面なら
// 1 面、2 面なら 2 面と仕切り) が足りないときは、まず一覧を詰めた幅
// (HISTORY_WIDTH.min の 240。題と札だけが読める幅) にし、次に木を帯に畳む
// (開くボタンを残す。利用者が開いたらそのセッションは畳まない)。それでも
// 足りなければ、2 面なら右の面を預け (main-tabs-view の fitToWidth)、1 面なら
// そのまま出す。左のサイドバー (プロジェクトとエージェント) は畳まない。

import type { PanelSize } from "./panel-sizes";

export type ListColumnInput = {
  /**
   * 一覧の列・木・本文が使える幅 (左のサイドバーの右から、右の列の左まで)。
   * 一覧の列の今の幅に関わらない。
   */
  room: number;
  /** 一覧の利用者の幅。一覧を隠しているなら 0。 */
  preferred: number;
  /** 一覧の詰めた幅。 */
  compact: number;
  /** 変更ファイルの木の幅。木の無い画面 (Diff) は 0。 */
  tree: number;
  /** 木を畳んだ帯の幅。 */
  treeRail: number;
  /** 利用者が畳んだ木を開いた (このセッションは畳まない)。 */
  treeKeptOpen: boolean;
  /** 本文に要る幅 (1 面なら 1 面分、2 面なら 2 面と仕切り)。 */
  need: number;
};

export type ListColumnLayout = {
  /** 一覧の幅。 */
  width: number;
  /** 一覧を詰めた。 */
  compact: boolean;
  /** 木の幅 (畳んだら帯の幅)。 */
  tree: number;
  /** 木を畳んだ。 */
  treeFolded: boolean;
};

export function listColumnLayout(input: ListColumnInput): ListColumnLayout {
  const { room, preferred, tree, treeRail, need } = input;
  const narrow = Math.min(preferred, input.compact);
  const fits = (list: number, treeWidth: number) =>
    room - list - treeWidth >= need;
  if (fits(preferred, tree))
    return { width: preferred, compact: false, tree, treeFolded: false };
  const compact = narrow !== preferred;
  if (fits(narrow, tree) || tree === 0 || input.treeKeptOpen)
    return { width: narrow, compact, tree, treeFolded: false };
  return { width: narrow, compact, tree: treeRail, treeFolded: true };
}

export type ListColumnDrag = {
  /** 掴み始めの幅 (見えている一覧の幅)。 */
  start: number;
  /** 掴んで広げられる上限。 */
  max: number;
};

/**
 * 一覧の列の掴み (#history-resizer) の開始幅と上限。開始は見えている一覧の
 * 幅 (隣の変更ファイルの木を含めない。含めると掴んだ瞬間に木の幅だけ広がり、
 * 狭めても上限で止まった)。上限は、本文が要る幅を保てる一覧の幅まで (それを
 * 超えて離すと詰めた幅へ跳ぶので、そこで止める)。下限・上限は size の範囲。
 */
export function listColumnDrag(input: {
  /** 見えている一覧の幅 (出していなければ 0)。 */
  shown: number;
  /** 利用者の幅。 */
  preferred: number;
  /** listColumnLayout と同じ room / tree / need から出す、入る一覧の幅。 */
  fits: number;
  size: PanelSize;
}): ListColumnDrag {
  const { shown, preferred, fits, size } = input;
  return {
    start: shown > 0 ? shown : preferred,
    max: Math.min(size.max, Math.max(size.min, fits)),
  };
}

/**
 * 保存した一覧の列の幅 (設定の historyWidth) を読み戻す。範囲 (HISTORY_WIDTH の
 * 下限〜上限) の中ならそのまま、外や数でないものは既定。端へ寄せない: 範囲の
 * 外の値は、この列が別の意味 (右の列の一覧) だった頃や壊れた設定から来るので、
 * 端に寄せた幅は利用者が選んだ幅ではない。
 */
export function restoredListWidth(value: unknown, size: PanelSize): number {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= size.min &&
    value <= size.max
    ? Math.round(value)
    : size.default;
}
