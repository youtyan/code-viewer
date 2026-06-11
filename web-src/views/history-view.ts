// Commit history screen (left panel). Renders the commit list, handles
// infinite scroll / deep links, and delegates diff rendering to the existing
// diff pipeline via deps.applyCommitRange().

import {
  commitDiffRange,
  HISTORY_PAGE_SIZE,
  type HistoryCommit,
  type HistoryLogResponse,
  shouldContinueAutoLoad,
} from "../core/history";
import type { AppRoute } from "../core/routes";

export type HistoryViewDeps = {
  $: <T extends Element = HTMLElement>(sel: string) => T;
  escapeHtml(s: unknown): string;
  getRoute(): AppRoute;
  setRoute(route: AppRoute, replace?: boolean): void;
  // Sets STATE.from/to to the commit range and reloads the diff pane.
  applyCommitRange(range: { from: string; to: string }): Promise<void>;
  // Clears the diff pane and shows the "no commit selected" empty state.
  showEmptyDiffPane(): void;
  trackLoad<T>(promise: Promise<T>): Promise<T>;
};

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

  function setBanner(message: string) {
    banner.textContent = message;
    banner.hidden = !message;
  }

  function setStatusText(message: string) {
    statusEl.textContent = message;
    statusEl.hidden = !message;
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

  function fetchPage(skip: number): Promise<HistoryLogResponse | null> {
    const url = `/_log?ref=${encodeURIComponent(ref)}&skip=${skip}&limit=${HISTORY_PAGE_SIZE}`;
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
      `<span class="when">${deps.escapeHtml(relativeWhen(commit.when))}</span>` +
      `</span>` +
      `</li>`
    );
  }

  function renderList() {
    list.innerHTML = commits.map(commitRow).join("");
    setStatusText(loading ? "loading..." : commits.length ? "" : "no commits");
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
    inFlight = doLoadNextPage().finally(() => {
      inFlight = null;
    });
    return inFlight;
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
      ref = nextRef;
      commits = [];
      hasMore = false;
      loading = false;
      selectedSha = "";
      setBanner("");
      renderList();
      await loadNextPage();
    }
    const route2 = deps.getRoute();
    if (route2.screen !== "history") return;
    if (route2.commit) {
      await resolveDeepLink(route2.commit);
    } else {
      selectedSha = "";
      updateActiveRow();
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

  list.addEventListener("click", (e) => {
    const row = (e.target as Element).closest<HTMLElement>(".history-item");
    if (!row?.dataset.sha) return;
    const commit = commits.find((c) => c.sha === row.dataset.sha);
    if (commit) selectCommit(commit);
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

  return { enterHistory, onRefPicked };
}
