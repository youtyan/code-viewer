// インストールした窓 (PWA): manifest・アイコン・index.html の head が噛み合っていること、
// standalone のときだけブラウザのタブ操作のキーをメインの面のタブへ振り向けること。
import { readFileSync } from "node:fs";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { applyColorTheme, type ColorTheme } from "../core/color-themes";
import {
  defaultKeyBindings,
  type KeyEventLike,
  type KeyOutcome,
  resolveKeyOutcome,
} from "../core/keymap";
import type { Layout } from "../core/main-tabs";
import {
  createInstallOffer,
  type InstallOfferState,
  isChromeBrowser,
  lastTabNumber,
  syncThemeColor,
  type UserAgentBrand,
} from "../core/pwa";
import { staticFileSpec } from "../server/static-files";
import { themeVariants } from "./_color-themes";
import {
  baseRules,
  cascadedDeclarations,
  loadStyleSheet,
} from "./_css-fixture";
import { pngSize } from "./_pwa-fixture";

type Manifest = {
  icons: { src: string; sizes: string; type: string; purpose: string }[];
} & Record<string, unknown>;

function readManifest(): Manifest {
  return JSON.parse(readFileSync("web/manifest.webmanifest", "utf8"));
}

function servedPngSize(src: string): string {
  const spec = staticFileSpec(src);
  if (!spec) throw new Error(`${src} is not served`);
  expect(spec[1]).toBe("image/png");
  return pngSize(readFileSync(`web/${spec[0]}`));
}

describe("the web app manifest", () => {
  test("installs as a standalone window named code-viewer that starts at the root", () => {
    const { icons: _icons, ...fields } = readManifest();
    expect(fields).toEqual({
      id: "/",
      name: "code-viewer",
      short_name: "code-viewer",
      description: "Local code and git diff viewer",
      start_url: "/",
      scope: "/",
      display: "standalone",
      theme_color: "#101014",
      background_color: "#101014",
    });
  });

  test("is served as application/manifest+json", () => {
    expect(staticFileSpec("/manifest.webmanifest")).toEqual([
      "manifest.webmanifest",
      "application/manifest+json; charset=utf-8",
    ]);
  });

  test("every icon is served as a PNG of the size it declares, 192 and 512 for both purposes", () => {
    const icons = readManifest().icons.map((icon) => [
      icon.purpose,
      icon.sizes,
      icon.type,
      servedPngSize(icon.src),
    ]);
    expect(icons).toEqual([
      ["any", "192x192", "image/png", "192x192"],
      ["any", "512x512", "image/png", "512x512"],
      ["maskable", "192x192", "image/png", "192x192"],
      ["maskable", "512x512", "image/png", "512x512"],
    ]);
  });
});

describe("the head of index.html", () => {
  let head: Document;
  beforeAll(() => {
    GlobalRegistrator.register();
    head = new DOMParser().parseFromString(
      readFileSync("web/index.html", "utf8"),
      "text/html",
    );
  });
  afterAll(() => GlobalRegistrator.unregister());

  test("links the served manifest and apple-touch-icon by absolute paths (the same file under /p/<key>/)", () => {
    const manifest = head
      .querySelector('link[rel="manifest"]')
      ?.getAttribute("href");
    const touch = head
      .querySelector('link[rel="apple-touch-icon"]')
      ?.getAttribute("href");
    expect([manifest, staticFileSpec(manifest ?? "")?.[1]]).toEqual([
      "/manifest.webmanifest",
      "application/manifest+json; charset=utf-8",
    ]);
    expect([touch, servedPngSize(touch ?? "")]).toEqual([
      "/icons/apple-touch-icon.png",
      "180x180",
    ]);
  });

  test("the theme colors are the window ground of each theme, and the dark one is the manifest's", () => {
    const rules = baseRules(loadStyleSheet());
    const light = cascadedDeclarations(rules, (s) => s === ":root");
    // ダークはその規則だけから読む (_css-fixture の詳細度は属性セレクタを数えず、
    // :root と並べると :root が勝ってしまう)。
    const dark = cascadedDeclarations(
      rules,
      (s) => s === '[data-theme="dark"]',
    );
    const themeColors = Array.from(
      head.querySelectorAll('meta[name="theme-color"]'),
    ).map((meta) => [meta.getAttribute("media"), meta.getAttribute("content")]);
    expect(themeColors).toEqual([
      ["(prefers-color-scheme: dark)", dark.get("--color-ground")],
      ["(prefers-color-scheme: light)", light.get("--color-ground")],
    ]);
    expect(readManifest().theme_color).toBe(dark.get("--color-ground"));
  });
});

