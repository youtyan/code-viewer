import { describe, expect, test } from "vitest";
import {
  findMainScrollTarget,
  focusMainPanel,
  focusSidebarPanel,
  getPanelFocusScope,
  isEditableKeyTarget,
  isPageKeymapBlockedKey,
  isPageKeymapBlockedTarget,
  keymapScope,
  restorePanelFocusScope,
  setPanelFocusScope,
} from "../core/focus-scope";
import { resolveKeymapAction } from "../core/keymap";

function target(
  tagName: string,
  closestMap: Record<string, boolean> = {},
): Element {
  return {
    tagName,
    closest: (selector: string) => (closestMap[selector] ? {} : null),
  } as Element;
}

describe("focus scope helpers", () => {
  test("detects sidebar and main keymap scopes from the event target", () => {
    // ファイル一覧と変更ファイルの一覧は同じキー (sidebar)。
    expect(
      keymapScope(target("BUTTON", { "#sidebar, #file-list": true })),
    ).toBe("sidebar");
    expect(keymapScope(target("BUTTON", { "#content": true }))).toBe("main");
    expect(keymapScope(target("BUTTON", { ".main-pane-source": true }))).toBe(
      "main",
    );
    expect(keymapScope(target("BODY"))).toBe("global");
  });

  test.each([
    {
      name: "history screen panel",
      closest: { "#history-panel, .gdp-file-history-panel": true },
      expected: "history",
    },
    {
      name: "file History tab panel wins over #content",
      closest: {
        "#history-panel, .gdp-file-history-panel": true,
        "#content": true,
      },
      expected: "history",
    },
    {
      name: "the Tools / Search tab content wins over #content",
      closest: {
        "#tools-sheet, #search-sheet": true,
        "#content": true,
      },
      expected: "panel",
    },
  ])("keymap scope: $name", ({ closest, expected }) => {
    expect(keymapScope(target("LI", closest))).toBe(expected);
  });

  test("detects editable keyboard targets", () => {
    expect(isEditableKeyTarget(target("INPUT"))).toBe(true);
    expect(isEditableKeyTarget(target("TEXTAREA"))).toBe(true);
    expect(
      isEditableKeyTarget(target("SPAN", { '[contenteditable="true"]': true })),
    ).toBe(true);
    expect(isEditableKeyTarget(target("BUTTON"))).toBe(false);
  });

  test.each([
    ["xterm", { ".xterm": true }, true],
    ["modal dialog", { '[role="dialog"]:not(.gdp-palette)': true }, true],
    ["search palette", {}, false],
    ["ordinary button", {}, false],
  ])("blocks the page keymap for %s", (_name, closest, expected) => {
    expect(isPageKeymapBlockedTarget(target("BUTTON", closest))).toBe(expected);
  });

  // ターミナルは ⌘ (Meta) 付きのキーだけページの keymap に渡す。Ctrl は全部
  // ターミナルへ。ダイアログは ⌘ も塞ぐ。
  test.each([
    {
      name: "terminal Meta+K",
      on: ".xterm",
      key: "k",
      ctrl: false,
      meta: true,
      action: "open-file-palette",
    },
    {
      name: "terminal Meta+G",
      on: ".xterm",
      key: "g",
      ctrl: false,
      meta: true,
      action: "open-grep-palette",
    },
    {
      name: "terminal Ctrl+K",
      on: ".xterm",
      key: "k",
      ctrl: true,
      meta: false,
      action: null,
    },
    {
      name: "terminal Ctrl+C",
      on: ".xterm",
      key: "c",
      ctrl: true,
      meta: false,
      action: null,
    },
    {
      name: "terminal plain k",
      on: ".xterm",
      key: "k",
      ctrl: false,
      meta: false,
      action: null,
    },
    {
      name: "dialog Meta+K",
      on: '[role="dialog"]:not(.gdp-palette)',
      key: "k",
      ctrl: false,
      meta: true,
      action: null,
    },
    {
      name: "ordinary button Ctrl+K",
      on: null,
      key: "k",
      ctrl: true,
      meta: false,
      action: "open-file-palette",
    },
  ])("$name reaches the page keymap as $action", ({
    on,
    key,
    ctrl,
    meta,
    action,
  }) => {
    // xterm は textarea でキーを受ける (編集できる対象)。
    const el = target("TEXTAREA", on ? { [on]: true } : {});
    const event = {
      key,
      ctrlKey: ctrl,
      metaKey: meta,
      altKey: false,
      shiftKey: false,
    } as KeyboardEvent;
    expect(
      resolveKeymapAction(event, {
        scope: "global",
        editable: true,
        pageKeymapBlocked: isPageKeymapBlockedKey(el, meta),
      }),
    ).toBe(action);
  });

  test("stores the active panel focus scope on the document body", () => {
    const doc = { body: { dataset: {} } } as Document;

    setPanelFocusScope("sidebar", doc);
    expect(getPanelFocusScope(doc)).toBe("sidebar");

    setPanelFocusScope("main", doc);
    expect(getPanelFocusScope(doc)).toBe("main");

    setPanelFocusScope(null, doc);
    expect(getPanelFocusScope(doc)).toBeNull();
  });

  // 一覧へのフォーカス: 一覧を出す画面 (body[data-list-column]) は変更ファイルの
  // 一覧 (#sidebar)、ほかの画面はファイル一覧 (#file-list)。
  function panelDoc(listColumn: boolean, calls: string[]) {
    const lists = listColumn
      ? { root: "#sidebar", rows: "#filelist" }
      : { root: "#file-list", rows: "#file-list-rows" };
    return {
      body: { dataset: {}, hasAttribute: () => listColumn },
      querySelector: (selector: string) => {
        if (
          selector ===
          `${lists.rows} li.active[data-path], ${lists.rows} .tree-dir.active[data-dirpath]`
        )
          return null;
        if (selector === lists.root)
          return { focus: () => calls.push(lists.root) };
        if (selector === "#content")
          return { focus: () => calls.push("content") };
        return null;
      },
    } as unknown as Document;
  }

  test.each([
    { listColumn: true, list: "#sidebar" },
    { listColumn: false, list: "#file-list" },
  ])("panel focus helpers update the visual focus scope (list column $listColumn → $list)", ({
    listColumn,
    list,
  }) => {
    const calls: string[] = [];
    const doc = panelDoc(listColumn, calls);

    focusSidebarPanel(doc);
    expect(calls).toEqual([list]);
    expect(getPanelFocusScope(doc)).toBe("sidebar");

    focusMainPanel(doc);
    expect(calls).toEqual([list, "content"]);
    expect(getPanelFocusScope(doc)).toBe("main");
  });

  test("restores saved panel focus through the focus helpers", () => {
    const calls: string[] = [];
    const doc = panelDoc(true, calls);

    restorePanelFocusScope("main", doc);
    restorePanelFocusScope("sidebar", doc);
    restorePanelFocusScope(null, doc);

    expect(calls).toEqual(["content", "#sidebar"]);
    expect(getPanelFocusScope(doc)).toBeNull();
  });

  // 「画面に出ているか」は getClientRects で見る (本文の箱は position: fixed
  // なので offsetParent は常に null。ui-layout.md の「本文の箱」)。
  test("finds a scrollable main-panel target beyond virtual source views", () => {
    const onScreen = () => [{}] as unknown as DOMRectList;
    const scrollable = {
      getClientRects: onScreen,
      scrollHeight: 500,
      clientHeight: 200,
    } as unknown as HTMLElement;
    const content = {
      getClientRects: onScreen,
      querySelectorAll: (selector: string) =>
        selector ===
        ".gdp-source-viewer, .gdp-markdown-layout, .gdp-markdown-preview, .d2h-files-diff, .d2h-file-diff"
          ? [scrollable]
          : [],
    } as unknown as HTMLElement;
    const doc = {
      activeElement: null,
      scrollingElement: {
        getClientRects: onScreen,
        scrollHeight: 1000,
        clientHeight: 400,
      },
      defaultView: {
        getComputedStyle: (item: HTMLElement) => ({
          overflowY: item === scrollable ? "auto" : "visible",
        }),
      },
      querySelector: (selector: string) => {
        if (selector === "#content .gdp-source-virtual-scroller") return null;
        if (selector === "#content") return content;
        return null;
      },
    } as unknown as Document;

    expect(findMainScrollTarget(doc)).toBe(scrollable);
  });
});
