// Ref picker popover (branch / tag / commit selector), extracted from app.ts.
// createRefPicker() wires the popover, the #ref-from/#ref-to inputs, and the
// #repo-target input at construction time.

import { isImeComposing } from "../core/keyboard";
import type { AppRoute, DiffRange } from "../core/routes";
import type { RefCommitResponse, RefResponse } from "../core/types";

export type RefPickerDeps = {
  $: <T extends Element = HTMLElement>(sel: string) => T;
  escapeHtml(s: unknown): string;
  currentRange(): DiffRange;
  setRange(from: string, to: string): void;
  setRoute(route: AppRoute, replace?: boolean): void;
  renderStandaloneSource(target: {
    path: string;
    ref: string;
  }): Promise<unknown>;
  getFrom(): string;
  getTo(): string;
  getRepoRef(): string;
  getRoute(): AppRoute;
};

export function createRefPicker(deps: RefPickerDeps) {
  function wireRefSelectorInput(
    input: HTMLInputElement,
    onPick?: (ref: string) => void,
  ) {
    const wrap = input.closest<HTMLElement>("[data-ref-selector]");
    wrap?.addEventListener("click", (e) => {
      e.stopPropagation();
      openPopover(input);
    });
    input.addEventListener("keydown", (e) => {
      if (isImeComposing(e)) return;
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openPopover(input);
      } else if (e.key === "Escape") {
        closePopover();
        input.blur();
      }
    });
    if (onPick)
      input.addEventListener("change", () => onPick(input.value || "worktree"));
  }

  // ---- Ref picker popover ----
  const REFS: Required<RefResponse> = {
    branches: [],
    tags: [],
    commits: [],
    current: "",
  };
  const popover = deps.$<HTMLElement>("#ref-popover");
  const popBody = popover.querySelector<HTMLElement>(".rp-body");
  const popSearch = popover.querySelector<HTMLInputElement>(".rp-search");
  if (!popBody || !popSearch) return;
  let popTarget: HTMLInputElement | null = null; // which input opened the popover

  function fetchRefs() {
    return fetch("/_refs")
      .then((r) => r.json())
      .then((refs: RefResponse) => {
        Object.assign(REFS, refs);
      })
      .catch(() => {});
  }
  fetchRefs();

  let popTab = "commits";
  const COMMIT_PAGE_SIZE = 50;
  let commitSearchTimer: ReturnType<typeof setTimeout> | null = null;
  let commitSearchSeq = 0;
  let commitSearchAbort: AbortController | null = null;
  let commitSearchLoading = false;
  let commitAppendLoading = false;
  let commitHasMore = false;
  let commitQuery = "";

  function appendUniqueCommits(commits: RefCommitResponse["commits"]) {
    const seen = new Set(REFS.commits.map((commit) => commit.sha));
    for (const commit of commits || []) {
      if (!commit.sha || seen.has(commit.sha)) continue;
      seen.add(commit.sha);
      REFS.commits.push(commit);
    }
  }

  function fetchCommitRefs(query: string, options: { append?: boolean } = {}) {
    const append = !!options.append;
    const normalizedQuery = (query || "").trim();
    const seq = ++commitSearchSeq;
    if (commitSearchAbort) commitSearchAbort.abort();
    commitSearchAbort = new AbortController();
    const skip = append ? REFS.commits.length : 0;
    const previousScrollTop = popBody.scrollTop;
    if (append) commitAppendLoading = true;
    else {
      commitQuery = normalizedQuery;
      commitSearchLoading = true;
      commitAppendLoading = false;
      commitHasMore = false;
    }
    const url =
      `/_commits?max=${COMMIT_PAGE_SIZE}&skip=${skip}` +
      `&q=${encodeURIComponent(normalizedQuery)}`;
    return fetch(url, { signal: commitSearchAbort.signal })
      .then((r) => r.json())
      .then((refs: RefCommitResponse) => {
        if (seq !== commitSearchSeq) return;
        commitSearchLoading = false;
        commitAppendLoading = false;
        commitHasMore = !!refs.hasMore;
        if (append) appendUniqueCommits(refs.commits);
        else REFS.commits = refs.commits || [];
        if (!popover.hidden && popTab === "commits") {
          buildPopBody(popSearch.value);
          if (append) popBody.scrollTop = previousScrollTop;
        }
      })
      .catch(() => {
        if (seq === commitSearchSeq) {
          commitSearchLoading = false;
          commitAppendLoading = false;
        }
      });
  }

  function scheduleCommitSearch(query: string) {
    if (commitSearchTimer) clearTimeout(commitSearchTimer);
    commitQuery = (query || "").trim();
    commitSearchLoading = true;
    commitAppendLoading = false;
    commitHasMore = false;
    REFS.commits = [];
    commitSearchTimer = setTimeout(() => {
      commitSearchTimer = null;
      fetchCommitRefs(query);
    }, 150);
  }

  function maybeLoadMoreCommits() {
    if (popTab !== "commits") return;
    if (!commitHasMore || commitSearchLoading || commitAppendLoading) return;
    const remaining =
      popBody.scrollHeight - popBody.scrollTop - popBody.clientHeight;
    if (remaining > 96) return;
    fetchCommitRefs(commitQuery, { append: true });
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

  function buildPopBody(query: string) {
    const q = (query || "").toLowerCase().trim();
    const m = (s: string) => !q || String(s).toLowerCase().includes(q);
    const html: string[] = [];
    if (popTab === "commits") {
      if (commitSearchLoading) {
        html.push('<div class="rp-empty">loading commits...</div>');
        popBody.innerHTML = html.join("");
        highlightCurrentInPopover();
        return;
      }
      const commits = (REFS.commits || []).filter((commit) =>
        m(`${commit.sha} ${commit.subject} ${commit.author}`),
      );
      if (!commits.length) {
        html.push('<div class="rp-empty">no commits</div>');
      }
      for (const commit of commits) {
        if (!commit.sha) continue;
        const shortSha = commit.sha.slice(0, 7);
        html.push(
          '<div class="rp-item-commit" data-val="' +
            escapeAttr(commit.sha) +
            '">' +
            '<div class="row1">' +
            '<span class="sha">' +
            deps.escapeHtml(shortSha) +
            "</span>" +
            '<span class="subject" title="' +
            escapeAttr(commit.subject || "") +
            '">' +
            deps.escapeHtml(commit.subject || "") +
            "</span>" +
            "</div>" +
            '<div class="row2">' +
            '<span class="author">' +
            deps.escapeHtml(commit.author || "") +
            "</span>" +
            '<span class="when">' +
            deps.escapeHtml(commit.when ? displayWhen(commit.when) : "") +
            "</span>" +
            "</div>" +
            "</div>",
        );
      }
      if (commitAppendLoading) {
        html.push('<div class="rp-empty">loading more commits...</div>');
      } else if (commitHasMore) {
        html.push('<div class="rp-empty">scroll for more commits...</div>');
      }
    } else if (popTab === "branches") {
      const branches = (REFS.branches || []).filter((b) => m(b.name));
      if (!branches.length) {
        html.push('<div class="rp-empty">no branches</div>');
      }
      for (const branch of branches) {
        const cur = branch.name === REFS.current;
        html.push(
          '<div class="rp-item-ref" data-val="' +
            escapeAttr(branch.name) +
            '">' +
            '<div class="row1">' +
            '<span class="name">' +
            deps.escapeHtml(branch.name) +
            "</span>" +
            (cur
              ? '<span class="badge cur">current</span>'
              : '<span class="badge">branch</span>') +
            "</div>" +
            (branch.when
              ? '<div class="row2"><span class="when">' +
                deps.escapeHtml(branch.when) +
                "</span></div>"
              : "") +
            "</div>",
        );
      }
    } else if (popTab === "tags") {
      const tags = (REFS.tags || []).filter((t) => m(t.name));
      if (!tags.length) {
        html.push('<div class="rp-empty">no tags</div>');
      }
      for (const tag of tags) {
        html.push(
          '<div class="rp-item-ref" data-val="' +
            escapeAttr(tag.name) +
            '">' +
            '<div class="row1">' +
            '<span class="name">' +
            deps.escapeHtml(tag.name) +
            "</span>" +
            '<span class="badge">tag</span>' +
            "</div>" +
            (tag.when
              ? '<div class="row2"><span class="when">' +
                deps.escapeHtml(tag.when) +
                "</span></div>"
              : "") +
            "</div>",
        );
      }
    }
    popBody.innerHTML = html.join("");
    highlightCurrentInPopover();
  }

  // Mark the item matching the focused input's current value, so the user
  // sees what's currently selected when re-opening the picker.
  function highlightCurrentInPopover() {
    if (!popTarget) return;
    const cur = (popTarget.value || "").trim();
    if (!cur) return;
    const items = popBody.querySelectorAll<HTMLElement>("[data-val]");
    let match: HTMLElement | null = null;
    items.forEach((it) => {
      if (it.dataset.val === cur) match = it;
    });
    if (match) {
      match.classList.add("current");
      // Bring into view inside the popover only (not the page scroll)
      const ph = popBody;
      const r = match.getBoundingClientRect();
      const pr = ph.getBoundingClientRect();
      if (r.top < pr.top || r.bottom > pr.bottom) {
        ph.scrollTop = match.offsetTop - ph.clientHeight / 2;
      }
    }
  }
  function escapeAttr(s: unknown): string {
    return deps.escapeHtml(s).replace(/"/g, "&quot;");
  }

  function openPopover(input: HTMLInputElement) {
    popTarget = input;
    popSearch.value = "";
    if (popTab === "commits") scheduleCommitSearch("");
    buildPopBody("");
    // Reflect the input's current value on the quick chips
    const cur = (input.value || "").trim();
    popover.querySelectorAll<HTMLElement>(".rp-chip").forEach((c) => {
      c.classList.toggle("current", c.dataset.val === cur);
    });
    popover.hidden = false;
    const r = input.getBoundingClientRect();
    const popWidth = Math.min(560, Math.floor(window.innerWidth * 0.9));
    popover.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - popWidth - 8))}px`;
    popover.style.top = `${r.bottom + 4}px`;
    setTimeout(() => popSearch.focus(), 0);
  }
  function closePopover() {
    popover.hidden = true;
    popTarget = null;
  }

  const refFromInput = deps.$<HTMLInputElement>("#ref-from");
  const refToInput = deps.$<HTMLInputElement>("#ref-to");
  wireRefSelectorInput(refFromInput, () => {
    const otherEmpty = !refToInput.value;
    deps.setRange(refFromInput.value, refToInput.value);
    if (otherEmpty) setTimeout(() => openPopover(refToInput), 0);
  });
  wireRefSelectorInput(refToInput, () =>
    deps.setRange(refFromInput.value, refToInput.value),
  );
  wireRefSelectorInput(deps.$<HTMLInputElement>("#repo-target"), (ref) => {
    const route = deps.getRoute();
    if (route.screen !== "file") return;
    const nextRoute: AppRoute = {
      ...route,
      ref,
      range: deps.currentRange(),
    };
    if (nextRoute.view === "history") delete nextRoute.commit;
    deps.setRoute(nextRoute);
  });

  popSearch.addEventListener("input", () => {
    if (popTab === "commits") scheduleCommitSearch(popSearch.value);
    buildPopBody(popSearch.value);
  });
  popBody.addEventListener("scroll", maybeLoadMoreCommits, { passive: true });
  popSearch.addEventListener("keydown", (e) => {
    if (isImeComposing(e)) return;
    if (e.key === "Escape") {
      closePopover();
    }
    if (e.key === "Enter") {
      // pick first visible item
      const first = popBody.querySelector<HTMLElement>(
        ".rp-item-commit, .rp-item-ref",
      );
      if (first) first.click();
    }
  });
  function handlePicked(val?: string) {
    if (!popTarget || !val) return;
    const pickedTarget = popTarget;
    pickedTarget.value = val;
    closePopover();
    pickedTarget.dispatchEvent(new Event("change"));
  }
  popBody.addEventListener("click", (e) => {
    const item = (e.target as Element).closest<HTMLElement>(
      ".rp-item-commit, .rp-item-ref",
    );
    if (!item) return;
    handlePicked(item.dataset.val);
  });

  // Tabs
  popover.querySelectorAll<HTMLElement>(".rp-tab").forEach((t) => {
    t.addEventListener("click", () => {
      popTab = t.dataset.tab || "commits";
      popover.querySelectorAll(".rp-tab").forEach((b) => {
        b.classList.toggle("active", b === t);
      });
      if (popTab === "commits") scheduleCommitSearch(popSearch.value);
      buildPopBody(popSearch.value);
    });
  });

  // Quick-fill chips (worktree / HEAD / --staged)
  popover.querySelectorAll<HTMLElement>(".rp-chip").forEach((c) => {
    c.addEventListener("click", () => handlePicked(c.dataset.val));
  });
  document.addEventListener("mousedown", (e) => {
    if (popover.hidden) return;
    const target = e.target as Element;
    if (popover.contains(target)) return;
    if (
      target.id === "ref-from" ||
      target.id === "ref-to" ||
      target.id === "repo-ref" ||
      target.id === "repo-target" ||
      target.id === "history-ref"
    )
      return;
    closePopover();
  });

  return { openPopover, closePopover, wireRefSelectorInput };
}
