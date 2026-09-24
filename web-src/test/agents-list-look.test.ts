// 左のサイドバーの「プロジェクト → エージェント」は 2 段に見える: プロジェクトは
// 大きく太い見出しの行 (面なし)、その下のエージェントは字下げした 2 行組の行。
// プロジェクトの間は行の間より広く空ける。全体ボードの見出しと行も同じ形。以前は
// 見出しと行が同じ 1 行組・同じ太さで見分けが付かなかった。
// 行の面はダークだけ (地より一段明るい面)。ライトは地のまま行の間を線で区切る
// (白い面の箱がベージュの地に並んで重たかった)。
//
// 値そのものは固定しない (密度の表や色を変えても、この関係を保てば通る)。

import { describe, expect, test } from "vitest";
import { contrastRatio } from "./_color-contrast";
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
// 全部のテーマ × 明暗 (body の寸法の名前は regular から)。
const variants = themeVariants(rules).map((variant) => ({
  name: variant.name,
  mode: variant.mode,
  vars: new Map([...regular, ...variant.vars]),
}));
const lightThemes = variants.filter((variant) => variant.mode === "light");
const darkThemes = variants.filter((variant) => variant.mode === "dark");

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

// 左のサイドバーの頭の検索の欄は枠のある箱なので、サイドバーの上端からも左右と
// 同じ内側の余白 (--pad-face) を取る (上下 3px で窓の上端に付いて見えた)。下は
// 見出しの行が続くので詰め (--space-1)。頭の行はタブ列と同じ高さのまま (下端を
// そろえる) で、検索の欄は残りの高さいっぱい。
test.each([
  { density: "compact", top: 7, side: 7, bottom: 3.5 },
  { density: "regular", top: 8, side: 8, bottom: 4 },
  { density: "large", top: 9, side: 9, bottom: 4.5 },
  { density: "xlarge", top: 10, side: 10, bottom: 5 },
] as const)("density $density: the search field is inset $top px from the top and $side px from the sides", ({
  density,
  top,
  side,
  bottom,
}) => {
  const vars = densities[density];
  const [padTop, padSide, padBottom] = declared(".nav-head", "padding")
    .split(/\s+/)
    .map((value) => px(resolveVar(value, vars)));
  expect({
    top: padTop,
    side: padSide,
    bottom: padBottom,
    headHeight: declared(".nav-head", "height"),
    searchHeight: block(".nav-search").get("height") ?? null,
    searchStretch: declared(".nav-search", "align-self"),
  }).toEqual({
    top,
    side,
    bottom,
    headHeight: "var(--main-tabs-h)",
    searchHeight: null,
    searchStretch: "stretch",
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

// ダークは変えていない: 行の面は本文の面 (--color-doc。以前 .nav-agent と
// .agents-row が直に読んでいた色) で、線は引かない。
test.each(
  darkThemes,
)("$name: a row sits on a lighter surface than the ground under it", ({
  vars,
}) => {
  const color = (value: string) => luminance(resolveVar(value, vars));
  const face = declared(".agent-card", "background-color");
  expect({
    face: resolveVar(face, vars),
    rule: resolveVar("var(--color-agent-row-rule)", vars),
    sidebar: color(face) > color(declared("#app-nav", "background")),
    board: color(face) > color(declared(".agents-page", "background")),
  }).toEqual({
    face: resolveVar("var(--color-doc)", vars),
    rule: "transparent",
    sidebar: true,
    board: true,
  });
});

// ライトは行ごとの面が無く、行の間の線 (表の区切りと同じ --color-line-row) が
// サイドバーの地・全体ボードの地・hover の面のどれにも 1.5:1 以上で見える。
test.each(
  lightThemes,
)("$name: rows have no face of their own and a visible rule between them", ({
  vars,
}) => {
  const rule = resolveVar("var(--color-agent-row-rule)", vars);
  const on = (value: string) =>
    contrastRatio(rule, resolveVar(value, vars)) >= 1.5;
  expect({
    face: resolveVar(declared(".agent-card", "background-color"), vars),
    rule: declared(".agent-card", "background-image").replace(/\s+/g, ""),
    ruleSize: declared(".agent-card", "background-size"),
    ruleAt: declared(".agent-card", "background-position"),
    sidebar: on(declared("#app-nav", "background")),
    board: on(declared(".agents-page", "background")),
    hover: on("var(--color-raised)"),
  }).toEqual({
    face: "transparent",
    rule: "linear-gradient(var(--color-agent-row-rule),var(--color-agent-row-rule))",
    ruleSize: "100% 1px",
    ruleAt: "bottom",
    sidebar: true,
    board: true,
    hover: true,
  });
});

// 箱の形は明暗で同じ: 枠線は無く、線は行の間だけ (最後の行の下には引かない)。
// hover と選択中は面の色に替わる (background ごと。線もその行だけ消える)。
test.each([
  { selector: ".nav-agent", property: "border", expected: "0" },
  { selector: ".agents-row", property: "border", expected: "0" },
  {
    selector: ".agent-card:last-child",
    property: "background-image",
    expected: "none",
  },
  {
    selector: ".nav-agent:hover",
    property: "background",
    expected: "var(--color-raised)",
  },
  {
    selector: ".nav-agent.active",
    property: "background",
    expected: "var(--color-select)",
  },
  {
    selector: ".agents-row:hover",
    property: "background",
    expected: "var(--color-raised)",
  },
  {
    selector: ".agents-row.active",
    property: "background",
    expected: "var(--color-select)",
  },
])("$selector has $property: $expected", ({ selector, property, expected }) => {
  expect(declared(selector, property)).toBe(expected);
});

// 札は小さな字なので、その地の上で 4.5:1 以上 (WCAG 1.4.3)。ダークは札が透けて
// 行の面の上 (以前のまま)、ライトは行に面が無いので札が自分の地 (本文の面) を持つ
// (サイドバーの地の上では入力待ちの色が 4.3:1 前後だった)。
test.each(
  variants.flatMap(({ name, mode, vars }) =>
    [".agent-card-badge-waiting", ".agent-card-badge-finished"].map(
      (badge) => ({
        name,
        badge,
        vars,
        under:
          mode === "dark"
            ? declared(".agent-card", "background-color")
            : declared(".agent-card-badge", "background"),
      }),
    ),
  ),
)("$name: $badge reads on the surface under it", ({ badge, vars, under }) => {
  const [fg, bg] = [
    luminance(resolveVar(declared(badge, "color"), vars)),
    luminance(resolveVar(under, vars)),
  ];
  const ratio = (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
  expect(ratio).toBeGreaterThanOrEqual(4.5);
});

test.each([
  ...lightThemes.map(({ name, vars }) => ({
    name,
    vars,
    expected: resolveVar("var(--color-doc)", vars),
  })),
  ...darkThemes.map(({ name, vars }) => ({
    name,
    vars,
    expected: "transparent",
  })),
])("$name: a badge's own ground is $expected", ({ vars, expected }) => {
  expect(resolveVar(declared(".agent-card-badge", "background"), vars)).toBe(
    expected,
  );
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
