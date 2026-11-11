// Floating "copy line reference" pill. Shown while a line selection exists
// (file view or diff after-side); clicking copies "@path#start-end" to the
// clipboard for pasting into Claude Code / Codex prompts. Shift+click copies
// the same reference followed by a fenced code block carrying the actual
// lines, so an AI can reason about the code without re-fetching.

import { html, nothing, svg, type TemplateResult } from "lit/html.js";
import { AI_CONTEXT_LARGE_SELECTION_LINE_THRESHOLD } from "../core/ai-context-copy";
import { showCopyFailure } from "../core/copy-failure";
import {
  fileReferenceClipboardText,
  fileReferenceWithCodeClipboardText,
} from "../core/file-path-copy";
import {
  COPY_16_PATHS,
  GIT_BRANCH_16_PATH,
  MARK_GITHUB_16_PATH,
  OPEN_EXTERNAL_16_PATH,
} from "../core/icons";
import { EXT_TO_LANG } from "../core/source-meta";
import { iconTemplate } from "./ui/icon";
import { renderOwned, templateElement } from "./ui/renderer";

export type LineRefPill = {
  /**
   * `scope` は選択のある面 (左の本文 / 右の面の箱)。同じパスを左右で別の ref
   * に開いていても、コードを写すときはその面の行を読む。省けば document。
   */
  show(
    path: string,
    start: number,
    end: number,
    scope?: () => ParentNode | null,
  ): void;
  hide(): void;
};

export type LineRefPillDeps = {
  // Called when the close button is clicked. The caller decides what
  // "clear the selection" means for the current screen (e.g. drop the file
  // route's line param, or clear a diff drag-selection). This module stays
  // route-agnostic and only renders/hides the pill itself.
  onClose: () => void;
  githubUrlForSelection: (
    path: string,
    start: number,
    end: number,
  ) => string | null;
  copyReferenceLabel: () => string;
  lineCountLabel: (count: number) => string;
  githubOpenTitle: () => string;
  githubCopyTitle: () => string;
  // "Line history": open the commits that changed the selected lines
  // (git log -L). Optional so hosts without history (e.g. tests) can omit it.
  lineHistoryTitle?: () => string;
  openLineHistory?: (path: string, start: number, end: number) => void;
};

/** 札のコピーの絵 (14px。札の文字に合わせて小さく描く)。 */
const PILL_CHECK_PATH =
  "M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z";

function pillIconTemplate(paths: readonly string[]): TemplateResult {
  return html`<svg
    viewBox="0 0 16 16"
    width="14"
    height="14"
    aria-hidden="true"
    fill="currentColor"
  >${paths.map((path) => svg`<path d=${path}></path>`)}</svg>`;
}

export function langFromPath(path: string): string {
  const m = path.match(/\.([^./]+)$/);
  if (!m) return "";
  return EXT_TO_LANG[m[1].toLowerCase()] || "";
}

// Read the rendered code text for [start..end] lines belonging to `path` from
// whichever surface is currently shown (source/blame/history table, or
// diff2html after-side) inside `scope` (the pane that holds the selection).
// Returns an empty array when nothing is rendered so callers degrade silently
// to the ref-only clipboard text.
export function readRenderedLines(
  path: string,
  start: number,
  end: number,
  scope: ParentNode = document,
): string[] {
  const card = scope.querySelector<HTMLElement>(
    `.gdp-file-shell[data-path="${CSS.escape(path)}"]`,
  );
  if (!card) return [];
  const out: string[] = [];
  for (let line = start; line <= end; line++) {
    const sourceRow = card.querySelector<HTMLElement>(
      `.gdp-source-table tr[data-line="${String(line)}"]`,
    );
    if (sourceRow) {
      const code = sourceRow.querySelector<HTMLElement>(
        ".gdp-source-line-code",
      );
      out.push(code?.textContent ?? "");
    }
  }
  if (out.length > 0 && out.some((value) => value.length > 0)) return out;
  // Fall back to diff2html after-side rows.
  const diffRows = card.querySelectorAll<HTMLTableRowElement>(
    "table.d2h-diff-table tr",
  );
  if (diffRows.length === 0) return [];
  const collected = new Map<number, string>();
  diffRows.forEach((row) => {
    const sideCell = row.querySelector<HTMLElement>(
      "td.d2h-code-linenumber, td.d2h-code-side-linenumber",
    );
    if (!sideCell) return;
    const side = sideCell.closest<HTMLElement>(".d2h-file-side-diff");
    const wrapper = sideCell.closest<HTMLElement>(".d2h-file-wrapper");
    if (side && wrapper) {
      const sides = wrapper.querySelectorAll<HTMLElement>(
        ".d2h-file-side-diff",
      );
      if (sides.length >= 2 && side !== sides[1]) return;
    }
    const numText =
      sideCell.querySelector<HTMLElement>(".line-num2")?.textContent ??
      sideCell.textContent ??
      "";
    const line = Number(numText.trim());
    if (!Number.isInteger(line) || line < start || line > end) return;
    const codeCell = row.querySelector<HTMLElement>(".d2h-code-line-ctn");
    if (codeCell) collected.set(line, codeCell.textContent ?? "");
  });
  if (collected.size === 0) return [];
  const ordered: string[] = [];
  for (let line = start; line <= end; line++) {
    ordered.push(collected.get(line) ?? "");
  }
  return ordered;
}

