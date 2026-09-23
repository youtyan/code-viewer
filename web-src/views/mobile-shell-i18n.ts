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
  /** 右の列 (木・一覧) を下から出す。 */
  list: string;
  /** 開いている引き出し・面を閉じる。 */
  close: string;
  /** 端末の操作札の並びの名前。 */
  keys: string;
  /** 札の名前 (読み上げと title)。札の文字は言語で変えない。 */
  keyLabel: Record<TerminalSoftKey, string>;
  /** ソフトキーボードを出す (端末に入力を向ける)。 */
  keyboard: string;
};

const EN: MobileShellText = {
  bar: "Switch view",
  projects: "Projects",
  files: "Files",
  diff: "Diff",
  agents: "Agents",
  list: "List",
  close: "Close",
  keys: "Terminal keys",
  keyLabel: {
    escape: "Escape",
    ctrlC: "Control+C (interrupt)",
    up: "Up arrow",
    down: "Down arrow",
    enter: "Enter",
  },
  keyboard: "Show keyboard",
};

const JA: MobileShellText = {
  bar: "画面の切替",
  projects: "プロジェクト",
  files: "ファイル",
  diff: "差分",
  agents: "エージェント",
  list: "一覧",
  close: "閉じる",
  keys: "端末のキー",
  keyLabel: {
    escape: "Esc",
    ctrlC: "Ctrl+C (中断)",
    up: "上矢印",
    down: "下矢印",
    enter: "Enter",
  },
  keyboard: "キーボードを出す",
};

export function mobileShellText(lang: MobileShellLang): MobileShellText {
  return lang === "ja" ? JA : EN;
}

/** 札に書く文字。キーの刻印なので言語で変えない。 */
export const SOFT_KEY_CAPS: Record<TerminalSoftKey, string> = {
  escape: "Esc",
  ctrlC: "Ctrl+C",
  up: "↑",
  down: "↓",
  enter: "Enter",
};
