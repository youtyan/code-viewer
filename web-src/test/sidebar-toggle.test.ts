import "./_dom";
import { describe, expect, test } from "vitest";
import { showEmptyHistoryDiffPane } from "../views/empty-diff-pane";
import {
  CHANGES_LIST_DOM,
  createSidebar,
  FILE_LIST_DOM,
} from "../views/sidebar";

// 一覧の列の頭 (#panel-head) の 2 段目の画面の入口 (#view-head) と、畳むボタンの
// 置き場所 (.view-head-row)。プロジェクト名の切替は 1 段目 (#project-head) に固定
// (index.html)。ファイル一覧を畳んでも頭 (1 段目・ボタンと絵柄) はそのまま。
function installHeadDom() {
  document.body.innerHTML = `
    <div id="panel-head">
      <div id="project-head"><button id="project-switcher" class="brand"></button></div>
      <div id="view-head">
        <div class="view-head-row"></div>
        <nav class="app-menu view-strip"></nav>
      </div>
    </div>
    <div id="topbar"></div>
    <aside id="sidebar">
      <div class="sb-head"></div>
      <div class="sb-filter-wrap"></div>
      <ul id="filelist"></ul>
    </aside>
    <button id="sidebar-toggle"><span class="sidebar-toggle-label"></span></button>`;
  const el = (selector: string) => {
    const found = document.querySelector<HTMLElement>(selector);
    if (!found) throw new Error(`missing ${selector}`);
    return found;
  };
  return {
    body: document.body,
    projectHead: el("#project-head"),
    brand: el("#project-switcher"),
    leftHead: el("#panel-head"),
    viewHead: el("#view-head"),
    nameRow: el(".view-head-row"),
    strip: el(".view-strip"),
    sidebar: el("#sidebar"),
    topbar: el("#topbar"),
  };
}

/** 画面に出ているか (DOM にあり、隠した箱の中にない)。 */
function shown(element: HTMLElement | null): boolean {
  return !!element?.isConnected && !element.closest("[hidden]");
}

// 畳むボタンと頭の置き場所はファイル一覧 (FILE_LIST_DOM) の側が持つ。
function createSidebarForTest(
  state: { sidebarHidden: boolean },
  list: "files" | "changes" = "files",
) {
  return createSidebar({
    dom: list === "files" ? FILE_LIST_DOM : CHANGES_LIST_DOM,
    repository: list === "files",
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
    fileBadge: () => document.createElement("span"),
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
    createOpenPathButton: () => document.createElement("button"),
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
      document.querySelector(selector) as T,
    $$: <T extends Element = HTMLElement>(selector: string) =>
      Array.from(document.querySelectorAll<T>(selector)),
  });
}

// プロジェクト名とブランチはタブ列の左端に固定で、ファイル一覧を畳んでも動かない。
// 画面の入口は一覧の列の頭の 1 段で、畳んでも絵柄はそこに残る (畳むのは頭の下の
// ファイル一覧だけ)。ファイル一覧を畳む / 出すボタンは頭の右端 (絵柄の行の右端)
// で、畳んでも同じ場所 (ツールバーやタブ列へは行かない)。
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
      // 名前はタブ列の左端のまま。畳むボタンと絵柄も頭の行のまま。
      name: "the user folded the column: the name stays in the tab row's lead, the toggle and the view icons in the head row",
      hidden: true,
      screenHidesTree: false,
      host: "leftHead" as const,
      toggleHost: "nameRow" as const,
      stripHost: "viewHead" as const,
      toggleAt: "first",
      stripAt: "first",
    },
  ])(
    "$name",
    ({
      hidden,
      screenHidesTree,
      host,
      toggleHost,
      stripHost,
      toggleAt,
      stripAt,
    }) => {
      const dom = installHeadDom();
      dom.sidebar.hidden = screenHidesTree;
      const sidebar = createSidebarForTest({ sidebarHidden: hidden });
      sidebar.placeSidebarToggle();
      expect([
        dom.viewHead.parentElement === dom[host],
        document.querySelector<HTMLElement>("#sidebar-toggle")
          ?.parentElement === dom[toggleHost],
        dom.strip.parentElement === dom[stripHost],
        dom.brand.parentElement === dom.projectHead,
        dom.leftHead.children[0] === dom.projectHead,
      ]).toEqual([true, true, true, true, true]);
      // 置き場所の中の順は見た目の順 (Tab で移る順): 畳むボタンは絵柄の行の右端の
      // 置き場所 (中はボタンだけ)。一覧の列の頭では絵柄が行の頭。
      const at = (element: Element) => {
        const siblings = [...(element.parentElement?.children ?? [])];
        return siblings[0] === element
          ? "first"
          : siblings[siblings.length - 1] === element
            ? "last"
            : "middle";
      };
      const toggle = document.querySelector("#sidebar-toggle");
      if (!toggle) throw new Error("missing #sidebar-toggle");
      expect([at(toggle), at(dom.strip)]).toEqual([toggleAt, stripAt]);
    },
  );

  test("folding and unfolding keeps the view icons and the toggle in the head row", () => {
    const dom = installHeadDom();
    const state = { sidebarHidden: false };
    const sidebar = createSidebarForTest(state);
    const places = () => [
      dom.strip.parentElement === dom.viewHead,
      dom.viewHead.children[0] === dom.strip,
      document.querySelector<HTMLElement>("#sidebar-toggle")?.parentElement ===
        dom.nameRow,
    ];
    sidebar.applySidebarHidden(true);
    expect(places()).toEqual([true, true, true]);
    sidebar.applySidebarHidden(false);
    expect(places()).toEqual([true, true, true]);
  });
});

