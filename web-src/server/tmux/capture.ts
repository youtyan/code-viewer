// 選択中のペインの「今の画面」を 1 フレームぶん取る。
//
// tmux に attach せず capture-pane だけを使う。attach するとそのクライアント
// のサイズがセッションに効いてしまい、既に開いている本物の tmux クライアント
// のペインが縮む。閲覧のためにユーザーの作業環境を変えてはいけない。
//
// capture-pane -e は tmux が解釈し終えた確定済みの画面を ANSI 付きで返す。
// アプリの生バイトを途中から拾う方式と違って、購読を始めた時点の画面が必ず
// 正しく組み上がる。

import type { TmuxPaneId, TmuxScreen } from "../../core/tmux";
import { runTmux } from "./command";

/**
 * 画面と一緒に取るメタ情報。桁数・行数は xterm 側を合わせるため、カーソル
 * 位置は描画後にカーソルを戻すために要る。空白区切りで並べる (どれも数値)。
 *
 * history_size は「実際に何行ぶん遡れたか」を出すために要る。遡りを頼んでも
 * 履歴がそれより短ければ短いぶんしか返らず、返ってきた本文だけでは前置きが
 * 何行なのか分からない (行末の空行は tmux 側で落とされるので、数えても
 * ずれる)。カーソル行を置く位置がこれで決まる。
 */
const META_FORMAT =
  "#{pane_width} #{pane_height} #{cursor_x} #{cursor_y} #{history_size}";

export type TmuxCaptureResult =
  | { status: "ok"; screen: TmuxScreen }
  /** ペインが閉じられた / tmux が居ない。どちらも購読を終える合図。 */
  | { status: "gone" }
  | { status: "error"; error: Error };

/**
 * 何行ぶんの履歴まで遡れるか。ドロワーの表示では使わず、他のエージェントへ
 * 本文を渡すときだけ遡る。青天井にすると 1 回の応答が巨大になる。
 */
export const MAX_TMUX_HISTORY_LINES = 5000;

/** 色と装飾を既定に戻す SGR。 */
const SGR_RESET = `${String.fromCharCode(27)}[0m`;

/**
 * 行の終わりで色を閉じる。
 *
 * capture-pane -e は行ごとに色を閉じない。背景色が付いたまま終わる行がある
 * と、その色が次の行以降へそのまま引き継がれ、画面の残りが丸ごと塗り潰される
 * (ステータスラインの色で画面全体が青くなる、など)。tmux の画面では行が独立
 * しているので、行の切れ目で必ず既定へ戻す。
 *
 * 空行には付けない。前の行がここで閉じているので、足しても変わらない。
 */
export function closeLineColors(content: string): string {
  if (!content) return content;
  return content
    .split("\n")
    .map((line) => (line ? `${line}${SGR_RESET}` : line))
    .join("\n");
}

export async function captureTmuxPane(
  paneId: TmuxPaneId,
  cwd: string,
  /**
   * 今の画面より前を何行ぶん含めるか。0 (既定) なら今の画面だけ。ドロワーの
   * 購読はスクロールバックを持たないので既定のまま使う。
   */
  historyLines = 0,
): Promise<TmuxCaptureResult> {
  const history = Math.min(
    Math.max(Math.trunc(historyLines) || 0, 0),
    MAX_TMUX_HISTORY_LINES,
  );
  // サイズと画面を 1 プロセスで取る。別々に呼ぶと、その間にリサイズされた
  // ときサイズと中身が食い違う。
  const result = await runTmux(
    [
      "display-message",
      "-p",
      "-t",
      paneId,
      "-F",
      META_FORMAT,
      ";",
      "capture-pane",
      "-e",
      "-p",
      "-t",
      paneId,
      ...(history > 0 ? ["-S", `-${history}`] : []),
    ],
    cwd,
  );

  if (result.status === "missing" || result.status === "no-server") {
    return { status: "gone" };
  }
  if (result.status === "no-target") return { status: "gone" };
  if (result.status === "error") {
    return result;
  }

  const newline = result.stdout.indexOf("\n");
  if (newline < 0) {
    return {
      status: "error",
      error: new Error("tmux capture returned no screen"),
    };
  }
  const meta = result.stdout.slice(0, newline).split(" ");
  const toInt = (value: string | undefined) =>
    Number.parseInt(value ?? "", 10) || 0;
  return {
    status: "ok",
    screen: {
      pane: paneId,
      content: closeLineColors(result.stdout.slice(newline + 1)),
      width: toInt(meta[0]),
      height: toInt(meta[1]),
      cursorX: toInt(meta[2]),
      cursorY: toInt(meta[3]),
      // 頼んだ行数と、実際に在る履歴の短いほう。
      historyLines: Math.min(history, toInt(meta[4])),
    },
  };
}
