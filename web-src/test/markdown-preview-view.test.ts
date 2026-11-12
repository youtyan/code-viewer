// Markdown のプレビュー (core/markdown-preview.ts) が足す部品の形
// (views/markdown-preview-view.ts)。チェックボックス・コードのコピーの済みの絵・
// 図の拡大の窓のボタンを、描いた DOM で見る。

import "./_dom";
import { afterEach, describe, expect, test, vi } from "vitest";
import { renderMarkdownPreview } from "../core/markdown-preview";
import { DEFAULT_VIEW } from "../views/markdown-preview-view";
import { templateElement } from "../views/ui/renderer";

const TARGET = { path: "docs/guide.md", ref: "worktree" };

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe("the markdown preview view", () => {
  test("puts a disabled checkbox at the head of each task item", async () => {
    const root = await renderMarkdownPreview(
      "- [x] done\n- [ ] todo\n",
      TARGET,
      { syntaxHighlight: false },
    );
    expect(
      [...root.querySelectorAll("li.task-list-item")].map((li) => {
        const box = li.firstElementChild;
        return box instanceof HTMLInputElement
          ? [box.type, box.disabled, box.checked, li.textContent?.trim()]
          : null;
      }),
    ).toEqual([
      ["checkbox", true, true, "done"],
      ["checkbox", true, false, "todo"],
    ]);
  });

  test("shows the copied mark for a while after copying the code", async () => {
    vi.useFakeTimers();
    const written: string[] = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          written.push(text);
        },
      },
    });
    const root = await renderMarkdownPreview("```\nplain\n```", TARGET, {
      syntaxHighlight: false,
    });
    const button = root.querySelector<HTMLButtonElement>(".mkdp-code-copy");
    const mark = () => button?.querySelector("svg")?.getAttribute("class");
    const before = mark();
    button?.click();
    await vi.advanceTimersByTimeAsync(0);
    const copied = mark();
    await vi.advanceTimersByTimeAsync(1500);
    expect([written, before, copied, mark()]).toEqual([
      ["plain\n"],
      "octicon octicon-copy",
      "octicon octicon-check",
      "octicon octicon-copy",
    ]);
  });

  test("the lightbox keeps the toolbar presses to itself", () => {
    const pressed: string[] = [];
    const outer = vi.fn();
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const overlay = templateElement(
      DEFAULT_VIEW.mermaidLightbox({
        svg,
        hint: "sample hint",
        buttons: ["+", "-", "fit", "x"].map((label) => ({
          label,
          title: label,
          onPress: () => pressed.push(label),
        })),
      }),
    );
    overlay.addEventListener("click", outer);
    for (const button of overlay.querySelectorAll("button")) button.click();
    expect([
      overlay.querySelector(".mkdp-lightbox-stage")?.firstElementChild === svg,
      overlay.querySelector(".mkdp-lightbox-hint")?.textContent,
      pressed,
      outer.mock.calls.length,
    ]).toEqual([true, "sample hint", ["+", "-", "fit", "x"], 0]);
  });
});
