import { GlobalRegistrator } from "@happy-dom/global-registrator";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "vitest";
import {
  DEFAULT_KEY_BINDINGS,
  type KeyBinding,
  resolveKeyBindings,
} from "../core/keymap";
import { createQuickHelp } from "../views/quick-help";

beforeAll(() => {
  GlobalRegistrator.register();
});

afterAll(() => {
  GlobalRegistrator.unregister();
});

function installFixtureDom() {
  document.body.innerHTML = [
    // ヘルプのページの「キーボードショートカット」のボタンと同じ印。
    '<button id="sample-trigger" data-quick-help-trigger></button>',
    '<div id="quick-help-popover" hidden>',
    '  <div class="quick-help-head">',
    '    <strong id="quick-help-title"></strong>',
    '    <button id="quick-help-close"></button>',
    "  </div>",
    '  <div id="quick-help-groups"></div>',
    '  <a id="quick-help-settings-link" href="/settings"></a>',
    '  <a id="quick-help-full-link" href="/help?section=keybindings"></a>',
    "</div>",
    '<div id="outside-marker"></div>',
  ].join("");
}

function makeQuickHelp(
  language: "en" | "ja" = "en",
  onOpenFull?: () => void,
  onOpenSettings?: () => void,
  bindings: KeyBinding[] = DEFAULT_KEY_BINDINGS,
) {
  installFixtureDom();
  const quickHelp = createQuickHelp({
    $: <T extends Element = HTMLElement>(sel: string): T => {
      const found = document.querySelector(sel);
      if (!found) throw new Error(`missing fixture element: ${sel}`);
      return found as T;
    },
    getLanguage: () => language,
    getKeyBindings: () => bindings,
    openFullKeybindings: () => onOpenFull?.(),
    openSettings: () => onOpenSettings?.(),
  });
  // 呼び出し側 (ヘルプのページ) と同じく、ボタンの click で開閉する。
  document
    .querySelector("#sample-trigger")
    ?.addEventListener("click", quickHelp.toggle);
  return quickHelp;
}

/** ボタンを押す: mousedown (外を押したら閉じる、の判定) の後に click。 */
function pressTrigger() {
  const trigger = document.querySelector<HTMLButtonElement>("#sample-trigger");
  trigger?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  trigger?.click();
}

describe("quick help popover", () => {
  beforeEach(() => {
    installFixtureDom();
  });

  test("trigger click opens the panel showing Global and Main Panel groups with AI/search shortcuts", () => {
    const quickHelp = makeQuickHelp();

    expect(quickHelp.isOpen()).toBe(false);
    pressTrigger();
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

    // File-list-only rows must not leak into the compact panel.
    expect(groupTitles.includes("File list")).toBe(false);
  });

  test("shows the keys the user assigned in the shortcut settings", () => {
    const quickHelp = makeQuickHelp(
      "en",
      undefined,
      undefined,
      resolveKeyBindings({ "toggle-theme": [{ key: "x", alt: true }] }),
    );
    quickHelp.open();

    const themeRow = Array.from(
      document.querySelectorAll("#quick-help-groups tr"),
    ).find((row) => row.textContent?.includes("Toggle theme"));
    expect(themeRow?.querySelector("th")?.textContent).toBe("Alt+X");
  });

  test("re-clicking the trigger toggles the panel closed", () => {
    const quickHelp = makeQuickHelp();

    pressTrigger();
    expect(quickHelp.isOpen()).toBe(true);
    pressTrigger();
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
      getKeyBindings: () => DEFAULT_KEY_BINDINGS,
      openFullKeybindings: () => undefined,
      openSettings: () => undefined,
    });

    const names = () => ({
      title: document.querySelector("#quick-help-title")?.textContent,
      close: document
        .querySelector("#quick-help-close")
        ?.getAttribute("aria-label"),
      dialog: document
        .querySelector("#quick-help-popover")
        ?.getAttribute("aria-label"),
    });
    quickHelp.open();
    const english = names();

    language = "ja";
    quickHelp.localize();

    expect({ english, japanese: names() }).toEqual({
      english: {
        title: "Keyboard shortcuts",
        close: "Close keyboard shortcuts",
        dialog: "Keyboard shortcuts",
      },
      japanese: {
        title: "キーボードショートカット",
        close: "キーボードショートカットを閉じる",
        dialog: "キーボードショートカット",
      },
    });
    const groupTitles = Array.from(
      document.querySelectorAll("#quick-help-groups .gdp-help-group h3"),
      (el) => el.textContent,
    );
    expect(groupTitles).toEqual(["グローバル", "メインパネル"]);
  });
});
