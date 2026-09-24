// 全部のテーマ × 明暗のどれでも、文字と部品が地からくっきり読める (WCAG 2.x の比)。
//
// 差分・コード (diff-code-contrast)・フォーカスの輪 (focus-ring-contrast)・表の区切り
// (table-rules-css)・カードの面 (agents-list-look) の下限は、それぞれのテストが同じ
// 全部の組 (_color-themes.ts) で確かめる。ここはそれ以外の文字の段階・強調色・状態の色・
// ターミナル、構文の種類どうしの見分け、そして「テーマの塊がそろっている」こと。
// 値そのものは固定しない (下限を保てば色を変えてよい)。

import { describe, expect, test } from "vitest";
import { COLOR_THEMES } from "../core/color-themes";
import { contrastRatio, hueGap, oklabDistance } from "./_color-contrast";
import { themeVariants } from "./_color-themes";
import {
  baseRules,
  cascadedDeclarations,
  loadStyleSheet,
  resolveVar,
} from "./_css-fixture";

const rules = baseRules(loadStyleSheet());
const VARIANTS = themeVariants(rules);
const token = (name: string, vars: Map<string, string>) =>
  resolveVar(`var(${name})`, vars);

// 文字が乗る主な面 (前面のタブは、ライトは本文の面・ダークは hover の面)。
const SURFACES = [
  "--color-ground",
  "--color-nav",
  "--color-tree",
  "--color-doc",
  "--color-inset",
  "--color-overlay",
  "--color-code",
  "--color-tab-active",
];
const STATES = [
  "--color-waiting",
  "--color-working",
  "--color-done",
  "--color-failed",
  "--color-idle",
];

const PAIRS = [
  ...SURFACES.map((bg) => ({ fg: "--color-text", bg, min: 7 })),
  { fg: "--color-text", bg: "--color-raised", min: 4.5 },
  { fg: "--color-text", bg: "--color-select", min: 4.5 },
  ...[...SURFACES, "--color-raised"].map((bg) => ({
    fg: "--color-text-2",
    bg,
    min: 4.5,
  })),
  { fg: "--color-text-2", bg: "--color-select", min: 3 },
  // 薄い補足 (件数・時刻など) は、どの面でも 3:1 以上。
  ...[...SURFACES, "--color-raised", "--color-select"].map((bg) => ({
    fg: "--color-text-3",
    bg,
    min: 3,
  })),
  { fg: "--color-on-accent", bg: "--color-accent", min: 4.5 },
  { fg: "--color-on-accent", bg: "--color-accent-strong", min: 4.5 },
  // 強調色の文字 (リンク・選んでいる印)。
  ...["--color-doc", "--color-ground", "--color-overlay"].map((bg) => ({
    fg: "--color-accent",
    bg,
    min: 4.5,
  })),
  // 状態の色は、エージェントのカード (本文の面) で 4.5:1、地とサイドバーで 3:1。
  ...STATES.map((fg) => ({ fg, bg: "--color-doc", min: 4.5 })),
  ...STATES.flatMap((fg) =>
    ["--color-ground", "--color-nav", "--color-tree"].map((bg) => ({
      fg,
      bg,
      min: 3,
    })),
  ),
  { fg: "--color-term-text", bg: "--color-term", min: 7 },
  { fg: "--color-term-white", bg: "--color-term", min: 4.5 },
  // 端末の ANSI の赤・緑・黄・紫 (terminal-screen.ts の terminalTheme が状態の色を
  // 渡す)。足りない分は xterm が TERMINAL_MINIMUM_CONTRAST_RATIO (4.5) まで上げる
  // が、上げる量が小さく済むよう、配色そのもので 4:1 以上。カーソルは 3:1。
  // ターミナルの明暗が「常にダーク」なら、ライトの画面でも端末はダークの組を使う
  // (terminal-tone-css.test.ts)。
  ...[
    "--color-failed",
    "--color-working",
    "--color-waiting",
    "--color-done",
  ].map((fg) => ({ fg, bg: "--color-term", min: 4 })),
  { fg: "--color-accent-strong", bg: "--color-term", min: 3 },
  { fg: "--graph-branch", bg: "--color-doc", min: 3 },
  // 選んでいる行は本文の面から見分けられる。
  { fg: "--color-select", bg: "--color-doc", min: 1.15 },
];

describe("text and marks read on every theme", () => {
  test.each(
    VARIANTS.flatMap((variant) =>
      PAIRS.map((pair) => ({ ...variant, ...pair })),
    ),
  )("$name: $fg on $bg is $min:1 or more", ({ fg, bg, min, vars }) => {
    expect(
      contrastRatio(token(fg, vars), token(bg, vars)),
    ).toBeGreaterThanOrEqual(min);
  });
});

// 構文の種類 (キーワード・文字列・型と定数・関数名) は色相で見分けられる
// (OKLCH の色相で 40 度以上離れる)。明るさだけの違いは見分けにくい。
describe("the syntax kinds differ in hue", () => {
  const KINDS = [
    "--syntax-keyword",
    "--syntax-string",
    "--syntax-type",
    "--syntax-function",
  ];
  test.each(
    VARIANTS.flatMap((variant) =>
      KINDS.flatMap((a, i) =>
        KINDS.slice(i + 1).map((b) => ({ ...variant, a, b })),
      ),
    ),
  )("$name: $a and $b are 40 degrees apart or more", ({ a, b, vars }) => {
    expect(hueGap(token(a, vars), token(b, vars))).toBeGreaterThanOrEqual(40);
  });
});

// 追加・削除の行の面は、コードの面と色で見分けられる (明るさの差は小さいので OKLab
// の距離で見る)。0.025 は既定のライト (0.028) が下回らない所。
describe("added and removed lines stand apart from the code face", () => {
  test.each(
    VARIANTS.flatMap((variant) =>
      ["--diff-add-bg", "--diff-del-bg"].map((line) => ({ ...variant, line })),
    ),
  )("$name: $line", ({ line, vars }) => {
    expect(
      oklabDistance(token(line, vars), token("--color-code", vars)),
    ).toBeGreaterThanOrEqual(0.025);
  });
});

// テーマの塊は、既定が 16 進で持つ色の名前を全部書く (一部だけ書くと、残りが既定の
// 色のまま混ざる)。既定のダークの塊も同じ名前を全部持つ (設定の見本の箱は
// [data-theme] だけで既定を描くので、足りない名前は外側のテーマの値が漏れる)。
describe("every theme block writes every color token", () => {
  const block = (selector: string) =>
    cascadedDeclarations(rules, (s) => s === selector);
  const literal = (value: string) =>
    /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(value) || /^rgba?\(/.test(value);
  const colorNames = (vars: Map<string, string>) =>
    [...vars]
      .filter(
        ([name, value]) =>
          /^--(color|syntax|diff|graph)-/.test(name) && literal(value),
      )
      .map(([name]) => name);
  const root = block(":root");
  const dark = block('[data-theme="dark"]');
  const owned = [...new Set([...colorNames(root), ...colorNames(dark)])].sort();

  test("the default dark block writes them all", () => {
    expect(owned.filter((name) => !dark.has(name))).toEqual([]);
  });

  test.each(
    COLOR_THEMES.filter((theme) => theme !== "default").flatMap((theme) => [
      { theme, selector: `[data-color-theme="${theme}"]` },
      { theme, selector: `[data-color-theme="${theme}"][data-theme="dark"]` },
    ]),
  )("$selector", ({ selector }) => {
    expect([...block(selector).keys()].sort()).toEqual(owned);
  });
});
