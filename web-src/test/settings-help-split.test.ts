// 設定とヘルプを別のページにしたことの、ページの外側: 左下の入口・タブの種類と
// 絵・保存したタブ・キーの割り当て・最初の描画の印。ページの中身は
// help-page.test.ts。

import { readFileSync } from "node:fs";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { GEAR_16_PATH, QUESTION_16_PATH } from "../core/icons";
import { DEFAULT_KEY_BINDINGS } from "../core/keymap";
import {
  isProjectKind,
  LAYOUT_VERSION,
  parseLayout,
  type TabTarget,
} from "../core/main-tabs";
import { pageModeClasses } from "../core/page-mode";
import type { AppRoute } from "../core/routes";
import { KEYMAP_ACTION_INFO } from "../views/help-keybindings";
import { routeTarget } from "../views/main-tabs/main-tabs-view";
import { pageIconPaths } from "../views/main-tabs/tab-icons";
import { searchPaletteText } from "../views/search-palette-i18n";

const range = { from: "HEAD", to: "worktree" };

beforeAll(() => {
  GlobalRegistrator.register();
});

afterAll(() => {
  GlobalRegistrator.unregister();
});

function indexDocument(): Document {
  return new DOMParser().parseFromString(
    readFileSync("web/index.html", "utf8"),
    "text/html",
  );
}

describe("the entries at the bottom of the left sidebar", () => {
  test("Settings and Help are two links to two pages", () => {
    const links = Array.from(
      indexDocument().querySelectorAll<HTMLAnchorElement>(".nav-foot a"),
      (link) => [
        link.id,
        link.dataset.route,
        link.getAttribute("href"),
        link.querySelector(".nav-foot-label")?.textContent,
      ],
    );
    expect(links).toEqual([
      ["nav-settings", "settings", "/settings", "Settings"],
      ["nav-help", "help", "/help", "Help"],
    ]);
  });

  test("the keyboard shortcuts window is named so before the app localizes it", () => {
    const doc = indexDocument();
    expect([
      doc.querySelector("#quick-help-title")?.textContent,
      doc.querySelector("#quick-help-popover")?.getAttribute("aria-label"),
      doc.querySelector("#quick-help-close")?.getAttribute("aria-label"),
      doc.querySelector("#quick-help-settings-link")?.getAttribute("href"),
    ]).toEqual([
      "Keyboard shortcuts",
      "Keyboard shortcuts",
      "Close keyboard shortcuts",
      "/settings",
    ]);
  });
});

describe("tabs of the two pages", () => {
  test.each<[AppRoute, TabTarget]>([
    [
      { screen: "settings", range },
      { kind: "page", page: "settings" },
    ],
    [
      { screen: "help", lang: "en", section: "overview", range },
      { kind: "page", page: "help" },
    ],
  ])("the route %j opens the tab %j", (route, target) => {
    expect(routeTarget(route, "/sample/repo")).toEqual(target);
  });

  test("neither tab belongs to a project", () => {
    expect([
      isProjectKind({ kind: "page", page: "settings" }),
      isProjectKind({ kind: "page", page: "help" }),
    ]).toEqual([false, false]);
  });

  test("the tab icons are the same as the entries: a gear and a question mark", () => {
    expect([pageIconPaths("settings"), pageIconPaths("help")]).toEqual([
      GEAR_16_PATH,
      QUESTION_16_PATH,
    ]);
  });

  // 1 つのページだった頃の help のタブはヘルプのまま読み、settings のタブも読む。
  test("a saved layout keeps an old help tab and reads a settings tab", () => {
    const parsed = parseLayout({
      version: LAYOUT_VERSION,
      focused: "left",
      panes: [
        {
          side: "left",
          activeId: "h",
          recent: ["h", "s"],
          tabs: [
            { id: "h", preview: false, target: { kind: "page", page: "help" } },
            {
              id: "s",
              preview: false,
              target: { kind: "page", page: "settings" },
            },
          ],
        },
      ],
    });
    expect([
      parsed.layout.panes.left.tabs.map((tab) => tab.target),
      parsed.dropped,
    ]).toEqual([
      [
        { kind: "page", page: "help" },
        { kind: "page", page: "settings" },
      ],
      [],
    ]);
  });
});

describe("keys and the palette", () => {
  test("? keeps opening the keyboard shortcuts window, now named so", () => {
    expect([
      DEFAULT_KEY_BINDINGS.filter((binding) => binding.action === "open-help"),
      KEYMAP_ACTION_INFO["open-help"].label,
      searchPaletteText("en").actions["open-help"],
      searchPaletteText("ja").actions["open-help"],
    ]).toEqual([
      [{ action: "open-help", key: "?", shift: true }],
      { en: "Show keyboard shortcuts", ja: "キーボードショートカットを表示" },
      "Keyboard shortcuts",
      "キーボードショートカット",
    ]);
  });

  test("the help page is an action without a default key", () => {
    expect([
      DEFAULT_KEY_BINDINGS.filter(
        (binding) => binding.action === "open-help-page",
      ),
      KEYMAP_ACTION_INFO["open-help-page"].label,
      searchPaletteText("en").actions["open-help-page"],
      searchPaletteText("ja").actions["open-help-page"],
    ]).toEqual([[], { en: "Open help", ja: "ヘルプを開く" }, "Help", "ヘルプ"]);
  });
});

test("the settings page is laid out like the help page", () => {
  expect([
    [...pageModeClasses({ screen: "settings", range }, false)],
    [
      ...pageModeClasses(
        { screen: "help", lang: "en", section: "overview", range },
        false,
      ),
    ],
  ]).toEqual([["gdp-help-page"], ["gdp-help-page"]]);
});
