// Diff の画面の文言。カードの見出し・置き札・帯は描くときに文言を入れるので、
// 言語を切り替えたら diff-view の relocalize で描き直す。

export type DiffViewText = {
  files(count: number): string;
  updated(time: string): string;
  updatedTitle: string;
  kindAdded: string;
  kindDeleted: string;
  kindRenamed: string;
  kindHeavy: string;
  kindBinary: string;
  kindMedia: string;
  viewedProgress(viewed: number, total: number): string;
  viewedProgressTitle: string;
  nextUnviewed: string;
  nextUnviewedTitle: string;
  allViewed: string;
  allViewedTitle: string;
  /** ファイルの見出し (diff2html の「Viewed」も書き換える)。 */
  viewed: string;
  preview: string;
  previewTitle: string;
  viewFile: string;
  viewFileTitle: string;
  viewDiff: string;
  viewDiffTitle: string;
  collapseFile: string;
  copyFilePath: string;
  expandFile: string;
  expandAllLines: string;
  collapseExpandedLines: string;
  expandContextFailed: string;
  currentBranch(branch: string): string;
  filePath: string;
  openParentFolder: string;
  noContent: string;
  /** 自動では読み込まないファイルの理由。 */
  manualReason: Record<ManualLoadReason, string>;
  manualNote(reason: string): string;
  loadPreview: string;
  openAsFile: string;
  openAsFileTitle: string;
  loadFullDiff: string;
  loadFullDiffTitle: string;
  showNextHunks(count: number): string;
  showAllHunks(remaining: number): string;
  hunksShown(shown: number, total: number): string;
  loading: string;
  dataChanged: string;
  failedRetry: string;
  loadFailed: string;
  retry: string;
};

export type ManualLoadReason = "huge" | "minified" | "sourceMap" | "generated";

/** app.ts の空の Diff の案内まで含めた Diff の画面の文言。 */
export type DiffScreenText = DiffViewText & {
  /** 変更ファイルの一覧の印と、差分の行の展開 (hunk-expand)。 */
  kindTagBinary: string;
  kindTagHeavy: string;
  invalidRegex: string;
  /** 差分の一覧 (変更ファイル) の名前 (支援技術向け)。 */
  fileListLabel: string;
  showMoreLines: (count: number) => string;
  showMoreLinesUnknown: string;
  openInOs: string;
  openInOsFailed: string;
  noChangesTitle: string;
  noChangesBody: string;
  noChangesReload: string;
  noChangesReloadTitle: string;
  noChangesHistory: string;
  noChangesHistoryTitle: string;
  emptyDiffTitle: string;
  emptyDiffBody: string;
  noCommitSelectedTitle: string;
  noCommitSelectedBody: string;
};

const EN: DiffScreenText = {
  kindTagBinary: "binary/media file",
  kindTagHeavy: "large diff",
  invalidRegex: "invalid regular expression",
  fileListLabel: "Changed files",
  showMoreLines: (count) => `Show ${count} more lines`,
  showMoreLinesUnknown: "Show more lines",
  openInOs: "open in OS",
  openInOsFailed: "failed to open in OS",
  files: (count) => `${count} file${count === 1 ? "" : "s"}`,
  updated: (time) => `updated ${time}`,
  updatedTitle: "last updated",
  kindAdded: "added",
  kindDeleted: "deleted",
  kindRenamed: "renamed",
  kindHeavy: "heavy",
  kindBinary: "binary",
  kindMedia: "media",
  viewedProgress: (viewed, total) => `${viewed}/${total} viewed`,
  viewedProgressTitle: "review progress",
  nextUnviewed: "next unviewed",
  nextUnviewedTitle: "Jump to the next unviewed file (n)",
  allViewed: "all viewed",
  allViewedTitle: "All visible files are viewed",
  viewed: "Viewed",
  preview: "Preview",
  previewTitle: "Preview rendered file",
  viewFile: "View File",
  viewFileTitle: "View file",
  viewDiff: "View Diff",
  viewDiffTitle: "View diff",
  collapseFile: "Collapse file",
  copyFilePath: "copy file path",
  expandFile: "Expand file",
  expandAllLines: "Expand all lines",
  collapseExpandedLines: "Collapse expanded lines",
  expandContextFailed: "Could not show some of the hidden lines",
  currentBranch: (branch) => `Current branch: ${branch}`,
  filePath: "File path",
  openParentFolder: "open parent folder in OS",
  noContent: "No content",
  manualReason: {
    huge: "huge diff",
    minified: "minified or bundled file",
    sourceMap: "source map",
    generated: "generated or vendored path",
  },
  manualNote: (reason) => `${reason} - click to load diff`,
  loadPreview: "Load preview",
  openAsFile: "Open as file",
  openAsFileTitle: "Open this file in the virtualized source viewer",
  loadFullDiff: "Load full diff",
  loadFullDiffTitle:
    "Render the full diff with Diff2Html. This can be slow for large files.",
  showNextHunks: (count) => `Show next ${count} hunk${count === 1 ? "" : "s"}`,
  showAllHunks: (remaining) => `Show all (${remaining} remaining)`,
  hunksShown: (shown, total) => `${shown} / ${total} hunks shown`,
  loading: "Loading…",
  dataChanged: "Data changed — reload",
  failedRetry: "Failed — retry",
  loadFailed: "failed to load",
  retry: "retry",
  noChangesTitle: "No changes",
  noChangesBody: "The working tree is clean against this ref.",
  noChangesReload: "Reload diff",
  noChangesReloadTitle: "Reload this diff range",
  noChangesHistory: "Open history",
  noChangesHistoryTitle: "Open commit history for this range",
  emptyDiffTitle: "Empty diff",
  emptyDiffBody: "This commit has no changes against its first parent.",
  noCommitSelectedTitle: "No commit selected",
  noCommitSelectedBody: "Select a commit from the list to see its changes.",
};

