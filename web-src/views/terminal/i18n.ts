// terminal ドロワーの文言。tools オーバーレイと同じく、アプリ全体の言語設定
// (app.ts の STATE.language) で切り替える。言語切替時のライブ反映は
// terminal-view の localize() が担当する。

export type TerminalLang = "en" | "ja";

export type TerminalText = {
  title: string;
  open: string;
  close: string;
  resizeSheet: string;
  resizeList: string;
  /** ペイン一覧の見出し。 */
  panes: string;
  reload: string;
  /** tmux 実行ファイルが無い。 */
  notInstalled: string;
  /** tmux は在るがセッションが 0。 */
  noSessions: string;
  /** ペインを選ぶ前。 */
  selectPane: string;
  connecting: string;
  /** 選んでいたペインが閉じられた。 */
  paneClosed: string;
  /** 画面を取得できない。 */
  screenFailed: string;
  /** ターミナル本体を読み込めなかった。 */
  loadFailed: string;
  /** キー送信に失敗した。 */
  sendFailed: string;
  /** ペインの実サイズ表示 (80x24 など)。 */
  paneSize: (cols: number, rows: number) => string;
  /** 読み取り専用で、キー入力を送らない状態。 */
  readOnly: string;
  readOnlyTitle: string;
  writable: string;
  writableTitle: string;
};

const EN: TerminalText = {
  title: "Terminal",
  open: "tmux panes",
  close: "close",
  resizeSheet: "resize drawer",
  resizeList: "resize pane list",
  panes: "Panes",
  reload: "reload pane list",
  notInstalled: "tmux is not installed.",
  noSessions: "No tmux session is running.",
  selectPane: "Select a pane to attach.",
  connecting: "Connecting…",
  paneClosed: "This pane has been closed.",
  screenFailed: "Cannot read this pane.",
  loadFailed: "Failed to load the terminal.",
  sendFailed: "Failed to send input.",
  paneSize: (cols, rows) => `${cols}x${rows}`,
  readOnly: "read only",
  readOnlyTitle: "input is not sent to tmux",
  writable: "input on",
  writableTitle: "keystrokes are sent to the tmux pane",
};

const JA: TerminalText = {
  title: "ターミナル",
  open: "tmux ペイン",
  close: "閉じる",
  resizeSheet: "ドロワーの幅を変更",
  resizeList: "ペイン一覧の高さを変更",
  panes: "ペイン",
  reload: "ペイン一覧を再取得",
  notInstalled: "tmux がインストールされていません。",
  noSessions: "起動中の tmux セッションがありません。",
  selectPane: "表示するペインを選んでください。",
  connecting: "接続しています…",
  paneClosed: "このペインは閉じられました。",
  screenFailed: "このペインの画面を取得できません。",
  loadFailed: "ターミナルを読み込めませんでした。",
  sendFailed: "入力を送信できませんでした。",
  paneSize: (cols, rows) => `${cols}x${rows}`,
  readOnly: "閲覧のみ",
  readOnlyTitle: "キー入力を tmux に送りません",
  writable: "入力する",
  writableTitle: "キー入力を tmux のペインに送ります",
};

export function terminalText(lang: TerminalLang): TerminalText {
  return lang === "ja" ? JA : EN;
}
