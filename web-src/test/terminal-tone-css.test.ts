// ターミナルの明暗 (設定 → 表示。core/color-themes.ts の TerminalTone)。
//
// 「常にダーク」(html[data-terminal-tone="dark"]) のとき、ターミナルの面
// ([data-terminal-surface]) の中は、画面の明暗にかかわらずそのテーマのダークと
// 同じ色で描く。「画面に合わせる」(属性なし) では面に何も当たらない。
//
// 実物の style.css のカスケードを、html と面の 2 段で解いて確かめる。面が宣言し
// 直さない名前は html で解いた値を継ぐ (custom property は宣言した箱で var() を
// 解く) ので、var() で作る名前 (--focus-ring・--fg-muted など) を面で作り直して
// いなければ、ここでライトの色が残って落ちる。
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { COLOR_THEMES, type ColorTheme } from "../core/color-themes";
import { type ThemeMode, themeVariants } from "./_color-themes";
import {
  baseRules,
  type CssRule,
  cascadedDeclarations,
  loadStyleSheet,
  parseCss,
  resolveVar,
} from "./_css-fixture";

const SURFACE = "[data-terminal-surface]";
const TONE_DARK = '[data-terminal-tone="dark"]';

/** その組の html に付く属性のもとで、面に当たりうるセレクタ。 */
function surfaceSelectors(theme: ColorTheme): string[] {
  return [
    `${TONE_DARK} ${SURFACE}`,
    ...(theme === "default"
      ? []
      : [`[data-color-theme="${theme}"]${TONE_DARK} ${SURFACE}`]),
  ];
}

/** value の var() が vars の中で最後まで解けるか (解けない名前を含む値は比べない)。 */
function resolvable(
  value: string,
  vars: Map<string, string>,
  seen = new Set<string>(),
): boolean {
  for (const [, name] of value.matchAll(/var\((--[\w-]+)\)/g)) {
    if (seen.has(name)) return false;
    const next = vars.get(name);
    if (next === undefined || !resolvable(next, vars, new Set([...seen, name])))
      return false;
  }
  return true;
}

/** 名前ごとに、解ききった値 (解けない名前は除く)。 */
function resolvedAll(vars: Map<string, string>): Map<string, string> {
  return new Map(
    [...vars]
      .filter(([, value]) => resolvable(value, vars))
      .map(([name, value]) => [name, resolveVar(value, vars)]),
  );
}

/**
 * ターミナルの明暗がダークのときの、面の中の値。面が宣言しない名前は html で
 * 解いた値を継ぎ、宣言した名前は面の中の値で解く。
 */
function surfaceResolved(
  rules: CssRule[],
  theme: ColorTheme,
  page: Map<string, string>,
): Map<string, string> {
  const selectors = surfaceSelectors(theme);
  const own = cascadedDeclarations(rules, (selector) =>
    selectors.includes(selector),
  );
  const inside = new Map(resolvedAll(page));
  for (const [name, value] of own) inside.set(name, value);
  return resolvedAll(inside);
}

function variantsOf(rules: CssRule[]) {
  const all = themeVariants(rules);
  return (theme: ColorTheme, mode: ThemeMode) => {
    const found = all.find(
      (variant) => variant.theme === theme && variant.mode === mode,
    );
    if (!found) throw new Error(`no theme variant for ${theme} ${mode}`);
    return found.vars;
  };
}

/** 面の中の値が、そのテーマのダークの値と食い違う名前。 */
function mismatches(
  rules: CssRule[],
  theme: ColorTheme,
  mode: ThemeMode,
): string[] {
  const variant = variantsOf(rules);
  const dark = resolvedAll(variant(theme, "dark"));
  const inside = surfaceResolved(rules, theme, variant(theme, mode));
  return [...dark]
    .filter(([name, value]) => inside.get(name) !== value)
    .map(([name, value]) => `${name}: ${inside.get(name)} (dark ${value})`);
}

const RULES = baseRules(loadStyleSheet());

describe("always dark: the terminal surface takes the theme's dark colors", () => {
  test.each(
    COLOR_THEMES.flatMap((theme) =>
      (["light", "dark"] as const).map((mode) => ({ theme, mode })),
    ),
  )("$theme on a $mode page", ({ theme, mode }) => {
    expect(mismatches(RULES, theme, mode)).toEqual([]);
  });

  // 見る名前が端末の色を含んでいること (比べる対象が空で通っていないこと)。
  test("the compared names include the terminal and derived colors", () => {
    const dark = resolvedAll(variantsOf(RULES)("default", "dark"));
    expect(
      [
        "--color-term",
        "--color-term-text",
        "--color-term-white",
        "--color-failed",
        "--fg-muted",
        "--border",
        "--focus-ring",
        "--glow-select",
      ].filter((name) => !dark.has(name)),
    ).toEqual([]);
  });
});

// 「画面に合わせる」は html に属性を付けない。面に当たる規則は、どれも
// html[data-terminal-tone="dark"] の下でだけ当たる形でなければならない。
test("match leaves the surface alone: every surface rule needs the dark tone", () => {
  const loose = baseRules(loadStyleSheet())
    .filter((rule) => rule.selector.includes(SURFACE))
    .filter((rule) => !rule.selector.includes(`${TONE_DARK} ${SURFACE}`))
    .map((rule) => rule.selector);
  expect(loose).toEqual([]);
});

// 検査が食い違いを見分けること。面のセレクタを 1 か所外した写しで落ちる。
describe("the check tells a missing surface selector", () => {
  test.each([
    {
      name: "a theme's dark block",
      theme: "github" as const,
      remove: `[data-color-theme="github"][data-theme="dark"],\n[data-color-theme="github"]${TONE_DARK} ${SURFACE} {`,
      keep: `[data-color-theme="github"][data-theme="dark"] {`,
    },
    {
      name: "the :root block (values made with var())",
      theme: "default" as const,
      remove: `:root,\n[data-theme="light"],\n${TONE_DARK} ${SURFACE} {`,
      keep: `:root,\n[data-theme="light"] {`,
    },
  ])("$name", ({ theme, remove, keep }) => {
    const css = readStyleSource();
    expect(css.includes(remove)).toBe(true);
    const broken = baseRules(parseCss(css.replace(remove, keep)));
    expect({
      real: mismatches(RULES, theme, "light"),
      brokenFails: mismatches(broken, theme, "light").length > 0,
    }).toEqual({ real: [], brokenFails: true });
  });
});

function readStyleSource(): string {
  // parseCss に渡す前の生の文字列 (写しを書き換えるため)。
  return readFileSync("web/style.css", "utf8");
}
