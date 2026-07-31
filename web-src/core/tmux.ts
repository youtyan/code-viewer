// terminal ドロワーが扱う tmux ペインの identity と形。URL (?terminal=%14)、
// サーバの一覧レスポンス、クライアントのツリー描画が同じ 1 つの型を参照する
// ように、client / server 双方から import できる core に置く
// (core/tools.ts と同じ役割)。

/**
 * tmux のペイン識別子 (`%0`, `%14`)。tmux サーバ内で一意で、ペインやウィンドウ
 * が増減しても振り直されない。`0:1.2` 形式のインデックス指定は隣のペインを
 * 閉じただけでずれるので、選択状態の保持にはこちらだけを使う。
 */
export type TmuxPaneId = string;

export type TmuxPane = {
  id: TmuxPaneId;
  /** ペイン単体を指す tmux のターゲット表記 (`0:1.2`)。表示用。 */
  label: string;
  paneIndex: number;
  /** tmux が付けているタイトル。AI CLI は作業内容をここに出すので一覧の主役。 */
  title: string;
  /** そのペインで動いているコマンド名 (`zsh`, `node`, ...)。 */
  command: string;
  path: string;
  /** 桁数と行数。xterm 側をこのサイズに合わせると capture がずれない。 */
  width: number;
  height: number;
  active: boolean;
};

export type TmuxWindow = {
  index: number;
  name: string;
  active: boolean;
  panes: TmuxPane[];
};

export type TmuxSession = {
  name: string;
  attached: boolean;
  windows: TmuxWindow[];
};

export type TmuxPanesResponse = {
  /** tmux 実行ファイルが見つかったか。false なら未導入。 */
  available: boolean;
  /** tmux サーバが起動しているか。false なら導入済みでセッションが 0。 */
  running: boolean;
  sessions: TmuxSession[];
};

/** ペイン画面の 1 フレーム。 */
export type TmuxScreen = {
  pane: TmuxPaneId;
  /** capture-pane -e の出力。ANSI エスケープを含む。 */
  content: string;
  width: number;
  height: number;
  /** カーソル位置 (0 始まり)。capture-pane の出力には入っていないので別に
   * 取る。これが無いと、描画後のカーソルが本文の末尾に落ちて、入力中の
   * 位置とずれる。 */
  cursorX: number;
  cursorY: number;
};

/** ドロワー幅 (px) の許容範囲。サーバ側の sanitize とクライアント側のドラッグ
 * クランプが同じ値を見るように core に置く。 */
export const MIN_TERMINAL_SHEET_WIDTH = 480;
export const MAX_TERMINAL_SHEET_WIDTH = 4000;

/** 画面を取り直す間隔 (ms)。tmux の capture-pane は 1 ペインぶんの画面を
 * 読むだけなので、この頻度でも負荷にならない。 */
export const TERMINAL_POLL_INTERVAL_MS = 120;

/**
 * `%12` 形式かどうか。ペイン ID は URL・SSE の購読対象・send-keys の宛先に
 * そのまま渡るので、tmux へ渡す前に必ずこれを通す。
 */
export function isTmuxPaneId(value: unknown): value is TmuxPaneId {
  return typeof value === "string" && /^%\d+$/.test(value);
}

/** 一覧を平坦なペイン列にする。ツリーを辿らずに ID を引きたいとき用。 */
export function flattenTmuxPanes(sessions: TmuxSession[]): TmuxPane[] {
  const panes: TmuxPane[] = [];
  for (const session of sessions) {
    for (const window of session.windows) {
      panes.push(...window.panes);
    }
  }
  return panes;
}

/** 一覧の中に指定のペインがまだ在るか。閉じられたペインを選び続けないため。 */
export function findTmuxPane(
  sessions: TmuxSession[],
  id: TmuxPaneId | null,
): TmuxPane | null {
  if (!id) return null;
  return flattenTmuxPanes(sessions).find((pane) => pane.id === id) ?? null;
}
