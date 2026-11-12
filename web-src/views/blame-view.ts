import { ref } from "lit/directives/ref.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { html, nothing, type TemplateResult } from "lit/html.js";
import { apiUrl } from "../core/api-url";
import { showHighlightFailure } from "../core/copy-failure";
import {
  errorWithCause,
  formatErrorDetail,
  responseErrorMessage,
} from "../core/error-detail";
import { pageLanguage } from "./page-language";
import { SOURCE_READING_TEXT } from "./source-preview-i18n";
// Standalone file-blame view. Fetches /_file_blame, groups same-sha runs into
// row-span blocks, paints an Older → Newer time bar legend, and reuses the
// existing file shell DOM so tabs/sticky header stay consistent across views.

import {
  BLAME_TIME_BIN_COUNT,
  type BlameGroup,
  type BlameResponse,
  blameShortSha,
  blameTimeBins,
  groupBlameLines,
  relativeTimeText,
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
  type FileViewTab,
  mountFileShellCard,
  type SourceBlobTab,
} from "./file-shell";
import type { VirtualSourceGutter } from "./source-view";
import { renderOwned, templateElement } from "./ui/renderer";

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
  /** Blame のカードを差し込む先 (本文なら #diff、右の面ならその面の箱の本体)。 */
  mountRoot(): HTMLElement;
  /** この実体が描いたものを探す範囲 (本文なら #content、右の面ならその面の箱)。 */
  scope(): ParentNode;
  setRoute(route: AppRoute, replace?: boolean): void;
  applyRouteFromLocation?(): void;
  setPageMode(): void;
  currentRange(): DiffRange;
  trackLoad<T>(promise: Promise<T>): Promise<T>;
  getSyntaxHighlight(): boolean;
  loadSourceShikiHighlighter(
    lang: string,
  ): Promise<SourceShikiHighlighter | null>;
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
  createRepositoryWebLink?(target: SourceFileTarget): HTMLAnchorElement | null;
  createRevisionNav?(
    target: SourceFileTarget,
    activeTab: FileViewTab,
  ): HTMLElement | null;
  removeStandaloneSource(): void;
  /** 仮想で描く大きさなら、左に Blame の欄を付けた仮想の行 (source-view.ts)。小さければ null。 */
  renderVirtualSourceWithGutter(
    target: SourceFileTarget,
    textValue: string,
    gutter: VirtualSourceGutter,
  ): Promise<HTMLElement | null>;
  placeSidebarToggle(): void;
  escapeHtml(s: unknown): string;
  // Repository サイドバーを再描画するためのフック。null/undefined を返すと
  // ラッパ無しの全幅レイアウトになる（Diff Viewer 経由で開いた時など）。
  repoFileTargetFromRoute(): string | null;
  renderRepoBlobSidebar(path: string, ref: string): Promise<unknown> | unknown;
};

/** まとまり (同じコミットの続く行) の印と説明。 */
export type BlameGroupProps = {
  bar: { bin: number; uncommitted: boolean };
  /** 1 段目: 時刻・作者・コミット (押すと履歴へ。未コミットなら押せない)。 */
  meta: {
    time: string;
    author: string;
    sha: string;
    open: { sha: string; title: string; onClick(): void } | null;
  };
  /** 2 段目: コミットの件名。 */
  summary: string;
};

export type BlameRowProps = {
  line: number;
  sha: string;
  target: boolean;
  /** まとまりの 1 行目だけ: 左の欄 (rowspan で続く行をまたぐ)。 */
  info: { group: BlameGroupProps; rowspan: number } | null;
  code: { kind: "plain"; text: string } | { kind: "html"; html: string };
};

export type BlameBodyProps =
  | { kind: "loading"; text: string }
  | { kind: "error"; text: string }
  | { kind: "virtual"; element: HTMLElement }
  | {
      kind: "table";
      rows: BlameRowProps[];
      /** 行番号の欄 (行を選ぶ操作を付ける)。 */
      onLineNumber(element: HTMLElement, line: number): void;
    };

