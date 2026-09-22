// メインの面のタブ列の文言。page のタブの名前は上の行の入口と同じ文言を
// 使うので、ここには持たない (app.ts の uiText().nav から渡す)。

export type MainTabsLang = "en" | "ja";

export type MainTabsText = {
  tabList: string;
  close: string;
  closeTab: (name: string) => string;
  closeOthers: string;
  closeToRight: string;
  keepOpen: string;
  splitRight: string;
  moveToOtherSide: string;
  copyPath: string;
  newTab: string;
  splitUnavailable: string;
  previewHint: string;
};

const EN: MainTabsText = {
  tabList: "Open tabs",
  close: "Close",
  closeTab: (name) => `Close ${name}`,
  closeOthers: "Close others",
  closeToRight: "Close to the right",
  keepOpen: "Keep open",
  splitRight: "Split right",
  moveToOtherSide: "Move to other side",
  copyPath: "Copy path",
  newTab: "Open a file (⌘K)",
  splitUnavailable: "Split right (not available yet)",
  previewHint:
    "Preview tab: the next file you open replaces it. Double-click to keep it open.",
};

const JA: MainTabsText = {
  tabList: "開いているタブ",
  close: "閉じる",
  closeTab: (name) => `${name} を閉じる`,
  closeOthers: "ほかを閉じる",
  closeToRight: "右側を閉じる",
  keepOpen: "開いたままにする",
  splitRight: "右に分割",
  moveToOtherSide: "反対側へ移す",
  copyPath: "パスをコピー",
  newTab: "ファイルを開く (⌘K)",
  splitUnavailable: "右に分割 (まだ使えません)",
  previewHint:
    "仮のタブ: 次に開いたファイルで置き換わります。ダブルクリックで開いたままにします。",
};

export function mainTabsText(lang: MainTabsLang): MainTabsText {
  return lang === "ja" ? JA : EN;
}
