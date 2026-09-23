// アプリの端末の中で、tmux のウインドウの外側 (tmux が点で埋める所) を覆う
// 範囲を決める。DOM を触らない (terminal-screen.ts が描く)。
//
// tmux のウインドウは 1 つの大きさしか持てないので、同じセッションを大きさの
// 違う端末でも開き、`window-size smallest` などで小さい方に合わせていると、
// アプリの端末の中でウインドウの右と下が余り、tmux がそこを点で埋める。
// 利用者の tmux の設定・状態は変えない (以前 `window-size manual` が残った
// 事故がある)。アプリの側でその余りを覆い、理由を 1 行出すだけにする。
//
// 端末の中の並び (上から):
//   ステータスが上: [ステータス statusLines 行][ウインドウの行 …][余りの行]
//   ステータスが下: [ウインドウの行 …][余りの行][ステータス statusLines 行]
// 桁は、ウインドウの桁の右が余り。ペインの境界線はウインドウの中に引かれる
// ので、ここでは考えない。ウインドウが端末より大きい (見える範囲だけ映して
// いる) ときは余りが無い。

import type { TmuxClientWindow } from "../../core/tmux";

/** 覆う矩形。単位は端末の行と桁、起点は左上 (0, 0)。 */
export type TmuxCoverRect = {
  top: number;
  left: number;
  rows: number;
  cols: number;
};

export type TmuxCover = {
  rects: TmuxCoverRect[];
  /** 案内の 1 行を置く矩形 (rects の添字)。広い方。覆う所が無ければ -1。 */
  messageIn: number;
};

export function tmuxCover(window: TmuxClientWindow): TmuxCover {
  const status = Math.min(window.statusLines, window.clientRows);
  const available = window.clientRows - status;
  const top = window.statusAt === "top" ? status : 0;
  const shownRows = Math.min(window.windowRows, available);
  const rects: TmuxCoverRect[] = [];
  if (window.windowCols < window.clientCols && shownRows > 0) {
    rects.push({
      top,
      left: window.windowCols,
      rows: shownRows,
      cols: window.clientCols - window.windowCols,
    });
  }
  if (window.windowRows < available) {
    rects.push({
      top: top + window.windowRows,
      left: 0,
      rows: available - window.windowRows,
      cols: window.clientCols,
    });
  }
  let messageIn = -1;
  rects.forEach((rect, index) => {
    const best = rects[messageIn];
    if (!best || rect.rows * rect.cols > best.rows * best.cols)
      messageIn = index;
  });
  return { rects, messageIn };
}
