// 生きた知らせ (/_live) の型と枠。サーバ (server/live/handle.ts) とブラウザ
// (views/shell/live-hub.ts) が同じものを使う。
//
// 1 つの窓は /_live に SSE を 1 本だけ張り、プロジェクトの通知・シェルの出力・
// SP のペインの出力を「チャンネル」として相乗りさせる。枠は `event: m` の 1 つで、
// data は `<チャンネル> <知らせ> <中身>`。中身は改行を含んでよい (SSE の複数行)。
// `_` で始まる知らせはチャンネルの状態で、流れてくる中身の知らせとは別:
// - _open: 流しが繋がった (EventSource の open に当たる)
// - _closed: サーバが流しを閉じた。ブラウザは少し待って開き直す (EventSource の
//   繋ぎ直しに当たる)
// - _failed: 開けなかった。中身は理由の JSON。開き直さない (EventSource の CLOSED)

import { isShellSessionId, type ShellSessionId } from "./shell";
import { isTmuxPaneId, type TmuxPaneId } from "./tmux";

export type LiveSpec =
  /** プロジェクトの通知 (/events)。project は /p/<鍵> の鍵 (単体のサーバでは null)。 */
  | { kind: "events"; project: string | null }
  | { kind: "shell"; id: ShellSessionId }
  /** SP の 1 ペイン表示。 */
  | { kind: "pane"; pane: TmuxPaneId };

/** 購読の 1 件。ch はブラウザが付ける (同じ接続の中で一意)。 */
export type LiveOpen = LiveSpec & { ch: string };

/** チャンネルの知らせを運ぶ SSE の event 名。 */
export const LIVE_FRAME_EVENT = "m";

/**
 * 流しが切れた後、繋ぎ直すまでの待ち。プロジェクトの通知と生きた知らせの流しが
 * 開いた直後に retry で送り、
 * サーバが閉じたチャンネルの開き直しも同じだけ待つ。EventSource の既定 (Chrome
 * で約 3 秒) が、入口のサーバを起こし直した後の待ちのほとんどだった
 * (scripts/perf.mjs の sse.caughtUpMs)。
 */
export const SSE_RETRY_MS = 500;

const CHANNEL_ID = /^[a-z0-9]{1,16}$/;
const PROJECT_KEY = /^[0-9a-f]{16}$/;

export function isLiveOpen(value: unknown): value is LiveOpen {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  if (typeof item.ch !== "string" || !CHANNEL_ID.test(item.ch)) return false;
  if (item.kind === "events")
    return (
      item.project === null ||
      (typeof item.project === "string" && PROJECT_KEY.test(item.project))
    );
  if (item.kind === "shell") return isShellSessionId(item.id);
  if (item.kind === "pane") return isTmuxPaneId(item.pane);
  return false;
}

export function liveFrame(ch: string, event: string, data: string): string {
  return `${ch} ${event} ${data}`;
}

/** liveFrame の逆。形が違えば null。 */
export function parseLiveFrame(
  text: string,
): { ch: string; event: string; data: string } | null {
  const first = text.indexOf(" ");
  if (first <= 0) return null;
  const second = text.indexOf(" ", first + 1);
  if (second <= first + 1) return null;
  return {
    ch: text.slice(0, first),
    event: text.slice(first + 1, second),
    data: text.slice(second + 1),
  };
}
