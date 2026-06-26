// データベースビューアの文言ローカライズ。アプリ全体の言語設定
// (app.ts の STATE.language / 設定の en/ja トグル) と同じ値で切り替える。
// アプリ shell 側は app.ts の UI_TEXT を使うが、DB ビューアは独立した
// DOM 構築なので、ここに DB 用の小さな文字列テーブルを置く。

export type DbLang = "en" | "ja";

export type DbGridText = {
  /** エクスポート操作のラベル/ツールチップ。 */
  exportAction: string;
  /** FK セルのヒント（クリックで関連データ）。 */
  foreignKeyHint: string;
  /** 関連パネルで参照先が 0 件のときの空表示。 */
  relatedEmpty: string;
};

const DB_TEXT: Record<DbLang, DbGridText> = {
  en: {
    exportAction: "Export",
    foreignKeyHint: "Foreign key — click to view related rows",
    relatedEmpty: "No matching row in the referenced table",
  },
  ja: {
    exportAction: "エクスポート",
    foreignKeyHint: "外部キー: クリックして関連データを表示",
    relatedEmpty: "参照先に該当する行がありません",
  },
};

export function dbGridText(lang: DbLang): DbGridText {
  return DB_TEXT[lang] ?? DB_TEXT.en;
}
