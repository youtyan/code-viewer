import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  DEFAULT_KEY_BINDINGS,
  KEYMAP_SCOPES,
  type KeyBinding,
  resolveKeymapAction,
} from "../core/keymap";
import { PHONE_MEDIA_QUERY } from "../core/mobile-layout";
import type { InstallOffer, InstallOfferState } from "../core/pwa";
import type { AppRoute } from "../core/routes";
import { parseQueryArgs } from "../server/query-cli";
import { staticFileSpec, WEB_ROOT } from "../server/static-files";
import {
  type AppHelpLabels,
  HELP_SECTION_ALIASES,
  type HelpLabels,
  helpLabels,
} from "../views/help-guides";
import { HELP_CAPTURES } from "../views/help-images";
import {
  buildHelpKeybindingGroups,
  collectHelpKeybindingCoverage,
  documentedHelpKeybindingActions,
  HIDDEN_HELP_KEYBINDING_ACTIONS,
} from "../views/help-keybindings";
import {
  createHelpPage,
  type HelpLanguage,
  type HelpPageDeps,
  type HelpSection,
  helpSectionName,
  openHelpKeybindings,
} from "../views/help-page";
import { mobileShellText } from "../views/mobile-shell-i18n";
import { quickHelpText } from "../views/quick-help-i18n";
import { createSettingsPage } from "../views/settings-page";
import type { SettingsCategory } from "../views/viewer-settings";

/** インストールの案内を出さないブラウザ (案内の中身は pwa.test.ts)。 */
const HIDDEN_INSTALL_OFFER: InstallOffer = {
  state: () => "hidden",
  install: () => Promise.reject(new Error("no install prompt in this test")),
  onChange: () => undefined,
};

beforeAll(() => {
  GlobalRegistrator.register();
});

afterAll(() => {
  GlobalRegistrator.unregister();
});

function eventKeyForBinding(binding: KeyBinding): string {
  if (binding.key === "?") return "?";
  if (binding.shift && binding.key.length === 1)
    return binding.key.toUpperCase();
  return binding.key;
}

describe("help page navigation", () => {
  const range = { from: "HEAD", to: "worktree" };

  test("opens the keybindings section before applying page mode", () => {
    let route: AppRoute = { screen: "repo", ref: "worktree", path: "", range };
    const calls: string[] = [];
    let routeSeenByPageMode: AppRoute | null = null;

    openHelpKeybindings({
      getRoute: () => route,
      getLanguage: () => "ja",
      currentRange: () => range,
      setRoute(nextRoute) {
        calls.push("setRoute");
        route = nextRoute;
      },
      setPageMode() {
        calls.push("setPageMode");
        routeSeenByPageMode = route;
      },
      renderHelpPage() {
        calls.push("renderHelpPage");
      },
      setStatus(status) {
        calls.push(`setStatus:${status}`);
      },
      cancelActiveSourceLoad() {
        calls.push("cancelActiveSourceLoad");
        return true;
      },
    });

    expect(calls).toEqual([
      "cancelActiveSourceLoad",
      "setRoute",
      "setPageMode",
      "renderHelpPage",
      "setStatus:live",
    ]);
    expect(route).toEqual({
      screen: "help",
      lang: "ja",
      section: "keybindings",
      range,
    });
    expect(routeSeenByPageMode).toEqual(route);
  });

  test("keeps the current help language when jumping back to keybindings", () => {
    let route: AppRoute = {
      screen: "help",
      lang: "ja",
      section: "database",
      range,
    };

    openHelpKeybindings({
      getRoute: () => route,
      getLanguage: () => "en",
      currentRange: () => range,
      setRoute(nextRoute) {
        route = nextRoute;
      },
      setPageMode: () => undefined,
      renderHelpPage: () => undefined,
      setStatus: () => undefined,
      cancelActiveSourceLoad: () => true,
    });

    expect(route).toEqual({
      screen: "help",
      lang: "ja",
      section: "keybindings",
      range,
    });
  });
});

const FIXTURE_DOM = [
  '<main id="diff"></main>',
  '<div id="empty"></div>',
  '<div id="meta"></div>',
  '<div id="totals"></div>',
  '<div id="filelist"></div>',
].join("");

function fixture$<T extends Element = HTMLElement>(sel: string): T {
  const found = document.querySelector(sel);
  if (!found) throw new Error(`missing fixture element: ${sel}`);
  return found as T;
}

/** 左の列: 見出しは "# "、選択中は " *"。 */
function navItems(): string[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>(".gdp-help-nav > *"),
    (item) =>
      `${item.tagName === "BUTTON" ? "" : "# "}${item.textContent}${item.classList.contains("active") ? " *" : ""}`,
  );
}

function clickNav(label: string): void {
  const button = Array.from(
    document.querySelectorAll<HTMLButtonElement>(".gdp-help-nav button"),
  ).find((item) => item.textContent === label);
  if (!button) throw new Error(`missing nav button: ${label}`);
  button.click();
}

