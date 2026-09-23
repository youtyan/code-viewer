// メインの面のタブ列の文言。page のタブの名前は画面の入口と同じ文言を
// 使うので、ここには持たない (app.ts の uiText().nav から渡す)。

export type MainTabsLang = "en" | "ja";

type MainTabsText = {
  /** タブ列の名前。2 面なら左右が分かるように (side が null なら 1 面)。 */
  tabList: (side: "left" | "right" | null) => string;
  close: string;
  closeTab: (name: string) => string;
  closeOthers: string;
  closeToRight: string;
  keepOpen: string;
  splitRight: string;
  moveToOtherSide: string;
  moveLeft: string;
  moveRight: string;
  copyPath: string;
  newTab: string;
  /** ターミナルのタブの右クリック: シェルを止める (タブを閉じるのとは別)。 */
  stopSession: string;
  stopSessionTitle: string;
  /** 分割のボタンを押せない理由 (core/main-tabs.ts の splitBlocker と窓の幅)。 */
  splitBlocked: Record<"split" | "no-front" | "page" | "narrow", string>;
  /** 2 面のときの右の面のボタン: 右のタブを左へ移して 1 面に戻す。 */
  unsplit: string;
  /** 窓が狭くて右の面を隠している間の、分割のボタンの説明。 */
  rightParked: (count: number) => string;
  /**
   * 一覧の列の一覧 (Diff・History・作業ツリー) を出すために右の面を隠している
   * 間の説明。一覧を詰めて列を畳んでも、本文が 2 面の下限に足りない。
   */
  rightParkedForList: (count: number) => string;
  resizeSplit: string;
  dropToSplit: string;
  /** 電話の段のタブ列の右端: 開いているタブの一覧を出すボタン (枚数は右の面の預けた分も)。 */
  openTabs: (count: number) => string;
  /** 画像のタブのメニュー: そのファイルの履歴。 */
  fileHistory: string;
  previewHint: string;
};

const EN: MainTabsText = {
  tabList: (side) => (side === null ? "Open tabs" : `Open tabs, ${side} side`),
  close: "Close",
  closeTab: (name) => `Close ${name}`,
  closeOthers: "Close others",
  closeToRight: "Close to the right",
  keepOpen: "Keep open",
  splitRight: "Split right",
  moveToOtherSide: "Move to other side",
  moveLeft: "Move left",
  moveRight: "Move right",
  copyPath: "Copy path",
  newTab: "New tab: a file, a new shell, or a session",
  stopSession: "Stop session",
  stopSessionTitle:
    "End this shell (Close only hides the tab and keeps the shell running)",
  splitBlocked: {
    split: "Split right: already two sides",
    "no-front": "Split right: open a file, terminal or image tab first",
    page: "Split right: this screen stays on the left. Bring a file, terminal or image tab to the front",
    narrow: "Split right: the window is too narrow for two sides",
  },
  unsplit:
    "Back to one side (moves the right tabs to the left; a file already open on the left closes on the right)",
  rightParked: (count) =>
    `The right side (${count} tab${count === 1 ? "" : "s"}) is hidden because the window is too narrow for two sides. It comes back when the window is wide enough.`,
  rightParkedForList: (count) =>
    `The right side (${count} tab${count === 1 ? "" : "s"}) is set aside to make room for this screen's list in the left column. It comes back when you move to another screen or widen the window.`,
  resizeSplit: "Resize the two sides",
  openTabs: (count) => `Open tabs (${count})`,
  dropToSplit: "Drop to split right",
  fileHistory: "File history",
  previewHint:
    "Preview tab: the next file you open replaces it. Double-click to keep it open.",
};

const JA: MainTabsText = {
  tabList: (side) =>
    side === null
      ? "開いているタブ"
      : `開いているタブ (${side === "left" ? "左" : "右"}の面)`,
  close: "閉じる",
  closeTab: (name) => `${name} を閉じる`,
  closeOthers: "ほかを閉じる",
  closeToRight: "右側を閉じる",
  keepOpen: "開いたままにする",
  splitRight: "右に分割",
  moveToOtherSide: "反対側へ移す",
  moveLeft: "左へ移す",
  moveRight: "右へ移す",
  copyPath: "パスをコピー",
  newTab: "新しいタブ: ファイル・新しいシェル・セッション",
  stopSession: "セッションを止める",
  stopSessionTitle:
    "このシェルを終了します (閉じるはタブを隠すだけで、シェルは動き続けます)",
  splitBlocked: {
    split: "右に分割: もう 2 面です",
    "no-front":
      "右に分割: 先にファイル・ターミナル・画像のタブを開いてください",
    page: "右に分割: この画面は左の面だけに置きます。ファイル・ターミナル・画像のタブを前面にしてください",
    narrow: "右に分割: 窓が 2 面を置ける幅より狭いです",
  },
  unsplit:
    "1 面に戻す (右のタブを左へ移します。左で開いているファイルは右を閉じます)",
  rightParked: (count) =>
    `窓が 2 面を出せる幅より狭いので、右の面 (タブ ${count} 枚) を隠しています。2 面を出せる幅になれば戻ります。`,
  rightParkedForList: (count) =>
    `左の列の一覧 (差分・履歴・作業ツリー) のために、右の面 (タブ ${count} 枚) を預けています。別の画面に移るか窓を広げると戻ります。`,
  resizeSplit: "左右の幅を変える",
  openTabs: (count) => `開いているタブ (${count} 枚)`,
  dropToSplit: "ここに落とすと右に分割",
  fileHistory: "ファイルの履歴",
  previewHint:
    "仮のタブ: 次に開いたファイルで置き換わります。ダブルクリックで開いたままにします。",
};

export function mainTabsText(lang: MainTabsLang): MainTabsText {
  return lang === "ja" ? JA : EN;
}
