import type { AgentHooksResponse } from "./core/agent-hooks";
import { type AgentPane, titleWithUnread } from "./core/agent-overview";
import {
  type AgentScreenRuleIssue,
  type AgentScreenRulesResponse,
  DEFAULT_AGENT_SCREEN_RULES,
  formatAgentScreenRuleSet,
} from "./core/agent-screen";
import type { AgentState } from "./core/agent-state";
import {
  AI_CONTEXT_LARGE_SELECTION_LINE_THRESHOLD,
  aiContextClipboardText,
  resolveSelectionTarget,
} from "./core/ai-context-copy";
import {
  apiUrl,
  pageUrl,
  projectKey,
  projectRequest,
  routePathname,
  withoutProjectPrefix,
} from "./core/api-url";
import {
  type CatchUpReason,
  catchUpKind,
  createCatchUpGate,
  shouldAutoLoadForRoute,
} from "./core/catch-up";
import { changedPathsCoverPath } from "./core/changed-paths";
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
  fileSignatureUnchanged,
  rawFileInfoSignature,
} from "./core/file-refresh";
import {
  findMainScrollTarget,
  focusMainPanel,
  focusSidebarPanel,
  isEditableKeyTarget,
  isEnterForFocusedControl,
  isPageKeymapBlockedKey,
  keymapScope,
  mainScrollBox,
  prepareKeyboardPanels,
  setPanelFocusScope,
} from "./core/focus-scope";
import {
  ensureGdscriptHighlightLanguage,
  ensureTerraformHighlightLanguage,
} from "./core/highlight-languages";
import type { FileRevisionNeighbors } from "./core/history";
import {
  APPS_16_PATH,
  ARROW_RIGHT_16_PATH,
  BOOK_16_PATH,
  CHEVRON_DOWN_12_PATH,
  COMMENT_DISCUSSION_16_PATH,
  COPY_16_PATHS,
  DIFF_SPLIT_16_PATH,
  DIFF_UNIFIED_16_PATHS,
  FOLDER_ICON_PATHS,
  GEAR_16_PATH,
  GIT_BRANCH_16_PATH,
  iconSvg,
  MARK_GITHUB_16_PATH,
  MOON_16_PATH,
  NEXT_16_PATHS,
  OPEN_EXTERNAL_16_PATH,
  PLUS_16_PATH,
  PREVIOUS_16_PATHS,
  PULSE_16_PATH,
  QUESTION_16_PATH,
  SEARCH_16_PATH,
  SIDEBAR_HIDE_16_PATHS,
  SIDEBAR_SHOW_16_PATHS,
  SYNC_16_PATH,
  TERMINAL_16_PATHS,
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
import { isNativeLinkClick } from "./core/link-click";
import {
  listColumnDrag,
  listColumnLayout,
  restoredListWidth,
} from "./core/list-column";
import type { PaneSide, TabTarget } from "./core/main-tabs";
import { createNetworkActivityTracker } from "./core/network-activity";
import { panelColumnAction } from "./core/panel-column-policy";
import {
  clampPanelSize,
  HISTORY_WIDTH,
  SIDEBAR_WIDTH,
} from "./core/panel-sizes";
import {
  createInstallOffer,
  lastTabNumber,
  resolvePwaKey,
  STANDALONE_MEDIA_QUERY,
  syncThemeColor,
} from "./core/pwa";
import { buildRepositoryWebTarget } from "./core/repository-web-url";
import {
  type AppRoute,
  buildRoute,
  type DiffRange,
  legacyPanelRoute,
  parseDoctorOverlay,
  parseOpenPaneOverlay,
  parsePaneOverlay,
  parseRoute,
  parseTerminalOverlay,
  projectSwitchPath,
  type SourceFileTarget,
  type SourceLineTarget,
  screenToLeave,
  type TerminalOverlayState,
  urlKeepsSavedFront,
  withDoctorOverlay,
  withOpenPaneOverlay,
  withPaneOverlay,
  withTerminalOverlay,
} from "./core/routes";
import {
  createScrollMemory,
  scrollKeyOfHistoryState,
} from "./core/scroll-memory";
import { rememberPaletteSelection } from "./core/search-palette";
import type { ShellListResponse, ShellSessionId } from "./core/shell";
import { sourceInternalPathKind } from "./core/source-meta";
import {
  type TerminalImageRef,
  type TerminalImagesResponse,
  terminalImageExtension,
  validateTerminalImageResponseUrls,
} from "./core/terminal-images";
import type { TerminalTabProject } from "./core/terminal-tab-name";
import { clampTerminalFontSize } from "./core/tmux";
import { isToolId, type ToolId } from "./core/tools";
import {
  type AppSettingsState,
  type DiffCardElement,
  type DiffMeta,
  type FileMeta,
  type HljsApi,
  type SettingsResponse,
  type SidebarItem,
  THEME_PALETTES,
  type ThemePalette,
  type UndoActionResponse,
  type ViewState,
} from "./core/types";
import { createAccountsBand } from "./views/agents/accounts-band";
import { createAccountsClient } from "./views/agents/accounts-client";
import { createAccountDialogs } from "./views/agents/accounts-dialogs";
import {
  ACCOUNTS_SECTION_ID,
  createAccountsSettings,
} from "./views/agents/accounts-settings";
import {
  AGENT_HOOKS_SECTION_ID,
  createAgentHooksSettings,
} from "./views/agents/agent-hooks-settings";
import { createAgentMonitor } from "./views/agents/agent-monitor";
import { createAgentPaneOpener } from "./views/agents/agent-pane-opener";
import { mountAgentStatus } from "./views/agents/agent-status";
import {
  type AgentsSidebar,
  mountAgentsSidebar,
} from "./views/agents/agents-sidebar";
import { type AgentsView, createAgentsView } from "./views/agents/agents-view";
import { agentsText } from "./views/agents/i18n";
import { paneText, shellName } from "./views/agents/pane-text";
import { mountUsageStatus } from "./views/agents/usage-status";
import { createAnnotationsPlayer } from "./views/annotations-player";
import {
  ANNOTATION_ENTRY_PARAM,
  ANNOTATION_PANEL_PARAM,
  ANNOTATION_SESSION_PARAM,
  type AnnotationsUi,
  createAnnotationsUi,
} from "./views/annotations-ui";
import { createBackendState } from "./views/backend-state";
import { type BlameViewDeps, createBlameView } from "./views/blame-view";
import { fitBrand } from "./views/brand-fit";
import { type ContextMenuItem, showContextMenu } from "./views/context-menu";
import { createDatabaseView } from "./views/database/database-view";
import { createDefinitionJump } from "./views/definition-jump";
import { createDiffLineSelect } from "./views/diff-line-select";
import { createDiffView, type RenderResult } from "./views/diff-view";
import { DIFF_SCREEN_TEXT, type DiffScreenText } from "./views/diff-view-i18n";
import { createDoctorView, doctorText } from "./views/doctor-view";
import { showEmptyHistoryDiffPane } from "./views/empty-diff-pane";
import {
  removeFileHistoryShell as removeRenderedFileHistoryShell,
  renderFileHistoryShell as renderFileHistoryShellView,
} from "./views/file-history-shell";
import {
  type FileViewTab,
  fileRouteKeepingActiveView,
  isBlobOrBlameFileRoute,
} from "./views/file-shell";
import { createHelpKeybindingEditor } from "./views/help-keybinding-editor";
import { formatKeyBinding } from "./views/help-keybindings";
import {
  createHelpPage,
  helpLanguageFromRoute,
  helpSectionFromRoute,
  openHelpKeybindings,
  openHelpSection,
} from "./views/help-page";
import { createHistoryView, installHistoryPageDom } from "./views/history-view";
import { onListRowKeys } from "./views/list-tab-stop";
import {
  createListTreeOpen,
  localizeListTreeOpen as setListTreeOpenLabel,
} from "./views/list-tree-open";
import { createHunkExpand } from "./views/hunk-expand";
import { createImageTabView, type ImageTabHandle } from "./views/image-tab";
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
import {
  COMFORTABLE_PANE_WIDTH,
  createMainTabsView,
  type FrontChange,
  isPageKind,
  isRouteTab,
  type PanesView,
  routeTarget,
  SPLIT_DIVIDER_WIDTH,
} from "./views/main-tabs/main-tabs-view";
import { pageIconPaths } from "./views/main-tabs/tab-icons";
import { installMobileShell } from "./views/mobile-shell";
import { createProjectActions } from "./views/projects/project-actions";
import {
  mountProjectSwitcher,
  type ProjectSwitcher,
} from "./views/projects/project-switcher";
import { createQuickHelp } from "./views/quick-help";
import { createRefPicker } from "./views/ref-picker";
import { createRepoView } from "./views/repo-view";
import { createRepositoryWebLink } from "./views/repository-web-link";
import {
  type PaletteActionId,
  searchPaletteText,
} from "./views/search-palette-i18n";
import {
  createSearchPalette,
  type PaletteCommand,
} from "./views/search-palette-ui";
import { createSearchResultsView } from "./views/search-results-view";
import { type AppNav, mountAppNav } from "./views/shell/app-nav";
import { rememberEarlyLook } from "./views/shell/early-look";
import { createSidebar, type ViewerFontSize } from "./views/sidebar";
import {
  createSourceView,
  type SourceViewDeps,
  type VirtualSourcePagingKeyboardEvent,
} from "./views/source-view";
import { currentStatusLabel, renderStatusLabel } from "./views/status-label";
import { terminalText } from "./views/terminal/i18n";
import { createTerminalView } from "./views/terminal/terminal-view";
import { toolsText } from "./views/tools/i18n";
import { createToolsView } from "./views/tools/tools-view";
import { showAlertDialog, showConfirmDialog } from "./views/ui-dialog";
import {
  createViewerSettings,
  SETTINGS_CATEGORIES,
  type ViewerSettingsDraft,
  type ViewerSettingsText,
} from "./views/viewer-settings";
import { worktreeText } from "./views/worktree-i18n";
import { createWorktreeView, type WorktreeView } from "./views/worktree-view";

/** 画面の入口の絵柄と、その画面へ移るキー (Worktrees にはキーが無い)。 */
const VIEW_STRIP_KEYS: Record<
  "repo" | "diff" | "history" | "worktree" | "database" | "journal",
  KeymapAction | null
> = {
  repo: "goto-repo",
  diff: "goto-diff",
  history: "goto-history",
  worktree: null,
  database: "goto-database",
  journal: "goto-journal",
};

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

  // 入口のサーバの下で、このプロジェクトの裏のプロセスが止まった (502)・
  // 起きなかった (503)・起動中。どの画面の取得でも同じ応答が来るので、fetch の
  // 包みで拾って中央に 1 つだけ出す。
  const BACKEND_STATE = createBackendState({
    text: () => agentsText(STATE.language).projects,
    reload: () => window.location.reload(),
    reportError: reportPersistenceError,
  });
  const NETWORK_ACTIVITY = createNetworkActivityTracker({
    onChange: updateNetworkActivity,
    // 入口のサーバの下の画面では、前置きとプロジェクトの鍵を足す。
    prepareRequest: projectRequest,
    onResponse: (response) => BACKEND_STATE.inspect(response),
  });
  NETWORK_ACTIVITY.installFetch(window);
  // 入口のサーバの下の画面では、index.html に書いた画面のリンクにも前置きを
  // 付ける。クリックは横取りして pushState するが、中クリック・新しいタブでは
  // 素の href が開くため。
  if (projectKey()) {
    for (const link of document.querySelectorAll<HTMLAnchorElement>(
      'a[href^="/"]',
    )) {
      const href = link.getAttribute("href") ?? "";
      if (!href.startsWith("//") && !href.startsWith("/p/")) {
        link.setAttribute("href", pageUrl(href));
      }
    }
  }

  function updateNetworkActivity(state = NETWORK_ACTIVITY.getState()): void {
    const loadBar = document.querySelector<HTMLElement>("#load-bar");
    if (loadBar) loadBar.classList.toggle("active", state.inFlight > 0);
    const text = uiText().global;
    const statusEl = document.querySelector<HTMLElement>("#status");
    if (statusEl) {
      statusEl.title =
        state.inFlight > 0
          ? text.statusInFlightTitle(state.inFlight, state.cancellable)
          : currentStatusLabel(statusEl);
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
    const source = activeSourceView();
    if (source.moveSourceCursor(direction, unit)) return;
    const target = source.mainScrollTarget();
    const viewportHeight =
      target?.clientHeight ||
      document.scrollingElement?.clientHeight ||
      window.innerHeight;
    const top =
      direction *
      (unit === "line"
        ? Math.round(source.sourceLineScrollAmount() || 32)
        : Math.round(viewportHeight * 0.55));
    const behavior: ScrollBehavior = repeated ? "auto" : "smooth";
    if (target) target.scrollBy({ top, behavior });
    else window.scrollBy({ top, behavior });
  }

  let MAIN_SURFACE_FOCUS_SEQ = 0;

  function focusMainSurface() {
    const source = activeSourceView();
    const target = source.mainScrollTarget();
    // 右の面のソース表示: その面の scroller (無ければ枠) にフォーカスを置く。
    if (source !== SOURCE_VIEW) {
      (target ?? RIGHT_SOURCE?.root)?.focus({ preventScroll: true });
      setPanelFocusScope("main");
      return;
    }
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
    const source = activeSourceView();
    if (source.moveSourceCursor(edge === "bottom" ? 1 : -1, "edge", edge))
      return;
    const target = source.mainScrollTarget();
    if (target) {
      target.scrollTo({
        top: edge === "top" ? 0 : target.scrollHeight,
        behavior: "auto",
      });
      return;
    }
    // 動かせる箱が見つからないとき (中身がまだ無い) も、窓ではなく本文の箱。
    const box = mainScrollBox();
    box?.scrollTo({
      top: edge === "top" ? 0 : box.scrollHeight,
      behavior: "auto",
    });
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

  /** エージェントの未読の数。タブのタイトルの先頭に出す。 */
  let AGENT_UNREAD_COUNT = 0;

  function applyDocumentTitle(): void {
    const base = PROJECT_NAME ? `${PROJECT_NAME} - code viewer` : "code viewer";
    document.title = titleWithUnread(base, AGENT_UNREAD_COUNT);
  }

  function setProjectName(project: string) {
    if (!project) return;
    PROJECT_NAME = project;
    applyDocumentTitle();
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
    el.title = branch ? uiText().diff.currentBranch(branch) : "";
  }

  type SettingsPatch = Partial<Omit<AppSettingsState, "version">> &
    Record<string, unknown>;
  // Mirrors the server-side cap in state-store.ts (normalizeStringList).
  const MAX_RECENT_REFS = 8;
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
      fetch(apiUrl("stateSettings"), {
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
        fetch(apiUrl("stateView"), {
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

  // 未設定ならダーク (既定のテーマ)。light / dark を保存している人はその値。
  function savedTheme(): ThemeMode {
    return APP_SETTINGS.theme === "light" ? "light" : "dark";
  }

  function savedPalette(): ThemePalette {
    return (
      THEME_PALETTES.find((value) => value === APP_SETTINGS.palette) ?? "violet"
    );
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
    const res = await trackLoad(fetch(apiUrl("settings")));
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
      await trackLoad(fetch(apiUrl("agentRules"))),
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
        fetch(apiUrl("agentRules"), {
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
        fetch(apiUrl("agentRules"), {
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
        apiUrl("stateSettings"),
        "settings state request failed",
      ),
      loadStateResponse<ViewState>(
        apiUrl("stateView"),
        "view state request failed",
      ),
    ]);
    APP_SETTINGS = settings;
    VIEW_STATE = view;
  }

  /**
   * 下パネルがあった頃の URL (?tools= / ?results=) を、そのタブの URL
   * (/tools?tool= / /search?q=) に書き換える。URL から route を読む入口
   * (読み込み・戻る進む) の最初に呼ぶ。
   */
  function upgradeLegacyPanelUrl(): void {
    const legacy = legacyPanelRoute(window.location.search, savedRange());
    if (!legacy) return;
    history.replaceState(
      history.state,
      "",
      buildRoute(legacy) + window.location.hash,
    );
  }

  function routeFromLocation(): AppRoute {
    upgradeLegacyPanelUrl();
    const savedLanguage =
      viewerLanguageFromSearch(window.location.search) || savedViewerLanguage();
    const parsedRoute = parseRoute(
      routePathname(),
      window.location.search,
      savedRange(),
    );
    // URL が右の面のファイル (pane=right) なら、本文はフォルダ表示から起こす
    // (本文の面の前面はタブの読み戻しが決め、右の面は INITIAL_RIGHT_ROUTE)。
    if (INITIAL_RIGHT_ROUTE && parsePaneOverlay(window.location.search))
      return {
        screen: "repo",
        ref: INITIAL_RIGHT_ROUTE.ref,
        path: "",
        range: parsedRoute.range,
      };
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
    STATE.sbWidth = savedNumber(
      APP_SETTINGS.sidebarWidth,
      SIDEBAR_WIDTH.default,
      SIDEBAR_WIDTH.min,
      SIDEBAR_WIDTH.max,
    );
    STATE.historyWidth = restoredListWidth(
      APP_SETTINGS.historyWidth,
      HISTORY_WIDTH,
    );
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
    APP_NAV?.sync();
    AGENTS_SIDEBAR?.syncCollapsed();
    localizeViewerChrome();
  }

  /** 開いたときの ?terminal= (起動の途中で URL が書き直される前に読む)。 */
  const INITIAL_TERMINAL_PARAM = parseTerminalOverlay(window.location.search);
  /** 開いたときの ?open-pane= (別のプロジェクトから移ってきた。同じく先に読む)。 */
  const INITIAL_OPEN_PANE = parseOpenPaneOverlay(window.location.search);
  /** 保存したタブの前面を URL の route より優先するか (同じく先に読む)。 */
  const INITIAL_KEEPS_SAVED_FRONT = urlKeepsSavedFront(
    window.location.search,
    performance
      .getEntriesByType("navigation")
      .some(
        (entry) => (entry as PerformanceNavigationTiming).type === "reload",
      ),
  );
  /** 開いたときの pane=right の、右の面のファイルの route (同じく先に読む)。 */
  const INITIAL_RIGHT_ROUTE = ((): Extract<
    AppRoute,
    { screen: "file" }
  > | null => {
    if (parsePaneOverlay(window.location.search) !== "right") return null;
    const route = parseRoute(
      routePathname(),
      window.location.search,
      savedRange(),
    );
    return route.screen === "file" && route.view !== "history" ? route : null;
  })();

  const STATE: AppState = (() => {
    const route = routeFromLocation();
    return {
      layout: savedLayout(),
      theme: savedTheme(),
      language:
        viewerLanguageFromSearch(window.location.search) ||
        savedViewerLanguage(),
      sbView: savedSidebarView(),
      sbWidth: savedNumber(
        APP_SETTINGS.sidebarWidth,
        SIDEBAR_WIDTH.default,
        SIDEBAR_WIDTH.min,
        SIDEBAR_WIDTH.max,
      ),
      historyWidth: restoredListWidth(APP_SETTINGS.historyWidth, HISTORY_WIDTH),
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

  /** 読み戻したタブ (覚えた route が無い) を開くときの route。 */
  function defaultRouteForTab(target: TabTarget): AppRoute {
    const range = currentRange();
    switch (target.kind) {
      case "file":
        return {
          screen: "file",
          path: target.path,
          ref: target.ref ?? "worktree",
          range,
          view: "blob",
          ...(target.line === undefined ? {} : { line: target.line }),
        };
      case "page":
        switch (target.page) {
          case "history":
            return { screen: "history", ref: "HEAD", range };
          case "help":
            return {
              screen: "help",
              range,
              lang: STATE.language,
              section: "settings",
            };
          default:
            return { screen: target.page, range };
        }
      case "terminal":
      case "image":
        // ターミナルと画像は route を持たない (面の箱に描く)。来たら不具合。
        throw new Error(
          `main tabs: ${target.kind} tabs have no route: ${JSON.stringify(target)}`,
        );
    }
  }

  /**
   * 一覧の列を隠している (一覧の画面の帯のボタン)。このセッションだけ (保存
   * しない。右の列の畳みの設定とは別)。配線は syncListColumn。
   */
  let LIST_COLUMN_HIDDEN = false;
  /**
   * 利用者が畳んだ変更ファイルの木を開いた (このセッションは畳まない)。
   * 配線は syncListColumn。
   */
  let LIST_TREE_KEPT_OPEN = false;
  /**
   * 一覧の列のいまの幅 (一覧 + 変更ファイルの木。出していなければ 0)。2 面の
   * 幅の計算が引く。
   */
  let LIST_COLUMN_WIDTH = 0;
  /** 見えている一覧だけの幅 (木を含めない。出していなければ 0)。掴みの開始幅。 */
  let LIST_SHOWN_WIDTH = 0;
  /** 本文が要る幅を保てる一覧の幅 (掴んで広げられる上限)。 */
  let LIST_FITS_WIDTH = HISTORY_WIDTH.max;
  /** 一覧の列に出す一覧の要素 (body[data-list-column] の値ごと)。 */
  const LIST_COLUMN_IDS = {
    sidebar: "sidebar",
    history: "history-panel",
    worktree: "worktree-panel",
  } as const;

  const MAIN_TABS = createMainTabsView({
    mount: (() => {
      const mount = document.getElementById("main-tabs");
      if (!mount) throw new Error("#main-tabs is missing from index.html");
      return mount;
    })(),
    lead: (() => {
      const lead = document.getElementById("tabs-lead");
      if (!lead) throw new Error("#tabs-lead is missing from index.html");
      return lead;
    })(),
    panelColumn: (() => {
      const head = document.getElementById("panel-head");
      if (!head) throw new Error("#panel-head is missing from index.html");
      return head;
    })(),
    listColumnWidth: () => LIST_COLUMN_WIDTH,
    getLanguage: () => STATE.language,
    pageLabel: (page) => uiText().nav[page],
    navigate: (route, replace) => {
      if (replace) replaceWithRoute(route);
      else navigateToRoute(route);
      // 本文を裏で移しただけでフォーカスが右の面に残ったなら、URL は右の面の
      // もの (setRoute の後と同じ)。分割のボタンで右に出した直後に、URL が
      // 左の面のファイルのまま残っていた。
      syncFocusedPaneUrl("replace");
    },
    currentRoute: () => STATE.route,
    defaultRoute: defaultRouteForTab,
    homeRoute: () => ({
      screen: "repo",
      ref: STATE.repoRef || "worktree",
      path: "",
      range: currentRange(),
    }),
    copyPath: (path) => {
      navigator.clipboard
        .writeText(filePathClipboardText(path))
        .catch((error: unknown) => {
          console.error("[code-viewer] copying the tab path failed", error);
          setStatus("error");
        });
    },
    onNewTab: (side, anchor) => void openNewTabMenu(side, anchor),
    stopTerminal: (session) => void stopTerminal(session as ShellSessionId),
    terminalMenuItems: () => TERMINAL_VIEW.menuItems(),
    loadSaved: async () => {
      const saved = await loadStateResponse<{
        layout: unknown;
        common?: unknown;
      }>(apiUrl("stateTabs"), "main tabs request failed");
      // common を返さないのは、この項を知らない版の裏 (共通のタブはまだ無い扱い)。
      return { layout: saved.layout, common: saved.common ?? null };
    },
    save: async (layout, keepalive, common) => {
      const response = await fetch(apiUrl("stateTabs"), {
        method: "PUT",
        keepalive,
        headers: { ...actionHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(common ? { layout, common } : { layout }),
      });
      if (!response.ok)
        throw new Error(await responseErrorMessage(response, "save main tabs"));
    },
    backupSaved: async () => {
      const response = await fetch(apiUrl("stateTabsBackup"), {
        method: "POST",
        headers: actionHeaders(),
      });
      if (!response.ok)
        throw new Error(
          await responseErrorMessage(response, "back up the saved main tabs"),
        );
      const body = (await response.json()) as { backup?: unknown };
      if (typeof body.backup !== "string")
        throw new Error(
          `back up the saved main tabs: the answer has no backup path: ${JSON.stringify(body)}`,
        );
      return body.backup;
    },
    terminalInfo: (session) => terminalTabInfo(session),
    onPanes: (view, how) => showPanes(view, how),
    panelColumnHoldsList,
    onTerminals: (_open, closed) => {
      for (const id of closed) TERMINAL_VIEW.releaseTab(id as ShellSessionId);
    },
  });

  // 言語の当て直し (起動の途中でも呼ばれる) が読むので、ここで宣言する。
  /** 面ごとの画像の部品 (使い回す。setImage で差し替える)。 */
  const IMAGE_VIEWS: Partial<Record<PaneSide, ImageTabHandle>> = {};
  /** 画像のパス → 引いた画像と前後の並び (棚から開いたときは棚の並び)。 */
  const IMAGE_REFS = new Map<
    string,
    { image: TerminalImageRef; images: TerminalImageRef[] }
  >();

  /**
   * 画面へ移る。その画面のタブが開いていれば、そのタブが最後に見ていた
   * 状態へ (画面の入口の絵柄や g d などで、選んでいたコミットや表を失わない)。
   */
  function navigateToPageTab(route: AppRoute): void {
    const target = routeTarget(route);
    const stored =
      target?.kind === "page" ? MAIN_TABS.routeForPage(target.page) : null;
    navigateToRoute(stored ?? route);
  }

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
    lineHistoryTitle: () => uiText().global.lineHistory,
    openLineHistory: (path, start, end) => {
      const route = STATE.route;
      const ref =
        route.screen === "file"
          ? route.commit || route.ref || "worktree"
          : route.screen === "diff" && route.range.to
            ? route.range.to
            : "worktree";
      navigateToRoute({
        screen: "file",
        path,
        ref,
        view: "history",
        lines: { start, end },
        range: currentRange(),
      });
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
    // 右の面のファイルにフォーカスがあれば、札はその面の行を指す。
    const view = MAIN_TABS.panes();
    const right =
      view.focused === "right" && view.fronts.right?.target.kind === "file"
        ? MAIN_TABS.paneRoute("right")
        : null;
    const route = right ?? STATE.route;
    if (route.screen === "diff") return;
    DIFF_LINE_SELECT.clear();
    if (route.screen === "file" && route.line) {
      const start =
        typeof route.line === "number" ? route.line : route.line.start;
      const end = typeof route.line === "number" ? route.line : route.line.end;
      // コードを写すときは選択のある面の行を読む (同じパスを左右で別の ref
      // に開いていても、反対の面を読まない)。
      LINE_REF_PILL.show(route.path, start, end, () =>
        right ? (RIGHT_SOURCE?.root ?? null) : $("#content"),
      );
      return;
    }
    if (right) LINE_REF_PILL.hide();
    else if (route.screen === "file") clearRenderedSourceLineTargets();
  }

  // ---------- Sidebar: extracted to sidebar.ts ----------
  const SIDEBAR = createSidebar({
    $,
    $$,
    STATE,
    openDiffFile: (path) => DIFF_VIEW.openDiffFile(path),
    openFileAs: (file, intent, list) => openFileAs(file, intent, list),
    // Where a plain click on the row takes the app; mirrors the diff sidebar
    // (openDiffFile) and the repository sidebar handler in repo-view.ts.
    sidebarItemHref: (item, mode) => {
      if (mode === "diff")
        return buildRoute({
          screen: "diff",
          range: currentRange(),
          path: item.path,
        });
      const ref = REPO_SIDEBAR_REF || STATE.repoRef || "worktree";
      if (item.type === "tree")
        return buildRoute(
          REPO_VIEW.repoRoute(ref, item.resolved_path ?? item.path),
        );
      return buildRoute(
        fileRouteKeepingActiveView(
          STATE.route,
          { path: item.path, ref },
          currentRange(),
        ),
      );
    },
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
    filterCountTitle: (visible, total) =>
      uiText().sidebar.filterCountTitle(visible, total),
    fileCountText: (count) => uiText().diff.files(count),
    sidebarToggleTitle: panelColumnToggleTitle,
    onUserToggledSidebarHidden,
    toggleListColumn,
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
  // 本文 (左の面) のソース表示の依存。右の面のソース表示はこれを土台に、
  // route・探す範囲・差し込み先・本文だけの操作を差し替える (createSidePane)。
  const SOURCE_VIEW_DEPS: SourceViewDeps = {
    STATE,
    route: () => STATE.route,
    setRoute,
    scope: () => $("#content"),
    mountRoot: () => $("#diff"),
    mainScrollTarget: () => findMainScrollTarget(),
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
    createRevisionNav: createFileRevisionNav,
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
    onSourceRendered: applyInlineAnnotations,
  };
  const SOURCE_VIEW = createSourceView(SOURCE_VIEW_DEPS);
  const {
    applySourceRouteToShell,
    removeStandaloneSource,
    cancelActiveSourceLoad,
    sourceTargetFromRoute,
    fileSourceTarget,
  } = SOURCE_VIEW;

  const DEFINITION_JUMP = createDefinitionJump({
    STATE,
    trackLoad,
    isAbortError,
    appendScopeParams,
    inferLang: SOURCE_VIEW.inferLang,
    getSyntaxHighlight: () => STATE.syntaxHighlight,
    loadSourceShikiHighlighter: (lang) =>
      SOURCE_VIEW.loadSourceShikiHighlighter(lang),
    sourceShikiLines: (textValue, lang, highlighter) =>
      SOURCE_VIEW.sourceShikiLines(textValue, lang, highlighter),
    openMatch: ({ path, ref, line, hl }) => {
      setRoute({
        screen: "file",
        path,
        ref,
        view: "blob",
        line,
        ...(hl ? { hl } : {}),
        range: currentRange(),
      });
      void renderStandaloneSource({ path, ref });
    },
    openSearch: (query) => openSearchPage(query),
  });
  DEFINITION_JUMP.install($("#content"));

  const BLAME_VIEW_DEPS: BlameViewDeps = {
    mountRoot: () => $("#diff"),
    scope: () => $("#content"),
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
    createRevisionNav: createFileRevisionNav,
    removeStandaloneSource,
    placeSidebarToggle,
    escapeHtml,
    repoFileTargetFromRoute,
    renderRepoBlobSidebar: (path: string, ref: string) =>
      REPO_VIEW.renderRepoBlobSidebar(path, ref),
  };
  const BLAME_VIEW = createBlameView(BLAME_VIEW_DEPS);

  // ---------- Repository view: extracted to repo-view.ts ----------
  const REPO_VIEW = createRepoView({
    openTreeFileAs: (path, intent) =>
      openFileAs({ path, type: "blob" }, intent, "repo"),
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
    filesColumnRef: () =>
      document.body.classList.contains("gdp-files-column-page")
        ? STATE.repoRef || "worktree"
        : null,
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
        committed: text.sortCommitted,
        committedHint: text.committedHint,
        updatedHint: text.updatedHint,
        noCommit: text.noCommit,
        filterPlaceholder: text.filterPlaceholder,
        clearFilter: text.clearFilter,
        noMatches: text.noMatches,
        entryCount: text.entryCount,
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
    folderHistoryLabel: () => uiText().repo.folderHistory,
    folderHistoryTitle: () => uiText().repo.folderHistoryTitle,
    openFolderHistory: (ref, path) => {
      const dir = path.replace(/\/+$/, "");
      navigateToRoute({
        screen: "history",
        ref: ref && ref !== "worktree" ? ref : "HEAD",
        ...(dir ? { path: `${dir}/` } : {}),
        range: currentRange(),
      });
    },
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
    openingNewTab: (run) => MAIN_TABS.openingNewTab(run),
    currentRange,
    appendScopeParams,
    isAbortError,
    scrollToFile: (path, line) =>
      DIFF_VIEW.scrollToFile(path, line as SourceLineTarget | undefined),
    openDiffFile: (path) => DIFF_VIEW.openDiffFile(path),
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
    getGrepCaseSensitive: () => APP_SETTINGS.grepCaseSensitive === true,
    getGrepWholeWord: () => APP_SETTINGS.grepWholeWord === true,
    getGrepHideTests: () => STATE.hideTests,
    getGrepGroupByFile: () => APP_SETTINGS.grepGroupByFile === true,
    getGrepPaletteWidth: () => APP_SETTINGS.grepPaletteWidth,
    getGrepPaletteHeight: () => APP_SETTINGS.grepPaletteHeight,
    persistGrepSettings: persistSettingsPatch,
    applyGrepHideTests: (hidden) => {
      STATE.hideTests = hidden;
      applyHideTests();
    },
    openSearchResults: (query) => openSearchPage(query),
    getPaletteCommands: () => paletteCommands(),
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
        | "agents"
        | "tools"
        | "search"
        | "help",
        string
      >;
      global: {
        annotations: string;
        queryHistory: string;
        settings: string;
        theme: string;
        search: string;
        lineHistory: string;
        recentRef: string;
        olderRevision: string;
        newerRevision: string;
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
      diff: DiffScreenText;
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
        filterCountTitle: (visible: number, total: number) => string;
        filterClear: string;
        filterClearTitle: string;
        filterLabel: string;
        hide: string;
        show: string;
        hideList: string;
        showList: string;
        showTree: string;
        autoHiddenForSplit: string;
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
        sortCommitted: string;
        committedHint: string;
        updatedHint: string;
        noCommit: string;
        filterPlaceholder: string;
        clearFilter: string;
        noMatches: string;
        entryCount: (visible: number, total: number) => string;
        sortSize: string;
        repositoryFallback: string;
        repositoryRootFallback: string;
        gitlinkLabel: string;
        gitlinkTitle: string;
        submoduleLabel: string;
        submoduleTitle: string;
        openGithub: string;
        openRepositoryWeb: string;
        folderHistory: string;
        folderHistoryTitle: string;
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
        repo: "Files",
        diff: "Diff",
        history: "History",
        journal: "Work log",
        database: "Data",
        worktree: "Worktrees",
        agents: "Agents",
        tools: "Tools",
        search: "Search",
        help: "Settings & Help",
      },
      global: {
        annotations: "code annotations",
        queryHistory: "query history",
        settings: "viewer settings",
        theme: "toggle theme",
        search:
          "Search projects, agents, sessions and files (Ctrl+K) · Shift+click: grep (Ctrl+G)",
        lineHistory: "Line history",
        recentRef: "Recently used ref",
        olderRevision: "Older revision of this file",
        newerRevision: "Newer revision of this file",
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
      diff: DIFF_SCREEN_TEXT.en,
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
          "Filter files. Plain text matches anywhere in the path; /pattern/ is a regex, ~text is a fuzzy match, *.ts or src/** is a glob. Press / to focus this field, Cmd/Ctrl+K for the full-file palette, Ctrl+G for grep, ? for help.",
        filterCountTitle: (visible, total) =>
          `${visible} of ${total} files match the filter`,
        filterClear: "Clear",
        filterClearTitle: "Clear file filter",
        filterLabel: "Filter files",
        hide: "Hide right column",
        show: "Show right column",
        hideList: "hide the list",
        showList: "show the list",
        showTree:
          "show the changed files (folded to make room for the main area)",
        autoHiddenForSplit:
          "collapsed to make room for the two panes - open it to keep it open",
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
        sortUpdated: "Local modified",
        sortCommitted: "Last committed",
        committedHint:
          "Last commit that changed this path, at HEAD for the worktree or at the selected revision. Folders include changes inside them. Local edits do not change this date.",
        updatedHint:
          "Filesystem modification time. Checkout, copy, and extraction can change this independently of Git history.",
        noCommit: "No commit history",
        filterPlaceholder: "Filter this folder…",
        clearFilter: "Clear filter",
        noMatches: "No files match this filter.",
        entryCount: (visible, total) => `${visible} / ${total} items`,
        sortSize: "Size",
        repositoryFallback: "repository",
        repositoryRootFallback: "repository root",
        gitlinkLabel: "gitlink",
        gitlinkTitle: "Git commit entry is not directly browsable at this ref",
        submoduleLabel: "submodule",
        submoduleTitle: "Git submodule pinned to a commit",
        openGithub: "Open on GitHub",
        openRepositoryWeb: "Open repository web page",
        folderHistory: "History",
        folderHistoryTitle: "Commits that touched this folder",
      },
      history: {
        title: "Commits",
        filter: "Filter commits...",
        filterTitle:
          "Filter commits by message, SHA, author:name, or path:file.",
        refreshTitle: "Refresh commit history",
      },
      journal: {
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
        theme: "Theme",
        themeHelp:
          "Applies right away. The T key switches between light and the dark theme you picked.",
        themeNames: {
          dark: "Dark (violet)",
          graphite: "Dark (graphite)",
          warm: "Dark (warm gray)",
          light: "Light",
        },
        language: "Language",
        fileListFontSize: "UI font size",
        fileListFontSizeHelp: "Applies to all UI except code content.",
        codeFontSize: "Code font size",
        sizeSmall: "Small",
        sizeRegular: "Regular",
        sizeLarge: "Large",
        sizeExtraLarge: "Extra Large",
        displaySource:
          "Theme, language, font sizes, key bindings, notifications and dismissed hints are shared by all projects. Excluded directories and the settings below them apply to this repository only.",
        sharedTag: "All projects",
        sharedTagTitle:
          "Shared by all projects: changing it here changes it everywhere, and it stays the same when you switch projects.",
        userSettingsError: (detail) =>
          `The settings shared by all projects cannot be used, so this repository's settings are shown. Changes to them are not saved until this is fixed:\n${detail}`,
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
        agentNotifyTitle: "Agent notifications",
        agentNotifyWaitingLabel:
          "Notify when an agent starts waiting for input",
        agentNotifyDoneLabel: "Notify when an agent finishes working",
        agentNotifyHelp:
          "Desktop notifications from the Agents screen. The browser asks for permission once, from the Enable notifications button there. Nothing is shown while you are looking at that pane.",
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
        categories: {
          general: {
            label: "General",
            description:
              "Uploads and the directories this repository skips or hides.",
          },
          appearance: {
            label: "Appearance",
            description: "Theme, language, and font sizes.",
          },
          agents: {
            label: "Agents",
            description: "Notifications and hooks.",
          },
          accounts: {
            label: "Accounts",
            description:
              "Sign-in per settings directory, usage, and launch commands.",
          },
          advanced: {
            label: "Advanced",
            description:
              "Datastores, file watching, and terminal status detection.",
          },
        },
        searchPlaceholder: "Search settings",
        searchNoMatch: (query) => `No settings match "${query}".`,
      },
      annotations: {
        title: "Annotations",
        follow: "Follow new notes",
        followTitle: "Jump to new notes as they arrive; paused while editing",
        clear: "clear",
        close: "close",
        sessions: "Sessions",
      },
    },
    ja: {
      nav: {
        repo: "ファイル",
        diff: "差分",
        history: "履歴",
        journal: "ワークログ",
        database: "データストア",
        worktree: "作業ツリー",
        agents: "エージェント",
        tools: "ツール",
        search: "検索",
        help: "設定・ヘルプ",
      },
      global: {
        annotations: "コード注釈",
        queryHistory: "クエリ履歴",
        settings: "ビューア設定",
        theme: "テーマ切り替え",
        search:
          "プロジェクト・エージェント・セッション・ファイルを検索 (Ctrl+K)・Shift+クリックで grep (Ctrl+G)",
        lineHistory: "この行の履歴",
        recentRef: "最近使った ref",
        olderRevision: "このファイルの 1 つ前のリビジョン",
        newerRevision: "このファイルの 1 つ後のリビジョン",
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
      diff: DIFF_SCREEN_TEXT.ja,
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
          "ファイルを絞り込みます。文字列はパスの部分一致、/pattern/ は正規表現、~text はあいまい一致、*.ts や src/** は glob。/ でこの欄にフォーカス、Cmd/Ctrl+K で全ファイルパレット、Ctrl+G で grep、? でヘルプ。",
        filterCountTitle: (visible, total) =>
          `${total} ファイル中 ${visible} 件が一致`,
        filterClear: "解除",
        filterClearTitle: "ファイル絞り込みを解除",
        filterLabel: "ファイル絞り込み",
        hide: "右の列を隠す",
        show: "右の列を表示",
        hideList: "一覧を隠す",
        showList: "一覧を表示",
        showTree: "変更ファイルを表示 (本文の幅のために畳みました)",
        autoHiddenForSplit:
          "2 面のために畳みました。開くと、そのまま開いたままにします",
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
        sortUpdated: "ローカル更新日時",
        sortCommitted: "最終コミット日時",
        committedHint:
          "このパスを最後に変更したコミットの日時。作業ツリーではHEAD、過去の版では選択した版が基準です。フォルダは配下の変更を含みます。未コミットの編集では変わりません。",
        updatedHint:
          "ファイルシステム上の更新日時。チェックアウト・コピー・展開でも変わるため、Git履歴の日時とは異なります。",
        noCommit: "コミット履歴なし",
        filterPlaceholder: "このフォルダ内を絞り込み…",
        clearFilter: "絞り込みを解除",
        noMatches: "一致するファイルがありません。",
        entryCount: (visible, total) => `${visible} / ${total} 件`,
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
        folderHistory: "履歴",
        folderHistoryTitle: "このフォルダを変更したコミット",
      },
      history: {
        title: "コミット",
        filter: "コミットを絞り込み...",
        filterTitle:
          "メッセージ、SHA、author:name、path:file でコミットを絞り込みます。",
        refreshTitle: "コミット履歴を更新",
      },
      journal: {
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
        theme: "テーマ",
        themeHelp:
          "選ぶとすぐに変わります。T キーでライトと、選んだダークを切り替えます。",
        themeNames: {
          dark: "ダーク (紫)",
          graphite: "ダーク (無彩色)",
          warm: "ダーク (暖かい灰色)",
          light: "ライト",
        },
        language: "言語",
        fileListFontSize: "UIの文字サイズ",
        fileListFontSizeHelp: "コード本文を除くUI全体に適用されます。",
        codeFontSize: "コード表示の文字サイズ",
        sizeSmall: "小",
        sizeRegular: "標準",
        sizeLarge: "大",
        sizeExtraLarge: "特大",
        displaySource:
          "テーマ・言語・文字サイズ・キー割り当て・通知・閉じた案内は、全プロジェクト共通です。除外ディレクトリから下の設定は、このリポジトリだけの設定です。",
        sharedTag: "全プロジェクト共通",
        sharedTagTitle:
          "全プロジェクト共通: ここで変えるとどのプロジェクトでも変わり、プロジェクトを移っても同じです。",
        userSettingsError: (detail) =>
          `全プロジェクト共通の設定を使えないため、このリポジトリの設定で表示しています。直るまで、この節の変更は保存されません:\n${detail}`,
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
        agentNotifyTitle: "エージェントの通知",
        agentNotifyWaitingLabel: "エージェントが入力待ちになったら通知する",
        agentNotifyDoneLabel: "エージェントの作業が終わったら通知する",
        agentNotifyHelp:
          "エージェント画面からデスクトップ通知を出します。ブラウザの許可は、その画面の「通知を有効にする」から 1 度だけ求めます。そのペインをいま見ているときは通知しません。",
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
        categories: {
          general: {
            label: "一般",
            description:
              "アップロードと、このリポジトリで読まない・隠すディレクトリ。",
          },
          appearance: {
            label: "表示",
            description: "テーマ、言語、文字の大きさ。",
          },
          agents: {
            label: "エージェント",
            description: "通知とフック。",
          },
          accounts: {
            label: "アカウント",
            description:
              "設定ディレクトリごとのログイン、使用量、起動コマンド。",
          },
          advanced: {
            label: "詳細",
            description: "データストア、ファイルの監視、端末の状態判定。",
          },
        },
        searchPlaceholder: "設定を検索",
        searchNoMatch: (query) => `「${query}」に当てはまる設定はありません。`,
      },
      annotations: {
        title: "注釈",
        follow: "新しい注釈へ自動移動",
        followTitle:
          "新しい注釈が届いたら移動します。編集中は自動移動を停止します。",
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

  // Split / Unified は絵と文字を持ち、帯が狭いと CSS が文字を畳んで絵だけに
  // する (@container topbar)。畳んでも名前が分かるよう title と aria-label にも入れる。
  function setLayoutButtonLabel(
    selector: string,
    paths: string | string[],
    label: string,
  ) {
    const button = document.querySelector<HTMLButtonElement>(selector);
    if (!button) return;
    button.innerHTML = iconSvg("seg-icon", paths);
    const name = document.createElement("span");
    name.className = "seg-label";
    name.textContent = label;
    button.append(name);
    button.title = label;
    button.setAttribute("aria-label", label);
  }

  function setButtonLabel(button: HTMLButtonElement | null, text: string) {
    if (button) button.textContent = text;
  }

  function localizeViewerChrome() {
    const text = uiText();
    document.documentElement.lang = STATE.language;
    // 最下段の接続状態も今の言語で書き直す (状態は #status の class にある)。
    const status = $("#status").classList;
    setStatus(
      (["live", "refreshing", "error"] as const).find((s) =>
        status.contains(s),
      ) ?? null,
    );
    // 画面の入口 (木の見出しの絵柄の列)。絵だけなので、名前とキーは
    // title / aria-label に出す。
    const bindings = activeKeyBindings();
    document
      .querySelectorAll<HTMLElement>(".view-strip-item")
      .forEach((link) => {
        const route = link.dataset.route as keyof typeof VIEW_STRIP_KEYS;
        const name = text.nav[route];
        if (!name) throw new Error(`view strip: no label for route ${route}`);
        const action = VIEW_STRIP_KEYS[route];
        const binding = action
          ? bindings.find((item) => item.action === action)
          : undefined;
        const label = binding ? `${name} (${formatKeyBinding(binding)})` : name;
        link.title = label;
        link.setAttribute("aria-label", label);
        const icon = link.querySelector<HTMLElement>(".goi-icon");
        if (icon && !icon.firstElementChild)
          icon.innerHTML = iconSvg("view-strip-icon", pageIconPaths(route));
      });
    MAIN_TABS.localize();
    for (const view of Object.values(IMAGE_VIEWS))
      view?.setLanguage(STATE.language);
    // The repo link is icon-only; the label lives in title/aria-label
    // instead of visible text.
    const repoWebLink =
      document.querySelector<HTMLAnchorElement>("#repo-web-link");
    if (repoWebLink) {
      repoWebLink.title = text.global.repoWebLink;
      repoWebLink.setAttribute("aria-label", text.global.repoWebLink);
    }
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
    const searchBtn = document.querySelector<HTMLButtonElement>("#search-btn");
    if (searchBtn) {
      searchBtn.title = text.global.search;
      searchBtn.setAttribute("aria-label", text.global.search);
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
    document
      .querySelector<HTMLElement>("#tools-sheet")
      ?.setAttribute("aria-label", toolsText(STATE.language).title);
    relocalizeTools?.();
    relocalizeTerminal?.();
    relocalizeSearchResults?.();
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
    setLayoutButtonLabel(
      '#topbar .seg button[data-layout="line-by-line"]',
      DIFF_UNIFIED_16_PATHS,
      text.topbar.unified,
    );
    setLayoutButtonLabel(
      '#topbar .seg button[data-layout="side-by-side"]',
      DIFF_SPLIT_16_PATH,
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
      filter.setAttribute("aria-label", text.sidebar.filterLabel);
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
      const sidebarToggleTitle = panelColumnToggleTitle(STATE.sidebarHidden);
      sidebarToggle.title = sidebarToggleTitle;
      sidebarToggle.setAttribute("aria-label", sidebarToggleTitle);
      localizeListTreeOpen();
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
    relocalizeAgents?.();
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
    ANNOTATIONS_UI?.localize();

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
  let relocalizeAgents: (() => void) | null = null;
  let relocalizeTools: (() => void) | null = null;
  let relocalizeViewerSettings: (() => void) | null = null;
  let relocalizeTerminal: (() => void) | null = null;
  let relocalizeSearchResults: (() => void) | null = null;
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
    // 開いている Diff の帯とカードは描いたときの言語のまま残るので描き直す。
    applyHideTestsToMeta();
    DIFF_VIEW.relocalize();
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
    if (labelEl)
      renderStatusLabel(
        labelEl,
        [
          text.global.statusLive,
          text.global.statusLoading,
          text.global.statusError,
          text.global.statusIdle,
        ],
        label,
      );
    el.setAttribute("aria-label", label);
    updateNetworkActivity();
  }

  function applyTheme() {
    document.documentElement.dataset.theme = STATE.theme;
    // 既定の紫は属性なし。色違いはダークのときだけ効く (style.css 先頭)。
    const palette = savedPalette();
    if (palette === "violet") delete document.documentElement.dataset.palette;
    else document.documentElement.dataset.palette = palette;
    rememberEarlyLook({
      theme: STATE.theme,
      palette: palette === "violet" ? undefined : palette,
    });
    $<HTMLLinkElement>("#hljs-light").disabled = STATE.theme === "dark";
    $<HTMLLinkElement>("#hljs-dark").disabled = STATE.theme !== "dark";
    // インストールした窓の枠の色も今の地に (core/pwa.ts)。
    syncThemeColor(document);
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
    }).catch((error: unknown) => {
      // 次に使うときに読み直す。ボタンは失敗の見た目、理由はここに残す。
      console.error("[code-viewer] highlight.js could not be loaded", error);
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
    navigator.clipboard
      .writeText(filePathClipboardText(path))
      .catch((error: unknown) => {
        console.error(
          errorWithCause("copying the selected file path failed", error),
        );
        setStatus("error");
      });
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
      agentNotifyWaiting: true,
      agentNotifyDone: true,
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
      agentNotifyWaiting: draft.agentNotifyWaiting,
      agentNotifyDone: draft.agentNotifyDone,
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
        agentNotifyWaiting: null,
        agentNotifyDone: null,
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
      if (changed.has("agentNotifyWaiting"))
        appPatch.agentNotifyWaiting = normalized.agentNotifyWaiting;
      if (changed.has("agentNotifyDone"))
        appPatch.agentNotifyDone = normalized.agentNotifyDone;
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
  // `g h` opens the log of what the user is looking at: the ref of the
  // repository / file page, the "to" side of a diff, else HEAD.
  function historyRefForCurrentView(): string {
    const route = STATE.route;
    if (route.screen === "history") return route.ref || "HEAD";
    if (route.screen === "repo" || route.screen === "file") {
      return route.ref && route.ref !== "worktree" ? route.ref : "HEAD";
    }
    if (route.screen === "diff") {
      const to = route.range.to;
      return to && to !== "worktree" ? to : "HEAD";
    }
    return "HEAD";
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
        mountRoot: () => $("#diff"),
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
        createRevisionNav: createFileRevisionNav,
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
  let AGENTS_VIEW: AgentsView | null = null;
  let APP_NAV: AppNav | null = null;
  let AGENTS_SIDEBAR: AgentsSidebar | null = null;
  let PROJECT_SWITCHER: ProjectSwitcher | null = null;

  function applyInlineAnnotations() {
    ANNOTATIONS_UI?.applyInlineAnnotations();
  }

  function withAnnotationSessionParam(rawUrl: string): string {
    if (ANNOTATIONS_UI) return ANNOTATIONS_UI.withSessionParam(rawUrl);
    // Repository startup can canonicalize the route before the panel mounts.
    // Keep its incoming selection until the annotation UI can own the URL.
    const url = new URL(rawUrl, window.location.origin);
    const initial = new URLSearchParams(window.location.search);
    for (const key of [
      ANNOTATION_PANEL_PARAM,
      ANNOTATION_SESSION_PARAM,
      ANNOTATION_ENTRY_PARAM,
    ]) {
      const value = initial.get(key);
      if (value !== null) url.searchParams.set(key, value);
    }
    return url.pathname + url.search;
  }

  // buildRoute は AppRoute しか知らないので、そこに乗らないオーバーレイの状態
  // (doctor) は現在の URL から明示的に引き継ぐ。落とすと画面を移動した瞬間に
  // シートの状態が URL から消える。history に積む URL とヘッダメニューの href の
  // 両方がこれを通る必要がある。?terminal= は引き継がない: 前面のタブが
  // ターミナルでない画面へ移るので、映しているシェルは無い (ターミナルのタブが
  // 前面になるときは showPanes がそのシェルを積む)。Tools と Search はタブ
  // (route の画面) なので、ここでは運ばない。
  function withOverlayState(url: string): string {
    return withDoctorOverlay(
      url,
      parseDoctorOverlay(routePathname(), window.location.search),
    );
  }

  function urlForRoute(route: AppRoute): string {
    return withOverlayState(withAnnotationSessionParam(buildRoute(route)));
  }

  // ---- 戻る/進むのスクロール位置 ----
  // 本文は窓ではなく自分の箱 (#content) で動くので、ブラウザは位置を戻さない。
  // 履歴の項ごとの鍵で覚えて、戻ったときにその位置へ戻す (core/scroll-memory)。
  const SCROLL_MEMORY = createScrollMemory();
  let SCROLL_KEY_SEQ = 0;

  function currentScrollKey(): string | null {
    return scrollKeyOfHistoryState(history.state);
  }

  /**
   * いまの履歴の項の鍵。無ければその場で付ける (最初に開いた項・外から来た項は
   * この仕組みを通っていないので鍵を持たない)。
   */
  function ensureScrollKey(): string {
    const existing = currentScrollKey();
    if (existing) return existing;
    const key = `h${++SCROLL_KEY_SEQ}`;
    const state = history.state;
    history.replaceState(
      { ...(typeof state === "object" && state ? state : {}), scrollKey: key },
      "",
    );
    return key;
  }

  /** いま見ている位置を、いまの履歴の項に覚える。 */
  function rememberMainScroll(): void {
    const box = mainScrollBox();
    if (box) SCROLL_MEMORY.remember(ensureScrollKey(), box.scrollTop);
  }

  /**
   * 履歴に積む state。`keep` は同じ項を書き換えるとき (replaceState) で、
   * 覚えた位置を捨てないように鍵をそのまま使う。
   */
  function historyStateForRoute(route: AppRoute, keep = false): unknown {
    const base =
      route.screen === "file"
        ? {
            screen: "file",
            path: route.path,
            ref: route.ref,
            view: route.view || "detail",
          }
        : { view: route.screen };
    const key = (keep ? currentScrollKey() : null) || `h${++SCROLL_KEY_SEQ}`;
    // 新しい項へ移る前に、いま見ていた位置を覚えておく。
    if (!keep) rememberMainScroll();
    return { ...base, scrollKey: key };
  }

  /** 本文の箱を先頭へ (新しい画面は先頭から見せる)。 */
  function scrollMainToTop(): void {
    const box = mainScrollBox();
    if (box) box.scrollTop = 0;
  }

  /**
   * 戻る/進むで来た項の位置へ戻す。中身は後から描き終わるので、箱がその高さに
   * なるまで何度か試し、途中で別の画面へ移ったらやめる。
   */
  let SCROLL_RESTORE_SEQ = 0;
  /** 中身が描き終わるまでの間、位置を当て直す時点 (ミリ秒)。 */
  const SCROLL_RESTORE_DELAYS = [0, 120, 400, 900, 1500];
  function restoreMainScroll(): void {
    const key = currentScrollKey();
    const top = SCROLL_MEMORY.recall(key);
    const seq = ++SCROLL_RESTORE_SEQ;
    // 中身は後から届くので (差分のカードは遅れて描かれ、その分だけ上が伸びる)、
    // 描き終わるまで何度か当て直す。利用者が自分で動かしたらそこでやめる。
    const stop = new AbortController();
    for (const event of ["wheel", "pointerdown", "keydown"] as const) {
      window.addEventListener(event, () => stop.abort(), {
        once: true,
        passive: true,
        signal: stop.signal,
      });
    }
    const apply = () => {
      if (seq !== SCROLL_RESTORE_SEQ || stop.signal.aborted) return;
      const box = mainScrollBox();
      if (box) box.scrollTop = top;
    };
    apply();
    requestAnimationFrame(apply);
    for (const delay of SCROLL_RESTORE_DELAYS) {
      setTimeout(() => {
        apply();
        if (delay === SCROLL_RESTORE_DELAYS[SCROLL_RESTORE_DELAYS.length - 1])
          stop.abort();
      }, delay);
    }
  }

  function replaceUrlWithCurrentRoute(): void {
    const url = urlForRoute(STATE.route);
    const current = window.location.pathname + window.location.search;
    if (url !== current) {
      history.replaceState(
        historyStateForRoute(STATE.route, true),
        "",
        url + window.location.hash,
      );
    }
  }

  // blob / blame ビューの SSE 再描画ゲート。変更通知は tick やディレクトリ丸めで
  // パス精度を失うため、通知だけを根拠に再描画すると、見ているファイルと無関係な
  // 更新 (ログファイル等) でも画面が「読み込み中」に置き換わる。HEAD /_file の
  // メタデータ署名を表示時に控えておき、署名が動いたときだけ再描画する。
  let fileRouteSignature: { key: string; sig: string } | null = null;
  let fileRouteSignatureSeed: Promise<void> | null = null;
  let fileRouteSignatureCheck: Promise<void> | null = null;

  function fileRouteSignatureKey(
    route: Extract<AppRoute, { screen: "file" }>,
  ): string {
    return `${route.view || "blob"}\0${route.path}\0${route.ref || "worktree"}`;
  }

  async function readFileRouteSignature(
    route: Extract<AppRoute, { screen: "file" }>,
  ): Promise<string | null> {
    const info = await REPO_VIEW.loadRawFileInfo({
      path: route.path,
      ref: route.ref || "worktree",
    });
    return rawFileInfoSignature(info);
  }

  function seedFileRouteSignature(
    route: Extract<AppRoute, { screen: "file" }>,
  ): void {
    const key = fileRouteSignatureKey(route);
    const seed = trackLoad(readFileRouteSignature(route)).then((sig) => {
      if (fileRouteSignatureSeed === seed) fileRouteSignatureSeed = null;
      if (sig === null) return;
      fileRouteSignature = { key, sig };
    });
    fileRouteSignatureSeed = seed;
  }

  function refreshFileRouteIfChanged(
    route: Extract<AppRoute, { screen: "file" }>,
  ): void {
    if (fileRouteSignatureCheck) return;
    const key = fileRouteSignatureKey(route);
    // 表示直後の seed がまだ飛行中なら先に待つ。待たないと「基準が無い」だけで
    // 変化ありと誤判定し、開いた直後の無関係な通知で画面を作り直してしまう。
    const pendingSeed = fileRouteSignatureSeed ?? Promise.resolve();
    fileRouteSignatureCheck = pendingSeed
      .then(() => trackLoad(readFileRouteSignature(route)))
      .then((sig) => {
        fileRouteSignatureCheck = null;
        // 署名が取れない (HEAD 失敗 / 中断) のは判定不能であって変化ではない。
        // 画面には触れず、次の変更通知で再検証する。
        if (sig === null) return;
        const routeNow = STATE.route;
        if (
          routeNow.screen !== "file" ||
          !isBlobOrBlameFileRoute(routeNow) ||
          fileRouteSignatureKey(routeNow) !== key
        )
          return;
        if (fileSignatureUnchanged(fileRouteSignature, key, sig)) return;
        fileRouteSignature = { key, sig };
        dispatchFileRoute(routeNow, { refresh: true });
      });
    // 中断 (cancelInFlightRequests) は再描画しない。次の通知で再検証する。
    fileRouteSignatureCheck.catch((error: unknown) => {
      fileRouteSignatureCheck = null;
      if (!isAbortError(error))
        console.error(
          `[code-viewer] could not check whether ${key} changed`,
          error,
        );
    });
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
      seedFileRouteSignature(route);
      return true;
    }
    if (route.view === "blame") {
      setStatus("live");
      cancelActiveSourceLoad("navigation");
      removeFileHistoryShell();
      void BLAME_VIEW.renderBlamePage({ path: route.path, ref: route.ref });
      seedFileRouteSignature(route);
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

  /**
   * 自分の箱を本文の面に置く画面を離れるなら、その画面の後片付け (箱を外し、
   * 隠した #diff を戻す)。setRoute と URL からの移動の両方がここを通る。
   */
  function leaveScreen(previous: AppRoute, next: AppRoute): void {
    const leaving = screenToLeave(previous, next);
    switch (leaving) {
      case "database":
        DATABASE_VIEW.suspend();
        return;
      case "journal":
        JOURNAL_VIEW?.suspend();
        return;
      case "worktree":
        WORKTREE_VIEW?.suspend();
        return;
      case "agents":
        AGENTS_VIEW?.suspend();
        return;
      case "tools":
      case "search":
        leaveToolOrSearchPage(leaving);
        return;
      case null:
        return;
    }
  }

  function setRoute(route: AppRoute, replace = false) {
    // 右の面にフォーカスがあるときの木・パレット・リンクで開くファイルは、
    // 右の面で開く (本文は描き直さない)。履歴を置き換えるだけの呼び出し
    // (本文の行の選択など) は本文のもの。
    if (!replace && route.screen === "file") {
      const fileRoute = normalizeInternalFileRoute(route);
      if (
        fileRoute.screen === "file" &&
        fileRoute.view !== "history" &&
        routeTarget(fileRoute)?.kind === "file" &&
        MAIN_TABS.panes().split &&
        MAIN_TABS.sideForRoute(fileRoute) === "right" &&
        openInRightPane(fileRoute)
      )
        return;
    }
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
    leaveScreen(previousRoute, nextRoute);
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
    const state = historyStateForRoute(nextRoute, replace);
    if (replace) history.replaceState(state, "", url);
    else history.pushState(state, "", url);
    MAIN_TABS.syncRoute(nextRoute, !replace);
    // 右の面にフォーカスが残っている (本文を裏で移した) なら URL は右の面のもの。
    syncFocusedPaneUrl("replace");
    syncHeaderMenu();
    syncLineRefPill();
    // Picking another commit (or clearing the file) on the history screen
    // closes the source view its diff cards had opened; the cards come back.
    if (
      previousRoute.screen === "history" &&
      previousRoute.source &&
      !(nextRoute.screen === "history" && nextRoute.source)
    ) {
      setPageMode();
      removeStandaloneSource();
    }
    if (
      isSameBlobFileRoute(previousRoute, nextRoute) &&
      routeBlobPreview(previousRoute) !== routeBlobPreview(nextRoute)
    ) {
      SOURCE_VIEW.switchSourceTab(
        routeBlobPreview(nextRoute) ? "preview" : "code",
        { updateRoute: false },
      );
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
    if (nextRoute.screen === "agents") {
      cancelActiveSourceLoad("navigation");
      setPageMode();
      removeStandaloneSource();
      void AGENTS_VIEW?.enter();
    }
    enterToolOrSearchPage();
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

  /** 右の列に Files の木を出す (読み込み済みなら使い回す)。失敗は状態と console に出す。 */
  function showFilesTreeInLeftColumn(): void {
    const ref = STATE.repoRef || "worktree";
    REPO_VIEW.renderRepoBlobSidebar("", ref).catch((error: unknown) => {
      console.error(
        `[code-viewer] the Files tree (${ref}) for the left column could not be loaded`,
        error,
      );
      setStatus("error");
    });
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
    // The source view a diff-hosting page keeps open in place ("View File"
    // on the history screen) gets the file-detail chrome too: the topbar
    // and the diff cards go away while the panels of the page stay.
    const hostedSourceOpen =
      STATE.route.screen === "history" &&
      !!STATE.route.source &&
      SOURCE_VIEW.sourceTargetFromRoute() !== null;
    document.body.classList.toggle(
      "gdp-file-detail-page",
      STATE.route.screen === "file" || hostedSourceOpen,
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
    document.body.classList.toggle(
      "gdp-agents-page",
      STATE.route.screen === "agents",
    );
    document.body.classList.toggle(
      "gdp-tools-page",
      STATE.route.screen === "tools",
    );
    document.body.classList.toggle(
      "gdp-search-page",
      STATE.route.screen === "search",
    );
    // 右の列: 自分の一覧を持たない画面は Files の木を出す (History・選んでいる
    // Worktrees は一覧パネル、repo / file / diff は #sidebar の自分の一覧)。
    const filesColumnRoute =
      STATE.route.screen === "journal" ||
      STATE.route.screen === "agents" ||
      STATE.route.screen === "tools" ||
      STATE.route.screen === "search" ||
      STATE.route.screen === "help" ||
      STATE.route.screen === "database" ||
      (STATE.route.screen === "worktree" && !STATE.route.wt);
    document.body.classList.toggle("gdp-files-column-page", filesColumnRoute);
    if (filesColumnRoute) showFilesTreeInLeftColumn();
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

  /**
   * 画面を移るリンク (中央上のタブ・左のサイドバーの全体ボードと設定・
   * アイコンのリンク)。選択の印と、ページを読み直さない移動の対象。
   */
  const ROUTE_LINK_SELECTOR =
    "a.app-menu-item, a.global-icon-link, a.nav-board-link, a.nav-foot-item";

  /**
   * いまの画面の入口 (.active を付ける。見た目の印は付けず、プロジェクトを
   * 移るときの移り先 currentScreenPath などが読む)。フォーカスのある面の選択
   * タブで決める: page はその入口、file は Files、ターミナルは無し。タブが
   * まだ無い (本文の既定を出している) ときは route から決める。
   */
  function headerRouteForFront(): string | null {
    const front = MAIN_TABS.front();
    if (front?.target.kind === "page") return front.target.page;
    if (front?.target.kind === "file") return "repo";
    if (front) return null;
    if (STATE.route.screen !== "file") return STATE.route.screen;
    return STATE.route.view === "blob" ||
      STATE.route.view === "blame" ||
      STATE.route.view === "history"
      ? "repo"
      : "diff";
  }

  function syncHeaderMenu() {
    document
      .querySelectorAll<HTMLAnchorElement>(ROUTE_LINK_SELECTOR)
      .forEach((link) => {
        const active = link.dataset.route === headerRouteForFront();
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
        if (link.dataset.route === "agents") {
          link.href = withOverlayState(
            buildRoute({ screen: "agents", range: currentRange() }),
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
              // 左下の「設定」は、いつも設定の節を開く入口。
              section:
                link.id === "nav-settings"
                  ? "settings"
                  : helpSectionFromRoute(STATE.route),
              range: currentRange(),
            }),
          );
        }
      });
  }

  /**
   * OS のファイルマネージャでそのパスを開く。
   *
   * **成否を返す。** ボタンを渡さない呼び出し (メニューの項目など) では、
   * ここで握り潰すと利用者に何も伝わらない — 成功しても失敗しても画面が
   * 無反応になる。失敗の理由はコンソールにも残す。
   */
  /**
   * そのパス (か親のフォルダ) を OS で開く。失敗は理由を cause に付けて投げる
   * (以前は握りつぶして false を返していた)。見た目で伝えるのは呼び出し側。
   */
  async function openPathInOs(
    path: string,
    kind: "directory" | "file-parent",
  ): Promise<void> {
    let res: Response;
    try {
      res = await fetch(apiUrl("openPath"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Code-Viewer-Action": "1",
        },
        body: JSON.stringify({ path, kind }),
      });
    } catch (error) {
      throw errorWithCause(`failed to open ${path} in the OS`, error);
    }
    if (!res.ok)
      throw new Error(
        await responseErrorMessage(res, `failed to open ${path} in the OS`),
      );
  }

  /** ボタンから OS で開く。成否はボタンの色と title で伝え、理由はコンソールへ。 */
  async function openPathFromButton(
    path: string,
    kind: "directory" | "file-parent",
    button: HTMLButtonElement,
  ): Promise<void> {
    const oldTitle = button.title;
    button.disabled = true;
    button.classList.remove("failed");
    try {
      await openPathInOs(path, kind);
      button.classList.add("opened");
      setTimeout(() => {
        button.classList.remove("opened");
      }, 1200);
    } catch (error) {
      console.error("[code-viewer] failed to open path in OS", error);
      button.classList.add("failed");
      button.title = uiText().diff.openInOsFailed;
      setTimeout(() => {
        button.classList.remove("failed");
        button.title = oldTitle || uiText().diff.openInOs;
      }, 1600);
    } finally {
      button.disabled = false;
    }
  }

  async function runUndoAction(action: UndoActionResponse) {
    if (action.type !== "trash") return false;
    const res = await fetch(apiUrl("restoreTrash"), {
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
    title = uiText().sidebar.openDirectoryInOs,
  ): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "gdp-file-header-icon gdp-open-path";
    button.title = title;
    button.setAttribute("aria-label", title);
    button.innerHTML = iconSvg("octicon-link-external", OPEN_EXTERNAL_16_PATH);
    button.addEventListener("click", (e) => {
      e.stopPropagation();
      void openPathFromButton(path, kind, button);
    });
    return button;
  }

  // Older / newer revision stepper on a file page. The neighbours come from
  // /_file_revisions; until they arrive (or when there is none) the button
  // is disabled, so the header never reflows.
  function createFileRevisionNav(
    target: SourceFileTarget,
    activeTab: FileViewTab,
  ): HTMLElement | null {
    if (activeTab === "history") return null;
    const nav = document.createElement("span");
    nav.className = "gdp-file-revision-nav";
    const text = uiText().global;
    const make = (title: string, paths: string[]): HTMLButtonElement => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "gdp-file-header-icon gdp-file-revision-btn";
      button.title = title;
      button.setAttribute("aria-label", title);
      button.disabled = true;
      button.innerHTML = iconSvg("octicon-revision", paths);
      return button;
    };
    const older = make(text.olderRevision, PREVIOUS_16_PATHS);
    const newer = make(text.newerRevision, NEXT_16_PATHS);
    nav.append(older, newer);
    const goTo = (sha: string) => {
      const view =
        STATE.route.screen === "file" && STATE.route.view === "blame"
          ? "blame"
          : "blob";
      navigateToRoute({
        screen: "file",
        path: target.path,
        ref: sha,
        view,
        range: currentRange(),
      });
    };
    const params = new URLSearchParams({
      path: target.path,
      ref: target.ref || "worktree",
    });
    void trackLoad<FileRevisionNeighbors>(
      fetch(`${apiUrl("fileRevisions")}?${params.toString()}`).then(
        async (r) => {
          if (!r.ok) throw new Error(await r.text());
          return r.json();
        },
      ),
    )
      .then((neighbors) => {
        if (!nav.isConnected) return;
        if (neighbors.previous) {
          const sha = neighbors.previous;
          older.disabled = false;
          older.addEventListener("click", () => goTo(sha));
        }
        if (neighbors.next) {
          const sha = neighbors.next;
          newer.disabled = false;
          newer.addEventListener("click", () => goTo(sha));
        }
      })
      .catch((err: unknown) => {
        if (isAbortError(err)) return;
        console.error("Failed to load file revision neighbours", err);
      });
    return nav;
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

  // ---------- Agent integration (hooks): agent-hooks-settings.ts ----------
  // 設定画面の節と、エージェント一覧の案内が同じ状態を見る。取り直すのは
  // 設定画面の節と一覧に入ったときだけ (周期では取らない)。
  let AGENT_HOOK_STATUS: AgentHooksResponse | null = null;
  const AGENT_HOOKS_SETTINGS = createAgentHooksSettings({
    getText: () => agentsText(STATE.language).hooks,
    trackLoad,
    actionHeaders,
    onChanged: (status) => {
      AGENT_HOOK_STATUS = status;
      AGENTS_VIEW?.localize();
    },
  });

  // ---------- Accounts: views/agents/accounts-*.ts ----------
  // エージェント一覧の帯と設定画面の節が同じ結果を見る。取り直すのは、
  // どちらかが画面にある間だけ (retain)。
  const ACCOUNTS_CLIENT = createAccountsClient({ trackLoad, actionHeaders });
  const ACCOUNT_DIALOGS = createAccountDialogs({
    client: ACCOUNTS_CLIENT,
    getText: () => agentsText(STATE.language).accounts,
    // 一覧の監視役と画面の関数は後で作られる。押されたときにだけ呼ぶ。
    openPane: (pane) => openAgentPane(pane),
    getOverview: () => AGENT_MONITOR.snapshot().overview,
    serverRoot: () => ACCOUNTS_CLIENT.snapshot().data?.serverRoot ?? "",
    refreshOverview: () => AGENT_MONITOR.refresh(),
  });
  const ACCOUNTS_SETTINGS = createAccountsSettings({
    client: ACCOUNTS_CLIENT,
    dialogs: ACCOUNT_DIALOGS,
    getText: () => agentsText(STATE.language).accounts,
  });

  // ---------- Viewer settings: extracted to viewer-settings.ts ----------
  // 以前はヘッダの歯車から出るポップオーバーだった。今は Help ページの
  // 設定セクションが唯一の置き場で、ここは値の出し入れだけを受け持つ。
  const VIEWER_SETTINGS = createViewerSettings({
    getText: () => uiText().settings,
    getTheme: () => {
      if (STATE.theme === "light") return "light";
      const palette = savedPalette();
      return palette === "violet" ? "dark" : palette;
    },
    setTheme: (choice) => {
      STATE.theme = choice === "light" ? "light" : "dark";
      // ライトを選んでも、ダークの色違いの選択は残す (T で戻ったときに使う)。
      const palette: ThemePalette | undefined =
        choice === "light" ? undefined : choice === "dark" ? "violet" : choice;
      patchSettings(
        palette ? { theme: STATE.theme, palette } : { theme: STATE.theme },
      );
      applyTheme();
    },
    getValues: () => ({
      userSettingsError: APP_SETTINGS.userSettingsError ?? "",
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
      agentNotifyWaiting: APP_SETTINGS.agentNotifyWaiting !== false,
      agentNotifyDone: APP_SETTINGS.agentNotifyDone !== false,
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
        AGENT_HOOKS_SETTINGS.refresh(),
        ACCOUNTS_SETTINGS.refresh(),
      ]);
    },
    onSave: saveViewerSettings,
    onAgentRulesSave: saveAgentScreenRules,
    onAgentRulesReset: resetAgentScreenRuleSettings,
    agentHooksSection: AGENT_HOOKS_SETTINGS.element,
    agentAccountsSection: ACCOUNTS_SETTINGS.element,
  });
  relocalizeViewerSettings = () => {
    VIEWER_SETTINGS.localize();
    AGENT_HOOKS_SETTINGS.localize();
    ACCOUNTS_SETTINGS.localize();
  };

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
    mountSettingsSearch: (host) => VIEWER_SETTINGS.mountSearch(host),
    settingsCategories: () => {
      const labels = uiText().settings.categories;
      return SETTINGS_CATEGORIES.map((id) => ({ id, ...labels[id] }));
    },
    getSettingsCategory: () => VIEWER_SETTINGS.getCategory(),
    setSettingsCategory: (category) => VIEWER_SETTINGS.setCategory(category),
    getKeyBindings: activeKeyBindings,
    decorateKeybindings: (article, groups) =>
      KEYBINDING_EDITOR.decorate(article, groups),
    // インストールの案内 (PWA)。ブラウザが出す 1 度きりの event を今から受けておく。
    installOffer: createInstallOffer(window),
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
    const navIcons: [string, string, string | string[]][] = [
      ["#nav-collapse", "octicon-sidebar-collapse", SIDEBAR_HIDE_16_PATHS],
      ["#nav-expand", "octicon-sidebar-expand", SIDEBAR_SHOW_16_PATHS],
      ["#nav-board-link", "octicon-apps", APPS_16_PATH],
      ["#nav-launch", "octicon-plus", PLUS_16_PATH],
      ["#nav-settings", "octicon-gear", GEAR_16_PATH],
    ];
    for (const [selector, className, paths] of navIcons) {
      const icon = document.querySelector<HTMLElement>(`${selector} .goi-icon`);
      if (icon) icon.innerHTML = iconSvg(className, paths);
    }
    const searchIcon = document.querySelector<HTMLElement>(
      "#search-btn .goi-icon",
    );
    if (searchIcon) {
      searchIcon.innerHTML = iconSvg("octicon-search", SEARCH_16_PATH);
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
  let copyAiContextFeedbackTimer: ReturnType<typeof setTimeout> | null = null;
  $("#copy-ai-context")?.addEventListener("click", async (event) => {
    const button = event.currentTarget as HTMLButtonElement;
    const feedback = document.querySelector<HTMLElement>(
      "#copy-ai-context-feedback",
    );
    const selectionTarget = resolveSelectionTarget(STATE.route);
    let selectionCode: { lines: string[]; lang?: string | null } | undefined;
    if (event.shiftKey && selectionTarget) {
      // STATE.route は左の本文の route なので、左の本文から読む。
      const content = $("#content");
      const renderedLines = content
        ? readRenderedLines(
            selectionTarget.path,
            selectionTarget.start,
            selectionTarget.end,
            content,
          )
        : [];
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
      reason?: "empty" | Error,
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
      button.title =
        reason instanceof Error
          ? `${label}\n${formatErrorDetail(reason)}`
          : label;
      button.setAttribute("aria-label", button.title);
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
    } catch (error) {
      const failure = errorWithCause("copying the AI context failed", error);
      console.error(failure);
      finish(false, false, 0, failure);
    }
  });
  localizeViewerChrome();
  prepareKeyboardPanels();
  // Diff の変更ファイル (History の変更ファイルの木も) の行の上のキー。↑↓・
  // Home / End は j k・gg / G と同じキー割り当てを呼び、Enter は 1 回押したのと
  // 同じ (行の click)。作業ツリーの変更ファイルは worktree-view.ts が受ける。
  const diffFileList = document.getElementById("filelist");
  if (!diffFileList) throw new Error("#filelist is missing from index.html");
  onListRowKeys(
    diffFileList,
    "#filelist[data-diff-list] li[data-path], #filelist[data-diff-list] li[data-dirpath]",
    {
      ArrowDown: (row) => moveDiffListFrom(row, "sidebar-next"),
      ArrowUp: (row) => moveDiffListFrom(row, "sidebar-previous"),
      Home: () => keepDiffListFocus("goto-top"),
      End: () => keepDiffListFocus("goto-bottom"),
      Enter: (row) => row.click(),
    },
  );
  /** Tab で入った先頭の行 (まだ選んでいない) からも、その行を起点に動かす。 */
  function moveDiffListFrom(
    row: HTMLElement,
    action: "sidebar-next" | "sidebar-previous",
  ): void {
    if (!row.classList.contains("active")) markActive(sidebarItemPath(row));
    keepDiffListFocus(action);
  }
  /**
   * j k・gg / G と同じキー割り当てを呼ぶ (選んだファイルの差分のカードへ送る)。
   * キー割り当ては行を click するので本文へフォーカスを移すが、行の上の矢印
   * キーでは一覧に残す (続けて ↑↓ で選べるように)。本文へ移す予約も取り消す。
   */
  function keepDiffListFocus(
    action: "sidebar-next" | "sidebar-previous" | "goto-top" | "goto-bottom",
  ): void {
    dispatchKeymapAction(action, "sidebar");
    MAIN_SURFACE_FOCUS_SEQ++;
    document
      .querySelector<HTMLElement>(
        "#filelist[data-diff-list] li.active[data-path], #filelist[data-diff-list] li.active[data-dirpath]",
      )
      ?.focus({ preventScroll: true });
  }
  const contentPanel = document.querySelector<HTMLElement>("#content");
  contentPanel?.addEventListener("focusin", () => setPanelFocusScope("main"));
  contentPanel?.addEventListener("mousedown", (event) => {
    if (isFocusableClickTarget(event.target)) setPanelFocusScope("main");
    else focusMainPanel();
  });

  function applyHistoryWidth(w: number, persist = true) {
    const cw = clampPanelSize(HISTORY_WIDTH, w);
    document.documentElement.style.setProperty("--history-w", `${cw}px`);
    STATE.historyWidth = cw;
    if (persist) patchSettings({ historyWidth: cw });
    syncListColumn();
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
  /**
   * 列の幅を掴んで変える (線を引き、離したときに 1 度だけ幅を当てる。重い本文を
   * 動かすたびに組み直さない)。列が画面の右端に付いていれば (右の列) 左へ引くと
   * 広がり、左に付いていれば (History の変更ファイルの列) 右へ引くと広がる。
   */
  function setupColumnResizer(opts: {
    handle: HTMLElement | null;
    previewId: string;
    resizingClass: string;
    column: () => HTMLElement | null;
    width: () => number;
    clamp: (width: number) => number;
    apply: (width: number) => void;
    reset: () => void;
  }): void {
    const { handle } = opts;
    if (!handle) return;
    const preview = document.createElement("div");
    preview.id = opts.previewId;
    document.body.appendChild(preview);
    let drag: {
      startX: number;
      startW: number;
      rect: DOMRect;
      onRight: boolean;
      width: number;
    } | null = null;
    const edge = (d: NonNullable<typeof drag>) =>
      d.onRight ? d.rect.right - d.width : d.rect.left + d.width;
    handle.addEventListener("mousedown", (e) => {
      const column = opts.column();
      if (!column) return;
      const rect = column.getBoundingClientRect();
      drag = {
        startX: e.clientX,
        startW: opts.width(),
        rect,
        onRight: rect.right >= document.documentElement.clientWidth - 1,
        width: opts.width(),
      };
      document.body.classList.add(opts.resizingClass);
      preview.style.display = "block";
      preview.style.left = `${edge(drag)}px`;
      e.preventDefault();
    });
    window.addEventListener("mousemove", (e) => {
      if (!drag) return;
      const moved = e.clientX - drag.startX;
      drag.width = opts.clamp(drag.startW + (drag.onRight ? -moved : moved));
      preview.style.left = `${edge(drag)}px`;
    });
    window.addEventListener("mouseup", () => {
      if (!drag) return;
      const { width } = drag;
      drag = null;
      preview.style.display = "none";
      document.body.classList.remove(opts.resizingClass);
      opts.apply(width);
    });
    handle.addEventListener("dblclick", opts.reset);
  }
  setupColumnResizer({
    handle: document.getElementById("sidebar-resizer"),
    previewId: "sidebar-resize-preview",
    resizingClass: "gdp-resizing",
    column: () => document.getElementById("sidebar"),
    width: () => STATE.sbWidth,
    clamp: (w) => Math.max(SIDEBAR_WIDTH.min, Math.min(SIDEBAR_WIDTH.max, w)),
    apply: (w) => applySidebarWidth(w),
    reset: () => applySidebarWidth(SIDEBAR_WIDTH.default),
  });
  setupColumnResizer({
    handle: document.getElementById("history-resizer"),
    previewId: "history-resize-preview",
    resizingClass: "gdp-history-resizing",
    // 一覧の列 (Diff の変更ファイル・History・選んでいる作業ツリー)。
    column: () => {
      const kind = listColumnKind();
      return kind ? document.getElementById(LIST_COLUMN_IDS[kind]) : null;
    },
    // 見えている一覧の端から掴み (木の幅を足さない)、本文が要る幅を保てる
    // ところで止める (core/list-column.ts の listColumnDrag)。
    width: () => historyDrag().start,
    clamp: (w) => Math.min(historyDrag().max, clampPanelSize(HISTORY_WIDTH, w)),
    apply: (w) => applyHistoryWidth(w),
    reset: () => applyHistoryWidth(HISTORY_WIDTH.default),
  });

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
  // Header search button: the palettes were keyboard-only before this, so a
  // mouse user had no way to discover them. Plain click = files, Shift+click
  // = grep; either palette can switch to the other from its label row.
  document
    .querySelector<HTMLButtonElement>("#search-btn")
    ?.addEventListener("click", (event) => {
      openSearchPalette(event.shiftKey ? "grep" : "file");
    });
  function focusFileFilter() {
    const input = $<HTMLInputElement>("#sb-filter");
    input.focus();
    input.select();
  }

  function focusActiveMainTabSurface() {
    const front = MAIN_TABS.front();
    if (front && isRouteTab(front)) scheduleMainSurfaceFocus();
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
      // Escape は手前にあるものから畳む。Tools / Search の中にいればそのタブを
      // 閉じ (下パネルだった頃の「パネルを閉じる」)、行を選んでいればその解除、
      // どちらでもなければ読み込みを止める。
      if (scope === "panel") {
        if (STATE.route.screen === "tools" || STATE.route.screen === "search")
          MAIN_TABS.closeActive();
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
      return activeSourceView().switchSourceTab(
        action === "tab-preview" ? "preview" : "code",
      );
    }
    if (action === "goto-definition")
      return DEFINITION_JUMP.triggerFromKeyboard();
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
        mainScrollBox()?.scrollTo({
          top: edge === "top" ? 0 : (mainScrollBox()?.scrollHeight ?? 0),
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
      navigateToPageTab({ screen: "diff", range: currentRange() });
      return true;
    }
    if (action === "goto-history") {
      navigateToRoute({
        screen: "history",
        ref: historyRefForCurrentView(),
        range: currentRange(),
      });
      return true;
    }
    if (
      action === "history-next-commit" ||
      action === "history-previous-commit"
    ) {
      if (!isHistoryPanelRoute(STATE.route)) return false;
      void HISTORY_VIEW.moveCommitSelection(
        action === "history-next-commit" ? 1 : -1,
      );
      return true;
    }
    // Files はタブではなく左の面の本文の既定 (フォルダ表示)。選択を外して出す。
    if (action === "goto-repo") {
      MAIN_TABS.showHome();
      return true;
    }
    if (action === "toggle-sidebar") {
      applySidebarHidden(!STATE.sidebarHidden);
      return true;
    }
    // 名前は下パネルにターミナルがあった頃のまま (保存したキー割り当てを
    // 壊さない)。いまはフォーカスのある面の「＋」のメニューを開く。
    if (action === "toggle-terminal-panel") {
      openNewTabMenuFromKeys();
      return true;
    }
    if (action === "undo-last-action") {
      void undoLastAction();
      return true;
    }
    if (action === "find-in-source")
      return activeSourceView().openVirtualSourceSearchFromKeyboard(target);
    if (action === "goto-journal") {
      navigateToPageTab({ screen: "journal", range: currentRange() });
      return true;
    }
    if (action === "goto-database") {
      navigateToPageTab({ screen: "database", range: currentRange() });
      return true;
    }
    if (action === "goto-agents") {
      navigateToPageTab({ screen: "agents", range: currentRange() });
      return true;
    }
    if (action === "main-tab-next") {
      MAIN_TABS.next();
      focusActiveMainTabSurface();
      return true;
    }
    if (action === "main-tab-previous") {
      MAIN_TABS.previous();
      focusActiveMainTabSurface();
      return true;
    }
    if (action === "main-tab-close") {
      MAIN_TABS.closeActive();
      focusActiveMainTabSurface();
      return true;
    }
    if (action === "main-tab-menu") return MAIN_TABS.openFrontMenu();
    if (action === "main-pane-other") {
      MAIN_TABS.focusOther();
      focusActiveMainTabSurface();
      return true;
    }
    const nthTab = /^main-tab-([1-9])$/.exec(action);
    if (nthTab) {
      MAIN_TABS.activateNth(Number(nthTab[1]));
      focusActiveMainTabSurface();
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
    if (action === "switch-project") {
      if (!PROJECT_SWITCHER) return false;
      PROJECT_SWITCHER.toggle();
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

  document.addEventListener(
    "keydown",
    (event) => activeSourceView().handleVirtualSourcePagingKeydown(event),
    { capture: true },
  );
  document.addEventListener("click", closeRepoContextMenu);
  $("#filelist").addEventListener("contextmenu", handleSidebarContextMenu);

  document.addEventListener("keydown", async (e) => {
    if (isImeComposing(e) || e.defaultPrevented) return;
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
        pageKeymapBlocked:
          isPageKeymapBlockedKey(targetEl, e.metaKey) ||
          isEnterForFocusedControl(targetEl, e.key),
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

  // インストールした窓 (PWA) だけ、ブラウザのタブ操作のキー (⌘W・⌘T・⌘1〜9・
  // Ctrl+Tab など) をメインの面のタブへ振り向ける。表と決まりは core/pwa.ts。
  document.addEventListener("keydown", (e) => {
    if (e.defaultPrevented) return;
    const targetEl = e.target as Element | null;
    const outcome = resolvePwaKey(e, {
      standalone: window.matchMedia(STANDALONE_MEDIA_QUERY).matches,
      mac: /Mac|iPhone|iPad/.test(navigator.platform),
      // Meta 付きとして聞くと、塞がるのはダイアログだけ (端末は下で分ける)。
      target:
        isPaletteOpen() || isPageKeymapBlockedKey(targetEl, true)
          ? "blocked"
          : targetEl?.closest(".xterm")
            ? "terminal"
            : "page",
      composing: isImeComposing(e),
    });
    if (!outcome) return;
    e.preventDefault();
    if (outcome.kind === "swallow") return;
    if (outcome.action === "main-tab-new-menu") {
      openNewTabMenuFromKeys();
      return;
    }
    if (outcome.action === "main-tab-reopen") {
      // 開き直せるものが無ければ何もしない (窓は閉じさせない)。
      if (MAIN_TABS.reopenClosed()) focusActiveMainTabSurface();
      return;
    }
    if (outcome.action === "main-tab-last") {
      MAIN_TABS.activateNth(lastTabNumber(MAIN_TABS.layout()));
      focusActiveMainTabSurface();
      return;
    }
    dispatchKeymapAction(
      outcome.action,
      keymapScope(targetEl),
      e.repeat,
      targetEl,
    );
  });

  // ----- initial state + live updates -----
  applyTheme();
  // 読んだ設定を当てるだけ。書き戻すと、開くたびにリポジトリへ
  // .code-viewer/settings.json を作ってしまう (利用者は何も変えていない)。
  setLayout(STATE.layout, false);
  setPageMode();
  if (routePathname() === "/") {
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
    if (isNativeLinkClick(event)) return;
    event.preventDefault();
    const route = emptyDiffHistoryRoute();
    history.pushState(historyStateForRoute(route), "", urlForRoute(route));
    scrollMainToTop();
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
    if (STATE.route.screen === "agents") {
      void AGENTS_VIEW?.enter();
      setStatus("live");
      return Promise.resolve(null);
    }
    if (enterToolOrSearchPage()) return Promise.resolve(null);
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
    const url = `${apiUrl("diffJson")}${params.toString() ? `?${params.toString()}` : ""}`;
    // HTTP の失敗を差分として描かない。裏のプロセスが止まると入口は 502 と
    // `{error, code, project: {key, root}, …}` を返し、それを DiffMeta として
    // 読むと見出しのプロジェクト名が "[object Object]" になり、差分が空になった。
    const request = fetch(url).then(async (response) => {
      if (!response.ok)
        throw new Error(
          await responseErrorMessage(
            response,
            `diff ${fromAtRequest}..${toAtRequest} request failed`,
          ),
        );
      return (await response.json()) as DiffMeta;
    });
    return trackLoad<DiffMeta>(request)
      .then((data) => {
        if (!isCurrentDiffRequest()) return null;
        const result = renderShell(data, options.changedPaths);
        applyHideTestsToMeta();
        setStatus(data.error ? "error" : "live");
        return result;
      })
      .catch((error: unknown) => {
        if (!isCurrentDiffRequest()) return null;
        if (!isAbortError(error))
          console.error(
            `[code-viewer] the diff ${fromAtRequest}..${toAtRequest} could not be loaded or drawn`,
            error,
          );
        setStatus("error");
        return null;
      });
  }
  /** 保存した配置に残った、サーバにもう無いシェルのタブを閉じる。 */
  function closeTabsOfGoneShells(): void {
    // 読み戻した時点のタブだけを見る (この後に開いたシェルは、一覧に載る前に
    // 取り直しが返っても閉じない)。
    const saved = MAIN_TABS.terminalSessions();
    TERMINAL_VIEW.loadShells().then(
      (list) => {
        // シェルを使えないサーバ (available: false) では一覧が空。閉じない。
        if (!list.available) return;
        const live = new Set(list.sessions.map((session) => session.id));
        MAIN_TABS.closeTerminals(saved.filter((id) => !live.has(id)));
      },
      (error: unknown) =>
        console.error(
          "[code-viewer] could not check whether the saved terminal tabs still have their shells",
          error,
        ),
    );
  }

  loadInitialState().finally(() => {
    MAIN_TABS.syncRoute(STATE.route);
    // ?terminal= のタブが前面になるかは、読み戻したタブの並びで決まる。
    void MAIN_TABS.restore({
      ...(INITIAL_RIGHT_ROUTE ? { rightRoute: INITIAL_RIGHT_ROUTE } : {}),
      // URL がシェルかペインを指すときだけ、保存した前面 (ターミナル) を残す。
      keepSavedFront: INITIAL_KEEPS_SAVED_FRONT,
    }).then(() => {
      // 右の面に開けなかった (1 面で狭い) なら、そのファイルは本文で開く。
      const right = MAIN_TABS.paneRoute("right");
      if (
        INITIAL_RIGHT_ROUTE &&
        !(
          right?.screen === "file" &&
          right.path === INITIAL_RIGHT_ROUTE.path &&
          right.ref === INITIAL_RIGHT_ROUTE.ref
        )
      )
        setRoute(INITIAL_RIGHT_ROUTE, true);
      syncTerminalFromUrl(INITIAL_TERMINAL_PARAM);
      closeTabsOfGoneShells();
      // 移ってきた先で開くペイン。一度きりなので、開いたら URL から外す
      // (読み直しで開き直さない)。行き先の判定は通さない (食い違ったときに
      // 移り直しを繰り返さない)。
      if (INITIAL_OPEN_PANE) {
        openAgentPaneHere(INITIAL_OPEN_PANE);
        history.replaceState(
          history.state,
          "",
          withOpenPaneOverlay(
            window.location.pathname + window.location.search,
            null,
          ) + window.location.hash,
        );
      }
    });
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
    } else if (STATE.route.screen === "agents") {
      setStatus("live");
      void AGENTS_VIEW?.enter();
    } else if (!enterToolOrSearchPage()) load();
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
      // Data を離れる後片付けは setRoute (leaveScreen) がする。
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
    commitWebLink: (sha) => {
      const target = buildRepositoryWebTarget(REPO_WEB_URL, {
        ref: sha,
        kind: "commit",
      });
      if (!target) return null;
      return createRepositoryWebLink(
        target,
        target.provider === "github"
          ? uiText().repo.openGithub
          : uiText().repo.openRepositoryWeb,
      );
    },
    copyText: (text) => navigator.clipboard.writeText(text),
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
    return parseDoctorOverlay(routePathname(), window.location.search);
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
    // 道具の面の閉じる = Tools のタブを閉じる (前面のときだけ押せる)。
    onCloseRequest: () => {
      if (STATE.route.screen === "tools") MAIN_TABS.closeActive();
    },
    onToolChange: (tool) => rememberPageRoute("tools", tool),
  });
  relocalizeTools = () => TOOLS_VIEW.localize();

  // grep の結果の一覧 (Search のタブ)。URL の /search?q= が検索語を持つので、
  // 読み直すと同じ検索をやり直す。
  const SEARCH_RESULTS_VIEW = createSearchResultsView({
    $: <T extends Element = HTMLElement>(sel: string) =>
      document.querySelector<T>(sel),
    trackLoad,
    getLanguage: () => STATE.language,
    appendScopeParams,
    getRef: () => {
      const route = STATE.route;
      if (route.screen === "repo" || route.screen === "file")
        return route.ref || "worktree";
      return STATE.repoRef || "worktree";
    },
    getServerGeneration: () => SERVER_GENERATION,
    isAbortError,
    getGrepRegex: () => APP_SETTINGS.grepRegex === true,
    getGrepCaseSensitive: () => APP_SETTINGS.grepCaseSensitive === true,
    getGrepWholeWord: () => APP_SETTINGS.grepWholeWord === true,
    getGrepHideTests: () => STATE.hideTests,
    persistGrepSettings: async (patch) => {
      await persistSettingsPatch(patch);
      if (patch.hideTests !== undefined) {
        STATE.hideTests = patch.hideTests;
        applyHideTests();
      }
    },
    openMatch: ({ path, line, hl }, intent) => {
      const route = STATE.route;
      const ref =
        route.screen === "repo" || route.screen === "file"
          ? route.ref || "worktree"
          : STATE.repoRef || "worktree";
      const fileRoute: FileRoute = {
        screen: "file",
        path,
        ref,
        view: "blob",
        line,
        ...(hl ? { hl } : {}),
        range: currentRange(),
      };
      if (intent === "other-pane") {
        openFileInOtherPane(fileRoute);
        return;
      }
      if (intent === "new-tab")
        MAIN_TABS.openingNewTab(() => setRoute(fileRoute));
      else setRoute(fileRoute);
      void renderStandaloneSource({ path, ref });
    },
    onQueryChange: (query) => rememberPageRoute("search", query),
  });
  relocalizeSearchResults = () => SEARCH_RESULTS_VIEW.localize();

  /**
   * Tools と Search はメインの面のタブ (page の画面)。中身の箱 (#tools-sheet /
   * #search-sheet) は index.html で本文 (#content) の中にあり、画面に入ると
   * #diff を隠して中身を開き、離れると閉じて #diff を戻す (agents と同じ形)。
   */
  // 道具・検索語を渡されたらそれを開く (タブが覚えている前の検索語に負けない)。
  // 渡されなければタブが最後に見ていた route へ戻る。
  function openToolsPage(tool?: ToolId): void {
    if (tool) navigateToRoute({ screen: "tools", tool, range: currentRange() });
    else navigateToPageTab({ screen: "tools", range: currentRange() });
  }

  function openSearchPage(query?: string): void {
    if (query)
      navigateToRoute({ screen: "search", q: query, range: currentRange() });
    else navigateToPageTab({ screen: "search", range: currentRange() });
  }

  /** Tools / Search の画面に入る (setRoute・戻る進む・読み込みの全部がここ)。 */
  function enterToolOrSearchPage(): boolean {
    const route = STATE.route;
    if (route.screen !== "tools" && route.screen !== "search") return false;
    cancelActiveSourceLoad("navigation");
    setPageMode();
    removeStandaloneSource();
    document.getElementById("diff")?.setAttribute("hidden", "true");
    document.getElementById("empty")?.classList.add("hidden");
    document
      .getElementById("history-commit-info")
      ?.setAttribute("hidden", "true");
    if (route.screen === "tools") {
      if (!TOOLS_VIEW.isOpen() || TOOLS_VIEW.getActiveTool() !== route.tool)
        void TOOLS_VIEW.open(route.tool);
    } else if (
      !SEARCH_RESULTS_VIEW.isOpen() ||
      SEARCH_RESULTS_VIEW.getQuery() !== (route.q ?? "")
    ) {
      SEARCH_RESULTS_VIEW.open(route.q);
    }
    setStatus("live");
    return true;
  }

  /** Tools / Search の画面を離れる (leaveScreen)。 */
  function leaveToolOrSearchPage(screen: "tools" | "search"): void {
    if (screen === "tools") TOOLS_VIEW.close();
    else SEARCH_RESULTS_VIEW.close();
    document.getElementById("diff")?.removeAttribute("hidden");
  }

  /**
   * 画面の中で道具・検索語が変わった: route と URL とタブの記憶だけを
   * 書き換える (画面に入り直さない)。
   */
  function rememberPageRoute(
    screen: "tools" | "search",
    value: string | null,
  ): void {
    const route = STATE.route;
    if (route.screen !== screen) return;
    if (route.screen === "tools") {
      STATE.route = isToolId(value)
        ? { ...route, tool: value }
        : { screen: "tools", range: route.range };
    } else {
      STATE.route = value
        ? { ...route, q: value }
        : { screen: "search", range: route.range };
    }
    replaceUrlWithCurrentRoute();
    MAIN_TABS.syncRoute(STATE.route, false);
  }

  // メインの面のターミナルのタブ。URL の ?terminal= は、フォーカスのある面の
  // 前面のターミナルのタブが映しているシェル (?terminal=shell-…)。
  const TERMINAL_VIEW = createTerminalView({
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
    // 画像の棚を畳んだかは人に付く設定 (プロジェクトを移っても同じ)。
    isImageShelfCollapsed: () =>
      APP_SETTINGS.terminalImageShelfCollapsed === true,
    onImageShelfCollapsedChange: (collapsed) => {
      mergeLocalSettings({ terminalImageShelfCollapsed: collapsed });
      patchSettings({ terminalImageShelfCollapsed: collapsed });
    },
    onOpenInTab: (session, pane, side) => {
      if (pane) TAB_SHELL_PANES.set(session.id, pane);
      MAIN_TABS.openTerminal(session.id, side);
    },
    onOpenImage: (image, gallery, kept) => {
      IMAGE_REFS.set(image.path, { image, images: gallery });
      const open = () => MAIN_TABS.openImage(image.path, "other-if-split");
      if (kept) MAIN_TABS.openingNewTab(open);
      else open();
    },
  });

  /**
   * メインの面の左右の箱。前面のタブがターミナル・画像・本文を出していない
   * route のタブ (置き札) のとき、その面の位置に出す。本文 (route の中身) を
   * 出している面の箱は隠し、下の本文が見える。
   */
  const PANE_HOSTS: Record<PaneSide, HTMLElement> = {
    left: createPaneHost("left"),
    right: createPaneHost("right"),
  };

  function createPaneHost(side: PaneSide): HTMLElement {
    const app = document.getElementById("app");
    if (!app) throw new Error("#app is missing from index.html");
    const host = document.createElement("div");
    host.className = "main-pane-host";
    host.dataset.side = side;
    app.append(host);
    return host;
  }

  // ---- 右の面のソース表示 ----
  // 右の面の前面がファイルのとき、面の箱に 2 つ目のソース表示 (と Blame) を
  // 描く。本文 (左の面) の実体と同じ createSourceView を、route・探す範囲・
  // 差し込み先を右の面のものにして呼ぶ。行の選択・読み込みの取り消し・仮想
  // スクロールは実体ごと、ファイルの取得・強調器・注釈の保存は共有。

  type FileRoute = Extract<AppRoute, { screen: "file" }>;

  type SidePane = {
    /** 面の箱に入れる枠。スクロールはこの中。 */
    root: HTMLElement;
    /** カードを差し込む先 (本文の #diff にあたる)。 */
    body: HTMLElement;
    /** 描いている route (右の前面のタブの route)。 */
    route: FileRoute;
    /** 最後に描いた route。同じなら描き直さない (スクロールを失わない)。 */
    rendered: string | null;
    source: ReturnType<typeof createSourceView>;
    blame: ReturnType<typeof createBlameView>;
  };

  let RIGHT_SOURCE: SidePane | null = null;

  function rightSourcePane(route: FileRoute): SidePane {
    if (RIGHT_SOURCE) return RIGHT_SOURCE;
    const root = document.createElement("div");
    root.className = "main-pane-source";
    root.tabIndex = -1;
    const body = document.createElement("div");
    body.className = "main-pane-source-body";
    root.append(body);
    const scrollTarget = (): HTMLElement => {
      const virtual = root.querySelector<HTMLElement>(
        ".gdp-source-virtual-scroller",
      );
      return virtual && virtual.offsetParent !== null ? virtual : root;
    };
    // 本文だけのもの (body のクラス・木・右の列のボタン) は右の面では動かさない。
    const noop = () => undefined;
    // 実体の依存は描くときの route を読む (pane は下で組む)。
    let pane: SidePane;
    const source = createSourceView({
      ...SOURCE_VIEW_DEPS,
      route: () => pane.route,
      setRoute: (next, replace) => setRightPaneRoute(next, replace),
      scope: () => root,
      mountRoot: () => body,
      mainScrollTarget: scrollTarget,
      focusPanel: () => root.focus({ preventScroll: true }),
      setPageMode: noop,
      repoFileTargetFromRoute: () => pane.route.ref,
      renderRepoBlobSidebar: noop,
      placeSidebarToggle: noop,
    });
    const blame = createBlameView({
      ...BLAME_VIEW_DEPS,
      mountRoot: () => body,
      scope: () => root,
      setRoute: (next, replace) => setRightPaneRoute(next, replace),
      setPageMode: noop,
      removeStandaloneSource: () => pane.source.removeStandaloneSource(),
      placeSidebarToggle: noop,
      repoFileTargetFromRoute: () => pane.route.ref,
      renderRepoBlobSidebar: noop,
      currentSourceLineTarget: (target) =>
        pane.source.currentSourceLineTarget(target),
      lineInSourceTarget: (lineNumber, target) =>
        pane.source.lineInSourceTarget(lineNumber, target),
      bindSourceLineNumber: (num, card, target, line) =>
        pane.source.bindSourceLineNumber(num, card, target, line),
      setPreferredSourceTab: (tab) => pane.source.setPreferredSourceTab(tab),
    });
    pane = { root, body, route, rendered: null, source, blame };
    DEFINITION_JUMP.install(root);
    RIGHT_SOURCE = pane;
    return pane;
  }

  /**
   * 木・差分の一覧のファイルの行を、固定のタブ (new-tab) か反対の面
   * (other-pane) で開く (ui-surface.md の「タブの決まり」)。木は今見ている
   * 表示 (Code / Blame) を保ち、差分の一覧はその差分の新しい側の版 (消した
   * ファイルは古い側) を Code で開く。フォルダはタブにならないので普通の
   * クリックと同じ。
   */
  function openFileAs(
    file: SidebarItem,
    intent: "new-tab" | "other-pane",
    list: "diff" | "repo",
  ): void {
    const ref = REPO_SIDEBAR_REF || STATE.repoRef || "worktree";
    if (file.type === "tree") {
      setRoute(REPO_VIEW.repoRoute(ref, file.resolved_path ?? file.path));
      void REPO_VIEW.loadRepo();
      return;
    }
    const range = currentRange();
    const route: FileRoute =
      list === "diff"
        ? {
            screen: "file",
            path: file.path,
            ref: file.status === "D" ? range.from : range.to,
            view: "blob",
            range,
          }
        : fileRouteKeepingActiveView(
            STATE.route,
            { path: file.path, ref },
            range,
          );
    if (intent === "new-tab") {
      MAIN_TABS.openingNewTab(() => setRoute(route));
      if (route.view === "blob")
        void renderStandaloneSource({ path: route.path, ref: route.ref });
      return;
    }
    openFileInOtherPane(route);
  }

  /**
   * 反対の面で開く。1 面か左にフォーカスがあれば右の面 (1 面なら右に分ける)、
   * 右にフォーカスがあれば左 (本文)。右の面では History を持たないので、その
   * 表示は Code に落とす。
   */
  function openFileInOtherPane(keep: FileRoute): void {
    const route: FileRoute =
      keep.view === "history" ? { ...keep, view: "blob" } : keep;
    const view = MAIN_TABS.panes();
    if (view.split && view.focused === "right") {
      MAIN_TABS.focusSide("left");
      setRoute(route);
      return;
    }
    // 2 面を置けない幅: 反対の面が無いので本文で開く。
    if (!openInRightPane(route)) setRoute(route);
  }

  /** キー操作・スクロールの相手: フォーカスのある面のソース表示。 */
  function activeSourceView(): ReturnType<typeof createSourceView> {
    const view = MAIN_TABS.panes();
    return view.focused === "right" &&
      view.fronts.right?.target.kind === "file" &&
      RIGHT_SOURCE
      ? RIGHT_SOURCE.source
      : SOURCE_VIEW;
  }

  /** 右の面の箱に、前面のファイルのタブの route を描く (同じ route なら何もしない)。 */
  function showSourceInRight(): void {
    const route = MAIN_TABS.paneRoute("right");
    if (route?.screen !== "file")
      throw new Error(
        `right pane: the front tab has no file route (${JSON.stringify(route)})`,
      );
    const pane = rightSourcePane(route);
    const host = PANE_HOSTS.right;
    if (pane.root.parentElement !== host) host.replaceChildren(pane.root);
    pane.route = route;
    const key = JSON.stringify(route);
    if (pane.rendered === key) return;
    pane.rendered = key;
    const target = { path: route.path, ref: route.ref };
    if (route.view === "blame") {
      pane.source.cancelActiveSourceLoad("navigation");
      pane.source.removeStandaloneSource();
      void pane.blame.renderBlamePage(target);
      return;
    }
    pane.blame.removeBlamePage();
    pane.source.applySourceRouteToShell();
  }

  /**
   * 右の面へファイルの route を開く (右にフォーカスがあるときの木・パレット、
   * Alt+クリック、右の面の中の移動)。開けなければ (1 面で狭い) false。
   */
  function openInRightPane(route: FileRoute, replace = false): boolean {
    if (!MAIN_TABS.openRouteRight(route)) return false;
    showSourceInRight();
    syncLineRefPill();
    if (isRepositorySidebarMode()) markActive(route.path);
    const url = withPaneOverlay(urlForRoute(route), "right");
    if (url !== window.location.pathname + window.location.search) {
      if (replace)
        history.replaceState(historyStateForRoute(route, true), "", url);
      else history.pushState(historyStateForRoute(route), "", url);
    }
    return true;
  }

  /**
   * 右の面のソース表示・Blame が route を変える。右で描けないもの (ファイル
   * の History・フォルダ・Diff・History) は本文 (左の面) で開く。
   */
  function setRightPaneRoute(route: AppRoute, replace = false): void {
    if (
      route.screen === "file" &&
      route.view !== "history" &&
      routeTarget(route)?.kind === "file" &&
      openInRightPane(route, replace)
    )
      return;
    MAIN_TABS.focusSide("left");
    setRoute(route, replace);
  }

  /**
   * 木・パレット・定義ジャンプなどが route を置いた後に呼ぶソースの描画。
   * いま右の面に開いたファイルなら右の面の実体、それ以外は本文の実体。
   */
  function renderStandaloneSource(
    target: SourceFileTarget,
    options?: { refresh?: boolean },
  ): Promise<unknown> {
    const view = MAIN_TABS.panes();
    const route = MAIN_TABS.paneRoute("right");
    if (
      view.focused === "right" &&
      RIGHT_SOURCE &&
      route?.screen === "file" &&
      route.path === target.path &&
      route.ref === target.ref
    )
      return RIGHT_SOURCE.source.renderStandaloneSource(target, options);
    return SOURCE_VIEW.renderStandaloneSource(target, options);
  }

  /**
   * URL をフォーカスのある面に合わせる: 右の面のファイルなら その route に
   * pane=right を足したもの、そうでないのに pane=right が残っていれば本文の
   * route に戻す。
   */
  function syncFocusedPaneUrl(mode: "push" | "replace"): void {
    const view = MAIN_TABS.panes();
    const right = MAIN_TABS.paneRoute("right");
    const current = window.location.pathname + window.location.search;
    let next: string | null = null;
    if (view.focused === "right" && right?.screen === "file")
      next = withPaneOverlay(urlForRoute(right), "right");
    else if (parsePaneOverlay(window.location.search))
      next = urlForRoute(STATE.route);
    if (next === null || next === current) return;
    const state = historyStateForRoute(
      view.focused === "right" && right ? right : STATE.route,
      mode === "replace",
    );
    if (mode === "push") history.pushState(state, "", next);
    else history.replaceState(state, "", next);
  }

  /**
   * パスから画像を引く (既存の /_agent/images。URL はサーバが組み立てる)。
   * リポジトリのファイルなら、木の同じフォルダの画像を前後の並びにする。
   */
  async function resolveImage(
    path: string,
  ): Promise<{ image: TerminalImageRef; images: TerminalImageRef[] }> {
    const known = IMAGE_REFS.get(path);
    if (known) return known;
    const folder = path.includes("/")
      ? path.slice(0, path.lastIndexOf("/"))
      : "";
    const siblings = path.startsWith("/")
      ? [path]
      : getSidebarFiles()
          .map((item) => item.path)
          .filter(
            (item) =>
              terminalImageExtension(item) !== null &&
              (item.includes("/")
                ? item.slice(0, item.lastIndexOf("/"))
                : "") === folder,
          );
    const paths = siblings.includes(path) ? siblings : [path, ...siblings];
    const params = new URLSearchParams();
    for (const item of paths) params.append("path", item);
    const res = await trackLoad(
      fetch(`${apiUrl("agentImages")}?${params.toString()}`),
    );
    if (!res.ok)
      throw new Error(await responseErrorMessage(res, `load image ${path}`));
    const body = validateTerminalImageResponseUrls(
      (await res.json()) as TerminalImagesResponse,
      window.location.href,
    );
    const image = body.images.find(
      (item) => item.candidate === path || item.path === path,
    );
    if (!image) {
      const rejected = body.rejected.find((item) => item.candidate === path);
      throw new Error(
        `image ${path} cannot be shown: ${rejected ? JSON.stringify(rejected) : "not in the response"}`,
      );
    }
    const resolved = { image, images: body.images };
    IMAGE_REFS.set(path, resolved);
    return resolved;
  }

  /** その面の箱に画像を出す。読めなければ理由を箱に出す (黙って空にしない)。 */
  function showImageIn(side: PaneSide, path: string): void {
    const host = PANE_HOSTS[side];
    void resolveImage(path).then(
      ({ image, images }) => {
        const front = MAIN_TABS.panes().fronts[side];
        if (front?.target.kind !== "image" || front.target.path !== path)
          return;
        let view = IMAGE_VIEWS[side];
        if (view) view.setImage(image, images);
        else {
          view = createImageTabView({
            image,
            images,
            imageUrlFor: (ref) => ref.url,
            copyPath: (target) =>
              navigator.clipboard.writeText(filePathClipboardText(target)),
            openPath: (target) => openPathInOs(target, "file-parent"),
            language: STATE.language,
          });
          IMAGE_VIEWS[side] = view;
        }
        host.replaceChildren(view.el);
        if (MAIN_TABS.panes().focused === side) view.focus();
      },
      (error: unknown) => {
        console.error("[code-viewer] image tab could not be shown", error);
        const front = MAIN_TABS.panes().fronts[side];
        if (front?.target.kind !== "image" || front.target.path !== path)
          return;
        const message = document.createElement("p");
        message.className = "main-pane-message";
        message.textContent = formatErrorDetail(error);
        host.replaceChildren(message);
      },
    );
  }

  // 2 面のとき、面の中 (本文・箱) を押したらその面へフォーカスを移す。
  // タブ列 (タブを押せばその面へ移る)・サイドバー・最下段・
  // メニューやダイアログは面の外なので見ない。
  document.addEventListener(
    "pointerdown",
    (event) => {
      const side = MAIN_TABS.sideAt(event.clientX);
      if (!side) return;
      const target = event.target as Element | null;
      if (
        target?.closest(
          "#app-nav, #main-tabs, #statusbar, .main-split-divider, .gdp-context-menu, [role=dialog]",
        )
      )
        return;
      MAIN_TABS.focusSide(side);
    },
    true,
  );

  relocalizeTerminal = () => TERMINAL_VIEW.localize();

  // 電話の幅の骨格 (引き出し・下からの面・下端の帯・端末の操作札)。2 面は
  // 無いので、端末は左の面のものに送る。
  installMobileShell({
    getLanguage: () => STATE.language,
    sendTerminalKey: (key) => TERMINAL_VIEW.sendSoftKey("left", key),
    focusTerminal: () => TERMINAL_VIEW.focusTab("left"),
  });

  /**
   * URL の ?terminal= (映しているシェル) に合わせる。そのシェルのタブを開いて
   * 前面に出す (無ければ作る)。`open` は下パネルにターミナルがあった頃の
   * 「パネルを開くだけ」の値で、いまは意味を持たないので URL から外すだけ
   * (route はそのまま。ルートの URL なら Files)。
   */
  function syncTerminalFromUrl(state: TerminalOverlayState): void {
    if (state === "open") {
      const path = window.location.pathname + window.location.search;
      const next = withTerminalOverlay(path, null);
      if (next !== path)
        history.replaceState(history.state, "", next + window.location.hash);
      return;
    }
    if (state) MAIN_TABS.openTerminal(state);
  }

  /**
   * キー (Ctrl+`) で「＋」のメニューを開くときの、フォーカスの戻し先。
   * タブ列の openNewTabMenu が同期で openNewTabMenu (下) を呼ぶ間だけ持つ。
   */
  let newTabMenuFocusReturn: HTMLElement | null = null;

  /** キー (Ctrl+`・PWA の窓の ⌘/Ctrl+T) で、フォーカスのある面の「＋」のメニューを開く。 */
  function openNewTabMenuFromKeys(): void {
    newTabMenuFocusReturn =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    MAIN_TABS.openNewTabMenu();
  }

  /**
   * タブ列の「＋」のメニュー: ファイルを開く・新しいシェル・既存のセッション
   * (このサーバのシェルと、このプロジェクトの tmux のペイン)。一覧は開く
   * 直前に取り直す。取れなかったら、理由をメニューの 1 行に出す (ファイルと
   * 新しいシェルは使えるままにする)。
   */
  async function openNewTabMenu(
    side: PaneSide,
    anchor: HTMLElement,
  ): Promise<void> {
    const back = newTabMenuFocusReturn;
    newTabMenuFocusReturn = null;
    let list: ShellListResponse | Error;
    try {
      list = await TERMINAL_VIEW.loadShells();
    } catch (error) {
      console.error(
        "[code-viewer] shell list for the new-tab menu failed",
        error,
      );
      list = error instanceof Error ? error : new Error(String(error));
    }
    if (!anchor.isConnected) return;
    // キーで開いたなら、Escape で戻す先はキーを押した場所 (＋のボタンではない)。
    // 何も選んでいなかった・もう無いなら＋のボタン (既定)。
    showContextMenu(
      anchor,
      newTabMenuItems(side, list),
      back && back !== document.body && back.isConnected
        ? { focusReturn: back }
        : {},
    );
  }

  function newTabMenuItems(
    side: PaneSide,
    list: ShellListResponse | Error,
  ): ContextMenuItem[] {
    const t = terminalText(STATE.language);
    const a = agentsText(STATE.language);
    const overview = AGENT_MONITOR.snapshot().overview;
    const unread = AGENT_MONITOR.snapshot().unread;
    const items: ContextMenuItem[] = [
      {
        label: t.newTabOpenFile,
        // その面の＋から開いたファイルは、その面に開く (右の面にも置ける)。
        onSelect: () => {
          MAIN_TABS.focusSide(side);
          openSearchPalette("file");
        },
      },
      {
        label: t.newShell,
        title:
          list instanceof Error || list.available
            ? t.newShellTitle
            : `${t.shellUnavailable}\n${list.reason ?? ""}`,
        disabled: !(list instanceof Error) && !list.available,
        onSelect: () => {
          TERMINAL_VIEW.createShell(side).catch((error: unknown) => {
            console.error("[code-viewer] shell create failed", error);
            void showAlertDialog({
              title: t.shellCreateFailed,
              body: formatErrorDetail(error),
            });
          });
        },
      },
      // Tools と Search は page のタブ (左の面にだけ開く)。
      { label: uiText().nav.tools, onSelect: () => openToolsPage() },
      { label: uiText().nav.search, onSelect: () => openSearchPage() },
    ];
    const sessions: ContextMenuItem[] = [];
    /** タブで開いていない未読のペイン (印を付け、まとめて読んだことにできる)。 */
    const unreadPanes: string[] = [];
    const mark = (paneId: string | undefined, tabbed: boolean): string => {
      if (!paneId || tabbed || !unread.has(paneId)) return "";
      unreadPanes.push(paneId);
      return "● ";
    };
    if (list instanceof Error) {
      sessions.push({
        label: t.shellListFailed,
        title: formatErrorDetail(list),
        disabled: true,
        onSelect: () => undefined,
      });
    } else {
      for (const session of list.sessions) {
        const tabbed = MAIN_TABS.hasTerminal(session.id);
        const pane = paneForShell(session.id);
        sessions.push({
          label: `${mark(pane?.id, tabbed)}${terminalTabInfo(session.id).label}${tabbed ? ` · ${t.inTab}` : ""}`,
          title: [pane ? paneText(pane, a).title : session.command, session.cwd]
            .filter(Boolean)
            .join("\n"),
          onSelect: () => MAIN_TABS.openTerminal(session.id),
        });
      }
    }
    // このプロジェクトの tmux のペインのうち、上のシェルが映していないもの。
    const shown = new Set(
      list instanceof Error ? [] : list.sessions.map((item) => item.id),
    );
    const current = overview?.projects.find(
      (item) => item.server.status === "current",
    );
    for (const pane of overview?.panes ?? []) {
      if (pane.project !== current?.root) continue;
      if (pane.shownInShell !== "" && shown.has(pane.shownInShell)) continue;
      // 行の形はサイドバー・パレット・タブと同じ決まり (pane-text.ts)。
      const row = paneText(pane, a);
      sessions.push({
        label: `${mark(pane.id, false)}${row.row}`,
        title: row.title,
        onSelect: () => openAgentPane(pane.id),
      });
    }
    if (sessions.length > 0) items.push({ kind: "separator" }, ...sessions);
    else if (!(list instanceof Error))
      items.push(
        { kind: "separator" },
        { label: t.noShells, disabled: true, onSelect: () => undefined },
      );
    items.push({ kind: "separator" });
    if (unreadPanes.length > 0)
      items.push({
        label: t.markAllRead(unreadPanes.length),
        title: t.unreadTitle,
        onSelect: () => {
          for (const pane of unreadPanes) AGENT_MONITOR.markRead(pane);
        },
      });
    items.push({
      label: t.allSessions,
      onSelect: () =>
        navigateToRoute({ screen: "agents", range: currentRange() }),
    });
    return items;
  }

  /** タブの右クリックの「セッションを止める」。確かめてから止め、タブも閉じる。 */
  async function stopTerminal(session: ShellSessionId): Promise<void> {
    const t = terminalText(STATE.language);
    const name = terminalTabInfo(session).label;
    const ok = await showConfirmDialog({
      title: t.stopConfirmTitle,
      body: t.stopConfirmMessage(name),
      confirmLabel: t.stopConfirm,
      cancelLabel: t.cancel,
      danger: true,
    });
    if (!ok) return;
    try {
      await TERMINAL_VIEW.closeShell(session);
    } catch (error) {
      console.error("[code-viewer] shell close failed", error);
      await showAlertDialog({
        title: t.shellCloseFailed,
        body: formatErrorDetail(error),
      });
      return;
    }
    MAIN_TABS.closeTerminal(session);
  }

  /**
   * 面の前面・フォーカス・分割が変わった。面ごとの箱にターミナル・画像・
   * 右の面のファイルを出す (本文 = route の中身は左の面にしか出ないので、左の
   * 前面が route のタブか何も選んでいないときは箱を隠して本文を見せる)。
   * URL はフォーカスのある面に合わせる: 右の面のファイルなら pane=right、
   * ターミナルならそのシェルを積み、そうでないタブへ route を移らずに戻った
   * ときは ?terminal= を外す。
   */
  // ---- 2 面のときの右の列 (ui-layout.md の「2 面と右の列」) ----
  // 2 面にした本文が、ゆとりのある面の最小幅 2 つ分に足りないなら、右の列を
  // 細い帯へ自動で畳む (Data の検索欄などが 0 幅に潰れるため)。2 面を解いたら
  // 元へ戻す。一覧が右の列にある画面 (History・選んでいる作業ツリー) の間は
  // 畳まない。利用者が 2 面の間に自分で開いたら、その意思を優先して、この
  // セッションでは二度と自動で畳まない (保存はしない = 読み直しで元に戻る)。
  // 決まりそのものは core/panel-column-policy.ts。
  let PANEL_COLUMN_AUTO_HIDDEN = false;
  let PANEL_COLUMN_AUTO_HIDE_OFF = false;
  let PANEL_COLUMN_SPLIT = false;
  let PANEL_COLUMN_HOLDS_LIST = false;

  /**
   * 本文の左の一覧の列に出す一覧 (body[data-list-column] の値)。Diff は変更
   * ファイル (#sidebar)、History はコミット、選んでいる作業ツリーは作業ツリーの
   * 一覧。どれでもない画面は null。画面の印 (body の class と
   * data-worktree-overview) から決める: 作業ツリーの選択の印は worktree-view.ts
   * が付けるので、route からでは遅れる。
   */
  function listColumnKind(): "sidebar" | "history" | "worktree" | null {
    const body = document.body;
    if (body.classList.contains("gdp-diff-page")) return "sidebar";
    if (body.classList.contains("gdp-history-page")) return "history";
    if (
      body.classList.contains("gdp-worktree-page") &&
      !body.hasAttribute("data-worktree-overview")
    )
      return "worktree";
    return null;
  }

  function panelColumnHoldsList(): boolean {
    return listColumnKind() !== null;
  }

  /**
   * 一覧の列を出す / 隠す印と、出す幅 (利用者の幅か詰めた幅。決まりは
   * core/list-column.ts) を合わせる。幅が変わったら 2 面の幅も合わせ直す。
   */
  function syncListColumn(): void {
    const body = document.body;
    const kind = listColumnKind();
    if (kind) body.dataset.listColumn = kind;
    else delete body.dataset.listColumn;
    body.toggleAttribute(
      "data-list-column-hidden",
      !!kind && LIST_COLUMN_HIDDEN,
    );
    let total = 0;
    let shown = 0;
    let treeFolded = false;
    if (kind) {
      // タブ列は左のサイドバーの右から右の列の左まで (= 一覧の列と本文)。
      const room = document
        .getElementById("main-tabs")
        ?.getBoundingClientRect().width;
      if (room === undefined) throw new Error("#main-tabs is missing");
      // 木を畳んだ帯の幅 = 右の列の帯と同じ (--panelcol-rail-w。密度で変わる)。
      const railValue =
        getComputedStyle(body).getPropertyValue("--panelcol-rail-w");
      const treeRail = Number.parseFloat(railValue);
      if (!Number.isFinite(treeRail))
        throw new Error(
          `--panelcol-rail-w is not a length: ${JSON.stringify(railValue)}`,
        );
      const split = MAIN_TABS.panes().split;
      const need = split
        ? COMFORTABLE_PANE_WIDTH * 2 + SPLIT_DIVIDER_WIDTH
        : COMFORTABLE_PANE_WIDTH;
      const layout = listColumnLayout({
        room,
        preferred: LIST_COLUMN_HIDDEN ? 0 : STATE.historyWidth,
        compact: HISTORY_WIDTH.min,
        // History・作業ツリーは一覧の右に変更ファイルの木の列が並ぶ。
        tree: kind === "sidebar" ? 0 : STATE.sbWidth,
        treeRail,
        treeKeptOpen: LIST_TREE_KEPT_OPEN,
        need,
      });
      // 掴んで広げられる上限 = 今の木の幅のままで本文が need を保てる幅。
      LIST_FITS_WIDTH = room - layout.tree - need;
      if (!LIST_COLUMN_HIDDEN)
        document.documentElement.style.setProperty(
          "--list-w",
          `${layout.width}px`,
        );
      treeFolded = layout.treeFolded;
      total = layout.width + layout.tree;
      shown = LIST_COLUMN_HIDDEN ? 0 : layout.width;
    }
    LIST_SHOWN_WIDTH = shown;
    // 木の幅そのものは CSS が --sidebar-w と帯の幅から作る (木の掴みでの
    // ドラッグを ResizeObserver で拾えるように)。ここは畳むかどうかだけ。
    body.toggleAttribute("data-list-tree-folded", treeFolded);
    if (total === LIST_COLUMN_WIDTH) return;
    LIST_COLUMN_WIDTH = total;
    MAIN_TABS.refit();
  }

  /** 一覧の列の掴みの開始幅と上限 (core/list-column.ts の listColumnDrag)。 */
  function historyDrag() {
    return listColumnDrag({
      shown: LIST_SHOWN_WIDTH,
      preferred: STATE.historyWidth,
      fits: LIST_FITS_WIDTH,
      size: HISTORY_WIDTH,
    });
  }

  /**
   * 右の列を畳む / 出すボタンの説明。2 面のために自動で畳んだときは、その理由も
   * 出す (手で畳んだときと区別が付かないと、なぜ消えたのか分からない)。一覧の
   * 画面では、このボタンは一覧の列を出し入れする (toggleListColumn)。
   */
  function panelColumnToggleTitle(hidden: boolean): string {
    const text = uiText().sidebar;
    if (listColumnKind())
      return LIST_COLUMN_HIDDEN ? text.showList : text.hideList;
    if (!hidden) return text.hide;
    return PANEL_COLUMN_AUTO_HIDDEN
      ? `${text.show} (${text.autoHiddenForSplit})`
      : text.show;
  }

  /**
   * 2 面になった / 解いた、または一覧のある画面に入った / 出たときに、右の列を
   * 畳む・開く。どちらも変わっていなければ何もしない (利用者の操作を上書きしない)。
   */
  function syncPanelColumn(split: boolean = PANEL_COLUMN_SPLIT): void {
    syncListColumn();
    const holdsList = panelColumnHoldsList();
    if (split === PANEL_COLUMN_SPLIT && holdsList === PANEL_COLUMN_HOLDS_LIST)
      return;
    const leftList = PANEL_COLUMN_HOLDS_LIST && !holdsList;
    PANEL_COLUMN_SPLIT = split;
    PANEL_COLUMN_HOLDS_LIST = holdsList;
    applyPanelColumnAction(split, holdsList, leftList);
    // 一覧の画面を出て開いた: 2 面なら、開いた幅でもう一度決める。
    if (leftList && !PANEL_COLUMN_AUTO_HIDDEN)
      applyPanelColumnAction(split, holdsList, false);
    // 帯のボタンの意味 (右の列か一覧の列か) が画面で変わる。
    markPanelRailAutoHidden();
  }

  function applyPanelColumnAction(
    split: boolean,
    holdsList: boolean,
    leftList: boolean,
  ): void {
    const action = panelColumnAction({
      split,
      holdsList,
      leftList,
      autoHidden: PANEL_COLUMN_AUTO_HIDDEN,
      userHidden: STATE.sidebarHidden && !PANEL_COLUMN_AUTO_HIDDEN,
      userOptedOut: PANEL_COLUMN_AUTO_HIDE_OFF,
      fitsWithColumn: MAIN_TABS.splitFitsWithPanelColumn(),
    });
    if (action === "keep") return;
    PANEL_COLUMN_AUTO_HIDDEN = action === "collapse";
    SIDEBAR.applySidebarHidden(action === "collapse", { persist: false });
    markPanelRailAutoHidden();
  }

  /**
   * 帯の頭に「2 面のため畳みました」の印と説明を出す / 外す。一覧の画面では
   * 一覧のために畳んでいるので印は出さず、説明は一覧の列の出し入れにする。
   */
  function markPanelRailAutoHidden(): void {
    const rail = document.querySelector<HTMLElement>("#panel-rail");
    rail?.classList.toggle(
      "panel-rail-auto-hidden",
      PANEL_COLUMN_AUTO_HIDDEN && STATE.sidebarHidden && !listColumnKind(),
    );
    const toggle = document.querySelector<HTMLButtonElement>("#sidebar-toggle");
    if (!toggle) return;
    const title = panelColumnToggleTitle(STATE.sidebarHidden);
    toggle.title = title;
    toggle.setAttribute("aria-label", title);
  }

  // 一覧のある画面に入った / 出た (本文の route・作業ツリーの選択) ときも合わせる。
  // 画面の印は app.ts の画面の切替と worktree-view.ts の何か所かで付くので、
  // 付け忘れが起きないよう body の印そのものを見る。
  new MutationObserver(() => syncPanelColumn()).observe(document.body, {
    attributes: true,
    attributeFilter: ["class", "data-worktree-overview"],
  });

  // 窓・左のサイドバー・右の列の幅 (タブ列の幅) と、History の変更ファイルの
  // 木の幅が変わったら、一覧の列の幅を決め直す。
  // 畳んだ変更ファイルの木の帯。押すと開き、このセッションは畳まない。
  createListTreeOpen({
    open: () => {
      LIST_TREE_KEPT_OPEN = true;
      syncListColumn();
    },
    label: () => uiText().sidebar.showTree,
  });

  /** 言語の切替でも呼ばれる (ボタンを作る前にも呼ばれるので DOM から引く)。 */
  function localizeListTreeOpen(): void {
    const button = document.querySelector<HTMLButtonElement>(".list-tree-open");
    if (button) setListTreeOpenLabel(button, uiText().sidebar.showTree);
  }

  const listColumnObserver = new ResizeObserver(() => syncListColumn());
  for (const id of ["main-tabs", "sidebar"]) {
    const el = document.getElementById(id);
    if (!el) throw new Error(`#${id} is missing from index.html`);
    listColumnObserver.observe(el);
  }

  /**
   * 帯のボタン (と、そのキー) を一覧の画面で押した: 右の列は一覧の画面の間は
   * 帯のまま (開いても出す木が無い) なので、代わりに一覧の列を出し入れする。
   * 一覧の画面でなければ false (右の列を開く / 畳む)。
   */
  function toggleListColumn(): boolean {
    if (!listColumnKind()) return false;
    LIST_COLUMN_HIDDEN = !LIST_COLUMN_HIDDEN;
    syncListColumn();
    markPanelRailAutoHidden();
    return true;
  }

  function onUserToggledSidebarHidden(hidden: boolean): void {
    if (!hidden && PANEL_COLUMN_SPLIT) {
      // 2 面の間に自分で開いた = これ以降は自動で畳まない。
      PANEL_COLUMN_AUTO_HIDE_OFF = true;
    }
    PANEL_COLUMN_AUTO_HIDDEN = false;
    markPanelRailAutoHidden();
  }

  function showPanes(view: PanesView, how: FrontChange): void {
    syncPanelColumn(view.split);
    for (const side of ["left", "right"] as const) {
      const host = PANE_HOSTS[side];
      const tab = view.fronts[side];
      const present = side === "left" || view.split;
      const shown =
        present &&
        tab !== null &&
        (!isRouteTab(tab) || (side === "right" && tab.target.kind === "file"));
      host.classList.toggle("is-shown", shown);
      host.dataset.kind = shown && tab ? tab.target.kind : "";
      if (!shown || !tab) continue;
      if (tab.target.kind === "file") {
        showSourceInRight();
      } else if (tab.target.kind === "terminal") {
        host.replaceChildren(TERMINAL_VIEW.tabPaneFor(side));
        void TERMINAL_VIEW.showInTab(
          tab.target.session as ShellSessionId,
          side,
        );
      } else if (tab.target.kind === "image") {
        showImageIn(side, tab.target.path);
      }
    }
    syncHeaderMenu();
    AGENTS_SIDEBAR?.refresh();
    syncLineRefPill();
    // 木の選択の印は、フォーカスのある面のファイル (リポジトリの木のとき)。
    if (isRepositorySidebarMode()) {
      const right =
        view.focused === "right" && view.fronts.right?.target.kind === "file"
          ? MAIN_TABS.paneRoute("right")
          : null;
      const focusedRoute = right ?? STATE.route;
      if (focusedRoute.screen === "file") markActive(focusedRoute.path);
    }
    if (how !== "navigate")
      syncFocusedPaneUrl(how === "stay" ? "push" : "replace");
    const front = view.fronts[view.focused];
    const session =
      front?.target.kind === "terminal" ? front.target.session : null;
    const path = window.location.pathname + window.location.search;
    if (session) {
      if (parseTerminalOverlay(window.location.search) !== session)
        history.pushState(
          history.state,
          "",
          withTerminalOverlay(path, session) + window.location.hash,
        );
      return;
    }
    if (how !== "stay") return;
    const next = withTerminalOverlay(path, null);
    if (next !== path)
      history.pushState(history.state, "", next + window.location.hash);
  }

  /**
   * タブで開いたシェルと、開いたときのペイン。シェルとペインの対応は本来
   * エージェントの一覧 (shownInShell) から引くが、サーバがシェルの端末名を
   * まだ知らないうちは空になるので、開いたときの対応で補う。
   */
  const TAB_SHELL_PANES = new Map<string, string>();

  /** そのシェルが映しているエージェントのペイン。 */
  function paneForShell(session: string): AgentPane | undefined {
    const panes = AGENT_MONITOR.snapshot().overview?.panes ?? [];
    const opened = TAB_SHELL_PANES.get(session);
    return (
      panes.find(
        (item) => item.shownInShell !== "" && item.shownInShell === session,
      ) ?? panes.find((item) => item.id === opened)
    );
  }

  /** ターミナルのタブの名前と印。エージェントを映していれば、その種類と状態。 */
  function terminalTabInfo(session: string): {
    label: string;
    state: AgentState | null;
    project: TerminalTabProject | null;
  } {
    const pane = paneForShell(session);
    const a = agentsText(STATE.language);
    if (pane?.kind) {
      // 別のプロジェクトのペインは、タブの名前の前にプロジェクト名を付ける。
      const info = AGENT_MONITOR.snapshot().overview?.projects.find(
        (item) => item.root === pane.project,
      );
      return {
        label: paneText(pane, a).headline,
        state: pane.state,
        project: info
          ? { name: info.name, current: info.server.status === "current" }
          : null,
      };
    }
    return {
      label: shellName(
        session,
        TERMINAL_VIEW.knownShells()?.sessions ?? [],
        {
          shell: terminalText(STATE.language).shellTarget,
          signIn: a.accounts.loginButton,
          defaultAccount: a.accounts.defaultName,
        },
        (id) => !!paneForShell(id)?.kind,
      ),
      state: null,
      project: null,
    };
  }

  // エージェントの状態。どの画面にいても取り直し、ヘッダの件数・未読・通知に
  // 流す。一覧の画面 (/agents) も同じ結果を描く。
  /** いま映しているシェル: 左右の面の前面のターミナルのタブ。 */
  function viewedShells(): string[] {
    const { fronts } = MAIN_TABS.panes();
    return [fronts.left, fronts.right]
      .map((tab) =>
        tab?.target.kind === "terminal" ? tab.target.session : null,
      )
      .filter((id): id is string => id !== null);
  }

  function isViewingAgentPane(pane: AgentPane): boolean {
    return (
      document.visibilityState === "visible" &&
      document.hasFocus() &&
      pane.shownInShell !== "" &&
      viewedShells().includes(pane.shownInShell)
    );
  }

  /**
   * Ctrl+K のパレットに混ぜる行き先。プロジェクト = 登録したものと tmux から
   * 見つけたもの (選ぶとヘッダの切替と同じ関数で移る)、エージェント = 一覧の
   * エージェント (選ぶとターミナルに開く)、セッション = 通常のシェル、
   * 操作 = キー割り当てのある操作と新しいエージェント。キーは今の割り当てから出す。
   */
  const PALETTE_ACTIONS: ReadonlyArray<{
    id: PaletteActionId;
    keymap?: KeymapAction;
    icon: string | string[];
    suggested: boolean;
    run?: () => void;
  }> = [
    {
      id: "new-agent",
      icon: PLUS_16_PATH,
      suggested: true,
      run: () => launchAgent(),
    },
    {
      id: "open-settings",
      keymap: "open-settings",
      icon: GEAR_16_PATH,
      suggested: true,
    },
    {
      id: "toggle-theme",
      keymap: "toggle-theme",
      icon: MOON_16_PATH,
      suggested: true,
    },
    {
      id: "goto-repo",
      keymap: "goto-repo",
      icon: ARROW_RIGHT_16_PATH,
      suggested: false,
    },
    {
      id: "goto-diff",
      keymap: "goto-diff",
      icon: ARROW_RIGHT_16_PATH,
      suggested: false,
    },
    {
      id: "goto-history",
      keymap: "goto-history",
      icon: ARROW_RIGHT_16_PATH,
      suggested: false,
    },
    {
      id: "goto-worktrees",
      icon: ARROW_RIGHT_16_PATH,
      suggested: false,
      run: () => navigateToRoute({ screen: "worktree", range: currentRange() }),
    },
    {
      id: "goto-database",
      keymap: "goto-database",
      icon: ARROW_RIGHT_16_PATH,
      suggested: false,
    },
    {
      id: "goto-journal",
      keymap: "goto-journal",
      icon: ARROW_RIGHT_16_PATH,
      suggested: false,
    },
    {
      id: "goto-agents",
      keymap: "goto-agents",
      icon: ARROW_RIGHT_16_PATH,
      suggested: false,
    },
    {
      id: "goto-tools",
      icon: BOOK_16_PATH,
      suggested: false,
      run: () => openToolsPage(),
    },
    {
      id: "goto-search",
      icon: SEARCH_16_PATH,
      suggested: false,
      run: () => openSearchPage(),
    },
    {
      id: "toggle-terminal-panel",
      keymap: "toggle-terminal-panel",
      icon: TERMINAL_16_PATHS,
      suggested: false,
    },
    {
      id: "toggle-sidebar",
      keymap: "toggle-sidebar",
      icon: SIDEBAR_SHOW_16_PATHS,
      suggested: false,
    },
    {
      id: "switch-project",
      keymap: "switch-project",
      icon: APPS_16_PATH,
      suggested: false,
    },
    {
      id: "open-help",
      keymap: "open-help",
      icon: QUESTION_16_PATH,
      suggested: false,
    },
  ];

  function paletteCommands(): PaletteCommand[] {
    const t = searchPaletteText(STATE.language);
    const agents = agentsText(STATE.language);
    const overview = AGENT_MONITOR.snapshot().overview;
    const commands: PaletteCommand[] = [];
    // 登録したもの (利用者の並び) を先に、見つけただけのものは名前順で後ろに。
    const projects = [...(overview?.projects ?? [])].sort((a, b) =>
      a.registered && b.registered
        ? 0
        : a.registered
          ? -1
          : b.registered
            ? 1
            : a.name.localeCompare(b.name),
    );
    projects.forEach((info, index) => {
      const current = info.server.status === "current";
      commands.push({
        group: "projects",
        id: `project:${info.root}`,
        title: info.name,
        detail: info.displayRoot,
        status: current ? t.currentProject : "",
        iconHtml: iconSvg("gdp-palette-icon", FOLDER_ICON_PATHS.closed),
        suggested: index < 5,
        run: () => {
          if (!current) void PROJECT_ACTIONS.open(info, currentScreenPath());
        },
      });
    });
    const rank: Record<AgentPane["state"], number> = {
      waiting: 0,
      done: 1,
      working: 2,
      idle: 3,
    };
    // エージェントを先に (状態の順)、ただの tmux のペインを後ろに。候補 (何も
    // 打っていないとき) に出すのはエージェントの上位だけ。
    const panes = [...(overview?.panes ?? [])].sort(
      (a, b) =>
        Number(a.kind === null) - Number(b.kind === null) ||
        rank[a.state] - rank[b.state],
    );
    panes.forEach((pane, index) => {
      commands.push({
        group: pane.kind === null ? "sessions" : "agents",
        id: `pane:${pane.id}`,
        title: paneText(pane, agents).kind,
        detail: paneText(pane, agents).detail,
        status: agents.state[pane.state],
        statusTone: pane.state,
        iconHtml: `<i class="terminal-mark terminal-mark-${pane.state}" aria-hidden="true"></i>`,
        suggested: pane.kind !== null && index < 5,
        run: () => openAgentPane(pane.id),
      });
    });
    // このサーバのシェル (最後に取った一覧。「＋」のメニューを開くたびと、
    // タブを映すときに取り直す)。tmux のペインを映しているシェルは上のペインの
    // 行と同じ行き先なので出さない。
    const terminal = terminalText(STATE.language);
    for (const session of TERMINAL_VIEW.knownShells()?.sessions ?? []) {
      if (paneForShell(session.id)) continue;
      commands.push({
        group: "sessions",
        id: `shell:${session.id}`,
        title: terminalTabInfo(session.id).label,
        detail: session.cwd,
        status: MAIN_TABS.hasTerminal(session.id) ? terminal.inTab : "",
        iconHtml: iconSvg("gdp-palette-icon", TERMINAL_16_PATHS),
        suggested: false,
        run: () => MAIN_TABS.openTerminal(session.id),
      });
    }
    const bindings = activeKeyBindings();
    for (const action of PALETTE_ACTIONS) {
      const binding = action.keymap
        ? bindings.find((item) => item.action === action.keymap)
        : undefined;
      commands.push({
        group: "actions",
        id: `action:${action.id}`,
        title: t.actions[action.id],
        iconHtml: iconSvg("gdp-palette-icon", action.icon),
        shortcut: binding ? formatKeyBinding(binding) : "",
        suggested: action.suggested,
        run: () => {
          if (action.run) action.run();
          else if (action.keymap)
            dispatchKeymapAction(action.keymap, "global", false, null);
        },
      });
    }
    return commands;
  }

  /** 移った先でも同じ画面を開く (ナビで選ばれている画面の入口)。 */
  /** いまの画面のパス (前置きを外したもの)。プロジェクトを移るときの移り先。 */
  function currentScreenPath(): string {
    return projectSwitchPath(
      withoutProjectPrefix(
        document
          .querySelector<HTMLAnchorElement>(
            "a.app-menu-item.active, a.nav-board-link.active",
          )
          ?.getAttribute("href") ?? "/",
      ),
      window.location.search,
    );
  }

  /**
   * エージェントのペインを開く (通知・サイドバー・全体ボード・パレット)。
   * 別のプロジェクトのペインならそのプロジェクトへ移る (agent-pane-opener.ts)。
   */
  function openAgentPane(pane: string, destination?: "opposite"): void {
    AGENT_PANE_OPENER(pane, destination);
  }

  /** この画面のメインの面のタブで開く。サイドバーの修飾操作だけ反対面。 */
  function openAgentPaneHere(pane: string, destination?: "opposite"): void {
    AGENT_MONITOR.markRead(pane);
    const panes = MAIN_TABS.panes();
    const side: PaneSide =
      destination === "opposite"
        ? panes.split
          ? panes.focused === "left"
            ? "right"
            : "left"
          : "right"
        : panes.focused;
    // もうタブで開いていれば、そのタブを前面に出すだけ (シェルを増やさない)。
    const tabbed = [...TAB_SHELL_PANES].find(
      ([shell, opened]) =>
        (opened === pane || paneForShell(shell)?.id === pane) &&
        MAIN_TABS.hasTerminal(shell),
    );
    if (tabbed) {
      MAIN_TABS.openTerminal(
        tabbed[0],
        destination === "opposite" ? side : undefined,
      );
      return;
    }
    void TERMINAL_VIEW.openPaneInTab(pane, side);
  }

  const AGENT_MONITOR = createAgentMonitor({
    getText: () => agentsText(STATE.language),
    getNotifySettings: () => ({
      waiting: APP_SETTINGS.agentNotifyWaiting !== false,
      finished: APP_SETTINGS.agentNotifyDone !== false,
    }),
    isViewing: isViewingAgentPane,
    onUnreadCountChange: (count) => {
      if (count === AGENT_UNREAD_COUNT) return;
      AGENT_UNREAD_COUNT = count;
      applyDocumentTitle();
    },
    onNotificationClick: (pane) => openAgentPane(pane.id),
    actionHeaders,
  });

  const agentStatusButton =
    document.querySelector<HTMLButtonElement>("#agent-status");
  const AGENT_STATUS = agentStatusButton
    ? mountAgentStatus(agentStatusButton, {
        monitor: AGENT_MONITOR,
        getText: () => agentsText(STATE.language),
        openList: () =>
          navigateToRoute({ screen: "agents", range: currentRange() }),
        openPane: openAgentPane,
      })
    : null;

  /** 設定画面を開き、指定の見出しまで送る。 */
  function openSettingsAt(headingId: string): void {
    VIEWER_SETTINGS.revealHeading(headingId);
    openHelpSection(helpSectionDeps(), "settings");
    requestAnimationFrame(() =>
      document.getElementById(headingId)?.scrollIntoView({ block: "start" }),
    );
  }

  let releaseAccounts: (() => void) | null = null;
  const ACCOUNTS_BAND = createAccountsBand({
    client: ACCOUNTS_CLIENT,
    dialogs: ACCOUNT_DIALOGS,
    getText: () => agentsText(STATE.language).accounts,
    hookStateLabel: (state) => agentsText(STATE.language).hooks.state[state],
    getOverview: () => AGENT_MONITOR.snapshot().overview,
    isCollapsed: () => APP_SETTINGS.agentAccountsCollapsed === true,
    setCollapsed: (collapsed) => {
      void patchSettings({ agentAccountsCollapsed: collapsed });
      AGENTS_VIEW?.localize();
    },
    openSettings: () => openSettingsAt(ACCOUNTS_SECTION_ID),
    requestRender: () => AGENTS_VIEW?.localize(),
  });
  ACCOUNTS_CLIENT.subscribe(() => AGENTS_VIEW?.localize());

  const PROJECT_ACTIONS = createProjectActions({
    getText: () => agentsText(STATE.language).projects,
    trackLoad,
    actionHeaders,
    refresh: () => AGENT_MONITOR.refresh(),
    navigate: (url) => window.location.assign(url),
  });

  const AGENT_PANE_OPENER = createAgentPaneOpener({
    overview: () => AGENT_MONITOR.snapshot().overview,
    currentPath: currentScreenPath,
    openProject: (info, path) =>
      PROJECT_ACTIONS.open(info, path, { confirmRegister: false }),
    openHere: openAgentPaneHere,
  });

  const projectSwitcherButton =
    document.querySelector<HTMLElement>("#project-switcher");
  // 名前と枝の名前の幅を、置き場所の幅に合わせて分ける (枝を 1 文字にしない)。
  if (projectSwitcherButton) fitBrand(projectSwitcherButton);
  PROJECT_SWITCHER = projectSwitcherButton
    ? mountProjectSwitcher({
        button: projectSwitcherButton,
        actions: PROJECT_ACTIONS,
        getText: () => agentsText(STATE.language).projects,
        getOverview: () => AGENT_MONITOR.snapshot().overview,
        subscribe: (listener) => AGENT_MONITOR.subscribe(listener),
        currentPath: currentScreenPath,
        currentName: () => PROJECT_NAME,
        shortcutLabel: () => {
          const binding = activeKeyBindings().find(
            (item) => item.action === "switch-project",
          );
          return binding ? formatKeyBinding(binding) : "";
        },
      })
    : null;

  function launchAgent(project?: string): void {
    ACCOUNT_DIALOGS.launch({ project }).then(
      () => AGENTS_VIEW?.localize(),
      (error: unknown) =>
        console.error("[code-viewer] launch dialog failed", error),
    );
  }

  AGENT_MONITOR.subscribe(() => {
    // 開いたときのペインが一覧から消えたら、その対応を捨てる。ペイン ID は
    // tmux サーバの中でしか一意でなく、tmux が起き直すと同じ `%0` が別の
    // ペインに付く (ログインのウィンドウを閉じた後の最初の起動がそう)。
    // 残すと、新しいエージェントを閉じ終わった古いシェルのタブで開いてしまう。
    const overview = AGENT_MONITOR.snapshot().overview;
    if (overview && !overview.tmux.error) {
      const live = new Set(overview.panes.map((pane) => pane.id));
      for (const [shell, pane] of TAB_SHELL_PANES) {
        if (!live.has(pane)) TAB_SHELL_PANES.delete(shell);
      }
    }
    // ターミナルのタブの名前 (エージェントの状態) を当て直す。
    MAIN_TABS.localize();
  });

  /** いまターミナルで見ているエージェントのペイン (サイドバーの選択の印)。 */
  function viewingAgentPane(): string | null {
    const target = viewedShells()[0];
    if (!target) return null;
    return (
      AGENT_MONITOR.snapshot().overview?.panes.find(
        (pane) => pane.shownInShell !== "" && pane.shownInShell === target,
      )?.id ?? null
    );
  }

  const navProjectsRoot = document.querySelector<HTMLElement>("#nav-projects");
  AGENTS_SIDEBAR = navProjectsRoot
    ? mountAgentsSidebar({
        root: navProjectsRoot,
        monitor: AGENT_MONITOR,
        projects: PROJECT_ACTIONS,
        getText: () => agentsText(STATE.language),
        openPane: openAgentPane,
        viewingPane: viewingAgentPane,
        launch: launchAgent,
        openBoard: () =>
          navigateToRoute({ screen: "agents", range: currentRange() }),
        getCollapsed: () => APP_SETTINGS.navCollapsedProjects ?? [],
        currentName: () => PROJECT_NAME,
        saveCollapsed: (roots) =>
          patchSettings({ navCollapsedProjects: roots }),
        notifyHintDismissed: () =>
          APP_SETTINGS.agentNotifyHintDismissed === true,
        dismissNotifyHint: () =>
          patchSettings({ agentNotifyHintDismissed: true }),
      })
    : null;
  document
    .querySelector<HTMLButtonElement>("#nav-launch")
    ?.addEventListener("click", () => launchAgent());

  const appNavElement = document.querySelector<HTMLElement>("#app-nav");
  const appNavResizer = document.querySelector<HTMLElement>("#app-nav-resizer");
  const navCollapse = document.querySelector<HTMLElement>("#nav-collapse");
  const navExpand = document.querySelector<HTMLElement>("#nav-expand");
  APP_NAV =
    appNavElement && appNavResizer && navCollapse && navExpand
      ? mountAppNav({
          nav: appNavElement,
          resizer: appNavResizer,
          collapseButton: navCollapse,
          expandButton: navExpand,
          getWidth: () => APP_SETTINGS.navWidth,
          isCollapsed: () => APP_SETTINGS.navCollapsed === true,
          save: (patch) => patchSettings(patch),
          // 面の幅が変わるので端末の桁数を取り直す。
          onResize: () => TERMINAL_VIEW.refit(),
        })
      : null;

  /** 左のサイドバーの枠の文言 (中の一覧は AGENTS_SIDEBAR が貼る)。 */
  function localizeAppNav(): void {
    const t = agentsText(STATE.language).sidebar;
    document
      .querySelector<HTMLElement>("#app-nav")
      ?.setAttribute("aria-label", t.ariaLabel);
    setElementText(".nav-section-title", t.projects);
    setElementText(".nav-search-label", t.search);
    setElementText(
      ".nav-search-key",
      /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘K" : "Ctrl K",
    );
    setElementText("#nav-launch .nav-foot-label", t.newAgent);
    setElementText("#nav-settings .nav-foot-label", t.settings);
    setElementText("#quick-help-btn .nav-foot-label", t.help);
    for (const [selector, label] of [
      ["#nav-collapse", t.collapse],
      ["#nav-expand", t.expand],
      ["#nav-board-link", t.board],
      ["#app-nav-resizer", t.resize],
    ] as const) {
      const el = document.querySelector<HTMLElement>(selector);
      if (!el) continue;
      el.title = label;
      el.setAttribute("aria-label", label);
    }
  }
  localizeAppNav();

  // 使用量は最下段に常に出すので、アカウントの一覧はずっと取り直す
  // (周期の取り直しは通信中の表示の対象外。accounts-client.ts)。
  ACCOUNTS_CLIENT.retain();
  void ACCOUNTS_CLIENT.load({ background: true });
  const usageStatusRoot = document.querySelector<HTMLElement>("#usage-status");
  const USAGE_STATUS = usageStatusRoot
    ? mountUsageStatus({
        root: usageStatusRoot,
        client: ACCOUNTS_CLIENT,
        getText: () => agentsText(STATE.language),
        openSettings: () => openSettingsAt(ACCOUNTS_SECTION_ID),
        login: (account) => ACCOUNT_DIALOGS.login(account),
      })
    : null;

  AGENTS_VIEW = createAgentsView({
    projects: PROJECT_ACTIONS,
    monitor: AGENT_MONITOR,
    getText: () => agentsText(STATE.language),
    setPageMode,
    syncHeaderMenu,
    openPane: openAgentPane,
    openNotificationSettings: () =>
      openSettingsAt("agent-notify-section-title"),
    getHookStatus: () => AGENT_HOOK_STATUS,
    refreshHookStatus: AGENT_HOOKS_SETTINGS.refresh,
    hookHintDismissed: () => APP_SETTINGS.agentHookHintDismissed === true,
    dismissHookHint: () => patchSettings({ agentHookHintDismissed: true }),
    openHookSettings: () => openSettingsAt(AGENT_HOOKS_SECTION_ID),
    accountsBand: ACCOUNTS_BAND,
    getAccounts: () => ACCOUNTS_CLIENT.snapshot().data,
    launch: launchAgent,
    onVisibilityChange: (visible) => {
      releaseAccounts?.();
      releaseAccounts = null;
      if (visible) {
        releaseAccounts = ACCOUNTS_CLIENT.retain();
        void ACCOUNTS_CLIENT.load();
      }
    },
  });
  relocalizeAgents = () => {
    PROJECT_SWITCHER?.localize();
    AGENTS_VIEW?.localize();
    AGENT_STATUS?.localize();
    AGENTS_SIDEBAR?.localize();
    USAGE_STATUS?.localize();
    localizeAppNav();
  };
  AGENT_MONITOR.start();

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
    onSidebarOwner: (owned) => {
      // 作業ツリーの変更ファイルを書くなら、Files の木はもう使い回せない。
      // 一覧だけの表示なら右の列を Files の木に戻す (読み込み済みなら使い回す)。
      if (owned) invalidateRepoSidebar();
      else showFilesTreeInLeftColumn();
    },
    setStatus,
    createOpenPathButton,
    openPathInOs: (path, kind) => openPathInOs(path, kind),
    getAgents: () => {
      const text = agentsText(STATE.language);
      return (AGENT_MONITOR.snapshot().overview?.panes ?? [])
        .filter((pane) => pane.kind !== null)
        .map((pane) => ({
          path: pane.path,
          kind: pane.kind ? text.kind[pane.kind] : text.kindShell,
          state: pane.state,
          stateLabel: text.state[pane.state],
        }));
    },
    subscribeAgents: (listener) => AGENT_MONITOR.subscribe(listener),
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
    getRecentRefs: () => APP_SETTINGS.recentRefs || [],
    rememberRecentRef: (ref) => {
      const current = APP_SETTINGS.recentRefs || [];
      const next = rememberPaletteSelection(current, ref).slice(
        -MAX_RECENT_REFS,
      );
      if (next.join("\0") === current.join("\0")) return;
      patchSettings({ recentRefs: next });
    },
    recentRefTitle: () => uiText().global.recentRef,
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
  /** 履歴を積まずにその route へ (本文の面を合わせ直すとき)。 */
  function replaceWithRoute(route: AppRoute): void {
    history.replaceState(
      historyStateForRoute(route, true),
      "",
      urlForRoute(route),
    );
    applyRouteFromLocation();
  }

  function navigateToRoute(route: AppRoute): void {
    history.pushState(historyStateForRoute(route), "", urlForRoute(route));
    scrollMainToTop();
    applyRouteFromLocation();
  }

  function applyRouteFromLocation() {
    upgradeLegacyPanelUrl();
    // URL が右の面のファイル (pane=right): 右の面で開き、本文は描き直さない。
    // 右に開けない (1 面で狭い・ファイルでない) なら pane=right を外して本文へ。
    if (parsePaneOverlay(window.location.search) === "right") {
      const paneRoute = normalizeInternalFileRoute(
        parseRoute(routePathname(), window.location.search, currentRange()),
      );
      if (
        paneRoute.screen === "file" &&
        paneRoute.view !== "history" &&
        routeTarget(paneRoute)?.kind === "file" &&
        MAIN_TABS.openRouteRight(paneRoute, true)
      ) {
        showSourceInRight();
        return;
      }
      history.replaceState(
        history.state,
        "",
        withPaneOverlay(
          window.location.pathname + window.location.search,
          null,
        ) + window.location.hash,
      );
    }
    const previousRoute = STATE.route;
    // replaceUrlWithCurrentRoute が ?terminal= を今の状態で書き直す前に読む。
    const terminalParam = parseTerminalOverlay(window.location.search);
    // Leaving the history screen: bring back the range the user had picked
    // for the other screens before the URL fallback below reads it.
    if (
      isHistoryPanelRoute(previousRoute) &&
      routePathname() !== "/history" &&
      !(
        routePathname() === "/file" &&
        new URLSearchParams(window.location.search).get("view") === "history"
      )
    ) {
      restoreRangeAfterHistory();
    }
    const parsedRoute = parseRoute(
      routePathname(),
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
    leaveScreen(previousRoute, nextRoute);
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
    MAIN_TABS.syncRoute(STATE.route);
    syncRefInputs();
    syncHeaderMenu();
    syncLineRefPill();
    syncDoctorSheetFromUrl();
    syncTerminalFromUrl(terminalParam);
    if (
      isSameBlobFileRoute(previousRoute, STATE.route) &&
      routeBlobPreview(previousRoute) !== routeBlobPreview(STATE.route) &&
      SOURCE_VIEW.switchSourceTab(
        routeBlobPreview(STATE.route) ? "preview" : "code",
        { updateRoute: false },
      )
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
    if (STATE.route.screen === "agents") {
      cancelActiveSourceLoad("navigation");
      setPageMode();
      removeStandaloneSource();
      void AGENTS_VIEW?.enter();
      setStatus("live");
      return;
    }
    if (enterToolOrSearchPage()) return;
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
  window.addEventListener("popstate", () => {
    // 戻る・進むは本文 (URL) だけを動かし、タブの配置は変えない。そのファイル
    // のタブが右の面にだけあるなら、左の面に仮のタブを作らずに右の面の前面に
    // 出す (分割した後の戻るで、左に同じファイルが開き直っていた)。
    if (frontRightTabForLocation()) return;
    applyRouteFromLocation();
    restoreMainScroll();
  });

  /** 今の URL (右の面の印なし) のファイルのタブが右の面にだけあれば前面に出して true。 */
  function frontRightTabForLocation(): boolean {
    if (parsePaneOverlay(window.location.search) === "right") return false;
    const route = normalizeInternalFileRoute(
      parseRoute(routePathname(), window.location.search, currentRange()),
    );
    if (
      route.screen !== "file" ||
      route.view === "history" ||
      routeTarget(route)?.kind !== "file" ||
      MAIN_TABS.sideHolding(route) !== "right"
    )
      return false;
    return openInRightPane(route, true);
  }
  // 本文の箱の位置を、いまの履歴の項に覚え続ける (scroll は上がってこないので
  // capture で受ける)。
  document.addEventListener(
    "scroll",
    (event) => {
      if (event.target === mainScrollBox()) rememberMainScroll();
    },
    { capture: true, passive: true },
  );
  window.addEventListener("pagehide", () => {
    flushViewStatePatch(true);
    MAIN_TABS.flush(true);
  });

  // Header logo and menu links navigate within the SPA. A full page load here
  // re-lays-out the whole app from scratch (the layout shift the menu was
  // notorious for); pushState + the shared route handler keeps the chrome
  // stable. The panel is independent from the page route, so carry its current
  // state to the destination URL. Modified clicks (new tab etc.) keep native
  // anchor behavior.
  document
    .querySelectorAll<HTMLAnchorElement>(ROUTE_LINK_SELECTOR)
    .forEach((link) => {
      // External links (the GitHub repo link) keep native anchor behavior;
      // hijacking them would push their pathname onto the local origin.
      if (link.target === "_blank") return;
      link.addEventListener("click", (e) => {
        if (isNativeLinkClick(e)) return;
        e.preventDefault();
        // 画面の入口 (木の見出しの絵柄の列) と全体ボードは、その画面のタブが
        // 開いていれば、そのタブが最後に見ていた状態を前面に出す。Files は
        // タブではなく本文の既定なので、左の面の選択を外して出す。
        const page = link.dataset.route;
        if (link.matches("a.app-menu-item") && page === "repo") {
          MAIN_TABS.showHome();
          return;
        }
        const stored =
          link.matches("a.app-menu-item, a.nav-board-link") && isPageKind(page)
            ? MAIN_TABS.routeForPage(page)
            : null;
        if (stored) {
          navigateToRoute(stored);
          return;
        }
        const target = new URL(link.href, window.location.origin);
        history.pushState(
          null,
          "",
          withOverlayState(target.pathname + target.search),
        );
        // Mimic a fresh page load: menu navigation starts at the top.
        scrollMainToTop();
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
    getLanguage: () => STATE.language,
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
    getLanguage: () => STATE.language,
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
      // 通知がパス精度を失っていても (tick / ディレクトリ丸め)、見ている
      // ファイルが実際に変わったときだけ再描画する。変わっていなければ
      // 画面には一切触れない。
      refreshFileRouteIfChanged(route);
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
    // 位置を持っているのは本文の箱 (窓は動かない)。
    const box = mainScrollBox();
    const savedScroll = box?.scrollTop ?? 0;
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
      if (box) box.scrollTop = savedScroll;
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
    const es = new EventSource(apiUrl("events"));
    eventSource = es;
    es.addEventListener("update", (event) => {
      const raw = (event as MessageEvent).data;
      let paths: string[] | null = null;
      if (raw && raw !== "tick") {
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed.paths)) paths = parsed.paths;
        } catch (error) {
          // 壊れた本文でも、変わったことは確か。どのファイルかが分からない
          // だけなので、全体を読み直す (paths = null) 形で続ける。本文は残す。
          console.error(
            "[code-viewer] the SSE update event has a body that is not JSON; reloading everything",
            raw,
            error,
          );
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
    es.addEventListener("error", () => {
      setStatus("error");
      // 入口のサーバの下で、裏のプロセスが止まっていると入口は 502 を返し、
      // EventSource は繋ぎ直しをやめる。理由と再起動を出すため、同じ入口に
      // 1 回だけ問い合わせる (応答は inspectBackendResponse が見る)。
      if (projectKey() && es.readyState === EventSource.CLOSED) {
        void fetch(apiUrl("settings")).catch((error: unknown) => {
          console.error("[code-viewer] project process check failed", error);
        });
      }
    });
    es.addEventListener("open", () => {
      setStatus("live");
      if (!openedOnce) {
        openedOnce = true;
        return;
      }
      catchUpMissedChanges("reconnect");
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
  // 入口の下で、このプロジェクトの裏を起こしている最中なら「起動中」を出す。
  // 画面の組み立てが終わってから聞く (fetch の包みと状態表示を使うため)。
  if (projectKey()) {
    BACKEND_STATE.checkStarting().catch((error: unknown) =>
      reportPersistenceError(
        "check the state of this project's process",
        error,
      ),
    );
  }

  function catchUpMissedChanges(reason: CatchUpReason) {
    const historyWorktreeSelected = HISTORY_VIEW.isWorktreeSelected();
    const kind = catchUpKind(STATE.route, { historyWorktreeSelected });
    if (!kind) return;
    if (!catchUpGate(reason)) return;
    if (kind === "files") {
      scheduleSseLoad(null);
      return;
    }
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
    catchUpMissedChanges("visible");
    void ANNOTATIONS_UI?.refreshAnnotations();
  });
  window.addEventListener("focus", () => {
    scheduleEventSourceConnect();
    catchUpMissedChanges("visible");
    void ANNOTATIONS_UI?.refreshAnnotations();
  });
})();
