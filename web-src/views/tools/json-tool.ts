// Tools の JSON / YAML の結果の描き方。貼り付けたテキストを JSON か YAML として
// 解釈し (自動判定)、選んだ形式に整形して出し直す。整形・検証・相互変換が
// 1 画面で完結する。出す形式と 1 行化の状態は tools-presenter が持つ。
//
// YAML パーサは web/yaml.js を lazy import する。JSON を貼って JSON で出す
// 限りロードは走らない。強調の HTML は shiki が作るもの (外の部品)。

import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { html } from "lit/html.js";
import {
  highlightToInnerHtml,
  loadShikiHighlighter,
} from "../../core/shiki-loader";
import { loadYaml, type YamlApi } from "../../core/yaml-loader";
import type { ToolsText } from "./i18n";
import type { ScratchpadRender } from "./scratchpad-pane";
import {
  formatStructured,
  parseStructuredText,
  type StructuredFormat,
  type StructuredParseResult,
} from "./structured-text";

export type JsonOutputSettings = {
  text: ToolsText;
  format: StructuredFormat;
  minify: boolean;
};

/** 入力を解釈する。JSON を JSON のまま整形するだけなら YAML パーサは読まない。
 * 中断された場合は null (呼び出し側はそのまま抜ける)。 */
async function resolveInput(
  value: string,
  format: StructuredFormat,
  signal: AbortSignal,
): Promise<{ parsed: StructuredParseResult; yaml: YamlApi | null } | null> {
  const direct = parseStructuredText(value, null);
  if (direct.status === "ok" && format === "json")
    return { parsed: direct, yaml: null };
  const yaml = await loadYaml();
  if (signal.aborted) return null;
  return {
    parsed: direct.status === "ok" ? direct : parseStructuredText(value, yaml),
    yaml,
  };
}

/** JSON / YAML の結果の描き方。settings() は描くたびに読み、整形した文字列
 * (コピーの元。出せなかったときは "") を onOutput に渡す。 */
export function jsonOutputRenderer(
  settings: () => JsonOutputSettings,
  onOutput: (formatted: string) => void,
): ScratchpadRender {
  return async (value, { signal, show, setStatus }) => {
    const { text, format, minify } = settings();
    const resolved = await resolveInput(value, format, signal);
    if (!resolved) return;
    const { parsed, yaml } = resolved;
    if (parsed.status === "error") {
      onOutput("");
      show(
        html`<p class="tools-pane-error">${text.json.invalid(parsed.message)}</p>`,
      );
      setStatus("");
      return;
    }
    const formatted = formatStructured(parsed.value, format, minify, yaml);
    if (formatted === null) {
      onOutput("");
      show(html`<p class="tools-pane-error">${text.json.loadError}</p>`);
      setStatus("");
      return;
    }
    onOutput(formatted);
    const highlighter = await loadShikiHighlighter({
      langs: ["json", "yaml"],
    });
    if (signal.aborted) return;
    const highlighted = highlightToInnerHtml(formatted, format, highlighter);
    const pre = html`<pre class="tools-code">${highlighted ? unsafeHTML(highlighted) : formatted}</pre>`;
    // 解釈はできたが引っかかった点 (YAML の警告) は結果の上に添える。
    show(
      parsed.warnings?.length
        ? html`<p class="tools-pane-warning">${parsed.warnings.join("\n\n")}</p>${pre}`
        : pre,
    );
    setStatus(
      parsed.source === "json"
        ? text.json.parsedAsJson
        : text.json.parsedAsYaml,
    );
  };
}
