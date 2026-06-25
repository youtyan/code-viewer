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

import {
  COPY_16_PATHS,
  iconSvg,
  PENCIL_16_PATH,
  PLUS_16_PATH,
  TRASH_16_PATH,
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
  AnnotationTarget,
  DiffCardElement,
  FileMeta,
} from "../core/types";

export const ANNOTATION_SESSION_PARAM = "annotationSession";

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
  setRange(from: string, to: string): void;
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
  /** Re-inject inline rows for the active session into loaded diff/source. */
  applyInlineAnnotations(): void;
  /** Fetch state from the server and re-render panel + inline rows. */
  refreshAnnotations(): Promise<void>;
  /** Handle a raw `annotations` SSE payload. */
  handleSse(raw: string): void;
  /** Append/remove the annotationSession query param on a URL. */
  withSessionParam(rawUrl: string): string;
  /** Re-read the session param from location (popstate) and re-render. */
  restoreSessionFromUrl(): void;
  /** Jump to an entry (file/line navigation + detail panel). */
  openAnnotationEntry(entryId: string): Promise<void>;
  /** Show or hide the annotation panel. */
  setAnnotationPanelOpen(open: boolean): void;
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

  let ANNOTATIONS: AnnotationsState = { version: 1, sessions: [] };
  let annotationFollow = localStorage.getItem("gdp:annotation-follow") !== "0";
  let activeAnnotationId: string | null = null;
  let annotationPanelDismissed = false;
  let activeSessionId: string | null = new URLSearchParams(
    window.location.search,
  ).get(ANNOTATION_SESSION_PARAM);
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
      if (activeAnnotationId) {
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
  const annotationCaptureDb = $<HTMLButtonElement>("#annotation-capture-db");
  annotationCaptureDb.innerHTML = iconSvg("octicon-plus", PLUS_16_PATH);

  function updateDatabaseCaptureButton() {
    annotationCaptureDb.hidden = deps.getRoute().screen !== "database";
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
    }
    localStorage.setItem("gdp:annotation-panel", open ? "1" : "0");
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
      const parts = ["Database"];
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
    if (activeSessionId)
      url.searchParams.set(ANNOTATION_SESSION_PARAM, activeSessionId);
    else url.searchParams.delete(ANNOTATION_SESSION_PARAM);
    return url.pathname + url.search;
  }

  // Inline annotation rows: the explanation is rendered directly under its
  // target code line (diff or standalone source) so the reader does not have
  // to glance back and forth between code and the side panel.
  function buildInlineAnnotationRow(
    entry: AnnotationEntry,
    colSpan: number,
  ): HTMLTableRowElement {
    const tr = document.createElement("tr");
    tr.className = "gdp-annotation-row";
    tr.dataset.annotationId = entry.id;
    tr.classList.toggle("active", entry.id === activeAnnotationId);
    const td = document.createElement("td");
    td.colSpan = colSpan;
    const box = document.createElement("div");
    box.className = "gdp-annotation-inline";
    if (entry.title) {
      const heading = document.createElement("strong");
      heading.className = "gdp-annotation-inline-title";
      heading.textContent = entry.title;
      box.appendChild(heading);
    }
    box.appendChild(createCopyRefButton(entry, "gdp-annotation-inline-copy"));
    const markdown = document.createElement("div");
    markdown.className = "gdp-annotation-inline-body";
    ensureMarkdownHighlighter();
    markdown.innerHTML = renderMarkdownHtml(
      entry.body,
      { path: entry.path, ref: annotationRefForEntry(entry) },
      mdHighlighter,
    );
    box.appendChild(markdown);
    td.appendChild(box);
    tr.appendChild(td);
    return tr;
  }

  function buildDatabaseAnnotationBlock(entry: AnnotationEntry): HTMLElement {
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
    head.append(title, location, createCopyRefButton(entry));
    const markdown = document.createElement("div");
    markdown.className = "gdp-db-annotation-inline-body";
    ensureMarkdownHighlighter();
    markdown.innerHTML = renderMarkdownHtml(
      entry.body,
      { path: entry.path, ref: annotationRefForEntry(entry) },
      mdHighlighter,
    );
    box.append(head, markdown);
    return box;
  }

  function applyDatabaseAnnotations(session: AnnotationSession | undefined) {
    document
      .querySelectorAll<HTMLElement>(".gdp-db-annotation-strip")
      .forEach((el) => {
        el.remove();
      });
    if (!session || deps.getRoute().screen !== "database") return;
    const matches = session.entries.filter(databaseAnnotationMatchesRoute);
    if (!matches.length) return;
    const root = document.querySelector<HTMLElement>(".db-root");
    if (!root) return;
    const strip = document.createElement("section");
    strip.className = "gdp-db-annotation-strip";
    strip.setAttribute("aria-label", "Database annotations");
    for (const entry of matches) {
      strip.appendChild(buildDatabaseAnnotationBlock(entry));
    }
    root.prepend(strip);
  }

  function inlineAnnotationTargetRow(
    entry: AnnotationEntry,
  ): HTMLTableRowElement | null {
    if (!entry.line) return null;
    const line = entry.line.end;
    const card = document.querySelector<HTMLElement>(
      deps.diffCardSelector(entry.path),
    );
    if (!card) return null;
    const sourceRow = card.querySelector<HTMLTableRowElement>(
      `.gdp-source-table tr[data-line="${String(line)}"]`,
    );
    if (sourceRow) return sourceRow;
    const rows = Array.from(
      card.querySelectorAll<HTMLTableRowElement>("table.d2h-diff-table tr"),
    );
    return rows.find((row) => deps.diffRowLineNumber(row) === line) || null;
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

  function applyInlineAnnotations() {
    document.querySelectorAll(".gdp-annotation-row").forEach((row) => {
      row.remove();
    });
    // Inline rows are scoped to the selected session: showing every entry at
    // once buries the code, so nothing is inlined until a session is active.
    const session = ANNOTATIONS.sessions.find((s) => s.id === activeSessionId);
    applyDatabaseAnnotations(session);
    if (!session) return;
    for (const entry of session.entries) {
      if (entry.target?.kind === "database") continue;
      const target = inlineAnnotationTargetRow(entry);
      if (!target) continue;
      // Keep document order when several annotations land on the same line.
      let anchor: HTMLTableRowElement = target;
      while (
        anchor.nextElementSibling?.classList.contains("gdp-annotation-row")
      )
        anchor = anchor.nextElementSibling as HTMLTableRowElement;
      anchor.after(buildInlineAnnotationRow(entry, target.cells.length));
      const sibling = siblingSideRow(target);
      if (sibling) {
        let sibAnchor: HTMLTableRowElement = sibling;
        while (
          sibAnchor.nextElementSibling?.classList.contains("gdp-annotation-row")
        )
          sibAnchor = sibAnchor.nextElementSibling as HTMLTableRowElement;
        sibAnchor.after(buildInlineSpacerRow(entry, sibling.cells.length));
      }
    }
    syncInlineAnnotationWidths();
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

  function syncInlineAnnotationWidths() {
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
      });
    syncInlineAnnotationSpacerHeights();
  }
  window.addEventListener("resize", syncInlineAnnotationWidths);

  function syncSessionUrl() {
    const current = window.location.pathname + window.location.search;
    const next = withSessionParam(current);
    if (next !== current) history.replaceState(history.state, "", next);
  }

  function setActiveSession(sessionId: string | null) {
    if (activeSessionId === sessionId) return;
    activeSessionId = sessionId;
    syncSessionUrl();
    updateActiveHighlights();
    applyInlineAnnotations();
    notifyAnnotationsChanged();
  }

  function restoreSessionFromUrl() {
    activeSessionId = new URLSearchParams(window.location.search).get(
      ANNOTATION_SESSION_PARAM,
    );
    renderAnnotationPanel();
    applyInlineAnnotations();
  }

  // When an annotation targets unchanged code outside the diff hunks, the
  // target row does not exist yet — expand the full file context (same as
  // the header unfold button) so the line and its inline note become visible.
  async function expandAnnotationContext(entry: AnnotationEntry) {
    if (!entry.line || inlineAnnotationTargetRow(entry)) return;
    const card = document.querySelector<DiffCardElement>(
      deps.diffCardSelector(entry.path),
    );
    const file = deps.getFiles().find((f) => f.path === entry.path);
    if (!card || !file || card.classList.contains("gdp-standalone-source"))
      return;
    // The card may still be lazy-loading after the scrollToFile priority load.
    for (let i = 0; i < 50 && !card.classList.contains("loaded"); i++)
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
    if (inlineAnnotationTargetRow(entry)) return;
    if (card.classList.contains("gdp-context-expanded")) return;
    await deps.expandAllFileContext(card, file);
    deps.focusDiffLine(card, annotationLineTarget(entry));
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
      "copy AI-ready reference (id / location / edit commands)",
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
      } catch {
        button.classList.add("failed");
      }
      setTimeout(() => {
        button.classList.remove("copied", "failed");
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
    annotationListCountEl.textContent = `${ANNOTATIONS.sessions.length} sessions / ${total} annotations`;
  }

  async function refreshAnnotations(): Promise<void> {
    try {
      const res = await fetch("/_annotations");
      if (!res.ok) return;
      ANNOTATIONS = (await res.json()) as AnnotationsState;
    } catch {
      return;
    }
    updateAnnotationBadge();
    if (
      activeSessionId &&
      !ANNOTATIONS.sessions.some((s) => s.id === activeSessionId)
    ) {
      activeSessionId = null;
      syncSessionUrl();
    }
    renderAnnotationPanel();
    applyInlineAnnotations();
    if (activeAnnotationId && !findAnnotation(activeAnnotationId))
      hideAnnotationDetail();
    notifyAnnotationsChanged();
  }

  async function postAnnotationAction(
    payload: Record<string, unknown>,
  ): Promise<void> {
    try {
      await fetch("/_annotations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Code-Viewer-Action": "1",
        },
        body: JSON.stringify(payload),
      });
    } catch {
      /* refresh below shows the real state either way */
    }
    await refreshAnnotations();
  }

  // "2026-06-11T04:21:08.296Z" → "6/11 13:21" (local time). Same-day noise
  // like seconds is dropped; the full ISO string stays in the tooltip.
  function sessionTimeLabel(createdAt: string): string {
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

  function databaseAnnotationTitle(
    target: Extract<AnnotationEntry["target"], { kind: "database" }>,
  ): string {
    const parts = [target.table || target.schema || target.db || "Database"];
    if (target.schema && target.table) parts.unshift(target.schema);
    if (target.tab === "data" && target.data?.search)
      parts.push(`search: ${target.data.search}`);
    else if (target.tab === "query" && target.query?.sql) parts.push("query");
    else if (target.tab === "search" && target.search?.term)
      parts.push(`global search: ${target.search.term}`);
    else if (target.tab) parts.push(target.tab);
    return parts.join(" / ");
  }

  function openDatabaseCaptureForm(
    target: Extract<AnnotationTarget, { kind: "database" }>,
  ) {
    $("#annotation-detail-session").textContent =
      activeSessionId || "Database annotations";
    $("#annotation-detail-step").textContent = "new";
    const location = $<HTMLAnchorElement>("#annotation-detail-location");
    location.textContent = databaseAnnotationTitle(target);
    location.href = "#";
    const head = annotationDetail.querySelector<HTMLElement>(
      ".annotation-detail-head",
    );
    head?.querySelectorAll(".annotation-detail-head-action").forEach((el) => {
      el.remove();
    });
    const body = $("#annotation-detail-body");
    body.replaceChildren();
    const form = document.createElement("div");
    form.className = "annotation-edit-form";
    const titleInput = document.createElement("input");
    titleInput.type = "text";
    titleInput.placeholder = "title (optional)";
    titleInput.value = databaseAnnotationTitle(target);
    const bodyInput = document.createElement("textarea");
    bodyInput.rows = 10;
    bodyInput.placeholder = "annotation body";
    const buttons = document.createElement("div");
    buttons.className = "annotation-edit-buttons";
    const save = document.createElement("button");
    save.type = "button";
    save.className = "gdp-btn gdp-btn-sm";
    save.textContent = "Save";
    save.addEventListener("click", async () => {
      if (!bodyInput.value.trim()) return;
      save.disabled = true;
      annotationCaptureDb.disabled = true;
      try {
        const res = await fetch("/_annotations", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Code-Viewer-Action": "1",
          },
          body: JSON.stringify({
            action: "add",
            session_id: activeSessionId || undefined,
            session_title: activeSessionId ? undefined : "Database annotations",
            target,
            title: titleInput.value,
            body: bodyInput.value,
          }),
        });
        const result = res.ok
          ? ((await res.json()) as {
              session_id?: string;
              entry?: { id?: string };
            })
          : null;
        if (result?.session_id) {
          activeSessionId = result.session_id;
          syncSessionUrl();
        }
        await refreshAnnotations();
        if (result?.entry?.id) await openAnnotationEntry(result.entry.id);
      } finally {
        save.disabled = false;
        annotationCaptureDb.disabled = false;
      }
    });
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "gdp-btn gdp-btn-sm";
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", () => {
      annotationDetail.hidden = true;
    });
    buttons.append(save, cancel);
    form.append(titleInput, bodyInput, buttons);
    body.appendChild(form);
    annotationDetail.hidden = false;
    setAnnotationPanelOpen(true);
    titleInput.focus();
  }

  async function captureCurrentDatabaseAnnotation(): Promise<void> {
    const target = deps.captureDatabaseAnnotationTarget();
    if (!target?.db) return;
    openDatabaseCaptureForm(target);
  }

  function renderAnnotationPanel() {
    updateDatabaseCaptureButton();
    annotationSessionsEl.replaceChildren();
    if (!ANNOTATIONS.sessions.length) {
      const empty = document.createElement("p");
      empty.className = "annotation-empty";
      empty.textContent =
        "No annotations yet. Agents can add them with: code-viewer annotate add";
      annotationSessionsEl.appendChild(empty);
      return;
    }
    for (const session of [...ANNOTATIONS.sessions].reverse()) {
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
      title.textContent = session.title;
      title.title = session.created_at;
      const time = document.createElement("span");
      time.className = "annotation-session-time";
      time.textContent = sessionTimeLabel(session.created_at);
      time.title = session.created_at;
      title.addEventListener("click", () => {
        // Click toggles: selecting shows this session inline, re-clicking
        // the active session clears the inline walkthrough.
        setActiveSession(session.id === activeSessionId ? null : session.id);
      });
      const rename = annotationIconButton(
        "octicon-pencil",
        PENCIL_16_PATH,
        `rename session ${session.title}`,
      );
      rename.addEventListener("click", () => {
        const next = window.prompt("Rename session", session.title);
        if (next === null || !next.trim()) return;
        void postAnnotationAction({
          action: "rename",
          id: session.id,
          title: next,
        });
      });
      const del = annotationIconButton(
        "octicon-trash",
        TRASH_16_PATH,
        `delete session ${session.title}`,
      );
      del.addEventListener("click", () => {
        if (!window.confirm(`Delete annotation session "${session.title}"?`))
          return;
        void postAnnotationAction({ action: "delete", id: session.id });
      });
      head.append(title, time, rename, del);
      sessionEl.appendChild(head);

      const list = document.createElement("ol");
      list.className = "annotation-entries";
      session.entries.forEach((entry) => {
        const item = document.createElement("li");
        item.dataset.entryId = entry.id;
        item.classList.toggle("active", entry.id === activeAnnotationId);
        const open = document.createElement("button");
        open.type = "button";
        open.className = "annotation-entry-open";
        const location = document.createElement("span");
        location.className = "annotation-entry-location";
        location.textContent = annotationLocationLabel(entry);
        const summary = document.createElement("span");
        summary.className = "annotation-entry-summary";
        summary.textContent = annotationEntrySummary(entry);
        open.append(location, summary);
        open.addEventListener("click", () => {
          void openAnnotationEntry(entry.id);
        });
        const remove = annotationIconButton(
          "octicon-trash",
          TRASH_16_PATH,
          `delete annotation for ${annotationLocationLabel(entry)}`,
        );
        remove.addEventListener("click", () => {
          if (
            !window.confirm(
              `Delete annotation for ${annotationLocationLabel(entry)}?`,
            )
          )
            return;
          void postAnnotationAction({ action: "delete", id: entry.id });
        });
        item.append(open, remove);
        list.appendChild(item);
      });
      sessionEl.appendChild(list);
      annotationSessionsEl.appendChild(sessionEl);
    }
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
      "edit this annotation",
    );
    edit.classList.add("annotation-detail-head-action");
    edit.addEventListener("click", () => {
      openAnnotationEditForm(entry);
    });
    const prev = $("#annotation-detail-prev");
    head?.insertBefore(copyRef, prev);
    head?.insertBefore(edit, prev);
    $<HTMLButtonElement>("#annotation-detail-prev").disabled = index <= 0;
    $<HTMLButtonElement>("#annotation-detail-next").disabled =
      index >= session.entries.length - 1;
    annotationDetail.hidden = false;
    setAnnotationPanelOpen(true);
    updateActiveHighlights();
    syncInlineAnnotationActive();
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

  // Inline edit form inside the detail dock: fix up an annotation the AI
  // got wrong without leaving the browser.
  function openAnnotationEditForm(entry: AnnotationEntry) {
    const body = $("#annotation-detail-body");
    body.replaceChildren();
    const form = document.createElement("div");
    form.className = "annotation-edit-form";
    const titleInput = document.createElement("input");
    titleInput.type = "text";
    titleInput.placeholder = "title (optional)";
    titleInput.value = entry.title || "";
    const bodyInput = document.createElement("textarea");
    bodyInput.value = entry.body;
    bodyInput.rows = 10;
    const buttons = document.createElement("div");
    buttons.className = "annotation-edit-buttons";
    const save = document.createElement("button");
    save.type = "button";
    save.className = "gdp-btn gdp-btn-sm";
    save.textContent = "Save";
    save.addEventListener("click", async () => {
      if (!bodyInput.value.trim()) return;
      save.disabled = true;
      await postAnnotationAction({
        action: "update",
        id: entry.id,
        title: titleInput.value,
        body: bodyInput.value,
      });
      const found = findAnnotation(entry.id);
      if (found) showAnnotationDetail(found.session, found.entry, found.index);
    });
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "gdp-btn gdp-btn-sm";
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", () => {
      const found = findAnnotation(entry.id);
      if (found) showAnnotationDetail(found.session, found.entry, found.index);
    });
    buttons.append(save, cancel);
    form.append(titleInput, bodyInput, buttons);
    body.appendChild(form);
    bodyInput.focus();
  }

  async function openAnnotationEntry(entryId: string): Promise<void> {
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

    if (deps.getFiles().some((f) => f.path === entry.path)) {
      // Replace the route pushed for the load above instead of stacking a
      // second history entry for the same step.
      deps.setRoute(
        { screen: "diff", range, path: entry.path, line },
        needDiffLoad,
      );
      deps.setPageMode();
      // Reload the diff only when the rendered cards cannot be reused: a
      // full load() tears down and rebuilds every file card, which is the
      // heaviest re-render an entry click can trigger.
      const hasDiffCards = !!document.querySelector(
        ".gdp-file-shell:not(.gdp-standalone-source)",
      );
      if (!hasDiffCards) {
        deps.removeStandaloneSource();
        await deps.load();
        if (stale()) return;
      }
      deps.removeStandaloneSource();
      deps.scrollToFile(entry.path, line);
      await expandAnnotationContext(entry);
      if (stale()) return;
    } else {
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
        needDiffLoad,
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
    } catch {
      event = null;
    }
    void refreshAnnotations().then(() => {
      if (
        event?.kind === "add" &&
        event.entry_id &&
        annotationFollow &&
        !annotationPanelDismissed &&
        findAnnotation(event.entry_id)
      ) {
        void openAnnotationEntry(event.entry_id);
      }
    });
  }

  // Restore the panel open/closed state across reloads.
  if (localStorage.getItem("gdp:annotation-panel") === "1")
    setAnnotationPanelOpen(true);
  updateDatabaseCaptureButton();

  $("#annotations-toggle").addEventListener("click", () => {
    setAnnotationPanelOpen(annotationPanel.hidden);
    updateDatabaseCaptureButton();
    if (!annotationPanel.hidden) void refreshAnnotations();
  });
  annotationCaptureDb.addEventListener("click", () => {
    void captureCurrentDatabaseAnnotation();
  });
  $("#annotation-panel-close").addEventListener("click", () => {
    annotationPanelDismissed = true;
    setAnnotationPanelOpen(false);
  });
  const followCheckbox = $<HTMLInputElement>("#annotation-follow");
  followCheckbox.checked = annotationFollow;
  followCheckbox.addEventListener("change", () => {
    annotationFollow = followCheckbox.checked;
    localStorage.setItem("gdp:annotation-follow", annotationFollow ? "1" : "0");
  });
  $("#annotation-clear").addEventListener("click", () => {
    if (!window.confirm("Delete all annotations?")) return;
    hideAnnotationDetail();
    void postAnnotationAction({ action: "clear" });
  });
  $("#annotation-detail-close").addEventListener("click", hideAnnotationDetail);
  $("#annotation-detail-prev").addEventListener("click", () => {
    stepAnnotation(-1);
  });
  $("#annotation-detail-next").addEventListener("click", () => {
    stepAnnotation(1);
  });
  $("#annotation-detail-location").addEventListener("click", (e) => {
    e.preventDefault();
    if (activeAnnotationId) void openAnnotationEntry(activeAnnotationId);
  });
  void refreshAnnotations();

  return {
    applyInlineAnnotations,
    refreshAnnotations,
    handleSse,
    withSessionParam,
    restoreSessionFromUrl,
    openAnnotationEntry,
    setAnnotationPanelOpen,
    getActiveSessionEntries() {
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
