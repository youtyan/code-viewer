// 差分とコードの表示の文字は、どのテーマでも地からくっきり読める (WCAG 2.x の
// コントラスト比)。値そのものは固定せず、下限だけを確かめる (色を変えても下限を
// 保てば通る)。
//
// 本文の文字は 7:1 以上。構文の色は 6.5:1 以上 (7:1 前後)、コメントは 4.5:1 以上。
// 行番号と @@ の行は本文より一段落とすが 4.5:1 以上。追加・削除の行の面は、
// ダークで地の紫と混ぜて灰色に濁り、行番号 (4.4:1) と一緒に画面が霞んで見えていた。
//
// 構文の色は 2 系統 (shiki のテーマ core/shiki-theme.ts と highlight.js のクラス) を
// 同じ名前 (--syntax-*) へ寄せる。同じ種類が画面によって違う色にならないことも確かめる。

import { describe, expect, test } from "vitest";
import { SHIKI_COLOR_TOKENS } from "../core/shiki-theme";
import { contrastRatio } from "./_color-contrast";
import { themeVariants } from "./_color-themes";
import {
  baseRules,
  cascadedDeclarations,
  loadStyleSheet,
  resolveVar,
} from "./_css-fixture";

const rules = baseRules(loadStyleSheet());
// テーマは同じ名前の値を差し替えるだけ (ui-surface.md)。全部のテーマ × 明暗。
const THEMES = Object.fromEntries(
  themeVariants(rules).map((variant) => [variant.name, variant.vars]),
);

const token = (name: string, vars: Map<string, string>) =>
  resolveVar(`var(${name})`, vars);

// 文字が乗る面: コードの面・追加の行・削除の行。構文の色は Markdown のコード
// (--color-inset) と Data・Tools の表示 (--color-doc) にも乗る。
const LINE_SURFACES = ["--color-code", "--diff-add-bg", "--diff-del-bg"];
const SYNTAX_SURFACES = [...LINE_SURFACES, "--color-inset", "--color-doc"];

const PAIRS = [
  ...LINE_SURFACES.map((bg) => ({ fg: "--syntax-text", bg, min: 7 })),
  // 語の強調は構文の色を切ったときだけ出る (地の文字の上)。
  { fg: "--syntax-text", bg: "--diff-add-word-bg", min: 6.5 },
  { fg: "--syntax-text", bg: "--diff-del-word-bg", min: 6.5 },
  ...[
    "--syntax-keyword",
    "--syntax-string",
    "--syntax-type",
    "--syntax-function",
  ].flatMap((fg) => SYNTAX_SURFACES.map((bg) => ({ fg, bg, min: 6.5 }))),
  ...SYNTAX_SURFACES.map((bg) => ({ fg: "--syntax-comment", bg, min: 4.5 })),
  { fg: "--syntax-gutter", bg: "--color-code", min: 4.5 },
  { fg: "--diff-hunk-fg", bg: "--color-code", min: 4.5 },
  // 追加・削除の行の行番号と ＋ / − の印。
  { fg: "--diff-add-fg", bg: "--diff-add-num-sticky-bg", min: 4.5 },
  { fg: "--diff-add-fg", bg: "--diff-add-bg", min: 4.5 },
  { fg: "--diff-del-fg", bg: "--diff-del-num-sticky-bg", min: 4.5 },
  { fg: "--diff-del-fg", bg: "--diff-del-bg", min: 4.5 },
];

describe("text on the diff and code surfaces is crisp", () => {
  test.each(
    Object.entries(THEMES).flatMap(([theme, vars]) =>
      PAIRS.map((pair) => ({ theme, vars, ...pair })),
    ),
  )("$theme: $fg on $bg is $min:1 or more", ({ fg, bg, min, vars }) => {
    expect(
      contrastRatio(token(fg, vars), token(bg, vars)),
    ).toBeGreaterThanOrEqual(min);
  });
});

describe("line numbers and the @@ row sit one step below the code text", () => {
  test.each(
    Object.entries(THEMES).flatMap(([theme, vars]) =>
      ["--syntax-gutter", "--diff-hunk-fg"].map((fg) => ({ theme, fg, vars })),
    ),
  )("$theme: $fg", ({ fg, vars }) => {
    const code = token("--color-code", vars);
    expect(contrastRatio(token(fg, vars), code)).toBeLessThan(
      contrastRatio(token("--syntax-text", vars), code),
    );
  });
});

// 変わった語の強調は行の面より一段はっきりさせる (面どうしで 1.2:1 以上)。
describe("a changed word stands out from its line", () => {
  test.each(
    Object.entries(THEMES).flatMap(([theme, vars]) =>
      [
        { word: "--diff-add-word-bg", line: "--diff-add-bg" },
        { word: "--diff-del-word-bg", line: "--diff-del-bg" },
      ].map((pair) => ({ theme, vars, ...pair })),
    ),
  )("$theme: $word on $line", ({ word, line, vars }) => {
    expect(
      contrastRatio(token(word, vars), token(line, vars)),
    ).toBeGreaterThanOrEqual(1.2);
  });
});

// 眩しさを避ける: 純白の文字と真っ黒の面を使わない。
describe("no pure white text and no pure black surface", () => {
  test.each(
    Object.entries(THEMES).flatMap(([theme, vars]) => [
      { theme, vars, name: "--syntax-text", glaring: "#ffffff" },
      { theme, vars, name: "--color-code", glaring: "#000000" },
    ]),
  )("$theme: $name is not $glaring", ({ vars, name, glaring }) => {
    expect(token(name, vars).toLowerCase()).not.toBe(glaring);
  });
});

