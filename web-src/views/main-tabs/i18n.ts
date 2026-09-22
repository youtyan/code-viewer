// メインの面のタブ列の文言。page のタブの名前は画面の入口と同じ文言を
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
  /** ターミナルのタブの右クリック: シェルを止める (タブを閉じるのとは別)。 */
  stopSession: string;
  stopSessionTitle: string;
  splitUnavailable: string;
  resizeSplit: string;
  dropToSplit: string;
  /** 画像のタブのメニュー: そのファイルの履歴。 */
  fileHistory: string;
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
  newTab: "New tab: a file, a new shell, or a session",
  stopSession: "Stop session",
  stopSessionTitle:
    "End this shell (Close only hides the tab and keeps the shell running)",
  splitUnavailable:
    "Split right (a terminal or image tab in front, one side, and a window wide enough for two)",
  resizeSplit: "Resize the two sides",
  dropToSplit: "Drop to split right",
  fileHistory: "File history",
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
  newTab: "新しいタブ: ファイル・新しいシェル・セッション",
  stopSession: "セッションを止める",
  stopSessionTitle:
    "このシェルを終了します (閉じるはタブを隠すだけで、シェルは動き続けます)",
  splitUnavailable:
    "右に分割 (前面がターミナルか画像のタブ・1 面・2 面が置ける窓の幅のときに使えます)",
  resizeSplit: "左右の幅を変える",
  dropToSplit: "ここに落とすと右に分割",
  fileHistory: "ファイルの履歴",
  previewHint:
    "仮のタブ: 次に開いたファイルで置き換わります。ダブルクリックで開いたままにします。",
};

export function mainTabsText(lang: MainTabsLang): MainTabsText {
  return lang === "ja" ? JA : EN;
}
