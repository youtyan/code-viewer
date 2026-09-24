// 表と表のような一覧の決まり (ui-surface.md の「表」、style.css の .ui-table)。
//
// 守ること:
// - 行の区切りの線 (--color-line-row) は、表が載るどの面 (窓の地・本文・沈んだ面・
//   浮く面・hover の面) にも 1.5:1 以上。ライトとダークの色違い 3 つの全部で
// - 本物の表 (.ui-table)・div の一覧の行 (.ui-table-row)・データストア・CSV・
//   Markdown の表の行の区切りが、その線で描かれている (部品ごとの古い薄い線が
//   勝っていない)
// - キーキャップはどれも同じ形 (縁の線がその線、文字は本文の色)
// - 行の多い表は 1 行おきに面が付く
import { readFileSync } from "node:fs";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { themeVariants } from "./_color-themes";
import {
  baseRules,
  cascadedDeclarations,
  loadStyleSheet,
  resolveVar,
} from "./_css-fixture";

const rules = baseRules(loadStyleSheet());

// 全部のテーマ × 明暗 (`default light`・`forest dark` …)。
const PALETTES = Object.fromEntries(
  themeVariants(rules).map((variant) => [variant.name, variant.vars]),
);
type Palette = string;

/** その組で効く名前の層の値 (後の塊が前を上書きする)。 */
function tokens(palette: Palette): Map<string, string> {
  const vars = PALETTES[palette];
  if (!vars) throw new Error(`table rules test: no theme ${palette}`);
  return vars;
}

function color(palette: Palette, name: string): string {
  const vars = tokens(palette);
  return resolveVar(vars.get(name) ?? `var(${name})`, vars);
}

/** WCAG の相対輝度。#rrggbb だけを読む。 */
function luminance(hex: string): number {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!match) throw new Error(`not a #rrggbb colour: ${hex}`);
  const [r, g, b] = match
    .slice(1)
    .map((part) => Number.parseInt(part, 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}

function contrast(a: string, b: string): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((high ?? 0) + 0.05) / ((low ?? 0) + 0.05);
}

describe("the row line of tables", () => {
  const CASES = Object.keys(PALETTES).flatMap((palette) =>
    [
      "--color-ground",
      "--color-doc",
      "--color-inset",
      "--color-overlay",
      "--color-raised",
    ].map((surface) => [palette, surface] as const),
  );
  test.each(CASES)("in %s it stands out 1.5:1 on %s", (palette, surface) => {
    const ratio = contrast(
      color(palette, "--color-line-row"),
      color(palette, surface),
    );
    expect(ratio).toBeGreaterThanOrEqual(1.5);
  });
});

// メニューの区切りも同じ線 (浮く面の上で 1.5:1 以上は上の表で見ている)。
// --color-line はダークで浮く面とほぼ同じ色 (#28242f と #28232f) で、区切りが消えていた。
test("the separator of menus is drawn with the row line", () => {
  expect(
    cascadedDeclarations(rules, (s) => s === ".gdp-context-menu-sep").get(
      "border-top",
    ),
  ).toBe("1px solid var(--color-line-row)");
});