type Mods =
  | ""
  | "cmd"
  | "ctrl"
  | "cmd+shift"
  | "ctrl+shift"
  | "cmd+alt"
  | "cmd+ctrl";

function keyEvent(key: string, mods: Mods): KeyEventLike {
  const parts = mods.split("+");
  return {
    key,
    metaKey: parts.includes("cmd"),
    ctrlKey: parts.includes("ctrl"),
    shiftKey: parts.includes("shift"),
    altKey: parts.includes("alt"),
  };
}

const run = (action: string) => ({ kind: "run", action });
const SWALLOW = { kind: "swallow" };

type PwaKeyOutcome = KeyOutcome;
/**
 * キーを受けた場所。page: 本文 (入力欄の外)、input: 文字の入力欄、terminal:
 * xterm の中、blocked: ダイアログの中。
 */
type PwaKeyTarget = "page" | "input" | "terminal" | "blocked";

/** app の keydown と同じ形で、既定の割り当て (その OS の PWA の行を含む) を引く。 */
function resolvePwaKey(
  event: KeyEventLike,
  context: {
    standalone: boolean;
    mac: boolean;
    target: PwaKeyTarget;
    composing: boolean;
  },
): PwaKeyOutcome {
  return resolveKeyOutcome(
    event,
    {
      scope: "global",
      editable: context.target === "input" || context.target === "terminal",
      terminal: context.target === "terminal",
      pageKeymapBlocked: context.target === "blocked",
      standalone: context.standalone,
      mac: context.mac,
      composing: context.composing,
    },
    defaultKeyBindings(context.mac),
  );
}

