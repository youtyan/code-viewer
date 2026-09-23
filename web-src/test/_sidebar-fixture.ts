// 一覧 (views/sidebar.ts) を happy-dom で描くための DOM と deps。変更ファイルの
// 一覧 (#sidebar。既定) とファイル一覧 (#file-list) のどちらでも組める。
// GlobalRegistrator の登録は呼び出し側のテストが行う。

import {
  CHANGES_LIST_DOM,
  createSidebar,
  FILE_LIST_DOM,
  type SidebarDeps,
  type SidebarDom,
} from "../views/sidebar";

const id = (selector: string) => selector.replace(/^#/, "");

/** dom の要素を index.html と同じ形で置く (ファイル一覧は絞り込みが見出しの中)。 */
export function installSidebarDom(dom: SidebarDom = CHANGES_LIST_DOM) {
  const files = dom === FILE_LIST_DOM;
  const filter = `
      <div class="sb-filter-wrap">
        <input id="${id(dom.filter)}" value="" />
        <button id="${id(dom.filterClear)}" type="button" hidden>Clear</button>
      </div>`;
  document.body.innerHTML = `
    <aside id="${id(dom.root)}">
      <div class="sb-head">
        <span class="sb-title">Files</span>
        <span id="${id(dom.totals)}"></span>
        ${
          files
            ? `<div id="repo-target-wrap" data-ref-selector>
          <input id="repo-target" value="worktree" />
        </div>`
            : ""
        }
        <div class="sb-actions" role="group">
          <button id="${id(dom.expandAll)}" class="sb-tree-action"></button>
          <button id="${id(dom.collapseAll)}" class="sb-tree-action"></button>
        </div>
        ${
          files
            ? filter
            : `<div class="seg sb-view-seg">
          <button data-view="tree"></button>
          <button data-view="flat"></button>
        </div>`
        }
      </div>
      ${files ? "" : filter}
      <ul id="${id(dom.list)}"></ul>
    </aside>
  `;
}

export function createSidebarForTest(
  options: { dom?: SidebarDom; repository?: boolean } = {},
) {
  const dom = options.dom ?? CHANGES_LIST_DOM;
  const state = {
    sbView: "tree" as const,
    sbWidth: 280,
    sidebarHidden: false,
    collapsedDirs: new Set<string>(),
    files: [],
    activeFile: null,
    hideTests: false,
    viewedFiles: new Set<string>(),
    lazyExpandedDirs: new Set<string>(),
  };
  return createSidebar({
    dom,
    repository: options.repository ?? dom === FILE_LIST_DOM,
    STATE: state,
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
    fileBadge(status) {
      const badge = document.createElement("span");
      badge.className = `badge ${status || "M"}`;
      badge.textContent = status || "";
      return badge;
    },
    fileEntryIcon: () => '<svg class="octicon-file"></svg>',
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
    createOpenPathButton() {
      return document.createElement("button");
    },
    normalizeViewerFontSize: () => "regular",
    getSidebarFontSize: () => "regular",
    persistSidebarHidden() {
      /* noop */
    },
    persistSidebarWidth() {
      /* noop */
    },
    scheduleMainSurfaceFocus() {
      /* noop */
    },
    setChevronIcon(el) {
      el.textContent = ">";
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
    omittedDirectoryBadge: () => ({ label: "skipped", title: "skipped" }),
    commitEntryBadge: () => ({ label: "GIT", title: "Git commit entry" }),
    $: <T extends Element = HTMLElement>(selector: string): T => {
      const el = document.querySelector(selector);
      if (!el) throw new Error(`missing ${selector}`);
      return el as T;
    },
    $$: <T extends Element = HTMLElement>(selector: string): T[] =>
      Array.from(document.querySelectorAll(selector)) as T[],
  } satisfies SidebarDeps);
}
