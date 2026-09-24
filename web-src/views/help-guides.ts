// ヘルプの節の中身: 節の並び・古い ?section= の読み替え・画面の名前の集め方。
// 本文は言語ごとに help-text-en.ts / help-text-ja.ts。ボタンや画面の名前は、
// その画面の i18n の値から組み立てる (文字を写さない。画面の文言を変えれば
// ヘルプも変わる)。部品の見た目は help-blocks.ts。

import { agentsText } from "./agents/i18n";
import { annotationText } from "./annotations/i18n";
import { dbText } from "./database/i18n";
import { DIFF_SCREEN_TEXT } from "./diff-view-i18n";
import { doctorText } from "./doctor-view";
import type { HelpText } from "./help-blocks";
import type { HelpBlock, HelpLanguage, HelpSectionContent } from "./help-page";
import { helpTextEn } from "./help-text-en";
import { helpTextJa } from "./help-text-ja";
import { mainTabsText } from "./main-tabs/i18n";
import { mobileShellText } from "./mobile-shell-i18n";
import { quickHelpText } from "./quick-help-i18n";
import { searchPaletteText } from "./search-palette-i18n";
import { SOURCE_READING_TEXT } from "./source-preview-i18n";
import { terminalText } from "./terminal/i18n";
import { VIEWER_SETTINGS_TEXT } from "./viewer-settings-i18n";
import { worktreeText } from "./worktree-i18n";

/** 左の列の並び (使う人がやりたいことの順)。?section= の値。 */
export const HELP_SECTIONS = [
  "getting-started",
  "projects",
  "read-files",
  "read-diffs",
  "search",
  "worktrees",
  "start-agent",
  "agent-state",
  "notifications",
  "agent-hooks",
  "add-account",
  "terminal",
  "tabs-layout",
  "install-app",
  "phone",
  "datastores",
  "tools",
  "annotations",
  "ask-ai",
  "ai-cli-mcp",
  "project-files",
  "doctor",
  "keybindings",
] as const;
export type HelpSection = (typeof HELP_SECTIONS)[number];

/**
 * 構成を組み直す前の ?section= の値と、その中身が移った節。保存したリンク・
 * 履歴・タブの並びに残った古い値から来ても、近い節を開く。
 */
export const HELP_SECTION_ALIASES: Readonly<Record<string, HelpSection>> = {
  overview: "getting-started",
  "add-project": "projects",
  storage: "project-files",
  database: "datastores",
  skills: "ask-ai",
  mcp: "ai-cli-mcp",
};

/** ?section= の値を節にする。知らない値は先頭の節。 */
export function resolveHelpSection(value: string): HelpSection {
  if ((HELP_SECTIONS as readonly string[]).includes(value))
    return value as HelpSection;
  return HELP_SECTION_ALIASES[value] ?? HELP_SECTIONS[0];
}

/** 節の名前 (左の列と、ほかの画面からのリンクの文字)。 */
export const HELP_SECTION_NAMES: Record<
  HelpLanguage,
  Record<HelpSection, string>
> = {
  en: {
    "getting-started": "Getting started",
    projects: "Projects",
    "read-files": "Read files",
    "read-diffs": "Read diffs",
    search: "Search and history",
    worktrees: "Worktrees",
    "start-agent": "Start an agent",
    "agent-state": "Watch your agents",
    notifications: "Notifications",
    "agent-hooks": "Reliable states (hooks)",
    "add-account": "Add an account",
    terminal: "Terminal",
    "tabs-layout": "Tabs and layout",
    "install-app": "Install as an app",
    phone: "On a phone",
    datastores: "Datastores",
    tools: "Tools",
    annotations: "AI annotations",
    "ask-ai": "Let AI do it",
    "ai-cli-mcp": "CLI and MCP for AI",
    "project-files": "What it saves",
    doctor: "Troubleshooting",
    keybindings: "Keyboard shortcuts",
  },
  ja: {
    "getting-started": "導入手順",
    projects: "プロジェクト",
    "read-files": "ファイルを読む",
    "read-diffs": "差分を読む",
    search: "検索と履歴",
    worktrees: "作業ツリー",
    "start-agent": "エージェントを起動する",
    "agent-state": "エージェントの様子を見る",
    notifications: "通知を受け取る",
    "agent-hooks": "状態を正しく出す（フック）",
    "add-account": "アカウントを追加する",
    terminal: "ターミナル",
    "tabs-layout": "タブと画面の配置",
    "install-app": "アプリとして入れる",
    phone: "SP で使う",
    datastores: "データストア",
    tools: "ツール",
    annotations: "AI の注釈",
    "ask-ai": "AI に任せる",
    "ai-cli-mcp": "AI 向けの CLI と MCP",
    "project-files": "保存するもの",
    doctor: "困ったとき",
    keybindings: "キーボードショートカット",
  },
};

