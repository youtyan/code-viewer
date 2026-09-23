// 一覧の列 (左のサイドバーの右、本文の左) の幅の決まり (ui-layout.md の
// 「一覧の列」)。DOM に触らない。配線は app.ts の syncListColumn。
//
// 並びは左から、ファイル一覧 (どの画面でも出す)、一覧 (Diff の変更ファイルの
// 一覧・History のコミット・選んでいる作業ツリー)、変更ファイルの一覧
// (History・選んでいる作業ツリーだけ。一覧の右)。どれも面の外 (2 面でも本文
// 全体の左)。本文 (1 面なら 1 面、2 面なら 2 面と仕切り) が足りないときは、
// (1) 一覧を詰めた幅 (HISTORY_WIDTH.min の 240。題と札だけが読める幅) にし、
// (2) 変更ファイルの一覧を帯に畳み、(3) ファイル一覧を畳む (最後まで残す)。
// それでも足りなければ、2 面なら右の面を預け (main-tabs-view の fitToWidth)、
// 1 面ならそのまま出す。利用者が手で開いた列は、そのセッションは自動で畳まない。
// 左のサイドバー (プロジェクトとエージェント) は畳まない。

import type { PanelSize } from "./panel-sizes";

export type ListColumnInput = {
  /**
   * 一覧の列と本文が使える幅 (左のサイドバーの右から窓の右端まで)。一覧の列の
   * 今の幅に関わらない。
   */
  room: number;
  /** ファイル一覧の幅。利用者が畳んでいるなら 0。 */
  files: number;
  /**
   * 畳んだファイル一覧が残す縦の帯 (頭の 2 段目の画面の入口の絵柄と開くボタンを
   * 縦に並べたもの) の幅。畳んでも本文はこの帯の右から。
   */
  filesRail: number;
  /** 利用者が手でファイル一覧を開いた (このセッションは自動で畳まない)。 */
  filesKeptOpen: boolean;
  /** 一覧の利用者の幅。一覧の無い画面・利用者が一覧を畳んだなら 0。 */
  preferred: number;
  /** 一覧の詰めた幅。 */
  compact: number;
  /**
   * 変更ファイルの一覧 (一覧の右) の幅。それを持たない画面 (Diff は一覧そのもの
   * が変更ファイルの一覧) と、利用者が畳んだなら 0。
   */
  tree: number;
  /** 畳んだ列の帯の幅。 */
  treeRail: number;
  /** 利用者が畳んだ変更ファイルの一覧を開いた (このセッションは畳まない)。 */
  treeKeptOpen: boolean;
  /** 本文に要る幅 (1 面なら 1 面分、2 面なら 2 面と仕切り)。 */
  need: number;
};

export type ListColumnLayout = {
  /** 一覧の幅。 */
  width: number;
  /** 一覧を詰めた。 */
  compact: boolean;
  /** 変更ファイルの一覧の幅 (畳んだら帯の幅)。 */
  tree: number;
  /** 変更ファイルの一覧を畳んだ。 */
  treeFolded: boolean;
  /** ファイル一覧を自動で畳んだ (幅は帯の幅 filesRail。帯の開くボタンで開く)。 */
  filesFolded: boolean;
};

export function listColumnLayout(input: ListColumnInput): ListColumnLayout {
  const { room, preferred, tree, treeRail, need } = input;
  // 利用者が畳んだファイル一覧も帯の幅は取る。
  const files = input.files === 0 ? input.filesRail : input.files;
  const narrow = Math.min(preferred, input.compact);
  const compact = narrow !== preferred;
  const fits = (fileList: number, list: number, treeWidth: number) =>
    room - fileList - list - treeWidth >= need;
  if (fits(files, preferred, tree))
    return {
      width: preferred,
      compact: false,
      tree,
      treeFolded: false,
      filesFolded: false,
    };
  // (1) 一覧を詰める。
  if (fits(files, narrow, tree))
    return {
      width: narrow,
      compact,
      tree,
      treeFolded: false,
      filesFolded: false,
    };
  // (2) 変更ファイルの一覧を帯に畳む。
  const treeFolded = tree !== 0 && !input.treeKeptOpen;
  const treeWidth = treeFolded ? treeRail : tree;
  if (fits(files, narrow, treeWidth))
    return {
      width: narrow,
      compact,
      tree: treeWidth,
      treeFolded,
      filesFolded: false,
    };
  // (3) ファイル一覧を畳む。
  return {
    width: narrow,
    compact,
    tree: treeWidth,
    treeFolded,
    filesFolded: input.files !== 0 && !input.filesKeptOpen,
  };
}

export type ListColumnDrag = {
  /** 掴み始めの幅 (見えている一覧の幅)。 */
  start: number;
  /** 掴んで広げられる上限。 */
  max: number;
};

/**
 * 一覧の列の掴み (#history-resizer) の開始幅と上限。開始は見えている一覧の
 * 幅 (隣の変更ファイルの一覧を含めない。含めると掴んだ瞬間にその幅だけ広がり、
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
 * 外の値は、この列が別の意味 (画面の右端の列の一覧) だった頃や壊れた設定から来るので、
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

/**
 * 一覧を出す画面 (Diff は変更ファイルの一覧 #sidebar そのもの、History と作業
 * ツリーは専用の一覧で、変更ファイルの一覧はその右)。
 */
export type ListColumnKind = "sidebar" | "history" | "worktree";

export type ListColumnKindInput = {
  /** body の画面の印 (core/page-mode.ts の pageModeClasses)。 */
  has(pageClass: string): boolean;
  /** 作業ツリーの一覧だけの表示 (body[data-worktree-overview])。一覧が本文。 */
  worktreeOverview: boolean;
  /**
   * 左の面の前面が画面 (route) のタブか、何も選んでいない。端末・画像のタブが
   * 前面なら false: 本文はその面の箱が覆い、一覧は出さない (その画面の印は
   * 背面のタブのまま残っている)。
   */
  leftFrontIsPage: boolean;
};

/**
 * 一覧の列に出す一覧 (body[data-list-column] の値)。列は前面のタブの画面で
 * 決める: Diff と、Diff から開いたファイルの詳細 (差分の 1 ファイル) は変更
 * ファイルの一覧、History はコミット、選んでいる作業ツリーは作業ツリーの一覧。
 * どれでもない画面と、前面が端末・画像のタブは null (ファイル一覧だけ)。
 */
export function listColumnKindFor(
  input: ListColumnKindInput,
): ListColumnKind | null {
  if (!input.leftFrontIsPage) return null;
  if (input.has("gdp-diff-page")) return "sidebar";
  if (input.has("gdp-history-page")) return "history";
  if (input.has("gdp-worktree-page") && !input.worktreeOverview)
    return "worktree";
  if (input.has("gdp-file-detail-page") && !input.has("gdp-repo-blob-page"))
    return "sidebar";
  return null;
}
