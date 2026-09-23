// 電話の幅の骨格 (views/mobile-shell.ts) の文言。言語はアプリ全体の設定
// (app.ts の STATE.language)。切替は html の lang の変化で当て直す。

import type { TerminalSoftKey } from "../core/mobile-layout";

export type MobileShellLang = "en" | "ja";

export type MobileShellText = {
  /** 下端の切替の帯そのものの名前。 */
  bar: string;
  /** 左のサイドバー (プロジェクトとエージェント) を引き出す。 */
  projects: string;
  /** Files (フォルダ表示) へ。 */
  files: string;
  /** Diff へ。 */
  diff: string;
  /** 全体ボード (エージェントの一覧) へ。 */
  agents: string;
  /** 「エージェント」の入口の名前に、入力待ちの件数を添えたもの。 */
  agentsWaiting: (count: number) => string;
  /** 一覧の列 (ファイル一覧か、その画面の一覧) を下から出す。 */
  list: string;
  /** 開いている引き出し・面を閉じる。 */
  close: string;
  /** 端末の操作札の並びの名前。 */
  keys: string;
  /** 札の名前 (読み上げと title)。札の文字は言語で変えない。 */
  keyLabel: Record<TerminalSoftKey, string>;
  /** ソフトキーボードを出す (端末に入力を向ける)。 */
  keyboard: string;
  /** ソフトキーボードをしまう (端末から入力を外す)。 */
  keyboardHide: string;
  /** 差分の長い行を折り返す切替 (札の文字と名前)。 */
  wrap: string;
  wrapTitle: string;
  /** 開いているタブの一覧の面の見出し。 */
  tabsTitle: (count: number) => string;
  /** タブが 1 枚も無いとき。 */
  tabsEmpty: string;
  /** 右の面に預けているタブの札 (電話では右の面を出さない)。 */
  tabsParked: string;
  tabsParkedTitle: string;
  /** 一覧の行のタブを閉じる。 */
  closeTab: (name: string) => string;
};

const EN: MobileShellText = {
  bar: "Switch view",
  projects: "Projects",
  files: "Files",
  diff: "Diff",
  agents: "Agents",
  agentsWaiting: (count) =>
    `Agents (${count} ${count === 1 ? "needs" : "need"} input)`,
  list: "List",
  close: "Close",
  keys: "Terminal keys",
  keyLabel: {
    escape: "Escape",
    tab: "Tab",
    shiftTab: "Shift+Tab",
    ctrlC: "Control+C (interrupt)",
    up: "Up arrow",
    down: "Down arrow",
    enter: "Enter",
  },
  keyboard: "Show keyboard",
  keyboardHide: "Hide keyboard",
  wrap: "Wrap",
  wrapTitle: "Wrap long lines in the diff",
  tabsTitle: (count) => `Open tabs (${count})`,
  tabsEmpty: "No open tabs",
  tabsParked: "Right",
  tabsParkedTitle:
    "On the right side (hidden on a phone). Opening it moves it to the left side.",
  closeTab: (name) => `Close ${name}`,
};

const JA: MobileShellText = {
  bar: "画面の切替",
  projects: "プロジェクト",
  files: "ファイル",
  diff: "差分",
  agents: "エージェント",
  agentsWaiting: (count) => `エージェント (入力待ち ${count})`,
  list: "一覧",
  close: "閉じる",
  keys: "端末のキー",
  keyLabel: {
    escape: "Esc",
    tab: "Tab",
    shiftTab: "Shift+Tab",
    ctrlC: "Ctrl+C (中断)",
    up: "上矢印",
    down: "下矢印",
    enter: "Enter",
  },
  keyboard: "キーボードを出す",
  keyboardHide: "キーボードをしまう",
  wrap: "折り返し",
  wrapTitle: "差分の長い行を折り返す",
  tabsTitle: (count) => `開いているタブ (${count} 枚)`,
  tabsEmpty: "開いているタブはありません",
  tabsParked: "右",
  tabsParkedTitle:
    "右の面のタブです (SP では右の面を出しません)。開くと左の面へ移します。",
  closeTab: (name) => `${name} を閉じる`,
};

export function mobileShellText(lang: MobileShellLang): MobileShellText {
  return lang === "ja" ? JA : EN;
}

/** 札に書く文字。キーの刻印なので言語で変えない。 */
export const SOFT_KEY_CAPS: Record<TerminalSoftKey, string> = {
  escape: "Esc",
  tab: "Tab",
  shiftTab: "⇧Tab",
  ctrlC: "Ctrl+C",
  up: "↑",
  down: "↓",
  enter: "Enter",
};
