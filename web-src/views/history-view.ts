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
import { renderMarkdownPreview } from "../core/markdown-preview";
import type { AppRoute } from "../core/routes";

export const HISTORY_BODY_COLLAPSE_LINES = 10;
export const HISTORY_WORKTREE_COMMIT = "worktree";
export const HISTORY_WORKTREE_LABEL = "未コミット変更 (Working tree)";

export type HistoryViewDeps = {
  $: <T extends Element = HTMLElement>(sel: string) => T;
  escapeHtml(s: unknown): string;
  getRoute(): AppRoute;
  setRoute(route: AppRoute, replace?: boolean): void;
  // Sets STATE.from/to to the commit range and reloads the diff pane.
  applyCommitRange(range: { from: string; to: string }): Promise<void>;
  // Clears the diff pane and shows the "no commit selected" empty state.
  showEmptyDiffPane(): void;
  getSyntaxHighlight(): boolean;
  trackLoad<T>(promise: Promise<T>): Promise<T>;
};

export function historyBodyLineCount(rawText: string): number {
  if (!rawText) return 0;
  return rawText.split(/\r?\n/).length;
}

export function historyBodyToggleLabel(
  expanded: boolean,
  remainingLines: number,
) {
  return expanded ? "閉じる" : `もっと見る (${remainingLines} 行)`;
}

export function buildExpandableHistoryBody(
  rendered: HTMLElement,
  rawText: string,
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
    button.textContent = historyBodyToggleLabel(expanded, remainingLines);
    button.setAttribute("aria-expanded", expanded ? "true" : "false");
  };
  const toggle = () => {
    collapsible.classList.toggle("expanded");
    sync();
  };
  button.addEventListener("click", toggle);
  button.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    toggle();
  });
  sync();
  wrap.append(collapsible, button);
  return wrap;
}

