// terminal ドロワーの文言。tools オーバーレイと同じく、アプリ全体の言語設定
// (app.ts の STATE.language) で切り替える。言語切替時のライブ反映は
// terminal-view の localize() が担当する。

import { formatBytes } from "../../core/source-meta";
import type { TerminalImageRejectReason } from "../../core/terminal-images";

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
  /** まだ何も映していないとき。 */
  selectPane: string;
  connecting: string;
  /** 選んだペインが閉じられていた。 */
  paneClosed: string;
  /** ペインを開けなかった。 */
  paneOpenFailed: string;
  /** 画面を取得できない。 */
  screenFailed: string;
  paneListFailed: string;
  shellListFailed: string;
  stateListFailed: string;
  clientListFailed: string;
  listLoadFailed: string;
  markReadFailed: string;
  /** ターミナル本体を読み込めなかった。 */
  loadFailed: string;
  /** キー送信に失敗した。 */
  sendFailed: string;
  resizeFailed: string;
  imageListFailed: string;
  /** ペインの実サイズ表示 (80x24 など)。 */
  paneSize: (cols: number, rows: number) => string;
  /** セッションタブに並ぶシェルの見出し。 */
  shells: string;
  /** そのシェルが中で動かしている tmux セッション。 */
  attachedTo: (session: string) => string;
  /** 枝の開閉ボタン。 */
  toggleBranch: string;
  /** 新しいシェルを開くボタン。 */
  newShell: string;
  newShellTitle: string;
  /** シェルを閉じるボタン。 */
  closeShell: string;
  /** node-pty が無い環境。 */
  shellUnavailable: string;
  /** シェルがまだ 1 つも無い。 */
  noShells: string;
  /** シェルのプロセスが終了した。 */
  shellExited: (exitCode: number | null) => string;
  /** 開いていたシェルが無くなっていた。 */
  shellClosed: string;
  /** シェルを開けなかった。 */
  shellCreateFailed: string;
  shellCloseFailed: string;
  /** 同時に開ける数の上限に達した。 */
  shellLimitReached: string;
  /** 読み取り専用で、キー入力を送らない状態。 */
  readOnly: string;
  readOnlyTitle: string;
  writable: string;
  writableTitle: string;
  /** 上段の見出し。入力待ちと未読をまとめた区画。 */
  yourTurn: string;
  yourTurnHint: string;
  /** 上段が空のとき。 */
  yourTurnEmpty: string;
  /** 一覧の見出し。 */
  sessions: string;
  /** 状態そのものの名前。絞り込みの札にも行にも使う。 */
  stateWorking: string;
  stateWaiting: string;
  stateDone: string;
  stateIdle: string;
  /** 状態の出どころが当て推量であることの補足。 */
  guessed: string;
  /** 絞り込みの入力欄。 */
  filterPlaceholder: string;
  /** 絞り込みを解除する札。 */
  filterAll: string;
  /** 絞り込みの結果が 0 件。 */
  noMatches: string;
  /** 未読を読んだことにするボタン。 */
  markRead: string;
  /** 上段のカードから、その対象を映すボタン。 */
  openTarget: string;
  /** 文字サイズの増減。 */
  fontSmaller: string;
  fontLarger: string;
  /** 見出しの行のセッションの一覧の開閉。 */
  sessionsShow: string;
  sessionsHide: string;
  /** 見出しの行に出す、何も映していないときの札。 */
  noTarget: string;
  /** ただのシェル (エージェントではない) を映しているときの札。 */
  shellTarget: string;
  /** 貼り付けた画像を帯から外す。 */
  removeAttachment: string;
  /** 画像を大きく開く。 */
  openImage: string;
  /** 拡大表示の操作。 */
  zoomIn: string;
  zoomOut: string;
  zoomReset: string;
  closeImage: string;
  /** 拡大表示の下に出す操作の説明。 */
  imageHint: string;
  /** 拡大表示の、棚の並びの前へ・次へ。 */
  previousImage: string;
  nextImage: string;
  /** 拡大表示の、パスのコピー。 */
  copyImagePath: string;
  imagePathCopied: string;
  copyImagePathFailed: string;
  /** 画像の棚の見出し。 */
  imageShelfTitle: string;
  /** 棚を畳む・開く。 */
  imageShelfCollapse: string;
  imageShelfExpand: (count: number) => string;
  /** 棚の項目の寸法 (読み込めたら)。 */
  imageSize: (width: number, height: number) => string;
  /** 棚の項目の読めなかった理由。 */
  imageRejected: (
    reason: TerminalImageRejectReason,
    bytes: number | null,
  ) => string;
  /** 棚の項目の「何分前」(ファイルの更新時刻から)。 */
  imageAge: (bucket: {
    unit: "now" | "minute" | "hour" | "day";
    value: number;
  }) => string;
  /** 読めなかった項目を押したときの説明 (押すと確かめ直す)。 */
  imageRecheck: string;
  /** ペインの作業場所を引けず、別の場所から解いた。 */
  imageBaseFailed: string;
  /** 繋いだときの履歴の走査に失敗した。 */
  imageHistoryFailed: string;
  /** 画像を貼り付けられなかった。 */
  pasteFailed: string;
  /** 出す範囲の切り替え。 */
  scopeLabel: string;
  scopeRepo: string;
  scopeAll: string;
  stateFilterLabel: string;
  /** このリポジトリに絞った結果、隠れている件数。 */
  hiddenOther: (count: number) => string;
  /** 最後に人間が出した指示の見出し。 */
  lastPrompt: string;
  /** 状態が変わってからの経過。 */
  elapsed: (bucket: {
    unit: "now" | "minute" | "hour" | "day";
    value: number;
  }) => string;
};

