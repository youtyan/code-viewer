import { afterEach, describe, expect, test } from "bun:test";
import { showEmptyHistoryDiffPane } from "../views/empty-diff-pane";
import { createSidebar } from "../views/sidebar";

const originalDocument = globalThis.document;
const originalRequestAnimationFrame = globalThis.requestAnimationFrame;

afterEach(() => {
  globalThis.document = originalDocument;
  globalThis.requestAnimationFrame = originalRequestAnimationFrame;
});

class FakeClassList {
  private classes = new Set<string>();

  constructor(value = "") {
    this.set(value);
  }

  set(value: string) {
    this.classes = new Set(value.split(/\s+/).filter(Boolean));
  }

  contains(name: string) {
    return this.classes.has(name);
  }

  // ai-dup-check: allow -- local fake DOM class list for this focused test.
  toggle(name: string, force?: boolean) {
    const next = force ?? !this.classes.has(name);
    if (next) this.classes.add(name);
    else this.classes.delete(name);
    return next;
  }

  toString() {
    return Array.from(this.classes).join(" ");
  }
}

class FakeElement {
  children: FakeElement[] = [];
  classList = new FakeClassList();
  dataset: Record<string, string> = {};
  attributes: Record<string, string> = {};
  parentElement: FakeElement | null = null;
  textContent = "";
  title = "";
  type = "";
  innerHTML = "";
  visible = true;
  private listeners: Record<string, Array<() => void>> = {};
  private classValue = "";

  constructor(
    public tagName = "div",
    public id = "",
  ) {}

  get className() {
    return this.classValue;
  }

  set className(value: string) {
    this.classValue = value;
    this.classList.set(value);
  }

  get offsetParent() {
    if (!this.parentElement) return null;
    for (let node: FakeElement | null = this; node; node = node.parentElement) {
      if (!node.visible) return null;
    }
    return this.parentElement;
  }

