// 設定のページ (/settings)。左の列に設定の分類、本文に選んだ分類の節と「変更を
// 保存」。フォームの実体は views/viewer-settings.ts、使い方の案内はヘルプの
// ページ (views/help-page.ts) にある。

import type { AppRoute, DiffRange } from "../core/routes";
import { agentsText } from "./agents/i18n";
import {
  type HelpLanguage,
  type HelpSection,
  helpSectionName,
} from "./help-page";
import { createPageShell } from "./page-shell";
import type { SettingsCategory } from "./viewer-settings";

export type SettingsPageDeps = {
  $: <T extends Element = HTMLElement>(sel: string) => T;
  setRoute(route: AppRoute, replace?: boolean): void;
  setPageMode(): void;
  setStatus(status: "live" | "refreshing" | "error" | null): void;
  currentRange(): DiffRange;
  cancelActiveSourceLoad(reason: "user" | "navigation" | "esc"): boolean;
  removeStandaloneSource(): void;
  clearLoadQueue(): void;
  getLanguage(): HelpLanguage;
  /** 設定の節の中身。フォームの実体は views/viewer-settings.ts が持つ */
  mountViewerSettings(host: HTMLElement): void;
  /** 設定の検索欄 (実体は viewer-settings.ts)。見出しの下に置く。 */
  mountSettingsSearch(host: HTMLElement): void;
  /** 左の列に並べる設定の分類 (並び順どおり)。 */
  settingsCategories(): Array<{
    id: SettingsCategory;
    label: string;
    description: string;
  }>;
  getSettingsCategory(): SettingsCategory;
  setSettingsCategory(category: SettingsCategory): void;
  /** その id の見出しを含む分類に切り替える (views/viewer-settings.ts)。 */
  revealHeading(headingId: string): void;
  /** 設定の見出しの id か。 */
  hasHeading(headingId: string): boolean;
  /** ヘルプのその節を開く (分類の説明の下の案内から)。 */
  openHelpSection(section: HelpSection): void;
};

/** 分類の説明の下に置く、ヘルプの節への 1 行 (リンクの文字はヘルプの節の名前)。 */
const CATEGORY_HELP_LINKS: Partial<
  Record<
    SettingsCategory,
    { section: HelpSection; before: Record<HelpLanguage, string> }
  >
> = {
  accounts: {
    section: "add-account",
    before: {
      en: "Each row is one claude or codex account. How to add one, sign it in and start an agent with it: ",
      ja: "1 行が claude か codex のアカウント 1 つです。足し方・ログインのしかた・エージェントでの使い方は ",
    },
  },
  shortcuts: {
    section: "keybindings",
    before: {
      en: "The list of every key as it works now: ",
      ja: "いま効くキーの一覧は ",
    },
  },
};

const NAV_TOGGLE_TEXT: Record<HelpLanguage, string> = {
  en: "Contents",
  ja: "目次",
};

export function createSettingsPage(deps: SettingsPageDeps) {
  const shell = createPageShell();

  function helpLink(category: SettingsCategory, lang: HelpLanguage) {
    const entry = CATEGORY_HELP_LINKS[category];
    if (!entry) return null;
    const note = document.createElement("p");
    note.className = "gdp-help-shortcut-link";
    const link = document.createElement("a");
    link.href = `/help?section=${entry.section}`;
    link.textContent = `${agentsText(lang).sidebar.help} › ${helpSectionName(lang, entry.section)}`;
    link.addEventListener("click", (event) => {
      event.preventDefault();
      deps.openHelpSection(entry.section);
    });
    note.append(
      entry.before[lang],
      link,
      lang === "ja" ? " にあります。" : ".",
    );
    return note;
  }

  function renderSettingsPage(options: { openedSection?: boolean } = {}) {
    deps.cancelActiveSourceLoad("navigation");
    deps.removeStandaloneSource();
    deps.clearLoadQueue();
    deps.$("#empty").classList.add("hidden");
    deps.$("#meta").textContent = "";
    const lang = deps.getLanguage();
    const categories = deps.settingsCategories();
    const active = deps.getSettingsCategory();
    const current = categories.find((category) => category.id === active);

    const article = document.createElement("article");
    article.className = "gdp-help-content";
    const h2 = document.createElement("h2");
    h2.textContent = current?.label ?? "";
    const intro = document.createElement("p");
    intro.textContent = current?.description ?? "";
    article.append(h2, intro);
    const note = helpLink(active, lang);
    if (note) article.append(note);
    deps.mountViewerSettings(article);

    // 設定の検索は見出しの下。電話の段の目次 (1 段目) で打ち始めたら、結果を
    // 出す本文 (2 段目) へ。
    const searchRow = document.createElement("div");
    searchRow.className = "gdp-help-search-row";
    deps.mountSettingsSearch(searchRow);
    const view = shell.render(deps.$("#diff"), {
      page: "settings",
      title: agentsText(lang).sidebar.settings,
      searchRow,
      nav: categories.map((category) => ({
        kind: "item" as const,
        label: category.label,
        active: category.id === active,
        onSelect: () => {
          deps.setSettingsCategory(category.id);
          renderSettingsPage();
        },
      })),
      article,
      toggleText: NAV_TOGGLE_TEXT[lang],
      openedSection: options.openedSection === true,
    });
    searchRow.addEventListener("input", () => {
      if (view.navOpen()) view.closeNav();
    });
  }

  /** 設定のページを開く (今の分類のまま)。 */
  function openSettingsPage(
    options: { replace?: boolean; openedSection?: boolean } = {},
  ): void {
    deps.cancelActiveSourceLoad("navigation");
    deps.setRoute(
      { screen: "settings", range: deps.currentRange() },
      options.replace,
    );
    deps.setPageMode();
    renderSettingsPage({ openedSection: options.openedSection });
    deps.setStatus("live");
  }

  /** 設定のページを開き、その見出し (を含む分類) まで送る。 */
  function openSettingsAt(headingId: string, replace = false): void {
    deps.revealHeading(headingId);
    openSettingsPage({ replace, openedSection: true });
    requestAnimationFrame(() =>
      document.getElementById(headingId)?.scrollIntoView({ block: "start" }),
    );
  }

  /**
   * URL の # (location.hash) が設定の見出しならその id。設定とヘルプが 1 つの
   * ページだった頃の /help#<見出し> と、/settings#<見出し>。
   */
  function headingInHash(hash: string): string | null {
    const id = decodeURIComponent(hash.slice(1));
    return id && deps.hasHeading(id) ? id : null;
  }

  return {
    renderSettingsPage,
    openSettingsPage,
    openSettingsAt,
    headingInHash,
  };
}