const SAMPLE_CATEGORIES: Array<{
  id: SettingsCategory;
  label: string;
  description: string;
}> = [
  { id: "files", label: "Files", description: "Files text." },
  { id: "shortcuts", label: "Shortcuts", description: "Shortcuts text." },
  { id: "agents", label: "Agents", description: "Agents text." },
  { id: "accounts", label: "Accounts", description: "Accounts text." },
  { id: "advanced", label: "Advanced", description: "Advanced text." },
];

/** 見出しの id と、その見出しを含む分類 (viewer-settings.ts の代わり)。 */
const SAMPLE_HEADINGS: Record<string, SettingsCategory> = {
  "sample-accounts-title": "accounts",
  "sample-shortcuts-title": "shortcuts",
};

/** keepDom: 前のページ (ヘルプ) を描いたまま開く (ページを移ったとき)。 */
function renderSettings(lang: HelpLanguage = "en", keepDom = false) {
  if (!keepDom) document.body.innerHTML = FIXTURE_DOM;
  const range = { from: "HEAD", to: "worktree" };
  let route: AppRoute = { screen: "repo", ref: "worktree", path: "", range };
  let category: SettingsCategory = "files";
  const searchHosts: HTMLElement[] = [];
  const openedHelp: HelpSection[] = [];
  const page = createSettingsPage({
    $: fixture$,
    setRoute: (next) => {
      route = next;
    },
    setPageMode: () => undefined,
    setStatus: () => undefined,
    currentRange: () => range,
    cancelActiveSourceLoad: () => true,
    removeStandaloneSource: () => undefined,
    clearLoadQueue: () => undefined,
    getLanguage: () => lang,
    mountViewerSettings: () => undefined,
    mountSettingsSearch: (host) => {
      searchHosts.push(host);
    },
    settingsCategories: () => SAMPLE_CATEGORIES,
    getSettingsCategory: () => category,
    setSettingsCategory: (next) => {
      category = next;
    },
    revealHeading: (id) => {
      const owner = SAMPLE_HEADINGS[id];
      if (owner) category = owner;
    },
    hasHeading: (id) => id in SAMPLE_HEADINGS,
    openHelpSection: (section) => {
      openedHelp.push(section);
    },
  });
  page.openSettingsPage();
  return {
    page,
    route: () => route,
    category: () => category,
    searchHosts,
    openedHelp,
  };
}

/** app だけが持つ名前 (本物は app.ts の UI_TEXT の値)。 */
const APP_LABELS: Record<HelpLanguage, AppHelpLabels> = {
  en: {
    diff: "Diff",
    history: "History",
    worktree: "Worktrees",
    tools: "Tools",
    split: "split",
    unified: "unified",
    ignoreWs: "ws",
    hideTests: "no test",
    paletteKey: "⌘K",
  },
  ja: {
    diff: "差分",
    history: "履歴",
    worktree: "作業ツリー",
    tools: "ツール",
    split: "分割",
    unified: "統合",
    ignoreWs: "空白",
    hideTests: "テスト非表示",
    paletteKey: "⌘K",
  },
};

function renderHelpPage(
  lang: HelpLanguage,
  section: HelpSection | string,
  overrides: Partial<HelpPageDeps> = {},
) {
  document.body.innerHTML = FIXTURE_DOM;
  let route: AppRoute = {
    screen: "help",
    lang,
    section,
    range: { from: "HEAD", to: "worktree" },
  };
  const calls: string[] = [];
  const page = createHelpPage({
    $: fixture$,
    getRoute: () => route,
    setRoute: (next) => {
      route = next;
    },
    setPageMode: () => undefined,
    cancelActiveSourceLoad: () => true,
    removeStandaloneSource: () => undefined,
    clearLoadQueue: () => undefined,
    currentRange: () => ({ from: "HEAD", to: "worktree" }),
    syncHeaderMenu: () => undefined,
    getLanguage: () => lang,
    helpLabels: (labelLang) => helpLabels(labelLang, APP_LABELS[labelLang]),
    openAccountsSettings: () => calls.push("openAccountsSettings"),
    toggleKeyboardShortcuts: () => calls.push("toggleKeyboardShortcuts"),
    getKeyBindings: () => DEFAULT_KEY_BINDINGS,
    openShortcutSettings: () => calls.push("openShortcutSettings"),
    installOffer: HIDDEN_INSTALL_OFFER,
    ...overrides,
  });
  page.renderHelpPage();
  return { page, calls, route: () => route };
}