  appendChild(child: FakeElement) {
    this.detachChildFromParent(child);
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  append(...children: FakeElement[]) {
    for (const child of children) this.appendChild(child);
  }

  prepend(child: FakeElement) {
    this.detachChildFromParent(child);
    child.parentElement = this;
    this.children.unshift(child);
  }

  remove() {
    if (!this.parentElement) return;
    this.parentElement.children = this.parentElement.children.filter(
      (child) => child !== this,
    );
    this.parentElement = null;
  }

  setAttribute(name: string, value: string) {
    this.attributes[name] = value;
  }

  getAttribute(name: string) {
    return this.attributes[name] ?? null;
  }

  addEventListener(event: string, listener: () => void) {
    this.listeners[event] = [...(this.listeners[event] || []), listener];
  }

  click() {
    for (const listener of this.listeners.click || []) listener();
  }

  querySelector(selector: string) {
    return this.querySelectorAll(selector)[0] || null;
  }

  // ai-dup-check: allow -- local fake DOM selector traversal for this focused test.
  querySelectorAll(selector: string) {
    const selectors = selector.split(",").map((part) => part.trim());
    const found: FakeElement[] = [];
    const visit = (node: FakeElement) => {
      for (const child of node.children) {
        if (selectors.some((part) => child.matches(part))) found.push(child);
        visit(child);
      }
    };
    visit(this);
    return found;
  }

  matches(selector: string) {
    if (selector.startsWith("#")) return this.id === selector.slice(1);
    if (selector.startsWith("."))
      return this.classList.contains(selector.slice(1));
    return this.tagName.toLowerCase() === selector.toLowerCase();
  }

  // ai-dup-check: allow -- local fake DOM parent bookkeeping for this focused test.
  private detachChildFromParent(child: FakeElement) {
    if (!child.parentElement) return;
    child.parentElement.children = child.parentElement.children.filter(
      (existing) => existing !== child,
    );
  }
}

function installFakeDom() {
  const body = new FakeElement("body");
  const globalHeader = new FakeElement("header", "global-header");
  const topbar = new FakeElement("div", "topbar");
  const sidebar = new FakeElement("aside", "sidebar");
  const sidebarHead = new FakeElement("div");
  sidebarHead.className = "sb-head";
  const filter = new FakeElement("div");
  filter.className = "sb-filter-wrap";
  const filelist = new FakeElement("ul", "filelist");
  const toggle = new FakeElement("button", "sidebar-toggle");
  const label = new FakeElement("span");
  label.className = "sidebar-toggle-label";
  toggle.appendChild(label);
  sidebar.append(sidebarHead, filter, filelist);
  body.append(globalHeader, topbar, sidebar, toggle);
  globalThis.document = {
    body,
    createElement: (tagName: string) => new FakeElement(tagName),
    querySelector: (selector: string) => body.querySelector(selector),
    querySelectorAll: (selector: string) => body.querySelectorAll(selector),
  } as unknown as Document;
  globalThis.requestAnimationFrame = (() => 1) as typeof requestAnimationFrame;
  return { body, globalHeader, sidebarHead, topbar };
}

function createSidebarForTest(state: { sidebarHidden: boolean }) {
  return createSidebar({
    STATE: {
      sbView: "tree",
      sbWidth: 280,
      sidebarHidden: state.sidebarHidden,
      collapsedDirs: new Set(),
      lazyExpandedDirs: new Set(),
      files: [],
      activeFile: null,
      hideTests: false,
      viewedFiles: new Set(),
    },
    scrollToFile() {
      /* noop */
    },
    prefetchByPath() {
      /* noop */
    },
    fileBadge: () => new FakeElement("span") as unknown as HTMLElement,
    fileEntryIcon: () => "",
    applyViewedState() {
      /* noop */
    },
    persistCollapsedDirs() {
      /* noop */
    },
    persistLazyExpandedDirs() {
      /* noop */
    },
    appendScopeParams() {
      /* noop */
    },
    createOpenPathButton: () =>
      new FakeElement("button") as unknown as HTMLElement,
    normalizeViewerFontSize: () => "regular",
    getSidebarFontSize: () => "regular",
    persistSidebarHidden(hidden) {
      state.sidebarHidden = hidden;
    },
    persistSidebarWidth() {
      /* noop */
    },
    scheduleMainSurfaceFocus() {
      /* noop */
    },
    setChevronIcon() {
      /* noop */
    },
    trackLoad: (promise) => promise,
    getRepoSidebarRef: () => null,
    setRepoSidebarRef() {
      /* noop */
    },
    isTestPath: () => false,
    sidebarToggleTitle: (hidden) => (hidden ? "show sidebar" : "hide sidebar"),
    openDirectoryInOsTitle: () => "open this folder in OS",
    omittedDirectoryBadge: (reason) =>
      reason === "heavy"
        ? {
            label: "skipped",
            title:
              "Tree expansion is skipped, but the directory detail can be opened",
          }
        : {
            label: "private",
            title: "This directory cannot be opened from the browser",
          },
    $: <T extends Element = HTMLElement>(selector: string) =>
      document.querySelector(selector) as unknown as T,
    $$: <T extends Element = HTMLElement>(selector: string) =>
      Array.from(document.querySelectorAll(selector)) as unknown as T[],
  });
}

describe("sidebar toggle placement", () => {
  test("recreates a visible toggle after a hidden repo toolbar is removed", () => {
    const dom = installFakeDom();
    const state = { sidebarHidden: false };
    const sidebar = createSidebarForTest(state);
    const repoToolbar = new FakeElement("div");
    repoToolbar.className = "gdp-repo-toolbar";
    dom.body.appendChild(repoToolbar);

    sidebar.applySidebarHidden(true);
    let toggle = document.querySelector<HTMLElement>("#sidebar-toggle");
    expect(toggle?.parentElement).toBe(repoToolbar);
    expect(toggle?.offsetParent === null).toBe(false);
    expect(toggle?.innerHTML.includes("<svg")).toBe(true);

    repoToolbar.remove();
    expect(document.querySelector("#sidebar-toggle")).toBeNull();

    sidebar.placeSidebarToggle();
    toggle = document.querySelector<HTMLElement>("#sidebar-toggle");
    expect(toggle === null).toBe(false);
    expect(toggle?.parentElement).toBe(dom.topbar);
    expect(toggle?.offsetParent === null).toBe(false);
    expect(toggle?.getAttribute("aria-pressed")).toBe("true");
    expect(toggle?.innerHTML.includes("<svg")).toBe(true);

    toggle?.click();
    expect(
      document.querySelector<HTMLElement>("#sidebar-toggle")?.parentElement,
    ).toBe(dom.sidebarHead);
    expect(
      document.querySelector<HTMLElement>("#sidebar-toggle")?.offsetParent,
    ).toBeTruthy();
  });

  test("keeps the toggle visible across repeated hide and show clicks", () => {
    const dom = installFakeDom();
    const state = { sidebarHidden: false };
    const sidebar = createSidebarForTest(state);

    sidebar.applySidebarHidden(false);
    for (let i = 0; i < 4; i++) {
      const toggle = document.querySelector<HTMLElement>("#sidebar-toggle");
      expect(toggle === null).toBe(false);
      expect(toggle?.offsetParent === null).toBe(false);
      toggle?.click();
    }

    const toggle = document.querySelector<HTMLElement>("#sidebar-toggle");
    expect(toggle === null).toBe(false);
    expect(toggle?.offsetParent === null).toBe(false);
    const parent = toggle?.parentElement as unknown as FakeElement | null;
    expect(parent === dom.sidebarHead || parent === dom.topbar).toBe(true);
    expect(toggle?.innerHTML.includes("<svg")).toBe(true);
  });

  test("recreates the toggle with an svg icon when no button exists", () => {
    const dom = installFakeDom();
    const state = { sidebarHidden: true };
    const sidebar = createSidebarForTest(state);
    document.querySelector<HTMLElement>("#sidebar-toggle")?.remove();

    sidebar.placeSidebarToggle();

    const toggle = document.querySelector<HTMLElement>("#sidebar-toggle");
    expect(toggle === null).toBe(false);
    expect(toggle?.parentElement).toBe(dom.topbar);
    expect(toggle?.offsetParent === null).toBe(false);
    expect(toggle?.innerHTML.includes("<svg")).toBe(true);
  });

  test("uses the global header only when no toolbar or topbar host exists", () => {
    const dom = installFakeDom();
    const state = { sidebarHidden: true };
    const sidebar = createSidebarForTest(state);
    dom.topbar.remove();
    document.querySelector<HTMLElement>("#sidebar-toggle")?.remove();

    sidebar.placeSidebarToggle();

    const toggle = document.querySelector<HTMLElement>("#sidebar-toggle");
    expect(toggle === null).toBe(false);
    expect(toggle?.parentElement).toBe(dom.globalHeader);
    expect(toggle?.offsetParent === null).toBe(false);
    expect(toggle?.innerHTML.includes("<svg")).toBe(true);
  });

  test("empty history pane restores a hidden sidebar toggle after clearing repo DOM", () => {
    const dom = installFakeDom();
    const state = { sidebarHidden: false };
    const sidebar = createSidebarForTest(state);
    const repoToolbar = new FakeElement("div");
    repoToolbar.className = "gdp-repo-toolbar";
    dom.body.appendChild(repoToolbar);
    sidebar.applySidebarHidden(true);
    expect(
      document.querySelector<HTMLElement>("#sidebar-toggle")?.parentElement,
    ).toBe(repoToolbar);

    const diff = {
      set innerHTML(_value: string) {
        repoToolbar.remove();
      },
    } as unknown as HTMLElement;

    showEmptyHistoryDiffPane({
      diff,
      empty: null,
      renderSidebar() {
        /* noop */
      },
      setFiles() {
        /* noop */
      },
      clearLastMeta() {
        /* noop */
      },
      renderMeta() {
        /* noop */
      },
      invalidateRepoSidebar() {
        /* noop */
      },
      clearLoadQueue() {
        /* noop */
      },
      placeSidebarToggle: sidebar.placeSidebarToggle,
      setStatus() {
        /* noop */
      },
    });

    const toggle = document.querySelector<HTMLElement>("#sidebar-toggle");
    expect(toggle === null).toBe(false);
    expect(toggle?.parentElement).toBe(dom.topbar);
    expect(toggle?.offsetParent === null).toBe(false);
    expect(toggle?.getAttribute("aria-pressed")).toBe("true");
    expect(toggle?.innerHTML.includes("<svg")).toBe(true);
  });
});
