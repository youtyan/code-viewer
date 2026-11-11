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

/** 見本の見出し (場所と、あれば操作)。 */
export type CodePreviewHeaderProps = {
  location: string;
  title: string;
  action: { label: string; onSelect(): void } | null;
};

export type CodePreviewLineProps = {
  line: number;
  target: boolean;
  /** 色付け前は原文 (探した文字の範囲つき)、色付けの後はその HTML。 */
  code:
    | {
        kind: "plain";
        text: string;
        mark: { start: number; end: number } | null;
      }
    | { kind: "html"; html: string };
};

export type CodePreviewProps =
  | { kind: "empty" }
  | { kind: "placeholder"; message: string }
  | {
      kind: "frame";
      header: CodePreviewHeaderProps;
      message: string | null;
      /** ファイルが変わった: この見本だけを読み直すボタン。 */
      reload: { label: string; onClick(): void } | null;
    }
  | {
      kind: "code";
      header: CodePreviewHeaderProps;
      /** 見本ごとに変わる番号 (表を見本ごとに作り直す)。 */
      key: number;
      meta: string;
      empty: string | null;
      lines: CodePreviewLineProps[];
    };

export type CodePreviewView = (props: CodePreviewProps) => unknown;

function headerTemplate(header: CodePreviewHeaderProps): TemplateResult {
  return html`<div class="gdp-code-preview-header"><div
      class="gdp-code-preview-location"
      title=${header.title}
    >${header.location}</div>${
      header.action
        ? html`<button
            type="button"
            class="gdp-btn gdp-btn-sm"
            @mousedown=${(event: MouseEvent) => event.preventDefault()}
            @click=${header.action.onSelect}
          >${header.action.label}</button>`
        : nothing
    }</div>`;
}

function lineCodeTemplate(code: CodePreviewLineProps["code"]): TemplateResult {
  if (code.kind === "html")
    return html`<td class="gdp-source-line-code shiki">${unsafeHTML(code.html || " ")}</td>`;
  const { text, mark } = code;
  if (!mark) return html`<td class="gdp-source-line-code">${text || " "}</td>`;
  return html`<td class="gdp-source-line-code">${text.slice(0, mark.start)}<mark
      class="gdp-grep-match"
      >${text.slice(mark.start, mark.end)}</mark
    >${text.slice(mark.end)}</td>`;
}

export const DEFAULT_VIEW: CodePreviewView = (props) => {
  switch (props.kind) {
    case "empty":
      return nothing;
    case "placeholder":
      return html`<div class="gdp-code-preview-placeholder">${props.message}</div>`;
    case "frame":
      // 文とボタンを 1 つの行にまとめる (枠は grid の中央寄せなので、
      // 別々に置くと上下に離れて並ぶ)。
      return html`${headerTemplate(props.header)}<div class="gdp-code-preview-code">${
        props.message
          ? html`<div class="gdp-code-preview-message">${
              props.reload
                ? html`<div>${props.message}<button
                    type="button"
                    class="gdp-btn gdp-btn-sm gdp-code-preview-reload"
                    @mousedown=${(event: MouseEvent) =>
                      // 検索の小窓の入力欄から焦点を奪わない (見出しの操作と同じ)。
                      event.preventDefault()}
                    @click=${props.reload.onClick}
                  >${props.reload.label}</button></div>`
                : props.message
            }</div>`
          : nothing
      }</div>`;
    case "code":
      // 表は見本ごとに作り直す (色付けの後に印を付けた行を、次の見本で使い回さない)。
      return html`${headerTemplate(props.header)}<div class="gdp-code-preview-code">${keyed(
        props.key,
        html`<div class="gdp-code-preview-meta">${props.meta}</div>${
          props.empty
            ? html`<div class="gdp-code-preview-message">${props.empty}</div>`
            : html`<table class="gdp-source-table"><tbody>${props.lines.map(
                (line) => html`<tr
                  data-line=${String(line.line)}
                  class=${line.target ? "gdp-source-line-target" : ""}
                ><td class="gdp-source-line-number">${String(line.line)}</td>${lineCodeTemplate(
                  line.code,
                )}</tr>`,
              )}</tbody></table>`
        }`,
      )}</div>`;
  }
};

export function createCodePreview(
  host: HTMLElement,
  deps: CodePreviewDeps,
  view: CodePreviewView = DEFAULT_VIEW,
): CodePreview {
  let controller: AbortController | null = null;
  let generation = 0;
  let previewKey = "";
  let disposed = false;
  let state: PreviewState = { kind: "empty" };
  host.classList.add("gdp-code-preview");

  const isCurrent = (myGeneration: number, signal: AbortSignal): boolean =>
    !disposed && !signal.aborted && myGeneration === generation;

  function headerProps(request: CodePreviewRequest): CodePreviewHeaderProps {
    const { target, action } = request;
    return {
      location: target.line ? `${target.path}:${target.line}` : target.path,
      title: target.line
        ? `${target.path}:${target.line}:${target.column ?? 1}`
        : target.path,
      action: action
        ? { label: action.label, onSelect: action.onSelect }
        : null,
    };
  }

  /** 目当ての行の、探した文字の範囲 (色付け前の原文で印を付ける)。 */
  function markRange(
    request: CodePreviewRequest,
    line: number,
    lineText: string,
  ): { start: number; end: number } | null {
    const { match, target } = request;
    return match && line === target.line
      ? findTextRange(lineText, match.text, {
          caseSensitive: match.caseSensitive,
          nearColumn: target.column,
        })
      : null;
  }

  function previewProps(): CodePreviewProps {
    switch (state.kind) {
      case "empty":
        return { kind: "empty" };
      case "placeholder":
        return { kind: "placeholder", message: state.message };
      case "frame": {
        const { request } = state;
        const text = codePreviewText(deps.getLanguage());
        return {
          kind: "frame",
          header: headerProps(request),
          message: state.message ?? null,
          reload: state.reload
            ? {
                label: text.reload,
                onClick: () => {
                  previewKey = "";
                  show(request);
                },
              }
            : null,
        };
      }
      case "code": {
        const { request, response, highlighted } = state;
        const text = codePreviewText(deps.getLanguage());
        return {
          kind: "code",
          header: headerProps(request),
          key: generation,
          meta: text.lines(
            response.start,
            Math.min(
              response.end,
              response.start + Math.max(0, response.lines.length - 1),
            ),
            response.complete ? response.total : undefined,
          ),
          empty: response.lines.length === 0 ? text.noText : null,
          lines: response.lines.map((lineText, index) => {
            const line = response.start + index;
            const code = highlighted?.[index];
            return {
              line,
              target:
                request.target.line !== undefined &&
                line === request.target.line,
              code:
                code == null
                  ? {
                      kind: "plain" as const,
                      text: lineText,
                      mark: markRange(request, line, lineText),
                    }
                  : { kind: "html" as const, html: code },
            };
          }),
        };
      }
    }
  }

  function draw(): void {
    renderOwned(host, view(previewProps()));
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