describe("the tab keys of an installed window", () => {
  // [押し方, event.key, 修飾, standalone, mac, 受けた場所, 結果]
  test.each<
    [string, string, Mods, boolean, boolean, PwaKeyTarget, PwaKeyOutcome]
  >([
    [
      "a normal browser tab keeps its keys",
      "w",
      "cmd",
      false,
      true,
      "page",
      null,
    ],
    [
      "Cmd+W closes the front tab",
      "w",
      "cmd",
      true,
      true,
      "page",
      run("main-tab-close") as PwaKeyOutcome,
    ],
    [
      "Cmd+W from a terminal still closes the tab (Cmd is not a terminal key)",
      "w",
      "cmd",
      true,
      true,
      "terminal",
      run("main-tab-close") as PwaKeyOutcome,
    ],
    [
      "Cmd+W in a dialog does nothing but keeps the window",
      "w",
      "cmd",
      true,
      true,
      "blocked",
      SWALLOW as PwaKeyOutcome,
    ],
    [
      "Cmd+W in a text field still closes the tab (not a text editing key)",
      "w",
      "cmd",
      true,
      true,
      "input",
      run("main-tab-close") as PwaKeyOutcome,
    ],
    [
      "Ctrl+W on a Mac is not a browser key",
      "w",
      "ctrl",
      true,
      true,
      "page",
      null,
    ],
    ["Cmd+Alt+W is not in the table", "w", "cmd+alt", true, true, "page", null],
    [
      "Cmd+Ctrl+W is not in the table",
      "w",
      "cmd+ctrl",
      true,
      true,
      "page",
      null,
    ],
    [
      "Cmd+Shift+T reopens the last closed tab",
      "T",
      "cmd+shift",
      true,
      true,
      "page",
      run("main-tab-reopen") as PwaKeyOutcome,
    ],
    [
      "Cmd+T opens the + menu",
      "t",
      "cmd",
      true,
      true,
      "page",
      run("toggle-terminal-panel") as PwaKeyOutcome,
    ],
    [
      "Cmd+N does not open another window",
      "n",
      "cmd",
      true,
      true,
      "page",
      SWALLOW as PwaKeyOutcome,
    ],
    [
      "Cmd+1 is the first tab",
      "1",
      "cmd",
      true,
      true,
      "page",
      run("main-tab-1") as PwaKeyOutcome,
    ],
    [
      "Cmd+8 is the eighth tab",
      "8",
      "cmd",
      true,
      true,
      "page",
      run("main-tab-8") as PwaKeyOutcome,
    ],
    [
      "Cmd+9 is the last tab",
      "9",
      "cmd",
      true,
      true,
      "page",
      run("main-tab-last") as PwaKeyOutcome,
    ],
    [
      "Ctrl+Tab is the next tab",
      "Tab",
      "ctrl",
      true,
      true,
      "page",
      run("main-tab-next") as PwaKeyOutcome,
    ],
    [
      "Ctrl+Shift+Tab is the previous tab",
      "Tab",
      "ctrl+shift",
      true,
      true,
      "page",
      run("main-tab-previous") as PwaKeyOutcome,
    ],
    [
      "Ctrl+Tab in a terminal stays in the terminal",
      "Tab",
      "ctrl",
      true,
      true,
      "terminal",
      null,
    ],
    [
      "Cmd+Shift+] reported as } is the next tab",
      "}",
      "cmd+shift",
      true,
      true,
      "page",
      run("main-tab-next") as PwaKeyOutcome,
    ],
    [
      "Cmd+Shift+] reported as ] is the next tab",
      "]",
      "cmd+shift",
      true,
      true,
      "page",
      run("main-tab-next") as PwaKeyOutcome,
    ],
    [
      "Cmd+Shift+[ is the previous tab",
      "{",
      "cmd+shift",
      true,
      true,
      "page",
      run("main-tab-previous") as PwaKeyOutcome,
    ],
    // タブのキーでないものは、ページのキー割り当てのまま (窓のキーとして止めない)。
    [
      "Cmd+K is not a tab key: it stays the file palette",
      "k",
      "cmd",
      true,
      true,
      "page",
      run("open-file-palette") as PwaKeyOutcome,
    ],
    [
      "a plain w is not a tab key: it stays ignore-whitespace",
      "w",
      "",
      true,
      true,
      "page",
      run("toggle-ignore-whitespace") as PwaKeyOutcome,
    ],
    [
      "Ctrl+W closes the front tab off a Mac",
      "w",
      "ctrl",
      true,
      false,
      "page",
      run("main-tab-close") as PwaKeyOutcome,
    ],
    [
      "Ctrl+W in a terminal off a Mac deletes a word",
      "w",
      "ctrl",
      true,
      false,
      "terminal",
      null,
    ],
    [
      "Ctrl+W in a dialog off a Mac keeps the window",
      "w",
      "ctrl",
      true,
      false,
      "blocked",
      SWALLOW as PwaKeyOutcome,
    ],
    [
      "the Meta key off a Mac is not the tab modifier",
      "w",
      "cmd",
      true,
      false,
      "page",
      null,
    ],
    [
      "Ctrl+Shift+T off a Mac reopens the last closed tab",
      "T",
      "ctrl+shift",
      true,
      false,
      "page",
      run("main-tab-reopen") as PwaKeyOutcome,
    ],
    [
      "Ctrl+T off a Mac opens the + menu",
      "t",
      "ctrl",
      true,
      false,
      "page",
      run("toggle-terminal-panel") as PwaKeyOutcome,
    ],
    [
      "Ctrl+9 off a Mac is the last tab",
      "9",
      "ctrl",
      true,
      false,
      "page",
      run("main-tab-last") as PwaKeyOutcome,
    ],
    [
      "Ctrl+Tab off a Mac is the next tab",
      "Tab",
      "ctrl",
      true,
      false,
      "page",
      run("main-tab-next") as PwaKeyOutcome,
    ],
    [
      "Cmd+Shift+W still closes the window (never taken)",
      "W",
      "cmd+shift",
      true,
      true,
      "page",
      null,
    ],
    [
      "Ctrl+Shift+W off a Mac still closes the window (never taken)",
      "W",
      "ctrl+shift",
      true,
      false,
      "page",
      null,
    ],
    [
      "Ctrl+Shift+] off a Mac is not a tab key",
      "}",
      "ctrl+shift",
      true,
      false,
      "page",
      null,
    ],
  ])("%s", (_label, key, mods, standalone, mac, target, expected) => {
    expect(
      resolvePwaKey(keyEvent(key, mods), {
        standalone,
        mac,
        target,
        composing: false,
      }),
    ).toEqual(expected);
  });

  // ⌘← / ⌘→ (mac 以外は Ctrl) で隣のタブへ。PWA の窓だけ。入力欄では行の先頭・
  // 末尾へ動く今の働きのまま (ページは受けない)、端末の中ではタブを移る。
  test.each<[boolean, boolean, PwaKeyTarget, string, PwaKeyOutcome]>([
    [true, true, "page", "ArrowLeft", run("main-tab-previous") as KeyOutcome],
    [true, true, "page", "ArrowRight", run("main-tab-next") as KeyOutcome],
    [
      true,
      true,
      "terminal",
      "ArrowLeft",
      run("main-tab-previous") as KeyOutcome,
    ],
    [true, true, "terminal", "ArrowRight", run("main-tab-next") as KeyOutcome],
    [true, true, "input", "ArrowLeft", null],
    [true, true, "input", "ArrowRight", null],
    [true, true, "blocked", "ArrowLeft", null],
    [true, false, "page", "ArrowLeft", null],
    [true, false, "page", "ArrowRight", null],
    [true, false, "terminal", "ArrowRight", null],
    [false, true, "page", "ArrowLeft", run("main-tab-previous") as KeyOutcome],
    [false, true, "page", "ArrowRight", run("main-tab-next") as KeyOutcome],
    [false, true, "terminal", "ArrowRight", run("main-tab-next") as KeyOutcome],
    [false, true, "input", "ArrowRight", null],
    [false, false, "page", "ArrowRight", null],
  ])("mac %s, installed window %s, %s: the primary key + %s", (mac, standalone, target, key, expected) => {
    expect(
      resolvePwaKey(keyEvent(key, mac ? "cmd" : "ctrl"), {
        standalone,
        mac,
        target,
        composing: false,
      }),
    ).toEqual(expected);
  });

  test("keys typed while an IME is composing are left alone", () => {
    expect(
      resolvePwaKey(keyEvent("w", "cmd"), {
        standalone: true,
        mac: true,
        target: "page",
        composing: true,
      }),
    ).toBeNull();
  });

  const tab = (id: string) => ({
    id,
    target: { kind: "page" as const, page: "agents" as const },
    preview: false,
  });
  const pane = (ids: string[]) => ({
    tabs: ids.map(tab),
    activeId: ids[0] ?? null,
    recent: ids.slice(0, 1),
  });

  test.each<[string, Layout, number]>([
    [
      "the focused left pane",
      { panes: { left: pane(["a", "b", "c"]) }, focused: "left" },
      3,
    ],
    [
      "the focused right pane",
      {
        panes: { left: pane(["a"]), right: pane(["b", "c"]) },
        focused: "right",
        split: 0.5,
      },
      2,
    ],
    ["an empty pane", { panes: { left: pane([]) }, focused: "left" }, 0],
  ])("Cmd+9 goes to the last tab of %s", (_label, layout, expected) => {
    expect(lastTabNumber(layout)).toBe(expected);
  });

  test("a layout whose focused pane is missing is reported, not treated as empty", () => {
    expect(() =>
      lastTabNumber({ panes: { left: pane(["a"]) }, focused: "right" }),
    ).toThrow("pwa: the focused pane right is missing from the layout");
  });
});

