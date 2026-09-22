// 2 面のときに右の列 (ファイルの木・一覧) を自動で畳むか・開くかの決まり
// (ui-layout.md の「2 面と右の列」)。DOM に触らない。配線は app.ts の
// syncPanelColumn。
//
// - 2 面で、本文が面 2 つ分のゆとりに足りないなら畳む (Data の欄などが潰れる)
// - ただし一覧が右の列にある画面 (History・選んでいる作業ツリー) を出している
//   間は畳まない (自動で畳んでいたら開く)。一覧が無い History は使えないが、
//   2 面が無い History は使える。本文が 2 面の下限に足りなければ、右の面は
//   main-tabs-view が預ける (parkRight)
// - 1 面に戻ったら、自動で畳んでいたものは開く
// - 利用者が自分で畳んだ / 2 面の間に自分で開いたなら、その意思を優先する

export type PanelColumnState = {
  /** 2 面を出している (右の面を預けている間は false)。 */
  split: boolean;
  /** 一覧が右の列にある画面を出している。 */
  holdsList: boolean;
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
  if (state.split && !state.holdsList) {
    if (state.autoHidden || state.userHidden || state.userOptedOut)
      return "keep";
    return state.fitsWithColumn ? "keep" : "collapse";
  }
  return state.autoHidden ? "restore" : "keep";
}
