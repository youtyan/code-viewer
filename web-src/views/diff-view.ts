// Diff view: per-file lazy rendering pipeline (queue + IntersectionObserver),
// diff2html mounting, viewed-state, scroll spy, route line focus with
// re-anchoring, idle syntax highlight, and the diff meta header.
// Extracted from app.ts.

import { summarizeDiffFileKinds } from "../core/diff-file-kinds";
import { filePathClipboardText } from "../core/file-path-copy";
import {
  CHEVRON_DOWN_16_PATH,
  COLLAPSE_ALL_16_PATHS,
  COPY_16_PATHS,
  EXPAND_ALL_16_PATHS,
  iconSvg,
} from "../core/icons";
import type { AppRoute, SourceLineTarget } from "../core/routes";
import { isPreviewableSource } from "../core/source-meta";
import type {
  DiffCardElement,
  DiffMeta,
  FileDiffResponse,
  FileMeta,
  HljsApi,
  SidebarItem,
} from "../core/types";
import { suppressWhitespaceOnlyInlineHighlights } from "../core/ws-highlight";
import { diffRowAfterLineNumber } from "./diff-line-select";
import type { ExpandStackElement } from "./hunk-expand";
import { enhanceMediaCard } from "./media-embed";

export type DiffViewDeps = {
  STATE: {
    route: AppRoute;
    files: FileMeta[];
    layout: string;
    ignoreWs: boolean;
    syntaxHighlight: boolean;
    collapsed: boolean;
    viewedFiles: Set<string>;
  };
  setRoute(route: AppRoute, replace?: boolean): void;
  currentRange(): { from: string; to: string };
  escapeHtml(s: unknown): string;
  trackLoad: <T>(promise: Promise<T>) => Promise<T>;
  diffCardSelector(path: string): string;
  getHljs(): HljsApi | null;
  inferLang(path: string): string | null;
  lineTargetStart(line: SourceLineTarget | undefined): number | null;
  fileSourceTarget(file: FileMeta): { path: string; ref: string };
  applySourceRouteToShell(): void;
  setupHunkExpand(card: DiffCardElement, file: FileMeta): void;
  applyInlineAnnotations(): void;
  applyFilter(): void;
  markActive(path: string, options?: { reveal?: boolean }): void;
  renderSidebar(files: SidebarItem[], onFileClick?: unknown): void;
  isRepositorySidebarMode(): boolean;
  loadRepo(): Promise<void>;
  repoRoute(ref: string, path: string): AppRoute;
  setProjectName(project: string): void;
  getProjectName(): string;
  createOpenPathButton(
    path: string,
    kind: "directory" | "file-parent",
    title?: string,
  ): HTMLElement;
  persistViewedFiles(path: string, viewed: boolean): void;
  applyHideTests(): void;
  getServerGeneration(): number;
  setServerGeneration(generation: number): void;
  invalidateRepoSidebar(): void;
  diffText(): DiffViewText;
  $: <T extends Element = HTMLElement>(sel: string) => T;
  $$: <T extends Element = HTMLElement>(sel: string) => T[];
  getDiffRoot?(): HTMLElement;
  getEmptyPane?(): HTMLElement;
  isEmbeddedDiffMode?(): boolean;
};

export type DiffViewText = {
  files(count: number): string;
  updated(time: string): string;
  updatedTitle: string;
  kindAdded: string;
  kindDeleted: string;
  kindRenamed: string;
  kindHeavy: string;
  kindBinary: string;
  kindMedia: string;
  viewedProgress(viewed: number, total: number): string;
  viewedProgressTitle: string;
  nextUnviewed: string;
  nextUnviewedTitle: string;
  allViewed: string;
  allViewedTitle: string;
};

type LoadQueueItem = {
  file: FileMeta;
  card: DiffCardElement;
  priority: number;
  epoch: number;
};

export type RenderResult = {
  structureChanged: boolean;
  invalidatedCards: number;
  preservedDom: boolean;
};

type ScrollSpyHandler = EventListener & { _raf?: number | null };

export function isDiffShellDomIntact(
  target: Element,
  expectedKeys: string[],
): boolean {
  const children = Array.from(target.children);
  if (children.length !== expectedKeys.length) return false;
  return children.every((child, index) => {
    if (!child.classList.contains("gdp-file-shell")) return false;
    return (child as HTMLElement).dataset.key === expectedKeys[index];
  });
}

export function shouldRenderDiffSidebar(listSame: boolean, domIntact: boolean) {
  return !listSame || !domIntact;
}

function collectDiffCardsByKey(target: Element): Map<string, DiffCardElement> {
  const cards = new Map<string, DiffCardElement>();
  for (const child of Array.from(target.children)) {
    if (!child.classList.contains("gdp-file-shell")) continue;
    const card = child as DiffCardElement;
    if (card.dataset.key) cards.set(card.dataset.key, card);
  }
  return cards;
}

