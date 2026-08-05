// terminal ドロワーが叩く tmux コマンドの共通入口。
//
// ペイン一覧 / 画面取得 / キー送信のどれもが「tmux が入っていない」「tmux
// サーバが動いていない」「ペインがもう無い」の 3 つを普通の状態として扱う
// 必要があるので、その判定をここ 1 箇所に置く。呼び出し側は status を見る
// だけでよい。
//
// 実行ファイルの解決は command-resolver に任せる (--bin tmux=... と
// CODE_VIEWER_BIN_TMUX がそのまま効く)。シェルは経由せず、必ず引数配列で
// 渡す。ペイン ID もキー入力も外から来た文字列なので、シェル展開に載せない。

import { errorWithCause } from "../../core/error-detail";
import {
  commandForExternal,
  isCommandNotFoundResult,
} from "../command-resolver";
import { runAsync } from "../runtime";

/** tmux が応答しないときに待ち続けない。ローカルの tmux は数 ms で返る。 */
const TMUX_TIMEOUT_MS = 3000;

/**
 * tmux サーバが動いていないときの stderr。tmux はこれを exit 1 で返すが、
 * ユーザーから見れば「まだセッションが無い」だけなのでエラーにしない。
 */
const NO_SERVER_MARKERS = [
  "no server running",
  "error connecting to",
  "no current session",
];

/**
 * 選んでいたペインが閉じられたときの stderr。ユーザーが tmux 側でペインを
 * 閉じただけなので、静かに畳む合図として扱う。
 *
 * クライアントも同じ扱いにする。宛先にしていた端末の tmux が終了していれば
 * 「もう居ない」だけで、こちらの異常ではない。
 */
const NO_TARGET_MARKERS = [
  "can't find pane",
  "can't find window",
  "can't find session",
  "can't find client",
];

/**
 * フィールド区切り。ASCII の Unit Separator (0x1F)。タブや空白と違い、
 * ペインタイトルにもパスにも現れない。生の制御文字をソースに直接置くと、
 * 見た目が空文字と区別できず、消えていても気付けない。必ずこの形で書く。
 *
 * 一覧を引く側 (panes.ts / clients.ts) が同じ区切りを使うようにここへ置く。
 */
export const TMUX_FIELD_SEP = String.fromCharCode(31);

export type TmuxRunResult =
  | { status: "ok"; stdout: string }
  /** tmux 実行ファイルが見つからない。 */
  | { status: "missing" }
  /** tmux は在るがサーバが起動していない (セッションが 1 つも無い)。 */
  | { status: "no-server" }
  /** 指定したペイン / ウィンドウが既に閉じられている。 */
  | { status: "no-target" }
  | { status: "error"; error: Error };

/** 実行ファイル名を解決した引数列。 */
export function tmuxArgs(args: string[]): string[] {
  return [commandForExternal("tmux"), ...args];
}

function stderrIncludesAny(stderr: string, markers: string[]): boolean {
  const lower = stderr.toLowerCase();
  return markers.some((marker) => lower.includes(marker));
}

export async function runTmux(
  args: string[],
  cwd: string,
): Promise<TmuxRunResult> {
  let result: Awaited<ReturnType<typeof runAsync>>;
  try {
    result = await runAsync(tmuxArgs(args), cwd, {
      timeout: TMUX_TIMEOUT_MS,
    });
  } catch (error) {
    return {
      status: "error",
      error: errorWithCause("failed to execute tmux", error),
    };
  }
  if (result.code === 0) return { status: "ok", stdout: result.stdout };
  if (isCommandNotFoundResult("tmux", result)) return { status: "missing" };
  if (stderrIncludesAny(result.stderr, NO_SERVER_MARKERS)) {
    return { status: "no-server" };
  }
  if (stderrIncludesAny(result.stderr, NO_TARGET_MARKERS)) {
    return { status: "no-target" };
  }
  return {
    status: "error",
    error: new Error(
      [
        `tmux exited with ${result.code}`,
        result.stderr ? `stderr: ${result.stderr}` : "",
        result.stdout ? `stdout: ${result.stdout}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    ),
  };
}
