import {
  AI_CONTEXT_LARGE_SELECTION_LINE_THRESHOLD,
  aiContextClipboardText,
  resolveSelectionTarget,
} from "./core/ai-context-copy";
import {
  createCatchUpGate,
  shouldAutoLoadForRoute,
  shouldCatchUpDiff,
} from "./core/catch-up";
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
import { ensureTerraformHighlightLanguage } from "./core/highlight-languages";
import {
  CHEVRON_DOWN_12_PATH,
  COMMENT_DISCUSSION_16_PATH,
  COPY_16_PATHS,
  GIT_BRANCH_16_PATH,
  iconSvg,
  MOON_16_PATH,
  OPEN_EXTERNAL_16_PATH,
  PULSE_16_PATH,
  SYNC_16_PATH,
  TRIANGLE_DOWN_16_PATH,
  X_16_PATH,
} from "./core/icons";
import { isImeComposing } from "./core/keyboard";
import {
  type KeymapAction,
  type KeymapScope,
  resolveKeymapAction,
} from "./core/keymap";
import { createNetworkActivityTracker } from "./core/network-activity";
import {
  type AppRoute,
  buildRoute,
  type DiffRange,
  parseDoctorOverlay,
  parseRoute,
  type SourceLineTarget,
  withDoctorOverlay,
} from "./core/routes";
import { sourceInternalPathKind } from "./core/source-meta";
import type {
  AppSettingsState,
  DiffCardElement,
  DiffMeta,
  FileMeta,
  HljsApi,
  SettingsResponse,
  UndoActionResponse,
  ViewState,
} from "./core/types";
import { createAnnotationsPlayer } from "./views/annotations-player";
import {
  type AnnotationsUi,
  createAnnotationsUi,
} from "./views/annotations-ui";
import { createBlameView } from "./views/blame-view";
import { createDatabaseView } from "./views/database/database-view";
import { createDiffLineSelect } from "./views/diff-line-select";
import { createDiffView, type RenderResult } from "./views/diff-view";
import { createDoctorView, doctorText } from "./views/doctor-view";
import { showEmptyHistoryDiffPane } from "./views/empty-diff-pane";
import {
  removeFileHistoryShell as removeRenderedFileHistoryShell,
  renderFileHistoryShell as renderFileHistoryShellView,
} from "./views/file-history-shell";
import { isBlobOrBlameFileRoute } from "./views/file-shell";
import {
  createHelpPage,
  helpLanguageFromRoute,
  helpSectionFromRoute,
  openHelpKeybindings,
} from "./views/help-page";
import { createHistoryView, installHistoryPageDom } from "./views/history-view";
import { createHunkExpand } from "./views/hunk-expand";
import {
  createJournalView,
  type JournalView,
  type JournalViewText,
} from "./views/journal-view";
import {
  createLineRefPill,
  langFromPath,
  readRenderedLines,
} from "./views/line-ref-pill";
import { createQuickHelp } from "./views/quick-help";
import { createRefPicker } from "./views/ref-picker";
import { createRepoView } from "./views/repo-view";
import { createSearchPalette } from "./views/search-palette-ui";
import { createSidebar, type ViewerFontSize } from "./views/sidebar";
import {
  createSourceView,
  type VirtualSourcePagingKeyboardEvent,
} from "./views/source-view";

window.GdpExpandLogic = GdpExpandLogic;

