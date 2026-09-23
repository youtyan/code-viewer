// 差分のカードの貼り付く横スクロールバー (views/diff-hscroll.ts と
// core/hscroll-proxy.ts)。長いカードの上の方を読んでいる間も、本文の箱の下端で
// 横に送れるようにする。
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  maxScrollLeft,
  mirroredScrollLeft,
  needsProxyScrollbar,
} from "../core/hscroll-proxy";
import {
  baseRules,
  cascadedDeclarations,
  loadStyleSheet,
} from "./_css-fixture";

describe("数え方", () => {
  test.each([
    { scrollWidth: 1057, clientWidth: 1020, max: 37, needs: true },
    { scrollWidth: 1021, clientWidth: 1020, max: 1, needs: false },
    { scrollWidth: 1020, clientWidth: 1020, max: 0, needs: false },
    { scrollWidth: 0, clientWidth: 510, max: 0, needs: false },
  ])("scrollWidth $scrollWidth / clientWidth $clientWidth → 送れる量 $max・バー $needs", ({
    scrollWidth,
    clientWidth,
    max,
    needs,
  }) => {
    expect(maxScrollLeft({ scrollWidth, clientWidth })).toBe(max);
    expect(needsProxyScrollbar({ scrollWidth, clientWidth })).toBe(needs);
  });

  test.each([
    // 範囲の中はそのまま (整数に丸める)
    { source: 120, target: [1057, 1020, 0], expected: 37 },
    { source: 20.4, target: [1057, 1020, 0], expected: 20 },
    // 範囲の外は端で止める
    { source: -5, target: [1057, 1020, 10], expected: 0 },
    // 送れない箱 (Split の短い側) には 0 しか書けない。今が 0 なら書かない
    { source: 200, target: [510, 510, 0], expected: null },
    // 今と同じ値なら書かない (写し合いが止まる)
    { source: 30, target: [1057, 1020, 30], expected: null },
  ])("横位置 $source を写す → $expected", ({ source, target, expected }) => {
    const [scrollWidth, clientWidth, scrollLeft] = target;
    expect(
      mirroredScrollLeft(source, { scrollWidth, clientWidth, scrollLeft }),
    ).toBe(expected);
  });
});

describe("CSS", () => {
  const rules = baseRules(loadStyleSheet());
  test.each([
    // 本文の箱の下端に貼り付く (箱の下の余白の分だけ下へ出す)
    [".gdp-hscroll", "position", "sticky"],
    [".gdp-hscroll", "bottom", "calc(0px - var(--content-pad-bottom, 0px))"],
    [".gdp-hscroll-lane", "overflow-x", "auto"],
    // 中身の本物の横スクロールバーは隠す (二重に出さない)
    [".gdp-hscroll-host .d2h-code-wrapper", "scrollbar-width", "none"],
    // 下の余白は名前のある値から (貼り付く位置と同じもの)
    [
      "#content",
      "padding",
      "var(--content-top-gap) var(--content-pad-x) var(--content-pad-bottom)",
    ],
    // 畳んだカードには出さない
    [".gdp-file-collapsed .gdp-hscroll", "display", "none"],
  ])("%s has %s: %s", (selector, property, expected) => {
    expect(
      cascadedDeclarations(rules, (candidate) => candidate === selector).get(
        property,
      ),
    ).toBe(expected);
  });
});

