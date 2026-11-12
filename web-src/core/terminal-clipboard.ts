// 端末の中のプログラムが送る OSC 52 (クリップボードの操作) を解く純ロジック。
// 受け口は views/terminal/terminal-screen.ts。
//
// 形は `ESC ] 52 ; <選択> ; <中身> BEL`。選択は c (クリップボード)・p (主選択)・
// s・0〜7 の並びで、空なら既定 (tmux は空で送る)。どれもブラウザのクリップ
// ボード 1 つに書く。中身が `?` なら読み出しの求めで、いつも断る (端末の
// プログラムに、利用者が別の所でコピーしたものを読ませない)。中身は base64 の
// UTF-8 で、大きすぎるもの・解けないものは書かない。
//
// tmux の中のプログラムが送った OSC 52 は、tmux の `set-clipboard` が `on` の
// ときだけ外 (code-viewer の端末) へ届く。tmux のコピーモードの写しは既定
// (`external`) でも届く。

/** 書いてよい中身の上限 (解いた後のバイト数)。 */
export const MAX_TERMINAL_CLIPBOARD_BYTES = 1024 * 1024;

export type Osc52Request =
  | { kind: "write"; text: string }
  | { kind: "read" }
  | { kind: "invalid"; reason: string };

const SELECTION = /^[cpqs0-7]*$/;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

export function parseOsc52(data: string): Osc52Request {
  const at = data.indexOf(";");
  if (at < 0) return { kind: "invalid", reason: "no ';' after the selection" };
  const selection = data.slice(0, at);
  const payload = data.slice(at + 1);
  if (!SELECTION.test(selection)) {
    return {
      kind: "invalid",
      reason: `unknown selection ${JSON.stringify(selection.slice(0, 16))}`,
    };
  }
  if (payload === "?") return { kind: "read" };
  if (payload === "") return { kind: "invalid", reason: "empty payload" };
  // base64 は 4 文字で 3 バイト。解く前に大きさを見る (大きな文字列を作らない)。
  if (Math.floor((payload.length * 3) / 4) > MAX_TERMINAL_CLIPBOARD_BYTES + 2) {
    return {
      kind: "invalid",
      reason: `larger than ${MAX_TERMINAL_CLIPBOARD_BYTES} bytes`,
    };
  }
  if (payload.length % 4 !== 0 || !BASE64.test(payload)) {
    return { kind: "invalid", reason: "the payload is not base64" };
  }
  const binary = atob(payload);
  if (binary.length > MAX_TERMINAL_CLIPBOARD_BYTES) {
    return {
      kind: "invalid",
      reason: `larger than ${MAX_TERMINAL_CLIPBOARD_BYTES} bytes`,
    };
  }
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  try {
    return {
      kind: "write",
      text: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    };
  } catch (error) {
    return {
      kind: "invalid",
      reason: `the payload is not UTF-8 (${error instanceof Error ? error.message : String(error)})`,
    };
  }
}
