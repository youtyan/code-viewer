// インストールした窓 (PWA): manifest・アイコン・index.html の head が噛み合っていること、
// standalone のときだけブラウザのタブ操作のキーをメインの面のタブへ振り向けること。
import { readFileSync } from "node:fs";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { KeyEventLike } from "../core/keymap";
import type { Layout } from "../core/main-tabs";
import {
  lastTabNumber,
  type PwaKeyOutcome,
  type PwaKeyTarget,
  resolvePwaKey,
} from "../core/pwa";
import { staticFileSpec } from "../server/static-files";
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
      run("main-tab-new-menu") as PwaKeyOutcome,
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
    ["Cmd+K is not a tab key", "k", "cmd", true, true, "page", null],
    ["a plain w is not a tab key", "w", "", true, true, "page", null],
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
      run("main-tab-new-menu") as PwaKeyOutcome,
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