// ファイル一覧と変更ファイルの一覧は同時に出る。畳むボタン (#sidebar-toggle) の絵と
// 状態はファイル一覧の側だけが付け、変更ファイルの一覧の側は触らない (両方が付けると、
// 後に呼んだ側の状態でボタンが描き直される)。
describe("the toggle belongs to the file list", () => {
  test.each([
    { list: "files" as const, icon: true },
    { list: "changes" as const, icon: false },
  ])("$list list: sets the toggle icon $icon", ({ list, icon }) => {
    installHeadDom();
    const toggle = document.querySelector<HTMLElement>("#sidebar-toggle");
    if (!toggle) throw new Error("missing #sidebar-toggle");
    toggle.replaceChildren();
    createSidebarForTest(
      { sidebarHidden: false },
      list,
    ).setSidebarTreeActionIcons();
    expect(toggle.querySelector("svg") !== null).toBe(icon);
  });
});

describe("sidebar toggle placement", () => {
  test("keeps the toggle in the left column even when a repo toolbar exists", () => {
    const dom = installHeadDom();
    const state = { sidebarHidden: false };
    const sidebar = createSidebarForTest(state);
    const repoToolbar = document.createElement("div");
    repoToolbar.className = "gdp-repo-toolbar";
    dom.body.appendChild(repoToolbar);

    sidebar.applySidebarHidden(true);
    const toggle = document.querySelector<HTMLElement>("#sidebar-toggle");
    expect([
      toggle?.parentElement === dom.nameRow,
      // 名前は頭の 1 段目のまま、入口は頭 (2 段目) のまま。
      dom.brand.parentElement === dom.projectHead &&
        dom.viewHead.parentElement === dom.leftHead,
      !shown(toggle),
      toggle?.getAttribute("aria-expanded"),
      toggle?.querySelector("svg") !== null,
    ]).toEqual([true, true, false, "false", true]);

    toggle?.click();
    expect([
      document.querySelector<HTMLElement>("#sidebar-toggle")?.parentElement ===
        dom.nameRow,
      dom.viewHead.parentElement === dom.leftHead,
      state.sidebarHidden,
    ]).toEqual([true, true, false]);
  });

  test("keeps the toggle visible across repeated hide and show clicks", () => {
    const dom = installHeadDom();
    const state = { sidebarHidden: false };
    const sidebar = createSidebarForTest(state);

    sidebar.applySidebarHidden(false);
    for (let i = 0; i < 4; i++) {
      const toggle = document.querySelector<HTMLElement>("#sidebar-toggle");
      expect(toggle === null).toBe(false);
      expect(!shown(toggle)).toBe(false);
      toggle?.click();
    }

    const toggle = document.querySelector<HTMLElement>("#sidebar-toggle");
    expect([
      toggle?.parentElement === dom.nameRow,
      !shown(toggle),
      toggle?.querySelector("svg") !== null,
      dom.viewHead.parentElement === dom.leftHead,
    ]).toEqual([true, false, true, true]);
  });

  test("recreates the toggle with an svg icon when no button exists", () => {
    const dom = installHeadDom();
    const state = { sidebarHidden: true };
    const sidebar = createSidebarForTest(state);
    document.querySelector<HTMLElement>("#sidebar-toggle")?.remove();

    sidebar.placeSidebarToggle();

    const toggle = document.querySelector<HTMLElement>("#sidebar-toggle");
    expect([
      toggle === null,
      toggle?.parentElement === dom.nameRow,
      !shown(toggle),
      toggle?.querySelector("svg") !== null,
    ]).toEqual([false, true, false, true]);
  });

  test("reports every missing box of the head instead of skipping the placement", () => {
    const dom = installHeadDom();
    dom.leftHead.remove();
    const sidebar = createSidebarForTest({ sidebarHidden: false });
    expect(() => sidebar.placeSidebarToggle()).toThrow(
      "view head: missing #view-head, #view-head .view-head-row, #panel-head in index.html",
    );
  });

  test("empty history pane keeps the toggle in the head row after clearing repo DOM", () => {
    const dom = installHeadDom();
    const state = { sidebarHidden: false };
    const sidebar = createSidebarForTest(state);
    const repoToolbar = document.createElement("div");
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
      toggle?.parentElement === dom.nameRow,
      !shown(toggle),
      toggle?.getAttribute("aria-expanded"),
      toggle?.querySelector("svg") !== null,
    ]).toEqual([false, true, false, "false", true]);
  });
});