describe("the window frame color follows the app theme", () => {
  // 全部のテーマ × 明暗。html に付ける属性の組と、その組で効く地の値
  // (_color-themes.ts がカスケードの順で解いたもの)。
  const VARIANTS = themeVariants();
  const root = () => document.documentElement;
  const setLook = (theme: "light" | "dark", colorTheme: ColorTheme) => {
    root().dataset.theme = theme;
    applyColorTheme(root(), colorTheme);
  };
  const themeColors = () =>
    Array.from(document.querySelectorAll('meta[name="theme-color"]'), (meta) =>
      meta.getAttribute("content"),
    );
  let style: HTMLStyleElement;
  beforeAll(() => {
    GlobalRegistrator.register();
    // index.html の head にある theme-color をそのまま使う。
    const page = new DOMParser().parseFromString(
      readFileSync("web/index.html", "utf8"),
      "text/html",
    );
    for (const meta of page.querySelectorAll('meta[name="theme-color"]'))
      document.head.append(document.importNode(meta, true));
    style = document.createElement("style");
    style.textContent = readFileSync("web/style.css", "utf8");
    document.head.append(style);
  });
  afterAll(() => GlobalRegistrator.unregister());

  test.each(VARIANTS)("$name paints both theme colors with its ground", ({
    theme,
    mode,
    vars,
  }) => {
    const ground = vars.get("--color-ground");
    if (!ground)
      throw new Error(`${theme} ${mode} does not set --color-ground`);
    setLook(mode, theme);
    syncThemeColor(document);
    expect(themeColors()).toEqual([ground, ground]);
  });

  test("switching back and forth repaints every time", () => {
    const seen: (string | null)[] = [];
    for (const { theme, mode } of [...VARIANTS, VARIANTS[0]]) {
      setLook(mode, theme);
      syncThemeColor(document);
      seen.push(themeColors()[0] ?? null);
    }
    // 全部の組の地はどれも違う (同じなら上の表の検査が何も見分けていない)。
    expect({
      distinct: new Set(seen.slice(0, VARIANTS.length)).size,
      back: seen[seen.length - 1],
    }).toEqual({ distinct: VARIANTS.length, back: seen[0] });
  });

  // いま見ているプロジェクトの色 (app がその変数を渡す)。テーマで値が替わる。
  test.each([
    ["light", ":root"],
    ["dark", '[data-theme="dark"]'],
  ])("theme %s paints the current project's color from %s", (theme, selector) => {
    const green = cascadedDeclarations(
      baseRules(loadStyleSheet()),
      (s) => s === selector,
    ).get("--project-green");
    if (!green) throw new Error(`${selector} does not set --project-green`);
    setLook(theme as "light" | "dark", "default");
    syncThemeColor(document, "--project-green");
    expect(themeColors()).toEqual([green, green]);
  });

  test("a page without the stylesheet is reported instead of painting an empty color", () => {
    style.remove();
    setLook("dark", "default");
    try {
      expect(() => syncThemeColor(document)).toThrow(
        'pwa: --color-ground is empty on <html data-theme="dark" data-color-theme="">',
      );
    } finally {
      document.head.append(style);
    }
  });
});

