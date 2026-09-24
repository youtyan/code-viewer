// ターミナル (メインの面のタブ) の文言。tools オーバーレイと同じく、アプリ全体の言語設定
// (app.ts の STATE.language) で切り替える。言語切替時のライブ反映は
// terminal-view の localize() が担当する。

import { formatBytes } from "../../core/source-meta";
import type {
  TerminalImageRejectReason,
  TerminalImageShelfPlacement,
} from "../../core/terminal-images";

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
  /**
   * シェル (または映していた tmux のペイン) が終わり、そのタブを閉じた。
   * name はタブの名前。最下段に短く出す。
   */
  tabEnded: (name: string) => string;
  /**
   * サーバが起き直してシェルが終わり、繋ぎ直す tmux の場所が無い (tmux を映して
   * いなかった・繋ぎ直せなかった) タブ。タブは残し、中に空の状態の案内として出す。
   */
  shellEndedByRestart: string;
  shellEndedByRestartHint: string;
  /** その案内の操作: 同じタブで新しいシェルを開く。 */
  reopenShell: string;
  /**
   * tmux のウインドウが端末より小さく、外側を覆っている理由。shared は、同じ
   * セッションを別の端末でも開いているか。
   */
  tmuxWindowSmaller: (cols: number, rows: number, shared: boolean) => string;
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
  /** 画面の中の URL・パスの帯: 開く・コピー・コピーした・失敗。 */
  linkOpen: string;
  linkCopy: string;
  linkCopied: string;
  linkCopyFailed: string;
  /** 画面の中のファイルのパスを確かめられなかった。 */
  linkLookupFailed: string;
  /** 棚の項目の右クリック: 端末の中でそのパスが出た行を見せる。 */
  imageShowInTerminal: string;
  /** 棚の項目の出どころ: tmux のペイン (番号とそのペインの題名)。 */
  imageOriginPane: (index: number, title: string) => string;
  /** 棚のまとまりの見出し: 出た所が分からない画像。 */
  imageOriginUnknown: string;
  /** 棚の札: 同じ画像がほかにも出たペイン。 */
  imageOriginsOthers: string;
  /** tmux のペインを読めず、どのペインに出たかを示せない。 */
  imageOriginFailed: string;
  /** 「ターミナルで見る」に失敗した。 */
  imageRevealFailed: string;
  /** 「ターミナルで見る」: 端末の中にもうそのパスが無い。 */
  imageRevealNotFound: string;
  /** 棚を畳む・開く。 */
  imageShelfCollapse: string;
  /** 棚の見出しの ⋯: 棚の置き場所を移す。 */
  imageShelfMove: string;
  /** 棚の置き場所の名前 (メニューと設定の欄)。 */
  imageShelfPlacementNames: Record<TerminalImageShelfPlacement, string>;
  /** 棚の内側の縁の掴み (大きさを変える)。 */
  imageShelfResize: string;
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
  /** 貼り付けた画像を保存し、そのパスを入力した (保存先はリポジトリからの相対パス)。 */
  pasteSaved: (relativePath: string) => string;
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
  tabEnded: (name) => `${name} has ended.`,
  shellEndedByRestart: "The shell ended when the server restarted",
  shellEndedByRestartHint:
    "There is nothing to reconnect to. Open a new shell in this tab to keep working here.",
  reopenShell: "Reopen in a new shell",
  tmuxWindowSmaller: (cols, rows, shared) =>
    shared
      ? `The tmux window is ${cols}×${rows} (sized to another terminal attached to the same session).`
      : `The tmux window is ${cols}×${rows} (smaller than this terminal; set by the tmux window-size option).`,
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
  openImage: "open larger",
  zoomIn: "zoom in",
  zoomOut: "zoom out",
  zoomReset: "fit",
  closeImage: "Close",
  imageHint: "drag to pan · ctrl+wheel to zoom · ← → to move · Esc to close",
  previousImage: "previous image",
  nextImage: "next image",
  copyImagePath: "copy path",
  imagePathCopied: "path copied",
  copyImagePathFailed: "Could not copy the path.",
  imageShelfTitle: "Images",
  imageOpenInTab: "Open in new tab",
  imageOpenInViewer: "Open in the viewer (Alt+click)",
  imageShowInTerminal: "Show in terminal",
  linkOpen: "Open",
  linkCopy: "Copy",
  linkCopied: "Copied",
  linkCopyFailed: "Could not copy.",
  linkLookupFailed: "Could not check the file paths on the terminal screen.",
  imageOriginPane: (index, title) =>
    title ? `Pane ${index} · ${title}` : `Pane ${index}`,
  imageOriginUnknown: "Unknown pane",
  imageOriginsOthers: "Also in",
  imageOriginFailed:
    "Could not read the tmux panes, so the image shelf cannot tell which pane an image came from.",
  imageRevealFailed: "Could not show the image's line in the terminal.",
  imageRevealNotFound: "The path is no longer in the terminal.",
  imageShelfCollapse: "collapse images",
  imageShelfMove: "Move the image shelf",
  imageShelfPlacementNames: {
    right: "Right of the terminal",
    left: "Left of the terminal",
    bottom: "Below the terminal",
    top: "Above the terminal",
  },
  imageShelfResize: "Resize the image shelf",
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
  pasteSaved: (relativePath) =>
    `Pasted image saved in this project as ${relativePath} (not tracked by git); its path is typed for the agent.`,
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
  tabEnded: (name) => `${name} は終了しました`,
  shellEndedByRestart: "サーバの再起動でシェルが終わりました",
  shellEndedByRestartHint:
    "繋ぎ直す先がありません。このタブで新しいシェルを開けます。",
  reopenShell: "新しいシェルで開き直す",
  tmuxWindowSmaller: (cols, rows, shared) =>
    shared
      ? `tmux のウインドウは ${cols}×${rows} です（同じセッションを開いている別の端末の大きさに合わせています）`
      : `tmux のウインドウは ${cols}×${rows} です（tmux の window-size の設定で、この端末より小さくなっています）`,
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
  imageOpenInTab: "新しいタブで開く",
  imageOpenInViewer: "拡大表示で開く (Alt+クリック)",
  imageShowInTerminal: "ターミナルで見る",
  linkOpen: "開く",
  linkCopy: "コピー",
  linkCopied: "コピーしました",
  linkCopyFailed: "コピーできませんでした。",
  linkLookupFailed: "画面のファイルのパスを確かめられませんでした。",
  imageOriginPane: (index, title) =>
    title ? `ペイン ${index} · ${title}` : `ペイン ${index}`,
  imageOriginUnknown: "出た所が不明",
  imageOriginsOthers: "ほかに出た所",
  imageOriginFailed:
    "tmux のペインを読めませんでした。画像がどのペインに出たかを示せません。",
  imageRevealFailed: "画像の行をターミナルで示せませんでした。",
  imageRevealNotFound: "そのパスはもうターミナルにありません。",
  imageShelfCollapse: "画像の棚を畳む",
  imageShelfMove: "画像の棚の場所を移す",
  imageShelfPlacementNames: {
    right: "ターミナルの右",
    left: "ターミナルの左",
    bottom: "ターミナルの下",
    top: "ターミナルの上",
  },
  imageShelfResize: "画像の棚の大きさを変える",
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
  pasteSaved: (relativePath) =>
    `貼り付けた画像をこのプロジェクトの ${relativePath} に保存し、エージェントに渡すパスを入力しました (git には入りません)。`,
  lastPrompt: "最後に出した指示",
  elapsed: elapsedFormatter("今", "分", "時間", "日"),
};

export function terminalText(lang: TerminalLang): TerminalText {
  return lang === "ja" ? JA : EN;
}