const JA: DiffScreenText = {
  kindTagBinary: "バイナリ・メディアのファイル",
  kindTagHeavy: "大きな差分",
  invalidRegex: "正規表現が正しくありません",
  fileListLabel: "変更ファイル",
  showMoreLines: (count) => `あと ${count} 行を表示`,
  showMoreLinesUnknown: "続きの行を表示",
  openInOs: "OS で開く",
  openInOsFailed: "OS で開けませんでした",
  files: (count) => `${count}ファイル`,
  updated: (time) => `更新 ${time}`,
  updatedTitle: "最終更新",
  kindAdded: "追加",
  kindDeleted: "削除",
  kindRenamed: "名前変更",
  kindHeavy: "大容量",
  kindBinary: "バイナリ",
  kindMedia: "メディア",
  viewedProgress: (viewed, total) => `${viewed}/${total} 確認済み`,
  viewedProgressTitle: "確認進捗",
  nextUnviewed: "次の未確認",
  nextUnviewedTitle: "次の未確認ファイルへ移動 (n)",
  allViewed: "すべて確認済み",
  allViewedTitle: "表示中のファイルはすべて確認済みです",
  viewed: "確認済み",
  preview: "プレビュー",
  previewTitle: "描画したファイルをプレビュー",
  viewFile: "ファイルを見る",
  viewFileTitle: "ファイルを見る",
  viewDiff: "差分を見る",
  viewDiffTitle: "差分を見る",
  collapseFile: "ファイルを畳む",
  copyFilePath: "ファイルのパスをコピー",
  expandFile: "ファイルを開く",
  expandAllLines: "すべての行を表示",
  collapseExpandedLines: "表示した行を畳む",
  expandContextFailed: "隠れている行の一部を表示できませんでした",
  currentBranch: (branch) => `現在のブランチ: ${branch}`,
  filePath: "ファイルのパス",
  openParentFolder: "親フォルダを OS で開く",
  noContent: "内容がありません",
  manualReason: {
    huge: "差分が大きいファイル",
    minified: "圧縮・バンドルされたファイル",
    sourceMap: "ソースマップ",
    generated: "生成物・同梱のフォルダ",
  },
  manualNote: (reason) => `${reason}なので自動では読み込みません`,
  loadPreview: "一部を読み込む",
  openAsFile: "ファイルとして開く",
  openAsFileTitle: "大きなファイル向けの表示でこのファイルを開きます",
  loadFullDiff: "差分をすべて読み込む",
  loadFullDiffTitle:
    "差分をすべて Diff2Html で描きます。大きなファイルでは時間がかかります。",
  showNextHunks: (count) => `次の ${count} 個の変更を表示`,
  showAllHunks: (remaining) => `すべて表示（残り ${remaining} 個）`,
  hunksShown: (shown, total) => `${total} 個の変更のうち ${shown} 個を表示`,
  loading: "読み込み中…",
  dataChanged: "内容が変わりました — 読み直す",
  failedRetry: "失敗しました — もう一度",
  loadFailed: "読み込めませんでした",
  retry: "もう一度",
  noChangesTitle: "変更はありません",
  noChangesBody: "この参照との差分はありません。",
  noChangesReload: "diff を更新",
  noChangesReloadTitle: "この差分範囲を再読み込み",
  noChangesHistory: "履歴を開く",
  noChangesHistoryTitle: "この範囲のコミット履歴を開く",
  emptyDiffTitle: "空の差分",
  emptyDiffBody: "このコミットは最初の親との差分がありません。",
  noCommitSelectedTitle: "コミット未選択",
  noCommitSelectedBody: "一覧からコミットを選ぶと変更内容を表示します。",
};

export const DIFF_SCREEN_TEXT: Record<"en" | "ja", DiffScreenText> = {
  en: EN,
  ja: JA,
};
