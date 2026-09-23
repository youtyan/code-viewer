// ファイル一覧を自動で畳むか・開くかの決まりと、一覧の列が本文の横に取る幅
// (ui-layout.md の「一覧の列」)。DOM に触らない。配線は app.ts の
// syncListColumn。
//
// 畳むのは一覧の列の頭の下のファイル一覧だけ。頭 (#panel-head: 画面の入口の
// 絵柄と畳むボタン) はタブ列の行の左端に同じ幅で残る (絵柄・畳むボタン・タブ列
// の左端の名前の枠・分割のボタンを動かさない)。
//
// - 幅が足りない (core/list-column.ts の listColumnLayout が filesFolded) なら
//   畳み、足りるようになったら、自動で畳んでいたものだけ開く
// - 利用者が自分で畳んだなら、その意思を優先して触らない (手で開いた後は
//   listColumnLayout がそのセッションは畳まない)

export type FileListState = {
  /** 幅が足りないので畳む (listColumnLayout の filesFolded)。 */
  folded: boolean;
  /** いま自動で畳んでいる。 */
  autoHidden: boolean;
  /** 利用者が自分で畳んでいる (自動で畳んだものは含めない)。 */
  userHidden: boolean;
};

export type FileListAction = "collapse" | "restore" | "keep";

export function fileListAction(state: FileListState): FileListAction {
  if (state.userHidden) return "keep";
  if (state.folded) return state.autoHidden ? "keep" : "collapse";
  return state.autoHidden ? "restore" : "keep";
}

/**
 * 起動の途中で、index.html の早いスクリプトが付けたファイル一覧の畳み
 * (body.gdp-sidebar-hidden) を引き継ぐ。外さない (外した状態が描かれ、設定を
 * 読んでまた畳むと本文がファイル一覧の幅だけ動いた)。控えが利用者の畳みなら
 * 利用者の畳みとして (設定を読むと当て直す)、そうでなければ幅による自動の
 * 畳みとして (syncListColumn が幅で決め直す) 引き継ぐ。控えが読めなければ
 * 自動の畳み。
 */
export function bootFileListFold(input: {
  /** 早いスクリプトが畳んで描いた。 */
  bodyHidden: boolean;
  /** 控えの「利用者がファイル一覧を畳んでいる」(読めなければ null)。 */
  earlyUserHidden: boolean | null;
}): { userHidden: boolean; autoHidden: boolean } {
  if (!input.bodyHidden) return { userHidden: false, autoHidden: false };
  const user = input.earlyUserHidden === true;
  return { userHidden: user, autoHidden: !user };
}

export type ListColumnBodyInput = {
  /**
   * 一覧の列を本文の横に置かず、重ねて出す面にしている (電話の幅)。本文の幅は
   * これまでどおり頭の実幅を引く (電話では 2 面を出さない)。
   */
  overlaid: boolean;
  /** 一覧の列が出している幅 (ファイル一覧・一覧・変更ファイルの一覧の和)。 */
  shown: number;
  /** 一覧の列の頭 (#panel-head) の実幅。 */
  headWidth: number;
};

/**
 * 一覧の列が本文の横に取っている幅 (本文の幅 = 窓 − 左のサイドバー − これ)。
 * 頭の行はタブ列の行にあり、その下の本文の幅には数えない。
 */
export function listColumnBodyWidth(input: ListColumnBodyInput): number {
  return input.overlaid ? input.headWidth : input.shown;
}
