import { repeat } from "lit/directives/repeat.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { html, nothing } from "lit/html.js";
import { apiUrl } from "../core/api-url";
import {
  errorWithCause,
  formatErrorDetail,
  responseErrorMessage,
} from "../core/error-detail";

// Commit history screen (left panel). Renders the commit list, handles
// infinite scroll / deep links, and delegates diff rendering to the existing
// diff pipeline via deps.applyCommitRange().

import { relativeTimeText } from "../core/blame";
import {
  commitDiffRange,
  EMPTY_TREE_SHA,
  formatHistoryLineRange,
  HISTORY_PAGE_SIZE,
  type HistoryAuthorsResponse,
  type HistoryCommit,
  type HistoryCommitRef,
  type HistoryLineRange,
  type HistoryLogResponse,
  historyGroupLabel,
  shouldContinueAutoLoad,
} from "../core/history";
import {
  CHECK_16_PATHS,
  CHEVRON_LEFT_16_PATH,
  COPY_16_PATHS,
  SYNC_16_PATH,
} from "../core/icons";
import { isImeComposing } from "../core/keyboard";
import { renderMarkdownPreview } from "../core/markdown-preview";
import type { AppRoute } from "../core/routes";
import {
  buildHistoryGraph,
  type GraphRow,
  historyGraphPassSvg,
  historyGraphSvg,
  passingLanes,
} from "./history-graph";
import {
  type FocusedListRow,
  focusedListRow,
  type ListRowKeys,
  onListRowKeys,
  syncListTabStop,
} from "./list-tab-stop";
import { pageLanguage } from "./page-language";
import { iconTemplate } from "./ui/icon";
import { detachedElement, renderOwned, templateElement } from "./ui/renderer";

export const HISTORY_BODY_COLLAPSE_LINES = 10;
export const HISTORY_WORKTREE_COMMIT = "worktree";

export type HistoryLang = "en" | "ja";

export type HistoryText = {
  worktreeLabel: string;
  bodyExpandClose: string;
  bodyExpandMore: (remainingLines: number) => string;
  refreshLabel: string;
  refreshTitle: string;
  refreshTitlePending: string;
  filterClearLabel: string;
  filterClearTitle: string;
  filterPlaceholder: string;
  filterTitle: string;
  commitsTitle: string;
  commitsIn: (path: string) => string;
  commitsForLines: (start: number, end: number) => string;
  copyShaTitle: string;
  copiedTitle: string;
  copyFailedTitle: string;
  mergeBadge: string;
  compareWith: string;
  parentLabel: (index: number, shortSha: string) => string;
  comparing: (from: string, to: string) => string;
  clearCompare: string;
  refTitle: (kind: HistoryCommitRef["kind"], name: string) => string;
  panelLabel: string;
  selectedCommit: string;
  backToList: string;
};

type HistoryRefreshStatus = { type: "none" } | { type: "pending" };

const HISTORY_TEXT: Record<HistoryLang, HistoryText> = {
  en: {
    worktreeLabel: "Uncommitted changes (Working tree)",
    panelLabel: "Commit history",
    selectedCommit: "Selected commit",
    backToList: "History list",
    bodyExpandClose: "Collapse",
    bodyExpandMore: (n) => `Show more (${n} lines)`,
    refreshLabel: "Refresh",
    refreshTitle: "Refresh commit history",
    refreshTitlePending: "History may have changed. Refresh",
    filterClearLabel: "Clear",
    filterClearTitle: "Clear commit filter",
    filterPlaceholder: "filter… text author: path: since: code:",
    filterTitle:
      'Filter commits. Words match the message ("quoted" keeps spaces), sha prefixes match commits, author:<name>, path:<part>, since:/after:<date>, until:/before:<date>, code:<text> (lines added or removed), merges:no / merges:only. Kinds combine with AND.',
    commitsTitle: "Commits",
    commitsIn: (path) => `Commits · ${path}`,
    commitsForLines: (start, end) =>
      start === end
        ? `Commits · line ${start}`
        : `Commits · lines ${start}-${end}`,
    copyShaTitle: "Copy full commit sha",
    copiedTitle: "Copied",
    copyFailedTitle: "Copy failed",
    mergeBadge: "merge",
    compareWith: "Compare with",
    parentLabel: (index, shortSha) => `parent ${index} (${shortSha})`,
    comparing: (from, to) => `Comparing ${from}..${to}`,
    clearCompare: "Clear",
    refTitle: (kind, name) =>
      kind === "tag"
        ? `Tag ${name}`
        : kind === "head"
          ? "HEAD"
          : `Branch ${name}`,
  },
  ja: {
    worktreeLabel: "未コミット変更 (Working tree)",
    panelLabel: "コミットの履歴",
    selectedCommit: "選んだコミット",
    backToList: "履歴の一覧",
    bodyExpandClose: "閉じる",
    bodyExpandMore: (n) => `もっと見る (${n} 行)`,
    refreshLabel: "更新",
    refreshTitle: "コミット履歴を更新",
    refreshTitlePending: "新しい履歴がある可能性があります。更新",
    filterClearLabel: "解除",
    filterClearTitle: "コミットフィルタを解除",
    filterPlaceholder: "絞り込み… 文字列 author: path: since: code:",
    filterTitle:
      'コミットを絞り込みます。語はメッセージに一致（"引用" で空白を含む句）、sha の前方一致、author:<名前>、path:<一部>、since:/after:<日付>、until:/before:<日付>、code:<文字列>（追加・削除された行）、merges:no / merges:only。種類が違う条件は AND。',
    commitsTitle: "コミット",
    commitsIn: (path) => `コミット · ${path}`,
    commitsForLines: (start, end) =>
      start === end
        ? `コミット · ${start} 行目`
        : `コミット · ${start}-${end} 行`,
    copyShaTitle: "コミットの sha をコピー",
    copiedTitle: "コピーしました",
    copyFailedTitle: "コピーに失敗しました",
    mergeBadge: "merge",
    compareWith: "比較対象",
    parentLabel: (index, shortSha) => `親 ${index} (${shortSha})`,
    comparing: (from, to) => `${from}..${to} を比較中`,
    clearCompare: "解除",
    refTitle: (kind, name) =>
      kind === "tag"
        ? `タグ ${name}`
        : kind === "head"
          ? "HEAD"
          : `ブランチ ${name}`,
  },
};

export function historyText(lang: HistoryLang): HistoryText {
  return HISTORY_TEXT[lang];
}

export function historyWorktreeLabel(lang: HistoryLang): string {
  return HISTORY_TEXT[lang].worktreeLabel;
}

export type HistoryViewDeps = {
  $: <T extends Element = HTMLElement>(sel: string) => T;
  getRoute(): AppRoute;
  setRoute(route: AppRoute, replace?: boolean): void;
  // Sets STATE.from/to to the commit range and reloads the diff pane.
  applyCommitRange(
    range: { from: string; to: string },
    pathFilter?: string,
  ): Promise<void>;
  // Clears the diff pane and shows the "no commit selected" empty state.
  showEmptyDiffPane(): void;
  getSyntaxHighlight(): boolean;
  getLanguage(): HistoryLang;
  trackLoad<T>(promise: Promise<T>): Promise<T>;
  // "Open on GitHub" style link for a commit, or null when the remote is
  // not a web host. Optional so tests and minimal hosts can omit it.
  commitWebLink?(sha: string): HTMLAnchorElement | null;
  copyText?(text: string): Promise<void>;
  /**
   * 一覧と差分が別のページか (電話の段)。そうなら一覧から選んだコミットを
   * ブラウザの履歴に積み (戻るで一覧へ)、差分の頭に一覧へ戻るボタンを出す。
   */
  listIsPage?(): boolean;
  /** 一覧のページを出す (電話の段)。 */
  showList?(): void;
};

export type HistoryViewMount = {
  panel: HTMLElement;
  list: HTMLOListElement;
  banner: HTMLElement;
  status: HTMLElement;
  sentinel: HTMLElement;
  filterInput?: HTMLInputElement | null;
  filterClearButton?: HTMLButtonElement | null;
  authorList?: HTMLDataListElement | null;
  refreshButton?: HTMLButtonElement | null;
  refreshResult?: HTMLElement | null;
  commitInfo?: HTMLElement | null;
};

export type HistoryPanelDomOptions = {
  variant?: "page" | "file";
};

