// Commit history screen (left panel). Renders the commit list, handles
// infinite scroll / deep links, and delegates diff rendering to the existing
// diff pipeline via deps.applyCommitRange().

import {
  commitDiffRange,
  HISTORY_PAGE_SIZE,
  type HistoryCommit,
  type HistoryLogResponse,
  historyGroupLabel,
  shouldContinueAutoLoad,
} from "../core/history";
import { iconSvg, SYNC_16_PATH } from "../core/icons";
import { isImeComposing } from "../core/keyboard";
import { renderMarkdownPreview } from "../core/markdown-preview";
import type { AppRoute } from "../core/routes";

export const HISTORY_BODY_COLLAPSE_LINES = 10;
export const HISTORY_WORKTREE_COMMIT = "worktree";

export type HistoryLang = "en" | "ja";

export type HistoryText = {
  worktreeLabel: string;
  bodyExpandClose: string;
  bodyExpandMore: (remainingLines: number) => string;
  refreshLabel: string;
  refreshLabelPending: string;
  refreshTitle: string;
  refreshTitlePending: string;
  refreshPendingStatus: string;
  refreshResultUpdated: (sha: string) => string;
  refreshResultUnchanged: string;
  refreshResultUnchangedInView: string;
  filterClearLabel: string;
  filterClearTitle: string;
};

type HistoryRefreshStatus =
  | { type: "none" }
  | { type: "pending" }
  | { type: "updated"; sha: string }
  | { type: "unchanged"; scoped: boolean };

