import { afterEach, describe, expect, test } from "vitest";
import { showEmptyHistoryDiffPane } from "../views/empty-diff-pane";
import { createSidebar } from "../views/sidebar";

const originalDocument = globalThis.document;
const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
const originalGetComputedStyle = globalThis.getComputedStyle;

afterEach(() => {
  globalThis.document = originalDocument;
  globalThis.requestAnimationFrame = originalRequestAnimationFrame;
  globalThis.getComputedStyle = originalGetComputedStyle;
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
  hidden = false;
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

  getBoundingClientRect() {
    return { width: this.visible ? 280 : 0 };
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
  // 右の列の頭 (#panel-head) の中の画面の入口 (#view-head) と、畳むボタンの
  // 置き場所 (.view-head-row)。プロジェクト名の切替はタブ列の左端 (#tabs-lead)
  // に固定 (index.html)。右の列を畳むと細い帯 (#panel-rail) に開くボタンと絵柄。
  const tabsLead = new FakeElement("div", "tabs-lead");
  const brand = new FakeElement("button", "project-switcher");
  brand.className = "brand";
  tabsLead.appendChild(brand);
  const leftHead = new FakeElement("div", "panel-head");
  const viewHead = new FakeElement("div", "view-head");
  const nameRow = new FakeElement("div");
  nameRow.className = "view-head-row";
  viewHead.appendChild(nameRow);
  // 画面の入口の絵柄。畳んだときだけ帯 (#panel-rail) へ縦に移る。
  const strip = new FakeElement("nav");
  strip.className = "app-menu view-strip";
  viewHead.appendChild(strip);
  const rail = new FakeElement("div", "panel-rail");
  leftHead.append(viewHead, rail);
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
  body.append(tabsLead, leftHead, topbar, sidebar, toggle);
  globalThis.document = {
    body,
    createElement: (tagName: string) => new FakeElement(tagName),
    querySelector: (selector: string) => body.querySelector(selector),
    querySelectorAll: (selector: string) => body.querySelectorAll(selector),
  } as unknown as Document;
  globalThis.requestAnimationFrame = (() => 1) as typeof requestAnimationFrame;
  globalThis.getComputedStyle = ((el: FakeElement) => ({
    display: el.visible ? "block" : "none",
  })) as unknown as typeof getComputedStyle;
  return {
    body,
    tabsLead,
    brand,
    leftHead,
    viewHead,
    nameRow,
    strip,
    rail,
    sidebar,
    sidebarHead,
    topbar,
  };
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
    openFileAs() {
      /* noop */
    },
    openDiffFile() {
      /* noop */
    },
    sidebarItemHref: () => null,
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
    filterCountTitle: () => "",
    fileCountText: (count) => `${count} files`,
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
    commitEntryBadge: (submodule) =>
      submodule
        ? { label: "SUB", title: "Git submodule pinned to a commit" }
        : { label: "GIT", title: "Git commit entry" },
    $: <T extends Element = HTMLElement>(selector: string) =>
      document.querySelector(selector) as unknown as T,
    $$: <T extends Element = HTMLElement>(selector: string) =>
      Array.from(document.querySelectorAll(selector)) as unknown as T[],
  });
}

// プロジェクト名とブランチはタブ列の左端に固定で、右の列を畳んでも動かない。
// 画面の入口は右の列の頭の 1 段で、右の列を畳んだときだけ絵柄が帯へ移る。
// 木を畳む / 出すボタンは右の列の頭の右端: 出ているときは絵柄の行の右端、
// 畳んだときは右の列の細い帯 (ツールバーやタブ列へは行かない)。
describe("project name and view entries placement", () => {
  test.each([
    {
      name: "the column is shown: the head of the left column",
      hidden: false,
      screenHidesTree: false,
      host: "leftHead" as const,
      toggleHost: "nameRow" as const,
      stripHost: "viewHead" as const,
      toggleAt: "first",
      stripAt: "first",
    },
    {
      name: "a screen without its own list: still the head of the left column",
      hidden: false,
      screenHidesTree: true,
      host: "leftHead" as const,
      toggleHost: "nameRow" as const,
      stripHost: "viewHead" as const,
      toggleAt: "first",
      stripAt: "first",
    },
    {
      // 名前はタブ列の左端のまま。絵柄は帯へ (タブ列の左へは移さない)。
      name: "the user folded the column: the name stays in the tab row's lead, the toggle and the view icons on the rail",
      hidden: true,
      screenHidesTree: false,
      host: "leftHead" as const,
      toggleHost: "rail" as const,
      stripHost: "rail" as const,
      toggleAt: "first",
      stripAt: "last",
    },
  ])("$name", ({
    hidden,
    screenHidesTree,
    host,
    toggleHost,
    stripHost,
    toggleAt,
    stripAt,
  }) => {
    const dom = installFakeDom();
    dom.sidebar.visible = !screenHidesTree;
    const sidebar = createSidebarForTest({ sidebarHidden: hidden });
    sidebar.placeSidebarToggle();
    expect([
      dom.viewHead.parentElement === dom[host],
      document.querySelector<HTMLElement>("#sidebar-toggle")?.parentElement ===
        (dom[toggleHost] as unknown as HTMLElement),
      dom.strip.parentElement === dom[stripHost],
      dom.brand.parentElement === dom.tabsLead,
    ]).toEqual([true, true, true, true]);
    // 置き場所の中の順は見た目の順 (Tab で移る順): 畳むボタンは絵柄の行の右端の
    // 置き場所 (中はボタンだけ)、帯では頭。右の列の頭では絵柄が行の頭。
    const at = (element: FakeElement) => {
      const siblings = element.parentElement?.children ?? [];
      return siblings[0] === element
        ? "first"
        : siblings[siblings.length - 1] === element
          ? "last"
          : "middle";
    };
    const toggle = document.querySelector(
      "#sidebar-toggle",
    ) as unknown as FakeElement;
    expect([at(toggle), at(dom.strip)]).toEqual([toggleAt, stripAt]);
  });

  test("folding and unfolding moves the view icons to the rail and back", () => {
    const dom = installFakeDom();
    const state = { sidebarHidden: false };
    const sidebar = createSidebarForTest(state);
    sidebar.applySidebarHidden(true);
    expect(dom.strip.parentElement).toBe(dom.rail);
    sidebar.applySidebarHidden(false);
    expect(dom.strip.parentElement).toBe(dom.viewHead);
  });
});

