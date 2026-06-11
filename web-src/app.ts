import { type AnnotationsUi, createAnnotationsUi } from "./annotations-ui";
import { createCatchUpGate, shouldCatchUpDiff } from "./catch-up";
import { GdpExpandLogic } from "./expand-logic";
import { compileFileFilter } from "./file-filter";
import { nextVisibleFileIndex } from "./file-navigation";
import { filePathClipboardText } from "./file-path-copy";
import {
  findMainScrollTarget,
  focusMainPanel,
  focusSidebarPanel,
  getPanelFocusScope,
  isEditableKeyTarget,
  keymapScope,
  type PanelFocusScope,
  prepareKeyboardPanels,
  restorePanelFocusScope,
  setPanelFocusScope,
} from "./focus-scope";
import {
  type FuzzyRange,
  fuzzyMatchPath,
  globMatchPath,
  isGlobPathQuery,
  rankPathMatches,
} from "./fuzzy-search";
import {
  createHelpPage,
  helpLanguageFromRoute,
  helpSectionFromRoute,
} from "./help-page";
import { createHunkExpand, type ExpandStackElement } from "./hunk-expand";
import {
  CHEVRON_DOWN_12_PATH,
  CHEVRON_DOWN_16_PATH,
  COLLAPSE_ALL_16_PATHS,
  COPY_16_PATHS,
  EXPAND_ALL_16_PATHS,
  FOLDER_ICON_PATHS,
  GEAR_16_PATH,
  GIT_BRANCH_16_PATH,
  iconSvg,
  OPEN_EXTERNAL_16_PATH,
  SIDEBAR_HIDE_16_PATHS,
  SIDEBAR_SHOW_16_PATHS,
  TRIANGLE_DOWN_16_PATH,
} from "./icons";
import {
  type KeymapAction,
  type KeymapScope,
  resolveKeymapAction,
} from "./keymap";
import { enhanceMediaCard } from "./media-embed";
import { createRefPicker } from "./ref-picker";
import { createRepoView } from "./repo-view";
import {
  type AppRoute,
  buildRoute,
  type DiffRange,
  parseRoute,
  type SourceLineTarget,
} from "./routes";
import { limitPaletteResults, movePaletteSelection } from "./search-palette";
import {
  createSourceView,
  type VirtualSourcePagingKeyboardEvent,
} from "./source-view";
import type {
  DiffCardElement,
  DiffMeta,
  FileDiffResponse,
  FileMeta,
  FileSearchListResponse,
  GrepResponse,
  HljsApi,
  RepoTreeEntry,
  RepoTreeResponse,
  SettingsResponse,
  SidebarItem,
  UndoActionResponse,
} from "./types";
import { suppressWhitespaceOnlyInlineHighlights } from "./ws-highlight";

window.GdpExpandLogic = GdpExpandLogic;

