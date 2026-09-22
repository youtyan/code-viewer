// 本文の左の一覧の列 (Diff の変更ファイル・History のコミット・選んでいる作業
// ツリー) の幅の決まり (ui-layout.md の「一覧の列と右の列」)。DOM に触らない。
// 配線は app.ts の syncListColumn。
//
// 一覧の列は 2 段の幅を持つ: 利用者の幅 (保存。既定 320) と、詰めた幅
// (HISTORY_WIDTH.min の 240。題と札だけが読める幅)。本文が足りないときは
// 詰めた幅にする。それでも足りなければ、2 面なら右の面を預け (main-tabs-view
// の fitToWidth)、1 面ならそのまま出す。左のサイドバー (プロジェクトと
// エージェント) は畳まない。

export type ListColumnInput = {
  /**
   * 一覧の列と本文が使える幅 (左のサイドバーの右から、右の列の左まで)。
   * 一覧の列の今の幅に関わらない。
   */
  room: number;
  /** 利用者の幅。 */
  preferred: number;
  /** 詰めた幅。 */
  compact: number;
  /**
   * 本文の中で一覧の列の隣に居座るもの (History・作業ツリーの変更ファイルの
   * 木) の幅。無ければ 0。
   */
  inset: number;
  /** 本文に要る幅 (1 面なら 1 面分、2 面なら 2 面と仕切り)。 */
  need: number;
};

export type ListColumnWidth = { width: number; compact: boolean };

export function listColumnWidth(input: ListColumnInput): ListColumnWidth {
  const { room, preferred, compact, inset, need } = input;
  const narrow = Math.min(preferred, compact);
  if (room - preferred - inset >= need || narrow === preferred)
    return { width: preferred, compact: false };
  return { width: narrow, compact: true };
}
