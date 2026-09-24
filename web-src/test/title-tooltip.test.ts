// title の吹き出し (views/title-tooltip.ts): マウスとペンで約 300ms 後に出て、
// 離れる・押す・キー・スクロール・窓がぼやけるで消える。出している間は title を
// 外して既定の吹き出しと重ねず、消すときに戻す (その間に書き直された値は残す)。
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import {
  installTitleTooltips,
  placeTooltip,
  TITLE_TOOLTIP_DELAY_MS,
} from "../views/title-tooltip";

beforeAll(() => {
  GlobalRegistrator.register();
});
afterAll(() => {
  GlobalRegistrator.unregister();
});

let uninstall: (() => void) | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = `
    <div id="outside">outside</div>
    <button id="anchor" title="History (g h)"><span id="inner">icon</span></button>
    <div id="tab" title="src/sample.ts"><span id="tab-name">sample.ts</span><button id="close" title="Close tab">x</button></div>
    <div id="blank" title=" "><span id="blank-inner">x</span></div>`;
  uninstall = installTitleTooltips(document);
});
afterEach(() => {
  uninstall?.();
  uninstall = null;
  vi.useRealTimers();
});

function el(id: string): HTMLElement {
  const found = document.getElementById(id);
  if (!found) throw new Error(`missing #${id}`);
  return found;
}

function pointer(
  type: "pointerover" | "pointerout" | "pointerdown",
  target: Element,
  pointerType = "mouse",
  relatedTarget: Element | null = null,
): void {
  target.dispatchEvent(
    new PointerEvent(type, { bubbles: true, pointerType, relatedTarget }),
  );
}

/** 出ている吹き出しの文言。出ていなければ null。 */
function shownText(): string | null {
  const tip = document.querySelector<HTMLElement>(".title-tooltip");
  return tip && !tip.hidden ? tip.textContent : null;
}

describe("showing", () => {
  test.each([
    { name: "mouse", pointerType: "mouse", expected: "History (g h)" },
    { name: "pen", pointerType: "pen", expected: "History (g h)" },
    { name: "touch does not show", pointerType: "touch", expected: null },
  ])("$name", ({ pointerType, expected }) => {
    pointer("pointerover", el("inner"), pointerType);
    vi.advanceTimersByTime(1000);
    expect(shownText()).toBe(expected);
  });

  test.each([
    { name: "just before the delay", ms: 299, expected: null },
    { name: "at the delay", ms: 300, expected: "History (g h)" },
  ])("$name", ({ ms, expected }) => {
    pointer("pointerover", el("anchor"));
    vi.advanceTimersByTime(ms);
    expect(shownText()).toBe(expected);
  });

  test("the delay is about 300ms", () => {
    expect(TITLE_TOOLTIP_DELAY_MS).toBe(300);
  });

  test("is placed in the body, out of reach of the parents' overflow", () => {
    pointer("pointerover", el("anchor"));
    vi.advanceTimersByTime(300);
    const tip = document.querySelector(".title-tooltip");
    expect([tip?.parentElement?.tagName, tip?.getAttribute("role")]).toEqual([
      "BODY",
      "tooltip",
    ]);
  });

  test("a blank title shows nothing (and hides the parents' title)", () => {
    pointer("pointerover", el("blank-inner"));
    vi.advanceTimersByTime(1000);
    expect(shownText()).toBe(null);
  });

  test("leaving before the delay never shows it", () => {
    pointer("pointerover", el("anchor"));
    vi.advanceTimersByTime(200);
    pointer("pointerout", el("anchor"), "mouse", el("outside"));
    vi.advanceTimersByTime(1000);
    expect([shownText(), el("anchor").getAttribute("title")]).toEqual([
      null,
      "History (g h)",
    ]);
  });
});

describe("while shown", () => {
  beforeEach(() => {
    pointer("pointerover", el("anchor"));
    vi.advanceTimersByTime(300);
  });

  test("the title is taken off so the browser's own tooltip does not overlap", () => {
    expect(el("anchor").hasAttribute("title")).toBe(false);
  });

  test("moving onto a child of the element keeps it", () => {
    pointer("pointerout", el("anchor"), "mouse", el("inner"));
    pointer("pointerover", el("inner"));
    expect(shownText()).toBe("History (g h)");
  });

  test.each([
    {
      name: "leaving",
      act: () => pointer("pointerout", el("inner"), "mouse", el("outside")),
    },
    {
      name: "leaving the window",
      act: () => pointer("pointerout", el("inner"), "mouse", null),
    },
    { name: "pressing", act: () => pointer("pointerdown", el("inner")) },
    {
      name: "a key",
      act: () =>
        document.dispatchEvent(
          new KeyboardEvent("keydown", { key: "a", bubbles: true }),
        ),
    },
    {
      name: "scrolling anywhere",
      act: () => el("outside").dispatchEvent(new Event("scroll")),
    },
    {
      name: "the window blurring",
      act: () => window.dispatchEvent(new Event("blur")),
    },
  ])("$name hides it and puts the title back", ({ act }) => {
    act();
    expect([shownText(), el("anchor").getAttribute("title")]).toEqual([
      null,
      "History (g h)",
    ]);
  });

  test("a title rewritten meanwhile is shown, and kept when it hides", async () => {
    el("anchor").title = "History (g y)";
    await Promise.resolve();
    const whileShown = [shownText(), el("anchor").hasAttribute("title")];
    pointer("pointerout", el("inner"), "mouse", el("outside"));
    expect([whileShown, el("anchor").getAttribute("title")]).toEqual([
      ["History (g y)", false],
      "History (g y)",
    ]);
  });

  test("a title rewritten just before it hides is not overwritten", () => {
    el("anchor").title = "History (g y)";
    pointer("pointerdown", el("inner"));
    expect(el("anchor").getAttribute("title")).toBe("History (g y)");
  });
});

describe("a title inside another title", () => {
  test("the inner one takes over, and the outer one comes back", () => {
    pointer("pointerover", el("tab-name"));
    vi.advanceTimersByTime(300);
    const outer = shownText();
    pointer("pointerout", el("tab-name"), "mouse", el("close"));
    pointer("pointerover", el("close"));
    vi.advanceTimersByTime(300);
    expect([outer, shownText(), el("tab").getAttribute("title")]).toEqual([
      "src/sample.ts",
      "Close tab",
      "src/sample.ts",
    ]);
  });
});

describe("placeTooltip", () => {
  const viewport = { width: 1000, height: 600 };
  const tip = { width: 100, height: 20 };
  test.each([
    {
      name: "below, centered on the element",
      anchor: { left: 400, top: 100, width: 40, height: 20 },
      expected: { left: 370, top: 126 },
    },
    {
      name: "just fits below (bottom edge 8px from the window)",
      anchor: { left: 400, top: 546, width: 40, height: 20 },
      expected: { left: 370, top: 572 },
    },
    {
      name: "one pixel too low goes above",
      anchor: { left: 400, top: 547, width: 40, height: 20 },
      expected: { left: 370, top: 521 },
    },
    {
      name: "pushed right off the left edge",
      anchor: { left: 0, top: 100, width: 20, height: 20 },
      expected: { left: 8, top: 126 },
    },
    {
      name: "pushed left off the right edge",
      anchor: { left: 980, top: 100, width: 20, height: 20 },
      expected: { left: 892, top: 126 },
    },
  ])("$name", ({ anchor, expected }) => {
    expect(placeTooltip(anchor, tip, viewport)).toEqual(expected);
  });
});
