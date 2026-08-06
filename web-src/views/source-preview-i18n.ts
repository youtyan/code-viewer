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