/** app だけが持つ名前 (一覧の列の頭の画面の名前・差分の帯のボタン)。 */
export type AppHelpLabels = {
  diff: string;
  history: string;
  worktree: string;
  tools: string;
  split: string;
  unified: string;
  ignoreWs: string;
  hideTests: string;
  /** パレットを開くキー (いまの割り当て)。 */
  paletteKey: string;
};

/** ヘルプに出す、画面の名前とボタンの文言 (各画面の i18n の表)。 */
export type HelpLabels = {
  agents: ReturnType<typeof agentsText>;
  annotations: ReturnType<typeof annotationText>;
  database: ReturnType<typeof dbText>;
  diff: (typeof DIFF_SCREEN_TEXT)[HelpLanguage];
  doctor: ReturnType<typeof doctorText>;
  mainTabs: ReturnType<typeof mainTabsText>;
  mobile: ReturnType<typeof mobileShellText>;
  quickHelp: ReturnType<typeof quickHelpText>;
  search: ReturnType<typeof searchPaletteText>;
  settings: (typeof VIEWER_SETTINGS_TEXT)[HelpLanguage];
  source: (typeof SOURCE_READING_TEXT)[HelpLanguage];
  terminal: ReturnType<typeof terminalText>;
  worktree: ReturnType<typeof worktreeText>;
  app: AppHelpLabels;
};

export function helpLabels(lang: HelpLanguage, app: AppHelpLabels): HelpLabels {
  return {
    agents: agentsText(lang),
    annotations: annotationText(lang),
    database: dbText(lang),
    diff: DIFF_SCREEN_TEXT[lang],
    doctor: doctorText(lang),
    mainTabs: mainTabsText(lang),
    mobile: mobileShellText(lang),
    quickHelp: quickHelpText(lang),
    search: searchPaletteText(lang),
    settings: VIEWER_SETTINGS_TEXT[lang],
    source: SOURCE_READING_TEXT[lang],
    terminal: terminalText(lang),
    worktree: worktreeText(lang),
    app,
  };
}

/** 本文の中のリンクが開く先 (app と help-page が配線する)。 */
export type HelpActions = {
  openSection(section: HelpSection): void;
  openAccountsSettings(): void;
  toggleKeyboardShortcuts(): void;
};

/** 本文を書くときの道具 (両方の言語で同じ形のリンクを作る)。 */
export type HelpWriter = {
  l: HelpLabels;
  /** 手順の中の「→ <節の名前>」。 */
  seeText(section: HelpSection): HelpText;
  /** 「→ <節の名前>」の 1 行。 */
  see(section: HelpSection): HelpBlock;
  /** 「→ キーの一覧は <キーボードショートカット> ?」の 1 行。 */
  keys(): HelpBlock;
  /** 設定のアカウントの節を開く 1 行。 */
  accountsSettings(): HelpBlock;
};

export type HelpTexts = Record<HelpSection, HelpSectionContent>;

export function helpContent(
  lang: HelpLanguage,
  l: HelpLabels,
  actions: HelpActions,
): HelpTexts {
  const names = HELP_SECTION_NAMES[lang];
  const seeText = (section: HelpSection): HelpText => [
    "→ ",
    {
      link: names[section],
      href: `/help?section=${section}`,
      open: () => actions.openSection(section),
    },
  ];
  const writer: HelpWriter = {
    l,
    seeText,
    see: (section) => ({ kind: "link", text: seeText(section) }),
    keys: () => ({
      kind: "link",
      text: [
        lang === "ja" ? "→ キーの一覧は " : "→ All keys: ",
        {
          link: l.quickHelp.panelTitle,
          href: "/help?section=keybindings",
          open: actions.toggleKeyboardShortcuts,
        },
        " ",
        { key: "?" },
      ],
    }),
    accountsSettings: () => ({
      kind: "link",
      text: [
        lang === "ja" ? "→ " : "→ Open ",
        {
          link: `${l.agents.sidebar.settings} › ${l.settings.categories.accounts.label}`,
          href: "/settings",
          open: actions.openAccountsSettings,
        },
        lang === "ja" ? " を開く" : "",
      ],
    }),
  };
  return lang === "ja" ? helpTextJa(writer) : helpTextEn(writer);
}