describe("tables drawn with the rule", () => {
  beforeAll(() => {
    GlobalRegistrator.register();
    const style = document.createElement("style");
    style.textContent = readFileSync("web/style.css", "utf8");
    document.head.append(style);
  });
  afterAll(() => {
    GlobalRegistrator.unregister();
  });

  function computed(html: string, selector: string): CSSStyleDeclaration {
    document.body.innerHTML = html;
    const element = document.querySelector(selector);
    if (!element) throw new Error(`missing ${selector}`);
    return getComputedStyle(element);
  }

  const TABLE = `<table class="ui-table ui-table-striped"><thead><tr><th id="head">Key</th></tr></thead>
    <tbody><tr><td id="odd">a</td></tr><tr><td id="even">b</td></tr></tbody></table>`;

  // 部品の見た目の古い規則 (薄い線・線なし) より、表の決まりの線が勝つこと。
  test.each([
    { name: "a help table cell", html: TABLE, selector: "#odd" },
    {
      name: "an accounts row",
      html: `<div class="agent-accounts-row ui-table-row" id="x"></div>`,
      selector: "#x",
    },
    {
      name: "a usage row",
      html: `<div class="agent-accounts-usage-row ui-table-row" id="x"></div>`,
      selector: "#x",
    },
    {
      name: "an agent hooks row",
      html: `<div class="agent-hooks-row ui-table-row" id="x"></div>`,
      selector: "#x",
    },
    {
      name: "a shortcut settings row",
      html: `<div class="shortcut-settings"><div class="shortcut-row ui-table-row" id="x"></div></div>`,
      selector: "#x",
    },
    {
      name: "a doctor row",
      html: `<div class="doctor-row ui-table-row" id="x"></div>`,
      selector: "#x",
    },
    {
      name: "a datastore grid row",
      html: `<div class="db-root"><div class="db-grid-row" id="x"></div></div>`,
      selector: "#x",
    },
    {
      name: "a datastore query result cell",
      html: `<div class="db-root"><table class="db-query-table"><tbody><tr><td id="x">1</td></tr></tbody></table></div>`,
      selector: "#x",
    },
    {
      name: "a datastore list row",
      html: `<div class="db-root"><div class="db-snapshot-table-row" id="x"></div><div class="db-snapshot-table-row"></div></div>`,
      selector: "#x",
    },
    {
      name: "a CSV cell",
      html: `<table class="gdp-csv-table"><tbody><tr><td id="x">1</td></tr><tr><td>2</td></tr></tbody></table>`,
      selector: "#x",
    },
    {
      name: "a Markdown table cell",
      html: `<div class="gdp-markdown-preview"><table><tbody><tr><td id="x">1</td></tr></tbody></table></div>`,
      selector: "#x",
    },
  ])("$name is separated by the row line (dark)", ({ html, selector }) => {
    document.documentElement.dataset.theme = "dark";
    const style = computed(html, selector);
    expect([style.borderBottomStyle, style.borderBottomColor]).toEqual([
      "solid",
      color("default dark", "--color-line-row"),
    ]);
  });

  test("the head row of a table is smaller, bold and in the note colour, with a heavier line", () => {
    document.documentElement.dataset.theme = "light";
    const head = computed(TABLE, "#head");
    const cell = getComputedStyle(document.querySelector("#odd") as Element);
    expect({
      color: head.color,
      weight: head.fontWeight,
      line: head.borderBottomWidth,
      cellLine: cell.borderBottomWidth,
    }).toEqual({
      color: color("default light", "--color-text-2"),
      weight: "600",
      line: "2px",
      cellLine: "1px",
    });
  });

  // happy-dom は color-mix() の背景を返さないので、縞は宣言をカスケードで読む。
  test("a striped table shades every other row with the row face", () => {
    const even = cascadedDeclarations(
      rules,
      (selector) =>
        selector === ".ui-table-striped > tbody > tr:nth-child(even) > *",
    );
    const odd = cascadedDeclarations(
      rules,
      (selector) =>
        selector === ".ui-table-striped > tbody > tr:nth-child(odd) > *",
    );
    expect([
      even.get("background"),
      odd.get("background"),
      tokens("default light").get("--color-row-alt"),
    ]).toEqual([
      "var(--color-row-alt)",
      undefined,
      "color-mix(in srgb, var(--color-raised) 45%, transparent)",
    ]);
  });

  test.each([
    ["the help key", `<kbd class="gdp-help-key" id="x">t</kbd>`],
    ["the palette key", `<span class="gdp-palette-row-key" id="x">t</span>`],
    [
      "the settings key",
      `<div class="shortcut-settings"><kbd id="x">t</kbd></div>`,
    ],
  ])("%s is a key cap edged with the row line", (_name, html) => {
    document.documentElement.dataset.theme = "dark";
    const style = computed(html, "#x");
    const line = color("default dark", "--color-line-row");
    expect({
      edged: style.boxShadow.includes(line),
      text: style.color,
    }).toEqual({ edged: true, text: color("default dark", "--color-text") });
  });
});
