import { live } from "lit/directives/live.js";
import { ref } from "lit/directives/ref.js";
import { repeat } from "lit/directives/repeat.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { html, nothing, type TemplateResult } from "lit/html.js";
import { apiUrl, projectKey } from "../core/api-url";
import { showCopyFailure, showHighlightFailure } from "../core/copy-failure";
import {
  errorWithCause,
  formatErrorDetail,
  responseErrorMessage,
} from "../core/error-detail";
// Standalone source view: text/virtual/paged renderers, shiki highlight,
// HTML/markdown preview tabs, line selection + keyboard cursor, in-source
// search, and the source load/cancel machinery. Extracted from app.ts as a
// deps-injected factory.

import {
  focusMainPanel,
  isEditableKeyTarget,
  isPageKeymapBlockedTarget,
} from "../core/focus-scope";
import { COPY_16_PATHS } from "../core/icons";
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
import { SHIKI_THEMES } from "../core/shiki-theme";
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
import { DIFF_SCREEN_TEXT } from "./diff-view-i18n";
import {
  createFileShellSticky,
  type FileViewTab,
  fileViewTabsTemplate,
  isMediaPreviewOnlySource,
  mountFileShellCard,
  type SourceBlobTab,
} from "./file-shell";
import {
  type MarkdownLinkNavigationDeps,
  openMarkdownLink,
} from "./markdown-link-navigation";
import {
  type DelimitedPreviewElement,
  mediaEmbedTemplate,
  renderDelimitedPreview,
  renderHtmlPreviewFrame,
  renderUnsupportedPreview,
} from "./source-preview-elements";
import {
  type DelimitedPreviewLanguage,
  delimitedPreviewText,
  SOURCE_READING_TEXT,
} from "./source-preview-i18n";
import { markNeedleInCell } from "./text-mark";
import { iconTemplate } from "./ui/icon";
import { renderOwned, templateElement } from "./ui/renderer";

export type VirtualSourcePagingKeyboardEvent = KeyboardEvent & {
  __gdpVirtualSourcePagingHandled?: boolean;
};

/**
 * 仮想の行の左に足す欄 (大きなファイルの Blame が使う)。行番号は 1 から。
 * 「全部を描く」の後は fullView で描き直す (無ければ本文の表示)。
 */
export type VirtualSourceGutter = {
  rowClass: string;
  cell(line: number): HTMLElement;
  fullView(): void;
};

export type SourceViewDeps = {
  STATE: {
    route: AppRoute;
    from: string;
    to: string;
    files: FileMeta[];
    syntaxHighlight: boolean;
  };
  /**
   * この実体が描く route。左の面 (本文) なら STATE.route、右の面ならその面の
   * 前面のタブの route。STATE.route を直接読まない (面ごとに違うため)。
   */
  route(): AppRoute;
  /** この実体の route を変える (左は app の setRoute、右はその面の route)。 */
  setRoute(route: AppRoute, replace?: boolean): void;
  /** この実体が描いたものを探す範囲 (左は #content、右はその面の箱)。 */
  scope(): ParentNode;
  /** ソースのカードを差し込む先 (左は #diff、右はその面の箱の本体)。 */
  mountRoot(): HTMLElement;
  /** この実体のスクロール先 (左は本文の scroller、右はその面の箱の scroller)。 */
  mainScrollTarget(): HTMLElement | null;
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
  createRevisionNav?(
    target: SourceFileTarget,
    activeTab: FileViewTab,
  ): HTMLElement | null;
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
  /**
   * Code / Preview を切り替えた後にキー操作の相手を置く先。無ければ本文
   * (#content)。右の面の実体はその面の枠。
   */
  focusPanel?(): void;
  isPaletteOpen(): boolean;
  getLanguage(): DelimitedPreviewLanguage;
  onSourceRendered?(): void;
  /**
   * この実体が読む URL (ファイルの中身・範囲・生のリンク) を送る先へ直す。別の
   * プロジェクトのファイルを出す実体は、そのプロジェクトの `/p/<鍵>` へ向ける
   * (app.ts の別のプロジェクトの面)。無ければこのページのプロジェクト。
   */
  requestUrl?(url: string): string;
};

/** 小さなファイルの表と、色付けした行で描き直す口。 */
type SourceTable = {
  table: HTMLTableElement;
  highlight(lines: string[]): void;
};

