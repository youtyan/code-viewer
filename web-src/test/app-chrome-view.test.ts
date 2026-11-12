// app.ts が作る要素の形 (views/app-chrome.ts)。前は app.ts が要素を 1 つずつ組み、
// 絵は iconSvg の文字列を innerHTML に入れていた。テンプレートにしても同じ DOM に
// なること (見た目が変わらないこと) と、押したときに presenter へ渡す値を見る。

import "./_dom";
import { afterEach, describe, expect, test, vi } from "vitest";
import { CHEVRON_DOWN_12_PATH, iconSvg, SYNC_16_PATH } from "../core/icons";
import { DEFAULT_VIEW, fillWith } from "../views/app-chrome";
import { templateElement } from "../views/ui/renderer";

afterEach(() => {
  document.body.replaceChildren();
});

type Shape = { tag: string; attrs: string[][]; children: (Shape | string)[] };

/** 要素の形 (名前・属性・子)。属性は並びを問わない (描き方で並びが変わるだけで、
 * 見た目は変わらない)。lit が残す印 (コメント) は数えない。 */
function shape(el: Element): Shape {
  return {
    tag: el.tagName.toLowerCase(),
    attrs: [...el.attributes]
      .map((attr) => [attr.name, attr.value])
      .sort(([a = ""], [b = ""]) => a.localeCompare(b)),
    children: [...el.childNodes].flatMap((node): (Shape | string)[] => {
      if (node instanceof Element) return [shape(node)];
      if (node.nodeType === Node.TEXT_NODE) return [node.textContent ?? ""];
      return [];
    }),
  };
}

function fromMarkup(markup: string): HTMLElement {
  const box = document.createElement("span");
  box.innerHTML = markup;
  return box;
}

function filled(template: unknown): HTMLElement {
  const box = document.createElement("span");
  fillWith(box, template);
  return box;
}

