// Floating "copy line reference" pill. Shown while a line selection exists
// (file view or diff after-side); clicking copies "@path#start-end" to the
// clipboard for pasting into Claude Code / Codex prompts. Shift+click copies
// the same reference followed by a fenced code block carrying the actual
// lines, so an AI can reason about the code without re-fetching.

import { AI_CONTEXT_LARGE_SELECTION_LINE_THRESHOLD } from "../core/ai-context-copy";
import {
  fileReferenceClipboardText,
  fileReferenceWithCodeClipboardText,
} from "../core/file-path-copy";
import { escapeHtml } from "../core/html-escape";
import { EXT_TO_LANG } from "../core/source-meta";

export type LineRefPill = {
  show(path: string, start: number, end: number): void;
  hide(): void;
};

export type LineRefPillDeps = {
  // Called when the close button is clicked. The caller decides what
  // "clear the selection" means for the current screen (e.g. drop the file
  // route's line param, or clear a diff drag-selection). This module stays
  // route-agnostic and only renders/hides the pill itself.
  onClose: () => void;
};

const COPY_ICON =
  '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="currentColor">' +
  '<path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z"/>' +
  '<path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"/>' +
  "</svg>";

const CHECK_ICON =
  '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="currentColor">' +
  '<path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"/>' +
  "</svg>";

export function langFromPath(path: string): string {
  const m = path.match(/\.([^./]+)$/);
  if (!m) return "";
  return EXT_TO_LANG[m[1].toLowerCase()] || "";
}

// Read the rendered code text for [start..end] lines belonging to `path` from
// whichever surface is currently shown (source/blame/history table, or
// diff2html after-side). Returns an empty array when nothing is rendered so
// callers degrade silently to the ref-only clipboard text.
export function readRenderedLines(
  path: string,
  start: number,
  end: number,
): string[] {
  const card = document.querySelector<HTMLElement>(
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
export function createLineRefPill(deps: LineRefPillDeps): LineRefPill {
  const pill = document.createElement("div");
  pill.id = "line-ref-pill";
  pill.hidden = true;

  const copyButton = document.createElement("button");
  copyButton.id = "line-ref-pill-copy";
  copyButton.type = "button";
  copyButton.title =
    "選択行の参照をコピー（Claude Code / Codex に貼り付け用）。Shift+Click でコード本体も添付。";

  const closeButton = document.createElement("button");
  closeButton.id = "line-ref-pill-close";
  closeButton.type = "button";
  closeButton.title = "選択を解除";
  closeButton.setAttribute("aria-label", "選択を解除");
  closeButton.textContent = "×";

  pill.appendChild(copyButton);
  pill.appendChild(closeButton);
  document.body.appendChild(pill);

  let refText = "";
  let currentPath = "";
  let currentStart = 0;
  let currentEnd = 0;
  let feedbackTimer: ReturnType<typeof setTimeout> | null = null;

  // Lines spanned by the active selection. Only meaningful once `show()` has
  // set currentStart/currentEnd; callers gate display on count > 1 so a
  // single-line selection (self-evident from "@path#42") stays uncluttered.
  function selectionLineCount(): number {
    return currentEnd - currentStart + 1;
  }

  function countBadgeHtml(): string {
    const count = selectionLineCount();
    if (count <= 1) return "";
    const warn = count >= AI_CONTEXT_LARGE_SELECTION_LINE_THRESHOLD;
    return `<span class="lrp-count${warn ? " lrp-count-warn" : ""}">${count} lines</span>`;
  }

  function render(state: "ready" | "copied" | "copied-code" | "failed") {
    pill.classList.toggle(
      "copied",
      state === "copied" || state === "copied-code",
    );
    if (state === "copied") {
      copyButton.innerHTML = `${CHECK_ICON}<span class="lrp-label">Copied!</span>`;
      return;
    }
    if (state === "copied-code") {
      const count = selectionLineCount();
      const suffix = count > 1 ? ` (${count} lines)` : "";
      copyButton.innerHTML = `${CHECK_ICON}<span class="lrp-label">Copied + code${suffix}</span>`;
      return;
    }
    if (state === "failed") {
      copyButton.innerHTML = `${COPY_ICON}<span class="lrp-label">copy failed</span>`;
      return;
    }
    copyButton.innerHTML =
      `${COPY_ICON}<span class="lrp-label">Copy</span>` +
      `<span class="lrp-ref">${escapeHtml(refText)}</span>` +
      countBadgeHtml();
  }

  copyButton.addEventListener("click", async (event) => {
    if (!refText) return;
    const withCode = event.shiftKey;
    let payload = refText;
    let copiedCode = false;
    if (withCode && currentPath) {
      const lines = readRenderedLines(currentPath, currentStart, currentEnd);
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
      render(copiedCode ? "copied-code" : "copied");
    } catch {
      render("failed");
    }
    if (feedbackTimer) clearTimeout(feedbackTimer);
    feedbackTimer = setTimeout(() => {
      feedbackTimer = null;
      if (!pill.hidden) render("ready");
    }, 1200);
  });

  closeButton.addEventListener("click", () => {
    deps.onClose();
  });

  return {
    show(path: string, start: number, end: number) {
      const next = fileReferenceClipboardText(path, start, end);
      if (!next) return;
      const changed = next !== refText;
      refText = next;
      currentPath = path;
      currentStart = Math.max(1, Math.floor(Math.min(start, end)));
      currentEnd = Math.max(1, Math.floor(Math.max(start, end)));
      if (feedbackTimer) {
        clearTimeout(feedbackTimer);
        feedbackTimer = null;
      }
      render("ready");
      if (pill.hidden || changed) {
        // Replay the pop-in so updates to the selection are noticeable.
        pill.classList.remove("pop");
        void pill.offsetWidth;
        pill.classList.add("pop");
      }
      pill.hidden = false;
    },
    hide() {
      refText = "";
      currentPath = "";
      currentStart = 0;
      currentEnd = 0;
      pill.hidden = true;
    },
  };
}
