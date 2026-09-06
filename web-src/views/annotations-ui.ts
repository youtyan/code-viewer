// Code annotations (AI walkthrough) UI.
//
// Agents post explanations for code locations through the CLI
// (`code-viewer annotate add ...`). The server persists them under
// .code-viewer/annotations.json and notifies open tabs over SSE; with
// follow mode on, the viewer jumps to each new location as it arrives.
//
// The UI has two synchronized faces:
// - a right-side panel listing sessions/entries with a detail view, and
// - inline rows injected directly under the annotated code lines, scoped
//   to the active session.
// The active session travels in the URL as `annotationSession` so a shared
// link or reload restores the same inline walkthrough.

import { formatErrorDetail, responseErrorMessage } from "../core/error-detail";
import {
  CHEVRON_DOWN_16_PATH,
  COPY_16_PATHS,
  iconSvg,
  NEXT_16_PATHS,
  PENCIL_16_PATH,
  PLUS_16_PATH,
  PREVIOUS_16_PATHS,
  SEARCH_16_PATH,
  TRASH_16_PATH,
  X_16_PATH,
} from "../core/icons";
import {
  loadMarkdownHighlighter,
  renderMarkdownHtml,
  type ShikiHighlighter,
} from "../core/markdown-preview";
import type { AppRoute, DiffRange, SourceLineTarget } from "../core/routes";
import type {
  AnnotationEntry,
  AnnotationSession,
  AnnotationSseEvent,
  AnnotationsState,
  DiffCardElement,
  FileMeta,
} from "../core/types";
import { createAnnotationEditor } from "./annotations/editor";
import { annotationText } from "./annotations/i18n";
import { diffRowHasAfterChange } from "./diff-line-select";
import { showConfirmDialog, showPromptDialog } from "./ui-dialog";

export const ANNOTATION_SESSION_PARAM = "annotationSession";
export const ANNOTATION_PANEL_PARAM = "annotations";
export const ANNOTATION_ENTRY_PARAM = "annotation";

export type AnnotationsUiDeps = {
  $: <T extends Element = HTMLElement>(sel: string) => T;
  diffCardSelector(path: string): string;
  diffRowLineNumber(row: HTMLTableRowElement): number | null;
  focusDiffLine(card: HTMLElement, line: SourceLineTarget | undefined): boolean;
  scrollDiffElementIntoView(
    element: HTMLElement,
    block: ScrollLogicalPosition,
  ): void;
  expandAllFileContext(card: DiffCardElement, file: FileMeta): Promise<void>;
  loadDiffFile(path: string): Promise<boolean>;
  scrollToFile(path: string, line?: SourceLineTarget): void;
  renderStandaloneSource(target: {
    path: string;
    ref: string;
  }): Promise<unknown>;
  removeStandaloneSource(): void;
  cancelActiveSourceLoad(reason: "user" | "navigation" | "esc"): boolean;
  setRoute(route: AppRoute, replace?: boolean): void;
  setPageMode(): void;
  syncRefInputs(): void;
  load(): Promise<unknown>;
  currentRange(): DiffRange;
  getFiles(): FileMeta[];
  getRoute(): AppRoute;
  getLanguage?(): "en" | "ja";
  setRange(from: string, to: string): void;
  getAnnotationPanelOpen(): boolean;
  setAnnotationPanelOpenState(open: boolean): void;
  getAnnotationPanelWidth(): number | undefined;
  setAnnotationPanelWidth(width: number): void;
  getAnnotationFollow(): boolean;
  setAnnotationFollow(follow: boolean): void;
  leaveDatabaseView(): void;
  openDatabaseAnnotation(
    target: Extract<AnnotationEntry["target"], { kind: "database" }>,
  ): Promise<void>;
  captureDatabaseAnnotationTarget(): Extract<
    AnnotationEntry["target"],
    { kind: "database" }
  > | null;
};

export type AnnotationsUi = {
  localize(): void;
  /** Re-inject inline rows for the active session into loaded diff/source. */
  applyInlineAnnotations(): void;
  /** Fetch state from the server and re-render panel + inline rows. */
  refreshAnnotations(): Promise<void>;
  /** Handle a raw `annotations` SSE payload. */
  handleSse(raw: string): void;
  /** Append/remove annotation panel and selection query params on a URL. */
  withSessionParam(rawUrl: string): string;
  /** Re-read the session param from location (popstate) and re-render. */
  restoreSessionFromUrl(): void;
  /** Jump to an entry (file/line navigation + detail panel). */
  openAnnotationEntry(entryId: string): Promise<void>;
  /** Show or hide the annotation panel. */
  setAnnotationPanelOpen(open: boolean): void;
  /** Apply (and, by default, persist) the panel width in px. */
  applyAnnotationPanelWidth(width: number, persist?: boolean): void;
  /** Entries of the active session, or [] when none is active. */
  getActiveSessionEntries(): AnnotationEntry[];
  /** Register a callback fired after refresh or active-session change. */
  onAnnotationsChanged(cb: () => void): void;
  /** Register a callback fired when an entry is opened (clicked etc). */
  onAnnotationOpened(cb: (entryId: string) => void): void;
  /** Id of the entry currently shown in the detail panel, or null. */
  getActiveAnnotationId(): string | null;
  /** Open the next (1) or previous (-1) annotation in the session. */
  stepAnnotation(direction: 1 | -1): void;
};

