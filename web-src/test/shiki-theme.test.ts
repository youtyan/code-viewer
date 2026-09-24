// shiki のハイライトの色は、値ではなく名前の層の CSS 変数 (core/shiki-theme.ts)。
// テーマ (配色) と明暗を替えると、ハイライトし直さずに CSS だけで色が替わる。
//
// 本物の shiki (配布物の shiki.js と同じ shiki/bundle/full) で実際にハイライトし、
// 出てきた色が全部 var(--syntax-*) か差分の文字の名前であること、種類ごとの割り当て
// (highlight.js の面とそろえた表) のとおりであることを確かめる。

import { bundledThemes, createHighlighter } from "shiki/bundle/full";
import { beforeAll, describe, expect, test } from "vitest";
import {
  codeViewerShikiTheme,
  SHIKI_COLOR_TOKENS,
  SHIKI_THEMES,
  type ShikiTheme,
} from "../core/shiki-theme";

let theme: ShikiTheme;
let highlight: (code: string, lang: string) => string;

beforeAll(async () => {
  theme = codeViewerShikiTheme((await bundledThemes["github-dark"]()).default);
  const highlighter = await createHighlighter({
    themes: [theme],
    langs: ["typescript", "json", "shellscript", "markdown", "diff"],
  });
  highlight = (code, lang) =>
    highlighter.codeToHtml(code, {
      lang,
      themes: SHIKI_THEMES,
      defaultColor: false,
    });
}, 30_000);

/** 出力の span ごとの [文字, --shiki-light の値, --shiki-dark の値]。 */
function spans(html: string): Array<[string, string, string]> {
  return [...html.matchAll(/<span style="([^"]*)">([^<]*)<\/span>/g)].map(
    ([, style, text]) => [
      text.replace(/&#x3C;/g, "<").replace(/&quot;/g, '"'),
      /--shiki-light:([^;]+)/.exec(style)?.[1] ?? "",
      /--shiki-dark:([^;]+)/.exec(style)?.[1] ?? "",
    ],
  );
}

const ALLOWED = new Set(
  [...new Set(Object.values(SHIKI_COLOR_TOKENS)), "--diff-add-fg"].map(
    (name) => `var(${name})`,
  ),
);

describe("the theme is made of the syntax names only", () => {
  test("every rule of the theme paints with a name, not a value", () => {
    const painted = theme.tokenColors
      .map((item) => item.settings.foreground)
      .filter((color): color is string => color !== undefined);
    expect(painted.filter((color) => !ALLOWED.has(color))).toEqual([]);
  });

  test("a color with no name is reported instead of being guessed", () => {
    expect(() =>
      codeViewerShikiTheme({
        tokenColors: [
          { scope: "keyword", settings: { foreground: "#123456" } },
        ],
      }),
    ).toThrow("shiki theme: no syntax token for #123456 (scopes: keyword)");
  });
});

describe("highlighted code reads the syntax names", () => {
  const SAMPLES = [
    {
      lang: "typescript",
      code: 'import { formatPrice } from "./format";\n// sum of lines\nexport function total(count: number): string {\n  return formatPrice(count * 2);\n}',
    },
    {
      lang: "json",
      code: '{ "name": "sample-app", "port": 8080, "debug": false }',
    },
    {
      lang: "shellscript",
      code: 'OUT_DIR="dist"\nif [ -d "$OUT_DIR" ]; then echo ok; fi',
    },
    { lang: "markdown", code: "# Sample app\n\n- one item\n\n`code`" },
  ];

  test.each(
    SAMPLES,
  )("$lang: every span uses a name, the same in light and dark", ({
    lang,
    code,
  }) => {
    const found = spans(highlight(code, lang));
    expect({
      some: found.length > 0,
      outside: found.filter(([, light]) => !ALLOWED.has(light)),
      differ: found.filter(([, light, dark]) => light !== dark),
    }).toEqual({ some: true, outside: [], differ: [] });
  });

  // 種類ごとの割り当て (highlight.js の面と同じ。diff-code-contrast.test.ts の表)。
  test.each([
    {
      lang: "typescript",
      code: "const a = 1;",
      text: "const",
      token: "--syntax-keyword",
    },
    {
      lang: "typescript",
      code: 'const a = "x";',
      text: '"',
      token: "--syntax-string",
    },
    {
      lang: "typescript",
      code: "const a = 1;",
      text: "1",
      token: "--syntax-type",
    },
    {
      lang: "typescript",
      code: "total(1);",
      text: "total",
      token: "--syntax-function",
    },
    {
      lang: "typescript",
      code: "class Order {}",
      text: "Order",
      token: "--syntax-function",
    },
    {
      lang: "typescript",
      code: "// note",
      text: "// note",
      token: "--syntax-comment",
    },
    {
      lang: "json",
      code: '{ "port": 1 }',
      text: "port",
      token: "--syntax-type",
    },
    {
      lang: "markdown",
      code: "# Title",
      text: "Title",
      token: "--syntax-type",
    },
    { lang: "diff", code: "+added line", text: "+", token: "--diff-add-fg" },
    { lang: "diff", code: "-removed line", text: "-", token: "--diff-del-fg" },
  ])("$lang: $text is $token", ({ lang, code, text, token }) => {
    const span = spans(highlight(code, lang)).find(([value]) =>
      value.includes(text),
    );
    expect(span?.[1]).toBe(`var(${token})`);
  });
});