const HISTORY_TEXT: Record<HistoryLang, HistoryText> = {
  en: {
    worktreeLabel: "Uncommitted changes (Working tree)",
    bodyExpandClose: "Collapse",
    bodyExpandMore: (n) => `Show more (${n} lines)`,
    refreshLabel: "Refresh",
    refreshLabelPending: "Update",
    refreshTitle: "Refresh commit history",
    refreshTitlePending: "History may have changed. Refresh",
    refreshPendingStatus: "History may have changed",
    refreshResultUpdated: (sha) => `Updated: ${sha} is now latest`,
    refreshResultUnchanged: "No new commits",
    refreshResultUnchangedInView: "No new commits in this view",
    filterClearLabel: "Clear",
    filterClearTitle: "Clear commit filter",
  },
  ja: {
    worktreeLabel: "未コミット変更 (Working tree)",
    bodyExpandClose: "閉じる",
    bodyExpandMore: (n) => `もっと見る (${n} 行)`,
    refreshLabel: "更新",
    refreshLabelPending: "更新あり",
    refreshTitle: "コミット履歴を更新",
    refreshTitlePending: "新しい履歴がある可能性があります。更新",
    refreshPendingStatus: "新しい履歴がある可能性があります",
    refreshResultUpdated: (sha) => `更新: ${sha} が最新です`,
    refreshResultUnchanged: "新しいコミットはありません",
    refreshResultUnchangedInView: "この表示では新しいコミットはありません",
    filterClearLabel: "解除",
    filterClearTitle: "コミットフィルタを解除",
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
  escapeHtml(s: unknown): string;
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
};

export type HistoryViewMount = {
  panel: HTMLElement;
  list: HTMLOListElement;
  banner: HTMLElement;
  status: HTMLElement;
  sentinel: HTMLElement;
  filterInput?: HTMLInputElement | null;
  filterClearButton?: HTMLButtonElement | null;
  refreshButton?: HTMLButtonElement | null;
  refreshResult?: HTMLElement | null;
  commitInfo?: HTMLElement | null;
};

export type HistoryPanelDomOptions = {
  variant?: "page" | "file";
};

export function buildHistoryPanelDom(
  options: HistoryPanelDomOptions = {},
): Omit<HistoryViewMount, "commitInfo"> {
  const variant = options.variant || "page";
  const page = variant === "page";
  const panel = document.createElement("aside");
  if (page) {
    panel.id = "history-panel";
    panel.hidden = true;
  } else {
    panel.className = "gdp-file-history-panel";
  }
  panel.setAttribute("aria-label", "Commit history");

  const panelHead = document.createElement("div");
  panelHead.className = "history-head";
  const title = document.createElement("span");
  title.className = "history-title";
  title.textContent = "Commits";
  panelHead.appendChild(title);

  const refreshButton = document.createElement("button");
  refreshButton.type = "button";
  refreshButton.className = "history-refresh";
  refreshButton.title = HISTORY_TEXT.en.refreshTitle;
  refreshButton.setAttribute("aria-label", HISTORY_TEXT.en.refreshTitle);
  refreshButton.innerHTML = iconSvg("octicon-sync", SYNC_16_PATH);
  const refreshLabel = document.createElement("span");
  refreshLabel.className = "history-refresh-label";
  refreshLabel.textContent = HISTORY_TEXT.en.refreshLabel;
  refreshButton.appendChild(refreshLabel);
  const refreshResult = document.createElement("span");
  refreshResult.className = "db-refresh-result history-refresh-result";
  refreshResult.setAttribute("aria-live", "polite");
  refreshResult.hidden = true;

  if (page) {
    const refMount = document.createElement("span");
    refMount.dataset.refSelectorMount = "";
    refMount.dataset.refId = "history-ref";
    refMount.dataset.placeholder = "ref...";
    refMount.dataset.title = "history ref";
    panelHead.appendChild(refMount);
  }
  panelHead.append(refreshButton, refreshResult);

  const filterWrap = document.createElement("div");
  filterWrap.className = "history-filter-wrap";
  const filterInput = document.createElement("input");
  if (page) filterInput.id = "history-filter";
  else filterInput.className = "history-filter";
  filterInput.type = "search";
  filterInput.placeholder = page
    ? "filter commits… (message, sha, author:name, path:file)"
    : "filter commits… (message, sha, author:name)";
  filterInput.autocomplete = "off";
  const filterClearButton = document.createElement("button");
  filterClearButton.type = "button";
  if (page) filterClearButton.id = "history-filter-clear";
  filterClearButton.className = "history-filter-clear";
  filterClearButton.hidden = true;
  filterClearButton.textContent = HISTORY_TEXT.en.filterClearLabel;
  filterClearButton.title = HISTORY_TEXT.en.filterClearTitle;
  filterClearButton.setAttribute(
    "aria-label",
    HISTORY_TEXT.en.filterClearTitle,
  );
  filterWrap.append(filterInput, filterClearButton);

  const banner = document.createElement("div");
  if (page) banner.id = "history-banner";
  banner.className = "history-banner";
  banner.hidden = true;
  banner.setAttribute("role", "status");

  const list = document.createElement("ol");
  if (page) list.id = "history-list";
  list.className = "history-list";

  const sentinel = document.createElement("div");
  if (page) sentinel.id = "history-sentinel";
  sentinel.className = "history-sentinel";
  sentinel.setAttribute("aria-hidden", "true");

  const status = document.createElement("div");
  if (page) status.id = "history-status";
  status.className = "history-status";
  status.hidden = true;
  status.setAttribute("role", "status");

  panel.append(panelHead, filterWrap, banner, list, sentinel, status);
  return {
    panel,
    list,
    banner,
    status,
    sentinel,
    filterInput,
    filterClearButton,
    refreshButton,
    refreshResult,
  };
}

export type HistoryCommitInfoDomOptions = {
  variant?: "page" | "file";
};

export function buildHistoryCommitInfoDom(
  options: HistoryCommitInfoDomOptions = {},
): HTMLElement {
  const variant = options.variant || "page";
  const page = variant === "page";
  const info = document.createElement("section");
  if (page) info.id = "history-commit-info";
  info.className = page
    ? "history-commit-info"
    : "history-commit-info gdp-file-history-commit-info";
  info.hidden = true;
  info.setAttribute("aria-label", "Selected commit");
  const head = document.createElement("div");
  head.className = "hci-head";
  const sha = document.createElement("span");
  if (page) sha.id = "hci-sha";
  sha.className = "hci-sha";
  const author = document.createElement("span");
  if (page) author.id = "hci-author";
  author.className = "hci-author";
  const date = document.createElement("span");
  if (page) date.id = "hci-date";
  date.className = "hci-date";
  head.append(sha, author, date);
  const subject = document.createElement("h2");
  if (page) subject.id = "hci-subject";
  subject.className = "hci-subject";
  const body = document.createElement("div");
  if (page) body.id = "hci-body";
  body.className = "hci-body";
  body.hidden = true;
  info.append(head, subject, body);
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

export function buildExpandableHistoryBody(
  rendered: HTMLElement,
  rawText: string,
  lang: HistoryLang,
): HTMLElement {
  const lineCount = historyBodyLineCount(rawText);
  if (lineCount <= HISTORY_BODY_COLLAPSE_LINES) return rendered;
  const wrap = document.createElement("div");
  wrap.className = "hci-body-expandable";
  const collapsible = document.createElement("div");
  collapsible.className = "hci-body-collapsible";
  collapsible.appendChild(rendered);
  const button = document.createElement("div");
  button.className = "hci-body-toggle";
  button.setAttribute("role", "button");
  button.setAttribute("tabindex", "0");
  const remainingLines = lineCount - HISTORY_BODY_COLLAPSE_LINES;
  const sync = () => {
    const expanded = collapsible.classList.contains("expanded");
    button.textContent = historyBodyToggleLabel(expanded, remainingLines, lang);
    button.setAttribute("aria-expanded", expanded ? "true" : "false");
  };
  const toggle = () => {
    collapsible.classList.toggle("expanded");
    sync();
  };
  button.addEventListener("click", toggle);
  button.addEventListener("keydown", (event) => {
    if (isImeComposing(event)) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    toggle();
  });
  sync();
  wrap.append(collapsible, button);
  return wrap;
}

export function createHistoryView(deps: HistoryViewDeps) {
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

  type HistoryScope = {
    mode: "history" | "file";
    logRef: string;
    routeRef: string;
    pathFilter: string;
    commit?: string;
  };

  function historyScopeFromRoute(route = deps.getRoute()): HistoryScope | null {
    if (route.screen === "history") {
      const nextRef = route.ref || "HEAD";
      return {
        mode: "history",
        logRef: nextRef,
        routeRef: nextRef,
        pathFilter: "",
        commit: route.commit,
      };
    }
    if (route.screen === "file" && route.view === "history") {
      const nextRouteRef = route.ref || "worktree";
      return {
        mode: "file",
        logRef: nextRouteRef === "worktree" ? "HEAD" : nextRouteRef,
        routeRef: nextRouteRef,
        pathFilter: route.path,
        commit: route.commit,
      };
    }
    return null;
  }

  function currentRefreshScopeKey(): string {
    const scope = historyScopeFromRoute();
    if (!scope) return "";
    return [
      scope.mode,
      scope.logRef,
      scope.routeRef,
      scope.pathFilter,
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
    refreshStatus = freshSha
      ? { type: "updated", sha: nextTopSha.slice(0, 7) }
      : { type: "unchanged", scoped: Boolean(query || pathFilter) };
    renderList();
  }

  function refreshStatusMessage(): string {
    const text = historyText(deps.getLanguage());
    switch (refreshStatus.type) {
      case "pending":
        return text.refreshPendingStatus;
      case "updated":
        return text.refreshResultUpdated(refreshStatus.sha);
      case "unchanged":
        return refreshStatus.scoped
          ? text.refreshResultUnchangedInView
          : text.refreshResultUnchanged;
      case "none":
        return "";
      default: {
        const exhaustive: never = refreshStatus;
        return exhaustive;
      }
    }
  }

  function syncRefreshStatusText() {
    setStatusText(
      loading
        ? "loading..."
        : refreshStatusMessage() || (commits.length ? "" : "no commits"),
    );
  }

  function commitInfoElement(): HTMLElement | null {
    return (
      activeMount.commitInfo ||
      document.querySelector<HTMLElement>("#history-commit-info")
    );
  }

  function clearCommitInfo() {
    const info = commitInfoElement();
    if (!info) return;
    info.hidden = true;
    info.querySelector<HTMLElement>(".hci-head")?.removeAttribute("hidden");
    info.querySelector<HTMLElement>(".hci-body")?.replaceChildren();
  }

  function relativeWhen(iso: string): string {
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return iso;
    const sec = Math.round((Date.now() - t) / 1000);
    if (sec < 60) return "just now";
    const min = Math.round(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hour = Math.round(min / 60);
    if (hour < 24) return `${hour}h ago`;
    const day = Math.round(hour / 24);
    if (day < 30) return `${day}d ago`;
    return iso.slice(0, 10);
  }

  function absoluteWhen(iso: string): string {
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return iso;
    const d = new Date(t);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function displayWhen(iso: string): string {
    const relative = relativeWhen(iso);
    const absolute = absoluteWhen(iso);
    if (relative === absolute || relative === absolute.slice(0, 10))
      return absolute;
    return `${relative} (${absolute})`;
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
      if (routeRef === "worktree") params.set("worktree", "1");
    }
    const url = `/_log?${params.toString()}`;
    return deps
      .trackLoad(
        fetch(url).then(async (r) => {
          if (!r.ok) throw new Error(await r.text());
          const page = (await r.json()) as HistoryLogResponse;
          if (page.generation !== undefined && requestGeneration !== generation)
            return null;
          return page;
        }),
      )
      .catch((err) => {
        setBanner(err instanceof Error ? err.message : "failed to load log");
        return null;
      });
  }

  function commitRow(commit: HistoryCommit): string {
    const active = commit.sha === selectedSha ? " active" : "";
    const fresh = commit.sha === freshSha ? " history-item-fresh" : "";
    return (
      `<li class="history-item${active}${fresh}" data-sha="${deps.escapeHtml(commit.sha)}">` +
      `<span class="subject" title="${deps.escapeHtml(commit.subject)}">${deps.escapeHtml(commit.subject)}</span>` +
      `<span class="meta2">` +
      `<span class="sha">${deps.escapeHtml(commit.sha.slice(0, 7))}</span>` +
      `<span class="author">${deps.escapeHtml(commit.author)}</span>` +
      `<span class="when">${deps.escapeHtml(displayWhen(commit.when))}</span>` +
      `</span>` +
      `</li>`
    );
  }

  function worktreeRow(): string {
    const active = selectedSha === HISTORY_WORKTREE_COMMIT ? " active" : "";
    return (
      `<li class="history-item history-item-worktree${active}" data-sha="${HISTORY_WORKTREE_COMMIT}">` +
      `<span class="subject" title="${deps.escapeHtml(historyWorktreeLabel(deps.getLanguage()))}">${deps.escapeHtml(historyWorktreeLabel(deps.getLanguage()))}</span>` +
      `<span class="meta2">` +
      `<span class="sha">HEAD..worktree</span>` +
      `<span class="author">Working tree</span>` +
      `</span>` +
      `</li>`
    );
  }

  function renderList() {
    syncRefreshButton(activeMount.refreshButton);
    syncRefreshResult(activeMount.refreshResult);
    const now = new Date();
    const html: string[] = mode === "history" ? [worktreeRow()] : [];
    let lastGroup = "";
    for (const commit of commits) {
      if (commit.sha === HISTORY_WORKTREE_COMMIT) {
        html.push(worktreeRow());
        continue;
      }
      const group = historyGroupLabel(commit.when, now);
      if (group !== lastGroup) {
        html.push(
          `<li class="history-group" aria-hidden="true">${deps.escapeHtml(group)}</li>`,
        );
        lastGroup = group;
      }
      html.push(commitRow(commit));
    }
    list.innerHTML = html.join("");
    syncRefreshStatusText();
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
    if (label) {
      label.textContent = hasPendingUpdate
        ? text.refreshLabelPending
        : text.refreshLabel;
    }
  }

  function syncRefreshResult(result?: HTMLElement | null) {
    const el = result ?? activeMount.refreshResult;
    if (!el) return;
    const message =
      refreshStatus.type === "updated" || refreshStatus.type === "unchanged"
        ? refreshStatusMessage()
        : "";
    el.textContent = message;
    el.hidden = message.length === 0;
    el.classList.toggle("changed", refreshStatus.type === "updated");
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

  async function updateCommitInfo(commit: HistoryCommit | null) {
    const info = commitInfoElement();
    if (!info) return;
    if (!commit) {
      clearCommitInfo();
      return;
    }
    const gen = generation;
    const set = (sel: string, text: string) => {
      const el = info.querySelector<HTMLElement>(sel);
      if (el) el.textContent = text;
    };
    info.querySelector<HTMLElement>(".hci-head")?.removeAttribute("hidden");
    set(".hci-sha", commit.sha);
    set(".hci-author", commit.author);
    const t = Date.parse(commit.when);
    set(
      ".hci-date",
      Number.isFinite(t) ? new Date(t).toLocaleString() : commit.when,
    );
    set(".hci-subject", commit.subject);
    const body = info.querySelector<HTMLElement>(".hci-body");
    if (body) {
      body.replaceChildren();
      if (!commit.body) {
        body.hidden = true;
      } else {
        body.hidden = false;
        const rendered = await renderMarkdownPreview(
          commit.body,
          { path: "COMMIT_MSG", ref: commit.sha },
          { syntaxHighlight: deps.getSyntaxHighlight() },
        );
        if (gen !== generation || selectedSha !== commit.sha) return;
        body.replaceChildren(
          buildExpandableHistoryBody(rendered, commit.body, deps.getLanguage()),
        );
      }
    }
    info.hidden = false;
  }

  function updateWorktreeInfo() {
    const info = commitInfoElement();
    if (!info) return;
    info.querySelector<HTMLElement>(".hci-head")?.setAttribute("hidden", "");
    const subject = info.querySelector<HTMLElement>(".hci-subject");
    if (subject) {
      subject.textContent = historyWorktreeLabel(deps.getLanguage());
    }
    const body = info.querySelector<HTMLElement>(".hci-body");
    if (body) {
      body.hidden = true;
      body.replaceChildren();
    }
    info.hidden = false;
  }

  function updateActiveRow() {
    list.querySelectorAll<HTMLElement>(".history-item").forEach((row) => {
      row.classList.toggle("active", row.dataset.sha === selectedSha);
    });
  }

  function isEditableTarget(target: EventTarget | null): boolean {
    return (
      typeof Element === "function" &&
      target instanceof Element &&
      !!target.closest(
        'input, textarea, select, button, [contenteditable="true"]',
      )
    );
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

  async function moveSelection(delta: 1 | -1) {
    if (!historyScopeFromRoute()) return;
    let shas = selectableShas();
    if (shas.length === 0) return;
    let index = selectedSha ? shas.indexOf(selectedSha) : -1;
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

  async function selectCommit(
    commit: HistoryCommit,
    options: { updateUrl?: boolean } = {},
  ) {
    const selectionGen = ++selectionGeneration;
    const gen = generation;
    selectedSha = commit.sha;
    updateActiveRow();
    await updateCommitInfo(commit);
    if (selectionGen !== selectionGeneration || gen !== generation) return;
    if (options.updateUrl !== false) {
      const range = commitDiffRange(commit);
      if (mode === "file") {
        deps.setRoute(
          {
            screen: "file",
            path: pathFilter,
            ref: routeRef,
            view: "history",
            commit: commit.sha,
            range,
          },
          true,
        );
      } else {
        deps.setRoute(
          { screen: "history", ref, commit: commit.sha, range },
          true,
        );
      }
    }
    if (selectionGen !== selectionGeneration || gen !== generation) return;
    await deps.applyCommitRange(
      commitDiffRange(commit),
      pathFilter || undefined,
    );
    if (selectionGen !== selectionGeneration || gen !== generation) return;
  }

  async function selectWorktree(options: { updateUrl?: boolean } = {}) {
    const selectionGen = ++selectionGeneration;
    const gen = generation;
    selectedSha = HISTORY_WORKTREE_COMMIT;
    updateActiveRow();
    updateWorktreeInfo();
    const range = worktreeDiffRange();
    if (options.updateUrl !== false) {
      if (mode === "file") {
        deps.setRoute(
          {
            screen: "file",
            path: pathFilter,
            ref: routeRef,
            view: "history",
            commit: selectedSha,
            range,
          },
          true,
        );
      } else {
        deps.setRoute(
          { screen: "history", ref, commit: selectedSha, range },
          true,
        );
      }
    }
    if (selectionGen !== selectionGeneration || gen !== generation) return;
    await deps.applyCommitRange(range, pathFilter || undefined);
    if (selectionGen !== selectionGeneration || gen !== generation) return;
  }

  // Set when fetchSingleCommit fails for reasons other than "the server says
  // the ref does not exist" (HTTP 400) — e.g. network errors or 5xx.
  let lookupFailed = false;

  async function fetchSingleCommit(sha: string): Promise<HistoryCommit | null> {
    const url = `/_log?ref=${encodeURIComponent(sha)}&skip=0&limit=1`;
    lookupFailed = false;
    try {
      const res = await deps.trackLoad(
        fetch(url).then(async (r) => {
          if (r.status === 400) return null;
          if (!r.ok) throw new Error(await r.text());
          return (await r.json()) as HistoryLogResponse;
        }),
      );
      return res?.commits[0] || null;
    } catch {
      lookupFailed = true;
      return null;
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
    for (;;) {
      const found = commits.find((c) => c.sha.startsWith(sha));
      if (found) {
        await selectCommit(found, { updateUrl: false });
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
    const single = await fetchSingleCommit(sha);
    if (gen !== generation) return;
    if (!single) {
      setBanner(
        lookupFailed
          ? `failed to load commit: ${sha}`
          : `commit not found: ${sha}`,
      );
      await updateCommitInfo(null);
      deps.showEmptyDiffPane();
      return;
    }
    setBanner(`showing commit outside the loaded ${ref} log`);
    commits = [single, ...commits];
    renderList();
    await selectCommit(single, { updateUrl: false });
    scrollToSelected();
  }

  function scrollToSelected() {
    const escaped =
      typeof CSS !== "undefined" && CSS.escape
        ? CSS.escape(selectedSha)
        : selectedSha.replace(/["\\]/g, "\\$&");
    list
      .querySelector<HTMLElement>(`.history-item[data-sha="${escaped}"]`)
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
    entering = entering
      .then(() => doEnterHistory(force))
      .catch(() => undefined);
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
      scope.mode !== mode;
    if (scopeChanged || force || commits.length === 0) {
      generation++;
      const gen = generation;
      ref = scope.logRef;
      routeRef = scope.routeRef;
      pathFilter = scope.pathFilter;
      mode = scope.mode;
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
      selectionGeneration++;
      selectedSha = "";
      updateActiveRow();
      await updateCommitInfo(null);
      deps.showEmptyDiffPane();
    }
  }

  function onRefPicked(nextRef: string) {
    const value = nextRef && nextRef !== "worktree" ? nextRef : "HEAD";
    if (mode === "file" && pathFilter) {
      deps.setRoute(
        {
          screen: "file",
          path: pathFilter,
          ref: nextRef || "worktree",
          view: "history",
          range: { from: "HEAD", to: "worktree" },
        },
        false,
      );
    } else {
      deps.setRoute(
        {
          screen: "history",
          ref: value,
          range: { from: "HEAD", to: "worktree" },
        },
        false,
      );
    }
    // Force a reload even if the picked ref equals the current one.
    void enterHistory({ force: true });
  }

  function leaveHistory() {
    generation++;
    loading = false;
    inFlight = null;
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
    if (row.dataset.sha === HISTORY_WORKTREE_COMMIT) {
      void selectWorktree();
      return;
    }
    const commit = commits.find((c) => c.sha === row.dataset.sha);
    if (commit) selectCommit(commit);
  }

  // Server-side filter: message text by default, sha prefix for hex terms,
  // plus "author:" and "path:" prefixes. Keeps the selected commit and the
  // diff pane untouched; only the list reloads.
  function applyFilter(next: string) {
    const value = next.trim();
    if (value === query) return;
    query = value;
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
      attachedList = null;
    }
    if (attachedFilterInput) {
      attachedFilterInput.removeEventListener("input", handleFilterInput);
      attachedFilterInput.removeEventListener("change", handleFilterInput);
      attachedFilterInput.removeEventListener("keydown", handleFilterKeydown);
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
    attachedList = list;
    const input = mount.filterInput ?? null;
    if (input) {
      input.value = query;
      input.addEventListener("input", handleFilterInput);
      input.addEventListener("change", handleFilterInput);
      input.addEventListener("keydown", handleFilterKeydown);
      attachedFilterInput = input;
    }
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

  const docWithEvents = document as Document & {
    addEventListener?: Document["addEventListener"];
  };
  docWithEvents.addEventListener?.("keydown", (e) => {
    if (isImeComposing(e) || isEditableTarget(e.target)) return;
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    if (!historyScopeFromRoute()) return;
    e.preventDefault();
    void moveSelection(e.key === "ArrowDown" ? 1 : -1);
  });
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
    onRefPicked,
    localize: () => {
      syncRefreshButton(activeMount.refreshButton);
      syncRefreshResult(activeMount.refreshResult);
      syncFilterClearButton(activeMount.filterClearButton);
      renderList();
    },
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
