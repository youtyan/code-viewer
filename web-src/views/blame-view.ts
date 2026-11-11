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
  type BlameCommit,
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

export function createBlameView(deps: BlameViewDeps) {
  let activeGeneration = 0;

  function cleanup() {
    deps
      .scope()
      .querySelectorAll(".gdp-standalone-blame")
      .forEach((el) => {
        el.remove();
      });
  }

  function colourBarTemplate(
    commit: BlameCommit,
    bin: number,
    binCount: number,
  ): TemplateResult {
    return html`<span
      class=${commit.isUncommitted ? "gdp-blame-bar uncommitted" : "gdp-blame-bar"}
      data-bin=${String(commit.isUncommitted ? binCount - 1 : bin)}
    ></span>`;
  }

  function legendTemplate(): TemplateResult {
    const text = SOURCE_READING_TEXT[pageLanguage()];
    return html`<div class="gdp-blame-legend"><span class="gdp-blame-legend-label"
        >${text.blameOlder}</span
      ><span class="gdp-blame-legend-stops">${Array.from(
        { length: BLAME_TIME_BIN_COUNT },
        (_, i) =>
          html`<span class="gdp-blame-legend-stop" data-bin=${String(i)}></span>`,
      )}</span><span class="gdp-blame-legend-label">${text.blameNewer}</span></div>`;
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

  /** まとまり (同じコミットの続く行) の 1 段目: 時刻・作者・コミット (押すと履歴へ)。 */
  function blameMetaTemplate(
    group: BlameGroup,
    target: SourceFileTarget,
  ): TemplateResult {
    const text = SOURCE_READING_TEXT[pageLanguage()];
    const uncommitted = group.commit.isUncommitted;
    return html`<div class="gdp-blame-meta"><span class="gdp-blame-time"
        >${
          uncommitted
            ? text.blameUncommitted
            : relativeTimeText(group.commit.authorTime, pageLanguage())
        }</span
      ><span class="gdp-blame-author">${group.commit.author}</span>${
        uncommitted
          ? html`<span class="gdp-blame-sha">${blameShortSha(group.sha)}</span>`
          : html`<span
              class="gdp-blame-sha"
              data-sha=${group.sha}
              title=${text.blameOpenCommit}
              style="cursor: pointer;"
              @click=${() => {
                const ref =
                  target.ref && target.ref !== "worktree" ? target.ref : "HEAD";
                deps.setRoute({
                  screen: "history",
                  ref,
                  commit: group.sha,
                  range: deps.currentRange(),
                });
                deps.applyRouteFromLocation?.();
              }}
            >${blameShortSha(group.sha)}</span>`
      }</div>`;
  }

  /** まとまりの 2 段目: コミットの件名。 */
  function blameSummaryTemplate(group: BlameGroup): TemplateResult {
    return html`<div class="gdp-blame-summary" title=${group.commit.summary}
      >${group.commit.summary}</div
    >`;
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
        if (!group)
          return templateElement(html`<span class="gdp-blame-cell"></span>`);
        const start = line === group.startLine;
        return templateElement(
          html`<span class=${start ? "gdp-blame-cell gdp-blame-cell-start" : "gdp-blame-cell"}
            >${colourBarTemplate(
              group.commit,
              bins[group.sha] ?? 0,
              BLAME_TIME_BIN_COUNT,
            )}${
              start
                ? html`${blameMetaTemplate(group, target)}${
                    group.endLine === group.startLine
                      ? blameSummaryTemplate(group)
                      : nothing
                  }`
                : line === group.startLine + 1
                  ? blameSummaryTemplate(group)
                  : nothing
            }</span
          >`,
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
  ): { template: TemplateResult; highlightError: unknown } {
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
    const rows: TemplateResult[] = [];
    for (const group of groups) {
      for (let lineNo = group.startLine; lineNo <= group.endLine; lineNo++) {
        const highlighted = shikiLines?.[lineNo - 1];
        const codeContent = sourceLines[lineNo - 1] ?? "";
        rows.push(html`<tr
          class=${
            deps.lineInSourceTarget(lineNo, lineTarget)
              ? "gdp-blame-row gdp-source-line-target"
              : "gdp-blame-row"
          }
          data-line=${String(lineNo)}
          data-sha=${group.sha}
        >${
          lineNo === group.startLine
            ? html`<td
                class="gdp-blame-info"
                rowspan=${group.endLine - group.startLine + 1}
              >${colourBarTemplate(
                group.commit,
                bins[group.sha] ?? 0,
                BLAME_TIME_BIN_COUNT,
              )}${blameMetaTemplate(group, target)}${blameSummaryTemplate(group)}</td>`
            : nothing
        }<td
          class="gdp-source-line-number"
          ${ref((num) => {
            if (num instanceof HTMLElement)
              deps.bindSourceLineNumber(num, card, target, lineNo);
          })}
        >${String(lineNo)}</td>${
          highlighted != null
            ? html`<td class="gdp-source-line-code shiki"><code
                >${unsafeHTML(highlighted || " ")}</code
              ></td>`
            : html`<td class="gdp-source-line-code"><code>${codeContent || " "}</code></td>`
        }</tr>`);
      }
    }
    return {
      template: html`<table class="gdp-source-table gdp-blame-table"><tbody>${rows}</tbody></table>`,
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
    sticky.append(templateElement(legendTemplate()));
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
    renderOwned(
      body,
      html`<div class="gdp-blame-loading">${
        SOURCE_READING_TEXT[pageLanguage()].blameLoading
      }</div>`,
    );
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
      renderOwned(body, blameErrorTemplate(formatErrorDetail(failure)));
      return;
    }
    const [blameResp, srcText, highlighter] = loaded;
    if (generation !== activeGeneration || !blameResp) return;
    if (!blameResp.lines.length && blameResp.error) {
      renderOwned(body, blameErrorTemplate(blameResp.error));
      return;
    }
    const virtual = await deps.renderVirtualSourceWithGutter(
      target,
      srcText,
      virtualBlameGutter(target, blameResp),
    );
    if (generation !== activeGeneration) return;
    if (virtual) {
      renderOwned(body, virtual);
      return;
    }
    const table = blameTable(card, target, blameResp, srcText, highlighter);
    renderOwned(body, table.template);
    // 強調に失敗したら原文のまま、表に失敗の印と理由を付ける。
    const drawn = body.querySelector<HTMLElement>(".gdp-blame-table");
    if (table.highlightError !== null && drawn)
      showHighlightFailure(
        drawn,
        `syntax highlighting failed for ${target.path}`,
        table.highlightError,
      );
  }

  function blameErrorTemplate(detail: string): TemplateResult {
    return html`<div class="gdp-blame-error">${detail}</div>`;
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