export function createDiffView(deps: DiffViewDeps) {
  const {
    $,
    $$,
    STATE,
    setRoute,
    currentRange,
    escapeHtml,
    trackLoad,
    diffCardSelector,
    getHljs,
    inferLang,
    lineTargetStart,
    fileSourceTarget,
    applySourceRouteToShell,
    setupHunkExpand,
    applyInlineAnnotations,
    applyFilter,
    markActive,
    renderSidebar,
    isRepositorySidebarMode,
    loadRepo,
    repoRoute,
    setProjectName,
    getProjectName,
    createOpenPathButton,
    persistViewedFiles,
    applyHideTests,
    getServerGeneration,
    setServerGeneration,
    invalidateRepoSidebar,
    diffText,
    getDiffRoot,
    getEmptyPane,
    isEmbeddedDiffMode,
  } = deps;

  function rerenderLoadedDiffs() {
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

  function shouldSyncSourceRouteToShell(): boolean {
    return STATE.route.screen === "file" && STATE.route.view !== "history";
  }

  function syncSourceRouteToShell(): void {
    if (shouldSyncSourceRouteToShell()) applySourceRouteToShell();
  }

  function fileBadge(status?: string) {
    const ch = (status || "M")[0].toUpperCase();
    const span = document.createElement("span");
    span.className = `badge ${ch}`;
    span.textContent = ch;
    span.title =
      { M: "modified", A: "added", D: "deleted", R: "renamed" }[ch] || ch;
    return span;
  }

  function setFileViewed(path: string, viewed: boolean) {
    if (viewed) STATE.viewedFiles.add(path);
    else STATE.viewedFiles.delete(path);
    persistViewedFiles(path, viewed);
    applyViewedState();
    $$<HTMLElement>(diffCardSelector(path)).forEach((card) => {
      applyViewedToCard(card, viewed, true);
    });
  }

  function syncViewedCardDisplay(card: HTMLElement, viewed: boolean) {
    card.classList.toggle("viewed", viewed);
    card
      .querySelectorAll<HTMLInputElement>(".d2h-file-collapse-input")
      .forEach((checkbox) => {
        checkbox.checked = viewed;
      });
  }

  function applyViewedToCard(
    card: HTMLElement,
    viewed: boolean,
    collapseLoaded = false,
  ) {
    syncViewedCardDisplay(card, viewed);
    if (collapseLoaded && card.classList.contains("loaded")) {
      setFileCollapsed(card as DiffCardElement, viewed);
    }
  }

  function setUnfoldButtonState(
    button: HTMLButtonElement | null,
    expanded: boolean,
  ) {
    if (!button) return;
    button.setAttribute("aria-pressed", expanded ? "true" : "false");
    const label = expanded ? "Collapse expanded lines" : "Expand all lines";
    button.title = label;
    button.setAttribute("aria-label", label);
    button.innerHTML = expanded
      ? iconSvg("octicon-fold", COLLAPSE_ALL_16_PATHS)
      : iconSvg("octicon-unfold", EXPAND_ALL_16_PATHS);
  }

  function setProjectBranch(branch: string) {
    const el = document.querySelector<HTMLElement>("#project-branch");
    if (!el) return;
    el.hidden = !branch;
    // Keep the static icon markup intact; only the name text changes.
    const name = el.querySelector<HTMLElement>(".project-branch-name");
    if (name) name.textContent = branch;
    el.title = branch ? `Current branch: ${branch}` : "";
  }

  let metaFilesForViewedProgress: FileMeta[] = [];

  function viewedProgressFor(files: FileMeta[]) {
    const total = files.length;
    const viewed = files.filter((file) =>
      STATE.viewedFiles.has(file.path),
    ).length;
    return { viewed, total };
  }

  function applyViewedProgressChipState(
    chip: HTMLElement,
    viewed: number,
    total: number,
  ) {
    chip.textContent = diffText().viewedProgress(viewed, total);
    chip.classList.toggle("chip-viewed-empty", viewed === 0);
    chip.classList.toggle("chip-viewed-partial", viewed > 0 && viewed < total);
    chip.classList.toggle("chip-viewed-done", total > 0 && viewed === total);
  }

  function syncViewedProgressChip() {
    const chip = document.querySelector<HTMLElement>("#meta .chip-viewed");
    if (chip) {
      const { viewed, total } = viewedProgressFor(metaFilesForViewedProgress);
      if (total <= 0) chip.remove();
      else applyViewedProgressChipState(chip, viewed, total);
    }
    syncNextUnviewedButton();
  }

  function applyNextUnviewedButtonState(
    button: HTMLButtonElement,
    hasUnviewed: boolean,
  ) {
    const text = diffText();
    button.disabled = !hasUnviewed;
    button.textContent = hasUnviewed ? text.nextUnviewed : text.allViewed;
    button.title = hasUnviewed ? text.nextUnviewedTitle : text.allViewedTitle;
  }

  function syncNextUnviewedButton() {
    const button = document.querySelector<HTMLButtonElement>(
      "#meta .chip-next-unviewed",
    );
    if (!button) return;
    const { total } = viewedProgressFor(metaFilesForViewedProgress);
    if (total <= 0) {
      button.remove();
      return;
    }
    // DOM-derived (not just totals) so a live search filter that hides every
    // remaining unviewed row correctly disables the button too. Safe here:
    // this only runs from applyViewedState(), which itself already requires
    // #filelist li rows to exist (renderShell renders the sidebar before
    // calling applyViewedState - see the ordering note on renderMeta above).
    applyNextUnviewedButtonState(button, nextUnviewedFilePath() !== null);
  }

  // Next unviewed file lookup walks the same "currently visible" sidebar
  // rows sidebar-next/sidebar-previous use (app.ts), so it automatically
  // respects the live search filter and hide-tests state without needing
  // its own copy of that filtering logic. A row counts as viewed if either
  // STATE.viewedFiles or its own DOM ".viewed" class says so - the DOM class
  // is what the user actually sees, so it wins if the two ever disagree.
  function nextUnviewedFilePath(): string | null {
    if (isRepositorySidebarMode()) return null;
    const items = $$<HTMLElement>(
      "#filelist li[data-path]:not(.hidden):not(.hidden-by-tests)",
    );
    if (items.length === 0) return null;
    const currentIndex = items.findIndex((li) =>
      li.classList.contains("active"),
    );
    for (let offset = 1; offset <= items.length; offset++) {
      const idx = (currentIndex + offset + items.length) % items.length;
      const li = items[idx];
      const path = li.dataset.path || "";
      const viewed =
        STATE.viewedFiles.has(path) || li.classList.contains("viewed");
      if (path && !viewed) return path;
    }
    return null;
  }

  function scrollToNextUnviewedFile(): boolean {
    const path = nextUnviewedFilePath();
    if (!path) return false;
    scrollToFile(path, undefined, { reveal: true });
    return true;
  }

  function renderMeta(meta: DiffMeta | null) {
    const el = $("#meta");
    if (!meta) {
      el.textContent = "";
      metaFilesForViewedProgress = [];
      return;
    }
    setProjectName(meta.project || "");
    setProjectBranch(meta.branch || "");
    metaFilesForViewedProgress = meta.files || [];
    el.innerHTML = "";
    const text = diffText();
    if (meta.error) {
      const error = document.createElement("span");
      error.className = "chip chip-error";
      error.textContent = meta.error;
      el.appendChild(error);
    }
    if (meta.totals) {
      const files = document.createElement("span");
      files.className = "chip chip-files";
      files.textContent = text.files(meta.totals.files);
      el.appendChild(files);
      const add = document.createElement("span");
      add.className = "chip chip-add";
      add.textContent = `+${meta.totals.additions}`;
      el.appendChild(add);
      const del = document.createElement("span");
      del.className = "chip chip-del";
      del.textContent = `−${meta.totals.deletions}`;
      el.appendChild(del);
    }
    const kinds = summarizeDiffFileKinds(meta.files);
    const kindChip = (className: string, label: string, count: number) => {
      if (count <= 0) return;
      const chip = document.createElement("span");
      chip.className = `chip ${className}`;
      chip.textContent = `${count} ${label}`;
      el.appendChild(chip);
    };
    kindChip("chip-added", text.kindAdded, kinds.added);
    kindChip("chip-deleted", text.kindDeleted, kinds.deleted);
    kindChip("chip-renamed", text.kindRenamed, kinds.renamed);
    kindChip("chip-heavy", text.kindHeavy, kinds.heavy);
    kindChip("chip-binary", text.kindBinary, kinds.binary);
    kindChip("chip-media", text.kindMedia, kinds.media);
    const viewedProgress = viewedProgressFor(metaFilesForViewedProgress);
    if (viewedProgress.total > 0) {
      const viewed = document.createElement("span");
      viewed.className = "chip chip-viewed";
      viewed.title = text.viewedProgressTitle;
      applyViewedProgressChipState(
        viewed,
        viewedProgress.viewed,
        viewedProgress.total,
      );
      el.appendChild(viewed);
      const nextUnviewed = document.createElement("button");
      nextUnviewed.type = "button";
      nextUnviewed.className = "chip chip-next-unviewed";
      // renderShell() calls renderMeta() before renderSidebar(), so #filelist
      // rows for this file list do not exist yet - approximate with totals
      // here. syncNextUnviewedButton() (run after applyViewedState(), always
      // after renderSidebar()) refines this with the DOM-aware check.
      applyNextUnviewedButtonState(
        nextUnviewed,
        viewedProgress.viewed < viewedProgress.total,
      );
      nextUnviewed.addEventListener("click", () => {
        scrollToNextUnviewedFile();
      });
      el.appendChild(nextUnviewed);
    }
    const u = document.createElement("span");
    u.className = "chip chip-updated";
    u.title = text.updatedTitle;
    u.textContent = text.updated(
      new Date().toLocaleTimeString([], { hour12: false }),
    );
    el.appendChild(u);
  }

  let SUPPRESS_SPY_UNTIL = 0;

  function prefetchByPath(path: string) {
    const card = document.querySelector<DiffCardElement>(
      diffCardSelector(path),
    );
    if (!card?.classList.contains("pending")) return;
    const f = card._file || STATE.files.find((x) => x.path === path);
    if (!f) return;
    enqueueLoad(f, card, 5);
  }

  function clearDiffLineFocus() {
    document
      .querySelectorAll<HTMLElement>(".gdp-diff-line-target")
      .forEach((row) => {
        row.classList.remove("gdp-diff-line-target");
      });
  }

  function diffRowLineNumber(row: HTMLTableRowElement): number | null {
    return diffRowAfterLineNumber(row);
  }

  function focusDiffLine(
    card: HTMLElement,
    line: SourceLineTarget | undefined,
  ) {
    const start = lineTargetStart(line);
    if (!start) return false;
    const end = typeof line === "object" ? line.end : start;
    const rows = Array.from(
      card.querySelectorAll<HTMLTableRowElement>("table.d2h-diff-table tr"),
    );
    const targetRows = rows.filter((candidate) => {
      const rowLine = diffRowLineNumber(candidate);
      return rowLine !== null && rowLine >= start && rowLine <= end;
    });
    const targetLines = new Set(
      targetRows
        .map((candidate) => diffRowLineNumber(candidate))
        .filter((value): value is number => value !== null),
    );
    // Ranges are all-or-nothing here: partial after-side matches can point a
    // stale annotation URL at unrelated current lines after deletions.
    for (let lineNo = start; lineNo <= end; lineNo++) {
      if (!targetLines.has(lineNo)) return false;
    }
    const firstRow = targetRows[0];
    if (!firstRow) return false;
    clearDiffLineFocus();
    targetRows.forEach((row) => {
      row.classList.add("gdp-diff-line-target");
    });
    scrollDiffElementIntoView(firstRow, "center");
    return true;
  }

  function scrollDiffElementIntoView(
    element: HTMLElement,
    block: ScrollLogicalPosition,
  ) {
    element.scrollIntoView({ behavior: "auto", block });
  }

  function applyDiffRouteFocus(card?: HTMLElement) {
    if (STATE.route.screen !== "diff" || !STATE.route.path || !STATE.route.line)
      return false;
    if (card && card.dataset.path !== STATE.route.path) return false;
    const targetCard =
      card ||
      document.querySelector<DiffCardElement>(
        diffCardSelector(STATE.route.path),
      );
    if (!targetCard) return false;
    return focusDiffLine(targetCard, STATE.route.line);
  }

  let REANCHOR_UNTIL =
    STATE.route.screen === "diff" && STATE.route.line
      ? performance.now() + 6000
      : 0;

  window.addEventListener(
    "wheel",
    () => {
      REANCHOR_UNTIL = 0;
    },
    { passive: true },
  );

  window.addEventListener(
    "touchmove",
    () => {
      REANCHOR_UNTIL = 0;
    },
    { passive: true },
  );

  function scrollToFile(
    path: string,
    line?: SourceLineTarget,
    options?: { reveal?: boolean },
  ) {
    const card = document.querySelector<DiffCardElement>(
      diffCardSelector(path),
    );
    if (!card) return;
    if (line) REANCHOR_UNTIL = performance.now() + 4000;
    markActive(path, { reveal: options?.reveal });
    SUPPRESS_SPY_UNTIL = performance.now() + 1500;
    const onEnd = () => {
      SUPPRESS_SPY_UNTIL = 0;
      window.removeEventListener("scrollend", onEnd);
    };
    window.addEventListener("scrollend", onEnd, { once: true });
    // Priority-load if still pending
    if (card.classList.contains("pending")) {
      const f = card._file || STATE.files.find((x) => x.path === path);
      if (f) enqueueLoad(f, card, 10);
    }
    if (!line || !focusDiffLine(card, line)) {
      scrollDiffElementIntoView(card, "start");
    }
  }

  function applyViewedState() {
    if (isRepositorySidebarMode()) return;
    $$<HTMLElement>("#filelist li[data-path]").forEach((li) => {
      const path = li.dataset.path || "";
      li.classList.toggle("viewed", STATE.viewedFiles.has(path));
    });
    $$<HTMLElement>(".gdp-file-shell[data-path]").forEach((card) => {
      const path = card.dataset.path || "";
      const viewed = STATE.viewedFiles.has(path);
      syncViewedCardDisplay(card, viewed);
    });
    syncViewedProgressChip();
  }

  let CLIENT_REQ_SEQ = 0;

  const LOAD_QUEUE: LoadQueueItem[] = [];

  let ACTIVE_LOADS = 0;
  let LOAD_EPOCH = 0;

  const MAX_PARALLEL = 2;

  let lazyObserver: IntersectionObserver | null = null;
  let scrollSpyInstalled = false;
  let prevListSignature = "";
  let prevCardSignatures = new Map<string, string>();

  function resetLoadScheduling() {
    LOAD_EPOCH++;
    LOAD_QUEUE.length = 0;
    ACTIVE_LOADS = 0;
  }

  function fileKey(f: FileMeta): string {
    return f.key || f.path;
  }

  function computeListSignature(files: FileMeta[]): string {
    return files
      .map(
        (f) =>
          `${fileKey(f)}\0${f.path}\0${f.old_path || ""}\0${f.status || "M"}`,
      )
      .join("\n");
  }

  function computeCardSignature(f: FileMeta): string {
    return [
      fileKey(f),
      f.status || "M",
      f.additions || 0,
      f.deletions || 0,
      f.binary ? 1 : 0,
      f.media_kind || "",
      f.size_class || "small",
      f.force_layout || "",
      f.highlight ? 1 : 0,
      f.load_url,
      f.preview_url || "",
      f.estimated_height_px || 0,
      f.untracked ? 1 : 0,
    ].join("\0");
  }

  function ensureLazyObserver(): IntersectionObserver {
    if (!lazyObserver) {
      lazyObserver = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            const card = entry.target as DiffCardElement;
            if (
              card.classList.contains("loaded") ||
              card.classList.contains("loading")
            )
              continue;
            const f =
              card._file ||
              STATE.files.find((x) => x.path === card.dataset.path);
            if (f) enqueueLoad(f, card, 0);
          }
        },
        { rootMargin: "1200px 0px 1600px 0px" },
      );
    }
    return lazyObserver;
  }

  function activatePendingCard(card: DiffCardElement, file: FileMeta) {
    ensureLazyObserver().observe(card);
    const rect = card.getBoundingClientRect();
    if (rect.top <= window.innerHeight + 1600) {
      enqueueLoad(file, card, 0);
    }
  }

  function invalidateLoadedCard(
    card: DiffCardElement,
    file: FileMeta,
    changedPaths: Set<string> | null,
    measuredHeight?: number,
  ): boolean {
    if (
      !card.classList.contains("loaded") &&
      !card.classList.contains("loading")
    )
      return false;
    if (changedPaths && !changedPaths.has(file.path)) return false;
    card.dataset.reqId = String(++CLIENT_REQ_SEQ);
    // Stale-while-revalidate: keep the previous diff visible (dimmed by the
    // .pending style) while the fresh content loads. Wiping the body here
    // collapsed every loaded card into a spinner on each SSE tick, which
    // made the whole page jump. renderFile() rebuilds the body on arrival;
    // the height reservation stops the card from collapsing in between.
    card.style.minHeight = `${measuredHeight ?? card.offsetHeight}px`;
    card.classList.remove("loaded", "loading", "error");
    card.classList.add("pending");
    card._diffData = null;
    const indicator = card.querySelector<HTMLElement>(".loading-indicator");
    if (indicator) indicator.hidden = false;
    activatePendingCard(card, file);
    return true;
  }

  function updateSidebarStats(files: FileMeta[]) {
    for (const f of files) {
      const li = document.querySelector<HTMLElement>(
        `#filelist li[data-path="${CSS.escape(f.path)}"]`,
      );
      if (!li) continue;
      const badge = li.querySelector<HTMLElement>(".badge");
      if (badge) {
        const ch = (f.status || "M")[0].toUpperCase();
        if (badge.textContent !== ch) {
          badge.textContent = ch;
          badge.className = `badge ${ch}`;
        }
      }
    }
  }

  function resetReusableCard(card: DiffCardElement, file: FileMeta) {
    card.classList.remove("loaded", "loading", "error", "manual-load");
    card.classList.add("pending");
    card.replaceChildren();
    const tmp = createPlaceholder(file);
    while (tmp.firstChild) card.appendChild(tmp.firstChild);
    card.dataset.path = file.path;
    card.dataset.key = fileKey(file);
    card.dataset.sizeClass = file.size_class || "small";
    card.dataset.status = file.status || "M";
    card.dataset.reqId = String(++CLIENT_REQ_SEQ);
    delete card.dataset.manualRendered;
    delete card.dataset.manualLoad;
    delete card.dataset.manualMode;
    card.style.minHeight = `${file.estimated_height_px || 80}px`;
    card._diffData = null;
    card._file = file;
  }

  function renderShell(
    meta: DiffMeta,
    changedPaths?: Set<string> | null,
  ): RenderResult {
    const newFiles = meta.files || [];
    const newListSig = computeListSignature(newFiles);
    const listSame =
      newListSig === prevListSignature && prevListSignature !== "";

    STATE.files = newFiles;
    const canUpdateSidebar = !isEmbeddedDiffMode?.();
    if (canUpdateSidebar) invalidateRepoSidebar();
    setServerGeneration(meta.generation || 0);
    window._lastMeta = meta;
    renderMeta(meta);

    const target = getDiffRoot?.() || $("#diff");
    const empty = getEmptyPane?.() || $("#empty");
    const expectedKeys = newFiles.map(fileKey);
    const domIntact = isDiffShellDomIntact(target, expectedKeys);
    const sidebarNeedsRender = shouldRenderDiffSidebar(listSame, domIntact);
    if (!newFiles.length) {
      prevListSignature = newListSig;
      prevCardSignatures.clear();
      if (sidebarNeedsRender && canUpdateSidebar) renderSidebar(newFiles);
      if (shouldSyncSourceRouteToShell()) {
        empty.classList.add("hidden");
        applySourceRouteToShell();
      } else {
        empty.classList.remove("hidden");
        target.replaceChildren();
      }
      resetLoadScheduling();
      return {
        structureChanged: sidebarNeedsRender,
        invalidatedCards: 0,
        preservedDom: listSame && domIntact,
      };
    }
    empty.classList.add("hidden");

    const newCardSigs = new Map<string, string>();
    for (const f of newFiles) {
      newCardSigs.set(fileKey(f), computeCardSignature(f));
    }
    const pathsUnknown = !changedPaths;
    const contentMayNeedReload =
      !listSame ||
      pathsUnknown ||
      (changedPaths
        ? newFiles.some((file) => {
            const key = fileKey(file);
            return (
              prevCardSignatures.get(key) !== newCardSigs.get(key) ||
              changedPaths.has(file.path)
            );
          })
        : false);
    if (contentMayNeedReload) resetLoadScheduling();

    let invalidatedCards = 0;

    if (listSame && domIntact) {
      // Fast path: file list structure unchanged — skip replaceChildren and renderSidebar.
      // changedPaths === null means unknown (e.g. tick, parse failure, truncated paths)
      // so treat all loaded cards as potentially stale.
      const pathsUnknown = !changedPaths;
      // Index the cards once — a per-file linear scan from both loops below
      // is O(n²) on large diffs.
      const cardsByKey = collectDiffCardsByKey(target);
      // Read all card heights up front: interleaving offsetHeight reads with
      // the class/minHeight writes below would force one synchronous reflow
      // per invalidated card.
      const measuredHeights = new Map<string, number>();
      for (const f of newFiles) {
        const key = fileKey(f);
        const card = cardsByKey.get(key);
        if (
          card &&
          (card.classList.contains("loaded") ||
            card.classList.contains("loading"))
        )
          measuredHeights.set(key, card.offsetHeight);
      }
      let sidebarNeedsStatsUpdate = false;
      for (const f of newFiles) {
        const key = fileKey(f);
        const oldSig = prevCardSignatures.get(key);
        const newSig = newCardSigs.get(key) ?? computeCardSignature(f);
        const sigChanged = oldSig !== newSig;
        const pathHint = pathsUnknown || changedPaths.has(f.path);
        if (!sigChanged && !pathHint) {
          continue;
        }
        const card = cardsByKey.get(key);
        if (!card) continue;
        const sizeChanged =
          card.dataset.sizeClass !== (f.size_class || "small");
        const statusChanged = card.dataset.status !== (f.status || "M");
        if (sizeChanged || statusChanged) {
          resetReusableCard(card, f);
          activatePendingCard(card, f);
          invalidatedCards++;
          sidebarNeedsStatsUpdate = true;
        } else {
          const stats = card.querySelector(".gdp-shell-header .stats");
          if (stats) {
            stats.innerHTML =
              '<span class="a">+' +
              (f.additions || 0) +
              "</span>" +
              '<span class="d">−' +
              (f.deletions || 0) +
              "</span>";
          }
          card._file = f;
          const didInvalidate = sigChanged
            ? invalidateLoadedCard(card, f, null, measuredHeights.get(key))
            : invalidateLoadedCard(
                card,
                f,
                changedPaths,
                measuredHeights.get(key),
              );
          if (didInvalidate) invalidatedCards++;
          else if (
            (sigChanged || pathHint) &&
            card.classList.contains("pending")
          ) {
            activatePendingCard(card, f);
          }
          if (sigChanged) sidebarNeedsStatsUpdate = true;
        }
      }
      if (sidebarNeedsStatsUpdate && canUpdateSidebar)
        updateSidebarStats(newFiles);
      prevCardSignatures = newCardSigs;
      prevListSignature = newListSig;
      syncSourceRouteToShell();
      if (!scrollSpyInstalled) {
        setupScrollSpy();
        scrollSpyInstalled = true;
      }
      // renderMeta() above already rebuilt #meta from raw totals (see the
      // note in renderMeta), ignoring any live sidebar filter. #filelist
      // rows are untouched on this path, so re-check them here instead of
      // the full applyViewedState() sweep.
      syncViewedProgressChip();
      return {
        structureChanged: false,
        invalidatedCards,
        preservedDom: invalidatedCards === 0,
      };
    }

    // Full path: file list structure changed
    if (sidebarNeedsRender && canUpdateSidebar) renderSidebar(newFiles);

    const oldByKey = collectDiffCardsByKey(target);

    const ordered: DiffCardElement[] = [];
    for (const f of newFiles) {
      const key = fileKey(f);
      const old = oldByKey.get(key);
      if (old) {
        oldByKey.delete(key);
        const sizeChanged = old.dataset.sizeClass !== (f.size_class || "small");
        const statusChanged = old.dataset.status !== (f.status || "M");
        const oldSig = prevCardSignatures.get(key);
        const newSig = newCardSigs.get(key) ?? computeCardSignature(f);
        const sigChanged = oldSig !== newSig;
        if (sizeChanged || statusChanged || sigChanged) {
          resetReusableCard(old, f);
          invalidatedCards++;
        } else {
          const stats = old.querySelector(".gdp-shell-header .stats");
          if (stats) {
            stats.innerHTML =
              '<span class="a">+' +
              (f.additions || 0) +
              "</span>" +
              '<span class="d">−' +
              (f.deletions || 0) +
              "</span>";
          }
          old._file = f;
        }
        ordered.push(old);
      } else {
        ordered.push(createPlaceholder(f));
        invalidatedCards++;
      }
    }

    oldByKey.forEach((c) => {
      c.remove();
    });

    target.replaceChildren(...ordered);

    for (let i = LOAD_QUEUE.length - 1; i >= 0; i--) {
      if (!LOAD_QUEUE[i].card.isConnected) LOAD_QUEUE.splice(i, 1);
    }

    prevCardSignatures = newCardSigs;
    prevListSignature = newListSig;

    setupLazyObserver();
    enqueueInitialLoads();
    syncSourceRouteToShell();
    setupScrollSpy();
    scrollSpyInstalled = true;
    if (typeof applyHideTests === "function") applyHideTests();
    applyFilter();
    applyViewedState();
    return { structureChanged: true, invalidatedCards, preservedDom: false };
  }

  function createPlaceholder(f: FileMeta): DiffCardElement {
    const card = document.createElement("div") as DiffCardElement;
    card.className = "gdp-file-shell pending";
    card.dataset.path = f.path;
    card.dataset.key = f.key || f.path;
    card.dataset.sizeClass = f.size_class || "small";
    card.dataset.status = f.status || "M";
    card._file = f;
    card.classList.toggle("viewed", STATE.viewedFiles.has(f.path));
    if (f.estimated_height_px) {
      card.style.minHeight = `${f.estimated_height_px}px`;
    }

    const head = document.createElement("div");
    head.className = "gdp-shell-header";
    head.innerHTML =
      '<span class="status-pill ' +
      escapeHtml(f.status || "M") +
      '">' +
      escapeHtml(f.status || "M") +
      "</span>" +
      '<span class="path">' +
      escapeHtml(f.display_path || f.path) +
      "</span>" +
      '<span class="stats">' +
      '<span class="a">+' +
      (f.additions || 0) +
      "</span>" +
      '<span class="d">−' +
      (f.deletions || 0) +
      "</span>" +
      "</span>" +
      '<span class="size-tag ' +
      escapeHtml(f.size_class || "") +
      '">' +
      escapeHtml(f.size_class || "") +
      "</span>" +
      '<span class="loading-indicator" hidden>loading…</span>';
    card.appendChild(head);

    const body = document.createElement("div");
    body.className = "gdp-shell-body";
    card.appendChild(body);

    return card;
  }

  function setupLazyObserver() {
    if (lazyObserver) lazyObserver.disconnect();
    lazyObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const card = entry.target as DiffCardElement;
          if (
            card.classList.contains("loaded") ||
            card.classList.contains("loading")
          )
            return;
          const f =
            card._file || STATE.files.find((x) => x.path === card.dataset.path);
          if (!f) return;
          enqueueLoad(f, card, 0);
        });
      },
      { rootMargin: "1200px 0px 1600px 0px" },
    );
    document
      .querySelectorAll<DiffCardElement>(".gdp-file-shell.pending")
      .forEach((c) => {
        lazyObserver.observe(c);
      });
  }

  function enqueueInitialLoads() {
    const viewportBottom = window.innerHeight + 1600;
    document
      .querySelectorAll<DiffCardElement>(".gdp-file-shell.pending")
      .forEach((card) => {
        const rect = card.getBoundingClientRect();
        if (rect.top > viewportBottom) return;
        const f =
          card._file || STATE.files.find((x) => x.path === card.dataset.path);
        if (f) enqueueLoad(f, card, 0);
      });
  }

  function enqueueLoad(
    file: FileMeta,
    card: DiffCardElement,
    priority?: number,
  ) {
    if (manualLoadReason(file) && card.dataset.manualLoad !== "1") {
      renderManualLoadPlaceholder(card, file);
      return;
    }
    if (
      LOAD_QUEUE.find((item) => item.card === card && item.epoch === LOAD_EPOCH)
    )
      return;
    LOAD_QUEUE.push({
      file,
      card,
      priority: priority || 0,
      epoch: LOAD_EPOCH,
    });
    LOAD_QUEUE.sort((a, b) => b.priority - a.priority);
    pumpQueue();
  }

  function pumpQueue() {
    while (ACTIVE_LOADS < MAX_PARALLEL && LOAD_QUEUE.length) {
      const item = LOAD_QUEUE.shift();
      if (item.epoch !== LOAD_EPOCH) continue;
      if (
        item.card.classList.contains("loaded") ||
        item.card.classList.contains("loading")
      )
        continue;
      ACTIVE_LOADS++;
      loadFile(item.file, item.card).finally(() => {
        if (item.epoch === LOAD_EPOCH) {
          ACTIVE_LOADS = Math.max(0, ACTIVE_LOADS - 1);
        }
        pumpQueue();
      });
    }
  }

  function manualLoadReason(file: FileMeta): string | null {
    const path = file.path || "";
    if (file.size_class === "huge") return "huge diff";
    if (/\.(min|bundle)\.(js|mjs|css)$/i.test(path))
      return "minified or bundled file";
    if (/\.map$/i.test(path)) return "source map";
    if (/(^|\/)(vendor|node_modules|dist|build|out)\//i.test(path))
      return "generated or vendored path";
    return null;
  }

  function renderManualLoadPlaceholder(card: DiffCardElement, file: FileMeta) {
    if (card.dataset.manualRendered === "1") return;
    card.dataset.manualRendered = "1";
    card.classList.remove("loading");
    card.classList.add("pending", "manual-load");
    if (lazyObserver) lazyObserver.unobserve(card);
    const indicator = card.querySelector<HTMLElement>(".loading-indicator");
    if (indicator) indicator.hidden = true;
    const body = card.querySelector<HTMLElement>(".gdp-shell-body");
    if (!body) return;
    body.innerHTML = "";

    const wrap = document.createElement("div");
    wrap.className = "gdp-manual-load";

    const note = document.createElement("div");
    note.className = "gdp-manual-note";
    note.textContent = `${manualLoadReason(file)} - click to load diff`;

    const previewBtn = document.createElement("button");
    previewBtn.className = "gdp-show-full";
    previewBtn.textContent = "Load preview";
    previewBtn.addEventListener("click", () => {
      body.innerHTML = "";
      card.dataset.manualLoad = "1";
      card.dataset.manualMode = "preview";
      card.classList.remove("manual-load");
      loadFile(file, card, buildPreviewUrl(file, 3));
    });

    const openFileBtn = document.createElement("button");
    openFileBtn.className = "gdp-show-full";
    openFileBtn.textContent = "Open as file";
    openFileBtn.title = "Open this file in the virtualized source viewer";
    openFileBtn.addEventListener("click", () => {
      const target = fileSourceTarget(file);
      setRoute({
        screen: "file",
        path: target.path,
        ref: target.ref,
        range: currentRange(),
      });
      applySourceRouteToShell();
    });

    const fullBtn = document.createElement("button");
    fullBtn.className = "gdp-show-full secondary";
    fullBtn.textContent = "Load full diff";
    fullBtn.title =
      "Render the full diff with Diff2Html. This can be slow for large files.";
    fullBtn.addEventListener("click", () => {
      body.innerHTML = "";
      card.dataset.manualLoad = "1";
      card.dataset.manualMode = "full";
      card.classList.remove("manual-load");
      loadFile(file, card, file.load_url);
    });

    wrap.appendChild(note);
    if (file.status === "A") wrap.appendChild(openFileBtn);
    wrap.appendChild(previewBtn);
    wrap.appendChild(fullBtn);
    body.appendChild(wrap);
  }

  function nextIdle(timeout = 500): Promise<void> {
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve();
      };
      const ric = window.requestIdleCallback;
      if (typeof ric === "function") {
        ric(finish, { timeout });
      } else {
        requestAnimationFrame(finish);
        setTimeout(finish, 50);
      }
    });
  }

  function loadFile(
    file: FileMeta,
    card: DiffCardElement,
    urlOverride?: string,
    options?: { immediate?: boolean },
  ): Promise<void> {
    card.classList.remove("pending");
    card.classList.add("loading");
    if (lazyObserver) lazyObserver.unobserve(card);
    const indicator = card.querySelector<HTMLElement>(".loading-indicator");
    if (indicator) indicator.hidden = false;

    const url =
      urlOverride ||
      (card.dataset.manualMode === "full"
        ? file.load_url
        : file.preview_url || file.load_url);
    const myGen = getServerGeneration();
    const myReq = ++CLIENT_REQ_SEQ;
    card.dataset.reqId = String(myReq);

    const retryStale = () => {
      if (String(myReq) !== card.dataset.reqId) return;
      card.classList.remove("loading");
      card.classList.add("pending");
      if (indicator) indicator.hidden = true;
      const fresh =
        card._file || STATE.files.find((x) => x.path === card.dataset.path);
      if (fresh && card.isConnected) enqueueLoad(fresh, card, 0);
    };

    const request = trackLoad<FileDiffResponse>(
      fetch(url).then(async (r) => {
        if (!r.ok) throw new Error(await r.text());
        return r.json();
      }),
    )
      .then(async (data) => {
        if (String(myReq) !== card.dataset.reqId) return; // superseded by newer request
        if (myGen !== getServerGeneration()) {
          retryStale();
          return;
        } // generation rolled, retry
        if (data.generation && data.generation !== getServerGeneration()) {
          retryStale();
          return;
        }
        if (!options?.immediate) await nextIdle();
        if (String(myReq) !== card.dataset.reqId) return;
        renderFile(file, data, card);
      })
      .catch((error) => {
        if (String(myReq) !== card.dataset.reqId) return;
        console.error("[code-viewer] failed to load diff", error);
        card.classList.remove("loading");
        card.classList.add("error");
        // Drop the stale-while-revalidate height reservation: the error
        // panel replaces the old content, so the card must shrink to fit.
        card.style.minHeight = "";
        const body = card.querySelector<HTMLElement>(".gdp-shell-body");
        if (!body) return;
        body.innerHTML =
          '<div class="gdp-error">failed to load — <button class="retry">retry</button></div>';
        const btn = body.querySelector(".retry");
        if (btn)
          btn.addEventListener("click", () => {
            card.classList.remove("error");
            card.classList.add("pending");
            body.innerHTML = "";
            enqueueLoad(file, card, 1);
          });
      });
    const completed = request.finally(() => {
      if (card._loadPromise === completed) delete card._loadPromise;
    });
    card._loadPromise = completed;
    return completed;
  }

  async function loadDiffFile(path: string): Promise<boolean> {
    const root = getDiffRoot?.() || document;
    const card = root.querySelector<DiffCardElement>(diffCardSelector(path));
    if (!card || card.classList.contains("gdp-standalone-source")) return false;
    if (card.classList.contains("loaded")) return true;
    if (card.classList.contains("loading") && card._loadPromise) {
      await card._loadPromise;
      return card.classList.contains("loaded");
    }
    const file = card._file || STATE.files.find((x) => x.path === path);
    if (!file) return false;
    await loadFile(file, card, undefined, { immediate: true });
    return card.classList.contains("loaded");
  }

  function mountDiff(
    card: DiffCardElement,
    file: FileMeta,
    data: FileDiffResponse,
  ) {
    const head = card.querySelector<HTMLElement>(".gdp-shell-header");
    if (head) head.style.display = "none";
    const body = card.querySelector<HTMLElement>(".gdp-shell-body");
    if (!body) return;
    if (!data.diff?.trim()) {
      body.innerHTML = "";
      body.innerHTML = '<div class="gdp-info">No content</div>';
      return;
    }

    body.innerHTML = "";
    const layout = file.force_layout || STATE.layout;
    const hljsRef = getHljs();
    const ui = new window.Diff2HtmlUI(
      body,
      data.diff,
      {
        drawFileList: false,
        matching: "lines",
        outputFormat: layout,
        synchronisedScroll: true,
        highlight: false,
        fileListToggle: false,
        fileContentToggle: false,
      },
      hljsRef,
    );
    ui.draw();
    if (STATE.ignoreWs) suppressWhitespaceOnlyInlineHighlights(body);

    enhanceMediaCard(file, card);
    syncSideScrollCard(card);
    appendStatSquaresToHeader(card, file);
    setupHunkExpand(card, file);
  }

  function setFileCollapsed(card: DiffCardElement, collapsed: boolean) {
    card.classList.toggle("gdp-file-collapsed", collapsed);
    // 折りたたみ時は stale-while-revalidate の高さ予約を解除する。残すと
    // 再検証が終わるまで予約分の空箱が見え続ける。
    if (collapsed) card.style.minHeight = "";
    card
      .querySelectorAll<HTMLElement>(
        ".d2h-files-diff, .d2h-file-diff, .gdp-source-viewer, .gdp-media",
      )
      .forEach((body) => {
        body.classList.toggle("d2h-d-none", collapsed);
      });
    const button = card.querySelector<HTMLButtonElement>(".gdp-file-toggle");
    if (button) {
      button.setAttribute("aria-expanded", collapsed ? "false" : "true");
      const toggleLabel = collapsed ? "Expand file" : "Collapse file";
      button.title = toggleLabel;
      button.setAttribute("aria-label", toggleLabel);
    }
    const unfold = card.querySelector<HTMLButtonElement>(".gdp-file-unfold");
    if (unfold) unfold.disabled = collapsed;
    card
      .querySelectorAll<HTMLButtonElement>(".gdp-preview-file, .gdp-view-file")
      .forEach((button) => {
        button.disabled = collapsed;
      });
  }

  function setViewFileButtonState(
    button: HTMLButtonElement | null,
    sourceMode: boolean,
  ) {
    if (!button) return;
    button.classList.add("gdp-btn", "gdp-btn-sm");
    button.textContent = sourceMode ? "View Diff" : "View File";
    button.setAttribute("aria-pressed", sourceMode ? "true" : "false");
    button.title = sourceMode ? "View diff" : "View file";
  }

  function createFileBreadcrumb(path: string, ref?: string): HTMLElement {
    const nav = document.createElement("nav");
    nav.className = "gdp-file-breadcrumb";
    nav.setAttribute("aria-label", "File path");
    const parts = path.split("/").filter(Boolean);
    const allParts = getProjectName() ? [getProjectName(), ...parts] : parts;
    allParts.forEach((part, index) => {
      if (index > 0) {
        const sep = document.createElement("span");
        sep.className = "gdp-file-breadcrumb-sep";
        sep.textContent = "/";
        nav.appendChild(sep);
      }
      const isCurrent = index === allParts.length - 1;
      const crumb = document.createElement(isCurrent ? "span" : "button");
      crumb.className =
        index === allParts.length - 1
          ? "gdp-file-breadcrumb-current"
          : "gdp-file-breadcrumb-part";
      crumb.textContent = part;
      if (!isCurrent && crumb instanceof HTMLButtonElement) {
        crumb.type = "button";
        crumb.addEventListener("click", () => {
          const projectOffset = getProjectName() ? 1 : 0;
          const currentPath = parts
            .slice(0, Math.max(0, index - projectOffset + 1))
            .join("/");
          setRoute(repoRoute(ref || "worktree", currentPath));
          loadRepo();
        });
      }
      nav.appendChild(crumb);
    });
    if (!allParts.length) {
      const crumb = document.createElement("span");
      crumb.className = "gdp-file-breadcrumb-current";
      crumb.textContent = path;
      nav.appendChild(crumb);
    }
    return nav;
  }

  async function expandAllFileContext(card: DiffCardElement, file: FileMeta) {
    if (card.classList.contains("gdp-context-expanded")) {
      const data = card._diffData;
      if (!data) return;
      card.classList.remove("gdp-context-expanded");
      mountDiff(card, file, data);
      if (data.truncated && data.mode === "preview")
        addExpandHunksUI(file, data, card);
      scheduleIdleHighlight(card, file);
      setUnfoldButtonState(
        card.querySelector<HTMLButtonElement>(".gdp-file-unfold"),
        false,
      );
      return;
    }
    if (
      card._diffData &&
      (card._diffData.truncated || card._diffData.mode === "preview")
    ) {
      // Load the full diff first, then fall through to expand its gaps too.
      await loadFile(file, card, file.load_url);
    }
    const button = card.querySelector<HTMLButtonElement>(".gdp-file-unfold");
    if (button) button.disabled = true;
    try {
      // Expand every gap fully in parallel: each stack exposes a one-shot
      // whole-gap fetch, so a round costs one request per gap instead of
      // a 20-line click every 80ms. Extra rounds only pick up stacks the
      // previous round created (e.g. trailing EOF probing).
      for (let round = 0; round < 20; round++) {
        const tasks = Array.from(
          card.querySelectorAll<ExpandStackElement>(".gdp-expand-stack"),
        )
          .map((stack) => stack._gdpExpandFully)
          .filter((fn): fn is () => Promise<void> => !!fn);
        if (!tasks.length) break;
        const results = await Promise.all(
          tasks.map((fn) =>
            fn().then(
              () => true,
              () => false,
            ),
          ),
        );
        if (!results.some(Boolean)) break;
      }
      card.classList.add("gdp-context-expanded");
      setUnfoldButtonState(button || null, true);
    } finally {
      if (button) button.disabled = false;
    }
  }

  function appendStatSquaresToHeader(card: DiffCardElement, file: FileMeta) {
    const header = card.querySelector(".d2h-file-header");
    if (!header) return;
    if (!header.querySelector(".gdp-file-toggle")) {
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "gdp-file-header-icon gdp-file-toggle";
      toggle.title = "Collapse file";
      toggle.setAttribute("aria-label", "Collapse file");
      toggle.setAttribute("aria-expanded", "true");
      toggle.innerHTML = iconSvg("octicon-chevron-down", CHEVRON_DOWN_16_PATH);
      toggle.addEventListener("click", (e) => {
        e.stopPropagation();
        setFileCollapsed(card, !card.classList.contains("gdp-file-collapsed"));
      });
      header.insertBefore(toggle, header.firstChild);
    }
    header
      .querySelectorAll<HTMLInputElement>(".d2h-file-collapse-input")
      .forEach((checkbox) => {
        checkbox.checked = STATE.viewedFiles.has(file.path);
        if (checkbox.dataset.gdpBound !== "1") {
          checkbox.dataset.gdpBound = "1";
          checkbox.addEventListener("change", () =>
            setFileViewed(file.path, checkbox.checked),
          );
        }
      });
    if (!header.querySelector(".gdp-copy-path")) {
      const nameWrapper = header.querySelector(".d2h-file-name-wrapper");
      const copy = document.createElement("button");
      copy.type = "button";
      copy.className = "gdp-file-header-icon gdp-copy-path";
      copy.title = "copy file path";
      copy.setAttribute("aria-label", "copy file path");
      copy.innerHTML = iconSvg("octicon-copy", COPY_16_PATHS);
      copy.addEventListener("click", async (e) => {
        e.stopPropagation();
        const path = filePathClipboardText(file.path);
        if (!path) return;
        try {
          await navigator.clipboard.writeText(path);
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
      const statusTag = nameWrapper
        ? nameWrapper.querySelector(".d2h-tag")
        : null;
      if (statusTag) statusTag.insertAdjacentElement("afterend", copy);
      else if (nameWrapper)
        nameWrapper.insertAdjacentElement("beforeend", copy);
      else header.insertBefore(copy, header.firstChild);
    }
    if (!header.querySelector(".gdp-file-unfold")) {
      const unfold = document.createElement("button");
      unfold.type = "button";
      unfold.className = "gdp-file-header-icon gdp-file-unfold";
      setUnfoldButtonState(
        unfold,
        card.classList.contains("gdp-context-expanded"),
      );
      unfold.addEventListener("click", (e) => {
        e.stopPropagation();
        expandAllFileContext(card, file);
      });
      const copy = header.querySelector(".gdp-copy-path");
      if (copy) copy.insertAdjacentElement("afterend", unfold);
      else header.appendChild(unfold);
    }
    if (!header.querySelector(".gdp-open-path")) {
      const unfold = header.querySelector(".gdp-file-unfold");
      const openPath = createOpenPathButton(
        file.path,
        "file-parent",
        "open parent folder in OS",
      );
      if (unfold) unfold.insertAdjacentElement("afterend", openPath);
      else header.appendChild(openPath);
    }
    // Numeric counts (matches GitHub: "+10 -113 ▰▰▰▰▰")
    if (!header.querySelector(".gdp-stat-text")) {
      const stats = document.createElement("span");
      stats.className = "gdp-stat-text";
      stats.innerHTML =
        '<span class="a">+' +
        (file.additions || 0) +
        "</span>" +
        '<span class="d">−' +
        (file.deletions || 0) +
        "</span>";
      header.appendChild(stats);
    }
    const total = (file.additions || 0) + (file.deletions || 0);
    const SEG = 5;
    let aSeg: number;
    let dSeg: number;
    if (total === 0) {
      aSeg = 0;
      dSeg = 0;
    } else {
      aSeg = Math.round((file.additions / total) * SEG);
      dSeg = Math.max(0, SEG - aSeg);
      if (file.additions > 0 && aSeg === 0) aSeg = 1;
      if (file.deletions > 0 && dSeg === 0) dSeg = 1;
      const over = aSeg + dSeg - SEG;
      if (over > 0) dSeg -= over;
    }
    const wrap = document.createElement("span");
    wrap.className = "gdp-stat-squares";
    for (let i = 0; i < SEG; i++) {
      const box = document.createElement("span");
      if (i < aSeg) box.className = "sq add";
      else if (i < aSeg + dSeg) box.className = "sq del";
      else box.className = "sq nu";
      wrap.appendChild(box);
    }
    header.appendChild(wrap);
    if (
      !header.querySelector(".gdp-preview-file") &&
      isPreviewableSource(fileSourceTarget(file).path)
    ) {
      const previewFile = document.createElement("button");
      previewFile.type = "button";
      previewFile.className = "gdp-preview-file gdp-btn gdp-btn-sm";
      previewFile.textContent = "Preview";
      previewFile.title = "Preview rendered file";
      previewFile.addEventListener("click", (e) => {
        e.stopPropagation();
        const target = fileSourceTarget(file);
        setRoute({
          screen: "file",
          path: target.path,
          ref: target.ref,
          view: "blob",
          preview: true,
          range: currentRange(),
        });
        applySourceRouteToShell();
      });
      header.appendChild(previewFile);
    }
    if (!header.querySelector(".gdp-view-file")) {
      const viewFile = document.createElement("button");
      viewFile.type = "button";
      viewFile.className = "gdp-view-file gdp-btn gdp-btn-sm";
      setViewFileButtonState(viewFile, false);
      viewFile.addEventListener("click", (e) => {
        e.stopPropagation();
        const target = fileSourceTarget(file);
        setRoute({
          screen: "file",
          path: target.path,
          ref: target.ref,
          range: currentRange(),
        });
        applySourceRouteToShell();
      });
      header.appendChild(viewFile);
    } else {
      setViewFileButtonState(
        header.querySelector<HTMLButtonElement>(".gdp-view-file"),
        false,
      );
    }
  }

  function renderFile(
    file: FileMeta,
    data: FileDiffResponse,
    card: DiffCardElement,
  ) {
    card._diffData = data;
    card._file = file;
    card.classList.remove("loading", "pending");
    card.classList.add("loaded");
    card.style.minHeight = "";

    mountDiff(card, file, data);
    applyInlineAnnotations();
    const focused = applyDiffRouteFocus(card);
    // A shared/annotation URL can point at a line outside the diff hunks
    // (unchanged code). Expand the file context so the target is visible.
    if (
      !focused &&
      STATE.route.screen === "diff" &&
      STATE.route.path === file.path &&
      STATE.route.line &&
      !card.classList.contains("gdp-context-expanded")
    ) {
      void expandAllFileContext(card, file).then(() => {
        applyInlineAnnotations();
        applyDiffRouteFocus(card);
      });
    }
    // Another card finishing its lazy load can shift the already-focused
    // target line; re-anchor on it while the navigation window is open.
    if (
      performance.now() < REANCHOR_UNTIL &&
      STATE.route.screen === "diff" &&
      STATE.route.path !== file.path
    ) {
      applyDiffRouteFocus();
    }
    card.style.containIntrinsicSize = `${Math.max(card.offsetHeight, file.estimated_height_px || 200)}px`;
    applyViewedToCard(card, STATE.viewedFiles.has(file.path), true);

    if (data.truncated && data.mode === "preview") {
      addExpandHunksUI(file, data, card);
    }

    scheduleIdleHighlight(card, file);
  }

  function buildPreviewUrl(file: FileMeta, hunks: number): string {
    // Reuse load_url's query, swap mode/max_hunks
    const u = new URL(file.load_url, window.location.origin);
    u.searchParams.set("mode", "preview");
    u.searchParams.set("max_hunks", String(hunks));
    return u.pathname + u.search;
  }

  function addExpandHunksUI(
    file: FileMeta,
    data: FileDiffResponse,
    card: DiffCardElement,
  ) {
    const total = data.hunk_count || 0;
    const rendered = data.rendered_hunk_count || 0;
    const remaining = total - rendered;
    if (remaining <= 0) return;

    const old = card.querySelector(".gdp-show-full-wrap");
    if (old) old.remove();

    const wrap = document.createElement("div");
    wrap.className = "gdp-show-full-wrap";

    const step = Math.min(10, remaining);
    const moreBtn = document.createElement("button");
    moreBtn.className = "gdp-show-full";
    moreBtn.textContent = `Show next ${step} hunk${step === 1 ? "" : "s"}`;
    moreBtn.addEventListener("click", () => loadMore(rendered + step, false));

    const allBtn = document.createElement("button");
    allBtn.className = "gdp-show-full secondary";
    allBtn.textContent = `Show all (${remaining} remaining)`;
    allBtn.addEventListener("click", () => loadMore(total, true));

    const note = document.createElement("span");
    note.className = "gdp-hunk-note";
    note.textContent = `${rendered} / ${total} hunks shown`;

    wrap.appendChild(note);
    wrap.appendChild(moreBtn);
    wrap.appendChild(allBtn);
    card.appendChild(wrap);

    function loadMore(count: number, full: boolean) {
      moreBtn.disabled = allBtn.disabled = true;
      moreBtn.textContent = "Loading…";
      const myGen = getServerGeneration();
      const url = full ? file.load_url : buildPreviewUrl(file, count);
      trackLoad<FileDiffResponse>(fetch(url).then((r) => r.json()))
        .then((next) => {
          if (myGen !== getServerGeneration()) {
            moreBtn.textContent = "Data changed — reload";
            moreBtn.disabled = allBtn.disabled = false;
            return;
          }
          wrap.remove();
          card._diffData = next;
          mountDiff(card, file, next);
          if (
            next.truncated ||
            (next.mode === "preview" &&
              next.hunk_count > next.rendered_hunk_count)
          ) {
            addExpandHunksUI(file, next, card);
          }
        })
        .catch(() => {
          moreBtn.disabled = allBtn.disabled = false;
          moreBtn.textContent = "Failed — retry";
        });
    }
  }

  function highlightInsertedSpans(card: Element, file: FileMeta) {
    const spans = card.querySelectorAll<HTMLElement>(
      "tr.gdp-inserted-ctx .d2h-code-line-ctn:not([data-gdp-hl])",
    );
    highlightDiffSpans(file, spans);
  }

  function highlightDiffSpans(
    file: FileMeta,
    spans: Iterable<HTMLElement>,
    deadline?: IdleDeadline,
  ): boolean {
    if (file.size_class === "huge") return true;
    if (!STATE.syntaxHighlight) return true;
    const hljsRef = getHljs();
    if (!hljsRef?.highlight) return true;
    const lang = inferLang(file.path);
    if (!lang || (hljsRef.getLanguage && !hljsRef.getLanguage(lang)))
      return true;
    for (const s of spans) {
      if (deadline && deadline.timeRemaining() <= 4) return false;
      s.dataset.gdpHl = "1";
      const text = s.textContent || "";
      if (text.length === 0) continue;
      try {
        s.innerHTML = hljsRef.highlight(text, {
          language: lang,
          ignoreIllegals: true,
        }).value;
        s.classList.add("hljs", `language-${lang}`);
        s.classList.remove("plaintext");
      } catch {
        // Keep the original text when highlight.js cannot parse a line.
      }
    }
    return true;
  }

  function scheduleIdleHighlight(card: DiffCardElement, file: FileMeta) {
    if (file.size_class === "huge") return; // skip
    if (!STATE.syntaxHighlight) return;
    if (!("requestIdleCallback" in window)) return;
    const hljsRef = getHljs();
    if (!hljsRef?.highlight) return;
    const lang = inferLang(file.path);
    if (!lang || !hljsRef.getLanguage?.(lang)) return;

    const work = (deadline: IdleDeadline) => {
      const spans = card.querySelectorAll<HTMLElement>(
        ".d2h-code-line-ctn:not([data-gdp-hl])",
      );
      if (!highlightDiffSpans(file, spans, deadline))
        requestIdleCallback(work, { timeout: 1500 });
    };
    requestIdleCallback(work, { timeout: 2000 });
  }

  function syncSideScrollCard(card: Element) {
    card.querySelectorAll(".d2h-files-diff").forEach((group) => {
      const sides = group.querySelectorAll<HTMLElement>(".d2h-code-wrapper");
      if (sides.length !== 2) return;
      const [a, b] = sides;
      let syncing = false;
      const mirror = (src: HTMLElement, dst: HTMLElement) => {
        if (syncing) return;
        syncing = true;
        dst.scrollLeft = src.scrollLeft;
        requestAnimationFrame(() => {
          syncing = false;
        });
      };
      a.addEventListener("scroll", () => mirror(a, b), { passive: true });
      b.addEventListener("scroll", () => mirror(b, a), { passive: true });
    });
  }

  function setupScrollSpy() {
    const handler: ScrollSpyHandler = () => {
      if (handler._raf) return;
      if (performance.now() < SUPPRESS_SPY_UNTIL) return;
      handler._raf = requestAnimationFrame(() => {
        handler._raf = null;
        if (performance.now() < SUPPRESS_SPY_UNTIL) return;
        const topbarH =
          parseInt(
            getComputedStyle(document.documentElement).getPropertyValue(
              "--topbar-h",
            ),
            10,
          ) || 56;
        // Note: spy now targets .gdp-file-shell (placeholder + loaded both expose
        // data-path), instead of .d2h-file-wrapper which only exists post-render.
        const scanY = topbarH + 24;
        const cards = document.querySelectorAll<HTMLElement>(".gdp-file-shell");
        for (const w of cards) {
          const r = w.getBoundingClientRect();
          if (r.top <= scanY && r.bottom > scanY) {
            const best = w.dataset.path || "";
            if (best) {
              markActive(best);
              // Auto-scroll sidebar so the active item stays visible — but
              // only when the user is NOT currently interacting with the
              // sidebar. Otherwise lazy-render of huge diffs (40k+ lines)
              // fires window scroll, the spy yanks `li` into view, and
              // the user's manual sidebar scroll position is lost.
              const recentlyTouched =
                performance.now() - (window.__gdpSidebarTouchedAt || 0) < 1500;
              if (!recentlyTouched) {
                const li = document.querySelector<HTMLElement>(
                  `#filelist li[data-path="${CSS.escape(best)}"]`,
                );
                if (li) {
                  const sb = document.querySelector<HTMLElement>("#sidebar");
                  if (!sb) return;
                  const lr = li.getBoundingClientRect();
                  const sr = sb.getBoundingClientRect();
                  if (lr.top < sr.top + 40 || lr.bottom > sr.bottom - 40) {
                    li.scrollIntoView({ block: "nearest" });
                  }
                }
              }
            }
            return;
          }
        }
      });
    };
    // Remove previous listeners (avoid duplicates after re-render)
    if (window.__gdpScrollSpy)
      window.removeEventListener("scroll", window.__gdpScrollSpy);
    window.__gdpScrollSpy = handler;
    window.addEventListener("scroll", handler, { passive: true });
    handler(new Event("scroll"));
  }

  function _collapseAll(force?: boolean) {
    STATE.collapsed = typeof force === "boolean" ? force : !STATE.collapsed;
    document
      .querySelectorAll<HTMLElement>(".gdp-file-shell.loaded .d2h-file-wrapper")
      .forEach((w) => {
        const body = w.querySelector<HTMLElement>(
          ".d2h-files-diff, .d2h-file-diff",
        );
        if (body) body.style.display = STATE.collapsed ? "none" : "";
      });
  }

  function clearLoadQueue() {
    resetLoadScheduling();
  }

  return {
    renderMeta,
    renderShell,
    renderFile,
    rerenderLoadedDiffs,
    mountDiff,
    addExpandHunksUI,
    scheduleIdleHighlight,
    scrollToFile,
    scrollToNextUnviewedFile,
    prefetchByPath,
    applyDiffRouteFocus,
    clearDiffLineFocus,
    diffRowLineNumber,
    focusDiffLine,
    scrollDiffElementIntoView,
    expandAllFileContext,
    applyViewedState,
    applyViewedToCard,
    setFileViewed,
    fileBadge,
    setViewFileButtonState,
    setupScrollSpy,
    setupLazyObserver,
    enqueueInitialLoads,
    enqueueLoad,
    loadFile,
    loadDiffFile,
    createFileBreadcrumb,
    highlightInsertedSpans,
    setFileCollapsed,
    clearLoadQueue,
    persistViewedFiles,
  };
}
