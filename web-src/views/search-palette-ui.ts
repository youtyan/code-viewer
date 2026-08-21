// Search palette (Ctrl+K file / Ctrl+G grep): overlay UI, ranked file
// matching, repo-wide grep, and result navigation. Extracted from app.ts.

import { attachDragResizer } from "../core/drag-resizer";
import { isTestFilePath } from "../core/file-filter";
import {
  getPanelFocusScope,
  type PanelFocusScope,
  restorePanelFocusScope,
  setPanelFocusScope,
} from "../core/focus-scope";
import {
  type FuzzyRange,
  fuzzyMatchPath,
  globMatchPath,
  isGlobPathQuery,
  type PathMatchStats,
  rankPathMatches,
} from "../core/fuzzy-search";
import { isImeComposing } from "../core/keyboard";
import type { AppRoute } from "../core/routes";
import {
  limitPaletteResults,
  MAX_GREP_PALETTE_HEIGHT,
  MAX_GREP_PALETTE_WIDTH,
  MIN_GREP_PALETTE_HEIGHT,
  MIN_GREP_PALETTE_WIDTH,
  movePaletteSelection,
  PALETTE_RESULT_LIMIT,
  rankPaletteResultsByHistory,
  rememberPaletteSelection,
} from "../core/search-palette";
import type { ShikiHighlighter } from "../core/shiki-loader";
import { normalizeSourceShikiLang } from "../core/source-meta";
import type {
  FileMeta,
  FileRangeResponse,
  FileSearchListResponse,
  GrepResponse,
} from "../core/types";
import {
  type SearchPaletteLanguage,
  searchPaletteText,
} from "./search-palette-i18n";

export type SearchPaletteDeps = {
  setRoute(route: AppRoute, replace?: boolean): void;
  currentRange(): { from: string; to: string };
  appendScopeParams(params: URLSearchParams): void;
  isAbortError(err: unknown): boolean;
  scrollToFile(path: string, line?: unknown): void;
  applySourceRouteToShell(): void;
  fileSourceTarget(file: FileMeta): { path: string; ref: string };
  renderStandaloneSource(target: {
    path: string;
    ref: string;
  }): Promise<unknown>;
  repoFileCacheKey(ref: string): string;
  trackLoad: <T>(promise: Promise<T>) => Promise<T>;
  getServerGeneration(): number;
  getSyntaxHighlight(): boolean;
  inferLang(path: string): string | null;
  loadSourceShikiHighlighter(lang: string): Promise<ShikiHighlighter | null>;
  sourceShikiLines(
    textValue: string,
    lang: string,
    highlighter: ShikiHighlighter,
  ): string[] | null;
  getLanguage(): SearchPaletteLanguage;
  getFileSelectionHistory(): string[];
  getGrepSelectionHistory(): string[];
  getGrepRegex(): boolean;
  getGrepHideTests(): boolean;
  getGrepGroupByFile(): boolean;
  getGrepPaletteWidth(): number | undefined;
  getGrepPaletteHeight(): number | undefined;
  persistGrepSettings(patch: {
    fileSelectionHistory?: string[];
    grepSelectionHistory?: string[];
    grepRegex?: boolean;
    hideTests?: boolean;
    grepGroupByFile?: boolean;
    grepPaletteWidth?: number;
    grepPaletteHeight?: number;
  }): Promise<void>;
  applyGrepHideTests(hidden: boolean): void;
  STATE: {
    route: AppRoute;
    files: FileMeta[];
    repoRef: string;
    to: string;
  };
};

