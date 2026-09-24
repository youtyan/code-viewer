// キーボードショートカットの小窓 (views/quick-help.ts) の文言。ヘルプのページの
// 「キーボードショートカット」のボタンも同じ名前を使う。

export type QuickHelpText = {
  panelTitle: string;
  close: string;
  viewAll: string;
  settings: string;
};

const TEXT: Record<"en" | "ja", QuickHelpText> = {
  en: {
    panelTitle: "Keyboard shortcuts",
    close: "Close keyboard shortcuts",
    viewAll: "View all keys →",
    settings: "Settings →",
  },
  ja: {
    panelTitle: "キーボードショートカット",
    close: "キーボードショートカットを閉じる",
    viewAll: "すべてのキーを見る →",
    settings: "設定 →",
  },
};

export function quickHelpText(lang: "en" | "ja"): QuickHelpText {
  return TEXT[lang];
}