/** 一覧の枠 (見出し・更新・絞り込み・帯・一覧・状態)。中身は presenter が描く。 */
export type HistoryPanelProps = {
  /** 履歴の画面か (id を付け、ref を選ぶ欄を置く)。ファイルの履歴のタブは false。 */
  page: boolean;
  label: string;
  title: string;
  refreshTitle: string;
  filter: {
    placeholder: string;
    title: string;
    clearLabel: string;
    clearTitle: string;
    /** 名前の候補 (datalist) の id。 */
    authorListId: string;
  };
};

/** 一覧の 1 行。 */
export type HistoryRowProps =
  | { kind: "worktree"; key: string; active: boolean; label: string }
  | { kind: "group"; key: string; label: string; graph: string }
  | {
      kind: "commit";
      key: string;
      sha: string;
      shortSha: string;
      subject: string;
      author: string;
      /** 相対 (無ければ null: 絶対だけ出す) と絶対の時刻。 */
      when: { relative: string | null; absolute: string };
      active: boolean;
      fresh: boolean;
      inRange: boolean;
      /** 枝の線の SVG (history-graph.ts。数だけから作る)。 */
      graph: string;
      refs: {
        chips: { className: string; title: string; name: string }[];
        /** 枝の名前を全部 (入りきらない札の分も)。無ければ ""。 */
        names: string;
      } | null;
    };

/** 選んだコミットの頭の操作。 */
export type HistoryActionsProps = {
  copy: {
    title: string;
    state: "idle" | "copied" | "failed";
    onClick(): void;
  } | null;
  /** リポジトリの Web の画面へのリンク (外から受け取った要素)。 */
  link: HTMLElement | null;
  parents: {
    label: string;
    items: { label: string; pressed: boolean; onClick(): void }[];
  } | null;
  comparing: { label: string; clearLabel: string; onClear(): void } | null;
};

/** 選んだコミット (または作業ツリー) の頭と本文。 */
export type HistoryCommitInfoProps = {
  back: { label: string; onClick(): void } | null;
  /** 作業ツリーのときは null (頭を隠す)。 */
  head: {
    sha: string;
    author: string;
    date: string;
    actions: HistoryActionsProps;
  } | null;
  subject: string;
  /** 本文 (描いた Markdown)。無いときは null で隠す。 */
  body: { content: unknown } | null;
};

export type HistoryBodyProps = {
  rendered: HTMLElement;
  expanded: boolean;
  label: string;
  onToggle(): void;
};

/** 履歴の画面 (createHistoryView) の描き方。 */
export type HistoryViewView = {
  panel(props: HistoryPanelProps): unknown;
  /** 選んだコミットの箱 (中身は commitInfo が描く)。 */
  commitInfoFrame(props: { page: boolean; label: string }): unknown;
  list(rows: readonly HistoryRowProps[]): unknown;
  commitInfo(props: HistoryCommitInfoProps): unknown;
  /** 長い本文を畳む箱。 */
  body(props: HistoryBodyProps): unknown;
  authorOptions(values: readonly string[]): unknown;
};

const graphCell = (graph: string) =>
  html`<span class="history-graph-cell">${graph ? unsafeHTML(graph) : nothing}</span>`;

