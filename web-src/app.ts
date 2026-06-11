import { createCatchUpGate, shouldCatchUpDiff } from "./core/catch-up";
import { GdpExpandLogic } from "./core/expand-logic";
import {
  findMainScrollTarget,
  focusMainPanel,
  focusSidebarPanel,
  isEditableKeyTarget,
  keymapScope,
  prepareKeyboardPanels,
  setPanelFocusScope,
} from "./core/focus-scope";
import {
  CHEVRON_DOWN_12_PATH,
  GIT_BRANCH_16_PATH,
  iconSvg,
  OPEN_EXTERNAL_16_PATH,
  TRIANGLE_DOWN_16_PATH,
} from "./core/icons";
import {
  type KeymapAction,
  type KeymapScope,
  resolveKeymapAction,
} from "./core/keymap";
import {
  type AppRoute,
  buildRoute,
  type DiffRange,
  parseRoute,
  type SourceLineTarget,
} from "./core/routes";
import type {
  DiffCardElement,
  DiffMeta,
  FileMeta,
  HljsApi,
  SettingsResponse,
  UndoActionResponse,
} from "./core/types";
import { createAnnotationsPlayer } from "./views/annotations-player";
import {
  type AnnotationsUi,
  createAnnotationsUi,
} from "./views/annotations-ui";
import { createDiffLineSelect } from "./views/diff-line-select";
import { createDiffView } from "./views/diff-view";
import {
  createHelpPage,
  helpLanguageFromRoute,
  helpSectionFromRoute,
} from "./views/help-page";
import { createHistoryView } from "./views/history-view";
import { createHunkExpand } from "./views/hunk-expand";
import { createLineRefPill } from "./views/line-ref-pill";
import { createRefPicker } from "./views/ref-picker";
import { createRepoView } from "./views/repo-view";
import { createSearchPalette } from "./views/search-palette-ui";
import {
  createSidebar,
  SIDEBAR_FONT_SIZE_KEY,
  type ViewerFontSize,
} from "./views/sidebar";
import {
  createSourceView,
  type VirtualSourcePagingKeyboardEvent,
} from "./views/source-view";

window.GdpExpandLogic = GdpExpandLogic;