export function createSourceView(deps: SourceViewDeps) {
  const {
    STATE,
    route: currentRoute,
    setRoute,
    scope,
    mountRoot,
    mainScrollTarget,
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
    createRevisionNav,
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
    getLanguage,
  } = deps;

  /** この実体の route がファイルなら、その route。 */
  function currentFileRoute(): Extract<AppRoute, { screen: "file" }> | null {
    const route = currentRoute();
    return route.screen === "file" ? route : null;
  }

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
    open: (query?: string) => void;
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
    const virtualRow = scope().querySelector<HTMLElement>(
      ".gdp-source-virtual:not([hidden]) .gdp-source-virtual-row",
    );
    if (virtualRow)
      return (
        virtualRow.getBoundingClientRect().height || VIRTUAL_SOURCE_ROW_HEIGHT
      );
    const sourceRow = scope().querySelector<HTMLElement>(
      ".gdp-source-table:not([hidden]) tr",
    );
    if (sourceRow) return sourceRow.getBoundingClientRect().height || 20;
    const preview = scope().querySelector<HTMLElement>(
      ".gdp-markdown-preview:not([hidden])",
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
      scope().querySelectorAll<HTMLElement>(
        ".gdp-source-virtual-scroller, .gdp-source-table",
      ),
    ).some((item) => item.offsetParent !== null);
  }

  function sourceCursorKey(target: SourceFileTarget): string {
    return `${projectKey() ?? ""}\0${target.ref}\0${target.path}`;
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
        scope().querySelectorAll<HTMLElement>(
          ".gdp-source-table tr.gdp-source-cursor, .gdp-source-virtual-row.gdp-source-cursor",
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
    const table = scope().querySelector<HTMLTableElement>(".gdp-source-table");
    const tableRow = table?.rows[SOURCE_CURSOR.line - 1];
    if (tableRow?.dataset.line === line) {
      tableRow.classList.add("gdp-source-cursor");
      SOURCE_CURSOR_ROWS.push(tableRow);
    }
    const windowEl = scope().querySelector<HTMLElement>(
      ".gdp-source-virtual-window",
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
    const scroller = mainScrollTarget();
    const rowHeight = sourceLineScrollAmount() || VIRTUAL_SOURCE_ROW_HEIGHT;
    if (scroller)
      return Math.max(1, Math.floor(scroller.scrollTop / rowHeight) + 1);
    const rows = Array.from(
      scope().querySelectorAll<HTMLElement>(".gdp-source-table tr[data-line]"),
    );
    const scopeTop =
      scope() instanceof HTMLElement
        ? (scope() as HTMLElement).getBoundingClientRect().top
        : 0;
    const row = rows.find(
      (item) => item.getBoundingClientRect().bottom >= Math.max(0, scopeTop),
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
    const scroller = mainScrollTarget();
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
    scope()
      .querySelector<HTMLElement>(`[data-line="${cursor.line}"]`)
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
        ((mainScrollTarget()?.clientHeight || window.innerHeight) * 0.55) /
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
    const route = currentRoute();
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
    const tabs = scope().querySelector<HTMLElement>(".gdp-source-tabs");
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
      const codePane = scope().querySelector<HTMLElement>(
        '[data-source-pane="code"]',
      );
      const previewPane = scope().querySelector<HTMLElement>(
        '[data-source-pane="preview"]',
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
      if (applied) (deps.focusPanel ?? focusMainPanel)();
      return applied;
    }
    button.click();
    (deps.focusPanel ?? focusMainPanel)();
    return true;
  }

  function loadSourceShikiHighlighter(
    lang: string,
  ): Promise<ShikiHighlighter | null> {
    if (deps.loadSourceHighlighter) return deps.loadSourceHighlighter(lang);
    return loadShikiHighlighter({
      langs: [lang],
    });
  }

  /**
   * Shiki で行ごとの HTML にする。失敗したら理由 (言語と元の例外) を付けて
   * 投げる: 呼び出し側が原文のまま失敗の印を付ける (showHighlightFailure)。
   */
  function sourceShikiLines(
    textValue: string,
    lang: string,
    highlighter: ShikiHighlighter,
  ): string[] {
    let html: string;
    try {
      html = highlighter.codeToHtml(textValue || " ", {
        lang,
        themes: SHIKI_THEMES,
        defaultColor: false,
      });
    } catch (error) {
      throw errorWithCause(`shiki could not highlight ${lang}`, error);
    }
    // 色付けした HTML を読むだけ (画面には置かない)。行ごとの中身を取り出す。
    const parsed = new DOMParser().parseFromString(html, "text/html");
    const renderedLines = Array.from(
      parsed.querySelectorAll<HTMLElement>(".line"),
    );
    if (!renderedLines.length)
      throw new Error(`shiki returned no lines for ${lang}`);
    return renderedLines.map((line) => line.innerHTML || " ");
  }

  function scheduleSourceHighlight(
    sourceTable: SourceTable,
    target: SourceFileTarget,
    textValue: string,
    lang: string,
    signal?: AbortSignal,
  ): void {
    const { table } = sourceTable;
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
          sourceTable.highlight(highlightedLines);
        })
        .catch((err: unknown) => {
          showHighlightFailure(
            table,
            `syntax highlighting failed for ${target.path}`,
            err,
          );
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
          showHighlightFailure(
            preview,
            `preview syntax highlighting failed for ${target.path}`,
            err,
          );
        });
    }, 0);
  }

  function setPreferredSourceTab(tab: SourceBlobTab): void {
    PREFERRED_SOURCE_TAB = tab;
  }

  function preferredSourceTabFor(previewable: boolean): SourceBlobTab {
    if (!previewable) return "code";
    const fileRoute = currentFileRoute();
    const routeTab =
      fileRoute?.view === "blob" && fileRoute.preview ? "preview" : "code";
    return PREFERRED_SOURCE_TAB || routeTab;
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
    const route = currentRoute();
    if (route.screen === "file") return { path: route.path, ref: route.ref };
    if (route.screen === "history" && route.source) {
      // Resolved through the loaded diff so a deleted file reads from the
      // parent side, exactly as the View File button computed it.
      const file = STATE.files.find((f) => f.path === route.source);
      return file ? fileSourceTarget(file) : null;
    }
    return null;
  }

  /**
   * 貼り付くファイルの見出しの高さを --doc-head-h に出す。Markdown の見出しの
   * scroll-margin-top がこれを読み、URL の # で送ったとき (ブラウザが自分で
   * スクロールする) に、見出しが貼り付いた見出しの下に潜らないようにする。
   * 見出しは幅で 1〜3 段に変わる (doc-head の段) ので、大きさが変わるたびに書く。
   */
  function observeDocHeadHeight(wrapper: HTMLElement, sticky: HTMLElement) {
    const write = () =>
      wrapper.style.setProperty(
        "--doc-head-h",
        `${Math.ceil(sticky.getBoundingClientRect().height)}px`,
      );
    if (typeof ResizeObserver !== "function") {
      write();
      return;
    }
    const observer = new ResizeObserver(() => {
      if (!sticky.isConnected) {
        observer.disconnect();
        return;
      }
      write();
    });
    observer.observe(sticky);
  }

  function removeStandaloneSource() {
    scope()
      .querySelectorAll(".gdp-standalone-source")
      .forEach((el) => {
        el.remove();
      });
    scope()
      .querySelectorAll(".gdp-repo-blob-layout")
      .forEach((el) => {
        el.remove();
      });
  }

  /** カードの本文 (読み込み中・失敗などの面) を view に差し替える。 */
  function replaceSourceBody(card: DiffCardElement, view: HTMLElement): void {
    const body = card.querySelector<HTMLElement>(
      ".gdp-file-detail-body, .d2h-files-diff, .d2h-file-diff, .gdp-media, .gdp-source-viewer",
    );
    if (body) body.replaceWith(view);
    else card.appendChild(view);
  }

  function renderSourceLoading(
    card: DiffCardElement,
    target: SourceFileTarget,
    onCancel?: () => void,
  ) {
    const view = templateElement(
      html`<div class="gdp-source-viewer loading"></div>`,
    );
    const startedAt = Date.now();
    /** 長くかかっているときの経過秒 (null はまだ普通の待ち)。 */
    let elapsed: number | null = null;
    const draw = () => {
      const text = SOURCE_READING_TEXT[getLanguage()];
      renderOwned(
        view,
        html`<div class="gdp-source-loading-content"><span
            class="gdp-source-loading-spinner"
            aria-hidden="true"
          ></span><strong class="gdp-source-loading-title"
            >${elapsed === null ? text.loadingFile : text.stillLoading(elapsed)}</strong
          ><div class="gdp-source-loading-message">${text.fileAtRef(
            target.path,
            target.ref,
          )}</div>${
            elapsed === null
              ? nothing
              : html`<div class="gdp-source-loading-slow-note">${text.slowNote(
                  elapsed,
                )}</div>`
          }${
            onCancel
              ? html`<button
                  type="button"
                  class="gdp-btn gdp-btn-sm gdp-source-cancel"
                  title=${text.cancelTitle}
                  @click=${(event: MouseEvent) => {
                    event.stopPropagation();
                    onCancel();
                  }}
                >${text.cancel}</button>`
              : nothing
          }</div>`,
      );
    };
    draw();
    // Loads usually finish in well under a second. If this exact loading
    // view is still mounted past the threshold, that is no longer the
    // common case, so say so explicitly instead of leaving the user
    // guessing whether the app has silently hung.
    window.setTimeout(() => {
      if (!view.isConnected) return;
      let interval: number | null = null;
      const updateSlowNote = () => {
        if (!view.isConnected) {
          if (interval !== null) window.clearInterval(interval);
          return;
        }
        elapsed = Math.max(1, Math.floor((Date.now() - startedAt) / 1000));
        draw();
      };
      updateSlowNote();
      interval = window.setInterval(updateSlowNote, 1000);
    }, SOURCE_LOADING_SLOW_THRESHOLD_MS);
    replaceSourceBody(card, view);
  }

  function renderSourceError(
    card: DiffCardElement,
    target: SourceFileTarget,
    message: string,
  ) {
    replaceSourceBody(
      card,
      templateElement(
        html`<div class="gdp-source-viewer error">${
          message ||
          SOURCE_READING_TEXT[getLanguage()].cannotLoad(target.path, target.ref)
        }</div>`,
      ),
    );
    setSourceCardState(card, "error");
  }

  function renderSourceCancelled(
    card: DiffCardElement,
    target: SourceFileTarget,
  ) {
    const text = SOURCE_READING_TEXT[getLanguage()];
    replaceSourceBody(
      card,
      templateElement(
        html`<div class="gdp-source-viewer cancelled"><div
            class="gdp-source-loading-content"
          ><strong class="gdp-source-loading-title">${text.loadingCancelled}</strong
            ><div class="gdp-source-loading-message">${text.fileAtRef(
              target.path,
              target.ref,
            )}</div><button
              type="button"
              class="gdp-btn gdp-btn-sm"
              @click=${() =>
                renderStandaloneSource(sourceTargetFromRoute() || target)}
            >${text.reopen}</button></div></div>`,
      ),
    );
    setSourceCardState(card, "cancelled");
  }

  function renderSourceUnsupported(
    card: DiffCardElement,
    target: SourceFileTarget,
  ) {
    const text = SOURCE_READING_TEXT[getLanguage()];
    const info = createSourceFileInfo(target, "unsupported file");
    const link = templateElement(
      html`<a
        class="gdp-btn gdp-btn-sm gdp-source-download"
        href=${rawFileUrl(target)}
        target="_blank"
        rel="noreferrer"
      >${text.downloadRaw}</a>`,
    );
    replaceSourceBody(
      card,
      renderUnsupportedPreview({
        message: text.unsupported,
        extraChildren: [info, link],
      }),
    );
    setSourceCardState(card, "done");
  }

  function renderSourceInternalPath(
    card: DiffCardElement,
    target: SourceFileTarget,
  ) {
    const info = createSourceFileInfo(target, "internal metadata", {
      loadMeta: false,
    });
    replaceSourceBody(
      card,
      renderUnsupportedPreview({
        message: SOURCE_READING_TEXT[getLanguage()].internalMetadata,
        extraChildren: [info],
      }),
    );
    setSourceCardState(card, "done");
  }

  function renderHtmlPreview(
    target: SourceFileTarget,
    html: string,
  ): HTMLElement {
    return renderHtmlPreviewFrame(`${target.path} preview`, html);
  }

  /** ファイルの種類と大きさ (と、画像なら縦横) の小さな行。 */
  function sourceFileInfo(
    target: SourceFileTarget,
    kind: string,
    options: { loadMeta?: boolean } = {},
  ): { element: HTMLElement; setResolution(text: string): void } {
    const element = templateElement(
      html`<div class="gdp-source-file-info"></div>`,
    );
    let meta: RawFileInfo | undefined;
    let resolution = "";
    const draw = () =>
      renderOwned(
        element,
        html`<span class="kind">${humanFileKind(
          target.path,
          meta?.type,
          kind,
          getLanguage(),
        )}</span>${
          meta?.size != null
            ? html`<span>${formatBytes(meta.size)}</span>`
            : nothing
        }${resolution ? html`<span>${resolution}</span>` : nothing}`,
      );
    draw();
    if (options.loadMeta !== false)
      loadRawFileInfo(target).then((loaded) => {
        meta = loaded;
        draw();
      });
    return {
      element,
      setResolution(text) {
        resolution = text;
        draw();
      },
    };
  }

  function createSourceFileInfo(
    target: SourceFileTarget,
    kind: string,
    options: { loadMeta?: boolean } = {},
  ): HTMLElement {
    return sourceFileInfo(target, kind, options).element;
  }

  /**
   * 中身をコピーするボタン。textValue が null なら読み込む前の場所取り
   * (押せない。読み込んだら本物と差し替える)。
   */
  function sourceCopyButtonTemplate(
    textValue: string | null,
    extraClass = "",
  ): TemplateResult {
    const text = SOURCE_READING_TEXT[getLanguage()];
    return html`<button
      type="button"
      class=${`gdp-file-header-icon gdp-copy-source${extraClass ? ` ${extraClass}` : ""}`}
      title=${text.copySource}
      aria-label=${text.copySource}
      ?disabled=${textValue === null}
      @click=${async (event: MouseEvent) => {
        if (textValue === null) return;
        const copy = event.currentTarget as HTMLButtonElement;
        try {
          await navigator.clipboard.writeText(textValue);
          copy.classList.add("copied");
          setTimeout(() => {
            copy.classList.remove("copied");
          }, 1200);
        } catch (error) {
          showCopyFailure(
            copy,
            "copy the source to the clipboard",
            error,
            text.copySource,
            1600,
          );
        }
      }}
    >${iconTemplate(COPY_16_PATHS, "octicon-copy")}</button>`;
  }

  function sourceLineJumpTemplate(target: SourceFileTarget): TemplateResult {
    const text = SOURCE_READING_TEXT[getLanguage()];
    const total = SOURCE_CURSOR_TOTALS.get(sourceCursorKey(target));
    // 文字は span に包む: 狭い面では CSS がこれだけを畳む (欄は残す)。
    // localize は label の最初の子の文字を書き換える。
    return html`<form
      class="gdp-source-line-jump"
      @submit=${(event: SubmitEvent) => {
        event.preventDefault();
        const input = (event.currentTarget as HTMLFormElement).querySelector(
          "input",
        );
        if (!input?.reportValidity()) return;
        const cursor = ensureSourceCursor(target);
        cursor.line = input.valueAsNumber;
        syncSourceCursorRows(target);
        scrollSourceCursorIntoView(cursor, "center");
        focusMainSurface();
      }}
    ><span class="gdp-source-line-count">${
      total ? text.total(total) : text.totalPending
    }</span><label><span class="gdp-source-line-jump-label">${text.line}</span><input
          type="number"
          min="1"
          step="1"
          required
          max=${total ? String(total) : nothing}
          aria-label=${text.line}
          .value=${String(lineTargetStart(currentSourceLineTarget(target)) || 1)}
        /></label
      ><button type="submit" class="gdp-btn gdp-btn-sm">${text.go}</button></form>`;
  }

  /**
   * 見出しの右の切替・行へ移る欄・コピー。textValue が null なら読み込む前の
   * 場所取り (コピーは押せない)、undefined ならコピーを置かない (大きいファイル
   * を分けて読むとき)。
   */
  function createSourceTabs(
    target: SourceFileTarget,
    active: SourceBlobTab,
    textValue?: string | null,
    options: { previewable?: boolean } = {},
  ) {
    const tabs = templateElement(
      html`<div class="gdp-source-tabs">${fileViewTabsTemplate(
        { currentRange, setRoute, setPreferredSourceTab },
        target,
        active,
        {
          includeFileTabs:
            currentRoute().screen === "file" &&
            sourceInternalPathKind(target.path) !== "code-viewer",
          previewable: !!options.previewable || active === "preview",
          sourceTabClick: "manual",
          ...(textValue !== undefined
            ? { sourceCopyButton: sourceCopyButtonTemplate(textValue) }
            : {}),
        },
      )}${sourceLineJumpTemplate(target)}</div>`,
    );
    const button = (tab: SourceBlobTab) =>
      tabs.querySelector<HTMLButtonElement>(`button[data-file-tab="${tab}"]`);
    return {
      tabs,
      codeButton: button("code"),
      previewButton: button("preview"),
    };
  }

  /** 行番号の欄に、行を選ぶ操作を 1 度だけ付ける (描き直しでは付け直さない)。 */
  const boundLineNumbers = new WeakSet<Element>();
  function lineNumberRef(
    card: HTMLElement,
    target: SourceFileTarget,
    line: number,
  ) {
    return ref((element) => {
      if (!(element instanceof HTMLElement) || boundLineNumbers.has(element))
        return;
      boundLineNumbers.add(element);
      bindSourceLineNumber(element, card, target, line);
    });
  }

  /**
   * 小さなファイルの表。行は 500 行ずつ描いて間に休む (大きめのファイルで画面を
   * 止めない)。色付けが届いたら、同じ行を色付けした中身で描き直す。
   */
  async function buildSourceTable(
    card: DiffCardElement,
    target: SourceFileTarget,
    lines: string[],
    signal?: AbortSignal,
  ): Promise<SourceTable | null> {
    const table = templateElement<HTMLTableElement>(
      html`<table class="gdp-source-table" data-source-pane="code"><tbody></tbody></table>`,
    );
    const tbody = table.tBodies[0];
    if (!tbody) throw new Error("source table: the body was not drawn");
    let highlighted: string[] | null = null;
    const rows = (count: number) => {
      const lineTarget = currentSourceLineTarget(target);
      return lines.slice(0, count).map((line, index) => {
        const number = index + 1;
        const code = highlighted?.[index];
        const cls = [
          lineInSourceTarget(number, lineTarget)
            ? "gdp-source-line-target"
            : "",
          sourceCursorMatches(target, number) ? "gdp-source-cursor" : "",
        ]
          .filter(Boolean)
          .join(" ");
        return html`<tr data-line=${String(number)} class=${cls}><td
            class="gdp-source-line-number"
            ${lineNumberRef(card, target, number)}
          >${String(number)}</td>${
            // 同じ升のまま中身だけを色付けしたものに替える (升を作り直さない)。
            html`<td class=${code == null ? "gdp-source-line-code" : "gdp-source-line-code shiki"}
              >${code == null ? line || " " : unsafeHTML(code || " ")}</td
            >`
          }</tr>`;
      });
    };
    /** 描いた行のうち from から後の目当ての行に、探した語の印を付ける。 */
    const markFrom = (from: number) => {
      const cells = tbody.querySelectorAll<HTMLElement>(
        ".gdp-source-line-code",
      );
      for (let index = from; index < cells.length; index++) {
        const cell = cells[index];
        if (cell)
          markSourceHighlightTerm(cell, lines[index] ?? "", index + 1, target);
      }
    };
    for (let drawn = 0; drawn < lines.length; ) {
      if (signal?.aborted) return null;
      const next = Math.min(lines.length, drawn + 500);
      renderOwned(tbody, rows(next));
      markFrom(drawn);
      drawn = next;
      if (drawn < lines.length) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        if (signal?.aborted) return null;
      }
    }
    return {
      table,
      highlight(next) {
        highlighted = next;
        renderOwned(tbody, rows(lines.length));
        markFrom(0);
      },
    };
  }

  async function renderSourceText(
    card: DiffCardElement,
    target: SourceFileTarget,
    textValue: string,
    signal?: AbortSignal,
  ): Promise<boolean> {
    const lines = splitSourceLines(textValue);
    SOURCE_CURSOR_TOTALS.set(sourceCursorKey(target), lines.length);
    resetSourceCursorForTarget(target, lines.length);
    const body = card.querySelector<HTMLElement>(
      ".gdp-file-detail-body, .d2h-files-diff, .d2h-file-diff, .gdp-media, .gdp-source-viewer",
    );
    const isStandalone = card.classList.contains("gdp-standalone-source");
    /** 本文の面。単独で開いたカードでなければ、頭にパスと ref を出す。 */
    const sourceView = (virtual: boolean, children: Node[]) =>
      templateElement(
        html`<div class=${virtual ? "gdp-source-viewer virtual" : "gdp-source-viewer"}
          >${
            isStandalone
              ? nothing
              : html`<div class="gdp-source-meta">${target.path} @ ${target.ref}</div>`
          }${children}</div
        >`,
      );
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
    const initialSourceTab = preferredSourceTabFor(previewable);
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
            : previewKind === "csv" || previewKind === "tsv"
              ? renderDelimitedPreview(textValue, previewKind, () =>
                  delimitedPreviewText(getLanguage(), previewKind),
                )
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
            previewKind !== "markdown" ||
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
        const view = sourceView(true, [preview, virtualCode]);
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
      if (signal?.aborted) return false;
      const view = sourceView(true, [virtualCode]);
      if (body) body.replaceWith(view);
      else card.appendChild(view);
      return true;
    }
    const sourceTable = await buildSourceTable(card, target, lines, signal);
    if (!sourceTable) return false;
    const { table } = sourceTable;
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
          : previewKind === "csv" || previewKind === "tsv"
            ? renderDelimitedPreview(textValue, previewKind, () =>
                delimitedPreviewText(getLanguage(), previewKind),
              )
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
          previewKind !== "markdown" ||
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
      if (signal?.aborted) return false;
      const view = sourceView(false, [preview, table]);
      if (body) body.replaceWith(view);
      else card.appendChild(view);
      if (STATE.syntaxHighlight && sourceShikiLang)
        scheduleSourceHighlight(
          sourceTable,
          target,
          textValue,
          sourceShikiLang,
          signal,
        );
      if (initialSourceTab === "preview") ensurePreviewHighlight();
      return true;
    }
    if (signal?.aborted) return false;
    const view = sourceView(false, [table]);
    if (body) body.replaceWith(view);
    else card.appendChild(view);
    if (STATE.syntaxHighlight && sourceShikiLang)
      scheduleSourceHighlight(
        sourceTable,
        target,
        textValue,
        sourceShikiLang,
        signal,
      );
    return true;
  }

  function splitSourceLines(textValue: string): string[] {
    return textValue.length
      ? textValue.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n")
      : [""];
  }

  /**
   * 仮想で描く大きさなら、左の欄つきの仮想の行で描く (大きなファイルの Blame。
   * 全部の行を表に組むと、2.7 万行で 3 秒止まった)。小さければ null。
   */
  async function renderVirtualSourceWithGutter(
    target: SourceFileTarget,
    textValue: string,
    gutter: VirtualSourceGutter,
  ): Promise<HTMLElement | null> {
    const lines = splitSourceLines(textValue);
    if (!shouldVirtualizeSource(textValue, lines) || isVirtualSourceDisabled())
      return null;
    const hljsRef = STATE.syntaxHighlight
      ? await loadSyntaxHighlighter()
      : null;
    return renderVirtualSource(
      target,
      textValue,
      lines,
      hljsRef,
      inferLang(target.path),
      gutter,
    );
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
      fetch(rawFileUrl(target), {
        headers: { Range: `bytes=0-${end}` },
        signal,
      }),
    );
    if (!response.ok && response.status !== 206) return false;
    return isLikelyTextBytes(new Uint8Array(await response.arrayBuffer()));
  }

  function isVirtualSourceDisabled(): boolean {
    return currentFileRoute()?.virtual === "off";
  }

  function buildCurrentFileRouteWithVirtualMode(
    target: SourceFileTarget,
    virtualMode: "auto" | "off",
  ): string {
    const route: AppRoute = {
      screen: "file",
      path: target.path,
      ref: target.ref,
      view: currentFileRoute()?.view ?? "blob",
      range: currentRange(),
      ...(virtualMode === "off" ? { virtual: "off" as const } : {}),
    };
    return buildRoute(route);
  }

  /** ファイルの中身の URL (この実体が読むプロジェクトの)。 */
  function rawFileUrl(target: SourceFileTarget): string {
    const url = buildRawFileUrl(target);
    return deps.requestUrl ? deps.requestUrl(url) : url;
  }

  function buildFileRangeUrl(
    target: SourceFileTarget,
    start: number,
    end: number,
  ): string {
    const url =
      apiUrl("fileRange") +
      "?path=" +
      encodeURIComponent(target.path) +
      "&ref=" +
      encodeURIComponent(target.ref || "worktree") +
      "&start=" +
      encodeURIComponent(String(start)) +
      "&end=" +
      encodeURIComponent(String(end));
    return deps.requestUrl ? deps.requestUrl(url) : url;
  }

  function currentSourceLineTarget(
    target: SourceFileTarget,
  ): SourceLineTarget | undefined {
    const routeTarget = sourceTargetFromRoute();
    return sourceTargetsEqual(routeTarget, target)
      ? currentFileRoute()?.line
      : undefined;
  }

  // "hl=" on the file route: the text (a grep hit) to mark on the target
  // line(s). Only meaningful together with a line target.
  function currentSourceHighlightTerm(
    target: SourceFileTarget,
  ): string | undefined {
    const routeTarget = sourceTargetFromRoute();
    const fileRoute = currentFileRoute();
    return sourceTargetsEqual(routeTarget, target) &&
      fileRoute?.line &&
      fileRoute.hl
      ? fileRoute.hl
      : undefined;
  }

  // Same file, new hit: drop the previous <mark>s and mark the new target
  // line. A virtual file re-opens its find bar with the new term instead,
  // which re-renders its rows.
  function syncSourceHighlightMarks(
    card: HTMLElement,
    target: SourceFileTarget,
  ): void {
    card
      .querySelectorAll<HTMLElement>("mark.gdp-grep-match")
      .forEach((mark) => {
        const parent = mark.parentElement;
        if (!parent) return;
        while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
        parent.removeChild(mark);
        parent.normalize();
      });
    const term = currentSourceHighlightTerm(target);
    const virtual = card.querySelector<VirtualSourceSearchRoot>(
      ".gdp-source-virtual",
    );
    if (virtual?.__gdpVirtualSourceSearch) {
      if (term) virtual.__gdpVirtualSourceSearch.open(term);
      return;
    }
    if (!term) return;
    card
      .querySelectorAll<HTMLElement>(".gdp-source-table tr[data-line]")
      .forEach((row) => {
        const cell = row.querySelector<HTMLElement>(".gdp-source-line-code");
        if (!cell) return;
        markSourceHighlightTerm(
          cell,
          cell.textContent ?? "",
          Number(row.dataset.line || "0"),
          target,
        );
      });
  }

  function markSourceHighlightTerm(
    cell: HTMLElement,
    lineText: string,
    lineNumber: number,
    target: SourceFileTarget,
  ): void {
    const term = currentSourceHighlightTerm(target);
    if (!term) return;
    if (!lineInSourceTarget(lineNumber, currentSourceLineTarget(target)))
      return;
    markNeedleInCell(cell, lineText, term, "gdp-grep-match");
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
    const fileRoute = currentFileRoute();
    if (!fileRoute) return;
    setRoute(
      {
        screen: "file",
        path: target.path,
        ref: target.ref,
        view: fileRoute.view,
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

  /** 検索の当たりに印を付けた行の中身。当たりが無ければ null。 */
  function virtualSourceSearchLineTemplate(
    line: string,
    query: string,
    activeRange: VirtualSourceSearchMatch | null,
    lineNumber: number,
  ): TemplateResult | null {
    const ranges = virtualSourceSearchRanges(line, query);
    if (!ranges.length) return null;
    const pieces: unknown[] = [];
    let cursor = 0;
    for (const range of ranges) {
      if (range.start > cursor) pieces.push(line.slice(cursor, range.start));
      const active =
        !!activeRange &&
        activeRange.line === lineNumber &&
        activeRange.start === range.start &&
        activeRange.end === range.end;
      pieces.push(
        html`<mark
          class=${active ? "gdp-source-virtual-search-hit active" : "gdp-source-virtual-search-hit"}
          >${line.slice(range.start, range.end)}</mark
        >`,
      );
      cursor = range.end;
    }
    if (cursor < line.length) pieces.push(line.slice(cursor));
    return html`<span class="gdp-source-virtual-line-code">${pieces}</span>`;
  }

  type VirtualRow = {
    number: number;
    /** 行の文字 (まだ読んでいなければ null)。 */
    text: string | null;
    /** 読めなかった範囲の行の理由。 */
    failedReason?: string;
  };

  /**
   * 仮想の窓の行を描く。行は行番号で結ぶ (窓が動いても、同じ行の要素は同じ行の
   * まま。行番号の操作はその行に付く)。色付けに失敗した行は原文のまま、行に
   * 失敗の印と理由を付ける。
   */
  function drawVirtualRows(
    windowEl: HTMLElement,
    wrap: HTMLElement,
    target: SourceFileTarget,
    rows: VirtualRow[],
    search: VirtualSourceSearchHandle | null,
    hljsRef: HljsApi | null,
    lang: string | null,
    gutter?: VirtualSourceGutter,
  ): void {
    const lineTarget = currentSourceLineTarget(target);
    const query = search?.query() || "";
    const activeRange = search?.activeRange() || null;
    const failures: Array<{ line: number; error: unknown }> = [];
    const codeTemplate = (row: VirtualRow): TemplateResult => {
      const line = row.text;
      if (line == null)
        // 読めなかった範囲の行は空のままにせず、失敗の印と理由を付ける。
        return html`<span
          class=${row.failedReason ? "gdp-source-virtual-line-code gdp-highlight-failed" : "gdp-source-virtual-line-code"}
          title=${row.failedReason ?? nothing}
        ></span>`;
      const marked = virtualSourceSearchLineTemplate(
        line,
        query,
        activeRange,
        row.number,
      );
      if (marked) return marked;
      if (
        hljsRef?.highlight &&
        lang &&
        line.length <= VIRTUAL_SOURCE_HIGHLIGHT_MAX_LINE_LENGTH &&
        (!hljsRef.getLanguage || hljsRef.getLanguage(lang))
      ) {
        try {
          const value = hljsRef.highlight(line, {
            language: lang,
            ignoreIllegals: true,
          }).value;
          return html`<span class="gdp-source-virtual-line-code hljs">${unsafeHTML(value)}</span>`;
        } catch (error) {
          failures.push({ line: row.number, error });
        }
      }
      return html`<span class="gdp-source-virtual-line-code">${line}</span>`;
    };
    renderOwned(
      windowEl,
      repeat(
        rows,
        (row) => row.number,
        (row) => {
          const cls = [
            "gdp-source-virtual-row",
            lineInSourceTarget(row.number, lineTarget)
              ? "gdp-source-line-target"
              : "",
            sourceCursorMatches(target, row.number) ? "gdp-source-cursor" : "",
            gutter?.rowClass ?? "",
          ]
            .filter(Boolean)
            .join(" ");
          return html`<div class=${cls} data-line=${String(row.number)}>${
            gutter ? gutter.cell(row.number) : nothing
          }<span
              class="gdp-source-virtual-line-number"
              ${lineNumberRef(wrap, target, row.number)}
            >${String(row.number)}</span
            >${codeTemplate(row)}</div>`;
        },
      ),
    );
    for (const failure of failures) {
      const code = windowEl.querySelector<HTMLElement>(
        `[data-line="${failure.line}"] .gdp-source-virtual-line-code`,
      );
      if (code)
        showHighlightFailure(
          code,
          `syntax highlighting failed for line ${failure.line} of ${target.path}`,
          failure.error,
        );
    }
  }

  function createVirtualSourceSearch(
    wrap: VirtualSourceSearchRoot,
    scroller: HTMLElement,
    findMatches: (query: string) => Promise<VirtualSourceSearchMatch[]>,
    renderFn: () => void,
  ): VirtualSourceSearchHandle {
    // 探す欄は情報の帯の右に置く (帯の中身とは別に、この欄だけを描き直す)。
    const bar = templateElement(
      html`<div class="gdp-source-virtual-search" hidden></div>`,
    );
    wrap.querySelector(".gdp-source-virtual-info")?.appendChild(bar);

    let query = "";
    let count: { text: string; title?: string } = { text: "" };
    let matches: VirtualSourceSearchMatch[] = [];
    let active = -1;
    let debounce = 0;
    let searchVersion = 0;
    const input = () => bar.querySelector<HTMLInputElement>("input");
    const drawBar = () => {
      const text = SOURCE_READING_TEXT[getLanguage()];
      renderOwned(
        bar,
        html`<input
            type="search"
            placeholder=${text.findInFile}
            autocomplete="off"
            spellcheck="false"
            .value=${live(query)}
            @input=${(event: Event) => {
              query = (event.currentTarget as HTMLInputElement).value;
              active = 0;
              scheduleSync();
            }}
            @keydown=${(event: KeyboardEvent) => {
              if (isImeComposing(event)) return;
              if (event.key === "Escape") {
                event.preventDefault();
                hide();
              } else if (event.key === "Enter") {
                event.preventDefault();
                move(event.shiftKey ? -1 : 1);
              }
            }}
          /><span class="gdp-source-virtual-search-count" title=${count.title ?? nothing}
            >${count.text}</span
          ><button type="button" class="gdp-btn gdp-btn-sm" @click=${() => move(-1)}
            >${text.findPrev}</button
          ><button type="button" class="gdp-btn gdp-btn-sm" @click=${() => move(1)}
            >${text.findNext}</button
          ><button type="button" class="gdp-btn gdp-btn-sm" @click=${hide}
            >${text.findClose}</button
          >`,
      );
    };
    const setCount = (next: { text: string; title?: string }) => {
      count = next;
      drawBar();
    };
    const hide = () => {
      bar.hidden = true;
      renderFn();
      scroller.focus({ preventScroll: true });
    };
    const scrollToActive = () => {
      const rowHeight = sourceLineScrollAmount() || VIRTUAL_SOURCE_ROW_HEIGHT;
      scroller.scrollTop = Math.max(
        0,
        (matches[active].line - 1) * rowHeight - rowHeight * 3,
      );
    };
    const sync = () => {
      const version = ++searchVersion;
      if (!query) {
        matches = [];
        active = -1;
        setCount({ text: "" });
        renderFn();
        return;
      }
      const text = SOURCE_READING_TEXT[getLanguage()];
      setCount({ text: text.searching });
      const asked = query;
      findMatches(asked)
        .then((nextMatches) => {
          if (version !== searchVersion) return;
          matches = nextMatches;
          active = matches.length
            ? Math.max(0, Math.min(active, matches.length - 1))
            : -1;
          setCount({
            text: matches.length
              ? `${active + 1} / ${matches.length}`
              : "0 / 0",
          });
          if (active >= 0) scrollToActive();
          renderFn();
        })
        .catch((error: unknown) => {
          if (version !== searchVersion) return;
          const failure = errorWithCause(
            `in-file search for ${JSON.stringify(asked)} failed`,
            error,
          );
          console.error(failure);
          matches = [];
          active = -1;
          setCount({
            text: SOURCE_READING_TEXT[getLanguage()].searchFailed,
            title: formatErrorDetail(failure),
          });
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
      setCount({ text: `${active + 1} / ${matches.length}` });
      scrollToActive();
      renderFn();
    };
    drawBar();
    return {
      open: (next?: string) => {
        bar.hidden = false;
        if (next !== undefined) query = next;
        drawBar();
        input()?.focus();
        input()?.select();
        sync();
      },
      query: () => (bar.hidden ? "" : query),
      activeRange: () => (active >= 0 ? matches[active] || null : null),
    };
  }

  /** 大きなファイルの枠: 情報の帯 (印・要約・操作) と、行の窓を持つ巻物。 */
  function virtualSourceFrame(
    target: SourceFileTarget,
    actions: TemplateResult,
    summary: string,
  ): {
    wrap: VirtualSourceSearchRoot;
    summaryEl: HTMLElement;
    scroller: HTMLElement;
    spacer: HTMLElement;
    windowEl: HTMLElement;
  } {
    const text = SOURCE_READING_TEXT[getLanguage()];
    const wrap = templateElement<VirtualSourceSearchRoot>(
      html`<div class="gdp-source-virtual"><div class="gdp-source-virtual-info"><span
            class="gdp-source-virtual-badge"
            >${text.virtualMode}</span
          ><span class="gdp-source-virtual-summary">${summary}</span><span
            class="gdp-source-virtual-actions"
            >${actions}</span
          ></div
        ><div
          class="gdp-source-virtual-scroller"
          tabindex="0"
          role="region"
          aria-label=${text.sourceCode(target.path)}
        ><div class="gdp-source-virtual-spacer"><div
              class="gdp-source-virtual-window"
            ></div></div></div></div>`,
    );
    const find = (selector: string) => {
      const element = wrap.querySelector<HTMLElement>(selector);
      if (!element)
        throw new Error(`virtual source: ${selector} was not drawn`);
      return element;
    };
    return {
      wrap,
      summaryEl: find(".gdp-source-virtual-summary"),
      scroller: find(".gdp-source-virtual-scroller"),
      spacer: find(".gdp-source-virtual-spacer"),
      windowEl: find(".gdp-source-virtual-window"),
    };
  }

  /** 全体を開くリンク (仮想表示をやめる)。 */
  function openFullViewTemplate(
    target: SourceFileTarget,
    title: string,
    onOpen: () => void,
  ): TemplateResult {
    const href = buildCurrentFileRouteWithVirtualMode(target, "off");
    return html`<a
      class="gdp-source-virtual-action"
      href=${href}
      title=${title}
      @click=${(event: MouseEvent) => {
        event.preventDefault();
        const url = new URL(
          (event.currentTarget as HTMLAnchorElement).href,
          window.location.origin,
        );
        setRoute(parseRoute(url.pathname, url.search, currentRange()), true);
        onOpen();
      }}
    >${SOURCE_READING_TEXT[getLanguage()].openFullView}</a>`;
  }

  function openVirtualSourceSearchFromKeyboard(
    targetEl: Element | null,
  ): boolean {
    const closest = targetEl?.closest<VirtualSourceSearchRoot>(
      ".gdp-source-virtual",
    );
    const active = closest && scope().contains(closest) ? closest : null;
    const fallback = scope().querySelector<VirtualSourceSearchRoot>(
      ".gdp-source-viewer.virtual .gdp-source-virtual:not([hidden])",
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
    gutter?: VirtualSourceGutter,
  ): HTMLElement {
    const text = SOURCE_READING_TEXT[getLanguage()];
    const { wrap, scroller, spacer, windowEl } = virtualSourceFrame(
      target,
      html`${sourceCopyButtonTemplate(textValue, "gdp-source-virtual-copy")}${openFullViewTemplate(
        target,
        text.openFullViewTitle,
        () => {
          if (gutter) gutter.fullView();
          else renderStandaloneSource(target, { refresh: true });
        },
      )}`,
      text.virtualSummary(
        lines.length.toLocaleString(),
        formatBytes(textValue.length),
      ),
    );
    spacer.style.height = `${Math.max(
      1,
      lines.length * (sourceLineScrollAmount() || VIRTUAL_SOURCE_ROW_HEIGHT),
    )}px`;

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
      windowEl.style.transform = `translateY(${start * rowHeight}px)`;
      const rows: VirtualRow[] = [];
      for (let index = start; index < end; index++)
        rows.push({ number: index + 1, text: lines[index] ?? "" });
      drawVirtualRows(
        windowEl,
        wrap,
        target,
        rows,
        search,
        hljsRef,
        lang,
        gutter,
      );
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
      () => {
        // 検索の印は行の範囲が同じでも変わる。描いた範囲を忘れて作り直す
        // (忘れないと、スクロールするまで当たりに印が付かなかった)。
        renderedStart = -1;
        render();
      },
    );
    wrap.__gdpVirtualSourceSearch = search;
    // A grep hit opened into a virtual file: the find bar carries the term,
    // which also highlights it on the rendered rows.
    const initialHighlightTerm = currentSourceHighlightTerm(target);
    if (initialHighlightTerm) {
      const searchHandle = search;
      setTimeout(() => {
        if (wrap.isConnected) searchHandle.open(initialHighlightTerm);
      }, 0);
    }
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
    const text = SOURCE_READING_TEXT[getLanguage()];
    const { wrap, summaryEl, scroller, spacer, windowEl } = virtualSourceFrame(
      target,
      html`<a
          class="gdp-source-virtual-action"
          href=${rawFileUrl(target)}
          target="_blank"
          rel="noreferrer"
          >${text.openRaw}</a
        >${openFullViewTemplate(target, text.openFullViewPagedTitle, () =>
          renderStandaloneSource(target, { refresh: true }),
        )}`,
      "",
    );

    const lines = new Map<number, string>();
    const requestedPages = new Set<number>();
    /** 読めなかったページと、その理由 (行に失敗の印と title で出す)。 */
    const failedPages = new Map<number, string>();
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
      renderOwned(
        summaryEl,
        text.pagedSummary(
          complete
            ? totalRows.toLocaleString()
            : `${lines.size.toLocaleString()}+`,
          formatBytes(size),
        ),
      );
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
          .then(async (res) => {
            if (!res.ok)
              throw new Error(
                await responseErrorMessage(
                  res,
                  `load lines ${start}-${end} of ${target.path}`,
                ),
              );
            return res.json() as Promise<FileRangeResponse>;
          })
          .then((data) => {
            if (signal?.aborted) return;
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
              const failure = errorWithCause(
                `lines ${start}-${end} of ${target.path} could not be loaded`,
                err,
              );
              console.error(failure);
              failedPages.set(page, formatErrorDetail(failure));
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
      windowEl.style.transform = `translateY(${start * rowHeight}px)`;
      const rows: VirtualRow[] = [];
      for (let index = start; index < end; index++) {
        const lineNumber = index + 1;
        if (!lines.has(lineNumber)) loadPage(lineNumber);
        rows.push({
          number: lineNumber,
          text: lines.get(lineNumber) ?? null,
          failedReason: failedPages.get(
            Math.floor((lineNumber - 1) / VIRTUAL_SOURCE_PAGE_SIZE),
          ),
        });
      }
      drawVirtualRows(windowEl, wrap, target, rows, search, hljsRef, lang);
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
      () => {
        // 検索の印は行の範囲が同じでも変わる (今の当たりを次へ送ったときなど)。
        renderedStart = -1;
        render();
      },
    );
    wrap.__gdpVirtualSourceSearch = search;
    // A grep hit opened into a virtual file: the find bar carries the term,
    // which also highlights it on the rendered rows.
    const initialHighlightTerm = currentSourceHighlightTerm(target);
    if (initialHighlightTerm) {
      const searchHandle = search;
      setTimeout(() => {
        if (wrap.isConnected) searchHandle.open(initialHighlightTerm);
      }, 0);
    }
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
      }).then(async (res) => {
        // 失敗は呼び出し側の catch が理由ごと画面と console に出す。
        if (!res.ok)
          throw new Error(
            await responseErrorMessage(
              res,
              `loading lines ${initialStart}-${initialEnd} of ${target.path}`,
            ),
          );
        return res.json() as Promise<FileRangeResponse>;
      }),
    );
    if (signal?.aborted) return false;
    SOURCE_CURSOR_TOTALS.set(
      sourceCursorKey(target),
      Math.max(1, initial.total, lineTarget),
    );
    resetSourceCursorForTarget(target, Math.max(1, initial.total, lineTarget));
    const tabsHost = card.querySelector<HTMLElement>(".gdp-file-detail-tabs");
    if (tabsHost) {
      tabsHost.hidden = false;
      tabsHost.replaceChildren(
        createSourceTabs(target, "code", undefined, {
          previewable: false,
        }).tabs,
      );
    }
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
    const view = templateElement(
      html`<div class="gdp-source-viewer virtual">${
        isStandalone
          ? nothing
          : html`<div class="gdp-source-meta">${target.path} @ ${target.ref}</div>`
      }${virtualCode}</div>`,
    );
    if (body) body.replaceWith(view);
    else card.appendChild(view);
    return true;
  }

  function renderSourceMedia(
    card: DiffCardElement,
    target: SourceFileTarget,
    mediaKind: string,
  ) {
    const isStandalone = card.classList.contains("gdp-standalone-source");
    const info = sourceFileInfo(target, mediaKind);
    replaceSourceBody(
      card,
      templateElement(
        html`<div class=${`gdp-source-viewer media ${mediaKind}`}>${
          isStandalone
            ? nothing
            : html`<div class="gdp-source-meta">${target.path} @ ${target.ref}</div>`
        }${info.element}${mediaEmbedTemplate({
          url: rawFileUrl(target),
          kind: mediaKind,
          title: target.path,
          onImageLoad: (img) =>
            info.setResolution(`${img.naturalWidth} x ${img.naturalHeight}`),
        })}</div>`,
      ),
    );
    setSourceCardState(card, "done");
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
    const card = scope().querySelector<DiffCardElement>(
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
    // Notes can arrive before the file on reload. Notify after the source
    // rows exist, including refreshes that replace the previous table.
    if (state === "done") deps.onSourceRendered?.();
  }

  async function renderStandaloneSource(
    target: SourceFileTarget,
    options: { refresh?: boolean } = {},
  ) {
    if (!options.refresh) {
      const mounted = mountedStandaloneSourceCard(target);
      const state = mounted?.dataset.sourceState;
      if (mounted && state === "done") {
        // Same target already on screen (another hit of the same file from
        // the palette or the results sheet): move the target-line class and
        // the hl= mark to the new line, then scroll. No reload.
        syncRenderedSourceLineHighlights(mounted, target);
        syncSourceHighlightMarks(mounted, target);
        scrollStandaloneSourceLine(
          mounted,
          lineTargetStart(currentFileRoute()?.line),
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
    scope()
      .querySelectorAll(".gdp-repo-blob-layout")
      .forEach((el) => {
        el.remove();
      });
    const internalKind = sourceInternalPathKind(target.path);
    const mediaOnly = !internalKind && isMediaPreviewOnlySource(target.path);
    const activeTab: SourceBlobTab =
      mediaOnly || (!internalKind && !!currentFileRoute()?.preview)
        ? "preview"
        : "code";
    const { sticky, header, tabsHost } = createFileShellSticky(
      {
        currentRange,
        setRoute,
        setPreferredSourceTab,
        createFileBreadcrumb,
        createRepositoryWebLink,
        createRevisionNav,
      },
      target,
      activeTab,
      internalKind ? { includeFileTabs: false, previewable: false } : {},
    );
    // 文字のファイルは、読み込んだ後の切替・行へ移る欄・コピーを読み込む前から
    // 同じ関数で置く。後から足すと、右寄せの切替が左へ伸びて見出しが動いていた
    // (約 250px)。大きいファイル (分けて読む) はコピーを置かないので、そのとき
    // だけコピーの幅の分が残る。
    if (!internalKind && sourceDisplayKind(target.path) === "text") {
      const previewable = isPreviewableSource(target.path);
      tabsHost.replaceChildren(
        createSourceTabs(target, preferredSourceTabFor(previewable), null, {
          previewable,
        }).tabs,
      );
    }
    const pathActions =
      header.querySelector<HTMLElement>(".gdp-file-detail-path") || header;
    pathActions.appendChild(
      createOpenPathButton(
        target.path,
        "file-parent",
        DIFF_SCREEN_TEXT[getLanguage()].openParentFolder,
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
      header.appendChild(
        templateElement(
          html`<button
            type="button"
            class="gdp-view-file gdp-btn gdp-btn-sm"
            ${ref((back) => {
              if (back instanceof HTMLButtonElement)
                setViewFileButtonState(back, true);
            })}
            @click=${() => {
              const route = currentRoute();
              setRoute(
                route.screen === "history"
                  ? { ...route, source: undefined }
                  : { screen: "diff", range: currentRange() },
              );
              setPageMode();
              removeStandaloneSource();
            }}
          ></button>`,
        ),
      );
    }
    const card = templateElement<DiffCardElement>(
      html`<article
        class="gdp-file-shell loaded gdp-standalone-source gdp-source-mode"
        data-path=${target.path}
        data-source-ref=${target.ref || "worktree"}
      ><div class="gdp-file-detail-wrapper">${sticky}<div
            class="gdp-file-detail-body"
          ></div></div></article>`,
    );
    setSourceCardState(card, "loading");
    const wrapper = card.querySelector<HTMLElement>(".gdp-file-detail-wrapper");
    if (!wrapper) throw new Error("source view: the card was not drawn");
    observeDocHeadHeight(wrapper, sticky);
    // Prepend instead of replaceChildren: the rendered diff cards stay alive
    // (hidden via body.gdp-repo-blob-page CSS), so leaving the blob view does
    // not force a full diff reload.
    mountFileShellCard(
      {
        mountRoot,
        repoFileTargetFromRoute,
        renderRepoBlobSidebar,
        placeSidebarToggle,
      },
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
              // An aborted load with a current req. Land on "error" instead
              // of leaving the card stuck in "loading", which the
              // idempotent-mount guard would otherwise treat as in-progress
              // and refuse to retry on re-click.
              finishSourceLoad(req);
              renderSourceError(
                card,
                target,
                `Cannot load ${target.path} at ${target.ref}`,
              );
              return;
            }
            scrollToLineOrRemembered(card, target);
            setSourceCardState(card, "done");
            finishSourceLoad(req);
            return;
          }
          const response = await trackLoad(
            fetch(rawFileUrl(target), { signal: controller.signal }),
          );
          if (
            req !== SOURCE_REQ_SEQ ||
            !sourceTargetsEqual(sourceTargetFromRoute(), target)
          )
            return;
          if (!response.ok)
            throw new Error(
              await responseErrorMessage(response, `loading ${target.path}`),
            );
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
          scrollToLineOrRemembered(card, target);
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
        console.error(
          `[code-viewer] loading ${target.path} at ${target.ref} failed`,
          err,
        );
        renderSourceError(
          card,
          target,
          `Cannot load ${target.path} at ${target.ref}\n${formatErrorDetail(err)}`,
        );
      }
    })();
    const completed = sourceLoad.finally(() => {
      if (card._loadPromise === completed) delete card._loadPromise;
    });
    card._loadPromise = completed;
    return completed;
  }

  // ---- ファイルごとのスクロール位置 (この実体の面の中。セッション中だけ) ----
  // タブを切り替えて同じファイルへ戻ったとき、描き直しても前の位置へ戻す。
  // 行の指定 (line=) がある route はその行が優先。保存はしない。
  const SOURCE_SCROLL = new Map<string, number>();

  function sourceScrollTop(): number {
    const scroller = mainScrollTarget();
    return scroller ? scroller.scrollTop : window.scrollY;
  }

  // 見えている描き終わったカードが今の route のファイルなら、その位置を覚える。
  // route が移った後に届くスクロール (前の画面の位置の戻り) は覚えない。
  document.addEventListener(
    "scroll",
    () => {
      const route = currentFileRoute();
      if (route?.view !== "blob") return;
      const card = scope().querySelector<HTMLElement>(
        '.gdp-standalone-source[data-source-state="done"]',
      );
      if (
        !card ||
        card.offsetParent === null ||
        card.dataset.path !== route.path ||
        card.dataset.sourceRef !== (route.ref || "worktree")
      )
        return;
      SOURCE_SCROLL.set(
        sourceCursorKey({ path: route.path, ref: route.ref }),
        sourceScrollTop(),
      );
    },
    { capture: true, passive: true },
  );

  /** 描き終わったとき: 行の指定があればその行、無ければ覚えた位置 (無ければ先頭)。 */
  function scrollToLineOrRemembered(
    card: HTMLElement,
    target: SourceFileTarget,
  ): void {
    const route = currentFileRoute();
    // ファイルの route でない (History の画面の中のソースなど) は今までどおり動かさない。
    if (!route) return;
    const line = lineTargetStart(route.line);
    if (line) {
      scrollStandaloneSourceLine(card, line);
      return;
    }
    const top = SOURCE_SCROLL.get(sourceCursorKey(target)) ?? 0;
    const scroller = mainScrollTarget();
    if (scroller) scroller.scrollTop = top;
    else window.scrollTo(0, top);
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
      isPageKeymapBlockedTarget(targetEl) ||
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
    const scroller = mainScrollTarget();
    if (
      !scroller?.matches(".gdp-source-virtual-scroller") ||
      !scope().contains(scroller)
    )
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

  function localize(): void {
    const text = SOURCE_READING_TEXT[getLanguage()];
    document
      .querySelectorAll<HTMLFormElement>(".gdp-source-line-jump")
      .forEach((form) => {
        const label = form.querySelector("label");
        const input = form.querySelector("input");
        const button = form.querySelector("button");
        const count = form.querySelector(".gdp-source-line-count");
        if (label?.firstChild) label.firstChild.textContent = text.line;
        input?.setAttribute("aria-label", text.line);
        if (button) button.textContent = text.go;
        if (count)
          count.textContent = input?.max
            ? text.total(Number(input.max))
            : text.totalPending;
      });
    document
      .querySelectorAll<DelimitedPreviewElement>(".gdp-csv-preview")
      .forEach((preview) => {
        preview.localize();
      });
  }

  return {
    renderStandaloneSource,
    applySourceRouteToShell,
    removeStandaloneSource,
    resetProject() {
      cancelActiveSourceLoad("navigation");
      removeStandaloneSource();
      SOURCE_CURSOR = null;
      SOURCE_CURSOR_ROWS = [];
    },
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
    renderVirtualSourceWithGutter,
    inferLang,
    localize,
    /** この実体のスクロール先 (キー操作のスクロールが使う)。 */
    mainScrollTarget,
  };
}