function rowTemplate(row: HistoryRowProps): unknown {
  if (row.kind === "group")
    return html`<li class="history-group" aria-hidden="true">${graphCell(row.graph)}${row.label}</li>`;
  if (row.kind === "worktree")
    return html`<li
      class=${`history-item history-item-worktree${row.active ? " active" : ""}`}
      data-sha=${HISTORY_WORKTREE_COMMIT}
      role="option"
      tabindex="-1"
    ><span class="history-graph-cell"></span><span class="history-title"><span
          class="subject"
          title=${row.label}
        >${row.label}</span></span><span class="meta2"><span class="sha"
          >HEAD..worktree</span
        ><span class="author">Working tree</span></span></li>`;
  const cls = [
    "history-item",
    row.active ? "active" : "",
    row.fresh ? "history-item-fresh" : "",
    row.inRange ? "history-item-in-range" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return html`<li class=${cls} data-sha=${row.sha} role="option" tabindex="-1"
    >${graphCell(row.graph)}<span class="history-title"><span
        class="subject"
        title=${row.subject}
      >${row.subject}</span>${
        row.refs
          ? html`<span class="history-refs" title=${row.refs.names || nothing}
              >${row.refs.chips.map(
                (chip) =>
                  html`<span class=${chip.className} title=${chip.title}
                    >${chip.name}</span
                  >`,
              )}</span
            >`
          : nothing
      }</span><span class="meta2"><span class="sha">${row.shortSha}</span><span
        class="author"
      >${row.author}</span><span class="when" title=${row.when.absolute}>${
        row.when.relative === null
          ? html`<span class="when-abs">${row.when.absolute}</span>`
          : html`<span class="when-rel">${row.when.relative}</span> <span
                class="when-abs"
              >(${row.when.absolute})</span>`
      }</span></span></li>`;
}

function actionsTemplate(props: HistoryActionsProps): unknown {
  return html`${
    props.copy
      ? html`<button
          type="button"
          class=${`gdp-btn gdp-btn-sm hci-copy${props.copy.state === "idle" ? "" : ` ${props.copy.state}`}`}
          title=${props.copy.title}
          aria-label=${props.copy.title}
          @click=${props.copy.onClick}
        >${
          props.copy.state === "copied"
            ? iconTemplate(CHECK_16_PATHS, "octicon-check")
            : iconTemplate(COPY_16_PATHS, "octicon-copy")
        }</button>`
      : nothing
  }${props.link ?? nothing}${
    props.parents
      ? html`<span class="hci-compare-label">${props.parents.label}</span>${props.parents.items.map(
          (item) => html`<button
            type="button"
            class="gdp-btn gdp-btn-sm hci-parent"
            aria-pressed=${String(item.pressed)}
            @click=${item.onClick}
          >${item.label}</button>`,
        )}`
      : nothing
  }${
    props.comparing
      ? html`<span class="hci-compare-label">${props.comparing.label}</span><button
            type="button"
            class="gdp-btn gdp-btn-sm hci-compare-clear"
            @click=${props.comparing.onClear}
          >${props.comparing.clearLabel}</button>`
      : nothing
  }`;
}

export const DEFAULT_VIEW: HistoryViewView = {
  panel: (props) => html`<aside
    id=${props.page ? "history-panel" : nothing}
    class=${props.page ? nothing : "gdp-file-history-panel"}
    ?hidden=${props.page}
    aria-label=${props.label}
    tabindex="-1"
  ><div class="history-head"><span class="history-title">${props.title}</span>${
    props.page
      ? html`<span
          data-ref-selector-mount=""
          data-ref-id="history-ref"
          data-placeholder="ref..."
          data-title="history ref"
        ></span>`
      : nothing
  }<button
        type="button"
        class="history-refresh"
        title=${props.refreshTitle}
        aria-label=${props.refreshTitle}
      >${iconTemplate(SYNC_16_PATH, "octicon-sync")}<span
          class="history-refresh-label"
        ></span></button><span
        class="db-refresh-result history-refresh-result"
        aria-live="polite"
        hidden
      ></span></div><div class="history-filter-wrap"><input
        id=${props.page ? "history-filter" : nothing}
        class=${props.page ? nothing : "history-filter"}
        type="search"
        placeholder=${props.filter.placeholder}
        title=${props.filter.title}
        autocomplete="off"
        list=${props.filter.authorListId}
      /><button
        type="button"
        id=${props.page ? "history-filter-clear" : nothing}
        class="history-filter-clear"
        hidden
        title=${props.filter.clearTitle}
        aria-label=${props.filter.clearTitle}
      >${props.filter.clearLabel}</button><datalist
        id=${props.filter.authorListId}
      ></datalist></div><div
      id=${props.page ? "history-banner" : nothing}
      class="history-banner"
      hidden
      role="status"
    ></div><ol
      id=${props.page ? "history-list" : nothing}
      class="history-list"
    ></ol><div
      id=${props.page ? "history-sentinel" : nothing}
      class="history-sentinel"
      aria-hidden="true"
    ></div><div
      id=${props.page ? "history-status" : nothing}
      class="history-status"
      hidden
      role="status"
    ></div></aside>`,
  commitInfoFrame: (props) => html`<section
    id=${props.page ? "history-commit-info" : nothing}
    class=${props.page ? "history-commit-info" : "history-commit-info gdp-file-history-commit-info"}
    hidden
    aria-label=${props.label}
  ></section>`,
  list: (rows) =>
    repeat(
      rows,
      (row) => row.key,
      (row) => rowTemplate(row),
    ),
  commitInfo: (props) => html`<div class="hci-back-slot">${
    props.back
      ? html`<button
          type="button"
          class="gdp-btn hci-back"
          @click=${props.back.onClick}
        >${iconTemplate([CHEVRON_LEFT_16_PATH], "hci-back-icon")}<span
            >${props.back.label}</span
          ></button>`
      : nothing
  }</div><div class="hci-head" ?hidden=${!props.head}><span class="hci-sha"
        >${props.head?.sha ?? ""}</span
      ><span class="hci-author">${props.head?.author ?? ""}</span><span
        class="hci-date"
      >${props.head?.date ?? ""}</span><span class="hci-actions">${
        props.head ? actionsTemplate(props.head.actions) : nothing
      }</span></div><h2 class="hci-subject">${props.subject}</h2><div
      class="hci-body"
      ?hidden=${!props.body}
    >${props.body?.content ?? nothing}</div>`,
  body: (props) => html`<div class="hci-body-expandable"><div
      class=${props.expanded ? "hci-body-collapsible expanded" : "hci-body-collapsible"}
    >${props.rendered}</div><div
      class="hci-body-toggle"
      role="button"
      tabindex="0"
      aria-expanded=${props.expanded ? "true" : "false"}
      @click=${props.onToggle}
      @keydown=${(event: KeyboardEvent) => {
        if (isImeComposing(event)) return;
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        props.onToggle();
      }}
    >${props.label}</div></div>`,
  authorOptions: (values) =>
    values.map((value) => html`<option value=${value}></option>`),
};

export function buildHistoryPanelDom(
  options: HistoryPanelDomOptions = {},
  view: HistoryViewView = DEFAULT_VIEW,
): Omit<HistoryViewMount, "commitInfo"> {
  const page = (options.variant || "page") === "page";
  // "author:<name>" suggestions, filled from /_authors on first focus.
  const authorListId = page
    ? "history-filter-authors"
    : `history-filter-authors-${Math.random().toString(36).slice(2, 8)}`;
  const panel = templateElement(
    view.panel({
      page,
      label: historyText(pageLanguage()).panelLabel,
      title: historyText(pageLanguage()).commitsTitle,
      refreshTitle: HISTORY_TEXT.en.refreshTitle,
      filter: {
        placeholder: HISTORY_TEXT.en.filterPlaceholder,
        title: HISTORY_TEXT.en.filterTitle,
        clearLabel: HISTORY_TEXT.en.filterClearLabel,
        clearTitle: HISTORY_TEXT.en.filterClearTitle,
        authorListId,
      },
    }),
  );
  const part = <T extends Element>(selector: string): T => {
    const element = panel.querySelector<T>(selector);
    if (!element) throw new Error(`history panel: ${selector} was not drawn`);
    return element;
  };
  return {
    panel,
    list: part<HTMLOListElement>(".history-list"),
    banner: part<HTMLElement>(".history-banner"),
    status: part<HTMLElement>(".history-status"),
    sentinel: part<HTMLElement>(".history-sentinel"),
    filterInput: part<HTMLInputElement>(".history-filter-wrap input"),
    filterClearButton: part<HTMLButtonElement>(".history-filter-clear"),
    authorList: part<HTMLDataListElement>("datalist"),
    refreshButton: part<HTMLButtonElement>(".history-refresh"),
    refreshResult: part<HTMLElement>(".history-refresh-result"),
  };
}

export type HistoryCommitInfoDomOptions = {
  variant?: "page" | "file";
};

/** まだ何も選んでいない箱の中身 (頭は空で出し、本文は隠す)。 */
const NO_COMMIT_INFO: HistoryCommitInfoProps = {
  back: null,
  head: {
    sha: "",
    author: "",
    date: "",
    actions: { copy: null, link: null, parents: null, comparing: null },
  },
  subject: "",
  body: null,
};

/**
 * 選んだコミットの箱。中身は作ったときから presenter と同じ描き方 (renderOwned)
 * で描くので、選び直しても中の要素は同じものが残る。
 */
export function buildHistoryCommitInfoDom(
  options: HistoryCommitInfoDomOptions = {},
  view: HistoryViewView = DEFAULT_VIEW,
): HTMLElement {
  const info = templateElement(
    view.commitInfoFrame({
      page: (options.variant || "page") === "page",
      label: historyText(pageLanguage()).selectedCommit,
    }),
  );
  renderOwned(info, view.commitInfo(NO_COMMIT_INFO));
  return info;
}

export function installHistoryPageDom(): HistoryViewMount {
  const panelDom = buildHistoryPanelDom({ variant: "page" });
  document.getElementById("history-panel")?.replaceWith(panelDom.panel);
  const commitInfo = buildHistoryCommitInfoDom({ variant: "page" });
  document.getElementById("history-commit-info")?.replaceWith(commitInfo);
  return { ...panelDom, commitInfo };
}

// ai-dup-check: allow -- 別ドメイン(history)の独立した小ヘルパ。
// annotation-speech.ts の関数とは引数も用途も無関係。
export function historyBodyLineCount(rawText: string): number {
  if (!rawText) return 0;
  return rawText.split(/\r?\n/).length;
}

export function historyBodyToggleLabel(
  expanded: boolean,
  remainingLines: number,
  lang: HistoryLang,
) {
  const t = HISTORY_TEXT[lang];
  return expanded ? t.bodyExpandClose : t.bodyExpandMore(remainingLines);
}

/** 長い本文は畳んで出す (開閉はこの箱の中だけの状態)。短ければそのまま。 */
export function buildExpandableHistoryBody(
  rendered: HTMLElement,
  rawText: string,
  lang: HistoryLang,
  view: HistoryViewView = DEFAULT_VIEW,
): HTMLElement {
  const lineCount = historyBodyLineCount(rawText);
  if (lineCount <= HISTORY_BODY_COLLAPSE_LINES) return rendered;
  const remainingLines = lineCount - HISTORY_BODY_COLLAPSE_LINES;
  let expanded = false;
  const box = detachedElement(() =>
    view.body({
      rendered,
      expanded,
      label: historyBodyToggleLabel(expanded, remainingLines, lang),
      onToggle: () => {
        expanded = !expanded;
        box.draw();
      },
    }),
  );
  return box.element;
}

export function createHistoryView(
  deps: HistoryViewDeps,
  view: HistoryViewView = DEFAULT_VIEW,
) {
  const defaultMount: HistoryViewMount = {
    panel: deps.$<HTMLElement>("#history-panel"),
    list: deps.$<HTMLOListElement>("#history-list"),
    banner: deps.$<HTMLElement>("#history-banner"),
    status: deps.$<HTMLElement>("#history-status"),
    sentinel: deps.$<HTMLElement>("#history-sentinel"),
    filterInput: document.querySelector<HTMLInputElement>("#history-filter"),
    filterClearButton: document.querySelector<HTMLButtonElement>(
      "#history-filter-clear",
    ),
    refreshButton:
      document.querySelector<HTMLButtonElement>(".history-refresh"),
    refreshResult: document.querySelector<HTMLElement>(
      ".history-refresh-result",
    ),
    commitInfo: document.querySelector<HTMLElement>("#history-commit-info"),
  };
  let activeMount = defaultMount;
  let panel = defaultMount.panel;
  let list = defaultMount.list;
  let banner = defaultMount.banner;
  let statusEl = defaultMount.status;
  let sentinel = defaultMount.sentinel;
  let attachedList: HTMLOListElement | null = null;
  /** 一覧の行の上のキーを受けるのをやめる (一覧の箱を付け替えるとき)。 */
  let detachListKeys: (() => void) | null = null;
  let attachedFilterInput: HTMLInputElement | null = null;
  let attachedFilterClearButton: HTMLButtonElement | null = null;
  let attachedRefreshButton: HTMLButtonElement | null = null;
  let filterTimer: ReturnType<typeof setTimeout> | null = null;
  let observer: IntersectionObserver | null = null;
  let ref = "HEAD";
  let commits: HistoryCommit[] = [];
  let hasMore = false;
  let loading = false;
  let generation = 0; // bumped on ref switch / re-enter to drop stale fetches
  let selectionGeneration = 0; // bumped on selection changes to drop stale async commits
  let selectedSha = "";
  let query = "";
  let mode: "history" | "file" = "history";
  let routeRef = "HEAD";
  let pathFilter = "";
  let refreshStatus: HistoryRefreshStatus = { type: "none" };
  let freshSha = "";
  // Non-empty while the selected commit is diffed against something other
  // than its first parent: the "from" sha of a Shift+click range, or the
  // second parent of a merge.
  let compareSha = "";
  // 電話の段で、今の選択の 1 つ前のブラウザの履歴が一覧か (一覧から選んで積んだ)。
  let listEntry = false;
  let authorsLoadedFor = "";
  // git log -L range when the log is restricted to a few lines of a file.
  let lineRange: HistoryLineRange | undefined;
  /** 選んだコミットの箱に出しているもの。本文は描いた Markdown (届くまで null)。 */
  let shown:
    | { kind: "none" }
    | { kind: "worktree" }
    | {
        kind: "commit";
        commit: HistoryCommit;
        body: HTMLElement | null;
        link: HTMLElement | null;
      } = { kind: "none" };
  /** 選んだコミットの sha をコピーした結果 (少しの間だけ印を出す)。 */
  let copyState: "idle" | "copied" | "failed" = "idle";
  let copyTimer: ReturnType<typeof setTimeout> | null = null;

  type HistoryScope = {
    mode: "history" | "file";
    logRef: string;
    routeRef: string;
    pathFilter: string;
    query: string;
    lines?: HistoryLineRange;
    commit?: string;
    compare?: string;
  };

  function lineRangeKey(range: HistoryLineRange | undefined): string {
    return range ? formatHistoryLineRange(range) : "";
  }

  function historyScopeFromRoute(route = deps.getRoute()): HistoryScope | null {
    if (route.screen === "history") {
      const nextRef = route.ref || "HEAD";
      return {
        mode: "history",
        logRef: nextRef,
        routeRef: nextRef,
        pathFilter: route.path || "",
        query: route.q || "",
        lines: route.path ? route.lines : undefined,
        commit: route.commit,
        compare: route.compare,
      };
    }
    if (route.screen === "file" && route.view === "history") {
      const nextRouteRef = route.ref || "worktree";
      return {
        mode: "file",
        logRef: nextRouteRef === "worktree" ? "HEAD" : nextRouteRef,
        routeRef: nextRouteRef,
        pathFilter: route.path,
        query: route.q || "",
        lines: route.lines,
        commit: route.commit,
        compare: route.compare,
      };
    }
    return null;
  }

  // The route that describes the current panel state. `commit` omitted means
  // "nothing selected"; `compare` is carried only when it is in effect.
  function routeFor(options: {
    commit?: string;
    compare?: string;
    query?: string;
    ref?: string;
  }): AppRoute {
    const commit = options.commit;
    const compare = options.compare || undefined;
    const q = (options.query ?? query) || undefined;
    const range =
      commit && commit !== HISTORY_WORKTREE_COMMIT
        ? diffRangeFor(commit, compare)
        : worktreeDiffRange();
    if (mode === "file") {
      return {
        screen: "file",
        path: pathFilter,
        ref: options.ref ?? routeRef,
        view: "history",
        ...(commit ? { commit } : {}),
        ...(compare ? { compare } : {}),
        ...(q ? { q } : {}),
        ...(lineRange ? { lines: lineRange } : {}),
        range,
      };
    }
    // The source view opened from the diff cards of the commit ("View File")
    // belongs to that commit: a filter change or a re-selection of the same
    // commit keeps it, picking another commit closes it.
    const current = deps.getRoute();
    const source =
      current.screen === "history" && commit && current.commit === commit
        ? current.source
        : undefined;
    return {
      screen: "history",
      ref: options.ref ?? ref,
      ...(pathFilter ? { path: pathFilter } : {}),
      ...(pathFilter && lineRange ? { lines: lineRange } : {}),
      ...(commit ? { commit } : {}),
      ...(compare ? { compare } : {}),
      ...(q ? { q } : {}),
      ...(source ? { source } : {}),
      range,
    };
  }

  function diffRangeFor(sha: string, compare?: string) {
    const commit = commits.find((item) => item.sha === sha);
    if (compare) return { from: compare, to: sha };
    return commit ? commitDiffRange(commit) : { from: `${sha}^`, to: sha };
  }

  function shortSha(sha: string): string {
    return sha.slice(0, 7);
  }

  function currentRefreshScopeKey(): string {
    const scope = historyScopeFromRoute();
    if (!scope) return "";
    return [
      scope.mode,
      scope.logRef,
      scope.routeRef,
      scope.pathFilter,
      lineRangeKey(scope.lines),
      query,
    ].join("\0");
  }

  function worktreeDiffRange() {
    return { from: "HEAD", to: "worktree" };
  }

  function setBanner(message: string) {
    banner.textContent = message;
    banner.hidden = !message;
  }

  function setStatusText(message: string) {
    statusEl.textContent = message;
    statusEl.hidden = !message;
  }

  function latestCommitSha(): string {
    return (
      commits.find((commit) => commit.sha !== HISTORY_WORKTREE_COMMIT)?.sha ||
      ""
    );
  }

  function clearRefreshResult() {
    refreshStatus = { type: "none" };
    freshSha = "";
    syncRefreshResult();
  }

  function setRefreshResult(previousTopSha: string, nextTopSha: string) {
    freshSha =
      previousTopSha && nextTopSha && previousTopSha !== nextTopSha
        ? nextTopSha
        : "";
    refreshStatus = { type: "none" };
    renderList();
  }

  function syncRefreshStatusText() {
    setStatusText(
      loading
        ? "loading..."
        : refreshStatus.type === "pending"
          ? ""
          : commits.length
            ? ""
            : "no commits",
    );
  }

  function commitInfoElement(): HTMLElement | null {
    return (
      activeMount.commitInfo ||
      document.querySelector<HTMLElement>("#history-commit-info")
    );
  }

  function clearCommitInfo() {
    shown = { kind: "none" };
    drawCommitInfo();
  }

  function relativeWhen(iso: string): string {
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return iso;
    // 30 日より前は日付だけ (相対では幅をとるうえに読み取りにくい)。
    if (Date.now() - t >= 30 * 24 * 60 * 60 * 1000) return iso.slice(0, 10);
    return relativeTimeText(t / 1000, deps.getLanguage());
  }

  function absoluteWhen(iso: string): string {
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return iso;
    const d = new Date(t);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  /** 「相対 (絶対)」の時刻。一覧が狭いときは CSS が絶対の方を隠す (列の幅を
   * そろえるため)。相対が絶対と同じ (古いコミット) なら絶対だけ (relative は null)。 */
  function displayWhen(iso: string): {
    relative: string | null;
    absolute: string;
  } {
    const relative = relativeWhen(iso);
    const absolute = absoluteWhen(iso);
    if (relative === absolute || relative === absolute.slice(0, 10))
      return { relative: null, absolute };
    return { relative, absolute };
  }

  function historyItemSelector(sha: string): string {
    const escaped =
      typeof CSS !== "undefined" && CSS.escape
        ? CSS.escape(sha)
        : sha.replace(/["\\]/g, "\\$&");
    return `.history-item[data-sha="${escaped}"]`;
  }

  function fetchPage(
    skip: number,
    requestGeneration: number,
  ): Promise<HistoryLogResponse | null> {
    const params = new URLSearchParams();
    params.set("ref", ref);
    params.set("skip", String(skip));
    params.set("limit", String(HISTORY_PAGE_SIZE));
    if (query) params.set("q", query);
    if (pathFilter) {
      params.set("path", pathFilter);
      if (lineRange) params.set("lines", formatHistoryLineRange(lineRange));
      if (routeRef === "worktree") params.set("worktree", "1");
    }
    const url = `${apiUrl("log")}?${params.toString()}`;
    return deps
      .trackLoad(
        fetch(url).then(async (r) => {
          if (!r.ok)
            throw new Error(await responseErrorMessage(r, "loading the log"));
          const page = (await r.json()) as HistoryLogResponse;
          if (page.generation !== undefined && requestGeneration !== generation)
            return null;
          return page;
        }),
      )
      .catch((err) => {
        // null は「描かない」。失敗の理由は帯と console に残す。
        console.error("[code-viewer] loading the log failed", err);
        setBanner(formatErrorDetail(err));
        return null;
      });
  }

  function refChips(
    commit: HistoryCommit,
  ): Extract<HistoryRowProps, { kind: "commit" }>["refs"] {
    const text = historyText(deps.getLanguage());
    const chips = (commit.refs ?? []).map((ref) => ({
      className: [
        "history-ref",
        `history-ref-${ref.kind}`,
        ref.head ? "history-ref-head" : "",
      ]
        .filter(Boolean)
        .join(" "),
      title: text.refTitle(ref.kind, ref.name),
      name: ref.name,
    }));
    if (commit.parents.length > 1)
      chips.push({
        className: "history-ref history-ref-merge",
        title: text.mergeBadge,
        name: text.mergeBadge,
      });
    // 入りきらない札は隠れる (style.css の B-1) ので、全部の名前は title に。
    const names = (commit.refs ?? []).map((ref) => ref.name).join(", ");
    return chips.length ? { chips, names } : null;
  }

  // Rows covered by the current Shift+click range: from the selected (newer)
  // commit down to the commit whose first parent is `compareSha`. A merge
  // parent comparison has no such run and highlights nothing.
  function rangeShas(): Set<string> {
    const shas = new Set<string>();
    if (!compareSha || !selectedSha) return shas;
    const start = commits.findIndex((commit) => commit.sha === selectedSha);
    if (start < 0) return shas;
    const end = commits.findIndex(
      (commit, index) => index >= start && commit.parents[0] === compareSha,
    );
    if (end < 0) return shas;
    for (let index = start; index <= end; index++) shas.add(commits[index].sha);
    return shas;
  }

  /** 枝の線は一覧が変わったときだけ数え直す (選び直しでは同じ)。 */
  let graphCache: {
    commits: HistoryCommit[];
    linear: boolean;
    graph: ReturnType<typeof buildHistoryGraph>;
    rows: Map<string, GraphRow>;
  } | null = null;

  function graphFor(linear: boolean) {
    if (graphCache?.commits === commits && graphCache.linear === linear)
      return graphCache;
    const graphCommits = commits.filter(
      (commit) => commit.sha !== HISTORY_WORKTREE_COMMIT,
    );
    const graph = buildHistoryGraph(graphCommits, { linear });
    const rows = new Map<string, GraphRow>();
    graphCommits.forEach((commit, i) => {
      rows.set(commit.sha, graph.rows[i]);
    });
    graphCache = { commits, linear, graph, rows };
    return graphCache;
  }

  function listRows(): HistoryRowProps[] {
    const now = new Date();
    const worktree = (): HistoryRowProps => ({
      kind: "worktree",
      key: HISTORY_WORKTREE_COMMIT,
      active: selectedSha === HISTORY_WORKTREE_COMMIT,
      label: historyWorktreeLabel(deps.getLanguage()),
    });
    const rows: HistoryRowProps[] = mode === "history" ? [worktree()] : [];
    const inRange = rangeShas();
    // 枝の線は全体の履歴のときだけ。絞り込み中・1 ファイルの履歴は並んだ行が
    // 親子とは限らないので、行を上から順につないだ 1 本の線にする。
    const { graph, rows: graphRows } = graphFor(
      mode !== "history" || query !== "" || !!pathFilter,
    );
    let lastGroup = "";
    for (const commit of commits) {
      if (commit.sha === HISTORY_WORKTREE_COMMIT) {
        rows.push(worktree());
        continue;
      }
      const row = graphRows.get(commit.sha);
      const group = historyGroupLabel(commit.when, now);
      if (group !== lastGroup) {
        rows.push({
          kind: "group",
          key: `group:${group}:${commit.sha}`,
          label: group,
          graph: historyGraphPassSvg(passingLanes(row), graph.lanes),
        });
        lastGroup = group;
      }
      rows.push({
        kind: "commit",
        key: commit.sha,
        sha: commit.sha,
        shortSha: shortSha(commit.sha),
        subject: commit.subject,
        author: commit.author,
        when: displayWhen(commit.when),
        active: commit.sha === selectedSha,
        fresh: commit.sha === freshSha,
        inRange: inRange.has(commit.sha),
        graph: row ? historyGraphSvg(row, graph.lanes) : "",
        refs: refChips(commit),
      });
    }
    // 同じ行が 2 度並ぶ (作業ツリーの行) ときも、鍵は 1 つずつにする。
    const seen = new Map<string, number>();
    return rows.map((row) => {
      const count = seen.get(row.key) ?? 0;
      seen.set(row.key, count + 1);
      return count === 0 ? row : { ...row, key: `${row.key}#${count}` };
    });
  }

  function drawList(focused?: FocusedListRow | null) {
    renderOwned(list, view.list(listRows()));
    syncListTabStopHere(focused);
  }

  function renderList() {
    syncRefreshButton(activeMount.refreshButton);
    syncRefreshResult(activeMount.refreshResult);
    // 描き直す前に、行にあったフォーカスを控える (行が入れ替わると body へ落ちる)。
    drawList(focusedListRow(list, HISTORY_ROW_SELECTOR, rowSha));
    syncRefreshStatusText();
  }

  // コミットの一覧は Tab の止まり場所を 1 つにする (views/list-tab-stop.ts):
  // 選んでいる行 (無ければ先頭の行) だけが tabIndex 0。選び直したら選んだ行へ
  // フォーカスを移す。行の上の ↑↓ は j k と同じ moveSelection、Home / End は
  // 先頭 / 末尾のコミット、Enter は 1 回押したのと同じ (行の click)。
  const HISTORY_ROW_SELECTOR = ".history-item";

  function rowSha(row: HTMLElement): string {
    return row.dataset.sha ?? "";
  }

  function syncListTabStopHere(focused?: FocusedListRow | null) {
    syncListTabStop(list, {
      rows: [...list.querySelectorAll<HTMLElement>(HISTORY_ROW_SELECTOR)],
      keyOf: rowSha,
      isActive: (row) => row.classList.contains("active"),
      ariaSelected: true,
      ...(focused === undefined ? {} : { focused }),
      fallback: panel,
    });
  }

  function historyRowKeys(): ListRowKeys {
    return {
      ArrowDown: (row) => void moveSelection(1, rowSha(row)),
      ArrowUp: (row) => void moveSelection(-1, rowSha(row)),
      Home: () => void selectEdge("first"),
      End: () => void selectEdge("last"),
      Enter: (row) => {
        row.click();
        // click は j k のために一覧の箱へフォーカスを移すので、行へ戻す。
        row.focus({ preventScroll: true });
      },
    };
  }

  async function selectEdge(edge: "first" | "last") {
    if (!historyScopeFromRoute()) return;
    const shas = selectableShas();
    const sha = edge === "first" ? shas[0] : shas[shas.length - 1];
    if (!sha) return;
    await selectSha(sha);
    scrollToSelected();
  }

  function syncRefreshButton(button?: HTMLButtonElement | null) {
    if (!button) return;
    const text = historyText(deps.getLanguage());
    const hasPendingUpdate = refreshStatus.type === "pending";
    const title = hasPendingUpdate
      ? text.refreshTitlePending
      : text.refreshTitle;
    button.title = title;
    button.setAttribute("aria-label", title);
    button.classList.toggle("has-update", hasPendingUpdate);
    const label = button.querySelector(".history-refresh-label");
    if (label) label.textContent = "";
  }

  function syncRefreshResult(result?: HTMLElement | null) {
    const el = result ?? activeMount.refreshResult;
    if (!el) return;
    el.textContent = "";
    el.hidden = true;
    el.classList.toggle("changed", false);
    el.classList.toggle("pending", false);
  }

  function syncFilterClearButton(button?: HTMLButtonElement | null) {
    const clearButton = button ?? activeMount.filterClearButton;
    if (!clearButton) return;
    const input = activeMount.filterInput ?? null;
    const text = historyText(deps.getLanguage());
    clearButton.textContent = text.filterClearLabel;
    clearButton.title = text.filterClearTitle;
    clearButton.setAttribute("aria-label", text.filterClearTitle);
    clearButton.hidden = !(input?.value || "");
  }

  function commitInfoProps(): HistoryCommitInfoProps {
    const text = historyText(deps.getLanguage());
    const back = { label: text.backToList, onClick: backToList };
    if (shown.kind === "none") return NO_COMMIT_INFO;
    if (shown.kind === "worktree")
      return {
        back,
        head: null,
        subject: historyWorktreeLabel(deps.getLanguage()),
        body: null,
      };
    const { commit } = shown;
    const t = Date.parse(commit.when);
    return {
      back,
      head: {
        sha: commit.sha,
        author: commit.author,
        date: Number.isFinite(t)
          ? new Date(t).toLocaleString(deps.getLanguage())
          : commit.when,
        actions: commitActions(commit, shown.link),
      },
      subject: commit.subject,
      // 本文のあるコミットは、Markdown が描けるまで空の箱を出しておく。
      body: commit.body ? { content: shown.body ?? nothing } : null,
    };
  }

  function drawCommitInfo() {
    const info = commitInfoElement();
    if (!info) return;
    renderOwned(info, view.commitInfo(commitInfoProps()));
    info.hidden = shown.kind === "none";
  }

  async function updateCommitInfo(commit: HistoryCommit | null) {
    if (!commitInfoElement()) return;
    if (!commit) {
      clearCommitInfo();
      return;
    }
    const gen = generation;
    if (copyTimer) clearTimeout(copyTimer);
    copyTimer = null;
    copyState = "idle";
    const link = deps.commitWebLink?.(commit.sha) ?? null;
    link?.classList.add("hci-link");
    shown = { kind: "commit", commit, body: null, link };
    drawCommitInfo();
    if (!commit.body) return;
    const rendered = await renderMarkdownPreview(
      commit.body,
      { path: "COMMIT_MSG", ref: commit.sha },
      { syntaxHighlight: deps.getSyntaxHighlight() },
    );
    if (gen !== generation || selectedSha !== commit.sha) return;
    if (shown.kind !== "commit" || shown.commit !== commit) return;
    shown = {
      ...shown,
      body: buildExpandableHistoryBody(
        rendered,
        commit.body,
        deps.getLanguage(),
        view,
      ),
    };
    drawCommitInfo();
  }

  function commitActions(
    commit: HistoryCommit,
    link: HTMLElement | null,
  ): HistoryActionsProps {
    const text = historyText(deps.getLanguage());
    const copyText = deps.copyText;
    return {
      copy: copyText
        ? {
            title:
              copyState === "copied"
                ? text.copiedTitle
                : copyState === "failed"
                  ? text.copyFailedTitle
                  : text.copyShaTitle,
            state: copyState,
            onClick: () => {
              void copyText(commit.sha)
                .then(() => {
                  copyState = "copied";
                })
                .catch((err: unknown) => {
                  console.error("Failed to copy commit sha", err);
                  copyState = "failed";
                })
                .finally(() => {
                  drawCommitInfo();
                  if (copyTimer) clearTimeout(copyTimer);
                  copyTimer = setTimeout(() => {
                    copyTimer = null;
                    copyState = "idle";
                    drawCommitInfo();
                  }, 1200);
                });
            },
          }
        : null,
      link,
      parents:
        commit.parents.length > 1
          ? {
              label: text.compareWith,
              items: commit.parents.map((parent, index) => ({
                label: text.parentLabel(index + 1, shortSha(parent)),
                pressed: compareSha ? compareSha === parent : index === 0,
                onClick: () => {
                  void selectCommit(commit, {
                    compare: index === 0 ? "" : parent,
                  });
                },
              })),
            }
          : null,
      comparing:
        compareSha && !commit.parents.includes(compareSha)
          ? {
              label: text.comparing(shortSha(compareSha), shortSha(commit.sha)),
              clearLabel: text.clearCompare,
              onClear: () => {
                void selectCommit(commit, { compare: "" });
              },
            }
          : null,
    };
  }

  function updateWorktreeInfo() {
    shown = { kind: "worktree" };
    drawCommitInfo();
  }

  /** 選んだ行と Shift+click の範囲の色を描き直す (行は作り直さないので、行への
   * 参照とスクロールの位置は残る)。 */
  function updateActiveRow() {
    drawList();
  }

  function selectableShas(): string[] {
    const shas: string[] = mode === "history" ? [HISTORY_WORKTREE_COMMIT] : [];
    for (const commit of commits) {
      if (!shas.includes(commit.sha)) shas.push(commit.sha);
    }
    return shas;
  }

  async function selectSha(sha: string) {
    if (sha === HISTORY_WORKTREE_COMMIT) {
      await selectWorktree();
      return;
    }
    const commit = commits.find((item) => item.sha === sha);
    if (commit) await selectCommit(commit);
  }

  /**
   * 選んでいるコミットの隣を選ぶ (j k・↑↓)。from は行の上の ↑↓ のときの起点
   * (Tab で入った、まだ選んでいない行からも、その行の隣へ動かす)。
   */
  async function moveSelection(delta: 1 | -1, from?: string) {
    if (!historyScopeFromRoute()) return;
    let shas = selectableShas();
    if (shas.length === 0) return;
    const origin = from ?? selectedSha;
    let index = origin ? shas.indexOf(origin) : -1;
    if (index < 0) index = delta > 0 ? -1 : shas.length;
    let nextIndex = index + delta;
    if (nextIndex >= shas.length && hasMore && !loading) {
      await loadNextPage();
      shas = selectableShas();
      nextIndex = Math.min(nextIndex, shas.length - 1);
    }
    if (nextIndex < 0 || nextIndex >= shas.length) return;
    await selectSha(shas[nextIndex]);
    scrollToSelected();
  }

  // Shared in-flight promise so concurrent callers (IntersectionObserver and
  // resolveDeepLink) await the same real page load instead of busy-spinning.
  let inFlight: Promise<boolean> | null = null;
  function loadNextPage(): Promise<boolean> {
    if (inFlight) return inFlight;
    const started: Promise<boolean> = doLoadNextPage().finally(() => {
      // Only clear our own promise; a generation reset may have replaced it.
      if (inFlight === started) inFlight = null;
    });
    inFlight = started;
    return started;
  }

  async function doLoadNextPage(): Promise<boolean> {
    loading = true;
    const gen = generation;
    setStatusText("loading...");
    const page = await fetchPage(commits.length, gen);
    if (gen !== generation) return false;
    loading = false;
    if (!page) {
      setStatusText("");
      return false;
    }
    commits = commits.concat(page.commits);
    hasMore = page.hasMore;
    renderList();
    return page.commits.length > 0;
  }

  // `compare` ("" = first parent, the default) decides what the commit is
  // diffed against. It is explicit on every caller so a plain click always
  // clears a previous range / parent choice.
  /**
   * 電話の段で一覧から選んだら、差分をブラウザの履歴に積む (戻るで一覧へ戻る)。
   * それ以外は置き換える (デスクトップで選び直すたびに履歴が増えない)。
   */
  function pushesSelection(fromList: boolean | undefined): boolean {
    if (fromList !== true || deps.listIsPage?.() !== true) return false;
    // 差分の上に一覧を開き直して選び直したときは置き換える (1 つ前は一覧のまま)。
    const push = !listEntry;
    listEntry = true;
    return push;
  }

  /**
   * 差分の頭の「一覧へ戻る」。一覧から積んだならブラウザの戻るで積んだ項を戻す。
   * ファイルの履歴のタブは一覧が同じ箱の中にあるので、選択を外して一覧を出す。
   */
  function backToList() {
    if (listEntry) {
      listEntry = false;
      history.back();
    } else if (mode === "file") {
      deps.setRoute(routeFor({}), true);
      void showNoSelection();
    } else deps.showList?.();
  }

  /** 選んでいるコミットを外し、差分の箱を「未選択」に戻す。 */
  async function showNoSelection() {
    selectionGeneration++;
    selectedSha = "";
    listEntry = false;
    updateActiveRow();
    await updateCommitInfo(null);
    deps.showEmptyDiffPane();
  }

  async function selectCommit(
    commit: HistoryCommit,
    options: { updateUrl?: boolean; compare?: string; fromList?: boolean } = {},
  ) {
    const selectionGen = ++selectionGeneration;
    const gen = generation;
    selectedSha = commit.sha;
    compareSha = options.compare ?? "";
    if (compareSha === commit.parents[0]) compareSha = "";
    updateActiveRow();
    await updateCommitInfo(commit);
    if (selectionGen !== selectionGeneration || gen !== generation) return;
    const range = compareSha
      ? { from: compareSha, to: commit.sha }
      : commitDiffRange(commit);
    // URL から当て直した選択 (開き直し・ブラウザの戻る・進む) は、1 つ前が一覧か分からない。
    if (options.updateUrl === false) listEntry = false;
    else
      deps.setRoute(
        routeFor({ commit: commit.sha, compare: compareSha }),
        !pushesSelection(options.fromList),
      );
    if (selectionGen !== selectionGeneration || gen !== generation) return;
    await deps.applyCommitRange(range, pathFilter || undefined);
    if (selectionGen !== selectionGeneration || gen !== generation) return;
  }

  // Shift+click: diff from the older of (selected, clicked) back to its
  // first parent, up to the newer one — every commit in between inclusive.
  async function selectRange(clicked: HistoryCommit) {
    const anchor = commits.find((item) => item.sha === selectedSha);
    if (!anchor || anchor.sha === clicked.sha) {
      await selectCommit(clicked, { compare: "" });
      return;
    }
    const anchorIndex = commits.indexOf(anchor);
    const clickedIndex = commits.indexOf(clicked);
    const newer = anchorIndex < clickedIndex ? anchor : clicked;
    const older = newer === anchor ? clicked : anchor;
    await selectCommit(newer, {
      compare: older.parents[0] || EMPTY_TREE_SHA,
    });
  }

  async function selectWorktree(
    options: { updateUrl?: boolean; fromList?: boolean } = {},
  ) {
    const selectionGen = ++selectionGeneration;
    const gen = generation;
    selectedSha = HISTORY_WORKTREE_COMMIT;
    compareSha = "";
    updateActiveRow();
    updateWorktreeInfo();
    const range = worktreeDiffRange();
    if (options.updateUrl === false) listEntry = false;
    else
      deps.setRoute(
        routeFor({ commit: selectedSha }),
        !pushesSelection(options.fromList),
      );
    if (selectionGen !== selectionGeneration || gen !== generation) return;
    await deps.applyCommitRange(range, pathFilter || undefined);
    if (selectionGen !== selectionGeneration || gen !== generation) return;
  }

  // HTTP 400 means the server says the ref does not exist; every other
  // failure (network, 5xx, bad JSON) is kept with its cause for the banner.
  async function fetchSingleCommit(
    sha: string,
  ): Promise<
    | { kind: "found"; commit: HistoryCommit }
    | { kind: "missing" }
    | { kind: "failed"; error: Error }
  > {
    const url = `${apiUrl("log")}?ref=${encodeURIComponent(sha)}&skip=0&limit=1`;
    try {
      const res = await deps.trackLoad(
        fetch(url).then(async (r) => {
          if (r.status === 400) return null;
          if (!r.ok) {
            throw new Error(
              await responseErrorMessage(r, `load commit ${sha}`),
            );
          }
          return (await r.json()) as HistoryLogResponse;
        }),
      );
      const commit = res?.commits[0];
      return commit ? { kind: "found", commit } : { kind: "missing" };
    } catch (error) {
      return {
        kind: "failed",
        error: errorWithCause(`failed to load commit: ${sha}`, error),
      };
    }
  }

  // Deep link: keep paging until the commit shows up, then fall back to a
  // single lookup pinned to the top of the list.
  async function resolveDeepLink(sha: string) {
    const gen = generation;
    if (sha === HISTORY_WORKTREE_COMMIT) {
      await selectWorktree({ updateUrl: false });
      return;
    }
    let pagesLoaded = 0;
    if (commits.length === 0) {
      await loadNextPage();
      if (gen !== generation) return;
      pagesLoaded = 1;
    } else {
      pagesLoaded = 1;
    }
    const compare = historyScopeFromRoute()?.compare || "";
    for (;;) {
      const found = commits.find((c) => c.sha.startsWith(sha));
      if (found) {
        await selectCommit(found, { updateUrl: false, compare });
        scrollToSelected();
        return;
      }
      if (!shouldContinueAutoLoad({ pagesLoaded, found: false, hasMore }))
        break;
      const got = await loadNextPage();
      if (gen !== generation) return;
      pagesLoaded++;
      if (!got && !hasMore) break;
    }
    const lookup = await fetchSingleCommit(sha);
    if (gen !== generation) return;
    if (lookup.kind !== "found") {
      if (lookup.kind === "failed") console.error(lookup.error);
      setBanner(
        lookup.kind === "failed"
          ? formatErrorDetail(lookup.error)
          : `commit not found: ${sha}`,
      );
      await updateCommitInfo(null);
      deps.showEmptyDiffPane();
      return;
    }
    const single = lookup.commit;
    setBanner(`showing commit outside the loaded ${ref} log`);
    commits = [single, ...commits];
    renderList();
    await selectCommit(single, { updateUrl: false, compare });
    scrollToSelected();
  }

  function scrollToSelected() {
    list
      .querySelector<HTMLElement>(historyItemSelector(selectedSha))
      ?.scrollIntoView({ block: "center" });
  }

  // Serialize enterHistory calls so overlapping invocations (e.g. rapid ref
  // picks plus route changes) run sequentially instead of interleaving.
  let entering: Promise<void> = Promise.resolve();
  function enterHistory(
    options: { mount?: HistoryViewMount; force?: boolean } = {},
  ): Promise<void> {
    const force = options.force === true;
    const mount = options.mount || (force ? activeMount : defaultMount);
    activateMount(mount);
    // 1 回の失敗で後の enter が止まらないよう、列は失敗しても続ける。ただし
    // 理由は捨てずに console とバナーへ出す。
    entering = entering
      .then(() => doEnterHistory(force))
      .catch((error: unknown) => {
        const failure = errorWithCause("opening the history failed", error);
        console.error(failure);
        setBanner(formatErrorDetail(failure));
      });
    return entering;
  }

  // force=true treats the call like a ref change (full reset + reload) even
  // when the route's ref equals the current one.
  async function doEnterHistory(force = false) {
    const scope = historyScopeFromRoute();
    if (!scope) return;
    const scopeChanged =
      scope.logRef !== ref ||
      scope.routeRef !== routeRef ||
      scope.pathFilter !== pathFilter ||
      lineRangeKey(scope.lines) !== lineRangeKey(lineRange) ||
      scope.query !== query ||
      scope.mode !== mode;
    if (scopeChanged || force || commits.length === 0) {
      generation++;
      const gen = generation;
      ref = scope.logRef;
      routeRef = scope.routeRef;
      pathFilter = scope.pathFilter;
      lineRange = scope.lines;
      query = scope.query;
      mode = scope.mode;
      compareSha = "";
      syncFilterInputValue();
      syncPanelTitle();
      commits = [];
      hasMore = false;
      loading = false;
      inFlight = null;
      selectionGeneration++;
      selectedSha = "";
      setBanner("");
      clearRefreshResult();
      await updateCommitInfo(null);
      renderList();
      await loadNextPage();
      if (gen !== generation) return;
    } else {
      renderList();
    }
    const scope2 = historyScopeFromRoute();
    if (!scope2) return;
    if (scope2.commit) {
      await resolveDeepLink(scope2.commit);
    } else {
      await showNoSelection();
    }
  }

  function onRefPicked(nextRef: string) {
    const value = nextRef && nextRef !== "worktree" ? nextRef : "HEAD";
    // Keep the filter text and path scope; only the ref changes.
    deps.setRoute(
      routeFor({
        ref: mode === "file" ? nextRef || "worktree" : value,
      }),
      false,
    );
    // Force a reload even if the picked ref equals the current one.
    void enterHistory({ force: true });
  }

  function leaveHistory() {
    generation++;
    listEntry = false;
    loading = false;
    inFlight = null;
    compareSha = "";
    if (filterTimer) {
      clearTimeout(filterTimer);
      filterTimer = undefined;
    }
    selectionGeneration++;
    selectedSha = "";
    setBanner("");
    setStatusText("");
    updateActiveRow();
    clearCommitInfo();
  }

  function handleListClick(e: MouseEvent) {
    const row = (e.target as Element).closest<HTMLElement>(".history-item");
    if (!row?.dataset.sha) return;
    // Keyboard focus follows the click so j / k act on this list. 箱を見える
    // 位置へ送らない: 電話の段のファイルの履歴では、送った分だけ次に出す
    // コミットの頭 (一覧へ戻るボタン) が上の固定の段の下に隠れた。
    panel.focus?.({ preventScroll: true });
    if (row.dataset.sha === HISTORY_WORKTREE_COMMIT) {
      void selectWorktree({ fromList: true });
      return;
    }
    const commit = commits.find((c) => c.sha === row.dataset.sha);
    if (!commit) return;
    if (e.shiftKey && selectedSha && selectedSha !== HISTORY_WORKTREE_COMMIT) {
      void selectRange(commit);
      return;
    }
    void selectCommit(commit, { compare: "", fromList: true });
  }

  // Server-side filter (syntax: core/history.ts tokenizeHistoryQuery). Keeps
  // the selected commit and the diff pane untouched; only the list reloads.
  // The text also lives in the URL (?q=) so a reload or a shared link
  // restores it.
  function applyFilter(next: string) {
    const value = next.trim();
    if (value === query) return;
    query = value;
    if (historyScopeFromRoute()) {
      deps.setRoute(
        routeFor({
          commit: selectedSha || undefined,
          compare: compareSha,
          query: value,
        }),
        true,
      );
    }
    generation++;
    selectionGeneration++;
    clearRefreshResult();
    commits = [];
    hasMore = false;
    loading = false;
    inFlight = null;
    setBanner("");
    renderList();
    void loadNextPage();
  }

  function activeFilterInputFromEvent(event?: Event): HTMLInputElement | null {
    const target = event?.target;
    if (
      typeof HTMLInputElement === "function" &&
      target instanceof HTMLInputElement &&
      target === activeMount.filterInput
    ) {
      return target;
    }
    return attachedFilterInput;
  }

  function handleFilterInput(event?: Event) {
    const input = activeFilterInputFromEvent(event);
    if (!input) return;
    syncFilterClearButton();
    if (filterTimer) clearTimeout(filterTimer);
    filterTimer = setTimeout(() => {
      filterTimer = null;
      applyFilter(input.value);
    }, 250);
  }

  function handleFilterKeydown(e: KeyboardEvent) {
    const input = attachedFilterInput;
    if (!input) return;
    if (isImeComposing(e)) return;
    if (e.key === "Escape" && input.value) {
      input.value = "";
      syncFilterClearButton();
      applyFilter("");
      e.stopPropagation();
    }
  }

  function handleFilterClearClick() {
    const input = attachedFilterInput;
    if (!input?.value) return;
    if (filterTimer) {
      clearTimeout(filterTimer);
      filterTimer = null;
    }
    input.value = "";
    syncFilterClearButton();
    applyFilter("");
    input.focus?.();
  }

  async function handleRefreshClick() {
    const button = attachedRefreshButton;
    if (button?.disabled) return;
    const refreshScopeKey = currentRefreshScopeKey();
    const previousTopSha = latestCommitSha();
    clearRefreshResult();
    if (button) {
      button.disabled = true;
      button.classList.add("spinning");
    }
    try {
      await enterHistory({ mount: activeMount, force: true });
      if (!refreshScopeKey || currentRefreshScopeKey() !== refreshScopeKey)
        return;
      setRefreshResult(previousTopSha, latestCommitSha());
    } finally {
      if (button) {
        button.classList.remove("spinning");
        button.disabled = false;
      }
    }
  }

  function activateMount(mount: HistoryViewMount) {
    if (activeMount === mount && attachedList === mount.list) {
      syncRefreshButton(mount.refreshButton);
      syncRefreshResult(mount.refreshResult);
      syncFilterClearButton(mount.filterClearButton);
      return;
    }
    if (attachedList) {
      attachedList.removeEventListener("click", handleListClick);
      detachListKeys?.();
      detachListKeys = null;
      attachedList = null;
    }
    if (attachedFilterInput) {
      attachedFilterInput.removeEventListener("input", handleFilterInput);
      attachedFilterInput.removeEventListener("change", handleFilterInput);
      attachedFilterInput.removeEventListener("keydown", handleFilterKeydown);
      attachedFilterInput.removeEventListener("focus", handleFilterFocus);
      attachedFilterInput = null;
    }
    if (attachedFilterClearButton) {
      attachedFilterClearButton.removeEventListener(
        "click",
        handleFilterClearClick,
      );
      attachedFilterClearButton = null;
    }
    if (attachedRefreshButton) {
      attachedRefreshButton.removeEventListener("click", handleRefreshClick);
      attachedRefreshButton = null;
    }
    if (filterTimer) {
      clearTimeout(filterTimer);
      filterTimer = null;
    }
    observer?.disconnect();

    activeMount = mount;
    panel = mount.panel;
    list = mount.list;
    banner = mount.banner;
    statusEl = mount.status;
    sentinel = mount.sentinel;

    list.addEventListener("click", handleListClick);
    detachListKeys = onListRowKeys(
      list,
      HISTORY_ROW_SELECTOR,
      historyRowKeys(),
    );
    attachedList = list;
    const input = mount.filterInput ?? null;
    if (input) {
      input.value = query;
      input.addEventListener("input", handleFilterInput);
      input.addEventListener("change", handleFilterInput);
      input.addEventListener("keydown", handleFilterKeydown);
      input.addEventListener("focus", handleFilterFocus);
      attachedFilterInput = input;
    }
    syncPanelTitle();
    syncFilterChrome();
    const filterClearButton = mount.filterClearButton ?? null;
    if (filterClearButton) {
      syncFilterClearButton(filterClearButton);
      filterClearButton.addEventListener("click", handleFilterClearClick);
      attachedFilterClearButton = filterClearButton;
    }
    const refreshButton = mount.refreshButton ?? null;
    if (refreshButton) {
      syncRefreshButton(refreshButton);
      syncRefreshResult(mount.refreshResult);
      refreshButton.addEventListener("click", handleRefreshClick);
      attachedRefreshButton = refreshButton;
    }
    observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        if (!historyScopeFromRoute()) return;
        if (hasMore && !loading) loadNextPage();
      },
      { root: panel, rootMargin: "200px" },
    );
    observer.observe(sentinel);
  }

  function syncFilterInputValue() {
    const input = activeMount.filterInput ?? null;
    if (input && input.value !== query) input.value = query;
    syncFilterClearButton();
  }

  function syncFilterChrome() {
    const input = activeMount.filterInput ?? null;
    if (!input) return;
    const text = historyText(deps.getLanguage());
    input.placeholder = text.filterPlaceholder;
    input.title = text.filterTitle;
  }

  function syncPanelTitle() {
    const text = historyText(deps.getLanguage());
    const label = lineRange
      ? text.commitsForLines(lineRange.start, lineRange.end)
      : mode === "history" && pathFilter
        ? text.commitsIn(pathFilter)
        : text.commitsTitle;
    // 行は選べる項目 (中にボタンが無い) なので listbox。名前は見出しと同じ。
    list.setAttribute("role", "listbox");
    list.setAttribute("aria-label", label);
    const title = panel.querySelector?.<HTMLElement>(".history-title");
    if (!title) return;
    title.textContent = label;
  }

  // "author:<name>" suggestions for the filter, loaded once per ref the
  // first time the field gets focus.
  function handleFilterFocus() {
    const list = activeMount.authorList ?? null;
    if (!list || typeof fetch !== "function") return;
    const key = ref;
    if (authorsLoadedFor === key) return;
    authorsLoadedFor = key;
    void deps
      .trackLoad(
        fetch(`${apiUrl("authors")}?ref=${encodeURIComponent(ref)}`).then(
          async (r) => {
            if (!r.ok)
              throw new Error(
                await responseErrorMessage(r, "loading history authors"),
              );
            return (await r.json()) as HistoryAuthorsResponse;
          },
        ),
      )
      .then((res) => {
        if (activeMount.authorList !== list || key !== ref) return;
        renderOwned(
          list,
          view.authorOptions(
            res.authors.map((author) => `author:${author.name}`),
          ),
        );
      })
      .catch((err: unknown) => {
        authorsLoadedFor = "";
        console.error("Failed to load history authors", err);
      });
  }

  const docWithEvents = document as Document & {
    addEventListener?: Document["addEventListener"];
  };
  docWithEvents.addEventListener?.("input", (e) => {
    if (e.target !== activeMount.filterInput) return;
    handleFilterInput(e);
  });
  docWithEvents.addEventListener?.("change", (e) => {
    if (e.target !== activeMount.filterInput) return;
    handleFilterInput(e);
  });

  activateMount(defaultMount);

  return {
    enterHistory,
    leaveHistory,
    resetProject() {
      leaveHistory();
      commits = [];
      ref = "";
    },
    onRefPicked,
    localize: () => {
      syncRefreshButton(activeMount.refreshButton);
      syncRefreshResult(activeMount.refreshResult);
      syncFilterClearButton(activeMount.filterClearButton);
      syncFilterChrome();
      syncPanelTitle();
      renderList();
    },
    // Keyboard stepping through the commit list (keymap actions
    // history-next-commit / history-previous-commit).
    moveCommitSelection: (delta: 1 | -1) => moveSelection(delta),
    // Called from the SSE "update" listener when a history panel is on
    // screen. Only updates existing local UI hints — no fetch, no list redraw,
    // no generation bump, so it can't race with trackLoad/cancelInFlightRequests.
    notePossibleUpdate: () => {
      refreshStatus = { type: "pending" };
      syncRefreshButton(activeMount.refreshButton);
      syncRefreshResult(activeMount.refreshResult);
      syncRefreshStatusText();
    },
    isWorktreeSelected: () => selectedSha === HISTORY_WORKTREE_COMMIT,
  };
}