/** 大きなファイルの左の欄の 1 行。group が無ければ空の欄。 */
export type BlameGutterProps = {
  group: BlameGroupProps;
  start: boolean;
  meta: boolean;
  summary: boolean;
} | null;

export type BlameView = {
  legend(props: { older: string; newer: string; bins: number }): unknown;
  body(props: BlameBodyProps): unknown;
  gutterCell(props: BlameGutterProps): unknown;
};

function colourBarTemplate(bar: BlameGroupProps["bar"]): TemplateResult {
  return html`<span
    class=${bar.uncommitted ? "gdp-blame-bar uncommitted" : "gdp-blame-bar"}
    data-bin=${String(bar.bin)}
  ></span>`;
}

function blameMetaTemplate(meta: BlameGroupProps["meta"]): TemplateResult {
  const open = meta.open;
  return html`<div class="gdp-blame-meta"><span class="gdp-blame-time">${meta.time}</span
    ><span class="gdp-blame-author">${meta.author}</span>${
      open
        ? html`<span
            class="gdp-blame-sha"
            data-sha=${open.sha}
            title=${open.title}
            style="cursor: pointer;"
            @click=${open.onClick}
          >${meta.sha}</span>`
        : html`<span class="gdp-blame-sha">${meta.sha}</span>`
    }</div>`;
}

function blameSummaryTemplate(summary: string): TemplateResult {
  return html`<div class="gdp-blame-summary" title=${summary}>${summary}</div>`;
}

export const DEFAULT_VIEW: BlameView = {
  legend: (props) => html`<div class="gdp-blame-legend"><span
      class="gdp-blame-legend-label"
      >${props.older}</span
    ><span class="gdp-blame-legend-stops">${Array.from(
      { length: props.bins },
      (_, i) =>
        html`<span class="gdp-blame-legend-stop" data-bin=${String(i)}></span>`,
    )}</span><span class="gdp-blame-legend-label">${props.newer}</span></div>`,
  body: (props) => {
    if (props.kind === "loading")
      return html`<div class="gdp-blame-loading">${props.text}</div>`;
    if (props.kind === "error")
      return html`<div class="gdp-blame-error">${props.text}</div>`;
    if (props.kind === "virtual") return props.element;
    return html`<table class="gdp-source-table gdp-blame-table"><tbody>${props.rows.map(
      (row) => html`<tr
        class=${row.target ? "gdp-blame-row gdp-source-line-target" : "gdp-blame-row"}
        data-line=${String(row.line)}
        data-sha=${row.sha}
      >${
        row.info
          ? html`<td class="gdp-blame-info" rowspan=${row.info.rowspan}
              >${colourBarTemplate(row.info.group.bar)}${blameMetaTemplate(
                row.info.group.meta,
              )}${blameSummaryTemplate(row.info.group.summary)}</td
            >`
          : nothing
      }<td
        class="gdp-source-line-number"
        ${ref((num) => {
          if (num instanceof HTMLElement) props.onLineNumber(num, row.line);
        })}
      >${String(row.line)}</td>${
        row.code.kind === "html"
          ? html`<td class="gdp-source-line-code shiki"><code
              >${unsafeHTML(row.code.html || " ")}</code
            ></td>`
          : html`<td class="gdp-source-line-code"><code>${row.code.text || " "}</code></td>`
      }</tr>`,
    )}</tbody></table>`;
  },
  gutterCell: (props) => {
    if (!props) return html`<span class="gdp-blame-cell"></span>`;
    return html`<span
      class=${props.start ? "gdp-blame-cell gdp-blame-cell-start" : "gdp-blame-cell"}
      >${colourBarTemplate(props.group.bar)}${
        props.meta ? blameMetaTemplate(props.group.meta) : nothing
      }${props.summary ? blameSummaryTemplate(props.group.summary) : nothing}</span
    >`;
  },
};

