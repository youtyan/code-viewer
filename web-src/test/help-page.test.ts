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
import { agentsText } from "../views/agents/i18n";
import {
  GUIDE_SECTIONS,
  type GuideLabels,
  type GuideSection,
  guideLabels,
} from "../views/help-guides";
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
import { mainTabsText } from "../views/main-tabs/i18n";
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

const EXPECTED_QUERY_DIFF_COMMANDS = [
  "code-viewer query diff tables --before snap-abc123 --after snap-def456 --json",
  "code-viewer query diff rows --before snap-abc123 --after snap-def456 --table users --limit 50",
];

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
    guideLabels: (guideLang) =>
      guideLabels(guideLang, {
        accounts: guideLang === "ja" ? "アカウント" : "Accounts",
        paletteKey: "⌘K",
      }),
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
      clickNav("Getting Started");
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
    ["en", "shortcuts", "keybindings", "Help › Keyboard Shortcuts"],
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
        "Getting Started *",
        "Add an account",
        "Start an agent",
        "Add a project",
        "Let AI do it",
        "Keyboard Shortcuts",
        "Project Files",
        "AI Annotations",
        "Datastores",
        "Agent Skill",
        "MCP Server",
      ],
    ],
    [
      "ja",
      "ヘルプ",
      [
        "はじめに *",
        "アカウントを追加する",
        "エージェントを起動する",
        "プロジェクトを追加する",
        "AI に任せる",
        "キーボードショートカット",
        "プロジェクトファイル",
        "AI注釈",
        "データストア",
        "スキル登録",
        "MCPサーバー",
      ],
    ],
  ])("in %s lists the help sections only, under %s", (lang, title, nav) => {
    renderHelpPage(lang, "overview");
    expect({
      title: document.querySelector(".gdp-help-header h1")?.textContent,
      nav: navItems(),
      search: document.querySelector(".gdp-help-search-row"),
    }).toEqual({ title, nav, search: null });
  });

  // 設定の節だった値は route が設定のページへ移す (routes.test.ts)。ここに来たら
  // はじめにを出す。
  test("an unknown section shows Getting Started", () => {
    renderHelpPage("en", "settings");
    expect(navItems()[0]).toBe("Getting Started *");
  });

  test("picking a section moves ?section= and keeps the page", () => {
    const view = renderHelpPage("en", "overview");
    clickNav("Keyboard Shortcuts");
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
      ["Keyboard Shortcuts *"],
    ]);
  });

  test.each<HelpLanguage>([
    "en",
    "ja",
  ])("in %s the header button opens the keyboard shortcuts window by its name", (lang) => {
    const view = renderHelpPage(lang, "overview");
    const button = document.querySelector<HTMLButtonElement>(
      ".gdp-help-header button[data-quick-help-trigger]",
    );
    button?.click();
    expect([button?.textContent, view.calls]).toEqual([
      quickHelpText(lang).panelTitle,
      ["toggleKeyboardShortcuts"],
    ]);
  });

  test("the key list links to Settings › Shortcuts", () => {
    const view = renderHelpPage("en", "keybindings");
    const link = document.querySelector<HTMLAnchorElement>(
      ".gdp-help-shortcut-link a",
    );
    link?.click();
    expect([link?.getAttribute("href"), view.calls]).toEqual([
      "/settings",
      ["openShortcutSettings"],
    ]);
  });
});

describe("help page guides", () => {
  const LABEL_SETS: Record<HelpLanguage, GuideLabels> = {
    en: guideLabels("en", { accounts: "Accounts", paletteKey: "⌘K" }),
    ja: guideLabels("ja", { accounts: "アカウント", paletteKey: "⌘K" }),
  };

  /** その案内で使う名前 (GuideLabels の欄)。 */
  const USED: Record<GuideSection, Array<keyof GuideLabels>> = {
    "add-account": [
      "settings",
      "accounts",
      "add",
      "addKind",
      "addName",
      "addModeCreate",
      "addModeRegister",
      "addNext",
      "createRun",
      "registerRun",
      "login",
      "signedIn",
    ],
    "start-agent": [
      "newAgent",
      "launchKind",
      "launchAccount",
      "launchProject",
      "launchRun",
      "groupNewAgent",
    ],
    "add-project": [
      "projects",
      "addProject",
      "addProjectSubmit",
      "addProjectMenu",
      "paletteKey",
    ],
    "ask-ai": [],
  };

  // 名前は画面の i18n の値そのもの (写した文字ではない)。
  test.each<HelpLanguage>([
    "en",
    "ja",
  ])("in %s the labels are the values of each screen's i18n", (lang) => {
    const agents = agentsText(lang);
    expect(LABEL_SETS[lang]).toMatchObject({
      settings: agents.sidebar.settings,
      add: agents.accounts.add,
      addModeCreate: agents.accounts.addModeCreate,
      addModeRegister: agents.accounts.addModeRegister,
      login: agents.accounts.loginButton,
      newAgent: agents.sidebar.newAgent,
      launchAccount: agents.accounts.launchAccount,
      groupNewAgent: mainTabsText(lang).newAgentHere,
      projects: agents.sidebar.projects,
      addProject: agents.projects.addProject,
      addProjectMenu: agents.projects.addProjectMenu,
    });
  });

  const CASES = (["en", "ja"] as const).flatMap((lang) =>
    GUIDE_SECTIONS.map((section) => [lang, section] as const),
  );

  test.each(
    CASES,
  )("in %s the %s guide shows every name it uses", (lang, section) => {
    renderHelpPage(lang, section);
    const text = document.querySelector(".gdp-help-content")?.textContent ?? "";
    const labels = LABEL_SETS[lang];
    const missing = USED[section].filter((key) => !text.includes(labels[key]));
    expect([navItems().filter((item) => item.endsWith(" *")), missing]).toEqual(
      [[`${helpSectionName(lang, section)} *`], []],
    );
  });

  // 画面の文言が変われば案内も変わる (案内に文字を写していない)。
  test("a renamed button shows up in the guide", () => {
    renderHelpPage("en", "add-account", {
      guideLabels: () => ({
        ...LABEL_SETS.en,
        add: "Sample add button",
        login: "Sample sign-in button",
      }),
    });
    const text = document.querySelector(".gdp-help-content")?.textContent ?? "";
    expect([
      text.includes("Sample add button"),
      text.includes("Sample sign-in button"),
      text.includes(LABEL_SETS.en.add),
    ]).toEqual([true, true, false]);
  });

  test.each<HelpLanguage>([
    "en",
    "ja",
  ])("in %s the account guide links to Settings › Accounts and warns about the browser account", (lang) => {
    const view = renderHelpPage(lang, "add-account");
    const link = document.querySelector<HTMLAnchorElement>(
      ".gdp-help-content .gdp-help-shortcut-link a",
    );
    link?.click();
    const text = document.querySelector(".gdp-help-content")?.textContent ?? "";
    expect([
      link?.textContent,
      view.calls,
      text.includes(
        lang === "en"
          ? "second account of the same service"
          : "同じサービスで 2 つ目",
      ),
    ]).toEqual([
      `${LABEL_SETS[lang].settings} › ${LABEL_SETS[lang].accounts}`,
      ["openAccountsSettings"],
      true,
    ]);
  });

  test.each<HelpLanguage>([
    "en",
    "ja",
  ])("in %s the AI guide shows the skill install commands and every accounts command", (lang) => {
    renderHelpPage(lang, "ask-ai");
    const commands = Array.from(
      document.querySelectorAll(".gdp-help-command code"),
      (code) => code.textContent,
    );
    const rows = Array.from(
      document.querySelectorAll(".gdp-help-content th"),
      (th) => th.textContent,
    );
    expect([commands, rows]).toEqual([
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
        "list",
        "plan",
        "create",
        "register",
        "login",
        "wait",
        "rename",
        "remove",
      ],
    ]);
  });
});

