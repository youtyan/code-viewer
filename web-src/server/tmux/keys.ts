// ブラウザで打った内容を tmux ペインへ送る。
//
// send-keys -H はバイトを 16 進で受け取る。キー名 (`Enter`, `C-c`) に翻訳
// せず、xterm が組み立てたバイト列をそのまま渡すので、日本語 (UTF-8 の
// マルチバイト)・Ctrl 系・矢印キーのエスケープ列が同じ 1 経路で通る。
// tmux 側の解釈を挟まないぶん、翻訳漏れによる「特定のキーだけ効かない」が
// 起きない。

import type { TmuxPaneId } from "../../core/tmux";
import { runTmux } from "./command";

/**
 * 1 回の send-keys に載せるバイト数。引数 1 つが 1 バイトなので、貼り付けの
 * ような長い入力をそのまま渡すと引数リストが実行時の上限に当たる。分割して
 * 順に送れば、ペイン側では連続した入力として届く。
 */
const MAX_BYTES_PER_CALL = 512;

export type TmuxSendResult =
  | { status: "ok" }
  /** ペインが閉じられた / tmux が居ない。 */
  | { status: "gone" }
  | { status: "error"; message: string };

/** 文字列を send-keys -H に渡す 16 進バイト列にする。 */
export function toTmuxKeyBytes(data: string): string[] {
  const bytes = new TextEncoder().encode(data);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
}

export async function sendTmuxKeys(
  paneId: TmuxPaneId,
  data: string,
  cwd: string,
): Promise<TmuxSendResult> {
  const hex = toTmuxKeyBytes(data);
  if (hex.length === 0) return { status: "ok" };

  for (let offset = 0; offset < hex.length; offset += MAX_BYTES_PER_CALL) {
    const chunk = hex.slice(offset, offset + MAX_BYTES_PER_CALL);
    const result = await runTmux(
      ["send-keys", "-H", "-t", paneId, ...chunk],
      cwd,
    );
    if (result.status === "ok") continue;
    if (
      result.status === "no-target" ||
      result.status === "missing" ||
      result.status === "no-server"
    ) {
      return { status: "gone" };
    }
    return { status: "error", message: result.message };
  }
  return { status: "ok" };
}
