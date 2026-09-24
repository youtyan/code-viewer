// 選択中のタブの印 (ui-surface.md の「タブの決まり」)。実物の style.css を happy-dom に
// 流し込み、計算値で見る (happy-dom は変数を解決する。::before は返さないので、
// フォーカスのある面の強調色の線は main-tabs-drag-css.test.ts の宣言の検査)。
//
// 守ること:
// - 選択中でない / もう一方の面の選択中 / フォーカスのある面の選択中の 3 つが、
//   ライトとダークの両方で見分けられる (1 面でもフォーカスのある面の印が付く)
// - 選んでも寸法が変わらない (タブの幅は中身で決まるので、名前の太さも含めて)
import { readFileSync } from "node:fs";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

beforeAll(() => {
  GlobalRegistrator.register();
  const style = document.createElement("style");
  style.textContent = readFileSync("web/style.css", "utf8");
  document.head.append(style);
});
afterAll(() => {
  GlobalRegistrator.unregister();
});

type State = "plain" | "otherSide" | "focused";

// main-tabs-view.ts の renderTab が付ける印 (focused はフォーカスのある面の選択中)。
const CLASSES: Record<State, string> = {
  plain: "main-tab",
  otherSide: "main-tab main-tab-active",
  focused: "main-tab main-tab-active main-tab-focused",
};

function renderTabs(theme: "light" | "dark", split: boolean): void {
  document.documentElement.dataset.theme = theme;
  document.body.className = split ? "main-split" : "";
  const tabs = (Object.keys(CLASSES) as State[])
    .map(
      (state) =>
        `<div class="${CLASSES[state]}" data-state="${state}"><span class="main-tab-icon"></span><span class="main-tab-name">sample.ts</span><button class="main-tab-close"></button></div>`,
    )
    .join("");
  document.body.innerHTML = `<div id="main-tabs"><div class="main-tabs-pane main-tabs-pane-focused"><div class="main-tabs-strip"><div class="main-tabs-list">${tabs}</div></div></div></div>`;
}

function parts(state: State) {
  const tab = document.querySelector<HTMLElement>(`[data-state="${state}"]`);
  const icon = tab?.querySelector(".main-tab-icon");
  const name = tab?.querySelector(".main-tab-name");
  if (!tab || !icon || !name) throw new Error(`missing tab ${state}`);
  return {
    tab: getComputedStyle(tab),
    icon: getComputedStyle(icon),
    name: getComputedStyle(name),
  };
}

/** 見た目の印 (面・文字・上の辺の線・絵・名前の太さ)。 */
function looks(state: State) {
  const { tab, icon, name } = parts(state);
  return {
    background: tab.backgroundColor,
    color: tab.color,
    edge: tab.boxShadow,
    icon: icon.color,
    stroke: name.getPropertyValue("-webkit-text-stroke"),
  };
}

const SIZE_PROPS = [
  "width",
  "height",
  "min-width",
  "max-width",
  "padding",
  "margin",
  "border-width",
  "font-size",
  "font-weight",
  "letter-spacing",
  "line-height",
  "gap",
] as const;

/** 寸法に効く値 (タブ・絵・名前)。 */
function sizes(state: State) {
  const { tab, icon, name } = parts(state);
  return Object.fromEntries(
    Object.entries({ tab, icon, name }).map(([part, style]) => [
      part,
      SIZE_PROPS.map((prop) => `${prop}:${style.getPropertyValue(prop)}`),
    ]),
  );
}

const CASES = [
  { name: "light, one side", theme: "light", split: false },
  { name: "light, split", theme: "light", split: true },
  { name: "dark, one side", theme: "dark", split: false },
  { name: "dark, split", theme: "dark", split: true },
] as const;

describe("the selected tab", () => {
  test.each(
    CASES,
  )("$name: plain, other side's and focused side's selected tabs look different", ({
    theme,
    split,
  }) => {
    renderTabs(theme, split);
    const plain = looks("plain");
    const otherSide = looks("otherSide");
    const focused = looks("focused");
    expect([
      plain.background !== otherSide.background,
      plain.color !== otherSide.color,
      plain.edge !== otherSide.edge,
      otherSide.icon !== focused.icon,
      otherSide.stroke !== focused.stroke,
    ]).toEqual([true, true, true, true, true]);
  });

  test.each(
    CASES,
  )("$name: the focused side's selected tab draws its icon in the accent colour", ({
    theme,
    split,
  }) => {
    renderTabs(theme, split);
    const accent = getComputedStyle(document.documentElement)
      .getPropertyValue("--color-accent")
      .trim();
    expect(looks("focused").icon).toBe(accent);
  });

  test.each(CASES)("$name: selecting a tab does not change its size", ({
    theme,
    split,
  }) => {
    renderTabs(theme, split);
    const plain = sizes("plain");
    expect([sizes("otherSide"), sizes("focused")]).toEqual([plain, plain]);
  });
});
