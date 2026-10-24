// 上の帯の「⋯」のメニュー (views/topbar-more.ts): 帯に見えていない操作だけを、帯の
// 並びの順に、帯と同じ名前で並べる。切替には今の状態の印を付け、選ぶと帯の同じ
// ボタンを押す。どれを外すかは CSS の段が決めるので、ここでは「見えていない」を
// getClientRects が空であることで表す (data-folded の中)。

import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";

GlobalRegistrator.register();
const { topbarMoreItems } = await import("../views/topbar-more");

const originalRects = HTMLElement.prototype.getClientRects;
beforeAll(() => {
  HTMLElement.prototype.getClientRects = function (this: HTMLElement) {
    return (this.closest("[data-folded]")
      ? []
      : [new DOMRect(0, 0, 10, 10)]) as unknown as DOMRectList;
  };
});
afterAll(() => {
  HTMLElement.prototype.getClientRects = originalRects;
  GlobalRegistrator.unregister();
});
afterEach(() => {
  document.body.innerHTML = "";
});

/** 帯。folded に挙げた部品を外した (見えていない) ことにする。 */
function topbar(folded: string[]): void {
  document.body.innerHTML = `
    <header id="topbar">
      <div class="ref-pickers">
        <button id="ref-reset" title="reset to HEAD .. worktree" aria-label="reset to HEAD .. worktree"><svg></svg></button>
        <button id="reload-prom" title="reload diff (R)" aria-label="reload diff (R)"><svg></svg></button>
      </div>
      <div class="controls">
        <div class="seg">
          <button data-layout="line-by-line" class="active" title="unified"><svg></svg><span class="seg-label">unified</span></button>
          <button data-layout="side-by-side" title="split"><svg></svg><span class="seg-label">split</span></button>
        </div>
        <button id="ignore-ws" class="active" title="ignore whitespace changes (-w)">ws</button>
        <button id="syntax-highlight" title="syntax highlighting off">syntax</button>
        <button id="hide-tests" title="hide test files (test|spec)">no test</button>
      </div>
    </header>`;
  for (const selector of folded)
    document.querySelector(selector)?.setAttribute("data-folded", "");
}

describe("topbarMoreItems", () => {
  test.each([
    { name: "nothing folded", folded: [], items: [] },
    {
      name: "the text toggles folded",
      folded: ["#ignore-ws", "#syntax-highlight", "#hide-tests"],
      items: [
        ["ws", "ignore whitespace changes (-w)", true],
        ["syntax", "syntax highlighting off", false],
        ["no test", "hide test files (test|spec)", false],
      ],
    },
    {
      name: "everything folded (in the order of the bar)",
      folded: [
        "#ref-reset",
        "#reload-prom",
        ".seg",
        "#ignore-ws",
        "#syntax-highlight",
        "#hide-tests",
      ],
      items: [
        ["reset to HEAD .. worktree", "reset to HEAD .. worktree", undefined],
        ["reload diff (R)", "reload diff (R)", undefined],
        ["unified", "unified", true],
        ["split", "split", false],
        ["ws", "ignore whitespace changes (-w)", true],
        ["syntax", "syntax highlighting off", false],
        ["no test", "hide test files (test|spec)", false],
      ],
    },
  ])("$name", ({ folded, items }) => {
    topbar(folded);
    expect(
      topbarMoreItems(document).map((item) =>
        item.kind === "separator"
          ? item.kind
          : [item.label, item.title, item.checked],
      ),
    ).toEqual(items);
  });

  test("choosing an item presses the same button on the bar", () => {
    topbar(["#hide-tests"]);
    const pressed: string[] = [];
    document
      .querySelector("#hide-tests")
      ?.addEventListener("click", () => pressed.push("hide-tests"));
    for (const item of topbarMoreItems(document))
      if (item.kind !== "separator") item.onSelect();
    expect(pressed).toEqual(["hide-tests"]);
  });
});
