export type CodePreviewLanguage = "en" | "ja";

export type CodePreviewText = {
  loadingCode: string;
  fileChanged: string;
  /** その見本だけを読み直すボタン。 */
  reload: string;
  lines: (start: number, end: number, total?: number) => string;
  noText: string;
  codeLoadFailed: (error: string) => string;
};

const EN: CodePreviewText = {
  loadingCode: "Loading code context...",
  fileChanged: "The file changed after this context was read.",
  reload: "Reload",
  lines: (start, end, total) =>
    `Lines ${start}-${end}${total === undefined ? "" : ` of ${total}`}`,
  noText: "No text is available for this range.",
  codeLoadFailed: (error) => `Failed to load code context: ${error}`,
};

const JA: CodePreviewText = {
  loadingCode: "コードの前後を読み込み中...",
  fileChanged: "読んだ後にファイルが変わりました。",
  reload: "再読み込み",
  lines: (start, end, total) =>
    `${start}-${end} 行${total === undefined ? "" : ` / 全 ${total} 行`}`,
  noText: "この範囲に表示できるテキストはありません。",
  codeLoadFailed: (error) => `コードの前後を読み込めませんでした: ${error}`,
};

export function codePreviewText(
  language: CodePreviewLanguage,
): CodePreviewText {
  return language === "ja" ? JA : EN;
}