export function createSearchPalette(deps: SearchPaletteDeps) {
  const {
    STATE,
    setRoute,
    currentRange,
    appendScopeParams,
    isAbortError,
    scrollToFile,
    applySourceRouteToShell,
    fileSourceTarget,
    renderStandaloneSource,
    repoFileCacheKey,
    trackLoad,
    getServerGeneration,
    getSyntaxHighlight,
    inferLang,
    loadSourceShikiHighlighter,
    sourceShikiLines,
    getLanguage,
    getFileSelectionHistory,
    getGrepSelectionHistory,
    getGrepRegex,
    getGrepHideTests,
    getGrepGroupByFile,
    getGrepPaletteWidth,
    getGrepPaletteHeight,
    persistGrepSettings,
    applyGrepHideTests,
  } = deps;

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
    matchText?: string;
    query: string;
    regex: boolean;
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
    preview: HTMLElement;
    mode: PaletteMode;
    grepRegex: boolean;
    grepHideTests: boolean;
    grepGroupByFile: boolean;
    grepPaletteWidth: number;
    grepPaletteHeight: number;
    fileHistory: string[];
    grepHistory: string[];
    selected: number;
    items: PaletteItem[];
    composing: boolean;
    controller?: AbortController;
    previewController?: AbortController;
    previewGeneration: number;
    previewKey: string;
    settingsPending: boolean;
    opening: boolean;
    pointerClientX: number | null;
    pointerClientY: number | null;
    debounce?: number;
    diffSnapshot: FileMeta[];
    previousFocusScope: PanelFocusScope | null;
    detachResizers: Array<() => void>;
  };
  let PALETTE: PaletteState | null = null;
  // Last query typed per mode. Reopening a palette restores it (selected, so
  // typing replaces it); switching Ctrl+K <-> Ctrl+G carries the live query
  // over instead. Session-scoped on purpose: not persisted to settings.
  const LAST_QUERY: Record<PaletteMode, string> = { file: "", grep: "" };
  let repoFileRequestGeneration = 0;
  const GREP_CONTEXT_RADIUS = 5;
  const FILE_PREVIEW_LINE_LIMIT = 200;
  const REPO_FILE_CACHE = new Map<string, FileSearchListResponse>();
  const text = () => searchPaletteText(getLanguage());

  function clampGrepPaletteWidth(width: number): number {
    const viewportMax = Math.min(
      MAX_GREP_PALETTE_WIDTH,
      Math.max(1, window.innerWidth - 48),
    );
    const viewportMin = Math.min(MIN_GREP_PALETTE_WIDTH, viewportMax);
    return Math.max(viewportMin, Math.min(viewportMax, Math.round(width)));
  }

  function clampGrepPaletteHeight(height: number): number {
    const viewportMax = Math.min(
      MAX_GREP_PALETTE_HEIGHT,
      Math.max(1, window.innerHeight - 48),
    );
    const viewportMin = Math.min(MIN_GREP_PALETTE_HEIGHT, viewportMax);
    return Math.max(viewportMin, Math.min(viewportMax, Math.round(height)));
  }

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
    LAST_QUERY[PALETTE.mode] = PALETTE.input.value;
    const previousFocusScope = PALETTE.previousFocusScope;
    PALETTE.controller?.abort();
    PALETTE.previewController?.abort();
    for (const detach of PALETTE.detachResizers) detach();
    if (PALETTE.debounce) window.clearTimeout(PALETTE.debounce);
    PALETTE.root.remove();
    PALETTE = null;
    restorePanelFocusScope(previousFocusScope);
  }

  function createPalette(mode: PaletteMode): PaletteState {
    const previousFocusScope = PALETTE
      ? PALETTE.previousFocusScope
      : getPanelFocusScope();
    // Mode switch while open: keep what the user typed. Fresh open: restore
    // the last query of that mode.
    const initialQuery = PALETTE ? PALETTE.input.value : LAST_QUERY[mode];
    closeSearchPalette();
    const root = document.createElement("div");
    root.className = "gdp-palette-backdrop";
    root.classList.add("gdp-palette-backdrop-wide");
    const dialog = document.createElement("div");
    dialog.className = "gdp-palette";
    dialog.classList.add("gdp-palette-wide");
    dialog.classList.toggle("gdp-palette-grep", mode === "grep");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    const savedWidth = getGrepPaletteWidth();
    const savedHeight = getGrepPaletteHeight();
    if (savedWidth !== undefined)
      dialog.style.width = `${clampGrepPaletteWidth(savedWidth)}px`;
    if (savedHeight !== undefined)
      dialog.style.height = `${clampGrepPaletteHeight(savedHeight)}px`;
    const label = document.createElement("div");
    label.className = "gdp-palette-label";
    for (const switchMode of ["file", "grep"] as const) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "gdp-palette-mode-button gdp-palette-mode-switch";
      button.setAttribute("aria-pressed", String(switchMode === mode));
      button.textContent = switchMode === "file" ? text().files : text().grep;
      button.title =
        switchMode === "file" ? text().switchToFiles : text().switchToGrep;
      button.addEventListener("mousedown", (event) => {
        event.preventDefault();
        if (switchMode !== mode) createPalette(switchMode);
      });
      label.appendChild(button);
    }
    const input = document.createElement("input");
    input.className = "gdp-palette-input";
    input.type = "search";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.placeholder =
      mode === "file" ? text().searchFiles : text().searchText;
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-expanded", "true");
    input.setAttribute("aria-controls", "gdp-palette-list");
    input.value = initialQuery;
    const status = document.createElement("div");
    status.className = "gdp-palette-status";
    const controls = document.createElement("div");
    controls.className = "gdp-palette-controls";
    const list = document.createElement("div");
    list.id = "gdp-palette-list";
    list.className = "gdp-palette-list";
    list.setAttribute("role", "listbox");
    const preview = document.createElement("div");
    preview.className = "gdp-palette-preview";
    preview.setAttribute(
      "aria-label",
      mode === "grep" ? text().grepCodeContext : text().fileCodePreview,
    );
    const body = document.createElement("div");
    body.className = "gdp-palette-body";
    body.append(list, preview);
    dialog.append(label, input, controls, status, body);
    const resizeX = document.createElement("div");
    const resizeY = document.createElement("div");
    resizeX.className = "gdp-palette-resizer gdp-palette-resizer-x";
    resizeX.role = "separator";
    resizeX.tabIndex = 0;
    resizeX.setAttribute("aria-orientation", "vertical");
    resizeX.setAttribute("aria-label", text().resizeWidth);
    resizeY.className = "gdp-palette-resizer gdp-palette-resizer-y";
    resizeY.role = "separator";
    resizeY.tabIndex = 0;
    resizeY.setAttribute("aria-orientation", "horizontal");
    resizeY.setAttribute("aria-label", text().resizeHeight);
    dialog.append(resizeX, resizeY);
    root.appendChild(dialog);
    document.body.appendChild(root);
    const dialogRect = dialog.getBoundingClientRect();
    const state: PaletteState = {
      root,
      input,
      controls,
      list,
      status,
      preview,
      mode,
      grepRegex: getGrepRegex(),
      grepHideTests: getGrepHideTests(),
      grepGroupByFile: getGrepGroupByFile(),
      grepPaletteWidth: clampGrepPaletteWidth(savedWidth ?? dialogRect.width),
      grepPaletteHeight: clampGrepPaletteHeight(
        savedHeight ?? dialogRect.height,
      ),
      fileHistory: [...getFileSelectionHistory()],
      grepHistory: [...getGrepSelectionHistory()],
      selected: -1,
      items: [],
      composing: false,
      previewGeneration: 0,
      previewKey: "",
      settingsPending: false,
      opening: false,
      pointerClientX: null,
      pointerClientY: null,
      diffSnapshot: [...STATE.files],
      previousFocusScope,
      detachResizers: [],
    };
    PALETTE = state;
    state.detachResizers.push(
      attachDragResizer({
        handle: resizeX,
        getSize: () => dialog.getBoundingClientRect().width,
        applySize: (width) => {
          state.grepPaletteWidth = clampGrepPaletteWidth(width);
          dialog.style.width = `${state.grepPaletteWidth}px`;
        },
        direction: 1,
        axis: "x",
        onEnd: () =>
          void persistGrepAppearance(
            state,
            { grepPaletteWidth: state.grepPaletteWidth },
            text().windowWidth,
          ),
        activeClassTarget: dialog,
        activeClassName: "gdp-palette-resizing",
      }),
      attachDragResizer({
        handle: resizeY,
        getSize: () => dialog.getBoundingClientRect().height,
        applySize: (height) => {
          state.grepPaletteHeight = clampGrepPaletteHeight(height);
          dialog.style.height = `${state.grepPaletteHeight}px`;
        },
        direction: 1,
        axis: "y",
        onEnd: () =>
          void persistGrepAppearance(
            state,
            { grepPaletteHeight: state.grepPaletteHeight },
            text().windowHeight,
          ),
        activeClassTarget: dialog,
        activeClassName: "gdp-palette-resizing",
      }),
    );
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
    // A restored / carried query is selected so typing starts over while
    // Enter still opens the first result of the previous query.
    if (input.value) input.select();
    updatePaletteResults(state);
    return state;
  }

  function createExcludeTestsButton(state: PaletteState): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "gdp-palette-mode-button";
    button.setAttribute("aria-pressed", String(state.grepHideTests));
    button.textContent = text().excludeTests;
    button.title = text().excludeTestsTitle;
    button.disabled = state.settingsPending;
    button.addEventListener("mousedown", (event) => {
      event.preventDefault();
      void updateGrepHideTests(state, !state.grepHideTests);
    });
    return button;
  }

  function renderPaletteControls(state: PaletteState) {
    state.controls.innerHTML = "";
    if (state.mode === "file") {
      const hint = document.createElement("span");
      hint.className = "gdp-palette-mode-hint";
      hint.textContent = isGlobPathQuery(state.input.value)
        ? text().globHint
        : text().fuzzyHint;
      state.controls.append(createExcludeTestsButton(state), hint);
      return;
    }
    const plain = document.createElement("button");
    plain.type = "button";
    plain.className = "gdp-palette-mode-button";
    plain.setAttribute("aria-pressed", String(!state.grepRegex));
    plain.textContent = text().plain;
    plain.disabled = state.settingsPending;
    plain.addEventListener("mousedown", (e) => {
      e.preventDefault();
      void updateGrepRegex(state, false);
    });
    const regex = document.createElement("button");
    regex.type = "button";
    regex.className = "gdp-palette-mode-button";
    regex.setAttribute("aria-pressed", String(state.grepRegex));
    regex.textContent = text().regex;
    regex.title = "Alt+R";
    regex.disabled = state.settingsPending;
    regex.addEventListener("mousedown", (e) => {
      e.preventDefault();
      void updateGrepRegex(state, true);
    });
    const excludeTests = createExcludeTestsButton(state);
    const groupFiles = document.createElement("button");
    groupFiles.type = "button";
    groupFiles.className = "gdp-palette-mode-button";
    groupFiles.setAttribute("aria-pressed", String(state.grepGroupByFile));
    groupFiles.textContent = text().groupFiles;
    groupFiles.title = text().groupFilesTitle;
    groupFiles.disabled = state.settingsPending;
    groupFiles.addEventListener("mousedown", (e) => {
      e.preventDefault();
      void updateGrepGroupByFile(state, !state.grepGroupByFile);
    });
    const hint = document.createElement("span");
    hint.className = "gdp-palette-mode-hint";
    hint.textContent = text().regexHint;
    state.controls.append(plain, regex, excludeTests, groupFiles, hint);
  }

  function errorMessage(err: unknown, fallback: string): string {
    return err instanceof Error && err.message ? err.message : fallback;
  }

  function responseGenerationIsStale(
    responseGeneration: number | undefined,
  ): boolean {
    const currentGeneration = getServerGeneration();
    return (
      responseGeneration !== undefined &&
      currentGeneration > 0 &&
      responseGeneration < currentGeneration
    );
  }

  async function persistGrepAppearance(
    state: PaletteState,
    patch: {
      grepGroupByFile?: boolean;
      grepPaletteWidth?: number;
      grepPaletteHeight?: number;
    },
    label: string,
  ): Promise<void> {
    try {
      await persistGrepSettings(patch);
    } catch (err) {
      console.error(`Failed to save grep ${label}`, err);
      if (PALETTE === state) {
        state.status.textContent = text().saveFailed(
          label,
          errorMessage(err, text().unknownError),
        );
      }
    }
  }

  async function updateGrepGroupByFile(
    state: PaletteState,
    grouped: boolean,
  ): Promise<void> {
    if (state.settingsPending || grouped === state.grepGroupByFile) return;
    const previous = state.grepGroupByFile;
    state.grepGroupByFile = grouped;
    state.settingsPending = true;
    renderPaletteControls(state);
    renderPalette(state);
    try {
      await persistGrepSettings({ grepGroupByFile: grouped });
    } catch (err) {
      console.error("Failed to save grep grouping", err);
      state.grepGroupByFile = previous;
      if (PALETTE === state) {
        state.status.textContent = text().saveFailed(
          text().fileGrouping,
          errorMessage(err, text().unknownError),
        );
        renderPalette(state);
      }
    } finally {
      state.settingsPending = false;
      if (PALETTE === state) {
        renderPaletteControls(state);
        state.input.focus();
      }
    }
  }

  async function updateGrepRegex(
    state: PaletteState,
    regex: boolean,
  ): Promise<void> {
    if (state.settingsPending || regex === state.grepRegex) return;
    const previous = state.grepRegex;
    state.grepRegex = regex;
    state.settingsPending = true;
    renderPaletteControls(state);
    try {
      await persistGrepSettings({ grepRegex: regex });
      if (PALETTE === state) updatePaletteResults(state);
    } catch (err) {
      console.error("Failed to save grep regex mode", err);
      state.grepRegex = previous;
      if (PALETTE === state) {
        state.status.textContent = text().saveFailed(
          text().regexMode,
          errorMessage(err, text().unknownError),
        );
      }
    } finally {
      state.settingsPending = false;
      if (PALETTE === state) {
        renderPaletteControls(state);
        state.input.focus();
      }
    }
  }

  async function updateGrepHideTests(
    state: PaletteState,
    hidden: boolean,
  ): Promise<void> {
    if (state.settingsPending || hidden === state.grepHideTests) return;
    const previous = state.grepHideTests;
    state.grepHideTests = hidden;
    state.settingsPending = true;
    renderPaletteControls(state);
    try {
      await persistGrepSettings({ hideTests: hidden });
      applyGrepHideTests(hidden);
      if (PALETTE === state) updatePaletteResults(state);
    } catch (err) {
      console.error("Failed to save grep test exclusion", err);
      state.grepHideTests = previous;
      if (PALETTE === state) {
        state.status.textContent = text().saveFailed(
          text().testExclusion,
          errorMessage(err, text().unknownError),
        );
      }
    } finally {
      state.settingsPending = false;
      if (PALETTE === state) {
        renderPaletteControls(state);
        state.input.focus();
      }
    }
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

  function grepMatchRange(
    lineText: string,
    item: PaletteGrepItem,
  ): { start: number; end: number } | null {
    const matchText = item.matchText || (item.regex ? "" : item.query);
    if (!matchText) return null;
    const caseSensitive = item.regex || /[A-Z]/.test(item.query);
    const haystack = caseSensitive ? lineText : lineText.toLowerCase();
    const needle = caseSensitive ? matchText : matchText.toLowerCase();
    const expectedStart = Math.max(0, item.column - 1);
    let bestStart = -1;
    let cursor = haystack.indexOf(needle);
    while (cursor >= 0) {
      if (
        bestStart < 0 ||
        Math.abs(cursor - expectedStart) < Math.abs(bestStart - expectedStart)
      )
        bestStart = cursor;
      cursor = haystack.indexOf(needle, cursor + Math.max(1, needle.length));
    }
    return bestStart < 0
      ? null
      : { start: bestStart, end: bestStart + matchText.length };
  }

  function highlightGrepMatch(
    cell: HTMLElement,
    lineText: string,
    item: PaletteGrepItem,
  ): void {
    const match = grepMatchRange(lineText, item);
    if (!match) return;
    const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
    const parts: Array<{ node: Text; start: number; end: number }> = [];
    let offset = 0;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const textNode = node as Text;
      const nextOffset = offset + textNode.data.length;
      const start = Math.max(match.start, offset);
      const end = Math.min(match.end, nextOffset);
      if (start < end)
        parts.push({
          node: textNode,
          start: start - offset,
          end: end - offset,
        });
      offset = nextOffset;
    }
    for (const part of parts.reverse()) {
      const selected = part.node.splitText(part.start);
      selected.splitText(part.end - part.start);
      const mark = document.createElement("mark");
      mark.className = "gdp-grep-match";
      const parent = selected.parentNode;
      if (!parent) throw new Error("grep match text is detached");
      parent.insertBefore(mark, selected);
      mark.appendChild(selected);
    }
  }

  function palettePreviewTarget(item: PaletteItem): {
    path: string;
    ref: string;
  } {
    return item.kind === "file"
      ? {
          path: item.targetPath || item.path,
          ref: item.targetRef || item.ref,
        }
      : { path: item.path, ref: item.ref };
  }

  function renderPalettePreviewFrame(
    state: PaletteState,
    item: PaletteItem,
    message?: string,
  ): HTMLElement {
    state.preview.innerHTML = "";
    const header = document.createElement("div");
    header.className = "gdp-palette-preview-header";
    const location = document.createElement("div");
    location.className = "gdp-palette-preview-location";
    const target = palettePreviewTarget(item);
    location.textContent =
      item.kind === "grep" ? `${item.path}:${item.line}` : target.path;
    location.title =
      item.kind === "grep"
        ? `${item.path}:${item.line}:${item.column}`
        : target.path;
    const openButton = document.createElement("button");
    openButton.type = "button";
    openButton.className = "gdp-btn gdp-btn-sm";
    openButton.textContent = text().openFile;
    openButton.addEventListener("mousedown", (event) => event.preventDefault());
    openButton.addEventListener("click", () => {
      void selectPaletteItem(state);
    });
    header.append(location, openButton);
    const body = document.createElement("div");
    body.className = "gdp-palette-preview-code";
    if (message) {
      const status = document.createElement("div");
      status.className = "gdp-palette-preview-message";
      status.textContent = message;
      body.appendChild(status);
    }
    state.preview.append(header, body);
    return body;
  }

  function clearPalettePreview(state: PaletteState, message: string): void {
    state.previewController?.abort();
    state.previewController = undefined;
    state.previewKey = "";
    state.preview.innerHTML = "";
    const placeholder = document.createElement("div");
    placeholder.className = "gdp-palette-preview-placeholder";
    placeholder.textContent = message;
    state.preview.appendChild(placeholder);
  }

  function palettePreviewIsCurrent(
    state: PaletteState,
    controller: AbortController,
    previewGeneration: number,
  ): boolean {
    return (
      PALETTE === state &&
      !controller.signal.aborted &&
      previewGeneration === state.previewGeneration
    );
  }

  function renderPalettePreview(state: PaletteState): void {
    const item = state.items[state.selected];
    if (!item) {
      clearPalettePreview(state, text().selectResult);
      return;
    }
    const target = palettePreviewTarget(item);
    const previewKey = `${item.kind}\0${target.ref}\0${target.path}\0${item.kind === "grep" ? item.line : ""}`;
    if (previewKey === state.previewKey) return;
    state.previewKey = previewKey;
    state.previewController?.abort();
    const controller = new AbortController();
    state.previewController = controller;
    const previewGeneration = ++state.previewGeneration;
    const start =
      item.kind === "grep" ? Math.max(1, item.line - GREP_CONTEXT_RADIUS) : 1;
    const end =
      item.kind === "grep"
        ? item.line + GREP_CONTEXT_RADIUS
        : FILE_PREVIEW_LINE_LIMIT;
    renderPalettePreviewFrame(state, item, text().loadingCode);
    const params = new URLSearchParams({
      path: target.path,
      ref: target.ref,
      start: String(start),
      end: String(end),
    });
    void trackLoad<FileRangeResponse>(
      fetch(`/file_range?${params.toString()}`, {
        signal: controller.signal,
      }).then(async (response) => {
        if (!response.ok) throw new Error(await response.text());
        return response.json();
      }),
    )
      .then(async (response) => {
        if (!palettePreviewIsCurrent(state, controller, previewGeneration))
          return;
        if (responseGenerationIsStale(response.generation)) {
          renderPalettePreviewFrame(state, item, text().fileChanged);
          return;
        }
        const body = renderPalettePreviewFrame(state, item);
        const meta = document.createElement("div");
        meta.className = "gdp-palette-preview-meta";
        meta.textContent = text().lines(
          response.start,
          Math.min(
            response.end,
            response.start + Math.max(0, response.lines.length - 1),
          ),
          response.complete ? response.total : undefined,
        );
        body.appendChild(meta);
        const table = document.createElement("table");
        table.className = "gdp-source-table";
        const tbody = document.createElement("tbody");
        response.lines.forEach((text, index) => {
          const line = response.start + index;
          const row = document.createElement("tr");
          row.dataset.line = String(line);
          row.classList.toggle(
            "gdp-source-line-target",
            item.kind === "grep" && line === item.line,
          );
          const number = document.createElement("td");
          number.className = "gdp-source-line-number";
          number.textContent = String(line);
          const content = document.createElement("td");
          content.className = "gdp-source-line-code";
          content.textContent = text || " ";
          if (item.kind === "grep" && line === item.line)
            highlightGrepMatch(content, text, item);
          row.append(number, content);
          tbody.appendChild(row);
        });
        table.appendChild(tbody);
        if (response.lines.length === 0) {
          const empty = document.createElement("div");
          empty.className = "gdp-palette-preview-message";
          empty.textContent = text().noText;
          body.appendChild(empty);
        } else {
          body.appendChild(table);
        }
        const lang = normalizeSourceShikiLang(inferLang(target.path));
        if (!getSyntaxHighlight() || !lang || response.lines.length === 0)
          return;
        const highlighter = await loadSourceShikiHighlighter(lang);
        if (
          !highlighter ||
          !table.isConnected ||
          !palettePreviewIsCurrent(state, controller, previewGeneration)
        )
          return;
        const highlightedLines = sourceShikiLines(
          response.lines.join("\n"),
          lang,
          highlighter,
        );
        if (
          !highlightedLines ||
          !table.isConnected ||
          !palettePreviewIsCurrent(state, controller, previewGeneration)
        )
          return;
        table
          .querySelectorAll<HTMLElement>(".gdp-source-line-code")
          .forEach((cell, index) => {
            if (highlightedLines[index] == null) return;
            cell.innerHTML = highlightedLines[index] || " ";
            cell.classList.add("shiki");
            if (item.kind === "grep" && response.start + index === item.line)
              highlightGrepMatch(cell, response.lines[index] || "", item);
          });
      })
      .catch((err) => {
        if (
          isAbortError(err) ||
          PALETTE !== state ||
          controller.signal.aborted ||
          previewGeneration !== state.previewGeneration
        )
          return;
        console.error("Failed to load search code preview", err);
        renderPalettePreviewFrame(
          state,
          item,
          text().codeLoadFailed(errorMessage(err, text().unknownError)),
        );
      });
  }

  function createPaletteRow(
    state: PaletteState,
    item: PaletteItem,
    index: number,
    grouped: boolean,
  ): HTMLButtonElement {
    const row = document.createElement("button");
    row.type = "button";
    row.id = `gdp-palette-item-${index}`;
    row.dataset.paletteIndex = String(index);
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
      title.textContent = grouped
        ? text().line(item.line, item.column)
        : `${item.path}:${item.line}`;
      detail.textContent = item.preview;
    }
    row.append(title, detail);
    row.addEventListener("mousemove", (event) => {
      if (
        state.pointerClientX === event.clientX &&
        state.pointerClientY === event.clientY
      )
        return;
      state.pointerClientX = event.clientX;
      state.pointerClientY = event.clientY;
      if (state.selected === index) return;
      state.selected = index;
      syncPaletteSelection(state);
    });
    row.addEventListener("mousedown", (e) => {
      e.preventDefault();
      state.selected = index;
      syncPaletteSelection(state);
    });
    row.addEventListener("click", (e) => {
      e.preventDefault();
      state.selected = index;
      syncPaletteSelection(state);
      void selectPaletteItem(state);
    });
    return row;
  }

  function renderPalette(state: PaletteState) {
    state.list.innerHTML = "";
    if (state.mode === "grep" && state.grepGroupByFile) {
      const grouped = new Map<
        string,
        Array<{ item: PaletteGrepItem; index: number }>
      >();
      state.items.forEach((item, index) => {
        if (item.kind !== "grep") return;
        const matches = grouped.get(item.path) ?? [];
        matches.push({ item, index });
        grouped.set(item.path, matches);
      });
      for (const [path, matches] of grouped) {
        const group = document.createElement("section");
        group.className = "gdp-palette-file-group";
        group.setAttribute("role", "group");
        group.setAttribute("aria-label", path);
        const heading = document.createElement("div");
        heading.className = "gdp-palette-file-heading";
        const name = document.createElement("span");
        name.className = "gdp-palette-file-heading-name";
        name.textContent = path;
        name.title = path;
        const count = document.createElement("span");
        count.className = "gdp-palette-file-heading-count";
        count.textContent = String(matches.length);
        heading.append(name, count);
        const rows = document.createElement("div");
        rows.className = "gdp-palette-file-matches";
        for (const match of matches) {
          rows.appendChild(
            createPaletteRow(state, match.item, match.index, true),
          );
        }
        group.append(heading, rows);
        state.list.appendChild(group);
      }
    } else {
      state.items.forEach((item, index) => {
        state.list.appendChild(createPaletteRow(state, item, index, false));
      });
    }
    syncPaletteSelection(state);
  }

  function syncPaletteSelection(state: PaletteState) {
    state.input.setAttribute(
      "aria-activedescendant",
      state.selected >= 0 ? `gdp-palette-item-${state.selected}` : "",
    );
    state.list
      .querySelectorAll<HTMLElement>(".gdp-palette-row")
      .forEach((row) => {
        const index = Number(row.dataset.paletteIndex);
        row.setAttribute(
          "aria-selected",
          index === state.selected ? "true" : "false",
        );
        if (index === state.selected) {
          const group = row.closest<HTMLElement>(".gdp-palette-file-group");
          if (group?.querySelector(".gdp-palette-row") === row) {
            group
              .querySelector<HTMLElement>(".gdp-palette-file-heading")
              ?.scrollIntoView({ block: "nearest" });
          }
          row.scrollIntoView({ block: "nearest" });
        }
      });
    renderPalettePreview(state);
  }

  async function repoPaletteFiles(
    ref: string,
  ): Promise<FileSearchListResponse> {
    const cacheKey = repoFileCacheKey(ref);
    const cached = REPO_FILE_CACHE.get(cacheKey);
    if (cached && cached.generation === getServerGeneration()) return cached;
    const params = new URLSearchParams();
    params.set("ref", ref);
    appendScopeParams(params);
    const res = await trackLoad<FileSearchListResponse>(
      fetch(`/_files?${params.toString()}`).then(async (r) => {
        if (!r.ok)
          throw new Error(
            `file search request failed (${r.status}): ${await r.text()}`,
          );
        return r.json();
      }),
    );
    return res;
  }

  function diffFilePaletteItems(
    state: PaletteState,
    query: string,
  ): { items: PaletteFileItem[]; total: number } {
    const matchPath = isGlobPathQuery(query) ? globMatchPath : fuzzyMatchPath;
    const candidates = state.diffSnapshot
      .filter((file) => !state.grepHideTests || !isTestFilePath(file.path))
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
    return {
      total: candidates.length,
      items: limitPaletteResults(
        rankPaletteResultsByHistory(
          candidates.map((candidate) => ({
            kind: "file" as const,
            path: candidate.file.path,
            old_path: candidate.file.old_path,
            displayPath: candidate.displayPath,
            ref: paletteRef("diff"),
            targetPath: fileSourceTarget(candidate.file).path,
            targetRef: fileSourceTarget(candidate.file).ref,
            source: "diff" as const,
            ranges: candidate.match.ranges,
          })),
          state.fileHistory,
        ),
      ),
    };
  }

  // Empty-query view of the repository palette: the files the user opened
  // most recently (newest first), limited to paths that still exist on the
  // current ref so a stale entry cannot open a 404.
  async function updateRecentFilePalette(
    state: PaletteState,
    source: "repo",
  ): Promise<void> {
    const recent = [...state.fileHistory].reverse();
    if (recent.length === 0) {
      state.items = [];
      state.selected = -1;
      state.status.textContent = text().typeToSearchFiles;
      renderPalette(state);
      return;
    }
    state.status.textContent = text().loadingFiles;
    const ref = paletteRef(source);
    const requestGeneration = ++repoFileRequestGeneration;
    let response: FileSearchListResponse;
    try {
      response = await repoPaletteFiles(ref);
    } catch (err) {
      if (requestGeneration !== repoFileRequestGeneration) return;
      throw err;
    }
    if (
      PALETTE !== state ||
      state.input.value.trim() !== "" ||
      requestGeneration !== repoFileRequestGeneration
    )
      return;
    REPO_FILE_CACHE.set(repoFileCacheKey(ref), response);
    const existing = new Set(response.files.map((file) => file.path));
    state.items = limitPaletteResults(
      recent
        .filter(
          (path) =>
            existing.has(path) &&
            (!state.grepHideTests || !isTestFilePath(path)),
        )
        .map((path) => ({
          kind: "file" as const,
          path,
          displayPath: path,
          ref,
          source,
          ranges: [],
        })),
    );
    state.selected = state.items.length ? 0 : -1;
    state.status.textContent = state.items.length
      ? text().recentFiles(state.items.length)
      : text().typeToSearchFiles;
    renderPalette(state);
  }

  async function updateFilePalette(state: PaletteState, query: string) {
    renderPaletteControls(state);
    const source = paletteSource();
    if (!query.trim()) {
      if (source === "repo") {
        await updateRecentFilePalette(state, source);
        return;
      }
      const base =
        source === "diff"
          ? state.diffSnapshot
              .filter(
                (file) => !state.grepHideTests || !isTestFilePath(file.path),
              )
              .map((file) => {
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
      state.items = limitPaletteResults(
        rankPaletteResultsByHistory(base, state.fileHistory),
      );
      state.selected = state.items.length ? 0 : -1;
      state.status.textContent =
        source === "diff"
          ? text().diffFiles(base.length)
          : text().typeToSearchFiles;
      renderPalette(state);
      return;
    }
    let totalMatches = 0;
    let candidatesTruncated = false;
    if (source === "diff") {
      const ranked = diffFilePaletteItems(state, query);
      state.items = ranked.items;
      totalMatches = ranked.total;
    } else {
      state.status.textContent = text().loadingFiles;
      const ref = paletteRef(source);
      const requestGeneration = ++repoFileRequestGeneration;
      let response: FileSearchListResponse;
      try {
        response = await repoPaletteFiles(ref);
      } catch (err) {
        if (requestGeneration !== repoFileRequestGeneration) return;
        throw err;
      }
      if (
        PALETTE !== state ||
        state.input.value !== query ||
        requestGeneration !== repoFileRequestGeneration
      )
        return;
      REPO_FILE_CACHE.set(repoFileCacheKey(ref), response);
      const visibleFiles = response.files.filter(
        (file) => !state.grepHideTests || !isTestFilePath(file.path),
      );
      const stats: PathMatchStats = { total: 0 };
      state.items = limitPaletteResults(
        rankPaletteResultsByHistory(
          rankPathMatches(query, visibleFiles, PALETTE_RESULT_LIMIT, stats).map(
            (match) => ({
              kind: "file" as const,
              path: match.item.path,
              displayPath: match.item.path,
              ref,
              source,
              ranges: match.ranges,
            }),
          ),
          state.fileHistory,
        ),
      );
      totalMatches = stats.total;
      candidatesTruncated = response.truncated;
    }
    state.selected = state.items.length ? 0 : -1;
    state.status.textContent = state.items.length
      ? text().results(
          state.items.length,
          totalMatches > state.items.length ? totalMatches : undefined,
          candidatesTruncated,
        )
      : text().noResults;
    renderPalette(state);
  }

  function updateGrepPalette(state: PaletteState, query: string) {
    renderPaletteControls(state);
    state.controller?.abort();
    if (state.debounce) window.clearTimeout(state.debounce);
    if (!query.trim()) {
      state.items = [];
      state.selected = -1;
      state.status.textContent = text().typeToGrep;
      renderPalette(state);
      return;
    }
    if (state.grepRegex && !regexQueryIsValid(query)) {
      state.controller?.abort();
      state.items = [];
      state.selected = -1;
      state.status.textContent = text().invalidRegex;
      renderPalette(state);
      return;
    }
    state.status.textContent = text().searching;
    state.items = [];
    state.selected = -1;
    renderPalette(state);
    state.debounce = window.setTimeout(() => {
      const source = paletteSource();
      const ref = paletteRef(source);
      const regex = state.grepRegex;
      const hideTests = state.grepHideTests;
      const params = new URLSearchParams();
      params.set("ref", ref);
      params.set("q", query);
      params.set("max", "200");
      if (regex) params.set("regex", "1");
      if (hideTests) params.set("exclude_tests", "1");
      appendScopeParams(params);
      if (source === "diff") {
        for (const file of state.diffSnapshot) params.append("path", file.path);
      }
      const controller = new AbortController();
      state.controller = controller;
      trackLoad<GrepResponse>(
        fetch(`/_grep?${params.toString()}`, {
          signal: controller.signal,
        }).then(async (r) => {
          if (!r.ok)
            throw new Error(
              `grep request failed (${r.status}): ${await r.text()}`,
            );
          return r.json();
        }),
      )
        .then((response) => {
          if (
            PALETTE !== state ||
            controller.signal.aborted ||
            state.input.value !== query ||
            state.grepRegex !== regex ||
            state.grepHideTests !== hideTests
          )
            return;
          if (responseGenerationIsStale(response.generation)) {
            state.items = [];
            state.selected = -1;
            state.status.textContent = text().repositoryChanged;
            renderPalette(state);
            return;
          }
          state.items = limitPaletteResults(
            rankPaletteResultsByHistory(
              response.matches,
              state.grepHistory,
            ).map((match) => ({
              kind: "grep" as const,
              path: match.path,
              line: match.line,
              column: match.column,
              preview: match.preview,
              matchText: match.matchText,
              query,
              regex,
              ref,
              source,
            })),
          );
          state.selected = state.items.length ? 0 : -1;
          state.status.textContent = text().grepSummary({
            engine: response.engine,
            regex,
            testsExcluded: hideTests,
            truncated: response.truncated,
            count: state.items.length,
          });
          renderPalette(state);
        })
        .catch((err) => {
          if (isAbortError(err)) return;
          if (PALETTE !== state || controller.signal.aborted) return;
          console.error("Grep search failed", err);
          state.items = [];
          state.selected = -1;
          state.status.textContent = text().searchFailed(
            errorMessage(err, text().unknownError),
          );
          renderPalette(state);
        });
    }, 80);
  }

  function updatePaletteResults(state: PaletteState) {
    const query = state.input.value;
    if (state.mode === "file") {
      updateFilePalette(state, query).catch((err) => {
        if (PALETTE !== state || state.input.value !== query) return;
        console.error("File search failed", err);
        state.status.textContent = text().searchFailed(
          errorMessage(err, text().unknownError),
        );
      });
    } else {
      updateGrepPalette(state, query);
    }
  }

  async function selectPaletteItem(state: PaletteState): Promise<void> {
    const item = state.items[state.selected];
    if (!item || state.opening) return;
    const history =
      item.kind === "file" ? state.fileHistory : state.grepHistory;
    const nextHistory = rememberPaletteSelection(history, item.path);
    if (nextHistory.join("\0") !== history.join("\0")) {
      state.opening = true;
      state.status.textContent = text().savingSelection;
      try {
        await persistGrepSettings(
          item.kind === "file"
            ? { fileSelectionHistory: nextHistory }
            : { grepSelectionHistory: nextHistory },
        );
      } catch (err) {
        console.error(`Failed to save ${item.kind} selection`, err);
        state.opening = false;
        if (PALETTE === state) {
          state.status.textContent = text().selectionSaveFailed(
            errorMessage(err, text().unknownError),
          );
        }
        return;
      }
      if (item.kind === "file") state.fileHistory = nextHistory;
      else state.grepHistory = nextHistory;
    }
    if (PALETTE !== state) return;
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
        void renderStandaloneSource({ path: item.path, ref: item.ref });
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
      void renderStandaloneSource({ path: item.path, ref: item.ref });
    }
  }

  function handlePaletteKeydown(e: KeyboardEvent, state: PaletteState) {
    if (isImeComposing(e)) return;
    if (e.key === "Escape") {
      e.preventDefault();
      closeSearchPalette();
      return;
    }
    if (e.key === "Enter") {
      if (state.composing) return;
      e.preventDefault();
      void selectPaletteItem(state);
      return;
    }
    if (state.mode === "grep" && e.altKey && e.key.toLowerCase() === "r") {
      e.preventDefault();
      void updateGrepRegex(state, !state.grepRegex);
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
  function isPaletteOpen() {
    return !!PALETTE;
  }
  function paletteMode(): PaletteMode | null {
    return PALETTE ? PALETTE.mode : null;
  }
  function clearRepoFileCache() {
    REPO_FILE_CACHE.clear();
  }

  return {
    openSearchPalette,
    closeSearchPalette,
    isPaletteOpen,
    paletteMode,
    clearRepoFileCache,
  };
}
