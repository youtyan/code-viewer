export type CodePreviewLanguage = "en" | "ja";

export type CodePreviewText = {
  loadingCode: string;
  fileChanged: string;
  lines: (start: number, end: number, total?: number) => string;
  noText: string;
  codeLoadFailed: (error: string) => string;
  unknownError: string;
};

const EN: CodePreviewText = {
  loadingCode: "Loading code context...",
  fileChanged: "The file changed. Move the selection to refresh this context.",
  lines: (start, end, total) =>
    `Lines ${start}-${end}${total === undefined ? "" : ` of ${total}`}`,
  noText: "No text is available for this range.",
  codeLoadFailed: (error) => `Failed to load code context: ${error}`,
  unknownError: "unknown error",
};

const JA: CodePreviewText = {
  loadingCode: "コードの前後を読み込み中...",
  fileChanged:
    "ファイルが変更されました。選択を動かして再読み込みしてください。",
  lines: (start, end, total) =>
    `${start}-${end} 行${total === undefined ? "" : ` / 全 ${total} 行`}`,
  noText: "この範囲に表示できるテキストはありません。",
  codeLoadFailed: (error) => `コードの前後を読み込めませんでした: ${error}`,
  unknownError: "不明なエラー",
};

export function codePreviewText(
  language: CodePreviewLanguage,
): CodePreviewText {
  return language === "ja" ? JA : EN;
}
