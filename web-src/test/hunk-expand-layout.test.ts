// 行の展開 (views/hunk-expand.ts) を付けるときの配置の読み方。ハンクの行の位置を
// 書き込みと交互に読むと、読むたびに表全体の配置をやり直す (ハンク 300 の差分で
// 2 秒止まった)。位置は 1 行 1 回だけ読み、行の高さはまとめて合わせる。
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, beforeAll, expect, test } from "vitest";
import type { DiffCardElement } from "../core/types";
import { createHunkExpand } from "../views/hunk-expand";

beforeAll(() => {
  GlobalRegistrator.register();
});

afterAll(() => {
  GlobalRegistrator.unregister();
});

test("reads each hunk row's position once and sets every row height", async () => {
  const hunks = 6;
  const card = document.createElement("div") as DiffCardElement;
  card.innerHTML = `<table class="d2h-diff-table"><tbody>${Array.from(
    { length: hunks },
    (_, i) =>
      `<tr><td class="d2h-code-linenumber d2h-info"></td><td class="d2h-info">@@ -${i * 50 + 20},3 +${i * 50 + 20},3 @@</td></tr><tr><td class="d2h-code-linenumber">1</td><td class="d2h-cntx">sample</td></tr>`,
  ).join("")}</tbody></table>`;
  document.body.appendChild(card);
  const rows = [...card.querySelectorAll("tr")];
  let rowReads = 0;
  const originalRect = Element.prototype.getBoundingClientRect;
  const originalFetch = globalThis.fetch;
  Element.prototype.getBoundingClientRect = function (this: Element) {
    if (this instanceof HTMLTableRowElement) rowReads += 1;
    const top =
      this instanceof HTMLTableRowElement ? rows.indexOf(this) * 20 : 0;
    return {
      top,
      bottom: top + 20,
      left: 0,
      right: 0,
      width: 0,
      height: 20,
      x: 0,
      y: top,
      toJSON: () => ({}),
    } as DOMRect;
  };
  globalThis.fetch = (() =>
    new Promise<Response>(() => undefined)) as typeof fetch;
  try {
    createHunkExpand({
      trackLoad: (promise) => promise,
      getServerGeneration: () => 1,
      getToRef: () => "worktree",
      highlightInsertedSpans: () => undefined,
    }).setupHunkExpand(card, {
      path: "src/sample.ts",
      status: "M",
      load_url: "/file_diff?path=src%2Fsample.ts",
    });
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect({
      rowReads,
      heights: card.querySelectorAll<HTMLElement>(
        "tr.gdp-hunk-row[style*='height']",
      ).length,
    }).toEqual({ rowReads: hunks, heights: hunks });
  } finally {
    Element.prototype.getBoundingClientRect = originalRect;
    globalThis.fetch = originalFetch;
  }
});
