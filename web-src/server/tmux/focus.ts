// 「このペインを見せる」ための tmux 操作。
//
// ブラウザのターミナルは PTY のシェルなので、tmux は他の端末と同じように
// その中で動く。だからここがやるのは 2 つだけで、どちらも tmux の普通の
// 使い方をなぞる。
//
// - 既にそのシェルの中で tmux が動いているなら、そのクライアントを目的の
//   ペインへ動かす (switch-client)。端末を増やさずに済む。
// - まだ動いていないなら、そのペインが最初に見えるようセッションのカレントを
//   合わせておく (select-window / select-pane)。この後シェルへ attach の 1 行を
//   流し込めば、繋いだ瞬間にそのペインが出る。
//
// switch-client には必ず -c で宛先の端末を渡す。省くと tmux は「最後に
// 使われたクライアント」を動かすので、ユーザーが別の端末で作業している
// 画面を勝手に切り替えてしまう。

import type { TmuxPaneId } from "../../core/tmux";
import { commandForExternal } from "../command-resolver";
import { runTmux, type TmuxRunResult } from "./command";

export type TmuxFocusResult =
  | { status: "ok" }
  /** ペインが閉じられた / 宛先の tmux が終了した / tmux が居ない。 */
  | { status: "gone" }
  | { status: "error"; error: Error };

export type TmuxPaneSessionResult =
  | { status: "ok"; session: string }
  | { status: "gone" }
  | { status: "error"; error: Error };

function toResult(result: TmuxRunResult): TmuxFocusResult {
  if (result.status === "ok") return { status: "ok" };
  if (
    result.status === "no-target" ||
    result.status === "missing" ||
    result.status === "no-server"
  ) {
    return { status: "gone" };
  }
  return { status: "error", error: result.error };
}

/**
 * その端末で動いている tmux クライアントを、目的のペインへ動かす。
 *
 * ペイン ID を渡せば tmux がセッション・ウィンドウ・ペインまで解決するので、
 * 別セッションのペインへも 1 回で飛べる。
 */
export async function focusTmuxPane(
  paneId: TmuxPaneId,
  tty: string,
  cwd: string,
): Promise<TmuxFocusResult> {
  // 宛先が無いまま呼ぶと関係のない端末が動く。呼び出し側の取りこぼしを
  // ここでも止める。
  if (!tty) return { status: "gone" };
  return toResult(
    await runTmux(["switch-client", "-c", tty, "-t", paneId], cwd),
  );
}

/**
 * そのペインが属するセッション名を引く。見つからなければ null。
 *
 * 「このペインを既に開いているシェルがあるか」はセッション単位で決まるので、
 * ペイン ID からセッションへ辿る必要がある。一覧を丸ごと引いて探すより、
 * tmux に 1 回聞くほうが軽い。
 */
export async function resolvePaneSession(
  paneId: TmuxPaneId,
  cwd: string,
): Promise<TmuxPaneSessionResult> {
  const result = await runTmux(
    ["display-message", "-p", "-t", paneId, "-F", "#{session_name}"],
    cwd,
  );
  if (result.status === "error") return result;
  if (result.status !== "ok") return { status: "gone" };
  const session = result.stdout.trim();
  return session ? { status: "ok", session } : { status: "gone" };
}

/**
 * そのペインをセッションのカレントにする。
 *
 * カレントウィンドウとアクティブペインはセッションが持つ。だから attach 前に
 * 呼べば繋いだ瞬間の画面がそのペインになり、既に繋がっている端末に対して
 * 呼べばその場で表示が切り替わる。どちらの用途でも同じ操作で足りる。
 *
 * そのセッションを見ている他の端末の表示も動くが、これは tmux で普通に
 * ウィンドウを選んだときと同じ挙動 (クライアントごとに別のウィンドウを
 * 見ることは tmux にはできない)。
 */
export async function selectTmuxPane(
  paneId: TmuxPaneId,
  cwd: string,
): Promise<TmuxFocusResult> {
  // 1 プロセスにまとめる。別々に呼ぶと、その間にウィンドウが変わりうる。
  return toResult(
    await runTmux(
      ["select-window", "-t", paneId, ";", "select-pane", "-t", paneId],
      cwd,
    ),
  );
}

/**
 * シェルへ流し込む文字列を 1 つの引数として安全に包む。
 *
 * ペイン ID は `%12` の形しか通していないが、tmux の実行ファイルは
 * `--bin tmux=...` で任意のパスになりうる。シェルに渡す以上、空白や記号が
 * 入っても 1 語として届くようにする。
 */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * 開いたシェルへ打ち込む attach の 1 行。
 *
 * ここで実行ファイル名を解決しておくので、`--bin tmux=...` や
 * CODE_VIEWER_BIN_TMUX がブラウザから開いたシェルでもそのまま効く。
 */
export function tmuxAttachCommandLine(paneId: TmuxPaneId): string {
  const tmux = shellQuote(commandForExternal("tmux"));
  return `${tmux} attach-session -t ${shellQuote(paneId)}\r`;
}
