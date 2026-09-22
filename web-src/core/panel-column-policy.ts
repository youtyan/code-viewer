// 右の列 (Files の木) を自動で畳むか・開くかの決まり (ui-layout.md の
// 「一覧の列と右の列」)。DOM に触らない。配線は app.ts の syncPanelColumn。
//
// - 本文を選ぶための一覧 (Diff の変更ファイル・History のコミット・選んでいる
//   作業ツリー) は本文の左の列に出す。その画面の間、右の列は帯へ畳む (木は
//   探して開くためのもので、一覧を見ている間は要らない)。別の画面へ移れば、
//   自動で畳んでいたものは開く
// - 2 面で、本文が面 2 つ分のゆとりに足りないなら畳む (Data の欄などが潰れる)
// - 1 面に戻ったら、自動で畳んでいたものは開く
// - 利用者が自分で畳んだ / 2 面の間に自分で開いたなら、その意思を優先する

export type PanelColumnState = {
  /** 2 面を出している (右の面を預けている間は false)。 */
  split: boolean;
  /** 一覧が左の列にある画面 (Diff・History・選んでいる作業ツリー) を出している。 */
  holdsList: boolean;
  /**
   * 一覧の画面から出たところ。一覧のために畳んでいたなら一度開き、2 面の決まりは
   * 開いた幅で判断し直す (畳んだままの幅では「ゆとりがある」と出てしまう)。
   */
  leftList: boolean;
  /** いま自動で畳んでいる。 */
  autoHidden: boolean;
  /** 利用者が自分で畳んでいる (自動で畳んだものは含めない)。 */
  userHidden: boolean;
  /** 2 面の間に利用者が自分で開いた (このセッションでは自動で畳まない)。 */
  userOptedOut: boolean;
  /** 右の列を開いたままで、2 面がゆとりを持って並ぶ。 */
  fitsWithColumn: boolean;
};

export type PanelColumnAction = "collapse" | "restore" | "keep";

export function panelColumnAction(state: PanelColumnState): PanelColumnAction {
  if (state.holdsList)
    return state.autoHidden || state.userHidden ? "keep" : "collapse";
  if (state.leftList && state.autoHidden) return "restore";
  if (state.split) {
    if (state.autoHidden || state.userHidden || state.userOptedOut)
      return "keep";
    return state.fitsWithColumn ? "keep" : "collapse";
  }
  return state.autoHidden ? "restore" : "keep";
}