export function createAnnotationsUi(deps: AnnotationsUiDeps): AnnotationsUi {
  const { $ } = deps;
  const getLanguage = () => deps.getLanguage?.() || "en";
  const t = () => annotationText(getLanguage());
  let editor: ReturnType<typeof createAnnotationEditor> | null = null;
  let dataRevision = 0;
  let annotationsLoaded = false;
  const collapsedSessions = new Set<string>();
  const inlineExpanded = new Map<string, boolean>();
  let currentLocationOnly = false;

  let ANNOTATIONS: AnnotationsState = { version: 1, sessions: [] };
  let annotationFollow = deps.getAnnotationFollow();
  const initialUrlParams = new URLSearchParams(window.location.search);
  let activeAnnotationId: string | null = initialUrlParams.get(
    ANNOTATION_ENTRY_PARAM,
  );
  let refreshAnnotationsInFlight: Promise<void> | null = null;
  let inlineAnnotationsMounted = false;
  let databaseAnnotationsMounted = false;
  let annotationPanelDismissed = false;
  let activeSessionId: string | null = initialUrlParams.get(
    ANNOTATION_SESSION_PARAM,
  );
  const annotationsChangedCallbacks: Array<() => void> = [];
  function notifyAnnotationsChanged() {
    for (const cb of annotationsChangedCallbacks) cb();
  }
  const annotationOpenedCallbacks: Array<(entryId: string) => void> = [];
  // Range whose diff was loaded and turned out to be empty. Without this,
  // an empty file list is indistinguishable from a never-loaded one and a
  // clean worktree would re-trigger a full diff load on every step.
  let emptyDiffRangeKey: string | null = null;
  function notifyAnnotationOpened(entryId: string) {
    for (const cb of annotationOpenedCallbacks) cb(entryId);
  }

  // Code blocks inside annotation bodies get shiki highlighting once the
  // (lazily loaded) markdown highlighter is ready; until then they render
  // unhighlighted and are upgraded in place on load.
  let mdHighlighter: ShikiHighlighter | null = null;
  let mdHighlighterRequested = false;
  function ensureMarkdownHighlighter() {
    if (mdHighlighter || mdHighlighterRequested) return;
    mdHighlighterRequested = true;
    void loadMarkdownHighlighter().then((highlighter) => {
      mdHighlighter = highlighter;
      if (!highlighter) return;
      applyInlineAnnotations();
      if (activeAnnotationId && !editor) {
        const found = findAnnotation(activeAnnotationId);
        if (found)
          showAnnotationDetail(found.session, found.entry, found.index);
      }
    });
  }

  const annotationPanel = $("#annotation-panel");
  const annotationSessionsEl = $("#annotation-sessions");
  const annotationDetail = $("#annotation-detail");
  const annotationCountEl = $("#annotations-count");
  const annotationListCountEl = $("#annotation-list-count");
  const annotationAdd = $<HTMLButtonElement>("#annotation-add");
  annotationAdd.innerHTML = iconSvg("octicon-plus", PLUS_16_PATH);
  const annotationDetailPrev = $<HTMLButtonElement>("#annotation-detail-prev");
  const annotationDetailNext = $<HTMLButtonElement>("#annotation-detail-next");
  annotationDetailPrev.innerHTML = iconSvg(
    "octicon-skip-back",
    PREVIOUS_16_PATHS,
  );
  annotationDetailPrev.title = "previous annotation";
  annotationDetailPrev.setAttribute("aria-label", "previous annotation");
  annotationDetailNext.innerHTML = iconSvg(
    "octicon-skip-forward",
    NEXT_16_PATHS,
  );
  annotationDetailNext.title = "next annotation";
  annotationDetailNext.setAttribute("aria-label", "next annotation");

  const detailHead = annotationDetail.querySelector(".annotation-detail-head");
  const detailMeta = document.createElement("div");
  detailMeta.className = "annotation-detail-meta";
  detailMeta.append(
    $("#annotation-detail-session"),
    $("#annotation-detail-time"),
  );
  detailHead?.after(detailMeta);
  detailHead?.prepend($("#annotation-detail-close"));

  const searchToolbar = document.createElement("div");
  searchToolbar.className = "annotation-search-toolbar";
  const searchBox = document.createElement("div");
  searchBox.className = "annotation-search-box";
  searchBox.innerHTML = iconSvg("octicon-search", SEARCH_16_PATH);
  const search = document.createElement("input");
  search.id = "annotation-search";
  search.type = "search";
  const clearSearch = annotationIconButton(
    "octicon-x",
    X_16_PATH,
    t().clearSearch,
  );
  clearSearch.id = "annotation-search-clear";
  searchBox.append(search, clearSearch);
  const scopes = document.createElement("div");
  scopes.className = "annotation-search-scopes";
  const allScope = document.createElement("button");
  const currentScope = document.createElement("button");
  allScope.type = currentScope.type = "button";
  allScope.id = "annotation-scope-all";
  currentScope.id = "annotation-scope-current";
  scopes.append(allScope, currentScope);
  searchToolbar.append(searchBox, scopes);
  annotationSessionsEl.before(searchToolbar);
  search.addEventListener("input", renderAnnotationPanel);
  search.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      search.value = "";
      renderAnnotationPanel();
    }
  });
  clearSearch.addEventListener("click", () => {
    search.value = "";
    renderAnnotationPanel();
    search.focus();
  });
  allScope.addEventListener("click", () => {
    currentLocationOnly = false;
    renderAnnotationPanel();
  });
  currentScope.addEventListener("click", () => {
    currentLocationOnly = true;
    renderAnnotationPanel();
  });

  const errorBanner = document.createElement("div");
  errorBanner.id = "annotation-error";
  errorBanner.setAttribute("role", "alert");
  errorBanner.hidden = true;
  const errorTitle = document.createElement("strong");
  const errorDetails = document.createElement("details");
  const errorSummary = document.createElement("summary");
  const errorBody = document.createElement("pre");
  errorDetails.append(errorSummary, errorBody);
  const retry = document.createElement("button");
  retry.type = "button";
  retry.className = "gdp-btn gdp-btn-sm";
  retry.addEventListener("click", () => {
    void refreshAnnotations();
  });
  const dismissError = annotationIconButton(
    "octicon-x",
    X_16_PATH,
    t().dismiss,
  );
  dismissError.addEventListener("click", () => {
    errorBanner.hidden = true;
  });
  errorBanner.append(errorTitle, dismissError, errorDetails, retry);
  annotationPanel.querySelector(".annotation-panel-head")?.after(errorBanner);
  if (!errorBanner.isConnected) annotationPanel.prepend(errorBanner);

  function showAnnotationError(error: unknown, message = t().actionFailed) {
    console.error(message, error);
    errorTitle.textContent = message;
    errorBody.textContent = formatErrorDetail(error);
    errorBanner.hidden = false;
  }

  function updateAnnotationContext() {
    // Creation also works from the repository list by entering a file path.
    annotationAdd.hidden = false;
    const route = deps.getRoute();
    currentScope.disabled =
      !((route.screen === "file" || route.screen === "diff") && route.path) &&
      !(route.screen === "database" && route.db);
    if (currentScope.disabled) currentLocationOnly = false;
    allScope.setAttribute("aria-pressed", String(!currentLocationOnly));
    currentScope.setAttribute("aria-pressed", String(currentLocationOnly));
  }

  function localize() {
    annotationAdd.innerHTML = iconSvg("octicon-plus", PLUS_16_PATH);
    annotationAdd.append(t().add);
    annotationAdd.title = t().add;
    annotationAdd.setAttribute("aria-label", t().add);
    const close = $("#annotation-panel-close");
    close.innerHTML = iconSvg("octicon-x", X_16_PATH);
    close.title = t().close;
    close.setAttribute("aria-label", t().close);
    $("#annotation-detail-close").textContent = t().back;
    $("#annotation-clear").textContent = t().deleteAll;
    $("#annotation-clear").title = t().deleteAll;
    search.placeholder = t().search;
    search.setAttribute("aria-label", t().search);
    clearSearch.title = t().clearSearch;
    clearSearch.setAttribute("aria-label", t().clearSearch);
    allScope.textContent = t().all;
    currentScope.textContent = t().current;
    currentScope.title = t().currentHint;
    errorSummary.textContent = t().errorDetails;
    retry.textContent = t().retry;
    dismissError.title = t().dismiss;
    dismissError.setAttribute("aria-label", t().dismiss);
    for (const [button, label] of [
      [annotationDetailPrev, t().previous],
      [annotationDetailNext, t().next],
    ] as const) {
      button.title = label;
      button.setAttribute("aria-label", label);
    }
    editor?.localize();
    renderAnnotationPanel();
    if (!editor && annotationsLoaded) restoreAnnotationDetailFromState();
    applyInlineAnnotations();
    notifyAnnotationsChanged();
  }

  function setAnnotationPanelOpen(open: boolean) {
    annotationPanel.hidden = !open;
    document.body.classList.toggle("annotation-panel-open", open);
    if (open) {
      annotationPanelDismissed = false;
      // Mutual exclusion: close query-history panel
      const qhPanel = document.getElementById("query-history-panel");
      if (qhPanel) qhPanel.hidden = true;
      document.body.classList.remove("query-history-panel-open");
    } else if (activeAnnotationId && !editor) {
      activeAnnotationId = null;
      annotationDetail.hidden = true;
      updateActiveHighlights();
      syncInlineAnnotationActive();
    }
    deps.setAnnotationPanelOpenState(open);
    syncSessionUrl();
    applyInlineAnnotations();
  }

  function annotationLineTarget(
    entry: AnnotationEntry,
  ): SourceLineTarget | undefined {
    if (!entry.line) return undefined;
    return entry.line.start === entry.line.end
      ? entry.line.start
      : { start: entry.line.start, end: entry.line.end };
  }

  function annotationLocationLabel(entry: AnnotationEntry): string {
    if (entry.target?.kind === "database") {
      const parts = ["Datastores"];
      if (entry.target.db) parts.push(entry.target.db);
      if (entry.target.schema) parts.push(entry.target.schema);
      if (entry.target.table) parts.push(entry.target.table);
      if (entry.target.tab) parts.push(entry.target.tab);
      return parts.join(" / ");
    }
    if (!entry.line) return entry.path;
    return entry.line.start === entry.line.end
      ? `${entry.path}:${entry.line.start}`
      : `${entry.path}:${entry.line.start}-${entry.line.end}`;
  }

  function annotationRefForEntry(entry: AnnotationEntry): string {
    const to = entry.range.to || "worktree";
    return to === "worktree" || to === "" ? "worktree" : to;
  }

  function databaseAnnotationMatchesRoute(entry: AnnotationEntry): boolean {
    if (entry.target?.kind !== "database") return false;
    const route = deps.getRoute();
    if (route.screen !== "database") return false;
    const target = entry.target;
    if (target.db && target.db !== route.db) return false;
    if (target.schema && target.schema !== route.schema) return false;
    if (target.table && target.table !== route.table) return false;
    if (target.tab && target.tab !== (route.tab || "data")) return false;
    return true;
  }

  function withSessionParam(rawUrl: string): string {
    const url = new URL(rawUrl, window.location.origin);
    if (!annotationPanel.hidden)
      url.searchParams.set(ANNOTATION_PANEL_PARAM, "open");
    else url.searchParams.delete(ANNOTATION_PANEL_PARAM);
    if (activeSessionId)
      url.searchParams.set(ANNOTATION_SESSION_PARAM, activeSessionId);
    else url.searchParams.delete(ANNOTATION_SESSION_PARAM);
    if (activeAnnotationId)
      url.searchParams.set(ANNOTATION_ENTRY_PARAM, activeAnnotationId);
    else url.searchParams.delete(ANNOTATION_ENTRY_PARAM);
    return url.pathname + url.search;
  }

  // Inline annotation rows: the explanation is rendered directly under its
  // target code line (diff or standalone source) so the reader does not have
  // to glance back and forth between code and the side panel.
  // Step chip shared by the inline row and the DB annotation head: clicking
  // it opens the entry in the detail dock, so the walkthrough order is
  // navigable straight from the code. The label matches the panel list
  // numbering and the detail dock's "n/total" counter.
  function createStepChip(
    entry: AnnotationEntry,
    step: { index: number; total: number },
  ): HTMLButtonElement {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "gdp-annotation-step";
    chip.textContent = `${step.index + 1}/${step.total}`;
    chip.title = t().openStep(step.index + 1, step.total);
    chip.setAttribute("aria-label", chip.title);
    chip.addEventListener("click", () => {
      void openAnnotationEntry(entry.id);
    });
    return chip;
  }

  function createInlineExpandButton(entry: AnnotationEntry, body: HTMLElement) {
    const toggle = annotationIconButton(
      "octicon-chevron-down",
      CHEVRON_DOWN_16_PATH,
      t().expandNote,
    );
    toggle.classList.add("gdp-annotation-expand");
    toggle.append(t().body);
    toggle.setAttribute("aria-controls", body.id);
    const sync = (expanded: boolean) => {
      body.hidden = !expanded;
      toggle.setAttribute("aria-expanded", String(expanded));
      toggle.title = expanded ? t().collapseNote : t().expandNote;
      toggle.setAttribute("aria-label", toggle.title);
    };
    // Opening the panel must not hide explanations the reader is following
    // in the code. Only an explicit toggle changes inline visibility.
    sync(inlineExpanded.get(entry.id) ?? true);
    toggle.addEventListener("click", () => {
      const expanded = body.hidden;
      inlineExpanded.set(entry.id, expanded);
      sync(expanded);
      syncInlineAnnotationSpacerHeights();
    });
    return toggle;
  }

  function buildInlineAnnotationRow(
    entry: AnnotationEntry,
    colSpan: number,
    step: { index: number; total: number },
  ): HTMLTableRowElement {
    const tr = document.createElement("tr");
    tr.className = "gdp-annotation-row";
    tr.dataset.annotationId = entry.id;
    tr.classList.toggle("active", entry.id === activeAnnotationId);
    const td = document.createElement("td");
    td.colSpan = colSpan;
    const box = document.createElement("div");
    box.className = "gdp-annotation-inline";
    box.setAttribute("role", "note");
    const head = document.createElement("div");
    head.className = "gdp-annotation-inline-head";
    const location = document.createElement("span");
    location.className = "gdp-annotation-inline-location";
    location.textContent = entry.line
      ? t().inlineLines(entry.line.start, entry.line.end)
      : t().wholeFile;
    location.title = annotationLocationLabel(entry);
    const actions = document.createElement("div");
    actions.className = "gdp-annotation-inline-actions";
    const read = document.createElement("button");
    read.type = "button";
    read.className = "gdp-btn gdp-btn-sm gdp-annotation-read";
    read.textContent = t().readInPanel;
    read.addEventListener("click", () => {
      void openAnnotationEntry(entry.id);
    });
    head.append(createStepChip(entry, step), location, actions);
    const heading = document.createElement("strong");
    heading.className = "gdp-annotation-inline-title";
    heading.id = `annotation-title-${entry.id}`;
    heading.textContent = entry.title?.trim() || t().body;
    box.setAttribute("aria-labelledby", heading.id);
    const markdown = document.createElement("div");
    markdown.className =
      "gdp-annotation-inline-body gdp-markdown-preview markdown-body gdp-annotation-prose";
    markdown.id = `annotation-body-${entry.id}`;
    ensureMarkdownHighlighter();
    markdown.innerHTML = renderMarkdownHtml(
      entry.body,
      { path: entry.path, ref: annotationRefForEntry(entry) },
      mdHighlighter,
    );
    actions.append(
      read,
      createInlineExpandButton(entry, markdown),
      createCopyRefButton(entry, "gdp-annotation-inline-copy"),
    );
    box.append(head, heading, markdown);
    td.appendChild(box);
    tr.appendChild(td);
    return tr;
  }

  function buildDatabaseAnnotationBlock(
    entry: AnnotationEntry,
    step: { index: number; total: number },
  ): HTMLElement {
    const box = document.createElement("div");
    box.className = "gdp-db-annotation-inline";
    box.dataset.annotationId = entry.id;
    box.classList.toggle("active", entry.id === activeAnnotationId);
    const head = document.createElement("div");
    head.className = "gdp-db-annotation-inline-head";
    const title = document.createElement("button");
    title.type = "button";
    title.className = "gdp-db-annotation-inline-title";
    title.textContent = entry.title || annotationLocationLabel(entry);
    title.addEventListener("click", () => {
      void openAnnotationEntry(entry.id);
    });
    const location = document.createElement("span");
    location.className = "gdp-db-annotation-inline-location";
    location.textContent = annotationLocationLabel(entry);
    head.append(
      createStepChip(entry, step),
      title,
      location,
      createCopyRefButton(entry),
    );
    const markdown = document.createElement("div");
    markdown.className = "gdp-db-annotation-inline-body";
    markdown.id = `annotation-db-body-${entry.id}`;
    ensureMarkdownHighlighter();
    markdown.innerHTML = renderMarkdownHtml(
      entry.body,
      { path: entry.path, ref: annotationRefForEntry(entry) },
      mdHighlighter,
    );
    head.prepend(createInlineExpandButton(entry, markdown));
    box.append(head, markdown);
    return box;
  }

  function applyDatabaseAnnotations(session: AnnotationSession | undefined) {
    if (databaseAnnotationsMounted) {
      document
        .querySelectorAll<HTMLElement>(".gdp-db-annotation-strip")
        .forEach((el) => {
          el.remove();
        });
      databaseAnnotationsMounted = false;
    }
    if (!session || deps.getRoute().screen !== "database") return;
    const matches = session.entries.filter(databaseAnnotationMatchesRoute);
    if (!matches.length) return;
    const root = document.querySelector<HTMLElement>(".db-root");
    if (!root) return;
    const strip = document.createElement("section");
    strip.className = "gdp-db-annotation-strip";
    strip.setAttribute("aria-label", "Datastore annotations");
    for (const entry of matches) {
      strip.appendChild(
        buildDatabaseAnnotationBlock(entry, {
          index: session.entries.indexOf(entry),
          total: session.entries.length,
        }),
      );
    }
    root.prepend(strip);
    databaseAnnotationsMounted = true;
  }

  function inlineAnnotationTargetRow(
    entry: AnnotationEntry,
  ): HTMLTableRowElement | null {
    if (!entry.line) return null;
    const card = document.querySelector<HTMLElement>(
      deps.diffCardSelector(entry.path),
    );
    if (!card) return null;
    const line = entry.line.end;
    const sourceRow = card.querySelector<HTMLTableRowElement>(
      `.gdp-source-table tr[data-line="${String(line)}"]`,
    );
    if (sourceRow) return sourceRow;
    const start = entry.line.start;
    const end = entry.line.end;
    const rows = Array.from(
      card.querySelectorAll<HTMLTableRowElement>("table.d2h-diff-table tr"),
    );
    const byLine = new Map<number, HTMLTableRowElement>();
    let hasChangedAfterRow = false;
    for (const row of rows) {
      const rowLine = deps.diffRowLineNumber(row);
      if (rowLine === null || rowLine < start || rowLine > end) continue;
      if (!byLine.has(rowLine)) byLine.set(rowLine, row);
      if (diffRowHasAfterChange(row)) hasChangedAfterRow = true;
    }
    if (!hasChangedAfterRow) return null;
    for (let rowLine = start; rowLine <= end; rowLine++) {
      if (!byLine.has(rowLine)) return null;
    }
    return byLine.get(end) || null;
  }

  // Side-by-side diffs render LEFT and RIGHT as two separate tables whose
  // rows are paired by index. Inserting the note into one side only would
  // shear the panes apart, so the opposite side gets a spacer row that is
  // kept at exactly the same height.
  function siblingSideRow(
    row: HTMLTableRowElement,
  ): HTMLTableRowElement | null {
    const side = row.closest(".d2h-file-side-diff");
    if (!side) return null;
    const sides = side.parentElement?.querySelectorAll(".d2h-file-side-diff");
    const other = sides ? [...sides].find((s) => s !== side) : null;
    if (!other) return null;
    const rows = (tbody: Element | null) =>
      tbody
        ? [...tbody.children].filter(
            (r) => !r.classList.contains("gdp-annotation-row"),
          )
        : [];
    const mine = rows(row.parentElement);
    const theirs = rows(other.querySelector("table.d2h-diff-table tbody"));
    const index = mine.indexOf(row);
    return (theirs[index] as HTMLTableRowElement) || null;
  }

  function buildInlineSpacerRow(
    entry: AnnotationEntry,
    colSpan: number,
  ): HTMLTableRowElement {
    const tr = document.createElement("tr");
    tr.className = "gdp-annotation-row gdp-annotation-spacer";
    tr.dataset.annotationId = entry.id;
    const td = document.createElement("td");
    td.colSpan = colSpan;
    td.appendChild(document.createElement("div"));
    tr.appendChild(td);
    return tr;
  }

  // Both sidebar resizing and late Markdown layout (fonts/images) can alter
  // the note without a window resize. Keep the opposite diff pane aligned.
  const inlineResizeObserver =
    typeof ResizeObserver === "function"
      ? new ResizeObserver(() => syncInlineAnnotationWidths())
      : null;

  function applyInlineAnnotations() {
    inlineResizeObserver?.disconnect();
    updateAnnotationContext();
    if (currentLocationOnly) renderAnnotationPanel();
    // Inline rows are scoped to the selected session: showing every entry at
    // once buries the code, so nothing is inlined until a session is active.
    const session = ANNOTATIONS.sessions.find((s) => s.id === activeSessionId);
    if (!session && !inlineAnnotationsMounted && !databaseAnnotationsMounted)
      return;
    if (inlineAnnotationsMounted) {
      document.querySelectorAll(".gdp-annotation-row").forEach((row) => {
        row.remove();
      });
      inlineAnnotationsMounted = false;
    }
    applyDatabaseAnnotations(session);
    if (!session) return;
    let mountedInlineRows = false;
    session.entries.forEach((entry, index) => {
      // The index is over ALL session entries (DB targets included) so the
      // chip numbering matches the panel list and the detail dock counter.
      if (entry.target?.kind === "database") return;
      const target = inlineAnnotationTargetRow(entry);
      if (!target) return;
      // Keep document order when several annotations land on the same line.
      let anchor: HTMLTableRowElement = target;
      while (
        anchor.nextElementSibling?.classList.contains("gdp-annotation-row")
      )
        anchor = anchor.nextElementSibling as HTMLTableRowElement;
      anchor.after(
        buildInlineAnnotationRow(entry, target.cells.length, {
          index,
          total: session.entries.length,
        }),
      );
      const sibling = siblingSideRow(target);
      if (sibling) {
        let sibAnchor: HTMLTableRowElement = sibling;
        while (
          sibAnchor.nextElementSibling?.classList.contains("gdp-annotation-row")
        )
          sibAnchor = sibAnchor.nextElementSibling as HTMLTableRowElement;
        sibAnchor.after(buildInlineSpacerRow(entry, sibling.cells.length));
      }
      mountedInlineRows = true;
    });
    inlineAnnotationsMounted = mountedInlineRows;
    syncInlineAnnotationWidths(true);
  }

  // The code tables can be much wider than the viewport (long lines scroll
  // horizontally). A colspan cell stretches to the full table width, so the
  // note box gets an explicit width matching the visible scroll area and
  // sticks to its left edge while the code scrolls underneath.
  function syncInlineAnnotationSpacerHeights() {
    document
      .querySelectorAll<HTMLElement>(".gdp-annotation-spacer")
      .forEach((spacer) => {
        const id = spacer.dataset.annotationId || "";
        const note = document.querySelector<HTMLElement>(
          `.gdp-annotation-row:not(.gdp-annotation-spacer)[data-annotation-id="${CSS.escape(id)}"]`,
        );
        const div = spacer.querySelector<HTMLElement>("td > div");
        if (note && div) div.style.height = `${note.offsetHeight}px`;
      });
  }

  function syncInlineAnnotationWidths(observe = false) {
    document
      .querySelectorAll<HTMLElement>(".gdp-annotation-inline")
      .forEach((box) => {
        let scroller: HTMLElement | null = null;
        for (
          let el = box.parentElement;
          el && el !== document.body;
          el = el.parentElement
        ) {
          const overflowX = getComputedStyle(el).overflowX;
          if (overflowX === "auto" || overflowX === "scroll") {
            scroller = el;
            break;
          }
        }
        const width = scroller?.clientWidth || 0;
        // 16px = the 8px horizontal margins on both sides of the box.
        box.style.width = width > 32 ? `${width - 16}px` : "";
        if (observe) {
          if (scroller) inlineResizeObserver?.observe(scroller);
          inlineResizeObserver?.observe(box);
        }
      });
    syncInlineAnnotationSpacerHeights();
  }
  window.addEventListener("resize", () => syncInlineAnnotationWidths());

  function syncSessionUrl() {
    const current = window.location.pathname + window.location.search;
    const next = withSessionParam(current);
    if (next !== current) history.replaceState(history.state, "", next);
  }

  function setActiveSession(sessionId: string | null) {
    if (activeSessionId === sessionId) return;
    activeSessionId = sessionId;
    activeAnnotationId = null;
    annotationDetail.hidden = true;
    syncSessionUrl();
    updateActiveHighlights();
    syncInlineAnnotationActive();
    applyInlineAnnotations();
    notifyAnnotationsChanged();
  }

  function restoreSessionFromUrl() {
    const params = new URLSearchParams(window.location.search);
    activeSessionId = params.get(ANNOTATION_SESSION_PARAM);
    activeAnnotationId = params.get(ANNOTATION_ENTRY_PARAM);
    setAnnotationPanelOpen(
      params.get(ANNOTATION_PANEL_PARAM) === "open" || !!activeAnnotationId,
    );
    renderAnnotationPanel();
    restoreAnnotationDetailFromState();
    applyInlineAnnotations();
  }

  async function waitForAnnotationDiffTarget(
    entry: AnnotationEntry,
  ): Promise<HTMLTableRowElement | null> {
    if (!entry.line) return null;
    const ready = inlineAnnotationTargetRow(entry);
    if (ready) return ready;
    const card = document.querySelector<DiffCardElement>(
      deps.diffCardSelector(entry.path),
    );
    if (!card || card.classList.contains("gdp-standalone-source")) return null;
    if (
      !card.classList.contains("loaded") &&
      !(await deps.loadDiffFile(entry.path))
    )
      return null;
    return inlineAnnotationTargetRow(entry);
  }

  function syncInlineAnnotationActive() {
    document
      .querySelectorAll<HTMLElement>(".gdp-annotation-row")
      .forEach((row) => {
        row.classList.toggle(
          "active",
          row.dataset.annotationId === activeAnnotationId,
        );
      });
    document
      .querySelectorAll<HTMLElement>(".gdp-db-annotation-inline")
      .forEach((box) => {
        box.classList.toggle(
          "active",
          box.dataset.annotationId === activeAnnotationId,
        );
      });
  }

  // A paste-ready reference for AI agents: identifies the annotation and
  // shows the exact CLI commands to revise it or post a follow-up answer.
  function annotationAiReference(
    session: AnnotationSession,
    entry: AnnotationEntry,
  ): string {
    return [
      "code-viewer のコード注釈について依頼があります。",
      "",
      "## 対象の注釈",
      `- annotation id: ${entry.id}`,
      `- 場所: ${annotationLocationLabel(entry)}`,
      `- session: ${session.id}「${session.title}」`,
      "",
    ].join("\n");
  }

  function annotationIconButton(
    icon: string,
    paths: string | string[],
    title: string,
  ): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "annotation-icon-btn";
    button.title = title;
    button.setAttribute("aria-label", title);
    button.innerHTML = iconSvg(icon, paths);
    return button;
  }

  function createCopyRefButton(
    entry: AnnotationEntry,
    extraClass = "",
  ): HTMLButtonElement {
    const button = annotationIconButton(
      "octicon-copy",
      COPY_16_PATHS,
      t().copy,
    );
    if (extraClass) button.classList.add(extraClass);
    button.addEventListener("click", async (e) => {
      e.stopPropagation();
      const found = findAnnotation(entry.id);
      if (!found) return;
      try {
        await navigator.clipboard.writeText(
          annotationAiReference(found.session, found.entry),
        );
        button.classList.add("copied");
        button.title = t().copied;
      } catch (error) {
        showAnnotationError(error, t().copyFailed);
        button.classList.add("failed");
      }
      setTimeout(() => {
        button.classList.remove("copied", "failed");
        button.title = t().copy;
      }, 1200);
    });
    return button;
  }

  function findAnnotation(entryId: string): {
    session: AnnotationSession;
    entry: AnnotationEntry;
    index: number;
  } | null {
    for (const session of ANNOTATIONS.sessions) {
      const index = session.entries.findIndex((e) => e.id === entryId);
      if (index >= 0) return { session, entry: session.entries[index], index };
    }
    return null;
  }

  function updateAnnotationBadge() {
    const total = ANNOTATIONS.sessions.reduce(
      (sum, session) => sum + session.entries.length,
      0,
    );
    annotationCountEl.textContent = String(total);
    annotationCountEl.hidden = total === 0;
  }

  function refreshAnnotations(): Promise<void> {
    if (refreshAnnotationsInFlight) return refreshAnnotationsInFlight;
    // A failed refresh keeps the last good library and a visible retry action.
    const started = doRefreshAnnotations()
      .catch((error) => {
        showAnnotationError(error, t().loadFailed);
      })
      .finally(() => {
        if (refreshAnnotationsInFlight === started)
          refreshAnnotationsInFlight = null;
      });
    refreshAnnotationsInFlight = started;
    return started;
  }

  async function doRefreshAnnotations(): Promise<void> {
    const revision = dataRevision;
    const res = await fetch("/_annotations");
    if (!res.ok)
      throw new Error(await responseErrorMessage(res, "Load annotations"));
    const state = (await res.json()) as AnnotationsState;
    // A GET started before a successful save must not overwrite that save.
    if (revision !== dataRevision) return doRefreshAnnotations();
    ANNOTATIONS = state;
    annotationsLoaded = true;
    if (errorTitle.textContent === t().loadFailed) errorBanner.hidden = true;
    updateAnnotationBadge();
    if (
      activeSessionId &&
      !ANNOTATIONS.sessions.some((s) => s.id === activeSessionId)
    ) {
      activeSessionId = null;
      syncSessionUrl();
    }
    renderAnnotationPanel();
    restoreAnnotationDetailFromState();
    applyInlineAnnotations();
    notifyAnnotationsChanged();
  }

  async function postAnnotationAction(
    payload: Record<string, unknown>,
  ): Promise<{
    entry?: AnnotationEntry;
    session_id?: string;
    session_title?: string;
  }> {
    const res = await fetch("/_annotations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Code-Viewer-Action": "1",
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok)
      throw new Error(
        await responseErrorMessage(res, `Annotation ${payload.action}`),
      );
    const result = await res.json();
    dataRevision++;
    return result;
  }

  async function changeAnnotations(payload: Record<string, unknown>) {
    try {
      await postAnnotationAction(payload);
      await refreshAnnotations();
    } catch (error) {
      showAnnotationError(error);
    }
  }

  // "2026-06-11T04:21:08.296Z" → "6/11 13:21" (local time). Same-day noise
  // like seconds is dropped; the full ISO string stays in the tooltip.
  // Shared by session headers and entry rows — both carry a created_at ISO
  // string with the same shape.
  function annotationTimeLabel(createdAt: string): string {
    const date = new Date(createdAt);
    if (Number.isNaN(date.getTime())) return "";
    const hm = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
    return `${date.getMonth() + 1}/${date.getDate()} ${hm}`;
  }

  function annotationEntrySummary(entry: AnnotationEntry): string {
    const text = entry.title || entry.body;
    const firstLine = text.split("\n")[0].trim();
    return firstLine.length > 90 ? `${firstLine.slice(0, 90)}…` : firstLine;
  }

  async function leaveEditor(): Promise<boolean> {
    if (!editor) return true;
    if (editor.isSaving()) return false;
    if (
      editor.isDirty() &&
      !(await showConfirmDialog({
        cancelLabel: t().cancel,
        title: t().discardTitle,
        body: t().discardBody,
        confirmLabel: t().discard,
        danger: true,
      }))
    )
      return false;
    editor = null;
    annotationPanel.classList.remove("annotation-editing");
    notifyAnnotationsChanged();
    return true;
  }

  async function openAnnotationEditForm(entry?: AnnotationEntry) {
    if (!(await leaveEditor())) return;
    openEntrySeq++;
    const editingSessionId = entry
      ? findAnnotation(entry.id)?.session.id
      : null;
    const route = deps.getRoute();
    const target =
      !entry && route.screen === "database"
        ? deps.captureDatabaseAnnotationTarget()
        : null;
    const range =
      route.screen === "file" || route.screen === "repo"
        ? { ...deps.currentRange(), to: route.ref }
        : deps.currentRange();
    annotationDetail
      .querySelectorAll(".annotation-detail-head-action")
      .forEach((el) => {
        el.remove();
      });
    $("#annotation-detail-session").textContent = entry
      ? t().editing
      : t().newNote;
    $("#annotation-detail-time").textContent = "";
    $("#annotation-detail-step").textContent = "";
    const location = $("#annotation-detail-location");
    location.textContent = entry
      ? annotationLocationLabel(entry)
      : target
        ? [target.db, target.schema, target.table, target.tab]
            .filter(Boolean)
            .join(" / ")
        : "";
    annotationDetail.hidden = false;
    annotationPanel.classList.add("annotation-editing");
    setAnnotationPanelOpen(true);
    editor = createAnnotationEditor({
      container: $("#annotation-detail-body"),
      entry,
      target,
      route,
      range,
      sessions: ANNOTATIONS.sessions,
      sessionId: activeSessionId,
      getLanguage,
      getHighlighter: () => mdHighlighter,
      reportError: (error) => showAnnotationError(error, t().saveFailed),
      cancel: () => {
        void leaveEditor().then((left) => {
          if (left) restoreAnnotationDetailFromState();
        });
      },
      save: async (payload) => {
        const result = await postAnnotationAction(payload);
        if (!result.entry)
          throw new Error(
            `Annotation ${payload.action}: response is missing the saved entry`,
          );
        const saved = result.entry;
        const sessionId = result.session_id || editingSessionId;
        let session = ANNOTATIONS.sessions.find(
          (item) => item.id === sessionId,
        );
        if (
          !session &&
          result.session_id &&
          result.session_title !== undefined
        ) {
          session = {
            id: result.session_id,
            title: result.session_title,
            created_at: saved.created_at,
            entries: [],
          };
          ANNOTATIONS.sessions.push(session);
        }
        if (!session)
          throw new Error(
            `Annotation ${payload.action}: response is missing the saved session`,
          );
        const index = session.entries.findIndex((item) => item.id === saved.id);
        if (index < 0) session.entries.push(saved);
        else session.entries[index] = saved;
        // Commit the returned entry before refreshing: a later GET failure must
        // never offer "Save" again and accidentally create a duplicate note.
        editor = null;
        annotationPanel.classList.remove("annotation-editing");
        errorBanner.hidden = true;
        activeSessionId = session.id;
        updateAnnotationBadge();
        renderAnnotationPanel();
        showAnnotationDetail(
          session,
          saved,
          index < 0 ? session.entries.length - 1 : index,
        );
        notifyAnnotationsChanged();
        void refreshAnnotations();
      },
    });
    notifyAnnotationsChanged();
    ensureMarkdownHighlighter();
  }

  function renderAnnotationPanel() {
    updateAnnotationContext();
    const scrollTop = annotationSessionsEl.scrollTop;
    annotationSessionsEl.replaceChildren();
    const query = search.value.trim().toLocaleLowerCase();
    clearSearch.disabled = !search.value;
    const route = deps.getRoute();
    const matches = (session: AnnotationSession, entry: AnnotationEntry) => {
      if (
        currentLocationOnly &&
        !(entry.target?.kind === "database"
          ? databaseAnnotationMatchesRoute(entry)
          : (route.screen === "file" || route.screen === "diff") &&
            route.path === entry.path)
      )
        return false;
      return [
        session.title,
        entry.title || "",
        entry.body,
        annotationLocationLabel(entry),
      ].some((value) => value.toLocaleLowerCase().includes(query));
    };
    let visible = 0;
    const total = ANNOTATIONS.sessions.reduce(
      (count, session) => count + session.entries.length,
      0,
    );
    for (const session of [...ANNOTATIONS.sessions].reverse()) {
      const entries = session.entries.filter((entry) =>
        matches(session, entry),
      );
      if ((query || currentLocationOnly) && !entries.length) continue;
      visible += entries.length;
      const sessionEl = document.createElement("section");
      sessionEl.className = "annotation-session";
      sessionEl.dataset.sessionId = session.id;
      sessionEl.classList.toggle("active", session.id === activeSessionId);

      sessionEl.addEventListener("click", (event) => {
        // Clicking the card body (not its buttons or entries) selects the
        // session so [ and ] navigate inside it.
        const target = event.target as HTMLElement;
        if (target.closest("button, a, input")) return;
        if (session.id !== activeSessionId) setActiveSession(session.id);
      });

      const head = document.createElement("div");
      head.className = "annotation-session-head";
      const title = document.createElement("button");
      title.type = "button";
      title.className = "annotation-session-select";
      const sessionName = document.createElement("span");
      sessionName.textContent = session.title;
      const sessionTime = document.createElement("small");
      sessionTime.className = "annotation-session-time";
      sessionTime.textContent = annotationTimeLabel(session.created_at);
      sessionTime.title = session.created_at;
      title.append(sessionName, sessionTime);
      title.title = t().inline;
      title.setAttribute(
        "aria-pressed",
        String(session.id === activeSessionId),
      );
      // Total step count, visible before opening the session so the reader
      // knows how long the walkthrough is.
      const count = document.createElement("span");
      count.className = "annotation-session-count";
      count.textContent = String(session.entries.length);
      count.title = t().count(entries.length, session.entries.length);
      title.addEventListener("click", () => {
        // Click toggles: selecting shows this session inline, re-clicking
        // the active session clears the inline walkthrough.
        setActiveSession(session.id === activeSessionId ? null : session.id);
      });
      const rename = annotationIconButton(
        "octicon-pencil",
        PENCIL_16_PATH,
        `${t().rename}: ${session.title}`,
      );
      rename.addEventListener("click", async () => {
        const next = await showPromptDialog({
          cancelLabel: t().cancel,
          title: t().rename,
          defaultValue: session.title,
          ariaLabel: t().sessionName,
          confirmLabel: t().renameAction,
          validate: (v) => {
            const trimmed = v.trim();
            return trimmed ? trimmed : null;
          },
        });
        if (next === null) return;
        void changeAnnotations({
          action: "rename",
          id: session.id,
          title: next,
        });
      });
      const del = annotationIconButton(
        "octicon-trash",
        TRASH_16_PATH,
        `${t().deleteSession}: ${session.title}`,
      );
      del.addEventListener("click", async () => {
        const ok = await showConfirmDialog({
          cancelLabel: t().cancel,
          title: t().deleteTitle,
          body: t().deleteBody(session.title),
          confirmLabel: t().delete,
          danger: true,
        });
        if (!ok) return;
        void changeAnnotations({ action: "delete", id: session.id });
      });
      const collapse = annotationIconButton(
        "octicon-chevron-down",
        CHEVRON_DOWN_16_PATH,
        t().collapse,
      );
      collapse.classList.add("annotation-session-collapse");
      head.append(collapse, title, count, rename, del);
      sessionEl.title = session.created_at;
      sessionEl.appendChild(head);

      const list = document.createElement("ol");
      list.className = "annotation-entries";
      const syncCollapsed = () => {
        const expanded = !!query || !collapsedSessions.has(session.id);
        list.hidden = !expanded;
        collapse.setAttribute("aria-expanded", String(expanded));
        collapse.title = expanded ? t().collapse : t().expand;
        collapse.setAttribute("aria-label", collapse.title);
      };
      collapse.addEventListener("click", () => {
        if (collapsedSessions.has(session.id))
          collapsedSessions.delete(session.id);
        else collapsedSessions.add(session.id);
        syncCollapsed();
      });
      syncCollapsed();
      entries.forEach((entry) => {
        const item = document.createElement("li");
        item.dataset.entryId = entry.id;
        item.classList.toggle("active", entry.id === activeAnnotationId);
        const open = document.createElement("button");
        open.type = "button";
        open.className = "annotation-entry-open";
        open.dataset.step = String(session.entries.indexOf(entry) + 1);
        const location = document.createElement("span");
        location.className = "annotation-entry-location";
        location.textContent = annotationLocationLabel(entry);
        const summary = document.createElement("span");
        summary.className = "annotation-entry-summary";
        summary.textContent = annotationEntrySummary(entry);
        location.title = location.textContent;
        summary.title = summary.textContent;
        open.append(summary, location);
        const entryTimeLabel = annotationTimeLabel(entry.created_at);
        if (entryTimeLabel) {
          const time = document.createElement("span");
          time.className = "annotation-entry-time";
          time.textContent = entryTimeLabel;
          time.title = entry.created_at;
          open.appendChild(time);
        }
        open.addEventListener("click", () => {
          void openAnnotationEntry(entry.id);
        });
        const remove = annotationIconButton(
          "octicon-trash",
          TRASH_16_PATH,
          `${t().deleteNote}: ${annotationLocationLabel(entry)}`,
        );
        remove.addEventListener("click", async () => {
          const ok = await showConfirmDialog({
            cancelLabel: t().cancel,
            title: t().deleteNoteTitle,
            body: t().deleteBody(annotationEntrySummary(entry)),
            confirmLabel: t().delete,
            danger: true,
          });
          if (!ok) return;
          void changeAnnotations({ action: "delete", id: entry.id });
        });
        item.append(open, remove);
        list.appendChild(item);
      });
      sessionEl.appendChild(list);
      annotationSessionsEl.appendChild(sessionEl);
    }
    annotationListCountEl.textContent = t().count(visible, total);
    if (!annotationSessionsEl.childElementCount) {
      const empty = document.createElement("div");
      empty.className = "annotation-empty";
      const heading = document.createElement("h3");
      heading.textContent = total ? t().noMatches : t().emptyTitle;
      const description = document.createElement("p");
      description.textContent = total ? t().noMatchesBody : t().emptyBody;
      const action = document.createElement("button");
      action.type = "button";
      action.className = "gdp-btn annotation-primary";
      action.textContent = total ? t().reset : t().add;
      action.addEventListener("click", () => {
        if (total) {
          search.value = "";
          currentLocationOnly = false;
          renderAnnotationPanel();
        } else void openAnnotationEditForm();
      });
      const hint = document.createElement("p");
      hint.className = "annotation-empty-hint";
      hint.textContent = total ? "" : t().emptyHint;
      empty.append(heading, description, action, hint);
      annotationSessionsEl.appendChild(empty);
    }
    $("#annotation-clear").hidden = !total;
    annotationSessionsEl.scrollTop = scrollTop;
  }

  // Toggle .active classes in place. Rebuilding the whole panel for a
  // selection change resets the list scroll position and causes visible
  // layout shift, so full renderAnnotationPanel() is reserved for data
  // changes (refresh/delete).
  function updateActiveHighlights() {
    annotationSessionsEl
      .querySelectorAll<HTMLElement>(".annotation-session")
      .forEach((el) => {
        el.classList.toggle("active", el.dataset.sessionId === activeSessionId);
        el.querySelector(".annotation-session-select")?.setAttribute(
          "aria-pressed",
          String(el.dataset.sessionId === activeSessionId),
        );
      });
    annotationSessionsEl
      .querySelectorAll<HTMLElement>(".annotation-entries li")
      .forEach((el) => {
        el.classList.toggle(
          "active",
          el.dataset.entryId === activeAnnotationId,
        );
      });
  }

  function hideAnnotationDetail() {
    activeAnnotationId = null;
    annotationDetail.hidden = true;
    syncSessionUrl();
    updateActiveHighlights();
    syncInlineAnnotationActive();
  }

  function showAnnotationDetail(
    session: AnnotationSession,
    entry: AnnotationEntry,
    index: number,
  ) {
    activeAnnotationId = entry.id;
    $("#annotation-detail-session").textContent = session.title;
    const detailTime = $("#annotation-detail-time");
    detailTime.textContent = annotationTimeLabel(entry.created_at);
    detailTime.title = entry.created_at;
    $("#annotation-detail-step").textContent =
      `${index + 1}/${session.entries.length}`;
    const location = $<HTMLAnchorElement>("#annotation-detail-location");
    location.textContent = annotationLocationLabel(entry);
    const body = $("#annotation-detail-body");
    body.replaceChildren();
    if (entry.title) {
      const heading = document.createElement("strong");
      heading.className = "annotation-detail-title";
      heading.textContent = entry.title;
      body.appendChild(heading);
    }
    const markdown = document.createElement("div");
    markdown.className =
      "gdp-markdown-preview markdown-body gdp-annotation-prose";
    ensureMarkdownHighlighter();
    markdown.innerHTML = renderMarkdownHtml(
      entry.body,
      { path: entry.path, ref: annotationRefForEntry(entry) },
      mdHighlighter,
    );
    body.appendChild(markdown);
    const head = annotationDetail.querySelector<HTMLElement>(
      ".annotation-detail-head",
    );
    head?.querySelectorAll(".annotation-detail-head-action").forEach((el) => {
      el.remove();
    });
    const copyRef = createCopyRefButton(entry, "annotation-detail-head-action");
    const edit = annotationIconButton(
      "octicon-pencil",
      PENCIL_16_PATH,
      t().edit,
    );
    edit.classList.add("annotation-detail-head-action");
    edit.addEventListener("click", () => {
      void openAnnotationEditForm(entry);
    });
    head?.insertBefore(copyRef, annotationDetailPrev);
    head?.insertBefore(edit, annotationDetailPrev);
    annotationDetailPrev.disabled = index <= 0;
    annotationDetailNext.disabled = index >= session.entries.length - 1;
    annotationDetail.hidden = false;
    setAnnotationPanelOpen(true);
    updateActiveHighlights();
    syncInlineAnnotationActive();
  }

  function restoreAnnotationDetailFromState() {
    if (editor) return;
    if (!activeAnnotationId) {
      annotationDetail.hidden = true;
      updateActiveHighlights();
      syncInlineAnnotationActive();
      return;
    }
    const found = findAnnotation(activeAnnotationId);
    if (!found) {
      activeAnnotationId = null;
      annotationDetail.hidden = true;
      syncSessionUrl();
      updateActiveHighlights();
      syncInlineAnnotationActive();
      return;
    }
    activeSessionId = found.session.id;
    showAnnotationDetail(found.session, found.entry, found.index);
  }

  // In-place retarget of the source line highlight, used when an entry
  // click stays within the already-rendered standalone source file.
  function focusStandaloneSourceLines(
    card: HTMLElement,
    entry: AnnotationEntry,
  ) {
    if (!entry.line) return;
    const { start, end } = entry.line;
    card
      .querySelectorAll<HTMLElement>(".gdp-source-table tr[data-line]")
      .forEach((tr) => {
        const n = Number(tr.dataset.line);
        tr.classList.toggle("gdp-source-line-target", n >= start && n <= end);
      });
  }

  // Rapid clicks must not interleave: each open invalidates the previous
  // one at every await point, so the LAST click always wins.
  let openEntrySeq = 0;

  async function openAnnotationEntry(entryId: string): Promise<void> {
    if (editor && !(await leaveEditor())) return;
    const seq = ++openEntrySeq;
    const stale = () => seq !== openEntrySeq;
    const found = findAnnotation(entryId);
    if (!found) return;
    const { session, entry, index } = found;
    // Opening an entry activates its session so the inline walkthrough and
    // the URL param follow along; setRoute below pushes the URL with it.
    // The assignment must happen BEFORE showAnnotationDetail, which syncs
    // the active highlight classes from this value.
    const sessionChanged = activeSessionId !== session.id;
    activeSessionId = session.id;
    if (sessionChanged) notifyAnnotationsChanged();
    notifyAnnotationOpened(entry.id);
    // Show the detail panel immediately — the navigation below can involve
    // loads and context expansion; the panel must not lag behind the click.
    showAnnotationDetail(session, entry, index);
    if (entry.target?.kind === "database") {
      const target = entry.target;
      deps.cancelActiveSourceLoad("navigation");
      deps.removeStandaloneSource();
      deps.setRoute({
        screen: "database",
        db: target.db,
        schema: target.schema,
        table: target.table,
        tab: target.tab,
        range: deps.currentRange(),
      });
      deps.setPageMode();
      await deps.openDatabaseAnnotation(target);
      if (stale()) return;
      applyInlineAnnotations();
      const block = document.querySelector<HTMLElement>(
        `.gdp-db-annotation-inline[data-annotation-id="${CSS.escape(entryId)}"]`,
      );
      if (block) deps.scrollDiffElementIntoView(block, "center");
      return;
    }
    const from = entry.range.from || "HEAD";
    const to = entry.range.to || "worktree";
    const range = { from, to };
    const current = deps.currentRange();
    const rangeChanged = current.from !== from || current.to !== to;
    const prevRoute = deps.getRoute();
    const line = annotationLineTarget(entry);

    if (prevRoute.screen === "database") deps.leaveDatabaseView();
    deps.setRange(from, to);
    deps.syncRefInputs();
    deps.cancelActiveSourceLoad("navigation");
    // Decide the destination (diff card vs standalone source) BEFORE any
    // route or page-mode switch: flipping to the diff route first and then
    // correcting to the file route repaints the whole layout and makes the
    // header menu flicker on every annotation step.
    const rangeKey = `${from}..${to}`;
    const needDiffLoad =
      rangeChanged ||
      (!deps.getFiles().length && emptyDiffRangeKey !== rangeKey);
    if (needDiffLoad) {
      // The file list for this range is unknown — the diff has to load.
      deps.setRoute({ screen: "diff", range, path: entry.path, line });
      deps.setPageMode();
      deps.removeStandaloneSource();
      await deps.load();
      if (stale()) return;
      emptyDiffRangeKey = deps.getFiles().length ? null : rangeKey;
    }

    let showSourceView = !deps.getFiles().some((f) => f.path === entry.path);
    let replaceSourceRoute = needDiffLoad;
    if (!showSourceView) {
      // Reload the diff only when the rendered cards cannot be reused: a
      // full load() tears down and rebuilds every file card, which is the
      // heaviest re-render an entry click can trigger.
      const hasDiffCards = !!document.querySelector(
        ".gdp-file-shell:not(.gdp-standalone-source)",
      );
      if (!hasDiffCards) {
        // With no diff shell in the DOM we cannot resolve line-level diff
        // targets yet, so this is the one path that must paint the diff first.
        deps.setRoute(
          { screen: "diff", range, path: entry.path, line },
          needDiffLoad,
        );
        deps.setPageMode();
        deps.removeStandaloneSource();
        await deps.load();
        if (stale()) return;
      }
      deps.removeStandaloneSource();
      deps.scrollToFile(entry.path, line);
      const target = await waitForAnnotationDiffTarget(entry);
      if (stale()) return;
      if (!target) {
        showSourceView = true;
        replaceSourceRoute = true;
      } else {
        // Replace the route pushed for the load above instead of stacking a
        // second history entry for the same step.
        deps.setRoute(
          { screen: "diff", range, path: entry.path, line },
          needDiffLoad,
        );
        deps.setPageMode();
      }
    }
    if (showSourceView) {
      // The annotated file has no diff in this range — show its source
      // directly so unchanged code can be explained too.
      const ref = annotationRefForEntry(entry);
      const card = document.querySelector<HTMLElement>(
        ".gdp-standalone-source",
      );
      // Moving between annotations within the same rendered file must not
      // rebuild the whole source view — retarget the highlight in place.
      const reusable =
        prevRoute.screen === "file" &&
        prevRoute.path === entry.path &&
        prevRoute.ref === ref &&
        card?.dataset.path === entry.path &&
        !!card.querySelector(".gdp-source-table");
      deps.setRoute(
        { screen: "file", path: entry.path, ref, view: "blob", line, range },
        replaceSourceRoute,
      );
      deps.setPageMode();
      if (reusable && card) {
        focusStandaloneSourceLines(card, entry);
      } else {
        await deps.renderStandaloneSource({ path: entry.path, ref });
        if (stale()) return;
      }
    }
    // Re-inserting every inline row shifts the code layout; when only the
    // selection moved within the already-rendered session, the active class
    // sync from showAnnotationDetail is enough.
    const rowSelector = `.gdp-annotation-row[data-annotation-id="${CSS.escape(entryId)}"]`;
    if (sessionChanged || !document.querySelector(rowSelector))
      applyInlineAnnotations();
    const inlineRow = document.querySelector<HTMLElement>(rowSelector);
    if (inlineRow) deps.scrollDiffElementIntoView(inlineRow, "center");
  }

  function stepAnnotation(direction: 1 | -1) {
    const found = activeAnnotationId
      ? findAnnotation(activeAnnotationId)
      : null;
    // Step within the current annotation only while it belongs to the
    // active session; after the user selects another session the keys
    // must navigate that session instead.
    if (found && (!activeSessionId || found.session.id === activeSessionId)) {
      const next = found.session.entries[found.index + direction];
      if (next) void openAnnotationEntry(next.id);
      return;
    }
    // Enter the walkthrough at the start (or the end when stepping
    // backwards), preferring the active session.
    const session =
      ANNOTATIONS.sessions.find((s) => s.id === activeSessionId) ??
      ANNOTATIONS.sessions[0];
    const entries = session?.entries ?? [];
    const entry = direction === 1 ? entries[0] : entries[entries.length - 1];
    if (entry) void openAnnotationEntry(entry.id);
  }

  function handleSse(raw: string) {
    let event: AnnotationSseEvent | null = null;
    try {
      event = JSON.parse(raw) as AnnotationSseEvent;
    } catch (error) {
      showAnnotationError(error);
      return;
    }
    void refreshAnnotations().then(() => {
      if (
        event?.kind === "add" &&
        event.entry_id &&
        annotationFollow &&
        !annotationPanelDismissed &&
        !editor &&
        findAnnotation(event.entry_id)
      ) {
        void openAnnotationEntry(event.entry_id);
      }
    });
  }

  const ANNOTATION_PANEL_DEFAULT_WIDTH = 380;
  const ANNOTATION_PANEL_MIN_WIDTH = 260;
  const ANNOTATION_PANEL_MAX_WIDTH = 720;

  function annotationPanelMaxWidth() {
    return Math.max(
      ANNOTATION_PANEL_MIN_WIDTH,
      Math.min(ANNOTATION_PANEL_MAX_WIDTH, window.innerWidth - 32),
    );
  }

  function applyAnnotationPanelWidth(width: number, persist = true) {
    const clamped = Math.max(
      ANNOTATION_PANEL_MIN_WIDTH,
      Math.min(annotationPanelMaxWidth(), width),
    );
    document.documentElement.style.setProperty(
      "--annotation-panel-w",
      `${clamped}px`,
    );
    if (persist) deps.setAnnotationPanelWidth(clamped);
  }

  // URL state wins on reload; the persisted preference remains the fallback
  // for URLs that do not carry annotation state yet.
  if (
    initialUrlParams.get(ANNOTATION_PANEL_PARAM) === "open" ||
    activeAnnotationId ||
    deps.getAnnotationPanelOpen()
  )
    setAnnotationPanelOpen(true);
  applyAnnotationPanelWidth(
    deps.getAnnotationPanelWidth() ?? ANNOTATION_PANEL_DEFAULT_WIDTH,
    false,
  );
  updateAnnotationContext();

  $("#annotations-toggle").addEventListener("click", () => {
    setAnnotationPanelOpen(annotationPanel.hidden);
    updateAnnotationContext();
    if (!annotationPanel.hidden) void refreshAnnotations();
  });
  annotationAdd.addEventListener("click", () => {
    void openAnnotationEditForm();
  });
  $("#annotation-panel-close").addEventListener("click", () => {
    annotationPanelDismissed = true;
    setAnnotationPanelOpen(false);
  });
  const followCheckbox = $<HTMLInputElement>("#annotation-follow");
  followCheckbox.checked = annotationFollow;
  followCheckbox.addEventListener("change", () => {
    annotationFollow = followCheckbox.checked;
    deps.setAnnotationFollow(annotationFollow);
  });
  $("#annotation-clear").addEventListener("click", async () => {
    const ok = await showConfirmDialog({
      cancelLabel: t().cancel,
      title: t().deleteAll,
      body: t().deleteAllBody,
      confirmLabel: t().deleteAll,
      danger: true,
    });
    if (!ok) return;
    hideAnnotationDetail();
    void changeAnnotations({ action: "clear" });
  });
  $("#annotation-detail-close").addEventListener("click", () => {
    void leaveEditor().then((left) => {
      if (left) hideAnnotationDetail();
    });
  });
  annotationDetailPrev.addEventListener("click", () => {
    stepAnnotation(-1);
  });
  annotationDetailNext.addEventListener("click", () => {
    stepAnnotation(1);
  });
  $("#annotation-detail-location").addEventListener("click", (e) => {
    e.preventDefault();
    if (activeAnnotationId) void openAnnotationEntry(activeAnnotationId);
  });
  window.addEventListener("beforeunload", (event) => {
    if (editor?.isDirty() || editor?.isSaving()) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
  localize();
  void refreshAnnotations();

  return {
    localize,
    applyInlineAnnotations,
    refreshAnnotations,
    handleSse,
    withSessionParam,
    restoreSessionFromUrl,
    openAnnotationEntry,
    setAnnotationPanelOpen,
    applyAnnotationPanelWidth,
    getActiveSessionEntries() {
      if (editor) return [];
      const session = ANNOTATIONS.sessions.find(
        (s) => s.id === activeSessionId,
      );
      return session ? session.entries : [];
    },
    onAnnotationsChanged(cb: () => void) {
      annotationsChangedCallbacks.push(cb);
    },
    onAnnotationOpened(cb: (entryId: string) => void) {
      annotationOpenedCallbacks.push(cb);
    },
    getActiveAnnotationId() {
      return activeAnnotationId;
    },
    stepAnnotation,
  };
}
