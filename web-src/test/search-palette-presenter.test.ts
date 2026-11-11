// 検索のパレットの presenter (search-palette-ui.ts) を、表示 (view) を差し替えて
// 確かめる。presenter は描いた入力の欄と一覧を読むので、差し替える view は
// 渡された値を記録してから既定の表示に渡す。見るのは view に渡す値と、設定の
// 保存 (モデルの呼び出し)。既定の表示の形は search-palette*.test.ts と画面の撮影。

import "./_dom";
import { afterEach, describe, expect, test } from "vitest";
import type { SearchPaletteDeps } from "../views/search-palette-ui";
import {
  type PaletteViewProps,
  paletteTemplate,
} from "../views/search-palette-view";
import { q } from "./_test-helpers";

let seen: PaletteViewProps[] = [];
let saved: unknown[] = [];

afterEach(() => {
  document.body.innerHTML = "";
  seen = [];
  saved = [];
});

function last(): PaletteViewProps {
  const props = seen[seen.length - 1];
  if (!props) throw new Error("the palette was never drawn");
  return props;
}

async function openPalette(mode: "file" | "grep") {
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    writable: true,
    value: () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            ref: "worktree",
            generation: 1,
            files: [{ path: "src/sample.ts", type: "blob" }],
            truncated: false,
            matches: [],
          }),
          { headers: { "content-type": "application/json" } },
        ),
      ),
  });
  const { createSearchPalette } = await import("../views/search-palette-ui");
  const deps: SearchPaletteDeps = {
    STATE: {
      route: {
        screen: "repo",
        ref: "worktree",
        path: "",
        range: { from: "HEAD", to: "worktree" },
      },
      files: [],
      repoRef: "worktree",
      to: "worktree",
    },
    setRoute: () => undefined,
    openingNewTab: (run) => run(),
    currentRange: () => ({ from: "HEAD", to: "worktree" }),
    appendScopeParams: () => undefined,
    isAbortError: () => false,
    scrollToFile: () => undefined,
    openDiffFile: () => undefined,
    fileSourceTarget: (file) => ({ path: file.path, ref: "worktree" }),
    renderStandaloneSource: async () => undefined,
    repoFileCacheKey: (ref) => ref,
    trackLoad: (promise) => promise,
    getServerGeneration: () => 1,
    getSyntaxHighlight: () => false,
    inferLang: () => null,
    loadSourceShikiHighlighter: async () => null,
    sourceShikiLines: () => null,
    getLanguage: () => "en",
    getFileSelectionHistory: () => [],
    getGrepSelectionHistory: () => [],
    getGrepRegex: () => false,
    getGrepCaseSensitive: () => false,
    getGrepWholeWord: () => false,
    getGrepHideTests: () => false,
    getGrepGroupByFile: () => false,
    getGrepPaletteWidth: () => 800,
    getGrepPaletteHeight: () => undefined,
    persistGrepSettings: async (patch) => {
      saved.push(patch);
    },
    applyGrepHideTests: () => undefined,
    view: (props) => {
      seen.push(props);
      return paletteTemplate(props);
    },
  };
  const palette = createSearchPalette(deps);
  palette.openSearchPalette(mode);
  return palette;
}

describe("search palette presenter", () => {
  test("opening the text search passes the mode, the saved width and the grep toggles", async () => {
    const palette = await openPalette("grep");
    const props = last();
    expect({
      mode: props.mode,
      width: props.width,
      height: props.height,
      controls: props.controls.map((item) => [item.label, item.pressed]),
      pin: props.pin,
    }).toEqual({
      mode: "grep",
      width: 800,
      height: null,
      controls: [
        ["Plain", true],
        [".* Regex", false],
        ["Aa", false],
        ["Word", false],
        ["No test", false],
        ["Group files", false],
      ],
      pin: null,
    });
    palette.closeSearchPalette();
  });

  test("a toggle pressed in the view saves the setting and shows it pressed", async () => {
    const palette = await openPalette("grep");
    last().controls[1].onPress();
    await Promise.resolve();
    await Promise.resolve();
    expect({
      saved,
      regex: last().controls[1].pressed,
      plain: last().controls[0].pressed,
    }).toEqual({ saved: [{ grepRegex: true }], regex: true, plain: false });
    palette.closeSearchPalette();
  });

  test("switching the mode from the view opens the other search with the typed query", async () => {
    const palette = await openPalette("file");
    q<HTMLInputElement>(document, ".gdp-palette-input").value = "sample";
    last().onSwitchMode("grep");
    expect([last().mode, last().initialQuery, palette.paletteMode()]).toEqual([
      "grep",
      "sample",
      "grep",
    ]);
    palette.closeSearchPalette();
  });
});
