// 図を拡大縮小して見る箱 (core/diagram-viewport.ts の createDiagramViewport) の view。
// 箱の形を差し替え、呼び手の決めた class が view に渡ることと、view が作った箱の
// 最初の子が拡大縮小される中身になることを見る。

import "./_dom";
import { html } from "lit/html.js";
import { describe, expect, test } from "vitest";
import { createDiagramViewport, DEFAULT_VIEW } from "../core/diagram-viewport";

describe("the diagram viewport view", () => {
  test("builds the box from the view and zooms its first child", () => {
    const asked: string[][] = [];
    const viewport = createDiagramViewport(
      { containerClassName: "sample-box", contentClassName: "sample-content" },
      {
        box: (container, content) => {
          asked.push([container, content]);
          return html`<section class=${container}
            ><figure class=${content}></figure
          ></section>`;
        },
      },
    );
    viewport.zoomTo(2);
    expect([
      asked,
      viewport.container.tagName,
      viewport.content.tagName,
      viewport.content.className,
      viewport.scale(),
    ]).toEqual([
      [["sample-box", "sample-content"]],
      "SECTION",
      "FIGURE",
      "sample-content",
      2,
    ]);
    viewport.dispose();
  });

  test("the default view nests the content box in the container", () => {
    const viewport = createDiagramViewport(
      { containerClassName: "sample-box", contentClassName: "sample-content" },
      DEFAULT_VIEW,
    );
    expect(viewport.content.parentElement).toBe(viewport.container);
    viewport.dispose();
  });
});
