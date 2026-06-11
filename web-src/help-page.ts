// Help page (keybindings reference), extracted from app.ts.

import type { AppRoute } from "./routes";

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
};

export type HelpLanguage = "en" | "ja";

export type HelpSection = "keybindings";

type HelpContent = {
  languageLabel: string;
  title: string;
  sections: Record<
    HelpSection,
    {
      nav: string;
      title: string;
      intro: string;
      groups: Array<{ title: string; rows: Array<[string, string]> }>;
    }
  >;
};

const HELP_LANGUAGES: HelpLanguage[] = ["en", "ja"];

const HELP_SECTIONS: HelpSection[] = ["keybindings"];

const HELP_CONTENT: Record<HelpLanguage, HelpContent> = {
  en: {
    languageLabel: "Language",
    title: "Help",
    sections: {
      keybindings: {
        nav: "Keybindings",
        title: "Keyboard Shortcuts",
        intro:
          "Use these shortcuts to move between panels and navigate files without leaving the keyboard.",
        groups: [
          {
            title: "Global",
            rows: [
              ["Ctrl+K", "Open file palette"],
              ["Ctrl+G", "Open grep palette"],
              ["/", "Focus file filter"],
              ["t", "Toggle theme"],
            ],
          },
          {
            title: "Panels",
            rows: [
              ["Ctrl+H", "Focus sidebar"],
              ["Ctrl+L", "Focus main panel"],
            ],
          },
          {
            title: "Sidebar",
            rows: [
              ["j / k", "Move selection down / up"],
              ["Ctrl+D / Ctrl+U", "Move selection by half a page"],
              ["gg / Shift+G", "Move to top / bottom"],
              ["Enter", "Open selected item"],
              ["h / l", "Collapse / expand directory"],
            ],
          },
          {
            title: "Main Panel",
            rows: [
              ["j / k", "Move code cursor down / up"],
              ["Ctrl+D / Ctrl+U", "Move code cursor by half a page"],
              ["gg / Shift+G", "Move code cursor to top / bottom"],
              ["gp / gc", "Switch to Preview / Code tab"],
            ],
          },
        ],
      },
    },
  },
  ja: {
    languageLabel: "言語",
    title: "ヘルプ",
    sections: {
      keybindings: {
        nav: "キーバインド",
        title: "キーバインド",
        intro:
          "キーボードだけでパネル移動、ファイル選択、スクロールを行うためのショートカットです。",
        groups: [
          {
            title: "グローバル",
            rows: [
              ["Ctrl+K", "ファイルパレットを開く"],
              ["Ctrl+G", "grep パレットを開く"],
              ["/", "ファイルフィルターへフォーカス"],
              ["t", "テーマ切り替え"],
            ],
          },
          {
            title: "パネル",
            rows: [
              ["Ctrl+H", "サイドバーへフォーカス"],
              ["Ctrl+L", "メインパネルへフォーカス"],
            ],
          },
          {
            title: "サイドバー",
            rows: [
              ["j / k", "選択を下 / 上へ移動"],
              ["Ctrl+D / Ctrl+U", "半ページ分選択を移動"],
              ["gg / Shift+G", "先頭 / 末尾へ移動"],
              ["Enter", "選択項目を開く"],
              ["h / l", "ディレクトリを閉じる / 開く"],
            ],
          },
          {
            title: "メインパネル",
            rows: [
              ["j / k", "コードカーソルを下 / 上へ移動"],
              ["Ctrl+D / Ctrl+U", "コードカーソルを半ページ分移動"],
              ["gg / Shift+G", "コードカーソルを先頭 / 末尾へ移動"],
              ["gp / gc", "Preview / Code タブへ切り替え"],
            ],
          },
        ],
      },
    },
  },
};

export function helpLanguageFromRoute(route: AppRoute): HelpLanguage {
  return route.screen === "help" &&
    HELP_LANGUAGES.includes(route.lang as HelpLanguage)
    ? (route.lang as HelpLanguage)
    : "en";
}

export function helpSectionFromRoute(route: AppRoute): HelpSection {
  return route.screen === "help" &&
    HELP_SECTIONS.includes(route.section as HelpSection)
    ? (route.section as HelpSection)
    : "keybindings";
}

export function createHelpPage(deps: HelpPageDeps) {
  function renderHelpPage() {
    deps.cancelActiveSourceLoad("navigation");
    deps.removeStandaloneSource();
    deps.clearLoadQueue();
    const target = deps.$("#diff");
    const empty = deps.$("#empty");
    empty.classList.add("hidden");
    deps.$("#meta").textContent = "";
    deps.$("#totals").textContent = "";
    deps.$("#filelist").textContent = "";

    const lang = helpLanguageFromRoute(deps.getRoute());
    const section = helpSectionFromRoute(deps.getRoute());
    const content = HELP_CONTENT[lang];
    const sectionContent = content.sections[section];

    const shell = document.createElement("section");
    shell.className = "gdp-help-shell";
    const header = document.createElement("header");
    header.className = "gdp-help-header";
    const title = document.createElement("h1");
    title.textContent = content.title;
    const langSelect = document.createElement("select");
    langSelect.className = "gdp-help-language";
    langSelect.setAttribute("aria-label", content.languageLabel);
    HELP_LANGUAGES.forEach((optionLang) => {
      const option = document.createElement("option");
      option.value = optionLang;
      option.textContent = optionLang.toUpperCase();
      option.selected = optionLang === lang;
      langSelect.appendChild(option);
    });
    langSelect.addEventListener("change", () => {
      deps.setRoute({
        screen: "help",
        lang: langSelect.value,
        section,
        range: deps.currentRange(),
      });
      deps.setPageMode();
      renderHelpPage();
      deps.syncHeaderMenu();
    });
    header.append(title, langSelect);

    const layout = document.createElement("div");
    layout.className = "gdp-help-layout";
    const helpNav = document.createElement("nav");
    helpNav.className = "gdp-help-nav";
    HELP_SECTIONS.forEach((helpSection) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = helpSection === section ? "active" : "";
      button.textContent = content.sections[helpSection].nav;
      button.addEventListener("click", () => {
        deps.setRoute({
          screen: "help",
          lang,
          section: helpSection,
          range: deps.currentRange(),
        });
        renderHelpPage();
        deps.syncHeaderMenu();
      });
      helpNav.appendChild(button);
    });

    const article = document.createElement("article");
    article.className = "gdp-help-content";
    const h2 = document.createElement("h2");
    h2.textContent = sectionContent.title;
    const intro = document.createElement("p");
    intro.textContent = sectionContent.intro;
    article.append(h2, intro);
    sectionContent.groups.forEach((group) => {
      const groupSection = document.createElement("section");
      groupSection.className = "gdp-help-group";
      const groupTitle = document.createElement("h3");
      groupTitle.textContent = group.title;
      const table = document.createElement("table");
      group.rows.forEach(([keys, description]) => {
        const tr = document.createElement("tr");
        const keyCell = document.createElement("th");
        keyCell.scope = "row";
        keys.split(" / ").forEach((key, index) => {
          if (index > 0) keyCell.append(" / ");
          const kbd = document.createElement("kbd");
          kbd.textContent = key;
          keyCell.appendChild(kbd);
        });
        const desc = document.createElement("td");
        desc.textContent = description;
        tr.append(keyCell, desc);
        table.appendChild(tr);
      });
      groupSection.append(groupTitle, table);
      article.appendChild(groupSection);
    });

    layout.append(helpNav, article);
    shell.append(header, layout);
    target.replaceChildren(shell);
  }

  return { renderHelpPage };
}
