// Definition menus are short-lived and rebuilt for every trigger, so they do
// not need a localize hook. The next menu reads STATE.language again.

export type DefinitionJumpLanguage = "en" | "ja";

export type DefinitionJumpText = {
  searching: (symbol: string) => string;
  noDefinition: (symbol: string) => string;
  referencesHeader: (count: number, truncated: boolean) => string;
  openSearchPanel: string;
  searchFailed: (message: string) => string;
  unknownError: string;
};

const EN: DefinitionJumpText = {
  searching: (symbol) => `Searching for the definition of “${symbol}”…`,
  noDefinition: (symbol) => `No definition found for “${symbol}”`,
  referencesHeader: (count, truncated) =>
    `References (${count}${truncated ? "+" : ""})`,
  openSearchPanel: "Search this symbol in the search panel",
  searchFailed: (message) => `Definition search failed: ${message}`,
  unknownError: "unknown error",
};

const JA: DefinitionJumpText = {
  searching: (symbol) => `「${symbol}」の定義を検索中…`,
  noDefinition: (symbol) => `「${symbol}」の定義は見つかりませんでした`,
  referencesHeader: (count, truncated) =>
    `参照箇所 (${count}${truncated ? "+" : ""} 件)`,
  openSearchPanel: "このシンボル名で検索パネルを開く",
  searchFailed: (message) => `定義の検索に失敗しました: ${message}`,
  unknownError: "不明なエラー",
};

export function definitionJumpText(
  language: DefinitionJumpLanguage,
): DefinitionJumpText {
  return language === "ja" ? JA : EN;
}