(() => {
  type LayoutMode = "side-by-side" | "line-by-line";
  type SidebarView = "tree" | "flat";
  type ThemeMode = "light" | "dark";
  type ViewerLanguage = "en" | "ja";
  type AppState = {
    layout: LayoutMode;
    theme: ThemeMode;
    language: ViewerLanguage;
    sbView: SidebarView;
    sbWidth: number;
    historyWidth: number;
    sidebarHidden: boolean;
    collapsedDirs: Set<string>;
    lazyExpandedDirs: Set<string>;
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
    autoUpdate: boolean;
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
  let SERVER_SCOPE_WATCH_LIMIT_DEFAULT = 1024;
  let SERVER_SCOPE_WATCH_LIMIT_MIN = 16;
  let SERVER_SCOPE_WATCH_LIMIT_MAX = 65536;
  const UNDO_STACK: UndoActionResponse[] = [];
  let PENDING_G_SCOPE: KeymapScope | null = null;
  let PENDING_G_UNTIL = 0;

  let PROJECT_NAME = "";

  let APP_SETTINGS: AppSettingsState = { version: 1 };
  let VIEW_STATE: ViewState = {
    version: 1,
    collapsedDirs: [],
    lazyExpandedDirs: [],
    viewedFiles: [],
  };

  const NETWORK_ACTIVITY = createNetworkActivityTracker({
    onChange: updateNetworkActivity,
  });
  NETWORK_ACTIVITY.installFetch(window);

  function updateNetworkActivity(state = NETWORK_ACTIVITY.getState()): void {
    const loadBar = document.querySelector<HTMLElement>("#load-bar");
    if (loadBar) loadBar.classList.toggle("active", state.inFlight > 0);
    const text = uiText().global;
    const statusEl = document.querySelector<HTMLElement>("#status");
    if (statusEl) {
      statusEl.title =
        state.inFlight > 0
          ? text.statusInFlightTitle(state.inFlight, state.cancellable)
          : (statusEl.querySelector<HTMLElement>(".status-label")
              ?.textContent ?? "");
    }
    const cancelButton =
      document.querySelector<HTMLButtonElement>("#cancel-requests");
    if (!cancelButton) return;
    const cancellable = state.cancellable > 0;
    cancelButton.disabled = !cancellable;
    cancelButton.classList.toggle("active", cancellable);
    const cancelTitle = cancellable
      ? text.cancelRequestsActiveTitle(state.cancellable)
      : text.cancelRequestsInactiveTitle;
    cancelButton.title = cancelTitle;
    cancelButton.setAttribute("aria-label", cancelTitle);
  }

  function cancelInFlightRequests(): void {
    NETWORK_ACTIVITY.cancelAll();
    updateNetworkActivity();
  }

  const VIEWER_LANGUAGES: ViewerLanguage[] = ["en", "ja"];
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

  function setProjectBranch(branch: string) {
    const el = document.querySelector<HTMLElement>("#project-branch");
    if (!el) return;
    el.hidden = !branch;
    el.textContent = branch;
    el.title = branch ? `Current branch: ${branch}` : "";
  }

  type SettingsPatch = Partial<Omit<AppSettingsState, "version">> &
    Record<string, unknown>;
  type ViewPatch = {
    addedViewedFiles?: string[];
    removedViewedFiles?: string[];
    addedCollapsedDirs?: string[];
    removedCollapsedDirs?: string[];
    addedLazyExpandedDirs?: string[];
    removedLazyExpandedDirs?: string[];
  };

  function mergeLocalSettings(patch: SettingsPatch): void {
    const next = { ...APP_SETTINGS } as Record<string, unknown>;
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) delete next[key];
      else next[key] = value;
    }
    APP_SETTINGS = { version: 1, ...next } as AppSettingsState;
  }

  function actionHeaders(): HeadersInit {
    return {
      "Content-Type": "application/json",
      "X-Code-Viewer-Action": "1",
    };
  }

  function patchSettings(
    patch: SettingsPatch,
    options: { keepalive?: boolean } = {},
  ): void {
    mergeLocalSettings(patch);
    const body = JSON.stringify(patch);
    void fetch("/_state/settings", {
      method: "PATCH",
      headers: actionHeaders(),
      body,
      keepalive: options.keepalive,
    }).catch(() => undefined);
  }

  let pendingViewPatch: ViewPatch | null = null;
  let pendingViewTimer: ReturnType<typeof setTimeout> | null = null;

  function mergePathDelta(
    next: ViewPatch,
    base: ViewPatch | null,
    patch: ViewPatch,
    addKey: "addedViewedFiles" | "addedCollapsedDirs" | "addedLazyExpandedDirs",
    removeKey:
      | "removedViewedFiles"
      | "removedCollapsedDirs"
      | "removedLazyExpandedDirs",
  ): void {
    const added = new Set(base?.[addKey] || []);
    const removed = new Set(base?.[removeKey] || []);
    for (const path of patch[addKey] || []) {
      removed.delete(path);
      added.delete(path);
      added.add(path);
    }
    for (const path of patch[removeKey] || []) {
      added.delete(path);
      removed.delete(path);
      removed.add(path);
    }
    if (added.size > 0) next[addKey] = [...added];
    else delete next[addKey];
    if (removed.size > 0) next[removeKey] = [...removed];
    else delete next[removeKey];
  }

  function mergeViewPatch(base: ViewPatch | null, patch: ViewPatch): ViewPatch {
    const next: ViewPatch = { ...(base || {}), ...patch };
    mergePathDelta(next, base, patch, "addedViewedFiles", "removedViewedFiles");
    mergePathDelta(
      next,
      base,
      patch,
      "addedCollapsedDirs",
      "removedCollapsedDirs",
    );
    mergePathDelta(
      next,
      base,
      patch,
      "addedLazyExpandedDirs",
      "removedLazyExpandedDirs",
    );
    return next;
  }

  function mergeLocalViewState(state: ViewState, patch: ViewPatch): ViewState {
    const viewedFiles = new Set(state.viewedFiles);
    for (const path of patch.addedViewedFiles || []) viewedFiles.add(path);
    for (const path of patch.removedViewedFiles || []) viewedFiles.delete(path);
    const collapsedDirs = new Set(state.collapsedDirs);
    const lazyExpandedDirs = new Set(state.lazyExpandedDirs);
    for (const path of patch.addedCollapsedDirs || []) {
      collapsedDirs.add(path);
      lazyExpandedDirs.delete(path);
    }
    for (const path of patch.removedCollapsedDirs || [])
      collapsedDirs.delete(path);
    for (const path of patch.addedLazyExpandedDirs || []) {
      if (!collapsedDirs.has(path)) lazyExpandedDirs.add(path);
    }
    for (const path of patch.removedLazyExpandedDirs || [])
      lazyExpandedDirs.delete(path);
    return {
      version: 1,
      collapsedDirs: [...collapsedDirs],
      lazyExpandedDirs: [...lazyExpandedDirs],
      viewedFiles: [...viewedFiles],
    };
  }

  function patchViewState(
    patch: ViewPatch,
    options: { debounce?: boolean; keepalive?: boolean } = {},
  ): void {
    VIEW_STATE = mergeLocalViewState(VIEW_STATE, patch);
    pendingViewPatch = mergeViewPatch(pendingViewPatch, patch);
    const send = (keepalive = false) => {
      if (!pendingViewPatch) return;
      const body = JSON.stringify(pendingViewPatch);
      pendingViewPatch = null;
      void fetch("/_state/view", {
        method: "PATCH",
        headers: actionHeaders(),
        body,
        keepalive,
      }).catch(() => undefined);
    };
    if (options.keepalive) {
      if (pendingViewTimer !== null) clearTimeout(pendingViewTimer);
      pendingViewTimer = null;
      send(true);
      return;
    }
    if (options.debounce === false) {
      if (pendingViewTimer !== null) clearTimeout(pendingViewTimer);
      pendingViewTimer = null;
      send();
      return;
    }
    if (pendingViewTimer !== null) clearTimeout(pendingViewTimer);
    pendingViewTimer = setTimeout(() => {
      pendingViewTimer = null;
      send();
    }, 300);
  }

  function flushViewStatePatch(keepalive = false): void {
    if (!pendingViewPatch) return;
    if (pendingViewTimer !== null) clearTimeout(pendingViewTimer);
    pendingViewTimer = null;
    const body = JSON.stringify(pendingViewPatch);
    pendingViewPatch = null;
    void fetch("/_state/view", {
      method: "PATCH",
      headers: actionHeaders(),
      body,
      keepalive,
    }).catch(() => undefined);
  }

  function savedScopeOmitDirs(): string[] | null {
    return APP_SETTINGS.scopeOmitDirs
      ? normalizeScopeOmitDirs(APP_SETTINGS.scopeOmitDirs)
      : null;
  }

  function savedScopeExcludeNames(): string[] | null {
    return APP_SETTINGS.scopeExcludeNames
      ? normalizeScopeExcludeNames(APP_SETTINGS.scopeExcludeNames)
      : null;
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

  function normalizeViewerLanguage(value: unknown): ViewerLanguage {
    return VIEWER_LANGUAGES.includes(value as ViewerLanguage)
      ? (value as ViewerLanguage)
      : "en";
  }

  function savedViewerLanguage(): ViewerLanguage {
    return normalizeViewerLanguage(APP_SETTINGS.language);
  }

  function viewerLanguageFromSearch(search: string): ViewerLanguage | null {
    const raw = new URLSearchParams(search).get("lang");
    return raw ? normalizeViewerLanguage(raw) : null;
  }

  function savedCodeFontSize(): ViewerFontSize {
    return normalizeViewerFontSize(APP_SETTINGS.codeFontSize);
  }

  function applyCodeFontSize(size: ViewerFontSize = savedCodeFontSize()) {
    document.body.dataset.codeFontSize = size;
  }

  function savedSidebarFontSizeSetting(): ViewerFontSize {
    return normalizeViewerFontSize(APP_SETTINGS.sidebarFontSize);
  }

  function savedLayout(): LayoutMode {
    return APP_SETTINGS.layout === "line-by-line"
      ? "line-by-line"
      : "side-by-side";
  }

  function savedTheme(): ThemeMode {
    return APP_SETTINGS.theme === "light" || APP_SETTINGS.theme === "dark"
      ? APP_SETTINGS.theme
      : matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
  }

  function savedSidebarView(): SidebarView {
    return APP_SETTINGS.sidebarView === "flat" ? "flat" : "tree";
  }

  function savedNumber(
    value: unknown,
    fallback: number,
    min: number,
    max: number,
  ): number {
    return typeof value === "number" && Number.isFinite(value)
      ? Math.max(min, Math.min(max, Math.round(value)))
      : fallback;
  }

  function savedRange(): DiffRange {
    return APP_SETTINGS.range || DEFAULT_RANGE;
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
      setProjectBranch(settings.branch || "");
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
      if (typeof settings.scope.watch_limit_default === "number")
        SERVER_SCOPE_WATCH_LIMIT_DEFAULT = settings.scope.watch_limit_default;
      if (typeof settings.scope.watch_limit_min === "number")
        SERVER_SCOPE_WATCH_LIMIT_MIN = settings.scope.watch_limit_min;
      if (typeof settings.scope.watch_limit_max === "number")
        SERVER_SCOPE_WATCH_LIMIT_MAX = settings.scope.watch_limit_max;
      return settings;
    } catch {
      return null;
    }
  }

  async function loadPersistedState(): Promise<void> {
    const [settings, view] = await Promise.all([
      fetch("/_state/settings")
        .then((res) =>
          res.ok ? (res.json() as Promise<AppSettingsState>) : null,
        )
        .catch(() => null),
      fetch("/_state/view")
        .then((res) => (res.ok ? (res.json() as Promise<ViewState>) : null))
        .catch(() => null),
    ]);
    if (settings) APP_SETTINGS = settings;
    if (view) VIEW_STATE = view;
  }

  function routeFromLocation(): AppRoute {
    const savedLanguage =
      viewerLanguageFromSearch(window.location.search) || savedViewerLanguage();
    const parsedRoute = parseRoute(
      window.location.pathname,
      window.location.search,
      savedRange(),
    );
    const routeBase =
      parsedRoute.screen === "unknown"
        ? { screen: "diff" as const, range: parsedRoute.range }
        : normalizeInternalFileRoute(parsedRoute);
    return routeBase.screen === "help" &&
      !new URLSearchParams(window.location.search).has("lang")
      ? { ...routeBase, lang: savedLanguage }
      : routeBase;
  }

  function applyPersistedStateToState(): void {
    const route = routeFromLocation();
    const savedLanguage =
      viewerLanguageFromSearch(window.location.search) || savedViewerLanguage();
    STATE.layout = savedLayout();
    STATE.theme = savedTheme();
    STATE.language = savedLanguage;
    STATE.sbView = savedSidebarView();
    STATE.sbWidth = savedNumber(APP_SETTINGS.sidebarWidth, 308, 180, 900);
    STATE.historyWidth = savedNumber(APP_SETTINGS.historyWidth, 320, 220, 640);
    STATE.sidebarHidden = APP_SETTINGS.sidebarHidden === true;
    STATE.collapsedDirs = new Set(VIEW_STATE.collapsedDirs || []);
    STATE.lazyExpandedDirs = new Set(VIEW_STATE.lazyExpandedDirs || []);
    STATE.viewedFiles = new Set(VIEW_STATE.viewedFiles || []);
    STATE.ignoreWs =
      APP_SETTINGS.ignoreWhitespace === undefined
        ? true
        : APP_SETTINGS.ignoreWhitespace === true;
    STATE.hideTests = APP_SETTINGS.hideTests === true;
    STATE.syntaxHighlight = APP_SETTINGS.syntaxHighlight !== false;
    STATE.autoUpdate = APP_SETTINGS.autoUpdate !== false;
    STATE.route = route;
    STATE.from = route.range.from;
    STATE.to = route.range.to;
    STATE.repoRef = route.screen === "repo" ? route.ref : "worktree";
  }

  async function loadInitialState(): Promise<void> {
    await Promise.all([loadSettings(), loadPersistedState()]);
    applyPersistedStateToState();
    applySidebarFontSize();
    applyCodeFontSize();
    applySidebarHidden(STATE.sidebarHidden, { persist: false });
    applyHistoryWidth(STATE.historyWidth, false);
    applySidebarWidth(STATE.sbWidth, { persist: false });
    ANNOTATIONS_UI?.applyAnnotationPanelWidth(
      APP_SETTINGS.annotationPanelWidth ?? 380,
      false,
    );
    setLayout(STATE.layout, false);
    applyTheme();
    localizeViewerChrome();
  }

  const STATE: AppState = (() => {
    const route = routeFromLocation();
    return {
      layout: savedLayout(),
      theme: savedTheme(),
      language:
        viewerLanguageFromSearch(window.location.search) ||
        savedViewerLanguage(),
      sbView: savedSidebarView(),
      sbWidth: savedNumber(APP_SETTINGS.sidebarWidth, 308, 180, 900),
      historyWidth: savedNumber(APP_SETTINGS.historyWidth, 320, 220, 640),
      sidebarHidden: APP_SETTINGS.sidebarHidden === true,
      collapsedDirs: new Set<string>(VIEW_STATE.collapsedDirs),
      lazyExpandedDirs: new Set<string>(VIEW_STATE.lazyExpandedDirs),
      ignoreWs:
        APP_SETTINGS.ignoreWhitespace === undefined
          ? true
          : APP_SETTINGS.ignoreWhitespace === true,
      from: route.range.from,
      to: route.range.to,
      collapsed: false,
      files: [],
      activeFile: null,
      hideTests: APP_SETTINGS.hideTests === true,
      syntaxHighlight: APP_SETTINGS.syntaxHighlight !== false,
      viewedFiles: new Set<string>(VIEW_STATE.viewedFiles),
      route,
      repoRef: route.screen === "repo" ? route.ref : "worktree",
      autoUpdate: APP_SETTINGS.autoUpdate !== false,
    };
  })();

  // (declarations recovered during the source-view extraction)
  let highlightConfigured = false;
  let REPO_SIDEBAR_REF: string | null = null;

  // ---------- Line reference copy (@path#start-end) ----------
  const LINE_REF_PILL = createLineRefPill({
    onClose: () => {
      clearLineSelection();
    },
  });
  const DIFF_LINE_SELECT = createDiffLineSelect({ pill: LINE_REF_PILL });

  // The pill follows the line= route param of the file screen; on the diff screen
  // diff-line-select owns it (after-side drag selection).
  function clearRenderedSourceLineTargets() {
    document
      .querySelectorAll<HTMLElement>(".gdp-source-line-target")
      .forEach((row) => {
        row.classList.remove("gdp-source-line-target");
      });
  }

  function clearLineSelection() {
    const route = STATE.route;
    if (route.screen === "file" && route.line) {
      const { line, ...rest } = route;
      setRoute(rest, true);
      return true;
    }
    if (route.screen === "diff") {
      return DIFF_LINE_SELECT.clear();
    }
    LINE_REF_PILL.hide();
    return false;
  }

  function syncLineRefPill() {
    const route = STATE.route;
    if (route.screen === "diff") return;
    DIFF_LINE_SELECT.clear();
    if (route.screen === "file" && route.line) {
      const start =
        typeof route.line === "number" ? route.line : route.line.start;
      const end = typeof route.line === "number" ? route.line : route.line.end;
      LINE_REF_PILL.show(route.path, start, end);
      return;
    }
    if (route.screen === "file") clearRenderedSourceLineTargets();
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
    persistCollapsedDirs: ({ added = [], removed = [] }) => {
      if (added.length === 0 && removed.length === 0) return;
      patchViewState({
        addedCollapsedDirs: added,
        removedCollapsedDirs: removed,
      });
    },
    persistLazyExpandedDirs: ({ added = [], removed = [] }) => {
      if (added.length === 0 && removed.length === 0) return;
      patchViewState({
        addedLazyExpandedDirs: added,
        removedLazyExpandedDirs: removed,
      });
    },
    appendScopeParams,
    createOpenPathButton,
    normalizeViewerFontSize,
    getSidebarFontSize: savedSidebarFontSizeSetting,
    persistSidebarHidden: (hidden) => patchSettings({ sidebarHidden: hidden }),
    persistSidebarWidth: (width) => patchSettings({ sidebarWidth: width }),
    scheduleMainSurfaceFocus,
    setChevronIcon,
    trackLoad,
    getRepoSidebarRef: () => REPO_SIDEBAR_REF,
    setRepoSidebarRef: (ref: string | null) => {
      REPO_SIDEBAR_REF = ref;
    },
    isTestPath: (path: string) => TEST_RE.test(path),
    sidebarToggleTitle: (hidden) =>
      hidden ? uiText().sidebar.show : uiText().sidebar.hide,
    openDirectoryInOsTitle: () => uiText().sidebar.openDirectoryInOs,
    omittedDirectoryBadge: (reason) => {
      const text = uiText().sidebar;
      return reason === "heavy"
        ? { label: text.omittedHeavyLabel, title: text.omittedHeavyTitle }
        : { label: text.omittedPrivateLabel, title: text.omittedPrivateTitle };
    },
    commitEntryBadge: (submodule) => {
      const text = uiText().sidebar;
      return submodule
        ? {
            label: text.commitEntrySubmoduleLabel,
            title: text.commitEntrySubmoduleTitle,
          }
        : {
            label: text.commitEntryGitlinkLabel,
            title: text.commitEntryGitlinkTitle,
          };
    },
  });
  const {
    renderSidebar,
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
    applySidebarHidden,
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

  const BLAME_VIEW = createBlameView({
    $,
    STATE,
    setRoute,
    applyRouteFromLocation,
    setPageMode,
    currentRange,
    trackLoad,
    getSyntaxHighlight: () => STATE.syntaxHighlight,
    loadSourceShikiHighlighter: () => SOURCE_VIEW.loadSourceShikiHighlighter(),
    sourceShikiLines: (textValue, lang, highlighter) =>
      SOURCE_VIEW.sourceShikiLines(textValue, lang, highlighter),
    inferLang: (path) => SOURCE_VIEW.inferLang(path),
    currentSourceLineTarget: (target) =>
      SOURCE_VIEW.currentSourceLineTarget(target),
    lineInSourceTarget: (lineNumber, target) =>
      SOURCE_VIEW.lineInSourceTarget(lineNumber, target),
    bindSourceLineNumber: (num, card, target, line) =>
      SOURCE_VIEW.bindSourceLineNumber(num, card, target, line),
    setPreferredSourceTab: (tab) => SOURCE_VIEW.setPreferredSourceTab(tab),
    createFileBreadcrumb: (path, ref) =>
      DIFF_VIEW.createFileBreadcrumb(path, ref),
    removeStandaloneSource,
    placeSidebarToggle,
    escapeHtml,
    repoFileTargetFromRoute,
    renderRepoBlobSidebar: (path: string, ref: string) =>
      REPO_VIEW.renderRepoBlobSidebar(path, ref),
  });

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
    getSidebarOnFileClick: () => SIDEBAR.getSidebarOnFileClick(),
    syncHeaderMenu,
    getSidebarRowByPath,
    getSidebarVirtualActivePath,
    pushUndo: (undo: UndoActionResponse) => {
      UNDO_STACK.unshift(undo);
    },
    newFolderButtonTitle: () => uiText().repo.newFolder,
    openDirectoryInOsTitle: () => uiText().sidebar.openDirectoryInOs,
    moveFolderToTrashTitle: () => uiText().repo.moveFolderToTrash,
    uploadButtonLabel: () => uiText().repo.uploadButton,
    dropFilesIntoCopy: (target) => uiText().repo.dropFilesInto(target),
    uploadFailedMessage: () => uiText().repo.uploadFailed,
    emptyDirectoryLabel: () => uiText().repo.emptyDirectory,
    uploadConfirmText: (count, target) => {
      const text = uiText().repo;
      return {
        title: text.uploadConfirmTitle,
        body: text.uploadConfirmBody(count, target),
        confirmLabel: text.uploadConfirmLabel,
      };
    },
    sortColumnLabels: () => {
      const text = uiText().repo;
      return {
        name: text.sortName,
        updated: text.sortUpdated,
        size: text.sortSize,
      };
    },
    repositoryFallback: () => uiText().repo.repositoryFallback,
    repositoryRootFallback: () => uiText().repo.repositoryRootFallback,
    commitEntryMeta: (submodule) => {
      const text = uiText().repo;
      return submodule
        ? { label: text.submoduleLabel, title: text.submoduleTitle }
        : { label: text.gitlinkLabel, title: text.gitlinkTitle };
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

  const UI_TEXT: Record<
    ViewerLanguage,
    {
      nav: Record<
        "repo" | "diff" | "history" | "journal" | "database" | "help",
        string
      >;
      global: {
        annotations: string;
        queryHistory: string;
        settings: string;
        theme: string;
        product: string;
        copyAiContext: string;
        copyAiContextLabel: string;
        copyAiContextCopied: string;
        copyAiContextCopiedWithCode: (lines: number) => string;
        copyAiContextFailed: string;
        copyAiContextEmpty: string;
        statusLive: string;
        statusLoading: string;
        statusError: string;
        statusIdle: string;
        statusInFlightTitle: (count: number, cancellable: number) => string;
        cancelRequestsActiveTitle: (count: number) => string;
        cancelRequestsInactiveTitle: string;
        brandHome: string;
        menuViews: string;
      };
      topbar: {
        resetRange: string;
        reload: string;
        layout: string;
        unified: string;
        split: string;
        ignoreWs: string;
        ignoreWsLabel: string;
        syntaxLoading: string;
        syntaxOn: string;
        syntaxOff: string;
        syntaxOnTitle: string;
        syntaxLoadingTitle: string;
        syntaxErrorTitle: string;
        syntaxOffTitle: string;
        hideTests: string;
        hideTestsLabel: string;
        autoUpdate: string;
        autoUpdateOnTitle: string;
        autoUpdateOffTitle: string;
      };
      diff: {
        files: (count: number) => string;
        updated: (time: string) => string;
        updatedTitle: string;
        kindAdded: string;
        kindDeleted: string;
        kindRenamed: string;
        kindHeavy: string;
        kindBinary: string;
        kindMedia: string;
        viewedProgress: (viewed: number, total: number) => string;
        viewedProgressTitle: string;
        nextUnviewed: string;
        nextUnviewedTitle: string;
        allViewed: string;
        allViewedTitle: string;
        noChangesTitle: string;
        noChangesBody: string;
        noChangesReload: string;
        noChangesReloadTitle: string;
        noChangesHistory: string;
        noChangesHistoryTitle: string;
        emptyDiffTitle: string;
        emptyDiffBody: string;
        noCommitSelectedTitle: string;
        noCommitSelectedBody: string;
      };
      changeBanner: {
        text: string;
        reload: string;
        justNow: string;
        secondsAgo: (seconds: number) => string;
        minutesAgo: (minutes: number) => string;
        hoursAgo: (hours: number) => string;
      };
      watchLimitBanner: {
        text: (limit: number) => string;
      };
      sidebar: {
        files: string;
        actions: string;
        expandAll: string;
        collapseAll: string;
        view: string;
        tree: string;
        flat: string;
        treeTitle: string;
        flatTitle: string;
        filter: string;
        filterTitle: string;
        filterClear: string;
        filterClearTitle: string;
        hide: string;
        show: string;
        repoTarget: string;
        openDirectoryInOs: string;
        omittedHeavyLabel: string;
        omittedHeavyTitle: string;
        omittedPrivateLabel: string;
        omittedPrivateTitle: string;
        commitEntryGitlinkLabel: string;
        commitEntryGitlinkTitle: string;
        commitEntrySubmoduleLabel: string;
        commitEntrySubmoduleTitle: string;
      };
      repo: {
        newFolder: string;
        moveFolderToTrash: string;
        uploadButton: string;
        dropFilesInto: (target: string) => string;
        uploadFailed: string;
        emptyDirectory: string;
        uploadConfirmTitle: string;
        uploadConfirmBody: (count: number, target: string) => string;
        uploadConfirmLabel: string;
        sortName: string;
        sortUpdated: string;
        sortSize: string;
        repositoryFallback: string;
        repositoryRootFallback: string;
        gitlinkLabel: string;
        gitlinkTitle: string;
        submoduleLabel: string;
        submoduleTitle: string;
      };
      history: {
        title: string;
        filter: string;
        filterTitle: string;
        refreshTitle: string;
      };
      journal: JournalViewText;
      quickHelp: {
        buttonTitle: string;
        panelTitle: string;
        close: string;
        viewAll: string;
      };
      settings: {
        title: string;
        close: string;
        display: string;
        language: string;
        fileListFontSize: string;
        fileListFontSizeHelp: string;
        codeFontSize: string;
        sizeSmall: string;
        sizeRegular: string;
        sizeLarge: string;
        sizeExtraLarge: string;
        displaySource: string;
        excludedDirectories: string;
        omitDirs: string;
        omitDirsHelp: string;
        excludeNames: string;
        excludeNamesHelp: string;
        reset: string;
        autosaveNote: string;
        scopeSource: (project: string, source: string) => string;
        browserOverride: string;
        serverDefault: string;
        uploadsTitle: string;
        uploadEnabledLabel: string;
        uploadEnabledHelp: string;
        datastoreTitle: string;
        datastoreInferFkLabel: string;
        datastoreInferFkHelp: string;
        datastoreS3TooltipLabel: string;
        datastoreS3TooltipHelp: string;
        watchTitle: string;
        watchLimit: string;
        watchLimitHelp: (defaultLimit: number) => string;
      };
      annotations: {
        title: string;
        follow: string;
        followTitle: string;
        clear: string;
        close: string;
        sessions: string;
      };
    }
  > = {
    en: {
      nav: {
        repo: "Repository",
        diff: "Diff Viewer",
        history: "History",
        journal: "Work Log",
        database: "Datastores",
        help: "Help",
      },
      global: {
        annotations: "code annotations",
        queryHistory: "query history",
        settings: "viewer settings",
        theme: "toggle theme",
        product: "code viewer",
        copyAiContext: "Copy AI context (Shift+Click to include code)",
        copyAiContextLabel: "AI context",
        copyAiContextCopied: "Copied AI context",
        copyAiContextCopiedWithCode: (lines) =>
          `Copied AI context + code (${lines} line${lines === 1 ? "" : "s"})`,
        copyAiContextFailed: "Copy failed",
        copyAiContextEmpty: "Nothing to copy here",
        statusLive: "Live",
        statusLoading: "Loading",
        statusError: "Error",
        statusIdle: "Idle",
        statusInFlightTitle: (count, cancellable) =>
          `${count} request${count === 1 ? "" : "s"} in flight${
            cancellable > 0 ? " (cancellable)" : ""
          }`,
        cancelRequestsActiveTitle: (count) =>
          `cancel ${count} in-flight request${count === 1 ? "" : "s"}`,
        cancelRequestsInactiveTitle: "no in-flight requests",
        brandHome: "Repository home",
        menuViews: "Views",
      },
      topbar: {
        resetRange: "reset to HEAD .. worktree",
        reload: "reload diff (R)",
        layout: "layout",
        unified: "unified",
        split: "split",
        ignoreWs: "ignore whitespace changes (-w)",
        ignoreWsLabel: "ws",
        syntaxLoading: "loading...",
        syntaxOn: "syntax on",
        syntaxOff: "syntax off",
        syntaxOnTitle: "syntax highlighting on",
        syntaxLoadingTitle: "loading syntax highlighter",
        syntaxErrorTitle: "failed to load syntax highlighter",
        syntaxOffTitle: "syntax highlighting off",
        hideTests: "hide test files (test|spec)",
        hideTestsLabel: "no test",
        autoUpdate: "auto",
        autoUpdateOnTitle: "auto update on file change",
        autoUpdateOffTitle: "auto update off — manual reload",
      },
      diff: {
        files: (count) => `${count} file${count === 1 ? "" : "s"}`,
        updated: (time) => `updated ${time}`,
        updatedTitle: "last updated",
        kindAdded: "added",
        kindDeleted: "deleted",
        kindRenamed: "renamed",
        kindHeavy: "heavy",
        kindBinary: "binary",
        kindMedia: "media",
        viewedProgress: (viewed, total) => `${viewed}/${total} viewed`,
        viewedProgressTitle: "review progress",
        nextUnviewed: "next unviewed",
        nextUnviewedTitle: "Jump to the next unviewed file (n)",
        allViewed: "all viewed",
        allViewedTitle: "All visible files are viewed",
        noChangesTitle: "No changes",
        noChangesBody: "The working tree is clean against this ref.",
        noChangesReload: "Reload diff",
        noChangesReloadTitle: "Reload this diff range",
        noChangesHistory: "Open history",
        noChangesHistoryTitle: "Open commit history for this range",
        emptyDiffTitle: "Empty diff",
        emptyDiffBody: "This commit has no changes against its first parent.",
        noCommitSelectedTitle: "No commit selected",
        noCommitSelectedBody:
          "Select a commit from the list to see its changes.",
      },
      changeBanner: {
        text: "Files changed",
        reload: "Reload",
        justNow: "just now",
        secondsAgo: (seconds) => `${seconds}s ago`,
        minutesAgo: (minutes) => `${minutes}m ago`,
        hoursAgo: (hours) => `${hours}h ago`,
      },
      watchLimitBanner: {
        text: (limit) =>
          `Watching ${limit} ${limit === 1 ? "folder" : "folders"} (limit reached) — changes in deeper folders may go unnoticed.`,
      },
      sidebar: {
        files: "Files",
        actions: "sidebar actions",
        expandAll: "expand all folders",
        collapseAll: "collapse all folders",
        view: "view",
        tree: "tree",
        flat: "flat",
        treeTitle: "tree view",
        flatTitle: "flat list",
        filter: "Filter files…  /  ⌘K",
        filterTitle:
          "Filter files. Use /pattern/ for regex. Press / to focus this field, Cmd/Ctrl+K for the full-file palette, Ctrl+G for grep, ? for help.",
        filterClear: "Clear",
        filterClearTitle: "Clear file filter",
        hide: "hide sidebar",
        show: "show sidebar",
        repoTarget: "repository target",
        openDirectoryInOs: "open this folder in OS",
        omittedHeavyLabel: "skipped",
        omittedHeavyTitle:
          "Tree expansion is skipped, but the directory detail can be opened",
        omittedPrivateLabel: "private",
        omittedPrivateTitle: "This directory cannot be opened from the browser",
        commitEntryGitlinkLabel: "GIT",
        commitEntryGitlinkTitle: "Git commit entry",
        commitEntrySubmoduleLabel: "SUB",
        commitEntrySubmoduleTitle: "Git submodule pinned to a commit",
      },
      repo: {
        newFolder: "new folder",
        moveFolderToTrash: "move folder to Trash",
        uploadButton: "Upload files",
        dropFilesInto: (target) => `Drop files into ${target}`,
        uploadFailed: "Upload failed",
        emptyDirectory: "No files in this directory.",
        uploadConfirmTitle: "Upload files?",
        uploadConfirmBody: (count, target) =>
          `Upload ${count} file${count === 1 ? "" : "s"} into ${target}?`,
        uploadConfirmLabel: "Upload",
        sortName: "Name",
        sortUpdated: "Updated",
        sortSize: "Size",
        repositoryFallback: "repository",
        repositoryRootFallback: "repository root",
        gitlinkLabel: "gitlink",
        gitlinkTitle: "Git commit entry is not directly browsable at this ref",
        submoduleLabel: "submodule",
        submoduleTitle: "Git submodule pinned to a commit",
      },
      history: {
        title: "Commits",
        filter: "Filter commits...",
        filterTitle:
          "Filter commits by message, SHA, author:name, or path:file.",
        refreshTitle: "Refresh commit history",
      },
      journal: {
        locale: "en",
        ariaLabel: "Work log and tasks",
        title: "Work Log",
        tabs: {
          journal: "Log",
          tasks: "Tasks",
        },
        refresh: "Refresh work log",
        loading: "loading...",
        loadFailed: "failed to load work log",
        statusLabels: {
          draft: "Draft",
          todo: "Todo",
          doing: "Doing",
          blocked: "Blocked",
          done: "Done",
        },
        priorityLabels: {
          p0: "P0",
          p1: "P1",
          p2: "P2",
          p3: "P3",
        },
        statusField: "Status",
        priorityField: "Priority",
        previousMonth: "Previous month",
        nextMonth: "Next month",
        weekDays: ["S", "M", "T", "W", "T", "F", "S"],
        noEntries: "No logs",
        noRelatedTasks: "No related tasks",
        noBody: "No body",
        relatedTasks: "Tasks",
        new: "New",
        titlePlaceholder: "Title",
        labelPlaceholder: "labels",
        entryBodyPlaceholder: "What did you work on today?",
        addEntry: "Add log",
        saveEntry: "Save log",
        delete: "Delete",
        deleteEntryFailed: "failed to delete log",
        saveEntryFailed: "failed to save log",
        moveTaskFailed: "failed to move task",
        aiQueue: "AI queue",
        empty: "Empty",
        duePrefix: "due",
        startDate: "Start date",
        endDate: "End date",
        removeLabel: (label) => `Remove ${label}`,
        claimedBy: (name) => `claimed by ${name}`,
        taskHeading: "Task",
        newTaskHeading: "New task",
        taskBodyPlaceholder: "Task details, acceptance checklist, notes",
        addTask: "Add task",
        saveTask: "Save task",
        saveTaskFailed: "failed to save task",
        claim: "Claim",
        claimTaskFailed: "failed to claim task",
        done: "Done",
        doneTaskFailed: "failed to complete task",
        deleteTaskFailed: "failed to delete task",
        labelFilterPlaceholder: "label",
        allLabels: "All",
        labelFilters: "Label filters",
        githubIssues: "GitHub Issues",
        githubRepoPlaceholder: "repo (optional)",
        githubLabelPlaceholder: "GitHub labels, comma separated",
        githubSearchPlaceholder: "search issues",
        githubStateLabels: {
          open: "Open",
          closed: "Closed",
          all: "All",
        },
        githubLoad: "Load issues",
        githubLoadMore: "Load more",
        githubLoading: "loading issues...",
        githubLoadFailed: "failed to load GitHub issues",
        githubShowing: (count, limit) => `Showing ${count} of ${limit}.`,
        githubRateLimited: (seconds) =>
          `GitHub rate limit hit. Try again in ${seconds}s.`,
        githubNotLoaded: "GitHub issues are not loaded",
        githubNoIssues: "No GitHub issues",
        githubClose: "Close GitHub issues",
        githubLinked: "linked",
        githubAddToBoard: "Add to board",
        githubOpenTask: "Open task",
        githubDragHint: "Add or drag an issue to link it to a local task.",
        githubLinkTaskFailed: "failed to link GitHub issue",
        githubMemoLabel: "Memo:",
        moreTasks: (count) => `${count} more`,
        resizeTaskPanel: "Resize task panel",
        dragTask: "Drag task",
        editorModes: {
          write: "write",
          preview: "preview",
          split: "split",
        },
      },
      quickHelp: {
        buttonTitle: "quick help (shortcuts)",
        panelTitle: "Quick Help",
        close: "close quick help",
        viewAll: "View all keybindings →",
      },
      settings: {
        title: "Viewer Settings",
        close: "close viewer settings",
        display: "Display",
        language: "Language",
        fileListFontSize: "UI font size",
        fileListFontSizeHelp: "Applies to the file sidebar and datastore UI.",
        codeFontSize: "Code font size",
        sizeSmall: "Small",
        sizeRegular: "Regular",
        sizeLarge: "Large",
        sizeExtraLarge: "Extra Large",
        displaySource: "Applies to all projects in this browser.",
        excludedDirectories: "Excluded directories",
        omitDirs: "Skip these directory names while browsing and searching",
        omitDirsHelp:
          "Reads no contents inside these directories. Applies to the sidebar (Files), Ctrl+K (file search), Ctrl+G (grep), Datastores, and the file change watcher.",
        excludeNames: "Hide these file or directory names completely",
        excludeNamesHelp:
          "Removes matching files or directories from the sidebar, search, and grep results entirely. Unlike Skip, the names themselves disappear from the UI.",
        reset: "Restore defaults",
        autosaveNote: "Changes save automatically.",
        scopeSource: (project, source) =>
          `Saved for project "${project}" in this browser. Source: ${source}. Used by the sidebar, Ctrl+K, Ctrl+G, Datastores, and the file change watcher. Restore defaults removes the browser override.`,
        browserOverride: "Browser override",
        serverDefault: "Server default",
        uploadsTitle: "Uploads",
        uploadEnabledLabel: "Allow file uploads into worktree folders",
        uploadEnabledHelp:
          "Disable to make the worktree read-only for everyone using this server.",
        datastoreTitle: "Datastores",
        datastoreInferFkLabel:
          "Infer FK from Rails-style naming (<name>_id → <names>.id)",
        datastoreInferFkHelp:
          "Show inferred foreign-key links in the related-data panel for SQL tables.",
        datastoreS3TooltipLabel: "Show S3 object preview tooltip on hover",
        datastoreS3TooltipHelp:
          "Hovering an S3 object row shows the full key path and a content preview.",
        watchTitle: "File change watcher",
        watchLimit: "Maximum directories to watch",
        watchLimitHelp: (defaultLimit) =>
          `Higher values reduce missed updates in deep trees at the cost of file handles. Combine with the Skip list above to keep heavy folders (node_modules, .git, dist...) out of the watch budget. Default: ${defaultLimit}.`,
      },
      annotations: {
        title: "Code annotations",
        follow: "follow",
        followTitle: "jump to new annotations as they arrive",
        clear: "clear",
        close: "close",
        sessions: "Sessions",
      },
    },
    ja: {
      nav: {
        repo: "リポジトリ",
        diff: "Diff ビューア",
        history: "履歴",
        journal: "ワークログ",
        database: "データストア",
        help: "ヘルプ",
      },
      global: {
        annotations: "コード注釈",
        queryHistory: "クエリ履歴",
        settings: "ビューア設定",
        theme: "テーマ切り替え",
        product: "code viewer",
        copyAiContext:
          "AI 用コンテキストをコピー（Shift+Click でコードも添付）",
        copyAiContextLabel: "AI文脈",
        copyAiContextCopied: "コピーしました",
        copyAiContextCopiedWithCode: (lines) =>
          `コピーしました（コード付き・${lines}行）`,
        copyAiContextFailed: "コピーに失敗しました",
        copyAiContextEmpty: "コピーする内容がありません",
        statusLive: "稼働中",
        statusLoading: "更新中",
        statusError: "エラー",
        statusIdle: "待機中",
        statusInFlightTitle: (count, cancellable) =>
          `${count}件のリクエストを実行中${cancellable > 0 ? "（キャンセル可能）" : ""}`,
        cancelRequestsActiveTitle: (count) =>
          `実行中のリクエストを${count}件キャンセル`,
        cancelRequestsInactiveTitle: "実行中のリクエストはありません",
        brandHome: "リポジトリホーム",
        menuViews: "ビュー切り替え",
      },
      topbar: {
        resetRange: "HEAD .. worktree に戻す",
        reload: "diff を再読み込み (R)",
        layout: "レイアウト",
        unified: "統合",
        split: "分割",
        ignoreWs: "空白差分を無視 (-w)",
        ignoreWsLabel: "空白",
        syntaxLoading: "読み込み中...",
        syntaxOn: "構文あり",
        syntaxOff: "構文なし",
        syntaxOnTitle: "シンタックスハイライト有効",
        syntaxLoadingTitle: "シンタックスハイライトを読み込み中",
        syntaxErrorTitle: "シンタックスハイライトの読み込みに失敗",
        syntaxOffTitle: "シンタックスハイライト無効",
        hideTests: "test/spec ファイルを隠す",
        hideTestsLabel: "テスト非表示",
        autoUpdate: "自動",
        autoUpdateOnTitle: "ファイル変更時に自動更新",
        autoUpdateOffTitle: "自動更新オフ — 手動で再読み込み",
      },
      diff: {
        files: (count) => `${count}ファイル`,
        updated: (time) => `更新 ${time}`,
        updatedTitle: "最終更新",
        kindAdded: "追加",
        kindDeleted: "削除",
        kindRenamed: "名前変更",
        kindHeavy: "大容量",
        kindBinary: "バイナリ",
        kindMedia: "メディア",
        viewedProgress: (viewed, total) => `${viewed}/${total} 確認済み`,
        viewedProgressTitle: "確認進捗",
        nextUnviewed: "次の未確認",
        nextUnviewedTitle: "次の未確認ファイルへ移動 (n)",
        allViewed: "すべて確認済み",
        allViewedTitle: "表示中のファイルはすべて確認済みです",
        noChangesTitle: "変更はありません",
        noChangesBody: "この参照との差分はありません。",
        noChangesReload: "diff を更新",
        noChangesReloadTitle: "この差分範囲を再読み込み",
        noChangesHistory: "履歴を開く",
        noChangesHistoryTitle: "この範囲のコミット履歴を開く",
        emptyDiffTitle: "空の差分",
        emptyDiffBody: "このコミットは最初の親との差分がありません。",
        noCommitSelectedTitle: "コミット未選択",
        noCommitSelectedBody: "一覧からコミットを選ぶと変更内容を表示します。",
      },
      changeBanner: {
        text: "ファイルに変更がありました",
        reload: "再読み込みする",
        justNow: "たった今",
        secondsAgo: (seconds) => `${seconds}秒前`,
        minutesAgo: (minutes) => `${minutes}分前`,
        hoursAgo: (hours) => `${hours}時間前`,
      },
      watchLimitBanner: {
        text: (limit) =>
          `監視フォルダ数が上限(${limit})に達しました — これより深いフォルダの変更は検知されない場合があります。`,
      },
      sidebar: {
        files: "ファイル",
        actions: "サイドバー操作",
        expandAll: "すべてのフォルダを開く",
        collapseAll: "すべてのフォルダを閉じる",
        view: "表示",
        tree: "ツリー",
        flat: "一覧",
        treeTitle: "ツリー表示",
        flatTitle: "一覧表示",
        filter: "ファイル絞り込み…  /  ⌘K",
        filterTitle:
          "ファイルを絞り込みます。/pattern/ は正規表現。/ でこの欄にフォーカス、Cmd/Ctrl+K で全ファイルパレット、Ctrl+G で grep、? でヘルプ。",
        filterClear: "解除",
        filterClearTitle: "ファイル絞り込みを解除",
        hide: "サイドバーを隠す",
        show: "サイドバーを表示",
        repoTarget: "リポジトリの対象",
        openDirectoryInOs: "このフォルダをOSで開く",
        omittedHeavyLabel: "省略",
        omittedHeavyTitle:
          "ツリー展開は省略されていますが、詳細パネルでは開けます",
        omittedPrivateLabel: "非公開",
        omittedPrivateTitle: "このディレクトリはブラウザから開けません",
        commitEntryGitlinkLabel: "GIT",
        commitEntryGitlinkTitle:
          "Git のコミットに固定された参照です。フォルダではないため直接は開けません。",
        commitEntrySubmoduleLabel: "SUB",
        commitEntrySubmoduleTitle:
          "Git サブモジュール: 特定のコミットに固定されています。フォルダではないため直接は開けません。",
      },
      repo: {
        newFolder: "新規フォルダ",
        moveFolderToTrash: "フォルダをゴミ箱へ移動",
        uploadButton: "ファイルをアップロード",
        dropFilesInto: (target) => `${target} にファイルをドロップ`,
        uploadFailed: "アップロードに失敗しました",
        emptyDirectory: "このディレクトリにファイルはありません。",
        uploadConfirmTitle: "ファイルをアップロードしますか？",
        uploadConfirmBody: (count, target) =>
          `${target} に ${count} 件のファイルをアップロードしますか？`,
        uploadConfirmLabel: "アップロード",
        sortName: "名前",
        sortUpdated: "更新日時",
        sortSize: "サイズ",
        repositoryFallback: "リポジトリ",
        repositoryRootFallback: "リポジトリのルート",
        gitlinkLabel: "固定コミット",
        gitlinkTitle:
          "特定のコミットに固定された参照です。この ref では直接開けません。",
        submoduleLabel: "サブモジュール",
        submoduleTitle:
          "Git サブモジュール: 特定のコミットに固定されています。直接は開けません。",
      },
      history: {
        title: "コミット",
        filter: "コミットを絞り込み...",
        filterTitle:
          "メッセージ、SHA、author:name、path:file でコミットを絞り込みます。",
        refreshTitle: "コミット履歴を更新",
      },
      journal: {
        locale: "ja",
        ariaLabel: "ワークログとタスク",
        title: "ワークログ",
        tabs: {
          journal: "ログ",
          tasks: "タスク",
        },
        refresh: "ワークログを更新",
        loading: "読み込み中...",
        loadFailed: "ワークログの読み込みに失敗しました",
        statusLabels: {
          draft: "下書き",
          todo: "未着手",
          doing: "進行中",
          blocked: "ブロック",
          done: "完了",
        },
        priorityLabels: {
          p0: "P0",
          p1: "P1",
          p2: "P2",
          p3: "P3",
        },
        statusField: "ステータス",
        priorityField: "優先度",
        previousMonth: "前の月",
        nextMonth: "次の月",
        weekDays: ["日", "月", "火", "水", "木", "金", "土"],
        noEntries: "ログはありません",
        noRelatedTasks: "関連タスクはありません",
        noBody: "本文はありません",
        relatedTasks: "タスク",
        new: "新規",
        titlePlaceholder: "タイトル",
        labelPlaceholder: "ラベル",
        entryBodyPlaceholder: "今日の作業を記録",
        addEntry: "ログを追加",
        saveEntry: "ログを保存",
        delete: "削除",
        deleteEntryFailed: "ログの削除に失敗しました",
        saveEntryFailed: "ログの保存に失敗しました",
        moveTaskFailed: "タスクの移動に失敗しました",
        aiQueue: "AIキュー",
        empty: "空",
        duePrefix: "期限",
        startDate: "開始日",
        endDate: "終了日",
        removeLabel: (label) => `${label} を削除`,
        claimedBy: (name) => `${name} が確保中`,
        taskHeading: "タスク",
        newTaskHeading: "新規タスク",
        taskBodyPlaceholder: "詳細、受け入れ条件、メモ",
        addTask: "タスクを追加",
        saveTask: "タスクを保存",
        saveTaskFailed: "タスクの保存に失敗しました",
        claim: "確保",
        claimTaskFailed: "タスクの確保に失敗しました",
        done: "完了",
        doneTaskFailed: "タスクの完了に失敗しました",
        deleteTaskFailed: "タスクの削除に失敗しました",
        labelFilterPlaceholder: "ラベル",
        allLabels: "すべて",
        labelFilters: "ラベルフィルタ",
        githubIssues: "GitHub Issue",
        githubRepoPlaceholder: "リポジトリ（任意）",
        githubLabelPlaceholder: "GitHubラベル（カンマ区切り）",
        githubSearchPlaceholder: "Issue検索",
        githubStateLabels: {
          open: "未解決",
          closed: "解決済み",
          all: "すべて",
        },
        githubLoad: "Issueを表示",
        githubLoadMore: "さらに読む",
        githubLoading: "Issueを読み込み中...",
        githubLoadFailed: "GitHub Issueの読み込みに失敗しました",
        githubShowing: (count, limit) => `${limit}件中${count}件を表示中。`,
        githubRateLimited: (seconds) =>
          `GitHubの制限に達しました。${seconds}秒後に再試行してください。`,
        githubNotLoaded: "GitHub Issueは未読み込みです",
        githubNoIssues: "GitHub Issueは0件です",
        githubClose: "GitHub Issueを閉じる",
        githubLinked: "紐づき済み",
        githubAddToBoard: "看板へ追加",
        githubOpenTask: "タスクを開く",
        githubDragHint:
          "Issueを追加またはドラッグすると、自分用タスクとして紐づけます。",
        githubLinkTaskFailed: "GitHub Issueの紐づけに失敗しました",
        githubMemoLabel: "メモ:",
        moreTasks: (count) => `他${count}件`,
        resizeTaskPanel: "タスクパネル幅を変更",
        dragTask: "タスクをドラッグ",
        editorModes: {
          write: "編集",
          preview: "プレビュー",
          split: "分割",
        },
      },
      quickHelp: {
        buttonTitle: "クイックヘルプ(ショートカット)",
        panelTitle: "クイックヘルプ",
        close: "クイックヘルプを閉じる",
        viewAll: "すべてのキーバインドを見る →",
      },
      settings: {
        title: "ビューア設定",
        close: "ビューア設定を閉じる",
        display: "表示",
        language: "言語",
        fileListFontSize: "UIの文字サイズ",
        fileListFontSizeHelp: "ファイル一覧とデータストア画面に適用されます。",
        codeFontSize: "コード表示の文字サイズ",
        sizeSmall: "小",
        sizeRegular: "標準",
        sizeLarge: "大",
        sizeExtraLarge: "特大",
        displaySource: "このブラウザのすべてのプロジェクトに適用されます。",
        excludedDirectories: "除外ディレクトリ",
        omitDirs: "閲覧と検索でスキップするディレクトリ名",
        omitDirsHelp:
          "これらのディレクトリの中身は読み込みません。サイドバー（Files）・Ctrl+K（ファイル検索）・Ctrl+G（grep）・Datastores・File change watcher の5機能すべてに適用されます。",
        excludeNames: "完全に非表示にするファイル名またはディレクトリ名",
        excludeNamesHelp:
          "リスト中の名前に一致するファイル/ディレクトリを、サイドバー・検索結果・grep 結果から完全に消します。Skip と違い、名前自体が UI に出なくなります。",
        reset: "デフォルトに戻す",
        autosaveNote: "変更は自動で保存されます。",
        scopeSource: (project, source) =>
          `このブラウザのプロジェクト "${project}" に保存されます。ソース: ${source}。サイドバー、Ctrl+K、Ctrl+G、Datastores、File change watcher で使われます。「デフォルトに戻す」でブラウザ側の上書きを削除します。`,
        browserOverride: "ブラウザ側の上書き",
        serverDefault: "サーバ既定値",
        uploadsTitle: "アップロード",
        uploadEnabledLabel: "ワークツリーへのファイルアップロードを許可する",
        uploadEnabledHelp:
          "オフにすると、このサーバを使う全員に対してワークツリーは読み取り専用になります。",
        datastoreTitle: "データストア",
        datastoreInferFkLabel:
          "Rails 命名規約 (<name>_id → <names>.id) から FK を推測",
        datastoreInferFkHelp:
          "SQL テーブルの関連データパネルに Rails 命名規約由来の仮想 FK リンクを表示します。",
        datastoreS3TooltipLabel: "S3 オブジェクトの hover プレビューを表示",
        datastoreS3TooltipHelp:
          "S3 オブジェクト行にホバーすると、完全な key とコンテンツプレビューを表示します。",
        watchTitle: "ファイル変更の監視",
        watchLimit: "監視するディレクトリ数の上限",
        watchLimitHelp: (defaultLimit) =>
          `値を大きくすると深いツリーの変更を取りこぼしにくくなりますが、ファイルハンドル数を消費します。上の Skip リストと併用すると、重いフォルダ（node_modules, .git, dist など）を監視枠から外せます。既定値: ${defaultLimit}。`,
      },
      annotations: {
        title: "コード注釈",
        follow: "追従",
        followTitle: "新しい注釈が届いたら移動する",
        clear: "削除",
        close: "閉じる",
        sessions: "セッション",
      },
    },
  };

  function uiText() {
    return UI_TEXT[STATE.language];
  }

  function setElementText(selector: string, text: string) {
    const el = document.querySelector<HTMLElement>(selector);
    if (el) el.textContent = text;
  }

  function setButtonLabel(button: HTMLButtonElement | null, text: string) {
    if (button) button.textContent = text;
  }

  function setOptionText(
    select: HTMLSelectElement | null,
    labels: Record<string, string>,
  ) {
    select?.querySelectorAll<HTMLOptionElement>("option").forEach((option) => {
      const label = labels[option.value];
      if (label) option.textContent = label;
    });
  }

  function localizeViewerChrome() {
    const text = uiText();
    document.documentElement.lang = STATE.language;
    document
      .querySelectorAll<HTMLAnchorElement>(".app-menu-item")
      .forEach((link) => {
        const route = link.dataset.route as keyof typeof text.nav;
        if (route && text.nav[route]) link.textContent = text.nav[route];
      });
    setElementText(".global-help-link[data-route='help']", text.nav.help);
    setElementText(".product-label", text.global.product);
    document
      .querySelector<HTMLAnchorElement>(".brand")
      ?.setAttribute("aria-label", text.global.brandHome);
    document
      .querySelector<HTMLElement>(".app-menu")
      ?.setAttribute("aria-label", text.global.menuViews);

    const annotationsToggle = document.querySelector<HTMLButtonElement>(
      "#annotations-toggle",
    );
    if (annotationsToggle) {
      annotationsToggle.title = text.global.annotations;
      annotationsToggle.setAttribute("aria-label", text.global.annotations);
    }
    const viewerSettings =
      document.querySelector<HTMLButtonElement>("#viewer-settings");
    if (viewerSettings) {
      viewerSettings.title = text.global.settings;
      viewerSettings.setAttribute("aria-label", text.global.settings);
    }
    const theme = document.querySelector<HTMLButtonElement>("#theme");
    if (theme) {
      theme.title = text.global.theme;
      theme.setAttribute("aria-label", text.global.theme);
    }
    const quickHelpBtn =
      document.querySelector<HTMLButtonElement>("#quick-help-btn");
    if (quickHelpBtn) {
      quickHelpBtn.title = text.quickHelp.buttonTitle;
      quickHelpBtn.setAttribute("aria-label", text.quickHelp.buttonTitle);
    }
    QUICK_HELP?.localize();
    const doctorTitle = doctorText(STATE.language).title;
    const doctorBtn = document.querySelector<HTMLButtonElement>("#doctor-btn");
    if (doctorBtn) {
      doctorBtn.title = doctorTitle;
      doctorBtn.setAttribute("aria-label", doctorTitle);
    }
    document
      .querySelector<HTMLElement>("#doctor-sheet")
      ?.setAttribute("aria-label", doctorTitle);
    const copyAiContext =
      document.querySelector<HTMLButtonElement>("#copy-ai-context");
    if (copyAiContext) {
      copyAiContext.title = text.global.copyAiContext;
      copyAiContext.setAttribute("aria-label", text.global.copyAiContext);
      const copyAiContextLabel =
        copyAiContext.querySelector<HTMLElement>(".ai-context-label");
      if (copyAiContextLabel)
        copyAiContextLabel.textContent = text.global.copyAiContextLabel;
    }

    const refReset = document.querySelector<HTMLButtonElement>("#ref-reset");
    if (refReset) {
      refReset.title = text.topbar.resetRange;
      refReset.setAttribute("aria-label", text.topbar.resetRange);
    }
    const reload = document.querySelector<HTMLButtonElement>("#reload-prom");
    if (reload) {
      reload.title = text.topbar.reload;
      reload.setAttribute("aria-label", text.topbar.reload);
    }
    const layoutGroup = document.querySelector<HTMLElement>("#topbar .seg");
    layoutGroup?.setAttribute("aria-label", text.topbar.layout);
    setElementText(
      '#topbar .seg button[data-layout="line-by-line"]',
      text.topbar.unified,
    );
    setElementText(
      '#topbar .seg button[data-layout="side-by-side"]',
      text.topbar.split,
    );
    const ignoreWs = document.querySelector<HTMLButtonElement>("#ignore-ws");
    if (ignoreWs) {
      ignoreWs.title = text.topbar.ignoreWs;
      ignoreWs.textContent = text.topbar.ignoreWsLabel;
    }
    const hideTests = document.querySelector<HTMLButtonElement>("#hide-tests");
    if (hideTests) {
      hideTests.title = text.topbar.hideTests;
      hideTests.textContent = text.topbar.hideTestsLabel;
    }
    applyAutoUpdateButton();
    setHighlightButton(STATE.syntaxHighlight && getHljs() ? "loaded" : "idle");

    setElementText(".sb-title", text.sidebar.files);
    const sidebarActions = document.querySelector<HTMLElement>(".sb-actions");
    sidebarActions?.setAttribute("aria-label", text.sidebar.actions);
    const expandAll =
      document.querySelector<HTMLButtonElement>("#sb-expand-all");
    if (expandAll) {
      expandAll.title = text.sidebar.expandAll;
      expandAll.setAttribute("aria-label", text.sidebar.expandAll);
    }
    const collapseAll =
      document.querySelector<HTMLButtonElement>("#sb-collapse-all");
    if (collapseAll) {
      collapseAll.title = text.sidebar.collapseAll;
      collapseAll.setAttribute("aria-label", text.sidebar.collapseAll);
    }
    const sbView = document.querySelector<HTMLElement>(".sb-view-seg");
    sbView?.setAttribute("aria-label", text.sidebar.view);
    setElementText('.sb-view-seg button[data-view="tree"]', text.sidebar.tree);
    setElementText('.sb-view-seg button[data-view="flat"]', text.sidebar.flat);
    const sbViewTree = document.querySelector<HTMLButtonElement>(
      '.sb-view-seg button[data-view="tree"]',
    );
    if (sbViewTree) sbViewTree.title = text.sidebar.treeTitle;
    const sbViewFlat = document.querySelector<HTMLButtonElement>(
      '.sb-view-seg button[data-view="flat"]',
    );
    if (sbViewFlat) sbViewFlat.title = text.sidebar.flatTitle;
    const filter = document.querySelector<HTMLInputElement>("#sb-filter");
    if (filter) {
      filter.placeholder = text.sidebar.filter;
      filter.title = text.sidebar.filterTitle;
    }
    const filterClear =
      document.querySelector<HTMLButtonElement>("#sb-filter-clear");
    if (filterClear) {
      filterClear.textContent = text.sidebar.filterClear;
      filterClear.title = text.sidebar.filterClearTitle;
      filterClear.setAttribute("aria-label", text.sidebar.filterClearTitle);
    }
    const repoTarget = document.querySelector<HTMLInputElement>("#repo-target");
    if (repoTarget) {
      repoTarget.title = text.sidebar.repoTarget;
      repoTarget.setAttribute("aria-label", text.sidebar.repoTarget);
    }
    const sidebarToggle =
      document.querySelector<HTMLButtonElement>("#sidebar-toggle");
    if (sidebarToggle) {
      const sidebarToggleTitle = STATE.sidebarHidden
        ? text.sidebar.show
        : text.sidebar.hide;
      sidebarToggle.title = sidebarToggleTitle;
      sidebarToggle.setAttribute("aria-label", sidebarToggleTitle);
    }
    setElementText(".sidebar-toggle-label", text.sidebar.files);

    setElementText(".history-title", text.history.title);
    const historyPanel = document.querySelector<HTMLElement>("#history-panel");
    historyPanel?.setAttribute("aria-label", text.history.title);
    const historyFilter =
      document.querySelector<HTMLInputElement>("#history-filter");
    if (historyFilter) {
      historyFilter.placeholder = text.history.filter;
      historyFilter.title = text.history.filterTitle;
    }
    document
      .querySelectorAll<HTMLButtonElement>(".history-refresh")
      .forEach((button) => {
        button.title = text.history.refreshTitle;
        button.setAttribute("aria-label", text.history.refreshTitle);
      });
    relocalizeHistory?.();
    relocalizeJournal?.();

    setElementText(".scope-settings-head strong", text.settings.title);
    const settingsClose = document.querySelector<HTMLButtonElement>(
      "#scope-settings-close",
    );
    settingsClose?.setAttribute("aria-label", text.settings.close);
    const settingsSections = document.querySelectorAll<HTMLElement>(
      ".scope-settings-section-title",
    );
    if (settingsSections[0])
      settingsSections[0].textContent = text.settings.display;
    if (settingsSections[1])
      settingsSections[1].textContent = text.settings.uploadsTitle;
    if (settingsSections[2])
      settingsSections[2].textContent = text.settings.excludedDirectories;
    if (settingsSections[3])
      settingsSections[3].textContent = text.settings.datastoreTitle;
    if (settingsSections[4])
      settingsSections[4].textContent = text.settings.watchTitle;
    setElementText(
      "#datastore-infer-fk-label",
      text.settings.datastoreInferFkLabel,
    );
    setElementText(
      "#datastore-infer-fk-help",
      text.settings.datastoreInferFkHelp,
    );
    setElementText(
      "#datastore-s3-tooltip-label",
      text.settings.datastoreS3TooltipLabel,
    );
    setElementText(
      "#datastore-s3-tooltip-help",
      text.settings.datastoreS3TooltipHelp,
    );
    setElementText("#upload-enabled-label", text.settings.uploadEnabledLabel);
    setElementText("#upload-help", text.settings.uploadEnabledHelp);
    setElementText("#scope-omit-dirs-help", text.settings.omitDirsHelp);
    setElementText("#scope-exclude-names-help", text.settings.excludeNamesHelp);
    setElementText(
      "#scope-watch-limit-help",
      text.settings.watchLimitHelp(SERVER_SCOPE_WATCH_LIMIT_DEFAULT),
    );
    const labelMap: Record<string, string> = {
      "viewer-language": text.settings.language,
      "sidebar-font-size": text.settings.fileListFontSize,
      "code-font-size": text.settings.codeFontSize,
      "scope-omit-dirs": text.settings.omitDirs,
      "scope-exclude-names": text.settings.excludeNames,
      "scope-watch-limit": text.settings.watchLimit,
    };
    Object.entries(labelMap).forEach(([id, label]) => {
      const labelEl = document.querySelector<HTMLLabelElement>(
        `label[for="${id}"]`,
      );
      if (labelEl) labelEl.textContent = label;
    });
    setOptionText(document.querySelector("#sidebar-font-size"), {
      compact: text.settings.sizeSmall,
      regular: text.settings.sizeRegular,
      large: text.settings.sizeLarge,
      xlarge: text.settings.sizeExtraLarge,
    });
    setOptionText(document.querySelector("#code-font-size"), {
      compact: text.settings.sizeSmall,
      regular: text.settings.sizeRegular,
      large: text.settings.sizeLarge,
      xlarge: text.settings.sizeExtraLarge,
    });
    setElementText("#ui-font-size-help", text.settings.fileListFontSizeHelp);
    setElementText("#display-settings-source", text.settings.displaySource);
    setElementText("#scope-settings-autosave-note", text.settings.autosaveNote);
    setButtonLabel(
      document.querySelector("#scope-omit-reset"),
      text.settings.reset,
    );

    setElementText(".annotation-panel-head strong", text.annotations.title);
    const followLabel = document.querySelector<HTMLElement>(
      ".annotation-follow-label",
    );
    if (followLabel) {
      followLabel.title = text.annotations.followTitle;
      const input = followLabel.querySelector("input");
      followLabel.replaceChildren();
      if (input) followLabel.append(input, ` ${text.annotations.follow}`);
    }
    setButtonLabel(
      document.querySelector("#annotation-clear"),
      text.annotations.clear,
    );
    setButtonLabel(
      document.querySelector("#annotation-panel-close"),
      text.annotations.close,
    );
    setElementText(".annotation-list-head strong", text.annotations.sessions);

    setElementText(
      ".query-history-panel-head strong",
      text.global.queryHistory,
    );
    setButtonLabel(
      document.querySelector("#query-history-panel-close"),
      text.annotations.close,
    );
    // DB ビューアは動的構築なので chrome の selector 走査では拾えない。
    // 言語切替時にビュー側の localize() を呼んで再適用する。
    relocalizeDatabase?.();
  }

  // createHistoryView / createDatabaseView 後に登録されるビュー再ローカライズ関数。
  // localizeViewerChrome より後 (init / 言語切替) に呼ばれるため遅延参照する。
  let relocalizeHistory: (() => void) | null = null;
  let relocalizeJournal: (() => void) | null = null;
  let relocalizeDatabase: (() => void) | null = null;

  // createQuickHelp 後に代入される (同じ遅延参照パターン)。
  let QUICK_HELP: ReturnType<typeof createQuickHelp> | null = null;

  function setViewerLanguage(language: ViewerLanguage, persist = true) {
    const next = normalizeViewerLanguage(language);
    STATE.language = next;
    if (persist) patchSettings({ language: next });
    const select =
      document.querySelector<HTMLSelectElement>("#viewer-language");
    if (select) select.value = next;
    localizeViewerChrome();
    if (STATE.route.screen === "help") {
      setRoute(
        {
          screen: "help",
          lang: next,
          section: helpSectionFromRoute(STATE.route),
          range: currentRange(),
        },
        true,
      );
      renderHelpPage();
    } else {
      syncHeaderMenu();
    }
  }

  function setStatus(s: "live" | "refreshing" | "error" | null) {
    const el = $("#status");
    el.classList.remove("live", "refreshing", "error");
    if (s) el.classList.add(s);
    const text = uiText();
    const label =
      s === "live"
        ? text.global.statusLive
        : s === "refreshing"
          ? text.global.statusLoading
          : s === "error"
            ? text.global.statusError
            : text.global.statusIdle;
    const labelEl = el.querySelector<HTMLElement>(".status-label");
    if (labelEl) labelEl.textContent = label;
    el.setAttribute("aria-label", label);
    updateNetworkActivity();
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
    ensureTerraformHighlightLanguage(hljsRef);
    if (!highlightConfigured && typeof hljsRef.configure === "function") {
      hljsRef.configure({ ignoreUnescapedHTML: true });
      highlightConfigured = true;
    }
    return hljsRef;
  }

  function setHighlightButton(state: "idle" | "loading" | "loaded" | "error") {
    const btn = $("#syntax-highlight");
    if (!btn) return;
    const text = uiText();
    btn.classList.toggle("active", STATE.syntaxHighlight);
    btn.classList.toggle("loading", state === "loading");
    btn.textContent =
      state === "loading"
        ? text.topbar.syntaxLoading
        : STATE.syntaxHighlight
          ? text.topbar.syntaxOn
          : text.topbar.syntaxOff;
    btn.setAttribute("aria-pressed", STATE.syntaxHighlight ? "true" : "false");
    btn.title = STATE.syntaxHighlight
      ? text.topbar.syntaxOnTitle
      : state === "loading"
        ? text.topbar.syntaxLoadingTitle
        : state === "error"
          ? text.topbar.syntaxErrorTitle
          : text.topbar.syntaxOffTitle;
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

  function routeCanUseSyntaxHighlighter(
    route: AppRoute = STATE.route,
  ): boolean {
    if (!STATE.syntaxHighlight) return false;
    // "history" also renders diff cards via the same load() pipeline as
    // "diff" once a commit is selected (HISTORY_VIEW.applyCommitRange calls
    // the shared load()), so it needs the highlighter just as much.
    if (route.screen === "diff" || route.screen === "history") return true;
    return (
      route.screen === "file" && sourceInternalPathKind(route.path) === null
    );
  }

  function ensureSyntaxHighlighterForRoute(): void {
    if (!routeCanUseSyntaxHighlighter()) return;
    loadSyntaxHighlighter().then((hljsRef) => {
      if (!hljsRef) return;
      rerenderLoadedDiffs();
    });
  }

  function setLayout(layout: LayoutMode, persist = true) {
    STATE.layout = layout;
    if (persist) patchSettings({ layout });
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
      ? uiText().settings.browserOverride
      : uiText().settings.serverDefault;
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
    const viewerLanguage =
      document.querySelector<HTMLSelectElement>("#viewer-language");
    const source = document.querySelector<HTMLElement>("#scope-omit-source");
    if (
      !pop ||
      !input ||
      !excludeInput ||
      !sidebarFontSize ||
      !codeFontSize ||
      !viewerLanguage ||
      !source
    )
      return;
    await loadSettings();
    localizeViewerChrome();
    viewerLanguage.value = STATE.language;
    sidebarFontSize.value = savedSidebarFontSize();
    codeFontSize.value = savedCodeFontSize();
    input.value = effectiveScopeOmitDirs().join("\n");
    excludeInput.value = effectiveScopeExcludeNames().join("\n");
    const watchLimitInput =
      document.querySelector<HTMLInputElement>("#scope-watch-limit");
    const watchLimitRange = document.querySelector<HTMLInputElement>(
      "#scope-watch-limit-range",
    );
    const watchLimitValue = effectiveScopeWatchLimit();
    if (watchLimitInput) {
      watchLimitInput.min = String(SERVER_SCOPE_WATCH_LIMIT_MIN);
      watchLimitInput.max = String(SERVER_SCOPE_WATCH_LIMIT_MAX);
      watchLimitInput.value = String(watchLimitValue);
    }
    if (watchLimitRange) {
      watchLimitRange.min = String(SERVER_SCOPE_WATCH_LIMIT_MIN);
      watchLimitRange.max = String(SERVER_SCOPE_WATCH_LIMIT_MAX);
      watchLimitRange.value = String(watchLimitValue);
    }
    const uploadToggle =
      document.querySelector<HTMLInputElement>("#upload-enabled");
    if (uploadToggle)
      uploadToggle.checked = APP_SETTINGS.uploadEnabled !== false;
    syncDatastoreToggles();
    source.textContent = uiText().settings.scopeSource(
      PROJECT_NAME || "default",
      scopeOmitSourceLabel(),
    );
    pop.hidden = false;
    viewerLanguage.focus();
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

  function refreshScopeSourceLabel() {
    const source = document.querySelector<HTMLElement>("#scope-omit-source");
    if (!source) return;
    source.textContent = uiText().settings.scopeSource(
      PROJECT_NAME || "default",
      scopeOmitSourceLabel(),
    );
  }

  function saveSidebarFontSize(value: string) {
    const next = normalizeViewerFontSize(value);
    mergeLocalSettings({ sidebarFontSize: next });
    applySidebarFontSize();
    patchSettings({ sidebarFontSize: next });
  }

  function saveCodeFontSize(value: string) {
    const next = normalizeViewerFontSize(value);
    mergeLocalSettings({ codeFontSize: next });
    applyCodeFontSize();
    patchSettings({ codeFontSize: next });
  }

  function saveUploadEnabled(checked: boolean) {
    mergeLocalSettings({ uploadEnabled: checked });
    patchSettings({ uploadEnabled: checked });
  }

  function saveScopeOmitDirsField(value: string) {
    const next = normalizeScopeOmitDirs(value);
    mergeLocalSettings({ scopeOmitDirs: next });
    patchSettings({ scopeOmitDirs: next });
    refreshScopeSourceLabel();
    refreshRepositoryTreeAfterSettings();
  }

  function saveScopeExcludeNamesField(value: string) {
    const next = normalizeScopeExcludeNames(value);
    mergeLocalSettings({ scopeExcludeNames: next });
    patchSettings({ scopeExcludeNames: next });
    refreshScopeSourceLabel();
    refreshRepositoryTreeAfterSettings();
  }

  function normalizeScopeWatchLimit(value: unknown): number | null {
    const parsed =
      typeof value === "number"
        ? value
        : typeof value === "string"
          ? Number(value)
          : Number.NaN;
    if (!Number.isFinite(parsed)) return null;
    const floored = Math.floor(parsed);
    if (floored < SERVER_SCOPE_WATCH_LIMIT_MIN)
      return SERVER_SCOPE_WATCH_LIMIT_MIN;
    if (floored > SERVER_SCOPE_WATCH_LIMIT_MAX)
      return SERVER_SCOPE_WATCH_LIMIT_MAX;
    return floored;
  }

  function effectiveScopeWatchLimit(): number {
    const saved = normalizeScopeWatchLimit(APP_SETTINGS.scopeWatchLimit);
    return saved ?? SERVER_SCOPE_WATCH_LIMIT_DEFAULT;
  }

  function syncScopeWatchLimitInputs(value: number) {
    const numberInput =
      document.querySelector<HTMLInputElement>("#scope-watch-limit");
    const rangeInput = document.querySelector<HTMLInputElement>(
      "#scope-watch-limit-range",
    );
    if (numberInput && numberInput.value !== String(value))
      numberInput.value = String(value);
    if (rangeInput && rangeInput.value !== String(value))
      rangeInput.value = String(value);
  }

  function saveScopeWatchLimitField(value: string) {
    const next = normalizeScopeWatchLimit(value);
    const resolved = next ?? SERVER_SCOPE_WATCH_LIMIT_DEFAULT;
    mergeLocalSettings({ scopeWatchLimit: resolved });
    patchSettings({ scopeWatchLimit: resolved });
    syncScopeWatchLimitInputs(resolved);
  }

  function previewScopeWatchLimit(value: string) {
    const next = normalizeScopeWatchLimit(value);
    if (next != null) syncScopeWatchLimitInputs(next);
  }

  function resetScopeSettings() {
    setViewerLanguage("en", false);
    mergeLocalSettings({
      sidebarFontSize: null,
      codeFontSize: null,
      scopeOmitDirs: null,
      scopeExcludeNames: null,
      scopeWatchLimit: null,
      uploadEnabled: null,
    });
    applySidebarFontSize("regular");
    applyCodeFontSize("regular");
    patchSettings({
      language: STATE.language,
      sidebarFontSize: null,
      codeFontSize: null,
      scopeOmitDirs: null,
      scopeExcludeNames: null,
      scopeWatchLimit: null,
      uploadEnabled: null,
    });
    const sidebarFontSize =
      document.querySelector<HTMLSelectElement>("#sidebar-font-size");
    const codeFontSize =
      document.querySelector<HTMLSelectElement>("#code-font-size");
    const omitDirs =
      document.querySelector<HTMLTextAreaElement>("#scope-omit-dirs");
    const excludeNames = document.querySelector<HTMLTextAreaElement>(
      "#scope-exclude-names",
    );
    const uploadToggle =
      document.querySelector<HTMLInputElement>("#upload-enabled");
    const viewerLanguage =
      document.querySelector<HTMLSelectElement>("#viewer-language");
    if (sidebarFontSize) sidebarFontSize.value = "regular";
    if (codeFontSize) codeFontSize.value = "regular";
    if (omitDirs) omitDirs.value = effectiveScopeOmitDirs().join("\n");
    if (excludeNames)
      excludeNames.value = effectiveScopeExcludeNames().join("\n");
    if (uploadToggle) uploadToggle.checked = true;
    if (viewerLanguage) viewerLanguage.value = STATE.language;
    refreshScopeSourceLabel();
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
    if (options.title) {
      input.title = options.title;
      input.setAttribute("aria-label", options.title);
    }
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

  // fetch() is wrapped once at startup, so new server calls are counted and
  // cancellable without every feature remembering to call trackLoad.
  function trackLoad<T>(promise: Promise<T>): Promise<T> {
    return NETWORK_ACTIVITY.track(promise);
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

  // While on the history screen, commit selection rewrites STATE.from/to to
  // drive the diff pane. The from/to the user chose for the Diff Viewer is
  // parked here on entry and restored on exit so the two screens stay
  // independent. Declared before the startup calls below to avoid TDZ.
  let preHistoryRange: DiffRange | null = null;
  let activeHistoryPathFilter: string | null = null;
  let activeFileHistoryDiffHost: HTMLElement | null = null;
  let activeFileHistoryEmptyHost: HTMLElement | null = null;
  function isFileHistoryRoute(
    route: AppRoute,
  ): route is Extract<AppRoute, { screen: "file" }> & { view: "history" } {
    return route.screen === "file" && route.view === "history";
  }
  function isHistoryPanelRoute(route: AppRoute): boolean {
    return route.screen === "history" || isFileHistoryRoute(route);
  }
  function normalizeInternalFileRoute(route: AppRoute): AppRoute {
    if (route.screen !== "file") return route;
    if (sourceInternalPathKind(route.path) === null) return route;
    if (route.view === "blob" && !route.preview && !route.line) return route;
    return {
      screen: "file",
      path: route.path,
      ref: route.ref,
      range: route.range,
      view: "blob",
    };
  }
  function parkRangeForHistory() {
    if (preHistoryRange === null)
      preHistoryRange = { from: STATE.from, to: STATE.to };
  }
  function restoreRangeAfterHistory() {
    if (!preHistoryRange) return;
    STATE.from = preHistoryRange.from;
    STATE.to = preHistoryRange.to;
    preHistoryRange = null;
    activeHistoryPathFilter = null;
    syncRefInputs();
  }

  function repoFileTargetFromRoute(): string | null {
    return isBlobOrBlameFileRoute(STATE.route) ||
      isFileHistoryRoute(STATE.route)
      ? STATE.route.ref
      : null;
  }

  function repoFileTargetForControls(): string | null {
    return repoFileTargetFromRoute();
  }

  function removeFileHistoryShell(): void {
    removeRenderedFileHistoryShell();
    activeFileHistoryDiffHost = null;
    activeFileHistoryEmptyHost = null;
  }

  function renderFileHistoryShell(
    route: Extract<AppRoute, { screen: "file" }>,
  ) {
    const historyRoute = { ...route, view: "history" as const };
    const mount = renderFileHistoryShellView(
      {
        $,
        repoFileTargetFromRoute,
        renderRepoBlobSidebar: (path, ref) =>
          REPO_VIEW.renderRepoBlobSidebar(path, ref),
        placeSidebarToggle,
        currentRange,
        setRoute,
        setPreferredSourceTab: (tab) => SOURCE_VIEW.setPreferredSourceTab(tab),
        createFileBreadcrumb: (path, ref) =>
          DIFF_VIEW.createFileBreadcrumb(path, ref),
        emptyText: () => uiText().diff,
      },
      historyRoute,
    );
    activeFileHistoryDiffHost = mount.diffHost;
    activeFileHistoryEmptyHost = mount.emptyHost;
    return mount;
  }

  // Annotations UI (annotations-ui.ts) is constructed near the end of this
  // file once its dependencies exist; the few call sites that can run before
  // that (setRoute, lazy diff renders) go through this late-bound handle.
  let ANNOTATIONS_UI: AnnotationsUi | null = null;
  let JOURNAL_VIEW: JournalView | null = null;

  function applyInlineAnnotations() {
    ANNOTATIONS_UI?.applyInlineAnnotations();
  }

  function withAnnotationSessionParam(rawUrl: string): string {
    return ANNOTATIONS_UI ? ANNOTATIONS_UI.withSessionParam(rawUrl) : rawUrl;
  }

  function urlForRoute(route: AppRoute): string {
    return withDoctorOverlay(
      withAnnotationSessionParam(buildRoute(route)),
      parseDoctorOverlay(window.location.pathname, window.location.search),
    );
  }

  function historyStateForRoute(route: AppRoute): unknown {
    return route.screen === "file"
      ? {
          screen: "file",
          path: route.path,
          ref: route.ref,
          view: route.view || "detail",
        }
      : { view: route.screen };
  }

  function replaceUrlWithCurrentRoute(): void {
    const base = withAnnotationSessionParam(buildRoute(STATE.route));
    const url = withDoctorOverlay(
      base,
      parseDoctorOverlay(window.location.pathname, window.location.search),
    );
    const current = window.location.pathname + window.location.search;
    if (url !== current) {
      history.replaceState(
        historyStateForRoute(STATE.route),
        "",
        url + window.location.hash,
      );
    }
  }

  function dispatchFileRoute(
    route: Extract<AppRoute, { screen: "file" }>,
  ): boolean {
    if (route.view === "blob") {
      setStatus("live");
      removeFileHistoryShell();
      BLAME_VIEW.removeBlamePage();
      applySourceRouteToShell();
      return true;
    }
    if (route.view === "blame") {
      setStatus("live");
      cancelActiveSourceLoad("navigation");
      removeFileHistoryShell();
      void BLAME_VIEW.renderBlamePage({ path: route.path, ref: route.ref });
      return true;
    }
    if (route.view === "history") {
      setStatus("live");
      cancelActiveSourceLoad("navigation");
      BLAME_VIEW.removeBlamePage();
      removeStandaloneSource();
      parkRangeForHistory();
      setPageMode();
      const mount = renderFileHistoryShell(route);
      void HISTORY_VIEW.enterHistory({ mount });
      return true;
    }
    return false;
  }

  function shouldDispatchFileRouteAfterSetRoute(
    previousRoute: AppRoute,
    nextRoute: AppRoute,
  ): nextRoute is Extract<AppRoute, { screen: "file" }> {
    if (nextRoute.screen !== "file") return false;
    if (previousRoute.screen !== "file") return true;
    return (
      previousRoute.view !== nextRoute.view ||
      previousRoute.path !== nextRoute.path ||
      previousRoute.ref !== nextRoute.ref
    );
  }

  function isSameBlobFileRoute(previousRoute: AppRoute, nextRoute: AppRoute) {
    return (
      previousRoute.screen === "file" &&
      previousRoute.view === "blob" &&
      nextRoute.screen === "file" &&
      nextRoute.view === "blob" &&
      previousRoute.path === nextRoute.path &&
      previousRoute.ref === nextRoute.ref
    );
  }

  function routeBlobPreview(route: AppRoute): boolean {
    return route.screen === "file" && route.view === "blob" && !!route.preview;
  }

  function setRoute(route: AppRoute, replace = false) {
    const previousRoute = STATE.route;
    let nextRoute =
      route.screen === "unknown"
        ? { screen: "diff" as const, range: route.range }
        : normalizeInternalFileRoute(route);
    if (isHistoryPanelRoute(previousRoute) && !isHistoryPanelRoute(nextRoute)) {
      if (preHistoryRange) nextRoute = { ...nextRoute, range: preHistoryRange };
      HISTORY_VIEW.leaveHistory();
      activeHistoryPathFilter = null;
      preHistoryRange = null;
      removeFileHistoryShell();
    }
    if (previousRoute.screen === "journal" && nextRoute.screen !== "journal") {
      JOURNAL_VIEW?.suspend();
    }
    STATE.route = nextRoute;
    STATE.from = nextRoute.range.from;
    STATE.to = nextRoute.range.to;
    if (
      nextRoute.screen === "repo" ||
      (nextRoute.screen === "file" &&
        (nextRoute.view === "blob" ||
          nextRoute.view === "blame" ||
          nextRoute.view === "history"))
    ) {
      STATE.repoRef = nextRoute.ref || "worktree";
    }
    const url = urlForRoute(nextRoute);
    const state = historyStateForRoute(nextRoute);
    if (replace) history.replaceState(state, "", url);
    else history.pushState(state, "", url);
    syncHeaderMenu();
    syncLineRefPill();
    if (
      isSameBlobFileRoute(previousRoute, nextRoute) &&
      routeBlobPreview(previousRoute) !== routeBlobPreview(nextRoute)
    ) {
      switchSourceTab(routeBlobPreview(nextRoute) ? "preview" : "code", {
        updateRoute: false,
      });
    }
    if (shouldDispatchFileRouteAfterSetRoute(previousRoute, nextRoute)) {
      dispatchFileRoute(nextRoute);
    }
    if (nextRoute.screen === "journal") {
      cancelActiveSourceLoad("navigation");
      setPageMode();
      removeStandaloneSource();
      void JOURNAL_VIEW?.enter();
    }
  }

  // ---- Query History right-panel open/close ----
  function setQueryHistoryPanelOpen(open: boolean) {
    const panel = document.getElementById("query-history-panel");
    if (!panel) return;
    panel.hidden = !open;
    document.body.classList.toggle("query-history-panel-open", open);
    // Mutual exclusion: close annotation panel when opening query history
    if (open && ANNOTATIONS_UI) {
      ANNOTATIONS_UI.setAnnotationPanelOpen(false);
    }
  }

  function setPageMode() {
    const historyPanelRoute = STATE.route.screen === "history";
    const fileHistoryRoute = isFileHistoryRoute(STATE.route);
    const fileRepoBlobRoute =
      STATE.route.screen === "file" &&
      (STATE.route.view === "blob" ||
        STATE.route.view === "blame" ||
        STATE.route.view === "history");
    const repoSidebarRoute = STATE.route.screen === "repo" || fileRepoBlobRoute;
    document.body.classList.toggle(
      "gdp-file-detail-page",
      STATE.route.screen === "file",
    );
    document.body.classList.toggle("gdp-repo-blob-page", fileRepoBlobRoute);
    document.body.classList.toggle(
      "gdp-repo-page",
      STATE.route.screen === "repo",
    );
    document.body.classList.toggle(
      "gdp-diff-page",
      STATE.route.screen === "diff",
    );
    document.body.classList.toggle(
      "gdp-help-page",
      STATE.route.screen === "help",
    );
    document.body.classList.toggle("gdp-history-page", historyPanelRoute);
    document.body.classList.toggle("gdp-file-history-page", fileHistoryRoute);
    document.body.classList.toggle(
      "gdp-database-page",
      STATE.route.screen === "database",
    );
    document.body.classList.toggle(
      "gdp-journal-page",
      STATE.route.screen === "journal",
    );
    const repoTargetWrap =
      document.querySelector<HTMLElement>("#repo-target-wrap");
    if (!repoSidebarRoute && repoTargetWrap) {
      repoTargetWrap.hidden = true;
      repoTargetWrap.style.display = "none";
    }
    // Repo pages park .sb-filter-wrap inside .sb-head (grid layout); other
    // pages expect it back outside as the sticky sibling. Re-place it every
    // time the page classes flip, or SPA navigation away from the repo view
    // keeps the repo-only DOM layout until a full reload.
    placeSidebarToggle();
    syncSidebarHeaderHeight();
    const historyPanel = $("#history-panel");
    if (historyPanel) historyPanel.hidden = !historyPanelRoute;
    if (historyPanelRoute) {
      const historyRefInput = $<HTMLInputElement>("#history-ref");
      if (historyRefInput) {
        const ref =
          STATE.route.screen === "file" && STATE.route.ref === "worktree"
            ? "HEAD"
            : "ref" in STATE.route
              ? STATE.route.ref || "HEAD"
              : "HEAD";
        historyRefInput.value = ref;
      }
    }
    syncRepoTargetInput(repoFileTargetForControls() || "worktree");

    // Close query-history panel when leaving database screen
    if (STATE.route.screen !== "database") {
      setQueryHistoryPanelOpen(false);
    }

    // Repository ビューに切り替わると hideTests を効かせない（DOM の
    // hidden-by-tests を剥がし直す）。Diff viewer 専用機能なので。
    applyHideTests();
  }

  function syncHeaderMenu() {
    document
      .querySelectorAll<HTMLAnchorElement>(".app-menu-item, .global-help-link")
      .forEach((link) => {
        const fileRouteOwner =
          STATE.route.screen === "file" &&
          (STATE.route.view === "blob" ||
            STATE.route.view === "blame" ||
            STATE.route.view === "history")
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
          // On the history screen the live range tracks the selected commit;
          // the Diff Viewer link keeps the range the user picked before.
          link.href = buildRoute({
            screen: "diff",
            range: preHistoryRange ?? currentRange(),
          });
        }
        if (link.dataset.route === "history") {
          link.href = buildRoute({
            screen: "history",
            ref: "HEAD",
            range: currentRange(),
          });
        }
        if (link.dataset.route === "journal") {
          link.href = buildRoute({
            screen: "journal",
            range: currentRange(),
          });
        }
        if (link.dataset.route === "database") {
          link.href = buildRoute({
            screen: "database",
            range: currentRange(),
          });
        }
        if (link.dataset.route === "help") {
          link.href = buildRoute({
            screen: "help",
            lang:
              STATE.route.screen === "help"
                ? helpLanguageFromRoute(STATE.route)
                : STATE.language,
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
    getLanguage: () => STATE.language,
    setLanguage: (language) => setViewerLanguage(language),
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
    persistViewedFiles: (path, viewed) =>
      patchViewState(
        viewed ? { addedViewedFiles: [path] } : { removedViewedFiles: [path] },
      ),
    applyHideTests: () => applyHideTests(),
    getServerGeneration: () => SERVER_GENERATION,
    setServerGeneration: (generation: number) => {
      SERVER_GENERATION = generation;
    },
    invalidateRepoSidebar,
    diffText: () => uiText().diff,
    getDiffRoot: () => activeFileHistoryDiffHost || $("#diff"),
    getEmptyPane: () => activeFileHistoryEmptyHost || $("#empty"),
    isEmbeddedDiffMode: () => !!activeFileHistoryDiffHost,
  });
  const {
    renderMeta,
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
    loadDiffFile,
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

  // Static Octicon SVGs for the global header. Run once at init; none of
  // these icons change with theme/language, unlike the badges that live
  // alongside them (#annotations-count, #doctor-badge) which keep their own
  // sibling <span> so this never clobbers them.
  function setGlobalHeaderIcons() {
    const annotationsIcon = document.querySelector<HTMLElement>(
      "#annotations-toggle .goi-icon",
    );
    if (annotationsIcon) {
      annotationsIcon.innerHTML = iconSvg(
        "octicon-comment-discussion",
        COMMENT_DISCUSSION_16_PATH,
      );
    }
    const doctorIcon = document.querySelector<HTMLElement>(
      "#doctor-btn .goi-icon",
    );
    if (doctorIcon) {
      doctorIcon.innerHTML = iconSvg("octicon-pulse", PULSE_16_PATH);
    }
    const themeButton = document.querySelector<HTMLButtonElement>("#theme");
    if (themeButton) {
      themeButton.innerHTML = iconSvg("octicon-moon", MOON_16_PATH);
    }
    const copyAiContextIcon = document.querySelector<HTMLElement>(
      "#copy-ai-context .goi-icon",
    );
    if (copyAiContextIcon) {
      copyAiContextIcon.innerHTML = iconSvg("octicon-copy", COPY_16_PATHS);
    }
    const autoUpdateIcon = document.querySelector<HTMLElement>(
      "#auto-update .goi-icon",
    );
    if (autoUpdateIcon) {
      autoUpdateIcon.innerHTML = iconSvg("octicon-sync", SYNC_16_PATH);
    }
    const cancelRequestsIcon = document.querySelector<HTMLElement>(
      "#cancel-requests .goi-icon",
    );
    if (cancelRequestsIcon) {
      cancelRequestsIcon.innerHTML = iconSvg("octicon-x", X_16_PATH);
    }
  }

  // Static SVGs for the topbar ref-picker actions. Run once at
  // init, same as setGlobalHeaderIcons(); title/aria-label stay in sync
  // with the active language via localizeViewerChrome() instead.
  function setRefActionIcons() {
    const refReset = document.querySelector<HTMLButtonElement>("#ref-reset");
    if (refReset) refReset.innerHTML = iconSvg("octicon-x", X_16_PATH);
    const reload = document.querySelector<HTMLButtonElement>("#reload-prom");
    if (reload) reload.innerHTML = iconSvg("octicon-sync", SYNC_16_PATH);
  }

  // ----- wiring -----
  applySidebarFontSize();
  applyCodeFontSize();
  applySidebarHidden(STATE.sidebarHidden, { persist: false });
  observeSidebarHeaderHeight();
  installHistoryPageDom();
  hydrateRefSelectorMounts();
  setSidebarTreeActionIcons();
  setGlobalHeaderIcons();
  setRefActionIcons();
  // Sidebar view toggle (tree / flat)
  $$(".sb-view-seg button").forEach((b) => {
    b.addEventListener("click", () => {
      STATE.sbView = (b.dataset.view as SidebarView) || "tree";
      patchSettings({ sidebarView: STATE.sbView });
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
  $("#viewer-settings")?.addEventListener("click", toggleScopeSettings);
  $("#doctor-btn")?.addEventListener("click", (event) => {
    event.preventDefault();
    toggleDoctorSheet();
  });
  let copyAiContextFeedbackTimer: ReturnType<typeof setTimeout> | null = null;
  $("#copy-ai-context")?.addEventListener("click", async (event) => {
    const button = event.currentTarget as HTMLButtonElement;
    const feedback = document.querySelector<HTMLElement>(
      "#copy-ai-context-feedback",
    );
    const selectionTarget = resolveSelectionTarget(STATE.route);
    let selectionCode: { lines: string[]; lang?: string | null } | undefined;
    if (event.shiftKey && selectionTarget) {
      const renderedLines = readRenderedLines(
        selectionTarget.path,
        selectionTarget.start,
        selectionTarget.end,
      );
      if (renderedLines.length > 0) {
        selectionCode = {
          lines: renderedLines,
          lang: langFromPath(selectionTarget.path),
        };
      }
    }
    const databaseQuerySql =
      STATE.route.screen === "database" && STATE.route.tab === "query"
        ? document.querySelector<HTMLTextAreaElement>(
            ".db-container:not([hidden]) .db-query-editor:not([hidden]) .db-query-textarea",
          )?.value
        : undefined;
    const text = aiContextClipboardText({
      route: STATE.route,
      diffFrom: STATE.from,
      diffTo: STATE.to,
      selectionCode,
      diffMeta: window._lastMeta
        ? visibleDiffMetaForBrief(window._lastMeta)
        : null,
      viewedFiles: STATE.viewedFiles,
      databaseQuerySql,
    });
    const finish = (
      ok: boolean,
      withCode: boolean,
      lineCount: number,
      reason?: "empty",
    ) => {
      const label =
        reason === "empty"
          ? uiText().global.copyAiContextEmpty
          : ok
            ? withCode
              ? uiText().global.copyAiContextCopiedWithCode(lineCount)
              : uiText().global.copyAiContextCopied
            : uiText().global.copyAiContextFailed;
      const isLargeCopy =
        ok &&
        withCode &&
        lineCount >= AI_CONTEXT_LARGE_SELECTION_LINE_THRESHOLD;
      // "empty" stays the neutral default look (no copied/failed/warn class).
      // This is not an error; there was just nothing to put on the clipboard.
      const stateClass =
        reason === "empty"
          ? ""
          : ok
            ? isLargeCopy
              ? "warn"
              : "copied"
            : "failed";
      button.classList.remove("copied", "failed", "warn");
      if (stateClass) button.classList.add(stateClass);
      button.title = label;
      button.setAttribute("aria-label", label);
      if (feedback) {
        feedback.textContent = label;
        feedback.classList.remove("copied", "failed", "warn");
        if (stateClass) feedback.classList.add(stateClass);
        feedback.hidden = false;
      }
      if (copyAiContextFeedbackTimer) clearTimeout(copyAiContextFeedbackTimer);
      copyAiContextFeedbackTimer = setTimeout(() => {
        copyAiContextFeedbackTimer = null;
        button.classList.remove("copied", "failed", "warn");
        button.title = uiText().global.copyAiContext;
        button.setAttribute("aria-label", uiText().global.copyAiContext);
        if (feedback) {
          feedback.hidden = true;
          feedback.classList.remove("copied", "failed", "warn");
        }
      }, 1200);
    };
    if (!text) {
      finish(false, false, 0, "empty");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      finish(true, !!selectionCode, selectionCode?.lines.length ?? 0);
    } catch {
      finish(false, false, 0);
    }
  });
  $("#scope-settings-close")?.addEventListener("click", closeScopeSettings);
  $("#scope-omit-reset")?.addEventListener("click", resetScopeSettings);
  $("#viewer-language")?.addEventListener("change", (event) => {
    const select = event.currentTarget as HTMLSelectElement;
    setViewerLanguage(normalizeViewerLanguage(select.value));
    refreshScopeSourceLabel();
  });
  $("#sidebar-font-size")?.addEventListener("change", (event) => {
    saveSidebarFontSize((event.currentTarget as HTMLSelectElement).value);
  });
  $("#code-font-size")?.addEventListener("change", (event) => {
    saveCodeFontSize((event.currentTarget as HTMLSelectElement).value);
  });
  $("#upload-enabled")?.addEventListener("change", (event) => {
    saveUploadEnabled((event.currentTarget as HTMLInputElement).checked);
  });
  // データストアセクションのトグル: db-ui pref に直接 PATCH する。
  // 既存ロケーション (サイドバー prefs バー / S3 explorer 内) からは取り除き、
  // ここに集約済み。
  $("#datastore-infer-fk")?.addEventListener("change", (event) => {
    DATABASE_VIEW.setDbUiPref(
      "inferFkRails",
      (event.currentTarget as HTMLInputElement).checked,
    );
  });
  $("#datastore-s3-tooltip")?.addEventListener("change", (event) => {
    DATABASE_VIEW.setDbUiPref(
      "s3TooltipEnabled",
      (event.currentTarget as HTMLInputElement).checked,
    );
  });

  // 設定パネルが開かれた時 (loadSettings 経由) に最新の pref 値で
  // checkbox を初期化するヘルパ。DATABASE_VIEW の宣言後に実行されるので
  // 実行時参照は安全。
  function syncDatastoreToggles(): void {
    const inferToggle = document.querySelector<HTMLInputElement>(
      "#datastore-infer-fk",
    );
    if (inferToggle) {
      inferToggle.checked = DATABASE_VIEW.getDbUiPref("inferFkRails", false);
    }
    const tooltipToggle = document.querySelector<HTMLInputElement>(
      "#datastore-s3-tooltip",
    );
    if (tooltipToggle) {
      tooltipToggle.checked = DATABASE_VIEW.getDbUiPref(
        "s3TooltipEnabled",
        true,
      );
    }
  }
  $("#scope-omit-dirs")?.addEventListener("change", (event) => {
    saveScopeOmitDirsField((event.currentTarget as HTMLTextAreaElement).value);
  });
  $("#scope-exclude-names")?.addEventListener("change", (event) => {
    saveScopeExcludeNamesField(
      (event.currentTarget as HTMLTextAreaElement).value,
    );
  });
  $("#scope-watch-limit")?.addEventListener("change", (event) => {
    saveScopeWatchLimitField((event.currentTarget as HTMLInputElement).value);
  });
  $("#scope-watch-limit-range")?.addEventListener("input", (event) => {
    previewScopeWatchLimit((event.currentTarget as HTMLInputElement).value);
  });
  $("#scope-watch-limit-range")?.addEventListener("change", (event) => {
    saveScopeWatchLimitField((event.currentTarget as HTMLInputElement).value);
  });
  $("#scope-settings-popover")?.addEventListener("keydown", (e) => {
    if (isImeComposing(e)) return;
    if (e.key === "Escape") closeScopeSettings();
  });
  localizeViewerChrome();
  prepareKeyboardPanels();
  const contentPanel = document.querySelector<HTMLElement>("#content");
  contentPanel?.addEventListener("focusin", () => setPanelFocusScope("main"));
  contentPanel?.addEventListener("mousedown", (event) => {
    if (isFocusableClickTarget(event.target)) setPanelFocusScope("main");
    else focusMainPanel();
  });

  function applyHistoryWidth(w: number, persist = true) {
    const cw = Math.max(220, Math.min(640, w));
    document.documentElement.style.setProperty("--history-w", `${cw}px`);
    STATE.historyWidth = cw;
    if (persist) patchSettings({ historyWidth: cw });
  }

  // History and sidebar resizers (drag right edge)
  applyHistoryWidth(STATE.historyWidth, false);
  applySidebarWidth(STATE.sbWidth, { persist: false });
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
    const sidebarLeft = () =>
      document.getElementById("sidebar")?.getBoundingClientRect().left || 0;
    let dragging = false,
      startX = 0,
      startW = 0,
      startLeft = 0,
      currentW = 0;

    handle.addEventListener("mousedown", (e) => {
      dragging = true;
      startX = e.clientX;
      startW = STATE.sbWidth;
      startLeft = sidebarLeft();
      currentW = startW;
      document.body.classList.add("gdp-resizing");
      preview.style.display = "block";
      preview.style.left = `${startLeft + startW}px`;
      e.preventDefault();
    });
    window.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      currentW = clamp(startW + (e.clientX - startX));
      preview.style.left = `${startLeft + currentW}px`;
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
  (function setupHistoryResizer() {
    const handle = document.getElementById("history-resizer");
    if (!handle) return;
    const preview = document.createElement("div");
    preview.id = "history-resize-preview";
    document.body.appendChild(preview);

    const MIN = 220,
      MAX = 640;
    const clamp = (w: number) => Math.max(MIN, Math.min(MAX, w));
    let dragging = false,
      startX = 0,
      startW = 0,
      currentW = 0;

    handle.addEventListener("mousedown", (e) => {
      dragging = true;
      startX = e.clientX;
      startW = STATE.historyWidth;
      currentW = startW;
      document.body.classList.add("gdp-history-resizing");
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
      document.body.classList.remove("gdp-history-resizing");
      applyHistoryWidth(currentW);
    });
    handle.addEventListener("dblclick", () => applyHistoryWidth(320));
  })();

  $$("#topbar .seg button").forEach((b) => {
    b.addEventListener("click", () =>
      setLayout((b.dataset.layout as LayoutMode) || "side-by-side"),
    );
  });
  $("#theme").addEventListener("click", () => {
    STATE.theme = STATE.theme === "dark" ? "light" : "dark";
    patchSettings({ theme: STATE.theme });
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
    sbFilter.addEventListener("input", () => {
      syncSidebarFilterClearButton();
      scheduleApplyFilter();
    });
    sbFilter.addEventListener("keydown", (e) => {
      if (isImeComposing(e)) return;
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
          syncSidebarFilterClearButton();
          flushSidebarFilter();
          applyFilter();
        } else {
          sbFilter.blur();
        }
      }
    });
  }
  const sbFilterClear =
    document.querySelector<HTMLButtonElement>("#sb-filter-clear");
  if (sbFilterClear) {
    syncSidebarFilterClearButton();
    sbFilterClear.addEventListener("click", clearSidebarFilter);
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
    if (action === "copy-ai-context") {
      $("#copy-ai-context")?.click();
      return true;
    }
    if (action === "copy-ai-context-with-code") {
      $("#copy-ai-context")?.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          shiftKey: true,
        }),
      );
      return true;
    }
    if (action === "next-unviewed-file") {
      if (DIFF_VIEW.scrollToNextUnviewedFile()) scheduleMainSurfaceFocus();
      return true;
    }
    if (action === "open-help") {
      QUICK_HELP?.toggle();
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
    if (isImeComposing(e)) return;
    if (e.key === "Escape") closeRepoContextMenu();
    if ((e as VirtualSourcePagingKeyboardEvent).__gdpVirtualSourcePagingHandled)
      return;
    const targetEl = e.target as Element | null;
    if (
      e.key === "Escape" &&
      !isEditableKeyTarget(targetEl) &&
      clearLineSelection()
    ) {
      e.preventDefault();
      return;
    }
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
      composing: isImeComposing(e),
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

  function normalizedHistoryRefForEmptyDiff(): string {
    const candidate =
      STATE.to && STATE.to !== "worktree" ? STATE.to : STATE.from || "HEAD";
    return candidate && candidate !== "worktree" && !candidate.startsWith("--")
      ? candidate
      : "HEAD";
  }

  function emptyDiffHistoryRoute(): AppRoute {
    return {
      screen: "history",
      ref: normalizedHistoryRefForEmptyDiff(),
      range: currentRange(),
    };
  }

  function setEmptyActionContent(
    action: HTMLElement,
    iconName: string,
    iconPath: string,
    label: string,
    title: string,
  ): void {
    action.title = title;
    action.setAttribute("aria-label", title);
    action.replaceChildren();
    const icon = document.createElement("span");
    icon.className = "empty-action-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.innerHTML = iconSvg(iconName, iconPath);
    const text = document.createElement("span");
    text.className = "empty-action-label";
    text.textContent = label;
    action.append(icon, text);
  }

  function navigateToEmptyDiffHistory(event: MouseEvent): void {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
      return;
    event.preventDefault();
    const route = emptyDiffHistoryRoute();
    history.pushState(historyStateForRoute(route), "", urlForRoute(route));
    window.scrollTo(0, 0);
    applyRouteFromLocation();
  }

  function ensureEmptyDiffActions(empty: HTMLElement): HTMLElement {
    let actions = empty.querySelector<HTMLElement>(".empty-actions");
    if (actions) return actions;
    actions = document.createElement("div");
    actions.className = "empty-actions";
    actions.hidden = true;

    const reload = document.createElement("button");
    reload.type = "button";
    reload.className = "empty-action empty-action-primary";
    reload.dataset.emptyAction = "reload";
    reload.addEventListener("click", () => reloadDiffFromUi(reload));

    const historyLink = document.createElement("a");
    historyLink.className = "empty-action";
    historyLink.dataset.emptyAction = "history";
    historyLink.addEventListener("click", navigateToEmptyDiffHistory);

    actions.append(reload, historyLink);
    empty.appendChild(actions);
    return actions;
  }

  function syncEmptyDiffPane(empty: HTMLElement, onHistory: boolean): void {
    empty.classList.toggle("empty-with-actions", !onHistory);
    const text = uiText().diff;
    const h2 = empty.querySelector("h2");
    if (h2)
      h2.textContent = onHistory ? text.emptyDiffTitle : text.noChangesTitle;
    const p = empty.querySelector("p");
    if (p) p.textContent = onHistory ? text.emptyDiffBody : text.noChangesBody;

    const existingActions = empty.querySelector<HTMLElement>(".empty-actions");
    if (onHistory) {
      if (existingActions) existingActions.hidden = true;
      return;
    }

    const actions = ensureEmptyDiffActions(empty);
    const reload = actions.querySelector<HTMLElement>(
      '[data-empty-action="reload"]',
    );
    const historyLink = actions.querySelector<HTMLAnchorElement>(
      '[data-empty-action="history"]',
    );
    if (reload)
      setEmptyActionContent(
        reload,
        "octicon-sync",
        SYNC_16_PATH,
        text.noChangesReload,
        text.noChangesReloadTitle,
      );
    if (historyLink) {
      const route = emptyDiffHistoryRoute();
      historyLink.href = urlForRoute(route);
      setEmptyActionContent(
        historyLink,
        "octicon-git-branch",
        GIT_BRANCH_16_PATH,
        text.noChangesHistory,
        text.noChangesHistoryTitle,
      );
    }
    actions.hidden = false;
  }

  function reloadDiffFromUi(trigger?: HTMLElement | null): void {
    const topbarButton = $("#reload-prom");
    topbarButton.classList.add("spinning");
    topbarButton.setAttribute("aria-busy", "true");
    if (trigger && trigger !== topbarButton) {
      trigger.classList.add("spinning");
      trigger.setAttribute("aria-busy", "true");
    }
    load().finally(() => {
      setTimeout(() => {
        topbarButton.classList.remove("spinning");
        topbarButton.setAttribute("aria-busy", "false");
        if (trigger && trigger !== topbarButton) {
          trigger.classList.remove("spinning");
          trigger.setAttribute("aria-busy", "false");
        }
      }, 200);
    });
  }

  function load(
    options: { force?: boolean; changedPaths?: Set<string> | null } = {},
  ): Promise<RenderResult | null> {
    if (STATE.route.screen === "help") {
      setStatus("live");
      renderHelpPage();
      syncHeaderMenu();
      return Promise.resolve(null);
    }
    if (STATE.route.screen === "database") {
      void DATABASE_VIEW.enter(
        STATE.route.db,
        STATE.route.schema,
        STATE.route.table,
        STATE.route.tab,
      ).then(() => ANNOTATIONS_UI?.applyInlineAnnotations());
      setStatus("live");
      return Promise.resolve(null);
    }
    if (STATE.route.screen === "journal") {
      void JOURNAL_VIEW?.enter();
      setStatus("live");
      return Promise.resolve(null);
    }
    if (
      STATE.route.screen === "file" &&
      !(isFileHistoryRoute(STATE.route) && activeHistoryPathFilter) &&
      dispatchFileRoute(STATE.route)
    ) {
      return Promise.resolve({
        structureChanged: false,
        invalidatedCards: 0,
        preservedDom: true,
      });
    }
    if (STATE.route.screen === "repo") return loadRepo().then(() => null);
    {
      const empty = activeFileHistoryEmptyHost || $("#empty");
      if (empty) {
        const onHistory =
          STATE.route.screen === "history" || isFileHistoryRoute(STATE.route);
        syncEmptyDiffPane(empty, onHistory);
      }
    }
    const routeAtRequest = STATE.route;
    const fromAtRequest = STATE.from;
    const toAtRequest = STATE.to;
    const ignoreWsAtRequest = STATE.ignoreWs;
    const isCurrentDiffRequest = () =>
      STATE.route === routeAtRequest &&
      STATE.from === fromAtRequest &&
      STATE.to === toAtRequest &&
      STATE.ignoreWs === ignoreWsAtRequest;
    setStatus("refreshing");
    const params = new URLSearchParams();
    if (STATE.ignoreWs) params.set("ignore_ws", "1");
    if (STATE.from) params.set("from", STATE.from);
    if (STATE.to) params.set("to", STATE.to);
    if (activeHistoryPathFilter) params.set("path", activeHistoryPathFilter);
    if (options.force) params.set("nocache", "1");
    const url = `/diff.json${params.toString() ? `?${params.toString()}` : ""}`;
    return trackLoad<DiffMeta>(fetch(url).then((r) => r.json()))
      .then((data) => {
        if (!isCurrentDiffRequest()) return null;
        const result = renderShell(data, options.changedPaths);
        applyHideTestsToMeta();
        setStatus(data.error ? "error" : "live");
        return result;
      })
      .catch(() => {
        if (!isCurrentDiffRequest()) return null;
        setStatus("error");
        return null;
      });
  }
  loadInitialState().finally(() => {
    if (STATE.route.screen === "help") {
      setStatus("live");
      renderHelpPage();
    } else if (STATE.route.screen === "repo") loadRepo();
    else if (STATE.route.screen === "file" && dispatchFileRoute(STATE.route)) {
      // handled by dispatchFileRoute
    } else if (STATE.route.screen === "history") {
      parkRangeForHistory();
      setStatus("live");
      HISTORY_VIEW.enterHistory();
    } else if (STATE.route.screen === "database") {
      setStatus("live");
      void DATABASE_VIEW.enter(
        STATE.route.db,
        STATE.route.schema,
        STATE.route.table,
        STATE.route.tab,
      ).then(() => ANNOTATIONS_UI?.applyInlineAnnotations());
    } else if (STATE.route.screen === "journal") {
      setStatus("live");
      void JOURNAL_VIEW?.enter();
    } else load();
    // Deep links land here without going through setRoute; reflect a line=
    // selection in the copy pill on first paint too.
    syncLineRefPill();
    syncDoctorSheetFromUrl();
  });

  // Ref picker (from / to)
  function syncRefInputs() {
    const fi = $<HTMLInputElement>("#ref-from"),
      ti = $<HTMLInputElement>("#ref-to");
    if (fi) fi.value = STATE.from;
    if (ti) ti.value = STATE.to;
  }
  function setRange(from: string, to: string) {
    // An explicit range pick supersedes whatever was parked for history.
    preHistoryRange = null;
    const wasDatabaseRoute = STATE.route.screen === "database";
    STATE.from = from || "";
    STATE.to = to || "";
    patchSettings({ range: currentRange() });
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
      if (wasDatabaseRoute) DATABASE_VIEW.suspend();
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
    applyCommitRange: (range, pathFilter) => {
      cancelInFlightRequests();
      DIFF_VIEW.clearLoadQueue();
      STATE.from = range.from;
      STATE.to = range.to;
      activeHistoryPathFilter = pathFilter || null;
      syncRefInputs();
      return load().then(() => undefined);
    },
    showEmptyDiffPane: () => {
      if (activeFileHistoryDiffHost || activeFileHistoryEmptyHost) {
        activeFileHistoryDiffHost?.replaceChildren();
        STATE.files = [];
        window._lastMeta = null;
        renderMeta(null);
        DIFF_VIEW.clearLoadQueue();
        if (activeFileHistoryEmptyHost) {
          activeFileHistoryEmptyHost.classList.remove("hidden");
          const text = uiText().diff;
          const h2 = activeFileHistoryEmptyHost.querySelector("h2");
          if (h2) h2.textContent = text.noCommitSelectedTitle;
          const p = activeFileHistoryEmptyHost.querySelector("p");
          if (p) p.textContent = text.noCommitSelectedBody;
        }
        setStatus("live");
        return;
      }
      showEmptyHistoryDiffPane({
        diff: $("#diff"),
        empty: $("#empty"),
        renderSidebar,
        setFiles: (files) => {
          STATE.files = files;
        },
        clearLastMeta: () => {
          window._lastMeta = null;
        },
        renderMeta,
        invalidateRepoSidebar,
        clearLoadQueue: () => DIFF_VIEW.clearLoadQueue(),
        placeSidebarToggle,
        setStatus,
        emptyText: () => uiText().diff,
      });
    },
    getSyntaxHighlight: () => STATE.syntaxHighlight,
    getLanguage: () => STATE.language,
    trackLoad,
  });
  relocalizeHistory = () => HISTORY_VIEW.localize();

  QUICK_HELP = createQuickHelp({
    $,
    getLanguage: () => STATE.language,
    getText: () => uiText().quickHelp,
    openFullKeybindings: () => {
      openHelpKeybindings({
        getRoute: () => STATE.route,
        getLanguage: () => STATE.language,
        currentRange,
        setRoute,
        setPageMode,
        renderHelpPage,
        setStatus,
        cancelActiveSourceLoad,
      });
    },
  });

  const DOCTOR_VIEW = createDoctorView({
    $: <T extends Element = HTMLElement>(sel: string) =>
      document.querySelector<T>(sel),
    escapeHtml,
    trackLoad,
    getLanguage: () => STATE.language,
    onWorstStatusChange: (status) => {
      const badge = document.getElementById("doctor-badge");
      if (!badge) return;
      if (status === "error") {
        badge.hidden = false;
        badge.dataset.level = "error";
      } else if (status === "warn") {
        badge.hidden = false;
        badge.dataset.level = "warn";
      } else {
        badge.hidden = true;
        badge.removeAttribute("data-level");
      }
    },
    onCloseRequest: () => closeDoctorSheet(),
  });

  function isDoctorOverlayOpen(): boolean {
    return parseDoctorOverlay(window.location.pathname, window.location.search);
  }

  function updateUrlForDoctorOverlay(open: boolean): void {
    const current = window.location.pathname + window.location.search;
    const next = withDoctorOverlay(current, open);
    if (next !== current) {
      history.replaceState(history.state, "", next + window.location.hash);
    }
  }

  function openDoctorSheet(): void {
    updateUrlForDoctorOverlay(true);
    void DOCTOR_VIEW.open();
  }

  function closeDoctorSheet(): void {
    DOCTOR_VIEW.close();
    updateUrlForDoctorOverlay(false);
  }

  function toggleDoctorSheet(): void {
    if (isDoctorOverlayOpen() || DOCTOR_VIEW.isOpen()) closeDoctorSheet();
    else openDoctorSheet();
  }

  function syncDoctorSheetFromUrl(): void {
    const shouldOpen = isDoctorOverlayOpen();
    const open = DOCTOR_VIEW.isOpen();
    if (shouldOpen && !open) void DOCTOR_VIEW.open();
    else if (!shouldOpen && open) DOCTOR_VIEW.close();
  }

  document
    .getElementById("doctor-sheet-overlay")
    ?.addEventListener("click", () => closeDoctorSheet());
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (!DOCTOR_VIEW.isOpen()) return;
    event.preventDefault();
    closeDoctorSheet();
  });

  JOURNAL_VIEW = createJournalView({
    getRoute: () => STATE.route,
    setRoute,
    currentRange,
    trackLoad,
    getText: () => uiText().journal,
    setPageMode,
    syncHeaderMenu,
    setStatus,
  });
  relocalizeJournal = () => JOURNAL_VIEW?.localize();

  const DATABASE_VIEW = createDatabaseView({
    setRoute,
    setPageMode,
    currentRange,
    trackLoad,
    syncHeaderMenu,
    getLanguage: () => STATE.language,
  });
  relocalizeDatabase = () => DATABASE_VIEW.localize();

  // 他経路 (例: SSE 経由 / 別タブからの設定変更) で db-ui pref が更新された
  // 場合、開いている設定パネルの checkbox 表示を最新値に追従させる。
  DATABASE_VIEW.onDbUiPrefChange(() => {
    if (
      !document.querySelector<HTMLElement>("#scope-settings-popover")?.hidden
    ) {
      syncDatastoreToggles();
    }
  });

  const REF_PICKER = createRefPicker({
    $,
    escapeHtml,
    currentRange,
    setRange,
    setRoute,
    loadRepo,
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
    const previousRoute = STATE.route;
    // Leaving the history screen: bring back the range the user had picked
    // for the other screens before the URL fallback below reads it.
    if (
      isHistoryPanelRoute(previousRoute) &&
      window.location.pathname !== "/history" &&
      !(
        window.location.pathname === "/file" &&
        new URLSearchParams(window.location.search).get("view") === "history"
      )
    ) {
      restoreRangeAfterHistory();
    }
    const parsedRoute = parseRoute(
      window.location.pathname,
      window.location.search,
      currentRange(),
    );
    const routeLanguage = viewerLanguageFromSearch(window.location.search);
    if (routeLanguage && routeLanguage !== STATE.language)
      setViewerLanguage(routeLanguage);
    let nextRoute: AppRoute =
      parsedRoute.screen === "unknown"
        ? { screen: "diff", range: parsedRoute.range }
        : parsedRoute;
    nextRoute = normalizeInternalFileRoute(nextRoute);
    if (previousRoute.screen === "database" && nextRoute.screen !== "database")
      DATABASE_VIEW.suspend();
    if (previousRoute.screen === "journal" && nextRoute.screen !== "journal")
      JOURNAL_VIEW?.suspend();
    if (isHistoryPanelRoute(previousRoute) && !isHistoryPanelRoute(nextRoute))
      HISTORY_VIEW.leaveHistory();
    if (isHistoryPanelRoute(previousRoute) && !isHistoryPanelRoute(nextRoute))
      removeFileHistoryShell();
    STATE.route =
      nextRoute.screen === "help" &&
      !new URLSearchParams(window.location.search).has("lang")
        ? { ...nextRoute, lang: STATE.language }
        : nextRoute;
    STATE.from = STATE.route.range.from;
    STATE.to = STATE.route.range.to;
    ensureSyntaxHighlighterForRoute();
    if (
      STATE.route.screen === "repo" ||
      (STATE.route.screen === "file" &&
        (STATE.route.view === "blob" ||
          STATE.route.view === "blame" ||
          STATE.route.view === "history"))
    )
      STATE.repoRef = STATE.route.ref || "worktree";
    ANNOTATIONS_UI?.restoreSessionFromUrl();
    replaceUrlWithCurrentRoute();
    syncRefInputs();
    syncHeaderMenu();
    syncLineRefPill();
    syncDoctorSheetFromUrl();
    if (
      isSameBlobFileRoute(previousRoute, STATE.route) &&
      routeBlobPreview(previousRoute) !== routeBlobPreview(STATE.route) &&
      switchSourceTab(routeBlobPreview(STATE.route) ? "preview" : "code", {
        updateRoute: false,
      })
    ) {
      setStatus("live");
      return;
    }
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
      parkRangeForHistory();
      cancelActiveSourceLoad("navigation");
      setPageMode();
      removeFileHistoryShell();
      BLAME_VIEW.removeBlamePage();
      removeStandaloneSource();
      HISTORY_VIEW.enterHistory();
      return;
    }
    if (STATE.route.screen === "database") {
      cancelActiveSourceLoad("navigation");
      setPageMode();
      removeStandaloneSource();
      void DATABASE_VIEW.enter(
        STATE.route.db,
        STATE.route.schema,
        STATE.route.table,
        STATE.route.tab,
      ).then(() => ANNOTATIONS_UI?.applyInlineAnnotations());
      setStatus("live");
      return;
    }
    if (STATE.route.screen === "journal") {
      cancelActiveSourceLoad("navigation");
      setPageMode();
      removeStandaloneSource();
      void JOURNAL_VIEW?.enter();
      setStatus("live");
      return;
    }
    if (STATE.route.screen !== "file") {
      cancelActiveSourceLoad("navigation");
      setPageMode();
      removeStandaloneSource();
      load();
      return;
    }
    if (dispatchFileRoute(STATE.route)) {
      return;
    }
    load();
  }
  window.addEventListener("popstate", applyRouteFromLocation);
  window.addEventListener("pagehide", () => flushViewStatePatch(true));

  // Header menu links navigate within the SPA. A full page load here
  // re-lays-out the whole app from scratch (the layout shift the menu was
  // notorious for); pushState + the shared route handler keeps the chrome
  // stable. Modified clicks (new tab etc.) keep native anchor behavior.
  document
    .querySelectorAll<HTMLAnchorElement>(".app-menu-item, .global-help-link")
    .forEach((link) => {
      // External links (the GitHub repo link) keep native anchor behavior;
      // hijacking them would push their pathname onto the local origin.
      if (link.target === "_blank") return;
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
    patchSettings({ ignoreWhitespace: STATE.ignoreWs });
    applyIgnoreWs();
    load();
  });

  function setSyntaxHighlight(on: boolean, persist = true) {
    STATE.syntaxHighlight = on;
    if (persist) patchSettings({ syntaxHighlight: on });
    setHighlightButton(on && getHljs() ? "loaded" : "idle");
    if (on) {
      ensureSyntaxHighlighterForRoute();
    } else {
      rerenderLoadedDiffs();
    }
  }

  setHighlightButton(STATE.syntaxHighlight && getHljs() ? "loaded" : "idle");
  $("#syntax-highlight").addEventListener("click", () => {
    setSyntaxHighlight(!STATE.syntaxHighlight);
  });
  if (STATE.syntaxHighlight) setSyntaxHighlight(true, false);

  // Manual reload button
  // Prominent reload button (next to ref-picker)
  $("#reload-prom").addEventListener("click", () => reloadDiffFromUi());

  // Hide-tests toggle: ファイル名に test|spec が含まれるエントリをフィルタ。
  // Diff viewer 専用。Repository ビュー（gdp-repo-page / gdp-repo-blob-page）には
  // 波及させない。
  function applyHideTests() {
    const btn = $("#hide-tests");
    if (btn) btn.classList.toggle("active", STATE.hideTests);
    const effective = STATE.hideTests && !isRepositorySidebarMode();
    document
      .querySelectorAll<HTMLElement>(".gdp-file-shell")
      .forEach((card) => {
        const isTest = TEST_RE.test(card.dataset.path || "");
        card.classList.toggle("hidden-by-tests", effective && isTest);
      });
    document
      .querySelectorAll<HTMLElement>("#filelist li[data-path]")
      .forEach((li) => {
        const isTest = TEST_RE.test(li.dataset.path || "");
        li.classList.toggle("hidden-by-tests", effective && isTest);
      });
    if (isVirtualSidebarActive()) rerenderVirtualSidebar();
    else updateTreeDirVisibility();
    if (typeof applyViewedState === "function") applyViewedState();
    applyHideTestsToMeta();
  }

  function visibleDiffMetaForBrief(meta: DiffMeta): DiffMeta {
    if (!meta.totals) return meta;
    const effective = STATE.hideTests && !isRepositorySidebarMode();
    if (!effective) return meta;
    let additions = 0;
    let deletions = 0;
    const visibleFiles: FileMeta[] = [];
    for (const f of meta.files) {
      if (TEST_RE.test(f.path || "")) continue;
      additions += f.additions || 0;
      deletions += f.deletions || 0;
      visibleFiles.push(f);
    }
    return {
      ...meta,
      files: visibleFiles,
      totals: { files: visibleFiles.length, additions, deletions },
    };
  }

  function applyHideTestsToMeta() {
    const meta = window._lastMeta;
    if (!meta?.totals) return;
    renderMeta(visibleDiffMetaForBrief(meta));
    // renderMeta() above rebuilds #meta from raw totals, so re-sync the
    // next-unviewed button against the live sidebar filter/viewed state.
    applyViewedState();
  }
  applyHideTests();
  $("#hide-tests").addEventListener("click", () => {
    STATE.hideTests = !STATE.hideTests;
    patchSettings({ hideTests: STATE.hideTests });
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
    loadDiffFile,
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
    getAnnotationPanelOpen: () => APP_SETTINGS.annotationPanelOpen === true,
    setAnnotationPanelOpenState: (open) =>
      patchSettings({ annotationPanelOpen: open }),
    getAnnotationPanelWidth: () => APP_SETTINGS.annotationPanelWidth,
    setAnnotationPanelWidth: (width) =>
      patchSettings({ annotationPanelWidth: width }),
    getAnnotationFollow: () => APP_SETTINGS.annotationFollow !== false,
    setAnnotationFollow: (follow) =>
      patchSettings({ annotationFollow: follow }),
    leaveDatabaseView: () => {
      DATABASE_VIEW.suspend();
    },
    openDatabaseAnnotation: (target) => {
      setStatus("live");
      // The annotation UI redraws DB annotation strips after this promise.
      // Keep this callback focused on mounting/navigating the database view.
      return DATABASE_VIEW.enter(
        target.db,
        target.schema,
        target.table,
        target.tab,
        {
          annotationTarget: target,
          reuseActiveTab: true,
        },
      );
    },
    captureDatabaseAnnotationTarget: () =>
      DATABASE_VIEW.captureAnnotationTarget(),
    setRange: (from, to) => {
      STATE.from = from;
      STATE.to = to;
      patchSettings({ range: currentRange() });
    },
  });
  (function setupAnnotationPanelResizer() {
    const panel = document.getElementById("annotation-panel");
    const handle = document.getElementById("annotation-panel-resizer");
    if (!panel || !handle) return;
    // Right-fixed panel with a left-edge handle: dragging left (negative
    // clientX delta) grows the panel, the same sign convention query-history
    // uses for its own left-edge handle.
    let dragging = false;
    let startX = 0;
    let startW = 0;
    handle.addEventListener("mousedown", (e) => {
      dragging = true;
      startX = e.clientX;
      startW = panel.offsetWidth;
      document.body.classList.add("gdp-annotation-resizing");
      e.preventDefault();
    });
    window.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      ANNOTATIONS_UI?.applyAnnotationPanelWidth(
        startW - (e.clientX - startX),
        false,
      );
    });
    window.addEventListener("mouseup", () => {
      if (!dragging) return;
      dragging = false;
      document.body.classList.remove("gdp-annotation-resizing");
      ANNOTATIONS_UI?.applyAnnotationPanelWidth(panel.offsetWidth);
    });
  })();
  replaceUrlWithCurrentRoute();

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
    getMuted: () => APP_SETTINGS.annotationMuted === true,
    setMuted: (muted) => patchSettings({ annotationMuted: muted }),
    getRate: () => APP_SETTINGS.annotationRate,
    setRate: (rate) => patchSettings({ annotationRate: rate }),
  });

  const qhCloseBtn = document.getElementById("query-history-panel-close");
  if (qhCloseBtn) {
    qhCloseBtn.addEventListener("click", () => {
      setQueryHistoryPanelOpen(false);
    });
  }

  (function setupQueryHistoryResizer() {
    const panel = document.getElementById("query-history-panel");
    const handle = document.getElementById("query-history-resizer");
    if (!panel || !handle) return;
    const MIN_W = 280;
    const MAX_W = 800;
    const saved = APP_SETTINGS.queryHistoryPanelWidth;
    if (typeof saved === "number") {
      const w = Math.max(MIN_W, Math.min(MAX_W, saved || 420));
      panel.style.width = `${w}px`;
    }
    let dragging = false;
    let startX = 0;
    let startW = 0;
    handle.addEventListener("mousedown", (e) => {
      dragging = true;
      startX = e.clientX;
      startW = panel.offsetWidth;
      document.body.classList.add("db-resizing");
      e.preventDefault();
    });
    window.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      const w = Math.max(MIN_W, Math.min(MAX_W, startW - (e.clientX - startX)));
      panel.style.width = `${w}px`;
    });
    window.addEventListener("mouseup", () => {
      if (!dragging) return;
      dragging = false;
      document.body.classList.remove("db-resizing");
      patchSettings({ queryHistoryPanelWidth: panel.offsetWidth });
    });
  })();

  // ---- Auto-update toggle + change notification banner ----
  function applyAutoUpdateButton() {
    const btn = document.querySelector<HTMLButtonElement>("#auto-update");
    if (!btn) return;
    const text = uiText();
    btn.classList.toggle("active", STATE.autoUpdate);
    const autoUpdateTitle = STATE.autoUpdate
      ? text.topbar.autoUpdateOnTitle
      : text.topbar.autoUpdateOffTitle;
    btn.title = autoUpdateTitle;
    btn.setAttribute("aria-label", autoUpdateTitle);
    btn.setAttribute("aria-pressed", STATE.autoUpdate ? "true" : "false");
    const label = btn.querySelector<HTMLElement>(".auto-update-label");
    if (label) label.textContent = text.topbar.autoUpdate;
  }

  function setAutoUpdate(on: boolean) {
    STATE.autoUpdate = on;
    patchSettings({ autoUpdate: on });
    applyAutoUpdateButton();
    if (on) {
      if (bannerPendingPaths) {
        const paths = bannerPendingPaths;
        hideChangeBanner();
        if (!shouldAutoLoadCurrentRoute()) return;
        doSseLoad(paths);
        return;
      }
      hideChangeBanner();
    }
  }

  let bannerPendingPaths: Set<string> | null = null;
  let changeBannerShownAt = 0;
  let changeBannerAgeTimer: ReturnType<typeof setInterval> | null = null;

  function formatChangeBannerAge(now: number): string {
    const text = uiText().changeBanner;
    const elapsedSeconds = Math.max(
      0,
      Math.floor((now - changeBannerShownAt) / 1000),
    );
    if (elapsedSeconds < 5) return text.justNow;
    if (elapsedSeconds < 60) return text.secondsAgo(elapsedSeconds);
    const elapsedMinutes = Math.floor(elapsedSeconds / 60);
    if (elapsedMinutes < 60) return text.minutesAgo(elapsedMinutes);
    return text.hoursAgo(Math.floor(elapsedMinutes / 60));
  }

  function updateChangeBannerAge() {
    const ageEl = document.getElementById("change-banner-age");
    if (ageEl) ageEl.textContent = formatChangeBannerAge(Date.now());
  }

  function showChangeBanner(paths: Set<string> | null) {
    bannerPendingPaths = paths;
    changeBannerShownAt = Date.now();
    const banner = document.getElementById("change-banner");
    if (!banner) return;
    const text = uiText();
    const textEl = document.getElementById("change-banner-text");
    if (textEl) textEl.textContent = text.changeBanner.text;
    updateChangeBannerAge();
    if (!changeBannerAgeTimer) {
      changeBannerAgeTimer = setInterval(updateChangeBannerAge, 1000);
    }
    const reloadBtn = document.getElementById("change-banner-reload");
    if (reloadBtn) reloadBtn.textContent = text.changeBanner.reload;
    banner.hidden = false;
  }

  function hideChangeBanner() {
    const banner = document.getElementById("change-banner");
    if (banner) banner.hidden = true;
    bannerPendingPaths = null;
    changeBannerShownAt = 0;
    if (changeBannerAgeTimer) {
      clearInterval(changeBannerAgeTimer);
      changeBannerAgeTimer = null;
    }
  }

  document
    .getElementById("change-banner-reload")
    ?.addEventListener("click", () => {
      const paths = bannerPendingPaths;
      hideChangeBanner();
      const route = STATE.route;
      if (!shouldAutoLoadCurrentRoute(route)) return;
      if (isBlobOrBlameFileRoute(route)) {
        dispatchFileRoute(route);
        return;
      }
      doSseLoad(paths);
    });
  document
    .getElementById("change-banner-dismiss")
    ?.addEventListener("click", () => {
      hideChangeBanner();
    });

  function showWatchLimitBanner(limit: number) {
    const banner = document.getElementById("watch-limit-banner");
    if (!banner) return;
    const textEl = document.getElementById("watch-limit-text");
    if (textEl) textEl.textContent = uiText().watchLimitBanner.text(limit);
    banner.hidden = false;
  }

  document
    .getElementById("watch-limit-dismiss")
    ?.addEventListener("click", () => {
      const banner = document.getElementById("watch-limit-banner");
      if (banner) banner.hidden = true;
    });
  document.getElementById("auto-update")?.addEventListener("click", () => {
    setAutoUpdate(!STATE.autoUpdate);
  });
  document
    .getElementById("cancel-requests")
    ?.addEventListener("click", cancelInFlightRequests);
  applyAutoUpdateButton();

  function shouldAutoLoadCurrentRoute(route = STATE.route): boolean {
    return shouldAutoLoadForRoute(route, {
      historyWorktreeSelected: HISTORY_VIEW.isWorktreeSelected(),
    });
  }

  function doSseLoad(paths: Set<string> | null) {
    const route = STATE.route;
    if (!shouldAutoLoadCurrentRoute(route)) return;
    if (isBlobOrBlameFileRoute(route)) {
      const viewingPath = route.path;
      if (paths && viewingPath && !paths.has(viewingPath)) return;
      dispatchFileRoute(route);
      return;
    }
    if (route.screen === "repo") {
      invalidateRepoSidebar();
      void loadRepo();
      return;
    }
    if (route.screen !== "diff" && route.screen !== "history") {
      return;
    }
    const savedScroll = window.scrollY;
    const savedActive = STATE.activeFile;
    load({ changedPaths: paths }).then((result) => {
      if (result?.preservedDom) return;
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
  }

  let sseTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingSseChangedPaths: Set<string> | null = new Set();
  function scheduleSseLoad(changedPaths?: string[] | null) {
    if (!shouldAutoLoadCurrentRoute()) return;
    if (changedPaths && pendingSseChangedPaths) {
      for (const p of changedPaths) pendingSseChangedPaths.add(p);
    } else {
      pendingSseChangedPaths = null;
    }
    if (sseTimer) clearTimeout(sseTimer);
    sseTimer = setTimeout(() => {
      sseTimer = null;
      const paths = pendingSseChangedPaths;
      pendingSseChangedPaths = new Set();
      const route = STATE.route;
      if (isBlobOrBlameFileRoute(route)) {
        const viewingPath = route.path;
        if (paths && viewingPath && !paths.has(viewingPath)) return;
      }
      if (STATE.autoUpdate) {
        doSseLoad(paths);
      } else {
        showChangeBanner(paths);
      }
    }, 350);
  }

  const catchUpGate = createCatchUpGate(() => Date.now(), 1000);
  let openedOnce = false;
  let eventSource: EventSource | null = null;
  let eventSourceConnectTimer: number | null = null;

  function shouldConnectEventSource(): boolean {
    return document.visibilityState === "visible";
  }

  function disconnectEventSource(): void {
    if (eventSourceConnectTimer !== null) {
      window.clearTimeout(eventSourceConnectTimer);
      eventSourceConnectTimer = null;
    }
    eventSource?.close();
    eventSource = null;
  }

  function connectEventSource(): void {
    if (!shouldConnectEventSource()) return;
    if (eventSource) return;
    const es = new EventSource("/events");
    eventSource = es;
    es.addEventListener("update", (event) => {
      const raw = (event as MessageEvent).data;
      let paths: string[] | null = null;
      if (raw && raw !== "tick") {
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed.paths)) paths = parsed.paths;
        } catch {
          /* ignore parse errors */
        }
      }
      if (isHistoryPanelRoute(STATE.route)) HISTORY_VIEW.notePossibleUpdate();
      scheduleSseLoad(paths);
    });
    es.addEventListener("watch-limit", (event) => {
      const raw = (event as MessageEvent).data;
      const limit = Number(raw);
      if (Number.isFinite(limit) && limit > 0) showWatchLimitBanner(limit);
    });
    es.addEventListener("reload", () => location.reload());
    es.addEventListener("annotation", (event) => {
      ANNOTATIONS_UI?.handleSse((event as MessageEvent).data);
    });
    es.addEventListener("journal", () => {
      JOURNAL_VIEW?.handleSse();
    });
    es.addEventListener("db-query", (event) => {
      DATABASE_VIEW.handleSse("db-query", (event as MessageEvent).data);
    });
    es.addEventListener("db-snapshot", (event) => {
      DATABASE_VIEW.handleSse("db-snapshot", (event as MessageEvent).data);
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
  }

  function scheduleEventSourceConnect(): void {
    if (!shouldConnectEventSource()) return;
    if (eventSource || eventSourceConnectTimer !== null) return;
    const schedule = () => {
      eventSourceConnectTimer = window.setTimeout(() => {
        eventSourceConnectTimer = null;
        connectEventSource();
      }, 1000);
    };
    if (document.readyState === "complete") {
      schedule();
      return;
    }
    window.addEventListener("load", schedule, { once: true });
  }

  scheduleEventSourceConnect();
  window.addEventListener("pagehide", disconnectEventSource);

  function catchUpDiff() {
    const historyWorktreeSelected = HISTORY_VIEW.isWorktreeSelected();
    if (!shouldAutoLoadCurrentRoute()) return;
    if (!shouldCatchUpDiff(STATE.route, { historyWorktreeSelected })) return;
    if (!catchUpGate()) return;
    if (!STATE.autoUpdate) {
      showChangeBanner(null);
      return;
    }
    void load({ force: true });
  }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      disconnectEventSource();
      return;
    }
    scheduleEventSourceConnect();
    catchUpDiff();
    void ANNOTATIONS_UI?.refreshAnnotations();
  });
  window.addEventListener("focus", () => {
    scheduleEventSourceConnect();
    catchUpDiff();
    void ANNOTATIONS_UI?.refreshAnnotations();
  });
})();
