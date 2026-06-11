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

  function setAnnotationPanelOpen(open: boolean) {
    annotationPanel.hidden = !open;
    document.body.classList.toggle("annotation-panel-open", open);
    if (open) annotationPanelDismissed = false;
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
    if (!entry.line) return entry.path;
    return entry.line.start === entry.line.end
      ? `${entry.path}:${entry.line.start}`
      : `${entry.path}:${entry.line.start}-${entry.line.end}`;
  }

  function annotationRefForEntry(entry: AnnotationEntry): string {
    const to = entry.range.to || "worktree";
    return to === "worktree" || to === "" ? "worktree" : to;
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
    if (!session) return;
    for (const entry of session.entries) {
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

  function renderAnnotationPanel() {
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
    // Show the detail panel immediately — the navigation below can involve
    // loads and context expansion; the panel must not lag behind the click.
    showAnnotationDetail(session, entry, index);
    const from = entry.range.from || "HEAD";
    const to = entry.range.to || "worktree";
    const range = { from, to };
    const current = deps.currentRange();
    const rangeChanged = current.from !== from || current.to !== to;
    const prevRoute = deps.getRoute();
    const line = annotationLineTarget(entry);

    deps.setRange(from, to);
    deps.syncRefInputs();
    deps.cancelActiveSourceLoad("navigation");
    deps.setRoute({ screen: "diff", range, path: entry.path, line });
    deps.setPageMode();
    // Reload the diff only when the rendered cards cannot be reused: a full
    // load() tears down and rebuilds every file card, which is the heaviest
    // re-render an entry click can trigger.
    const hasDiffCards = !!document.querySelector(
      ".gdp-file-shell:not(.gdp-standalone-source)",
    );
    if (rangeChanged || !deps.getFiles().length || !hasDiffCards) {
      deps.removeStandaloneSource();
      await deps.load();
      if (stale()) return;
    }

    if (deps.getFiles().some((f) => f.path === entry.path)) {
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
        true,
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
    if (!activeAnnotationId) return;
    const found = findAnnotation(activeAnnotationId);
    if (!found) return;
    const next = found.session.entries[found.index + direction];
    if (next) void openAnnotationEntry(next.id);
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

  $("#annotations-toggle").addEventListener("click", () => {
    setAnnotationPanelOpen(annotationPanel.hidden);
    if (!annotationPanel.hidden) void refreshAnnotations();
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
  };
}
