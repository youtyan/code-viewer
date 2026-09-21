// ファイルのツリーの字下げ (--lvl-pad)。ファイルのツリーと作業ツリー画面の
// 変更ファイルの一覧が同じ値を使う。
//
// base は行の面の端から最初の山形の列までの余白 (山形の絵は列の中で 4px
// 内側にあるので、絵の左端が文字の線 = 面の線 + 8 に乗る)、
// step は 1 段の字下げ。左のサイドバー・目次と同じ段 (--indent-step) にそろえる。
// 字下げの線 (style.css の Indent guides) はこの 2 つから位置を決めているので、
// 変えるときは一緒に直す。

export const TREE_INDENT = { base: 4, step: 16 } as const;

export function treeLevelPad(depth: number): string {
  return `${TREE_INDENT.base + depth * TREE_INDENT.step}px`;
}