// Root is a <div>, not a <button>: it now hosts two independent buttons
// (copy + close), and a button can't validly nest another button.
type CopyState = "ready" | "copied" | "copied-code" | "failed";

export function createLineRefPill(deps: LineRefPillDeps): LineRefPill {
  // 札の箱。body の末尾に 1 つ置き、中はここが描く。出す / 隠すと位置は箱に書く。
  const pill = templateElement(html`<div id="line-ref-pill" hidden></div>`);
  document.body.appendChild(pill);

  let refText = "";
  let currentPath = "";
  let currentStart = 0;
  let currentEnd = 0;
  let currentScope: () => ParentNode | null = () => document;
  let githubUrl = "";
  let copyState: CopyState = "ready";
  let githubCopied = false;
  let feedbackTimer: ReturnType<typeof setTimeout> | null = null;
  let githubFeedbackTimer: ReturnType<typeof setTimeout> | null = null;

  // 札は選択のある面の下の真ん中に出す。左右に分けたとき、画面の真ん中は
  // 反対の面 (端末など) の上になり、どの面の行の札か分からなかった。
  // 面の大きさが変わったら (掴みで幅を変えた・棚を畳んだ) 置き直す。
  const scopeResize =
    typeof ResizeObserver === "function" ? new ResizeObserver(place) : null;
  let observed: Element | null = null;

  function place() {
    const root = currentScope();
    const box = root instanceof Element ? root.getBoundingClientRect() : null;
    if (!box || box.width === 0) {
      pill.style.removeProperty("--lrp-center");
      pill.style.removeProperty("--lrp-room");
      return;
    }
    pill.style.setProperty("--lrp-center", `${box.left + box.width / 2}px`);
    pill.style.setProperty("--lrp-room", `${box.width}px`);
  }

  function watchScope(root: ParentNode | null) {
    const next = root instanceof Element ? root : null;
    if (next === observed) return;
    if (observed) scopeResize?.unobserve(observed);
    observed = next;
    if (observed) scopeResize?.observe(observed);
  }

  // Lines spanned by the active selection. Only meaningful once `show()` has
  // set currentStart/currentEnd; callers gate display on count > 1 so a
  // single-line selection (self-evident from "@path#42") stays uncluttered.
  function selectionLineCount(): number {
    return currentEnd - currentStart + 1;
  }

  function countBadgeTemplate(): unknown {
    const count = selectionLineCount();
    if (count <= 1) return nothing;
    const warn = count >= AI_CONTEXT_LARGE_SELECTION_LINE_THRESHOLD;
    return html`<span class=${warn ? "lrp-count lrp-count-warn" : "lrp-count"}
      >${deps.lineCountLabel(count)}</span
    >`;
  }

  async function copyReference(event: MouseEvent) {
    if (!refText) return;
    const copyButton = event.currentTarget as HTMLButtonElement;
    const withCode = event.shiftKey;
    let payload = refText;
    let copiedCode = false;
    if (withCode && currentPath) {
      const scope = currentScope();
      const lines = scope
        ? readRenderedLines(currentPath, currentStart, currentEnd, scope)
        : [];
      if (lines.length > 0) {
        payload = fileReferenceWithCodeClipboardText(
          currentPath,
          currentStart,
          currentEnd,
          lines,
          langFromPath(currentPath),
        );
        copiedCode = true;
      }
    }
    try {
      await navigator.clipboard.writeText(payload);
      copyState = copiedCode ? "copied-code" : "copied";
      draw();
    } catch (error) {
      copyState = "failed";
      draw();
      showCopyFailure(
        copyButton,
        "copying the line reference failed",
        error,
        deps.copyReferenceLabel(),
        1200,
      );
    }
    if (feedbackTimer) clearTimeout(feedbackTimer);
    feedbackTimer = setTimeout(() => {
      feedbackTimer = null;
      if (pill.hidden) return;
      copyState = "ready";
      draw();
    }, 1200);
  }

  async function copyGithubUrl(event: MouseEvent) {
    if (!githubUrl) return;
    const githubCopy = event.currentTarget as HTMLButtonElement;
    try {
      await navigator.clipboard.writeText(githubUrl);
      githubCopied = true;
      draw();
    } catch (error) {
      showCopyFailure(
        githubCopy,
        "copying the GitHub link failed",
        error,
        deps.githubCopyTitle(),
        1200,
      );
    }
    if (githubFeedbackTimer) clearTimeout(githubFeedbackTimer);
    githubFeedbackTimer = setTimeout(() => {
      githubFeedbackTimer = null;
      githubCopy.classList.remove("failed");
      githubCopied = false;
      draw();
    }, 1200);
  }

  function pillTemplate(): TemplateResult {
    const label = deps.copyReferenceLabel();
    const copied = copyState === "copied" || copyState === "copied-code";
    const openTitle = deps.githubOpenTitle();
    const copyTitle = deps.githubCopyTitle();
    const historyTitle = deps.lineHistoryTitle?.() ?? "Line history";
    return html`<button
        id="line-ref-pill-copy"
        type="button"
        class=${copied ? "copied" : copyState === "failed" ? "failed" : ""}
        title=${label}
        aria-label=${label}
        @click=${copyReference}
      >${pillIconTemplate(copied ? [PILL_CHECK_PATH] : COPY_16_PATHS)}<span
          class="lrp-label"
          >${label}</span
        ><span class="lrp-ref">${refText}</span>${countBadgeTemplate()}</button
      ><div id="line-ref-pill-github-actions" ?hidden=${!githubUrl}><a
          id="line-ref-pill-github-open"
          target="_blank"
          rel="noopener"
          href=${githubUrl || "#"}
          title=${openTitle}
          aria-label=${openTitle}
        >${iconTemplate(MARK_GITHUB_16_PATH, "octicon-mark-github")}<span
            class="lrp-github-open-label"
            >${openTitle}</span
          >${iconTemplate(OPEN_EXTERNAL_16_PATH, "octicon-link-external")}</a
        ><button
          id="line-ref-pill-github-copy"
          type="button"
          class=${githubCopied ? "copied" : ""}
          title=${copyTitle}
          aria-label=${copyTitle}
          @click=${copyGithubUrl}
        ><span class="lrp-github-copy-icon">${
          githubCopied
            ? pillIconTemplate([PILL_CHECK_PATH])
            : iconTemplate(COPY_16_PATHS, "octicon-copy")
        }</span><span class="lrp-github-copy-label">${copyTitle}</span></button></div
      ><button
        id="line-ref-pill-history"
        type="button"
        ?hidden=${!deps.openLineHistory}
        title=${ifHistory(historyTitle)}
        aria-label=${ifHistory(historyTitle)}
        @click=${() => {
          if (!currentPath || !deps.openLineHistory) return;
          deps.openLineHistory(currentPath, currentStart, currentEnd);
        }}
      >${iconTemplate(GIT_BRANCH_16_PATH, "octicon-git-branch")}<span
          class="lrp-history-label"
          >${deps.openLineHistory ? historyTitle : ""}</span
        ></button
      ><button
        id="line-ref-pill-close"
        type="button"
        title="選択を解除"
        aria-label="選択を解除"
        @click=${() => deps.onClose()}
      >×</button>`;
  }

  /** 行の履歴が無い画面では、見出しの文言を付けない (前と同じ)。 */
  function ifHistory(title: string): string | typeof nothing {
    return deps.openLineHistory ? title : nothing;
  }

  // 中身は初めて出すときに描く (文言を返す側は、札を作った時点ではまだ文言の
  // 表を持っていないことがある)。
  let drawn = false;

  function draw(): void {
    drawn = true;
    renderOwned(pill, pillTemplate());
  }

  return {
    show(path, start, end, scope = () => document) {
      const next = fileReferenceClipboardText(path, start, end);
      if (!next) return;
      const changed = next !== refText;
      refText = next;
      currentPath = path;
      currentScope = scope;
      currentStart = Math.max(1, Math.floor(Math.min(start, end)));
      currentEnd = Math.max(1, Math.floor(Math.max(start, end)));
      githubUrl =
        deps.githubUrlForSelection(currentPath, currentStart, currentEnd) || "";
      if (feedbackTimer) {
        clearTimeout(feedbackTimer);
        feedbackTimer = null;
      }
      copyState = "ready";
      draw();
      if (pill.hidden || changed) {
        // Replay the pop-in so updates to the selection are noticeable.
        pill.classList.remove("pop");
        void pill.offsetWidth;
        pill.classList.add("pop");
      }
      pill.hidden = false;
      watchScope(currentScope());
      place();
    },
    hide() {
      refText = "";
      currentPath = "";
      currentStart = 0;
      currentEnd = 0;
      currentScope = () => document;
      watchScope(null);
      githubUrl = "";
      if (drawn) draw();
      pill.hidden = true;
    },
  };
}