describe("help page CLI reference", () => {
  function renderHelp(
    lang: "en" | "ja",
    section: HelpSection = "database",
    installOffer: InstallOffer = HIDDEN_INSTALL_OFFER,
  ): {
    text: string;
    commands: string[];
  } {
    renderHelpPage(lang, section, { installOffer });
    const root = document.querySelector("#diff");
    return {
      text: root?.textContent ?? "",
      commands: Array.from(
        document.querySelectorAll(".gdp-help-command code"),
        (code) => code.textContent ?? "",
      ),
    };
  }

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

  /** 「アプリとしてインストール」の節: [ボタンの文字, 手順の数] (節が無ければ null)。 */
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
  ])("Getting Started in %s with the offer %s shows the install guide %j", (lang, state, expected) => {
    const { text } = renderHelp(lang, "overview", switchableOffer(state));
    expect(installGuide()).toEqual(expected);
    // キーの説明は案内を出さないブラウザでも残る。
    expect(text).toContain(
      lang === "en" ? "Installed as an app" : "アプリとしてインストールすると",
    );
  });

  test("the install button appears when the browser starts offering, and asks the browser once", () => {
    const offer = switchableOffer("manual");
    renderHelp("en", "overview", offer);
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
    renderHelp("en", "overview", offer);
    expect(offer.listening()).toBe(true);
    renderHelp("en", "database", offer);
    expect(offer.listening()).toBe(false);
  });

  function parseRenderedQueryCommand(command: string) {
    const parts = command.trim().split(/\s+/);
    expect(parts.slice(0, 2)).toEqual(["code-viewer", "query"]);
    return parseQueryArgs(parts.slice(2));
  }

  test("documents only wired query diff CLI commands in both languages", () => {
    for (const lang of ["en", "ja"] as const) {
      const { text, commands } = renderHelp(lang);
      const diffCommands = commands.filter((command) =>
        command.startsWith("code-viewer query diff "),
      );
      expect(diffCommands).toEqual(EXPECTED_QUERY_DIFF_COMMANDS);
      for (const command of diffCommands) {
        expect(parseRenderedQueryCommand(command).ok).toBe(true);
      }
      expect(text.includes("code-viewer query diff create")).toBe(false);
      expect(text.includes("code-viewer query diff list")).toBe(false);
      expect(text.includes("code-viewer query diff delete")).toBe(false);
      expect(text.includes("code-viewer query diff tables --id")).toBe(false);
      expect(text.includes("code-viewer query diff rows --id")).toBe(false);
    }
  });

  test("documents Doctor checks and command overrides in both languages", () => {
    for (const lang of ["en", "ja"] as const) {
      const { text, commands } = renderHelp(lang, "overview");
      expect(text).toContain("rg");
      expect(text).toContain("tmux");
      expect(text).toContain("@lydell/node-pty");
      expect(commands.join("\n")).toContain("--bin rg=/opt/bin/rg");
      expect(commands.join("\n")).toContain("--bin tmux=/opt/bin/tmux");
    }
  });

  // 利用者の呼び方は「SP」。日本語の案内に「電話」を混ぜない。
  test("the Japanese help calls the phone layout SP", () => {
    const { text } = renderHelp("ja", "overview");
    expect(text).toContain("SP (640px 以下の窓");
    expect(text).not.toContain("電話");
    expect(mobileShellText("ja").tabsParkedTitle).not.toContain("電話");
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
