import {
  type AgentScreenRuleIssue,
  type AgentScreenRulesResponse,
  DEFAULT_AGENT_SCREEN_RULES,
  formatAgentScreenRuleSet,
} from "./core/agent-screen";
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
import { changedPathsCoverPath } from "./core/changed-paths";
import { attachDragResizer } from "./core/drag-resizer";
import {
  errorWithCause,
  errorWithCauses,
  formatErrorDetail,
  responseErrorMessage,
} from "./core/error-detail";
import { GdpExpandLogic } from "./core/expand-logic";
import { isTestFilePath } from "./core/file-filter";
import { filePathClipboardText } from "./core/file-path-copy";
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
  ensureGdscriptHighlightLanguage,
  ensureTerraformHighlightLanguage,
} from "./core/highlight-languages";
import {
  ARROW_RIGHT_16_PATH,
  CHEVRON_DOWN_12_PATH,
  COMMENT_DISCUSSION_16_PATH,
  COPY_16_PATHS,
  GIT_BRANCH_16_PATH,
  iconSvg,
  MARK_GITHUB_16_PATH,
  MOON_16_PATH,
  OPEN_EXTERNAL_16_PATH,
  PULSE_16_PATH,
  QUESTION_16_PATH,
  SYNC_16_PATH,
  TRIANGLE_DOWN_16_PATH,
  UNDO_16_PATH,
  X_16_PATH,
} from "./core/icons";
import { isImeComposing } from "./core/keyboard";
import {
  DEFAULT_KEY_BINDINGS,
  type KeyBinding,
  type KeymapAction,
  type KeymapOverrides,
  type KeymapScope,
  resolveKeyBindings,
  resolveKeymapAction,
} from "./core/keymap";
import { createNetworkActivityTracker } from "./core/network-activity";
import { buildRepositoryWebTarget } from "./core/repository-web-url";
import {
  type AppRoute,
  buildRoute,
  type DiffRange,
  parseDoctorOverlay,
  parseRoute,
  parseTerminalOverlay,
  parseToolsOverlay,
  type SourceFileTarget,
  type SourceLineTarget,
  type TerminalOverlayState,
  withDoctorOverlay,
  withTerminalOverlay,
  withToolsOverlay,
} from "./core/routes";
import { sourceInternalPathKind } from "./core/source-meta";
import { readStoredSize, writeStoredSize } from "./core/stored-size";
import { clampTerminalFontSize } from "./core/tmux";
import type { ToolId } from "./core/tools";
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
import { createHelpKeybindingEditor } from "./views/help-keybinding-editor";
import {
  createHelpPage,
  helpLanguageFromRoute,
  helpSectionFromRoute,
  openHelpKeybindings,
  openHelpSection,
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
import { createRepositoryWebLink } from "./views/repository-web-link";
import { createSearchPalette } from "./views/search-palette-ui";
import { createSidebar, type ViewerFontSize } from "./views/sidebar";
import {
  createSourceView,
  type VirtualSourcePagingKeyboardEvent,
} from "./views/source-view";
import { terminalText } from "./views/terminal/i18n";
import { createTerminalView } from "./views/terminal/terminal-view";
import { toolsText } from "./views/tools/i18n";
import { createToolsView } from "./views/tools/tools-view";
import {
  createViewerSettings,
  type ViewerSettingsDraft,
  type ViewerSettingsText,
} from "./views/viewer-settings";
import { worktreeText } from "./views/worktree-i18n";
import { createWorktreeView, type WorktreeView } from "./views/worktree-view";

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
  let PROJECT_BRANCH = "";
  let REPO_WEB_URL: string | null = null;

  let APP_SETTINGS: AppSettingsState = { version: 1 };
  let AGENT_SCREEN_RULES = formatAgentScreenRuleSet(DEFAULT_AGENT_SCREEN_RULES);
  let AGENT_SCREEN_RULES_SOURCE: AgentScreenRulesResponse["source"] = "default";
  let AGENT_SCREEN_RULE_ERRORS: AgentScreenRuleIssue[] = [];
  let AGENT_SCREEN_RULES_GENERATION = 0;
  let AGENT_SCREEN_RULE_REQUEST_GENERATION = 0;
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
    PROJECT_BRANCH = branch;
    const el = document.querySelector<HTMLElement>("#project-branch");
    if (!el) return;
    el.hidden = !branch;
    const name = el.querySelector<HTMLElement>(".project-branch-name");
    if (name) name.textContent = branch;
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

  function reportPersistenceError(operation: string, error: unknown): void {
    const failure = errorWithCause(`${operation} failed`, error);
    console.error(failure);
    setStatus("error");
    const statusEl = document.querySelector<HTMLElement>("#status");
    if (statusEl) statusEl.title = formatErrorDetail(failure);
  }

  // APP_SETTINGS はいくつもの経路で丸ごと差し替わるので、そのたびに再構築を
  // 呼ぶのではなく、差分オブジェクトの同一性で覚えておく。参照が変われば
  // 作り直し、変わらなければ前回の配列をそのまま返す。keydown ごとに
  // 展開し直さずに済み、更新の呼び忘れも起きない。
  let cachedKeymapOverrides: KeymapOverrides | undefined;
  let cachedKeyBindings: KeyBinding[] = DEFAULT_KEY_BINDINGS;

  function activeKeyBindings(): KeyBinding[] {
    if (APP_SETTINGS.keybindings !== cachedKeymapOverrides) {
      cachedKeymapOverrides = APP_SETTINGS.keybindings;
      cachedKeyBindings = resolveKeyBindings(cachedKeymapOverrides);
    }
    return cachedKeyBindings;
  }

  let pendingSettingsPatch: SettingsPatch | null = null;
  let pendingSettingsKeepalive = false;
  let settingsPatchInFlight: Promise<void> | null = null;

  async function flushSettingsPatch(): Promise<void> {
    if (settingsPatchInFlight) {
      await settingsPatchInFlight;
      if (pendingSettingsPatch) await flushSettingsPatch();
      return;
    }
    if (!pendingSettingsPatch) return;
    const patch = pendingSettingsPatch;
    const keepalive = pendingSettingsKeepalive;
    pendingSettingsPatch = null;
    pendingSettingsKeepalive = false;
    const operation = sendSettingsPatch(patch, keepalive).then(() => undefined);
    settingsPatchInFlight = operation;
    try {
      await operation;
    } catch (error) {
      pendingSettingsPatch = {
        ...patch,
        ...(pendingSettingsPatch || {}),
      };
      pendingSettingsKeepalive ||= keepalive;
      throw error;
    } finally {
      if (settingsPatchInFlight === operation) settingsPatchInFlight = null;
    }
    if (pendingSettingsPatch) await flushSettingsPatch();
  }

  async function sendSettingsPatch(
    patch: SettingsPatch,
    keepalive = false,
  ): Promise<AppSettingsState> {
    const response = await trackLoad(
      fetch("/_state/settings", {
        method: "PATCH",
        headers: actionHeaders(),
        body: JSON.stringify(patch),
        keepalive,
      }),
    );
    if (!response.ok) {
      throw new Error(
        await responseErrorMessage(response, "save viewer settings"),
      );
    }
    try {
      return (await response.json()) as AppSettingsState;
    } catch (error) {
      throw errorWithCause(
        "save viewer settings: response is not valid JSON",
        error,
      );
    }
  }

  function patchSettings(
    patch: SettingsPatch,
    options: { keepalive?: boolean } = {},
  ): void {
    mergeLocalSettings(patch);
    pendingSettingsPatch = {
      ...(pendingSettingsPatch || {}),
      ...patch,
    };
    pendingSettingsKeepalive ||= options.keepalive === true;
    if (!settingsPatchInFlight) {
      void flushSettingsPatch().catch((error) => {
        reportPersistenceError("save viewer settings", error);
      });
    }
  }

  async function persistSettingsPatch(patch: SettingsPatch): Promise<void> {
    await flushSettingsPatch();
    while (settingsPatchInFlight) await settingsPatchInFlight;

    const operation = sendSettingsPatch(patch).then((state) => {
      APP_SETTINGS = state;
      if (pendingSettingsPatch) mergeLocalSettings(pendingSettingsPatch);
    });
    settingsPatchInFlight = operation;
    try {
      await operation;
    } finally {
      if (settingsPatchInFlight === operation) settingsPatchInFlight = null;
      if (pendingSettingsPatch) {
        void flushSettingsPatch().catch((error) => {
          reportPersistenceError("save viewer settings", error);
        });
      }
    }
  }

  let pendingViewPatch: ViewPatch | null = null;
  let pendingViewTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingViewKeepalive = false;
  let viewPatchInFlight = false;

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

  async function sendPendingViewPatch(): Promise<void> {
    if (viewPatchInFlight || !pendingViewPatch) return;
    const patch = pendingViewPatch;
    const keepalive = pendingViewKeepalive;
    pendingViewPatch = null;
    pendingViewKeepalive = false;
    viewPatchInFlight = true;
    let saved = false;
    try {
      const response = await trackLoad(
        fetch("/_state/view", {
          method: "PATCH",
          headers: actionHeaders(),
          body: JSON.stringify(patch),
          keepalive,
        }),
      );
      if (!response.ok) {
        throw new Error(
          await responseErrorMessage(response, "save viewer state"),
        );
      }
      saved = true;
    } catch (error) {
      pendingViewPatch = mergeViewPatch(patch, pendingViewPatch || {});
      reportPersistenceError("save viewer state", error);
    } finally {
      viewPatchInFlight = false;
    }
    if (saved && pendingViewPatch) void sendPendingViewPatch();
  }

  function patchViewState(
    patch: ViewPatch,
    options: { debounce?: boolean; keepalive?: boolean } = {},
  ): void {
    VIEW_STATE = mergeLocalViewState(VIEW_STATE, patch);
    pendingViewPatch = mergeViewPatch(pendingViewPatch, patch);
    const send = (keepalive = false) => {
      if (!pendingViewPatch) return;
      pendingViewKeepalive ||= keepalive;
      void sendPendingViewPatch();
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
    pendingViewKeepalive ||= keepalive;
    void sendPendingViewPatch();
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
    const previousLineHeight = Number.parseFloat(
      getComputedStyle(document.body).getPropertyValue("--code-line-height"),
    );
    document.body.dataset.codeFontSize = size;
    const nextLineHeight = Number.parseFloat(
      getComputedStyle(document.body).getPropertyValue("--code-line-height"),
    );
    document
      .querySelectorAll<HTMLElement>(".gdp-source-virtual-scroller")
      .forEach((scroller) => {
        if (
          Number.isFinite(previousLineHeight) &&
          previousLineHeight > 0 &&
          Number.isFinite(nextLineHeight) &&
          nextLineHeight > 0
        )
          scroller.scrollTop *= nextLineHeight / previousLineHeight;
        (
          scroller as HTMLElement & {
            __gdpRenderVirtualSource?: () => void;
          }
        ).__gdpRenderVirtualSource?.();
      });
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

  async function loadSettings(): Promise<SettingsResponse> {
    const res = await trackLoad(fetch("/_settings"));
    if (!res.ok) {
      throw new Error(
        await responseErrorMessage(res, "settings request failed"),
      );
    }
    let settings: SettingsResponse;
    try {
      settings = (await res.json()) as SettingsResponse;
    } catch (error) {
      throw errorWithCause("settings response is not valid JSON", error);
    }
    setProjectName(settings.project || "");
    setProjectBranch(settings.branch || "");
    REPO_WEB_URL = settings.repo_web_url;
    const repoLink =
      document.querySelector<HTMLAnchorElement>("#repo-web-link");
    if (repoLink) {
      repoLink.href = settings.repo_web_url || "#";
      repoLink.hidden = !settings.repo_web_url;
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
    if (typeof settings.scope.watch_recursive === "boolean") {
      // macOS and Windows watch the whole tree through one OS handle, so
      // there are no per-directory watchers for this limit to cap. Hide the
      // control rather than offer a setting that changes nothing.
      const watchSection = document.querySelector<HTMLElement>(
        "#watch-settings-section",
      );
      if (watchSection) watchSection.hidden = settings.scope.watch_recursive;
    }
    return settings;
  }

  function agentScreenRuleErrorsText(errors: AgentScreenRuleIssue[]): string {
    return errors
      .map(
        (error) =>
          `${error.path} [${error.code}] ${error.message}${
            error.stack ? `\n${error.stack}` : ""
          }`,
      )
      .join("\n\n");
  }

  async function agentScreenRuleResponse(
    response: Response,
  ): Promise<AgentScreenRulesResponse> {
    let body: unknown;
    try {
      body = await response.json();
    } catch (error) {
      throw errorWithCause(
        `terminal rule request returned ${response.status} with invalid JSON`,
        error,
      );
    }
    if (!response.ok) {
      throw Object.assign(
        new Error(
          `terminal rule request failed with status ${response.status}`,
        ),
        { status: response.status, response: body },
      );
    }
    if (!body || typeof body !== "object" || !("rules" in body)) {
      throw Object.assign(new Error("terminal rule response is incomplete"), {
        response: body,
      });
    }
    if (
      !("generation" in body) ||
      typeof (body as { generation?: unknown }).generation !== "number"
    ) {
      throw Object.assign(
        new Error("terminal rule response has no generation"),
        { response: body },
      );
    }
    return body as AgentScreenRulesResponse;
  }

  function applyAgentScreenRuleResponse(
    response: AgentScreenRulesResponse,
  ): void {
    if (response.generation < AGENT_SCREEN_RULES_GENERATION) return;
    AGENT_SCREEN_RULES = formatAgentScreenRuleSet(response.rules);
    AGENT_SCREEN_RULES_SOURCE = response.source;
    AGENT_SCREEN_RULE_ERRORS = response.errors;
    AGENT_SCREEN_RULES_GENERATION = response.generation;
  }

  async function loadAgentScreenRules(): Promise<void> {
    const generation = ++AGENT_SCREEN_RULE_REQUEST_GENERATION;
    const response = await agentScreenRuleResponse(
      await trackLoad(fetch("/_agent/rules")),
    );
    if (generation !== AGENT_SCREEN_RULE_REQUEST_GENERATION) return;
    applyAgentScreenRuleResponse(response);
  }

  async function saveAgentScreenRules(value: string): Promise<void> {
    let rules: unknown;
    try {
      rules = JSON.parse(value);
    } catch (error) {
      throw errorWithCause("terminal rules are not valid JSON", error);
    }
    const generation = ++AGENT_SCREEN_RULE_REQUEST_GENERATION;
    const response = await agentScreenRuleResponse(
      await trackLoad(
        fetch("/_agent/rules", {
          method: "PUT",
          headers: actionHeaders(),
          body: JSON.stringify(rules),
        }),
      ),
    );
    if (generation !== AGENT_SCREEN_RULE_REQUEST_GENERATION) return;
    applyAgentScreenRuleResponse(response);
  }

  async function resetAgentScreenRuleSettings(): Promise<void> {
    const generation = ++AGENT_SCREEN_RULE_REQUEST_GENERATION;
    const response = await agentScreenRuleResponse(
      await trackLoad(
        fetch("/_agent/rules", {
          method: "DELETE",
          headers: actionHeaders(),
        }),
      ),
    );
    if (generation !== AGENT_SCREEN_RULE_REQUEST_GENERATION) return;
    applyAgentScreenRuleResponse(response);
  }

  async function loadStateResponse<T>(
    url: string,
    operation: string,
  ): Promise<T> {
    const response = await trackLoad(fetch(url));
    if (!response.ok) {
      throw new Error(await responseErrorMessage(response, operation));
    }
    try {
      return (await response.json()) as T;
    } catch (error) {
      throw errorWithCause(`${operation}: response is not valid JSON`, error);
    }
  }

  async function loadPersistedState(): Promise<void> {
    const [settings, view] = await Promise.all([
      loadStateResponse<AppSettingsState>(
        "/_state/settings",
        "settings state request failed",
      ),
      loadStateResponse<ViewState>("/_state/view", "view state request failed"),
    ]);
    APP_SETTINGS = settings;
    VIEW_STATE = view;
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
    syncAppPanelLayout();
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
    githubUrlForSelection: (path, start, end) => {
      const route = STATE.route;
      const ref =
        route.screen === "file"
          ? route.commit || route.ref
          : route.screen === "diff"
            ? route.range.to
            : "worktree";
      const target = buildRepositoryWebTarget(REPO_WEB_URL, {
        ref,
        fallbackRef: PROJECT_BRANCH,
        path,
        kind: "blob",
        start,
        end,
      });
      return target?.provider === "github" ? target.url : null;
    },
    copyReferenceLabel: () => uiText().global.copyLineReference,
    lineCountLabel: (count) => uiText().global.selectedLineCount(count),
    githubOpenTitle: () => uiText().global.githubSelectionOpen,
    githubCopyTitle: () => uiText().global.githubSelectionCopy,
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
    isTestPath: isTestFilePath,
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
    createRepositoryWebLink: createFileRepositoryWebLink,
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
    getLanguage: () => STATE.language,
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
    loadSourceShikiHighlighter: (lang) =>
      SOURCE_VIEW.loadSourceShikiHighlighter(lang),
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
    createRepositoryWebLink: createFileRepositoryWebLink,
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
    refreshRepoSidebarTree,
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
    isAbortError,
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
    repositoryWebTarget: (path, ref) =>
      buildRepositoryWebTarget(REPO_WEB_URL, {
        ref,
        fallbackRef: PROJECT_BRANCH,
        path,
        kind: "tree",
      }),
    openGithubLabel: () => uiText().repo.openGithub,
    openRepositoryWebLabel: () => uiText().repo.openRepositoryWeb,
    fileBadge: (status) => DIFF_VIEW.fileBadge(status),
  });
  const {
    loadRepo,
    renderRepoBlobSidebar,
    syncRepoTargetInput,
    closeRepoContextMenu,
    handleSidebarContextMenu,
    invalidateRepoSidebar,
    refreshRepoSidebar,
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
    getSyntaxHighlight: () => STATE.syntaxHighlight,
    inferLang: (path) => SOURCE_VIEW.inferLang(path),
    loadSourceShikiHighlighter: (lang) =>
      SOURCE_VIEW.loadSourceShikiHighlighter(lang),
    sourceShikiLines: (textValue, lang, highlighter) =>
      SOURCE_VIEW.sourceShikiLines(textValue, lang, highlighter),
    getLanguage: () => STATE.language,
    getFileSelectionHistory: () => APP_SETTINGS.fileSelectionHistory || [],
    getGrepSelectionHistory: () => APP_SETTINGS.grepSelectionHistory || [],
    getGrepRegex: () => APP_SETTINGS.grepRegex === true,
    getGrepHideTests: () => STATE.hideTests,
    getGrepGroupByFile: () => APP_SETTINGS.grepGroupByFile === true,
    getGrepPaletteWidth: () => APP_SETTINGS.grepPaletteWidth,
    getGrepPaletteHeight: () => APP_SETTINGS.grepPaletteHeight,
    persistGrepSettings: persistSettingsPatch,
    applyGrepHideTests: (hidden) => {
      STATE.hideTests = hidden;
      applyHideTests();
    },
  });
  const { openSearchPalette, isPaletteOpen, paletteMode, clearRepoFileCache } =
    SEARCH_PALETTE;

  const UI_TEXT: Record<
    ViewerLanguage,
    {
      nav: Record<
        | "repo"
        | "diff"
        | "history"
        | "journal"
        | "database"
        | "worktree"
        | "tools"
        | "help",
        string
      >;
      appPanel: {
        tabs: string;
        layout: string;
        overlay: string;
        overlayTitle: string;
        docked: string;
        dockedTitle: string;
        close: string;
        resize: string;
      };
      global: {
        annotations: string;
        queryHistory: string;
        settings: string;
        theme: string;
        copyAiContext: string;
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
        repoWebLink: string;
        copyLineReference: string;
        selectedLineCount: (count: number) => string;
        githubSelectionOpen: string;
        githubSelectionCopy: string;
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
        syntax: string;
        syntaxOnTitle: string;
        syntaxLoadingTitle: string;
        syntaxErrorTitle: string;
        syntaxOffTitle: string;
        hideTests: string;
        hideTestsLabel: string;
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
        openGithub: string;
        openRepositoryWeb: string;
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
        settings: string;
      };
      // フォーム本体は views/viewer-settings.ts が持つので、文言の形も
      // あちらの型に合わせる。ここで二重に並べると片方だけ増えて崩れる。
      settings: ViewerSettingsText;
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
        worktree: "Worktrees",
        tools: "Tools",
        help: "Settings & Help",
      },
      appPanel: {
        tabs: "Panel",
        layout: "Panel layout",
        overlay: "Overlay",
        overlayTitle: "Show the panel over the page",
        docked: "Docked",
        dockedTitle: "Keep the panel inside the window",
        close: "Close panel",
        resize: "Resize panel height",
      },
      global: {
        annotations: "code annotations",
        queryHistory: "query history",
        settings: "viewer settings",
        theme: "toggle theme",
        copyAiContext: "Copy AI context (Shift+Click to include code)",
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
        repoWebLink: "open repository web page",
        copyLineReference: "Copy AI reference",
        selectedLineCount: (count) => `${count} line${count === 1 ? "" : "s"}`,
        githubSelectionOpen: "Open selected lines on GitHub",
        githubSelectionCopy: "Copy GitHub link",
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
        syntax: "syntax",
        syntaxOnTitle: "syntax highlighting on",
        syntaxLoadingTitle: "loading syntax highlighter",
        syntaxErrorTitle: "failed to load syntax highlighter",
        syntaxOffTitle: "syntax highlighting off",
        hideTests: "hide test files (test|spec)",
        hideTestsLabel: "no test",
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
        openGithub: "Open on GitHub",
        openRepositoryWeb: "Open repository web page",
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
        settings: "Settings →",
      },
      settings: {
        display: "Display",
        language: "Language",
        fileListFontSize: "UI font size",
        fileListFontSizeHelp: "Applies to all UI except code content.",
        codeFontSize: "Code font size",
        sizeSmall: "Small",
        sizeRegular: "Regular",
        sizeLarge: "Large",
        sizeExtraLarge: "Extra Large",
        displaySource: "Applies to all projects in this browser.",
        excludedDirectories: "Excluded directories",
        omitDirs: "Skip these directory names while browsing and searching",
        omitDirsHelp:
          "Reads no contents inside these directories. Applies to the sidebar (Files), Ctrl+K (file search), Ctrl+G (grep), Datastores, and the file change watcher. Supports gitignore-style wildcards (*, ?, [abc], [!abc]).",
        excludeNames: "Hide these file or directory names completely",
        excludeNamesHelp:
          "Removes matching files or directories from the sidebar, search, and grep results entirely. Unlike Skip, the names themselves disappear from the UI. Supports gitignore-style wildcards (*, ?, [abc], [!abc]).",
        reset: "Restore defaults",
        save: "Save changes",
        saving: "Saving…",
        saved: "Saved.",
        unsaved: "Unsaved changes.",
        saveNote: "Edits are not applied until you select Save changes.",
        watchLimitInvalid: (min, max) =>
          `Enter a whole number from ${min} to ${max}.`,
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
        agentRulesTitle: "Terminal status detection",
        agentRulesLabel: "Screen matching rules (JSON)",
        agentRulesHelp:
          "Rules can report working, waiting, idle, or skip. Configure priority, region, contains, regex, lineRegex, and nested all/any/not conditions. contains ignores letter case; regex accepts a leading (?i) for case-insensitive matching. To keep matching responsive, regex allows at most one variable-length repetition and rejects groups, alternation, and backreferences; express AND/OR with all/any. The highest-priority match wins; equal priorities keep the earlier rule. Save validates every rule before replacing the active set.",
        agentRulesGuideTitle: "JSON format and example",
        agentRulesGuideIntro:
          "Enter one object with version 1 and a rules array. Each rule needs the required fields listed below plus at least one matcher.",
        agentRulesGuideFields:
          "Required fields: id (unique name), state (working, waiting, idle, or skip), priority (higher wins), and region. lines is also required when region is bottom_non_empty.",
        agentRulesGuideMatchers:
          "Matchers: contains and regex test the selected region; lineRegex tests each line. Combine matcher objects with all, any, and not.",
        agentRulesGuideRegions:
          "Regions: osc_title checks the terminal title, whole_recent checks the recent screen, bottom_non_empty checks the last non-empty lines, and last_non_empty checks only the final non-empty line.",
        agentRulesGuideExample: `{
  "version": 1,
  "rules": [
    {
      "id": "waiting_for_confirmation",
      "state": "waiting",
      "priority": 900,
      "region": "bottom_non_empty",
      "lines": 12,
      "contains": ["enter to confirm"],
      "not": [{ "contains": ["finished"] }]
    }
  ]
}`,
        agentRulesSave: "Validate and save",
        agentRulesReset: "Use built-in rules",
        agentRulesSaving: "Validating and saving…",
        agentRulesSourceDefault: "Source: built-in rules",
        agentRulesSourceSaved: "Source: saved rules (active immediately)",
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
        worktree: "作業ツリー",
        tools: "ツール",
        help: "設定・ヘルプ",
      },
      appPanel: {
        tabs: "パネル",
        layout: "パネルの表示方法",
        overlay: "重ねる",
        overlayTitle: "本文に重ねて表示",
        docked: "画面内",
        dockedTitle: "本文と分けて画面内に表示",
        close: "パネルを閉じる",
        resize: "パネルの高さを変更",
      },
      global: {
        annotations: "コード注釈",
        queryHistory: "クエリ履歴",
        settings: "ビューア設定",
        theme: "テーマ切り替え",
        copyAiContext:
          "AI 用コンテキストをコピー（Shift+Click でコードも添付）",
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
        repoWebLink: "リポジトリのウェブページを開く",
        copyLineReference: "AI参照をコピー",
        selectedLineCount: (count) => `${count}行`,
        githubSelectionOpen: "選択行をGitHubで開く",
        githubSelectionCopy: "GitHubリンクをコピー",
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
        syntax: "構文",
        syntaxOnTitle: "シンタックスハイライト有効",
        syntaxLoadingTitle: "シンタックスハイライトを読み込み中",
        syntaxErrorTitle: "シンタックスハイライトの読み込みに失敗",
        syntaxOffTitle: "シンタックスハイライト無効",
        hideTests: "test/spec ファイルを隠す",
        hideTestsLabel: "テスト非表示",
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
        openGithub: "GitHubで開く",
        openRepositoryWeb: "リポジトリのウェブページを開く",
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
        settings: "設定 →",
      },
      settings: {
        display: "表示",
        language: "言語",
        fileListFontSize: "UIの文字サイズ",
        fileListFontSizeHelp: "コード本文を除くUI全体に適用されます。",
        codeFontSize: "コード表示の文字サイズ",
        sizeSmall: "小",
        sizeRegular: "標準",
        sizeLarge: "大",
        sizeExtraLarge: "特大",
        displaySource: "このブラウザのすべてのプロジェクトに適用されます。",
        excludedDirectories: "除外ディレクトリ",
        omitDirs: "閲覧と検索でスキップするディレクトリ名",
        omitDirsHelp:
          "これらのディレクトリの中身は読み込みません。サイドバー（Files）・Ctrl+K（ファイル検索）・Ctrl+G（grep）・Datastores・File change watcher の5機能すべてに適用されます。gitignore方式のワイルドカード（*, ?, [abc], [!abc]）に対応しています。",
        excludeNames: "完全に非表示にするファイル名またはディレクトリ名",
        excludeNamesHelp:
          "リスト中の名前に一致するファイル/ディレクトリを、サイドバー・検索結果・grep 結果から完全に消します。Skip と違い、名前自体が UI に出なくなります。gitignore方式のワイルドカード（*, ?, [abc], [!abc]）に対応しています。",
        reset: "デフォルトに戻す",
        save: "変更を保存",
        saving: "保存しています…",
        saved: "保存しました。",
        unsaved: "未保存の変更があります。",
        saveNote: "「変更を保存」を押すまで、編集内容は適用されません。",
        watchLimitInvalid: (min, max) =>
          `${min}〜${max}の整数を入力してください。`,
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
        agentRulesTitle: "ターミナルのAI状態判定",
        agentRulesLabel: "画面の一致ルール（JSON）",
        agentRulesHelp:
          "各ルールで working（作業中）・waiting（入力待ち）・idle（待機中）・skip（状態を維持）を指定できます。priority、region、contains、regex、lineRegex、入れ子の all/any/not を編集できます。contains は大文字小文字を区別せず、regex は先頭の (?i) による大小無視に対応します。判定処理を止めないため、regex の可変長の繰返しは1個までで、グループ・選択・後方参照は使えません。AND/OR は all/any で表します。優先度が最大の一致が採用され、同点は上にあるルールが優先されます。保存前に全ルールを検証します。",
        agentRulesGuideTitle: "JSONの書式と入力例",
        agentRulesGuideIntro:
          "version が 1、rules が配列のJSONオブジェクトを入力します。各ルールには下記の必須項目と、1個以上の一致条件が必要です。",
        agentRulesGuideFields:
          "必須項目: id（一意の名前）、state（working / waiting / idle / skip）、priority（大きい値を優先）、region。region が bottom_non_empty の場合は lines も必要です。",
        agentRulesGuideMatchers:
          "一致条件: contains と regex は選択した領域全体、lineRegex は各行を調べます。一致条件のオブジェクトは all / any / not で組み合わせられます。",
        agentRulesGuideRegions:
          "region: osc_title はターミナルタイトル、whole_recent は直近の画面全体、bottom_non_empty は末尾の非空行、last_non_empty は最後の非空行だけを調べます。",
        agentRulesGuideExample: `{
  "version": 1,
  "rules": [
    {
      "id": "waiting_for_confirmation",
      "state": "waiting",
      "priority": 900,
      "region": "bottom_non_empty",
      "lines": 12,
      "contains": ["enter to confirm"],
      "not": [{ "contains": ["finished"] }]
    }
  ]
}`,
        agentRulesSave: "検証して保存",
        agentRulesReset: "組み込みルールに戻す",
        agentRulesSaving: "検証して保存しています…",
        agentRulesSourceDefault: "適用中: 組み込みルール",
        agentRulesSourceSaved: "適用中: 保存したルール（即時反映）",
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

  function localizeViewerChrome() {
    const text = uiText();
    document.documentElement.lang = STATE.language;
    // Tools はリンクではなくボタンなので HTMLElement で拾う (ラベルの当て方は
    // 他のメニュー項目と同じ data-route 経由)。
    document.querySelectorAll<HTMLElement>(".app-menu-item").forEach((link) => {
      const route = link.dataset.route as keyof typeof text.nav;
      if (route && text.nav[route]) link.textContent = text.nav[route];
    });
    // The repo link is icon-only; the label lives in title/aria-label
    // instead of visible text.
    const repoWebLink =
      document.querySelector<HTMLAnchorElement>("#repo-web-link");
    if (repoWebLink) {
      repoWebLink.title = text.global.repoWebLink;
      repoWebLink.setAttribute("aria-label", text.global.repoWebLink);
    }
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
    const toolsChrome = toolsText(STATE.language);
    const toolsBtn =
      document.querySelector<HTMLButtonElement>("#panel-tab-tools");
    if (toolsBtn) {
      toolsBtn.textContent = toolsChrome.title;
      toolsBtn.title = toolsChrome.open;
    }
    document
      .querySelector<HTMLElement>("#tools-sheet")
      ?.setAttribute("aria-label", toolsChrome.title);
    relocalizeTools?.();
    const terminalChrome = terminalText(STATE.language);
    const terminalBtn = document.querySelector<HTMLButtonElement>(
      "#panel-tab-terminal",
    );
    if (terminalBtn) {
      terminalBtn.textContent = terminalChrome.title;
      terminalBtn.title = terminalChrome.open;
    }
    document
      .querySelector<HTMLElement>("#terminal-sheet")
      ?.setAttribute("aria-label", terminalChrome.title);
    relocalizeTerminal?.();
    document
      .querySelector<HTMLElement>(".app-panel-tabs")
      ?.setAttribute("aria-label", text.appPanel.tabs);
    const panelLayout = document.querySelector<HTMLElement>(
      ".app-panel-layout-switch",
    );
    panelLayout?.setAttribute("aria-label", text.appPanel.layout);
    const overlayLayout = document.querySelector<HTMLButtonElement>(
      '[data-panel-layout="overlay"]',
    );
    if (overlayLayout) {
      overlayLayout.textContent = text.appPanel.overlay;
      overlayLayout.title = text.appPanel.overlayTitle;
    }
    const dockedLayout = document.querySelector<HTMLButtonElement>(
      '[data-panel-layout="docked"]',
    );
    if (dockedLayout) {
      dockedLayout.textContent = text.appPanel.docked;
      dockedLayout.title = text.appPanel.dockedTitle;
    }
    const panelClose =
      document.querySelector<HTMLButtonElement>("#app-panel-close");
    if (panelClose) {
      panelClose.title = text.appPanel.close;
      panelClose.setAttribute("aria-label", text.appPanel.close);
    }
    document
      .querySelector<HTMLElement>("#app-panel-resizer")
      ?.setAttribute("aria-label", text.appPanel.resize);
    const copyAiContext =
      document.querySelector<HTMLButtonElement>("#copy-ai-context");
    if (copyAiContext) {
      copyAiContext.title = text.global.copyAiContext;
      copyAiContext.setAttribute("aria-label", text.global.copyAiContext);
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
    relocalizeWorktree?.();
    // 設定フォームの文言は viewer-settings.ts が自分で貼る。
    relocalizeViewerSettings?.();
    SOURCE_VIEW.localize();

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
  let relocalizeWorktree: (() => void) | null = null;
  let relocalizeTools: (() => void) | null = null;
  let relocalizeViewerSettings: (() => void) | null = null;
  let relocalizeTerminal: (() => void) | null = null;
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
    ensureGdscriptHighlightLanguage(hljsRef);
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
    // The label is state-neutral ("syntax"); ON/OFF reads from the tinted
    // .active styling, not from the text.
    btn.textContent =
      state === "loading" ? text.topbar.syntaxLoading : text.topbar.syntax;
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
    // worktree 画面も同じ diff2html のカードを積むので、同じく要る。
    if (
      route.screen === "diff" ||
      route.screen === "history" ||
      route.screen === "worktree"
    )
      return true;
    return (
      route.screen === "file" && sourceInternalPathKind(route.path) === null
    );
  }

  function ensureSyntaxHighlighterForRoute(): void {
    if (!routeCanUseSyntaxHighlighter()) return;
    loadSyntaxHighlighter().then((hljsRef) => {
      if (!hljsRef) return;
      rerenderLoadedDiffs();
      WORKTREE_VIEW?.displayOptionsChanged();
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
    WORKTREE_VIEW?.displayOptionsChanged();
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

  /** コードの文字サイズを 1 段ずつ動かす。端では止まる。 */
  const CODE_FONT_STEPS: ViewerFontSize[] = [
    "compact",
    "regular",
    "large",
    "xlarge",
  ];

  function stepCodeFontSize(delta: number): void {
    const current = CODE_FONT_STEPS.indexOf(savedCodeFontSize());
    const from = current < 0 ? CODE_FONT_STEPS.indexOf("regular") : current;
    const next =
      CODE_FONT_STEPS[
        Math.max(0, Math.min(CODE_FONT_STEPS.length - 1, from + delta))
      ];
    saveCodeFontSize(next);
    VIEWER_SETTINGS.sync();
  }

  /** サイドバーで選ばれているファイルのパスをクリップボードへ。 */
  function copyActiveFilePath(): boolean {
    const active = document.querySelector<HTMLElement>(
      "#filelist li.active[data-path]",
    );
    const path = active?.dataset.path;
    if (!path) return false;
    void navigator.clipboard.writeText(filePathClipboardText(path));
    return true;
  }

  function saveCodeFontSize(value: string) {
    const next = normalizeViewerFontSize(value);
    mergeLocalSettings({ codeFontSize: next });
    applyCodeFontSize();
    patchSettings({ codeFontSize: next });
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

  function defaultViewerSettingsDraft(): ViewerSettingsDraft {
    return {
      language: "en",
      sidebarFontSize: "regular",
      codeFontSize: "regular",
      omitDirs: serverScopeOmitDirsDefault().join("\n"),
      excludeNames: serverScopeExcludeNamesDefault().join("\n"),
      watchLimit: SERVER_SCOPE_WATCH_LIMIT_DEFAULT,
      uploadEnabled: true,
      inferFkRails: false,
      s3TooltipEnabled: true,
    };
  }

  async function saveViewerSettings(
    draft: ViewerSettingsDraft,
    options: {
      restoreDefaults: boolean;
      changedFields: readonly (keyof ViewerSettingsDraft)[];
    },
  ): Promise<void> {
    const normalizedLanguage = normalizeViewerLanguage(draft.language);
    const normalizedSidebarFontSize = normalizeViewerFontSize(
      draft.sidebarFontSize,
    );
    const normalizedCodeFontSize = normalizeViewerFontSize(draft.codeFontSize);
    const normalizedOmitDirs = normalizeScopeOmitDirs(draft.omitDirs);
    const normalizedExcludeNames = normalizeScopeExcludeNames(
      draft.excludeNames,
    );
    const normalized: ViewerSettingsDraft = {
      language: normalizedLanguage,
      sidebarFontSize: normalizedSidebarFontSize,
      codeFontSize: normalizedCodeFontSize,
      omitDirs: normalizedOmitDirs.join("\n"),
      excludeNames: normalizedExcludeNames.join("\n"),
      watchLimit:
        normalizeScopeWatchLimit(draft.watchLimit) ??
        SERVER_SCOPE_WATCH_LIMIT_DEFAULT,
      uploadEnabled: draft.uploadEnabled,
      inferFkRails: draft.inferFkRails,
      s3TooltipEnabled: draft.s3TooltipEnabled,
    };
    const changed = new Set(options.changedFields);
    const appPatch: SettingsPatch = {};
    const dbPrefsPatch: {
      inferFkRails?: boolean | null;
      s3TooltipEnabled?: boolean | null;
    } = {};
    if (options.restoreDefaults) {
      Object.assign(appPatch, {
        language: "en",
        sidebarFontSize: null,
        codeFontSize: null,
        scopeOmitDirs: null,
        scopeExcludeNames: null,
        scopeWatchLimit: null,
        uploadEnabled: null,
      });
      dbPrefsPatch.inferFkRails = null;
      dbPrefsPatch.s3TooltipEnabled = null;
    } else {
      if (changed.has("language")) appPatch.language = normalizedLanguage;
      if (changed.has("sidebarFontSize"))
        appPatch.sidebarFontSize = normalizedSidebarFontSize;
      if (changed.has("codeFontSize"))
        appPatch.codeFontSize = normalizedCodeFontSize;
      if (changed.has("omitDirs")) appPatch.scopeOmitDirs = normalizedOmitDirs;
      if (changed.has("excludeNames"))
        appPatch.scopeExcludeNames = normalizedExcludeNames;
      if (changed.has("watchLimit"))
        appPatch.scopeWatchLimit = normalized.watchLimit;
      if (changed.has("uploadEnabled"))
        appPatch.uploadEnabled = normalized.uploadEnabled;
      if (changed.has("inferFkRails"))
        dbPrefsPatch.inferFkRails = normalized.inferFkRails;
      if (changed.has("s3TooltipEnabled"))
        dbPrefsPatch.s3TooltipEnabled = normalized.s3TooltipEnabled;
    }
    const operations: Promise<void>[] = [];
    if (Object.keys(appPatch).length > 0)
      operations.push(persistSettingsPatch(appPatch));
    if (Object.keys(dbPrefsPatch).length > 0)
      operations.push(DATABASE_VIEW.saveDbUiPrefs(dbPrefsPatch));
    const results = await Promise.allSettled(operations);
    const errors = results.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : [],
    );
    if (errors.length > 0) {
      throw errorWithCauses("save viewer settings failed", errors);
    }

    if (options.restoreDefaults || changed.has("language"))
      setViewerLanguage(normalizedLanguage, false);
    if (options.restoreDefaults || changed.has("sidebarFontSize"))
      applySidebarFontSize();
    if (options.restoreDefaults || changed.has("codeFontSize"))
      applyCodeFontSize();
    if (
      options.restoreDefaults ||
      changed.has("omitDirs") ||
      changed.has("excludeNames")
    ) {
      refreshRepositoryTreeAfterSettings();
    }
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

  // fetch() is wrapped once at startup, so trackLoad is only a compatibility
  // passthrough. Do not pass non-fetch promises here unless tracking is restored.
  function trackLoad<T>(promise: Promise<T>): Promise<T> {
    return promise;
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
        createRepositoryWebLink: createFileRepositoryWebLink,
        emptyText: () => uiText().diff,
      },
      historyRoute,
      { loadSidebar: false },
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
  let WORKTREE_VIEW: WorktreeView | null = null;

  function applyInlineAnnotations() {
    ANNOTATIONS_UI?.applyInlineAnnotations();
  }

  function withAnnotationSessionParam(rawUrl: string): string {
    return ANNOTATIONS_UI ? ANNOTATIONS_UI.withSessionParam(rawUrl) : rawUrl;
  }

  // buildRoute は AppRoute しか知らないので、そこに乗らないオーバーレイの状態
  // (doctor / tools) は現在の URL から明示的に引き継ぐ。落とすと画面を移動した
  // 瞬間にシートの状態が URL から消える。history に積む URL とヘッダメニューの
  // href の両方がこれを通る必要がある。
  function withOverlayState(url: string): string {
    return withTerminalOverlay(
      withToolsOverlay(
        withDoctorOverlay(
          url,
          parseDoctorOverlay(window.location.pathname, window.location.search),
        ),
        parseToolsOverlay(window.location.search),
      ),
      parseTerminalOverlay(window.location.search),
    );
  }

  function urlForRoute(route: AppRoute): string {
    return withOverlayState(withAnnotationSessionParam(buildRoute(route)));
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
    const url = urlForRoute(STATE.route);
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
    options: { refresh?: boolean } = {},
  ): boolean {
    if (route.view === "blob") {
      setStatus("live");
      removeFileHistoryShell();
      BLAME_VIEW.removeBlamePage();
      applySourceRouteToShell(options);
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
      void HISTORY_VIEW.enterHistory({ mount }).then(async () => {
        const currentRoute = STATE.route;
        if (
          currentRoute.screen !== "file" ||
          currentRoute.view !== "history" ||
          currentRoute.path !== route.path ||
          currentRoute.ref !== route.ref
        )
          return;
        await loadDiffFile(route.path);
        const routeAfterDiff = STATE.route;
        if (
          routeAfterDiff.screen !== "file" ||
          routeAfterDiff.view !== "history" ||
          routeAfterDiff.path !== route.path ||
          routeAfterDiff.ref !== route.ref
        )
          return;
        await REPO_VIEW.renderRepoBlobSidebar(route.path, route.ref);
        placeSidebarToggle();
      });
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
    if (
      previousRoute.screen === "worktree" &&
      nextRoute.screen !== "worktree"
    ) {
      WORKTREE_VIEW?.suspend();
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
    if (nextRoute.screen === "worktree") {
      cancelActiveSourceLoad("navigation");
      setPageMode();
      removeStandaloneSource();
      void WORKTREE_VIEW?.enter();
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
    if (STATE.route.screen !== "help") {
      document.querySelector(".gdp-help-shell")?.remove();
    }
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
    document.body.classList.toggle(
      "gdp-worktree-page",
      STATE.route.screen === "worktree",
    );
    // docked の下パネルと場所を分け合うとき、#content がスクロール容器になる
    // ページ。style.css の body.app-panel-docked[data-content-scrolls-when-docked]
    // 規則群がこの属性だけを見る (ページクラスの列挙はしない)。
    // journal / database は自分の箱が --content-h から高さを取るので立てない。
    document.body.toggleAttribute(
      "data-content-scrolls-when-docked",
      STATE.route.screen === "diff" ||
        STATE.route.screen === "history" ||
        STATE.route.screen === "repo" ||
        STATE.route.screen === "file" ||
        STATE.route.screen === "help" ||
        STATE.route.screen === "worktree",
    );
    // 左に --history-w の一覧パネル (#history-panel / #worktree-panel) を持つ
    // ページ。#history-resizer の表示がこの属性を見る。
    document.body.toggleAttribute(
      "data-history-list-panel",
      historyPanelRoute || STATE.route.screen === "worktree",
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
    // Terminal / Tools はページ遷移ではなく下パネルの中身なので、ヘッダーの
    // 並びには居ない。選択状態は URL (?terminal= / ?tools=) から決める。
    syncAppPanel();
    document
      .querySelectorAll<HTMLAnchorElement>(
        "a.app-menu-item, a.global-icon-link",
      )
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
        // href にもオーバーレイの状態を載せる。載せないと、Tools や Doctor を
        // 開いたままメニューを押した瞬間にシートが閉じたことになる。
        if (link.dataset.route === "repo") {
          link.href = withOverlayState(
            buildRoute({
              screen: "repo",
              ref: STATE.repoRef || "worktree",
              path: "",
              range: currentRange(),
            }),
          );
        }
        if (link.dataset.route === "diff") {
          // On the history screen the live range tracks the selected commit;
          // the Diff Viewer link keeps the range the user picked before.
          link.href = withOverlayState(
            buildRoute({
              screen: "diff",
              range: preHistoryRange ?? currentRange(),
            }),
          );
        }
        if (link.dataset.route === "history") {
          link.href = withOverlayState(
            buildRoute({
              screen: "history",
              ref: "HEAD",
              range: currentRange(),
            }),
          );
        }
        if (link.dataset.route === "journal") {
          link.href = withOverlayState(
            buildRoute({
              screen: "journal",
              range: currentRange(),
            }),
          );
        }
        if (link.dataset.route === "database") {
          link.href = withOverlayState(
            buildRoute({
              screen: "database",
              range: currentRange(),
            }),
          );
        }
        if (link.dataset.route === "worktree") {
          link.href = withOverlayState(
            buildRoute({
              screen: "worktree",
              range: currentRange(),
            }),
          );
        }
        if (link.dataset.route === "help") {
          link.href = withOverlayState(
            buildRoute({
              screen: "help",
              lang:
                STATE.route.screen === "help"
                  ? helpLanguageFromRoute(STATE.route)
                  : STATE.language,
              section: helpSectionFromRoute(STATE.route),
              range: currentRange(),
            }),
          );
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

  function createFileRepositoryWebLink(
    target: SourceFileTarget,
  ): HTMLAnchorElement | null {
    const webTarget = buildRepositoryWebTarget(REPO_WEB_URL, {
      ref: target.ref,
      fallbackRef: PROJECT_BRANCH,
      path: target.path,
      kind: "blob",
    });
    if (!webTarget) return null;
    const label =
      webTarget.provider === "github"
        ? uiText().repo.openGithub
        : uiText().repo.openRepositoryWeb;
    return createRepositoryWebLink(webTarget, label);
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

  // ---------- Viewer settings: extracted to viewer-settings.ts ----------
  // 以前はヘッダの歯車から出るポップオーバーだった。今は Help ページの
  // 設定セクションが唯一の置き場で、ここは値の出し入れだけを受け持つ。
  const VIEWER_SETTINGS = createViewerSettings({
    getText: () => uiText().settings,
    getValues: () => ({
      language: STATE.language,
      sidebarFontSize: savedSidebarFontSize(),
      codeFontSize: savedCodeFontSize(),
      omitDirs: effectiveScopeOmitDirs().join("\n"),
      excludeNames: effectiveScopeExcludeNames().join("\n"),
      watchLimit: effectiveScopeWatchLimit(),
      watchLimitMin: SERVER_SCOPE_WATCH_LIMIT_MIN,
      watchLimitMax: SERVER_SCOPE_WATCH_LIMIT_MAX,
      watchLimitDefault: SERVER_SCOPE_WATCH_LIMIT_DEFAULT,
      uploadEnabled: APP_SETTINGS.uploadEnabled !== false,
      inferFkRails: DATABASE_VIEW.getDbUiPref("inferFkRails", false),
      s3TooltipEnabled: DATABASE_VIEW.getDbUiPref("s3TooltipEnabled", true),
      scopeSource: uiText().settings.scopeSource(
        PROJECT_NAME || "default",
        scopeOmitSourceLabel(),
      ),
      agentRulesJson: AGENT_SCREEN_RULES,
      agentRulesSource: AGENT_SCREEN_RULES_SOURCE,
      agentRulesErrors: agentScreenRuleErrorsText(AGENT_SCREEN_RULE_ERRORS),
    }),
    getDefaultValues: defaultViewerSettingsDraft,
    refresh: async () => {
      await Promise.all([
        loadSettings(),
        loadAgentScreenRules(),
        DATABASE_VIEW.loadDbUiPrefs(),
      ]);
    },
    onSave: saveViewerSettings,
    onAgentRulesSave: saveAgentScreenRules,
    onAgentRulesReset: resetAgentScreenRuleSettings,
  });
  relocalizeViewerSettings = () => VIEWER_SETTINGS.localize();

  // ---------- Keybinding editor: extracted to help-keybinding-editor.ts ----
  const KEYBINDING_EDITOR = createHelpKeybindingEditor({
    getLanguage: () => STATE.language,
    getOverrides: () => APP_SETTINGS.keybindings || {},
    saveOverrides: (next) => {
      // 差分が空になったら丸ごと消す。次に読んだときは素直にデフォルトへ。
      patchSettings({
        keybindings: Object.keys(next).length ? next : null,
      });
    },
    onChanged: () => renderHelpPage(),
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
    mountViewerSettings: (host) => VIEWER_SETTINGS.mount(host),
    getKeyBindings: activeKeyBindings,
    decorateKeybindings: (article, groups) =>
      KEYBINDING_EDITOR.decorate(article, groups),
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
    const repoWebLinkIcon = document.querySelector<HTMLElement>(
      "#repo-web-link .goi-icon",
    );
    if (repoWebLinkIcon) {
      repoWebLinkIcon.innerHTML = iconSvg(
        "octicon-mark-github",
        MARK_GITHUB_16_PATH,
      );
    }
    const quickHelpIcon = document.querySelector<HTMLElement>(
      "#quick-help-btn .goi-icon",
    );
    if (quickHelpIcon) {
      quickHelpIcon.innerHTML = iconSvg("octicon-question", QUESTION_16_PATH);
    }
    const branchIcon = document.querySelector<HTMLElement>(
      "#project-branch .goi-icon",
    );
    if (branchIcon) {
      branchIcon.innerHTML = iconSvg("octicon-git-branch", GIT_BRANCH_16_PATH);
    }
  }

  // Static SVGs for the topbar ref-picker actions. Run once at
  // init, same as setGlobalHeaderIcons(); title/aria-label stay in sync
  // with the active language via localizeViewerChrome() instead.
  function setRefActionIcons() {
    const refReset = document.querySelector<HTMLButtonElement>("#ref-reset");
    if (refReset) refReset.innerHTML = iconSvg("octicon-undo", UNDO_16_PATH);
    const reload = document.querySelector<HTMLButtonElement>("#reload-prom");
    if (reload) reload.innerHTML = iconSvg("octicon-sync", SYNC_16_PATH);
    const refDots = document.querySelector<HTMLElement>(".ref-dots .goi-icon");
    if (refDots) {
      refDots.innerHTML = iconSvg("octicon-arrow-right", ARROW_RIGHT_16_PATH);
    }
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
  $("#doctor-btn")?.addEventListener("click", (event) => {
    event.preventDefault();
    toggleDoctorSheet();
  });
  $("#panel-tab-tools")?.addEventListener("click", (event) => {
    event.preventDefault();
    openToolsSheet();
  });
  $("#panel-tab-terminal")?.addEventListener("click", (event) => {
    event.preventDefault();
    openTerminalSheet();
  });
  $("#app-panel-close")?.addEventListener("click", (event) => {
    event.preventDefault();
    closeAppPanel();
  });
  document
    .querySelectorAll<HTMLButtonElement>("[data-panel-layout]")
    .forEach((button) => {
      button.addEventListener("click", () => {
        setAppPanelDocked(button.dataset.panelLayout === "docked");
      });
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
          clearSidebarFilter();
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
    target: Element | null = null,
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
      // Escape は手前にあるものから畳む。下パネルの中にいればパネルを閉じ、
      // 行を選んでいればその解除、どちらでもなければ読み込みを止める。
      if (scope === "panel") {
        closeAppPanel();
        return true;
      }
      if (clearLineSelection()) return true;
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
    if (action === "previous-unviewed-file") {
      if (DIFF_VIEW.scrollToPreviousUnviewedFile()) scheduleMainSurfaceFocus();
      return true;
    }
    if (action === "toggle-viewed") return DIFF_VIEW.toggleActiveFileViewed();
    if (action === "reload-diff") {
      reloadDiffFromUi();
      return true;
    }
    if (action === "next-hunk" || action === "previous-hunk")
      return DIFF_VIEW.scrollToAdjacentHunk(action === "next-hunk" ? 1 : -1);
    if (action === "goto-diff") {
      navigateToRoute({ screen: "diff", range: currentRange() });
      return true;
    }
    if (action === "goto-history") {
      navigateToRoute({
        screen: "history",
        ref: "HEAD",
        range: currentRange(),
      });
      return true;
    }
    if (action === "goto-repo") {
      navigateToRoute({
        screen: "repo",
        ref: STATE.repoRef || "worktree",
        path: "",
        range: currentRange(),
      });
      return true;
    }
    if (action === "toggle-sidebar") {
      applySidebarHidden(!STATE.sidebarHidden);
      return true;
    }
    if (action === "toggle-terminal-panel") {
      if (TERMINAL_VIEW.isOpen()) closeTerminalSheet();
      else openTerminalSheet();
      return true;
    }
    if (action === "undo-last-action") {
      void undoLastAction();
      return true;
    }
    if (action === "find-in-source")
      return openVirtualSourceSearchFromKeyboard(target);
    if (action === "goto-journal") {
      navigateToRoute({ screen: "journal", range: currentRange() });
      return true;
    }
    if (action === "goto-database") {
      navigateToRoute({ screen: "database", range: currentRange() });
      return true;
    }
    if (action === "nav-back") {
      history.back();
      return true;
    }
    if (action === "nav-forward") {
      history.forward();
      return true;
    }
    if (action === "copy-file-path") return copyActiveFilePath();
    if (action === "toggle-annotations-panel") {
      $("#annotations-toggle")?.click();
      return true;
    }
    if (action === "toggle-ignore-whitespace") {
      $("#ignore-ws")?.click();
      return true;
    }
    if (action === "toggle-hide-tests") {
      $("#hide-tests")?.click();
      return true;
    }
    if (action === "open-settings") {
      openHelpSection(helpSectionDeps(), "settings");
      return true;
    }
    if (
      action === "code-font-size-increase" ||
      action === "code-font-size-decrease"
    ) {
      stepCodeFontSize(action === "code-font-size-increase" ? 1 : -1);
      return true;
    }
    if (action === "code-font-size-reset") {
      saveCodeFontSize("regular");
      VIEWER_SETTINGS.sync();
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
    const scope = keymapScope(targetEl);
    const action = resolveKeymapAction(
      e,
      {
        scope,
        editable: isEditableKeyTarget(targetEl),
        composing: isImeComposing(e),
        paletteOpen: isPaletteOpen(),
        pendingG:
          PENDING_G_SCOPE === scope && performance.now() <= PENDING_G_UNTIL,
        lightboxOpen: !!document.querySelector(".mkdp-lightbox"),
      },
      activeKeyBindings(),
    );
    if (!action) return;
    if (dispatchKeymapAction(action, scope, e.repeat, targetEl))
      e.preventDefault();
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

  let diffLoadGeneration = 0;

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
    if (STATE.route.screen === "worktree") {
      return (WORKTREE_VIEW?.reload() ?? Promise.resolve()).then(() => null);
    }
    if (
      STATE.route.screen === "file" &&
      !(isFileHistoryRoute(STATE.route) && activeHistoryPathFilter) &&
      // load() is by definition a reload (topbar Reload button, ignore-ws
      // toggle, catch-up after SSE reconnect) - bypass the idempotent-mount
      // guard so the blob view actually refetches, matching the pre-guard
      // behavior of every load() caller.
      dispatchFileRoute(STATE.route, { refresh: true })
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
    const requestGeneration = ++diffLoadGeneration;
    const fromAtRequest = STATE.from;
    const toAtRequest = STATE.to;
    const ignoreWsAtRequest = STATE.ignoreWs;
    const isCurrentDiffRequest = () =>
      requestGeneration === diffLoadGeneration &&
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
    } else if (STATE.route.screen === "worktree") {
      void WORKTREE_VIEW?.enter();
    } else load();
    // Deep links land here without going through setRoute; reflect a line=
    // selection in the copy pill on first paint too.
    syncLineRefPill();
    syncDoctorSheetFromUrl();
    syncToolsSheetFromUrl();
    syncTerminalSheetFromUrl();
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

  function helpSectionDeps() {
    return {
      getRoute: () => STATE.route,
      getLanguage: () => STATE.language,
      currentRange,
      setRoute,
      setPageMode,
      renderHelpPage,
      setStatus,
      cancelActiveSourceLoad,
    };
  }

  QUICK_HELP = createQuickHelp({
    $,
    getLanguage: () => STATE.language,
    getText: () => uiText().quickHelp,
    openFullKeybindings: () => openHelpKeybindings(helpSectionDeps()),
    openSettings: () => openHelpSection(helpSectionDeps(), "settings"),
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

  // Tools sheet — doctor sheet と同じ「AppRoute から独立した 1 クエリキーの
  // オーバーレイ」。違いは開いているツール名まで URL に載せる点だけ。
  const TOOLS_VIEW = createToolsView({
    $: <T extends Element = HTMLElement>(sel: string) =>
      document.querySelector<T>(sel),
    trackLoad,
    getLanguage: () => STATE.language,
    actionHeaders,
    onCloseRequest: () => closeToolsSheet(),
    onToolChange: (tool) => updateUrlForToolsOverlay(tool),
  });
  relocalizeTools = () => TOOLS_VIEW.localize();

  function openToolsOverlay(): ToolId | null {
    return parseToolsOverlay(window.location.search);
  }

  function updateUrlForToolsOverlay(tool: ToolId | null): void {
    const current = window.location.pathname + window.location.search;
    const next = withToolsOverlay(current, tool);
    if (next !== current) {
      history.replaceState(history.state, "", next + window.location.hash);
    }
    // メニューの Tools は URL の ?tools= を見て押下状態を出すので、URL を
    // 書き換えたらその場で貼り直す。
    syncHeaderMenu();
  }

  /**
   * 画面下のパネル。中身は Terminal と Tools で、出せるのは一度に 1 つ。
   *
   * 開いているかどうかは中身が持っている (それぞれの isOpen)。パネル自身は
   * 器なので、状態を二重に持たずに中身から引き直す。ここを別々に持つと、
   * URL から復元したときにタブと中身がずれる。
   */
  function syncAppPanel(): void {
    // 中身の open() は非同期なので、直後に isOpen() を見ると閉じたままに
    // 見える。URL は開いた時点で同期的に入るので、そちらを正とする
    // (ヘッダーのメニューが押下状態を出していたときと同じ決め方)。
    const tools = parseToolsOverlay(window.location.search) !== null;
    const terminal = parseTerminalOverlay(window.location.search) !== null;
    const open = tools || terminal;
    const panel = document.getElementById("app-panel");
    if (panel) {
      panel.classList.toggle("app-panel-open", open);
    }
    for (const [id, selected] of [
      ["#panel-tab-tools", tools],
      ["#panel-tab-terminal", terminal],
    ] as const) {
      const tab = document.querySelector<HTMLButtonElement>(id);
      if (!tab) continue;
      tab.setAttribute("aria-selected", String(selected));
    }
    syncAppPanelLayout();
  }

  function syncAppPanelLayout(): void {
    const docked = APP_SETTINGS.appPanelDocked === true;
    document.body.classList.toggle("app-panel-docked", docked);
    for (const button of document.querySelectorAll<HTMLButtonElement>(
      "[data-panel-layout]",
    )) {
      const active =
        button.dataset.panelLayout === (docked ? "docked" : "overlay");
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    }
  }

  function setAppPanelDocked(docked: boolean): void {
    if ((APP_SETTINGS.appPanelDocked === true) === docked) return;
    patchSettings({ appPanelDocked: docked });
    syncAppPanelLayout();
  }

  function closeAppPanel(): void {
    if (
      parseToolsOverlay(window.location.search) !== null ||
      TOOLS_VIEW.isOpen()
    )
      closeToolsSheet();
    if (
      parseTerminalOverlay(window.location.search) !== null ||
      TERMINAL_VIEW.isOpen()
    )
      closeTerminalSheet();
  }

  /** パネルの高さ (px) の許容範囲。上限は CSS の max-height が持つ。 */
  const MIN_APP_PANEL_HEIGHT = 160;
  const MAX_APP_PANEL_HEIGHT = 1400;
  /** CSS 側の既定値 (--app-panel-height の fallback) と揃える。 */
  const DEFAULT_APP_PANEL_HEIGHT = 420;
  const APP_PANEL_HEIGHT_STORAGE_KEY = "code-viewer:app-panel-height";

  /** 最後に適用した高さ。ドラッグが終わった時点でこれを保存する。 */
  let appPanelHeight = DEFAULT_APP_PANEL_HEIGHT;

  function applyAppPanelHeight(height: number): void {
    appPanelHeight = Math.min(
      MAX_APP_PANEL_HEIGHT,
      Math.max(MIN_APP_PANEL_HEIGHT, Math.round(height)),
    );
    // 高さはパネル自身だけでなく #content の下余白も決める。パネル要素に
    // 置くと兄弟の #content から見えないので、:root に置く。
    document.documentElement.style.setProperty(
      "--app-panel-height",
      `${appPanelHeight}px`,
    );
  }

  {
    const panel = document.getElementById("app-panel");
    const handle = document.getElementById("app-panel-resizer");
    // 前回引き伸ばした高さで開く。パネルを出す前に当てておけば、開いた瞬間に
    // 既定値からの跳ねが出ない。
    applyAppPanelHeight(
      readStoredSize(APP_PANEL_HEIGHT_STORAGE_KEY, DEFAULT_APP_PANEL_HEIGHT),
    );
    if (panel && handle) {
      attachDragResizer({
        handle,
        getSize: () => panel.getBoundingClientRect().height,
        // 上へ引くほど高くなる。ハンドルはパネルの上端にある。
        direction: -1,
        axis: "y",
        applySize: (height) => {
          applyAppPanelHeight(height);
          // 高さが変わると端末の桁数・行数も変わる。追従させる。
          TERMINAL_VIEW.refit();
        },
        // 保存はドラッグ / キー操作が終わった時だけ。動かしている間ずっと
        // 書くと、1 回のドラッグで数十回 localStorage を叩くことになる。
        onEnd: () =>
          writeStoredSize(APP_PANEL_HEIGHT_STORAGE_KEY, appPanelHeight),
        activeClassTarget: panel,
        activeClassName: "app-panel-resizing",
      });
    }
  }

  function openToolsSheet(tool?: ToolId): void {
    // タブなので、もう一方は畳む。2 つ並べると 1 つあたりが狭くなりすぎる。
    if (
      parseTerminalOverlay(window.location.search) !== null ||
      TERMINAL_VIEW.isOpen()
    )
      closeTerminalSheet();
    // 実際に出すツールが決まるのは保存状態を読んだ後だが、「開いた」ことは
    // その場で URL に出す。読み込みが止まっても URL と画面が食い違わない。
    updateUrlForToolsOverlay(tool ?? TOOLS_VIEW.getActiveTool());
    void TOOLS_VIEW.open(tool);
    syncAppPanel();
  }

  function closeToolsSheet(): void {
    TOOLS_VIEW.close();
    updateUrlForToolsOverlay(null);
    syncAppPanel();
  }

  function syncToolsSheetFromUrl(): void {
    const tool = openToolsOverlay();
    const open = TOOLS_VIEW.isOpen();
    if (tool && (!open || TOOLS_VIEW.getActiveTool() !== tool))
      void TOOLS_VIEW.open(tool);
    else if (!tool && open) TOOLS_VIEW.close();
    syncAppPanel();
  }

  // Terminal sheet — tools sheet と同じ独立オーバーレイ。URL に載るのは
  // 映している対象の ID で、tmux ペイン (?terminal=%14) かこのドロワーから
  // 開いたシェル (?terminal=shell-…)。何も選ぶ前は ?terminal=open。
  const TERMINAL_VIEW = createTerminalView({
    $: <T extends Element = HTMLElement>(sel: string) =>
      document.querySelector<T>(sel),
    trackLoad,
    getLanguage: () => STATE.language,
    actionHeaders,
    // 文字サイズは他の表示設定と同じ置き場 (app settings) に持たせる。
    // 保存の経路も codeFontSize などと同じ patchSettings に乗せる。
    getFontSize: () => clampTerminalFontSize(APP_SETTINGS.terminalFontSize),
    onFontSizeChange: (size) => {
      const next = clampTerminalFontSize(size);
      mergeLocalSettings({ terminalFontSize: next });
      patchSettings({ terminalFontSize: next });
    },
    onCloseRequest: () => closeTerminalSheet(),
    onTargetChange: (id) => updateUrlForTerminalOverlay(id ?? "open"),
  });
  relocalizeTerminal = () => TERMINAL_VIEW.localize();

  function updateUrlForTerminalOverlay(state: TerminalOverlayState): void {
    const current = window.location.pathname + window.location.search;
    const next = withTerminalOverlay(current, state);
    if (next !== current) {
      history.replaceState(history.state, "", next + window.location.hash);
    }
    // メニューの Terminal は URL の ?terminal= を見て押下状態を出す。
    syncHeaderMenu();
  }

  function openTerminalSheet(id?: string | null): void {
    // タブなので、もう一方は畳む。
    if (
      parseToolsOverlay(window.location.search) !== null ||
      TOOLS_VIEW.isOpen()
    )
      closeToolsSheet();
    const target = id ?? TERMINAL_VIEW.getActiveTarget();
    // 実際に何を映すかは一覧を取った後に決まるが、「開いた」ことはその場で
    // URL に出す。読み込みが止まっても URL と画面が食い違わない。
    updateUrlForTerminalOverlay(target ?? "open");
    void TERMINAL_VIEW.open(target);
    syncAppPanel();
  }

  function closeTerminalSheet(): void {
    TERMINAL_VIEW.close();
    updateUrlForTerminalOverlay(null);
    syncAppPanel();
  }

  function syncTerminalSheetFromUrl(): void {
    const state = parseTerminalOverlay(window.location.search);
    const open = TERMINAL_VIEW.isOpen();
    const target = state === "open" ? null : state;
    if (
      state &&
      (!open || (target && TERMINAL_VIEW.getActiveTarget() !== target))
    ) {
      void TERMINAL_VIEW.open(target);
    } else if (!state && open) {
      TERMINAL_VIEW.close();
    }
    syncAppPanel();
  }

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

  WORKTREE_VIEW = createWorktreeView({
    getRoute: () => STATE.route,
    // topbar のトグルは Diff ビューアと同じものを使う。値の出所も同じ STATE。
    getOptions: () => ({
      layout: STATE.layout,
      ignoreWs: STATE.ignoreWs,
      hideTests: STATE.hideTests,
      syntax: STATE.syntaxHighlight,
    }),
    isTestPath: isTestFilePath,
    getSidebarView: () => STATE.sbView,
    // ハイライタは遅延バンドル。差分を描く直前に読み込ませる。
    loadHljs: loadSyntaxHighlighter,
    setRoute,
    currentRange,
    trackLoad,
    getText: () => worktreeText(STATE.language),
    setPageMode,
    syncHeaderMenu,
    setStatus,
    createOpenPathButton,
  });
  relocalizeWorktree = () => WORKTREE_VIEW?.localize();

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
  // 場合、設定フォームの checkbox 表示を最新値に追従させる。sync() は
  // フォームがまだ組まれていなければ何もしないので、開閉の判定は要らない。
  DATABASE_VIEW.onDbUiPrefChange(() => VIEWER_SETTINGS.sync());

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
  /**
   * キーボードから画面を移る。メニューのリンクを踏んだときと同じ経路を
   * 通したいので、URL を積んでから applyRouteFromLocation に任せる。
   */
  function navigateToRoute(route: AppRoute): void {
    history.pushState(historyStateForRoute(route), "", urlForRoute(route));
    window.scrollTo(0, 0);
    applyRouteFromLocation();
  }

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
    if (previousRoute.screen === "worktree" && nextRoute.screen !== "worktree")
      WORKTREE_VIEW?.suspend();
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
    syncToolsSheetFromUrl();
    syncTerminalSheetFromUrl();
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
    if (STATE.route.screen === "worktree") {
      cancelActiveSourceLoad("navigation");
      setPageMode();
      removeStandaloneSource();
      void WORKTREE_VIEW?.enter();
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

  // Header logo and menu links navigate within the SPA. A full page load here
  // re-lays-out the whole app from scratch (the layout shift the menu was
  // notorious for); pushState + the shared route handler keeps the chrome
  // stable. The panel is independent from the page route, so carry its current
  // state to the destination URL. Modified clicks (new tab etc.) keep native
  // anchor behavior.
  document
    .querySelectorAll<HTMLAnchorElement>(
      "a.brand, a.app-menu-item, a.global-icon-link",
    )
    .forEach((link) => {
      // External links (the GitHub repo link) keep native anchor behavior;
      // hijacking them would push their pathname onto the local origin.
      if (link.target === "_blank") return;
      link.addEventListener("click", (e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0)
          return;
        e.preventDefault();
        const target = new URL(link.href, window.location.origin);
        history.pushState(
          null,
          "",
          withOverlayState(target.pathname + target.search),
        );
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
      WORKTREE_VIEW?.displayOptionsChanged();
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
        const isTest = isTestFilePath(card.dataset.path || "");
        card.classList.toggle("hidden-by-tests", effective && isTest);
      });
    document
      .querySelectorAll<HTMLElement>("#filelist li[data-path]")
      .forEach((li) => {
        const isTest = isTestFilePath(li.dataset.path || "");
        li.classList.toggle("hidden-by-tests", effective && isTest);
      });
    if (isVirtualSidebarActive()) rerenderVirtualSidebar();
    else updateTreeDirVisibility();
    if (typeof applyViewedState === "function") applyViewedState();
    applyHideTestsToMeta();
    WORKTREE_VIEW?.displayOptionsChanged();
  }

  function visibleDiffMetaForBrief(meta: DiffMeta): DiffMeta {
    if (!meta.totals) return meta;
    const effective = STATE.hideTests && !isRepositorySidebarMode();
    if (!effective) return meta;
    let additions = 0;
    let deletions = 0;
    const visibleFiles: FileMeta[] = [];
    for (const f of meta.files) {
      if (isTestFilePath(f.path || "")) continue;
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
        // The banner only appears after the viewed file changed on disk, so
        // this explicit reload must bypass the idempotent-mount guard.
        dispatchFileRoute(route, { refresh: true });
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
      // Scope match: a directory-level notification stands for the files under
      // it, so an exact lookup would skip the file being viewed.
      if (viewingPath && !changedPathsCoverPath(paths, viewingPath)) return;
      // The viewed file changed on disk - bypass the idempotent-mount guard
      // so the fresh content actually renders.
      dispatchFileRoute(route, { refresh: true });
      return;
    }
    if (route.screen === "repo") {
      // サイドバーのキャッシュは破棄しない。invalidate すると全消去・全再構築が
      // 走ってスクロール位置と展開状態が飛ぶ。refreshRepoSidebar が既存 DOM を
      // 温存したまま最新ツリーに合わせ、loadRepo はシグネチャ比較で同一内容の
      // 再構築をスキップする。
      void loadRepo();
      void refreshRepoSidebar();
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
        if (viewingPath && !changedPathsCoverPath(paths, viewingPath)) return;
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
      // 作業ツリー一覧は変更数を出しているので、ファイルが動いたら引き直す。
      // 専用イベントは無い (watcher が見ているのはこのサーバの作業ツリーだけ)。
      if (STATE.route.screen === "worktree") WORKTREE_VIEW?.handleSse();
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
