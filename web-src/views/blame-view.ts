// Standalone file-blame view. Fetches /_file_blame, groups same-sha runs into
// row-span blocks, paints an Older → Newer time bar legend, and reuses the
// existing file shell DOM so tabs/sticky header stay consistent across views.

import {
  BLAME_TIME_BIN_COUNT,
  type BlameCommit,
  type BlameResponse,
  blameRelativeTime,
  blameShortSha,
  blameTimeBins,
  groupBlameLines,
} from "../core/blame";
import type {
  AppRoute,
  DiffRange,
  SourceFileTarget,
  SourceLineTarget,
} from "../core/routes";
import { normalizeSourceShikiLang } from "../core/source-meta";
import {
  createFileShellSticky,
  mountFileShellCard,
  type SourceBlobTab,
} from "./file-shell";

type SourceShikiHighlighter = {
  codeToHtml: (
    code: string,
    options: {
      lang: string;
      themes: { light: string; dark: string };
      defaultColor: false;
    },
  ) => string;
};

export type BlameViewDeps = {
  $: <T extends Element = HTMLElement>(sel: string) => T;
  STATE: { route: AppRoute };
  setRoute(route: AppRoute, replace?: boolean): void;
  applyRouteFromLocation?(): void;
  setPageMode(): void;
  currentRange(): DiffRange;
  trackLoad<T>(promise: Promise<T>): Promise<T>;
  getSyntaxHighlight(): boolean;
  loadSourceShikiHighlighter(): Promise<SourceShikiHighlighter | null>;
  sourceShikiLines(
    textValue: string,
    lang: string,
    highlighter: SourceShikiHighlighter,
  ): string[] | null;
  inferLang(path: string): string | null;
  currentSourceLineTarget(
    target: SourceFileTarget,
  ): SourceLineTarget | undefined;
  lineInSourceTarget(
    lineNumber: number,
    target: SourceLineTarget | undefined,
  ): boolean;
  bindSourceLineNumber(
    num: HTMLElement,
    card: HTMLElement,
    target: SourceFileTarget,
    line: number,
  ): void;
  setPreferredSourceTab(tab: SourceBlobTab): void;
  createFileBreadcrumb(path: string, ref?: string): HTMLElement;
  removeStandaloneSource(): void;
  placeSidebarToggle(): void;
  escapeHtml(s: unknown): string;
  // Repository サイドバーを再描画するためのフック。null/undefined を返すと
  // ラッパ無しの全幅レイアウトになる（Diff Viewer 経由で開いた時など）。
  repoFileTargetFromRoute(): string | null;
  renderRepoBlobSidebar(path: string, ref: string): Promise<unknown> | unknown;
};