describe("settings page", () => {
  // 電話の段では 2 段の画面: ほかの画面から入ると目次 (1 段目)、節を選ぶと本文
  // (2 段目)、頭の「‹ 目次」で 1 段目へ戻る。節を指して開いたときは 2 段目から。
  describe("on a phone: contents, then a section", () => {
    let phone = true;
    let originalMatchMedia: typeof window.matchMedia;
    beforeAll(() => {
      originalMatchMedia = window.matchMedia;
      window.matchMedia = ((query: string) => ({
        get matches() {
          return query === PHONE_MEDIA_QUERY && phone;
        },
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      })) as unknown as typeof window.matchMedia;
    });
    afterAll(() => {
      window.matchMedia = originalMatchMedia;
      phone = true;
    });
    const level = () =>
      document
        .querySelector(".gdp-help-layout")
        ?.classList.contains("gdp-help-nav-open")
        ? "contents"
        : "section";
    const heading = () =>
      document.querySelector(".gdp-help-content h2")?.textContent;

    test("entering shows the contents, a pick shows that section, the toggle row goes back", () => {
      phone = true;
      renderSettings();
      const entered = level();
      clickNav("Agents");
      const picked = [level(), heading()];
      document
        .querySelector<HTMLButtonElement>(".gdp-help-nav-toggle")
        ?.click();
      expect({ entered, picked, back: level() }).toEqual({
        entered: "contents",
        picked: ["section", "Agents"],
        back: "contents",
      });
    });

    test("typing in the settings search from the contents shows the section", () => {
      phone = true;
      const view = renderSettings();
      const input = document.createElement("input");
      view.searchHosts[0]?.append(input);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      expect(level()).toBe("section");
    });

    test("opening a heading directly skips the contents", () => {
      phone = true;
      const view = renderSettings();
      view.page.openSettingsAt("sample-accounts-title");
      expect([level(), heading()]).toEqual(["section", "Accounts"]);
    });

    test("coming from the help page shows the contents again", () => {
      phone = true;
      renderHelpPage("en", "overview");
      document
        .querySelector<HTMLButtonElement>(".gdp-help-nav-toggle")
        ?.click();
      clickNav("Getting started");
      expect(level()).toBe("section");
      const view = renderSettings("en", true);
      expect(level()).toBe("contents");
      expect(view.route().screen).toBe("settings");
    });

    test("off the phone the contents stay folded when entering", () => {
      phone = false;
      renderSettings();
      expect(level()).toBe("section");
    });
  });

  test("lists only the settings categories, under the Settings title", () => {
    const view = renderSettings();
    expect({
      title: document.querySelector(".gdp-help-header h1")?.textContent,
      nav: navItems(),
      h2: document.querySelector(".gdp-help-content h2")?.textContent,
      searchHosts: view.searchHosts.length,
      route: view.route(),
    }).toEqual({
      title: "Settings",
      nav: ["Files *", "Shortcuts", "Agents", "Accounts", "Advanced"],
      h2: "Files",
      searchHosts: 1,
      route: { screen: "settings", range: { from: "HEAD", to: "worktree" } },
    });
  });

  test("picking a category keeps the Files tree and shows that category", () => {
    const view = renderSettings();
    // 右の列の Files の木は設定の画面でも出ている。分類を変えても消さない。
    const filelist = document.getElementById("filelist");
    filelist?.append(document.createElement("li"));
    clickNav("Agents");
    expect({
      files: filelist?.childElementCount,
      category: view.category(),
      nav: navItems(),
      h2: document.querySelector(".gdp-help-content h2")?.textContent,
    }).toEqual({
      files: 1,
      category: "agents",
      nav: ["Files", "Shortcuts", "Agents *", "Accounts", "Advanced"],
      h2: "Agents",
    });
  });

  // openSettingsAt: ほかの画面 (アカウントの帯・通知・ヘルプの案内) から見出しへ送る。
  test.each<[string, SettingsCategory]>([
    ["sample-accounts-title", "accounts"],
    ["sample-shortcuts-title", "shortcuts"],
  ])("openSettingsAt(%s) opens the settings page on the %s category", (id, expected) => {
    const view = renderSettings();
    view.page.openSettingsAt(id);
    expect([
      view.route().screen,
      view.category(),
      navItems().filter((item) => item.endsWith(" *")),
    ]).toEqual([
      "settings",
      expected,
      [
        `${SAMPLE_CATEGORIES.find((category) => category.id === expected)?.label} *`,
      ],
    ]);
  });

  // 設定とヘルプが 1 つのページだった頃の /help#<設定の見出し> を設定へ移すかの判断。
  test.each<[string, string | null]>([
    ["#sample-accounts-title", "sample-accounts-title"],
    ["#sample-shortcuts-title", "sample-shortcuts-title"],
    ["#getting-started", null],
    ["", null],
    ["#", null],
  ])("the hash %j is the settings heading %j", (hash, expected) => {
    const view = renderSettings();
    expect(view.page.headingInHash(hash)).toBe(expected);
  });

  test.each<[HelpLanguage, SettingsCategory, HelpSection, string]>([
    ["en", "accounts", "add-account", "Help › Add an account"],
    ["ja", "accounts", "add-account", "ヘルプ › アカウントを追加する"],
    ["en", "shortcuts", "keybindings", "Help › Keyboard shortcuts"],
    ["ja", "shortcuts", "keybindings", "ヘルプ › キーボードショートカット"],
  ])("in %s the %s category links to the help section %s", (lang, category, section, label) => {
    const view = renderSettings(lang);
    view.page.openSettingsAt(`sample-${category}-title`);
    const link = document.querySelector<HTMLAnchorElement>(
      ".gdp-help-content .gdp-help-shortcut-link a",
    );
    link?.click();
    expect([
      link?.textContent,
      link?.getAttribute("href"),
      view.openedHelp,
    ]).toEqual([label, `/help?section=${section}`, [section]]);
    // リンクの文字はヘルプの左の列の名前と同じ。
    expect(label.endsWith(helpSectionName(lang, section))).toBe(true);
  });

  test("a category without a help note shows none", () => {
    renderSettings();
    expect(
      document.querySelector(".gdp-help-content .gdp-help-shortcut-link"),
    ).toBeNull();
  });
});

