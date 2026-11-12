// 設定のページ (/settings)。左の列に設定の分類、本文に選んだ分類の節と「変更を
// 保存」。フォームの実体は views/viewer-settings.ts、使い方の案内はヘルプの
// ページ (views/help-page.ts) にある。

import { html, nothing } from "lit/html.js";
import type { AppRoute, DiffRange } from "../core/routes";
import { agentsText } from "./agents/i18n";
import {
  type HelpLanguage,
  type HelpSection,
  helpSectionName,
} from "./help-page";
import { createPageShell } from "./page-shell";
import { templateElement } from "./ui/renderer";
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
      en: "How to add an account, sign it in and start an agent with it: ",
      ja: "足し方・ログインのしかた・エージェントでの使い方は ",
    },
  },
  remote: {
    section: "remote-access",
    before: {
      en: "How to set up Cloudflare, step by step: ",
      ja: "Cloudflare 側の設定の手順は ",
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

/** 本文の頭 (分類の名前・説明・ヘルプへの 1 行)。この下にフォームを置く。 */
export type SettingsArticleProps = {
  title: string;
  description: string;
  help: {
    before: string;
    label: string;
    href: string;
    after: string;
    onOpen(): void;
  } | null;
};

export type SettingsPageView = {
  /** 本文の箱 (article.gdp-help-content。フォームはこの中に足す)。 */
  article(props: SettingsArticleProps): unknown;
  /** 見出しの下の検索の行の箱 (検索欄はこの中に足す)。 */
  searchRow(props: { onInput(): void }): unknown;
};

export const DEFAULT_VIEW: SettingsPageView = {
  article: (
    props,
  ) => html`<article class="gdp-help-content"><h2>${props.title}</h2><p
      >${props.description}</p
    >${
      props.help
        ? html`<p class="gdp-help-shortcut-link">${props.help.before}<a
              href=${props.help.href}
              @click=${(event: MouseEvent) => {
                event.preventDefault();
                props.help?.onOpen();
              }}
            >${props.help.label}</a
            >${props.help.after}</p>`
        : nothing
    }</article>`,
  searchRow: (props) =>
    html`<div class="gdp-help-search-row" @input=${props.onInput}></div>`,
};

export function createSettingsPage(
  deps: SettingsPageDeps,
  view: SettingsPageView = DEFAULT_VIEW,
) {
  const shell = createPageShell();

  function helpLink(
    category: SettingsCategory,
    lang: HelpLanguage,
  ): SettingsArticleProps["help"] {
    const entry = CATEGORY_HELP_LINKS[category];
    if (!entry) return null;
    return {
      before: entry.before[lang],
      label: `${agentsText(lang).sidebar.help} › ${helpSectionName(lang, entry.section)}`,
      href: `/help?section=${entry.section}`,
      after: lang === "ja" ? " にあります。" : ".",
      onOpen: () => deps.openHelpSection(entry.section),
    };
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

    // 本文の頭 (分類の名前と説明) を描き、その下にフォーム (使い回す要素) を置く。
    const article = templateElement(
      view.article({
        title: current?.label ?? "",
        description: current?.description ?? "",
        help: helpLink(active, lang),
      }),
    );
    deps.mountViewerSettings(article);

    // 設定の検索は見出しの下。電話の段の目次 (1 段目) で打ち始めたら、結果を
    // 出す本文 (2 段目) へ。
    const searchRow = templateElement(
      view.searchRow({
        onInput: () => {
          if (page.navOpen()) page.closeNav();
        },
      }),
    );
    deps.mountSettingsSearch(searchRow);
    const page = shell.render(deps.$("#diff"), {
      page: "settings",
      lang,
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
