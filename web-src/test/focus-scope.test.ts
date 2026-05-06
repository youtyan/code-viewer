import { describe, expect, test } from "bun:test";
import {
  focusMainPanel,
  focusSidebarPanel,
  findMainScrollTarget,
  getPanelFocusScope,
  isEditableKeyTarget,
  keymapScope,
  restorePanelFocusScope,
  setPanelFocusScope,
} from "../focus-scope";

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
    expect(keymapScope(target("BUTTON", { "#sidebar": true }))).toBe("sidebar");
    expect(keymapScope(target("BUTTON", { "#content": true }))).toBe("main");
    expect(keymapScope(target("BODY"))).toBe("global");
  });

  test("detects editable keyboard targets", () => {
    expect(isEditableKeyTarget(target("INPUT"))).toBe(true);
    expect(isEditableKeyTarget(target("TEXTAREA"))).toBe(true);
    expect(
      isEditableKeyTarget(target("SPAN", { '[contenteditable="true"]': true })),
    ).toBe(true);
    expect(isEditableKeyTarget(target("BUTTON"))).toBe(false);
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

  test("panel focus helpers update the visual focus scope", () => {
    const calls: string[] = [];
    const sidebar = { focus: () => calls.push("sidebar") };
    const content = { focus: () => calls.push("content") };
    const doc = {
      body: { dataset: {} },
      querySelector: (selector: string) => {
        if (
          selector ===
          "#filelist li.active[data-path], #filelist .tree-dir.active[data-dirpath]"
        )
          return null;
        if (selector === "#sidebar") return sidebar;
        if (selector === "#content") return content;
        return null;
      },
    } as unknown as Document;

    focusSidebarPanel(doc);
    expect(calls).toEqual(["sidebar"]);
    expect(getPanelFocusScope(doc)).toBe("sidebar");

    focusMainPanel(doc);
    expect(calls).toEqual(["sidebar", "content"]);
    expect(getPanelFocusScope(doc)).toBe("main");
  });

  test("restores saved panel focus through the focus helpers", () => {
    const calls: string[] = [];
    const sidebar = { focus: () => calls.push("sidebar") };
    const content = { focus: () => calls.push("content") };
    const doc = {
      body: { dataset: {} },
      querySelector: (selector: string) => {
        if (
          selector ===
          "#filelist li.active[data-path], #filelist .tree-dir.active[data-dirpath]"
        )
          return null;
        if (selector === "#sidebar") return sidebar;
        if (selector === "#content") return content;
        return null;
      },
    } as unknown as Document;

    restorePanelFocusScope("main", doc);
    restorePanelFocusScope("sidebar", doc);
    restorePanelFocusScope(null, doc);

    expect(calls).toEqual(["content", "sidebar"]);
    expect(getPanelFocusScope(doc)).toBeNull();
  });

  test("finds a scrollable main-panel target beyond virtual source views", () => {
    const scrollable = {
      offsetParent: {},
      scrollHeight: 500,
      clientHeight: 200,
    } as HTMLElement;
    const content = {
      offsetParent: {},
      querySelectorAll: (selector: string) =>
        selector ===
        ".gdp-source-viewer, .gdp-markdown-layout, .gdp-markdown-preview, .d2h-files-diff, .d2h-file-diff"
          ? [scrollable]
          : [],
    } as unknown as HTMLElement;
    const doc = {
      activeElement: null,
      scrollingElement: {
        offsetParent: {},
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
