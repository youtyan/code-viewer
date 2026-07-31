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
 */
const META_FORMAT = "#{pane_width} #{pane_height} #{cursor_x} #{cursor_y}";

export type TmuxCaptureResult =
  | { status: "ok"; screen: TmuxScreen }
  /** ペインが閉じられた / tmux が居ない。どちらも購読を終える合図。 */
  | { status: "gone" }
  | { status: "error"; message: string };

export async function captureTmuxPane(
  paneId: TmuxPaneId,
  cwd: string,
): Promise<TmuxCaptureResult> {
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
    ],
    cwd,
  );

  if (result.status === "missing" || result.status === "no-server") {
    return { status: "gone" };
  }
  if (result.status === "no-target") return { status: "gone" };
  if (result.status === "error") {
    return { status: "error", message: result.message };
  }

  const newline = result.stdout.indexOf("\n");
  if (newline < 0) {
    return { status: "error", message: "tmux capture returned no screen" };
  }
  const meta = result.stdout.slice(0, newline).split(" ");
  const toInt = (value: string | undefined) =>
    Number.parseInt(value ?? "", 10) || 0;
  return {
    status: "ok",
    screen: {
      pane: paneId,
      content: result.stdout.slice(newline + 1),
      width: toInt(meta[0]),
      height: toInt(meta[1]),
      cursorX: toInt(meta[2]),
      cursorY: toInt(meta[3]),
    },
  };
}
