// File list sidebar: tree/flat rendering, virtual tree for huge repos,
// filtering, folder icons, keyboard navigation, and sidebar chrome
// (width / font size / hide toggle). Extracted from app.ts.

import { classifyDiffFileKind } from "../core/diff-file-kinds";
import { compileFileFilter } from "../core/file-filter";
import { nextVisibleFileIndex } from "../core/file-navigation";
import {
  COLLAPSE_ALL_16_PATHS,
  EXPAND_ALL_16_PATHS,
  FOLDER_ICON_PATHS,
  GEAR_16_PATH,
  GIT_BRANCH_16_PATH,
  iconSvg,
  SIDEBAR_HIDE_16_PATHS,
  SIDEBAR_SHOW_16_PATHS,
} from "../core/icons";
import type {
  FileMeta,
  RepoTreeEntry,
  RepoTreeResponse,
  SidebarItem,
} from "../core/types";

export type ViewerFontSize = "compact" | "regular" | "large" | "xlarge";

// ai-dup-check: allow -- sidebar needs ordered ancestor paths for UI expansion.
export function sidebarAncestorDirs(path: string): string[] {
  const parts = path.split("/").filter(Boolean);
  const dirs: string[] = [];
  for (let i = 1; i < parts.length; i++) dirs.push(parts.slice(0, i).join("/"));
  return dirs;
}

export type SidebarDeps = {
  STATE: {
    sbView: "tree" | "flat";
    sbWidth: number;
    sidebarHidden: boolean;
    collapsedDirs: Set<string>;
    files: FileMeta[];
    activeFile: string | null;
    hideTests: boolean;
    viewedFiles: Set<string>;
    lazyExpandedDirs: Set<string>;
  };
  scrollToFile(path: string, line?: unknown): void;
  prefetchByPath(path: string): void;
  fileBadge(status?: string): HTMLElement;
  fileEntryIcon(): string;
  applyViewedState(): void;
  persistCollapsedDirs(patch: { added?: string[]; removed?: string[] }): void;
  persistLazyExpandedDirs(patch: {
    added?: string[];
    removed?: string[];
  }): void;
  appendScopeParams(params: URLSearchParams): void;
  createOpenPathButton(
    path: string,
    kind: "directory" | "file-parent",
    title?: string,
  ): HTMLElement;
  normalizeViewerFontSize(value: unknown): ViewerFontSize;
  getSidebarFontSize(): ViewerFontSize;
  persistSidebarHidden(hidden: boolean): void;
  persistSidebarWidth(width: number): void;
  scheduleMainSurfaceFocus(): void;
  setChevronIcon(el: HTMLElement): void;
  trackLoad: <T>(promise: Promise<T>) => Promise<T>;
  getRepoSidebarRef(): string | null;
  setRepoSidebarRef(ref: string | null): void;
  isTestPath(path: string): boolean;
  $: <T extends Element = HTMLElement>(sel: string) => T;
  $$: <T extends Element = HTMLElement>(sel: string) => T[];
};

