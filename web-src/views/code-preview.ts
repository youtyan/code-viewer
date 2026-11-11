import { keyed } from "lit/directives/keyed.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { html, nothing, type TemplateResult } from "lit/html.js";
import { apiUrl } from "../core/api-url";
import { showHighlightFailure } from "../core/copy-failure";
import {
  errorWithCause,
  formatErrorDetail,
  responseErrorMessage,
} from "../core/error-detail";
import type { ShikiHighlighter } from "../core/shiki-loader";
import { normalizeSourceShikiLang } from "../core/source-meta";
import type { FileRangeResponse } from "../core/types";
import { type CodePreviewLanguage, codePreviewText } from "./code-preview-i18n";
import { findTextRange, markNeedleInCell } from "./text-mark";
import { renderOwned } from "./ui/renderer";

export type CodePreviewRequest = {
  target: {
    path: string;
    ref: string;
    line?: number;
    column?: number;
  };
  match?: { text: string; caseSensitive: boolean };
  action?: { label: string; onSelect(): void };
};

export type CodePreviewDeps = {
  trackLoad<T>(promise: Promise<T>): Promise<T>;
  isAbortError(error: unknown): boolean;
  getLanguage(): CodePreviewLanguage;
  getSyntaxHighlight(): boolean;
  inferLang(path: string): string | null;
  loadSourceShikiHighlighter(lang: string): Promise<ShikiHighlighter | null>;
  sourceShikiLines(
    textValue: string,
    lang: string,
    highlighter: ShikiHighlighter,
  ): string[] | null;
  isStaleGeneration?(generation: number | undefined): boolean;
};

export type CodePreview = {
  show(request: CodePreviewRequest): void;
  clear(message: string): void;
  dispose(): void;
};

const CONTEXT_RADIUS = 5;
const FILE_LINE_LIMIT = 200;

function requestKey(request: CodePreviewRequest): string {
  const { target, match, action } = request;
  return [
    target.ref,
    target.path,
    target.line ?? "",
    target.column ?? "",
    match?.text ?? "",
    match?.caseSensitive ?? "",
    action?.label ?? "",
  ].join("\0");
}

/** 見本の箱に出しているもの。 */
type PreviewState =
  | { kind: "empty" }
  | { kind: "placeholder"; message: string }
  | {
      kind: "frame";
      request: CodePreviewRequest;
      message?: string;
      /** ファイルが変わった: この見本だけを読み直すボタンを添える。 */
      reload?: boolean;
    }
  | {
      kind: "code";
      request: CodePreviewRequest;
      response: FileRangeResponse;
      /** 色付けした行 (届くまでは null)。 */
      highlighted: string[] | null;
    };

