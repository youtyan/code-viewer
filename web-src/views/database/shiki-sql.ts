// SQL を shiki でハイライトした結果を、自前の <pre> 要素に流し込むための
// DOM 統合ヘルパ。lazy load 本体は core/shiki-loader (loadShikiHighlighter)
// に、言語非依存の HTML 取り出しは同 highlightToInnerHtml に集約されている
// ので、ここでは lang を固定するだけ。
//
// 使い方:
//   const highlighter = await loadShikiHighlighter({
//     themes: ["github-light", "github-dark"],
//     langs: ["sql"],
//   });
//   pre.innerHTML = highlightSqlToInnerHtml(sql, highlighter)
//                 || (pre.textContent = sql, "");

import {
  highlightToInnerHtml,
  type ShikiHighlighter,
} from "../../core/shiki-loader";

export function highlightSqlToInnerHtml(
  code: string,
  highlighter: ShikiHighlighter | null,
): string {
  return highlightToInnerHtml(code, "sql", highlighter);
}