export function createBlameView(deps: BlameViewDeps) {
  let activeGeneration = 0;

  function cleanup() {
    document.querySelectorAll(".gdp-standalone-blame").forEach((el) => {
      el.remove();
    });
  }

  function colourBarFor(
    commit: BlameCommit,
    bin: number,
    binCount: number,
  ): HTMLElement {
    const bar = document.createElement("span");
    bar.className = "gdp-blame-bar";
    bar.dataset.bin = String(commit.isUncommitted ? binCount - 1 : bin);
    if (commit.isUncommitted) bar.classList.add("uncommitted");
    return bar;
  }

  function buildLegend(): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "gdp-blame-legend";
    const older = document.createElement("span");
    older.className = "gdp-blame-legend-label";
    older.textContent = "Older";
    wrap.appendChild(older);
    const stops = document.createElement("span");
    stops.className = "gdp-blame-legend-stops";
    for (let i = 0; i < BLAME_TIME_BIN_COUNT; i++) {
      const stop = document.createElement("span");
      stop.className = "gdp-blame-legend-stop";
      stop.dataset.bin = String(i);
      stops.appendChild(stop);
    }
    wrap.appendChild(stops);
    const newer = document.createElement("span");
    newer.className = "gdp-blame-legend-label";
    newer.textContent = "Newer";
    wrap.appendChild(newer);
    return wrap;
  }

  async function fetchBlame(
    target: SourceFileTarget,
    requestGeneration: number,
  ): Promise<BlameResponse | null> {
    const params = new URLSearchParams();
    params.set("path", target.path);
    params.set("ref", target.ref);
    const url = `/_file_blame?${params.toString()}`;
    try {
      return await deps.trackLoad(
        fetch(url).then(async (r) => {
          if (!r.ok) throw new Error(await r.text());
          const data = (await r.json()) as BlameResponse;
          if (
            data.generation !== undefined &&
            requestGeneration !== activeGeneration
          )
            return null;
          return data;
        }),
      );
    } catch (err) {
      console.error("blame fetch failed", err);
      return null;
    }
  }

  async function fetchSource(
    target: SourceFileTarget,
    base: "worktree" | "HEAD",
  ): Promise<string> {
    // When the user is looking at base=HEAD, the blame line numbers refer to
    // the committed snapshot. Pull the same snapshot for the right-hand code
    // column so the row numbers line up.
    const sourceRef =
      base === "HEAD"
        ? target.ref === "worktree" || !target.ref
          ? "HEAD"
          : target.ref
        : target.ref || "worktree";
    const params = new URLSearchParams();
    params.set("path", target.path);
    params.set("ref", sourceRef);
    const url = `/_file?${params.toString()}`;
    try {
      const res = await deps.trackLoad(
        fetch(url).then(async (r) => {
          if (!r.ok) throw new Error(await r.text());
          return r.text();
        }),
      );
      return res;
    } catch {
      return "";
    }
  }

  function buildBlameTable(
    card: HTMLElement,
    target: SourceFileTarget,
    response: BlameResponse,
    sourceText: string,
    highlighter: SourceShikiHighlighter | null,
  ): HTMLElement {
    const groups = groupBlameLines(response.lines, response.commits);
    const bins = blameTimeBins(response.commits, BLAME_TIME_BIN_COUNT);
    const sourceLines = sourceText
      ? sourceText.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n")
      : [];
    // Trim a trailing empty entry produced by a final newline.
    if (sourceLines.length > 0 && sourceLines[sourceLines.length - 1] === "")
      sourceLines.pop();
    const sourceShikiLang = normalizeSourceShikiLang(
      deps.inferLang(target.path),
    );
    const shikiLines =
      highlighter && sourceShikiLang
        ? deps.sourceShikiLines(
            sourceLines.join("\n"),
            sourceShikiLang,
            highlighter,
          )
        : null;

    const lineTarget = deps.currentSourceLineTarget(target);
    const table = document.createElement("table");
    table.className = "gdp-source-table gdp-blame-table";
    const tbody = document.createElement("tbody");

    for (const group of groups) {
      for (let lineNo = group.startLine; lineNo <= group.endLine; lineNo++) {
        const tr = document.createElement("tr");
        tr.className = "gdp-blame-row";
        tr.dataset.line = String(lineNo);
        tr.dataset.sha = group.sha;
        tr.classList.toggle(
          "gdp-source-line-target",
          deps.lineInSourceTarget(lineNo, lineTarget),
        );
        if (lineNo === group.startLine) {
          const info = document.createElement("td");
          info.className = "gdp-blame-info";
          info.rowSpan = group.endLine - group.startLine + 1;
          info.appendChild(
            colourBarFor(
              group.commit,
              bins[group.sha] ?? 0,
              BLAME_TIME_BIN_COUNT,
            ),
          );
          const meta = document.createElement("div");
          meta.className = "gdp-blame-meta";
          const time = document.createElement("span");
          time.className = "gdp-blame-time";
          time.textContent = group.commit.isUncommitted
            ? "Uncommitted"
            : blameRelativeTime(group.commit.authorTime);
          meta.appendChild(time);
          const author = document.createElement("span");
          author.className = "gdp-blame-author";
          author.textContent = group.commit.author;
          meta.appendChild(author);
          const sha = document.createElement("span");
          sha.className = "gdp-blame-sha";
          sha.textContent = blameShortSha(group.sha);
          if (!group.commit.isUncommitted) {
            sha.dataset.sha = group.sha;
            sha.title = "open this commit in history";
            sha.style.cursor = "pointer";
            sha.addEventListener("click", () => {
              const ref =
                target.ref && target.ref !== "worktree" ? target.ref : "HEAD";
              deps.setRoute({
                screen: "history",
                ref,
                commit: group.sha,
                range: deps.currentRange(),
              });
              deps.applyRouteFromLocation?.();
            });
          }
          meta.appendChild(sha);
          info.appendChild(meta);
          const summary = document.createElement("div");
          summary.className = "gdp-blame-summary";
          summary.textContent = group.commit.summary;
          summary.title = group.commit.summary;
          info.appendChild(summary);
          tr.appendChild(info);
        }
        const num = document.createElement("td");
        num.className = "gdp-source-line-number";
        num.textContent = String(lineNo);
        deps.bindSourceLineNumber(num, card, target, lineNo);
        tr.appendChild(num);
        const code = document.createElement("td");
        code.className = "gdp-source-line-code";
        const codeContent = sourceLines[lineNo - 1] ?? "";
        const codeEl = document.createElement("code");
        if (shikiLines && shikiLines[lineNo - 1] != null) {
          code.classList.add("shiki");
          codeEl.innerHTML = shikiLines[lineNo - 1] || " ";
        } else {
          codeEl.textContent = codeContent || " ";
        }
        code.appendChild(codeEl);
        tr.appendChild(code);
        tbody.appendChild(tr);
      }
    }
    table.appendChild(tbody);
    return table;
  }

  async function renderBlamePage(target: SourceFileTarget) {
    const generation = ++activeGeneration;
    // GitHub と同じく target ref を起点に blame する。worktree なら worktree、
    // ブランチ/コミット指定ならその snapshot。base toggle は持たない。
    const base: "worktree" | "HEAD" =
      target.ref === "worktree" ? "worktree" : "HEAD";
    deps.setPageMode();
    deps.removeStandaloneSource();
    cleanup();
    const card = document.createElement("article");
    card.className =
      "gdp-file-shell loaded gdp-standalone-blame gdp-blame-mode";
    card.dataset.path = target.path;
    const wrapper = document.createElement("div");
    wrapper.className = "gdp-file-detail-wrapper";
    const { sticky } = createFileShellSticky(
      {
        currentRange: deps.currentRange,
        setRoute: deps.setRoute,
        setPreferredSourceTab: deps.setPreferredSourceTab,
        createFileBreadcrumb: deps.createFileBreadcrumb,
      },
      target,
      "blame",
    );
    sticky.appendChild(buildLegend());
    wrapper.appendChild(sticky);
    const body = document.createElement("div");
    body.className = "gdp-file-detail-body gdp-blame-body";
    body.appendChild(buildLoading());
    wrapper.appendChild(body);
    card.appendChild(wrapper);
    mountFileShellCard(deps, target, card);

    const [blameResp, srcText, highlighter] = await Promise.all([
      fetchBlame(target, generation),
      fetchSource(target, base),
      deps.getSyntaxHighlight()
        ? deps.loadSourceShikiHighlighter()
        : Promise.resolve(null),
    ]);
    if (generation !== activeGeneration) return;
    body.replaceChildren();
    if (!blameResp || (!blameResp.lines.length && blameResp.error)) {
      const err = document.createElement("div");
      err.className = "gdp-blame-error";
      err.textContent = blameResp?.error || "Failed to load blame";
      body.appendChild(err);
      return;
    }
    body.appendChild(
      buildBlameTable(card, target, blameResp, srcText, highlighter),
    );
  }

  function buildLoading(): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "gdp-blame-loading";
    wrap.textContent = "Loading blame…";
    return wrap;
  }

  function removeBlamePage() {
    activeGeneration++;
    cleanup();
  }

  return {
    renderBlamePage,
    removeBlamePage,
    cleanup,
  };
}

export type BlameViewApi = ReturnType<typeof createBlameView>;