describe("help page", () => {
  test.each<[HelpLanguage, string, string[]]>([
    [
      "en",
      "Help",
      [
        "Getting started *",
        "Projects",
        "Read files",
        "Read diffs",
        "Search and history",
        "Worktrees",
        "Start an agent",
        "Watch your agents",
        "Notifications",
        "Reliable states (hooks)",
        "Add an account",
        "Terminal",
        "Tabs and layout",
        "Install as an app",
        "On a phone",
        "Datastores",
        "Tools",
        "AI annotations",
        "Let AI do it",
        "CLI and MCP for AI",
        "What it saves",
        "Troubleshooting",
        "Keyboard shortcuts",
      ],
    ],
    [
      "ja",
      "ヘルプ",
      [
        "導入手順 *",
        "プロジェクト",
        "ファイルを読む",
        "差分を読む",
        "検索と履歴",
        "作業ツリー",
        "エージェントを起動する",
        "エージェントの様子を見る",
        "通知を受け取る",
        "状態を正しく出す（フック）",
        "アカウントを追加する",
        "ターミナル",
        "タブと画面の配置",
        "アプリとして入れる",
        "SP で使う",
        "データストア",
        "ツール",
        "AI の注釈",
        "AI に任せる",
        "AI 向けの CLI と MCP",
        "保存するもの",
        "困ったとき",
        "キーボードショートカット",
      ],
    ],
  ])("in %s lists the help sections in the order people use them, under %s", (lang, title, nav) => {
    renderHelpPage(lang, "getting-started");
    expect({
      title: document.querySelector(".gdp-help-header h1")?.textContent,
      nav: navItems(),
      search: document.querySelector(".gdp-help-search-row"),
    }).toEqual({ title, nav, search: null });
  });

  // 設定の節だった値は route が設定のページへ移す (routes.test.ts)。ここに来たら
  // 先頭の節を出す。
  test.each([
    { name: "an old settings value", section: "settings" },
    { name: "an unknown value", section: "sample-missing" },
    { name: "an empty value", section: "" },
  ])("$name shows Getting started", ({ section }) => {
    renderHelpPage("en", section);
    expect(navItems().filter((item) => item.endsWith(" *"))).toEqual([
      "Getting started *",
    ]);
  });

  // 構成を組み直す前の ?section= (保存したリンク・履歴・タブの並び) は、中身が
  // 移った節を開く。
  test.each([
    { old: "overview", nav: "Getting started *", h2: "Getting started" },
    { old: "add-project", nav: "Projects *", h2: "Add and switch projects" },
    { old: "storage", nav: "What it saves *", h2: "What code-viewer saves" },
    { old: "database", nav: "Datastores *", h2: "Browse datastores" },
    { old: "skills", nav: "Let AI do it *", h2: "Let AI do it (skills)" },
    { old: "mcp", nav: "CLI and MCP for AI *", h2: "CLI and MCP for AI" },
    { old: "add-account", nav: "Add an account *", h2: "Add an account" },
    { old: "start-agent", nav: "Start an agent *", h2: "Start an agent" },
    { old: "ask-ai", nav: "Let AI do it *", h2: "Let AI do it (skills)" },
    {
      old: "annotations",
      nav: "AI annotations *",
      h2: "Have AI explain code (annotations)",
    },
    {
      old: "keybindings",
      nav: "Keyboard shortcuts *",
      h2: "Keyboard shortcuts",
    },
  ])("the old ?section=$old opens $nav", ({ old, nav, h2 }) => {
    renderHelpPage("en", old);
    expect([
      navItems().filter((item) => item.endsWith(" *")),
      document.querySelector(".gdp-help-content h2")?.textContent,
    ]).toEqual([[nav], h2]);
  });

  test("every old value that is not a section any more has a place to go", () => {
    expect(HELP_SECTION_ALIASES).toEqual({
      overview: "getting-started",
      "add-project": "projects",
      storage: "project-files",
      database: "datastores",
      skills: "ask-ai",
      mcp: "ai-cli-mcp",
    });
  });

  test("picking a section moves ?section= and keeps the page", () => {
    const view = renderHelpPage("en", "getting-started");
    clickNav("Keyboard shortcuts");
    expect([
      view.route(),
      navItems().filter((item) => item.endsWith(" *")),
    ]).toEqual([
      {
        screen: "help",
        lang: "en",
        section: "keybindings",
        range: { from: "HEAD", to: "worktree" },
      },
      ["Keyboard shortcuts *"],
    ]);
  });

  test("a link to another section in the text opens that section", () => {
    const view = renderHelpPage("en", "getting-started");
    const link = [
      ...document.querySelectorAll<HTMLAnchorElement>(".gdp-help-content a"),
    ].find((a) => a.textContent === "Reliable states (hooks)");
    link?.click();
    expect([
      link?.getAttribute("href"),
      view.route(),
      document.querySelector(".gdp-help-content h2")?.textContent,
    ]).toEqual([
      "/help?section=agent-hooks",
      {
        screen: "help",
        lang: "en",
        section: "agent-hooks",
        range: { from: "HEAD", to: "worktree" },
      },
      "Show agent state reliably (install hooks)",
    ]);
  });

  test.each<HelpLanguage>([
    "en",
    "ja",
  ])("in %s the header button opens the keyboard shortcuts window by its name", (lang) => {
    const view = renderHelpPage(lang, "getting-started");
    const button = document.querySelector<HTMLButtonElement>(
      ".gdp-help-header button[data-quick-help-trigger]",
    );
    button?.click();
    expect([button?.textContent, view.calls]).toEqual([
      quickHelpText(lang).panelTitle,
      ["toggleKeyboardShortcuts"],
    ]);
  });

  test("the keys link in the text opens the keyboard shortcuts window", () => {
    const view = renderHelpPage("en", "tabs-layout");
    const link = [
      ...document.querySelectorAll<HTMLAnchorElement>(".gdp-help-content a"),
    ].find((a) => a.textContent === quickHelpText("en").panelTitle);
    link?.click();
    expect(view.calls).toEqual(["toggleKeyboardShortcuts"]);
  });

  test.each<[HelpLanguage, string]>([
    ["en", "Settings › Shortcuts"],
    ["ja", "設定 › ショートカット"],
  ])("in %s the key list links to %s", (lang, label) => {
    const view = renderHelpPage(lang, "keybindings");
    const link = document.querySelector<HTMLAnchorElement>(
      ".gdp-help-shortcut-link a",
    );
    link?.click();
    expect([link?.textContent, link?.getAttribute("href"), view.calls]).toEqual(
      [label, "/settings", ["openShortcutSettings"]],
    );
  });
});

