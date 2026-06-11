// Floating "copy line reference" pill. Shown while a line selection exists
// (file view or diff after-side); clicking copies "@path#start-end" to the
// clipboard for pasting into Claude Code / Codex prompts.

import { fileReferenceClipboardText } from "../core/file-path-copy";

export type LineRefPill = {
  show(path: string, start: number, end: number): void;
  hide(): void;
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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function createLineRefPill(): LineRefPill {
  const pill = document.createElement("button");
  pill.id = "line-ref-pill";
  pill.type = "button";
  pill.title = "選択行の参照をコピー（Claude Code / Codex に貼り付け用）";
  pill.hidden = true;
  document.body.appendChild(pill);

  let refText = "";
  let feedbackTimer: ReturnType<typeof setTimeout> | null = null;

  function render(state: "ready" | "copied" | "failed") {
    pill.classList.toggle("copied", state === "copied");
    if (state === "copied") {
      pill.innerHTML = `${CHECK_ICON}<span class="lrp-label">Copied!</span>`;
      return;
    }
    if (state === "failed") {
      pill.innerHTML = `${COPY_ICON}<span class="lrp-label">copy failed</span>`;
      return;
    }
    pill.innerHTML =
      `${COPY_ICON}<span class="lrp-label">Copy</span>` +
      `<span class="lrp-ref">${escapeHtml(refText)}</span>`;
  }

  pill.addEventListener("click", async () => {
    if (!refText) return;
    try {
      await navigator.clipboard.writeText(refText);
      render("copied");
    } catch {
      render("failed");
    }
    if (feedbackTimer) clearTimeout(feedbackTimer);
    feedbackTimer = setTimeout(() => {
      feedbackTimer = null;
      if (!pill.hidden) render("ready");
    }, 1200);
  });

  return {
    show(path: string, start: number, end: number) {
      const next = fileReferenceClipboardText(path, start, end);
      if (!next) return;
      const changed = next !== refText;
      refText = next;
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
      pill.hidden = true;
    },
  };
}
