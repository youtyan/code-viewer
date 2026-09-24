// 設定の保存の帯 (.scope-settings-footer) は、後ろのページの面と同じ色で塗る。
// 帯だけ地の色 (--color-ground) で塗っていた頃、本文の面 (--color-doc) が地と大きく
// 違うテーマ (薄墨のダークなど) で、帯だけ暗く浮き、本文の列の幅で切れて見えた。
//
// 後ろの面は本文の箱 (#content) が決める: 本文にフォーカスがある間は本文の面、
// それ以外は何も塗らず body の地。どの状態でも帯と後ろが同じであることを、
// 10 テーマ × 明暗の名前の層の値 (実物の style.css のカスケード) で確かめる。
import { describe, expect, test } from "vitest";
import { themeVariants } from "./_color-themes";
import {
  baseRules,
  cascadedDeclarations,
  loadStyleSheet,
  resolveVar,
} from "./_css-fixture";

const rules = baseRules(loadStyleSheet());
const FOCUS_SCOPES = [null, "main", "sidebar"] as const;

/** 本文の箱に効く宣言 (body のフォーカスの印の有無ごと)。 */
function contentDeclarations(scope: (typeof FOCUS_SCOPES)[number]) {
  return cascadedDeclarations(
    rules,
    (selector) =>
      selector === "#content" ||
      (scope !== null &&
        selector === `body[data-focus-scope="${scope}"] #content`),
  );
}

const body = cascadedDeclarations(
  rules,
  (selector) => selector === "html" || selector === "body",
);
const footer = cascadedDeclarations(
  rules,
  (selector) => selector === ".scope-settings-footer",
);

/** 自前の名前 (--*) だけ。子は本文の箱のものを継ぐ。 */
function customProperties(declarations: Map<string, string>) {
  return [...declarations].filter(([name]) => name.startsWith("--"));
}

describe("the settings save bar is painted like the page behind it", () => {
  const cases = themeVariants(rules).flatMap((variant) =>
    FOCUS_SCOPES.map((scope) => ({
      variant,
      scope,
      name: `${variant.name}, focus ${scope ?? "none"}`,
    })),
  );

  test.each(cases)("$name", ({ variant, scope }) => {
    const content = contentDeclarations(scope);
    const vars = new Map([
      ...variant.vars,
      ...customProperties(body),
      ...customProperties(content),
    ]);
    const behind = content.get("background") ?? body.get("background");
    if (!behind) throw new Error("nothing paints the page behind the bar");
    const bar = footer.get("background");
    if (!bar) throw new Error("the save bar has no background");

    expect(resolveVar(bar, vars)).toBe(resolveVar(behind, vars));
  });

  // 上の検査が色の違いを見分けられること: 本文の面と地が違うテーマでは、
  // フォーカスで後ろの色が変わる (帯を 1 つの色に決め打ちすると落ちる)。
  test("the page behind changes with the focus in a theme whose ground and page differ", () => {
    const ink = themeVariants(rules).find((v) => v.name === "ink dark");
    if (!ink) throw new Error("missing ink dark");
    const behind = FOCUS_SCOPES.map((scope) => {
      const content = contentDeclarations(scope);
      const vars = new Map([...ink.vars, ...customProperties(content)]);
      return resolveVar(
        content.get("background") ?? body.get("background") ?? "",
        vars,
      );
    });
    expect(new Set(behind).size).toBe(2);
  });
});
