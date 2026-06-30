import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import {
  DEFAULT_KEY_BINDINGS,
  type KeyBinding,
  type KeymapScope,
  resolveKeymapAction,
} from "../core/keymap";
import type { AppRoute } from "../core/routes";
import { parseQueryArgs } from "../server/query-cli";
import {
  buildHelpKeybindingGroups,
  collectHelpKeybindingCoverage,
  documentedHelpKeybindingActions,
  HIDDEN_HELP_KEYBINDING_ACTIONS,
} from "../views/help-keybindings";
import { createHelpPage, openHelpKeybindings } from "../views/help-page";

const KEYMAP_SCOPES: KeymapScope[] = ["global", "sidebar", "main"];
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

describe("help page database CLI reference", () => {
  function renderDatabaseHelp(lang: "en" | "ja"): {
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
      section: "database",
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
      setLanguage: () => undefined,
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

  function parseRenderedQueryCommand(command: string) {
    const parts = command.trim().split(/\s+/);
    expect(parts.slice(0, 2)).toEqual(["code-viewer", "query"]);
    return parseQueryArgs(parts.slice(2));
  }

  test("documents only wired query diff CLI commands in both languages", () => {
    for (const lang of ["en", "ja"] as const) {
      const { text, commands } = renderDatabaseHelp(lang);
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
