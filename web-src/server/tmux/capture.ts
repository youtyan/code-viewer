// 選択中のペインの「今の画面」を 1 フレームぶん取る。
//
// tmux に attach せず capture-pane だけを使う。attach するとそのクライアント
// のサイズがセッションに効いてしまい、既に開いている本物の tmux クライアント
// のペインが縮む。閲覧のためにユーザーの作業環境を変えてはいけない。
//
// capture-pane -e は tmux が解釈し終えた確定済みの画面を ANSI 付きで返す。
// アプリの生バイトを途中から拾う方式と違って、購読を始めた時点の画面が必ず
// 正しく組み上がる。

import { randomBytes } from "node:crypto";
import type { TmuxPaneId, TmuxScreen } from "../../core/tmux";
import { runTmux, TMUX_FIELD_SEP } from "./command";

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
  /** 呼び出し側に全体期限がある場合は、残り時間を tmux 子プロセスへ渡す。 */
  timeoutMs?: number,
): Promise<TmuxCaptureResult> {
  const [result] = await captureTmuxPanes(
    [paneId],
    cwd,
    historyLines,
    timeoutMs,
  );
  if (!result) throw new Error(`tmux capture of ${paneId} returned no result`);
  return result;
}

/**
 * 複数のペインの画面を、tmux を 1 回だけ起こして取る。結果は paneIds と同じ順。
 *
 * ペインごとに tmux を起こすと、子プロセスの起動の間 (macOS で 1 本数 ms、
 * 混むと 100ms を超える) 入口のサーバの手が塞がる。巡回は 1.5 秒ごとに 20 本
 * 以上を起こしていて、その間ずっと打鍵とシェルの出力が待たされていた。
 */
export async function captureTmuxPanes(
  paneIds: readonly TmuxPaneId[],
  cwd: string,
  historyLines = 0,
  timeoutMs?: number,
): Promise<TmuxCaptureResult[]> {
  if (paneIds.length === 0) return [];
  const history = Math.min(
    Math.max(Math.trunc(historyLines) || 0, 0),
    MAX_TMUX_HISTORY_LINES,
  );
  // ペインごとの区切りの行。画面には 0x1F が出ない (tmux の升目は制御文字を
  // 持たず、-e が足すのは ESC の並びだけ)。毎回変わる綴りも挟んで取り違えない。
  const marker = `${TMUX_FIELD_SEP}${randomBytes(6).toString("hex")}${TMUX_FIELD_SEP}`;
  // サイズと画面を同じ呼び出しで取る。別々に呼ぶと、その間にリサイズされた
  // ときサイズと中身が食い違う。
  const args = paneIds.flatMap((paneId, index) => [
    ...(index > 0 ? [";"] : []),
    "display-message",
    "-p",
    "-t",
    paneId,
    "-F",
    `${marker}#{pane_id} ${META_FORMAT}`,
    ";",
    "capture-pane",
    "-e",
    "-p",
    "-t",
    paneId,
    ...(history > 0 ? ["-S", `-${history}`] : []),
  ]);
  const startedAt = Date.now();
  const result = await runTmux(args, cwd, timeoutMs);

  if (result.status === "missing" || result.status === "no-server") {
    return paneIds.map(() => ({ status: "gone" }));
  }
  if (result.status === "error") return paneIds.map(() => result);
  if (result.status === "no-target") {
    if (paneIds.length === 1) return [{ status: "gone" }];
    // 1 本が閉じていると、tmux はそこで残りのコマンドを捨てる。1 本ずつ取り直す
    // (ペインが閉じた直後の巡回だけ)。
    const results: TmuxCaptureResult[] = [];
    for (const paneId of paneIds) {
      const remaining =
        timeoutMs === undefined
          ? undefined
          : Math.max(1, timeoutMs - (Date.now() - startedAt));
      results.push(await captureTmuxPane(paneId, cwd, history, remaining));
    }
    return results;
  }

  const blocks = result.stdout.split(marker);
  if (blocks.length !== paneIds.length + 1 || blocks[0] !== "") {
    const error = new Error(
      `tmux capture returned ${blocks.length - 1} screens for ${paneIds.length} panes (${paneIds.join(" ")})`,
    );
    return paneIds.map(() => ({ status: "error", error }));
  }
  return paneIds.map((paneId, index) =>
    parseCapture(paneId, blocks[index + 1], history),
  );
}

/** 区切りの後ろの 1 本ぶん (`<pane_id> <META_FORMAT>` の行と画面) を読む。 */
function parseCapture(
  paneId: TmuxPaneId,
  block: string,
  history: number,
): TmuxCaptureResult {
  const newline = block.indexOf("\n");
  if (newline < 0) {
    return {
      status: "error",
      error: new Error(`tmux capture returned no screen for ${paneId}`),
    };
  }
  const [shown, ...meta] = block.slice(0, newline).split(" ");
  if (shown !== paneId) {
    return {
      status: "error",
      error: new Error(
        `tmux capture of ${paneId} returned the screen of ${shown || "no pane"}`,
      ),
    };
  }
  const toInt = (value: string | undefined) =>
    Number.parseInt(value ?? "", 10) || 0;
  return {
    status: "ok",
    screen: {
      pane: paneId,
      content: closeLineColors(block.slice(newline + 1)),
      width: toInt(meta[0]),
      height: toInt(meta[1]),
      cursorX: toInt(meta[2]),
      cursorY: toInt(meta[3]),
      // 頼んだ行数と、実際に在る履歴の短いほう。
      historyLines: Math.min(history, toInt(meta[4])),
    },
  };
}
