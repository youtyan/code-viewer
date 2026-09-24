// 端末をどの描画で描くか。
//
// xterm の既定は DOM の描画で、枠の線 (─│┼) もフォントの字のまま並べる。字の
// 高さが行の高さに足りないフォントや、全角の字を別のフォントから拾った行では、
// 線が行ごとに途切れて上下にずれ、tmux のペインの境目が波打って見える。WebGL の
// 描画は枠の線とブロックの字を升目いっぱいに自前で描く (customGlyphs) ので、
// 行をまたいでつながる。
//
// WebGL が使えない (WebGL2 が無い・context を作れない) ときと、使っている途中で
// context を失ったときは DOM の描画に戻す。黙って戻さず、理由を console に出す
// (同じ理由はページで 1 回)。

import type {
  XtermApi,
  XtermTerminal,
  XtermWebglAddon,
} from "../../core/xterm-loader";

/** 端末が今どの描画で描いているか。 */
export type TerminalRenderer = "webgl" | "dom";

/** DOM に戻った理由のうち、もう console に出したもの。 */
const reportedFallbacks = new Set<string>();

function reportFallback(reason: string, error?: unknown): void {
  if (reportedFallbacks.has(reason)) return;
  reportedFallbacks.add(reason);
  if (error === undefined) {
    console.warn(`[code-viewer] terminal: ${reason}; drawing with the DOM`);
  } else {
    console.warn(
      `[code-viewer] terminal: ${reason}; drawing with the DOM`,
      error,
    );
  }
}

/**
 * 開いた端末を WebGL の描画に切り替える。切り替えられなければ DOM のまま。
 *
 * @param onFallback DOM に戻ったとき (context を失ったときは後から) 呼ぶ
 * @returns 切り替えた直後の描画
 */
export function useWebglRenderer(
  term: XtermTerminal,
  api: Pick<XtermApi, "WebglAddon">,
  onFallback?: () => void,
): TerminalRenderer {
  let addon: XtermWebglAddon;
  try {
    addon = new api.WebglAddon();
    term.loadAddon(addon);
  } catch (error) {
    reportFallback("WebGL renderer is unavailable", error);
    onFallback?.();
    return "dom";
  }
  const lost = addon.onContextLoss(() => {
    lost.dispose();
    // 外すと xterm は DOM の描画に戻る。
    addon.dispose();
    reportFallback("WebGL context was lost");
    onFallback?.();
  });
  return "webgl";
}