(() => {
  type LayoutMode = "side-by-side" | "line-by-line";
  type SidebarView = "tree" | "flat";
  type ViewerFontSize = "compact" | "regular" | "large" | "xlarge";
  type ThemeMode = "light" | "dark";
  type LoadQueueItem = {
    file: FileMeta;
    card: DiffCardElement;
    priority: number;
  };
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
  type AppState = {
    layout: LayoutMode;
    theme: ThemeMode;
    sbView: SidebarView;
    sbWidth: number;
    sidebarHidden: boolean;
    collapsedDirs: Set<string>;
    ignoreWs: boolean;
    from: string;
    to: string;
    collapsed: boolean;
    files: FileMeta[];
    activeFile: string | null;
    hideTests: boolean;
    syntaxHighlight: boolean;
    viewedFiles: Set<string>;
    route: AppRoute;
    repoRef: string;
  };
  type ScrollSpyHandler = EventListener & { _raf?: number | null };

  const $ = <T extends Element = HTMLElement>(sel: string): T =>
    document.querySelector(sel) as T;
  const $$ = <T extends Element = HTMLElement>(sel: string): T[] =>
    Array.from(document.querySelectorAll(sel)) as T[];
  const diffCardSelector = (path: string) =>
    '.gdp-file-shell[data-path="' +
    (window.CSS && CSS.escape ? CSS.escape(path) : path) +
    '"]';
  const HIGHLIGHT_SRC = "/vendor/highlight.js/highlight.min.js";
  const DEFAULT_RANGE: DiffRange = { from: "HEAD", to: "worktree" };
  // Keep in sync with .gdp-source-virtual-row height/line-height in web/style.css.
  const VIRTUAL_SIDEBAR_THRESHOLD = 3000;
  const VIRTUAL_SIDEBAR_ROW_HEIGHT = 29;
  const VIRTUAL_SIDEBAR_OVERSCAN = 16;
  const TEST_RE = /(^|[/_.])(test|spec|__tests__)([/_.]|$)/i;
  let highlightLoadPromise: Promise<HljsApi | null> | null = null;
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
  let SERVER_SCOPE_OMIT_DIRS_DEFAULT: string[] = [];
  let SERVER_SCOPE_EXCLUDE_NAMES_DEFAULT: string[] = [];
  const UNDO_STACK: UndoActionResponse[] = [];
  let PENDING_G_SCOPE: KeymapScope | null = null;
  let PENDING_G_UNTIL = 0;

  const SCOPE_OMIT_DIRS_STORAGE_KEY_PREFIX = "gdp:scope-omit-dirs:";
  const SCOPE_EXCLUDE_NAMES_STORAGE_KEY_PREFIX = "gdp:scope-exclude-names:";
  const SIDEBAR_FONT_SIZE_STORAGE_KEY = "gdp:sidebar-font-size";
  const CODE_FONT_SIZE_STORAGE_KEY = "gdp:code-font-size";
  const CLIENT_SCOPE_OMIT_DIRS_DEFAULT = [
    "node_modules",
    ".venv",
    "venv",
    ".next",
    ".nuxt",
    ".svelte-kit",
    ".astro",
    ".vercel",
    "dist",
    "build",
    "out",
    "target",
    ".gradle",
    "__pycache__",
    ".pytest_cache",
    ".tox",
    ".terraform",
    ".idea",
    ".vscode",
    "vendor",
    ".cache",
    "coverage",
    "DerivedData",
    "Pods",
    "bin",
    "obj",
  ];
  const CLIENT_SCOPE_EXCLUDE_NAMES_DEFAULT = [".DS_Store"];

  function scrollMainPanel(
    direction: 1 | -1,
    repeated = false,
    unit: "line" | "page" = "line",
  ) {
    if (moveSourceCursor(direction, unit)) return;
    const target = findMainScrollTarget();
    const viewportHeight =
      target?.clientHeight ||
      document.scrollingElement?.clientHeight ||
      window.innerHeight;
    const top =
      direction *
      (unit === "line"
        ? Math.round(sourceLineScrollAmount() || 32)
        : Math.round(viewportHeight * 0.55));
    const behavior: ScrollBehavior = repeated ? "auto" : "smooth";
    if (target) target.scrollBy({ top, behavior });
    else window.scrollBy({ top, behavior });
  }

  let MAIN_SURFACE_FOCUS_SEQ = 0;

  function focusMainSurface() {
    const target = findMainScrollTarget();
    if (target?.matches("#content .gdp-source-virtual-scroller")) {
      target.focus({ preventScroll: true });
      setPanelFocusScope("main");
      return;
    }
    focusMainPanel();
  }

  function scheduleMainSurfaceFocus() {
    const seq = ++MAIN_SURFACE_FOCUS_SEQ;
    const apply = () => {
      if (seq !== MAIN_SURFACE_FOCUS_SEQ || PALETTE) return;
      if (isEditableKeyTarget(document.activeElement)) return;
      focusMainSurface();
    };
    focusMainPanel();
    queueMicrotask(apply);
    requestAnimationFrame(apply);
    setTimeout(apply, 100);
    setTimeout(apply, 300);
  }

  function scrollMainToEdge(edge: "top" | "bottom") {
    if (moveSourceCursor(edge === "bottom" ? 1 : -1, "edge", edge)) return;
    const target = findMainScrollTarget();
    if (target) {
      target.scrollTo({
        top: edge === "top" ? 0 : target.scrollHeight,
        behavior: "auto",
      });
      return;
    }
    const top =
      edge === "top"
        ? 0
        : Math.max(
            document.documentElement.scrollHeight,
            document.body.scrollHeight,
          );
    window.scrollTo({ top, behavior: "auto" });
  }

  function isFocusableClickTarget(target: EventTarget | null): boolean {
    if (!(target instanceof Element)) return false;
    return !!target.closest(
      'a, button, input, textarea, select, summary, [tabindex]:not([tabindex="-1"]), [contenteditable="true"]',
    );
  }

  function normalizeScopeOmitDirs(value: string[] | string): string[] {
    const raw = Array.isArray(value) ? value : value.split(/[\n,]+/);
    return [
      ...new Set(
        raw
          .map((item) => item.trim())
          .filter(
            (item) =>
              item &&
              item.length <= 64 &&
              !item.includes("/") &&
              !item.includes("\\") &&
              item !== "." &&
              item !== ".." &&
              item !== ".git",
          ),
      ),
    ]
      .slice(0, 100)
      .sort((a, b) => a.localeCompare(b));
  }

  function normalizeScopeExcludeNames(value: string[] | string): string[] {
    const raw = Array.isArray(value) ? value : value.split(/[\n,]+/);
    return [
      ...new Set(
        raw
          .map((item) => item.trim())
          .filter(
            (item) =>
              item &&
              item.length <= 128 &&
              !item.includes("/") &&
              !item.includes("\\") &&
              item !== "." &&
              item !== ".." &&
              item !== ".git",
          ),
      ),
    ]
      .slice(0, 200)
      .sort((a, b) => a.localeCompare(b));
  }

  function scopeOmitDirsStorageKey(): string {
    return SCOPE_OMIT_DIRS_STORAGE_KEY_PREFIX + (PROJECT_NAME || "default");
  }

  function scopeExcludeNamesStorageKey(): string {
    return SCOPE_EXCLUDE_NAMES_STORAGE_KEY_PREFIX + (PROJECT_NAME || "default");
  }

  function setProjectName(project: string) {
    if (!project) return;
    PROJECT_NAME = project;
    document.title = `${project} - code viewer`;
    const projectTitle = document.querySelector<HTMLElement>("#project-title");
    if (projectTitle) {
      projectTitle.textContent = project;
      projectTitle.title = project;
    }
  }

  function savedScopeOmitDirs(): string[] | null {
    const raw = localStorage.getItem(scopeOmitDirsStorageKey());
    if (raw == null) return null;
    try {
      const parsed = JSON.parse(raw);
      return normalizeScopeOmitDirs(Array.isArray(parsed) ? parsed : []);
    } catch {
      return normalizeScopeOmitDirs(raw);
    }
  }

  function savedScopeExcludeNames(): string[] | null {
    const raw = localStorage.getItem(scopeExcludeNamesStorageKey());
    if (raw == null) return null;
    try {
      const parsed = JSON.parse(raw);
      return normalizeScopeExcludeNames(Array.isArray(parsed) ? parsed : []);
    } catch {
      return normalizeScopeExcludeNames(raw);
    }
  }

  function serverScopeOmitDirsDefault(): string[] {
    return SERVER_SCOPE_OMIT_DIRS_DEFAULT.length
      ? SERVER_SCOPE_OMIT_DIRS_DEFAULT
      : CLIENT_SCOPE_OMIT_DIRS_DEFAULT;
  }

  function serverScopeExcludeNamesDefault(): string[] {
    return SERVER_SCOPE_EXCLUDE_NAMES_DEFAULT.length
      ? SERVER_SCOPE_EXCLUDE_NAMES_DEFAULT
      : CLIENT_SCOPE_EXCLUDE_NAMES_DEFAULT;
  }

  function effectiveScopeOmitDirs(): string[] {
    return savedScopeOmitDirs() ?? serverScopeOmitDirsDefault();
  }

  function effectiveScopeExcludeNames(): string[] {
    return savedScopeExcludeNames() ?? serverScopeExcludeNamesDefault();
  }

  function appendScopeParams(params: URLSearchParams) {
    const omit = savedScopeOmitDirs();
    if (omit != null) params.set("omit_dirs", omit.join(","));
    const exclude = savedScopeExcludeNames();
    if (exclude != null) params.set("exclude_names", exclude.join(","));
  }

  function normalizeViewerFontSize(value: unknown): ViewerFontSize {
    return value === "compact" || value === "large" || value === "xlarge"
      ? value
      : "regular";
  }

  function savedSidebarFontSize(): ViewerFontSize {
    return normalizeViewerFontSize(
      localStorage.getItem(SIDEBAR_FONT_SIZE_STORAGE_KEY),
    );
  }

  function savedCodeFontSize(): ViewerFontSize {
    return normalizeViewerFontSize(
      localStorage.getItem(CODE_FONT_SIZE_STORAGE_KEY),
    );
  }

  function applySidebarFontSize(size: ViewerFontSize = savedSidebarFontSize()) {
    document.body.dataset.sidebarFontSize = size;
  }

  function applyCodeFontSize(size: ViewerFontSize = savedCodeFontSize()) {
    document.body.dataset.codeFontSize = size;
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

  function repoFileCacheKey(ref: string): string {
    const omit = savedScopeOmitDirs();
    const exclude = savedScopeExcludeNames();
    return `${ref}\0${omit ? omit.join("\0") : "server"}\0${exclude ? exclude.join("\0") : "server"}`;
  }

  async function loadSettings(): Promise<SettingsResponse | null> {
    try {
      const res = await fetch("/_settings");
      if (!res.ok) return null;
      const settings = (await res.json()) as SettingsResponse;
      setProjectName(settings.project || "");
      SERVER_SCOPE_OMIT_DIRS_DEFAULT = normalizeScopeOmitDirs(
        settings.scope.omit_dirs_effective,
      );
      SERVER_SCOPE_EXCLUDE_NAMES_DEFAULT = normalizeScopeExcludeNames(
        settings.scope.exclude_names_effective,
      );
      return settings;
    } catch {
      return null;
    }
  }

  const STATE: AppState = (() => {
    const igRaw = localStorage.getItem("gdp:ignore-ws");
    const fallbackRange = {
      from: localStorage.getItem("gdp:from") || DEFAULT_RANGE.from,
      to: localStorage.getItem("gdp:to") || DEFAULT_RANGE.to,
    };
    const parsedRoute = parseRoute(
      window.location.pathname,
      window.location.search,
      fallbackRange,
    );
    const route =
      parsedRoute.screen === "unknown"
        ? { screen: "diff" as const, range: parsedRoute.range }
        : parsedRoute;
    return {
      layout:
        (localStorage.getItem("gdp:layout") as LayoutMode) || "side-by-side",
      theme:
        (localStorage.getItem("gdp:theme") as ThemeMode) ||
        (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"),
      sbView: (localStorage.getItem("gdp:sbview") as SidebarView) || "tree",
      sbWidth: parseInt(localStorage.getItem("gdp:sbwidth") ?? "", 10) || 308,
      sidebarHidden: localStorage.getItem("gdp:sidebar-hidden") === "1",
      collapsedDirs: new Set<string>(
        JSON.parse(localStorage.getItem("gdp:collapsed-dirs") || "[]"),
      ),
      ignoreWs: igRaw === null ? true : igRaw === "1",
      from: route.range.from,
      to: route.range.to,
      collapsed: false,
      files: [],
      activeFile: null,
      hideTests: localStorage.getItem("gdp:hide-tests") === "1",
      syntaxHighlight: localStorage.getItem("gdp:syntax-highlight") !== "0",
      viewedFiles: new Set<string>(
        JSON.parse(localStorage.getItem("gdp:viewed-files") || "[]"),
      ),
      route,
      repoRef: route.screen === "repo" ? route.ref : "worktree",
    };
  })();

  // (declarations recovered during the source-view extraction)
  let highlightConfigured = false;
  let PROJECT_NAME = "";
  let REPO_SIDEBAR_REF: string | null = null;
  let SIDEBAR_FILES: SidebarItem[] = [];

  // ---------- Source view: extracted to source-view.ts ----------
  const SOURCE_VIEW = createSourceView({
    $$,
    $,
    STATE,
    setRoute,
    setPageMode,
    currentRange,
    trackLoad,
    isAbortError,
    loadRepo: () => REPO_VIEW.loadRepo(),
    repoRoute: (ref: string, path: string) => REPO_VIEW.repoRoute(ref, path),
    repoFileTargetFromRoute,
    renderRepoBlobSidebar: (path: string, ref: string) =>
      REPO_VIEW.renderRepoBlobSidebar(path, ref),
    placeSidebarToggle,
    createFileBreadcrumb,
    createFileDetailMeta: (target, meta) =>
      REPO_VIEW.createFileDetailMeta(target, meta),
    createOpenPathButton,
    createMoveToTrashButton: (path, onDeleted) =>
      REPO_VIEW.createMoveToTrashButton(path, onDeleted),
    canTrashWorktreeRef: (ref) => REPO_VIEW.canTrashWorktreeRef(ref),
    loadRawFileInfo: (target) => REPO_VIEW.loadRawFileInfo(target),
    loadSyntaxHighlighter,
    setViewFileButtonState,
    scrollMainPanel,
    focusMainSurface,
    isPaletteOpen: () => !!PALETTE,
  });
  const {
    renderStandaloneSource,
    applySourceRouteToShell,
    removeStandaloneSource,
    cancelActiveSourceLoad,
    sourceTargetFromRoute,
    fileSourceTarget,
    switchSourceTab,
    sourceLineScrollAmount,
    moveSourceCursor,
    handleVirtualSourcePagingKeydown,
    openVirtualSourceSearchFromKeyboard,
    lineTargetStart,
    inferLang,
  } = SOURCE_VIEW;

  // ---------- Repository view: extracted to repo-view.ts ----------
  const REPO_VIEW = createRepoView({
    $,
    STATE,
    setRoute,
    setPageMode,
    setStatus,
    setProjectName,
    currentRange,
    appendScopeParams,
    markActive,
    applyFilter,
    renderSidebar,
    rerenderVirtualSidebar,
    ensureVirtualSidebarDirLoaded: (dir) =>
      ensureVirtualSidebarDirLoaded(dir as TreeNode),
    scrollVirtualSidebarPathIntoView,
    shouldLazyLoadSidebarDir: (dir) =>
      shouldLazyLoadSidebarDir(dir as TreeNode),
    setFolderIcon,
    isRepositorySidebarMode,
    placeSidebarToggle,
    createOpenPathButton,
    removeStandaloneSource,
    renderStandaloneSource,
    repoFileTargetFromRoute,
    trackLoad,
    syncSidebarHeaderHeight,
    clearLoadQueue: () => {
      LOAD_QUEUE.length = 0;
    },
    getProjectName: () => PROJECT_NAME,
    getRepoSidebarRef: () => REPO_SIDEBAR_REF,
    setRepoSidebarRef: (ref: string | null) => {
      REPO_SIDEBAR_REF = ref;
    },
    syncHeaderMenu,
    getSidebarRowByPath: (path: string) => SIDEBAR_ROW_BY_PATH.get(path),
    getSidebarVirtualActivePath: () => SIDEBAR_VIRTUAL_ACTIVE_PATH,
    pushUndo: (undo: UndoActionResponse) => {
      UNDO_STACK.unshift(undo);
    },
  });
  const {
    loadRepo,
    repoRoute,
    renderRepoBlobSidebar,
    syncRepoTargetInput,
    closeRepoContextMenu,
    handleSidebarContextMenu,
    fileEntryIcon,
    invalidateRepoSidebar,
    showTrashError,
  } = REPO_VIEW;

  function setStatus(s: "live" | "refreshing" | "error" | null) {
    const el = $("#status");
    el.classList.remove("live", "refreshing", "error");
    if (s) el.classList.add(s);
  }

  function applyTheme() {
    document.documentElement.dataset.theme = STATE.theme;
    $<HTMLLinkElement>("#hljs-light").disabled = STATE.theme === "dark";
    $<HTMLLinkElement>("#hljs-dark").disabled = STATE.theme !== "dark";
  }

  function getHljs(): HljsApi | null {
    const hljsRef = (window.hljs || window.Diff2HtmlUI?.hljs) as
      | HljsApi
      | undefined;
    if (!hljsRef) return null;
    if (!highlightConfigured && typeof hljsRef.configure === "function") {
      hljsRef.configure({ ignoreUnescapedHTML: true });
      highlightConfigured = true;
    }
    return hljsRef;
  }

  function setHighlightButton(state: "idle" | "loading" | "loaded" | "error") {
    const btn = $("#syntax-highlight");
    if (!btn) return;
    btn.classList.toggle("active", STATE.syntaxHighlight);
    btn.classList.toggle("loading", state === "loading");
    btn.textContent =
      state === "loading"
        ? "loading..."
        : STATE.syntaxHighlight
          ? "syntax on"
          : "syntax off";
    btn.setAttribute("aria-pressed", STATE.syntaxHighlight ? "true" : "false");
    btn.title = STATE.syntaxHighlight
      ? "syntax highlighting on"
      : state === "loading"
        ? "loading syntax highlighter"
        : state === "error"
          ? "failed to load syntax highlighter"
          : "syntax highlighting off";
  }

  function loadSyntaxHighlighter(): Promise<HljsApi | null> {
    const existing = getHljs();
    if (existing) {
      setHighlightButton("loaded");
      return Promise.resolve(existing);
    }
    if (highlightLoadPromise) return highlightLoadPromise;

    setHighlightButton("loading");
    highlightLoadPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = HIGHLIGHT_SRC;
      script.async = true;
      script.onload = () => {
        const hljsRef = getHljs();
        if (hljsRef) {
          setHighlightButton("loaded");
          resolve(hljsRef);
        } else {
          setHighlightButton("error");
          reject(new Error("highlight.js did not expose window.hljs"));
        }
      };
      script.onerror = () => {
        setHighlightButton("error");
        reject(new Error("failed to load highlight.js"));
      };
      document.head.appendChild(script);
    }).catch(() => {
      highlightLoadPromise = null;
      return null;
    });
    return highlightLoadPromise;
  }

  function rerenderLoadedDiffs() {
    document
      .querySelectorAll<DiffCardElement>(".gdp-file-shell.loaded")
      .forEach((card) => {
        const data = card._diffData;
        const file = card._file;
        if (!data || !file) return;
        mountDiff(card, file, data);
        applyInlineAnnotations();
        if (data.truncated && data.mode === "preview") {
          addExpandHunksUI(file, data, card);
        }
        scheduleIdleHighlight(card, file);
      });
  }

  function setLayout(layout: LayoutMode) {
    STATE.layout = layout;
    localStorage.setItem("gdp:layout", layout);
    $$("#topbar .seg button").forEach((b) => {
      b.classList.toggle("active", b.dataset.layout === layout);
    });
    // Re-render diff2html in each loaded card with the new layout, but
    // respect per-file force_layout (large/huge are pinned to line-by-line).
    document
      .querySelectorAll<DiffCardElement>(".gdp-file-shell.loaded")
      .forEach((card) => {
        const data = card._diffData;
        const file = card._file;
        if (!data || !file) return;
        mountDiff(card, file, data);
        applyInlineAnnotations();
        if (data.truncated && data.mode === "preview") {
          addExpandHunksUI(file, data, card);
        }
        scheduleIdleHighlight(card, file);
      });
  }

  function fileBadge(status?: string) {
    const ch = (status || "M")[0].toUpperCase();
    const span = document.createElement("span");
    span.className = `badge ${ch}`;
    span.textContent = ch;
    span.title =
      { M: "modified", A: "added", D: "deleted", R: "renamed" }[ch] || ch;
    return span;
  }

  function persistViewedFiles() {
    localStorage.setItem(
      "gdp:viewed-files",
      JSON.stringify([...STATE.viewedFiles]),
    );
  }

  function setFileViewed(path: string, viewed: boolean) {
    if (viewed) STATE.viewedFiles.add(path);
    else STATE.viewedFiles.delete(path);
    persistViewedFiles();
    applyViewedState();
    $$<HTMLElement>(diffCardSelector(path)).forEach((card) => {
      applyViewedToCard(card, viewed, true);
    });
  }

  function syncViewedCardDisplay(card: HTMLElement, viewed: boolean) {
    card.classList.toggle("viewed", viewed);
    card
      .querySelectorAll<HTMLInputElement>(".d2h-file-collapse-input")
      .forEach((checkbox) => {
        checkbox.checked = viewed;
      });
  }

  function applyViewedToCard(
    card: HTMLElement,
    viewed: boolean,
    collapseLoaded = false,
  ) {
    syncViewedCardDisplay(card, viewed);
    if (collapseLoaded && card.classList.contains("loaded")) {
      setFileCollapsed(card as DiffCardElement, viewed);
    }
  }

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

  function setChevronIcon(el: HTMLElement) {
    el.innerHTML =
      '<svg class="octicon octicon-chevron-down" viewBox="0 0 12 12" width="12" height="12" fill="currentColor" aria-hidden="true">' +
      '<path fill="currentColor" d="' +
      CHEVRON_DOWN_12_PATH +
      '"></path></svg>';
  }

  function setUnfoldButtonState(
    button: HTMLButtonElement | null,
    expanded: boolean,
  ) {
    if (!button) return;
    button.setAttribute("aria-pressed", expanded ? "true" : "false");
    button.title = expanded ? "Collapse expanded lines" : "Expand all lines";
    button.innerHTML = expanded
      ? iconSvg("octicon-fold", COLLAPSE_ALL_16_PATHS)
      : iconSvg("octicon-unfold", EXPAND_ALL_16_PATHS);
  }

  function setSidebarTreeActionIcons() {
    const settings =
      document.querySelector<HTMLButtonElement>("#viewer-settings");
    const sidebarToggle =
      document.querySelector<HTMLButtonElement>("#sidebar-toggle");
    const expand = document.querySelector<HTMLButtonElement>("#sb-expand-all");
    const collapse =
      document.querySelector<HTMLButtonElement>("#sb-collapse-all");
    if (settings) settings.innerHTML = iconSvg("octicon-gear", GEAR_16_PATH);
    if (sidebarToggle)
      sidebarToggle.innerHTML = iconSvg(
        "octicon-sidebar",
        STATE.sidebarHidden ? SIDEBAR_SHOW_16_PATHS : SIDEBAR_HIDE_16_PATHS,
      );
    if (expand)
      expand.innerHTML = iconSvg("octicon-chevron-down", EXPAND_ALL_16_PATHS);
    if (collapse)
      collapse.innerHTML = iconSvg("octicon-chevron-up", COLLAPSE_ALL_16_PATHS);
  }

  function attachSidebarToggle(host: HTMLElement) {
    const button = document.querySelector<HTMLButtonElement>("#sidebar-toggle");
    if (!button || button.parentElement === host) return;
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

  function applySidebarHidden(hidden = STATE.sidebarHidden) {
    STATE.sidebarHidden = hidden;
    document.body.classList.toggle("gdp-sidebar-hidden", hidden);
    localStorage.setItem("gdp:sidebar-hidden", hidden ? "1" : "0");
    const button = document.querySelector<HTMLButtonElement>("#sidebar-toggle");
    if (button) {
      button.setAttribute("aria-pressed", hidden ? "true" : "false");
      button.title = hidden ? "show sidebar" : "hide sidebar";
      button.setAttribute(
        "aria-label",
        hidden ? "show sidebar" : "hide sidebar",
      );
    }
    setSidebarTreeActionIcons();
    placeSidebarToggle();
    syncSidebarHeaderHeight();
  }

  function toggleSidebarHidden() {
    applySidebarHidden(!STATE.sidebarHidden);
  }

  function scopeOmitSourceLabel(): string {
    return savedScopeOmitDirs() != null || savedScopeExcludeNames() != null
      ? "Browser override"
      : "Server default";
  }

  function refreshRepositoryTreeAfterSettings() {
    REPO_FILE_CACHE.clear();
    invalidateRepoSidebar();
    if (STATE.route.screen === "repo") {
      loadRepo();
      return;
    }
    const target = sourceTargetFromRoute();
    if (target) renderRepoBlobSidebar(target.path, target.ref || "worktree");
  }

  async function openScopeSettings() {
    const pop = document.querySelector<HTMLElement>("#scope-settings-popover");
    const input =
      document.querySelector<HTMLTextAreaElement>("#scope-omit-dirs");
    const excludeInput = document.querySelector<HTMLTextAreaElement>(
      "#scope-exclude-names",
    );
    const sidebarFontSize =
      document.querySelector<HTMLSelectElement>("#sidebar-font-size");
    const codeFontSize =
      document.querySelector<HTMLSelectElement>("#code-font-size");
    const source = document.querySelector<HTMLElement>("#scope-omit-source");
    if (
      !pop ||
      !input ||
      !excludeInput ||
      !sidebarFontSize ||
      !codeFontSize ||
      !source
    )
      return;
    await loadSettings();
    sidebarFontSize.value = savedSidebarFontSize();
    codeFontSize.value = savedCodeFontSize();
    input.value = effectiveScopeOmitDirs().join("\n");
    excludeInput.value = effectiveScopeExcludeNames().join("\n");
    source.textContent =
      'Saved for project "' +
      (PROJECT_NAME || "default") +
      '" in this browser. Source: ' +
      scopeOmitSourceLabel() +
      ". Used by tree, Ctrl+K, and Ctrl+G. Reset removes the browser override.";
    pop.hidden = false;
    sidebarFontSize.focus();
  }

  function closeScopeSettings() {
    const pop = document.querySelector<HTMLElement>("#scope-settings-popover");
    if (pop) pop.hidden = true;
  }

  function saveScopeSettings() {
    const input =
      document.querySelector<HTMLTextAreaElement>("#scope-omit-dirs");
    const excludeInput = document.querySelector<HTMLTextAreaElement>(
      "#scope-exclude-names",
    );
    const sidebarFontSize =
      document.querySelector<HTMLSelectElement>("#sidebar-font-size");
    const codeFontSize =
      document.querySelector<HTMLSelectElement>("#code-font-size");
    if (!input || !excludeInput || !sidebarFontSize || !codeFontSize) return;
    localStorage.setItem(
      SIDEBAR_FONT_SIZE_STORAGE_KEY,
      normalizeViewerFontSize(sidebarFontSize.value),
    );
    localStorage.setItem(
      CODE_FONT_SIZE_STORAGE_KEY,
      normalizeViewerFontSize(codeFontSize.value),
    );
    applySidebarFontSize();
    applyCodeFontSize();
    localStorage.setItem(
      scopeOmitDirsStorageKey(),
      JSON.stringify(normalizeScopeOmitDirs(input.value)),
    );
    localStorage.setItem(
      scopeExcludeNamesStorageKey(),
      JSON.stringify(normalizeScopeExcludeNames(excludeInput.value)),
    );
    closeScopeSettings();
    refreshRepositoryTreeAfterSettings();
  }

  function resetScopeSettings() {
    localStorage.removeItem(SIDEBAR_FONT_SIZE_STORAGE_KEY);
    localStorage.removeItem(CODE_FONT_SIZE_STORAGE_KEY);
    applySidebarFontSize("regular");
    applyCodeFontSize("regular");
    localStorage.removeItem(scopeOmitDirsStorageKey());
    localStorage.removeItem(scopeExcludeNamesStorageKey());
    closeScopeSettings();
    refreshRepositoryTreeAfterSettings();
  }

  // Build a directory trie from server tree entries. Explicit directory
  // entries are kept even when they have no visible file children, so the
  // worktree sidebar matches the repository tree screen.
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
          if (li.classList.contains("collapsed"))
            STATE.collapsedDirs.add(dir.path);
          else STATE.collapsedDirs.delete(dir.path);
          localStorage.setItem(
            "gdp:collapsed-dirs",
            JSON.stringify([...STATE.collapsedDirs]),
          );
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
        const li = document.createElement("li");
        li.className = "tree-file";
        li.tabIndex = -1;
        li.dataset.path = f.path;
        li.dataset.type = "blob";
        li.classList.toggle(
          "viewed",
          !onFileClick && STATE.viewedFiles.has(f.path),
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
          icon.innerHTML = fileEntryIcon();
          li.appendChild(icon);
        }
        const name = document.createElement("span");
        name.className = "name";
        name.textContent = f.path.split("/").pop();
        name.title = f.path;
        li.appendChild(name);
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
      }
    }
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
    params.set("ref", REPO_SIDEBAR_REF || "worktree");
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
              type: entry.type,
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
      const expanding = li.classList.contains("collapsed");
      li.dataset.toggling = "true";
      try {
        if (expanding) await ensureVirtualSidebarDirLoaded(dir);
        li.classList.toggle("collapsed");
        updateIcon();
        if (li.classList.contains("collapsed"))
          STATE.collapsedDirs.add(dir.path);
        else STATE.collapsedDirs.delete(dir.path);
        localStorage.setItem(
          "gdp:collapsed-dirs",
          JSON.stringify([...STATE.collapsedDirs]),
        );
        rerenderVirtualSidebar();
      } finally {
        delete li.dataset.toggling;
      }
    };
    li.classList.toggle("collapsed", STATE.collapsedDirs.has(dir.path));
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

  function createTreeFileRow(
    f: SidebarItem,
    depth: number,
    onFileClick?: (file: SidebarItem) => void,
  ) {
    const li = document.createElement("li");
    li.className = "tree-file";
    li.tabIndex = -1;
    li.dataset.path = f.path;
    li.dataset.type = "blob";
    li.classList.toggle(
      "viewed",
      !onFileClick && STATE.viewedFiles.has(f.path),
    );
    li.classList.toggle(
      "hidden-by-tests",
      STATE.hideTests && TEST_RE.test(f.path || ""),
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
      icon.innerHTML = fileEntryIcon();
      li.appendChild(icon);
    }
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = f.path.split("/").pop();
    name.title = f.path;
    li.appendChild(name);
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
          const expanded =
            !item.dir.children_omitted &&
            (filterActive || !STATE.collapsedDirs.has(item.dir.path));
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
            STATE.hideTests && TEST_RE.test(item.file.path || "");
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
      li.classList.toggle(
        "viewed",
        !onFileClick && STATE.viewedFiles.has(f.path),
      );
      if (f.status) {
        li.appendChild(fileBadge(f.status));
      } else {
        const icon = document.createElement("span");
        icon.className = "d2h-icon-wrapper";
        icon.innerHTML = fileEntryIcon();
        li.appendChild(icon);
      }
      const name = document.createElement("span");
      name.className = "name";
      name.textContent = f.path;
      name.title = f.path;
      li.appendChild(name);
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
    ul.innerHTML = "";
    ul.classList.toggle("tree", STATE.sbView === "tree");
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
    if (!onFileClick) REPO_SIDEBAR_REF = null;
    if (STATE.sbView === "tree") {
      const root = buildTree(files);
      if (onFileClick && files.length >= VIRTUAL_SIDEBAR_THRESHOLD)
        renderVirtualTreeSidebar(root);
      else renderTreeNode(root, 0, ul, onFileClick);
    } else {
      renderFlat(files, ul, onFileClick);
    }
    $("#totals").textContent = files.length
      ? `${files.length} file${files.length === 1 ? "" : "s"}`
      : "";
    // Update view-toggle visual
    $$(".sb-view-seg button").forEach((b) => {
      b.classList.toggle("active", b.dataset.view === STATE.sbView);
    });
    $$(".sb-tree-action").forEach((b) => {
      (b as HTMLButtonElement).disabled =
        STATE.sbView !== "tree" || !STATE.files.length;
    });
    // Re-apply active highlight if any
    if (STATE.activeFile) markActive(STATE.activeFile);
    applyFilter();
  }

  function setAllSidebarDirsCollapsed(collapsed: boolean) {
    if (!collapsed) STATE.collapsedDirs.clear();
    if ($("#filelist").classList.contains("tree-virtual")) {
      if (collapsed) {
        for (const row of SIDEBAR_TREE_ROWS) {
          if (row.kind === "dir") STATE.collapsedDirs.add(row.path);
        }
      }
      localStorage.setItem(
        "gdp:collapsed-dirs",
        JSON.stringify([...STATE.collapsedDirs]),
      );
      rerenderVirtualSidebar();
      return;
    }
    $$<HTMLElement>("#filelist .tree-dir[data-dirpath]").forEach((li) => {
      const path = li.dataset.dirpath || "";
      if (!path) return;
      li.classList.toggle("collapsed", collapsed);
      const dirIcon = li.querySelector<HTMLElement>(".dir-icon");
      if (dirIcon) setFolderIcon(dirIcon, collapsed);
      if (collapsed) STATE.collapsedDirs.add(path);
    });
    localStorage.setItem(
      "gdp:collapsed-dirs",
      JSON.stringify([...STATE.collapsedDirs]),
    );
  }

  function createRefSelectorInput(options: {
    id: string;
    placeholder: string;
    title?: string;
    wrapperId?: string;
    extraClass?: string;
    hidden?: boolean;
    value?: string;
  }): { wrap: HTMLDivElement; input: HTMLInputElement } {
    const wrap = document.createElement("div");
    wrap.className = `ref-selector${options.extraClass ? ` ${options.extraClass}` : ""}`;
    wrap.dataset.refSelector = "";
    if (options.wrapperId) wrap.id = options.wrapperId;
    if (options.hidden) wrap.hidden = true;

    const icon = document.createElement("span");
    icon.className = "ref-selector-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.innerHTML = iconSvg("octicon-git-branch", GIT_BRANCH_16_PATH);

    const input = document.createElement("input");
    input.className = "ref-input";
    input.id = options.id;
    input.readOnly = true;
    input.autocomplete = "off";
    input.placeholder = options.placeholder;
    if (options.title) input.title = options.title;
    if (options.value != null) input.value = options.value;

    const caret = document.createElement("span");
    caret.className = "ref-selector-caret";
    caret.setAttribute("aria-hidden", "true");
    caret.innerHTML = iconSvg("octicon-triangle-down", TRIANGLE_DOWN_16_PATH);

    wrap.append(icon, input, caret);
    return { wrap, input };
  }

  function hydrateRefSelectorMounts() {
    document
      .querySelectorAll<HTMLElement>("[data-ref-selector-mount]")
      .forEach((mount) => {
        const { wrap } = createRefSelectorInput({
          id: mount.dataset.refId || "",
          placeholder: mount.dataset.placeholder || "ref...",
          title: mount.dataset.title,
          wrapperId: mount.dataset.wrapperId,
          extraClass: mount.dataset.extraClass,
          hidden: mount.hidden,
        });
        mount.replaceWith(wrap);
      });
  }

  function renderMeta(meta: DiffMeta | null) {
    const el = $("#meta");
    if (!meta) {
      el.textContent = "";
      return;
    }
    setProjectName(meta.project || "");
    el.innerHTML = "";
    if (meta.branch) {
      const b = document.createElement("span");
      b.className = "ref";
      b.textContent = `⎇ ${meta.branch}`;
      el.appendChild(b);
    }
    if (meta.totals) {
      const t = document.createElement("span");
      t.className = "num";
      t.innerHTML =
        '<span class="add">+' +
        meta.totals.additions +
        "</span> " +
        '<span class="del">−' +
        meta.totals.deletions +
        "</span> " +
        "<span>" +
        meta.totals.files +
        " files</span>";
      el.appendChild(t);
    }
    const u = document.createElement("span");
    u.className = "updated-at";
    u.title = "last updated";
    u.textContent = `updated ${new Date().toLocaleTimeString([], { hour12: false })}`;
    el.appendChild(u);
  }

  // While we're animating a programmatic scroll (e.g. from a sidebar click),
  // suppress scrollspy so the user-chosen active item doesn't flicker through
  // every file the scroll passes over.
  let SUPPRESS_SPY_UNTIL = 0;

  // Prefetch a file's diff (low priority). Used for sidebar hover and j/k.
  function prefetchByPath(path: string) {
    const card = document.querySelector<DiffCardElement>(
      diffCardSelector(path),
    );
    if (!card?.classList.contains("pending")) return;
    const f = STATE.files.find((x) => x.path === path);
    if (!f) return;
    enqueueLoad(f, card, 5);
  }

  function clearDiffLineFocus() {
    document
      .querySelectorAll<HTMLElement>(".gdp-diff-line-target")
      .forEach((row) => {
        row.classList.remove("gdp-diff-line-target");
      });
  }

  function diffRowLineNumber(row: HTMLTableRowElement): number | null {
    const newLine = row.querySelector<HTMLElement>(
      ".line-num2, td.d2h-code-side-linenumber",
    );
    const raw = (newLine?.textContent || "").trim();
    const line = Number(raw);
    return Number.isInteger(line) && line > 0 ? line : null;
  }

  function focusDiffLine(
    card: HTMLElement,
    line: SourceLineTarget | undefined,
  ) {
    const start = lineTargetStart(line);
    if (!start) return false;
    const rows = Array.from(
      card.querySelectorAll<HTMLTableRowElement>("table.d2h-diff-table tr"),
    );
    const row = rows.find(
      (candidate) => diffRowLineNumber(candidate) === start,
    );
    if (!row) return false;
    clearDiffLineFocus();
    row.classList.add("gdp-diff-line-target");
    scrollDiffElementIntoView(row, "center");
    return true;
  }

  function scrollDiffElementIntoView(
    element: HTMLElement,
    block: ScrollLogicalPosition,
  ) {
    element.scrollIntoView({ behavior: "auto", block });
  }

  function applyDiffRouteFocus(card?: HTMLElement) {
    if (STATE.route.screen !== "diff" || !STATE.route.path || !STATE.route.line)
      return false;
    if (card && card.dataset.path !== STATE.route.path) return false;
    const targetCard =
      card ||
      document.querySelector<DiffCardElement>(
        diffCardSelector(STATE.route.path),
      );
    if (!targetCard) return false;
    return focusDiffLine(targetCard, STATE.route.line);
  }

  // Lazy diff loads above the focused line change the document height and
  // push the target away after we already scrolled to it. While this window
  // is open, every finished card load re-anchors the viewport on the target
  // line of the route; any manual scroll intent (wheel/touch) closes it so the
  // user is never yanked back.
  let REANCHOR_UNTIL =
    STATE.route.screen === "diff" && STATE.route.line
      ? performance.now() + 6000
      : 0;
  window.addEventListener(
    "wheel",
    () => {
      REANCHOR_UNTIL = 0;
    },
    { passive: true },
  );
  window.addEventListener(
    "touchmove",
    () => {
      REANCHOR_UNTIL = 0;
    },
    { passive: true },
  );

  function scrollToFile(path: string, line?: SourceLineTarget) {
    const card = document.querySelector<DiffCardElement>(
      diffCardSelector(path),
    );
    if (!card) return;
    if (line) REANCHOR_UNTIL = performance.now() + 4000;
    markActive(path);
    SUPPRESS_SPY_UNTIL = performance.now() + 1500;
    const onEnd = () => {
      SUPPRESS_SPY_UNTIL = 0;
      window.removeEventListener("scrollend", onEnd);
    };
    window.addEventListener("scrollend", onEnd, { once: true });
    // Priority-load if still pending
    if (card.classList.contains("pending")) {
      const f = STATE.files.find((x) => x.path === path);
      if (f) enqueueLoad(f, card, 10);
    }
    if (!line || !focusDiffLine(card, line)) {
      scrollDiffElementIntoView(card, "start");
    }
  }

  function sidebarAncestorDirs(path: string): string[] {
    const parts = path.split("/").filter(Boolean);
    const dirs: string[] = [];
    for (let i = 1; i < parts.length; i++)
      dirs.push(parts.slice(0, i).join("/"));
    return dirs;
  }

  function expandSidebarAncestors(path: string) {
    if (STATE.sbView !== "tree") return;
    let changed = false;
    for (const dir of sidebarAncestorDirs(path)) {
      if (STATE.collapsedDirs.delete(dir)) changed = true;
      const row = document.querySelector<HTMLElement>(
        `#filelist .tree-dir[data-dirpath="${CSS.escape(dir)}"]`,
      );
      row?.classList.remove("collapsed");
      const icon = row?.querySelector<HTMLElement>(".dir-icon");
      if (icon) setFolderIcon(icon, false);
    }
    if (changed)
      localStorage.setItem(
        "gdp:collapsed-dirs",
        JSON.stringify([...STATE.collapsedDirs]),
      );
    rerenderVirtualSidebar();
  }

  function markActive(path: string, options: { reveal?: boolean } = {}) {
    STATE.activeFile = path;
    SIDEBAR_VIRTUAL_ACTIVE_PATH = path;
    if (options.reveal && STATE.sbView === "tree") expandSidebarAncestors(path);
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

  function applyViewedState() {
    if (isRepositorySidebarMode()) return;
    $$<HTMLElement>("#filelist li[data-path]").forEach((li) => {
      const path = li.dataset.path || "";
      li.classList.toggle("viewed", STATE.viewedFiles.has(path));
    });
    $$<HTMLElement>(".gdp-file-shell[data-path]").forEach((card) => {
      const path = card.dataset.path || "";
      const viewed = STATE.viewedFiles.has(path);
      syncViewedCardDisplay(card, viewed);
    });
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

  // ============================================================
  // Lazy per-file rendering pipeline
  // ============================================================
  let SERVER_GENERATION = 0;
  let CLIENT_REQ_SEQ = 0;
  const LOAD_QUEUE: LoadQueueItem[] = [];
  let ACTIVE_LOADS = 0;
  const MAX_PARALLEL = 2;
  let lazyObserver: IntersectionObserver | null = null;

  // Top-edge loading indicator. Reflects any in-flight fetch (initial meta,
  // per-file diff, "show next", prefetch, ref-picker etc.).
  let IN_FLIGHT = 0;
  function updateLoadBar() {
    const el = $("#load-bar");
    if (el) el.classList.toggle("active", IN_FLIGHT > 0);
  }
  function trackLoad<T>(promise: Promise<T>): Promise<T> {
    IN_FLIGHT++;
    updateLoadBar();
    const done = () => {
      IN_FLIGHT = Math.max(0, IN_FLIGHT - 1);
      updateLoadBar();
    };
    return Promise.resolve(promise).then(
      (v) => {
        done();
        return v;
      },
      (e) => {
        done();
        throw e;
      },
    );
  }

  function escapeHtml(s: unknown): string {
    return String(s == null ? "" : s).replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  }

  function isAbortError(err: unknown): boolean {
    return err instanceof DOMException
      ? err.name === "AbortError"
      : !!err &&
          typeof err === "object" &&
          "name" in err &&
          (err as { name?: unknown }).name === "AbortError";
  }

  function currentRange() {
    return {
      from: STATE.from || DEFAULT_RANGE.from,
      to: STATE.to || DEFAULT_RANGE.to,
    };
  }

  function repoFileTargetFromRoute(): string | null {
    return STATE.route.screen === "file" && STATE.route.view === "blob"
      ? STATE.route.ref
      : null;
  }

  // Annotations UI (annotations-ui.ts) is constructed near the end of this
  // file once its dependencies exist; the few call sites that can run before
  // that (setRoute, lazy diff renders) go through this late-bound handle.
  let ANNOTATIONS_UI: AnnotationsUi | null = null;

  function applyInlineAnnotations() {
    ANNOTATIONS_UI?.applyInlineAnnotations();
  }

  function withAnnotationSessionParam(rawUrl: string): string {
    return ANNOTATIONS_UI ? ANNOTATIONS_UI.withSessionParam(rawUrl) : rawUrl;
  }

  function setRoute(route: AppRoute, replace = false) {
    const nextRoute =
      route.screen === "unknown"
        ? { screen: "diff" as const, range: route.range }
        : route;
    STATE.route = nextRoute;
    STATE.from = nextRoute.range.from;
    STATE.to = nextRoute.range.to;
    if (
      nextRoute.screen === "repo" ||
      (nextRoute.screen === "file" && nextRoute.view === "blob")
    ) {
      STATE.repoRef = nextRoute.ref || "worktree";
    }
    const url = withAnnotationSessionParam(buildRoute(nextRoute));
    const state =
      nextRoute.screen === "file"
        ? {
            screen: "file",
            path: nextRoute.path,
            ref: nextRoute.ref,
            view: nextRoute.view || "detail",
          }
        : { view: nextRoute.screen };
    if (replace) history.replaceState(state, "", url);
    else history.pushState(state, "", url);
    syncHeaderMenu();
  }

  function setPageMode() {
    document.body.classList.toggle(
      "gdp-file-detail-page",
      STATE.route.screen === "file",
    );
    document.body.classList.toggle(
      "gdp-repo-blob-page",
      STATE.route.screen === "file" && STATE.route.view === "blob",
    );
    document.body.classList.toggle(
      "gdp-repo-page",
      STATE.route.screen === "repo",
    );
    document.body.classList.toggle(
      "gdp-help-page",
      STATE.route.screen === "help",
    );
    syncRepoTargetInput(repoFileTargetFromRoute() || "worktree");
  }

  function syncHeaderMenu() {
    document
      .querySelectorAll<HTMLAnchorElement>(".app-menu-item, .global-help-link")
      .forEach((link) => {
        const fileRouteOwner =
          STATE.route.screen === "file" && STATE.route.view === "blob"
            ? "repo"
            : "diff";
        const active =
          link.dataset.route === STATE.route.screen ||
          (STATE.route.screen === "file" &&
            link.dataset.route === fileRouteOwner);
        link.classList.toggle("active", active);
        link.setAttribute("aria-current", active ? "page" : "false");
        if (link.dataset.route === "repo") {
          link.href = buildRoute({
            screen: "repo",
            ref: STATE.repoRef || "worktree",
            path: "",
            range: currentRange(),
          });
        }
        if (link.dataset.route === "diff") {
          link.href = buildRoute({ screen: "diff", range: currentRange() });
        }
        if (link.dataset.route === "help") {
          link.href = buildRoute({
            screen: "help",
            lang: helpLanguageFromRoute(STATE.route),
            section: helpSectionFromRoute(STATE.route),
            range: currentRange(),
          });
        }
      });
  }

  function renderShell(meta: DiffMeta) {
    const newFiles = meta.files || [];
    STATE.files = newFiles;
    SERVER_GENERATION = meta.generation || 0;
    window._lastMeta = meta;
    renderMeta(meta);
    renderSidebar(newFiles);

    const target = $("#diff");
    const empty = $("#empty");
    if (!newFiles.length) {
      if (STATE.route.screen === "file") {
        empty.classList.add("hidden");
        applySourceRouteToShell();
      } else {
        empty.classList.remove("hidden");
        target.replaceChildren();
      }
      LOAD_QUEUE.length = 0;
      return;
    }
    empty.classList.add("hidden");

    // Reuse existing cards by stable key when possible. This keeps scroll
    // position stable, avoids re-fetching unchanged files, and preserves any
    // expanded hunk state. Cards whose meta changed (size_class, status) are
    // reset to placeholder so they reload.
    const oldByKey = new Map();
    document
      .querySelectorAll<DiffCardElement>(".gdp-file-shell")
      .forEach((c) => {
        if (c.dataset.key) oldByKey.set(c.dataset.key, c);
      });

    const ordered = [];
    newFiles.forEach((f) => {
      const key = f.key || f.path;
      const old = oldByKey.get(key);
      if (old) {
        oldByKey.delete(key);
        const sizeChanged = old.dataset.sizeClass !== (f.size_class || "small");
        const statusChanged = old.dataset.status !== (f.status || "M");
        if (sizeChanged || statusChanged) {
          // Meta drifted — drop content and re-queue
          old.classList.remove("loaded", "error");
          old.classList.add("pending");
          old.replaceChildren();
          const tmp = createPlaceholder(f);
          while (tmp.firstChild) old.appendChild(tmp.firstChild);
          old.dataset.sizeClass = f.size_class || "small";
          old.dataset.status = f.status || "M";
          // Manual-load is the user's "show this heavy file" intent. Keep it
          // across live refreshes, but reset it when the file's basic meta
          // changes enough that the old intent may no longer match.
          delete old.dataset.manualRendered;
          delete old.dataset.manualLoad;
          delete old.dataset.manualMode;
          old.style.minHeight = `${f.estimated_height_px || 80}px`;
          old._diffData = null;
          old._file = null;
        } else {
          // Refresh the lightweight header counts in place
          const stats = old.querySelector(".gdp-shell-header .stats");
          if (stats) {
            stats.innerHTML =
              '<span class="a">+' +
              (f.additions || 0) +
              "</span>" +
              '<span class="d">−' +
              (f.deletions || 0) +
              "</span>";
          }
          old._file = f;
        }
        ordered.push(old);
      } else {
        ordered.push(createPlaceholder(f));
      }
    });

    // Cards no longer present
    oldByKey.forEach((c) => {
      c.remove();
    });

    target.replaceChildren(...ordered);

    // Drop pending queue entries whose card is gone
    for (let i = LOAD_QUEUE.length - 1; i >= 0; i--) {
      if (!LOAD_QUEUE[i].card.isConnected) LOAD_QUEUE.splice(i, 1);
    }

    setupLazyObserver();
    enqueueInitialLoads();
    applySourceRouteToShell();
    setupScrollSpy();
    if (typeof applyHideTests === "function") applyHideTests();
    applyFilter();
    applyViewedState();
  }

  async function openPathInOs(
    path: string,
    kind: "directory" | "file-parent",
    button?: HTMLButtonElement,
  ) {
    const oldTitle = button?.title;
    if (button) {
      button.disabled = true;
      button.classList.remove("failed");
    }
    try {
      const res = await fetch("/_open_path", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Code-Viewer-Action": "1",
        },
        body: JSON.stringify({ path, kind }),
      });
      if (!res.ok) throw new Error(await res.text());
      button?.classList.add("opened");
      setTimeout(() => {
        button?.classList.remove("opened");
      }, 1200);
    } catch {
      if (button) {
        button.classList.add("failed");
        button.title = "failed to open in OS";
        setTimeout(() => {
          button.classList.remove("failed");
          button.title = oldTitle || "open in OS";
        }, 1600);
      }
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function runUndoAction(action: UndoActionResponse) {
    if (action.type !== "trash") return false;
    const res = await fetch("/_restore_trash", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Code-Viewer-Action": "1",
      },
      body: JSON.stringify(action.payload),
    });
    if (!res.ok) {
      showTrashError(`Failed to undo "${action.label}": ${await res.text()}`);
      return false;
    }
    return true;
  }

  async function undoLastAction() {
    const action = UNDO_STACK.shift();
    if (!action) return false;
    if (!(await runUndoAction(action))) {
      UNDO_STACK.unshift(action);
      return true;
    }
    invalidateRepoSidebar();
    await load();
    return true;
  }

  function createOpenPathButton(
    path: string,
    kind: "directory" | "file-parent",
    title = "open folder in OS",
  ): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "gdp-file-header-icon gdp-open-path";
    button.title = title;
    button.setAttribute("aria-label", title);
    button.innerHTML = iconSvg("octicon-link-external", OPEN_EXTERNAL_16_PATH);
    button.addEventListener("click", (e) => {
      e.stopPropagation();
      openPathInOs(path, kind, button);
    });
    return button;
  }

  function createPlaceholder(f: FileMeta): DiffCardElement {
    const card = document.createElement("div");
    card.className = "gdp-file-shell pending";
    card.dataset.path = f.path;
    card.dataset.key = f.key || f.path;
    card.dataset.sizeClass = f.size_class || "small";
    card.dataset.status = f.status || "M";
    card.classList.toggle("viewed", STATE.viewedFiles.has(f.path));
    if (f.estimated_height_px) {
      card.style.minHeight = `${f.estimated_height_px}px`;
    }

    const head = document.createElement("div");
    head.className = "gdp-shell-header";
    head.innerHTML =
      '<span class="status-pill ' +
      escapeHtml(f.status || "M") +
      '">' +
      escapeHtml(f.status || "M") +
      "</span>" +
      '<span class="path">' +
      escapeHtml(f.display_path || f.path) +
      "</span>" +
      '<span class="stats">' +
      '<span class="a">+' +
      (f.additions || 0) +
      "</span>" +
      '<span class="d">−' +
      (f.deletions || 0) +
      "</span>" +
      "</span>" +
      '<span class="size-tag ' +
      escapeHtml(f.size_class || "") +
      '">' +
      escapeHtml(f.size_class || "") +
      "</span>" +
      '<span class="loading-indicator" hidden>loading…</span>';
    card.appendChild(head);

    const body = document.createElement("div");
    body.className = "gdp-shell-body";
    card.appendChild(body);

    return card;
  }

  function setupLazyObserver() {
    if (lazyObserver) lazyObserver.disconnect();
    lazyObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const card = entry.target as DiffCardElement;
          if (
            card.classList.contains("loaded") ||
            card.classList.contains("loading")
          )
            return;
          const f = STATE.files.find((x) => x.path === card.dataset.path);
          if (!f) return;
          enqueueLoad(f, card, 0);
        });
      },
      { rootMargin: "1200px 0px 1600px 0px" },
    );
    document
      .querySelectorAll<DiffCardElement>(".gdp-file-shell.pending")
      .forEach((c) => {
        lazyObserver.observe(c);
      });
  }

  window.addEventListener("scroll", () => enqueueInitialLoads(), {
    passive: true,
  });
  window.addEventListener(
    "resize",
    () => {
      enqueueInitialLoads();
      syncSidebarHeaderHeight();
    },
    { passive: true },
  );
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) enqueueInitialLoads();
  });

  function enqueueInitialLoads() {
    const viewportBottom = window.innerHeight + 1600;
    document
      .querySelectorAll<DiffCardElement>(".gdp-file-shell.pending")
      .forEach((card) => {
        const rect = card.getBoundingClientRect();
        if (rect.top > viewportBottom) return;
        const f = STATE.files.find((x) => x.path === card.dataset.path);
        if (f) enqueueLoad(f, card, 0);
      });
  }

  function enqueueLoad(
    file: FileMeta,
    card: DiffCardElement,
    priority?: number,
  ) {
    if (manualLoadReason(file) && card.dataset.manualLoad !== "1") {
      renderManualLoadPlaceholder(card, file);
      return;
    }
    if (LOAD_QUEUE.find((item) => item.card === card)) return;
    LOAD_QUEUE.push({ file, card, priority: priority || 0 });
    LOAD_QUEUE.sort((a, b) => b.priority - a.priority);
    pumpQueue();
  }

  function pumpQueue() {
    while (ACTIVE_LOADS < MAX_PARALLEL && LOAD_QUEUE.length) {
      const item = LOAD_QUEUE.shift();
      if (
        item.card.classList.contains("loaded") ||
        item.card.classList.contains("loading")
      )
        continue;
      ACTIVE_LOADS++;
      loadFile(item.file, item.card).finally(() => {
        ACTIVE_LOADS--;
        pumpQueue();
      });
    }
  }

  function manualLoadReason(file: FileMeta): string | null {
    const path = file.path || "";
    if (file.size_class === "huge") return "huge diff";
    if (/\.(min|bundle)\.(js|mjs|css)$/i.test(path))
      return "minified or bundled file";
    if (/\.map$/i.test(path)) return "source map";
    if (/(^|\/)(vendor|node_modules|dist|build|out)\//i.test(path))
      return "generated or vendored path";
    return null;
  }

  function renderManualLoadPlaceholder(card: DiffCardElement, file: FileMeta) {
    if (card.dataset.manualRendered === "1") return;
    card.dataset.manualRendered = "1";
    card.classList.remove("loading");
    card.classList.add("pending", "manual-load");
    if (lazyObserver) lazyObserver.unobserve(card);
    const indicator = card.querySelector<HTMLElement>(".loading-indicator");
    if (indicator) indicator.hidden = true;
    const body = card.querySelector<HTMLElement>(".gdp-shell-body");
    if (!body) return;
    body.innerHTML = "";

    const wrap = document.createElement("div");
    wrap.className = "gdp-manual-load";

    const note = document.createElement("div");
    note.className = "gdp-manual-note";
    note.textContent = `${manualLoadReason(file)} - click to load diff`;

    const previewBtn = document.createElement("button");
    previewBtn.className = "gdp-show-full";
    previewBtn.textContent = "Load preview";
    previewBtn.addEventListener("click", () => {
      body.innerHTML = "";
      card.dataset.manualLoad = "1";
      card.dataset.manualMode = "preview";
      card.classList.remove("manual-load");
      loadFile(file, card, buildPreviewUrl(file, 3));
    });

    const openFileBtn = document.createElement("button");
    openFileBtn.className = "gdp-show-full";
    openFileBtn.textContent = "Open as file";
    openFileBtn.title = "Open this file in the virtualized source viewer";
    openFileBtn.addEventListener("click", () => {
      const target = fileSourceTarget(file);
      setRoute({
        screen: "file",
        path: target.path,
        ref: target.ref,
        range: currentRange(),
      });
      applySourceRouteToShell();
    });

    const fullBtn = document.createElement("button");
    fullBtn.className = "gdp-show-full secondary";
    fullBtn.textContent = "Load full diff";
    fullBtn.title =
      "Render the full diff with Diff2Html. This can be slow for large files.";
    fullBtn.addEventListener("click", () => {
      body.innerHTML = "";
      card.dataset.manualLoad = "1";
      card.dataset.manualMode = "full";
      card.classList.remove("manual-load");
      loadFile(file, card, file.load_url);
    });

    wrap.appendChild(note);
    if (file.status === "A") wrap.appendChild(openFileBtn);
    wrap.appendChild(previewBtn);
    wrap.appendChild(fullBtn);
    body.appendChild(wrap);
  }

  function nextIdle(timeout = 500): Promise<void> {
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve();
      };
      const ric = window.requestIdleCallback;
      if (typeof ric === "function") {
        ric(finish, { timeout });
      } else {
        requestAnimationFrame(finish);
        setTimeout(finish, 50);
      }
    });
  }

  function loadFile(
    file: FileMeta,
    card: DiffCardElement,
    urlOverride?: string,
  ): Promise<void> {
    card.classList.remove("pending");
    card.classList.add("loading");
    if (lazyObserver) lazyObserver.unobserve(card);
    const indicator = card.querySelector<HTMLElement>(".loading-indicator");
    if (indicator) indicator.hidden = false;

    const url =
      urlOverride ||
      (card.dataset.manualMode === "full"
        ? file.load_url
        : file.preview_url || file.load_url);
    const myGen = SERVER_GENERATION;
    const myReq = ++CLIENT_REQ_SEQ;
    card.dataset.reqId = String(myReq);

    const retryStale = () => {
      if (String(myReq) !== card.dataset.reqId) return;
      card.classList.remove("loading");
      card.classList.add("pending");
      if (indicator) indicator.hidden = true;
      const fresh = STATE.files.find((x) => x.path === card.dataset.path);
      if (fresh && card.isConnected) enqueueLoad(fresh, card, 0);
    };

    return trackLoad<FileDiffResponse>(fetch(url).then((r) => r.json()))
      .then(async (data) => {
        if (String(myReq) !== card.dataset.reqId) return; // superseded by newer request
        if (myGen !== SERVER_GENERATION) {
          retryStale();
          return;
        } // generation rolled, retry
        if (data.generation && data.generation !== SERVER_GENERATION) {
          retryStale();
          return;
        }
        await nextIdle();
        if (String(myReq) !== card.dataset.reqId) return;
        renderFile(file, data, card);
      })
      .catch(() => {
        if (String(myReq) !== card.dataset.reqId) return;
        card.classList.remove("loading");
        card.classList.add("error");
        const body = card.querySelector<HTMLElement>(".gdp-shell-body");
        if (!body) return;
        body.innerHTML =
          '<div class="gdp-error">failed to load — <button class="retry">retry</button></div>';
        const btn = body.querySelector(".retry");
        if (btn)
          btn.addEventListener("click", () => {
            card.classList.remove("error");
            card.classList.add("pending");
            body.innerHTML = "";
            enqueueLoad(file, card, 1);
          });
      });
  }

  function mountDiff(
    card: DiffCardElement,
    file: FileMeta,
    data: FileDiffResponse,
  ) {
    const head = card.querySelector<HTMLElement>(".gdp-shell-header");
    if (head) head.style.display = "none";
    const body = card.querySelector<HTMLElement>(".gdp-shell-body");
    if (!body) return;
    body.innerHTML = "";

    if (!data.diff?.trim()) {
      body.innerHTML = '<div class="gdp-info">No content</div>';
      return;
    }

    const layout = file.force_layout || STATE.layout;
    const hljsRef = getHljs();
    const ui = new Diff2HtmlUI(
      body,
      data.diff,
      {
        drawFileList: false,
        matching: "lines",
        outputFormat: layout,
        synchronisedScroll: true,
        highlight: !!(STATE.syntaxHighlight && file.highlight && hljsRef),
        fileListToggle: false,
        fileContentToggle: false,
      },
      hljsRef,
    );
    ui.draw();
    if (STATE.ignoreWs) suppressWhitespaceOnlyInlineHighlights(body);
    if (
      STATE.syntaxHighlight &&
      file.highlight &&
      hljsRef &&
      typeof ui.highlightCode === "function"
    )
      ui.highlightCode();

    enhanceMediaCard(file, card);
    syncSideScrollCard(card);
    appendStatSquaresToHeader(card, file);
    setupHunkExpand(card, file);
  }

  // ---------- Help page: extracted to help-page.ts ----------
  const { renderHelpPage } = createHelpPage({
    $,
    getRoute: () => STATE.route,
    setRoute,
    setPageMode,
    cancelActiveSourceLoad,
    removeStandaloneSource,
    clearLoadQueue: () => {
      LOAD_QUEUE.length = 0;
    },
    currentRange,
    syncHeaderMenu,
  });

  // ---------- Hunk expand: extracted to hunk-expand.ts ----------
  const { setupHunkExpand } = createHunkExpand({
    trackLoad,
    getServerGeneration: () => SERVER_GENERATION,
    getToRef: () =>
      STATE.to && STATE.to !== "worktree" ? STATE.to : "worktree",
    highlightInsertedSpans,
  });
  function setFileCollapsed(card: DiffCardElement, collapsed: boolean) {
    card.classList.toggle("gdp-file-collapsed", collapsed);
    card
      .querySelectorAll<HTMLElement>(
        ".d2h-files-diff, .d2h-file-diff, .gdp-source-viewer, .gdp-media",
      )
      .forEach((body) => {
        body.classList.toggle("d2h-d-none", collapsed);
      });
    const button = card.querySelector<HTMLButtonElement>(".gdp-file-toggle");
    if (button) {
      button.setAttribute("aria-expanded", collapsed ? "false" : "true");
      button.title = collapsed ? "Expand file" : "Collapse file";
    }
    const unfold = card.querySelector<HTMLButtonElement>(".gdp-file-unfold");
    if (unfold) unfold.disabled = collapsed;
    const viewFile = card.querySelector<HTMLButtonElement>(".gdp-view-file");
    if (viewFile) viewFile.disabled = collapsed;
  }

  function setViewFileButtonState(
    button: HTMLButtonElement | null,
    sourceMode: boolean,
  ) {
    if (!button) return;
    button.classList.add("gdp-btn", "gdp-btn-sm");
    button.textContent = sourceMode ? "View Diff" : "View File";
    button.setAttribute("aria-pressed", sourceMode ? "true" : "false");
    button.title = sourceMode ? "View diff" : "View file";
  }

  function createFileBreadcrumb(path: string, ref?: string): HTMLElement {
    const nav = document.createElement("nav");
    nav.className = "gdp-file-breadcrumb";
    nav.setAttribute("aria-label", "File path");
    const parts = path.split("/").filter(Boolean);
    const allParts = PROJECT_NAME ? [PROJECT_NAME, ...parts] : parts;
    allParts.forEach((part, index) => {
      if (index > 0) {
        const sep = document.createElement("span");
        sep.className = "gdp-file-breadcrumb-sep";
        sep.textContent = "/";
        nav.appendChild(sep);
      }
      const isCurrent = index === allParts.length - 1;
      const crumb = document.createElement(isCurrent ? "span" : "button");
      crumb.className =
        index === allParts.length - 1
          ? "gdp-file-breadcrumb-current"
          : "gdp-file-breadcrumb-part";
      crumb.textContent = part;
      if (!isCurrent && crumb instanceof HTMLButtonElement) {
        crumb.type = "button";
        crumb.addEventListener("click", () => {
          const projectOffset = PROJECT_NAME ? 1 : 0;
          const currentPath = parts
            .slice(0, Math.max(0, index - projectOffset + 1))
            .join("/");
          setRoute(repoRoute(ref || "worktree", currentPath));
          loadRepo();
        });
      }
      nav.appendChild(crumb);
    });
    if (!allParts.length) {
      const crumb = document.createElement("span");
      crumb.className = "gdp-file-breadcrumb-current";
      crumb.textContent = path;
      nav.appendChild(crumb);
    }
    return nav;
  }

  async function expandAllFileContext(card: DiffCardElement, file: FileMeta) {
    if (card.classList.contains("gdp-context-expanded")) {
      const data = card._diffData;
      if (!data) return;
      card.classList.remove("gdp-context-expanded");
      mountDiff(card, file, data);
      if (data.truncated && data.mode === "preview")
        addExpandHunksUI(file, data, card);
      scheduleIdleHighlight(card, file);
      setUnfoldButtonState(
        card.querySelector<HTMLButtonElement>(".gdp-file-unfold"),
        false,
      );
      return;
    }
    if (
      card._diffData &&
      (card._diffData.truncated || card._diffData.mode === "preview")
    ) {
      // Load the full diff first, then fall through to expand its gaps too.
      await loadFile(file, card, file.load_url);
    }
    const button = card.querySelector<HTMLButtonElement>(".gdp-file-unfold");
    if (button) button.disabled = true;
    try {
      // Expand every gap fully in parallel: each stack exposes a one-shot
      // whole-gap fetch, so a round costs one request per gap instead of
      // a 20-line click every 80ms. Extra rounds only pick up stacks the
      // previous round created (e.g. trailing EOF probing).
      for (let round = 0; round < 20; round++) {
        const tasks = Array.from(
          card.querySelectorAll<ExpandStackElement>(".gdp-expand-stack"),
        )
          .map((stack) => stack._gdpExpandFully)
          .filter((fn): fn is () => Promise<void> => !!fn);
        if (!tasks.length) break;
        const results = await Promise.all(
          tasks.map((fn) =>
            fn().then(
              () => true,
              () => false,
            ),
          ),
        );
        if (!results.some(Boolean)) break;
      }
      card.classList.add("gdp-context-expanded");
      setUnfoldButtonState(button || null, true);
    } finally {
      if (button) button.disabled = false;
    }
  }

  // GitHub-style diff squares: 5 small filled boxes (green/red/grey)
  // appended to the right edge of the file header.
  function appendStatSquaresToHeader(card: DiffCardElement, file: FileMeta) {
    const header = card.querySelector(".d2h-file-header");
    if (!header) return;
    if (!header.querySelector(".gdp-file-toggle")) {
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "gdp-file-header-icon gdp-file-toggle";
      toggle.title = "Collapse file";
      toggle.setAttribute("aria-expanded", "true");
      toggle.innerHTML = iconSvg("octicon-chevron-down", CHEVRON_DOWN_16_PATH);
      toggle.addEventListener("click", (e) => {
        e.stopPropagation();
        setFileCollapsed(card, !card.classList.contains("gdp-file-collapsed"));
      });
      header.insertBefore(toggle, header.firstChild);
    }
    header
      .querySelectorAll<HTMLInputElement>(".d2h-file-collapse-input")
      .forEach((checkbox) => {
        checkbox.checked = STATE.viewedFiles.has(file.path);
        if (checkbox.dataset.gdpBound !== "1") {
          checkbox.dataset.gdpBound = "1";
          checkbox.addEventListener("change", () =>
            setFileViewed(file.path, checkbox.checked),
          );
        }
      });
    if (!header.querySelector(".gdp-copy-path")) {
      const nameWrapper = header.querySelector(".d2h-file-name-wrapper");
      const copy = document.createElement("button");
      copy.type = "button";
      copy.className = "gdp-file-header-icon gdp-copy-path";
      copy.title = "copy file path";
      copy.innerHTML = iconSvg("octicon-copy", COPY_16_PATHS);
      copy.addEventListener("click", async (e) => {
        e.stopPropagation();
        const path = filePathClipboardText(file.path);
        if (!path) return;
        try {
          await navigator.clipboard.writeText(path);
          copy.classList.add("copied");
          setTimeout(() => {
            copy.classList.remove("copied");
          }, 1200);
        } catch {
          copy.classList.add("failed");
          setTimeout(() => {
            copy.classList.remove("failed");
          }, 1200);
        }
      });
      const statusTag = nameWrapper
        ? nameWrapper.querySelector(".d2h-tag")
        : null;
      if (statusTag) statusTag.insertAdjacentElement("afterend", copy);
      else if (nameWrapper)
        nameWrapper.insertAdjacentElement("beforeend", copy);
      else header.insertBefore(copy, header.firstChild);
    }
    if (!header.querySelector(".gdp-file-unfold")) {
      const unfold = document.createElement("button");
      unfold.type = "button";
      unfold.className = "gdp-file-header-icon gdp-file-unfold";
      setUnfoldButtonState(
        unfold,
        card.classList.contains("gdp-context-expanded"),
      );
      unfold.addEventListener("click", (e) => {
        e.stopPropagation();
        expandAllFileContext(card, file);
      });
      const copy = header.querySelector(".gdp-copy-path");
      if (copy) copy.insertAdjacentElement("afterend", unfold);
      else header.appendChild(unfold);
    }
    if (!header.querySelector(".gdp-open-path")) {
      const unfold = header.querySelector(".gdp-file-unfold");
      const openPath = createOpenPathButton(
        file.path,
        "file-parent",
        "open parent folder in OS",
      );
      if (unfold) unfold.insertAdjacentElement("afterend", openPath);
      else header.appendChild(openPath);
    }
    // Numeric counts (matches GitHub: "+10 -113 ▰▰▰▰▰")
    if (!header.querySelector(".gdp-stat-text")) {
      const stats = document.createElement("span");
      stats.className = "gdp-stat-text";
      stats.innerHTML =
        '<span class="a">+' +
        (file.additions || 0) +
        "</span>" +
        '<span class="d">−' +
        (file.deletions || 0) +
        "</span>";
      header.appendChild(stats);
    }
    const total = (file.additions || 0) + (file.deletions || 0);
    const SEG = 5;
    let aSeg: number;
    let dSeg: number;
    if (total === 0) {
      aSeg = 0;
      dSeg = 0;
    } else {
      aSeg = Math.round((file.additions / total) * SEG);
      dSeg = Math.max(0, SEG - aSeg);
      if (file.additions > 0 && aSeg === 0) aSeg = 1;
      if (file.deletions > 0 && dSeg === 0) dSeg = 1;
      const over = aSeg + dSeg - SEG;
      if (over > 0) dSeg -= over;
    }
    const wrap = document.createElement("span");
    wrap.className = "gdp-stat-squares";
    for (let i = 0; i < SEG; i++) {
      const box = document.createElement("span");
      if (i < aSeg) box.className = "sq add";
      else if (i < aSeg + dSeg) box.className = "sq del";
      else box.className = "sq nu";
      wrap.appendChild(box);
    }
    header.appendChild(wrap);
    if (!header.querySelector(".gdp-view-file")) {
      const viewFile = document.createElement("button");
      viewFile.type = "button";
      viewFile.className = "gdp-view-file gdp-btn gdp-btn-sm";
      setViewFileButtonState(viewFile, false);
      viewFile.addEventListener("click", (e) => {
        e.stopPropagation();
        const target = fileSourceTarget(file);
        setRoute({
          screen: "file",
          path: target.path,
          ref: target.ref,
          range: currentRange(),
        });
        applySourceRouteToShell();
      });
      header.appendChild(viewFile);
    } else {
      setViewFileButtonState(
        header.querySelector<HTMLButtonElement>(".gdp-view-file"),
        false,
      );
    }
  }

  function renderFile(
    file: FileMeta,
    data: FileDiffResponse,
    card: DiffCardElement,
  ) {
    card._diffData = data;
    card._file = file;
    card.classList.remove("loading", "pending");
    card.classList.add("loaded");
    card.style.minHeight = "";

    mountDiff(card, file, data);
    applyInlineAnnotations();
    const focused = applyDiffRouteFocus(card);
    // A shared/annotation URL can point at a line outside the diff hunks
    // (unchanged code). Expand the file context so the target is visible.
    if (
      !focused &&
      STATE.route.screen === "diff" &&
      STATE.route.path === file.path &&
      STATE.route.line &&
      !card.classList.contains("gdp-context-expanded")
    ) {
      void expandAllFileContext(card, file).then(() => {
        applyInlineAnnotations();
        applyDiffRouteFocus(card);
      });
    }
    // Another card finishing its lazy load can shift the already-focused
    // target line; re-anchor on it while the navigation window is open.
    if (
      performance.now() < REANCHOR_UNTIL &&
      STATE.route.screen === "diff" &&
      STATE.route.path !== file.path
    ) {
      applyDiffRouteFocus();
    }
    card.style.containIntrinsicSize = `${Math.max(card.offsetHeight, file.estimated_height_px || 200)}px`;
    applyViewedToCard(card, STATE.viewedFiles.has(file.path), true);

    if (data.truncated && data.mode === "preview") {
      addExpandHunksUI(file, data, card);
    }

    scheduleIdleHighlight(card, file);
  }

  function buildPreviewUrl(file: FileMeta, hunks: number): string {
    // Reuse load_url's query, swap mode/max_hunks
    const u = new URL(file.load_url, window.location.origin);
    u.searchParams.set("mode", "preview");
    u.searchParams.set("max_hunks", String(hunks));
    return u.pathname + u.search;
  }

  function addExpandHunksUI(
    file: FileMeta,
    data: FileDiffResponse,
    card: DiffCardElement,
  ) {
    const total = data.hunk_count || 0;
    const rendered = data.rendered_hunk_count || 0;
    const remaining = total - rendered;
    if (remaining <= 0) return;

    const old = card.querySelector(".gdp-show-full-wrap");
    if (old) old.remove();

    const wrap = document.createElement("div");
    wrap.className = "gdp-show-full-wrap";

    const step = Math.min(10, remaining);
    const moreBtn = document.createElement("button");
    moreBtn.className = "gdp-show-full";
    moreBtn.textContent = `Show next ${step} hunk${step === 1 ? "" : "s"}`;
    moreBtn.addEventListener("click", () => loadMore(rendered + step, false));

    const allBtn = document.createElement("button");
    allBtn.className = "gdp-show-full secondary";
    allBtn.textContent = `Show all (${remaining} remaining)`;
    allBtn.addEventListener("click", () => loadMore(total, true));

    const note = document.createElement("span");
    note.className = "gdp-hunk-note";
    note.textContent = `${rendered} / ${total} hunks shown`;

    wrap.appendChild(note);
    wrap.appendChild(moreBtn);
    wrap.appendChild(allBtn);
    card.appendChild(wrap);

    function loadMore(count: number, full: boolean) {
      moreBtn.disabled = allBtn.disabled = true;
      moreBtn.textContent = "Loading…";
      const myGen = SERVER_GENERATION;
      const url = full ? file.load_url : buildPreviewUrl(file, count);
      trackLoad<FileDiffResponse>(fetch(url).then((r) => r.json()))
        .then((next) => {
          if (myGen !== SERVER_GENERATION) {
            moreBtn.textContent = "Data changed — reload";
            moreBtn.disabled = allBtn.disabled = false;
            return;
          }
          wrap.remove();
          card._diffData = next;
          mountDiff(card, file, next);
          if (
            next.truncated ||
            (next.mode === "preview" &&
              next.hunk_count > next.rendered_hunk_count)
          ) {
            addExpandHunksUI(file, next, card);
          }
        })
        .catch(() => {
          moreBtn.disabled = allBtn.disabled = false;
          moreBtn.textContent = "Failed — retry";
        });
    }
  }

  // ---- Idle highlight ----
  // For files where initial highlight was off (size_class != small) we still
  // run highlight.js, but chunked over requestIdleCallback so it never blocks
  // the main thread. Huge files are skipped entirely.
  // Highlight only the rows freshly inserted by hunk expand. Synchronous —
  // the inserted batch is small (≤ STEP), so this is cheap.
  function highlightInsertedSpans(card: Element, file: FileMeta) {
    if (file.size_class === "huge") return;
    if (!STATE.syntaxHighlight) return;
    const hljsRef = getHljs();
    if (!hljsRef?.highlight) return;
    const lang = inferLang(file.path);
    if (!lang || !hljsRef.getLanguage?.(lang)) return;
    const spans = card.querySelectorAll<HTMLElement>(
      "tr.gdp-inserted-ctx .d2h-code-line-ctn:not([data-gdp-hl])",
    );
    spans.forEach((s) => {
      s.dataset.gdpHl = "1";
      const text = s.textContent || "";
      if (text.length === 0) return;
      try {
        s.innerHTML = hljsRef.highlight(text, {
          language: lang,
          ignoreIllegals: true,
        }).value;
        if (!s.classList.contains("hljs")) s.classList.add("hljs");
      } catch (_) {
        /* swallow */
      }
    });
  }

  function scheduleIdleHighlight(card: DiffCardElement, file: FileMeta) {
    if (file.highlight) return; // already highlighted at render time
    if (file.size_class === "huge") return; // skip
    if (!STATE.syntaxHighlight) return;
    if (!("requestIdleCallback" in window)) return;
    const hljsRef = getHljs();
    if (!hljsRef?.highlight) return;
    const lang = inferLang(file.path);
    if (!lang || !hljsRef.getLanguage?.(lang)) return;

    const work = (deadline: IdleDeadline) => {
      const spans = card.querySelectorAll<HTMLElement>(
        ".d2h-code-line-ctn:not([data-gdp-hl])",
      );
      let i = 0;
      while (i < spans.length && deadline.timeRemaining() > 4) {
        const s = spans[i++];
        s.dataset.gdpHl = "1";
        const text = s.textContent || "";
        if (text.length === 0) continue;
        try {
          s.innerHTML = hljsRef.highlight(text, {
            language: lang,
            ignoreIllegals: true,
          }).value;
          if (!s.classList.contains("hljs")) s.classList.add("hljs");
        } catch (_) {
          /* swallow */
        }
      }
      if (i < spans.length) requestIdleCallback(work, { timeout: 1500 });
    };
    requestIdleCallback(work, { timeout: 2000 });
  }

  // Per-card horizontal sync (same as old syncSideScroll, scoped to one card)
  function syncSideScrollCard(card: Element) {
    card.querySelectorAll(".d2h-files-diff").forEach((group) => {
      const sides = group.querySelectorAll<HTMLElement>(".d2h-code-wrapper");
      if (sides.length !== 2) return;
      const [a, b] = sides;
      let syncing = false;
      const mirror = (src: HTMLElement, dst: HTMLElement) => {
        if (syncing) return;
        syncing = true;
        dst.scrollLeft = src.scrollLeft;
        requestAnimationFrame(() => {
          syncing = false;
        });
      };
      a.addEventListener("scroll", () => mirror(a, b), { passive: true });
      b.addEventListener("scroll", () => mirror(b, a), { passive: true });
    });
  }

  // ---- media (image / video / audio) embedding for binary file diffs ----
  // ---- media embedding: extracted to media-embed.ts ----
  function setupScrollSpy() {
    const handler: ScrollSpyHandler = () => {
      if (handler._raf) return;
      if (performance.now() < SUPPRESS_SPY_UNTIL) return;
      handler._raf = requestAnimationFrame(() => {
        handler._raf = null;
        if (performance.now() < SUPPRESS_SPY_UNTIL) return;
        const topbarH =
          parseInt(
            getComputedStyle(document.documentElement).getPropertyValue(
              "--topbar-h",
            ),
            10,
          ) || 56;
        // Note: spy now targets .gdp-file-shell (placeholder + loaded both expose
        // data-path), instead of .d2h-file-wrapper which only exists post-render.
        const scanY = topbarH + 24;
        const cards = document.querySelectorAll<HTMLElement>(".gdp-file-shell");
        for (const w of cards) {
          const r = w.getBoundingClientRect();
          if (r.top <= scanY && r.bottom > scanY) {
            const text = w.dataset.path || "";
            let best: string | null = null,
              bestLen = 0;
            STATE.files.forEach((f) => {
              if (
                (text === f.path || text.endsWith(f.path)) &&
                f.path.length > bestLen
              ) {
                best = f.path;
                bestLen = f.path.length;
              }
            });
            if (best) {
              markActive(best);
              // Auto-scroll sidebar so the active item stays visible — but
              // only when the user is NOT currently interacting with the
              // sidebar. Otherwise lazy-render of huge diffs (40k+ lines)
              // fires window scroll, the spy yanks `li` into view, and
              // the user's manual sidebar scroll position is lost.
              const recentlyTouched =
                performance.now() - (window.__gdpSidebarTouchedAt || 0) < 1500;
              if (!recentlyTouched) {
                const li = document.querySelector<HTMLElement>(
                  `#filelist li[data-path="${CSS.escape(best)}"]`,
                );
                if (li) {
                  const sb = document.querySelector<HTMLElement>("#sidebar");
                  if (!sb) return;
                  const lr = li.getBoundingClientRect();
                  const sr = sb.getBoundingClientRect();
                  if (lr.top < sr.top + 40 || lr.bottom > sr.bottom - 40) {
                    li.scrollIntoView({ block: "nearest" });
                  }
                }
              }
            }
            return;
          }
        }
      });
    };
    // Remove previous listeners (avoid duplicates after re-render)
    if (window.__gdpScrollSpy)
      window.removeEventListener("scroll", window.__gdpScrollSpy);
    window.__gdpScrollSpy = handler;
    window.addEventListener("scroll", handler, { passive: true });
    handler(new Event("scroll"));
  }

  function _collapseAll(force?: boolean) {
    STATE.collapsed = typeof force === "boolean" ? force : !STATE.collapsed;
    document
      .querySelectorAll<HTMLElement>(".gdp-file-shell.loaded .d2h-file-wrapper")
      .forEach((w) => {
        const body = w.querySelector<HTMLElement>(
          ".d2h-files-diff, .d2h-file-diff",
        );
        if (body) body.style.display = STATE.collapsed ? "none" : "";
      });
  }

  // ----- wiring -----
  applySidebarFontSize();
  applyCodeFontSize();
  applySidebarHidden();
  observeSidebarHeaderHeight();
  hydrateRefSelectorMounts();
  setSidebarTreeActionIcons();
  // Sidebar view toggle (tree / flat)
  $$(".sb-view-seg button").forEach((b) => {
    b.addEventListener("click", () => {
      STATE.sbView = (b.dataset.view as SidebarView) || "tree";
      localStorage.setItem("gdp:sbview", STATE.sbView);
      if (SIDEBAR_FILES.length)
        renderSidebar(SIDEBAR_FILES, SIDEBAR_ON_FILE_CLICK);
    });
  });
  $("#sb-expand-all").addEventListener("click", () =>
    setAllSidebarDirsCollapsed(false),
  );
  $("#sb-collapse-all").addEventListener("click", () =>
    setAllSidebarDirsCollapsed(true),
  );
  $("#sidebar-toggle")?.addEventListener("click", toggleSidebarHidden);
  $("#viewer-settings")?.addEventListener("click", openScopeSettings);
  $("#scope-settings-close")?.addEventListener("click", closeScopeSettings);
  $("#scope-omit-save")?.addEventListener("click", saveScopeSettings);
  $("#scope-omit-reset")?.addEventListener("click", resetScopeSettings);
  $("#scope-settings-popover")?.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeScopeSettings();
  });
  prepareKeyboardPanels();
  const contentPanel = document.querySelector<HTMLElement>("#content");
  contentPanel?.addEventListener("focusin", () => setPanelFocusScope("main"));
  contentPanel?.addEventListener("mousedown", (event) => {
    if (isFocusableClickTarget(event.target)) setPanelFocusScope("main");
    else focusMainPanel();
  });

  // Sidebar resizer (drag right edge)
  function applySidebarWidth(w: number) {
    const cw = Math.max(180, Math.min(900, w));
    document.documentElement.style.setProperty("--sidebar-w", `${cw}px`);
    STATE.sbWidth = cw;
    localStorage.setItem("gdp:sbwidth", String(cw));
  }
  applySidebarWidth(STATE.sbWidth);
  // Track sidebar touch / wheel / scroll so the scrollSpy auto-scroll
  // doesn't fight against an active manual scroll. window.__gdpSidebarTouchedAt
  // is read by the spy.
  (function trackSidebarInteraction() {
    const sb = document.getElementById("sidebar");
    if (!sb) return;
    const mark = () => {
      window.__gdpSidebarTouchedAt = performance.now();
    };
    sb.addEventListener("wheel", mark, { passive: true });
    sb.addEventListener("mousedown", mark);
    sb.addEventListener("touchstart", mark, { passive: true });
    sb.addEventListener("scroll", mark, { passive: true });
    sb.addEventListener("focusin", () => setPanelFocusScope("sidebar"));
    sb.addEventListener("mousedown", (event) => {
      if (isFocusableClickTarget(event.target)) setPanelFocusScope("sidebar");
      else focusSidebarPanel();
    });
  })();
  (function setupResizer() {
    const handle = $("#sidebar-resizer");
    if (!handle) return;
    // Build a transient preview line so the heavy diff content doesn't
    // reflow on every mousemove. The real width is applied once on mouseup.
    const preview = document.createElement("div");
    preview.id = "sidebar-resize-preview";
    document.body.appendChild(preview);

    const MIN = 180,
      MAX = 900;
    const clamp = (w: number) => Math.max(MIN, Math.min(MAX, w));
    let dragging = false,
      startX = 0,
      startW = 0,
      currentW = 0;

    handle.addEventListener("mousedown", (e) => {
      dragging = true;
      startX = e.clientX;
      startW = STATE.sbWidth;
      currentW = startW;
      document.body.classList.add("gdp-resizing");
      preview.style.display = "block";
      preview.style.left = `${startW}px`;
      e.preventDefault();
    });
    window.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      currentW = clamp(startW + (e.clientX - startX));
      preview.style.left = `${currentW}px`;
    });
    window.addEventListener("mouseup", () => {
      if (!dragging) return;
      dragging = false;
      preview.style.display = "none";
      document.body.classList.remove("gdp-resizing");
      applySidebarWidth(currentW);
    });
    // double-click to reset
    handle.addEventListener("dblclick", () => applySidebarWidth(308));
  })();

  $$("#topbar .seg button").forEach((b) => {
    b.addEventListener("click", () =>
      setLayout((b.dataset.layout as LayoutMode) || "side-by-side"),
    );
  });
  $("#theme").addEventListener("click", () => {
    STATE.theme = STATE.theme === "dark" ? "light" : "dark";
    localStorage.setItem("gdp:theme", STATE.theme);
    applyTheme();
  });
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
  const ACTIVE_SIDEBAR_ITEM_SELECTOR =
    "#filelist li.active[data-path], #filelist .tree-dir.active[data-dirpath]";

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
      if (STATE.collapsedDirs.has(row.path) === collapsed) return;
      if (collapsed) STATE.collapsedDirs.add(row.path);
      else STATE.collapsedDirs.delete(row.path);
      localStorage.setItem(
        "gdp:collapsed-dirs",
        JSON.stringify([...STATE.collapsedDirs]),
      );
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
      setActiveSidebarDirectoryCollapsed(!STATE.collapsedDirs.has(row.path));
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
  function jumpToActiveOrFirstFilteredItem() {
    if (isVirtualSidebarActive()) {
      const current = virtualSidebarActiveIndex();
      selectVirtualSidebarIndex(current >= 0 ? current : 0, { open: true });
      $<HTMLInputElement>("#sb-filter").blur();
      return;
    }
    const items = visibleSidebarItems();
    const active = items.find((li) => li.classList.contains("active"));
    const target = active || items[0];
    if (target) {
      target.click();
      $<HTMLInputElement>("#sb-filter").blur();
    }
  }
  const sbFilter = $<HTMLInputElement>("#sb-filter");
  if (sbFilter) {
    sbFilter.addEventListener("input", () => scheduleApplyFilter());
    sbFilter.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        flushSidebarFilter();
        jumpToActiveOrFirstFilteredItem();
      } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        flushSidebarFilter();
        moveActiveSidebarItem(e.key === "ArrowDown" ? 1 : -1);
      } else if (e.key === "Escape") {
        if (sbFilter.value) {
          sbFilter.value = "";
          flushSidebarFilter();
          applyFilter();
        } else {
          sbFilter.blur();
        }
      }
    });
  }
  function focusFileFilter() {
    const input = $<HTMLInputElement>("#sb-filter");
    input.focus();
    input.select();
  }

  type PaletteMode = "file" | "grep";
  type PaletteFileItem = {
    kind: "file";
    path: string;
    old_path?: string;
    displayPath: string;
    ref: string;
    targetPath?: string;
    targetRef?: string;
    source: "diff" | "repo";
    ranges: FuzzyRange[];
  };
  type PaletteGrepItem = {
    kind: "grep";
    path: string;
    line: number;
    column: number;
    preview: string;
    ref: string;
    source: "diff" | "repo";
  };
  type PaletteItem = PaletteFileItem | PaletteGrepItem;
  type PaletteState = {
    root: HTMLElement;
    input: HTMLInputElement;
    controls: HTMLElement;
    list: HTMLElement;
    status: HTMLElement;
    mode: PaletteMode;
    grepRegex: boolean;
    selected: number;
    items: PaletteItem[];
    composing: boolean;
    controller?: AbortController;
    debounce?: number;
    diffSnapshot: FileMeta[];
    previousFocusScope: PanelFocusScope | null;
  };
  let PALETTE: PaletteState | null = null;
  const REPO_FILE_CACHE = new Map<string, FileSearchListResponse>();

  function paletteSource(): "diff" | "repo" {
    if (STATE.route.screen === "diff") return "diff";
    if (STATE.route.screen === "file" && STATE.route.view !== "blob")
      return "diff";
    return "repo";
  }

  function paletteRef(source: "diff" | "repo"): string {
    if (source === "diff")
      return STATE.to && STATE.to !== "worktree" ? STATE.to : "worktree";
    if (STATE.route.screen === "repo") return STATE.route.ref || "worktree";
    if (STATE.route.screen === "file") return STATE.route.ref || "worktree";
    return STATE.repoRef || "worktree";
  }

  function closeSearchPalette() {
    if (!PALETTE) return;
    const previousFocusScope = PALETTE.previousFocusScope;
    PALETTE.controller?.abort();
    if (PALETTE.debounce) window.clearTimeout(PALETTE.debounce);
    PALETTE.root.remove();
    PALETTE = null;
    restorePanelFocusScope(previousFocusScope);
  }

  function createPalette(mode: PaletteMode): PaletteState {
    const previousFocusScope = PALETTE
      ? PALETTE.previousFocusScope
      : getPanelFocusScope();
    closeSearchPalette();
    const root = document.createElement("div");
    root.className = "gdp-palette-backdrop";
    const dialog = document.createElement("div");
    dialog.className = "gdp-palette";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    const label = document.createElement("div");
    label.className = "gdp-palette-label";
    label.textContent = mode === "file" ? "Files" : "Grep";
    const input = document.createElement("input");
    input.className = "gdp-palette-input";
    input.type = "search";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.placeholder = mode === "file" ? "Search files" : "Search text";
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-expanded", "true");
    input.setAttribute("aria-controls", "gdp-palette-list");
    const status = document.createElement("div");
    status.className = "gdp-palette-status";
    const controls = document.createElement("div");
    controls.className = "gdp-palette-controls";
    const list = document.createElement("div");
    list.id = "gdp-palette-list";
    list.className = "gdp-palette-list";
    list.setAttribute("role", "listbox");
    dialog.append(label, input, controls, status, list);
    root.appendChild(dialog);
    document.body.appendChild(root);
    const state: PaletteState = {
      root,
      input,
      controls,
      list,
      status,
      mode,
      grepRegex: false,
      selected: -1,
      items: [],
      composing: false,
      diffSnapshot: [...STATE.files],
      previousFocusScope,
    };
    PALETTE = state;
    setPanelFocusScope(null);
    root.addEventListener("mousedown", (e) => {
      if (e.target === root) closeSearchPalette();
    });
    input.addEventListener("compositionstart", () => {
      state.composing = true;
    });
    input.addEventListener("compositionend", () => {
      state.composing = false;
    });
    input.addEventListener("input", () => updatePaletteResults(state));
    input.addEventListener("keydown", (e) => handlePaletteKeydown(e, state));
    input.focus();
    updatePaletteResults(state);
    return state;
  }

  function renderPaletteControls(state: PaletteState) {
    state.controls.innerHTML = "";
    if (state.mode === "file") {
      const hint = document.createElement("span");
      hint.className = "gdp-palette-mode-hint";
      hint.textContent = isGlobPathQuery(state.input.value)
        ? "Glob: * ? []"
        : "Fuzzy path search";
      state.controls.appendChild(hint);
      return;
    }
    const plain = document.createElement("button");
    plain.type = "button";
    plain.className = "gdp-palette-mode-button";
    plain.setAttribute("aria-pressed", String(!state.grepRegex));
    plain.textContent = "Plain";
    plain.addEventListener("mousedown", (e) => {
      e.preventDefault();
      state.grepRegex = false;
      renderPaletteControls(state);
      updatePaletteResults(state);
      state.input.focus();
    });
    const regex = document.createElement("button");
    regex.type = "button";
    regex.className = "gdp-palette-mode-button";
    regex.setAttribute("aria-pressed", String(state.grepRegex));
    regex.textContent = ".* Regex";
    regex.title = "Alt+R";
    regex.addEventListener("mousedown", (e) => {
      e.preventDefault();
      state.grepRegex = true;
      renderPaletteControls(state);
      updatePaletteResults(state);
      state.input.focus();
    });
    const hint = document.createElement("span");
    hint.className = "gdp-palette-mode-hint";
    hint.textContent = "Alt+R toggles regex";
    state.controls.append(plain, regex, hint);
  }

  function regexQueryIsValid(query: string): boolean {
    try {
      new RegExp(query);
      return true;
    } catch {
      return false;
    }
  }

  function appendHighlightedPath(
    parent: HTMLElement,
    path: string,
    ranges: FuzzyRange[],
  ) {
    let cursor = 0;
    for (const range of ranges) {
      if (range.start > cursor)
        parent.appendChild(
          document.createTextNode(path.slice(cursor, range.start)),
        );
      const mark = document.createElement("mark");
      mark.textContent = path.slice(range.start, range.end);
      parent.appendChild(mark);
      cursor = range.end;
    }
    if (cursor < path.length)
      parent.appendChild(document.createTextNode(path.slice(cursor)));
  }

  function renderPalette(state: PaletteState) {
    state.list.innerHTML = "";
    state.items.forEach((item, index) => {
      const row = document.createElement("button");
      row.type = "button";
      row.id = `gdp-palette-item-${index}`;
      row.className = "gdp-palette-row";
      row.setAttribute("role", "option");
      row.setAttribute(
        "aria-selected",
        index === state.selected ? "true" : "false",
      );
      const title = document.createElement("span");
      title.className = "gdp-palette-row-title";
      const detail = document.createElement("span");
      detail.className = "gdp-palette-row-detail";
      if (item.kind === "file") {
        title.textContent = item.path.split("/").pop() || item.path;
        appendHighlightedPath(detail, item.displayPath, item.ranges);
        if (item.old_path && item.displayPath !== item.old_path) {
          detail.appendChild(document.createTextNode(`  ${item.old_path}`));
        }
      } else {
        title.textContent = `${item.path}:${item.line}`;
        detail.textContent = item.preview;
      }
      row.append(title, detail);
      row.addEventListener("mouseenter", () => {
        state.selected = index;
        syncPaletteSelection(state);
      });
      row.addEventListener("mousedown", (e) => {
        e.preventDefault();
        state.selected = index;
        selectPaletteItem(state);
      });
      state.list.appendChild(row);
    });
    syncPaletteSelection(state);
  }

  function syncPaletteSelection(state: PaletteState) {
    state.input.setAttribute(
      "aria-activedescendant",
      state.selected >= 0 ? `gdp-palette-item-${state.selected}` : "",
    );
    state.list
      .querySelectorAll<HTMLElement>(".gdp-palette-row")
      .forEach((row, index) => {
        row.setAttribute(
          "aria-selected",
          index === state.selected ? "true" : "false",
        );
        if (index === state.selected) row.scrollIntoView({ block: "nearest" });
      });
  }

  async function repoPaletteFiles(
    ref: string,
  ): Promise<FileSearchListResponse> {
    const cacheKey = repoFileCacheKey(ref);
    const cached = REPO_FILE_CACHE.get(cacheKey);
    if (cached && cached.generation === SERVER_GENERATION) return cached;
    const params = new URLSearchParams();
    params.set("ref", ref);
    appendScopeParams(params);
    const res = await trackLoad<FileSearchListResponse>(
      fetch(`/_files?${params.toString()}`).then((r) => {
        if (!r.ok) throw new Error("failed to load files");
        return r.json();
      }),
    );
    REPO_FILE_CACHE.set(cacheKey, res);
    return res;
  }

  function diffFilePaletteItems(
    state: PaletteState,
    query: string,
  ): PaletteFileItem[] {
    const matchPath = isGlobPathQuery(query) ? globMatchPath : fuzzyMatchPath;
    const candidates = state.diffSnapshot
      .map((file) => {
        const current = matchPath(query, file.path);
        const old = file.old_path ? matchPath(query, file.old_path) : null;
        const best =
          old && (!current || old.score > current.score)
            ? { match: old, displayPath: file.old_path || file.path }
            : current
              ? { match: current, displayPath: file.path }
              : null;
        return best ? { file, ...best } : null;
      })
      .filter(
        (
          item,
        ): item is {
          file: FileMeta;
          match: { score: number; ranges: FuzzyRange[] };
          displayPath: string;
        } => item !== null,
      )
      .sort(
        (a, b) =>
          b.match.score - a.match.score ||
          a.file.path.localeCompare(b.file.path),
      );
    return limitPaletteResults(candidates).map((candidate) => ({
      kind: "file",
      path: candidate.file.path,
      old_path: candidate.file.old_path,
      displayPath: candidate.displayPath,
      ref: paletteRef("diff"),
      targetPath: fileSourceTarget(candidate.file).path,
      targetRef: fileSourceTarget(candidate.file).ref,
      source: "diff",
      ranges: candidate.match.ranges,
    }));
  }

  async function updateFilePalette(state: PaletteState, query: string) {
    renderPaletteControls(state);
    const source = paletteSource();
    if (!query.trim()) {
      const base =
        source === "diff"
          ? state.diffSnapshot.map((file) => {
              const target = fileSourceTarget(file);
              return {
                kind: "file" as const,
                path: file.path,
                old_path: file.old_path,
                displayPath: file.path,
                ref: paletteRef(source),
                targetPath: target.path,
                targetRef: target.ref,
                source,
                ranges: [],
              };
            })
          : [];
      state.items = limitPaletteResults(base);
      state.selected = state.items.length ? 0 : -1;
      state.status.textContent =
        source === "diff"
          ? `${state.diffSnapshot.length} diff files`
          : "Type to search repository files";
      renderPalette(state);
      return;
    }
    if (source === "diff") {
      state.items = diffFilePaletteItems(state, query);
    } else {
      state.status.textContent = "Loading files...";
      const ref = paletteRef(source);
      const response = await repoPaletteFiles(ref);
      if (PALETTE !== state || state.input.value !== query) return;
      state.items = limitPaletteResults(
        rankPathMatches(query, response.files),
      ).map((match) => ({
        kind: "file",
        path: match.item.path,
        displayPath: match.item.path,
        ref,
        source,
        ranges: match.ranges,
      }));
    }
    state.selected = state.items.length ? 0 : -1;
    state.status.textContent = state.items.length
      ? `${state.items.length} results`
      : "No results";
    renderPalette(state);
  }

  function updateGrepPalette(state: PaletteState, query: string) {
    renderPaletteControls(state);
    state.controller?.abort();
    if (state.debounce) window.clearTimeout(state.debounce);
    if (!query.trim()) {
      state.items = [];
      state.selected = -1;
      state.status.textContent = "Type to grep";
      renderPalette(state);
      return;
    }
    if (state.grepRegex && !regexQueryIsValid(query)) {
      state.controller?.abort();
      state.items = [];
      state.selected = -1;
      state.status.textContent = "Invalid regular expression";
      renderPalette(state);
      return;
    }
    state.status.textContent = "Searching...";
    state.debounce = window.setTimeout(() => {
      const source = paletteSource();
      const ref = paletteRef(source);
      const params = new URLSearchParams();
      params.set("ref", ref);
      params.set("q", query);
      params.set("max", "200");
      if (state.grepRegex) params.set("regex", "1");
      appendScopeParams(params);
      if (source === "diff") {
        for (const file of state.diffSnapshot) params.append("path", file.path);
      }
      const controller = new AbortController();
      state.controller = controller;
      trackLoad<GrepResponse>(
        fetch(`/_grep?${params.toString()}`, {
          signal: controller.signal,
        }).then((r) => {
          if (!r.ok) throw new Error("grep failed");
          return r.json();
        }),
      )
        .then((response) => {
          if (PALETTE !== state || controller.signal.aborted) return;
          state.items = limitPaletteResults(
            response.matches.map((match) => ({
              kind: "grep" as const,
              path: match.path,
              line: match.line,
              column: match.column,
              preview: match.preview,
              ref,
              source,
            })),
          );
          state.selected = state.items.length ? 0 : -1;
          state.status.textContent =
            response.engine +
            (state.grepRegex ? " regex" : " plain") +
            (response.truncated ? " truncated" : "") +
            " - " +
            state.items.length +
            " results";
          renderPalette(state);
        })
        .catch((err) => {
          if (isAbortError(err)) return;
          state.status.textContent = "Search failed";
        });
    }, 80);
  }

  function updatePaletteResults(state: PaletteState) {
    const query = state.input.value;
    if (state.mode === "file") {
      updateFilePalette(state, query).catch(() => {
        state.status.textContent = "Search failed";
      });
    } else {
      updateGrepPalette(state, query);
    }
  }

  function selectPaletteItem(state: PaletteState) {
    const item = state.items[state.selected];
    if (!item) return;
    closeSearchPalette();
    if (item.kind === "file") {
      if (item.source === "diff") {
        if (STATE.route.screen === "file") {
          setRoute({
            screen: "file",
            path: item.targetPath || item.path,
            ref: item.targetRef || item.ref,
            range: currentRange(),
          });
          applySourceRouteToShell();
        } else {
          scrollToFile(item.path);
        }
      } else {
        setRoute({
          screen: "file",
          path: item.path,
          ref: item.ref,
          view: "blob",
          range: currentRange(),
        });
        renderStandaloneSource({ path: item.path, ref: item.ref });
      }
      return;
    }
    if (item.source === "diff") {
      setRoute({
        screen: "diff",
        range: currentRange(),
        path: item.path,
        line: item.line,
      });
      scrollToFile(item.path, item.line);
    } else {
      setRoute({
        screen: "file",
        path: item.path,
        ref: item.ref,
        view: "blob",
        line: item.line,
        range: currentRange(),
      });
      renderStandaloneSource({ path: item.path, ref: item.ref });
    }
  }

  function handlePaletteKeydown(e: KeyboardEvent, state: PaletteState) {
    if (e.key === "Escape") {
      e.preventDefault();
      closeSearchPalette();
      return;
    }
    if (e.key === "Enter") {
      if (state.composing) return;
      e.preventDefault();
      selectPaletteItem(state);
      return;
    }
    if (state.mode === "grep" && e.altKey && e.key.toLowerCase() === "r") {
      e.preventDefault();
      state.grepRegex = !state.grepRegex;
      updatePaletteResults(state);
      return;
    }
    const direction =
      e.key === "ArrowDown" || (e.ctrlKey && e.key.toLowerCase() === "n")
        ? 1
        : e.key === "ArrowUp" || (e.ctrlKey && e.key.toLowerCase() === "p")
          ? -1
          : 0;
    if (direction) {
      e.preventDefault();
      state.selected = movePaletteSelection(
        state.selected,
        state.items.length,
        direction,
      );
      syncPaletteSelection(state);
    }
  }

  function openSearchPalette(mode: PaletteMode) {
    createPalette(mode);
  }

  function dispatchKeymapAction(
    action: KeymapAction,
    scope: KeymapScope,
    repeated = false,
  ): boolean {
    if (action !== "start-g-sequence") {
      PENDING_G_SCOPE = null;
      PENDING_G_UNTIL = 0;
    }
    if (action === "open-file-palette") {
      if (PALETTE?.mode !== "file") openSearchPalette("file");
      return true;
    }
    if (action === "open-grep-palette") {
      if (PALETTE?.mode !== "grep") openSearchPalette("grep");
      return true;
    }
    if (action === "focus-file-filter") {
      focusFileFilter();
      return true;
    }
    if (action === "focus-sidebar") {
      if (STATE.sidebarHidden) applySidebarHidden(false);
      focusSidebarPanel();
      return true;
    }
    if (action === "focus-main") {
      focusMainPanel();
      return true;
    }
    if (action === "cancel-source-load") {
      cancelActiveSourceLoad("esc");
      return true;
    }
    if (action === "open-sidebar-item") {
      if (!isRepositorySidebarMode()) return false;
      openActiveSidebarItem();
      focusMainPanel();
      return true;
    }
    if (action === "sidebar-next" || action === "sidebar-previous") {
      const repoSidebar = isRepositorySidebarMode();
      const direction = action === "sidebar-next" ? 1 : -1;
      const diffItems = repoSidebar
        ? []
        : $$<HTMLElement>(
            "#filelist li[data-path]:not(.hidden):not(.hidden-by-tests)",
          );
      let diffIndex = diffItems.findIndex((li) =>
        li.classList.contains("active"),
      );
      if (!repoSidebar)
        diffIndex =
          diffIndex < 0
            ? 0
            : Math.max(
                0,
                Math.min(diffItems.length - 1, diffIndex + direction),
              );
      const target = repoSidebar
        ? isVirtualSidebarActive()
          ? null
          : adjacentVisibleSidebarItem(direction)
        : diffItems[diffIndex];
      if (repoSidebar && isVirtualSidebarActive()) {
        const current = virtualSidebarActiveIndex();
        const start =
          current < 0
            ? direction === 1
              ? 0
              : SIDEBAR_VISIBLE_ROWS.length - 1
            : current + direction;
        const row = selectVirtualSidebarIndex(start);
        const next = row
          ? SIDEBAR_VISIBLE_ROWS[
              Math.max(
                0,
                Math.min(
                  SIDEBAR_VISIBLE_ROWS.length - 1,
                  SIDEBAR_VISIBLE_ROWS.indexOf(row) + direction,
                ),
              )
            ]
          : null;
        if (!repeated && next?.file) prefetchByPath(next.file.path);
        return true;
      }
      if (!target) return true;
      const path = sidebarItemPath(target);
      if (!repoSidebar && target) {
        target.click();
        scrollSidebarItemIntoView(target);
      } else if (path) {
        markActive(path);
        scrollSidebarItemIntoView(target);
      }
      const nextItem = repoSidebar
        ? visibleSidebarItemFrom(target, direction)
        : diffItems[
            Math.max(0, Math.min(diffItems.length - 1, diffIndex + direction))
          ];
      if (!repeated && nextItem && nextItem !== target && nextItem.dataset.path)
        prefetchByPath(nextItem.dataset.path);
      return true;
    }
    if (action === "sidebar-page-down" || action === "sidebar-page-up") {
      moveActiveSidebarPage(action === "sidebar-page-down" ? 1 : -1);
      return true;
    }
    if (action === "sidebar-expand") {
      if (!isRepositorySidebarMode()) return false;
      toggleActiveSidebarDirectoryCollapsed();
      return true;
    }
    if (action === "sidebar-collapse") {
      if (!isRepositorySidebarMode()) return false;
      setActiveSidebarDirectoryCollapsed(true);
      return true;
    }
    if (action === "scroll-main-down" || action === "scroll-main-up") {
      scrollMainPanel(action === "scroll-main-down" ? 1 : -1, repeated);
      return true;
    }
    if (
      action === "scroll-main-page-down" ||
      action === "scroll-main-page-up"
    ) {
      scrollMainPanel(
        action === "scroll-main-page-down" ? 1 : -1,
        repeated,
        "page",
      );
      return true;
    }
    if (action === "tab-preview" || action === "tab-code") {
      return switchSourceTab(action === "tab-preview" ? "preview" : "code");
    }
    if (action === "start-g-sequence") {
      PENDING_G_SCOPE = scope;
      PENDING_G_UNTIL = performance.now() + 900;
      return true;
    }
    if (action === "goto-top" || action === "goto-bottom") {
      const edge = action === "goto-top" ? "top" : "bottom";
      if (scope === "main") scrollMainToEdge(edge);
      else if (scope === "sidebar") moveActiveSidebarToEdge(edge);
      else
        window.scrollTo({
          top:
            edge === "top"
              ? 0
              : Math.max(
                  document.documentElement.scrollHeight,
                  document.body.scrollHeight,
                ),
          behavior: "auto",
        });
      return true;
    }
    if (action === "layout-unified") {
      setLayout("line-by-line");
      return true;
    }
    if (action === "layout-split") {
      setLayout("side-by-side");
      return true;
    }
    if (action === "toggle-theme") {
      $("#theme").click();
      return true;
    }
    return false;
  }

  document.addEventListener("keydown", handleVirtualSourcePagingKeydown, {
    capture: true,
  });
  document.addEventListener("click", closeRepoContextMenu);
  $("#filelist").addEventListener("contextmenu", handleSidebarContextMenu);

  document.addEventListener("keydown", async (e) => {
    if (e.key === "Escape") closeRepoContextMenu();
    if ((e as VirtualSourcePagingKeyboardEvent).__gdpVirtualSourcePagingHandled)
      return;
    const targetEl = e.target as Element | null;
    if (
      (e.ctrlKey || e.metaKey) &&
      !e.shiftKey &&
      !e.altKey &&
      e.key.toLowerCase() === "z" &&
      !isEditableKeyTarget(targetEl)
    ) {
      if (await undoLastAction()) e.preventDefault();
      return;
    }
    if (
      (e.ctrlKey || e.metaKey) &&
      e.key.toLowerCase() === "f" &&
      !isEditableKeyTarget(targetEl)
    ) {
      if (openVirtualSourceSearchFromKeyboard(targetEl)) {
        e.preventDefault();
        return;
      }
    }
    const scope = keymapScope(targetEl);
    const action = resolveKeymapAction(e, {
      scope,
      editable: isEditableKeyTarget(targetEl),
      composing: e.isComposing,
      paletteOpen: !!PALETTE,
      pendingG:
        PENDING_G_SCOPE === scope && performance.now() <= PENDING_G_UNTIL,
      lightboxOpen: !!document.querySelector(".mkdp-lightbox"),
    });
    if (!action) return;
    if (dispatchKeymapAction(action, scope, e.repeat)) e.preventDefault();
  });

  // ----- initial state + live updates -----
  applyTheme();
  setLayout(STATE.layout);
  setPageMode();
  if (window.location.pathname === "/") {
    setRoute(STATE.route, true);
  }

  function load(options: { force?: boolean } = {}): Promise<void> {
    if (STATE.route.screen === "help") {
      setStatus("live");
      renderHelpPage();
      syncHeaderMenu();
      return Promise.resolve();
    }
    if (STATE.route.screen === "repo") return loadRepo();
    setStatus("refreshing");
    const params = new URLSearchParams();
    if (STATE.ignoreWs) params.set("ignore_ws", "1");
    if (STATE.from) params.set("from", STATE.from);
    if (STATE.to) params.set("to", STATE.to);
    if (options.force) params.set("nocache", "1");
    const url = `/diff.json${params.toString() ? `?${params.toString()}` : ""}`;
    return trackLoad<DiffMeta>(fetch(url).then((r) => r.json()))
      .then((data) => {
        renderShell(data);
        setStatus("live");
      })
      .catch(() => setStatus("error"));
  }
  loadSettings().finally(() => {
    if (STATE.route.screen === "help") {
      setStatus("live");
      renderHelpPage();
    } else if (STATE.route.screen === "repo") loadRepo();
    else if (STATE.route.screen === "file" && STATE.route.view === "blob") {
      setStatus("live");
      applySourceRouteToShell();
    } else load();
  });

  // Ref picker (from / to)
  function syncRefInputs() {
    const fi = $<HTMLInputElement>("#ref-from"),
      ti = $<HTMLInputElement>("#ref-to");
    if (fi) fi.value = STATE.from;
    if (ti) ti.value = STATE.to;
  }
  function setRange(from: string, to: string) {
    STATE.from = from || "";
    STATE.to = to || "";
    localStorage.setItem("gdp:from", STATE.from);
    localStorage.setItem("gdp:to", STATE.to);
    syncRefInputs();
    const range = currentRange();
    if (STATE.route.screen === "file") {
      setRoute(
        { screen: "file", path: STATE.route.path, ref: STATE.route.ref, range },
        true,
      );
    } else if (STATE.route.screen === "help") {
      setRoute(
        {
          screen: "help",
          lang: helpLanguageFromRoute(STATE.route),
          section: helpSectionFromRoute(STATE.route),
          range,
        },
        true,
      );
      renderHelpPage();
    } else {
      setRoute({ screen: "diff", range }, true);
      load();
    }
  }
  syncRefInputs();
  syncHeaderMenu();

  createRefPicker({
    $,
    escapeHtml,
    currentRange,
    setRange,
    setRoute,
    renderStandaloneSource,
    getFrom: () => STATE.from,
    getTo: () => STATE.to,
    getRepoRef: () => STATE.repoRef,
    getRoute: () => STATE.route,
  });

  $("#ref-reset").addEventListener("click", () => setRange("HEAD", "worktree"));
  window.addEventListener("popstate", () => {
    const parsedRoute = parseRoute(
      window.location.pathname,
      window.location.search,
      currentRange(),
    );
    STATE.route =
      parsedRoute.screen === "unknown"
        ? { screen: "diff", range: parsedRoute.range }
        : parsedRoute;
    STATE.from = STATE.route.range.from;
    STATE.to = STATE.route.range.to;
    if (STATE.route.screen === "repo")
      STATE.repoRef = STATE.route.ref || "worktree";
    ANNOTATIONS_UI?.restoreSessionFromUrl();
    syncRefInputs();
    syncHeaderMenu();
    if (STATE.route.screen === "help") {
      cancelActiveSourceLoad("navigation");
      setPageMode();
      renderHelpPage();
      setStatus("live");
      return;
    }
    if (STATE.route.screen === "repo") {
      cancelActiveSourceLoad("navigation");
      setPageMode();
      removeStandaloneSource();
      loadRepo();
      return;
    }
    if (STATE.route.screen !== "file") {
      cancelActiveSourceLoad("navigation");
      setPageMode();
      removeStandaloneSource();
      load();
      return;
    }
    applySourceRouteToShell();
  });

  // Ignore-whitespace toggle
  function applyIgnoreWs() {
    const btn = $("#ignore-ws");
    if (btn) btn.classList.toggle("active", STATE.ignoreWs);
  }
  applyIgnoreWs();
  $("#ignore-ws").addEventListener("click", () => {
    STATE.ignoreWs = !STATE.ignoreWs;
    localStorage.setItem("gdp:ignore-ws", STATE.ignoreWs ? "1" : "0");
    applyIgnoreWs();
    load();
  });

  function setSyntaxHighlight(on: boolean) {
    STATE.syntaxHighlight = on;
    localStorage.setItem("gdp:syntax-highlight", on ? "1" : "0");
    setHighlightButton(on && getHljs() ? "loaded" : "idle");
    if (on) {
      loadSyntaxHighlighter().then((hljsRef) => {
        if (!hljsRef) return;
        rerenderLoadedDiffs();
      });
    } else {
      rerenderLoadedDiffs();
    }
  }

  setHighlightButton(STATE.syntaxHighlight && getHljs() ? "loaded" : "idle");
  $("#syntax-highlight").addEventListener("click", () => {
    setSyntaxHighlight(!STATE.syntaxHighlight);
  });
  if (STATE.syntaxHighlight) setSyntaxHighlight(true);

  // Manual reload button
  // Prominent reload button (next to ref-picker)
  $("#reload-prom").addEventListener("click", () => {
    const btn = $("#reload-prom");
    btn.classList.add("spinning");
    load().finally(() => {
      setTimeout(() => btn.classList.remove("spinning"), 200);
    });
  });

  window.addEventListener("storage", (e) => {
    if (e.key === "gdp:syntax-highlight")
      setSyntaxHighlight(e.newValue !== "0");
  });

  // Hide-tests toggle: ファイル名に test|spec が含まれるエントリをフィルタ。
  function applyHideTests() {
    const btn = $("#hide-tests");
    if (btn) btn.classList.toggle("active", STATE.hideTests);
    document
      .querySelectorAll<HTMLElement>(".gdp-file-shell")
      .forEach((card) => {
        const isTest = TEST_RE.test(card.dataset.path || "");
        card.classList.toggle("hidden-by-tests", STATE.hideTests && isTest);
      });
    document
      .querySelectorAll<HTMLElement>("#filelist li[data-path]")
      .forEach((li) => {
        const isTest = TEST_RE.test(li.dataset.path || "");
        li.classList.toggle("hidden-by-tests", STATE.hideTests && isTest);
      });
    if (isVirtualSidebarActive()) rerenderVirtualSidebar();
    else updateTreeDirVisibility();
    if (typeof applyViewedState === "function") applyViewedState();
  }
  applyHideTests();
  $("#hide-tests").addEventListener("click", () => {
    STATE.hideTests = !STATE.hideTests;
    localStorage.setItem("gdp:hide-tests", STATE.hideTests ? "1" : "0");
    applyHideTests();
  });

  // ---- Code annotations (AI walkthrough) ----
  // Panel + inline rows live in annotations-ui.ts; this wires it to the app.
  ANNOTATIONS_UI = createAnnotationsUi({
    $,
    diffCardSelector,
    diffRowLineNumber,
    focusDiffLine,
    scrollDiffElementIntoView,
    expandAllFileContext,
    scrollToFile,
    renderStandaloneSource,
    removeStandaloneSource,
    cancelActiveSourceLoad,
    setRoute,
    setPageMode,
    syncRefInputs,
    load,
    currentRange,
    getFiles: () => STATE.files,
    getRoute: () => STATE.route,
    setRange: (from, to) => {
      STATE.from = from;
      STATE.to = to;
      localStorage.setItem("gdp:from", from);
      localStorage.setItem("gdp:to", to);
    },
  });

  // Debounce SSE-driven reloads. Multiple BufWritePost in quick succession
  // collapse into one fetch. Scroll + active file are preserved across reload.
  let sseTimer: ReturnType<typeof setTimeout> | null = null;
  function scheduleSseLoad() {
    if (sseTimer) clearTimeout(sseTimer);
    sseTimer = setTimeout(() => {
      sseTimer = null;
      invalidateRepoSidebar();
      const savedScroll = window.scrollY;
      const savedActive = STATE.activeFile;
      load().then(() => {
        if (savedActive) {
          const card = document.querySelector<DiffCardElement>(
            diffCardSelector(savedActive),
          );
          if (card) {
            card.scrollIntoView({ block: "start" });
            return;
          }
        }
        window.scrollTo(0, savedScroll);
      });
    }, 350);
  }

  const es = new EventSource("/events");
  const catchUpGate = createCatchUpGate(() => Date.now(), 1000);
  let openedOnce = false;
  es.addEventListener("update", () => scheduleSseLoad());
  es.addEventListener("reload", () => location.reload());
  es.addEventListener("annotation", (event) => {
    ANNOTATIONS_UI?.handleSse((event as MessageEvent).data);
  });
  es.addEventListener("error", () => setStatus("error"));
  es.addEventListener("open", () => {
    setStatus("live");
    if (!openedOnce) {
      openedOnce = true;
      return;
    }
    catchUpDiff();
  });

  function catchUpDiff() {
    if (!shouldCatchUpDiff(STATE.route)) return;
    if (!catchUpGate()) return;
    void load({ force: true });
  }

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) catchUpDiff();
  });
  window.addEventListener("focus", catchUpDiff);
})();
