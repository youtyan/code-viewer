// ヘルプのページ (/help): 使い方の説明・やり方の案内・キーの一覧。設定は
// 別のページ (views/settings-page.ts)。節の並びと本文は help-guides.ts と
// help-text-en.ts / help-text-ja.ts、部品の見た目は help-blocks.ts。

import type { KeyBinding } from "../core/keymap";
import type { InstallOffer } from "../core/pwa";
import type { AppRoute } from "../core/routes";
import { agentsText } from "./agents/i18n";
import {
  type HelpNoteKind,
  type HelpStepSpec,
  type HelpText,
  helpBlocks,
  helpInline,
} from "./help-blocks";
import {
  HELP_SECTION_NAMES,
  HELP_SECTIONS,
  type HelpLabels,
  type HelpSection,
  helpContent,
  resolveHelpSection,
} from "./help-guides";
import type { HelpFigure } from "./help-images";
import { buildHelpKeybindingGroups } from "./help-keybindings";
import { createPageShell, type PageShellNavItem } from "./page-shell";
import { quickHelpText } from "./quick-help-i18n";

export type { HelpSection } from "./help-guides";

export type HelpPageDeps = {
  $: <T extends Element = HTMLElement>(sel: string) => T;
  getRoute(): AppRoute;
  setRoute(route: AppRoute, replace?: boolean): void;
  setPageMode(): void;
  cancelActiveSourceLoad(reason: "user" | "navigation" | "esc"): boolean;
  removeStandaloneSource(): void;
  clearLoadQueue(): void;
  currentRange(): { from: string; to: string };
  syncHeaderMenu(): void;
  getLanguage(): HelpLanguage;
  /** 本文に出す画面の名前とボタンの文言 (各画面の i18n の値。help-guides.ts)。 */
  helpLabels(lang: HelpLanguage): HelpLabels;
  /** 設定のアカウントの節を開く (本文のリンク)。 */
  openAccountsSettings(): void;
  /** キーボードショートカットの小窓を開閉する (views/quick-help.ts)。 */
  toggleKeyboardShortcuts(): void;
  /** ユーザーの差分を反映した、いま実際に効くバインド一覧 */
  getKeyBindings(): KeyBinding[];
  /**
   * 設定の「ショートカット」を開く。キーの一覧はそこで変える (一覧の上に
   * 案内を出す。編集の画面は views/help-keybinding-editor.ts)。
   */
  openShortcutSettings(): void;
  /** インストールの案内 (PWA) を出すか・ボタンを出せるか。実体は core/pwa.ts */
  installOffer: InstallOffer;
};

export type HelpLanguage = "en" | "ja";

/** 本文の部品の中身。描くのは help-blocks.ts の部品。 */
export type HelpBlock =
  | { kind: "paragraph"; text: HelpText }
  | { kind: "list"; items: HelpText[] }
  /** 番号つきの手順。画像のある手順は、その番号の中に画像を置く。 */
  | { kind: "steps"; items: Array<string | HelpStepSpec> }
  /** 画面のキャプチャ (help-images.ts)。撮っていないものは描かない。 */
  | { kind: "figure"; figure: HelpFigure }
  | { kind: "note"; note: HelpNoteKind; paragraphs: HelpText[] }
  | { kind: "command"; command: string; title?: string }
  | { kind: "table"; rows: HelpText[][]; head?: HelpText[] }
  /** キーの一覧 (左の列の押し方をキーキャップにする)。 */
  | { kind: "keys"; rows: Array<[string, string]> }
  /** 既定で畳む「詳しく」。 */
  | { kind: "details"; blocks: HelpBlock[] }
  /** ほかの節・画面へのリンクの 1 行。 */
  | { kind: "link"; text: HelpText }
  /** インストールの案内 (PWA)。ボタンはブラウザが出せるときだけ。Chrome 以外では出さない */
  | { kind: "install"; button: string; steps: string[] };

export type HelpSectionContent = {
  title: string;
  /** 見出しのすぐ下の 1〜2 文の要約。 */
  intro: HelpText;
  /** 要約のすぐ下 (群の見出しより前) に置くもの。導入手順・画面のキャプチャなど。 */
  lead?: HelpBlock[];
  groups: Array<{ title: string; blocks: HelpBlock[] }>;
};

const HELP_LANGUAGES: HelpLanguage[] = ["en", "ja"];

/** 見出しの右の、キーボードショートカットの小窓を開くボタンの説明。 */
const KEYBOARD_SHORTCUTS_TITLE: Record<HelpLanguage, string> = {
  en: "Show the keys for the common actions in a small window (? on any screen)",
  ja: "よく使う操作のキーを小さな窓に出します (どの画面でも ? で開けます)",
};

export function helpLanguageFromRoute(route: AppRoute): HelpLanguage {
  return route.screen === "help" &&
    HELP_LANGUAGES.includes(route.lang as HelpLanguage)
    ? (route.lang as HelpLanguage)
    : "en";
}

