import {
  COMMENT_DISCUSSION_16_PATH,
  GRABBER_16_PATH,
  iconSvg,
  PLUS_16_PATH,
  SYNC_16_PATH,
  TRASH_16_PATH,
  X_16_PATH,
} from "../core/icons";
import {
  type DailyJournalEntry,
  isJournalTaskStatus,
  JOURNAL_TASK_PRIORITIES,
  JOURNAL_TASK_STATUSES,
  type JournalDataResponse,
  type JournalTask,
  type JournalTaskPriority,
  type JournalTaskStatus,
  journalIssueLabel,
  journalIssueRepoLabel,
  normalizeJournalLabel,
  normalizeJournalLabels,
  selectNextJournalTasks,
  todayIsoDate,
} from "../core/journal";
import { renderMarkdownPreview } from "../core/markdown-preview";
import type { AppRoute, DiffRange } from "../core/routes";
import { readStoredSize, writeStoredSize } from "../core/stored-size";
import type { PageView } from "./page-view";
import { showConfirmDialog } from "./ui-dialog";

export type JournalViewText = {
  locale: string;
  ariaLabel: string;
  title: string;
  tabs: Record<ActiveTab, string>;
  refresh: string;
  loading: string;
  loadFailed: string;
  statusLabels: Record<JournalTaskStatus, string>;
  priorityLabels: Record<JournalTaskPriority, string>;
  statusField: string;
  priorityField: string;
  previousMonth: string;
  nextMonth: string;
  weekDays: string[];
  noEntries: string;
  noRelatedTasks: string;
  noBody: string;
  relatedTasks: string;
  new: string;
  titlePlaceholder: string;
  labelPlaceholder: string;
  entryBodyPlaceholder: string;
  addEntry: string;
  saveEntry: string;
  delete: string;
  deleteEntryFailed: string;
  saveEntryFailed: string;
  moveTaskFailed: string;
  aiQueue: string;
  empty: string;
  duePrefix: string;
  startDate: string;
  endDate: string;
  removeLabel: (label: string) => string;
  claimedBy: (name: string) => string;
  taskHeading: string;
  newTaskHeading: string;
  taskBodyPlaceholder: string;
  addTask: string;
  saveTask: string;
  saveTaskFailed: string;
  claim: string;
  claimTaskFailed: string;
  done: string;
  doneTaskFailed: string;
  deleteTaskFailed: string;
  labelFilterPlaceholder: string;
  allLabels: string;
  labelFilters: string;
  githubIssues: string;
  githubRepoPlaceholder: string;
  githubLabelPlaceholder: string;
  githubSearchPlaceholder: string;
  githubStateLabels: Record<"open" | "closed" | "all", string>;
  githubLoad: string;
  githubLoadMore: string;
  githubLoading: string;
  githubLoadFailed: string;
  githubShowing: (count: number, limit: number) => string;
  githubRateLimited: (seconds: number) => string;
  githubNotLoaded: string;
  githubNoIssues: string;
  githubClose: string;
  githubLinked: string;
  githubAddToBoard: string;
  githubOpenTask: string;
  githubDragHint: string;
  githubLinkTaskFailed: string;
  githubMemoLabel: string;
  moreTasks: (count: number) => string;
  resizeTaskPanel: string;
  dragTask: string;
  editorModes: Record<EditorMode, string>;
};

export type JournalViewDeps = {
  getRoute(): AppRoute;
  setRoute(route: AppRoute, replace?: boolean): void;
  currentRange(): DiffRange;
  trackLoad<T>(promise: Promise<T>): Promise<T>;
  getText(): JournalViewText;
  setPageMode(): void;
  syncHeaderMenu(): void;
  setStatus(status: "live" | "refreshing" | "error" | null): void;
};

export type JournalView = PageView;

type ActiveTab = "journal" | "tasks";
type EditorMode = "write" | "preview" | "split";
type JournalActionResponse = {
  entry?: DailyJournalEntry;
  task?: JournalTask;
  removed?: boolean;
};
type GithubIssueItem = {
  number: number;
  title: string;
  state: string;
  url?: string;
  labels: string[];
};
type JournalTaskDropTarget = {
  status?: JournalTaskStatus;
  before_id?: string;
  after_id?: string;
};
type GithubIssueListResponse = {
  issues?: GithubIssueItem[];
};
type JournalTaskDateRange = {
  start: string;
  end: string;
};

const GITHUB_ISSUE_INITIAL_LIMIT = 30;
const GITHUB_ISSUE_LIMIT_STEP = 30;
const GITHUB_ISSUE_LIMIT_MAX = 100;
const GITHUB_ISSUE_RATE_LIMIT_RETRY_MS = 15_000;
const TASK_DRAG_AUTOSCROLL_EDGE_PX = 72;
const TASK_DRAG_AUTOSCROLL_MAX_STEP_PX = 22;
const TASK_EDITOR_WIDTH_STORAGE_KEY = "code-viewer:journal-task-editor-width";
const TASK_EDITOR_DEFAULT_WIDTH = 380;
const TASK_EDITOR_MIN_WIDTH = 320;
const TASK_EDITOR_MAX_WIDTH = 760;

function isJournalRoute(
  route: AppRoute,
): route is Extract<AppRoute, { screen: "journal" }> {
  return route.screen === "journal";
}

function parseGithubLabels(raw: string): string[] {
  const labels: string[] = [];
  const seen = new Set<string>();
  for (const item of raw.split(",")) {
    const label = item.trim().slice(0, 200);
    if (!label || seen.has(label)) continue;
    seen.add(label);
    labels.push(label);
  }
  return labels;
}

function taskDateRange(task: JournalTask): JournalTaskDateRange | null {
  const first = task.source_date || task.due_date;
  const last = task.due_date || task.source_date;
  if (!first || !last) return null;
  return first <= last
    ? { start: first, end: last }
    : { start: last, end: first };
}

function taskCoversDate(task: JournalTask, date: string): boolean {
  const range = taskDateRange(task);
  return !!range && range.start <= date && date <= range.end;
}

function monthKey(date: string): string {
  return date.slice(0, 7);
}

function monthTitle(date: string, locale: string): string {
  const parsed = new Date(`${monthKey(date)}-01T00:00:00`);
  return parsed.toLocaleString(locale, { month: "long", year: "numeric" });
}

function offsetMonth(date: string, delta: number): string {
  const parsed = new Date(`${monthKey(date)}-01T00:00:00`);
  parsed.setMonth(parsed.getMonth() + delta);
  return `${todayIsoDate(parsed).slice(0, 7)}-01`;
}

function labelChip(label: string): HTMLElement {
  const chip = document.createElement("span");
  chip.className = "journal-label-chip";
  chip.textContent = label;
  return chip;
}

function taskField(
  labelText: string,
  control: HTMLInputElement | HTMLSelectElement,
): HTMLLabelElement {
  const field = document.createElement("label");
  field.className = "journal-field";
  const caption = document.createElement("span");
  caption.className = "journal-field-label";
  caption.textContent = labelText;
  field.append(caption, control);
  return field;
}

function createLabelEditor(
  initialLabels: string[],
  placeholder: string,
  suggestionLabels: string[] = [],
  removeLabelText: (label: string) => string = (label) => `Remove ${label}`,
): { element: HTMLElement; getLabels(): string[] } {
  const root = document.createElement("div");
  root.className = "journal-label-editor";
  const input = document.createElement("input");
  input.className = "journal-label-editor-input";
  input.type = "text";
  input.autocomplete = "off";
  const labels = normalizeJournalLabels(initialLabels);
  const suggestions = normalizeJournalLabels(suggestionLabels);
  const menu = document.createElement("div");
  menu.className = "journal-label-editor-suggestions";
  menu.hidden = true;
  const quick = document.createElement("div");
  quick.className = "journal-label-editor-quick";
  quick.hidden = true;
  let highlightedSuggestion = -1;

  const suggestionItems = () => {
    const raw = input.value.trim().toLowerCase();
    const normalized = normalizeJournalLabel(raw) || raw;
    return suggestions
      .filter(
        (label) =>
          !labels.includes(label) &&
          (!normalized || label.includes(normalized)),
      )
      .slice(0, 8);
  };

  const renderSuggestions = () => {
    const items = suggestionItems();
    const hasQuery = !!(
      normalizeJournalLabel(input.value) || input.value.trim()
    );
    menu.replaceChildren();
    if (!items.length || !hasQuery || document.activeElement !== input) {
      menu.hidden = true;
      highlightedSuggestion = -1;
      return;
    }
    menu.hidden = false;
    if (highlightedSuggestion >= items.length) highlightedSuggestion = 0;
    items.forEach((label, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "journal-label-editor-suggestion";
      button.classList.toggle("active", index === highlightedSuggestion);
      button.textContent = label;
      button.addEventListener("mousedown", (event) => {
        event.preventDefault();
        commit(label);
      });
      menu.appendChild(button);
    });
  };

  const renderQuickSuggestions = () => {
    const items = suggestionItems().slice(0, 6);
    quick.replaceChildren();
    quick.hidden = !items.length;
    for (const label of items) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "journal-label-editor-quick-chip";
      button.textContent = label;
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        commit(label);
      });
      quick.appendChild(button);
    }
  };

  const render = () => {
    root.replaceChildren();
    for (const label of labels) {
      const chip = document.createElement("span");
      chip.className = "journal-label-editor-chip";
      const name = document.createElement("span");
      name.textContent = label;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "journal-label-editor-remove";
      remove.setAttribute("aria-label", removeLabelText(label));
      remove.innerHTML = iconSvg("octicon-x", X_16_PATH);
      remove.addEventListener("click", (event) => {
        event.stopPropagation();
        const index = labels.indexOf(label);
        if (index >= 0) labels.splice(index, 1);
        render();
        input.focus();
      });
      chip.append(name, remove);
      root.appendChild(chip);
    }
    input.placeholder = labels.length ? "" : placeholder;
    root.append(input, quick, menu);
    renderQuickSuggestions();
    renderSuggestions();
  };

  const commit = (raw: string): boolean => {
    const label = normalizeJournalLabel(raw);
    input.value = "";
    if (!label || labels.includes(label)) return false;
    labels.push(label);
    highlightedSuggestion = -1;
    render();
    input.focus();
    return true;
  };

  input.addEventListener("keydown", (event) => {
    const items = suggestionItems();
    if (event.key === "ArrowDown" && items.length) {
      event.preventDefault();
      highlightedSuggestion = (highlightedSuggestion + 1) % items.length;
      renderSuggestions();
      return;
    }
    if (event.key === "ArrowUp" && items.length) {
      event.preventDefault();
      highlightedSuggestion =
        (highlightedSuggestion - 1 + items.length) % items.length;
      renderSuggestions();
      return;
    }
    const value = input.value.trim();
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      commit(
        event.key === "Enter" &&
          highlightedSuggestion >= 0 &&
          items[highlightedSuggestion]
          ? items[highlightedSuggestion]
          : value,
      );
      return;
    }
    if (event.key === "Tab" && value) {
      event.preventDefault();
      commit(value);
      return;
    }
    if (event.key === "Backspace" && !value && labels.length) {
      labels.pop();
      render();
      input.focus();
    }
  });
  input.addEventListener("input", () => {
    highlightedSuggestion = -1;
    renderQuickSuggestions();
    renderSuggestions();
  });
  input.addEventListener("focus", renderSuggestions);
  input.addEventListener("paste", (event) => {
    const pasted = event.clipboardData?.getData("text") || "";
    if (!/[,\n]/.test(pasted)) return;
    event.preventDefault();
    for (const item of pasted.split(/[,\n]+/)) commit(item);
  });
  input.addEventListener("blur", () => {
    if (input.value.trim()) commit(input.value);
    window.setTimeout(() => {
      menu.hidden = true;
      highlightedSuggestion = -1;
    }, 120);
  });
  root.addEventListener("click", () => input.focus());
  render();

  return {
    element: root,
    getLabels: () => [...labels],
  };
}