describe("sidebar toggle placement", () => {
  test("keeps the toggle in the left column even when a repo toolbar exists", () => {
    const dom = installFakeDom();
    const state = { sidebarHidden: false };
    const sidebar = createSidebarForTest(state);
    const repoToolbar = new FakeElement("div");
    repoToolbar.className = "gdp-repo-toolbar";
    dom.body.appendChild(repoToolbar);

    sidebar.applySidebarHidden(true);
    const toggle = document.querySelector<HTMLElement>("#sidebar-toggle");
    expect([
      toggle?.parentElement === (dom.rail as unknown as HTMLElement),
      // 名前はタブ列の左端のまま、入口は右の列の頭のまま (帯へ移るのは絵柄だけ)。
      dom.brand.parentElement === dom.tabsLead &&
        dom.viewHead.parentElement === dom.leftHead,
      toggle?.offsetParent === null,
      toggle?.getAttribute("aria-expanded"),
      toggle?.innerHTML.includes("<svg"),
    ]).toEqual([true, true, false, "false", true]);

    toggle?.click();
    expect([
      document.querySelector<HTMLElement>("#sidebar-toggle")?.parentElement ===
        (dom.nameRow as unknown as HTMLElement),
      dom.viewHead.parentElement === dom.leftHead,
      state.sidebarHidden,
    ]).toEqual([true, true, false]);
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
    expect([
      toggle?.parentElement === (dom.nameRow as unknown as HTMLElement),
      toggle?.offsetParent === null,
      toggle?.innerHTML.includes("<svg"),
      dom.viewHead.parentElement === dom.leftHead,
    ]).toEqual([true, false, true, true]);
  });

  test("recreates the toggle with an svg icon when no button exists", () => {
    const dom = installFakeDom();
    const state = { sidebarHidden: true };
    const sidebar = createSidebarForTest(state);
    document.querySelector<HTMLElement>("#sidebar-toggle")?.remove();

    sidebar.placeSidebarToggle();

    const toggle = document.querySelector<HTMLElement>("#sidebar-toggle");
    expect([
      toggle === null,
      toggle?.parentElement === (dom.rail as unknown as HTMLElement),
      toggle?.offsetParent === null,
      toggle?.innerHTML.includes("<svg"),
    ]).toEqual([false, true, false, true]);
  });

  test("reports every missing box of the head instead of skipping the placement", () => {
    const dom = installFakeDom();
    dom.leftHead.remove();
    dom.tabsLead.remove();
    const sidebar = createSidebarForTest({ sidebarHidden: false });
    expect(() => sidebar.placeSidebarToggle()).toThrow(
      "view head: missing #view-head, #view-head .view-head-row, #panel-head, #panel-rail in index.html",
    );
  });

  test("empty history pane keeps the toggle on the rail after clearing repo DOM", () => {
    const dom = installFakeDom();
    const state = { sidebarHidden: false };
    const sidebar = createSidebarForTest(state);
    const repoToolbar = new FakeElement("div");
    repoToolbar.className = "gdp-repo-toolbar";
    dom.body.appendChild(repoToolbar);
    sidebar.applySidebarHidden(true);

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
      emptyText: () => ({
        noCommitSelectedTitle: "No commit selected",
        noCommitSelectedBody:
          "Select a commit from the list to see its changes.",
      }),
    });

    const toggle = document.querySelector<HTMLElement>("#sidebar-toggle");
    expect([
      toggle === null,
      toggle?.parentElement === (dom.rail as unknown as HTMLElement),
      toggle?.offsetParent === null,
      toggle?.getAttribute("aria-expanded"),
      toggle?.innerHTML.includes("<svg"),
    ]).toEqual([false, true, false, "false", true]);
  });
});
