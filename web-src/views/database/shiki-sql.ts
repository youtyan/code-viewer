// SQL を shiki でハイライトした結果を、自前の <pre> 要素に流し込むための
// DOM 統合ヘルパ。lazy load 本体は core/shiki-loader (loadShikiHighlighter)
// に集約されているので、ここでは load しない。
//
// 使い方:
//   const highlighter = await loadShikiHighlighter({
//     themes: ["github-light", "github-dark"],
//     langs: ["sql"],
//   });
//   pre.innerHTML = highlightSqlToInnerHtml(sql, highlighter)
//                 || (pre.textContent = sql, "");

import type { ShikiHighlighter } from "../../core/shiki-loader";

/** shiki の `<pre><code>...</code></pre>` 出力から、内側 (呼び出し側の自前
 * `<pre>` に流し込める innerHTML) を取り出す。highlighter が null / code が
 * 空のときは空文字 (呼び出し側で textContent フォールバックする想定)。 */
export function highlightSqlToInnerHtml(
  code: string,
  highlighter: ShikiHighlighter | null,
): string {
  if (!highlighter || !code) return "";
  const html = highlighter.codeToHtml(code, {
    lang: "sql",
    themes: { light: "github-light", dark: "github-dark" },
    defaultColor: false,
  });
  const template = document.createElement("template");
  template.innerHTML = html;
  const pre = template.content.querySelector("pre");
  return pre ? pre.innerHTML : "";
}
