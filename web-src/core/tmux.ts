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
  /**
   * このリポジトリの作業ツリー配下で動いているか。ドロワーは既定でこれが
   * true のものだけを出す。判定できなかった場合 (git が無い等) は true。
   * 絞り込めないことを理由に何も出さないより、全部見せるほうがまし。
   */
  inRepo: boolean;
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

/**
 * tmux に繋がっている端末 1 つ。
 *
 * ブラウザから開いたシェルの中で tmux を起動すると、その tmux クライアントは
 * シェルと同じ端末に載る。つまり ShellSession.tty と tty を突き合わせれば
 * 「このペインは今ブラウザのどのシェルで見えているか」が分かる。ツリーの印と
 * サーバ側の宛先解決が同じ 1 つの型を参照するように core に置く。
 */
export type TmuxClient = {
  /** 端末デバイス (`/dev/ttys012`)。 */
  tty: string;
  /** 見ているセッション名。 */
  session: string;
  /** 見ているペイン。 */
  pane: TmuxPaneId;
};

export type TmuxClientsResponse = {
  clients: TmuxClient[];
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
  /**
   * content の先頭に何行ぶんの過去が付いているか。0 なら今の画面だけ。
   *
   * ドロワーの表示領域がペインより縦に長いとき、余る上側をこれで埋める。
   * 本文から数えると tmux が落とした行末の空行のぶんずれるので、サーバから
   * 受け取る。画面の先頭行とカーソル行の位置はこれだけ下にずれる。
   */
  historyLines: number;
};

/** ドロワー幅 (px) の許容範囲。サーバ側の sanitize とクライアント側のドラッグ
 * クランプが同じ値を見るように core に置く。 */
export const MIN_TERMINAL_SHEET_WIDTH = 480;
export const MAX_TERMINAL_SHEET_WIDTH = 4000;

/**
 * ターミナルの文字サイズ (px) の許容範囲と既定。サーバ側の sanitize と
 * ブラウザ側のボタンが同じ値を見るように core に置く。
 */
export const MIN_TERMINAL_FONT_SIZE = 8;
export const MAX_TERMINAL_FONT_SIZE = 28;
export const DEFAULT_TERMINAL_FONT_SIZE = 13;
/** ボタン 1 回あたりの増減。 */
export const TERMINAL_FONT_SIZE_STEP = 1;

/** 保存値や入力を許容範囲へ丸める。数値でなければ既定。 */
export function clampTerminalFontSize(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number.NaN;
  if (!Number.isFinite(parsed)) return DEFAULT_TERMINAL_FONT_SIZE;
  return Math.min(
    MAX_TERMINAL_FONT_SIZE,
    Math.max(MIN_TERMINAL_FONT_SIZE, Math.round(parsed)),
  );
}

/**
 * `%12` 形式かどうか。ペイン ID は URL・SSE の購読対象・send-keys の宛先に
 * そのまま渡るので、tmux へ渡す前に必ずこれを通す。
 */
export function isTmuxPaneId(value: unknown): value is TmuxPaneId {
  return typeof value === "string" && /^%\d+$/.test(value);
}

/**
 * パスがどれかの作業ツリーの中にあるか。
 *
 * ドロワーは既定で「このリポジトリのペイン」だけを出す。エージェントは
 * worktree ごとに分けて走らせる前提なので、リポジトリルートの前方一致では
 * 足りず、worktree の一覧すべてと突き合わせる。
 *
 * 前方一致だけで見ると `/w/repo` が `/w/repo-old` にも当たるので、区切りまで
 * 含めて比べる。
 */
export function isPathInsideAny(path: string, roots: string[]): boolean {
  if (!path) return false;
  const target = path.replace(/\/+$/, "");
  return roots.some((raw) => {
    const root = raw.replace(/\/+$/, "");
    if (!root) return false;
    return target === root || target.startsWith(`${root}/`);
  });
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
