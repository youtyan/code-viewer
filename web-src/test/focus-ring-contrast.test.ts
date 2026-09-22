// キーで届いた部品の輪 (--focus-ring) は、どのテーマのどの面の上でも見える。
// 見えるの基準は WCAG 2.2 の 1.4.11 (部品の見た目の色の差 3:1)。
//
// 輪を 7 割に薄めていた頃は、ライトの地・hover・選んでいる行の上で 2.6〜3.0 しか
// なく、見えにくかった。値そのものは固定しない (色を変えても 3:1 を保てば通る)。

import { describe, expect, test } from "vitest";
import {
  baseRules,
  cascadedDeclarations,
  loadStyleSheet,
  resolveVar,
} from "./_css-fixture";

type Rgba = [number, number, number, number];

/** #rgb / #rrggbb と、透明と混ぜた color-mix (輪を薄める書き方) だけを読む。 */
function parseColor(value: string): Rgba {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  if (hex) {
    const digits =
      hex[1].length === 3 ? [...hex[1]].map((d) => d + d).join("") : hex[1];
    return [
      Number.parseInt(digits.slice(0, 2), 16),
      Number.parseInt(digits.slice(2, 4), 16),
      Number.parseInt(digits.slice(4, 6), 16),
      1,
    ];
  }
  const mix =
    /^color-mix\(in srgb,\s*(#[0-9a-f]+)\s+([\d.]+)%,\s*transparent\)$/i.exec(
      value.trim(),
    );
  if (mix) {
    const [r, g, b] = parseColor(mix[1]);
    return [r, g, b, Number(mix[2]) / 100];
  }
  throw new Error(`focus ring test: cannot read the color ${value}`);
}

function over(fg: Rgba, bg: Rgba): Rgba {
  const a = fg[3];
  return [
    fg[0] * a + bg[0] * (1 - a),
    fg[1] * a + bg[1] * (1 - a),
    fg[2] * a + bg[2] * (1 - a),
    1,
  ];
}

function luminance([r, g, b]: Rgba): number {
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a: Rgba, b: Rgba): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const rules = baseRules(loadStyleSheet());
const block = (selector: string) =>
  cascadedDeclarations(rules, (s) => s === selector);
// テーマは同じ名前の値を差し替えるだけ (ui-surface.md)。後ろほど強い。
const light = block(":root");
const dark = new Map([...light, ...block('[data-theme="dark"]')]);
const themes = {
  light,
  dark,
  "dark graphite": new Map([
    ...dark,
    ...block('[data-theme="dark"][data-palette="graphite"]'),
  ]),
  "dark warm": new Map([
    ...dark,
    ...block('[data-theme="dark"][data-palette="warm"]'),
  ]),
};
// 輪が乗る面: 窓の地・サイドバー・木・本文・コード・hover・選んでいる行・前面のタブ。
const SURFACES = [
  "--color-ground",
  "--color-nav",
  "--color-tree",
  "--color-doc",
  "--color-code",
  "--color-raised",
  "--color-select",
  "--color-tab-active",
];

function ringColor(vars: Map<string, string>): string {
  const ring = resolveVar("var(--focus-ring)", vars);
  const color = /^0 0 0 \d+px (.+)$/.exec(ring);
  if (!color) throw new Error(`focus ring test: unexpected ring ${ring}`);
  return color[1];
}

describe("the focus ring is visible on every surface", () => {
  test.each(
    Object.entries(themes).flatMap(([theme, vars]) =>
      SURFACES.map((surface) => ({ theme, surface, vars })),
    ),
  )("$theme on $surface: 3:1 or more", ({ surface, vars }) => {
    const bg = parseColor(resolveVar(`var(${surface})`, vars));
    const ring = over(parseColor(ringColor(vars)), bg);
    expect(contrast(ring, bg)).toBeGreaterThanOrEqual(3);
  });
});

// キーで届くのにブラウザの既定の輪 (色も太さもほかと違う) だった部品も、同じ輪を描く。
describe("controls that had the browser's default ring draw the shared ring", () => {
  test.each([
    ".main-tabs-action",
    "#sidebar-toggle",
    ".nav-note-link",
    ".gdp-file-breadcrumb-part",
    ".gdp-file-breadcrumb-ellipsis",
  ])("%s", (control) => {
    const focused = cascadedDeclarations(rules, (s) =>
      s
        .split(",")
        .map((part) => part.trim())
        .includes(`${control}:focus-visible`),
    );
    expect([
      focused.get("outline"),
      resolveVar(focused.get("box-shadow") ?? "", light),
    ]).toEqual(["none", resolveVar("var(--focus-ring)", light)]);
  });
});
