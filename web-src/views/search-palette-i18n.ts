import {
  type CodePreviewLanguage,
  type CodePreviewText,
  codePreviewText,
} from "./code-preview-i18n";

export type SearchPaletteLanguage = CodePreviewLanguage;

export type SearchPaletteText = CodePreviewText & {
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
  matchCase: string;
  matchCaseTitle: string;
  wholeWord: string;
  wholeWordTitle: string;
  excludeTests: string;
  excludeTestsTitle: string;
  groupFiles: string;
  groupFilesTitle: string;
  grepHint: string;
  windowWidth: string;
  windowHeight: string;
  regexMode: string;
  caseSensitivity: string;
  wordMatching: string;
  fileGrouping: string;
  testExclusion: string;
  saveFailed: (label: string, error: string) => string;
  openFile: string;
  selectResult: string;
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
    caseSensitive: boolean;
    wholeWord: boolean;
    testsExcluded: boolean;
    truncated: boolean;
    count: number;
    paths: string[];
  }) => string;
  searchFailed: (error: string) => string;
  savingSelection: string;
  selectionSaveFailed: (error: string) => string;
  // Results sheet (bottom panel tab that keeps a grep result list open).
  pinResults: string;
  pinResultsTitle: string;
  resultsTitle: string;
  resultsOpen: string;
  resultsRun: string;
  resultsPlaceholder: string;
  resultsIdle: string;
  resultsScope: (ref: string) => string;
};

const EN: SearchPaletteText = {
  ...codePreviewText("en"),
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
  matchCase: "Aa",
  matchCaseTitle: "Match case (Alt+C)",
  wholeWord: "Word",
  wholeWordTitle: "Match whole words only (Alt+W)",
  excludeTests: "No test",
  excludeTestsTitle: "Exclude test/spec files",
  groupFiles: "Group files",
  groupFilesTitle: "Group matching lines by file",
  grepHint: "path:<dir or glob> narrows · Alt+R regex",
  windowWidth: "window width",
  windowHeight: "window height",
  regexMode: "regex mode",
  caseSensitivity: "case sensitivity",
  wordMatching: "whole-word matching",
  fileGrouping: "file grouping",
  testExclusion: "test exclusion",
  saveFailed: (label, error) => `Failed to save ${label}: ${error}`,
  openFile: "Open file",
  selectResult: "Select a result to preview its code context",
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
  grepSummary: ({
    engine,
    regex,
    caseSensitive,
    wholeWord,
    testsExcluded,
    truncated,
    count,
    paths,
  }) =>
    engine +
    (regex ? " regex" : " plain") +
    (caseSensitive ? " · match case" : "") +
    (wholeWord ? " · whole word" : "") +
    (testsExcluded ? " · tests excluded" : "") +
    (paths.length ? ` · in ${paths.join(" ")}` : "") +
    (truncated ? " truncated" : "") +
    ` - ${count} results`,
  searchFailed: (error) => `Search failed: ${error}`,
  savingSelection: "Saving selection...",
  selectionSaveFailed: (error) => `Failed to save selection: ${error}`,
  pinResults: "Pin",
  pinResultsTitle:
    "Keep these results open in the bottom panel while you browse (Ctrl+Enter)",
  resultsTitle: "Search",
  resultsOpen: "Open the search results panel",
  resultsRun: "Search",
  resultsPlaceholder: "Search text (path:<dir or glob> narrows)",
  resultsIdle: "Type a search and press Enter",
  resultsScope: (ref) => `in ${ref}`,
};

const JA: SearchPaletteText = {
  ...codePreviewText("ja"),
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
  matchCase: "Aa",
  matchCaseTitle: "大文字と小文字を区別 (Alt+C)",
  wholeWord: "単語",
  wholeWordTitle: "単語単位で一致 (Alt+W)",
  excludeTests: "テスト除外",
  excludeTestsTitle: "test/spec ファイルを除外",
  groupFiles: "ファイル別",
  groupFilesTitle: "一致した行をファイル別に表示",
  grepHint: "path:<ディレクトリ or glob> で絞り込み · Alt+R 正規表現",
  windowWidth: "ウィンドウの幅",
  windowHeight: "ウィンドウの高さ",
  regexMode: "正規表現モード",
  caseSensitivity: "大文字小文字の区別",
  wordMatching: "単語単位の一致",
  fileGrouping: "ファイル別表示",
  testExclusion: "テスト除外",
  saveFailed: (label, error) => `${label}を保存できませんでした: ${error}`,
  openFile: "ファイルを開く",
  selectResult: "結果を選ぶとコードの前後を表示します",
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
  grepSummary: ({
    engine,
    regex,
    caseSensitive,
    wholeWord,
    testsExcluded,
    truncated,
    count,
    paths,
  }) =>
    engine +
    (regex ? "・正規表現" : "・通常") +
    (caseSensitive ? "・大文字小文字を区別" : "") +
    (wholeWord ? "・単語単位" : "") +
    (testsExcluded ? "・テスト除外" : "") +
    (paths.length ? `・${paths.join(" ")} 内` : "") +
    (truncated ? "・一部表示" : "") +
    ` - ${count} 件`,
  searchFailed: (error) => `検索に失敗しました: ${error}`,
  savingSelection: "選択履歴を保存中...",
  selectionSaveFailed: (error) => `選択履歴を保存できませんでした: ${error}`,
  pinResults: "固定",
  pinResultsTitle: "この結果を下パネルに出したまま閲覧を続ける (Ctrl+Enter)",
  resultsTitle: "検索",
  resultsOpen: "検索結果パネルを開く",
  resultsRun: "検索",
  resultsPlaceholder:
    "検索するコード（path:<ディレクトリ or glob> で絞り込み）",
  resultsIdle: "検索語を入力して Enter",
  resultsScope: (ref) => `${ref} 内`,
};

export function searchPaletteText(
  language: SearchPaletteLanguage,
): SearchPaletteText {
  return language === "ja" ? JA : EN;
}