/** ?section= の節。構成を組み直す前の値は、中身が移った節へ読み替える。 */
export function helpSectionFromRoute(route: AppRoute): HelpSection {
  return route.screen === "help"
    ? resolveHelpSection(route.section)
    : HELP_SECTIONS[0];
}

export type OpenHelpSectionDeps = Pick<
  HelpPageDeps,
  | "getRoute"
  | "getLanguage"
  | "currentRange"
  | "setRoute"
  | "setPageMode"
  | "cancelActiveSourceLoad"
> & {
  /**
   * openedSection: 節を指して開いた (設定の見出しへ送るなど)。電話の段で目次の
   * 1 段目を飛ばしてその節を出す。
   */
  renderHelpPage(options?: { openedSection?: boolean }): void;
  setStatus(status: "live" | "refreshing" | "error" | null): void;
};

export function openHelpSection(
  deps: OpenHelpSectionDeps,
  section: HelpSection,
): void {
  const route = deps.getRoute();
  deps.cancelActiveSourceLoad("navigation");
  deps.setRoute({
    screen: "help",
    lang:
      route.screen === "help"
        ? helpLanguageFromRoute(route)
        : deps.getLanguage(),
    section,
    range: deps.currentRange(),
  });
  deps.setPageMode();
  deps.renderHelpPage({ openedSection: true });
  deps.setStatus("live");
}

export function openHelpKeybindings(deps: OpenHelpSectionDeps): void {
  openHelpSection(deps, "keybindings");
}

/** ヘルプの節の名前 (左の列の文言)。設定のページのリンクもこれを使う。 */
export function helpSectionName(
  lang: HelpLanguage,
  section: HelpSection,
): string {
  return HELP_SECTION_NAMES[lang][section];
}

function renderHelpLink(text: HelpText): HTMLParagraphElement {
  const p = document.createElement("p");
  p.className = "gdp-help-shortcut-link";
  p.append(...helpInline(text));
  return p;
}

/** 撮っていない画像は描かない (壊れた画像を出さない)。 */
function capturedFigures(
  figures: readonly HelpFigure[] | undefined,
): HelpFigure[] {
  return (figures ?? []).filter((figure) => figure.captured);
}

/**
 * 本文の部品を描く。インストールの案内だけはブラウザの状態で描き直すので、
 * 呼び出し側 (renderInstall) に任せる。
 */
function renderHelpBlocks(
  lang: HelpLanguage,
  blocks: readonly HelpBlock[],
  renderInstall: (
    block: Extract<HelpBlock, { kind: "install" }>,
  ) => HTMLElement | null,
): HTMLElement[] {
  const b = helpBlocks(lang);
  const render = (block: HelpBlock): HTMLElement | null => {
    switch (block.kind) {
      case "paragraph":
        return b.paragraph(block.text);
      case "list":
        return b.list(block.items);
      case "steps":
        return b.steps(
          block.items.map((item) =>
            typeof item === "string"
              ? item
              : { ...item, figures: capturedFigures(item.figures) },
          ),
        );
      case "figure":
        return block.figure.captured ? b.figure(block.figure) : null;
      case "note":
        return b.note(block.note, block.paragraphs);
      case "command":
        return b.command(block.command, block.title);
      case "table":
        return b.table(block.rows, block.head);
      case "keys":
        return b.keyTable(block.rows);
      case "details":
        return b.details(renderHelpBlocks(lang, block.blocks, renderInstall));
      case "link":
        return renderHelpLink(block.text);
      case "install":
        return renderInstall(block);
    }
  };
  return blocks.flatMap((block) => render(block) ?? []);
}

/**
 * インストールの案内の中身。ボタンはブラウザがインストールの画面を出せるときだけ
 * (押すと 1 度きりなので、押した後は手順の文だけになる)。
 */
function fillInstallBlock(
  lang: HelpLanguage,
  host: HTMLElement,
  block: Extract<HelpBlock, { kind: "install" }>,
  offer: InstallOffer,
): void {
  const children: HTMLElement[] = [];
  if (offer.state() === "prompt") {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "gdp-btn";
    button.textContent = block.button;
    button.addEventListener("click", () => {
      void offer.install();
    });
    const row = document.createElement("p");
    row.append(button);
    children.push(row);
  }
  children.push(helpBlocks(lang).steps(block.steps));
  host.replaceChildren(...children);
}

/** 狭い面で目次を畳んだときの 1 行の見出し (「目次: 今の節」)。 */
const HELP_NAV_TOGGLE_TEXT: Record<HelpLanguage, string> = {
  en: "Contents",
  ja: "目次",
};

/** キーの一覧の上の案内: キーは設定の「ショートカット」で変える。 */
const SHORTCUT_SETTINGS_TEXT: Record<
  HelpLanguage,
  { before: string; after: string }
