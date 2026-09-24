// 左のサイドバーの「プロジェクト → エージェント」は 2 段に見える: プロジェクトは
// 大きく太い見出しの行 (面なし)、その下のエージェントは字下げした 2 行組のカード
// (地より一段明るい面)。プロジェクトの間はカードの間より広く空ける。全体ボードの
// 見出しとカードも同じ形。以前は見出しと行が同じ 1 行組・同じ太さで見分けが
// 付かなかった。
//
// 値そのものは固定しない (密度の表や色を変えても、この関係を保てば通る)。

import { describe, expect, test } from "vitest";
import { themeVariants } from "./_color-themes";
import {
  baseRules,
  cascadedDeclarations,
  loadStyleSheet,
  resolveVar,
} from "./_css-fixture";

const rules = baseRules(loadStyleSheet());
const block = (selector: string) =>
  cascadedDeclarations(rules, (s) => s === selector);
const regular = new Map([...block(":root"), ...block("body")]);
const densities = {
  compact: new Map([
    ...regular,
    ...block('body[data-sidebar-font-size="compact"]'),
  ]),
  regular,
  large: new Map([
    ...regular,
    ...block('body[data-sidebar-font-size="large"]'),
  ]),
  xlarge: new Map([
    ...regular,
    ...block('body[data-sidebar-font-size="xlarge"]'),
  ]),
};
// 10 テーマ × 明暗の全部 (body の寸法の名前は regular から)。
const themes = Object.fromEntries(
  themeVariants(rules).map((variant) => [
    variant.name,
    new Map([...regular, ...variant.vars]),
  ]),
);

/**
 * var() を解いた後の長さ (`12px`・`calc(28px + 4px / 2)` など、px と数と四則だけ)
 * を px の数にする。
 */
function px(value: string): number {
  const expression = value.replace(/calc\(/g, "(").replace(/([\d.]+)px/g, "$1");
  if (!/^[\d.\s+\-*/()]+$/.test(expression))
    throw new Error(`agents list look: cannot read ${value}`);
  return Number(new Function(`return (${expression});`)());
}

function luminance(hex: string): number {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) throw new Error(`agents list look: cannot read ${hex}`);
  const [r, g, b] = [0, 2, 4].map((i) => {
    const s = Number.parseInt(match[1].slice(i, i + 2), 16) / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const declared = (selector: string, property: string) => {
  const value = block(selector).get(property);
  if (!value)
    throw new Error(`agents list look: ${selector} has no ${property}`);
  return value;
};

describe.each(Object.entries(densities))("density %s", (_name, vars) => {
  const size = (selector: string) =>
    px(resolveVar(declared(selector, "font-size"), vars));

  test("a project heading is larger than an agent's name, in the sidebar and on the board", () => {
    expect({
      sidebar: size(".nav-project-toggle") > size(".agent-card-name"),
      board: size(".agents-project-name") > size(".agent-card-name"),
    }).toEqual({ sidebar: true, board: true });
  });

  test("a project heading's row fits its text (1.5 lines of the heading size)", () => {
    const height = px(
      resolveVar(declared(".nav-project-head", "height"), vars),
    );
    expect(height).toBeGreaterThanOrEqual(size(".nav-project-toggle") * 1.5);
  });

  test("projects are spaced wider than the cards under them", () => {
    const between = px(
      resolveVar(declared(".nav-project + .nav-project", "margin-top"), vars),
    );
    const cards = px(resolveVar(declared(".nav-agents", "gap"), vars));
    expect(between).toBeGreaterThan(cards);
  });
});

test("a card is two lines; at the most compact density the sidebar folds it to one", () => {
  const rows = (areas: string) => areas.match(/"[^"]*"/g)?.length ?? 0;
  expect({
    card: rows(declared(".agent-card", "grid-template-areas")),
    compact: rows(
      declared(
        'body[data-sidebar-font-size="compact"] .nav-agent',
        "grid-template-areas",
      ),
    ),
  }).toEqual({ card: 2, compact: 1 });
});

test.each(
  Object.entries(themes),
)("%s: a card sits on a lighter surface than the ground under it", (_name, vars) => {
  const color = (value: string) => luminance(resolveVar(value, vars));
  expect({
    sidebar:
      color(declared(".nav-agent", "background")) >
      color(declared("#app-nav", "background")),
    board:
      color(declared(".agents-row", "background")) >
      color(declared(".agents-page", "background")),
  }).toEqual({ sidebar: true, board: true });
});

// 札は小さな字なので、カードの面の上で 4.5:1 以上 (WCAG 1.4.3)。
test.each(
  Object.entries(themes).flatMap(([theme, vars]) =>
    [".agent-card-badge-waiting", ".agent-card-badge-finished"].map(
      (badge) => ({ theme, badge, vars }),
    ),
  ),
)("$theme: $badge reads on the card", ({ badge, vars }) => {
  const [fg, bg] = [
    luminance(resolveVar(declared(badge, "color"), vars)),
    luminance(resolveVar(declared(".nav-agent", "background"), vars)),
  ];
  const ratio = (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
  expect(ratio).toBeGreaterThanOrEqual(4.5);
});

// 見出しの行の高さは密度で変わる (以前は --ui-row-h の 30px 固定で、特大では字だけが
// 大きくなって詰まった)。
test("a project heading's row grows with the density", () => {
  const heights = Object.values(densities).map((vars) =>
    px(resolveVar(declared(".nav-project-head", "height"), vars)),
  );
  expect(heights.every((height, i) => i === 0 || height > heights[i - 1])).toBe(
    true,
  );
});