export function createCodePreview(
  host: HTMLElement,
  deps: CodePreviewDeps,
): CodePreview {
  let controller: AbortController | null = null;
  let generation = 0;
  let previewKey = "";
  let disposed = false;
  let state: PreviewState = { kind: "empty" };
  host.classList.add("gdp-code-preview");

  const isCurrent = (myGeneration: number, signal: AbortSignal): boolean =>
    !disposed && !signal.aborted && myGeneration === generation;

  function headerTemplate(request: CodePreviewRequest): TemplateResult {
    const { target, action } = request;
    return html`<div class="gdp-code-preview-header"><div
        class="gdp-code-preview-location"
        title=${
          target.line
            ? `${target.path}:${target.line}:${target.column ?? 1}`
            : target.path
        }
      >${target.line ? `${target.path}:${target.line}` : target.path}</div>${
        action
          ? html`<button
              type="button"
              class="gdp-btn gdp-btn-sm"
              @mousedown=${(event: MouseEvent) => event.preventDefault()}
              @click=${action.onSelect}
            >${action.label}</button>`
          : nothing
      }</div>`;
  }

  /** 目当ての行の、探した文字に印を付けた中身 (色付け前の原文)。 */
  function plainLineTemplate(
    request: CodePreviewRequest,
    line: number,
    lineText: string,
  ): unknown {
    const { match, target } = request;
    const range =
      match && line === target.line
        ? findTextRange(lineText, match.text, {
            caseSensitive: match.caseSensitive,
            nearColumn: target.column,
          })
        : null;
    if (!range) return lineText || " ";
    return html`${lineText.slice(0, range.start)}<mark class="gdp-grep-match"
        >${lineText.slice(range.start, range.end)}</mark
      >${lineText.slice(range.end)}`;
  }

  function codeTemplate(
    current: Extract<PreviewState, { kind: "code" }>,
  ): TemplateResult {
    const { request, response, highlighted } = current;
    const text = codePreviewText(deps.getLanguage());
    const meta = html`<div class="gdp-code-preview-meta">${text.lines(
      response.start,
      Math.min(
        response.end,
        response.start + Math.max(0, response.lines.length - 1),
      ),
      response.complete ? response.total : undefined,
    )}</div>`;
    if (response.lines.length === 0)
      return html`${meta}<div class="gdp-code-preview-message">${text.noText}</div>`;
    return html`${meta}<table class="gdp-source-table"><tbody>${response.lines.map(
      (lineText, index) => {
        const line = response.start + index;
        const target =
          request.target.line !== undefined && line === request.target.line;
        const code = highlighted?.[index];
        return html`<tr
          data-line=${String(line)}
          class=${target ? "gdp-source-line-target" : ""}
        ><td class="gdp-source-line-number">${String(line)}</td>${
          code == null
            ? html`<td class="gdp-source-line-code">${plainLineTemplate(
                request,
                line,
                lineText,
              )}</td>`
            : html`<td class="gdp-source-line-code shiki">${unsafeHTML(code || " ")}</td>`
        }</tr>`;
      },
    )}</tbody></table>`;
  }

  function previewTemplate(): unknown {
    switch (state.kind) {
      case "empty":
        return nothing;
      case "placeholder":
        return html`<div class="gdp-code-preview-placeholder">${state.message}</div>`;
      case "frame": {
        const { request, message, reload } = state;
        const text = codePreviewText(deps.getLanguage());
        // 文とボタンを 1 つの行にまとめる (枠は grid の中央寄せなので、
        // 別々に置くと上下に離れて並ぶ)。
        return html`${headerTemplate(request)}<div class="gdp-code-preview-code">${
          message
            ? html`<div class="gdp-code-preview-message">${
                reload
                  ? html`<div>${message}<button
                      type="button"
                      class="gdp-btn gdp-btn-sm gdp-code-preview-reload"
                      @mousedown=${(event: MouseEvent) =>
                        // 検索の小窓の入力欄から焦点を奪わない (見出しの操作と同じ)。
                        event.preventDefault()}
                      @click=${() => {
                        previewKey = "";
                        show(request);
                      }}
                    >${text.reload}</button></div>`
                  : message
              }</div>`
            : nothing
        }</div>`;
      }
      case "code":
        // 表は見本ごとに作り直す (色付けの後に印を付けた行を、次の見本で使い回さない)。
        return html`${headerTemplate(state.request)}<div class="gdp-code-preview-code">${keyed(
          generation,
          codeTemplate(state),
        )}</div>`;
    }
  }

  function draw(): void {
    renderOwned(host, previewTemplate());
  }

  const clear = (message: string): void => {
    controller?.abort();
    controller = null;
    generation += 1;
    previewKey = "";
    state = { kind: "placeholder", message };
    draw();
  };

  /** 色付けした目当ての行に、探した文字の印を付ける (色付けの印をまたいでも付く)。 */
  function markHighlightedTarget(
    request: CodePreviewRequest,
    response: FileRangeResponse,
  ): void {
    const { match, target } = request;
    if (!match || target.line === undefined) return;
    const cell = host.querySelector<HTMLElement>(
      `tr[data-line="${target.line}"] .gdp-source-line-code`,
    );
    if (!cell) return;
    markNeedleInCell(
      cell,
      response.lines[target.line - response.start] || "",
      match.text,
      "gdp-grep-match",
      { caseSensitive: match.caseSensitive, nearColumn: target.column },
    );
  }

  const show = (request: CodePreviewRequest): void => {
    if (disposed) return;
    const key = requestKey(request);
    if (key === previewKey) return;
    previewKey = key;
    controller?.abort();
    const abort = new AbortController();
    controller = abort;
    const myGeneration = ++generation;
    const { target } = request;
    const start = target.line ? Math.max(1, target.line - CONTEXT_RADIUS) : 1;
    const end = target.line ? target.line + CONTEXT_RADIUS : FILE_LINE_LIMIT;
    state = {
      kind: "frame",
      request,
      message: codePreviewText(deps.getLanguage()).loadingCode,
    };
    draw();
    const params = new URLSearchParams({
      path: target.path,
      ref: target.ref,
      start: String(start),
      end: String(end),
    });

    void deps
      .trackLoad<FileRangeResponse>(
        fetch(`${apiUrl("fileRange")}?${params.toString()}`, {
          signal: abort.signal,
        }).then(async (response) => {
          if (!response.ok) {
            throw new Error(
              await responseErrorMessage(
                response,
                "code preview request failed",
              ),
            );
          }
          try {
            return (await response.json()) as FileRangeResponse;
          } catch (error) {
            throw errorWithCause(
              `code preview response could not be parsed (HTTP ${response.status})`,
              error,
            );
          }
        }),
      )
      .then(async (response) => {
        if (!isCurrent(myGeneration, abort.signal)) return;
        const text = codePreviewText(deps.getLanguage());
        if (deps.isStaleGeneration?.(response.generation)) {
          state = {
            kind: "frame",
            request,
            message: text.fileChanged,
            reload: true,
          };
          draw();
          return;
        }
        const current: Extract<PreviewState, { kind: "code" }> = {
          kind: "code",
          request,
          response,
          highlighted: null,
        };
        state = current;
        draw();
        if (response.lines.length === 0) return;

        const lang = normalizeSourceShikiLang(deps.inferLang(target.path));
        if (!deps.getSyntaxHighlight() || !lang) return;
        const highlighter = await deps.loadSourceShikiHighlighter(lang);
        if (
          !highlighter ||
          state !== current ||
          !isCurrent(myGeneration, abort.signal)
        )
          return;
        // 強調に失敗したら原文のまま、表に失敗の印と理由を付ける (下見の
        // 読み込みの失敗とは分ける: コードは読めている)。
        let highlightedLines: string[] | null;
        try {
          highlightedLines = deps.sourceShikiLines(
            response.lines.join("\n"),
            lang,
            highlighter,
          );
        } catch (error) {
          const table = host.querySelector<HTMLElement>(".gdp-source-table");
          if (!table)
            throw errorWithCause(
              `syntax highlighting failed for ${target.path} before the table was drawn`,
              error,
            );
          showHighlightFailure(
            table,
            `syntax highlighting failed for ${target.path}`,
            error,
          );
          return;
        }
        if (
          !highlightedLines ||
          state !== current ||
          !isCurrent(myGeneration, abort.signal)
        )
          return;
        current.highlighted = highlightedLines;
        draw();
        markHighlightedTarget(request, response);
      })
      .catch((error) => {
        if (deps.isAbortError(error) || !isCurrent(myGeneration, abort.signal))
          return;
        console.error("Failed to load code preview", error);
        const text = codePreviewText(deps.getLanguage());
        state = {
          kind: "frame",
          request,
          message: text.codeLoadFailed(formatErrorDetail(error)),
        };
        draw();
      });
  };

  return {
    show,
    clear,
    dispose() {
      disposed = true;
      controller?.abort();
      controller = null;
      generation += 1;
      previewKey = "";
      state = { kind: "empty" };
      draw();
    },
  };
}
