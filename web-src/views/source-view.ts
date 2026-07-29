// Standalone source view: text/virtual/paged renderers, shiki highlight,
// HTML/markdown preview tabs, line selection + keyboard cursor, in-source
// search, and the source load/cancel machinery. Extracted from app.ts as a
// deps-injected factory.

import {
  findMainScrollTarget,
  focusMainPanel,
  isEditableKeyTarget,
} from "../core/focus-scope";
import { COPY_16_PATHS, iconSvg } from "../core/icons";
import { isImeComposing } from "../core/keyboard";
import { renderMarkdownPreview } from "../core/markdown-preview";
import {
  type AppRoute,
  buildRawFileUrl,
  buildRoute,
  type DiffRange,
  parseRoute,
  type SourceFileTarget,
  type SourceLineTarget,
} from "../core/routes";
import {
  loadShikiHighlighter,
  type ShikiHighlighter,
} from "../core/shiki-loader";
import {
  EXT_TO_LANG,
  FILENAME_TO_LANG,
  formatBytes,
  humanFileKind,
  isDockerfileName,
  isLikelyTextBytes,
  isMakefileName,
  isPreviewableSource,
  normalizeSourceShikiLang,
  sourceDisplayKind,
  sourceFileName,
  sourceInternalPathKind,
  sourcePreviewKind,
} from "../core/source-meta";
import type {
  DiffCardElement,
  FileMeta,
  FileRangeResponse,
  HljsApi,
  RawFileInfo,
} from "../core/types";
import {
  appendFileViewTabs,
  createFileShellSticky,
  isMediaPreviewOnlySource,
  mountFileShellCard,
  type SourceBlobTab,
} from "./file-shell";
import {
  type MarkdownLinkNavigationDeps,
  openMarkdownLink,
} from "./markdown-link-navigation";
import {
  appendMediaEmbed,
  renderHtmlPreviewFrame,
  renderUnsupportedPreview,
} from "./source-preview-elements";

export type VirtualSourcePagingKeyboardEvent = KeyboardEvent & {
  __gdpVirtualSourcePagingHandled?: boolean;
};

export type SourceViewDeps = {
  $: <T extends Element = HTMLElement>(sel: string) => T;
  $$: <T extends Element = HTMLElement>(sel: string) => T[];
  STATE: {
    route: AppRoute;
    from: string;
    to: string;
    syntaxHighlight: boolean;
  };
  setRoute(route: AppRoute, replace?: boolean): void;
  setPageMode(): void;
  currentRange(): DiffRange;
  trackLoad<T>(promise: Promise<T>): Promise<T>;
  isAbortError(err: unknown): boolean;
  loadRepo(): Promise<void>;
  repoRoute(ref: string, path: string): AppRoute;
  repoFileTargetFromRoute(): string | null;
  renderRepoBlobSidebar(
    currentPath: string,
    ref: string,
  ): Promise<unknown> | unknown;
  placeSidebarToggle(): void;
  createFileBreadcrumb(path: string, ref?: string): HTMLElement;
  createRepositoryWebLink?(target: SourceFileTarget): HTMLAnchorElement | null;
  createFileDetailMeta(
    target: SourceFileTarget,
    meta: RawFileInfo,
  ): HTMLElement;
  createOpenPathButton(
    path: string,
    kind: "directory" | "file-parent",
    title?: string,
  ): HTMLElement;
  createMoveToTrashButton(path: string, onDeleted: () => void): HTMLElement;
  canTrashWorktreeRef(ref: string): boolean;
  loadRawFileInfo(target: SourceFileTarget): Promise<RawFileInfo>;
  loadSyntaxHighlighter(): Promise<HljsApi | null>;
  loadSourceHighlighter?: (lang: string) => Promise<ShikiHighlighter | null>;
  renderMarkdownPreview?: typeof renderMarkdownPreview;
  setViewFileButtonState(
    button: HTMLButtonElement | null,
    sourceMode: boolean,
  ): void;
  scrollMainPanel(
    direction: 1 | -1,
    repeated?: boolean,
    unit?: "line" | "page",
  ): void;
  focusMainSurface(): void;
  isPaletteOpen(): boolean;
};

