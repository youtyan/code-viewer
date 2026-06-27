// File-scoped history view (/file?view=history). Reuses /_log?path= for the
// commit list and /file_diff for per-commit diffs. Layout mirrors /history's
// 3-column shell minus the file tree.

import { COPY_16_PATHS, iconSvg } from "../core/icons";
import type { AppRoute, DiffRange, SourceFileTarget } from "../core/routes";

type HistoryCommit = {
  sha: string;
  subject: string;
  author: string;
  when: string;
  parents: string[];
  body: string;
};

type HistoryLogResponse = {
  commits: HistoryCommit[];
  hasMore: boolean;
  hasWorktree?: boolean;
};

export type FileHistoryViewDeps = {
  $: <T extends Element = HTMLElement>(sel: string) => T;
  STATE: { route: AppRoute };
  setRoute(route: AppRoute, replace?: boolean): void;
  setPageMode(): void;
  currentRange(): DiffRange;
  trackLoad<T>(promise: Promise<T>): Promise<T>;
  createFileBreadcrumb(path: string, ref?: string): HTMLElement;
  removeStandaloneSource(): void;
  placeSidebarToggle(): void;
  escapeHtml(s: unknown): string;
};

const PAGE_SIZE = 50;

export function createFileHistoryView(deps: FileHistoryViewDeps) {
  let activeGeneration = 0;

  function cleanup() {
    document.querySelectorAll(".gdp-standalone-file-history").forEach((el) => {
      el.remove();
    });
  }

  function buildSticky(target: SourceFileTarget): HTMLElement {
    const sticky = document.createElement("div");
    sticky.className = "gdp-file-detail-sticky";
    const header = document.createElement("div");
    header.className = "gdp-file-detail-header";
    const name = document.createElement("div");
    name.className = "gdp-file-detail-path";
    name.appendChild(deps.createFileBreadcrumb(target.path, target.ref));
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "gdp-file-header-icon gdp-copy-path";
    copy.title = "copy file path";
    copy.innerHTML = iconSvg("octicon-copy", COPY_16_PATHS);
    copy.addEventListener("click", async (e) => {
      e.stopPropagation();
      try {
        await navigator.clipboard.writeText(target.path);
        copy.classList.add("copied");
        setTimeout(() => copy.classList.remove("copied"), 1000);
      } catch {
        // ignore
      }
    });
    name.appendChild(copy);
    header.appendChild(name);
    sticky.appendChild(header);
    const tabs = document.createElement("div");
    tabs.className = "gdp-source-tabs";
    tabs.appendChild(makeTabButton("Code", "blob", target, false));
    tabs.appendChild(makeTabButton("Blame", "blame", target, false));
    tabs.appendChild(makeTabButton("History", "history", target, true));
    sticky.appendChild(tabs);
    return sticky;
  }

  function makeTabButton(
    label: string,
    view: "blob" | "blame" | "history",
    target: SourceFileTarget,
    active: boolean,
  ): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = active ? "active" : "";
    btn.dataset.sourceTab = view;
    btn.textContent = label;
    btn.addEventListener("click", () => {
      if (active) return;
      deps.setRoute({
        screen: "file",
        path: target.path,
        ref: target.ref,
        view,
        range: deps.currentRange(),
      });
    });
    return btn;
  }

  async function fetchLog(
    target: SourceFileTarget,
  ): Promise<HistoryLogResponse | null> {
    const params = new URLSearchParams();
    params.set("path", target.path);
    params.set("ref", target.ref === "worktree" ? "HEAD" : target.ref);
    params.set("skip", "0");
    params.set("limit", String(PAGE_SIZE));
    if (target.ref === "worktree") params.set("worktree", "1");
    const url = `/_log?${params.toString()}`;
    try {
      return await deps.trackLoad(
        fetch(url).then(async (r) => {
          if (!r.ok) throw new Error(await r.text());
          return (await r.json()) as HistoryLogResponse;
        }),
      );
    } catch (err) {
      console.error("file history fetch failed", err);
      return null;
    }
  }

  function relativeWhen(iso: string): string {
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return iso || "";
    const sec = Math.round((Date.now() - t) / 1000);
    if (sec < 60) return "just now";
    const min = Math.round(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hour = Math.round(min / 60);
    if (hour < 24) return `${hour}h ago`;
    const day = Math.round(hour / 24);
    if (day === 1) return "yesterday";
    if (day < 30) return `${day} days ago`;
    if (day < 365) return `${Math.round(day / 30)} months ago`;
    return iso.slice(0, 10);
  }

  function commitRow(
    commit: HistoryCommit,
    active: boolean,
    onClick: () => void,
  ): HTMLElement {
    const li = document.createElement("li");
    li.className = `history-item${active ? " active" : ""}`;
    li.dataset.sha = commit.sha;
    if (commit.sha === "worktree") li.classList.add("history-item-worktree");
    const subject = document.createElement("span");
    subject.className = "subject";
    subject.title = commit.subject;
    subject.textContent = commit.subject;
    li.appendChild(subject);
    const meta = document.createElement("span");
    meta.className = "meta2";
    const sha = document.createElement("span");
    sha.className = "sha";
    sha.textContent =
      commit.sha === "worktree" ? "HEAD..worktree" : commit.sha.slice(0, 7);
    meta.appendChild(sha);
    const author = document.createElement("span");
    author.className = "author";
    author.textContent = commit.author || "Working tree";
    meta.appendChild(author);
    if (commit.when) {
      const when = document.createElement("span");
      when.className = "when";
      when.textContent = relativeWhen(commit.when);
      meta.appendChild(when);
    }
    li.appendChild(meta);
    li.addEventListener("click", onClick);
    return li;
  }

  async function fetchDiff(
    target: SourceFileTarget,
    range: { from: string; to: string },
  ): Promise<string> {
    const params = new URLSearchParams();
    params.set("path", target.path);
    params.set("from", range.from);
    params.set("to", range.to);
    params.set("mode", "full");
    const url = `/file_diff?${params.toString()}`;
    try {
      const json = await deps.trackLoad(
        fetch(url).then(async (r) => {
          if (!r.ok) throw new Error(await r.text());
          return (await r.json()) as { diff?: string };
        }),
      );
      return json?.diff || "";
    } catch (err) {
      console.error("file history diff failed", err);
      return "";
    }
  }

  function commitRange(commit: HistoryCommit): { from: string; to: string } {
    if (commit.sha === "worktree") return { from: "HEAD", to: "worktree" };
    const parent = commit.parents[0] || `${commit.sha}^`;
    return { from: parent, to: commit.sha };
  }

  async function renderHistoryPage(target: SourceFileTarget) {
    const generation = ++activeGeneration;
    deps.setPageMode();
    deps.removeStandaloneSource();
    cleanup();
    const root = deps.$<HTMLElement>("#diff");
    const card = document.createElement("article");
    card.className =
      "gdp-file-shell loaded gdp-standalone-file-history gdp-file-history-mode";
    card.dataset.path = target.path;
    const wrapper = document.createElement("div");
    wrapper.className = "gdp-file-detail-wrapper";
    wrapper.appendChild(buildSticky(target));
    const body = document.createElement("div");
    body.className = "gdp-file-detail-body gdp-file-history-body";
    const left = document.createElement("aside");
    left.className = "gdp-file-history-commits";
    const list = document.createElement("ol");
    list.className = "gdp-file-history-list";
    left.appendChild(list);
    body.appendChild(left);
    const right = document.createElement("div");
    right.className = "gdp-file-history-diff";
    right.textContent = "Loading…";
    body.appendChild(right);
    wrapper.appendChild(body);
    card.appendChild(wrapper);
    root.prepend(card);
    deps.placeSidebarToggle();

    const log = await fetchLog(target);
    if (generation !== activeGeneration) return;
    if (!log || log.commits.length === 0) {
      list.innerHTML = "";
      const empty = document.createElement("div");
      empty.className = "gdp-file-history-empty";
      empty.textContent = log
        ? "このパスにコミット履歴はありません"
        : "Failed to load history";
      right.replaceChildren(empty);
      return;
    }

    let selectedSha = log.commits[0].sha;

    async function selectCommit(commit: HistoryCommit) {
      selectedSha = commit.sha;
      Array.from(list.children).forEach((child) => {
        const li = child as HTMLElement;
        li.classList.toggle("active", li.dataset.sha === selectedSha);
      });
      const range = commitRange(commit);
      right.textContent = "Loading…";
      const diff = await fetchDiff(target, range);
      if (generation !== activeGeneration) return;
      if (!diff) {
        right.textContent = "No diff (binary or empty change)";
        return;
      }
      const pre = document.createElement("pre");
      pre.className = "gdp-file-history-diff-text";
      pre.textContent = diff;
      right.replaceChildren(pre);
    }

    list.replaceChildren();
    for (const commit of log.commits) {
      list.appendChild(
        commitRow(
          commit,
          commit.sha === selectedSha,
          () => void selectCommit(commit),
        ),
      );
    }
    void selectCommit(log.commits[0]);
  }

  function removeHistoryPage() {
    activeGeneration++;
    cleanup();
  }

  return {
    renderHistoryPage,
    removeHistoryPage,
  };
}

export type FileHistoryViewApi = ReturnType<typeof createFileHistoryView>;