describe("the app chrome view", () => {
  test.each<[string, string | string[]]>([
    ["octicon-sync", SYNC_16_PATH],
    ["view-strip-icon", [SYNC_16_PATH, SYNC_16_PATH]],
  ])("draws the %s icon as iconSvg did", (cls, paths) => {
    const before = fromMarkup(
      iconSvg(cls, typeof paths === "string" ? paths : [...paths]),
    );
    expect(shape(filled(DEFAULT_VIEW.icon(paths, cls)))).toEqual(shape(before));
  });

  test("draws the 12 px chevron as the hand-written svg did", () => {
    const before = fromMarkup(
      `<svg class="octicon octicon-chevron-down" viewBox="0 0 12 12" width="12" height="12" fill="currentColor" aria-hidden="true"><path fill="currentColor" d="${CHEVRON_DOWN_12_PATH}"></path></svg>`,
    );
    expect(
      shape(
        filled(
          DEFAULT_VIEW.icon(CHEVRON_DOWN_12_PATH, "octicon-chevron-down", 12),
        ),
      ),
    ).toEqual(shape(before));
  });

  test("draws the layout and empty-diff buttons' insides as before", () => {
    expect([
      shape(filled(DEFAULT_VIEW.layoutButton(SYNC_16_PATH, "Split"))),
      shape(
        filled(
          DEFAULT_VIEW.emptyAction("octicon-sync", SYNC_16_PATH, "Reload"),
        ),
      ),
    ]).toEqual([
      shape(
        fromMarkup(
          `${iconSvg("seg-icon", SYNC_16_PATH)}<span class="seg-label">Split</span>`,
        ),
      ),
      shape(
        fromMarkup(
          `<span class="empty-action-icon" aria-hidden="true">${iconSvg("octicon-sync", SYNC_16_PATH)}</span><span class="empty-action-label">Reload</span>`,
        ),
      ),
    ]);
  });

  test("fills a box again after other code rewrote it", () => {
    const box = filled(DEFAULT_VIEW.layoutButton(SYNC_16_PATH, "Split"));
    box.textContent = "rewritten";
    fillWith(box, DEFAULT_VIEW.layoutButton(SYNC_16_PATH, "Unified"));
    expect(box.querySelector(".seg-label")?.textContent).toBe("Unified");
  });

  test("builds the ref selector from its options", () => {
    const wrap = templateElement(
      DEFAULT_VIEW.refSelector({
        id: "sample-ref",
        placeholder: "ref...",
        title: "Base",
        wrapperId: "sample-wrap",
        extraClass: "sample-extra",
        hidden: true,
        value: "main",
      }),
    );
    const input = wrap.querySelector("input");
    expect([
      wrap.className,
      wrap.id,
      wrap.hidden,
      input?.id,
      input?.readOnly,
      input?.getAttribute("autocomplete"),
      input?.title,
      input?.getAttribute("aria-label"),
      input?.value,
      [...wrap.children].map((child) => child.className),
    ]).toEqual([
      "ref-selector sample-extra",
      "sample-wrap",
      true,
      "sample-ref",
      true,
      "off",
      "Base",
      "Base",
      "main",
      ["ref-selector-icon", "ref-input", "ref-selector-caret"],
    ]);
  });

  test("leaves out the ref selector's optional attributes", () => {
    const wrap = templateElement(
      DEFAULT_VIEW.refSelector({ id: "sample-ref", placeholder: "ref..." }),
    );
    const input = wrap.querySelector("input");
    expect([
      wrap.hasAttribute("id"),
      wrap.hidden,
      input?.hasAttribute("title"),
      input?.hasAttribute("aria-label"),
      input?.value,
    ]).toEqual([false, false, false, false, ""]);
  });

  test("enables a revision button only when that revision is known", () => {
    const onGo = vi.fn();
    const nav = templateElement(
      DEFAULT_VIEW.revisionNav({
        olderTitle: "Older",
        newerTitle: "Newer",
        previous: "sample-sha",
        next: null,
        onGo,
      }),
    );
    const [older, newer] = nav.querySelectorAll("button");
    older?.click();
    newer?.click();
    expect([older?.disabled, newer?.disabled, onGo.mock.calls]).toEqual([
      false,
      true,
      [["sample-sha"]],
    ]);
  });

  test("passes the pressed buttons to the presenter", () => {
    const onReload = vi.fn();
    const onOpen = vi.fn();
    const outer = vi.fn();
    const actions = templateElement(
      DEFAULT_VIEW.emptyDiffActions({ onReload, onHistory: () => undefined }),
    );
    const open = templateElement(DEFAULT_VIEW.openPathButton("Open", onOpen));
    const host = document.createElement("div");
    host.addEventListener("click", outer);
    host.append(actions, open);
    document.body.append(host);
    const reload = actions.querySelector("button");
    reload?.click();
    open.click();
    expect([
      actions.hidden,
      onReload.mock.calls[0]?.[0] === reload,
      onOpen.mock.calls[0]?.[0] === open,
      // 開くボタンは押しても外 (ファイルの頭) へ伝えない。
      outer.mock.calls.length,
    ]).toEqual([true, true, true, 1]);
  });

  test("marks only the last breadcrumb part as current", () => {
    const nav = templateElement(
      DEFAULT_VIEW.foreignCrumbs({
        label: "File path",
        look: { root: "/sample", name: "sample", initials: "S", color: null },
        parts: ["sample", "src", "main.ts"],
      }),
    );
    expect(
      [...nav.children].map((child) => [child.className, child.textContent]),
    ).toEqual([
      ["project-mark main-pane-foreign-mark", "S"],
      ["gdp-file-breadcrumb-part", "sample"],
      ["gdp-file-breadcrumb-sep", "/"],
      ["gdp-file-breadcrumb-part", "src"],
      ["gdp-file-breadcrumb-sep", "/"],
      ["gdp-file-breadcrumb-current", "main.ts"],
    ]);
  });
});