describe("配線", () => {
  beforeAll(() => {
    GlobalRegistrator.register();
  });
  afterAll(() => {
    GlobalRegistrator.unregister();
  });

  /** diff2html が描く形 (Split は左右 2 つ、Unified は 1 つの .d2h-code-wrapper)。 */
  function card(sides: number): HTMLElement {
    const shell = document.createElement("div");
    const wrapper = document.createElement("div");
    wrapper.className = "d2h-file-wrapper";
    for (let i = 0; i < sides; i++) {
      const code = document.createElement("div");
      code.className = "d2h-code-wrapper";
      code.append(document.createElement("table"));
      // happy-dom は寸法を持たないので、送れる幅を持つ箱として決めておく。
      Object.defineProperty(code, "scrollWidth", { value: 1057 });
      Object.defineProperty(code, "clientWidth", { value: 510 });
      wrapper.append(code);
    }
    shell.append(wrapper);
    document.body.append(shell);
    return shell;
  }

  async function importView() {
    return import("../views/diff-hscroll");
  }

  test.each([
    ["Unified", 1],
    ["Split", 2],
  ])("%s: 中身の数だけバーを付け、外すと消える", async (_name, sides) => {
    const { attachStickyHScroll, detachStickyHScroll } = await importView();
    const shell = card(sides);
    attachStickyHScroll(shell);
    const row = shell.querySelector<HTMLElement>(".gdp-hscroll");
    expect(row).not.toBeNull();
    expect(row?.hidden).toBe(false);
    expect(row?.querySelectorAll(".gdp-hscroll-lane").length).toBe(sides);
    expect(
      shell
        .querySelector(".d2h-file-wrapper")
        ?.classList.contains("gdp-hscroll-host"),
    ).toBe(true);
    // 内側の幅は中身の scrollWidth (同じだけ送れる)
    expect(
      shell.querySelector<HTMLElement>(".gdp-hscroll-inner")?.style.width,
    ).toBe("1057px");
    detachStickyHScroll(shell);
    expect(shell.querySelector(".gdp-hscroll")).toBeNull();
    expect(
      shell
        .querySelector(".d2h-file-wrapper")
        ?.classList.contains("gdp-hscroll-host"),
    ).toBe(false);
  });

  test("描き直すたびに付け直しても 1 本のまま", async () => {
    const { attachStickyHScroll } = await importView();
    const shell = card(1);
    attachStickyHScroll(shell);
    attachStickyHScroll(shell);
    expect(shell.querySelectorAll(".gdp-hscroll").length).toBe(1);
  });

  /** 横位置を持てる箱にする (happy-dom は scrollLeft を持たない)。 */
  function scrollable(
    el: HTMLElement,
    scrollWidth: number,
    clientWidth: number,
  ) {
    let left = 0;
    Object.defineProperty(el, "scrollWidth", {
      configurable: true,
      value: scrollWidth,
    });
    Object.defineProperty(el, "clientWidth", {
      configurable: true,
      value: clientWidth,
    });
    Object.defineProperty(el, "scrollLeft", {
      configurable: true,
      get: () => left,
      set: (value: number) => {
        left = value;
      },
    });
  }

  test("バーを送ると中身が、中身を送るとバーが同じ位置へ動く", async () => {
    const { attachStickyHScroll } = await importView();
    const shell = card(0);
    const code = document.createElement("div");
    code.className = "d2h-code-wrapper";
    scrollable(code, 1057, 510);
    shell.querySelector(".d2h-file-wrapper")?.append(code);
    attachStickyHScroll(shell);
    const lane = shell.querySelector<HTMLElement>(".gdp-hscroll-lane");
    if (!lane) throw new Error("lane was not attached");
    scrollable(lane, 1057, 510);

    lane.scrollLeft = 200;
    lane.dispatchEvent(new Event("scroll"));
    expect(code.scrollLeft).toBe(200);

    code.scrollLeft = 40;
    code.dispatchEvent(new Event("scroll"));
    expect(lane.scrollLeft).toBe(40);

    // 送れる範囲の外は端で止める
    lane.scrollLeft = 900;
    lane.dispatchEvent(new Event("scroll"));
    expect(code.scrollLeft).toBe(547);
  });

  test("送れない中身にはバーを出さない", async () => {
    const { attachStickyHScroll } = await importView();
    const shell = card(0);
    const wrapper = shell.querySelector(".d2h-file-wrapper");
    const code = document.createElement("div");
    code.className = "d2h-code-wrapper";
    Object.defineProperty(code, "scrollWidth", { value: 510 });
    Object.defineProperty(code, "clientWidth", { value: 510 });
    wrapper?.append(code);
    attachStickyHScroll(shell);
    expect(shell.querySelector<HTMLElement>(".gdp-hscroll")?.hidden).toBe(true);
  });

  // ブラウザは中に押せる部品 (隠れた行を出すボタン) のある箱には Tab で止まらず、
  // キーで横に送れなかった。送れる箱だけを止まり場所にする。
  test.each([
    { scrollWidth: 1057, clientWidth: 510, tabindex: "0" },
    { scrollWidth: 510, clientWidth: 510, tabindex: null },
  ])("中にボタンのある箱 (scrollWidth $scrollWidth / clientWidth $clientWidth) の tabindex は $tabindex", async ({
    scrollWidth,
    clientWidth,
    tabindex,
  }) => {
    const { attachStickyHScroll } = await importView();
    const shell = card(0);
    const code = document.createElement("div");
    code.className = "d2h-code-wrapper";
    const expand = document.createElement("button");
    expand.className = "gdp-expand-btn";
    code.append(expand);
    scrollable(code, scrollWidth, clientWidth);
    shell.querySelector(".d2h-file-wrapper")?.append(code);
    attachStickyHScroll(shell);
    expect(code.getAttribute("tabindex")).toBe(tabindex);
  });

  test("送れなくなった箱は止まり場所から外す", async () => {
    const { attachStickyHScroll } = await importView();
    const shell = card(0);
    const code = document.createElement("div");
    code.className = "d2h-code-wrapper";
    scrollable(code, 1057, 510);
    shell.querySelector(".d2h-file-wrapper")?.append(code);
    attachStickyHScroll(shell);
    expect(code.getAttribute("tabindex")).toBe("0");
    // 面が広がって収まった (描き直すたびに付け直す)。
    scrollable(code, 1057, 1057);
    attachStickyHScroll(shell);
    expect(code.hasAttribute("tabindex")).toBe(false);
  });
});
