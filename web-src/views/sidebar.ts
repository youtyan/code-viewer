// The two file lists: the file list (the repository tree, #file-list, shown on
// every screen) and the list of changed files (#sidebar: Diff, and next to the
// History / worktree lists). One createSidebar per list (SidebarDom).
// Tree/flat rendering, virtual tree for huge repos, filtering, folder icons,
// keyboard navigation, and the file list's chrome (width / font size / hide
// toggle). Extracted from app.ts.

import { keyed } from "lit/directives/keyed.js";
import { nothing, type TemplateResult } from "lit/html.js";
import { apiUrl } from "../core/api-url";
import { classifyDiffFileKind } from "../core/diff-file-kinds";
import { errorWithCause, responseErrorMessage } from "../core/error-detail";
import {
  type CompiledFileFilter,
  compileFileFilter,
} from "../core/file-filter";
import { nextVisibleFileIndex } from "../core/file-navigation";
import { filePathDisplayText } from "../core/file-path-copy";
import { isNativeLinkClick, linkOpenIntent } from "../core/link-click";
import type {
  FileMeta,
  FileStatusMark,
  RepoTreeEntry,
  RepoTreeResponse,
  SidebarItem,
} from "../core/types";
import { TREE_WITHOUT_COMMIT_DATES } from "../core/types";
import { DIFF_SCREEN_TEXT } from "./diff-view-i18n";
import {
  type FocusedListRow,
  focusedListRow,
  syncListTabStop,
} from "./list-tab-stop";
import { pageLanguage } from "./page-language";
import { repoViewText } from "./repo-view-i18n";
import { rowHeightFor, touchRowFloor } from "./shell/row-height";
import {
  DEFAULT_VIEW,
  type SidebarBadgeProps,
  type SidebarEntryIcon,
  type SidebarRowLinkProps,
  type SidebarSymlinkProps,
  type SidebarTagProps,
  type SidebarView,
} from "./sidebar-view";
import { treeLevelPad } from "./tree-indent";
import { renderOwned, templateElement } from "./ui/renderer";

export type ViewerFontSize = "compact" | "regular" | "large" | "xlarge";

// ai-dup-check: allow -- sidebar needs ordered ancestor paths for UI expansion.
export function sidebarAncestorDirs(path: string): string[] {
  const parts = path.split("/").filter(Boolean);
  const dirs: string[] = [];
  for (let i = 1; i < parts.length; i++) dirs.push(parts.slice(0, i).join("/"));
  return dirs;
}

/**
 * 一覧を描く要素 (セレクタ)。変更ファイルの一覧 (#sidebar) とファイル一覧
 * (#file-list) で 1 つずつ createSidebar を作る (ui-layout.md の「一覧の列」)。
 */
export type SidebarDom = {
  /** 列の要素 (スクロールする箱)。 */
  root: string;
  /** 行を描く ul。 */
  list: string;
  head: string;
  filterWrap: string;
  filter: string;
  filterClear: string;
  totals: string;
  expandAll: string;
  collapseAll: string;
};

/** 変更ファイルの一覧 (Diff の一覧・History と作業ツリーの一覧の右)。 */
export const CHANGES_LIST_DOM: SidebarDom = {
  root: "#sidebar",
  list: "#filelist",
  head: "#sidebar .sb-head",
  filterWrap: "#sidebar .sb-filter-wrap",
  filter: "#sb-filter",
  filterClear: "#sb-filter-clear",
  totals: "#totals",
  expandAll: "#sb-expand-all",
  collapseAll: "#sb-collapse-all",
};

/** ファイル一覧 (どの画面でも左のサイドバーの右に出すリポジトリの木)。 */
export const FILE_LIST_DOM: SidebarDom = {
  root: "#file-list",
  list: "#file-list-rows",
  head: "#file-list .sb-head",
  filterWrap: "#file-list .sb-filter-wrap",
  filter: "#file-list-filter",
  filterClear: "#file-list-filter-clear",
  totals: "#file-list-totals",
  expandAll: "#file-list-expand-all",
  collapseAll: "#file-list-collapse-all",
};

export type SidebarDeps = {
  /** 描く要素。 */
  dom: SidebarDom;
  /**
   * ファイル一覧 (リポジトリの木) なら true、変更ファイルの一覧なら false。
   * 列を畳むボタン・幅・文字の大きさはファイル一覧の側が持つ。
   */
  repository: boolean;
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
  openDiffFile(path: string): void;
  /**
   * ファイルの行を固定のタブで開く (中ボタン・⌘/Ctrl＋クリック・ダブル
   * クリック) か、反対の面で開く (Alt＋クリック。1 面なら右に分けて右で)。
   * list は行のある一覧 (repo = 木、diff = 差分の一覧: 差分の版のファイル)。
   */
  openFileAs(
    file: SidebarItem,
    intent: "new-tab" | "other-pane",
    list: "diff" | "repo",
  ): void;
  /** The URL a row leads to, so the browser can open it (Shift+click: a new window). */
  sidebarItemHref(item: SidebarItem, mode: "diff" | "repo"): string | null;
  prefetchByPath(path: string): void;
  /** 状態の札 (M・A・D …) の title。 */
  fileStatusTitles(): Record<FileStatusMark, string>;
  applyViewedState(): void;
  persistCollapsedDirs(patch: { added?: string[]; removed?: string[] }): void;
  persistLazyExpandedDirs(patch: {
    added?: string[];
    removed?: string[];
  }): void;
  appendScopeParams(params: URLSearchParams): void;
  /** フォルダの行の「OS で開く」を押した。 */
  openPathFromButton(
    path: string,
    kind: "directory",
    button: HTMLButtonElement,
  ): void;
  normalizeViewerFontSize(value: unknown): ViewerFontSize;
  getSidebarFontSize(): ViewerFontSize;
  persistSidebarHidden(hidden: boolean): void;
  persistSidebarWidth(width: number): void;
  scheduleMainSurfaceFocus(): void;
  trackLoad: <T>(promise: Promise<T>) => Promise<T>;
  getRepoSidebarRef(): string | null;
  setRepoSidebarRef(ref: string | null): void;
  isTestPath(path: string): boolean;
  // Tooltip for the "matching / all files" count shown while filtering.
  filterCountTitle(visible: number, total: number): string;
  /** 差分の一覧の件数 ("3 files" / "3ファイル")。 */
  fileCountText(count: number): string;
  sidebarToggleTitle(hidden: boolean): string;
  /**
   * 利用者が自分でファイル一覧を畳んだ / 開いた (ボタン・キー)。自動で畳んだ
   * ものと区別するために呼ぶ (app.ts の、幅が足りないときの自動の畳み)。
   */
  onUserToggledSidebarHidden?(hidden: boolean): void;
  openDirectoryInOsTitle(): string;
  omittedDirectoryBadge(reason: RepoTreeEntry["children_omitted_reason"]): {
    label: string;
    title: string;
  };
  commitEntryBadge(submodule: SidebarItem["submodule"]): {
    label: string;
    title: string;
  };
  $: <T extends Element = HTMLElement>(sel: string) => T;
  $$: <T extends Element = HTMLElement>(sel: string) => T[];
};