/**
 * 経過時間の書き方は言語で単位が変わるだけなので、組み立てはここに 1 つ置く。
 * 刻み方 (何分・何時間・何日) は core/terminal-board の elapsedBucket が決める。
 */
function elapsedFormatter(
  now: string,
  minute: string,
  hour: string,
  day: string,
): TerminalText["elapsed"] {
  return (bucket) => {
    if (bucket.unit === "now") return now;
    if (bucket.unit === "minute") return `${bucket.value}${minute}`;
    if (bucket.unit === "hour") return `${bucket.value}${hour}`;
    return `${bucket.value}${day}`;
  };
}

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
  selectPane:
    "Pick an agent in the sidebar, or open the session list to start a shell.",
  connecting: "Connecting…",
  paneClosed: "This pane has been closed.",
  paneOpenFailed: "Could not open this pane.",
  screenFailed: "Cannot read this terminal.",
  paneListFailed: "Failed to load the pane list.",
  shellListFailed: "Failed to load the shell list.",
  stateListFailed: "Failed to load terminal states.",
  clientListFailed: "Failed to load terminal clients.",
  listLoadFailed: "Failed to refresh terminal lists.",
  markReadFailed: "Failed to mark the terminal as read.",
  loadFailed: "Failed to load the terminal.",
  sendFailed: "Failed to send input.",
  resizeFailed: "Failed to resize the terminal.",
  imageListFailed: "Failed to inspect terminal images.",
  paneSize: (cols, rows) => `${cols}x${rows}`,
  shells: "Shells",
  attachedTo: (session) => `attached to tmux session ${session}`,
  toggleBranch: "expand or collapse",
  newShell: "+ new shell",
  newShellTitle: "open a new shell in this repository",
  closeShell: "close this shell",
  shellUnavailable:
    "Opening shells needs the optional node-pty package. Reinstall dependencies to enable it.",
  noShells: "No shell is open yet.",
  shellExited: (exitCode) =>
    exitCode === null
      ? "The shell has exited."
      : `The shell has exited (code ${exitCode}).`,
  shellClosed: "This shell has been closed.",
  shellCreateFailed: "Could not open a shell.",
  shellCloseFailed: "Could not close the shell.",
  shellLimitReached: "Too many shells are open. Close one first.",
  readOnly: "read only",
  readOnlyTitle: "input is not sent",
  writable: "input on",
  writableTitle: "keystrokes are sent to the attached terminal",
  yourTurn: "Your turn",
  yourTurnHint: "waiting for input, or finished and unread",
  yourTurnEmpty: "Nothing needs you right now.",
  sessions: "Terminals",
  stateWorking: "working",
  stateWaiting: "waiting",
  stateDone: "unread",
  stateIdle: "idle",
  guessed: "detected from visible terminal UI or screen activity",
  filterPlaceholder: "task, place, or id",
  filterAll: "all",
  noMatches: "Nothing matches this filter.",
  markRead: "mark read",
  openTarget: "open",
  fontSmaller: "smaller text",
  fontLarger: "larger text",
  sessionsShow: "Show sessions and tmux panes",
  sessionsHide: "Hide sessions and tmux panes",
  noTarget: "Nothing open",
  shellTarget: "Shell",
  removeAttachment: "remove this image",
  openImage: "open larger",
  zoomIn: "zoom in",
  zoomOut: "zoom out",
  zoomReset: "fit",
  closeImage: "close",
  imageHint: "drag to pan · ctrl+wheel to zoom · ← → to move · Esc to close",
  previousImage: "previous image",
  nextImage: "next image",
  copyImagePath: "copy path",
  imagePathCopied: "path copied",
  copyImagePathFailed: "Could not copy the path.",
  imageShelfTitle: "Images",
  imageShelfCollapse: "collapse images",
  imageShelfExpand: (count) => `show images (${count})`,
  imageSize: (width, height) => `${width} × ${height}`,
  imageRejected: (reason, bytes) => {
    switch (reason) {
      case "missing":
        return "Not found (deleted?)";
      case "too-large":
        return bytes === null
          ? "Too large to show"
          : `Too large (${formatBytes(bytes)})`;
      case "not-file":
        return "Not a regular file";
      case "empty":
        return "Empty file";
      case "unreadable":
        return "Cannot be read";
      case "unsupported":
        return "Unsupported type";
      case "invalid":
        return "Invalid path";
    }
  },
  imageAge: (bucket) =>
    bucket.unit === "now"
      ? "just now"
      : `${elapsedFormatter("now", "m", "h", "d")(bucket)} ago`,
  imageRecheck: "check again",
  imageBaseFailed:
    "Could not read the tmux pane's working directory; relative image paths are resolved from the shell's directory.",
  imageHistoryFailed: "Could not scan the pane history for images.",
  pasteFailed: "Could not attach the pasted image.",
  scopeLabel: "terminal scope",
  scopeRepo: "this repository",
  scopeAll: "all tmux",
  stateFilterLabel: "state",
  hiddenOther: (count) => `${count} elsewhere`,
  lastPrompt: "last instruction",
  elapsed: elapsedFormatter("now", "m", "h", "d"),
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
  selectPane:
    "サイドバーでエージェントを選ぶか、セッションの一覧を開いてシェルを始めてください。",
  connecting: "接続しています…",
  paneClosed: "このペインは閉じられました。",
  paneOpenFailed: "このペインを開けませんでした。",
  screenFailed: "このターミナルの画面を取得できません。",
  paneListFailed: "ペイン一覧を取得できませんでした。",
  shellListFailed: "シェル一覧を取得できませんでした。",
  stateListFailed: "ターミナルの状態を取得できませんでした。",
  clientListFailed: "ターミナルの接続情報を取得できませんでした。",
  listLoadFailed: "ターミナル一覧を更新できませんでした。",
  markReadFailed: "ターミナルを既読にできませんでした。",
  loadFailed: "ターミナルを読み込めませんでした。",
  sendFailed: "入力を送信できませんでした。",
  resizeFailed: "ターミナルの大きさを変更できませんでした。",
  imageListFailed: "ターミナルの画像を確認できませんでした。",
  paneSize: (cols, rows) => `${cols}x${rows}`,
  shells: "シェル",
  attachedTo: (session) => `tmux セッション ${session} に接続中`,
  toggleBranch: "開く / 畳む",
  newShell: "+ 新しいシェル",
  newShellTitle: "このリポジトリで新しいシェルを開きます",
  closeShell: "このシェルを閉じる",
  shellUnavailable:
    "シェルを開くには任意依存の node-pty が必要です。依存を入れ直すと使えるようになります。",
  noShells: "開いているシェルはありません。",
  shellExited: (exitCode) =>
    exitCode === null
      ? "シェルが終了しました。"
      : `シェルが終了しました (終了コード ${exitCode})。`,
  shellClosed: "このシェルは閉じられました。",
  shellCreateFailed: "シェルを開けませんでした。",
  shellCloseFailed: "シェルを閉じられませんでした。",
  shellLimitReached: "開いているシェルが多すぎます。どれかを閉じてください。",
  readOnly: "閲覧のみ",
  readOnlyTitle: "キー入力を送りません",
  writable: "入力する",
  writableTitle: "キー入力を接続中のターミナルに送ります",
  yourTurn: "あなたの番",
  yourTurnHint: "入力待ちと、終わったのにまだ見ていないもの",
  yourTurnEmpty: "いま手を入れるものはありません。",
  sessions: "ターミナル",
  stateWorking: "作業中",
  stateWaiting: "入力待ち",
  stateDone: "未読",
  stateIdle: "待機中",
  guessed: "画面表示または画面の動きからの判定",
  filterPlaceholder: "作業内容・場所・宛先",
  filterAll: "すべて",
  noMatches: "この条件に合うものはありません。",
  markRead: "読んだ",
  openTarget: "開く",
  fontSmaller: "文字を小さく",
  fontLarger: "文字を大きく",
  sessionsShow: "セッションと tmux のペインを表示",
  sessionsHide: "セッションと tmux のペインを隠す",
  noTarget: "何も開いていません",
  shellTarget: "シェル",
  removeAttachment: "この画像を外す",
  openImage: "大きく開く",
  zoomIn: "拡大",
  zoomOut: "縮小",
  zoomReset: "等倍に戻す",
  closeImage: "閉じる",
  imageHint:
    "ドラッグで移動 · ctrl+ホイールで拡大縮小 · ← → で前後の画像 · Esc で閉じる",
  previousImage: "前の画像",
  nextImage: "次の画像",
  copyImagePath: "パスをコピー",
  imagePathCopied: "パスをコピーしました",
  copyImagePathFailed: "パスをコピーできませんでした。",
  imageShelfTitle: "画像",
  imageShelfCollapse: "画像の棚を畳む",
  imageShelfExpand: (count) => `画像の棚を開く (${count} 件)`,
  imageSize: (width, height) => `${width} × ${height}`,
  imageRejected: (reason, bytes) => {
    switch (reason) {
      case "missing":
        return "見つかりません (削除された可能性)";
      case "too-large":
        return bytes === null
          ? "大きすぎて表示しません"
          : `大きすぎます (${formatBytes(bytes)})`;
      case "not-file":
        return "通常のファイルではありません";
      case "empty":
        return "空のファイルです";
      case "unreadable":
        return "読めません";
      case "unsupported":
        return "対象外の種類です";
      case "invalid":
        return "パスが正しくありません";
    }
  },
  imageAge: (bucket) =>
    bucket.unit === "now"
      ? "たった今"
      : `${elapsedFormatter("今", "分", "時間", "日")(bucket)}前`,
  imageRecheck: "確かめ直す",
  imageBaseFailed:
    "tmux のペインの作業場所を読めませんでした。相対パスの画像はシェルの場所から探しています。",
  imageHistoryFailed: "ペインの履歴から画像を探せませんでした。",
  pasteFailed: "貼り付けた画像を渡せませんでした。",
  scopeLabel: "表示範囲",
  scopeRepo: "このリポジトリ",
  scopeAll: "すべて",
  stateFilterLabel: "状態",
  hiddenOther: (count) => `他 ${count} 件`,
  lastPrompt: "最後に出した指示",
  elapsed: elapsedFormatter("今", "分", "時間", "日"),
};

export function terminalText(lang: TerminalLang): TerminalText {
  return lang === "ja" ? JA : EN;
}