> = {
  en: {
    before: "Change these keys in ",
    after: ". Keys marked (PWA) work only in the installed app window.",
  },
  ja: {
    before: "キーは ",
    after:
      " で変えられます。(PWA) の付いたキーは、インストールした窓だけで効きます。",
  },
};

export function createHelpPage(deps: HelpPageDeps) {
  const shell = createPageShell();

  function shortcutSettingsLink(
    lang: HelpLanguage,
    labels: HelpLabels,
  ): HTMLElement {
    const text = SHORTCUT_SETTINGS_TEXT[lang];
    return renderHelpLink([
      text.before,
      {
        link: `${labels.agents.sidebar.settings} › ${labels.settings.categories.shortcuts.label}`,
        href: "/settings",
        open: deps.openShortcutSettings,
      },
      text.after,
    ]);
  }

  function renderHelpPage(options: { openedSection?: boolean } = {}) {
    deps.cancelActiveSourceLoad("navigation");
    deps.removeStandaloneSource();
    deps.clearLoadQueue();
    deps.$("#empty").classList.add("hidden");
    deps.$("#meta").textContent = "";

    const lang =
      deps.getRoute().screen === "help" &&
      new URLSearchParams(window.location.search).has("lang")
        ? helpLanguageFromRoute(deps.getRoute())
        : deps.getLanguage();
    const section = helpSectionFromRoute(deps.getRoute());

    const goToSection = (helpSection: HelpSection) => {
      deps.setRoute({
        screen: "help",
        lang,
        section: helpSection,
        range: deps.currentRange(),
      });
      renderHelpPage();
      deps.syncHeaderMenu();
    };
    const labels = deps.helpLabels(lang);
    const current = helpContent(lang, labels, {
      openSection: goToSection,
      openAccountsSettings: deps.openAccountsSettings,
      toggleKeyboardShortcuts: deps.toggleKeyboardShortcuts,
    })[section];
    // ユーザーが割り当てを変えていれば、それを反映した一覧を出す。
    const sectionGroups =
      section === "keybindings"
        ? [
            ...buildHelpKeybindingGroups(lang, deps.getKeyBindings()).map(
              (group) => ({
                title: group.title,
                blocks: [{ kind: "keys" as const, rows: group.rows }],
              }),
            ),
            ...current.groups,
          ]
        : current.groups;

    const nav: PageShellNavItem[] = HELP_SECTIONS.map((helpSection) => ({
      kind: "item",
      label: helpSectionName(lang, helpSection),
      active: helpSection === section,
      onSelect: () => goToSection(helpSection),
    }));

    const article = document.createElement("article");
    article.className = "gdp-help-content";
    // ブラウザがインストールの画面を出せるようになった・出せなくなったら、
    // 案内だけ描き直す (この画面に案内が無ければ何もしない)。
    let installBlock: (() => void) | null = null;
    const renderInstall = (
      block: Extract<HelpBlock, { kind: "install" }>,
    ): HTMLElement | null => {
      if (deps.installOffer.state() === "hidden") return null;
      const host = document.createElement("div");
      host.className = "gdp-help-install";
      fillInstallBlock(lang, host, block, deps.installOffer);
      installBlock = () =>
        fillInstallBlock(lang, host, block, deps.installOffer);
      return host;
    };
    const h2 = document.createElement("h2");
    h2.textContent = current.title;
    article.append(
      h2,
      helpBlocks(lang).paragraph(current.intro),
      ...renderHelpBlocks(lang, current.lead ?? [], renderInstall),
    );
    if (section === "keybindings")
      article.append(shortcutSettingsLink(lang, labels));
    sectionGroups.forEach((group) => {
      const groupSection = document.createElement("section");
      groupSection.className = "gdp-help-group";
      const groupTitle = document.createElement("h3");
      groupTitle.textContent = group.title;
      groupSection.append(
        groupTitle,
        ...renderHelpBlocks(lang, group.blocks, renderInstall),
      );
      article.appendChild(groupSection);
    });
    deps.installOffer.onChange(installBlock);

    // キーボードショートカットの小窓 (どの画面でも ? で開く) をここからも開く。
    const shortcuts = document.createElement("button");
    shortcuts.type = "button";
    shortcuts.className = "gdp-btn";
    shortcuts.dataset.quickHelpTrigger = "";
    shortcuts.textContent = quickHelpText(lang).panelTitle;
    shortcuts.title = KEYBOARD_SHORTCUTS_TITLE[lang];
    shortcuts.addEventListener("click", deps.toggleKeyboardShortcuts);

    shell.render(deps.$("#diff"), {
      page: "help",
      lang,
      title: agentsText(lang).sidebar.help,
      headerActions: [shortcuts],
      nav,
      article,
      toggleText: HELP_NAV_TOGGLE_TEXT[lang],
      openedSection: options.openedSection === true,
    });
  }

  return { renderHelpPage };
}
