// ターミナル (メインの面のタブ) の文言。tools オーバーレイと同じく、アプリ全体の言語設定
// (app.ts の STATE.language) で切り替える。言語切替時のライブ反映は
// terminal-view の localize() が担当する。

import { formatBytes } from "../../core/source-meta";
import type { TerminalImageRejectReason } from "../../core/terminal-images";

export type TerminalLang = "en" | "ja";

export type TerminalText = {
  connecting: string;
  /** 選んだペインが閉じられていた。 */
  paneClosed: string;
  /** ペインを開けなかった。 */
  paneOpenFailed: string;
  /** 画面を取得できない。 */
  screenFailed: string;
  shellListFailed: string;
  /** ターミナル本体を読み込めなかった。 */
  loadFailed: string;
  /** キー送信に失敗した。 */
  sendFailed: string;
  resizeFailed: string;
  imageListFailed: string;
  /** 新しいシェルを開くボタン。 */
  newShell: string;
  newShellTitle: string;
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
  /** 文字サイズの増減。 */
  fontSmaller: string;
  fontLarger: string;
  /** ただのシェル (エージェントではない) を映しているときの札。 */
  shellTarget: string;
  /** タブ列の「＋」のメニュー。 */
  newTabOpenFile: string;
  /** 一覧の行がタブで開いているときの添え書き。 */
  inTab: string;
  /** 未読の印 (● ) の説明。 */
  unreadTitle: string;
  /** タブで開いていない未読を全部読んだことにする。 */
  markAllRead: (count: number) => string;
  /** 全部のプロジェクトのセッションを見る (Agents の一覧へ)。 */
  allSessions: string;
  /** 「セッションを止める」の確かめ。 */
  stopConfirmTitle: string;
  stopConfirmMessage: (name: string) => string;
  stopConfirm: string;
  cancel: string;
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
  /** 棚の項目の右クリック: 画像のタブで開く (既定の押し方と同じ)。 */
  imageOpenInTab: string;
  /** 棚の項目の右クリック: 覆いの拡大表示で開く (Alt / Shift + クリックと同じ)。 */
  imageOpenInViewer: string;
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
  connecting: "Connecting…",
  paneClosed: "This pane has been closed.",
  paneOpenFailed: "Could not open this pane.",
  screenFailed: "Cannot read this terminal.",
  shellListFailed: "Failed to load the shell list.",
  loadFailed: "Failed to load the terminal.",
  sendFailed: "Failed to send input.",
  resizeFailed: "Failed to resize the terminal.",
  imageListFailed: "Failed to inspect terminal images.",
  newShell: "New shell",
  newShellTitle: "open a new shell in this repository",
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
  readOnly: "Read only",
  readOnlyTitle: "input is not sent",
  writable: "Input on",
  writableTitle: "keystrokes are sent to the attached terminal",
  fontSmaller: "Smaller text",
  fontLarger: "Larger text",
  shellTarget: "Shell",
  newTabOpenFile: "Open a file… (⌘K)",
  inTab: "in a tab",
  unreadTitle: "● = unread: it changed state while you were away",
  markAllRead: (count) => `Mark all as read (${count})`,
  allSessions: "All sessions in every project…",
  stopConfirmTitle: "Stop this session?",
  stopConfirmMessage: (name) =>
    `${name} will end, and whatever is running in it stops. Its tab closes too.`,
  stopConfirm: "Stop",
  cancel: "Cancel",
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
  imageOpenInTab: "Open in a tab",
  imageOpenInViewer: "Open in the viewer (Alt+click)",
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
  lastPrompt: "last instruction",
  elapsed: elapsedFormatter("now", "m", "h", "d"),
};

const JA: TerminalText = {
  connecting: "接続しています…",
  paneClosed: "このペインは閉じられました。",
  paneOpenFailed: "このペインを開けませんでした。",
  screenFailed: "このターミナルの画面を取得できません。",
  shellListFailed: "シェル一覧を取得できませんでした。",
  loadFailed: "ターミナルを読み込めませんでした。",
  sendFailed: "入力を送信できませんでした。",
  resizeFailed: "ターミナルの大きさを変更できませんでした。",
  imageListFailed: "ターミナルの画像を確認できませんでした。",
  newShell: "新しいシェル",
  newShellTitle: "このリポジトリで新しいシェルを開きます",
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
  fontSmaller: "文字を小さく",
  fontLarger: "文字を大きく",
  shellTarget: "シェル",
  newTabOpenFile: "ファイルを開く… (⌘K)",
  inTab: "タブで表示中",
  unreadTitle: "● = 未読: 離れている間に状態が変わりました",
  markAllRead: (count) => `すべて読んだことにする (${count})`,
  allSessions: "すべてのプロジェクトのセッション…",
  stopConfirmTitle: "このセッションを止めますか？",
  stopConfirmMessage: (name) =>
    `${name} を終了します。中で動いているものも止まり、タブも閉じます。`,
  stopConfirm: "止める",
  cancel: "キャンセル",
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
  imageOpenInTab: "タブで開く",
  imageOpenInViewer: "拡大表示で開く (Alt+クリック)",
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
  lastPrompt: "最後に出した指示",
  elapsed: elapsedFormatter("今", "分", "時間", "日"),
};

export function terminalText(lang: TerminalLang): TerminalText {
  return lang === "ja" ? JA : EN;
}