describe("help page getting started", () => {
  test.each<[HelpLanguage, string[]]>([
    [
      "en",
      [
        "Start it",
        "Find your way around",
        "(Optional) Add another repository",
        "Install tmux",
        "Sign in to your account",
        "(Optional, recommended) Set up hooks",
        "Start an agent",
        "(Optional) Turn on notifications",
        "(Optional) Give your AI the skills",
        "If something does not work, run doctor",
      ],
    ],
    [
      "ja",
      [
        "起動する",
        "画面の見方",
        "（任意）ほかのリポジトリを足す",
        "tmux を入れる",
        "アカウントにログインする",
        "（任意・おすすめ）フックを入れる",
        "エージェントを起動する",
        "（任意）通知を有効にする",
        "（任意）AI にスキルを入れる",
        "うまく動かないときは doctor を見る",
      ],
    ],
  ])("in %s is the first section: ten numbered steps before any group", (lang, titles) => {
    renderHelpPage(lang, "getting-started");
    const content = document.querySelector(".gdp-help-content");
    expect([
      [
        ...(content?.querySelectorAll(
          ":scope > .gdp-help-steps > li > .gdp-help-step-title",
        ) ?? []),
      ].map((title) => title.textContent),
      content?.querySelectorAll(".gdp-help-group").length,
    ]).toEqual([titles, 0]);
  });

  test("the steps carry the commands to type", () => {
    renderHelpPage("en", "getting-started");
    expect(
      Array.from(
        document.querySelectorAll(".gdp-help-steps .gdp-help-command code"),
        (code) => code.textContent,
      ),
    ).toEqual([
      "npx @youtyan/code-viewer --open",
      "brew install tmux",
      "npx @youtyan/code-viewer skill install",
      "npx @youtyan/code-viewer doctor",
    ]);
  });
});