export function createSourceView(deps: SourceViewDeps) {
  const {
    $,
    $$,
    STATE,
    setRoute,
    setPageMode,
    currentRange,
    trackLoad,
    isAbortError,
    loadRepo,
    repoRoute,
    repoFileTargetFromRoute,
    renderRepoBlobSidebar,
    placeSidebarToggle,
    createFileBreadcrumb,
    createRepositoryWebLink,
    createFileDetailMeta,
    createOpenPathButton,
    createMoveToTrashButton,
    canTrashWorktreeRef,
    loadRawFileInfo,
    loadSyntaxHighlighter,
    setViewFileButtonState,
    scrollMainPanel,
    focusMainSurface,
    isPaletteOpen,
  } = deps;

  function markdownLinkNavigationDeps(): MarkdownLinkNavigationDeps {
    return {
      setRoute,
      currentRange,
      loadRepo,
      repoRoute,
      renderStandaloneSource,
      trackLoad,
      isAbortError,
    };
  }

  const VIRTUAL_SOURCE_LINE_THRESHOLD = 3000;

  const VIRTUAL_SOURCE_SIZE_THRESHOLD = 1024 * 1024;

  const VIRTUAL_SOURCE_PAGE_SIZE = 2000;

  const VIRTUAL_SOURCE_ROW_HEIGHT = 20;

  const VIRTUAL_SOURCE_HIGHLIGHT_MAX_LINE_LENGTH = 2000;

  const UNKNOWN_TEXT_SNIFF_BYTES = 8192;

  const SOURCE_LOADING_SLOW_THRESHOLD_MS = 3000;

  let PREFERRED_SOURCE_TAB: SourceBlobTab | null = null;

  type VirtualSourceSearchMatch = { line: number; start: number; end: number };

  type VirtualSourceSearchHandle = {
    open: () => void;
    query: () => string;
    activeRange: () => VirtualSourceSearchMatch | null;
  };

  type VirtualSourceSearchRoot = HTMLElement & {
    __gdpVirtualSourceSearch?: VirtualSourceSearchHandle;
  };

  let SOURCE_CURSOR: { target: SourceFileTarget; line: number } | null = null;
  let SOURCE_CURSOR_ROWS: HTMLElement[] = [];

  const SOURCE_CURSOR_TOTALS = new Map<string, number>();

  function sourceLineScrollAmount(): number | null {
    const virtualRow = document.querySelector<HTMLElement>(
      "#content .gdp-source-virtual:not([hidden]) .gdp-source-virtual-row",
    );
    if (virtualRow)
      return (
        virtualRow.getBoundingClientRect().height || VIRTUAL_SOURCE_ROW_HEIGHT
      );
    const sourceRow = document.querySelector<HTMLElement>(
      "#content .gdp-source-table:not([hidden]) tr",
    );
    if (sourceRow) return sourceRow.getBoundingClientRect().height || 20;
    const preview = document.querySelector<HTMLElement>(
      "#content .gdp-markdown-preview:not([hidden])",
    );
    if (preview) {
      const previewLineHeight = Number.parseFloat(
        getComputedStyle(preview).lineHeight,
      );
      if (Number.isFinite(previewLineHeight) && previewLineHeight > 0)
        return previewLineHeight;
    }
    const configuredLineHeight = Number.parseFloat(
      getComputedStyle(document.body).getPropertyValue("--code-line-height"),
    );
    return Number.isFinite(configuredLineHeight) && configuredLineHeight > 0
      ? configuredLineHeight
      : VIRTUAL_SOURCE_ROW_HEIGHT;
  }

  function hasVisibleSourceCodeSurface(): boolean {
    return Array.from(
      document.querySelectorAll<HTMLElement>(
        "#content .gdp-source-virtual-scroller, #content .gdp-source-table",
      ),
    ).some((item) => item.offsetParent !== null);
  }

  function sourceCursorKey(target: SourceFileTarget): string {
    return `${target.ref}\0${target.path}`;
  }

  function sourceCursorMatches(
    target: SourceFileTarget,
    line: number,
  ): boolean {
    return (
      !!SOURCE_CURSOR &&
      sourceTargetsEqual(SOURCE_CURSOR.target, target) &&
      SOURCE_CURSOR.line === line
    );
  }

  function syncSourceCursorRows(target: SourceFileTarget) {
    if (
      SOURCE_CURSOR_ROWS.length === 0 ||
      SOURCE_CURSOR_ROWS.every((row) => !row.isConnected)
    ) {
      SOURCE_CURSOR_ROWS = Array.from(
        document.querySelectorAll<HTMLElement>(
          "#content .gdp-source-table tr.gdp-source-cursor, #content .gdp-source-virtual-row.gdp-source-cursor",
        ),
      );
    }
    for (const row of SOURCE_CURSOR_ROWS) {
      row.classList.remove("gdp-source-cursor");
    }
    SOURCE_CURSOR_ROWS = [];
    if (!SOURCE_CURSOR || !sourceTargetsEqual(SOURCE_CURSOR.target, target))
      return;
    const line = String(SOURCE_CURSOR.line);
    const table = document.querySelector<HTMLTableElement>(
      "#content .gdp-source-table",
    );
    const tableRow = table?.rows[SOURCE_CURSOR.line - 1];
    if (tableRow?.dataset.line === line) {
      tableRow.classList.add("gdp-source-cursor");
      SOURCE_CURSOR_ROWS.push(tableRow);
    }
    const windowEl = document.querySelector<HTMLElement>(
      "#content .gdp-source-virtual-window",
    );
    if (windowEl) {
      const firstLine = Number(
        (windowEl.firstElementChild as HTMLElement | null)?.dataset.line || "0",
      );
      const offset = SOURCE_CURSOR.line - firstLine;
      const row =
        offset >= 0
          ? (windowEl.children[offset] as HTMLElement | undefined)
          : null;
      if (row?.dataset.line === line) {
        row.classList.add("gdp-source-cursor");
        SOURCE_CURSOR_ROWS.push(row);
      }
    }
  }

  function visibleSourceLineFallback(): number {
    const scroller = findMainScrollTarget();
    const rowHeight = sourceLineScrollAmount() || VIRTUAL_SOURCE_ROW_HEIGHT;
    if (scroller)
      return Math.max(1, Math.floor(scroller.scrollTop / rowHeight) + 1);
    const rows = $$<HTMLElement>("#content .gdp-source-table tr[data-line]");
    const contentTop =
      document.querySelector<HTMLElement>("#content")?.getBoundingClientRect()
        .top ?? 0;
    const row = rows.find(
      (item) => item.getBoundingClientRect().bottom >= Math.max(0, contentTop),
    );
    return Math.max(1, Number(row?.dataset.line || "1"));
  }

  function ensureSourceCursor(target: SourceFileTarget): {
    target: SourceFileTarget;
    line: number;
  } {
    if (SOURCE_CURSOR && sourceTargetsEqual(SOURCE_CURSOR.target, target))
      return SOURCE_CURSOR;
    const routeLine = lineTargetStart(currentSourceLineTarget(target));
    SOURCE_CURSOR = { target, line: routeLine || visibleSourceLineFallback() };
    syncSourceCursorRows(target);
    return SOURCE_CURSOR;
  }

  function resetSourceCursorForTarget(
    target: SourceFileTarget,
    totalLines: number,
  ) {
    const routeLine = lineTargetStart(currentSourceLineTarget(target));
    SOURCE_CURSOR = {
      target,
      line: Math.max(1, Math.min(totalLines, routeLine || 1)),
    };
  }

  function scrollSourceCursorIntoView(
    cursor: { target: SourceFileTarget; line: number },
    edge: "nearest" | "center" | "start" = "nearest",
  ) {
    const scroller = findMainScrollTarget();
    if (scroller) {
      const rowHeight = sourceLineScrollAmount() || VIRTUAL_SOURCE_ROW_HEIGHT;
      const top = (cursor.line - 1) * rowHeight;
      const bottom = top + rowHeight;
      const before = scroller.scrollTop;
      if (edge === "center")
        scroller.scrollTop = Math.max(
          0,
          top - Math.round(scroller.clientHeight / 2),
        );
      else if (edge === "start") scroller.scrollTop = top;
      else if (top < scroller.scrollTop) scroller.scrollTop = top;
      else if (bottom > scroller.scrollTop + scroller.clientHeight)
        scroller.scrollTop = bottom - scroller.clientHeight;
      if (scroller.scrollTop !== before)
        scroller.dispatchEvent(new Event("scroll"));
      (
        scroller as HTMLElement & { __gdpRenderVirtualSource?: () => void }
      ).__gdpRenderVirtualSource?.();
      syncSourceCursorRows(cursor.target);
      return;
    }
    document
      .querySelector<HTMLElement>(`#content [data-line="${cursor.line}"]`)
      ?.scrollIntoView({ block: edge });
  }

  function moveSourceCursor(
    direction: 1 | -1,
    unit: "line" | "page" | "edge",
    edge?: "top" | "bottom",
  ): boolean {
    if (!hasVisibleSourceCodeSurface()) return false;
    const target = sourceTargetFromRoute();
    if (!target) return false;
    const total = SOURCE_CURSOR_TOTALS.get(sourceCursorKey(target));
    if (!total) return false;
    const cursor = ensureSourceCursor(target);
    if (unit === "edge") {
      cursor.line = edge === "bottom" ? total : 1;
      syncSourceCursorRows(target);
      scrollSourceCursorIntoView(cursor, "center");
      return true;
    }
    const pageRows = Math.max(
      1,
      Math.floor(
        ((findMainScrollTarget()?.clientHeight || window.innerHeight) * 0.55) /
          (sourceLineScrollAmount() || VIRTUAL_SOURCE_ROW_HEIGHT),
      ),
    );
    const delta = unit === "page" ? pageRows : 1;
    cursor.line = Math.max(1, Math.min(total, cursor.line + direction * delta));
    syncSourceCursorRows(target);
    scrollSourceCursorIntoView(cursor, unit === "page" ? "start" : "nearest");
    return true;
  }

  function setSourceTabRoute(tab: SourceBlobTab): void {
    const route = STATE.route;
    if (route.screen !== "file") return;
    setRoute({
      screen: "file",
      path: route.path,
      ref: route.ref,
      view: "blob",
      range: currentRange(),
      ...(tab === "preview" ? { preview: true as const } : {}),
      ...(route.line ? { line: route.line } : {}),
      ...(route.virtual === "off" ? { virtual: "off" as const } : {}),
    });
  }

  function applyRenderedSourceTab(
    tab: SourceBlobTab,
    codeButton: HTMLButtonElement | null,
    previewButton: HTMLButtonElement | null,
    codePane: HTMLElement,
    previewPane: HTMLElement | null,
    updateRoute = true,
  ): boolean {
    if (!codeButton) return false;
    if (tab === "preview" && (!previewButton || !previewPane)) return false;
    codeButton.classList.toggle("active", tab === "code");
    previewButton?.classList.toggle("active", tab === "preview");
    codePane.hidden = tab === "preview";
    if (previewPane) previewPane.hidden = tab === "code";
    if (updateRoute) setSourceTabRoute(tab);
    return true;
  }

  function switchSourceTab(
    tab: "preview" | "code",
    options: { updateRoute?: boolean } = {},
  ): boolean {
    const tabs = document.querySelector<HTMLElement>(
      "#content .gdp-source-tabs",
    );
    if (!tabs) return false;
    const button = tabs.querySelector<HTMLButtonElement>(
      `button[data-source-tab="${tab}"]`,
    );
    if (!button || button.hidden || button.disabled) return false;
    if (options.updateRoute === false) {
      const codeButton = tabs.querySelector<HTMLButtonElement>(
        'button[data-source-tab="code"]',
      );
      const previewButton = tabs.querySelector<HTMLButtonElement>(
        'button[data-source-tab="preview"]',
      );
      const codePane = document.querySelector<HTMLElement>(
        '#content [data-source-pane="code"]',
      );
      const previewPane = document.querySelector<HTMLElement>(
        '#content [data-source-pane="preview"]',
      );
      if (!codeButton || !codePane) return false;
      const applied = applyRenderedSourceTab(
        tab,
        codeButton,
        previewButton,
        codePane,
        previewPane,
        false,
      );
      if (applied) focusMainPanel();
      return applied;
    }
    button.click();
    focusMainPanel();
    return true;
  }

  function loadSourceShikiHighlighter(
    lang: string,
  ): Promise<ShikiHighlighter | null> {
    if (deps.loadSourceHighlighter) return deps.loadSourceHighlighter(lang);
    return loadShikiHighlighter({
      themes: ["github-light", "github-dark"],
      langs: [lang],
    });
  }

  function sourceShikiLines(
    textValue: string,
    lang: string,
    highlighter: ShikiHighlighter,
  ): string[] | null {
    try {
      const html = highlighter.codeToHtml(textValue || " ", {
        lang,
        themes: { light: "github-light", dark: "github-dark" },
        defaultColor: false,
      });
      const template = document.createElement("template");
      template.innerHTML = html;
      const renderedLines = Array.from(
        template.content.querySelectorAll<HTMLElement>(".line"),
      );
      if (!renderedLines.length) return null;
      return renderedLines.map((line) => line.innerHTML || " ");
    } catch {
      return null;
    }
  }

  function scheduleSourceHighlight(
    table: HTMLTableElement,
    target: SourceFileTarget,
    textValue: string,
    lang: string,
    signal?: AbortSignal,
  ): void {
    setTimeout(() => {
      if (
        signal?.aborted ||
        !table.isConnected ||
        !STATE.syntaxHighlight ||
        !sourceTargetsEqual(sourceTargetFromRoute(), target)
      )
        return;
      void loadSourceShikiHighlighter(lang)
        .then((highlighter) => {
          if (
            !highlighter ||
            signal?.aborted ||
            !table.isConnected ||
            !STATE.syntaxHighlight ||
            !sourceTargetsEqual(sourceTargetFromRoute(), target)
          )
            return;
          const highlightedLines = sourceShikiLines(
            textValue,
            lang,
            highlighter,
          );
          if (
            !highlightedLines ||
            signal?.aborted ||
            !table.isConnected ||
            !sourceTargetsEqual(sourceTargetFromRoute(), target)
          )
            return;
          const cells = table.querySelectorAll<HTMLElement>(
            ".gdp-source-line-code",
          );
          cells.forEach((cell, index) => {
            if (highlightedLines[index] == null) return;
            cell.innerHTML = highlightedLines[index] || " ";
            cell.classList.add("shiki");
          });
        })
        .catch((err: unknown) => {
          console.error("Failed to apply source syntax highlighting", err);
        });
    }, 0);
  }

  function scheduleMarkdownPreviewHighlight(
    preview: HTMLElement,
    target: SourceFileTarget,
    textValue: string,
    signal: AbortSignal | undefined,
    onReplace: (next: HTMLElement) => void,
  ): void {
    setTimeout(() => {
      if (
        signal?.aborted ||
        !preview.isConnected ||
        !STATE.syntaxHighlight ||
        !sourceTargetsEqual(sourceTargetFromRoute(), target)
      )
        return;
      void (deps.renderMarkdownPreview ?? renderMarkdownPreview)(
        textValue,
        target,
        {
          syntaxHighlight: true,
          signal,
          onNavigateMarkdown: (link) =>
            void openMarkdownLink(link, markdownLinkNavigationDeps()),
        },
      )
        .then((next) => {
          if (
            signal?.aborted ||
            !preview.isConnected ||
            !sourceTargetsEqual(sourceTargetFromRoute(), target)
          )
            return;
          next.dataset.sourcePane = "preview";
          next.hidden = preview.hidden;
          preview.replaceWith(next);
          onReplace(next);
        })
        .catch((err: unknown) => {
          console.error("Failed to apply preview syntax highlighting", err);
        });
    }, 0);
  }

  function setPreferredSourceTab(tab: SourceBlobTab): void {
    PREFERRED_SOURCE_TAB = tab;
  }

  function consumePreferredSourceTab(previewable: boolean): SourceBlobTab {
    if (!previewable) {
      PREFERRED_SOURCE_TAB = null;
      return "code";
    }
    const routeTab =
      STATE.route.screen === "file" &&
      STATE.route.view === "blob" &&
      STATE.route.preview
        ? "preview"
        : "code";
    const tab = PREFERRED_SOURCE_TAB || routeTab;
    PREFERRED_SOURCE_TAB = null;
    return tab;
  }

  let SOURCE_REQ_SEQ = 0;

  let ACTIVE_SOURCE_LOAD: {
    controller: AbortController;
    req: number;
    target: SourceFileTarget;
    card: DiffCardElement;
  } | null = null;

  function sourceTargetsEqual(
    a: SourceFileTarget | null,
    b: SourceFileTarget | null,
  ): boolean {
    return !!a && !!b && a.path === b.path && a.ref === b.ref;
  }

  function finishSourceLoad(req: number) {
    if (ACTIVE_SOURCE_LOAD?.req === req) ACTIVE_SOURCE_LOAD = null;
  }

  function cancelActiveSourceLoad(
    reason: "user" | "navigation" | "esc",
  ): boolean {
    const active = ACTIVE_SOURCE_LOAD;
    if (!active) return false;
    ACTIVE_SOURCE_LOAD = null;
    SOURCE_REQ_SEQ++;
    active.controller.abort();
    if (
      reason !== "navigation" &&
      sourceTargetsEqual(sourceTargetFromRoute(), active.target)
    ) {
      renderSourceCancelled(active.card, active.target);
    }
    return true;
  }

  function fileSourceTarget(file: FileMeta): SourceFileTarget {
    if ((file.status || "").startsWith("D")) {
      return { path: file.old_path || file.path, ref: STATE.from || "HEAD" };
    }
    const ref = STATE.to && STATE.to !== "worktree" ? STATE.to : "worktree";
    return { path: file.path, ref };
  }

  function sourceTargetFromRoute(): SourceFileTarget | null {
    return STATE.route.screen === "file"
      ? { path: STATE.route.path, ref: STATE.route.ref }
      : null;
  }

  function removeStandaloneSource() {
    document.querySelectorAll(".gdp-standalone-source").forEach((el) => {
      el.remove();
    });
    document.querySelectorAll(".gdp-repo-blob-layout").forEach((el) => {
      el.remove();
    });
  }

  function renderSourceLoading(
    card: DiffCardElement,
    target: SourceFileTarget,
    onCancel?: () => void,
  ) {
    const body = card.querySelector<HTMLElement>(
      ".gdp-file-detail-body, .d2h-files-diff, .d2h-file-diff, .gdp-media, .gdp-source-viewer",
    );
    const view = document.createElement("div");
    view.className = "gdp-source-viewer loading";
    const content = document.createElement("div");
    content.className = "gdp-source-loading-content";
    const spinner = document.createElement("span");
    spinner.className = "gdp-source-loading-spinner";
    spinner.setAttribute("aria-hidden", "true");
    spinner.textContent = "";
    const title = document.createElement("strong");
    title.className = "gdp-source-loading-title";
    title.textContent = "Loading file";
    const message = document.createElement("div");
    message.className = "gdp-source-loading-message";
    message.textContent = `${target.path} at ${target.ref}`;
    content.append(spinner, title, message);
    if (onCancel) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "gdp-btn gdp-btn-sm gdp-source-cancel";
      button.textContent = "Cancel";
      button.title = "Cancel loading (Esc)";
      button.addEventListener("click", (e) => {
        e.stopPropagation();
        onCancel();
      });
      content.appendChild(button);
    }
    view.appendChild(content);
    const startedAt = Date.now();
    // Loads usually finish in well under a second. If this exact loading
    // view is still mounted past the threshold, that is no longer the
    // common case, so say so explicitly instead of leaving the user
    // guessing whether the app has silently hung.
    window.setTimeout(() => {
      if (!view.isConnected) return;
      const slowNote = document.createElement("div");
      slowNote.className = "gdp-source-loading-slow-note";
      content.insertBefore(slowNote, onCancel ? content.lastChild : null);
      let interval: number | null = null;
      const updateSlowNote = () => {
        if (!view.isConnected) {
          if (interval !== null) window.clearInterval(interval);
          return;
        }
        const elapsed = Math.max(
          1,
          Math.floor((Date.now() - startedAt) / 1000),
        );
        title.textContent = `Still loading file (${elapsed}s)`;
        slowNote.textContent = `Taking longer than usual (${elapsed}s elapsed). You can cancel below.`;
      };
      updateSlowNote();
      interval = window.setInterval(updateSlowNote, 1000);
    }, SOURCE_LOADING_SLOW_THRESHOLD_MS);
    if (body) body.replaceWith(view);
    else card.appendChild(view);
  }

  function renderSourceError(
    card: DiffCardElement,
    target: SourceFileTarget,
    message: string,
  ) {
    const body = card.querySelector<HTMLElement>(
      ".gdp-file-detail-body, .d2h-files-diff, .d2h-file-diff, .gdp-media, .gdp-source-viewer",
    );
    const view = document.createElement("div");
    view.className = "gdp-source-viewer error";
    view.textContent = message || `Cannot load ${target.path} at ${target.ref}`;
    if (body) body.replaceWith(view);
    else card.appendChild(view);
    setSourceCardState(card, "error");
  }

  function renderSourceCancelled(
    card: DiffCardElement,
    target: SourceFileTarget,
  ) {
    const body = card.querySelector<HTMLElement>(
      ".gdp-file-detail-body, .d2h-files-diff, .d2h-file-diff, .gdp-media, .gdp-source-viewer",
    );
    const view = document.createElement("div");
    view.className = "gdp-source-viewer cancelled";
    const content = document.createElement("div");
    content.className = "gdp-source-loading-content";
    const title = document.createElement("strong");
    title.className = "gdp-source-loading-title";
    title.textContent = "Loading cancelled";
    const message = document.createElement("div");
    message.className = "gdp-source-loading-message";
    message.textContent = `${target.path} at ${target.ref}`;
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "gdp-btn gdp-btn-sm";
    retry.textContent = "Reopen";
    retry.addEventListener("click", () =>
      renderStandaloneSource(sourceTargetFromRoute() || target),
    );
    content.append(title, message, retry);
    view.appendChild(content);
    if (body) body.replaceWith(view);
    else card.appendChild(view);
    setSourceCardState(card, "cancelled");
  }

  function renderSourceUnsupported(
    card: DiffCardElement,
    target: SourceFileTarget,
  ) {
    const body = card.querySelector<HTMLElement>(
      ".gdp-file-detail-body, .d2h-files-diff, .d2h-file-diff, .gdp-media, .gdp-source-viewer",
    );
    const info = createSourceFileInfo(target, "unsupported file");
    const link = document.createElement("a");
    link.className = "gdp-btn gdp-btn-sm gdp-source-download";
    link.href = buildRawFileUrl(target);
    link.textContent = "Download raw";
    link.target = "_blank";
    link.rel = "noreferrer";
    const view = renderUnsupportedPreview({
      message: "This file type cannot be previewed safely in the browser.",
      extraChildren: [info, link],
    });
    if (body) body.replaceWith(view);
    else card.appendChild(view);
    setSourceCardState(card, "done");
  }

  function renderSourceInternalPath(
    card: DiffCardElement,
    target: SourceFileTarget,
  ) {
    const body = card.querySelector<HTMLElement>(
      ".gdp-file-detail-body, .d2h-files-diff, .d2h-file-diff, .gdp-media, .gdp-source-viewer",
    );
    const info = createSourceFileInfo(target, "internal metadata", {
      loadMeta: false,
    });
    const view = renderUnsupportedPreview({
      message: "Git internal metadata is not previewed from the file viewer.",
      extraChildren: [info],
    });
    if (body) body.replaceWith(view);
    else card.appendChild(view);
    setSourceCardState(card, "done");
  }

  function renderHtmlPreview(
    target: SourceFileTarget,
    html: string,
  ): HTMLElement {
    return renderHtmlPreviewFrame(`${target.path} preview`, html);
  }

  function createSourceFileInfo(
    target: SourceFileTarget,
    kind: string,
    options: { loadMeta?: boolean } = {},
  ): HTMLElement {
    const info = document.createElement("div");
    info.className = "gdp-source-file-info";
    const type = document.createElement("span");
    type.className = "kind";
    type.textContent = humanFileKind(target.path, undefined, kind);
    info.appendChild(type);
    if (options.loadMeta === false) return info;
    loadRawFileInfo(target).then((meta) => {
      type.textContent = humanFileKind(target.path, meta.type, kind);
      if (meta.size != null) {
        const size = document.createElement("span");
        size.textContent = formatBytes(meta.size);
        info.appendChild(size);
      }
    });
    return info;
  }

  function createSourceCopyButton(textValue: string): HTMLButtonElement {
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "gdp-file-header-icon gdp-copy-source";
    copy.title = "Copy source";
    copy.setAttribute("aria-label", "Copy source");
    copy.innerHTML = iconSvg("octicon-copy", COPY_16_PATHS);
    copy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(textValue);
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
    return copy;
  }

  function createSourceTabs(
    target: SourceFileTarget,
    active: SourceBlobTab,
    textValue?: string,
    options: { previewable?: boolean } = {},
  ) {
    const tabs = document.createElement("div");
    tabs.className = "gdp-source-tabs";
    const { codeButton, previewButton } = appendFileViewTabs(
      tabs,
      { currentRange, setRoute, setPreferredSourceTab },
      target,
      active,
      {
        includeFileTabs:
          STATE.route.screen === "file" &&
          sourceInternalPathKind(target.path) !== "code-viewer",
        previewable: !!options.previewable || active === "preview",
        sourceTabClick: "manual",
        ...(textValue != null
          ? { sourceCopyButton: createSourceCopyButton(textValue) }
          : {}),
      },
    );
    return { tabs, codeButton, previewButton };
  }

  async function renderSourceText(
    card: DiffCardElement,
    target: SourceFileTarget,
    textValue: string,
    signal?: AbortSignal,
  ): Promise<boolean> {
    const lines = textValue.length
      ? textValue.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n")
      : [""];
    SOURCE_CURSOR_TOTALS.set(sourceCursorKey(target), lines.length);
    resetSourceCursorForTarget(target, lines.length);
    const body = card.querySelector<HTMLElement>(
      ".gdp-file-detail-body, .d2h-files-diff, .d2h-file-diff, .gdp-media, .gdp-source-viewer",
    );
    const isStandalone = card.classList.contains("gdp-standalone-source");
    const view = document.createElement("div");
    view.className = "gdp-source-viewer";
    const header = isStandalone ? null : document.createElement("div");
    if (header) {
      header.className = "gdp-source-meta";
      header.textContent = `${target.path} @ ${target.ref}`;
    }
    const lang = inferLang(target.path);
    const sourceShikiLang = normalizeSourceShikiLang(lang);
    const usesVirtualSource =
      shouldVirtualizeSource(textValue, lines) && !isVirtualSourceDisabled();
    const hljsRef =
      STATE.syntaxHighlight && usesVirtualSource
        ? await loadSyntaxHighlighter()
        : null;
    if (signal?.aborted) return false;
    const previewable = isPreviewableSource(target.path);
    const previewKind = sourcePreviewKind(target.path);
    const initialSourceTab = consumePreferredSourceTab(previewable);
    const tabsHost = card.querySelector<HTMLElement>(".gdp-file-detail-tabs");
    if (usesVirtualSource) {
      const virtualCode = renderVirtualSource(
        target,
        textValue,
        lines,
        hljsRef,
        lang,
      );
      virtualCode.dataset.sourcePane = "code";
      if (previewable) {
        const { tabs, codeButton, previewButton } = createSourceTabs(
          target,
          initialSourceTab,
          textValue,
          { previewable },
        );
        if (tabsHost) {
          tabsHost.hidden = false;
          tabsHost.replaceChildren(tabs);
        }
        let preview =
          previewKind === "html"
            ? renderHtmlPreview(target, textValue)
            : await (deps.renderMarkdownPreview ?? renderMarkdownPreview)(
                textValue,
                target,
                {
                  syntaxHighlight: false,
                  signal,
                  onNavigateMarkdown: (link) =>
                    void openMarkdownLink(link, markdownLinkNavigationDeps()),
                },
              );
        if (signal?.aborted) return false;
        preview.dataset.sourcePane = "preview";
        let previewHighlightScheduled = false;
        const ensurePreviewHighlight = () => {
          if (
            previewKind === "html" ||
            !STATE.syntaxHighlight ||
            previewHighlightScheduled
          )
            return;
          previewHighlightScheduled = true;
          scheduleMarkdownPreviewHighlight(
            preview,
            target,
            textValue,
            signal,
            (next) => {
              preview = next;
            },
          );
        };
        applyRenderedSourceTab(
          initialSourceTab,
          codeButton,
          previewButton,
          virtualCode,
          preview,
          false,
        );
        previewButton?.addEventListener("click", () => {
          applyRenderedSourceTab(
            "preview",
            codeButton,
            previewButton,
            virtualCode,
            preview,
          );
          ensurePreviewHighlight();
        });
        codeButton?.addEventListener("click", () => {
          applyRenderedSourceTab(
            "code",
            codeButton,
            previewButton,
            virtualCode,
            preview,
          );
        });
        if (header) view.appendChild(header);
        view.classList.add("virtual");
        view.append(preview, virtualCode);
        if (body) body.replaceWith(view);
        else card.appendChild(view);
        if (initialSourceTab === "preview") ensurePreviewHighlight();
        return true;
      }
      const { tabs } = createSourceTabs(target, "code", textValue, {
        previewable: false,
      });
      if (tabsHost) {
        tabsHost.hidden = false;
        tabsHost.replaceChildren(tabs);
      }
      if (header) view.appendChild(header);
      view.classList.add("virtual");
      view.appendChild(virtualCode);
      if (signal?.aborted) return false;
      if (body) body.replaceWith(view);
      else card.appendChild(view);
      return true;
    }
    const table = document.createElement("table");
    table.className = "gdp-source-table";
    table.dataset.sourcePane = "code";
    const tbody = document.createElement("tbody");
    for (let index = 0; index < lines.length; index++) {
      if (signal?.aborted) return false;
      const line = lines[index];
      const tr = document.createElement("tr");
      tr.dataset.line = String(index + 1);
      tr.classList.toggle(
        "gdp-source-line-target",
        lineInSourceTarget(index + 1, currentSourceLineTarget(target)),
      );
      tr.classList.toggle(
        "gdp-source-cursor",
        sourceCursorMatches(target, index + 1),
      );
      const num = document.createElement("td");
      num.className = "gdp-source-line-number";
      num.textContent = String(index + 1);
      bindSourceLineNumber(num, card, target, index + 1);
      const code = document.createElement("td");
      code.className = "gdp-source-line-code";
      code.textContent = line || " ";
      tr.appendChild(num);
      tr.appendChild(code);
      tbody.appendChild(tr);
      if (index > 0 && index % 500 === 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        if (signal?.aborted) return false;
      }
    }
    table.appendChild(tbody);
    const { tabs, codeButton, previewButton } = createSourceTabs(
      target,
      initialSourceTab,
      textValue,
      { previewable },
    );
    if (tabsHost) {
      tabsHost.hidden = false;
      tabsHost.replaceChildren(tabs);
    }
    if (previewable) {
      let preview =
        previewKind === "html"
          ? renderHtmlPreview(target, textValue)
          : await (deps.renderMarkdownPreview ?? renderMarkdownPreview)(
              textValue,
              target,
              {
                syntaxHighlight: false,
                signal,
                onNavigateMarkdown: (link) =>
                  void openMarkdownLink(link, markdownLinkNavigationDeps()),
              },
            );
      if (signal?.aborted) return false;
      preview.dataset.sourcePane = "preview";
      let previewHighlightScheduled = false;
      const ensurePreviewHighlight = () => {
        if (
          previewKind === "html" ||
          !STATE.syntaxHighlight ||
          previewHighlightScheduled
        )
          return;
        previewHighlightScheduled = true;
        scheduleMarkdownPreviewHighlight(
          preview,
          target,
          textValue,
          signal,
          (next) => {
            preview = next;
          },
        );
      };
      applyRenderedSourceTab(
        initialSourceTab,
        codeButton,
        previewButton,
        table,
        preview,
        false,
      );
      previewButton?.addEventListener("click", () => {
        applyRenderedSourceTab(
          "preview",
          codeButton,
          previewButton,
          table,
          preview,
        );
        ensurePreviewHighlight();
      });
      codeButton?.addEventListener("click", () => {
        applyRenderedSourceTab(
          "code",
          codeButton,
          previewButton,
          table,
          preview,
        );
      });
      if (header) view.appendChild(header);
      view.appendChild(preview);
      view.appendChild(table);
      if (signal?.aborted) return false;
      if (body) body.replaceWith(view);
      else card.appendChild(view);
      if (STATE.syntaxHighlight && sourceShikiLang)
        scheduleSourceHighlight(
          table,
          target,
          textValue,
          sourceShikiLang,
          signal,
        );
      if (initialSourceTab === "preview") ensurePreviewHighlight();
      return true;
    }
    if (header) view.appendChild(header);
    view.appendChild(table);
    if (signal?.aborted) return false;
    if (body) body.replaceWith(view);
    else card.appendChild(view);
    if (STATE.syntaxHighlight && sourceShikiLang)
      scheduleSourceHighlight(
        table,
        target,
        textValue,
        sourceShikiLang,
        signal,
      );
    return true;
  }

  function shouldVirtualizeSource(textValue: string, lines: string[]): boolean {
    return (
      textValue.length >= VIRTUAL_SOURCE_SIZE_THRESHOLD ||
      lines.length >= VIRTUAL_SOURCE_LINE_THRESHOLD
    );
  }

  async function sourceLooksTextByContent(
    target: SourceFileTarget,
    meta: RawFileInfo,
    signal: AbortSignal,
  ): Promise<boolean> {
    if (meta.size === 0) return true;
    const end =
      meta.size != null
        ? Math.max(0, Math.min(meta.size, UNKNOWN_TEXT_SNIFF_BYTES) - 1)
        : UNKNOWN_TEXT_SNIFF_BYTES - 1;
    const response = await trackLoad(
      fetch(buildRawFileUrl(target), {
        headers: { Range: `bytes=0-${end}` },
        signal,
      }),
    );
    if (!response.ok && response.status !== 206) return false;
    return isLikelyTextBytes(new Uint8Array(await response.arrayBuffer()));
  }

  function isVirtualSourceDisabled(): boolean {
    return (
      deps.STATE.route.screen === "file" && deps.STATE.route.virtual === "off"
    );
  }

  function buildCurrentFileRouteWithVirtualMode(
    target: SourceFileTarget,
    virtualMode: "auto" | "off",
  ): string {
    const route: AppRoute = {
      screen: "file",
      path: target.path,
      ref: target.ref,
      view: STATE.route.screen === "file" ? STATE.route.view : "blob",
      range: currentRange(),
      ...(virtualMode === "off" ? { virtual: "off" as const } : {}),
    };
    return buildRoute(route);
  }

  function buildFileRangeUrl(
    target: SourceFileTarget,
    start: number,
    end: number,
  ): string {
    return (
      "/file_range?path=" +
      encodeURIComponent(target.path) +
      "&ref=" +
      encodeURIComponent(target.ref || "worktree") +
      "&start=" +
      encodeURIComponent(String(start)) +
      "&end=" +
      encodeURIComponent(String(end))
    );
  }

  function currentSourceLineTarget(
    target: SourceFileTarget,
  ): SourceLineTarget | undefined {
    const routeTarget = sourceTargetFromRoute();
    return sourceTargetsEqual(routeTarget, target) &&
      STATE.route.screen === "file"
      ? STATE.route.line
      : undefined;
  }

  function lineTargetStart(
    line: SourceLineTarget | undefined,
  ): number | undefined {
    if (!line) return undefined;
    return typeof line === "number" ? line : line.start;
  }

  function lineInSourceTarget(
    lineNumber: number,
    target: SourceLineTarget | undefined,
  ): boolean {
    if (!target) return false;
    if (typeof target === "number") return lineNumber === target;
    return lineNumber >= target.start && lineNumber <= target.end;
  }

  let SOURCE_LINE_DRAG: { target: SourceFileTarget; start: number } | null =
    null;

  function normalizeSourceLineSelection(
    start: number,
    end: number,
  ): SourceLineTarget {
    const a = Math.max(1, Math.floor(start));
    const b = Math.max(1, Math.floor(end));
    const from = Math.min(a, b);
    const to = Math.max(a, b);
    return from === to ? from : { start: from, end: to };
  }

  function setSourceLineRoute(
    target: SourceFileTarget,
    line: SourceLineTarget,
  ) {
    if (STATE.route.screen !== "file") return;
    setRoute(
      {
        screen: "file",
        path: target.path,
        ref: target.ref,
        view: STATE.route.view,
        range: currentRange(),
        line,
      },
      true,
    );
  }

  function syncRenderedSourceLineHighlights(
    card: HTMLElement,
    target: SourceFileTarget,
  ) {
    const lineTarget = currentSourceLineTarget(target);
    card.querySelectorAll<HTMLElement>("[data-line]").forEach((row) => {
      const line = Number(row.dataset.line || "0");
      row.classList.toggle(
        "gdp-source-line-target",
        lineInSourceTarget(line, lineTarget),
      );
    });
  }

  function updateSourceLineSelection(
    card: HTMLElement,
    target: SourceFileTarget,
    start: number,
    end: number,
  ) {
    setSourceLineRoute(target, normalizeSourceLineSelection(start, end));
    syncRenderedSourceLineHighlights(card, target);
  }

  function beginSourceLineSelection(
    event: MouseEvent,
    card: HTMLElement,
    target: SourceFileTarget,
    line: number,
  ) {
    event.preventDefault();
    SOURCE_LINE_DRAG = { target, start: line };
    updateSourceLineSelection(card, target, line, line);
  }

  function bindSourceLineNumber(
    num: HTMLElement,
    card: HTMLElement,
    target: SourceFileTarget,
    line: number,
  ) {
    num.addEventListener("mousedown", (e) =>
      beginSourceLineSelection(e, card, target, line),
    );
    num.addEventListener("mouseenter", () => {
      if (
        !SOURCE_LINE_DRAG ||
        !sourceTargetsEqual(SOURCE_LINE_DRAG.target, target)
      )
        return;
      updateSourceLineSelection(card, target, SOURCE_LINE_DRAG.start, line);
    });
  }

  document.addEventListener("mouseup", () => {
    SOURCE_LINE_DRAG = null;
  });

  function virtualSourceSearchRanges(
    line: string,
    query: string,
  ): Array<{ start: number; end: number }> {
    const needle = query.toLowerCase();
    if (!needle) return [];
    const haystack = line.toLowerCase();
    const ranges: Array<{ start: number; end: number }> = [];
    let cursor = 0;
    while (cursor <= haystack.length) {
      const index = haystack.indexOf(needle, cursor);
      if (index < 0) break;
      ranges.push({ start: index, end: index + query.length });
      cursor = Math.max(index + query.length, index + 1);
    }
    return ranges;
  }

  function collectVirtualSourceSearchMatches(
    lines: string[],
    query: string,
    max = 5000,
  ): VirtualSourceSearchMatch[] {
    const matches: VirtualSourceSearchMatch[] = [];
    for (let index = 0; index < lines.length && matches.length < max; index++) {
      for (const range of virtualSourceSearchRanges(
        lines[index] || "",
        query,
      )) {
        matches.push({ line: index + 1, start: range.start, end: range.end });
        if (matches.length >= max) break;
      }
    }
    return matches;
  }

  function appendVirtualSourceLineCode(
    code: HTMLElement,
    line: string,
    query: string,
    activeRange: VirtualSourceSearchMatch | null,
    lineNumber: number,
  ): boolean {
    const ranges = virtualSourceSearchRanges(line, query);
    if (!ranges.length) return false;
    let cursor = 0;
    for (const range of ranges) {
      if (range.start > cursor)
        code.appendChild(
          document.createTextNode(line.slice(cursor, range.start)),
        );
      const mark = document.createElement("mark");
      const active =
        !!activeRange &&
        activeRange.line === lineNumber &&
        activeRange.start === range.start &&
        activeRange.end === range.end;
      mark.className = active
        ? "gdp-source-virtual-search-hit active"
        : "gdp-source-virtual-search-hit";
      mark.textContent = line.slice(range.start, range.end);
      code.appendChild(mark);
      cursor = range.end;
    }
    if (cursor < line.length)
      code.appendChild(document.createTextNode(line.slice(cursor)));
    return true;
  }

  function createVirtualSourceSearch(
    wrap: VirtualSourceSearchRoot,
    scroller: HTMLElement,
    findMatches: (query: string) => Promise<VirtualSourceSearchMatch[]>,
    renderFn: () => void,
  ): VirtualSourceSearchHandle {
    const bar = document.createElement("div");
    bar.className = "gdp-source-virtual-search";
    const input = document.createElement("input");
    input.type = "search";
    input.placeholder = "Find in file";
    input.autocomplete = "off";
    input.spellcheck = false;
    const count = document.createElement("span");
    count.className = "gdp-source-virtual-search-count";
    const previous = document.createElement("button");
    previous.type = "button";
    previous.textContent = "Prev";
    const next = document.createElement("button");
    next.type = "button";
    next.textContent = "Next";
    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "Close";
    bar.append(input, count, previous, next, close);
    wrap.querySelector(".gdp-source-virtual-info")?.appendChild(bar);
    bar.hidden = true;

    let matches: VirtualSourceSearchMatch[] = [];
    let active = -1;
    let debounce = 0;
    let searchVersion = 0;
    const hide = () => {
      bar.hidden = true;
      renderFn();
      scroller.focus({ preventScroll: true });
    };
    const sync = () => {
      const query = input.value;
      const version = ++searchVersion;
      if (!query) {
        matches = [];
        active = -1;
        count.textContent = "";
        renderFn();
        return;
      }
      count.textContent = "Searching...";
      findMatches(query)
        .then((nextMatches) => {
          if (version !== searchVersion) return;
          matches = nextMatches;
          active = matches.length
            ? Math.max(0, Math.min(active, matches.length - 1))
            : -1;
          count.textContent = matches.length
            ? `${active + 1} / ${matches.length}`
            : "0 / 0";
          if (active >= 0) {
            const rowHeight =
              sourceLineScrollAmount() || VIRTUAL_SOURCE_ROW_HEIGHT;
            scroller.scrollTop = Math.max(
              0,
              (matches[active].line - 1) * rowHeight - rowHeight * 3,
            );
          }
          renderFn();
        })
        .catch(() => {
          if (version !== searchVersion) return;
          matches = [];
          active = -1;
          count.textContent = "Search failed";
          renderFn();
        });
    };
    const scheduleSync = () => {
      if (debounce) window.clearTimeout(debounce);
      debounce = window.setTimeout(sync, 120);
    };
    const move = (direction: number) => {
      if (!matches.length) return;
      active = (active + direction + matches.length) % matches.length;
      count.textContent = `${active + 1} / ${matches.length}`;
      const rowHeight = sourceLineScrollAmount() || VIRTUAL_SOURCE_ROW_HEIGHT;
      scroller.scrollTop = Math.max(
        0,
        (matches[active].line - 1) * rowHeight - rowHeight * 3,
      );
      renderFn();
    };
    input.addEventListener("input", () => {
      active = 0;
      scheduleSync();
    });
    input.addEventListener("keydown", (e) => {
      if (isImeComposing(e)) return;
      if (e.key === "Escape") {
        e.preventDefault();
        hide();
      } else if (e.key === "Enter") {
        e.preventDefault();
        move(e.shiftKey ? -1 : 1);
      }
    });
    previous.addEventListener("click", () => move(-1));
    next.addEventListener("click", () => move(1));
    close.addEventListener("click", hide);
    return {
      open: () => {
        bar.hidden = false;
        input.focus();
        input.select();
        sync();
      },
      query: () => (bar.hidden ? "" : input.value),
      activeRange: () => (active >= 0 ? matches[active] || null : null),
    };
  }

  function openVirtualSourceSearchFromKeyboard(
    targetEl: Element | null,
  ): boolean {
    const active = targetEl?.closest<VirtualSourceSearchRoot>(
      "#content .gdp-source-virtual",
    );
    const fallback = document.querySelector<VirtualSourceSearchRoot>(
      "#content .gdp-source-viewer.virtual .gdp-source-virtual:not([hidden])",
    );
    const search =
      active?.__gdpVirtualSourceSearch || fallback?.__gdpVirtualSourceSearch;
    if (!search) return false;
    search.open();
    return true;
  }

  function renderVirtualSource(
    target: SourceFileTarget,
    textValue: string,
    lines: string[],
    hljsRef: HljsApi | null,
    lang: string | null,
  ): HTMLElement {
    const wrap = document.createElement("div") as VirtualSourceSearchRoot;
    wrap.className = "gdp-source-virtual";
    const info = document.createElement("div");
    info.className = "gdp-source-virtual-info";
    const badge = document.createElement("span");
    badge.className = "gdp-source-virtual-badge";
    badge.textContent = "Virtual mode";
    const summary = document.createElement("span");
    summary.className = "gdp-source-virtual-summary";
    summary.textContent =
      lines.length.toLocaleString() +
      " lines, " +
      formatBytes(textValue.length) +
      ". Only visible rows are rendered. Highlighting is per-line.";
    const actions = document.createElement("span");
    actions.className = "gdp-source-virtual-actions";
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className =
      "gdp-file-header-icon gdp-copy-source gdp-source-virtual-copy";
    copy.title = "Copy source";
    copy.setAttribute("aria-label", "Copy source");
    copy.innerHTML = iconSvg("octicon-copy", COPY_16_PATHS);
    copy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(textValue);
        copy.classList.add("copied");
        setTimeout(() => {
          copy.classList.remove("copied");
        }, 1200);
      } catch {
        copy.classList.add("failed");
        setTimeout(() => {
          copy.classList.remove("failed");
        }, 1600);
      }
    });
    const full = document.createElement("a");
    full.className = "gdp-source-virtual-action";
    full.href = buildCurrentFileRouteWithVirtualMode(target, "off");
    full.textContent = "Open full view";
    full.title =
      "Render every line without virtualization. This can be slow for large files.";
    full.addEventListener("click", (e) => {
      e.preventDefault();
      const url = new URL(full.href, window.location.origin);
      setRoute(parseRoute(url.pathname, url.search, currentRange()), true);
      renderStandaloneSource(target, { refresh: true });
    });
    actions.append(copy, full);
    info.append(badge, summary, actions);
    const scroller = document.createElement("div");
    scroller.className = "gdp-source-virtual-scroller";
    scroller.tabIndex = 0;
    scroller.setAttribute("role", "region");
    scroller.setAttribute("aria-label", `${target.path} source code`);
    const spacer = document.createElement("div");
    spacer.className = "gdp-source-virtual-spacer";
    spacer.style.height = `${Math.max(
      1,
      lines.length * (sourceLineScrollAmount() || VIRTUAL_SOURCE_ROW_HEIGHT),
    )}px`;
    const windowEl = document.createElement("div");
    windowEl.className = "gdp-source-virtual-window";
    spacer.appendChild(windowEl);
    scroller.appendChild(spacer);
    wrap.append(info, scroller);

    let raf = 0;
    let renderedStart = -1;
    let renderedEnd = -1;
    let renderedRowHeight = -1;
    let search: VirtualSourceSearchHandle | null = null;
    const render = () => {
      raf = 0;
      const rowHeight = sourceLineScrollAmount() || VIRTUAL_SOURCE_ROW_HEIGHT;
      spacer.style.height = `${Math.max(1, lines.length * rowHeight)}px`;
      const viewportHeight = scroller.clientHeight || window.innerHeight;
      const overscan = 20;
      const start = Math.max(
        0,
        Math.floor(scroller.scrollTop / rowHeight) - overscan,
      );
      const end = Math.min(
        lines.length,
        Math.ceil((scroller.scrollTop + viewportHeight) / rowHeight) + overscan,
      );
      if (
        start === renderedStart &&
        end === renderedEnd &&
        rowHeight === renderedRowHeight
      )
        return;
      renderedStart = start;
      renderedEnd = end;
      renderedRowHeight = rowHeight;
      windowEl.replaceChildren();
      windowEl.style.transform = `translateY(${start * rowHeight}px)`;
      const fragment = document.createDocumentFragment();
      for (let index = start; index < end; index++) {
        const row = document.createElement("div");
        row.className = "gdp-source-virtual-row";
        row.dataset.line = String(index + 1);
        row.classList.toggle(
          "gdp-source-line-target",
          lineInSourceTarget(index + 1, currentSourceLineTarget(target)),
        );
        row.classList.toggle(
          "gdp-source-cursor",
          sourceCursorMatches(target, index + 1),
        );
        const num = document.createElement("span");
        num.className = "gdp-source-virtual-line-number";
        num.textContent = String(index + 1);
        bindSourceLineNumber(num, wrap, target, index + 1);
        const code = document.createElement("span");
        code.className = "gdp-source-virtual-line-code";
        const line = lines[index] ?? "";
        const searchQuery = search?.query() || "";
        const activeRange = search?.activeRange() || null;
        if (
          appendVirtualSourceLineCode(
            code,
            line,
            searchQuery,
            activeRange,
            index + 1,
          )
        ) {
          // Intentional: appendVirtualSourceLineCode は DOM 構築の副作用が完了したら true を返すので追加処理不要
        } else if (
          hljsRef?.highlight &&
          lang &&
          line.length <= VIRTUAL_SOURCE_HIGHLIGHT_MAX_LINE_LENGTH &&
          (!hljsRef.getLanguage || hljsRef.getLanguage(lang))
        ) {
          try {
            code.innerHTML = hljsRef.highlight(line, {
              language: lang,
              ignoreIllegals: true,
            }).value;
            code.classList.add("hljs");
          } catch {
            code.textContent = line;
          }
        } else {
          code.textContent = line;
        }
        row.append(num, code);
        fragment.appendChild(row);
      }
      windowEl.appendChild(fragment);
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(render);
    };
    (
      scroller as HTMLElement & { __gdpRenderVirtualSource?: () => void }
    ).__gdpRenderVirtualSource = render;
    scroller.addEventListener("scroll", schedule, { passive: true });
    search = createVirtualSourceSearch(
      wrap,
      scroller,
      (query) =>
        Promise.resolve(collectVirtualSourceSearchMatches(lines, query)),
      render,
    );
    wrap.__gdpVirtualSourceSearch = search;
    let resizeObserver: ResizeObserver | null = null;
    resizeObserver =
      typeof ResizeObserver === "function"
        ? new ResizeObserver(() => {
            if (!scroller.isConnected) {
              resizeObserver?.disconnect();
              resizeObserver = null;
              return;
            }
            schedule();
          })
        : null;
    resizeObserver?.observe(scroller);
    render();
    schedule();
    return wrap;
  }

  function renderPagedVirtualSource(
    target: SourceFileTarget,
    size: number,
    initialStart: number,
    initialLines: string[],
    initialComplete: boolean,
    initialTotal: number,
    hljsRef: HljsApi | null,
    lang: string | null,
    signal?: AbortSignal,
  ): HTMLElement {
    const wrap = document.createElement("div") as VirtualSourceSearchRoot;
    wrap.className = "gdp-source-virtual";
    const info = document.createElement("div");
    info.className = "gdp-source-virtual-info";
    const badge = document.createElement("span");
    badge.className = "gdp-source-virtual-badge";
    badge.textContent = "Virtual mode";
    const summary = document.createElement("span");
    summary.className = "gdp-source-virtual-summary";
    const actions = document.createElement("span");
    actions.className = "gdp-source-virtual-actions";
    const raw = document.createElement("a");
    raw.className = "gdp-source-virtual-action";
    raw.href = buildRawFileUrl(target);
    raw.target = "_blank";
    raw.rel = "noreferrer";
    raw.textContent = "Open raw";
    const full = document.createElement("a");
    full.className = "gdp-source-virtual-action";
    full.href = buildCurrentFileRouteWithVirtualMode(target, "off");
    full.textContent = "Open full view";
    full.title =
      "Render every line without paged loading. This can be slow for large files.";
    full.addEventListener("click", (e) => {
      e.preventDefault();
      const url = new URL(full.href, window.location.origin);
      setRoute(parseRoute(url.pathname, url.search, currentRange()), true);
      renderStandaloneSource(target, { refresh: true });
    });
    actions.append(raw, full);
    info.append(badge, summary, actions);

    const scroller = document.createElement("div");
    scroller.className = "gdp-source-virtual-scroller";
    scroller.tabIndex = 0;
    scroller.setAttribute("role", "region");
    scroller.setAttribute("aria-label", `${target.path} source code`);
    const spacer = document.createElement("div");
    spacer.className = "gdp-source-virtual-spacer";
    const windowEl = document.createElement("div");
    windowEl.className = "gdp-source-virtual-window";
    spacer.appendChild(windowEl);
    scroller.appendChild(spacer);
    wrap.append(info, scroller);

    const lines = new Map<number, string>();
    const requestedPages = new Set<number>();
    const failedPages = new Set<number>();
    const targetLine = lineTargetStart(currentSourceLineTarget(target)) || 1;
    let complete = initialComplete;
    let totalRows = initialComplete
      ? Math.max(1, initialTotal)
      : Math.max(
          initialTotal || 1,
          initialStart + initialLines.length - 1,
          targetLine + VIRTUAL_SOURCE_PAGE_SIZE,
        );
    initialLines.forEach((line, index) => {
      lines.set(initialStart + index, line);
    });
    requestedPages.add(
      Math.max(0, Math.floor((initialStart - 1) / VIRTUAL_SOURCE_PAGE_SIZE)),
    );
    for (
      let line = initialStart;
      line < initialStart + initialLines.length;
      line += VIRTUAL_SOURCE_PAGE_SIZE
    ) {
      requestedPages.add(
        Math.max(0, Math.floor((line - 1) / VIRTUAL_SOURCE_PAGE_SIZE)),
      );
    }

    const updateTotals = () => {
      SOURCE_CURSOR_TOTALS.set(sourceCursorKey(target), totalRows);
      summary.textContent =
        (complete
          ? totalRows.toLocaleString()
          : `${lines.size.toLocaleString()}+`) +
        " lines loaded from " +
        formatBytes(size) +
        ". More rows load as you scroll.";
      const rowHeight = sourceLineScrollAmount() || VIRTUAL_SOURCE_ROW_HEIGHT;
      spacer.style.height = `${Math.max(1, totalRows * rowHeight)}px`;
    };

    const loadPage = (line: number) => {
      if (signal?.aborted || (complete && line > totalRows)) return;
      const page = Math.max(
        0,
        Math.floor((line - 1) / VIRTUAL_SOURCE_PAGE_SIZE),
      );
      if (requestedPages.has(page)) return;
      if (failedPages.has(page)) return;
      requestedPages.add(page);
      const start = page * VIRTUAL_SOURCE_PAGE_SIZE + 1;
      const end = start + VIRTUAL_SOURCE_PAGE_SIZE - 1;
      trackLoad(
        fetch(buildFileRangeUrl(target, start, end), { signal })
          .then((res) =>
            res.ok ? (res.json() as Promise<FileRangeResponse>) : null,
          )
          .then((data) => {
            if (!data || signal?.aborted) return;
            data.lines.forEach((lineValue, index) => {
              lines.set(data.start + index, lineValue);
            });
            totalRows = data.complete
              ? Math.max(1, data.total)
              : Math.max(totalRows, data.total, end + VIRTUAL_SOURCE_PAGE_SIZE);
            complete = data.complete === true;
            updateTotals();
            renderedStart = -1;
            renderedEnd = -1;
            render();
          })
          .catch((err) => {
            if (!isAbortError(err)) {
              failedPages.add(page);
              renderedStart = -1;
              renderedEnd = -1;
              schedule();
            }
          }),
      );
    };

    let raf = 0;
    let renderedStart = -1;
    let renderedEnd = -1;
    let renderedRowHeight = -1;
    let search: VirtualSourceSearchHandle | null = null;
    let searchController: AbortController | null = null;
    const render = () => {
      raf = 0;
      const rowHeight = sourceLineScrollAmount() || VIRTUAL_SOURCE_ROW_HEIGHT;
      spacer.style.height = `${Math.max(1, totalRows * rowHeight)}px`;
      const viewportHeight = scroller.clientHeight || window.innerHeight;
      const overscan = 20;
      const start = Math.max(
        0,
        Math.floor(scroller.scrollTop / rowHeight) - overscan,
      );
      const end = Math.min(
        totalRows,
        Math.ceil((scroller.scrollTop + viewportHeight) / rowHeight) + overscan,
      );
      if (
        start === renderedStart &&
        end === renderedEnd &&
        rowHeight === renderedRowHeight
      )
        return;
      renderedStart = start;
      renderedEnd = end;
      renderedRowHeight = rowHeight;
      windowEl.replaceChildren();
      windowEl.style.transform = `translateY(${start * rowHeight}px)`;
      const fragment = document.createDocumentFragment();
      for (let index = start; index < end; index++) {
        const lineNumber = index + 1;
        if (!lines.has(lineNumber)) loadPage(lineNumber);
        const row = document.createElement("div");
        row.className = "gdp-source-virtual-row";
        row.dataset.line = String(lineNumber);
        row.classList.toggle(
          "gdp-source-line-target",
          lineInSourceTarget(lineNumber, currentSourceLineTarget(target)),
        );
        row.classList.toggle(
          "gdp-source-cursor",
          sourceCursorMatches(target, lineNumber),
        );
        const num = document.createElement("span");
        num.className = "gdp-source-virtual-line-number";
        num.textContent = String(lineNumber);
        bindSourceLineNumber(num, wrap, target, lineNumber);
        const code = document.createElement("span");
        code.className = "gdp-source-virtual-line-code";
        const line = lines.get(lineNumber);
        if (line == null) {
          code.textContent = "";
        } else if (
          appendVirtualSourceLineCode(
            code,
            line,
            search?.query() || "",
            search?.activeRange() || null,
            lineNumber,
          )
        ) {
          // Search marks are rendered from text so virtual rows can be rebuilt cheaply.
        } else if (
          hljsRef?.highlight &&
          lang &&
          line.length <= VIRTUAL_SOURCE_HIGHLIGHT_MAX_LINE_LENGTH &&
          (!hljsRef.getLanguage || hljsRef.getLanguage(lang))
        ) {
          try {
            code.innerHTML = hljsRef.highlight(line, {
              language: lang,
              ignoreIllegals: true,
            }).value;
            code.classList.add("hljs");
          } catch {
            code.textContent = line;
          }
        } else {
          code.textContent = line;
        }
        row.append(num, code);
        fragment.appendChild(row);
      }
      windowEl.appendChild(fragment);
      if (!complete && totalRows - end < VIRTUAL_SOURCE_PAGE_SIZE) {
        totalRows += VIRTUAL_SOURCE_PAGE_SIZE;
        updateTotals();
      }
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(render);
    };
    (
      scroller as HTMLElement & { __gdpRenderVirtualSource?: () => void }
    ).__gdpRenderVirtualSource = render;
    scroller.addEventListener("scroll", schedule, { passive: true });
    const findPagedMatches = async (
      query: string,
      matchSignal?: AbortSignal,
    ): Promise<VirtualSourceSearchMatch[]> => {
      const matches: VirtualSourceSearchMatch[] = [];
      let startLine = 1;
      let done = false;
      while (!done && matches.length < 5000) {
        const endLine = startLine + VIRTUAL_SOURCE_PAGE_SIZE - 1;
        const data = await trackLoad(
          fetch(buildFileRangeUrl(target, startLine, endLine), {
            signal: matchSignal,
          }).then((res) => {
            if (!res.ok) throw new Error("file range failed");
            return res.json() as Promise<FileRangeResponse>;
          }),
        );
        if (matchSignal?.aborted) return [];
        data.lines.forEach((lineValue, index) => {
          const lineNumber = data.start + index;
          lines.set(lineNumber, lineValue);
          for (const range of virtualSourceSearchRanges(lineValue, query)) {
            matches.push({
              line: lineNumber,
              start: range.start,
              end: range.end,
            });
            if (matches.length >= 5000) break;
          }
        });
        totalRows = data.complete
          ? Math.max(1, data.total)
          : Math.max(totalRows, data.total, endLine + VIRTUAL_SOURCE_PAGE_SIZE);
        complete = data.complete === true;
        updateTotals();
        if (data.complete || !data.lines.length) done = true;
        else startLine = data.start + data.lines.length;
      }
      renderedStart = -1;
      renderedEnd = -1;
      schedule();
      return matches;
    };
    search = createVirtualSourceSearch(
      wrap,
      scroller,
      (query) => {
        searchController?.abort();
        searchController = new AbortController();
        return findPagedMatches(query, searchController.signal);
      },
      render,
    );
    wrap.__gdpVirtualSourceSearch = search;
    let resizeObserver: ResizeObserver | null = null;
    resizeObserver =
      typeof ResizeObserver === "function"
        ? new ResizeObserver(() => {
            if (!scroller.isConnected) {
              resizeObserver?.disconnect();
              resizeObserver = null;
              return;
            }
            schedule();
          })
        : null;
    resizeObserver?.observe(scroller);
    updateTotals();
    if (targetLine <= 1) {
      render();
      schedule();
    }
    return wrap;
  }

  async function renderPagedSourceText(
    card: DiffCardElement,
    target: SourceFileTarget,
    size: number,
    signal?: AbortSignal,
  ): Promise<boolean> {
    const body = card.querySelector<HTMLElement>(
      ".gdp-file-detail-body, .d2h-files-diff, .d2h-file-diff, .gdp-media, .gdp-source-viewer",
    );
    const isStandalone = card.classList.contains("gdp-standalone-source");
    const view = document.createElement("div");
    view.className = "gdp-source-viewer virtual";
    const header = isStandalone ? null : document.createElement("div");
    if (header) {
      header.className = "gdp-source-meta";
      header.textContent = `${target.path} @ ${target.ref}`;
      view.appendChild(header);
    }
    const lineTarget = lineTargetStart(currentSourceLineTarget(target)) || 1;
    const initialPage = Math.max(
      0,
      Math.floor((lineTarget - 1) / VIRTUAL_SOURCE_PAGE_SIZE),
    );
    const initialStart = initialPage * VIRTUAL_SOURCE_PAGE_SIZE + 1;
    const initialEnd = initialStart + VIRTUAL_SOURCE_PAGE_SIZE - 1;
    const lang = inferLang(target.path);
    const hljsRef = STATE.syntaxHighlight
      ? await loadSyntaxHighlighter()
      : null;
    if (signal?.aborted) return false;
    const initial = await trackLoad(
      fetch(buildFileRangeUrl(target, initialStart, initialEnd), {
        signal,
      }).then((res) =>
        res.ok ? (res.json() as Promise<FileRangeResponse>) : null,
      ),
    );
    if (!initial) return false;
    if (signal?.aborted) return false;
    const tabsHost = card.querySelector<HTMLElement>(".gdp-file-detail-tabs");
    if (tabsHost) {
      tabsHost.hidden = false;
      tabsHost.replaceChildren(
        createSourceTabs(target, "code", undefined, {
          previewable: false,
        }).tabs,
      );
    }
    SOURCE_CURSOR_TOTALS.set(
      sourceCursorKey(target),
      Math.max(1, initial.total, lineTarget),
    );
    resetSourceCursorForTarget(target, Math.max(1, initial.total, lineTarget));
    const virtualCode = renderPagedVirtualSource(
      target,
      size,
      initialStart,
      initial.lines,
      initial.complete === true,
      initial.total,
      hljsRef,
      lang,
      signal,
    );
    view.appendChild(virtualCode);
    if (body) body.replaceWith(view);
    else card.appendChild(view);
    return true;
  }

  function renderSourceMedia(
    card: DiffCardElement,
    target: SourceFileTarget,
    mediaKind: string,
  ) {
    const body = card.querySelector<HTMLElement>(
      ".gdp-file-detail-body, .d2h-files-diff, .d2h-file-diff, .gdp-media, .gdp-source-viewer",
    );
    const isStandalone = card.classList.contains("gdp-standalone-source");
    const view = document.createElement("div");
    view.className = "gdp-source-viewer media";
    view.classList.add(mediaKind);
    if (!isStandalone) {
      const meta = document.createElement("div");
      meta.className = "gdp-source-meta";
      meta.textContent = `${target.path} @ ${target.ref}`;
      view.appendChild(meta);
    }
    const url = buildRawFileUrl(target);
    const info = createSourceFileInfo(target, mediaKind);
    view.appendChild(info);
    appendMediaEmbed(view, {
      url,
      kind: mediaKind,
      title: target.path,
      onImageLoad: (img) => {
        const resolution = document.createElement("span");
        resolution.textContent = `${img.naturalWidth} x ${img.naturalHeight}`;
        info.appendChild(resolution);
      },
    });
    if (body) body.replaceWith(view);
    else card.appendChild(view);
    setSourceCardState(card, "done");
  }

  function _renderSourceBinary(
    card: DiffCardElement,
    target: SourceFileTarget,
  ) {
    const body = card.querySelector<HTMLElement>(
      ".gdp-file-detail-body, .d2h-files-diff, .d2h-file-diff, .gdp-media, .gdp-source-viewer",
    );
    const isStandalone = card.classList.contains("gdp-standalone-source");
    const view = document.createElement("div");
    view.className = "gdp-source-viewer binary";
    const link = document.createElement("a");
    link.href = buildRawFileUrl(target);
    link.textContent = "Open raw file";
    link.target = "_blank";
    link.rel = "noreferrer";
    if (!isStandalone) {
      const meta = document.createElement("div");
      meta.className = "gdp-source-meta";
      meta.textContent = `${target.path} @ ${target.ref}`;
      view.appendChild(meta);
    }
    view.appendChild(link);
    if (body) body.replaceWith(view);
    else card.appendChild(view);
  }

  // AGENTS.md "Request Lifecycle Discipline": entering the blob view must be
  // idempotent. setRoute() already dispatches a render when the route
  // changes, and most click handlers also call renderStandaloneSource
  // directly - without this guard every file open rendered twice (two
  // loads and duplicate HEAD /_file metadata fetches). A mounted card that
  // is loading or done for the same target short-circuits; error/cancelled
  // cards stay re-renderable so a retry click still works. Callers that
  // must re-render the same target (SSE file change, virtual-mode switch)
  // pass refresh: true.
  function mountedStandaloneSourceCard(
    target: SourceFileTarget,
  ): DiffCardElement | null {
    const card = document.querySelector<DiffCardElement>(
      ".gdp-standalone-source",
    );
    if (!card) return null;
    if (card.dataset.path !== target.path) return null;
    if (card.dataset.sourceRef !== (target.ref || "worktree")) return null;
    return card;
  }

  function setSourceCardState(
    card: HTMLElement,
    state: "loading" | "done" | "error" | "cancelled",
  ) {
    card.dataset.sourceState = state;
  }

  async function renderStandaloneSource(
    target: SourceFileTarget,
    options: { refresh?: boolean } = {},
  ) {
    if (!options.refresh) {
      const mounted = mountedStandaloneSourceCard(target);
      const state = mounted?.dataset.sourceState;
      if (mounted && state === "done") {
        // Same target already on screen: honor a line jump, skip the reload.
        scrollStandaloneSourceLine(
          mounted,
          lineTargetStart(
            STATE.route.screen === "file" ? STATE.route.line : undefined,
          ),
        );
        return;
      }
      if (mounted && state === "loading" && mounted._loadPromise)
        return mounted._loadPromise;
    }
    cancelActiveSourceLoad("navigation");
    const req = ++SOURCE_REQ_SEQ;
    const repoTarget = repoFileTargetFromRoute();
    setPageMode();
    removeStandaloneSource();
    document.querySelectorAll(".gdp-repo-blob-layout").forEach((el) => {
      el.remove();
    });
    const card = document.createElement("article") as DiffCardElement;
    card.className =
      "gdp-file-shell loaded gdp-standalone-source gdp-source-mode";
    card.dataset.path = target.path;
    card.dataset.sourceRef = target.ref || "worktree";
    setSourceCardState(card, "loading");
    const internalKind = sourceInternalPathKind(target.path);
    const wrapper = document.createElement("div");
    wrapper.className = "gdp-file-detail-wrapper";
    const mediaOnly = !internalKind && isMediaPreviewOnlySource(target.path);
    const activeTab: SourceBlobTab =
      mediaOnly ||
      (!internalKind && STATE.route.screen === "file" && STATE.route.preview)
        ? "preview"
        : "code";
    const { sticky, header } = createFileShellSticky(
      {
        currentRange,
        setRoute,
        setPreferredSourceTab,
        createFileBreadcrumb,
        createRepositoryWebLink,
      },
      target,
      activeTab,
      internalKind ? { includeFileTabs: false, previewable: false } : {},
    );
    const pathActions =
      header.querySelector<HTMLElement>(".gdp-file-detail-path") || header;
    pathActions.appendChild(
      createOpenPathButton(
        target.path,
        "file-parent",
        "open parent folder in OS",
      ),
    );
    if (repoTarget && canTrashWorktreeRef(repoTarget)) {
      header.appendChild(
        createMoveToTrashButton(target.path, () => {
          const parent = target.path.split("/").slice(0, -1).join("/");
          setRoute(repoRoute(repoTarget, parent));
          loadRepo();
        }),
      );
    }
    if (internalKind !== "git") {
      loadRawFileInfo(target).then((meta) => {
        if (
          req !== SOURCE_REQ_SEQ ||
          !sourceTargetsEqual(sourceTargetFromRoute(), target)
        )
          return;
        header.appendChild(createFileDetailMeta(target, meta));
      });
    }
    if (!repoTarget) {
      const back = document.createElement("button");
      back.type = "button";
      back.className = "gdp-view-file gdp-btn gdp-btn-sm";
      setViewFileButtonState(back, true);
      back.addEventListener("click", () => {
        setRoute({ screen: "diff", range: currentRange() });
        setPageMode();
        removeStandaloneSource();
      });
      header.appendChild(back);
    }
    wrapper.appendChild(sticky);
    const detailBody = document.createElement("div");
    detailBody.className = "gdp-file-detail-body";
    wrapper.appendChild(detailBody);
    card.appendChild(wrapper);
    // Prepend instead of replaceChildren: the rendered diff cards stay alive
    // (hidden via body.gdp-repo-blob-page CSS), so leaving the blob view does
    // not force a full diff reload.
    mountFileShellCard(
      { $, repoFileTargetFromRoute, renderRepoBlobSidebar, placeSidebarToggle },
      target,
      card,
      repoTarget,
    );
    if (internalKind === "git") {
      renderSourceInternalPath(card, target);
      return;
    }
    const controller = new AbortController();
    ACTIVE_SOURCE_LOAD = { controller, req, target, card };
    renderSourceLoading(card, target, () => cancelActiveSourceLoad("user"));
    const sourceLoad = (async () => {
      try {
        let displayKind = sourceDisplayKind(target.path);
        let rawInfo: RawFileInfo | null = null;
        if (displayKind === "unsupported") {
          rawInfo = await loadRawFileInfo(target);
          if (
            req !== SOURCE_REQ_SEQ ||
            !sourceTargetsEqual(sourceTargetFromRoute(), target)
          )
            return;
          if (
            await sourceLooksTextByContent(target, rawInfo, controller.signal)
          ) {
            displayKind = "text";
          }
        }
        if (displayKind === "unsupported") {
          if (
            req !== SOURCE_REQ_SEQ ||
            !sourceTargetsEqual(sourceTargetFromRoute(), target)
          )
            return;
          finishSourceLoad(req);
          renderSourceUnsupported(card, target);
          return;
        }
        if (
          displayKind === "image" ||
          displayKind === "video" ||
          displayKind === "audio" ||
          displayKind === "pdf"
        ) {
          if (
            req !== SOURCE_REQ_SEQ ||
            !sourceTargetsEqual(sourceTargetFromRoute(), target)
          )
            return;
          finishSourceLoad(req);
          renderSourceMedia(card, target, displayKind);
          return;
        }
        if (displayKind === "text") {
          const meta = rawInfo ?? (await loadRawFileInfo(target));
          if (
            req !== SOURCE_REQ_SEQ ||
            !sourceTargetsEqual(sourceTargetFromRoute(), target)
          )
            return;
          if (
            !isVirtualSourceDisabled() &&
            meta.size != null &&
            meta.size >= VIRTUAL_SOURCE_SIZE_THRESHOLD
          ) {
            const rendered = await renderPagedSourceText(
              card,
              target,
              meta.size,
              controller.signal,
            );
            if (
              req !== SOURCE_REQ_SEQ ||
              !sourceTargetsEqual(sourceTargetFromRoute(), target)
            )
              return;
            if (!rendered) {
              // The only way to get here with a current req is the initial
              // range request failing (an abort always bumps SOURCE_REQ_SEQ
              // first). Land on "error" instead of leaving the card stuck in
              // "loading", which the idempotent-mount guard would otherwise
              // treat as in-progress and refuse to retry on re-click.
              finishSourceLoad(req);
              renderSourceError(
                card,
                target,
                `Cannot load ${target.path} at ${target.ref}`,
              );
              return;
            }
            scrollStandaloneSourceLine(
              card,
              lineTargetStart(
                STATE.route.screen === "file" ? STATE.route.line : undefined,
              ),
            );
            setSourceCardState(card, "done");
            finishSourceLoad(req);
            return;
          }
          const response = await trackLoad(
            fetch(buildRawFileUrl(target), { signal: controller.signal }),
          );
          if (
            req !== SOURCE_REQ_SEQ ||
            !sourceTargetsEqual(sourceTargetFromRoute(), target)
          )
            return;
          if (!response.ok) {
            finishSourceLoad(req);
            renderSourceError(
              card,
              target,
              `Cannot load ${target.path} at ${target.ref}`,
            );
            return;
          }
          const textValue = await response.text();
          if (
            req !== SOURCE_REQ_SEQ ||
            !sourceTargetsEqual(sourceTargetFromRoute(), target)
          )
            return;
          const rendered = await renderSourceText(
            card,
            target,
            textValue,
            controller.signal,
          );
          if (
            req !== SOURCE_REQ_SEQ ||
            !sourceTargetsEqual(sourceTargetFromRoute(), target)
          )
            return;
          if (!rendered) return;
          scrollStandaloneSourceLine(
            card,
            lineTargetStart(
              STATE.route.screen === "file" ? STATE.route.line : undefined,
            ),
          );
          setSourceCardState(card, "done");
          finishSourceLoad(req);
        }
      } catch (err) {
        if (
          req !== SOURCE_REQ_SEQ ||
          !sourceTargetsEqual(sourceTargetFromRoute(), target)
        )
          return;
        finishSourceLoad(req);
        if (isAbortError(err)) {
          renderSourceCancelled(card, target);
          return;
        }
        renderSourceError(
          card,
          target,
          `Cannot load ${target.path} at ${target.ref}`,
        );
      }
    })();
    const completed = sourceLoad.finally(() => {
      if (card._loadPromise === completed) delete card._loadPromise;
    });
    card._loadPromise = completed;
    return completed;
  }

  function scrollStandaloneSourceLine(
    card: HTMLElement,
    line: number | undefined,
  ) {
    if (!line || line < 1) return;
    const virtualScroller = card.querySelector<HTMLElement>(
      ".gdp-source-virtual-scroller",
    );
    if (virtualScroller) {
      const rowHeight = sourceLineScrollAmount() || VIRTUAL_SOURCE_ROW_HEIGHT;
      const centeredOffset = virtualScroller.clientHeight / 2 - rowHeight / 2;
      virtualScroller.scrollTop = Math.max(
        0,
        (line - 1) * rowHeight - Math.max(0, centeredOffset),
      );
      (
        virtualScroller as HTMLElement & {
          __gdpRenderVirtualSource?: () => void;
        }
      ).__gdpRenderVirtualSource?.();
      return;
    }
    const row = card.querySelector<HTMLElement>(
      `.gdp-source-table tr[data-line="${String(line)}"]`,
    );
    if (row) row.scrollIntoView({ block: "center" });
  }

  function applySourceRouteToShell(options: { refresh?: boolean } = {}) {
    const target = sourceTargetFromRoute();
    setPageMode();
    if (!target) {
      removeStandaloneSource();
      document
        .querySelectorAll<HTMLButtonElement>(".gdp-view-file")
        .forEach((button) => {
          setViewFileButtonState(button, false);
        });
      return;
    }
    renderStandaloneSource(target, options);
  }

  function inferLang(path: string): string | null {
    const name = sourceFileName(path);
    const fileLang = FILENAME_TO_LANG[name];
    if (fileLang) return fileLang;
    if (isDockerfileName(name)) return "dockerfile";
    if (isMakefileName(name)) return "makefile";
    const m = path.match(/\.([^.]+)$/);
    if (!m) return null;
    return EXT_TO_LANG[m[1].toLowerCase()] || null;
  }

  function handleVirtualSourcePagingKey(
    e: KeyboardEvent,
    targetEl: Element | null,
  ): boolean {
    if ((e as VirtualSourcePagingKeyboardEvent).__gdpVirtualSourcePagingHandled)
      return true;
    if (
      e.defaultPrevented ||
      isImeComposing(e) ||
      isPaletteOpen() ||
      document.querySelector(".mkdp-lightbox")
    )
      return false;
    const editable = isEditableKeyTarget(targetEl);
    const inVirtualSearch = !!targetEl?.closest(".gdp-source-virtual-search");
    if (editable && !inVirtualSearch) return false;
    const key = e.key.toLowerCase();
    if (e.altKey || e.metaKey) return false;
    const isPlainPageKey =
      (key === "pagedown" || key === "pageup") && !e.ctrlKey && !e.shiftKey;
    const isCtrlArrowKey =
      (key === "arrowdown" || key === "arrowup") && e.ctrlKey && !e.shiftKey;
    if (!isPlainPageKey && !isCtrlArrowKey) return false;
    const scroller = findMainScrollTarget();
    if (!scroller?.matches("#content .gdp-source-virtual-scroller"))
      return false;
    const pageDown = key === "pagedown" || key === "arrowdown";
    const pageUp = key === "pageup" || key === "arrowup";
    if (!pageDown && !pageUp) return false;
    (e as VirtualSourcePagingKeyboardEvent).__gdpVirtualSourcePagingHandled =
      true;
    e.preventDefault();
    e.stopPropagation();
    scrollMainPanel(pageDown ? 1 : -1, e.repeat, "page");
    focusMainSurface();
    return true;
  }

  function handleVirtualSourcePagingKeydown(e: KeyboardEvent) {
    handleVirtualSourcePagingKey(e, e.target as Element | null);
  }

  return {
    renderStandaloneSource,
    applySourceRouteToShell,
    removeStandaloneSource,
    cancelActiveSourceLoad,
    finishSourceLoad,
    sourceTargetsEqual,
    sourceTargetFromRoute,
    fileSourceTarget,
    scrollStandaloneSourceLine,
    createSourceTabs,
    setPreferredSourceTab,
    switchSourceTab,
    sourceLineScrollAmount,
    hasVisibleSourceCodeSurface,
    moveSourceCursor,
    ensureSourceCursor,
    resetSourceCursorForTarget,
    syncSourceCursorRows,
    scrollSourceCursorIntoView,
    visibleSourceLineFallback,
    handleVirtualSourcePagingKeydown,
    openVirtualSourceSearchFromKeyboard,
    isVirtualSourceDisabled,
    currentSourceLineTarget,
    lineTargetStart,
    lineInSourceTarget,
    setSourceLineRoute,
    syncRenderedSourceLineHighlights,
    bindSourceLineNumber,
    renderSourceError,
    loadSourceShikiHighlighter,
    sourceShikiLines,
    shouldVirtualizeSource,
    inferLang,
  };
}