export function createBlameView(
  deps: BlameViewDeps,
  view: BlameView = DEFAULT_VIEW,
) {
  let activeGeneration = 0;

  function cleanup() {
    deps
      .scope()
      .querySelectorAll(".gdp-standalone-blame")
      .forEach((el) => {
        el.remove();
      });
  }

  async function fetchBlame(
    target: SourceFileTarget,
    requestGeneration: number,
  ): Promise<BlameResponse | null> {
    const params = new URLSearchParams();
    params.set("path", target.path);
    params.set("ref", target.ref);
    const url = `${apiUrl("fileBlame")}?${params.toString()}`;
    return await deps.trackLoad(
      fetch(url).then(async (r) => {
        if (!r.ok) throw new Error(await responseErrorMessage(r, "load blame"));
        const data = (await r.json()) as BlameResponse;
        if (
          data.generation !== undefined &&
          requestGeneration !== activeGeneration
        )
          return null;
        return data;
      }),
    );
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
    const url = `${apiUrl("file")}?${params.toString()}`;
    return await deps.trackLoad(
      fetch(url).then(async (r) => {
        if (!r.ok) {
          throw new Error(
            await responseErrorMessage(
              r,
              `load ${target.path} at ${sourceRef}`,
            ),
          );
        }
        return r.text();
      }),
    );
  }

  function groupProps(
    group: BlameGroup,
    bins: Record<string, number>,
    target: SourceFileTarget,
  ): BlameGroupProps {
    const text = SOURCE_READING_TEXT[pageLanguage()];
    const uncommitted = group.commit.isUncommitted;
    return {
      bar: {
        bin: uncommitted ? BLAME_TIME_BIN_COUNT - 1 : (bins[group.sha] ?? 0),
        uncommitted,
      },
      meta: {
        time: uncommitted
          ? text.blameUncommitted
          : relativeTimeText(group.commit.authorTime, pageLanguage()),
        author: group.commit.author,
        sha: blameShortSha(group.sha),
        open: uncommitted
          ? null
          : {
              sha: group.sha,
              title: text.blameOpenCommit,
              onClick: () => {
                const ref =
                  target.ref && target.ref !== "worktree" ? target.ref : "HEAD";
                deps.setRoute({
                  screen: "history",
                  ref,
                  commit: group.sha,
                  range: deps.currentRange(),
                });
                deps.applyRouteFromLocation?.();
              },
            },
      },
      summary: group.commit.summary,
    };
  }

  /**
   * 大きなファイルの Blame の左の欄。仮想の行は 1 行の高さで並ぶので、表の
   * 1 つの升 (rowSpan) に入れていた 2 段を、まとまりの 1 行目 (時刻・作者・
   * コミット) と 2 行目 (件名) に分ける。1 行だけのまとまりは 1 行目に件名も置く。
   */
  function virtualBlameGutter(
    target: SourceFileTarget,
    response: BlameResponse,
  ): VirtualSourceGutter {
    const groups = groupBlameLines(response.lines, response.commits);
    const bins = blameTimeBins(response.commits, BLAME_TIME_BIN_COUNT);
    const groupOfLine: BlameGroup[] = [];
    for (const group of groups)
      for (let line = group.startLine; line <= group.endLine; line++)
        groupOfLine[line] = group;
    return {
      rowClass: "gdp-blame-virtual-row",
      fullView: () => deps.applyRouteFromLocation?.(),
      cell(line) {
        const group = groupOfLine[line];
        const start = !!group && line === group.startLine;
        return templateElement(
          view.gutterCell(
            group
              ? {
                  group: groupProps(group, bins, target),
                  start,
                  meta: start,
                  summary: start
                    ? group.endLine === group.startLine
                    : line === group.startLine + 1,
                }
              : null,
          ),
        );
      },
    };
  }

  function blameTable(
    card: HTMLElement,
    target: SourceFileTarget,
    response: BlameResponse,
    sourceText: string,
    highlighter: SourceShikiHighlighter | null,
  ): { body: BlameBodyProps; highlightError: unknown } {
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
    // 強調に失敗したら原文のまま、表に失敗の印と理由を付ける (下)。
    let shikiLines: string[] | null = null;
    let highlightError: unknown = null;
    if (highlighter && sourceShikiLang) {
      try {
        shikiLines = deps.sourceShikiLines(
          sourceLines.join("\n"),
          sourceShikiLang,
          highlighter,
        );
      } catch (error) {
        highlightError = error;
      }
    }

    const lineTarget = deps.currentSourceLineTarget(target);
    const rows: BlameRowProps[] = [];
    for (const group of groups) {
      const info = groupProps(group, bins, target);
      for (let lineNo = group.startLine; lineNo <= group.endLine; lineNo++) {
        const highlighted = shikiLines?.[lineNo - 1];
        rows.push({
          line: lineNo,
          sha: group.sha,
          target: deps.lineInSourceTarget(lineNo, lineTarget),
          info:
            lineNo === group.startLine
              ? { group: info, rowspan: group.endLine - group.startLine + 1 }
              : null,
          code:
            highlighted != null
              ? { kind: "html", html: highlighted }
              : { kind: "plain", text: sourceLines[lineNo - 1] ?? "" },
        });
      }
    }
    return {
      body: {
        kind: "table",
        rows,
        onLineNumber: (num, line) =>
          deps.bindSourceLineNumber(num, card, target, line),
      },
      highlightError,
    };
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
    const { sticky } = createFileShellSticky(
      {
        currentRange: deps.currentRange,
        setRoute: deps.setRoute,
        setPreferredSourceTab: deps.setPreferredSourceTab,
        createFileBreadcrumb: deps.createFileBreadcrumb,
        createRepositoryWebLink: deps.createRepositoryWebLink,
        createRevisionNav: deps.createRevisionNav,
      },
      target,
      "blame",
    );
    const text = SOURCE_READING_TEXT[pageLanguage()];
    sticky.append(
      templateElement(
        view.legend({
          older: text.blameOlder,
          newer: text.blameNewer,
          bins: BLAME_TIME_BIN_COUNT,
        }),
      ),
    );
    const card = templateElement(
      html`<article
        class="gdp-file-shell loaded gdp-standalone-blame gdp-blame-mode"
        data-path=${target.path}
      ><div class="gdp-file-detail-wrapper">${sticky}<div
            class="gdp-file-detail-body gdp-blame-body"
          ></div></div></article>`,
    );
    const body = card.querySelector<HTMLElement>(".gdp-blame-body");
    if (!body) throw new Error("blame: the card body was not drawn");
    renderOwned(body, view.body({ kind: "loading", text: text.blameLoading }));
    mountFileShellCard(deps, target, card);

    const sourceShikiLang = normalizeSourceShikiLang(
      deps.inferLang(target.path),
    );
    let loaded: [BlameResponse | null, string, SourceShikiHighlighter | null];
    try {
      loaded = await Promise.all([
        fetchBlame(target, generation),
        fetchSource(target, base),
        deps.getSyntaxHighlight() && sourceShikiLang
          ? deps.loadSourceShikiHighlighter(sourceShikiLang)
          : Promise.resolve(null),
      ]);
    } catch (error) {
      if (generation !== activeGeneration) return;
      const failure = errorWithCause(
        `loading blame for ${target.path} failed`,
        error,
      );
      console.error(failure);
      renderOwned(
        body,
        view.body({ kind: "error", text: formatErrorDetail(failure) }),
      );
      return;
    }
    const [blameResp, srcText, highlighter] = loaded;
    if (generation !== activeGeneration || !blameResp) return;
    if (!blameResp.lines.length && blameResp.error) {
      renderOwned(body, view.body({ kind: "error", text: blameResp.error }));
      return;
    }
    const virtual = await deps.renderVirtualSourceWithGutter(
      target,
      srcText,
      virtualBlameGutter(target, blameResp),
    );
    if (generation !== activeGeneration) return;
    if (virtual) {
      renderOwned(body, view.body({ kind: "virtual", element: virtual }));
      return;
    }
    const table = blameTable(card, target, blameResp, srcText, highlighter);
    renderOwned(body, view.body(table.body));
    // 強調に失敗したら原文のまま、表に失敗の印と理由を付ける。
    const drawn = body.querySelector<HTMLElement>(".gdp-blame-table");
    if (table.highlightError !== null && drawn)
      showHighlightFailure(
        drawn,
        `syntax highlighting failed for ${target.path}`,
        table.highlightError,
      );
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
