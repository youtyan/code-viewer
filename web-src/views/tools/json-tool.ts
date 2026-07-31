// tools オーバーレイの JSON / YAML ツール。貼り付けたテキストを JSON か YAML
// として解釈し (自動判定)、選んだ形式に整形して出し直す。整形・検証・相互変換
// が 1 画面で完結する。
//
// YAML パーサは web/yaml.js を lazy import する。JSON を貼って JSON で出す
// 限りロードは走らない。

import {
  highlightToInnerHtml,
  loadShikiHighlighter,
} from "../../core/shiki-loader";
import { loadYaml, type YamlApi } from "../../core/yaml-loader";
import type { ToolsText } from "./i18n";
import {
  createPaneAction,
  createScratchpadPane,
  type ScratchpadPane,
} from "./scratchpad-pane";
import {
  formatStructured,
  parseStructuredText,
  type StructuredFormat,
  type StructuredParseResult,
} from "./structured-text";

export type JsonTool = ScratchpadPane & {
  /** 言語切替でツールバーのラベルを貼り直す。 */
  localizeActions(text: ToolsText): void;
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

export function createJsonTool(
  text: ToolsText,
  initialText: string,
  onInput: (value: string) => void,
): JsonTool {
  let currentText = text;
  let format: StructuredFormat = "json";
  let minify = false;
  let lastOutput = "";

  const seg = document.createElement("div");
  seg.className = "seg";
  seg.role = "group";
  seg.setAttribute("aria-label", text.json.outputFormat);
  const jsonBtn = document.createElement("button");
  jsonBtn.type = "button";
  jsonBtn.textContent = text.json.asJson;
  jsonBtn.classList.add("active");
  const yamlBtn = document.createElement("button");
  yamlBtn.type = "button";
  yamlBtn.textContent = text.json.asYaml;
  seg.append(jsonBtn, yamlBtn);

  const minifyBtn = createPaneAction(text.json.minify, text.json.minifyTitle);
  const copyBtn = createPaneAction(text.pane.copy, text.pane.copyTitle);

  function syncActionState(): void {
    jsonBtn.classList.toggle("active", format === "json");
    yamlBtn.classList.toggle("active", format === "yaml");
    minifyBtn.classList.toggle("active", minify);
    minifyBtn.setAttribute("aria-pressed", String(minify));
    // YAML 出力に 1 行化は無い。ボタンは消さず disabled にして、押せる場所が
    // 動かないようにする。
    minifyBtn.disabled = format === "yaml";
    minifyBtn.title =
      format === "yaml"
        ? currentText.json.minifyYamlTitle
        : currentText.json.minifyTitle;
  }

  const pane = createScratchpadPane(
    text,
    text.json.output,
    text.json.placeholder,
    {
      toolClassName: "tools-pane-json",
      initialText,
      onInput,
      outputActions: [seg, minifyBtn, copyBtn],
      render: async (value, output, signal) => {
        const resolved = await resolveInput(value, format, signal);
        if (!resolved) return;
        const { parsed, yaml } = resolved;
        if (parsed.status === "error") {
          lastOutput = "";
          const error = document.createElement("p");
          error.className = "tools-pane-error";
          error.textContent = currentText.json.invalid(parsed.message);
          output.replaceChildren(error);
          pane.setStatus("");
          return;
        }
        const formatted = formatStructured(parsed.value, format, minify, yaml);
        if (formatted === null) {
          lastOutput = "";
          const error = document.createElement("p");
          error.className = "tools-pane-error";
          error.textContent = currentText.json.loadError;
          output.replaceChildren(error);
          pane.setStatus("");
          return;
        }
        lastOutput = formatted;
        const highlighter = await loadShikiHighlighter({
          themes: ["github-light", "github-dark"],
          langs: ["json", "yaml"],
        });
        if (signal.aborted) return;
        const pre = document.createElement("pre");
        pre.className = "tools-code";
        const html = highlightToInnerHtml(formatted, format, highlighter);
        if (html) pre.innerHTML = html;
        else pre.textContent = formatted;
        // 解釈はできたが引っかかった点 (YAML の警告) は出力の上に添える。
        if (parsed.warnings?.length) {
          const warning = document.createElement("p");
          warning.className = "tools-pane-warning";
          warning.textContent = parsed.warnings.join("\n\n");
          output.replaceChildren(warning, pre);
        } else {
          output.replaceChildren(pre);
        }
        pane.setStatus(
          parsed.source === "json"
            ? currentText.json.parsedAsJson
            : currentText.json.parsedAsYaml,
        );
      },
    },
  );

  jsonBtn.addEventListener("click", () => {
    if (format === "json") return;
    format = "json";
    syncActionState();
    pane.refresh();
  });
  yamlBtn.addEventListener("click", () => {
    if (format === "yaml") return;
    format = "yaml";
    syncActionState();
    pane.refresh();
  });
  minifyBtn.addEventListener("click", () => {
    minify = !minify;
    syncActionState();
    pane.refresh();
  });
  copyBtn.addEventListener("click", () => {
    if (!lastOutput) return;
    navigator.clipboard.writeText(lastOutput).then(
      () => pane.flashStatus(currentText.pane.copied),
      () => pane.flashStatus(currentText.pane.copyFailed, "error"),
    );
  });

  syncActionState();

  return {
    ...pane,
    localizeActions(nextText: ToolsText) {
      currentText = nextText;
      seg.setAttribute("aria-label", nextText.json.outputFormat);
      jsonBtn.textContent = nextText.json.asJson;
      yamlBtn.textContent = nextText.json.asYaml;
      minifyBtn.textContent = nextText.json.minify;
      copyBtn.textContent = nextText.pane.copy;
      copyBtn.title = nextText.pane.copyTitle;
      syncActionState();
    },
  };
}
