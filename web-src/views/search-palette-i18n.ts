export type SearchPaletteLanguage = "en" | "ja";

export type SearchPaletteText = {
  files: string;
  grep: string;
  switchToFiles: string;
  switchToGrep: string;
  searchFiles: string;
  searchText: string;
  fileCodePreview: string;
  grepCodeContext: string;
  resizeWidth: string;
  resizeHeight: string;
  globHint: string;
  fuzzyHint: string;
  plain: string;
  regex: string;
  excludeTests: string;
  excludeTestsTitle: string;
  groupFiles: string;
  groupFilesTitle: string;
  regexHint: string;
  windowWidth: string;
  windowHeight: string;
  regexMode: string;
  fileGrouping: string;
  testExclusion: string;
  saveFailed: (label: string, error: string) => string;
  openFile: string;
  selectResult: string;
  loadingCode: string;
  fileChanged: string;
  lines: (start: number, end: number, total?: number) => string;
  noText: string;
  codeLoadFailed: (error: string) => string;
  line: (line: number, column: number) => string;
  diffFiles: (count: number) => string;
  typeToSearchFiles: string;
  recentFiles: (count: number) => string;
  loadingFiles: string;
  results: (
    count: number,
    total?: number,
    candidatesTruncated?: boolean,
  ) => string;
  noResults: string;
  typeToGrep: string;
  invalidRegex: string;
  searching: string;
  repositoryChanged: string;
  grepSummary: (options: {
    engine: string;
    regex: boolean;
    testsExcluded: boolean;
    truncated: boolean;
    count: number;
  }) => string;
  searchFailed: (error: string) => string;
  savingSelection: string;
  selectionSaveFailed: (error: string) => string;
  unknownError: string;
};

const EN: SearchPaletteText = {
  files: "Files",
  grep: "Grep",
  switchToFiles: "Switch to file search (Ctrl+K)",
  switchToGrep: "Switch to text search (Ctrl+G)",
  searchFiles: "Search files",
  searchText: "Search text",
  fileCodePreview: "File code preview",
  grepCodeContext: "Grep code context",
  resizeWidth: "Resize search window width",
  resizeHeight: "Resize search window height",
  globHint: "Glob: * ? []",
  fuzzyHint: "Fuzzy path search",
  plain: "Plain",
  regex: ".* Regex",
  excludeTests: "No test",
  excludeTestsTitle: "Exclude test/spec files",
  groupFiles: "Group files",
  groupFilesTitle: "Group matching lines by file",
  regexHint: "Alt+R regex",
  windowWidth: "window width",
  windowHeight: "window height",
  regexMode: "regex mode",
  fileGrouping: "file grouping",
  testExclusion: "test exclusion",
  saveFailed: (label, error) => `Failed to save ${label}: ${error}`,
  openFile: "Open file",
  selectResult: "Select a result to preview its code context",
  loadingCode: "Loading code context...",
  fileChanged: "The file changed. Move the selection to refresh this context.",
  lines: (start, end, total) =>
    `Lines ${start}-${end}${total === undefined ? "" : ` of ${total}`}`,
  noText: "No text is available for this range.",
  codeLoadFailed: (error) => `Failed to load code context: ${error}`,
  line: (line, column) => `Line ${line}:${column}`,
  diffFiles: (count) => `${count} diff files`,
  typeToSearchFiles: "Type to search repository files",
  recentFiles: (count) => `Recent files - ${count}`,
  loadingFiles: "Loading files...",
  results: (count, total, candidatesTruncated) =>
    (total === undefined
      ? `${count} results`
      : `${count} of ${total} results`) +
    (candidatesTruncated ? " · file list truncated" : ""),
  noResults: "No results",
  typeToGrep: "Type to grep",
  invalidRegex: "Invalid regular expression",
  searching: "Searching...",
  repositoryChanged: "Repository changed; search again",
  grepSummary: ({ engine, regex, testsExcluded, truncated, count }) =>
    engine +
    (regex ? " regex" : " plain") +
    (testsExcluded ? " · tests excluded" : "") +
    (truncated ? " truncated" : "") +
    ` - ${count} results`,
  searchFailed: (error) => `Search failed: ${error}`,
  savingSelection: "Saving selection...",
  selectionSaveFailed: (error) => `Failed to save selection: ${error}`,
  unknownError: "unknown error",
};

const JA: SearchPaletteText = {
  files: "ファイル",
  grep: "GREP",
  switchToFiles: "ファイル名検索に切り替え (Ctrl+K)",
  switchToGrep: "コード検索に切り替え (Ctrl+G)",
  searchFiles: "ファイルを検索",
  searchText: "コードを検索",
  fileCodePreview: "ファイルのコード表示",
  grepCodeContext: "GREP のコード前後",
  resizeWidth: "検索ウィンドウの幅を変更",
  resizeHeight: "検索ウィンドウの高さを変更",
  globHint: "Glob: * ? []",
  fuzzyHint: "パスのあいまい検索",
  plain: "通常",
  regex: ".* 正規表現",
  excludeTests: "テスト除外",
  excludeTestsTitle: "test/spec ファイルを除外",
  groupFiles: "ファイル別",
  groupFilesTitle: "一致した行をファイル別に表示",
  regexHint: "Alt+R 正規表現",
  windowWidth: "ウィンドウの幅",
  windowHeight: "ウィンドウの高さ",
  regexMode: "正規表現モード",
  fileGrouping: "ファイル別表示",
  testExclusion: "テスト除外",
  saveFailed: (label, error) => `${label}を保存できませんでした: ${error}`,
  openFile: "ファイルを開く",
  selectResult: "結果を選ぶとコードの前後を表示します",
  loadingCode: "コードの前後を読み込み中...",
  fileChanged:
    "ファイルが変更されました。選択を動かして再読み込みしてください。",
  lines: (start, end, total) =>
    `${start}-${end} 行${total === undefined ? "" : ` / 全 ${total} 行`}`,
  noText: "この範囲に表示できるテキストはありません。",
  codeLoadFailed: (error) => `コードの前後を読み込めませんでした: ${error}`,
  line: (line, column) => `${line} 行:${column}`,
  diffFiles: (count) => `差分ファイル ${count} 件`,
  typeToSearchFiles: "リポジトリ内のファイル名を入力してください",
  recentFiles: (count) => `最近開いたファイル - ${count} 件`,
  loadingFiles: "ファイルを読み込み中...",
  results: (count, total, candidatesTruncated) =>
    (total === undefined ? `${count} 件` : `${total} 件中 ${count} 件`) +
    (candidatesTruncated ? "・ファイル一覧は上限で打ち切り" : ""),
  noResults: "該当なし",
  typeToGrep: "検索するコードを入力してください",
  invalidRegex: "正規表現が正しくありません",
  searching: "検索中...",
  repositoryChanged: "リポジトリが変更されました。もう一度検索してください",
  grepSummary: ({ engine, regex, testsExcluded, truncated, count }) =>
    engine +
    (regex ? "・正規表現" : "・通常") +
    (testsExcluded ? "・テスト除外" : "") +
    (truncated ? "・一部表示" : "") +
    ` - ${count} 件`,
  searchFailed: (error) => `検索に失敗しました: ${error}`,
  savingSelection: "選択履歴を保存中...",
  selectionSaveFailed: (error) => `選択履歴を保存できませんでした: ${error}`,
  unknownError: "不明なエラー",
};

export function searchPaletteText(
  language: SearchPaletteLanguage,
): SearchPaletteText {
  return language === "ja" ? JA : EN;
}