const CHROME: UserAgentBrand[] = [
  { brand: "Not)A;Brand", version: "8" },
  { brand: "Chromium", version: "140" },
  { brand: "Google Chrome", version: "140" },
];
const EDGE: UserAgentBrand[] = [
  { brand: "Not)A;Brand", version: "8" },
  { brand: "Chromium", version: "140" },
  { brand: "Microsoft Edge", version: "140" },
];

/** beforeinstallprompt の代わり。prompt() が呼ばれた回数を数える。 */
class FakeInstallPrompt extends Event {
  prompted = 0;
  constructor(private readonly outcome: "accepted" | "dismissed") {
    super("beforeinstallprompt");
  }
  prompt(): Promise<void> {
    this.prompted += 1;
    return Promise.resolve();
  }
  get userChoice() {
    return Promise.resolve({ outcome: this.outcome });
  }
}

function fakeWindow(brands: UserAgentBrand[] | undefined, standalone = false) {
  const target = new EventTarget();
  return Object.assign(target, {
    navigator: (brands ? { userAgentData: { brands } } : {}) as Navigator,
    matchMedia: (query: string) =>
      ({
        matches: standalone && query === "(display-mode: standalone)",
      }) as MediaQueryList,
  });
}

describe("the install offer", () => {
  test.each<
    [string, UserAgentBrand[] | undefined, boolean, boolean, InstallOfferState]
  >([
    ["Chrome before the browser offers", CHROME, false, false, "manual"],
    ["Chrome after the browser offers", CHROME, false, true, "prompt"],
    ["Chrome in the installed window", CHROME, true, true, "hidden"],
    ["Edge, even when it offers", EDGE, false, true, "hidden"],
    ["a browser without userAgentData", undefined, false, false, "hidden"],
  ])("%s", (_label, brands, standalone, offered, expected) => {
    const win = fakeWindow(brands, standalone);
    const offer = createInstallOffer(win);
    if (offered) win.dispatchEvent(new FakeInstallPrompt("accepted"));
    expect(offer.state()).toBe(expected);
  });

  test.each<[UserAgentBrand[] | undefined, boolean]>([
    [CHROME, true],
    [EDGE, false],
    [[{ brand: "Chromium", version: "140" }], false],
    [[], false],
    [undefined, false],
  ])("isChromeBrowser(%j) is %s", (brands, expected) => {
    expect(isChromeBrowser(brands)).toBe(expected);
  });

  test.each([
    "accepted",
    "dismissed",
  ] as const)("installing shows the browser's prompt once, returns %s and drops the button", async (outcome) => {
    const win = fakeWindow(CHROME);
    const offer = createInstallOffer(win);
    const states: InstallOfferState[] = [];
    offer.onChange(() => states.push(offer.state()));
    const event = new FakeInstallPrompt(outcome);
    win.dispatchEvent(event);
    await expect(offer.install()).resolves.toBe(outcome);
    expect(event.prompted).toBe(1);
    expect(states).toEqual(["prompt", "manual"]);
    await expect(offer.install()).rejects.toThrow(
      "pwa: the browser has not offered an install prompt",
    );
  });

  test("once installed, only the steps are left", () => {
    const win = fakeWindow(CHROME);
    const offer = createInstallOffer(win);
    let changes = 0;
    offer.onChange(() => {
      changes += 1;
    });
    win.dispatchEvent(new FakeInstallPrompt("accepted"));
    win.dispatchEvent(new Event("appinstalled"));
    expect([offer.state(), changes]).toEqual(["manual", 2]);
  });
});
