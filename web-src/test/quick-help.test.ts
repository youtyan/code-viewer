import { GlobalRegistrator } from "@happy-dom/global-registrator";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "vitest";
import { createQuickHelp, type QuickHelpText } from "../views/quick-help";

beforeAll(() => {
  GlobalRegistrator.register();
});

afterAll(() => {
  GlobalRegistrator.unregister();
});

const EN_TEXT: QuickHelpText = {
  panelTitle: "Quick Help",
  close: "close quick help",
  viewAll: "View all keybindings",
};

const JA_TEXT: QuickHelpText = {
  panelTitle: "クイックヘルプ",
  close: "クイックヘルプを閉じる",
  viewAll: "すべてのキーバインドを見る",
};

function installFixtureDom() {
  document.body.innerHTML = [
    '<button id="quick-help-btn"></button>',
    '<div id="quick-help-popover" hidden>',
    '  <div class="quick-help-head">',
    '    <strong id="quick-help-title"></strong>',
    '    <button id="quick-help-close"></button>',
    "  </div>",
    '  <div id="quick-help-groups"></div>',
    '  <a id="quick-help-full-link" href="/help?section=keybindings"></a>',
    "</div>",
    '<div id="outside-marker"></div>',
  ].join("");
}

function makeQuickHelp(language: "en" | "ja" = "en", onOpenFull?: () => void) {
  installFixtureDom();
  return createQuickHelp({
    $: <T extends Element = HTMLElement>(sel: string): T => {
      const found = document.querySelector(sel);
      if (!found) throw new Error(`missing fixture element: ${sel}`);
      return found as T;
    },
    getLanguage: () => language,
    getText: () => (language === "ja" ? JA_TEXT : EN_TEXT),
    openFullKeybindings: () => onOpenFull?.(),
  });
}

describe("quick help popover", () => {
  beforeEach(() => {
    installFixtureDom();
  });

  test("trigger click opens the panel showing Global and Main Panel groups with AI/search shortcuts", () => {
    const quickHelp = makeQuickHelp();
    const trigger =
      document.querySelector<HTMLButtonElement>("#quick-help-btn");

    expect(quickHelp.isOpen()).toBe(false);
    trigger?.click();
    expect(quickHelp.isOpen()).toBe(true);

    const groupTitles = Array.from(
      document.querySelectorAll("#quick-help-groups .gdp-help-group h3"),
      (el) => el.textContent,
    );
    expect(groupTitles).toEqual(["Global", "Main Panel"]);

    const rowText = (
      document.querySelector("#quick-help-groups")?.textContent ?? ""
    ).toLowerCase();
    expect(rowText.includes("ai context")).toBe(true);
    expect(rowText.includes("file palette")).toBe(true);
    expect(rowText.includes("grep palette")).toBe(true);
    expect(rowText.includes("next unviewed file")).toBe(true);

    // Sidebar-only rows must not leak into the compact panel.
    expect(groupTitles.includes("Sidebar")).toBe(false);
  });

  test("re-clicking the trigger toggles the panel closed", () => {
    const quickHelp = makeQuickHelp();
    const trigger =
      document.querySelector<HTMLButtonElement>("#quick-help-btn");

    trigger?.click();
    expect(quickHelp.isOpen()).toBe(true);
    trigger?.click();
    expect(quickHelp.isOpen()).toBe(false);
  });

  test("Escape closes the open panel", () => {
    const quickHelp = makeQuickHelp();
    quickHelp.open();
    expect(quickHelp.isOpen()).toBe(true);

    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(quickHelp.isOpen()).toBe(false);
  });

  test("clicking outside the panel closes it, clicking inside does not", () => {
    const quickHelp = makeQuickHelp();
    quickHelp.open();

    document
      .querySelector("#quick-help-groups")
      ?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(quickHelp.isOpen()).toBe(true);

    document
      .querySelector("#outside-marker")
      ?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(quickHelp.isOpen()).toBe(false);
  });

  test("the full-keybindings link closes the panel and delegates navigation", () => {
    let openedFull = 0;
    const quickHelp = makeQuickHelp("en", () => {
      openedFull++;
    });
    quickHelp.open();

    document.querySelector<HTMLAnchorElement>("#quick-help-full-link")?.click();

    expect(openedFull).toBe(1);
    expect(quickHelp.isOpen()).toBe(false);
  });

  test("localize re-applies panel text and, when open, re-renders in the new language", () => {
    let language: "en" | "ja" = "en";
    installFixtureDom();
    const quickHelp = createQuickHelp({
      $: <T extends Element = HTMLElement>(sel: string): T =>
        document.querySelector(sel) as T,
      getLanguage: () => language,
      getText: () => (language === "ja" ? JA_TEXT : EN_TEXT),
      openFullKeybindings: () => undefined,
    });

    quickHelp.open();
    expect(document.querySelector("#quick-help-title")?.textContent).toBe(
      "Quick Help",
    );

    language = "ja";
    quickHelp.localize();

    expect(document.querySelector("#quick-help-title")?.textContent).toBe(
      "クイックヘルプ",
    );
    expect(
      document.querySelector("#quick-help-close")?.getAttribute("aria-label"),
    ).toBe("クイックヘルプを閉じる");
    expect(
      document.querySelector("#quick-help-popover")?.getAttribute("aria-label"),
    ).toBe("クイックヘルプ");
    const groupTitles = Array.from(
      document.querySelectorAll("#quick-help-groups .gdp-help-group h3"),
      (el) => el.textContent,
    );
    expect(groupTitles).toEqual(["グローバル", "メインパネル"]);
  });
});
