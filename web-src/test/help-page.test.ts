import { describe, expect, test } from "bun:test";
import {
  DEFAULT_KEY_BINDINGS,
  type KeyBinding,
  type KeymapScope,
  resolveKeymapAction,
} from "../core/keymap";
import type { AppRoute } from "../core/routes";
import {
  buildHelpKeybindingGroups,
  collectHelpKeybindingCoverage,
  documentedHelpKeybindingActions,
  HIDDEN_HELP_KEYBINDING_ACTIONS,
} from "../views/help-keybindings";
import { openHelpKeybindings } from "../views/help-page";

const KEYMAP_SCOPES: KeymapScope[] = ["global", "sidebar", "main"];

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