// 部品の規則がここで測った名前を読んでいる (測った組と画面の組が同じ)。
describe("the diff and code rules read the measured tokens", () => {
  const exactly = (selector: string) =>
    cascadedDeclarations(rules, (s) => s === selector);
  test.each([
    {
      selector: ".d2h-code-side-linenumber",
      prop: "color",
      value: "var(--syntax-gutter) !important",
    },
    {
      selector: ".d2h-code-linenumber",
      prop: "color",
      value: "var(--syntax-gutter) !important",
    },
    {
      selector: ".gdp-source-line-number",
      prop: "color",
      value: "var(--syntax-gutter)",
    },
    {
      selector: ".d2h-info .d2h-code-side-line",
      prop: "color",
      value: "var(--diff-hunk-fg) !important",
    },
    {
      selector: ".d2h-ins .d2h-code-side-line",
      prop: "background",
      value: "var(--diff-add-bg) !important",
    },
    {
      selector: ".d2h-del .d2h-code-side-line",
      prop: "background",
      value: "var(--diff-del-bg) !important",
    },
    {
      selector: ".d2h-ins .d2h-code-side-linenumber",
      prop: "background",
      value: "var(--diff-add-num-sticky-bg) !important",
    },
    {
      selector: ".d2h-del .d2h-code-side-linenumber",
      prop: "background",
      value: "var(--diff-del-num-sticky-bg) !important",
    },
    {
      selector: ".d2h-ins ins",
      prop: "background",
      value: "var(--diff-add-word-bg) !important",
    },
    {
      selector: ".d2h-del del",
      prop: "background",
      value: "var(--diff-del-word-bg) !important",
    },
    {
      selector: ".d2h-code-line-ctn",
      prop: "color",
      value: "var(--syntax-text)",
    },
  ])("$selector $prop", ({ selector, prop, value }) => {
    expect(exactly(selector).get(prop)).toBe(value);
  });

  // diff2html の既定の左の線 (#eee) は暗い地で白い縦線になっていた。
  test.each([
    ".d2h-code-side-linenumber",
    ".d2h-code-linenumber",
  ])("%s drops diff2html's left border", (selector) => {
    expect(exactly(selector).get("border-left")).toBe("0 !important");
  });
});

// 同じ種類は shiki の面 (ソース表示・Markdown・Data・Tools) でも highlight.js の面
// (差分・仮想表示) でも同じ名前を読む。shiki の種類は、割り当てを借りた github-dark の
// 色で見分ける (core/shiki-theme.ts の表)。
describe("shiki and highlight.js give the same kind the same color", () => {
  const exactly = (selector: string) =>
    cascadedDeclarations(rules, (s) => s === selector);
  const KINDS = [
    {
      kind: "keyword",
      shiki: "f97583",
      hljs: "keyword",
      token: "--syntax-keyword",
    },
    {
      kind: "tag name",
      shiki: "85e89d",
      hljs: "tag",
      token: "--syntax-keyword",
    },
    {
      kind: "string",
      shiki: "9ecbff",
      hljs: "string",
      token: "--syntax-string",
    },
    {
      kind: "regexp",
      shiki: "dbedff",
      hljs: "regexp",
      token: "--syntax-string",
    },
    { kind: "number", shiki: "79b8ff", hljs: "number", token: "--syntax-type" },
    {
      kind: "constant",
      shiki: "79b8ff",
      hljs: "variable.constant_",
      token: "--syntax-type",
    },
    {
      kind: "built-in",
      shiki: "79b8ff",
      hljs: "built_in",
      token: "--syntax-type",
    },
    {
      kind: "property name (JSON key)",
      shiki: "79b8ff",
      hljs: "attr",
      token: "--syntax-type",
    },
    {
      kind: "heading",
      shiki: "79b8ff",
      hljs: "section",
      token: "--syntax-type",
    },
    {
      kind: "function name",
      shiki: "b392f0",
      hljs: "title",
      token: "--syntax-function",
    },
    {
      kind: "class name",
      shiki: "b392f0",
      hljs: "title.class_",
      token: "--syntax-function",
    },
    {
      kind: "comment",
      shiki: "6a737d",
      hljs: "comment",
      token: "--syntax-comment",
    },
    {
      kind: "variable",
      shiki: "ffab70",
      hljs: "variable",
      token: "--syntax-text",
    },
    {
      kind: "parameter",
      shiki: "e1e4e8",
      hljs: "params",
      token: "--syntax-text",
    },
  ];
  const HLJS_SURFACES = [
    ".d2h-code-line-ctn",
    ".gdp-markdown-preview",
    ".gdp-source-line-code",
    ".gdp-source-virtual-line-code",
  ];

  test.each(KINDS)("$kind (shiki #$shiki)", ({ shiki, token: name }) => {
    expect(SHIKI_COLOR_TOKENS[`#${shiki}`]).toBe(name);
  });

  test.each(
    KINDS.flatMap((kind) =>
      HLJS_SURFACES.map((surface) => ({ ...kind, surface })),
    ),
  )("$kind (highlight.js .hljs-$hljs on $surface)", ({
    hljs,
    surface,
    token: name,
  }) => {
    expect(exactly(`${surface} .hljs-${hljs}`).get("color")).toBe(
      `var(${name}) !important`,
    );
  });
});
