// Floating "copy line reference" pill. Shown while a line selection exists
// (file view or diff after-side); clicking copies "@path#start-end" to the
// clipboard for pasting into Claude Code / Codex prompts.

import { fileReferenceClipboardText } from "../core/file-path-copy";

export type LineRefPill = {
  show(path: string, start: number, end: number): void;
  hide(): void;
};

export function createLineRefPill(): LineRefPill {
  const pill = document.createElement("button");
  pill.id = "line-ref-pill";
  pill.type = "button";
  pill.title = "copy reference for Claude Code / Codex";
  pill.hidden = true;
  document.body.appendChild(pill);

  let refText = "";
  let feedbackTimer: ReturnType<typeof setTimeout> | null = null;

  function render(label: string, copied: boolean) {
    pill.textContent = label;
    pill.classList.toggle("copied", copied);
  }

  pill.addEventListener("click", async () => {
    if (!refText) return;
    try {
      await navigator.clipboard.writeText(refText);
      render("Copied!", true);
    } catch {
      render("copy failed", false);
    }
    if (feedbackTimer) clearTimeout(feedbackTimer);
    feedbackTimer = setTimeout(() => {
      feedbackTimer = null;
      if (!pill.hidden) render(refText, false);
    }, 1200);
  });

  return {
    show(path: string, start: number, end: number) {
      const next = fileReferenceClipboardText(path, start, end);
      if (!next) return;
      refText = next;
      if (feedbackTimer) {
        clearTimeout(feedbackTimer);
        feedbackTimer = null;
      }
      render(refText, false);
      pill.hidden = false;
    },
    hide() {
      refText = "";
      pill.hidden = true;
    },
  };
}