export function createSidebar(deps: SidebarDeps) {
  const {
    $,
    $$,
    STATE,
    scrollToFile,
    prefetchByPath,
    fileBadge,
    fileEntryIcon,
    applyViewedState,
    persistCollapsedDirs,
    persistLazyExpandedDirs,
    appendScopeParams,
    createOpenPathButton,
    normalizeViewerFontSize,
    getSidebarFontSize,
    persistSidebarHidden,
    persistSidebarWidth,
    scheduleMainSurfaceFocus,
    setChevronIcon,
    trackLoad,
    getRepoSidebarRef,
    setRepoSidebarRef,
    isTestPath,
  } = deps;

  type TreeNode = {
    name: string;
    dirs: Record<string, TreeNode>;
    files: SidebarItem[];
    path: string;
    minOrder: number;
    explicit?: boolean;
    children_omitted?: true;
    children_omitted_reason?: RepoTreeEntry["children_omitted_reason"];
  };

  const VIRTUAL_SIDEBAR_THRESHOLD = 3000;

  const VIRTUAL_SIDEBAR_ROW_HEIGHT = 29;

  const VIRTUAL_SIDEBAR_OVERSCAN = 16;

  let SIDEBAR_ON_FILE_CLICK: ((file: SidebarItem) => void) | undefined;

  type SidebarTreeRow = {
    kind: "dir" | "file";
    path: string;
    name: string;
    depth: number;
    file?: SidebarItem;
    dir?: TreeNode;
  };

  type TreeNodeItem =
    | { kind: "dir"; sortKey: number; dir: TreeNode }
    | { kind: "file"; sortKey: number; file: SidebarItem };

  let SIDEBAR_TREE_ROOT: TreeNode | null = null;

  let SIDEBAR_TREE_ROWS: SidebarTreeRow[] = [];

  let SIDEBAR_VISIBLE_ROWS: SidebarTreeRow[] = [];

  let SIDEBAR_ROW_BY_PATH = new Map<string, SidebarTreeRow>();

  let SIDEBAR_VIRTUAL_ACTIVE_PATH = "";

  let SIDEBAR_TREE_ITEMS_CACHE = new WeakMap<TreeNode, TreeNodeItem[]>();

  const SIDEBAR_LAZY_LOADED_DIRS = new Set<string>();

  const SIDEBAR_LAZY_LOADING_DIRS = new Map<string, Promise<void>>();

  function savedSidebarFontSize(): ViewerFontSize {
    return normalizeViewerFontSize(getSidebarFontSize());
  }

  function applySidebarFontSize(size: ViewerFontSize = savedSidebarFontSize()) {
    document.body.dataset.sidebarFontSize = size;
  }

  function syncSidebarHeaderHeight() {
    requestAnimationFrame(() => {
      const head = document.querySelector<HTMLElement>(".sb-head");
      if (head)
        document.documentElement.style.setProperty(
          "--sidebar-head-h",
          `${Math.ceil(head.getBoundingClientRect().height)}px`,
        );
    });
  }

  function observeSidebarHeaderHeight() {
    const head = document.querySelector<HTMLElement>(".sb-head");
    if (!head || typeof ResizeObserver === "undefined") {
      syncSidebarHeaderHeight();
      return;
    }
    const observer = new ResizeObserver(syncSidebarHeaderHeight);
    observer.observe(head);
    syncSidebarHeaderHeight();
  }

  let SIDEBAR_FILES: SidebarItem[] = [];

  function setFolderIcon(el: HTMLElement, collapsed: boolean) {
    const path = collapsed ? FOLDER_ICON_PATHS.closed : FOLDER_ICON_PATHS.open;
    el.innerHTML =
      '<svg class="octicon octicon-file-directory-' +
      (collapsed ? "fill" : "open-fill") +
      '" viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true">' +
      '<path fill="currentColor" d="' +
      path +
      '"></path></svg>';
  }

  function setSidebarTreeActionIcons() {
    const settings =
      document.querySelector<HTMLButtonElement>("#viewer-settings");
    const sidebarToggle = ensureSidebarToggleButton();
    const expand = document.querySelector<HTMLButtonElement>("#sb-expand-all");
    const collapse =
      document.querySelector<HTMLButtonElement>("#sb-collapse-all");
    if (settings) settings.innerHTML = iconSvg("octicon-gear", GEAR_16_PATH);
    syncSidebarToggleIcon(sidebarToggle);
    if (expand)
      expand.innerHTML = iconSvg("octicon-chevron-down", EXPAND_ALL_16_PATHS);
    if (collapse)
      collapse.innerHTML = iconSvg("octicon-chevron-up", COLLAPSE_ALL_16_PATHS);
  }

  function syncSidebarToggleIcon(button: HTMLButtonElement) {
    button.innerHTML = iconSvg(
      "octicon-sidebar",
      STATE.sidebarHidden ? SIDEBAR_SHOW_16_PATHS : SIDEBAR_HIDE_16_PATHS,
    );
  }

  function createSidebarToggleButton() {
    const button = document.createElement("button");
    button.id = "sidebar-toggle";
    button.type = "button";
    syncSidebarToggleIcon(button);
    return button;
  }

  function bindSidebarToggleButton(button: HTMLButtonElement) {
    if (button.dataset.gdpSidebarToggleBound === "1") return;
    button.dataset.gdpSidebarToggleBound = "1";
    button.addEventListener("click", toggleSidebarHidden);
  }

  function ensureSidebarToggleButton() {
    let button = document.querySelector<HTMLButtonElement>("#sidebar-toggle");
    if (!button) button = createSidebarToggleButton();
    bindSidebarToggleButton(button);
    button.setAttribute("aria-pressed", STATE.sidebarHidden ? "true" : "false");
    button.title = STATE.sidebarHidden ? "show sidebar" : "hide sidebar";
    button.setAttribute(
      "aria-label",
      STATE.sidebarHidden ? "show sidebar" : "hide sidebar",
    );
    syncSidebarToggleIcon(button);
    return button;
  }

  function attachSidebarToggle(host: HTMLElement) {
    const button = ensureSidebarToggleButton();
    syncSidebarToggleIcon(button);
    if (button.parentElement === host) return;
    host.prepend(button);
  }

  function placeSidebarToggle() {
    const sidebarHead = document.querySelector<HTMLElement>(".sb-head");
    const toolbar = document.querySelector<HTMLElement>(
      ".gdp-repo-toolbar, .gdp-file-detail-header",
    );
    const restoreHost =
      toolbar ||
      document.querySelector<HTMLElement>("#topbar") ||
      document.querySelector<HTMLElement>("#global-header");
    if (STATE.sidebarHidden && restoreHost) attachSidebarToggle(restoreHost);
    else if (sidebarHead) attachSidebarToggle(sidebarHead);
    const sidebarToggle =
      document.querySelector<HTMLButtonElement>("#sidebar-toggle");
    if (sidebarToggle) syncSidebarToggleIcon(sidebarToggle);
    placeSidebarFilter();
  }

  function placeSidebarFilter() {
    const sidebarHead = document.querySelector<HTMLElement>(".sb-head");
    const filter = document.querySelector<HTMLElement>(".sb-filter-wrap");
    const list = document.querySelector<HTMLElement>("#filelist");
    if (!sidebarHead || !filter || !list) return;
    const repoSidebar = isRepositorySidebarMode();
    if (repoSidebar && filter.parentElement !== sidebarHead) {
      sidebarHead.appendChild(filter);
      return;
    }
    if (!repoSidebar && filter.parentElement === sidebarHead) {
      sidebarHead.after(filter);
    }
  }

  function applySidebarHidden(
    hidden = STATE.sidebarHidden,
    options: { persist?: boolean } = {},
  ) {
    STATE.sidebarHidden = hidden;
    document.body.classList.toggle("gdp-sidebar-hidden", hidden);
    if (options.persist !== false) persistSidebarHidden(hidden);
    ensureSidebarToggleButton();
    setSidebarTreeActionIcons();
    placeSidebarToggle();
    syncSidebarHeaderHeight();
  }

  function toggleSidebarHidden() {
    applySidebarHidden(!STATE.sidebarHidden);
  }

  function buildTree(files: SidebarItem[]): TreeNode {
    const root: TreeNode = {
      name: "",
      dirs: {},
      files: [],
      path: "",
      minOrder: Infinity,
      explicit: true,
    };
    for (const f of files) {
      const parts = f.path.split("/");
      let node = root;
      let acc = "";
      const dirPartCount = f.type === "tree" ? parts.length : parts.length - 1;
      for (let i = 0; i < dirPartCount; i++) {
        const p = parts[i];
        acc = acc ? `${acc}/${p}` : p;
        if (!node.dirs[p]) {
          node.dirs[p] = {
            name: p,
            dirs: {},
            files: [],
            path: acc,
            minOrder: Infinity,
          };
        }
        node = node.dirs[p];
        if (typeof f.order === "number" && f.order < node.minOrder)
          node.minOrder = f.order;
      }
      if (f.type === "tree") {
        node.explicit = true;
        if (f.children_omitted === true) {
          node.children_omitted = true;
          node.children_omitted_reason = f.children_omitted_reason;
        }
        continue;
      }
      node.files.push(f);
    }
    function compress(node: TreeNode) {
      const ks = Object.keys(node.dirs);
      while (
        ks.length === 1 &&
        node.files.length === 0 &&
        !node.explicit &&
        node !== root
      ) {
        const only = node.dirs[ks[0]];
        node.name = node.name ? `${node.name}/${only.name}` : only.name;
        node.dirs = only.dirs;
        node.files = only.files;
        node.path = only.path;
        node.minOrder = Math.min(node.minOrder, only.minOrder);
        ks.length = 0;
        Object.keys(node.dirs).forEach((k) => {
          ks.push(k);
        });
      }
      Object.values(node.dirs).forEach(compress);
    }
    Object.values(root.dirs).forEach(compress);
    return root;
  }

  function renderTreeNode(
    node: TreeNode,
    depth: number,
    ul: HTMLElement,
    onFileClick?: (file: SidebarItem) => void,
  ) {
    // Sort by server-assigned order so the sidebar preserves the same root
    // ordering as the repository tree response.
    const items = [];
    for (const k of Object.keys(node.dirs)) {
      const d = node.dirs[k];
      items.push({ kind: "dir", sortKey: d.minOrder, dir: d });
    }
    for (const f of node.files) {
      items.push({
        kind: "file",
        sortKey: f.order != null ? f.order : Infinity,
        file: f,
      });
    }
    items.sort((a, b) => a.sortKey - b.sortKey);

    for (const item of items) {
      if (item.kind === "dir") {
        const dir = item.dir;
        const li = document.createElement("li");
        li.className = "tree-dir";
        li.tabIndex = -1;
        li.dataset.dirpath = dir.path;
        li.dataset.type = "tree";
        if (dir.children_omitted_reason)
          li.dataset.childrenOmittedReason = dir.children_omitted_reason;
        if (dir.explicit) li.dataset.explicit = "true";
        if (dir.children_omitted) {
          li.classList.add("children-omitted");
          li.classList.add(
            dir.children_omitted_reason === "heavy"
              ? "children-omitted-heavy"
              : "children-omitted-internal",
          );
          li.title =
            dir.children_omitted_reason === "heavy"
              ? "Large generated/vendor directory: open the detail pane to browse its contents"
              : "Internal Git metadata is not browsed";
        }
        li.style.setProperty("--lvl-pad", `${12 + depth * 14}px`);
        const chev = document.createElement("span");
        if (dir.children_omitted) {
          chev.className = "chev-spacer";
          chev.setAttribute("aria-hidden", "true");
        } else {
          chev.className = "chev";
          setChevronIcon(chev);
        }
        li.appendChild(chev);
        const dirIcon = document.createElement("span");
        dirIcon.className = "dir-icon";
        li.appendChild(dirIcon);
        const label = document.createElement("span");
        label.className = "dir-label";
        const dn = document.createElement("span");
        dn.className = "dir-name";
        dn.textContent = dir.name;
        dn.title = dir.path;
        label.appendChild(dn);
        if (dir.children_omitted) {
          const omitted = document.createElement("span");
          omitted.className =
            "dir-omitted " +
            (dir.children_omitted_reason === "heavy"
              ? "dir-omitted-heavy"
              : "dir-omitted-internal");
          omitted.textContent =
            dir.children_omitted_reason === "heavy" ? "skipped" : "private";
          omitted.title =
            dir.children_omitted_reason === "heavy"
              ? "Tree expansion is skipped, but the directory detail can be opened"
              : "This directory cannot be opened from the browser";
          label.appendChild(omitted);
        }
        li.appendChild(label);
        li.appendChild(
          createOpenPathButton(dir.path, "directory", "open this folder in OS"),
        );
        const collapsed = STATE.collapsedDirs.has(dir.path);
        if (collapsed) li.classList.add("collapsed");
        const updateIcon = () => {
          setFolderIcon(dirIcon, li.classList.contains("collapsed"));
        };
        updateIcon();
        const childUl = document.createElement("ul");
        childUl.className = "tree-children";
        renderTreeNode(dir, depth + 1, childUl, onFileClick);
        const toggleDir = (e: Event) => {
          e.stopPropagation();
          li.classList.toggle("collapsed");
          updateIcon();
          if (li.classList.contains("collapsed")) {
            STATE.collapsedDirs.add(dir.path);
            persistCollapsedDirs({ added: [dir.path] });
          } else {
            STATE.collapsedDirs.delete(dir.path);
            persistCollapsedDirs({ removed: [dir.path] });
          }
        };
        if (!dir.children_omitted) {
          chev.addEventListener("click", toggleDir);
          dirIcon.addEventListener("click", toggleDir);
        }
        if (onFileClick) {
          li.addEventListener("click", (e) => {
            e.stopPropagation();
            if (
              dir.children_omitted_reason === "internal" ||
              dir.children_omitted_reason === "truncated"
            )
              return;
            onFileClick({
              path: dir.path,
              display_path: dir.path,
              type: "tree",
              children_omitted: dir.children_omitted,
              children_omitted_reason: dir.children_omitted_reason,
            });
            scheduleMainSurfaceFocus();
          });
        } else {
          li.addEventListener("click", toggleDir);
        }
        ul.appendChild(li);
        ul.appendChild(childUl);
      } else {
        const f = item.file;
        const li = createTreeFileRow(f, depth, onFileClick);
        ul.appendChild(li);
      }
    }
  }

  function sidebarTreeNodeHasChildren(node: TreeNode) {
    return Object.keys(node.dirs).length > 0 || node.files.length > 0;
  }

  function shouldLazyLoadSidebarDir(dir: TreeNode) {
    return (
      isRepositorySidebarMode() &&
      isVirtualSidebarActive() &&
      !dir.children_omitted &&
      !sidebarTreeNodeHasChildren(dir) &&
      !SIDEBAR_LAZY_LOADED_DIRS.has(dir.path)
    );
  }

  // lazyExpandedDirs は「リロード後に再現したい (=hydrate で fetch する)」意図の
  // 永続化用 Positive Set。見た目 (effectiveCollapsed) には混ぜない。混ぜると
  // 「lazyExpanded だが load まだ → 展開表示 / 中身ゼロ」というバグが再発する。
  // 見た目は「閉じてる / 開いてる」の二択で、lazy 完了で SIDEBAR_LAZY_LOADED_DIRS
  // に入った dir は shouldLazyLoadSidebarDir が false に転じ、自然に展開表示。
  function dirEffectiveCollapsed(dir: TreeNode) {
    const userCollapsed = STATE.collapsedDirs.has(dir.path);
    const userLazyExpanded = STATE.lazyExpandedDirs.has(dir.path);
    const lazyNotLoaded = shouldLazyLoadSidebarDir(dir);
    return {
      userCollapsed,
      userLazyExpanded,
      lazyNotLoaded,
      effectiveCollapsed: userCollapsed || lazyNotLoaded,
    };
  }

  function upsertSidebarTreeEntry(entry: SidebarItem, order: number) {
    if (!SIDEBAR_TREE_ROOT) return;
    const parts = entry.path.split("/").filter(Boolean);
    if (!parts.length) return;
    let node = SIDEBAR_TREE_ROOT;
    let acc = "";
    const dirPartCount =
      entry.type === "tree" ? parts.length : parts.length - 1;
    for (let i = 0; i < dirPartCount; i++) {
      const part = parts[i];
      acc = acc ? `${acc}/${part}` : part;
      if (!node.dirs[part]) {
        node.dirs[part] = {
          name: part,
          dirs: {},
          files: [],
          path: acc,
          minOrder: order,
        };
      }
      node = node.dirs[part];
      node.minOrder = Math.min(node.minOrder, order);
    }
    if (entry.type === "tree") {
      node.explicit = true;
      if (entry.children_omitted === true) {
        node.children_omitted = true;
        node.children_omitted_reason = entry.children_omitted_reason;
      }
      return;
    }
    if (!node.files.some((file) => file.path === entry.path))
      node.files.push({ ...entry, order });
  }

  function mergeSidebarTreeEntries(entries: SidebarItem[]) {
    entries.forEach((entry, index) => {
      upsertSidebarTreeEntry(entry, entry.order ?? index + 1);
    });
    SIDEBAR_TREE_ITEMS_CACHE = new WeakMap<TreeNode, TreeNodeItem[]>();
    if (SIDEBAR_TREE_ROOT) buildSidebarTreeRows(SIDEBAR_TREE_ROOT);
  }

  function ensureVirtualSidebarDirLoaded(dir: TreeNode): Promise<void> {
    if (!shouldLazyLoadSidebarDir(dir)) return Promise.resolve();
    const existing = SIDEBAR_LAZY_LOADING_DIRS.get(dir.path);
    if (existing) return existing;
    const params = new URLSearchParams();
    params.set("ref", getRepoSidebarRef() || "worktree");
    params.set("path", dir.path);
    appendScopeParams(params);
    const load = trackLoad<RepoTreeResponse>(
      fetch(`/_tree?${params.toString()}`).then((response) => {
        if (!response.ok) throw new Error("failed to load repository tree");
        return response.json();
      }),
    )
      .then((meta) => {
        const entries = meta.entries.map(
          (entry, index) =>
            ({
              order: dir.minOrder + (index + 1) / 100000,
              path: entry.path,
              display_path: entry.path,
              type:
                meta.ref === "worktree" &&
                entry.type === "commit" &&
                !entry.submodule
                  ? "tree"
                  : entry.type,
              submodule: entry.submodule,
              children_omitted: entry.children_omitted,
              children_omitted_reason: entry.children_omitted_reason,
            }) satisfies SidebarItem,
        );
        mergeSidebarTreeEntries(entries);
        SIDEBAR_LAZY_LOADED_DIRS.add(dir.path);
      })
      .finally(() => {
        SIDEBAR_LAZY_LOADING_DIRS.delete(dir.path);
      });
    SIDEBAR_LAZY_LOADING_DIRS.set(dir.path, load);
    return load;
  }

  function createTreeDirRow(
    dir: TreeNode,
    depth: number,
    onFileClick?: (file: SidebarItem) => void,
  ) {
    const li = document.createElement("li");
    li.className = "tree-dir";
    li.tabIndex = -1;
    li.dataset.dirpath = dir.path;
    li.dataset.type = "tree";
    if (dir.children_omitted_reason)
      li.dataset.childrenOmittedReason = dir.children_omitted_reason;
    if (dir.explicit) li.dataset.explicit = "true";
    if (dir.children_omitted) {
      li.classList.add("children-omitted");
      li.classList.add(
        dir.children_omitted_reason === "heavy"
          ? "children-omitted-heavy"
          : "children-omitted-internal",
      );
      li.title =
        dir.children_omitted_reason === "heavy"
          ? "Large generated/vendor directory: open the detail pane to browse its contents"
          : "Internal Git metadata is not browsed";
    }
    li.style.setProperty("--lvl-pad", `${12 + depth * 14}px`);
    const chev = document.createElement("span");
    if (dir.children_omitted) {
      chev.className = "chev-spacer";
      chev.setAttribute("aria-hidden", "true");
    } else {
      chev.className = "chev";
      setChevronIcon(chev);
    }
    li.appendChild(chev);
    const dirIcon = document.createElement("span");
    dirIcon.className = "dir-icon";
    li.appendChild(dirIcon);
    const label = document.createElement("span");
    label.className = "dir-label";
    const dn = document.createElement("span");
    dn.className = "dir-name";
    dn.textContent = dir.name;
    dn.title = dir.path;
    label.appendChild(dn);
    if (dir.children_omitted) {
      const omitted = document.createElement("span");
      omitted.className =
        "dir-omitted " +
        (dir.children_omitted_reason === "heavy"
          ? "dir-omitted-heavy"
          : "dir-omitted-internal");
      omitted.textContent =
        dir.children_omitted_reason === "heavy" ? "skipped" : "private";
      omitted.title =
        dir.children_omitted_reason === "heavy"
          ? "Tree expansion is skipped, but the directory detail can be opened"
          : "This directory cannot be opened from the browser";
      label.appendChild(omitted);
    }
    li.appendChild(label);
    li.appendChild(
      createOpenPathButton(dir.path, "directory", "open this folder in OS"),
    );
    const updateIcon = () => {
      setFolderIcon(dirIcon, li.classList.contains("collapsed"));
    };
    const toggleDir = async (e: Event) => {
      e.stopPropagation();
      if (li.dataset.toggling === "true") return;
      li.dataset.toggling = "true";
      try {
        // snapshot 取得は await の前。await 中に rerender が走っても
        // この時点の意図 (開く/閉じる) を取り違えない。
        const snap = dirEffectiveCollapsed(dir);
        const expanding = snap.effectiveCollapsed;
        if (expanding && snap.lazyNotLoaded)
          await ensureVirtualSidebarDirLoaded(dir);
        if (expanding) {
          // 「開く」方向
          if (snap.userCollapsed) {
            STATE.collapsedDirs.delete(dir.path);
            persistCollapsedDirs({ removed: [dir.path] });
          }
          // ユーザーが明示的に開いた lazy dir はリロード後も再現したいので
          // lazyExpandedDirs にも記録する。lazy 対象でない通常 dir は
          // collapsedDirs から消すだけで default-open に戻るので不要。
          if (snap.lazyNotLoaded && !snap.userLazyExpanded) {
            STATE.lazyExpandedDirs.add(dir.path);
            persistLazyExpandedDirs({ added: [dir.path] });
          }
          li.classList.remove("collapsed");
        } else {
          // 「閉じる」方向
          if (!snap.userCollapsed) {
            STATE.collapsedDirs.add(dir.path);
            persistCollapsedDirs({ added: [dir.path] });
          }
          // 明示的に閉じたので lazyExpandedDirs の記録は破棄。
          if (snap.userLazyExpanded) {
            STATE.lazyExpandedDirs.delete(dir.path);
            persistLazyExpandedDirs({ removed: [dir.path] });
          }
          li.classList.add("collapsed");
        }
        updateIcon();
        rerenderVirtualSidebar();
      } finally {
        delete li.dataset.toggling;
      }
    };
    li.classList.toggle(
      "collapsed",
      dirEffectiveCollapsed(dir).effectiveCollapsed,
    );
    updateIcon();
    if (!dir.children_omitted) {
      chev.addEventListener("click", toggleDir);
      dirIcon.addEventListener("click", toggleDir);
    }
    if (onFileClick) {
      li.addEventListener("click", (e) => {
        e.stopPropagation();
        if (
          dir.children_omitted_reason === "internal" ||
          dir.children_omitted_reason === "truncated"
        )
          return;
        onFileClick({
          path: dir.path,
          display_path: dir.path,
          type: "tree",
          children_omitted: dir.children_omitted,
          children_omitted_reason: dir.children_omitted_reason,
        });
        scheduleMainSurfaceFocus();
      });
    } else {
      li.addEventListener("click", toggleDir);
    }
    return li;
  }

  // Small opt-in marker next to the status badge for files worth a second
  // look before diving in: a large/huge diff, or a binary/media file. Mirrors
  // the size-tag colors already used on the diff card header.
  function fileKindTag(f: SidebarItem): HTMLElement | null {
    if (f.type === "commit") {
      const tag = document.createElement("span");
      tag.className = `kind-tag ${f.submodule ? "submodule" : "gitlink"}`;
      tag.textContent = f.submodule ? "SUB" : "GIT";
      tag.title = f.submodule
        ? "Git submodule pinned to a commit"
        : "Git commit entry";
      return tag;
    }
    const kind = classifyDiffFileKind(f);
    if (!kind.heavy && !kind.binary && !kind.media) return null;
    const tag = document.createElement("span");
    const isBinaryLike = kind.binary || kind.media;
    tag.className = `kind-tag ${isBinaryLike ? "binary" : "heavy"}`;
    tag.textContent = isBinaryLike ? "B" : "!";
    tag.title = isBinaryLike ? "binary/media file" : "large diff";
    return tag;
  }

  function sidebarEntryIcon(f: SidebarItem): string {
    return f.type === "commit"
      ? iconSvg("octicon-git-branch", GIT_BRANCH_16_PATH)
      : fileEntryIcon();
  }

  function createTreeFileRow(
    f: SidebarItem,
    depth: number,
    onFileClick?: (file: SidebarItem) => void,
  ) {
    const li = document.createElement("li");
    li.className = "tree-file";
    li.tabIndex = -1;
    li.dataset.path = f.path;
    li.dataset.type = f.type || "blob";
    if (f.type === "commit") {
      li.title = f.submodule
        ? "Git submodule pinned to a commit"
        : "Git commit entry";
    }
    li.classList.toggle(
      "viewed",
      !onFileClick && STATE.viewedFiles.has(f.path),
    );
    li.classList.toggle(
      "hidden-by-tests",
      STATE.hideTests && !isRepositorySidebarMode() && isTestPath(f.path || ""),
    );
    li.style.setProperty("--lvl-pad", `${12 + depth * 14}px`);
    const spacer = document.createElement("span");
    spacer.className = "chev-spacer";
    li.appendChild(spacer);
    if (f.status) {
      li.appendChild(fileBadge(f.status));
    } else {
      const icon = document.createElement("span");
      icon.className = "d2h-icon-wrapper";
      icon.innerHTML = sidebarEntryIcon(f);
      li.appendChild(icon);
    }
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = f.path.split("/").pop();
    name.title = f.path;
    li.appendChild(name);
    const kindTag = fileKindTag(f);
    if (kindTag) li.appendChild(kindTag);
    li.addEventListener("click", () => {
      if (onFileClick) onFileClick(f);
      else scrollToFile(f.path);
      scheduleMainSurfaceFocus();
    });
    if (!onFileClick)
      li.addEventListener("mouseenter", () => prefetchByPath(f.path), {
        passive: true,
      });
    return li;
  }

  function buildSidebarTreeRows(root: TreeNode) {
    const rows: SidebarTreeRow[] = [];
    const byPath = new Map<string, SidebarTreeRow>();
    const walk = (node: TreeNode, depth: number) => {
      for (const item of treeNodeItems(node)) {
        if (item.kind === "dir") {
          const row: SidebarTreeRow = {
            kind: "dir",
            path: item.dir.path,
            name: item.dir.name,
            depth,
            dir: item.dir,
          };
          rows.push(row);
          byPath.set(row.path, row);
          walk(item.dir, depth + 1);
        } else {
          const row: SidebarTreeRow = {
            kind: "file",
            path: item.file.path,
            name: item.file.path.split("/").pop() || item.file.path,
            depth,
            file: item.file,
          };
          rows.push(row);
          byPath.set(row.path, row);
        }
      }
    };
    walk(root, 0);
    SIDEBAR_TREE_ROWS = rows;
    SIDEBAR_ROW_BY_PATH = byPath;
  }

  function computeVirtualSidebarVisibleRows() {
    if (!SIDEBAR_TREE_ROOT) {
      SIDEBAR_VISIBLE_ROWS = [];
      return;
    }
    const input = $<HTMLInputElement>("#sb-filter");
    const filter = compileFileFilter(input.value);
    const invalid = filter.kind === "invalid";
    input.toggleAttribute("aria-invalid", invalid);
    input.title = invalid ? filter.error || "invalid regular expression" : "";
    const filterActive = filter.kind !== "empty" && !invalid;
    const matches = invalid ? () => true : filter.match;
    const walk = (
      node: TreeNode,
      depth: number,
    ): { visible: boolean; rows: SidebarTreeRow[] } => {
      let subtreeVisible = false;
      const rows: SidebarTreeRow[] = [];
      for (const item of treeNodeItems(node)) {
        if (item.kind === "dir") {
          const dirMatches = filterActive && matches(item.dir.path);
          const eff = dirEffectiveCollapsed(item.dir);
          // filter 中はユーザー collapsed を無視してマッチ祖先を見えるようにする
          // 既存挙動を維持。ただし lazy 未ロードはそもそも子データがメモリに
          // 無いので展開できない (filterActive でも閉じる)。
          const expanded =
            !item.dir.children_omitted &&
            !eff.lazyNotLoaded &&
            (filterActive ? !eff.userCollapsed : !eff.effectiveCollapsed);
          const child = walk(item.dir, depth + 1);
          const visible =
            item.dir.explicit && !filterActive
              ? true
              : dirMatches || child.visible;
          if (visible) {
            rows.push({
              kind: "dir",
              path: item.dir.path,
              name: item.dir.name,
              depth,
              dir: item.dir,
            });
            if (expanded) rows.push(...child.rows);
          }
          subtreeVisible = subtreeVisible || visible;
        } else {
          const testHidden =
            STATE.hideTests &&
            !isRepositorySidebarMode() &&
            isTestPath(item.file.path || "");
          const visible = !testHidden && matches(item.file.path || "");
          if (visible) {
            rows.push({
              kind: "file",
              path: item.file.path,
              name: item.file.path.split("/").pop() || item.file.path,
              depth,
              file: item.file,
            });
          }
          subtreeVisible = subtreeVisible || visible;
        }
      }
      return { visible: subtreeVisible, rows };
    };
    SIDEBAR_VISIBLE_ROWS = walk(SIDEBAR_TREE_ROOT, 0).rows;
  }

  function sidebarVirtualRange() {
    const sidebar = document.querySelector<HTMLElement>("#sidebar");
    const scrollTop = sidebar?.scrollTop || 0;
    const height = sidebar?.clientHeight || window.innerHeight;
    const start = Math.max(
      0,
      Math.floor(scrollTop / VIRTUAL_SIDEBAR_ROW_HEIGHT) -
        VIRTUAL_SIDEBAR_OVERSCAN,
    );
    const end = Math.min(
      SIDEBAR_VISIBLE_ROWS.length,
      Math.ceil((scrollTop + height) / VIRTUAL_SIDEBAR_ROW_HEIGHT) +
        VIRTUAL_SIDEBAR_OVERSCAN,
    );
    return { start, end };
  }

  function renderVirtualSidebarWindow() {
    const ul = $("#filelist");
    if (!ul.classList.contains("tree-virtual")) return;
    const { start, end } = sidebarVirtualRange();
    const fragment = document.createDocumentFragment();
    for (let i = start; i < end; i++) {
      const row = SIDEBAR_VISIBLE_ROWS[i];
      const li =
        row.kind === "dir" && row.dir
          ? createTreeDirRow(row.dir, row.depth, SIDEBAR_ON_FILE_CLICK)
          : row.file
            ? createTreeFileRow(row.file, row.depth, SIDEBAR_ON_FILE_CLICK)
            : null;
      if (!li) continue;
      li.classList.toggle("active", row.path === SIDEBAR_VIRTUAL_ACTIVE_PATH);
      li.style.position = "absolute";
      li.style.top = `${i * VIRTUAL_SIDEBAR_ROW_HEIGHT}px`;
      li.style.left = "0";
      li.style.right = "0";
      fragment.appendChild(li);
    }
    ul.replaceChildren(fragment);
    ul.style.height = `${SIDEBAR_VISIBLE_ROWS.length * VIRTUAL_SIDEBAR_ROW_HEIGHT}px`;
  }

  function scrollVirtualSidebarPathIntoView(path: string) {
    const index = SIDEBAR_VISIBLE_ROWS.findIndex((row) => row.path === path);
    if (index < 0) return;
    const sidebar = document.querySelector<HTMLElement>("#sidebar");
    if (!sidebar) return;
    const ul = $("#filelist");
    const top = index * VIRTUAL_SIDEBAR_ROW_HEIGHT;
    const bottom = top + VIRTUAL_SIDEBAR_ROW_HEIGHT;
    const sidebarRect = sidebar.getBoundingClientRect();
    const stickyBottom = Math.max(
      sidebarRect.top,
      document.querySelector<HTMLElement>(".sb-head")?.getBoundingClientRect()
        .bottom || sidebarRect.top,
      document
        .querySelector<HTMLElement>(".sb-filter-wrap")
        ?.getBoundingClientRect().bottom || sidebarRect.top,
    );
    const topPadding = Math.max(8, stickyBottom - sidebarRect.top + 8);
    const bottomPadding = 14;
    const listTop = ul.offsetTop;
    const maxHeight = Number.parseFloat(getComputedStyle(sidebar).maxHeight);
    const visibleHeight =
      Number.isFinite(maxHeight) && maxHeight > 0
        ? Math.min(sidebar.clientHeight, maxHeight)
        : sidebar.clientHeight;
    const visibleTop = sidebar.scrollTop + topPadding - listTop;
    const visibleBottom =
      sidebar.scrollTop + visibleHeight - bottomPadding - listTop;
    if (top < visibleTop)
      sidebar.scrollTop = Math.max(0, top + listTop - topPadding);
    else if (bottom > visibleBottom)
      sidebar.scrollTop = bottom + listTop - visibleHeight + bottomPadding;
    renderVirtualSidebarWindow();
  }

  function rerenderVirtualSidebar() {
    const ul = document.querySelector<HTMLElement>("#filelist");
    if (!ul?.classList.contains("tree-virtual")) return;
    computeVirtualSidebarVisibleRows();
    renderVirtualSidebarWindow();
  }

  function renderVirtualTreeSidebar(root: TreeNode) {
    const ul = $("#filelist");
    SIDEBAR_TREE_ROOT = root;
    buildSidebarTreeRows(root);
    ul.classList.add("tree-virtual");
    ul.style.position = "relative";
    computeVirtualSidebarVisibleRows();
    renderVirtualSidebarWindow();
    document
      .querySelector<HTMLElement>("#sidebar")
      ?.addEventListener("scroll", renderVirtualSidebarWindow, {
        passive: true,
      });
    hydrateLazyExpandedDirs();
  }

  // 起動直後に lazyExpandedDirs に乗っている dir (前回ユーザーが開いた lazy dir)
  // の子を fetch して展開状態を再現する。fetch 完了ごとに rerender して
  // 開いた dir から順に中身が現れる。SIDEBAR_TREE_ROOT が差し替わったら
  // (例: ref 切替) 古い hydrate の続きは捨てる。
  function hydrateLazyExpandedDirs() {
    if (!SIDEBAR_TREE_ROOT) return;
    if (STATE.lazyExpandedDirs.size === 0) return;
    const root = SIDEBAR_TREE_ROOT;
    const visit = async (node: TreeNode) => {
      if (SIDEBAR_TREE_ROOT !== root) return;
      const tasks: Promise<void>[] = [];
      for (const child of Object.values(node.dirs)) {
        if (child.children_omitted) continue;
        if (
          STATE.lazyExpandedDirs.has(child.path) &&
          shouldLazyLoadSidebarDir(child)
        ) {
          tasks.push(
            ensureVirtualSidebarDirLoaded(child).then(() => {
              if (SIDEBAR_TREE_ROOT !== root) return;
              rerenderVirtualSidebar();
              return visit(child);
            }),
          );
        } else {
          tasks.push(visit(child));
        }
      }
      await Promise.all(tasks);
    };
    void visit(root);
  }

  function renderFlat(
    files: SidebarItem[],
    ul: HTMLElement,
    onFileClick?: (file: SidebarItem) => void,
  ) {
    files.forEach((f, i) => {
      const li = document.createElement("li");
      li.tabIndex = -1;
      li.dataset.index = String(i);
      li.dataset.path = f.path;
      li.dataset.type = f.type || "blob";
      if (f.type === "commit") {
        li.title = f.submodule
          ? "Git submodule pinned to a commit"
          : "Git commit entry";
      }
      li.classList.toggle(
        "viewed",
        !onFileClick && STATE.viewedFiles.has(f.path),
      );
      if (f.status) {
        li.appendChild(fileBadge(f.status));
      } else {
        const icon = document.createElement("span");
        icon.className = "d2h-icon-wrapper";
        icon.innerHTML = sidebarEntryIcon(f);
        li.appendChild(icon);
      }
      const name = document.createElement("span");
      name.className = "name";
      name.textContent = f.path;
      name.title = f.path;
      li.appendChild(name);
      const kindTag = fileKindTag(f);
      if (kindTag) li.appendChild(kindTag);
      li.addEventListener("click", () => {
        if (onFileClick) onFileClick(f);
        else scrollToFile(f.path);
        scheduleMainSurfaceFocus();
      });
      if (!onFileClick)
        li.addEventListener("mouseenter", () => prefetchByPath(f.path), {
          passive: true,
        });
      ul.appendChild(li);
    });
  }

  function renderSidebar(
    files: SidebarItem[],
    onFileClick?: (file: SidebarItem) => void,
  ) {
    const ul = $("#filelist");
    const repoSidebar = !!onFileClick;
    if (!repoSidebar) {
      const repoTarget =
        document.querySelector<HTMLElement>("#repo-target-wrap");
      if (repoTarget) {
        repoTarget.hidden = true;
        repoTarget.style.display = "none";
      }
    }
    const treeMode = STATE.sbView === "tree" || repoSidebar;
    ul.innerHTML = "";
    ul.classList.toggle("tree", treeMode);
    ul.classList.remove("tree-virtual");
    ul.style.removeProperty("height");
    ul.style.removeProperty("position");
    SIDEBAR_TREE_ROOT = null;
    SIDEBAR_TREE_ROWS = [];
    SIDEBAR_VISIBLE_ROWS = [];
    SIDEBAR_ROW_BY_PATH = new Map();
    SIDEBAR_LAZY_LOADED_DIRS.clear();
    SIDEBAR_LAZY_LOADING_DIRS.clear();
    // Repo-mode sidebars (custom onFileClick) list the whole repository;
    // writing that into STATE.files would make every file look like part of
    // the current diff. Only the diff sidebar owns STATE.files.
    if (!onFileClick) STATE.files = files as FileMeta[];
    SIDEBAR_FILES = files;
    SIDEBAR_ON_FILE_CLICK = onFileClick;
    if (!onFileClick) setRepoSidebarRef(null);
    if (treeMode) {
      const root = buildTree(files);
      if (repoSidebar || files.length >= VIRTUAL_SIDEBAR_THRESHOLD)
        renderVirtualTreeSidebar(root);
      else renderTreeNode(root, 0, ul, onFileClick);
    } else {
      renderFlat(files, ul, onFileClick);
    }
    $("#totals").textContent = files.length
      ? `${files.length} file${files.length === 1 ? "" : "s"}`
      : "";
    // Update view-toggle visual
    const effectiveView = treeMode ? "tree" : STATE.sbView;
    $$(".sb-view-seg button").forEach((b) => {
      b.classList.toggle("active", b.dataset.view === effectiveView);
    });
    $$(".sb-tree-action").forEach((b) => {
      (b as HTMLButtonElement).disabled = !treeMode || !files.length;
    });
    // Re-apply active highlight if any
    if (STATE.activeFile) markActive(STATE.activeFile);
    applyFilter();
  }

  function setAllSidebarDirsCollapsed(collapsed: boolean) {
    const before = new Set(STATE.collapsedDirs);
    const beforeLazyExpanded = new Set(STATE.lazyExpandedDirs);
    if (!collapsed) STATE.collapsedDirs.clear();
    if ($("#filelist").classList.contains("tree-virtual")) {
      const added: string[] = [];
      const addedLazyExpanded: string[] = [];
      if (collapsed) {
        // Collapse all: 全 dir を collapsedDirs に積み、lazyExpandedDirs は破棄。
        for (const row of SIDEBAR_TREE_ROWS) {
          if (row.kind !== "dir") continue;
          if (!STATE.collapsedDirs.has(row.path)) added.push(row.path);
          STATE.collapsedDirs.add(row.path);
        }
        STATE.lazyExpandedDirs.clear();
      } else {
        // Expand all: 現在メモリ上にある全 dir を「ユーザーが明示的に開いた」と
        // みなして lazyExpandedDirs に記録する。これでリロードしても展開状態が
        // 再現される (lazy 未ロード dir はリロード後 lazyExpandedDirs から
        // hydrate される)。
        for (const row of SIDEBAR_TREE_ROWS) {
          if (row.kind !== "dir" || !row.dir) continue;
          if (row.dir.children_omitted) continue;
          if (!STATE.lazyExpandedDirs.has(row.path))
            addedLazyExpanded.push(row.path);
          STATE.lazyExpandedDirs.add(row.path);
        }
      }
      persistCollapsedDirs({
        added,
        removed: collapsed ? [] : [...before],
      });
      persistLazyExpandedDirs({
        added: addedLazyExpanded,
        removed: collapsed ? [...beforeLazyExpanded] : [],
      });
      rerenderVirtualSidebar();
      return;
    }
    const added: string[] = [];
    $$<HTMLElement>("#filelist .tree-dir[data-dirpath]").forEach((li) => {
      const path = li.dataset.dirpath || "";
      if (!path) return;
      li.classList.toggle("collapsed", collapsed);
      const dirIcon = li.querySelector<HTMLElement>(".dir-icon");
      if (dirIcon) setFolderIcon(dirIcon, collapsed);
      if (collapsed) {
        if (!STATE.collapsedDirs.has(path)) added.push(path);
        STATE.collapsedDirs.add(path);
      }
    });
    persistCollapsedDirs({
      added,
      removed: collapsed ? [] : [...before],
    });
  }

  function expandSidebarAncestors(path: string) {
    if (!isSidebarTreeRendered()) return;
    const ancestors = sidebarAncestorDirs(path);
    let collapsedChanged = false;
    const lazyExpandedAdded: string[] = [];
    for (const dir of ancestors) {
      if (STATE.collapsedDirs.delete(dir)) collapsedChanged = true;
      // route reveal で開いた祖先がもし lazy 対象なら、リロード後も
      // 同じ位置を辿れるよう lazyExpandedDirs にも記録しておく。
      // (lazy 対象判定には TreeNode が要るので row 経由で参照する。)
      const row = SIDEBAR_ROW_BY_PATH.get(dir);
      if (
        row?.dir &&
        !row.dir.children_omitted &&
        shouldLazyLoadSidebarDir(row.dir) &&
        !STATE.lazyExpandedDirs.has(dir)
      ) {
        STATE.lazyExpandedDirs.add(dir);
        lazyExpandedAdded.push(dir);
      }
      const liEl = document.querySelector<HTMLElement>(
        `#filelist .tree-dir[data-dirpath="${CSS.escape(dir)}"]`,
      );
      liEl?.classList.remove("collapsed");
      const icon = liEl?.querySelector<HTMLElement>(".dir-icon");
      if (icon) setFolderIcon(icon, false);
    }
    if (collapsedChanged) persistCollapsedDirs({ removed: ancestors });
    if (lazyExpandedAdded.length > 0)
      persistLazyExpandedDirs({ added: lazyExpandedAdded });
    rerenderVirtualSidebar();
  }

  function markActive(path: string, options: { reveal?: boolean } = {}) {
    STATE.activeFile = path;
    SIDEBAR_VIRTUAL_ACTIVE_PATH = path;
    if (options.reveal && isSidebarTreeRendered()) expandSidebarAncestors(path);
    setActiveSidebarItem(sidebarItemByPath(path));
    if ($("#filelist").classList.contains("tree-virtual")) {
      renderVirtualSidebarWindow();
      scrollVirtualSidebarPathIntoView(path);
      return;
    }
    if (options.reveal) {
      const active = activeSidebarItem();
      if (active)
        requestAnimationFrame(() => scrollSidebarItemIntoView(active));
    }
  }

  function applyFilter() {
    const input = $<HTMLInputElement>("#sb-filter");
    if ($("#filelist").classList.contains("tree-virtual")) {
      rerenderVirtualSidebar();
      return;
    }
    const filter = compileFileFilter(input.value);
    const invalid = filter.kind === "invalid";
    input.toggleAttribute("aria-invalid", invalid);
    input.title = invalid ? filter.error || "invalid regular expression" : "";
    const matches = invalid ? () => true : filter.match;
    const filterActive = filter.kind !== "empty" && !invalid;
    $$("#filelist li[data-path]").forEach((li) => {
      const match = matches(li.dataset.path || "");
      li.classList.toggle("hidden", !match);
    });
    if (!isRepositorySidebarMode()) {
      document
        .querySelectorAll<HTMLElement>(".gdp-file-shell")
        .forEach((card) => {
          const match = matches(card.dataset.path || "");
          card.classList.toggle("hidden-by-filter", !match);
        });
    }
    updateTreeDirVisibility(matches, filterActive);
    if (!isRepositorySidebarMode() && typeof applyViewedState === "function")
      applyViewedState();
  }

  function updateTreeDirVisibility(
    dirMatches?: (path: string) => boolean,
    filterActive = false,
  ) {
    const dirs = $$<HTMLElement>("#filelist .tree-dir");
    for (let i = dirs.length - 1; i >= 0; i--) {
      const dir = dirs[i];
      const childUl = dir.nextElementSibling;
      if (!childUl?.classList.contains("tree-children")) continue;
      let anyVisible = false;
      for (const child of childUl.children) {
        if (!(child instanceof HTMLElement)) continue;
        if (
          child.classList.contains("tree-file") &&
          !child.classList.contains("hidden") &&
          !child.classList.contains("hidden-by-tests")
        ) {
          anyVisible = true;
          break;
        }
        if (
          child.classList.contains("tree-dir") &&
          !child.classList.contains("hidden") &&
          !child.classList.contains("hidden-by-tests")
        ) {
          anyVisible = true;
          break;
        }
      }
      const explicitVisible = dir.dataset.explicit === "true" && !filterActive;
      const selfMatches =
        filterActive && !!dirMatches && dirMatches(dir.dataset.dirpath || "");
      dir.classList.toggle(
        "hidden",
        !anyVisible && !explicitVisible && !selfMatches,
      );
    }
  }

  let SIDEBAR_FILTER_RAF = 0;

  function scheduleApplyFilter() {
    if (SIDEBAR_FILTER_RAF) cancelAnimationFrame(SIDEBAR_FILTER_RAF);
    SIDEBAR_FILTER_RAF = requestAnimationFrame(() => {
      SIDEBAR_FILTER_RAF = 0;
      applyFilter();
    });
  }

  function flushSidebarFilter() {
    if (!SIDEBAR_FILTER_RAF) return;
    cancelAnimationFrame(SIDEBAR_FILTER_RAF);
    SIDEBAR_FILTER_RAF = 0;
    applyFilter();
  }

  function applySidebarWidth(w: number, options: { persist?: boolean } = {}) {
    const cw = Math.max(180, Math.min(900, w));
    document.documentElement.style.setProperty("--sidebar-w", `${cw}px`);
    STATE.sbWidth = cw;
    if (options.persist !== false) persistSidebarWidth(cw);
  }

  function isSidebarRowVisible(row: HTMLElement): boolean {
    if (
      row.classList.contains("hidden") ||
      row.classList.contains("hidden-by-tests")
    )
      return false;
    let parent = row.parentElement;
    while (parent && parent.id !== "filelist") {
      if (parent.classList.contains("tree-children")) {
        const dir = parent.previousElementSibling;
        if (
          dir?.classList.contains("collapsed") ||
          dir?.classList.contains("hidden")
        )
          return false;
      }
      parent = parent.parentElement;
    }
    return true;
  }

  const SIDEBAR_ITEM_SELECTOR =
    "#filelist li[data-path], #filelist .tree-dir[data-dirpath]";

  function sidebarItemPath(item: HTMLElement): string {
    return item.dataset.path || item.dataset.dirpath || "";
  }

  function activeSidebarItem(): HTMLElement | null {
    return document.querySelector<HTMLElement>(ACTIVE_SIDEBAR_ITEM_SELECTOR);
  }

  function sidebarItemByPath(path: string): HTMLElement | null {
    if (isVirtualSidebarActive() && SIDEBAR_ROW_BY_PATH.has(path)) {
      return (
        document.querySelector<HTMLElement>(
          `#filelist li[data-path="${CSS.escape(path)}"], #filelist .tree-dir[data-dirpath="${CSS.escape(path)}"]`,
        ) || null
      );
    }
    const escaped = CSS.escape(path);
    return document.querySelector<HTMLElement>(
      `#filelist li[data-path="${escaped}"], #filelist .tree-dir[data-dirpath="${escaped}"]`,
    );
  }

  function setActiveSidebarItem(target: HTMLElement | null) {
    document
      .querySelectorAll<HTMLElement>(ACTIVE_SIDEBAR_ITEM_SELECTOR)
      .forEach((item) => {
        if (item !== target) item.classList.remove("active");
      });
    target?.classList.add("active");
  }

  function visibleSidebarItems() {
    return $$<HTMLElement>(SIDEBAR_ITEM_SELECTOR).filter(isSidebarRowVisible);
  }

  function isVirtualSidebarActive() {
    return $("#filelist").classList.contains("tree-virtual");
  }

  function virtualSidebarActiveIndex() {
    const activePath = SIDEBAR_VIRTUAL_ACTIVE_PATH || STATE.activeFile || "";
    return SIDEBAR_VISIBLE_ROWS.findIndex((row) => row.path === activePath);
  }

  function selectVirtualSidebarIndex(
    index: number,
    options?: { open?: boolean },
  ) {
    if (!SIDEBAR_VISIBLE_ROWS.length) return null;
    const safeIndex = Math.max(
      0,
      Math.min(SIDEBAR_VISIBLE_ROWS.length - 1, index),
    );
    const row = SIDEBAR_VISIBLE_ROWS[safeIndex];
    if (!row) return null;
    markActive(row.path);
    scrollVirtualSidebarPathIntoView(row.path);
    if (options?.open) {
      if (row.kind === "dir" && row.dir && SIDEBAR_ON_FILE_CLICK) {
        SIDEBAR_ON_FILE_CLICK({
          path: row.dir.path,
          display_path: row.dir.path,
          type: "tree",
          children_omitted: row.dir.children_omitted,
          children_omitted_reason: row.dir.children_omitted_reason,
        });
      } else if (row.file && SIDEBAR_ON_FILE_CLICK) {
        SIDEBAR_ON_FILE_CLICK(row.file);
      }
    }
    return row;
  }

  function visibleSidebarItemFrom(
    current: HTMLElement,
    direction: 1 | -1,
  ): HTMLElement | null {
    const root = document.querySelector<HTMLElement>("#filelist");
    if (!current.isConnected) return null;
    if (!root) return null;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
      acceptNode(node) {
        if (!(node instanceof HTMLElement)) return NodeFilter.FILTER_SKIP;
        if (node.classList.contains("tree-children")) {
          const dir = node.previousElementSibling;
          if (
            dir?.classList.contains("collapsed") ||
            dir?.classList.contains("hidden") ||
            dir?.classList.contains("hidden-by-tests")
          )
            return NodeFilter.FILTER_REJECT;
        }
        if (!node.matches(SIDEBAR_ITEM_SELECTOR)) return NodeFilter.FILTER_SKIP;
        return isSidebarRowVisible(node)
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_SKIP;
      },
    });
    walker.currentNode = current;
    const next = direction === 1 ? walker.nextNode() : walker.previousNode();
    return next instanceof HTMLElement ? next : null;
  }

  function adjacentVisibleSidebarItem(direction: 1 | -1): HTMLElement | null {
    const active = activeSidebarItem();
    if (!active) {
      const items = visibleSidebarItems();
      return direction === 1
        ? items[0] || null
        : items[items.length - 1] || null;
    }
    if (!isSidebarRowVisible(active)) {
      const items = visibleSidebarItems();
      return direction === 1
        ? items[0] || null
        : items[items.length - 1] || null;
    }
    return visibleSidebarItemFrom(active, direction) || active;
  }

  function scrollSidebarItemIntoView(
    item: HTMLElement,
    block: "nearest" | "start" | "end" = "nearest",
  ) {
    const sidebar = document.querySelector<HTMLElement>("#sidebar");
    if (!sidebar) {
      item.scrollIntoView({ block });
      return;
    }
    const sidebarRect = sidebar.getBoundingClientRect();
    const itemRect = item.getBoundingClientRect();
    const stickyBottom = Math.max(
      sidebarRect.top,
      document.querySelector<HTMLElement>(".sb-head")?.getBoundingClientRect()
        .bottom || sidebarRect.top,
      document
        .querySelector<HTMLElement>(".sb-filter-wrap")
        ?.getBoundingClientRect().bottom || sidebarRect.top,
    );
    const topPadding = Math.max(8, stickyBottom - sidebarRect.top + 8);
    const bottomPadding = 14;
    const visibleTop = sidebarRect.top + topPadding;
    const visibleBottom = sidebarRect.bottom - bottomPadding;
    if (block === "start") {
      sidebar.scrollTop += itemRect.top - visibleTop;
      return;
    }
    if (block === "end") {
      sidebar.scrollTop += itemRect.bottom - visibleBottom;
      return;
    }
    if (itemRect.top < visibleTop)
      sidebar.scrollTop += itemRect.top - visibleTop;
    else if (itemRect.bottom > visibleBottom)
      sidebar.scrollTop += itemRect.bottom - visibleBottom;
  }

  function isRepositorySidebarMode() {
    return (
      document.body.classList.contains("gdp-repo-page") ||
      document.body.classList.contains("gdp-repo-blob-page")
    );
  }

  function isSidebarTreeRendered() {
    return $("#filelist").classList.contains("tree");
  }

  function moveActiveSidebarItem(direction: 1 | -1) {
    if (isVirtualSidebarActive()) {
      const current = virtualSidebarActiveIndex();
      const start =
        current < 0
          ? direction === 1
            ? 0
            : SIDEBAR_VISIBLE_ROWS.length - 1
          : current + direction;
      const row = selectVirtualSidebarIndex(start);
      if (row?.file) prefetchByPath(row.file.path);
      return;
    }
    const items = visibleSidebarItems();
    if (!items.length) return;
    const current = items.findIndex((li) => li.classList.contains("active"));
    const idx = nextVisibleFileIndex(current, items.length, direction);
    const target = items[idx];
    if (!target) return;
    const path = target.dataset.path || target.dataset.dirpath;
    if (path) markActive(path);
    scrollSidebarItemIntoView(target);
    if (target.dataset.path) prefetchByPath(target.dataset.path);
  }

  function moveActiveSidebarPage(direction: 1 | -1) {
    if (isVirtualSidebarActive()) {
      const sidebar = document.querySelector<HTMLElement>("#sidebar");
      const halfPageRows = Math.max(
        1,
        Math.floor(
          (sidebar?.clientHeight || window.innerHeight) /
            2 /
            VIRTUAL_SIDEBAR_ROW_HEIGHT,
        ),
      );
      const current = virtualSidebarActiveIndex();
      const start = current < 0 ? 0 : current;
      const row = selectVirtualSidebarIndex(start + direction * halfPageRows);
      if (row?.file) prefetchByPath(row.file.path);
      return;
    }
    const items = visibleSidebarItems();
    if (!items.length) return;
    const repoSidebar = isRepositorySidebarMode();
    const sidebar = document.querySelector<HTMLElement>("#sidebar");
    const sample = items.find(
      (item) => item.getBoundingClientRect().height > 0,
    );
    const rowHeight = sample ? sample.getBoundingClientRect().height : 28;
    const halfPageRows = Math.max(
      1,
      Math.floor((sidebar?.clientHeight || window.innerHeight) / 2 / rowHeight),
    );
    const current = items.findIndex((li) => li.classList.contains("active"));
    const start = current < 0 ? 0 : current;
    const idx = Math.max(
      0,
      Math.min(items.length - 1, start + direction * halfPageRows),
    );
    const target = items[idx];
    const path = target.dataset.path || target.dataset.dirpath;
    if (!repoSidebar && target.dataset.path) target.click();
    else if (path) markActive(path);
    scrollSidebarItemIntoView(target);
    if (target.dataset.path) prefetchByPath(target.dataset.path);
  }

  function moveActiveSidebarToEdge(edge: "top" | "bottom") {
    if (isVirtualSidebarActive()) {
      const row = selectVirtualSidebarIndex(
        edge === "top" ? 0 : SIDEBAR_VISIBLE_ROWS.length - 1,
      );
      if (row?.file) prefetchByPath(row.file.path);
      return;
    }
    const items = visibleSidebarItems();
    const repoSidebar = isRepositorySidebarMode();
    const target = edge === "top" ? items[0] : items[items.length - 1];
    if (!target) return;
    const path = target.dataset.path || target.dataset.dirpath;
    if (!repoSidebar && target.dataset.path) target.click();
    else if (path) markActive(path);
    scrollSidebarItemIntoView(target, edge === "top" ? "start" : "end");
    if (target.dataset.path) prefetchByPath(target.dataset.path);
  }

  function setActiveSidebarDirectoryCollapsed(collapsed: boolean) {
    if (isVirtualSidebarActive()) {
      const row = SIDEBAR_VISIBLE_ROWS[virtualSidebarActiveIndex()];
      if (row?.kind !== "dir" || !row.dir || row.dir.children_omitted) return;
      const snap = dirEffectiveCollapsed(row.dir);
      if (snap.effectiveCollapsed === collapsed) return;
      if (collapsed) {
        // 「閉じる」: collapsedDirs に積む & lazyExpanded は破棄。
        if (!snap.userCollapsed) {
          STATE.collapsedDirs.add(row.path);
          persistCollapsedDirs({ added: [row.path] });
        }
        if (snap.userLazyExpanded) {
          STATE.lazyExpandedDirs.delete(row.path);
          persistLazyExpandedDirs({ removed: [row.path] });
        }
      } else {
        // 「開く」: user collapsed なら剥がす。lazy 未ロードなら lazyExpanded
        // に記録し、子を fetch してから rerender し直す。
        if (snap.userCollapsed) {
          STATE.collapsedDirs.delete(row.path);
          persistCollapsedDirs({ removed: [row.path] });
        }
        if (snap.lazyNotLoaded && !snap.userLazyExpanded) {
          STATE.lazyExpandedDirs.add(row.path);
          persistLazyExpandedDirs({ added: [row.path] });
        }
        if (snap.lazyNotLoaded) {
          void ensureVirtualSidebarDirLoaded(row.dir).then(() => {
            rerenderVirtualSidebar();
            scrollVirtualSidebarPathIntoView(row.path);
          });
        }
      }
      rerenderVirtualSidebar();
      scrollVirtualSidebarPathIntoView(row.path);
      return;
    }
    const active = document.querySelector<HTMLElement>(
      "#filelist .tree-dir.active[data-dirpath]",
    );
    if (!active) return;
    if (active.classList.contains("collapsed") === collapsed) return;
    const control = active.querySelector<HTMLElement>(".chev");
    if (control) control.click();
  }

  function toggleActiveSidebarDirectoryCollapsed() {
    if (isVirtualSidebarActive()) {
      const row = SIDEBAR_VISIBLE_ROWS[virtualSidebarActiveIndex()];
      if (row?.kind !== "dir" || !row.dir || row.dir.children_omitted) return;
      const snap = dirEffectiveCollapsed(row.dir);
      setActiveSidebarDirectoryCollapsed(!snap.effectiveCollapsed);
      return;
    }
    const active = document.querySelector<HTMLElement>(
      "#filelist .tree-dir.active[data-dirpath]",
    );
    if (!active) return;
    const control = active.querySelector<HTMLElement>(".chev");
    if (control) control.click();
  }

  function openActiveSidebarItem() {
    if (isVirtualSidebarActive()) {
      const index = virtualSidebarActiveIndex();
      if (index >= 0) selectVirtualSidebarIndex(index, { open: true });
      return;
    }
    const active = document.querySelector<HTMLElement>(
      "#filelist li.active[data-path], #filelist .tree-dir.active[data-dirpath]",
    );
    if (active && isSidebarRowVisible(active)) active.click();
  }

  function treeNodeItems(node: TreeNode) {
    const cached = SIDEBAR_TREE_ITEMS_CACHE.get(node);
    if (cached) return cached;
    const items: TreeNodeItem[] = [];
    for (const k of Object.keys(node.dirs)) {
      const d = node.dirs[k];
      items.push({ kind: "dir", sortKey: d.minOrder, dir: d });
    }
    for (const f of node.files) {
      items.push({
        kind: "file",
        sortKey: f.order != null ? f.order : Infinity,
        file: f,
      });
    }
    items.sort((a, b) => a.sortKey - b.sortKey);
    SIDEBAR_TREE_ITEMS_CACHE.set(node, items);
    return items;
  }

  const ACTIVE_SIDEBAR_ITEM_SELECTOR =
    "#filelist li.active[data-path], #filelist .tree-dir.active[data-dirpath]";
  function getSidebarRowByPath(path: string) {
    return SIDEBAR_ROW_BY_PATH.get(path);
  }
  function getSidebarVirtualActivePath() {
    return SIDEBAR_VIRTUAL_ACTIVE_PATH;
  }
  function getSidebarVisibleRows() {
    return SIDEBAR_VISIBLE_ROWS;
  }
  function getSidebarFiles() {
    return SIDEBAR_FILES;
  }
  function getSidebarOnFileClick() {
    return SIDEBAR_ON_FILE_CLICK;
  }

  return {
    renderSidebar,
    applyFilter,
    scheduleApplyFilter,
    flushSidebarFilter,
    markActive,
    rerenderVirtualSidebar,
    ensureVirtualSidebarDirLoaded,
    scrollVirtualSidebarPathIntoView,
    shouldLazyLoadSidebarDir,
    setFolderIcon,
    isRepositorySidebarMode,
    placeSidebarToggle,
    ensureSidebarToggleButton,
    placeSidebarFilter,
    applySidebarHidden,
    toggleSidebarHidden,
    applySidebarWidth,
    applySidebarFontSize,
    savedSidebarFontSize,
    syncSidebarHeaderHeight,
    observeSidebarHeaderHeight,
    setSidebarTreeActionIcons,
    setAllSidebarDirsCollapsed,
    expandSidebarAncestors,
    updateTreeDirVisibility,
    moveActiveSidebarItem,
    moveActiveSidebarPage,
    moveActiveSidebarToEdge,
    openActiveSidebarItem,
    setActiveSidebarDirectoryCollapsed,
    toggleActiveSidebarDirectoryCollapsed,
    activeSidebarItem,
    sidebarItemByPath,
    setActiveSidebarItem,
    isVirtualSidebarActive,
    selectVirtualSidebarIndex,
    virtualSidebarActiveIndex,
    adjacentVisibleSidebarItem,
    scrollSidebarItemIntoView,
    sidebarItemPath,
    visibleSidebarItems,
    upsertSidebarTreeEntry,
    mergeSidebarTreeEntries,
    buildTree,
    getSidebarRowByPath,
    getSidebarVirtualActivePath,
    getSidebarFiles,
    getSidebarOnFileClick,
    getSidebarVisibleRows,
    isSidebarRowVisible,
    visibleSidebarItemFrom,
  };
}