function setButtonBusy(button: HTMLButtonElement, busy: boolean): void {
  button.disabled = busy;
  button.setAttribute("aria-busy", busy ? "true" : "false");
}

export function createJournalView(deps: JournalViewDeps): JournalView {
  const root = document.createElement("section");
  root.className = "journal-page";
  root.hidden = true;
  root.setAttribute("aria-label", deps.getText().ariaLabel);

  let mounted = false;
  let lifecycle = 0;
  let data: JournalDataResponse | null = null;
  let activeTab: ActiveTab = "tasks";
  let selectedDate = todayIsoDate();
  let selectedEntryId = "";
  let creatingEntry = false;
  let selectedTaskId = "";
  let labelFilter = "";
  let editorMode: EditorMode = "split";
  let message = "";
  let draggingTaskId = "";
  let draggingGithubIssueNumber: number | null = null;
  let githubIssues: GithubIssueItem[] = [];
  let githubIssuesLoading = false;
  let githubIssuesLoaded = false;
  let githubIssuesError = "";
  let githubRepoFilter = "";
  let githubLabelFilter = "";
  let githubSearchFilter = "";
  let githubStateFilter: "open" | "closed" | "all" = "open";
  let githubIssueLimit = GITHUB_ISSUE_INITIAL_LIMIT;
  let githubIssuesRetryAt = 0;
  let githubIssueGeneration = 0;
  let githubIssuesAutoRequested = false;
  let githubInboxOpen = false;
  let suppressTaskClick = false;
  let pendingTaskEditorFocus = false;
  let pendingTaskEditorReveal = false;
  let lastTaskDropTarget: JournalTaskDropTarget | null = null;
  let nativeTaskDragActive = false;
  let taskEditorResizePointerId: number | null = null;
  let taskEditorResizeStartX = 0;
  let taskEditorResizeStartWidth = TASK_EDITOR_DEFAULT_WIDTH;
  let taskEditorFocusRequest = 0;
  let taskDragAutoScrollFrame = 0;
  let taskDragAutoScrollX = 0;
  let taskDragAutoScrollY = 0;
  let pointerDrag: {
    taskId: string;
    pointerId: number;
    source: HTMLElement;
    startX: number;
    startY: number;
    active: boolean;
  } | null = null;

  function text(): JournalViewText {
    return deps.getText();
  }

  function selectedEntry(): DailyJournalEntry | null {
    if (!data) return null;
    return (
      data.journal.entries.find((entry) => entry.id === selectedEntryId) || null
    );
  }

  function selectedTask(): JournalTask | null {
    if (!data) return null;
    return data.tasks.tasks.find((task) => task.id === selectedTaskId) || null;
  }

  function journalEditorHasFocus(): boolean {
    const active = document.activeElement as HTMLElement | null;
    return !!(
      active &&
      root.contains(active) &&
      active.closest(".journal-editor, .journal-task-editor")
    );
  }

  function labelSuggestions(): string[] {
    return (data?.labels || []).filter(
      (label) => !/^issue-\d+$/.test(label) && !label.startsWith("repo-"),
    );
  }

  function taskEditorMaxWidth(): number {
    const layoutWidth =
      root.querySelector<HTMLElement>(".journal-tasks-layout")?.clientWidth ||
      window.innerWidth;
    if (layoutWidth <= 1100) return TASK_EDITOR_MAX_WIDTH;
    return Math.max(
      TASK_EDITOR_MIN_WIDTH,
      Math.min(TASK_EDITOR_MAX_WIDTH, layoutWidth - 560),
    );
  }

  function clampTaskEditorWidth(width: number): number {
    return Math.max(
      TASK_EDITOR_MIN_WIDTH,
      Math.min(taskEditorMaxWidth(), Math.round(width)),
    );
  }

  function applyTaskEditorWidth(width: number, persist = true): void {
    const clamped = clampTaskEditorWidth(width);
    document.documentElement.style.setProperty(
      "--journal-task-editor-w",
      `${clamped}px`,
    );
    if (!persist) return;
    writeStoredSize(TASK_EDITOR_WIDTH_STORAGE_KEY, clamped);
  }

  function restoreTaskEditorWidth(): void {
    applyTaskEditorWidth(
      readStoredSize(TASK_EDITOR_WIDTH_STORAGE_KEY, TASK_EDITOR_DEFAULT_WIDTH),
      false,
    );
  }

  function startTaskEditorResize(
    event: PointerEvent,
    panel: HTMLElement,
  ): void {
    if (event.button !== 0) return;
    taskEditorResizePointerId = event.pointerId;
    taskEditorResizeStartX = event.clientX;
    taskEditorResizeStartWidth = panel.getBoundingClientRect().width;
    panel.setPointerCapture?.(event.pointerId);
    document.body.classList.add("journal-task-editor-resizing");
    event.preventDefault();
  }

  function handleTaskEditorResizeMove(event: PointerEvent): void {
    if (taskEditorResizePointerId !== event.pointerId) return;
    applyTaskEditorWidth(
      taskEditorResizeStartWidth - (event.clientX - taskEditorResizeStartX),
      false,
    );
  }

  function finishTaskEditorResize(event: PointerEvent): void {
    if (taskEditorResizePointerId !== event.pointerId) return;
    taskEditorResizePointerId = null;
    document.body.classList.remove("journal-task-editor-resizing");
    const panel = root.querySelector<HTMLElement>(".journal-task-editor");
    if (panel) applyTaskEditorWidth(panel.getBoundingClientRect().width);
  }

  function revealTaskEditorIfNeeded(editor: HTMLElement): void {
    const layout = root.querySelector<HTMLElement>(".journal-tasks-layout");
    if (!layout || layout.scrollHeight <= layout.clientHeight + 1) return;
    const layoutRect = layout.getBoundingClientRect();
    const editorRect = editor.getBoundingClientRect();
    const topPadding = 8;
    const bottomPadding = 8;
    const visibleTop = layoutRect.top + topPadding;
    const visibleBottom = layoutRect.bottom - bottomPadding;
    const minVisibleTopGap = Math.min(160, editorRect.height);
    if (
      editorRect.top >= visibleTop &&
      editorRect.top <= visibleBottom - minVisibleTopGap
    )
      return;
    layout.scrollTop += editorRect.top - visibleTop;
  }

  function scheduleTaskEditorInteraction(
    options: { focusEditor?: boolean; revealEditor?: boolean } = {},
  ): void {
    if (options.focusEditor) pendingTaskEditorFocus = true;
    if (options.revealEditor) pendingTaskEditorReveal = true;
    const request = ++taskEditorFocusRequest;
    const interact = (final = false) => {
      if (request !== taskEditorFocusRequest) return;
      const editor = root.querySelector<HTMLElement>(".journal-task-editor");
      const input =
        editor?.querySelector<HTMLInputElement>(".journal-title-input") || null;
      if (pendingTaskEditorReveal && editor) {
        revealTaskEditorIfNeeded(editor);
        pendingTaskEditorReveal = false;
      }
      if (pendingTaskEditorFocus && input) input.focus({ preventScroll: true });
      if (final && request === taskEditorFocusRequest) {
        pendingTaskEditorFocus = false;
        pendingTaskEditorReveal = false;
      }
    };
    window.requestAnimationFrame(() => interact());
    window.setTimeout(() => interact(), 50);
    window.setTimeout(() => interact(true), 250);
  }

  function selectTask(
    taskId: string,
    options: { focusEditor?: boolean; revealEditor?: boolean } = {},
  ): void {
    activeTab = "tasks";
    selectedTaskId = taskId;
    setRoute({ tab: "tasks", task: taskId });
    render();
    if (options.focusEditor || options.revealEditor)
      scheduleTaskEditorInteraction(options);
  }

  function routeFor(
    next: Partial<Extract<AppRoute, { screen: "journal" }>>,
  ): AppRoute {
    return {
      screen: "journal",
      tab: activeTab,
      date: selectedDate,
      ...(labelFilter ? { label: labelFilter } : {}),
      ...(selectedTaskId ? { task: selectedTaskId } : {}),
      ...next,
      range: deps.currentRange(),
    };
  }

  function applyRoute(route = deps.getRoute()): void {
    if (!isJournalRoute(route)) return;
    activeTab = route.tab || activeTab || "tasks";
    selectedDate = route.date || selectedDate || todayIsoDate();
    labelFilter = route.label || "";
    selectedTaskId = route.task || "";
  }

  function mount(): void {
    if (mounted) return;
    const content = document.getElementById("content");
    if (!content) return;
    document.getElementById("diff")?.setAttribute("hidden", "true");
    document.getElementById("empty")?.classList.add("hidden");
    document
      .getElementById("history-commit-info")
      ?.setAttribute("hidden", "true");
    root.hidden = false;
    content.appendChild(root);
    mounted = true;
    document.body.classList.add("gdp-journal-page");
    deps.setPageMode();
    deps.syncHeaderMenu();
  }

  function suspend(): void {
    lifecycle++;
    if (!mounted) {
      root.remove();
      root.hidden = false;
      document.body.classList.remove("gdp-journal-page");
      document.getElementById("diff")?.removeAttribute("hidden");
      return;
    }
    root.remove();
    root.hidden = false;
    document.body.classList.remove("gdp-journal-page");
    document.getElementById("diff")?.removeAttribute("hidden");
    mounted = false;
  }

  async function requestJournal(
    action: string,
    body: Record<string, unknown>,
    afterResponse?: (response: JournalActionResponse) => void,
  ): Promise<JournalActionResponse> {
    deps.setStatus("refreshing");
    const res = await deps.trackLoad(
      fetch("/_journal", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Code-Viewer-Action": "1",
        },
        body: JSON.stringify({ action, ...body }),
      }),
    );
    if (!res.ok) throw new Error(await res.text());
    const response = (await res.json()) as JournalActionResponse;
    afterResponse?.(response);
    await refresh();
    return response;
  }

  async function refresh(): Promise<void> {
    const seq = ++lifecycle;
    message = data ? "" : text().loading;
    render();
    deps.setStatus("refreshing");
    try {
      const next = await deps.trackLoad(
        fetch("/_journal").then(async (res) => {
          if (!res.ok) throw new Error(await res.text());
          return (await res.json()) as JournalDataResponse;
        }),
      );
      if (seq !== lifecycle) return;
      data = next;
      if (
        selectedEntryId &&
        !next.journal.entries.some((entry) => entry.id === selectedEntryId)
      ) {
        selectedEntryId = "";
      }
      if (!creatingEntry && !selectedEntryId) {
        selectedEntryId =
          next.journal.entries.find((entry) => entry.date === selectedDate)
            ?.id || "";
      }
      if (
        selectedTaskId &&
        !next.tasks.tasks.some((task) => task.id === selectedTaskId)
      ) {
        selectedTaskId = "";
      }
      message = "";
      deps.setStatus("live");
      render();
    } catch (error) {
      if (seq !== lifecycle) return;
      message = error instanceof Error ? error.message : text().loadFailed;
      deps.setStatus("error");
      render();
    }
  }

  function setRoute(
    next: Partial<Extract<AppRoute, { screen: "journal" }>>,
    replace = true,
  ): void {
    deps.setRoute(routeFor(next), replace);
  }

  function renderHeader(): HTMLElement {
    const header = document.createElement("div");
    header.className = "journal-header";

    const title = document.createElement("div");
    title.className = "journal-title";
    title.textContent = text().title;

    const tabs = document.createElement("div");
    tabs.className = "seg journal-tabs";
    tabs.setAttribute("role", "tablist");
    for (const tab of ["journal", "tasks"] as const) {
      const button = document.createElement("button");
      button.type = "button";
      button.classList.toggle("active", activeTab === tab);
      button.textContent = text().tabs[tab];
      button.addEventListener("click", () => {
        activeTab = tab;
        setRoute({ tab });
      });
      tabs.appendChild(button);
    }

    const refreshButton = document.createElement("button");
    refreshButton.type = "button";
    refreshButton.className = "global-icon-action journal-icon-action";
    refreshButton.title = text().refresh;
    refreshButton.setAttribute("aria-label", text().refresh);
    refreshButton.innerHTML = iconSvg("octicon-sync", SYNC_16_PATH);
    refreshButton.addEventListener("click", () => void refresh());

    const status = document.createElement("span");
    status.className = "journal-status";
    status.textContent = message;
    status.hidden = !message;
    status.setAttribute("role", "status");

    header.append(title, tabs, refreshButton, status);
    return header;
  }

  function renderCalendar(): HTMLElement {
    const panel = document.createElement("aside");
    panel.className = "journal-calendar";
    const head = document.createElement("div");
    head.className = "journal-calendar-head";
    const prev = document.createElement("button");
    prev.type = "button";
    prev.textContent = "<";
    prev.setAttribute("aria-label", text().previousMonth);
    const next = document.createElement("button");
    next.type = "button";
    next.textContent = ">";
    next.setAttribute("aria-label", text().nextMonth);
    const title = document.createElement("strong");
    title.textContent = monthTitle(selectedDate, text().locale);
    prev.addEventListener("click", () => {
      selectedDate = offsetMonth(selectedDate, -1);
      selectedEntryId = "";
      creatingEntry = false;
      setRoute({ date: selectedDate });
    });
    next.addEventListener("click", () => {
      selectedDate = offsetMonth(selectedDate, 1);
      selectedEntryId = "";
      creatingEntry = false;
      setRoute({ date: selectedDate });
    });
    head.append(prev, title, next);

    const days = document.createElement("div");
    days.className = "journal-calendar-grid";
    for (const label of text().weekDays) {
      const day = document.createElement("span");
      day.className = "journal-weekday";
      day.textContent = label;
      days.appendChild(day);
    }

    const monthStart = new Date(`${monthKey(selectedDate)}-01T00:00:00`);
    const first = new Date(monthStart);
    first.setDate(first.getDate() - first.getDay());
    const entryDates = new Set(
      (data?.journal.entries || []).map((entry) => entry.date),
    );
    const monthTasks = (data?.tasks.tasks || [])
      .filter((task) => {
        const range = taskDateRange(task);
        return (
          !!range &&
          range.end >= todayIsoDate(first) &&
          range.start <=
            todayIsoDate(new Date(first.getTime() + 41 * 24 * 60 * 60 * 1000))
        );
      })
      .slice(0, 60);
    const today = todayIsoDate();
    for (let i = 0; i < 42; i++) {
      const current = new Date(first);
      current.setDate(first.getDate() + i);
      const value = todayIsoDate(current);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "journal-day-button";
      button.classList.toggle(
        "muted",
        monthKey(value) !== monthKey(selectedDate),
      );
      button.classList.toggle("active", value === selectedDate);
      button.classList.toggle("today", value === today);
      button.classList.toggle("has-entry", entryDates.has(value));
      const number = document.createElement("span");
      number.className = "journal-day-number";
      number.textContent = String(current.getDate());
      const bars = document.createElement("span");
      bars.className = "journal-day-ranges";
      const tasksForDay = monthTasks.filter((item) =>
        taskCoversDate(item, value),
      );
      for (const task of tasksForDay.slice(0, 3)) {
        const range = taskDateRange(task);
        if (!range) continue;
        const bar = document.createElement("span");
        bar.className = `journal-day-range journal-range-${task.priority}`;
        bar.classList.toggle("start", value === range.start);
        bar.classList.toggle("end", value === range.end);
        bar.classList.toggle(
          "single",
          value === range.start && value === range.end,
        );
        if (value === range.start) bar.textContent = task.title;
        bar.title = `${task.title} (${range.start} - ${range.end})`;
        bars.appendChild(bar);
      }
      if (tasksForDay.length > 3) {
        const more = document.createElement("span");
        more.className = "journal-day-range-more";
        more.textContent = text().moreTasks(tasksForDay.length - 3);
        more.title = tasksForDay
          .slice(3)
          .map((task) => task.title)
          .join("\n");
        bars.appendChild(more);
      }
      button.append(number, bars);
      button.addEventListener("click", () => {
        selectedDate = value;
        creatingEntry = false;
        selectedEntryId =
          data?.journal.entries.find((entry) => entry.date === value)?.id || "";
        setRoute({ date: value, tab: "journal" });
      });
      days.appendChild(button);
    }
    panel.append(head, days);
    return panel;
  }

  function renderJournalEntryList(entries: DailyJournalEntry[]): HTMLElement {
    const list = document.createElement("div");
    list.className = "journal-entry-list";
    if (!entries.length) {
      const empty = document.createElement("div");
      empty.className = "journal-empty";
      empty.textContent = text().noEntries;
      list.appendChild(empty);
      return list;
    }
    for (const entry of entries) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "journal-entry-row";
      row.classList.toggle("active", entry.id === selectedEntryId);
      row.textContent = entry.title || entry.body.split("\n")[0] || entry.date;
      row.addEventListener("click", () => {
        selectedEntryId = entry.id;
        creatingEntry = false;
        render();
      });
      list.appendChild(row);
    }
    return list;
  }

  function renderJournalEditor(): HTMLElement {
    const selected = selectedEntry();
    const wrap = document.createElement("section");
    wrap.className = "journal-editor";

    const head = document.createElement("div");
    head.className = "journal-section-head";
    const dateInput = document.createElement("input");
    dateInput.type = "date";
    dateInput.value = selectedDate;
    dateInput.addEventListener("change", () => {
      selectedDate = dateInput.value || todayIsoDate();
      selectedEntryId = "";
      creatingEntry = false;
      setRoute({ date: selectedDate });
    });
    const newButton = document.createElement("button");
    newButton.type = "button";
    newButton.innerHTML = `${iconSvg("octicon-plus", PLUS_16_PATH)}<span>${text().new}</span>`;
    newButton.addEventListener("click", () => {
      selectedEntryId = "";
      creatingEntry = true;
      render();
    });
    head.append(dateInput, newButton);

    const entriesForDate = (data?.journal.entries || []).filter(
      (entry) => entry.date === selectedDate,
    );
    const title = document.createElement("input");
    title.className = "journal-title-input";
    title.placeholder = text().titlePlaceholder;
    title.value = selected?.title || "";
    const labels = createLabelEditor(
      selected ? selected.labels : [],
      text().labelPlaceholder,
      labelSuggestions(),
      text().removeLabel,
    );
    const body = document.createElement("textarea");
    body.className = "journal-body-input";
    body.placeholder = text().entryBodyPlaceholder;
    body.value = selected?.body || "";

    const actions = document.createElement("div");
    actions.className = "journal-editor-actions";
    const save = document.createElement("button");
    save.type = "button";
    save.className = "journal-primary-action";
    save.textContent = selected ? text().saveEntry : text().addEntry;
    save.addEventListener("click", async () => {
      setButtonBusy(save, true);
      try {
        const payload = {
          date: selectedDate,
          title: title.value,
          labels: labels.getLabels(),
          body: body.value,
        };
        if (selected)
          await requestJournal("update-entry", { id: selected.id, ...payload });
        else
          await requestJournal("add-entry", payload, (next) => {
            if (next.entry) {
              selectedEntryId = next.entry.id;
              creatingEntry = false;
            }
          });
      } catch (error) {
        message =
          error instanceof Error ? error.message : text().saveEntryFailed;
        deps.setStatus("error");
        render();
      } finally {
        setButtonBusy(save, false);
      }
    });
    actions.appendChild(save);
    if (selected) {
      const del = document.createElement("button");
      del.type = "button";
      del.className = "journal-danger-action";
      del.innerHTML = `${iconSvg("octicon-trash", TRASH_16_PATH)}<span>${text().delete}</span>`;
      del.addEventListener("click", async () => {
        const ok = await showConfirmDialog({
          title: `${text().delete}?`,
          body: selected.title || selected.date,
          confirmLabel: text().delete,
          danger: true,
          focusReturnTarget: del,
        });
        if (!ok) return;
        setButtonBusy(del, true);
        try {
          await requestJournal("delete-entry", { id: selected.id });
          selectedEntryId = "";
          creatingEntry = false;
        } catch (error) {
          message =
            error instanceof Error ? error.message : text().deleteEntryFailed;
          deps.setStatus("error");
          render();
        } finally {
          setButtonBusy(del, false);
        }
      });
      actions.appendChild(del);
    }

    wrap.append(
      head,
      renderJournalEntryList(entriesForDate),
      title,
      labels.element,
      body,
      actions,
    );
    return wrap;
  }

  function renderRelatedTasks(): HTMLElement {
    const panel = document.createElement("aside");
    panel.className = "journal-related";
    const heading = document.createElement("h2");
    heading.textContent = text().relatedTasks;
    panel.appendChild(heading);
    const tasks = (data?.tasks.tasks || []).filter((task) =>
      taskCoversDate(task, selectedDate),
    );
    if (!tasks.length) {
      const empty = document.createElement("div");
      empty.className = "journal-empty";
      empty.textContent = text().noRelatedTasks;
      panel.appendChild(empty);
      return panel;
    }
    for (const task of tasks)
      panel.appendChild(renderTaskCard(task, { compact: true }));
    return panel;
  }

  function renderJournalTab(): HTMLElement {
    const body = document.createElement("div");
    body.className = "journal-daily-layout";
    body.append(renderCalendar(), renderJournalEditor(), renderRelatedTasks());
    return body;
  }

  function taskVisible(task: JournalTask): boolean {
    return !labelFilter || task.labels.includes(labelFilter);
  }

  function renderTaskCard(
    task: JournalTask,
    options: { compact?: boolean } = {},
  ): HTMLElement {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "journal-task-card";
    card.dataset.taskId = task.id;
    card.classList.toggle("selected", task.id === selectedTaskId);
    card.classList.toggle("compact", !!options.compact);
    card.addEventListener("click", (event) => {
      if (
        draggingTaskId ||
        suppressTaskClick ||
        taskDragHandleFromTarget(card, event.target)
      )
        return;
      selectTask(task.id, { revealEditor: true });
    });
    card.addEventListener("dragstart", (event) => {
      if (!taskDragHandleFromTarget(card, event.target)) {
        event.preventDefault();
        return;
      }
      draggingTaskId = task.id;
      nativeTaskDragActive = true;
      lastTaskDropTarget = null;
      card.classList.add("dragging");
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", task.id);
        const rect = card.getBoundingClientRect();
        event.dataTransfer.setDragImage?.(
          card,
          Math.max(0, Math.min(rect.width, event.clientX - rect.left)),
          Math.max(0, Math.min(rect.height, event.clientY - rect.top)),
        );
      }
    });
    card.addEventListener("dragenter", (event) => {
      if (
        (!draggingTaskId && !draggingGithubIssue()) ||
        draggingTaskId === task.id
      )
        return;
      event.preventDefault();
      const after = isTaskDropAfter(card, event);
      lastTaskDropTarget = after
        ? { after_id: task.id }
        : { before_id: task.id };
      markTaskDropTarget(card, after);
    });
    card.addEventListener("dragover", (event) => {
      const issue = draggingGithubIssue();
      if ((!draggingTaskId && !issue) || draggingTaskId === task.id) return;
      event.preventDefault();
      if (event.dataTransfer)
        event.dataTransfer.dropEffect = issue ? "copy" : "move";
      scheduleTaskDragAutoScroll(event);
      const after = isTaskDropAfter(card, event);
      lastTaskDropTarget = after
        ? { after_id: task.id }
        : { before_id: task.id };
      markTaskDropTarget(card, after);
    });
    card.addEventListener("dragleave", (event) => {
      const related = event.relatedTarget as Node | null;
      if (related && card.contains(related)) return;
      lastTaskDropTarget = null;
      card.classList.remove("drop-target", "drop-after");
    });
    card.addEventListener("drop", (event) => {
      const issue =
        draggingGithubIssue() ||
        githubIssueFromDataTransfer(event.dataTransfer);
      if ((!draggingTaskId && !issue) || draggingTaskId === task.id) return;
      event.preventDefault();
      event.stopPropagation();
      const after = isTaskDropAfter(card, event);
      const target = after ? { after_id: task.id } : { before_id: task.id };
      lastTaskDropTarget = null;
      if (issue) void linkGithubIssueToTask(issue, target);
      else void moveDraggedTask(target);
    });
    card.addEventListener("dragend", (event) => finishNativeTaskDrag(event));
    card.addEventListener("pointerdown", (event) => {
      beginPointerTaskDrag(task.id, event);
    });
    const top = document.createElement("span");
    top.className = "journal-task-card-top";
    const priority = document.createElement("span");
    priority.className = `journal-priority journal-priority-${task.priority}`;
    priority.textContent = text().priorityLabels[task.priority];
    const status = document.createElement("span");
    status.className = "journal-task-status";
    status.textContent = text().statusLabels[task.status];
    top.append(priority, status);
    const dragHandle = document.createElement("span");
    dragHandle.className = "journal-task-drag-handle";
    dragHandle.draggable = true;
    dragHandle.title = text().dragTask;
    dragHandle.innerHTML = iconSvg("journal-task-drag-icon", GRABBER_16_PATH);
    dragHandle.setAttribute("aria-hidden", "true");
    top.appendChild(dragHandle);
    const title = document.createElement("strong");
    title.textContent = task.title;
    const labels = document.createElement("span");
    labels.className = "journal-task-labels";
    for (const label of task.labels) labels.appendChild(labelChip(label));
    card.append(top, title, labels);
    if (task.due_date) {
      const due = document.createElement("span");
      due.className = "journal-task-due";
      due.textContent = `${text().duePrefix} ${task.due_date}`;
      card.appendChild(due);
    }
    if (task.claim) {
      const claim = document.createElement("span");
      claim.className = "journal-task-claim";
      claim.textContent = text().claimedBy(task.claim.by);
      card.appendChild(claim);
    }
    return card;
  }

  function taskDragHandleFromTarget(
    card: HTMLElement,
    target: EventTarget | null,
  ): HTMLElement | null {
    const handle = (target as HTMLElement | null)?.closest<HTMLElement>(
      ".journal-task-drag-handle",
    );
    return handle && card.contains(handle) ? handle : null;
  }

  function isTaskDropAfter(
    card: HTMLElement,
    event: { clientY: number },
  ): boolean {
    const rect = card.getBoundingClientRect();
    return event.clientY > rect.top + rect.height / 2;
  }

  function clearTaskDropTargets(): void {
    root
      .querySelectorAll(
        ".journal-task-card.drop-target, .journal-task-column.drop-target",
      )
      .forEach((el) => {
        el.classList.remove("drop-target", "drop-after");
      });
  }

  function clearTaskDragState(): void {
    root.querySelectorAll(".journal-task-card.dragging").forEach((el) => {
      el.classList.remove("dragging");
    });
    stopTaskDragAutoScroll();
    clearTaskDropTargets();
    lastTaskDropTarget = null;
    nativeTaskDragActive = false;
    draggingTaskId = "";
    suppressTaskClick = true;
    window.setTimeout(() => {
      suppressTaskClick = false;
    }, 50);
  }

  function clearGithubIssueDragState(): void {
    draggingGithubIssueNumber = null;
    lastTaskDropTarget = null;
    stopTaskDragAutoScroll();
    clearTaskDropTargets();
  }

  function taskCardById(taskId: string): HTMLElement | null {
    return root.querySelector<HTMLElement>(
      `.journal-task-card[data-task-id="${CSS.escape(taskId)}"]`,
    );
  }

  function taskDragScrollTargetAtPoint(
    clientX: number,
    clientY: number,
  ): HTMLElement | null {
    const element = document.elementFromPoint(
      clientX,
      clientY,
    ) as HTMLElement | null;
    let cursor =
      element?.closest<HTMLElement>(
        ".journal-github-issues, .journal-github-panel, .journal-task-board-wrap, .journal-tasks-layout",
      ) || root.querySelector<HTMLElement>(".journal-task-board-wrap");
    while (cursor && cursor !== root) {
      const style = window.getComputedStyle(cursor);
      if (
        /(auto|scroll)/.test(style.overflowY) &&
        cursor.scrollHeight > cursor.clientHeight + 1
      ) {
        return cursor;
      }
      cursor = cursor.parentElement;
    }
    const layout = root.querySelector<HTMLElement>(".journal-tasks-layout");
    return layout && layout.scrollHeight > layout.clientHeight + 1
      ? layout
      : null;
  }

  function taskDragAutoScrollDelta(
    target: HTMLElement,
    clientY: number,
  ): number {
    const rect = target.getBoundingClientRect();
    const canScrollUp = target.scrollTop > 0;
    const canScrollDown =
      target.scrollTop + target.clientHeight < target.scrollHeight - 1;
    const topDistance = clientY - rect.top;
    if (canScrollUp && topDistance < TASK_DRAG_AUTOSCROLL_EDGE_PX) {
      const intensity =
        (TASK_DRAG_AUTOSCROLL_EDGE_PX - Math.max(0, topDistance)) /
        TASK_DRAG_AUTOSCROLL_EDGE_PX;
      return -Math.max(
        4,
        Math.round(TASK_DRAG_AUTOSCROLL_MAX_STEP_PX * intensity),
      );
    }
    const bottomDistance = rect.bottom - clientY;
    if (canScrollDown && bottomDistance < TASK_DRAG_AUTOSCROLL_EDGE_PX) {
      const intensity =
        (TASK_DRAG_AUTOSCROLL_EDGE_PX - Math.max(0, bottomDistance)) /
        TASK_DRAG_AUTOSCROLL_EDGE_PX;
      return Math.max(
        4,
        Math.round(TASK_DRAG_AUTOSCROLL_MAX_STEP_PX * intensity),
      );
    }
    return 0;
  }

  function stopTaskDragAutoScroll(): void {
    if (!taskDragAutoScrollFrame) return;
    window.cancelAnimationFrame(taskDragAutoScrollFrame);
    taskDragAutoScrollFrame = 0;
  }

  function runTaskDragAutoScroll(): void {
    taskDragAutoScrollFrame = 0;
    if (!draggingTaskId && !draggingGithubIssue()) return;
    const target = taskDragScrollTargetAtPoint(
      taskDragAutoScrollX,
      taskDragAutoScrollY,
    );
    if (!target) return;
    const delta = taskDragAutoScrollDelta(target, taskDragAutoScrollY);
    if (!delta) return;
    target.scrollBy({ top: delta, behavior: "auto" });
    markPointerDropTarget({
      clientX: taskDragAutoScrollX,
      clientY: taskDragAutoScrollY,
    });
    taskDragAutoScrollFrame = window.requestAnimationFrame(
      runTaskDragAutoScroll,
    );
  }

  function scheduleTaskDragAutoScroll(event: {
    clientX: number;
    clientY: number;
  }): void {
    taskDragAutoScrollX = event.clientX;
    taskDragAutoScrollY = event.clientY;
    if (taskDragAutoScrollFrame) return;
    taskDragAutoScrollFrame = window.requestAnimationFrame(
      runTaskDragAutoScroll,
    );
  }

  function markTaskDropTarget(card: HTMLElement, after: boolean): void {
    clearTaskDropTargets();
    card.classList.add("drop-target");
    card.classList.toggle("drop-after", after);
  }

  function markColumnDropTarget(column: HTMLElement): void {
    clearTaskDropTargets();
    column.classList.add("drop-target");
  }

  function taskDropTargetFromPoint(event: {
    clientX: number;
    clientY: number;
  }): JournalTaskDropTarget | null {
    const element = document.elementFromPoint(
      event.clientX,
      event.clientY,
    ) as HTMLElement | null;
    if (!element) return null;
    const card = element.closest<HTMLElement>(".journal-task-card");
    if (card?.dataset.taskId && card.dataset.taskId !== draggingTaskId) {
      const after = isTaskDropAfter(card, event);
      return after
        ? { after_id: card.dataset.taskId }
        : { before_id: card.dataset.taskId };
    }
    const column = element.closest<HTMLElement>(".journal-task-column");
    const status = column?.dataset.status;
    return isJournalTaskStatus(status) ? { status } : null;
  }

  function finishNativeTaskDrag(event: DragEvent): void {
    const issue = draggingGithubIssue();
    if (!draggingTaskId && !issue) {
      clearTaskDropTargets();
      stopTaskDragAutoScroll();
      return;
    }
    const target = taskDropTargetFromPoint(event) || lastTaskDropTarget;
    if (!target) {
      if (issue) clearGithubIssueDragState();
      else clearTaskDragState();
      return;
    }
    lastTaskDropTarget = null;
    if (issue) void linkGithubIssueToTask(issue, target);
    else void moveDraggedTask(target);
  }

  function markPointerDropTarget(event: {
    clientX: number;
    clientY: number;
  }): void {
    const element = document.elementFromPoint(
      event.clientX,
      event.clientY,
    ) as HTMLElement | null;
    const card = element?.closest<HTMLElement>(".journal-task-card");
    if (card?.dataset.taskId && card.dataset.taskId !== draggingTaskId) {
      markTaskDropTarget(card, isTaskDropAfter(card, event));
      return;
    }
    const column = element?.closest<HTMLElement>(".journal-task-column");
    if (column) {
      markColumnDropTarget(column);
      return;
    }
    clearTaskDropTargets();
  }

  function beginPointerTaskDrag(taskId: string, event: PointerEvent): void {
    if (event.button !== 0) return;
    const source = event.currentTarget as HTMLElement | null;
    if (!source) return;
    if (!taskDragHandleFromTarget(source, event.target)) return;
    pointerDrag = {
      taskId,
      pointerId: event.pointerId,
      source,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
    };
    source.setPointerCapture?.(event.pointerId);
    document.addEventListener("pointermove", handlePointerTaskDragMove);
    document.addEventListener("pointerup", handlePointerTaskDragEnd);
    document.addEventListener("pointercancel", handlePointerTaskDragCancel);
  }

  function stopPointerTaskDragListeners(): void {
    document.removeEventListener("pointermove", handlePointerTaskDragMove);
    document.removeEventListener("pointerup", handlePointerTaskDragEnd);
    document.removeEventListener("pointercancel", handlePointerTaskDragCancel);
  }

  function handlePointerTaskDragMove(event: PointerEvent): void {
    if (!pointerDrag) return;
    if (event.pointerId !== pointerDrag.pointerId) return;
    const distance = Math.hypot(
      event.clientX - pointerDrag.startX,
      event.clientY - pointerDrag.startY,
    );
    if (!pointerDrag.active) {
      if (distance < 5) return;
      pointerDrag.active = true;
      draggingTaskId = pointerDrag.taskId;
      taskCardById(pointerDrag.taskId)?.classList.add("dragging");
    }
    event.preventDefault();
    scheduleTaskDragAutoScroll(event);
    markPointerDropTarget(event);
  }

  function handlePointerTaskDragEnd(event: PointerEvent): void {
    const state = pointerDrag;
    if (state && event.pointerId !== state.pointerId) return;
    pointerDrag = null;
    stopPointerTaskDragListeners();
    state?.source.releasePointerCapture?.(event.pointerId);
    if (!state?.active) return;
    const target = taskDropTargetFromPoint(event);
    if (target) void moveDraggedTask(target);
    else clearTaskDragState();
  }

  function handlePointerTaskDragCancel(event: PointerEvent): void {
    const state = pointerDrag;
    if (state && event.pointerId !== state.pointerId) return;
    pointerDrag = null;
    stopPointerTaskDragListeners();
    state?.source.releasePointerCapture?.(event.pointerId);
    if (nativeTaskDragActive) return;
    clearTaskDragState();
  }

  async function moveDraggedTask(target: JournalTaskDropTarget): Promise<void> {
    const id = draggingTaskId;
    clearTaskDragState();
    if (!id) return;
    try {
      await requestJournal("move-task", { id, ...target }, () => {
        selectedTaskId = id;
      });
    } catch (error) {
      message = error instanceof Error ? error.message : text().moveTaskFailed;
      deps.setStatus("error");
      render();
    }
  }

  function renderQueuePreview(): HTMLElement {
    const queue = document.createElement("section");
    queue.className = "journal-command-preview journal-queue";
    const title = document.createElement("strong");
    title.textContent = text().aiQueue;
    const command = document.createElement("code");
    command.textContent = labelFilter
      ? `code-viewer journal task-next --label ${labelFilter} --limit 5`
      : "code-viewer journal task-next --limit 5";
    queue.append(title, command);
    const next = data
      ? selectNextJournalTasks(
          data.tasks,
          { labels: labelFilter ? [labelFilter] : [] },
          5,
        )
      : [];
    if (next.length) {
      const list = document.createElement("ol");
      for (const task of next) {
        const item = document.createElement("li");
        item.textContent = `${text().priorityLabels[task.priority]} ${task.title}`;
        list.appendChild(item);
      }
      queue.appendChild(list);
    }
    return queue;
  }

  function renderGithubIssueToggle(): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "journal-github-toggle";
    button.classList.toggle("active", githubInboxOpen);
    button.setAttribute("aria-expanded", githubInboxOpen ? "true" : "false");
    button.innerHTML = iconSvg(
      "journal-github-toggle-icon",
      COMMENT_DISCUSSION_16_PATH,
    );
    const label = document.createElement("span");
    label.textContent = text().githubIssues;
    button.appendChild(label);
    const count = document.createElement("span");
    count.className = "journal-github-toggle-count";
    count.textContent = githubIssuesLoading
      ? "..."
      : githubIssuesLoaded
        ? String(githubIssues.length)
        : "0";
    button.appendChild(count);
    button.addEventListener("click", () => {
      githubInboxOpen = !githubInboxOpen;
      render();
      if (
        githubInboxOpen &&
        !githubIssuesAutoRequested &&
        !githubIssuesLoading
      ) {
        void loadGithubIssues();
      }
    });
    return button;
  }

  function issueLabel(issueNumber: number): string {
    return journalIssueLabel(issueNumber);
  }

  function linkedTaskForIssue(issueNumber: number): JournalTask | null {
    const label = issueLabel(issueNumber);
    const repoLabel = journalIssueRepoLabel(githubRepoFilter || undefined);
    return (
      data?.tasks.tasks.find((task) => {
        if (!task.labels.includes("github") || !task.labels.includes(label)) {
          return false;
        }
        if (repoLabel) return task.labels.includes(repoLabel);
        return !task.labels.some((taskLabel) => taskLabel.startsWith("repo-"));
      }) || null
    );
  }

  function githubIssueStateLabel(state: string): string {
    if (state === "open" || state === "closed" || state === "all") {
      return text().githubStateLabels[state];
    }
    return state;
  }

  function closeGithubInbox(): void {
    if (!githubInboxOpen) return;
    githubInboxOpen = false;
    render();
  }

  function handleGithubInboxKeydown(event: KeyboardEvent): void {
    if (event.key !== "Escape" || !githubInboxOpen) return;
    closeGithubInbox();
  }

  function handleGithubInboxOutsidePointerDown(event: PointerEvent): void {
    if (!githubInboxOpen) return;
    const target = event.target as Node | null;
    const panel = root.querySelector<HTMLElement>(".journal-github-panel");
    const toggle = root.querySelector<HTMLElement>(".journal-github-toggle");
    if (target && (panel?.contains(target) || toggle?.contains(target))) return;
    closeGithubInbox();
  }

  function resetGithubIssueFilters(shouldRender = true): void {
    githubIssueGeneration++;
    githubIssueLimit = GITHUB_ISSUE_INITIAL_LIMIT;
    githubIssues = [];
    githubIssuesLoaded = false;
    githubIssuesLoading = false;
    githubIssuesAutoRequested = false;
    githubIssuesError =
      githubRetrySeconds() > 0
        ? text().githubRateLimited(githubRetrySeconds())
        : "";
    if (shouldRender) render();
  }

  function stableGithubIssues(issues: GithubIssueItem[]): GithubIssueItem[] {
    const byNumber = new Map<number, GithubIssueItem>();
    for (const issue of issues) byNumber.set(issue.number, issue);
    return [...byNumber.values()].sort((a, b) => b.number - a.number);
  }

  function githubRetrySeconds(): number {
    return Math.max(0, Math.ceil((githubIssuesRetryAt - Date.now()) / 1000));
  }

  function githubCanRequest(): boolean {
    return !githubIssuesLoading && githubRetrySeconds() === 0;
  }

  async function loadGithubIssues(limit = githubIssueLimit): Promise<void> {
    if (!githubCanRequest()) {
      render();
      return;
    }
    const seq = ++githubIssueGeneration;
    githubIssuesAutoRequested = true;
    githubIssuesLoading = true;
    githubIssueLimit = Math.min(
      Math.max(GITHUB_ISSUE_INITIAL_LIMIT, limit),
      GITHUB_ISSUE_LIMIT_MAX,
    );
    githubIssuesError = "";
    render();
    deps.setStatus("refreshing");
    try {
      const res = await deps.trackLoad(
        fetch("/_journal", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Code-Viewer-Action": "1",
          },
          body: JSON.stringify({
            action: "list-github-issues",
            repo: githubRepoFilter || undefined,
            labels: parseGithubLabels(githubLabelFilter),
            search: githubSearchFilter || undefined,
            state: githubStateFilter,
            limit: githubIssueLimit,
          }),
        }),
      );
      if (!res.ok) throw new Error(await res.text());
      const response = (await res.json()) as GithubIssueListResponse;
      if (seq !== githubIssueGeneration) return;
      githubIssues = stableGithubIssues(response.issues || []);
      githubIssuesLoaded = true;
      deps.setStatus("live");
    } catch (error) {
      if (seq !== githubIssueGeneration) return;
      if (
        error instanceof Error &&
        /rate limit|secondary rate limit/i.test(error.message)
      ) {
        githubIssuesRetryAt = Date.now() + GITHUB_ISSUE_RATE_LIMIT_RETRY_MS;
        githubIssuesError = text().githubRateLimited(githubRetrySeconds());
        window.setTimeout(() => {
          if (githubRetrySeconds() === 0) {
            githubIssuesError = "";
            render();
          }
        }, GITHUB_ISSUE_RATE_LIMIT_RETRY_MS + 50);
      } else {
        githubIssuesError =
          error instanceof Error ? error.message : text().githubLoadFailed;
      }
      githubIssuesLoaded = false;
      deps.setStatus("error");
    } finally {
      if (seq === githubIssueGeneration) {
        githubIssuesLoading = false;
        render();
      }
    }
  }

  async function linkGithubIssueToTask(
    issue: GithubIssueItem,
    target: {
      status?: JournalTaskStatus;
      before_id?: string;
      after_id?: string;
    },
  ): Promise<string | null> {
    try {
      const response = await requestJournal("link-github-issue", {
        issue_number: issue.number,
        repo: githubRepoFilter || undefined,
        title: issue.title,
        url: issue.url,
        memo_label: text().githubMemoLabel,
        status: target.status,
        before_id: target.before_id,
        after_id: target.after_id,
        priority: "p2",
        labels: normalizeJournalLabels([labelFilter]),
      });
      if (response.task) {
        selectedTaskId = response.task.id;
        githubInboxOpen = false;
        render();
        return response.task.id;
      }
    } catch (error) {
      message =
        error instanceof Error ? error.message : text().githubLinkTaskFailed;
      deps.setStatus("error");
      render();
    } finally {
      stopTaskDragAutoScroll();
      draggingGithubIssueNumber = null;
    }
    return null;
  }

  function draggingGithubIssue(): GithubIssueItem | null {
    if (draggingGithubIssueNumber === null) return null;
    return (
      githubIssues.find(
        (issue) => issue.number === draggingGithubIssueNumber,
      ) || null
    );
  }

  function githubIssueFromDataTransfer(
    dataTransfer: DataTransfer | null,
  ): GithubIssueItem | null {
    const raw = dataTransfer?.getData("text/plain") || "";
    const match = raw.trim().match(/^#?(\d+)$/);
    if (!match) return null;
    const issueNumber = Number(match[1]);
    if (!Number.isInteger(issueNumber)) return null;
    return githubIssues.find((issue) => issue.number === issueNumber) || null;
  }

  function renderGithubIssueCard(issue: GithubIssueItem): HTMLElement {
    const card = document.createElement("article");
    card.className = "journal-github-issue-card";
    card.dataset.issueNumber = String(issue.number);
    const linked = linkedTaskForIssue(issue.number);
    card.draggable = !linked;
    if (linked) card.classList.add("linked");
    if (!linked) {
      card.addEventListener("dragstart", (event) => {
        draggingGithubIssueNumber = issue.number;
        lastTaskDropTarget = null;
        event.dataTransfer?.setData("text/plain", `#${issue.number}`);
        if (event.dataTransfer) event.dataTransfer.effectAllowed = "copyMove";
      });
      card.addEventListener("dragend", (event) => finishNativeTaskDrag(event));
    }
    const head = document.createElement("div");
    head.className = "journal-github-issue-head";
    const number = document.createElement("span");
    number.textContent = `#${issue.number}`;
    const state = document.createElement("span");
    state.textContent = githubIssueStateLabel(issue.state);
    head.append(number, state);
    if (linked) {
      const linkedBadge = document.createElement("span");
      linkedBadge.className = "journal-github-linked";
      linkedBadge.textContent = text().githubLinked;
      head.appendChild(linkedBadge);
    }
    const title = document.createElement("strong");
    title.textContent = issue.title;
    const labels = document.createElement("div");
    labels.className = "journal-github-issue-labels";
    for (const label of issue.labels.slice(0, 4)) {
      labels.appendChild(labelChip(label));
    }
    const action = document.createElement("button");
    action.type = "button";
    action.draggable = false;
    action.className = "journal-github-issue-action";
    action.textContent = linked
      ? text().githubOpenTask
      : text().githubAddToBoard;
    action.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (linked) {
        githubInboxOpen = false;
        selectTask(linked.id, { focusEditor: true, revealEditor: true });
        return;
      }
      action.disabled = true;
      const taskId = await linkGithubIssueToTask(issue, { status: "draft" });
      if (taskId) selectTask(taskId, { focusEditor: true, revealEditor: true });
    });
    card.append(head, title, labels, action);
    return card;
  }

  function renderGithubIssuesPanel(): HTMLElement {
    const panel = document.createElement("section");
    panel.className = "journal-github-panel";
    const title = document.createElement("strong");
    title.textContent = text().githubIssues;
    const controls = document.createElement("div");
    controls.className = "journal-github-controls";
    const repo = document.createElement("input");
    repo.type = "text";
    repo.placeholder = text().githubRepoPlaceholder;
    repo.value = githubRepoFilter;
    const ghLabel = document.createElement("input");
    ghLabel.type = "text";
    ghLabel.placeholder = text().githubLabelPlaceholder;
    ghLabel.value = githubLabelFilter;
    const search = document.createElement("input");
    search.type = "search";
    search.placeholder = text().githubSearchPlaceholder;
    search.value = githubSearchFilter;
    const state = document.createElement("select");
    for (const value of ["open", "closed", "all"] as const) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = text().githubStateLabels[value];
      option.selected = value === githubStateFilter;
      state.appendChild(option);
    }
    const syncControls = (shouldRender = true, shouldLoad = shouldRender) => {
      const nextState =
        state.value === "closed" || state.value === "all"
          ? state.value
          : "open";
      const nextRepo = repo.value.trim();
      const nextLabel = ghLabel.value.trim();
      const nextSearch = search.value.trim();
      const changed =
        nextRepo !== githubRepoFilter ||
        nextLabel !== githubLabelFilter ||
        nextSearch !== githubSearchFilter ||
        nextState !== githubStateFilter;
      githubRepoFilter = nextRepo;
      githubLabelFilter = nextLabel;
      githubSearchFilter = nextSearch;
      githubStateFilter = nextState;
      if (!changed) return;
      resetGithubIssueFilters(shouldRender);
      if (shouldLoad && githubInboxOpen) void loadGithubIssues();
    };
    const loadOnEnter = (event: KeyboardEvent) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      syncControls(false, false);
      void loadGithubIssues();
    };
    repo.addEventListener("change", () => syncControls());
    repo.addEventListener("keydown", loadOnEnter);
    ghLabel.addEventListener("change", () => syncControls());
    ghLabel.addEventListener("keydown", loadOnEnter);
    search.addEventListener("change", () => syncControls());
    search.addEventListener("keydown", loadOnEnter);
    state.addEventListener("change", () => syncControls());
    const load = document.createElement("button");
    load.type = "button";
    load.textContent = githubIssuesLoading
      ? text().githubLoading
      : text().githubLoad;
    load.disabled = !githubCanRequest();
    load.addEventListener("click", () => {
      syncControls(false, false);
      void loadGithubIssues();
    });
    controls.append(repo, ghLabel, search, state, load);
    const hint = document.createElement("p");
    hint.className = "journal-github-hint";
    const showing =
      githubIssuesLoaded && !githubIssuesError
        ? ` ${text().githubShowing(githubIssues.length, githubIssueLimit)}`
        : "";
    hint.textContent =
      githubIssuesError || `${text().githubDragHint}${showing}`;
    const list = document.createElement("div");
    list.className = "journal-github-issues";
    list.addEventListener("dragover", (event) => {
      if (!draggingGithubIssue()) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      scheduleTaskDragAutoScroll(event);
    });
    if (githubIssues.length) {
      for (const issue of githubIssues) {
        list.appendChild(renderGithubIssueCard(issue));
      }
    } else {
      const empty = document.createElement("div");
      empty.className = "journal-empty";
      empty.textContent = githubIssuesLoading
        ? text().githubLoading
        : githubIssuesLoaded
          ? text().githubNoIssues
          : text().githubNotLoaded;
      list.appendChild(empty);
    }
    const head = document.createElement("div");
    head.className = "journal-github-panel-head";
    const close = document.createElement("button");
    close.type = "button";
    close.className = "journal-github-close";
    close.title = text().githubClose;
    close.setAttribute("aria-label", text().githubClose);
    close.innerHTML = iconSvg("journal-github-close-icon", X_16_PATH);
    close.addEventListener("click", () => {
      closeGithubInbox();
    });
    head.append(title, close);
    panel.append(head, controls, hint, list);
    if (
      githubIssuesLoaded &&
      githubIssues.length >= githubIssueLimit &&
      githubIssueLimit < GITHUB_ISSUE_LIMIT_MAX
    ) {
      const more = document.createElement("button");
      more.type = "button";
      more.className = "journal-github-load-more";
      more.textContent = text().githubLoadMore;
      more.disabled = !githubCanRequest();
      more.addEventListener("click", () =>
        loadGithubIssues(githubIssueLimit + GITHUB_ISSUE_LIMIT_STEP),
      );
      panel.appendChild(more);
    }
    return panel;
  }

  function taskLabelCounts(): Map<string, number> {
    const counts = new Map<string, number>();
    for (const task of data?.tasks.tasks || []) {
      for (const label of task.labels) {
        counts.set(label, (counts.get(label) || 0) + 1);
      }
    }
    return counts;
  }

  function renderLabelFilterButton(
    label: string,
    count: number,
    active: boolean,
    value = label,
  ): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "journal-label-filter";
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
    const name = document.createElement("span");
    name.className = "journal-label-filter-name";
    name.textContent = label;
    const badge = document.createElement("span");
    badge.className = "journal-label-filter-count";
    badge.textContent = String(count);
    button.append(name, badge);
    button.addEventListener("click", () => {
      labelFilter = active ? "" : value;
      setRoute({ tab: "tasks", label: labelFilter || undefined });
    });
    return button;
  }

  function renderLabelFilters(): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "journal-label-filters";
    wrap.setAttribute("aria-label", text().labelFilters);
    const counts = taskLabelCounts();
    const total = data?.tasks.tasks.length || 0;
    wrap.appendChild(
      renderLabelFilterButton(text().allLabels, total, !labelFilter, ""),
    );
    for (const [label, count] of [...counts.entries()].sort((a, b) =>
      a[0].localeCompare(b[0]),
    )) {
      wrap.appendChild(
        renderLabelFilterButton(label, count, label === labelFilter),
      );
    }
    return wrap;
  }

  function renderTaskBoard(): HTMLElement {
    const board = document.createElement("div");
    board.className = "journal-task-board";
    for (const status of JOURNAL_TASK_STATUSES) {
      const column = document.createElement("section");
      column.className = `journal-task-column journal-task-column-${status}`;
      column.dataset.status = status;
      column.addEventListener("dragover", (event) => {
        const issue =
          draggingGithubIssue() ||
          githubIssueFromDataTransfer(event.dataTransfer);
        if (!draggingTaskId && !issue) return;
        const targetCard = (event.target as HTMLElement | null)?.closest(
          ".journal-task-card",
        );
        if (targetCard && column.contains(targetCard)) return;
        event.preventDefault();
        if (event.dataTransfer)
          event.dataTransfer.dropEffect = issue ? "copy" : "move";
        scheduleTaskDragAutoScroll(event);
        lastTaskDropTarget = { status };
        markColumnDropTarget(column);
      });
      column.addEventListener("dragleave", (event) => {
        const related = event.relatedTarget as Node | null;
        if (related && column.contains(related)) return;
        lastTaskDropTarget = null;
        column.classList.remove("drop-target");
      });
      column.addEventListener("drop", (event) => {
        const issue = draggingGithubIssue();
        if (!draggingTaskId && !issue) return;
        const targetCard = (event.target as HTMLElement | null)?.closest(
          ".journal-task-card",
        );
        if (targetCard && column.contains(targetCard)) return;
        event.preventDefault();
        lastTaskDropTarget = null;
        if (issue) void linkGithubIssueToTask(issue, { status });
        else void moveDraggedTask({ status });
      });
      const head = document.createElement("div");
      head.className = "journal-task-column-head";
      const title = document.createElement("strong");
      title.textContent = text().statusLabels[status];
      const count = document.createElement("span");
      const tasks = (data?.tasks.tasks || []).filter(
        (task) => task.status === status && taskVisible(task),
      );
      count.textContent = String(tasks.length);
      head.append(title, count);
      column.appendChild(head);
      if (!tasks.length) {
        const empty = document.createElement("div");
        empty.className = "journal-column-empty";
        empty.textContent = text().empty;
        column.appendChild(empty);
      }
      for (const task of tasks) column.appendChild(renderTaskCard(task));
      board.appendChild(column);
    }
    return board;
  }

  function insertMarkdown(
    textarea: HTMLTextAreaElement,
    before: string,
    after = "",
  ): void {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = textarea.value.slice(start, end);
    textarea.value =
      textarea.value.slice(0, start) +
      before +
      selected +
      after +
      textarea.value.slice(end);
    textarea.focus();
    textarea.selectionStart = start + before.length;
    textarea.selectionEnd = end + before.length;
  }

  async function renderTaskPreview(
    host: HTMLElement,
    body: string,
  ): Promise<void> {
    host.replaceChildren();
    const rendered = await renderMarkdownPreview(
      body || `_${text().noBody}_`,
      { path: "journal-task.md", ref: "worktree" },
      { syntaxHighlight: false },
    );
    host.appendChild(rendered);
  }

  function renderTaskEditor(): HTMLElement {
    const task = selectedTask();
    const panel = document.createElement("aside");
    panel.className = "journal-task-editor";
    const resizer = document.createElement("div");
    resizer.className = "journal-task-editor-resizer";
    resizer.role = "separator";
    resizer.tabIndex = 0;
    resizer.setAttribute("aria-orientation", "vertical");
    resizer.setAttribute("aria-label", text().resizeTaskPanel);
    resizer.addEventListener("pointerdown", (event) =>
      startTaskEditorResize(event, panel),
    );
    const heading = document.createElement("div");
    heading.className = "journal-section-head";
    const titleText = document.createElement("strong");
    titleText.textContent = task ? text().taskHeading : text().newTaskHeading;
    const newTask = document.createElement("button");
    newTask.type = "button";
    newTask.innerHTML = `${iconSvg("octicon-plus", PLUS_16_PATH)}<span>${text().new}</span>`;
    newTask.addEventListener("click", () => {
      selectedTaskId = "";
      setRoute({ tab: "tasks", task: undefined });
    });
    heading.append(titleText, newTask);

    const title = document.createElement("input");
    title.className = "journal-title-input";
    title.placeholder = text().titlePlaceholder;
    title.value = task?.title || "";
    const row = document.createElement("div");
    row.className = "journal-task-fields";
    const status = document.createElement("select");
    for (const value of JOURNAL_TASK_STATUSES) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = text().statusLabels[value];
      option.selected = (task?.status || "todo") === value;
      status.appendChild(option);
    }
    const priority = document.createElement("select");
    for (const value of JOURNAL_TASK_PRIORITIES) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = text().priorityLabels[value];
      option.selected = (task?.priority || "p2") === value;
      priority.appendChild(option);
    }
    const due = document.createElement("input");
    due.type = "date";
    due.title = text().endDate;
    due.setAttribute("aria-label", text().endDate);
    due.value = task?.due_date || "";
    const sourceDate = document.createElement("input");
    sourceDate.type = "date";
    sourceDate.title = text().startDate;
    sourceDate.setAttribute("aria-label", text().startDate);
    sourceDate.value = task?.source_date || selectedDate;
    row.append(
      taskField(text().statusField, status),
      taskField(text().priorityField, priority),
      taskField(text().startDate, sourceDate),
      taskField(text().endDate, due),
    );

    const labels = createLabelEditor(
      task ? task.labels : normalizeJournalLabels([labelFilter]),
      text().labelPlaceholder,
      labelSuggestions(),
      text().removeLabel,
    );

    const toolbar = document.createElement("div");
    toolbar.className = "journal-markdown-toolbar";
    const body = document.createElement("textarea");
    body.className = "journal-body-input journal-task-body-input";
    body.placeholder = text().taskBodyPlaceholder;
    body.value = task?.body || "";
    const preview = document.createElement("div");
    preview.className = "journal-markdown-preview";
    const syncMode = () => {
      body.hidden = editorMode === "preview";
      preview.hidden = editorMode === "write";
      void renderTaskPreview(preview, body.value);
    };
    for (const spec of [
      ["B", "**", "**"],
      ["`", "`", "`"],
      ["[]", "- [ ] ", ""],
      [">", "> ", ""],
    ] as const) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = spec[0];
      button.addEventListener("click", () =>
        insertMarkdown(body, spec[1], spec[2]),
      );
      toolbar.appendChild(button);
    }
    const modes = document.createElement("div");
    modes.className = "seg journal-editor-mode";
    for (const mode of ["write", "preview", "split"] as const) {
      const button = document.createElement("button");
      button.type = "button";
      button.classList.toggle("active", editorMode === mode);
      button.textContent = text().editorModes[mode];
      button.addEventListener("click", () => {
        editorMode = mode;
        render();
      });
      modes.appendChild(button);
    }
    toolbar.appendChild(modes);
    body.addEventListener("input", () => {
      if (editorMode !== "write") void renderTaskPreview(preview, body.value);
    });
    syncMode();

    const actions = document.createElement("div");
    actions.className = "journal-editor-actions";
    const save = document.createElement("button");
    save.type = "button";
    save.className = "journal-primary-action";
    save.textContent = task ? text().saveTask : text().addTask;
    save.addEventListener("click", async () => {
      setButtonBusy(save, true);
      const payload = {
        title: title.value,
        status: status.value,
        priority: priority.value,
        labels: labels.getLabels(),
        due_date: due.value || null,
        source_date: sourceDate.value || null,
        body: body.value,
      };
      try {
        if (task)
          await requestJournal("update-task", { id: task.id, ...payload });
        else {
          const response = await requestJournal("add-task", payload, (next) => {
            if (next.task) selectedTaskId = next.task.id;
          });
          if (response.task) setRoute({ tab: "tasks", task: response.task.id });
        }
      } catch (error) {
        message =
          error instanceof Error ? error.message : text().saveTaskFailed;
        deps.setStatus("error");
        render();
      } finally {
        setButtonBusy(save, false);
      }
    });
    actions.appendChild(save);
    if (task) {
      const claim = document.createElement("button");
      claim.type = "button";
      claim.textContent = text().claim;
      claim.addEventListener("click", async () => {
        setButtonBusy(claim, true);
        try {
          await requestJournal("claim-task", { id: task.id, by: "user" });
        } catch (error) {
          message =
            error instanceof Error ? error.message : text().claimTaskFailed;
          deps.setStatus("error");
          render();
        } finally {
          setButtonBusy(claim, false);
        }
      });
      const done = document.createElement("button");
      done.type = "button";
      done.textContent = text().done;
      done.disabled = task.status !== "doing" || task.claim?.by !== "user";
      done.addEventListener("click", async () => {
        setButtonBusy(done, true);
        try {
          await requestJournal("complete-task", {
            id: task.id,
            by: "user",
            source: "user",
          });
        } catch (error) {
          message =
            error instanceof Error ? error.message : text().doneTaskFailed;
          deps.setStatus("error");
          render();
        } finally {
          setButtonBusy(done, false);
        }
      });
      const del = document.createElement("button");
      del.type = "button";
      del.className = "journal-danger-action";
      del.innerHTML = `${iconSvg("octicon-trash", TRASH_16_PATH)}<span>${text().delete}</span>`;
      del.addEventListener("click", async () => {
        const ok = await showConfirmDialog({
          title: `${text().delete}?`,
          body: task.title,
          confirmLabel: text().delete,
          danger: true,
          focusReturnTarget: del,
        });
        if (!ok) return;
        setButtonBusy(del, true);
        try {
          const result = await requestJournal("delete-task", { id: task.id });
          if (!result.removed) throw new Error(text().deleteTaskFailed);
          selectedTaskId = "";
          setRoute({ tab: "tasks", task: undefined });
        } catch (error) {
          message =
            error instanceof Error ? error.message : text().deleteTaskFailed;
          deps.setStatus("error");
          render();
        } finally {
          setButtonBusy(del, false);
        }
      });
      actions.append(claim, done, del);
    }

    panel.append(
      resizer,
      heading,
      title,
      row,
      labels.element,
      toolbar,
      body,
      preview,
      actions,
    );
    return panel;
  }

  function renderTasksTab(): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "journal-tasks-layout";
    const toolbar = document.createElement("div");
    toolbar.className = "journal-task-toolbar";
    const labelInput = document.createElement("input");
    labelInput.type = "search";
    labelInput.placeholder = text().labelFilterPlaceholder;
    labelInput.value = labelFilter;
    labelInput.addEventListener("change", () => {
      labelFilter = normalizeJournalLabel(labelInput.value) || "";
      setRoute({ tab: "tasks", label: labelFilter || undefined });
    });
    toolbar.append(
      labelInput,
      renderQueuePreview(),
      renderGithubIssueToggle(),
      renderLabelFilters(),
    );
    if (githubInboxOpen) toolbar.appendChild(renderGithubIssuesPanel());
    const boardWrap = document.createElement("div");
    boardWrap.className = "journal-task-board-wrap";
    boardWrap.appendChild(renderTaskBoard());
    wrap.append(toolbar, boardWrap, renderTaskEditor());
    return wrap;
  }

  function render(): void {
    root.setAttribute("aria-label", text().ariaLabel);
    root.replaceChildren(renderHeader());
    const content = document.createElement("div");
    content.className = "journal-content";
    content.appendChild(
      activeTab === "journal" ? renderJournalTab() : renderTasksTab(),
    );
    root.appendChild(content);
    if (pendingTaskEditorFocus || pendingTaskEditorReveal)
      scheduleTaskEditorInteraction();
  }

  async function enter(): Promise<void> {
    applyRoute();
    mount();
    render();
    await refresh();
  }

  function handleSse(): void {
    if (!mounted) return;
    if (
      draggingTaskId ||
      draggingGithubIssueNumber !== null ||
      pointerDrag ||
      journalEditorHasFocus()
    )
      return;
    void refresh();
  }

  function localize(): void {
    if (mounted) render();
  }

  restoreTaskEditorWidth();
  document.addEventListener("keydown", handleGithubInboxKeydown);
  document.addEventListener("pointerdown", handleGithubInboxOutsidePointerDown);
  window.addEventListener("pointermove", handleTaskEditorResizeMove);
  window.addEventListener("pointerup", finishTaskEditorResize);
  window.addEventListener("pointercancel", finishTaskEditorResize);
  window.addEventListener("resize", () => {
    const layout = root.querySelector<HTMLElement>(".journal-tasks-layout");
    if (layout && layout.clientWidth <= 1100) return;
    const panel = root.querySelector<HTMLElement>(".journal-task-editor");
    if (panel) applyTaskEditorWidth(panel.getBoundingClientRect().width, false);
  });

  return { enter, suspend, handleSse, localize };
}