export function createHistoryView(deps: HistoryViewDeps) {
  const panel = deps.$<HTMLElement>("#history-panel");
  const list = deps.$<HTMLOListElement>("#history-list");
  const banner = deps.$<HTMLElement>("#history-banner");
  const statusEl = deps.$<HTMLElement>("#history-status");
  const sentinel = deps.$<HTMLElement>("#history-sentinel");

  let ref = "HEAD";
  let commits: HistoryCommit[] = [];
  let hasMore = false;
  let loading = false;
  let generation = 0; // bumped on ref switch / re-enter to drop stale fetches
  let selectedSha = "";
  let query = "";

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

  function clearCommitInfo() {
    const info = document.querySelector<HTMLElement>("#history-commit-info");
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

  function fetchPage(skip: number): Promise<HistoryLogResponse | null> {
    const url =
      `/_log?ref=${encodeURIComponent(ref)}&skip=${skip}&limit=${HISTORY_PAGE_SIZE}` +
      (query ? `&q=${encodeURIComponent(query)}` : "");
    return deps
      .trackLoad(
        fetch(url).then(async (r) => {
          if (!r.ok) throw new Error(await r.text());
          return (await r.json()) as HistoryLogResponse;
        }),
      )
      .catch((err) => {
        setBanner(err instanceof Error ? err.message : "failed to load log");
        return null;
      });
  }

  function commitRow(commit: HistoryCommit): string {
    const active = commit.sha === selectedSha ? " active" : "";
    return (
      `<li class="history-item${active}" data-sha="${deps.escapeHtml(commit.sha)}">` +
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
      `<span class="subject" title="${deps.escapeHtml(HISTORY_WORKTREE_LABEL)}">${deps.escapeHtml(HISTORY_WORKTREE_LABEL)}</span>` +
      `<span class="meta2">` +
      `<span class="sha">HEAD..worktree</span>` +
      `<span class="author">Working tree</span>` +
      `</span>` +
      `</li>`
    );
  }

  function renderList() {
    const now = new Date();
    const html: string[] = [worktreeRow()];
    let lastGroup = "";
    for (const commit of commits) {
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
    setStatusText(loading ? "loading..." : commits.length ? "" : "no commits");
  }

  async function updateCommitInfo(commit: HistoryCommit | null) {
    const info = document.querySelector<HTMLElement>("#history-commit-info");
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
        body.replaceChildren(buildExpandableHistoryBody(rendered, commit.body));
      }
    }
    info.hidden = false;
  }

  function updateWorktreeInfo() {
    const info = document.querySelector<HTMLElement>("#history-commit-info");
    if (!info) return;
    info.querySelector<HTMLElement>(".hci-head")?.setAttribute("hidden", "");
    const subject = info.querySelector<HTMLElement>(".hci-subject");
    if (subject) subject.textContent = HISTORY_WORKTREE_LABEL;
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
    const page = await fetchPage(commits.length);
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
    const gen = generation;
    selectedSha = commit.sha;
    updateActiveRow();
    await updateCommitInfo(commit);
    if (gen !== generation) return;
    if (options.updateUrl !== false) {
      const range = commitDiffRange(commit);
      deps.setRoute(
        { screen: "history", ref, commit: commit.sha, range },
        true,
      );
    }
    if (gen !== generation) return;
    await deps.applyCommitRange(commitDiffRange(commit));
    if (gen !== generation) return;
  }

  async function selectWorktree(options: { updateUrl?: boolean } = {}) {
    const gen = generation;
    selectedSha = HISTORY_WORKTREE_COMMIT;
    updateActiveRow();
    updateWorktreeInfo();
    const range = worktreeDiffRange();
    if (options.updateUrl !== false) {
      deps.setRoute(
        { screen: "history", ref, commit: selectedSha, range },
        true,
      );
    }
    if (gen !== generation) return;
    await deps.applyCommitRange(range);
    if (gen !== generation) return;
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
    list
      .querySelector<HTMLElement>(
        `.history-item[data-sha="${CSS.escape(selectedSha)}"]`,
      )
      ?.scrollIntoView({ block: "center" });
  }

  // Serialize enterHistory calls so overlapping invocations (e.g. rapid ref
  // picks plus route changes) run sequentially instead of interleaving.
  let entering: Promise<void> = Promise.resolve();
  function enterHistory(force?: boolean): Promise<void> {
    entering = entering
      .then(() => doEnterHistory(force === true))
      .catch(() => {});
    return entering;
  }

  // force=true treats the call like a ref change (full reset + reload) even
  // when the route's ref equals the current one.
  async function doEnterHistory(force = false) {
    const route = deps.getRoute();
    if (route.screen !== "history") return;
    const nextRef = route.ref || "HEAD";
    const refChanged = nextRef !== ref;
    if (refChanged || force || commits.length === 0) {
      generation++;
      const gen = generation;
      ref = nextRef;
      commits = [];
      hasMore = false;
      loading = false;
      inFlight = null;
      selectedSha = "";
      setBanner("");
      await updateCommitInfo(null);
      renderList();
      await loadNextPage();
      if (gen !== generation) return;
    }
    const route2 = deps.getRoute();
    if (route2.screen !== "history") return;
    if (route2.commit) {
      await resolveDeepLink(route2.commit);
    } else {
      selectedSha = "";
      updateActiveRow();
      await updateCommitInfo(null);
      deps.showEmptyDiffPane();
    }
  }

  function onRefPicked(nextRef: string) {
    const value = nextRef && nextRef !== "worktree" ? nextRef : "HEAD";
    deps.setRoute(
      {
        screen: "history",
        ref: value,
        range: { from: "HEAD", to: "worktree" },
      },
      false,
    );
    // Force a reload even if the picked ref equals the current one.
    void enterHistory(true);
  }

  function leaveHistory() {
    generation++;
    loading = false;
    inFlight = null;
    selectedSha = "";
    setBanner("");
    setStatusText("");
    updateActiveRow();
    clearCommitInfo();
  }

  list.addEventListener("click", (e) => {
    const row = (e.target as Element).closest<HTMLElement>(".history-item");
    if (!row?.dataset.sha) return;
    if (row.dataset.sha === HISTORY_WORKTREE_COMMIT) {
      void selectWorktree();
      return;
    }
    const commit = commits.find((c) => c.sha === row.dataset.sha);
    if (commit) selectCommit(commit);
  });

  // Server-side filter: message text by default, sha prefix for hex terms,
  // plus "author:" and "path:" prefixes. Keeps the selected commit and the
  // diff pane untouched; only the list reloads.
  function applyFilter(next: string) {
    const value = next.trim();
    if (value === query) return;
    query = value;
    generation++;
    commits = [];
    hasMore = false;
    loading = false;
    inFlight = null;
    setBanner("");
    renderList();
    void loadNextPage();
  }

  const filterInput =
    document.querySelector<HTMLInputElement>("#history-filter");
  let filterTimer: ReturnType<typeof setTimeout> | null = null;
  filterInput?.addEventListener("input", () => {
    if (filterTimer) clearTimeout(filterTimer);
    filterTimer = setTimeout(() => {
      filterTimer = null;
      applyFilter(filterInput.value);
    }, 250);
  });
  filterInput?.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && filterInput.value) {
      filterInput.value = "";
      applyFilter("");
      e.stopPropagation();
    }
  });

  const observer = new IntersectionObserver(
    (entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      if (deps.getRoute().screen !== "history") return;
      if (hasMore && !loading) loadNextPage();
    },
    { root: panel, rootMargin: "200px" },
  );
  observer.observe(sentinel);

  return {
    enterHistory,
    leaveHistory,
    onRefPicked,
    isWorktreeSelected: () => selectedSha === HISTORY_WORKTREE_COMMIT,
  };
}
