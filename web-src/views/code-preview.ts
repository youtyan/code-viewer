import { errorWithCause, responseErrorMessage } from "../core/error-detail";
import type { ShikiHighlighter } from "../core/shiki-loader";
import { normalizeSourceShikiLang } from "../core/source-meta";
import type { FileRangeResponse } from "../core/types";
import {
  type CodePreviewLanguage,
  codePreviewText,
} from "./code-preview-i18n";
import { markNeedleInCell } from "./text-mark";

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

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function createCodePreview(
  host: HTMLElement,
  deps: CodePreviewDeps,
): CodePreview {
  let controller: AbortController | null = null;
  let generation = 0;
  let previewKey = "";
  let disposed = false;
  host.classList.add("gdp-code-preview");

  const isCurrent = (myGeneration: number, signal: AbortSignal): boolean =>
    !disposed && !signal.aborted && myGeneration === generation;

  const renderFrame = (
    request: CodePreviewRequest,
    message?: string,
  ): HTMLElement => {
    host.replaceChildren();
    const header = document.createElement("div");
    header.className = "gdp-code-preview-header";
    const location = document.createElement("div");
    location.className = "gdp-code-preview-location";
    const { target } = request;
    location.textContent = target.line
      ? `${target.path}:${target.line}`
      : target.path;
    location.title = target.line
      ? `${target.path}:${target.line}:${target.column ?? 1}`
      : target.path;
    header.appendChild(location);
    if (request.action) {
      const action = document.createElement("button");
      action.type = "button";
      action.className = "gdp-btn gdp-btn-sm";
      action.textContent = request.action.label;
      action.addEventListener("mousedown", (event) => event.preventDefault());
      action.addEventListener("click", request.action.onSelect);
      header.appendChild(action);
    }
    const body = document.createElement("div");
    body.className = "gdp-code-preview-code";
    if (message) {
      const status = document.createElement("div");
      status.className = "gdp-code-preview-message";
      status.textContent = message;
      body.appendChild(status);
    }
    host.append(header, body);
    return body;
  };

  const clear = (message: string): void => {
    controller?.abort();
    controller = null;
    generation += 1;
    previewKey = "";
    host.replaceChildren();
    const placeholder = document.createElement("div");
    placeholder.className = "gdp-code-preview-placeholder";
    placeholder.textContent = message;
    host.appendChild(placeholder);
  };

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
    const start = target.line
      ? Math.max(1, target.line - CONTEXT_RADIUS)
      : 1;
    const end = target.line ? target.line + CONTEXT_RADIUS : FILE_LINE_LIMIT;
    renderFrame(request, codePreviewText(deps.getLanguage()).loadingCode);
    const params = new URLSearchParams({
      path: target.path,
      ref: target.ref,
      start: String(start),
      end: String(end),
    });

    void deps
      .trackLoad<FileRangeResponse>(
        fetch(`/file_range?${params.toString()}`, {
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
          renderFrame(request, text.fileChanged);
          return;
        }
        const body = renderFrame(request);
        const meta = document.createElement("div");
        meta.className = "gdp-code-preview-meta";
        meta.textContent = text.lines(
          response.start,
          Math.min(
            response.end,
            response.start + Math.max(0, response.lines.length - 1),
          ),
          response.complete ? response.total : undefined,
        );
        body.appendChild(meta);
        if (response.lines.length === 0) {
          const empty = document.createElement("div");
          empty.className = "gdp-code-preview-message";
          empty.textContent = text.noText;
          body.appendChild(empty);
          return;
        }

        const table = document.createElement("table");
        table.className = "gdp-source-table";
        const tbody = document.createElement("tbody");
        response.lines.forEach((lineText, index) => {
          const line = response.start + index;
          const row = document.createElement("tr");
          row.dataset.line = String(line);
          row.classList.toggle(
            "gdp-source-line-target",
            target.line !== undefined && line === target.line,
          );
          const number = document.createElement("td");
          number.className = "gdp-source-line-number";
          number.textContent = String(line);
          const content = document.createElement("td");
          content.className = "gdp-source-line-code";
          content.textContent = lineText || " ";
          if (request.match && line === target.line) {
            markNeedleInCell(
              content,
              lineText,
              request.match.text,
              "gdp-grep-match",
              {
                caseSensitive: request.match.caseSensitive,
                nearColumn: target.column,
              },
            );
          }
          row.append(number, content);
          tbody.appendChild(row);
        });
        table.appendChild(tbody);
        body.appendChild(table);

        const lang = normalizeSourceShikiLang(deps.inferLang(target.path));
        if (!deps.getSyntaxHighlight() || !lang) return;
        const highlighter = await deps.loadSourceShikiHighlighter(lang);
        if (
          !highlighter ||
          !table.isConnected ||
          !isCurrent(myGeneration, abort.signal)
        )
          return;
        const highlightedLines = deps.sourceShikiLines(
          response.lines.join("\n"),
          lang,
          highlighter,
        );
        if (
          !highlightedLines ||
          !table.isConnected ||
          !isCurrent(myGeneration, abort.signal)
        )
          return;
        table
          .querySelectorAll<HTMLElement>(".gdp-source-line-code")
          .forEach((cell, index) => {
            if (highlightedLines[index] == null) return;
            cell.innerHTML = highlightedLines[index] || " ";
            cell.classList.add("shiki");
            if (request.match && response.start + index === target.line) {
              markNeedleInCell(
                cell,
                response.lines[index] || "",
                request.match.text,
                "gdp-grep-match",
                {
                  caseSensitive: request.match.caseSensitive,
                  nearColumn: target.column,
                },
              );
            }
          });
      })
      .catch((error) => {
        if (deps.isAbortError(error) || !isCurrent(myGeneration, abort.signal))
          return;
        console.error("Failed to load code preview", error);
        const text = codePreviewText(deps.getLanguage());
        renderFrame(
          request,
          text.codeLoadFailed(errorMessage(error, text.unknownError)),
        );
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
      host.replaceChildren();
    },
  };
}