describe("help page text uses each screen's names", () => {
  /** 名前を差し替えたラベル (画面の文言が変われば本文も変わることを見る)。 */
  function renamed(lang: HelpLanguage): HelpLabels {
    const labels = helpLabels(lang, APP_LABELS[lang]);
    return {
      ...labels,
      agents: {
        ...labels.agents,
        sidebar: { ...labels.agents.sidebar, newAgent: "Sample new agent" },
        accounts: {
          ...labels.agents.accounts,
          loginButton: "Sample sign in",
          createdSignIn: "Sample sign in now",
        },
      },
    };
  }

  test.each<[HelpLanguage, string, string]>([
    ["en", "getting-started", "Sample new agent"],
    ["en", "getting-started", "Sample sign in"],
    ["ja", "start-agent", "Sample new agent"],
    ["ja", "add-account", "Sample sign in now"],
  ])("in %s the %s section shows a renamed button %j", (lang, section, name) => {
    renderHelpPage(lang, section, { helpLabels: renamed });
    const text = document.querySelector(".gdp-help-content")?.textContent ?? "";
    expect(text.includes(name)).toBe(true);
  });

  // 本文の［…］は画面の i18n の値そのもの (写した文字ではない)。
  test.each<[HelpLanguage, string, string[]]>([
    [
      "en",
      "getting-started",
      [
        "Projects",
        "Register this folder",
        "Sign in",
        "Signed in",
        "Agent integration",
        "Set up",
        "New agent",
        "Launch",
        "All agents",
        "Enable notifications",
        "Environment doctor",
      ],
    ],
    [
      "ja",
      "getting-started",
      [
        "プロジェクト",
        "このディレクトリを登録",
        "ログイン",
        "ログイン済み",
        "エージェント連携",
        "入れる",
        "新しいエージェント",
        "起動",
        "すべてのエージェント",
        "通知を有効にする",
        "環境ドクター",
      ],
    ],
    [
      "ja",
      "add-account",
      [
        "設定",
        "アカウント",
        "アカウントを追加…",
        "新しく作る",
        "既にあるディレクトリを使う",
        "内容を確認…",
        "ログインする",
        "別のアカウントで続ける…",
        "起動して引き継ぐ",
      ],
    ],
    [
      "en",
      "agent-hooks",
      [
        "Settings",
        "Agents",
        "Agent integration",
        "Set up",
        "Finished · unread",
        "Hook target missing",
        "Repair",
        "Show how to set up",
        "Remove",
        "Advanced",
      ],
    ],
  ])("in %s the %s section names the buttons as the screens do", (lang, section, names) => {
    renderHelpPage(lang, section);
    const shown = Array.from(
      document.querySelectorAll(".gdp-help-content .gdp-help-ui"),
      (ui) => ui.textContent ?? "",
    );
    expect(names.filter((name) => !shown.includes(name))).toEqual([]);
  });

  test.each<[HelpLanguage, string]>([
    ["en", "Settings › Accounts"],
    ["ja", "設定 › アカウント"],
  ])("in %s the account section links to %s and warns about the browser account", (lang, label) => {
    const view = renderHelpPage(lang, "add-account");
    const link = [
      ...document.querySelectorAll<HTMLAnchorElement>(".gdp-help-content a"),
    ].find((a) => a.textContent === label);
    link?.click();
    expect([
      link?.getAttribute("href"),
      view.calls,
      document.querySelectorAll(
        ".gdp-help-content .gdp-help-note[data-kind='warning']",
      ).length,
    ]).toEqual(["/settings", ["openAccountsSettings"], 1]);
  });

  test.each<HelpLanguage>([
    "en",
    "ja",
  ])("in %s the AI section shows the skill install commands and every skill", (lang) => {
    renderHelpPage(lang, "ask-ai");
    const commands = Array.from(
      document.querySelectorAll(".gdp-help-command code"),
      (code) => code.textContent,
    );
    const skills = Array.from(
      document.querySelectorAll(".gdp-help-table tbody tr td:first-child"),
      (cell) => cell.textContent,
    );
    expect([commands, skills]).toEqual([
      [
        "code-viewer skill install",
        "code-viewer skill install --agent claude,codex",
        "code-viewer skill install --agent all --global",
      ],
      [
        "code-viewer-accounts",
        "code-viewer-annotate",
        "code-viewer-journal",
        "code-viewer-query",
        "code-viewer-snapshot",
      ],
    ]);
  });

  // 利用者の呼び方は「SP」。日本語の本文に「電話」を混ぜない。
  test("the Japanese help calls the phone layout SP", () => {
    renderHelpPage("ja", "phone");
    const text = document.querySelector(".gdp-help-content")?.textContent ?? "";
    expect([
      document.querySelector(".gdp-help-content h2")?.textContent,
      text.includes("電話"),
      mobileShellText("ja").tabsParkedTitle.includes("電話"),
    ]).toEqual(["SP で使う", false, false]);
  });
});

describe("help page commands", () => {
  const SECTIONS = ["read-diffs", "ai-cli-mcp", "ask-ai", "doctor"] as const;

  // 本文のコマンドは、今の CLI が受け付けるものだけ。
  test.each(
    (["en", "ja"] as const).flatMap((lang) =>
      SECTIONS.map((section) => [lang, section] as const),
    ),
  )("in %s every code-viewer query command in %s parses", (lang, section) => {
    renderHelpPage(lang, section);
    const queries = Array.from(
      document.querySelectorAll(".gdp-help-content code"),
      (code) => code.textContent ?? "",
    )
      .flatMap((text) => text.split("\n"))
      .filter((line) => line.startsWith("code-viewer query "));
    expect(
      queries.filter(
        (line) => !parseQueryArgs(line.trim().split(/\s+/).slice(2)).ok,
      ),
    ).toEqual([]);
  });
});