(() => {
  type LayoutMode = "side-by-side" | "line-by-line";
  type SidebarView = "tree" | "flat";
  type ThemeMode = "light" | "dark";
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
  const TEST_RE = /(^|[/_.])(test|spec|__tests__)([/_.]|$)/i;
  let highlightLoadPromise: Promise<HljsApi | null> | null = null;
  let SERVER_SCOPE_OMIT_DIRS_DEFAULT: string[] = [];
  let SERVER_SCOPE_EXCLUDE_NAMES_DEFAULT: string[] = [];
  const UNDO_STACK: UndoActionResponse[] = [];
  let PENDING_G_SCOPE: KeymapScope | null = null;
  let PENDING_G_UNTIL = 0;

  const SCOPE_OMIT_DIRS_STORAGE_KEY_PREFIX = "gdp:scope-omit-dirs:";
  const SCOPE_EXCLUDE_NAMES_STORAGE_KEY_PREFIX = "gdp:scope-exclude-names:";
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
      if (seq !== MAIN_SURFACE_FOCUS_SEQ || isPaletteOpen()) return;
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

  function savedCodeFontSize(): ViewerFontSize {
    return normalizeViewerFontSize(
      localStorage.getItem(CODE_FONT_SIZE_STORAGE_KEY),
    );
  }

  function applyCodeFontSize(size: ViewerFontSize = savedCodeFontSize()) {
    document.body.dataset.codeFontSize = size;
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
      const repoLink =
        document.querySelector<HTMLAnchorElement>("#repo-web-link");
      if (repoLink && settings.repo_web_url) {
        repoLink.href = settings.repo_web_url;
        repoLink.hidden = false;
      }
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

  // ---------- Line reference copy (@path#start-end) ----------
  const LINE_REF_PILL = createLineRefPill();
  const DIFF_LINE_SELECT = createDiffLineSelect({ pill: LINE_REF_PILL });

  // The pill follows the file screen's line= route param; on the diff screen
  // diff-line-select owns it (after-side drag selection).
  function syncLineRefPill() {
    const route = STATE.route;
    if (route.screen === "diff") return;
    DIFF_LINE_SELECT.clear();
    if (route.screen === "file" && route.line) {
      const start =
        typeof route.line === "number" ? route.line : route.line.start;
      const end = typeof route.line === "number" ? route.line : route.line.end;
      LINE_REF_PILL.show(route.path, start, end);
    }
  }

  // ---------- Sidebar: extracted to sidebar.ts ----------
  const SIDEBAR = createSidebar({
    $,
    $$,
    STATE,
    scrollToFile: (path, line) =>
      DIFF_VIEW.scrollToFile(path, line as SourceLineTarget | undefined),
    prefetchByPath: (path) => DIFF_VIEW.prefetchByPath(path),
    fileBadge: (status) => DIFF_VIEW.fileBadge(status),
    fileEntryIcon: () => REPO_VIEW.fileEntryIcon(),
    applyViewedState: () => DIFF_VIEW.applyViewedState(),
    appendScopeParams,
    createOpenPathButton,
    normalizeViewerFontSize,
    scheduleMainSurfaceFocus,
    setChevronIcon,
    trackLoad,
    getRepoSidebarRef: () => REPO_SIDEBAR_REF,
    setRepoSidebarRef: (ref: string | null) => {
      REPO_SIDEBAR_REF = ref;
    },
    isTestPath: (path: string) => TEST_RE.test(path),
  });
  const {
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
    applySidebarHidden,
    toggleSidebarHidden,
    applySidebarWidth,
    applySidebarFontSize,
    savedSidebarFontSize,
    syncSidebarHeaderHeight,
    observeSidebarHeaderHeight,
    setSidebarTreeActionIcons,
    setAllSidebarDirsCollapsed,
    updateTreeDirVisibility,
    moveActiveSidebarItem,
    moveActiveSidebarPage,
    moveActiveSidebarToEdge,
    openActiveSidebarItem,
    setActiveSidebarDirectoryCollapsed,
    toggleActiveSidebarDirectoryCollapsed,
    isVirtualSidebarActive,
    selectVirtualSidebarIndex,
    virtualSidebarActiveIndex,
    adjacentVisibleSidebarItem,
    scrollSidebarItemIntoView,
    sidebarItemPath,
    visibleSidebarItems,
    getSidebarRowByPath,
    getSidebarVirtualActivePath,
    getSidebarFiles,
    getSidebarOnFileClick,
    getSidebarVisibleRows,
    visibleSidebarItemFrom,
  } = SIDEBAR;

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
    createFileBreadcrumb: (path, ref) =>
      DIFF_VIEW.createFileBreadcrumb(path, ref),
    createFileDetailMeta: (target, meta) =>
      REPO_VIEW.createFileDetailMeta(target, meta),
    createOpenPathButton,
    createMoveToTrashButton: (path, onDeleted) =>
      REPO_VIEW.createMoveToTrashButton(path, onDeleted),
    canTrashWorktreeRef: (ref) => REPO_VIEW.canTrashWorktreeRef(ref),
    loadRawFileInfo: (target) => REPO_VIEW.loadRawFileInfo(target),
    loadSyntaxHighlighter,
    setViewFileButtonState: (button, sourceMode) =>
      DIFF_VIEW.setViewFileButtonState(button, sourceMode),
    scrollMainPanel,
    focusMainSurface,
    isPaletteOpen: () => SEARCH_PALETTE.isPaletteOpen(),
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
    ensureVirtualSidebarDirLoaded,
    scrollVirtualSidebarPathIntoView,
    shouldLazyLoadSidebarDir,
    setFolderIcon,
    isRepositorySidebarMode,
    placeSidebarToggle,
    createOpenPathButton,
    removeStandaloneSource,
    renderStandaloneSource,
    repoFileTargetFromRoute,
    trackLoad,
    syncSidebarHeaderHeight,
    clearLoadQueue: () => DIFF_VIEW.clearLoadQueue(),
    getProjectName: () => PROJECT_NAME,
    getRepoSidebarRef: () => REPO_SIDEBAR_REF,
    setRepoSidebarRef: (ref: string | null) => {
      REPO_SIDEBAR_REF = ref;
    },
    syncHeaderMenu,
    getSidebarRowByPath,
    getSidebarVirtualActivePath,
    pushUndo: (undo: UndoActionResponse) => {
      UNDO_STACK.unshift(undo);
    },
  });
  const {
    loadRepo,
    renderRepoBlobSidebar,
    syncRepoTargetInput,
    closeRepoContextMenu,
    handleSidebarContextMenu,
    invalidateRepoSidebar,
    showTrashError,
  } = REPO_VIEW;

  // ---------- Search palette: extracted to search-palette-ui.ts ----------
  const SEARCH_PALETTE = createSearchPalette({
    STATE,
    setRoute,
    currentRange,
    appendScopeParams,
    isAbortError,
    scrollToFile: (path, line) =>
      DIFF_VIEW.scrollToFile(path, line as SourceLineTarget | undefined),
    applySourceRouteToShell,
    fileSourceTarget,
    renderStandaloneSource,
    repoFileCacheKey,
    trackLoad,
    getServerGeneration: () => SERVER_GENERATION,
  });
  const { openSearchPalette, isPaletteOpen, paletteMode, clearRepoFileCache } =
    SEARCH_PALETTE;

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

  function setChevronIcon(el: HTMLElement) {
    el.innerHTML =
      '<svg class="octicon octicon-chevron-down" viewBox="0 0 12 12" width="12" height="12" fill="currentColor" aria-hidden="true">' +
      '<path fill="currentColor" d="' +
      CHEVRON_DOWN_12_PATH +
      '"></path></svg>';
  }

  function scopeOmitSourceLabel(): string {
    return savedScopeOmitDirs() != null || savedScopeExcludeNames() != null
      ? "Browser override"
      : "Server default";
  }

  function refreshRepositoryTreeAfterSettings() {
    clearRepoFileCache();
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

  function toggleScopeSettings() {
    const pop = document.querySelector<HTMLElement>("#scope-settings-popover");
    if (pop && !pop.hidden) {
      closeScopeSettings();
      return;
    }
    void openScopeSettings();
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
      SIDEBAR_FONT_SIZE_KEY,
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
    localStorage.removeItem(SIDEBAR_FONT_SIZE_KEY);
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

  // While we're animating a programmatic scroll (e.g. from a sidebar click),
  // suppress scrollspy so the user-chosen active item doesn't flicker through
  // every file the scroll passes over.

  // Prefetch a file's diff (low priority). Used for sidebar hover and j/k.

  // ============================================================
  // Lazy per-file rendering pipeline
  // ============================================================
  let SERVER_GENERATION = 0;

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
    syncLineRefPill();
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
    document.body.classList.toggle(
      "gdp-history-page",
      STATE.route.screen === "history",
    );
    const historyPanel = $("#history-panel");
    if (historyPanel) historyPanel.hidden = STATE.route.screen !== "history";
    if (STATE.route.screen === "history") {
      const historyRefInput = $<HTMLInputElement>("#history-ref");
      if (historyRefInput) historyRefInput.value = STATE.route.ref || "HEAD";
    }
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
        if (link.dataset.route === "history") {
          link.href = buildRoute({
            screen: "history",
            ref: "HEAD",
            range: currentRange(),
          });
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

  // ---------- Help page: extracted to help-page.ts ----------
  const { renderHelpPage } = createHelpPage({
    $,
    getRoute: () => STATE.route,
    setRoute,
    setPageMode,
    cancelActiveSourceLoad,
    removeStandaloneSource,
    clearLoadQueue: () => DIFF_VIEW.clearLoadQueue(),
    currentRange,
    syncHeaderMenu,
  });

  // ---------- Hunk expand: extracted to hunk-expand.ts ----------
  const { setupHunkExpand } = createHunkExpand({
    trackLoad,
    getServerGeneration: () => SERVER_GENERATION,
    getToRef: () =>
      STATE.to && STATE.to !== "worktree" ? STATE.to : "worktree",
    highlightInsertedSpans: (card, file) =>
      DIFF_VIEW.highlightInsertedSpans(card, file),
  });

  // ---------- Diff view: extracted to views/diff-view.ts ----------
  const DIFF_VIEW = createDiffView({
    $,
    $$,
    STATE,
    setRoute,
    currentRange,
    escapeHtml,
    trackLoad,
    diffCardSelector,
    getHljs,
    inferLang: (path: string) => SOURCE_VIEW.inferLang(path),
    lineTargetStart: (line) => SOURCE_VIEW.lineTargetStart(line),
    fileSourceTarget: (file) => SOURCE_VIEW.fileSourceTarget(file),
    applySourceRouteToShell: () => SOURCE_VIEW.applySourceRouteToShell(),
    setupHunkExpand,
    applyInlineAnnotations,
    applyFilter: () => SIDEBAR.applyFilter(),
    markActive: (path, options) => SIDEBAR.markActive(path, options),
    renderSidebar: (files, onFileClick) =>
      SIDEBAR.renderSidebar(files, onFileClick as never),
    isRepositorySidebarMode: () => SIDEBAR.isRepositorySidebarMode(),
    loadRepo: () => REPO_VIEW.loadRepo(),
    repoRoute: (ref, path) => REPO_VIEW.repoRoute(ref, path),
    setProjectName,
    getProjectName: () => PROJECT_NAME,
    createOpenPathButton,
    applyHideTests: () => applyHideTests(),
    getServerGeneration: () => SERVER_GENERATION,
    setServerGeneration: (generation: number) => {
      SERVER_GENERATION = generation;
    },
  });
  const {
    renderShell,
    rerenderLoadedDiffs,
    mountDiff,
    addExpandHunksUI,
    scheduleIdleHighlight,
    scrollToFile,
    prefetchByPath,
    diffRowLineNumber,
    focusDiffLine,
    scrollDiffElementIntoView,
    expandAllFileContext,
    applyViewedState,
    enqueueInitialLoads,
  } = DIFF_VIEW;

  // GitHub-style diff squares: 5 small filled boxes (green/red/grey)
  // appended to the right edge of the file header.

  // ---- Idle highlight ----
  // For files where initial highlight was off (size_class != small) we still
  // run highlight.js, but chunked over requestIdleCallback so it never blocks
  // the main thread. Huge files are skipped entirely.
  // Highlight only the rows freshly inserted by hunk expand. Synchronous —
  // the inserted batch is small (≤ STEP), so this is cheap.

  // Per-card horizontal sync (same as old syncSideScroll, scoped to one card)

  // ---- media (image / video / audio) embedding for binary file diffs ----
  // ---- media embedding: extracted to media-embed.ts ----

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
      if (getSidebarFiles().length)
        renderSidebar(getSidebarFiles(), getSidebarOnFileClick());
    });
  });
  $("#sb-expand-all").addEventListener("click", () =>
    setAllSidebarDirsCollapsed(false),
  );
  $("#sb-collapse-all").addEventListener("click", () =>
    setAllSidebarDirsCollapsed(true),
  );
  $("#sidebar-toggle")?.addEventListener("click", toggleSidebarHidden);
  $("#viewer-settings")?.addEventListener("click", toggleScopeSettings);
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
      if (paletteMode() !== "file") openSearchPalette("file");
      return true;
    }
    if (action === "open-grep-palette") {
      if (paletteMode() !== "grep") openSearchPalette("grep");
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
              : getSidebarVisibleRows().length - 1
            : current + direction;
        const row = selectVirtualSidebarIndex(start);
        const next = row
          ? getSidebarVisibleRows()[
              Math.max(
                0,
                Math.min(
                  getSidebarVisibleRows().length - 1,
                  getSidebarVisibleRows().indexOf(row) + direction,
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
    if (action === "annotation-next" || action === "annotation-previous") {
      ANNOTATIONS_UI?.stepAnnotation(action === "annotation-next" ? 1 : -1);
      // Hand focus to the code surface so j / k scroll the jumped-to code
      // instead of moving the sidebar selection (global scope).
      scheduleMainSurfaceFocus();
      return true;
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
      paletteOpen: isPaletteOpen(),
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
    // The history screen rewrites the #empty heading/body for its
    // no-commit-selected state; restore copy that matches the current screen
    // so a clean worktree or an empty commit does not show stale text.
    {
      const empty = $("#empty");
      if (empty) {
        const onHistory = STATE.route.screen === "history";
        const h2 = empty.querySelector("h2");
        if (h2) h2.textContent = onHistory ? "Empty diff" : "No changes";
        const p = empty.querySelector("p");
        if (p)
          p.textContent = onHistory
            ? "This commit has no changes against its first parent."
            : "The working tree is clean against this ref.";
      }
    }
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
    } else if (STATE.route.screen === "history") {
      setStatus("live");
      HISTORY_VIEW.enterHistory();
    } else load();
    // Deep links land here without going through setRoute; reflect a line=
    // selection in the copy pill on first paint too.
    syncLineRefPill();
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
      // Leaving the history screen here: drop its body class and panel layout.
      setPageMode();
      load();
    }
  }
  syncRefInputs();
  syncHeaderMenu();

  const HISTORY_VIEW = createHistoryView({
    $,
    escapeHtml,
    getRoute: () => STATE.route,
    setRoute,
    applyCommitRange: (range) => {
      STATE.from = range.from;
      STATE.to = range.to;
      syncRefInputs();
      return load();
    },
    showEmptyDiffPane: () => {
      const diff = $("#diff");
      if (diff) diff.innerHTML = "";
      const empty = $("#empty");
      if (empty) {
        empty.classList.remove("hidden");
        const h2 = empty.querySelector("h2");
        if (h2) h2.textContent = "No commit selected";
        const p = empty.querySelector("p");
        if (p)
          p.textContent = "Select a commit from the list to see its changes.";
      }
      setStatus("live");
    },
    trackLoad,
  });

  const REF_PICKER = createRefPicker({
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
  if (REF_PICKER) {
    const historyRefInput =
      document.querySelector<HTMLInputElement>("#history-ref");
    if (historyRefInput) {
      historyRefInput.value = "HEAD";
      REF_PICKER.wireRefSelectorInput(historyRefInput, (ref) =>
        HISTORY_VIEW.onRefPicked(ref),
      );
    }
  }

  $("#ref-reset").addEventListener("click", () => setRange("HEAD", "worktree"));
  function applyRouteFromLocation() {
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
    syncLineRefPill();
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
    if (STATE.route.screen === "history") {
      cancelActiveSourceLoad("navigation");
      setPageMode();
      removeStandaloneSource();
      HISTORY_VIEW.enterHistory();
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
  }
  window.addEventListener("popstate", applyRouteFromLocation);

  // Header menu links navigate within the SPA. A full page load here
  // re-lays-out the whole app from scratch (the layout shift the menu was
  // notorious for); pushState + the shared route handler keeps the chrome
  // stable. Modified clicks (new tab etc.) keep native anchor behavior.
  document
    .querySelectorAll<HTMLAnchorElement>(".app-menu-item, .global-help-link")
    .forEach((link) => {
      link.addEventListener("click", (e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0)
          return;
        e.preventDefault();
        const target = new URL(link.href, window.location.origin);
        history.pushState(null, "", target.pathname + target.search);
        // Mimic a fresh page load: menu navigation starts at the top.
        window.scrollTo(0, 0);
        applyRouteFromLocation();
      });
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

  createAnnotationsPlayer({
    $,
    getActiveSessionEntries: () =>
      ANNOTATIONS_UI?.getActiveSessionEntries() ?? [],
    openAnnotationEntry: (id) =>
      ANNOTATIONS_UI
        ? ANNOTATIONS_UI.openAnnotationEntry(id)
        : Promise.resolve(),
    setAnnotationPanelOpen: (open) =>
      ANNOTATIONS_UI?.setAnnotationPanelOpen(open),
    onAnnotationsChanged: (cb) => ANNOTATIONS_UI?.onAnnotationsChanged(cb),
    onAnnotationOpened: (cb) => ANNOTATIONS_UI?.onAnnotationOpened(cb),
    getActiveAnnotationId: () =>
      ANNOTATIONS_UI ? ANNOTATIONS_UI.getActiveAnnotationId() : null,
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
