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
import {
  buildHelpKeybindingGroups,
  collectHelpKeybindingCoverage,
  documentedHelpKeybindingActions,
  HIDDEN_HELP_KEYBINDING_ACTIONS,
} from "../views/help-keybindings";
import {
  createHelpPage,
  type HelpSection,
  openHelpKeybindings,
  openHelpSection,
} from "../views/help-page";
import { mobileShellText } from "../views/mobile-shell-i18n";
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

describe("help page settings categories", () => {
  function renderSettings(section: HelpSection) {
    document.body.innerHTML = [
      '<main id="diff"></main>',
      '<div id="empty"></div>',
      '<div id="meta"></div>',
      '<div id="totals"></div>',
      '<div id="filelist"></div>',
    ].join("");
    const range = { from: "HEAD", to: "worktree" };
    let route: AppRoute = { screen: "help", lang: "en", section, range };
    let category: SettingsCategory = "general";
    const searchHosts: HTMLElement[] = [];
    const page = createHelpPage({
      $: <T extends Element = HTMLElement>(sel: string): T => {
        const found = document.querySelector(sel);
        if (!found) throw new Error(`missing fixture element: ${sel}`);
        return found as T;
      },
      getRoute: () => route,
      setRoute: (next) => {
        route = next;
      },
      setPageMode: () => undefined,
      cancelActiveSourceLoad: () => true,
      removeStandaloneSource: () => undefined,
      clearLoadQueue: () => undefined,
      currentRange: () => range,
      syncHeaderMenu: () => undefined,
      getLanguage: () => "en",
      mountViewerSettings: () => undefined,
      mountSettingsSearch: (host) => {
        searchHosts.push(host);
      },
      settingsCategories: () => [
        { id: "general", label: "General", description: "General text." },
        {
          id: "shortcuts",
          label: "Shortcuts",
          description: "Shortcuts text.",
        },
        { id: "agents", label: "Agents", description: "Agents text." },
        { id: "accounts", label: "Accounts", description: "Accounts text." },
        { id: "advanced", label: "Advanced", description: "Advanced text." },
      ],
      getSettingsCategory: () => category,
      setSettingsCategory: (next) => {
        category = next;
      },
      getKeyBindings: () => DEFAULT_KEY_BINDINGS,
      openShortcutSettings: () => undefined,
      installOffer: HIDDEN_INSTALL_OFFER,
    });
    page.renderHelpPage();
    const nav = () =>
      Array.from(
        document.querySelectorAll<HTMLElement>(".gdp-help-nav > *"),
        (item) =>
          `${item.tagName === "BUTTON" ? "" : "# "}${item.textContent}${item.classList.contains("active") ? " *" : ""}`,
      );
    const click = (label: string) => {
      const button = Array.from(
        document.querySelectorAll<HTMLButtonElement>(".gdp-help-nav button"),
      ).find((item) => item.textContent === label);
      if (!button) throw new Error(`missing nav button: ${label}`);
      button.click();
    };
    return {
      nav,
      click,
      route: () => route,
      category: () => category,
      searchHosts,
      /** openHelpSection で節を指して開く (設定の見出しへ送る経路)。 */
      openSection: (next: HelpSection) =>
        openHelpSection(
          {
            getRoute: () => route,
            getLanguage: () => "en",
            currentRange: () => range,
            setRoute: (value) => {
              route = value;
            },
            setPageMode: () => undefined,
            cancelActiveSourceLoad: () => true,
            renderHelpPage: (options) => page.renderHelpPage(options),
            setStatus: () => undefined,
          },
          next,
        ),
    };
  }

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
      const view = renderSettings("settings");
      const entered = level();
      view.click("Agents");
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
      const view = renderSettings("settings");
      const input = document.createElement("input");
      view.searchHosts[0]?.append(input);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      expect(level()).toBe("section");
    });

    test("opening a section directly skips the contents", () => {
      phone = true;
      const view = renderSettings("settings");
      view.openSection("settings");
      expect(level()).toBe("section");
    });

    test("off the phone the contents stay folded when entering", () => {
      phone = false;
      renderSettings("settings");
      expect(level()).toBe("section");
    });
  });

  test("lists the settings categories, then key bindings, then the help sections", () => {
    const view = renderSettings("settings");
    expect(view.nav()).toEqual([
      "# Settings",
      "General *",
      "Shortcuts",
      "Keybindings",
      "Agents",
      "Accounts",
      "Advanced",
      "# Help",
      "Getting Started",
      "Project Files",
      "AI Annotations",
      "Datastores",
      "Agent Skill",
      "MCP Server",
    ]);
    expect(document.querySelector(".gdp-help-content h2")?.textContent).toBe(
      "General",
    );
    expect(view.searchHosts).toHaveLength(1);
  });

  test("typing in the settings search on a help section moves to the settings section", () => {
    const view = renderSettings("storage");
    expect(view.searchHosts).toHaveLength(1);
    const input = document.createElement("input");
    view.searchHosts[0]?.append(input);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(view.route()).toMatchObject({ section: "settings" });
    expect(view.searchHosts).toHaveLength(2);
  });

  test("picking a category from a help section goes back to ?section=settings", () => {
    const view = renderSettings("storage");
    // 右の列の Files の木は設定の画面でも出ている。節を変えても消さない。
    const filelist = document.getElementById("filelist");
    filelist?.append(document.createElement("li"));
    view.click("Agents");
    expect(filelist?.childElementCount).toBe(1);
    expect(view.category()).toBe("agents");
    expect(view.route()).toMatchObject({ screen: "help", section: "settings" });
    expect(view.nav()).toContain("Agents *");
    expect(document.querySelector(".gdp-help-content h2")?.textContent).toBe(
      "Agents",
    );
    view.click("Keybindings");
    expect(view.route()).toMatchObject({ section: "keybindings" });
    expect(view.nav()).toContain("Keybindings *");
    expect(view.nav()).not.toContain("Agents *");
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
    document.body.innerHTML = [
      '<main id="diff"></main>',
      '<div id="empty"></div>',
      '<div id="meta"></div>',
      '<div id="totals"></div>',
      '<div id="filelist"></div>',
    ].join("");
    let route: AppRoute = {
      screen: "help",
      lang,
      section,
      range: { from: "HEAD", to: "worktree" },
    };
    const page = createHelpPage({
      $: <T extends Element = HTMLElement>(sel: string): T => {
        const found = document.querySelector(sel);
        if (!found) throw new Error(`missing fixture element: ${sel}`);
        return found as T;
      },
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
      mountViewerSettings: () => undefined,
      mountSettingsSearch: () => undefined,
      settingsCategories: () => [],
      getSettingsCategory: () => "general",
      setSettingsCategory: () => undefined,
      getKeyBindings: () => DEFAULT_KEY_BINDINGS,
      openShortcutSettings: () => undefined,
      installOffer,
    });
    page.renderHelpPage();
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
