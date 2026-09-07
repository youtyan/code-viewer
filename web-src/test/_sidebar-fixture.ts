// サイドバー (views/sidebar.ts) を実 DOM に載せるための共有フィクスチャ。
//
// index.html と同じ id の箱を置き、SidebarDeps を全部埋めた createSidebar を返す。
// 個々のテストが自前で用意すると deps が 60 行ぶん重複するので、ここに 1 つ置く。

import { createSidebar, type SidebarDeps } from "../views/sidebar";

export function installSidebarDom() {
  document.body.innerHTML = `
    <aside id="sidebar">
      <div class="sb-head">
        <span class="sb-title">Files</span>
        <span id="totals"></span>
        <div id="repo-target-wrap" data-ref-selector>
          <input id="repo-target" value="worktree" />
        </div>
        <div class="sb-actions" role="group">
          <button id="sb-expand-all" class="sb-tree-action"></button>
          <button id="sb-collapse-all" class="sb-tree-action"></button>
        </div>
        <div class="seg sb-view-seg">
          <button data-view="tree"></button>
          <button data-view="flat"></button>
        </div>
      </div>
      <div class="sb-filter-wrap">
        <input id="sb-filter" value="" />
        <button id="sb-filter-clear" type="button" hidden>Clear</button>
      </div>
      <ul id="filelist"></ul>
    </aside>
  `;
}

export function createSidebarForTest() {
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
    STATE: state,
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