describe("help page install guide", () => {
  /** 状態を外から切り替えられる案内。install() の呼び出しを数える。 */
  function switchableOffer(initial: InstallOfferState) {
    let state = initial;
    let listener: (() => void) | null = null;
    const offer = {
      installs: 0,
      state: () => state,
      install: () => {
        offer.installs += 1;
        return Promise.resolve("accepted" as const);
      },
      onChange: (next: (() => void) | null) => {
        listener = next;
      },
      set(next: InstallOfferState) {
        state = next;
        listener?.();
      },
      listening: () => listener !== null,
    };
    return offer;
  }

  /** 「アプリとして入れる」の案内: [ボタンの文字, 手順の数] (案内が無ければ null)。 */
  function installGuide(): [string[], number] | null {
    const host = document.querySelector(".gdp-help-install");
    if (!host) return null;
    return [
      Array.from(host.querySelectorAll("button"), (b) => b.textContent ?? ""),
      host.querySelectorAll(".gdp-help-steps li").length,
    ];
  }

  test.each<["en" | "ja", InstallOfferState, [string[], number] | null]>([
    ["en", "prompt", [["Install code-viewer"], 2]],
    ["ja", "prompt", [["code-viewer をインストール"], 2]],
    ["en", "manual", [[], 2]],
    ["ja", "manual", [[], 2]],
    ["en", "hidden", null],
  ])("in %s with the offer %s the install section shows %j", (lang, state, expected) => {
    renderHelpPage(lang, "install-app", {
      installOffer: switchableOffer(state),
    });
    expect(installGuide()).toEqual(expected);
  });

  test("the install button appears when the browser starts offering, and asks the browser once", () => {
    const offer = switchableOffer("manual");
    renderHelpPage("en", "install-app", { installOffer: offer });
    expect(installGuide()).toEqual([[], 2]);
    offer.set("prompt");
    expect(installGuide()).toEqual([["Install code-viewer"], 2]);
    document
      .querySelector<HTMLButtonElement>(".gdp-help-install button")
      ?.click();
    expect(offer.installs).toBe(1);
    offer.set("manual");
    expect(installGuide()).toEqual([[], 2]);
  });

  test("a help section without the guide stops listening for the offer", () => {
    const offer = switchableOffer("manual");
    renderHelpPage("en", "install-app", { installOffer: offer });
    expect(offer.listening()).toBe(true);
    renderHelpPage("en", "datastores", { installOffer: offer });
    expect(offer.listening()).toBe(false);
  });
});

describe("help page keybinding reference", () => {
  test("documents every public default keymap action", () => {
    const documented = documentedHelpKeybindingActions();
    const allActions = new Set(
      DEFAULT_KEY_BINDINGS.map((binding) => binding.action),
    );
    const missing = [...allActions].filter(
      (action) =>
        !documented.has(action) && !HIDDEN_HELP_KEYBINDING_ACTIONS.has(action),
    );
    const staleHidden = [...HIDDEN_HELP_KEYBINDING_ACTIONS].filter(
      (action) => !allActions.has(action),
    );

    expect(missing).toEqual([]);
    expect(staleHidden).toEqual([]);
  });

  test("resolves every displayed keybinding back to its documented action", () => {
    const coverage = collectHelpKeybindingCoverage();

    expect(coverage.length).toBeTruthy();
    for (const { action, binding, label } of coverage) {
      const scopes = binding.scope ? [binding.scope] : KEYMAP_SCOPES;
      const resolves = scopes.some(
        (scope) =>
          resolveKeymapAction(
            {
              key: eventKeyForBinding(binding),
              ctrlKey: !!binding.ctrl,
              metaKey: !!binding.meta,
              altKey: !!binding.alt,
              shiftKey: !!binding.shift,
            },
            {
              scope,
              editable: false,
              pendingG: !!binding.pendingG,
              lightboxOpen: false,
            },
          ) === action,
      );

      expect(`${action}:${label}:${binding.key}:${resolves}`).toBe(
        `${action}:${label}:${binding.key}:true`,
      );
    }
  });

  test("keeps generated keybinding rows structurally aligned across languages", () => {
    const englishGroups = buildHelpKeybindingGroups("en");
    const japaneseGroups = buildHelpKeybindingGroups("ja");

    expect(
      japaneseGroups.map((group) => group.rows.map(([keys]) => keys)),
    ).toEqual(englishGroups.map((group) => group.rows.map(([keys]) => keys)));
    expect(japaneseGroups.map((group) => group.rows.length)).toEqual(
      englishGroups.map((group) => group.rows.length),
    );
    expect(
      englishGroups
        .flatMap((group) => group.rows.map(([keys]) => keys))
        .filter((keys) => keys === ""),
    ).toEqual([]);
  });
});

