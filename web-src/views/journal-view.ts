import { keyed } from "lit/directives/keyed.js";
import { html, nothing } from "lit/html.js";
import { apiUrl } from "../core/api-url";
import { formatErrorDetail, responseErrorMessage } from "../core/error-detail";
import {
  COMMENT_DISCUSSION_16_PATH,
  GRABBER_16_PATH,
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
import {
  readStoredSize,
  reportStoredSizeFailure,
  writeStoredSize,
} from "../core/stored-size";
import type { PageView } from "./page-view";
import { iconTemplate } from "./ui/icon";
import { detachedElement, renderOwned, templateElement } from "./ui/renderer";
import { showConfirmDialog } from "./ui-dialog";

export type JournalViewText = {
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

export type JournalView = PageView & { resetProject(): void };

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

/** ラベルを足す欄 (日誌とタスクの 2 か所)。 */
export type JournalLabelEditorProps = {
  labels: { name: string; removeLabel: string; onRemove(event: Event): void }[];
  placeholder: string;
  quick: { label: string; onPick(event: Event): void }[];
  /** 打っている語の候補 (欄にフォーカスがあるときだけ)。 */
  suggestions: { label: string; active: boolean; onPick(event: Event): void }[];
  onClick(): void;
  input: {
    onKeyDown(event: KeyboardEvent): void;
    onInput(): void;
    onFocus(): void;
    onPaste(event: ClipboardEvent): void;
    onBlur(): void;
  };
};

export type JournalButtonProps = { label: string; onClick(event: Event): void };

/** タスクの札 (ボードと、日誌の横の関係するタスク)。 */
export type JournalTaskCardProps = {
  id: string;
  selected: boolean;
  compact: boolean;
  priority: { value: string; label: string };
  status: string;
  dragTitle: string;
  title: string;
  labels: string[];
  due: string | null;
  claim: string | null;
  /** 引いて並べ替える (札の要素は event.currentTarget)。 */
  on: {
    click(event: MouseEvent): void;
    dragstart(event: DragEvent): void;
    dragenter(event: DragEvent): void;
    dragover(event: DragEvent): void;
    dragleave(event: DragEvent): void;
    drop(event: DragEvent): void;
    dragend(event: DragEvent): void;
    pointerdown(event: PointerEvent): void;
  };
};

export type JournalHeaderProps = {
  title: string;
  tabs: { label: string; active: boolean; onClick(): void }[];
  refresh: JournalButtonProps;
  status: string;
};

export type JournalDailyProps = {
  date: { value: string; onChange(value: string): void };
  newEntry: JournalButtonProps;
  entries: { label: string; active: boolean; onClick(): void }[];
  noEntries: string;
  title: { value: string; placeholder: string };
  labels: HTMLElement;
  body: { value: string; placeholder: string };
  save: JournalButtonProps;
  remove: JournalButtonProps | null;
  related: { heading: string; empty: string; cards: JournalTaskCardProps[] };
};

export type JournalGithubIssueProps = {
  number: number;
  state: string;
  linked: string | null;
  title: string;
  labels: string[];
  action: JournalButtonProps;
  onDragStart(event: DragEvent): void;
  onDragEnd(event: DragEvent): void;
};

export type JournalGithubPanelProps = {
  title: string;
  close: JournalButtonProps;
  repo: { value: string; placeholder: string };
  labels: { value: string; placeholder: string };
  search: { value: string; placeholder: string };
  state: { options: { value: string; label: string; selected: boolean }[] };
  /** 欄を変えた (中身は欄から読む)・Enter で読む。 */
  onChange(event: Event): void;
  onEnter(event: KeyboardEvent): void;
  load: { label: string; disabled: boolean; onClick(event: Event): void };
  hint: string;
  onListDragOver(event: DragEvent): void;
  issues: JournalGithubIssueProps[];
  empty: string;
  more: { label: string; disabled: boolean; onClick(): void } | null;
};

export type JournalTaskEditorProps = {
  resizer: { label: string; onPointerDown(event: PointerEvent): void };
  heading: string;
  newTask: JournalButtonProps;
  title: { value: string; placeholder: string };
  status: {
    label: string;
    options: { value: string; label: string; selected: boolean }[];
  };
  priority: {
    label: string;
    options: { value: string; label: string; selected: boolean }[];
  };
  start: { label: string; value: string };
  end: { label: string; value: string };
  labels: HTMLElement;
  tools: { label: string; onClick(event: Event): void }[];
  modes: { label: string; active: boolean; onClick(): void }[];
  body: {
    value: string;
    placeholder: string;
    hidden: boolean;
    onInput(event: Event): void;
  };
  previewHidden: boolean;
  save: JournalButtonProps;
  /** 既にあるタスクだけ。 */
  task: {
    claim: JournalButtonProps;
    done: JournalButtonProps & { disabled: boolean };
    remove: JournalButtonProps;
  } | null;
};

export type JournalTasksProps = {
  filter: { value: string; placeholder: string; onChange(value: string): void };
  queue: { title: string; command: string; items: string[] };
  githubToggle: {
    active: boolean;
    label: string;
    count: string;
    onClick(): void;
  };
  labelFilters: {
    label: string;
    buttons: {
      name: string;
      count: number;
      active: boolean;
      onClick(): void;
    }[];
  };
  github: JournalGithubPanelProps | null;
  columns: {
    status: string;
    title: string;
    count: number;
    empty: string;
    cards: JournalTaskCardProps[];
    on: {
      dragover(event: DragEvent): void;
      dragleave(event: DragEvent): void;
      drop(event: DragEvent): void;
    };
  }[];
  editor: JournalTaskEditorProps;
};

/** ワークログの画面 (createJournalView) の描き方。 */
export type JournalViewView = {
  root(): unknown;
  page(props: {
    header: JournalHeaderProps;
    daily: JournalDailyProps | null;
    tasks: JournalTasksProps | null;
  }): unknown;
  labelEditor(props: JournalLabelEditorProps): unknown;
};

const chipTemplate = (label: string) =>
  html`<span class="journal-label-chip">${label}</span>`;

const iconLabelButton = (
  cls: string,
  icon: { paths: string | string[]; cls: string },
  props: JournalButtonProps,
) => html`<button type="button" class=${cls} @click=${props.onClick}
  >${iconTemplate(icon.paths, icon.cls)}<span>${props.label}</span></button
>`;

function taskCardTemplate(card: JournalTaskCardProps): unknown {
  const cls = [
    "journal-task-card",
    card.selected ? "selected" : "",
    card.compact ? "compact" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return html`<button
    type="button"
    class=${cls}
    data-task-id=${card.id}
    @click=${card.on.click}
    @dragstart=${card.on.dragstart}
    @dragenter=${card.on.dragenter}
    @dragover=${card.on.dragover}
    @dragleave=${card.on.dragleave}
    @drop=${card.on.drop}
    @dragend=${card.on.dragend}
    @pointerdown=${card.on.pointerdown}
  ><span class="journal-task-card-top"><span
        class=${`journal-priority journal-priority-${card.priority.value}`}
      >${card.priority.label}</span><span class="journal-task-status"
        >${card.status}</span
      ><span
        class="journal-task-drag-handle"
        draggable="true"
        title=${card.dragTitle}
        aria-hidden="true"
      >${iconTemplate(GRABBER_16_PATH, "journal-task-drag-icon")}</span></span
    ><strong>${card.title}</strong><span class="journal-task-labels"
      >${card.labels.map(chipTemplate)}</span
    >${card.due === null ? nothing : html`<span class="journal-task-due">${card.due}</span>`}${
      card.claim === null
        ? nothing
        : html`<span class="journal-task-claim">${card.claim}</span>`
    }</button>`;
}

const headerTemplate = (props: JournalHeaderProps) => html`<div
  class="journal-header"
><div class="journal-title">${props.title}</div><div
    class="seg journal-tabs"
    role="tablist"
  >${props.tabs.map(
    (tab) => html`<button
      type="button"
      class=${tab.active ? "active" : ""}
      @click=${tab.onClick}
    >${tab.label}</button>`,
  )}</div><button
    type="button"
    class="global-icon-action journal-icon-action"
    title=${props.refresh.label}
    aria-label=${props.refresh.label}
    @click=${props.refresh.onClick}
  >${iconTemplate(SYNC_16_PATH, "octicon-sync")}</button><span
    class="journal-status"
    ?hidden=${!props.status}
    role="status"
  >${props.status}</span></div>`;

const dailyTemplate = (props: JournalDailyProps) => html`<div
  class="journal-daily-layout"
><section class="journal-editor"><div class="journal-section-head"><input
        type="date"
        .value=${props.date.value}
        @change=${(event: Event) =>
          props.date.onChange((event.currentTarget as HTMLInputElement).value)}
      />${iconLabelButton(
        "gdp-btn gdp-btn-sm",
        { paths: PLUS_16_PATH, cls: "octicon-plus" },
        props.newEntry,
      )}</div
    ><div class="journal-entry-list">${
      props.entries.length
        ? props.entries.map(
            (entry) => html`<button
              type="button"
              class=${entry.active ? "journal-entry-row active" : "journal-entry-row"}
              @click=${entry.onClick}
            >${entry.label}</button>`,
          )
        : html`<div class="journal-empty">${props.noEntries}</div>`
    }</div><input
      class="journal-title-input"
      name="title"
      placeholder=${props.title.placeholder}
      .value=${props.title.value}
    />${props.labels}<textarea
      class="journal-body-input"
      name="body"
      placeholder=${props.body.placeholder}
      .value=${props.body.value}
    ></textarea><div class="journal-editor-actions"><button
        type="button"
        class="journal-primary-action"
        @click=${props.save.onClick}
      >${props.save.label}</button>${
        props.remove
          ? iconLabelButton(
              "journal-danger-action",
              { paths: TRASH_16_PATH, cls: "octicon-trash" },
              props.remove,
            )
          : nothing
      }</div></section
  ><aside class="journal-related"><h2>${props.related.heading}</h2>${
    props.related.cards.length
      ? props.related.cards.map(taskCardTemplate)
      : html`<div class="journal-empty">${props.related.empty}</div>`
  }</aside></div>`;

const field = (label: string, control: unknown) => html`<label
  class="journal-field"
  ><span class="journal-field-label">${label}</span>${control}</label
>`;

const optionsTemplate = (
  options: { value: string; label: string; selected: boolean }[],
) =>
  options.map(
    (option) =>
      html`<option value=${option.value} ?selected=${option.selected}
        >${option.label}</option
      >`,
  );

function githubPanelTemplate(props: JournalGithubPanelProps): unknown {
  return html`<section class="journal-github-panel"><div
      class="journal-github-panel-head"
    ><strong>${props.title}</strong><button
        type="button"
        class="journal-github-close"
        title=${props.close.label}
        aria-label=${props.close.label}
        @click=${props.close.onClick}
      >${iconTemplate(X_16_PATH, "journal-github-close-icon")}</button></div
    ><div class="journal-github-controls"><input
        type="text"
        name="repo"
        placeholder=${props.repo.placeholder}
        .value=${props.repo.value}
        @change=${props.onChange}
        @keydown=${props.onEnter}
      /><input
        type="text"
        name="labels"
        placeholder=${props.labels.placeholder}
        .value=${props.labels.value}
        @change=${props.onChange}
        @keydown=${props.onEnter}
      /><input
        type="search"
        name="search"
        placeholder=${props.search.placeholder}
        .value=${props.search.value}
        @change=${props.onChange}
        @keydown=${props.onEnter}
      /><select name="state" @change=${props.onChange}
        >${optionsTemplate(props.state.options)}</select
      ><button
        type="button"
        ?disabled=${props.load.disabled}
        @click=${props.load.onClick}
      >${props.load.label}</button></div
    ><p class="journal-github-hint">${props.hint}</p><div
      class="journal-github-issues"
      @dragover=${props.onListDragOver}
    >${
      props.issues.length
        ? props.issues.map(
            (issue) => html`<article
              class=${issue.linked ? "journal-github-issue-card linked" : "journal-github-issue-card"}
              data-issue-number=${String(issue.number)}
              draggable=${issue.linked ? "false" : "true"}
              @dragstart=${issue.linked ? undefined : issue.onDragStart}
              @dragend=${issue.linked ? undefined : issue.onDragEnd}
            ><div class="journal-github-issue-head"><span>#${issue.number}</span><span
                  >${issue.state}</span
                >${
                  issue.linked
                    ? html`<span class="journal-github-linked">${issue.linked}</span>`
                    : nothing
                }</div
              ><strong>${issue.title}</strong><div class="journal-github-issue-labels"
                >${issue.labels.map(chipTemplate)}</div
              ><button
                type="button"
                draggable="false"
                class="journal-github-issue-action"
                @click=${issue.action.onClick}
              >${issue.action.label}</button></article>`,
          )
        : html`<div class="journal-empty">${props.empty}</div>`
    }</div>${
      props.more
        ? html`<button
            type="button"
            class="journal-github-load-more"
            ?disabled=${props.more.disabled}
            @click=${props.more.onClick}
          >${props.more.label}</button>`
        : nothing
    }</section>`;
}

function taskEditorTemplate(props: JournalTaskEditorProps): unknown {
  return html`<aside class="journal-task-editor"><div
      class="journal-task-editor-resizer"
      role="separator"
      tabindex="0"
      aria-orientation="vertical"
      aria-label=${props.resizer.label}
      @pointerdown=${props.resizer.onPointerDown}
    ></div><div class="journal-section-head"><strong>${props.heading}</strong>${iconLabelButton(
      "gdp-btn gdp-btn-sm",
      { paths: PLUS_16_PATH, cls: "octicon-plus" },
      props.newTask,
    )}</div><input
      class="journal-title-input"
      name="title"
      placeholder=${props.title.placeholder}
      .value=${props.title.value}
    /><div class="journal-task-fields">${field(
      props.status.label,
      html`<select name="status">${optionsTemplate(props.status.options)}</select>`,
    )}${field(
      props.priority.label,
      html`<select name="priority">${optionsTemplate(props.priority.options)}</select>`,
    )}${field(
      props.start.label,
      html`<input
        type="date"
        name="source_date"
        title=${props.start.label}
        aria-label=${props.start.label}
        .value=${props.start.value}
      />`,
    )}${field(
      props.end.label,
      html`<input
        type="date"
        name="due_date"
        title=${props.end.label}
        aria-label=${props.end.label}
        .value=${props.end.value}
      />`,
    )}</div>${props.labels}<div class="journal-markdown-toolbar">${props.tools.map(
      (tool) => html`<button
        type="button"
        class="journal-toolbar-action"
        @click=${tool.onClick}
      >${tool.label}</button>`,
    )}<div class="seg journal-editor-mode">${props.modes.map(
      (mode) => html`<button
        type="button"
        class=${mode.active ? "active" : ""}
        @click=${mode.onClick}
      >${mode.label}</button>`,
    )}</div></div><textarea
      class="journal-body-input journal-task-body-input"
      name="body"
      placeholder=${props.body.placeholder}
      ?hidden=${props.body.hidden}
      .value=${props.body.value}
      @input=${props.body.onInput}
    ></textarea><div class="journal-markdown-preview" ?hidden=${props.previewHidden}></div
    ><div class="journal-editor-actions"><button
        type="button"
        class="journal-primary-action"
        @click=${props.save.onClick}
      >${props.save.label}</button>${
        props.task
          ? html`<button type="button" @click=${props.task.claim.onClick}
                >${props.task.claim.label}</button
              ><button
                type="button"
                ?disabled=${props.task.done.disabled}
                @click=${props.task.done.onClick}
              >${props.task.done.label}</button>${iconLabelButton(
                "journal-danger-action",
                { paths: TRASH_16_PATH, cls: "octicon-trash" },
                props.task.remove,
              )}`
          : nothing
      }</div></aside>`;
}

const tasksTemplate = (props: JournalTasksProps) => html`<div
  class="journal-tasks-layout"
><div class="journal-task-toolbar"><input
      type="search"
      placeholder=${props.filter.placeholder}
      .value=${props.filter.value}
      @change=${(event: Event) =>
        props.filter.onChange((event.currentTarget as HTMLInputElement).value)}
    /><section class="journal-command-preview journal-queue"><strong
        >${props.queue.title}</strong
      ><code>${props.queue.command}</code>${
        props.queue.items.length
          ? html`<ol>${props.queue.items.map((item) => html`<li>${item}</li>`)}</ol>`
          : nothing
      }</section
    ><button
      type="button"
      class=${props.githubToggle.active ? "journal-github-toggle active" : "journal-github-toggle"}
      aria-expanded=${props.githubToggle.active ? "true" : "false"}
      @click=${props.githubToggle.onClick}
    >${iconTemplate(COMMENT_DISCUSSION_16_PATH, "journal-github-toggle-icon")}<span
        >${props.githubToggle.label}</span
      ><span class="journal-github-toggle-count">${props.githubToggle.count}</span></button
    ><div class="journal-label-filters" aria-label=${props.labelFilters.label}>${props.labelFilters.buttons.map(
      (button) => html`<button
        type="button"
        class=${button.active ? "journal-label-filter active" : "journal-label-filter"}
        aria-pressed=${button.active ? "true" : "false"}
        @click=${button.onClick}
      ><span class="journal-label-filter-name">${button.name}</span><span
          class="journal-label-filter-count"
        >${button.count}</span></button>`,
    )}</div>${props.github ? githubPanelTemplate(props.github) : nothing}</div
  ><div class="journal-task-board-wrap"><div class="journal-task-board">${props.columns.map(
    (column) => html`<section
      class=${`journal-task-column journal-task-column-${column.status}`}
      data-status=${column.status}
      @dragover=${column.on.dragover}
      @dragleave=${column.on.dragleave}
      @drop=${column.on.drop}
    ><div class="journal-task-column-head"><strong>${column.title}</strong><span
          >${column.count}</span
        ></div
      >${
        column.cards.length
          ? nothing
          : html`<div class="journal-column-empty">${column.empty}</div>`
      }${column.cards.map(taskCardTemplate)}</section>`,
  )}</div></div>${taskEditorTemplate(props.editor)}</div>`;

export const DEFAULT_VIEW: JournalViewView = {
  root: () => html`<section class="journal-page" hidden></section>`,
  page: (props) =>
    html`${headerTemplate(props.header)}<div class="journal-content">${
      props.daily
        ? dailyTemplate(props.daily)
        : props.tasks
          ? tasksTemplate(props.tasks)
          : nothing
    }</div>`,
  labelEditor: (props) => html`<div
    class="journal-label-editor"
    @click=${props.onClick}
  >${props.labels.map(
    (label) => html`<span class="journal-label-editor-chip"><span
          >${label.name}</span
        ><button
          type="button"
          class="journal-label-editor-remove"
          aria-label=${label.removeLabel}
          @click=${label.onRemove}
        >${iconTemplate(X_16_PATH, "octicon-x")}</button></span
      >`,
  )}<input
      class="journal-label-editor-input"
      type="text"
      autocomplete="off"
      placeholder=${props.placeholder}
      @keydown=${props.input.onKeyDown}
      @input=${props.input.onInput}
      @focus=${props.input.onFocus}
      @paste=${props.input.onPaste}
      @blur=${props.input.onBlur}
    /><div class="journal-label-editor-quick" ?hidden=${!props.quick.length}>${props.quick.map(
      (item) => html`<button
        type="button"
        class="journal-label-editor-quick-chip"
        @click=${item.onPick}
      >${item.label}</button>`,
    )}</div><div
      class="journal-label-editor-suggestions"
      ?hidden=${!props.suggestions.length}
    >${props.suggestions.map(
      (item) => html`<button
        type="button"
        class=${item.active ? "journal-label-editor-suggestion active" : "journal-label-editor-suggestion"}
        @mousedown=${item.onPick}
      >${item.label}</button>`,
    )}</div></div>`,
};

/**
 * ラベルを足す欄。並べたラベルと候補の選び位置はこの欄の中の状態で、欄を
 * 作り直すと最初の値に戻る (画面を描き直すたびに作る)。
 */
function createLabelEditor(
  initialLabels: string[],
  placeholder: string,
  suggestionLabels: string[],
  removeLabelText: (label: string) => string,
  view: JournalViewView,
): { element: HTMLElement; getLabels(): string[] } {
  const labels = normalizeJournalLabels(initialLabels);
  const suggestions = normalizeJournalLabels(suggestionLabels);
  let highlightedSuggestion = -1;
  /** 欄から離れた直後は候補を閉じる (押した候補が先に選ばれるよう少し待つ)。 */
  let menuClosed = false;
  /** 欄の要素 (最初に描くまでは null)。 */
  let box: { element: HTMLElement; draw(): void } | null = null;
  const draw = () => box?.draw();

  const input = (): HTMLInputElement | null =>
    box?.element.querySelector<HTMLInputElement>(
      ".journal-label-editor-input",
    ) ?? null;

  const suggestionItems = () => {
    const raw = (input()?.value ?? "").trim().toLowerCase();
    const normalized = normalizeJournalLabel(raw) || raw;
    return suggestions
      .filter(
        (label) =>
          !labels.includes(label) &&
          (!normalized || label.includes(normalized)),
      )
      .slice(0, 8);
  };

  const commit = (raw: string): boolean => {
    const label = normalizeJournalLabel(raw);
    const field = input();
    if (field) field.value = "";
    if (!label || labels.includes(label)) return false;
    labels.push(label);
    highlightedSuggestion = -1;
    draw();
    input()?.focus();
    return true;
  };

  const props = (): JournalLabelEditorProps => {
    const field = input();
    const value = field?.value ?? "";
    const items = suggestionItems();
    const hasQuery = !!(normalizeJournalLabel(value) || value.trim());
    const showMenu =
      !menuClosed &&
      items.length > 0 &&
      hasQuery &&
      !!field &&
      document.activeElement === field;
    if (!showMenu) highlightedSuggestion = -1;
    else if (highlightedSuggestion >= items.length) highlightedSuggestion = 0;
    return {
      labels: labels.map((label) => ({
        name: label,
        removeLabel: removeLabelText(label),
        onRemove: (event) => {
          event.stopPropagation();
          const index = labels.indexOf(label);
          if (index >= 0) labels.splice(index, 1);
          draw();
          input()?.focus();
        },
      })),
      placeholder: labels.length ? "" : placeholder,
      quick: items.slice(0, 6).map((label) => ({
        label,
        onPick: (event) => {
          event.preventDefault();
          event.stopPropagation();
          commit(label);
        },
      })),
      suggestions: showMenu
        ? items.map((label, index) => ({
            label,
            active: index === highlightedSuggestion,
            onPick: (event) => {
              event.preventDefault();
              commit(label);
            },
          }))
        : [],
      onClick: () => input()?.focus(),
      input: {
        onKeyDown: (event) => {
          const items = suggestionItems();
          if (event.key === "ArrowDown" && items.length) {
            event.preventDefault();
            highlightedSuggestion = (highlightedSuggestion + 1) % items.length;
            draw();
            return;
          }
          if (event.key === "ArrowUp" && items.length) {
            event.preventDefault();
            highlightedSuggestion =
              (highlightedSuggestion - 1 + items.length) % items.length;
            draw();
            return;
          }
          const value = (input()?.value ?? "").trim();
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
            draw();
            input()?.focus();
          }
        },
        onInput: () => {
          highlightedSuggestion = -1;
          menuClosed = false;
          draw();
        },
        onFocus: () => {
          menuClosed = false;
          draw();
        },
        onPaste: (event) => {
          const pasted = event.clipboardData?.getData("text") || "";
          if (!/[,\n]/.test(pasted)) return;
          event.preventDefault();
          for (const item of pasted.split(/[,\n]+/)) commit(item);
        },
        onBlur: () => {
          const field = input();
          if (field?.value.trim()) commit(field.value);
          window.setTimeout(() => {
            menuClosed = true;
            highlightedSuggestion = -1;
            draw();
          }, 120);
        },
      },
    };
  };

  const editor = detachedElement(() => view.labelEditor(props()));
  box = editor;
  return {
    element: editor.element,
    getLabels: () => [...labels],
  };
}

function setButtonBusy(button: HTMLButtonElement, busy: boolean): void {
  button.disabled = busy;
  button.setAttribute("aria-busy", busy ? "true" : "false");
}

export function createJournalView(
  deps: JournalViewDeps,
  view: JournalViewView = DEFAULT_VIEW,
): JournalView {
  const root = templateElement(view.root());
  root.setAttribute("aria-label", deps.getText().ariaLabel);
  /** 描くたびに画面を作り直す (前と同じく、欄の中身は保存した値に戻る)。 */
  let renderSeq = 0;

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
    reportStoredSizeFailure(
      writeStoredSize(TASK_EDITOR_WIDTH_STORAGE_KEY, clamped),
      "saving the journal editor width failed",
    );
  }

  function restoreTaskEditorWidth(): void {
    const result = readStoredSize(
      TASK_EDITOR_WIDTH_STORAGE_KEY,
      TASK_EDITOR_DEFAULT_WIDTH,
    );
    reportStoredSizeFailure(result, "reading the journal editor width failed");
    applyTaskEditorWidth(result.value, false);
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
      fetch(apiUrl("journal"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Code-Viewer-Action": "1",
        },
        body: JSON.stringify({ action, ...body }),
      }),
    );
    if (!res.ok)
      throw new Error(await responseErrorMessage(res, `journal ${action}`));
    const response = (await res.json()) as JournalActionResponse;
    afterResponse?.(response);
    await refresh();
    return response;
  }

  /** 失敗を console に出し、状態の行に操作の失敗と理由の全文を出す。 */
  function showFailure(operation: string, error: unknown): void {
    console.error(`[code-viewer] journal: ${operation}`, error);
    message = `${operation}\n${formatErrorDetail(error)}`;
    deps.setStatus("error");
    render();
  }

  async function refresh(): Promise<void> {
    const seq = ++lifecycle;
    message = data ? "" : text().loading;
    render();
    deps.setStatus("refreshing");
    try {
      const next = await deps.trackLoad(
        fetch(apiUrl("journal")).then(async (res) => {
          if (!res.ok)
            throw new Error(
              await responseErrorMessage(res, "loading the journal"),
            );
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
      showFailure(text().loadFailed, error);
    }
  }

  function setRoute(
    next: Partial<Extract<AppRoute, { screen: "journal" }>>,
    replace = true,
  ): void {
    deps.setRoute(routeFor(next), replace);
  }

  function headerProps(): JournalHeaderProps {
    return {
      title: text().title,
      tabs: (["journal", "tasks"] as const).map((tab) => ({
        label: text().tabs[tab],
        active: activeTab === tab,
        onClick: () => {
          activeTab = tab;
          setRoute({ tab });
        },
      })),
      refresh: { label: text().refresh, onClick: () => void refresh() },
      status: message,
    };
  }

  /** 画面の中の欄 (描いた後に値を読む)。 */
  function fieldIn<T extends Element>(scope: string, name: string): T | null {
    return root.querySelector<T & Element>(`${scope} [name="${name}"]`);
  }

  function dailyProps(): JournalDailyProps {
    const selected = selectedEntry();
    const entriesForDate = (data?.journal.entries || []).filter(
      (entry) => entry.date === selectedDate,
    );
    const labels = createLabelEditor(
      selected ? selected.labels : [],
      text().labelPlaceholder,
      labelSuggestions(),
      text().removeLabel,
      view,
    );
    const value = (name: string) =>
      fieldIn<HTMLInputElement>(".journal-editor", name)?.value ?? "";
    const tasks = (data?.tasks.tasks || []).filter((task) =>
      taskCoversDate(task, selectedDate),
    );
    return {
      date: {
        value: selectedDate,
        onChange: (next) => {
          selectedDate = next || todayIsoDate();
          selectedEntryId = "";
          creatingEntry = false;
          setRoute({ date: selectedDate });
        },
      },
      newEntry: {
        label: text().new,
        onClick: () => {
          selectedEntryId = "";
          creatingEntry = true;
          render();
        },
      },
      entries: entriesForDate.map((entry) => ({
        label: entry.title || entry.body.split("\n")[0] || entry.date,
        active: entry.id === selectedEntryId,
        onClick: () => {
          selectedEntryId = entry.id;
          creatingEntry = false;
          render();
        },
      })),
      noEntries: text().noEntries,
      title: {
        value: selected?.title || "",
        placeholder: text().titlePlaceholder,
      },
      labels: labels.element,
      body: {
        value: selected?.body || "",
        placeholder: text().entryBodyPlaceholder,
      },
      save: {
        label: selected ? text().saveEntry : text().addEntry,
        onClick: async (event) => {
          const save = event.currentTarget as HTMLButtonElement;
          setButtonBusy(save, true);
          try {
            const payload = {
              date: selectedDate,
              title: value("title"),
              labels: labels.getLabels(),
              body: value("body"),
            };
            if (selected)
              await requestJournal("update-entry", {
                id: selected.id,
                ...payload,
              });
            else
              await requestJournal("add-entry", payload, (next) => {
                if (next.entry) {
                  selectedEntryId = next.entry.id;
                  creatingEntry = false;
                }
              });
          } catch (error) {
            showFailure(text().saveEntryFailed, error);
          } finally {
            setButtonBusy(save, false);
          }
        },
      },
      remove: selected
        ? {
            label: text().delete,
            onClick: async (event) => {
              const del = event.currentTarget as HTMLButtonElement;
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
                showFailure(text().deleteEntryFailed, error);
              } finally {
                setButtonBusy(del, false);
              }
            },
          }
        : null,
      related: {
        heading: text().relatedTasks,
        empty: text().noRelatedTasks,
        cards: tasks.map((task) => taskCardProps(task, { compact: true })),
      },
    };
  }

  function taskVisible(task: JournalTask): boolean {
    return !labelFilter || task.labels.includes(labelFilter);
  }

  function taskCardProps(
    task: JournalTask,
    options: { compact?: boolean } = {},
  ): JournalTaskCardProps {
    const cardOf = (event: Event) => event.currentTarget as HTMLElement;
    return {
      id: task.id,
      selected: task.id === selectedTaskId,
      compact: !!options.compact,
      priority: {
        value: task.priority,
        label: text().priorityLabels[task.priority],
      },
      status: text().statusLabels[task.status],
      dragTitle: text().dragTask,
      title: task.title,
      labels: task.labels,
      due: task.due_date ? `${text().duePrefix} ${task.due_date}` : null,
      claim: task.claim ? text().claimedBy(task.claim.by) : null,
      on: {
        click: (event) => {
          if (
            draggingTaskId ||
            suppressTaskClick ||
            taskDragHandleFromTarget(cardOf(event), event.target)
          )
            return;
          selectTask(task.id, { revealEditor: true });
        },
        dragstart: (event) => {
          const card = cardOf(event);
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
        },
        dragenter: (event) => {
          if (
            (!draggingTaskId && !draggingGithubIssue()) ||
            draggingTaskId === task.id
          )
            return;
          event.preventDefault();
          const card = cardOf(event);
          const after = isTaskDropAfter(card, event);
          lastTaskDropTarget = after
            ? { after_id: task.id }
            : { before_id: task.id };
          markTaskDropTarget(card, after);
        },
        dragover: (event) => {
          const issue = draggingGithubIssue();
          if ((!draggingTaskId && !issue) || draggingTaskId === task.id) return;
          event.preventDefault();
          if (event.dataTransfer)
            event.dataTransfer.dropEffect = issue ? "copy" : "move";
          scheduleTaskDragAutoScroll(event);
          const card = cardOf(event);
          const after = isTaskDropAfter(card, event);
          lastTaskDropTarget = after
            ? { after_id: task.id }
            : { before_id: task.id };
          markTaskDropTarget(card, after);
        },
        dragleave: (event) => {
          const card = cardOf(event);
          const related = event.relatedTarget as Node | null;
          if (related && card.contains(related)) return;
          lastTaskDropTarget = null;
          card.classList.remove("drop-target", "drop-after");
        },
        drop: (event) => {
          const issue =
            draggingGithubIssue() ||
            githubIssueFromDataTransfer(event.dataTransfer);
          if ((!draggingTaskId && !issue) || draggingTaskId === task.id) return;
          event.preventDefault();
          event.stopPropagation();
          const after = isTaskDropAfter(cardOf(event), event);
          const target = after ? { after_id: task.id } : { before_id: task.id };
          lastTaskDropTarget = null;
          if (issue) void linkGithubIssueToTask(issue, target);
          else void moveDraggedTask(target);
        },
        dragend: (event) => finishNativeTaskDrag(event),
        pointerdown: (event) => beginPointerTaskDrag(task.id, event),
      },
    };
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
      showFailure(text().moveTaskFailed, error);
    }
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
        fetch(apiUrl("journal"), {
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
      if (!res.ok)
        throw new Error(
          await responseErrorMessage(res, "journal list-github-issues"),
        );
      const response = (await res.json()) as GithubIssueListResponse;
      if (seq !== githubIssueGeneration) return;
      githubIssues = stableGithubIssues(response.issues || []);
      githubIssuesLoaded = true;
      deps.setStatus("live");
    } catch (error) {
      if (seq !== githubIssueGeneration) return;
      console.error(
        "[code-viewer] journal: loading GitHub issues failed",
        error,
      );
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
        githubIssuesError = `${text().githubLoadFailed}\n${formatErrorDetail(error)}`;
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
      showFailure(text().githubLinkTaskFailed, error);
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

  function githubIssueProps(issue: GithubIssueItem): JournalGithubIssueProps {
    const linked = linkedTaskForIssue(issue.number);
    return {
      number: issue.number,
      state: githubIssueStateLabel(issue.state),
      linked: linked ? text().githubLinked : null,
      title: issue.title,
      labels: issue.labels.slice(0, 4),
      action: {
        label: linked ? text().githubOpenTask : text().githubAddToBoard,
        onClick: async (event) => {
          event.preventDefault();
          event.stopPropagation();
          if (linked) {
            githubInboxOpen = false;
            selectTask(linked.id, { focusEditor: true, revealEditor: true });
            return;
          }
          (event.currentTarget as HTMLButtonElement).disabled = true;
          const taskId = await linkGithubIssueToTask(issue, {
            status: "draft",
          });
          if (taskId)
            selectTask(taskId, { focusEditor: true, revealEditor: true });
        },
      },
      onDragStart: (event) => {
        draggingGithubIssueNumber = issue.number;
        lastTaskDropTarget = null;
        event.dataTransfer?.setData("text/plain", `#${issue.number}`);
        if (event.dataTransfer) event.dataTransfer.effectAllowed = "copyMove";
      },
      onDragEnd: (event) => finishNativeTaskDrag(event),
    };
  }

  function githubPanelProps(): JournalGithubPanelProps {
    const value = (name: string) =>
      fieldIn<HTMLInputElement | HTMLSelectElement>(
        ".journal-github-panel",
        name,
      )?.value ?? "";
    const syncControls = (shouldRender = true, shouldLoad = shouldRender) => {
      const state = value("state");
      const nextState = state === "closed" || state === "all" ? state : "open";
      const nextRepo = value("repo").trim();
      const nextLabel = value("labels").trim();
      const nextSearch = value("search").trim();
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
    const showing =
      githubIssuesLoaded && !githubIssuesError
        ? ` ${text().githubShowing(githubIssues.length, githubIssueLimit)}`
        : "";
    return {
      title: text().githubIssues,
      close: { label: text().githubClose, onClick: () => closeGithubInbox() },
      repo: {
        value: githubRepoFilter,
        placeholder: text().githubRepoPlaceholder,
      },
      labels: {
        value: githubLabelFilter,
        placeholder: text().githubLabelPlaceholder,
      },
      search: {
        value: githubSearchFilter,
        placeholder: text().githubSearchPlaceholder,
      },
      state: {
        options: (["open", "closed", "all"] as const).map((state) => ({
          value: state,
          label: text().githubStateLabels[state],
          selected: state === githubStateFilter,
        })),
      },
      onChange: () => syncControls(),
      onEnter: (event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        syncControls(false, false);
        void loadGithubIssues();
      },
      load: {
        label: githubIssuesLoading ? text().githubLoading : text().githubLoad,
        disabled: !githubCanRequest(),
        onClick: () => {
          syncControls(false, false);
          void loadGithubIssues();
        },
      },
      hint: githubIssuesError || `${text().githubDragHint}${showing}`,
      onListDragOver: (event) => {
        if (!draggingGithubIssue()) return;
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
        scheduleTaskDragAutoScroll(event);
      },
      issues: githubIssues.map(githubIssueProps),
      empty: githubIssuesLoading
        ? text().githubLoading
        : githubIssuesLoaded
          ? text().githubNoIssues
          : text().githubNotLoaded,
      more:
        githubIssuesLoaded &&
        githubIssues.length >= githubIssueLimit &&
        githubIssueLimit < GITHUB_ISSUE_LIMIT_MAX
          ? {
              label: text().githubLoadMore,
              disabled: !githubCanRequest(),
              onClick: () =>
                loadGithubIssues(githubIssueLimit + GITHUB_ISSUE_LIMIT_STEP),
            }
          : null,
    };
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

  function labelFilterButtons(): JournalTasksProps["labelFilters"]["buttons"] {
    const counts = taskLabelCounts();
    const total = data?.tasks.tasks.length || 0;
    const button = (
      name: string,
      count: number,
      active: boolean,
      value = name,
    ) => ({
      name,
      count,
      active,
      onClick: () => {
        labelFilter = active ? "" : value;
        setRoute({ tab: "tasks", label: labelFilter || undefined });
      },
    });
    return [
      button(text().allLabels, total, !labelFilter, ""),
      ...[...counts.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([label, count]) => button(label, count, label === labelFilter)),
    ];
  }

  function boardColumns(): JournalTasksProps["columns"] {
    return JOURNAL_TASK_STATUSES.map((status) => {
      const tasks = (data?.tasks.tasks || []).filter(
        (task) => task.status === status && taskVisible(task),
      );
      const columnOf = (event: Event) => event.currentTarget as HTMLElement;
      return {
        status,
        title: text().statusLabels[status],
        count: tasks.length,
        empty: text().empty,
        cards: tasks.map((task) => taskCardProps(task)),
        on: {
          dragover: (event) => {
            const column = columnOf(event);
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
          },
          dragleave: (event) => {
            const column = columnOf(event);
            const related = event.relatedTarget as Node | null;
            if (related && column.contains(related)) return;
            lastTaskDropTarget = null;
            column.classList.remove("drop-target");
          },
          drop: (event) => {
            const column = columnOf(event);
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
          },
        },
      };
    });
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

  function taskEditorProps(): JournalTaskEditorProps {
    const task = selectedTask();
    const labels = createLabelEditor(
      task ? task.labels : normalizeJournalLabels([labelFilter]),
      text().labelPlaceholder,
      labelSuggestions(),
      text().removeLabel,
      view,
    );
    const value = (name: string) =>
      fieldIn<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
        ".journal-task-editor",
        name,
      )?.value ?? "";
    const body = () =>
      fieldIn<HTMLTextAreaElement>(".journal-task-editor", "body");
    const busy =
      (run: (button: HTMLButtonElement) => Promise<void>) =>
      async (event: Event) => {
        const button = event.currentTarget as HTMLButtonElement;
        setButtonBusy(button, true);
        try {
          await run(button);
        } finally {
          setButtonBusy(button, false);
        }
      };
    return {
      resizer: {
        label: text().resizeTaskPanel,
        onPointerDown: (event) => {
          const panel = (
            event.currentTarget as HTMLElement
          ).closest<HTMLElement>(".journal-task-editor");
          if (panel) startTaskEditorResize(event, panel);
        },
      },
      heading: task ? text().taskHeading : text().newTaskHeading,
      newTask: {
        label: text().new,
        onClick: () => {
          selectedTaskId = "";
          setRoute({ tab: "tasks", task: undefined });
        },
      },
      title: { value: task?.title || "", placeholder: text().titlePlaceholder },
      status: {
        label: text().statusField,
        options: JOURNAL_TASK_STATUSES.map((status) => ({
          value: status,
          label: text().statusLabels[status],
          selected: (task?.status || "todo") === status,
        })),
      },
      priority: {
        label: text().priorityField,
        options: JOURNAL_TASK_PRIORITIES.map((priority) => ({
          value: priority,
          label: text().priorityLabels[priority],
          selected: (task?.priority || "p2") === priority,
        })),
      },
      start: {
        label: text().startDate,
        value: task?.source_date || selectedDate,
      },
      end: { label: text().endDate, value: task?.due_date || "" },
      labels: labels.element,
      tools: (
        [
          ["B", "**", "**"],
          ["`", "`", "`"],
          ["[]", "- [ ] ", ""],
          [">", "> ", ""],
        ] as const
      ).map(([label, before, after]) => ({
        label,
        onClick: () => {
          const field = body();
          if (field) insertMarkdown(field, before, after);
        },
      })),
      modes: (["write", "preview", "split"] as const).map((mode) => ({
        label: text().editorModes[mode],
        active: editorMode === mode,
        onClick: () => {
          editorMode = mode;
          render();
        },
      })),
      body: {
        value: task?.body || "",
        placeholder: text().taskBodyPlaceholder,
        hidden: editorMode === "preview",
        onInput: () => {
          if (editorMode !== "write") void drawTaskPreview();
        },
      },
      previewHidden: editorMode === "write",
      save: {
        label: task ? text().saveTask : text().addTask,
        onClick: busy(async () => {
          const payload = {
            title: value("title"),
            status: value("status"),
            priority: value("priority"),
            labels: labels.getLabels(),
            due_date: value("due_date") || null,
            source_date: value("source_date") || null,
            body: value("body"),
          };
          try {
            if (task)
              await requestJournal("update-task", { id: task.id, ...payload });
            else {
              const response = await requestJournal(
                "add-task",
                payload,
                (next) => {
                  if (next.task) selectedTaskId = next.task.id;
                },
              );
              if (response.task)
                setRoute({ tab: "tasks", task: response.task.id });
            }
          } catch (error) {
            showFailure(text().saveTaskFailed, error);
          }
        }),
      },
      task: task
        ? {
            claim: {
              label: text().claim,
              onClick: busy(async () => {
                try {
                  await requestJournal("claim-task", {
                    id: task.id,
                    by: "user",
                  });
                } catch (error) {
                  showFailure(text().claimTaskFailed, error);
                }
              }),
            },
            done: {
              label: text().done,
              disabled: task.status !== "doing" || task.claim?.by !== "user",
              onClick: busy(async () => {
                try {
                  await requestJournal("complete-task", {
                    id: task.id,
                    by: "user",
                    source: "user",
                  });
                } catch (error) {
                  showFailure(text().doneTaskFailed, error);
                }
              }),
            },
            remove: {
              label: text().delete,
              onClick: async (event) => {
                const del = event.currentTarget as HTMLButtonElement;
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
                  const result = await requestJournal("delete-task", {
                    id: task.id,
                  });
                  if (!result.removed)
                    throw new Error(
                      "the server reported that the task was not removed",
                    );
                  selectedTaskId = "";
                  setRoute({ tab: "tasks", task: undefined });
                } catch (error) {
                  showFailure(text().deleteTaskFailed, error);
                } finally {
                  setButtonBusy(del, false);
                }
              },
            },
          }
        : null,
    };
  }

  /** タスクの本文の下見 (描いた Markdown の要素を箱に置く)。 */
  async function drawTaskPreview(): Promise<void> {
    const host = root.querySelector<HTMLElement>(
      ".journal-task-editor .journal-markdown-preview",
    );
    const body = fieldIn<HTMLTextAreaElement>(".journal-task-editor", "body");
    if (!host || !body) return;
    host.replaceChildren();
    const rendered = await renderMarkdownPreview(
      body.value || `_${text().noBody}_`,
      { path: "journal-task.md", ref: "worktree" },
      { syntaxHighlight: false },
    );
    host.appendChild(rendered);
  }

  function tasksProps(): JournalTasksProps {
    const next = data
      ? selectNextJournalTasks(
          data.tasks,
          { labels: labelFilter ? [labelFilter] : [] },
          5,
        )
      : [];
    return {
      filter: {
        value: labelFilter,
        placeholder: text().labelFilterPlaceholder,
        onChange: (value) => {
          labelFilter = normalizeJournalLabel(value) || "";
          setRoute({ tab: "tasks", label: labelFilter || undefined });
        },
      },
      queue: {
        title: text().aiQueue,
        command: labelFilter
          ? `code-viewer journal task-next --label ${labelFilter} --limit 5`
          : "code-viewer journal task-next --limit 5",
        items: next.map(
          (task) => `${text().priorityLabels[task.priority]} ${task.title}`,
        ),
      },
      githubToggle: {
        active: githubInboxOpen,
        label: text().githubIssues,
        count: githubIssuesLoading
          ? "..."
          : githubIssuesLoaded
            ? String(githubIssues.length)
            : "0",
        onClick: () => {
          githubInboxOpen = !githubInboxOpen;
          render();
          if (
            githubInboxOpen &&
            !githubIssuesAutoRequested &&
            !githubIssuesLoading
          ) {
            void loadGithubIssues();
          }
        },
      },
      labelFilters: {
        label: text().labelFilters,
        buttons: labelFilterButtons(),
      },
      github: githubInboxOpen ? githubPanelProps() : null,
      columns: boardColumns(),
      editor: taskEditorProps(),
    };
  }

  function render(): void {
    root.setAttribute("aria-label", text().ariaLabel);
    renderSeq += 1;
    renderOwned(
      root,
      keyed(
        renderSeq,
        view.page({
          header: headerProps(),
          daily: activeTab === "journal" ? dailyProps() : null,
          tasks: activeTab === "journal" ? null : tasksProps(),
        }),
      ),
    );
    if (activeTab !== "journal") void drawTaskPreview();
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

  return {
    enter,
    suspend,
    handleSse,
    localize,
    resetProject() {
      suspend();
      data = null;
      selectedEntryId = "";
      selectedTaskId = "";
      creatingEntry = false;
      githubIssues = [];
      githubIssuesLoading = false;
      githubIssuesError = "";
      githubIssueGeneration++;
      githubIssuesLoaded = false;
      githubIssuesAutoRequested = false;
    },
  };
}
