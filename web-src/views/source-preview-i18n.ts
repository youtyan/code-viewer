export type DelimitedPreviewLanguage = "en" | "ja";
export type DelimitedPreviewFormat = "csv" | "tsv";

export type DelimitedPreviewText = {
  searchLabel: string;
  searchPlaceholder: string;
  resetLabel: string;
  resetAction: string;
  resultCount: (visible: number, total: number) => string;
  resultCountLabel: string;
  columnLabel: (index: number) => string;
  columnFilterLabel: (column: string) => string;
  columnFilterPlaceholder: string;
  sortAscending: (column: string) => string;
  sortDescending: (column: string) => string;
  clearSort: (column: string) => string;
  noMatches: string;
};

const DELIMITED_PREVIEW_TEXT: Record<
  DelimitedPreviewLanguage,
  (format: DelimitedPreviewFormat) => DelimitedPreviewText
> = {
  en: (format) => ({
    searchLabel: `Search all ${format.toUpperCase()} columns`,
    searchPlaceholder: "Search all columns…",
    resetLabel: "Reset",
    resetAction: "Clear search, column filters, and sorting",
    resultCount: (visible, total) => `${visible} / ${total} rows`,
    resultCountLabel: `Visible ${format.toUpperCase()} rows`,
    columnLabel: (index) => `Column ${index}`,
    columnFilterLabel: (column) => `Filter ${column}`,
    columnFilterPlaceholder: "Filter…",
    sortAscending: (column) => `Sort ${column} ascending`,
    sortDescending: (column) => `Sort ${column} descending`,
    clearSort: (column) => `Clear sorting for ${column}`,
    noMatches: "No rows match the current filters.",
  }),
  ja: (format) => ({
    searchLabel: `${format.toUpperCase()}の全列を検索`,
    searchPlaceholder: "全列を検索…",
    resetLabel: "リセット",
    resetAction: "検索、列フィルタ、並べ替えを解除",
    resultCount: (visible, total) => `${visible} / ${total} 行`,
    resultCountLabel: `表示中の${format.toUpperCase()}行数`,
    columnLabel: (index) => `列 ${index}`,
    columnFilterLabel: (column) => `${column}を絞り込み`,
    columnFilterPlaceholder: "絞り込み…",
    sortAscending: (column) => `${column}を昇順に並べ替え`,
    sortDescending: (column) => `${column}を降順に並べ替え`,
    clearSort: (column) => `${column}の並べ替えを解除`,
    noMatches: "現在の条件に一致する行はありません。",
  }),
};

export function delimitedPreviewText(
  language: DelimitedPreviewLanguage,
  format: DelimitedPreviewFormat,
): DelimitedPreviewText {
  return DELIMITED_PREVIEW_TEXT[language](format);
}