describe("help page captures", () => {
  /**
   * 節ごとに描く画面のキャプチャ (出る順)。本文は撮る予定の画面も名前で書いて
   * あり、撮っていないもの (HELP_CAPTURES に無いもの) は描かない。撮り直すのは
   * scripts/help-captures.mjs。
   */
  const FIGURES: Array<[string, string[]]> = [
    [
      "getting-started",
      [
        "overview",
        "overview-marked",
        "project-register",
        "sidebar-no-tmux",
        "accounts-sign-in",
        "hooks-section",
        "agent-launch",
        "notify-enable",
        "skill-install",
        "doctor-sheet",
      ],
    ],
    ["projects", ["project-add", "project-register", "projects-menu"]],
    ["read-files", ["files-open", "files-line-select"]],
    ["read-diffs", ["diff-screen"]],
    ["search", ["search-palette", "history-screen"]],
    ["worktrees", ["worktrees-screen"]],
    ["start-agent", ["agent-new", "agent-launch"]],
    ["agent-state", ["agent-running", "agents-board"]],
    ["notifications", ["notify-enable"]],
    ["agent-hooks", ["hooks-section", "hooks-dialog"]],
    [
      "add-account",
      [
        "accounts-list",
        "accounts-add",
        "accounts-review",
        "accounts-sign-in",
        "accounts-signed-in",
      ],
    ],
    ["terminal", ["terminal-tab"]],
    ["tabs-layout", ["tabs-groups", "tabs-split"]],
    ["install-app", []],
    ["phone", ["phone-screen"]],
    ["datastores", ["datastore-grid"]],
    ["tools", ["tools-markdown"]],
    ["annotations", ["annotations-panel"]],
    ["ask-ai", ["skill-install"]],
    ["ai-cli-mcp", []],
    ["project-files", []],
    ["doctor", ["doctor-sheet"]],
    ["keybindings", ["quick-help"]],
  ];
  /** 1 枚と全部の大きさの上限、画像の幅 (800 CSS px を 1.5 倍の画素で撮る)。 */
  const MAX_IMAGE_BYTES = 150 * 1024;
  const MAX_TOTAL_BYTES = 2 * 1024 * 1024;
  const IMAGE_WIDTH = 1200;
  const IMAGE_DIR = join(WEB_ROOT, "help-images");

  function renderedFigures(lang: HelpLanguage, section: string) {
    renderHelpPage(lang, section);
    return [...document.querySelectorAll(".gdp-help-figure")].map((link) => {
      const img = link.querySelector("img");
      return {
        href: link.getAttribute("href"),
        src: img?.getAttribute("src"),
        alt: img?.getAttribute("alt") ?? "",
      };
    });
  }

  /** WebP の幅 (可逆 VP8L・非可逆 VP8・拡張 VP8X の見出しから)。 */
  function webpWidth(bytes: Buffer): number {
    const chunk = bytes.toString("ascii", 12, 16);
    if (chunk === "VP8L") return 1 + (bytes.readUInt16LE(21) & 0x3fff);
    if (chunk === "VP8 ") return bytes.readUInt16LE(26) & 0x3fff;
    if (chunk === "VP8X") return 1 + bytes.readUIntLE(24, 3);
    throw new Error(`not a WebP image (chunk ${JSON.stringify(chunk)})`);
  }

  const CASES = (["en", "ja"] as const).flatMap((lang) =>
    FIGURES.map(([section, names]) => [lang, section, names] as const),
  );

  test("the table covers every help section", () => {
    renderHelpPage("en", "getting-started");
    expect(FIGURES.map(([section]) => section)).toEqual([
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
    ]);
  });

  test.each(
    CASES,
  )("in %s the %s section shows its captures, each with a description", (lang, section, names) => {
    const figures = renderedFigures(lang, section);
    expect(
      figures.map(({ href, src, alt }) => [href === src, src, alt !== ""]),
    ).toEqual(
      names.map((name) => [true, `/help-images/${name}.${lang}.webp`, true]),
    );
  });

  test("ships exactly the captures the help shows", () => {
    const shown = [
      ...new Set(
        CASES.flatMap(([lang, , names]) =>
          names.map((name) => `${name}.${lang}.webp`),
        ),
      ),
    ].sort();
    expect(readdirSync(IMAGE_DIR).sort()).toEqual(shown);
  });

  // 撮った画像の一覧 (描くかどうかを決める) と、置いてある画像が食い違わない。
  test("the list of taken captures matches web/help-images", () => {
    const files = readdirSync(IMAGE_DIR);
    expect(files.sort()).toEqual(
      [...HELP_CAPTURES]
        .flatMap((name) => [`${name}.en.webp`, `${name}.ja.webp`])
        .sort(),
    );
  });

  test("the server hands out each capture as WebP from web/help-images", () => {
    const files = readdirSync(IMAGE_DIR);
    expect(files.map((file) => staticFileSpec(`/help-images/${file}`))).toEqual(
      files.map((file) => [`help-images/${file}`, "image/webp"]),
    );
  });

  test.each([
    "/help-images/../package.json",
    "/help-images/overview.en.png",
    "/help-images/Overview.en.webp",
    "/help-images/overview.fr.webp",
    "/help-images/sub/overview.en.webp",
  ])("the server does not map %s", (path) => {
    expect(staticFileSpec(path)).toBeNull();
  });

  test("every capture is 1200 px wide and within the size budget", () => {
    const files = readdirSync(IMAGE_DIR);
    const sizes = files.map((file) => statSync(join(IMAGE_DIR, file)).size);
    expect({
      wide: files.filter(
        (file) =>
          webpWidth(readFileSync(join(IMAGE_DIR, file))) !== IMAGE_WIDTH,
      ),
      heavy: files.filter((_, index) => sizes[index] > MAX_IMAGE_BYTES),
      total: sizes.reduce((sum, size) => sum + size, 0) <= MAX_TOTAL_BYTES,
    }).toEqual({ wide: [], heavy: [], total: true });
  });
});