export function createSidebar(
  deps: SidebarDeps,
  view: SidebarView = DEFAULT_VIEW,
) {
  const {
    $,
    $$,
    STATE,
    dom: DOM,
    openDiffFile,
    sidebarItemHref,
    prefetchByPath,
    fileStatusTitles,
    applyViewedState,
    persistCollapsedDirs,
    persistLazyExpandedDirs,
    appendScopeParams,
    openPathFromButton,
    normalizeViewerFontSize,
    getSidebarFontSize,
    persistSidebarHidden,
    persistSidebarWidth,
    scheduleMainSurfaceFocus,
    trackLoad,
    getRepoSidebarRef,
    setRepoSidebarRef,
    isTestPath,
    sidebarToggleTitle,
    openDirectoryInOsTitle,
    omittedDirectoryBadge,
    commitEntryBadge,
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
    is_symlink?: true;
    symlink_target?: string;
    resolved_path?: string;
    // Only set for directories the server reported as a whole - a wholly
    // untracked ("U") or ignored ("I") directory. Directories synthesized
    // from a file path stay undefined: their tracked/untracked mix is only
    // knowable per file.
    status?: string;
  };

  const VIRTUAL_SIDEBAR_THRESHOLD = 3000;

  /**
   * 仮想表示の 1 行の高さ (px)。値の出所は views/shell/row-height.ts。指の画面
   * では押せる最小の高さ (--sp-touch) より低くしない (style.css の指の画面の節の
   * 仮想表示の行と同じ max)。
   */
  function virtualRowHeight(): number {
    return Math.max(rowHeightFor(savedSidebarFontSize()), touchRowFloor());
  }

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

  // 選んでいる行。変更ファイルの一覧は本文と共有する STATE.activeFile
  // (diff-view が読む)、ファイル一覧は自分だけで持つ (同時に出すので、片方の
  // 選択がもう片方の選択を上書きしない)。
  let REPO_ACTIVE_PATH: string | null = null;
  function activePath(): string | null {
    return deps.repository ? REPO_ACTIVE_PATH : STATE.activeFile;
  }

  let SIDEBAR_TREE_ITEMS_CACHE = new WeakMap<TreeNode, TreeNodeItem[]>();

  const SIDEBAR_LAZY_LOADED_DIRS = new Set<string>();

  const SIDEBAR_LAZY_LOADING_DIRS = new Map<string, Promise<void>>();

  // ロード済み lazy dir ごとの entries シグネチャ。SSE リフレッシュ時に
  // 「中身が変わっていなければ触らない」判定に使う。
  const SIDEBAR_LAZY_DIR_SIGNATURES = new Map<string, string>();

  function savedSidebarFontSize(): ViewerFontSize {
    return normalizeViewerFontSize(getSidebarFontSize());
  }

  function applySidebarFontSize(size: ViewerFontSize = savedSidebarFontSize()) {
    document.body.dataset.sidebarFontSize = size;
    document.body.style.setProperty("--ui-row-h", `${rowHeightFor(size)}px`);
  }

  // 見出しの高さ (その下に貼り付く絞り込みの top)。一覧は 2 つ同時に出るので、
  // それぞれの列の要素に書く。
  function syncSidebarHeaderHeight() {
    requestAnimationFrame(() => {
      const head = document.querySelector<HTMLElement>(DOM.head);
      const root = document.querySelector<HTMLElement>(DOM.root);
      if (head && root)
        root.style.setProperty(
          "--sidebar-head-h",
          `${Math.ceil(head.getBoundingClientRect().height)}px`,
        );
    });
  }

  function observeSidebarHeaderHeight() {
    const head = document.querySelector<HTMLElement>(DOM.head);
    if (!head || typeof ResizeObserver === "undefined") {
      syncSidebarHeaderHeight();
      return;
    }
    const observer = new ResizeObserver(syncSidebarHeaderHeight);
    observer.observe(head);
    syncSidebarHeaderHeight();
  }

  let SIDEBAR_FILES: SidebarItem[] = [];

  /** まだ宣言的に描いていない画面 (repo-view) のフォルダの絵の箱を描く。 */
  function setFolderIcon(el: HTMLElement, collapsed: boolean) {
    renderOwned(el, view.folderIcon(collapsed));
  }

  function setSidebarTreeActionIcons() {
    // 列を畳むボタンはファイル一覧の列の頭にあり、ファイル一覧の側が持つ。
    if (deps.repository) syncSidebarToggleIcon(ensureSidebarToggleButton());
    const expand = document.querySelector<HTMLButtonElement>(DOM.expandAll);
    const collapse = document.querySelector<HTMLButtonElement>(DOM.collapseAll);
    if (expand) renderOwned(expand, view.expandAllIcon());
    if (collapse) renderOwned(collapse, view.collapseAllIcon());
  }

  function syncSidebarToggleIcon(button: HTMLButtonElement) {
    renderOwned(button, view.toggleIcon(STATE.sidebarHidden));
  }

  function bindSidebarToggleButton(button: HTMLButtonElement) {
    if (button.dataset.gdpSidebarToggleBound === "1") return;
    button.dataset.gdpSidebarToggleBound = "1";
    button.addEventListener("click", toggleSidebarHidden);
  }

  function ensureSidebarToggleButton() {
    // 置き場所は web/index.html の一覧の列の頭 (#view-head)。無ければ作る
    // (置くのは placeSidebarToggle)。
    const button =
      document.querySelector<HTMLButtonElement>("#sidebar-toggle") ??
      templateElement<HTMLButtonElement>(view.toggleButton());
    bindSidebarToggleButton(button);
    // 文言が「畳む / 出す」と状態で変わるので、押した状態 (aria-pressed) は
    // 付けない (「出す、押されている」と読まれて逆に聞こえた)。ファイル一覧が
    // 出ているかを開閉 (aria-expanded) で伝える。
    button.setAttribute(
      "aria-expanded",
      STATE.sidebarHidden ? "false" : "true",
    );
    const toggleTitle = sidebarToggleTitle(STATE.sidebarHidden);
    button.title = toggleTitle;
    button.setAttribute("aria-label", toggleTitle);
    syncSidebarToggleIcon(button);
    return button;
  }

  /**
   * 置き場所の中の順は見た目の順 (Tab で移る順)。絵柄の行ではボタンは右端 (絵柄の
   * 後)。CSS の order で見た目だけ並べ替えると、Tab が右端のボタンから名前へ
   * 戻った。
   */
  function attachSidebarToggle(host: HTMLElement) {
    const button = ensureSidebarToggleButton();
    syncSidebarToggleIcon(button);
    if (button.parentElement === host) return;
    host.append(button);
  }

  /**
   * ファイル一覧を畳む / 出すボタンと画面の入口 (#view-head) の置き場所。入口の
   * 絵柄とボタンは一覧の列の頭 (#panel-head) の 2 段目で、ファイル一覧を畳んでも
   * 動かさない (畳むのは頭の下の一覧だけ。ui-layout.md の「一覧の列」)。ボタンは
   * 絵柄の行の右端 (.view-head-row)。1 段目 (#project-head。プロジェクトの名前と
   * ブランチ) はここでは動かさない。
   */
  function placeSidebarToggle() {
    const head = document.querySelector<HTMLElement>("#view-head");
    const row = head?.querySelector<HTMLElement>(".view-head-row") ?? null;
    const panelHead = document.querySelector<HTMLElement>("#panel-head");
    if (!head || !row || !panelHead)
      throw new Error(
        `view head: missing ${[
          ["#view-head", head],
          ["#view-head .view-head-row", row],
          ["#panel-head", panelHead],
        ]
          .filter(([, el]) => !el)
          .map(([name]) => name)
          .join(", ")} in index.html`,
      );
    attachSidebarToggle(row);
    if (head.parentElement !== panelHead) panelHead.append(head);
    // 絵柄 (.view-strip) は行の頭で、畳むボタンがその右端 (Tab で移る順を見た目の
    // 順にそろえる)。
    const strip = document.querySelector<HTMLElement>(".view-strip");
    if (strip && head.firstElementChild !== strip) head.prepend(strip);
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
    const hidden = !STATE.sidebarHidden;
    applySidebarHidden(hidden);
    deps.onUserToggledSidebarHidden?.(hidden);
  }

  // Copies the directory-only facts of a `type: "tree"` entry onto the node
  // that represents it. Shared by the two tree builders (full rebuild and
  // incremental upsert) so a directory carries the same attributes however
  // it entered the tree.
  function applyDirEntryToNode(node: TreeNode, entry: SidebarItem) {
    node.explicit = true;
    if (entry.children_omitted === true) {
      node.children_omitted = true;
      node.children_omitted_reason = entry.children_omitted_reason;
    }
    if (entry.is_symlink) {
      node.is_symlink = true;
      node.symlink_target = entry.symlink_target;
      node.resolved_path = entry.resolved_path;
    }
    if (entry.status) node.status = entry.status;
  }

  // The label span of a directory row: name, then the badges that qualify
  // it. Shared by the plain and virtualized tree renderers so both stay
  // identical. The status badge sits after the name rather than replacing
  // the leading icon (as a file row does), because that icon is the
  // expand/collapse target.
  // Rows are real links so the browser keeps Shift+click (a new window).
  // File rows take the other presses themselves (middle / ⌘ / Ctrl / Alt /
  // double click open app tabs: wireFileRowOpen); folder rows leave every
  // modified press to the browser. The target is resolved
  // again when the pointer goes down so it follows the current range / ref
  // even when the row itself was not re-rendered.
  function rowLink(
    className: string,
    href: () => string | null,
    text: string,
    title: string,
  ): SidebarRowLinkProps {
    return { className, href, text, title };
  }

  function statusBadge(status: string | undefined): SidebarBadgeProps | null {
    return status ? { status, titles: fileStatusTitles() } : null;
  }

  // Internal git metadata and truncated listings have nothing to open.
  function dirRowOpensNothing(dir: TreeNode): boolean {
    return (
      dir.children_omitted_reason === "internal" ||
      dir.children_omitted_reason === "truncated"
    );
  }

  function dirRowHref(
    dir: TreeNode,
    onFileClick?: (file: SidebarItem) => void,
  ): string | null {
    if (!onFileClick || dirRowOpensNothing(dir)) return null;
    return sidebarItemHref(
      { path: dir.path, type: "tree", resolved_path: dir.resolved_path },
      "repo",
    );
  }

  function omittedTag(dir: TreeNode): SidebarTagProps | null {
    if (!dir.children_omitted) return null;
    const badge = omittedDirectoryBadge(dir.children_omitted_reason);
    return {
      className: `dir-omitted ${dir.children_omitted_reason === "heavy" ? "dir-omitted-heavy" : "dir-omitted-internal"}`,
      label: badge.label,
      title: badge.title,
    };
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
        applyDirEntryToNode(node, f);
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

  /** 仮想表示でない木 (差分の一覧) の中身。畳む・開くは STATE.collapsedDirs。 */
  function treeTemplate(
    node: TreeNode,
    depth: number,
    onFileClick?: (file: SidebarItem) => void,
  ): unknown[] {
    // Sort by server-assigned order so the sidebar preserves the same root
    // ordering as the repository tree response.
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
    return items.map((item) => {
      if (item.kind === "file")
        return fileRowTemplate(item.file, depth, onFileClick);
      const dir = item.dir;
      const collapsed = STATE.collapsedDirs.has(dir.path);
      const toggleDir = (e: Event) => {
        e.stopPropagation();
        if (STATE.collapsedDirs.has(dir.path)) {
          STATE.collapsedDirs.delete(dir.path);
          persistCollapsedDirs({ removed: [dir.path] });
        } else {
          STATE.collapsedDirs.add(dir.path);
          persistCollapsedDirs({ added: [dir.path] });
        }
        // 畳んだ中に止まり場所があれば、見えている行へ移す。
        renderTreeList();
      };
      return view.treeDir(
        dirRowTemplate(dir, depth, onFileClick, {
          collapsed,
          virtual: false,
          toggleDir,
        }),
        treeTemplate(dir, depth + 1, onFileClick),
      );
    });
  }

  /** フォルダの行。仮想表示 (Files の木) と差分の一覧の木で同じ形。 */
  function dirRowTemplate(
    dir: TreeNode,
    depth: number,
    onFileClick: ((file: SidebarItem) => void) | undefined,
    options: {
      collapsed: boolean;
      virtual: boolean;
      toggleDir: (e: Event) => void;
      active?: boolean;
      top?: number;
    },
  ): TemplateResult {
    const cls = [
      "tree-dir",
      dir.is_symlink ? "symlink-row" : "",
      dir.children_omitted ? "children-omitted" : "",
      dir.children_omitted
        ? dir.children_omitted_reason === "heavy"
          ? "children-omitted-heavy"
          : "children-omitted-internal"
        : "",
      options.collapsed ? "collapsed" : "",
      options.active ? "active" : "",
    ]
      .filter(Boolean)
      .join(" ");
    const title = dir.children_omitted
      ? dir.children_omitted_reason === "heavy"
        ? "Large generated/vendor directory: open the detail pane to browse its contents"
        : "Internal Git metadata is not browsed"
      : undefined;
    const onRowClick = onFileClick
      ? (e: MouseEvent) => {
          if (isNativeLinkClick(e)) return;
          e.preventDefault();
          e.stopPropagation();
          if (dirRowOpensNothing(dir)) return;
          onFileClick({
            path: dir.path,
            display_path: dir.path,
            type: "tree",
            children_omitted: dir.children_omitted,
            children_omitted_reason: dir.children_omitted_reason,
            ...(options.virtual ? {} : { resolved_path: dir.resolved_path }),
          });
          scheduleMainSurfaceFocus();
        }
      : options.toggleDir;
    const style = [
      `--lvl-pad: ${treeLevelPad(depth)};`,
      options.top === undefined
        ? ""
        : `position: absolute; top: ${options.top}px; left: 0px; right: 0px;`,
    ].join(" ");
    return view.dirRow({
      path: dir.path,
      className: cls,
      title,
      omittedReason: dir.children_omitted_reason,
      explicit: !!dir.explicit,
      style,
      onRowClick,
      onToggle: dir.children_omitted ? null : options.toggleDir,
      collapsed: options.collapsed,
      link: rowLink(
        "dir-name",
        () => dirRowHref(dir, onFileClick),
        filePathDisplayText(dir.name),
        filePathDisplayText(dir.path),
      ),
      badge: statusBadge(dir.status),
      omitted: omittedTag(dir),
      symlink: symlinkTarget(dir),
      openPath: {
        title: openDirectoryInOsTitle(),
        // 止まり場所の行のボタンだけ Tab に入れる (syncTreeTabStop / syncDiffListTabStop)。
        rowAction: !!onFileClick || !options.virtual,
        onOpen: (button) => openPathFromButton(dir.path, "directory", button),
      },
    });
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
      applyDirEntryToNode(node, entry);
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

  function fetchSidebarDirEntries(dir: TreeNode): Promise<SidebarItem[]> {
    const params = new URLSearchParams();
    params.set("ref", getRepoSidebarRef() || "worktree");
    params.set("path", dir.path);
    params.set(...TREE_WITHOUT_COMMIT_DATES);
    appendScopeParams(params);
    return trackLoad<RepoTreeResponse>(
      fetch(`${apiUrl("tree")}?${params.toString()}`).then((response) =>
        response.ok
          ? response.json()
          : responseErrorMessage(response, `load folder ${dir.path}`).then(
              (message) => {
                throw new Error(message);
              },
            ),
      ),
    ).then((meta) =>
      meta.entries.map(
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
            is_symlink: entry.is_symlink,
            symlink_target: entry.symlink_target,
            symlink_target_type: entry.symlink_target_type,
            resolved_path: entry.resolved_path,
            status: entry.status,
          }) satisfies SidebarItem,
      ),
    );
  }

  function ensureVirtualSidebarDirLoaded(dir: TreeNode): Promise<void> {
    if (!shouldLazyLoadSidebarDir(dir)) return Promise.resolve();
    const existing = SIDEBAR_LAZY_LOADING_DIRS.get(dir.path);
    if (existing) return existing;
    const load = fetchSidebarDirEntries(dir)
      .then((entries) => {
        if (SIDEBAR_LAZY_LOADING_DIRS.get(dir.path) !== load) return;
        mergeSidebarTreeEntries(entries);
        SIDEBAR_LAZY_LOADED_DIRS.add(dir.path);
        SIDEBAR_LAZY_DIR_SIGNATURES.set(
          dir.path,
          sidebarItemsSignature(entries),
        );
      })
      .finally(() => {
        if (SIDEBAR_LAZY_LOADING_DIRS.get(dir.path) === load)
          SIDEBAR_LAZY_LOADING_DIRS.delete(dir.path);
      });
    SIDEBAR_LAZY_LOADING_DIRS.set(dir.path, load);
    return load;
  }

  /** 仮想表示 (Files の木) のフォルダの行の開く・畳む。 */
  function virtualToggleDir(dir: TreeNode): (e: Event) => Promise<void> {
    return async (e: Event) => {
      e.stopPropagation();
      if (VIRTUAL_TOGGLING.has(dir.path)) return;
      VIRTUAL_TOGGLING.add(dir.path);
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
        }
        rerenderVirtualSidebar();
      } finally {
        VIRTUAL_TOGGLING.delete(dir.path);
      }
    };
  }

  /** 開閉の途中 (読み込みを待っている) のフォルダ。2 回目の押しを無視する。 */
  const VIRTUAL_TOGGLING = new Set<string>();

  // Small opt-in marker next to the status badge for files worth a second
  // look before diving in: a large/huge diff, or a binary/media file. Mirrors
  // the size-tag colors already used on the diff card header.
  function fileKindTag(f: SidebarItem): SidebarTagProps | null {
    if (f.type === "commit") {
      const badge = commitEntryBadge(f.submodule);
      return {
        className: `kind-tag ${f.submodule ? "submodule" : "gitlink"}`,
        label: badge.label,
        title: badge.title,
      };
    }
    const kind = classifyDiffFileKind(f);
    if (!kind.heavy && !kind.binary && !kind.media) return null;
    const isBinaryLike = kind.binary || kind.media;
    const text = DIFF_SCREEN_TEXT[pageLanguage()];
    return {
      className: `kind-tag ${isBinaryLike ? "binary" : "heavy"}`,
      label: isBinaryLike ? "B" : "!",
      title: isBinaryLike ? text.kindTagBinary : text.kindTagHeavy,
    };
  }

  function sidebarEntryIcon(f: SidebarItem): SidebarEntryIcon {
    if (f.is_symlink) return "symlink";
    return f.type === "commit" ? "commit" : "file";
  }

  // Small "→ target" sublabel next to the name so a symlink target is
  // visible without a hover, and broken links (target missing/outside the
  // repo) are visually distinct. Mirrors the dir-omitted/kind-tag pattern of
  // a compact inline marker rather than a separate tooltip component.
  function symlinkTarget(f: {
    is_symlink?: true;
    symlink_target?: string;
    symlink_target_type?: "tree" | "blob" | "missing";
  }): SidebarSymlinkProps | null {
    if (!f.is_symlink) return null;
    const broken = f.symlink_target_type === "missing";
    const target = filePathDisplayText(f.symlink_target || "?");
    const text = repoViewText(pageLanguage());
    return {
      broken,
      target,
      title: broken ? text.brokenSymlink(target) : text.symlink(target),
    };
  }

  /** ファイルの行 (木)。 */
  function fileRowTemplate(
    f: SidebarItem,
    depth: number,
    onFileClick: ((file: SidebarItem) => void) | undefined,
    position?: { active: boolean; top: number },
  ): TemplateResult {
    const brokenSymlink = f.is_symlink && f.symlink_target_type === "missing";
    // A deleted-status entry is only synthesized for the repository
    // explorer (see deletedTreeEntriesForPath in preview.ts) and has no
    // filesystem content left to open there. Deleted files coming from the
    // diff sidebar itself (no onFileClick) still scroll to their diff card
    // as before.
    const deletedEntry = !!onFileClick && f.status === "D";
    const disabled = f.type !== "commit" && (brokenSymlink || deletedEntry);
    const cls = [
      "tree-file",
      f.is_symlink ? "symlink-row" : "",
      f.type !== "commit" && brokenSymlink ? "symlink-broken-row" : "",
      disabled ? "gdp-row-disabled" : "",
      !onFileClick && STATE.viewedFiles.has(f.path) ? "viewed" : "",
      STATE.hideTests && !isRepositorySidebarMode() && isTestPath(f.path || "")
        ? "hidden-by-tests"
        : "",
      position?.active ? "active" : "",
    ]
      .filter(Boolean)
      .join(" ");
    const style = [
      `--lvl-pad: ${treeLevelPad(depth)};`,
      position
        ? `position: absolute; top: ${position.top}px; left: 0px; right: 0px;`
        : "",
    ].join(" ");
    const inert = brokenSymlink || deletedEntry;
    return view.fileRow({
      path: f.path,
      type: f.type || "blob",
      className: cls,
      title:
        f.type === "commit" ? commitEntryBadge(f.submodule).title : undefined,
      disabled,
      style,
      onOpen: fileRowOpen(f, onFileClick, inert),
      onHover:
        !onFileClick && !brokenSymlink ? () => prefetchByPath(f.path) : null,
      badge: statusBadge(f.status),
      icon: sidebarEntryIcon(f),
      link: rowLink(
        "name",
        () =>
          inert ? null : sidebarItemHref(f, onFileClick ? "repo" : "diff"),
        filePathDisplayText(f.path.split("/").pop()),
        filePathDisplayText(f.path),
      ),
      symlink: symlinkTarget(f),
      kindTag: fileKindTag(f),
    });
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

  // 絞り込み欄の title は使い方の説明 (app.ts が言語ごとに付ける)。正規表現の
  // 誤りの間だけ理由に差し替え、直ったら説明に戻す。誤りの間に説明が付き直した
  // (言語の切替) なら、戻すのはその新しい説明。
  function showFilterValidity(
    input: HTMLInputElement,
    filter: CompiledFileFilter,
  ): boolean {
    const invalid = filter.kind === "invalid";
    input.toggleAttribute("aria-invalid", invalid);
    const shown = input.dataset.filterError;
    if (invalid) {
      const error =
        filter.error || DIFF_SCREEN_TEXT[pageLanguage()].invalidRegex;
      if (input.title !== shown) input.dataset.filterHelp = input.title;
      input.title = error;
      input.dataset.filterError = error;
    } else if (shown !== undefined) {
      if (input.title === shown) input.title = input.dataset.filterHelp ?? "";
      delete input.dataset.filterError;
      delete input.dataset.filterHelp;
    }
    return invalid;
  }

  function computeVirtualSidebarVisibleRows() {
    if (!SIDEBAR_TREE_ROOT) {
      SIDEBAR_VISIBLE_ROWS = [];
      return;
    }
    const input = $<HTMLInputElement>(DOM.filter);
    const filter = compileFileFilter(input.value);
    const invalid = showFilterValidity(input, filter);
    const filterActive = filter.kind !== "empty" && !invalid;
    const matches = invalid ? () => true : filter.match;
    let totalFiles = 0;
    let visibleFiles = 0;
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
          if (!testHidden) totalFiles++;
          if (visible) {
            visibleFiles++;
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
    syncSidebarFilterCount(filterActive, visibleFiles, totalFiles);
  }

  // The totals (#totals / #file-list-totals) normally show the sidebar summary ("12 files"). While a
  // filter is active it shows "matching / all" instead, and the original text
  // comes back when the filter clears. Only the text this function wrote is
  // replaced, so a later writer (e.g. "Cannot load tree") is never clobbered.
  let SIDEBAR_TOTALS_BASE = "";
  let SIDEBAR_TOTALS_FILTER_TEXT = "";
  function setSidebarTotals(text: string) {
    SIDEBAR_TOTALS_BASE = text;
    const el = $(DOM.totals);
    if (el.textContent === SIDEBAR_TOTALS_FILTER_TEXT) el.textContent = text;
    if (!SIDEBAR_TOTALS_FILTER_TEXT) {
      el.textContent = text;
      // 木の読み込みに失敗したとき repo-view が title に入れた理由を、
      // 次に一覧を描けた時点で外す (絞り込み中の title は別の持ち主)。
      el.removeAttribute("title");
    }
  }
  function syncSidebarFilterCount(
    active: boolean,
    visible: number,
    total: number,
  ) {
    const el = document.querySelector<HTMLElement>(DOM.totals);
    if (!el) return;
    if (!active) {
      if (SIDEBAR_TOTALS_FILTER_TEXT) {
        if (el.textContent === SIDEBAR_TOTALS_FILTER_TEXT)
          el.textContent = SIDEBAR_TOTALS_BASE;
        el.removeAttribute("title");
        SIDEBAR_TOTALS_FILTER_TEXT = "";
      }
      return;
    }
    SIDEBAR_TOTALS_FILTER_TEXT = `${visible} / ${total}`;
    el.textContent = SIDEBAR_TOTALS_FILTER_TEXT;
    el.title = deps.filterCountTitle(visible, total);
  }

  function sidebarVirtualRange() {
    const sidebar = document.querySelector<HTMLElement>(DOM.root);
    const scrollTop = sidebar?.scrollTop || 0;
    const height = sidebar?.clientHeight || window.innerHeight;
    const rowHeight = virtualRowHeight();
    const start = Math.max(
      0,
      Math.floor(scrollTop / rowHeight) - VIRTUAL_SIDEBAR_OVERSCAN,
    );
    const end = Math.min(
      SIDEBAR_VISIBLE_ROWS.length,
      Math.ceil((scrollTop + height) / rowHeight) + VIRTUAL_SIDEBAR_OVERSCAN,
    );
    return { start, end };
  }

  function renderVirtualSidebarWindow() {
    const ul = $(DOM.list);
    if (!ul.classList.contains("tree-virtual")) return;
    const { start, end } = sidebarVirtualRange();
    const rowHeight = virtualRowHeight();
    const rows: TemplateResult[] = [];
    for (let i = start; i < end; i++) {
      const row = SIDEBAR_VISIBLE_ROWS[i];
      const active = row.path === SIDEBAR_VIRTUAL_ACTIVE_PATH;
      const top = i * rowHeight;
      if (row.kind === "dir" && row.dir)
        rows.push(
          dirRowTemplate(row.dir, row.depth, SIDEBAR_ON_FILE_CLICK, {
            collapsed: dirEffectiveCollapsed(row.dir).effectiveCollapsed,
            virtual: true,
            toggleDir: virtualToggleDir(row.dir),
            active,
            top,
          }),
        );
      else if (row.file)
        rows.push(
          fileRowTemplate(row.file, row.depth, SIDEBAR_ON_FILE_CLICK, {
            active,
            top,
          }),
        );
    }
    const focused = focusedTreeRow(ul);
    // 窓の行は描くたびに作り直す (行の要素を使い回さない。位置・開閉の印を
    // 前の窓から持ち越さない)。
    WINDOW_SEQ += 1;
    renderOwned(ul, keyed(WINDOW_SEQ, rows));
    ul.style.height = `${SIDEBAR_VISIBLE_ROWS.length * rowHeight}px`;
    syncTreeTabStop(ul, focused);
  }

  /** 仮想表示の窓を描いた回数 (描くたびに行を作り直すための鍵)。 */
  let WINDOW_SEQ = 0;

  // Files の木は Tab の止まり場所を 1 つだけ持つ (roving tabindex): 選んでいる
  // 行、描いていなければ描いている先頭の行が tabIndex 0。行は選び直し・スクロール
  // のたびに作り直すので、木の行 (か、その中のボタン) にフォーカスがあったら戻す:
  // 選び直した (j k でも ↑↓ でも) なら選んだ行へ、そうでなければ同じ行の同じ
  // 部品へ。どちらも描いていなければ #sidebar (キーの範囲はそのまま)。差分の
  // 一覧は対象にしない。
  const TREE_ROW_SELECTOR = ":scope > li[data-path], :scope > li[data-dirpath]";

  type FocusedTreeRow = { path: string; onAction: boolean };

  function treeRowPath(row: HTMLElement): string {
    return row.dataset.path ?? row.dataset.dirpath ?? "";
  }

  function focusedTreeRow(ul: HTMLElement): FocusedTreeRow | null {
    const focused = document.activeElement;
    const row = focused?.closest<HTMLElement>("li");
    if (
      row?.parentElement !== ul ||
      !row.matches("li[data-path], li[data-dirpath]")
    )
      return null;
    return { path: treeRowPath(row), onAction: focused !== row };
  }

  function syncTreeTabStop(ul: HTMLElement, focused: FocusedTreeRow | null) {
    if (!SIDEBAR_ON_FILE_CLICK) return;
    const rows = [...ul.querySelectorAll<HTMLElement>(TREE_ROW_SELECTOR)];
    const active = rows.find((row) => row.classList.contains("active"));
    const stop = active ?? rows[0];
    // 行の中のボタン (フォルダを OS で開く) は止まり場所の行の分だけ Tab に入れる。
    const actionOf = (row: HTMLElement | undefined) =>
      row?.querySelector<HTMLElement>("[data-row-action]") ?? null;
    if (stop) stop.tabIndex = 0;
    const stopAction = actionOf(stop);
    if (stopAction) stopAction.tabIndex = 0;
    if (!focused) return;
    const same = rows.find((row) => treeRowPath(row) === focused.path);
    const moved = active && treeRowPath(active) !== focused.path;
    const target = moved ? active : (same ?? active);
    const restored =
      !moved && focused.onAction && target === stop ? actionOf(target) : null;
    (
      restored ??
      target ??
      document.querySelector<HTMLElement>(DOM.root)
    )?.focus({ preventScroll: true });
  }

  // 木の行の上の矢印キー。↑↓ と Home / End は j k と gg / G と同じ動き、→ は
  // 開くだけ (l は開閉の切り替え)、← は畳むか親へ (h と同じ)。Enter はページの
  // キー割り当て (open-sidebar-item) が開く。
  const TREE_ROW_KEYS: Record<string, () => void> = {
    ArrowDown: () => moveActiveSidebarItem(1),
    ArrowUp: () => moveActiveSidebarItem(-1),
    ArrowRight: () => setActiveSidebarDirectoryCollapsed(false),
    ArrowLeft: () => setActiveSidebarDirectoryCollapsed(true),
    Home: () => moveActiveSidebarToEdge("top"),
    End: () => moveActiveSidebarToEdge("bottom"),
  };

  function onTreeRowKeydown(event: KeyboardEvent) {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey)
      return;
    const row = event.target;
    const move = TREE_ROW_KEYS[event.key];
    if (!move || !SIDEBAR_ON_FILE_CLICK || !(row instanceof HTMLElement))
      return;
    if (!row.matches("li[data-path], li[data-dirpath]")) return;
    event.preventDefault();
    // Tab で入った先頭の行 (選んでいる行を描いていなかった) から動かす。
    if (!row.classList.contains("active")) markActive(treeRowPath(row));
    move();
  }

  function scrollVirtualSidebarPathIntoView(path: string) {
    const index = SIDEBAR_VISIBLE_ROWS.findIndex((row) => row.path === path);
    if (index < 0) return;
    const sidebar = document.querySelector<HTMLElement>(DOM.root);
    if (!sidebar) return;
    const ul = $(DOM.list);
    const rowHeight = virtualRowHeight();
    const top = index * rowHeight;
    const bottom = top + rowHeight;
    const sidebarRect = sidebar.getBoundingClientRect();
    const stickyBottom = Math.max(
      sidebarRect.top,
      document.querySelector<HTMLElement>(DOM.head)?.getBoundingClientRect()
        .bottom || sidebarRect.top,
      document
        .querySelector<HTMLElement>(DOM.filterWrap)
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
    const ul = document.querySelector<HTMLElement>(DOM.list);
    if (!ul?.classList.contains("tree-virtual")) return;
    computeVirtualSidebarVisibleRows();
    renderVirtualSidebarWindow();
  }

  function renderVirtualTreeSidebar(root: TreeNode) {
    const ul = $(DOM.list);
    SIDEBAR_TREE_ROOT = root;
    buildSidebarTreeRows(root);
    ul.classList.add("tree-virtual");
    ul.style.position = "relative";
    ul.addEventListener("keydown", onTreeRowKeydown);
    computeVirtualSidebarVisibleRows();
    renderVirtualSidebarWindow();
    document
      .querySelector<HTMLElement>(DOM.root)
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

  function sidebarItemsSignature(items: SidebarItem[]): string {
    return items
      .map((f) =>
        [
          f.path,
          f.type || "blob",
          f.status || "",
          f.children_omitted ? 1 : 0,
          f.children_omitted_reason || "",
          f.is_symlink ? 1 : 0,
          f.symlink_target || "",
          f.resolved_path || "",
          f.submodule ? 1 : 0,
        ].join("\0"),
      )
      .join("\n");
  }

  function findSidebarTreeDir(node: TreeNode, path: string): TreeNode | null {
    if (node.path === path) return node;
    for (const child of Object.values(node.dirs)) {
      if (path === child.path || path.startsWith(`${child.path}/`))
        return findSidebarTreeDir(child, path);
    }
    return null;
  }

  // 旧サブツリーでロード済みだった lazy dir の子を、新サブツリーの同じ path の
  // dir へ移植する。移植できない dir (新側に無い / omitted に転じた) はロード済み
  // 集合から外し、次に必要になったとき通常の lazy load で取り直す。親を先に
  // 移植しないと子の path が新側で見つからないため、浅い path から処理する。
  function graftLoadedSidebarDirs(oldRoot: TreeNode, newRoot: TreeNode) {
    const scope = newRoot.path ? `${newRoot.path}/` : "";
    const paths = [...SIDEBAR_LAZY_LOADED_DIRS]
      .filter((p) => p !== newRoot.path && (!scope || p.startsWith(scope)))
      .sort((a, b) => a.length - b.length);
    for (const path of paths) {
      const oldNode = findSidebarTreeDir(oldRoot, path);
      const newNode = findSidebarTreeDir(newRoot, path);
      if (!oldNode || !newNode || newNode.children_omitted) {
        SIDEBAR_LAZY_LOADED_DIRS.delete(path);
        SIDEBAR_LAZY_DIR_SIGNATURES.delete(path);
        continue;
      }
      if (sidebarTreeNodeHasChildren(newNode)) continue;
      newNode.dirs = oldNode.dirs;
      newNode.files = oldNode.files;
    }
  }

  // ロード済み lazy dir の子をサーバーの最新 entries で作り直す。子孫の
  // ロード済み dir の中身は移植して残す。前回と同じ内容なら何もしない。
  function applySidebarDirEntries(
    dir: TreeNode,
    entries: SidebarItem[],
  ): boolean {
    const signature = sidebarItemsSignature(entries);
    if (SIDEBAR_LAZY_DIR_SIGNATURES.get(dir.path) === signature) return false;
    SIDEBAR_LAZY_DIR_SIGNATURES.set(dir.path, signature);
    const oldSubtree: TreeNode = { ...dir };
    dir.dirs = {};
    dir.files = [];
    for (const entry of entries)
      upsertSidebarTreeEntry(entry, entry.order ?? 0);
    graftLoadedSidebarDirs(oldSubtree, dir);
    return true;
  }

  function rebuildVirtualSidebarRows() {
    if (!SIDEBAR_TREE_ROOT) return;
    SIDEBAR_TREE_ITEMS_CACHE = new WeakMap<TreeNode, TreeNodeItem[]>();
    buildSidebarTreeRows(SIDEBAR_TREE_ROOT);
    rerenderVirtualSidebar();
    // active ハイライトのみ再適用する。reveal なしなのでスクロールは動かない。
    const active = activePath();
    if (active) markActive(active);
    applyFilter();
  }

  // SSE 更新時に repo サイドバーをサーバーの最新ツリーへ合わせる。
  // renderSidebar() の全消去・再構築と違い、DOM・スクロール位置・展開状態を
  // 温存し、内容が変わったときだけ仮想窓 (絶対配置の可視行) を描き直す。
  async function refreshRepoSidebarTree(rootFiles: SidebarItem[]) {
    if (!isRepositorySidebarMode() || !isVirtualSidebarActive()) return;
    if (!SIDEBAR_TREE_ROOT) return;
    if (
      sidebarItemsSignature(rootFiles) !== sidebarItemsSignature(SIDEBAR_FILES)
    ) {
      const newRoot = buildTree(rootFiles);
      graftLoadedSidebarDirs(SIDEBAR_TREE_ROOT, newRoot);
      SIDEBAR_FILES = rootFiles;
      SIDEBAR_TREE_ROOT = newRoot;
      rebuildVirtualSidebarRows();
    }
    // ロード済み lazy dir の中身も取り直し、全件そろってから一度だけ反映する。
    const root = SIDEBAR_TREE_ROOT;
    const refreshed = await Promise.all(
      [...SIDEBAR_LAZY_LOADED_DIRS].map(async (path) => {
        const node = findSidebarTreeDir(root, path);
        if (!node) return null;
        // 取り直せなかったフォルダは前の中身のまま残す。理由は console に残す。
        const entries = await fetchSidebarDirEntries(node).catch((error) => {
          console.error(
            errorWithCause(
              `refreshing the sidebar folder ${path} failed; keeping the entries shown`,
              error,
            ),
          );
          return null;
        });
        return entries ? { path, entries } : null;
      }),
    );
    if (SIDEBAR_TREE_ROOT !== root) return; // ref 切替などで作り直された
    let childrenChanged = false;
    for (const result of refreshed) {
      if (!result) continue;
      const node = findSidebarTreeDir(root, result.path);
      if (node && applySidebarDirEntries(node, result.entries))
        childrenChanged = true;
    }
    if (childrenChanged) rebuildVirtualSidebarRows();
  }

  function flatTemplate(
    files: SidebarItem[],
    onFileClick?: (file: SidebarItem) => void,
  ): TemplateResult[] {
    return files.map((f, i) =>
      view.flatRow({
        index: i,
        path: f.path,
        type: f.type || "blob",
        className:
          !onFileClick && STATE.viewedFiles.has(f.path) ? "viewed" : "",
        title:
          f.type === "commit" ? commitEntryBadge(f.submodule).title : undefined,
        onOpen: fileRowOpen(f, onFileClick, false),
        onHover: !onFileClick ? () => prefetchByPath(f.path) : null,
        badge: statusBadge(f.status),
        icon: sidebarEntryIcon(f),
        link: rowLink(
          "name",
          () => sidebarItemHref(f, onFileClick ? "repo" : "diff"),
          filePathDisplayText(f.path),
          filePathDisplayText(f.path),
        ),
        kindTag: fileKindTag(f),
      }),
    );
  }

  /**
   * ファイルの行の押し方 (ui-surface.md の「タブの決まり」)。1 回押すは今までの
   * 開き方 (木は仮のタブ、差分の一覧はその差分へ送る)、固定の押し方と Alt は
   * deps.openFileAs。Shift と右ボタンはブラウザに任せる (行はリンク)。
   * inert (壊れたリンク・消したファイル) は何も開かない。
   */
  function fileRowOpen(
    f: SidebarItem,
    onFileClick: ((file: SidebarItem) => void) | undefined,
    inert: boolean,
  ): (e: MouseEvent) => void {
    return (e: MouseEvent) => {
      const intent = linkOpenIntent(e);
      if (intent === null) return;
      e.preventDefault();
      if (inert) return;
      if (intent !== "preview") {
        deps.openFileAs(f, intent, onFileClick ? "repo" : "diff");
      } else if (onFileClick) {
        onFileClick(f);
      } else {
        openDiffFile(f.path);
      }
      scheduleMainSurfaceFocus();
    };
  }

  /** 仮想表示でない一覧 (差分の一覧の木と平らな一覧) の行を描く。 */
  let LIST_SEQ = 0;
  let LIST_TEMPLATE: (() => unknown) | null = null;

  /**
   * いまの一覧 (差分の一覧) を状態から描き直し、選んでいる行・絞り込み・Tab の
   * 止まり場所を当て直す (畳む・開くのあと)。
   */
  /** 一覧の行だけを状態から描き直す (印は当て直さない)。 */
  function renderTreeListRows(): boolean {
    const ul = $(DOM.list);
    if (!LIST_TEMPLATE || ul.classList.contains("tree-virtual")) return false;
    renderOwned(ul, keyed(LIST_SEQ, LIST_TEMPLATE()));
    return true;
  }

  function renderTreeList() {
    const ul = $(DOM.list);
    const focused = focusedListRow(ul, DIFF_LIST_ROW_SELECTOR, sidebarItemPath);
    if (!renderTreeListRows()) return;
    const active = activePath();
    if (active) markActive(active);
    applyFilter();
    syncDiffListRoles(
      ul,
      !!SIDEBAR_ON_FILE_CLICK,
      ul.classList.contains("tree"),
    );
    syncDiffListTabStop(focused);
  }

  function renderSidebar(
    files: SidebarItem[],
    onFileClick?: (file: SidebarItem) => void,
  ) {
    const ul = $(DOM.list);
    const repoSidebar = !!onFileClick;
    if (!repoSidebar && deps.repository) {
      const repoTarget =
        document.querySelector<HTMLElement>("#repo-target-wrap");
      if (repoTarget) {
        repoTarget.hidden = true;
        repoTarget.style.display = "none";
      }
    }
    const treeMode = STATE.sbView === "tree" || repoSidebar;
    // 作り直す前に、差分の一覧の行にあったフォーカスを控える。
    const focused = focusedListRow(ul, DIFF_LIST_ROW_SELECTOR, sidebarItemPath);
    // 前の一覧は捨てて作り直す (行の要素を使い回さない)。
    LIST_SEQ += 1;
    LIST_TEMPLATE = null;
    renderOwned(ul, nothing);
    // 差分の一覧を描いた印 (diff-view の shouldRenderDiffSidebar が読む)。
    ul.toggleAttribute("data-diff-list", !repoSidebar);
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
    SIDEBAR_LAZY_DIR_SIGNATURES.clear();
    // Repo-mode sidebars (custom onFileClick) list the whole repository;
    // writing that into STATE.files would make every file look like part of
    // the current diff. Only the diff sidebar owns STATE.files.
    if (!onFileClick && !deps.repository) STATE.files = files as FileMeta[];
    SIDEBAR_FILES = files;
    SIDEBAR_ON_FILE_CLICK = onFileClick;
    if (!onFileClick && deps.repository) setRepoSidebarRef(null);
    if (treeMode) {
      const root = buildTree(files);
      if (repoSidebar || files.length >= VIRTUAL_SIDEBAR_THRESHOLD)
        renderVirtualTreeSidebar(root);
      else {
        LIST_TEMPLATE = () => treeTemplate(root, 0, onFileClick);
        renderOwned(ul, keyed(LIST_SEQ, LIST_TEMPLATE()));
      }
    } else {
      LIST_TEMPLATE = () => flatTemplate(files, onFileClick);
      renderOwned(ul, keyed(LIST_SEQ, LIST_TEMPLATE()));
    }
    setSidebarTotals(
      !repoSidebar && files.length ? deps.fileCountText(files.length) : "",
    );
    // Update view-toggle visual
    const effectiveView = treeMode ? "tree" : STATE.sbView;
    $$(`${DOM.root} .sb-view-seg button`).forEach((b) => {
      b.classList.toggle("active", b.dataset.view === effectiveView);
    });
    $$(`${DOM.root} .sb-tree-action`).forEach((b) => {
      (b as HTMLButtonElement).disabled = !treeMode || !files.length;
    });
    // Re-apply active highlight if any
    const active = activePath();
    if (active) markActive(active);
    applyFilter();
    syncDiffListRoles(ul, repoSidebar, treeMode);
    syncDiffListTabStop(focused);
  }

  // 差分の一覧 (Diff の変更ファイル・History の変更ファイルの一覧。仮想表示で
  // ない木と平らな一覧) も Tab の止まり場所を 1 つにする (views/list-tab-stop.ts。
  // Files の木は仮想表示で syncTreeTabStop)。行は作り直さず印だけ変わるので、
  // 選び直し・絞り込み・開閉のたびに付け直す。
  const DIFF_LIST_ROW_SELECTOR = "li[data-path], li[data-dirpath]";

  function syncDiffListTabStop(focused?: FocusedListRow | null) {
    const ul = document.querySelector<HTMLElement>(DOM.list);
    if (
      !ul?.hasAttribute("data-diff-list") ||
      ul.classList.contains("tree-virtual")
    )
      return;
    const rows = $$<HTMLElement>(SIDEBAR_ITEM_SELECTOR);
    for (const row of rows)
      if (row.dataset.dirpath !== undefined)
        row.setAttribute(
          "aria-expanded",
          String(!row.classList.contains("collapsed")),
        );
    syncListTabStop(ul, {
      rows,
      shown: rows.filter(isSidebarRowVisible),
      keyOf: sidebarItemPath,
      isActive: (row) => row.classList.contains("active"),
      actionSelector: "[data-row-action]",
      ariaSelected: true,
      ...(focused === undefined ? {} : { focused }),
      fallback: document.querySelector<HTMLElement>(DOM.root),
    });
  }

  /**
   * 差分の一覧の role と名前。木なら tree (フォルダの子は group)、平らなら
   * listbox。Files の木 (仮想表示) には付けない (付いていたら外す)。
   */
  function syncDiffListRoles(
    ul: HTMLElement,
    repoSidebar: boolean,
    treeMode: boolean,
  ) {
    if (repoSidebar) {
      ul.removeAttribute("role");
      ul.removeAttribute("aria-label");
      return;
    }
    ul.setAttribute("role", treeMode ? "tree" : "listbox");
    ul.setAttribute(
      "aria-label",
      DIFF_SCREEN_TEXT[pageLanguage()].fileListLabel,
    );
    for (const row of $$<HTMLElement>(SIDEBAR_ITEM_SELECTOR))
      row.setAttribute("role", treeMode ? "treeitem" : "option");
    for (const group of ul.querySelectorAll<HTMLElement>(".tree-children"))
      group.setAttribute("role", "group");
  }

  /** 見出しの全部開く / 全部畳むのボタンを、この一覧に付ける (一覧ごとに 1 組)。 */
  function bindTreeActions() {
    $(DOM.expandAll).addEventListener("click", () =>
      setAllSidebarDirsCollapsed(false),
    );
    $(DOM.collapseAll).addEventListener("click", () =>
      setAllSidebarDirsCollapsed(true),
    );
  }

  function setAllSidebarDirsCollapsed(collapsed: boolean) {
    const before = new Set(STATE.collapsedDirs);
    const beforeLazyExpanded = new Set(STATE.lazyExpandedDirs);
    if (!collapsed) STATE.collapsedDirs.clear();
    if ($(DOM.list).classList.contains("tree-virtual")) {
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
    $$<HTMLElement>(`${DOM.list} .tree-dir[data-dirpath]`).forEach((li) => {
      const path = li.dataset.dirpath || "";
      if (!path) return;
      if (collapsed) {
        if (!STATE.collapsedDirs.has(path)) added.push(path);
        STATE.collapsedDirs.add(path);
      }
    });
    persistCollapsedDirs({
      added,
      removed: collapsed ? [] : [...before],
    });
    renderTreeList();
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
    }
    if (collapsedChanged) persistCollapsedDirs({ removed: ancestors });
    if (lazyExpandedAdded.length > 0)
      persistLazyExpandedDirs({ added: lazyExpandedAdded });
    rerenderVirtualSidebar();
    // 仮想表示でない木は、開いた祖先を描き直す (選んでいる行の印は呼び手が付ける)。
    if (collapsedChanged) renderTreeListRows();
  }

  function markActive(path: string, options: { reveal?: boolean } = {}) {
    if (deps.repository) REPO_ACTIVE_PATH = path;
    else STATE.activeFile = path;
    SIDEBAR_VIRTUAL_ACTIVE_PATH = path;
    if (options.reveal && isSidebarTreeRendered()) expandSidebarAncestors(path);
    setActiveSidebarItem(sidebarItemByPath(path));
    if ($(DOM.list).classList.contains("tree-virtual")) {
      renderVirtualSidebarWindow();
      // Only navigation-driven activations may move the sidebar scroll.
      // Re-marking during a refresh/re-render must not yank the position
      // the user scrolled to (callers that need follow-scroll pass reveal
      // or call scrollVirtualSidebarPathIntoView themselves).
      if (options.reveal) scrollVirtualSidebarPathIntoView(path);
      return;
    }
    if (options.reveal) {
      const active = activeSidebarItem();
      if (active)
        requestAnimationFrame(() => scrollSidebarItemIntoView(active));
    }
    syncDiffListTabStop();
  }

  function applyFilter() {
    const input = $<HTMLInputElement>(DOM.filter);
    syncSidebarFilterClearButton();
    if ($(DOM.list).classList.contains("tree-virtual")) {
      rerenderVirtualSidebar();
      return;
    }
    const filter = compileFileFilter(input.value);
    const invalid = showFilterValidity(input, filter);
    const matches = invalid ? () => true : filter.match;
    const filterActive = filter.kind !== "empty" && !invalid;
    let totalFiles = 0;
    let visibleFiles = 0;
    $$(`${DOM.list} li[data-path]`).forEach((li) => {
      const match = matches(li.dataset.path || "");
      li.classList.toggle("hidden", !match);
      if (li.classList.contains("hidden-by-tests")) return;
      totalFiles++;
      if (match) visibleFiles++;
    });
    syncSidebarFilterCount(filterActive, visibleFiles, totalFiles);
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
    syncDiffListTabStop();
  }

  function updateTreeDirVisibility(
    dirMatches?: (path: string) => boolean,
    filterActive = false,
  ) {
    const dirs = $$<HTMLElement>(`${DOM.list} .tree-dir`);
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

  function syncSidebarFilterClearButton() {
    const input = document.querySelector<HTMLInputElement>(DOM.filter);
    const button = document.querySelector<HTMLButtonElement>(DOM.filterClear);
    if (!input || !button) return;
    button.hidden = input.value.length === 0;
  }

  function clearSidebarFilter() {
    const input = document.querySelector<HTMLInputElement>(DOM.filter);
    if (!input?.value) return;
    input.value = "";
    // Repository 以外の画面も同じ入力の input event を購読している。
    input.dispatchEvent(new Event("input", { bubbles: true }));
    syncSidebarFilterClearButton();
    flushSidebarFilter();
    applyFilter();
    input.focus();
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
    const list = document.querySelector(DOM.list);
    while (parent && parent !== list) {
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

  const SIDEBAR_ITEM_SELECTOR = `${DOM.list} li[data-path], ${DOM.list} .tree-dir[data-dirpath]`;

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
          `${DOM.list} li[data-path="${CSS.escape(path)}"], ${DOM.list} .tree-dir[data-dirpath="${CSS.escape(path)}"]`,
        ) || null
      );
    }
    const escaped = CSS.escape(path);
    return document.querySelector<HTMLElement>(
      `${DOM.list} li[data-path="${escaped}"], ${DOM.list} .tree-dir[data-dirpath="${escaped}"]`,
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
    return $(DOM.list).classList.contains("tree-virtual");
  }

  function virtualSidebarActiveIndex() {
    const active = SIDEBAR_VIRTUAL_ACTIVE_PATH || activePath() || "";
    return SIDEBAR_VISIBLE_ROWS.findIndex((row) => row.path === active);
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
    const root = document.querySelector<HTMLElement>(DOM.list);
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
    const sidebar = document.querySelector<HTMLElement>(DOM.root);
    if (!sidebar) {
      item.scrollIntoView({ block });
      return;
    }
    const sidebarRect = sidebar.getBoundingClientRect();
    const itemRect = item.getBoundingClientRect();
    const stickyBottom = Math.max(
      sidebarRect.top,
      document.querySelector<HTMLElement>(DOM.head)?.getBoundingClientRect()
        .bottom || sidebarRect.top,
      document
        .querySelector<HTMLElement>(DOM.filterWrap)
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
    return deps.repository;
  }

  function isSidebarTreeRendered() {
    return $(DOM.list).classList.contains("tree");
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
      const sidebar = document.querySelector<HTMLElement>(DOM.root);
      const halfPageRows = Math.max(
        1,
        Math.floor(
          (sidebar?.clientHeight || window.innerHeight) /
            2 /
            virtualRowHeight(),
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
    const sidebar = document.querySelector<HTMLElement>(DOM.root);
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

  function moveVirtualSidebarToParent(activeIndex: number) {
    const active = SIDEBAR_VISIBLE_ROWS[activeIndex];
    if (!active) return;
    for (let index = activeIndex - 1; index >= 0; index -= 1) {
      const candidate = SIDEBAR_VISIBLE_ROWS[index];
      if (candidate && candidate.depth < active.depth) {
        selectVirtualSidebarIndex(index);
        return;
      }
    }
  }

  function moveDomSidebarToParent() {
    const active = activeSidebarItem();
    const children = active?.parentElement;
    if (!children?.classList.contains("tree-children")) return;
    const parent = children.previousElementSibling;
    if (!(parent instanceof HTMLElement)) return;
    if (!parent.matches(".tree-dir[data-dirpath]")) return;
    const path = parent.dataset.dirpath;
    if (!path) return;
    markActive(path);
    scrollSidebarItemIntoView(parent);
  }

  function setActiveSidebarDirectoryCollapsed(collapsed: boolean) {
    if (isVirtualSidebarActive()) {
      const activeIndex = virtualSidebarActiveIndex();
      const row = SIDEBAR_VISIBLE_ROWS[activeIndex];
      if (!row) return;
      if (row.kind !== "dir" || !row.dir || row.dir.children_omitted) {
        if (collapsed) moveVirtualSidebarToParent(activeIndex);
        return;
      }
      const snap = dirEffectiveCollapsed(row.dir);
      if (snap.effectiveCollapsed === collapsed) {
        if (collapsed) moveVirtualSidebarToParent(activeIndex);
        return;
      }
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
      `${DOM.list} .tree-dir.active[data-dirpath]`,
    );
    if (!active) {
      if (collapsed) moveDomSidebarToParent();
      return;
    }
    if (active.classList.contains("collapsed") === collapsed) {
      if (collapsed) moveDomSidebarToParent();
      return;
    }
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
      `${DOM.list} .tree-dir.active[data-dirpath]`,
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
      `${DOM.list} li.active[data-path], ${DOM.list} .tree-dir.active[data-dirpath]`,
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

  const ACTIVE_SIDEBAR_ITEM_SELECTOR = `${DOM.list} li.active[data-path], ${DOM.list} .tree-dir.active[data-dirpath]`;
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
    refreshRepoSidebarTree,
    applyFilter,
    scheduleApplyFilter,
    flushSidebarFilter,
    syncSidebarFilterClearButton,
    clearSidebarFilter,
    markActive,
    rerenderVirtualSidebar,
    ensureVirtualSidebarDirLoaded,
    scrollVirtualSidebarPathIntoView,
    shouldLazyLoadSidebarDir,
    setFolderIcon,
    isRepositorySidebarMode,
    placeSidebarToggle,
    ensureSidebarToggleButton,
    applySidebarHidden,
    toggleSidebarHidden,
    applySidebarWidth,
    applySidebarFontSize,
    savedSidebarFontSize,
    syncSidebarHeaderHeight,
    observeSidebarHeaderHeight,
    setSidebarTreeActionIcons,
    setAllSidebarDirsCollapsed,
    bindTreeActions,
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