export const SOURCE_READING_TEXT = {
  en: {
    line: "Go to line",
    go: "Go",
    tabPreview: "Preview",
    tabCode: "Code",
    tabBlame: "Blame",
    tabHistory: "History",
    total: (n: number) => `${n.toLocaleString()} lines`,
    blameOlder: "Older",
    blameNewer: "Newer",
    blameUncommitted: "Uncommitted",
    blameOpenCommit: "open this commit in history",
    blameLoading: "Loading blame…",
    loadingFile: "Loading file",
    fileAtRef: (path: string, ref: string) => `${path} at ${ref}`,
    cancel: "Cancel",
    cancelTitle: "Cancel loading (Esc)",
    stillLoading: (seconds: number) => `Still loading file (${seconds}s)`,
    slowNote: (seconds: number) =>
      `Taking longer than usual (${seconds}s elapsed). You can cancel below.`,
    cannotLoad: (path: string, ref: string) => `Cannot load ${path} at ${ref}`,
    loadingCancelled: "Loading cancelled",
    reopen: "Reopen",
    downloadRaw: "Download raw",
    unsupported: "This file type cannot be previewed safely in the browser.",
    internalMetadata:
      "Git internal metadata is not previewed from the file viewer.",
    copySource: "Copy source",
    findInFile: "Find in file",
    findPrev: "Prev",
    findNext: "Next",
    findClose: "Close",
    searching: "Searching...",
    searchFailed: "Search failed",
    virtualMode: "Virtual mode",
    virtualSummary: (lines: string, size: string) =>
      `${lines} lines, ${size}. Only visible rows are rendered. Highlighting is per-line.`,
    pagedSummary: (lines: string, size: string) =>
      `${lines} lines loaded from ${size}. More rows load as you scroll.`,
    openFullView: "Open full view",
    openFullViewTitle:
      "Render every line without virtualization. This can be slow for large files.",
    openFullViewPagedTitle:
      "Render every line without paged loading. This can be slow for large files.",
    openRaw: "Open raw",
    openRawFile: "Open raw file",
    sourceCode: (path: string) => `${path} source code`,
    copyFilePath: "copy file path",
    previewUnavailable: "Preview unavailable",
  },
  ja: {
    line: "行へ移動",
    go: "移動",
    tabPreview: "プレビュー",
    tabCode: "コード",
    tabBlame: "Blame",
    tabHistory: "履歴",
    total: (n: number) => `${n.toLocaleString()} 行`,
    blameOlder: "古い",
    blameNewer: "新しい",
    blameUncommitted: "未コミット",
    blameOpenCommit: "このコミットを履歴で開く",
    blameLoading: "Blame を読み込み中…",
    loadingFile: "ファイルを読み込み中",
    fileAtRef: (path: string, ref: string) => `${ref} の ${path}`,
    cancel: "中止",
    cancelTitle: "読み込みを中止 (Esc)",
    stillLoading: (seconds: number) => `まだ読み込み中 (${seconds}秒)`,
    slowNote: (seconds: number) =>
      `いつもより時間がかかっています (${seconds}秒経過)。下のボタンで中止できます。`,
    cannotLoad: (path: string, ref: string) =>
      `${ref} の ${path} を読み込めません`,
    loadingCancelled: "読み込みを中止しました",
    reopen: "開き直す",
    downloadRaw: "元のファイルをダウンロード",
    unsupported: "この種類のファイルはブラウザで安全に表示できません。",
    internalMetadata: "Git の内部のファイルはここでは表示しません。",
    copySource: "中身をコピー",
    findInFile: "ファイル内を検索",
    findPrev: "前へ",
    findNext: "次へ",
    findClose: "閉じる",
    searching: "検索中...",
    searchFailed: "検索できませんでした",
    virtualMode: "部分表示",
    virtualSummary: (lines: string, size: string) =>
      `${lines} 行・${size}。見えている行だけを描き、色付けは行ごとです。`,
    pagedSummary: (lines: string, size: string) =>
      `${size} のうち ${lines} 行を読み込みました。スクロールすると続きを読み込みます。`,
    openFullView: "すべて表示",
    openFullViewTitle:
      "部分表示をやめてすべての行を描きます。大きなファイルでは時間がかかります。",
    openFullViewPagedTitle:
      "少しずつの読み込みをやめてすべての行を描きます。大きなファイルでは時間がかかります。",
    openRaw: "元のファイルを開く",
    openRawFile: "元のファイルを開く",
    sourceCode: (path: string) => `${path} の中身`,
    copyFilePath: "ファイルのパスをコピー",
    previewUnavailable: "プレビューできません",
  },
};

/** Markdown のプレビューの部品 (目次・コードのコピー・Mermaid)。描くときの言語で入れる。 */
export const MARKDOWN_PREVIEW_TEXT = {
  en: {
    contents: "Markdown contents",
    copyCode: "Copy code",
    mermaidRenderFailed: "Mermaid could not render this diagram.",
    mermaidSyntaxError: "Mermaid syntax error",
    mermaidLoadFailed: "Mermaid could not be loaded",
    noDetail: "No detail available.",
    source: "source",
    lightboxHint:
      "drag to pan · wheel to zoom · double-click to fit · ESC to close",
    sizeEstimated: " · size estimated from the layout",
    zoomIn: "zoom in",
    zoomOut: "zoom out",
    fit: "fit",
    close: "close",
  },
  ja: {
    contents: "Markdown の見出し",
    copyCode: "コードをコピー",
    mermaidRenderFailed: "Mermaid がこの図を描けませんでした。",
    mermaidSyntaxError: "Mermaid の書き方の誤り",
    mermaidLoadFailed: "Mermaid を読み込めませんでした",
    noDetail: "詳しい情報はありません。",
    source: "元の文字",
    lightboxHint:
      "ドラッグで移動 · ホイールで拡大縮小 · ダブルクリックで全体 · ESC で閉じる",
    sizeEstimated: " · 大きさは配置から見積もりました",
    zoomIn: "拡大",
    zoomOut: "縮小",
    fit: "全体を表示",
    close: "閉じる",
  },
};

/** 動画・音声の再生の操作。プレーヤーを作るときの言語で入れる。 */
export const MEDIA_PLAYER_TEXT = {
  en: {
    player: (kind: "video" | "audio", title: string) =>
      `${kind === "video" ? "Video" : "Audio"} player: ${title}`,
    play: "Play",
    pause: "Pause",
    seek: "Seek",
    mute: "Mute",
    unmute: "Unmute",
    volume: "Volume",
    playbackSpeed: "Playback speed",
    enterFullscreen: "Enter fullscreen",
    exitFullscreen: "Exit fullscreen",
  },
  ja: {
    player: (kind: "video" | "audio", title: string) =>
      `${kind === "video" ? "動画" : "音声"}の再生: ${title}`,
    play: "再生",
    pause: "一時停止",
    seek: "再生位置",
    mute: "消音",
    unmute: "消音を解除",
    volume: "音量",
    playbackSpeed: "再生速度",
    enterFullscreen: "全画面表示",
    exitFullscreen: "全画面表示を終了",
  },
};
