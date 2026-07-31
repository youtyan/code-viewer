// tools オーバーレイの文言。アプリ全体の言語設定 (app.ts の STATE.language)
// と同じ値で切り替える。DB ビューアと同じく、tools も独立した DOM 構築なので
// ここに専用の文字列テーブルを置く。
//
// 言語切替時のライブ反映は tools-view の localize() が担当する。

import type { ToolId } from "../../core/tools";

export type ToolsLang = "en" | "ja";

export type ToolsText = {
  title: string;
  open: string;
  close: string;
  resizeSheet: string;
  /** サーバが受け付けられず、送り直しても通らないとき。 */
  saveFailed: string;
  /** 保存済みの下書きを読み出せなかったとき。 */
  loadFailed: string;
  tabs: Record<ToolId, string>;
  pane: {
    input: string;
    clear: string;
    clearTitle: string;
    copy: string;
    copyTitle: string;
    copied: string;
    copyFailed: string;
    resize: string;
    emptyInput: string;
  };
  markdown: {
    output: string;
    placeholder: string;
  };
  mermaid: {
    output: string;
    placeholder: string;
    zoomIn: string;
    zoomOut: string;
    zoomReset: string;
    loadError: string;
    renderError: string;
  };
  json: {
    output: string;
    placeholder: string;
    outputFormat: string;
    asJson: string;
    asYaml: string;
    minify: string;
    minifyTitle: string;
    minifyYamlTitle: string;
    /** 入力をどちらとして解釈したか。 */
    parsedAsJson: string;
    parsedAsYaml: string;
    invalid: (message: string) => string;
    loadError: string;
  };
};

const TEXT: Record<ToolsLang, ToolsText> = {
  en: {
    title: "Tools",
    open: "tools (Markdown / Mermaid / JSON)",
    close: "Close",
    resizeSheet: "Resize the tools drawer",
    saveFailed: "could not save this draft",
    loadFailed: "could not load saved drafts",
    tabs: {
      markdown: "Markdown",
      mermaid: "Mermaid",
      json: "JSON / YAML",
    },
    pane: {
      input: "Input",
      clear: "clear",
      clearTitle: "Clear the input",
      copy: "copy",
      copyTitle: "Copy the output",
      copied: "copied",
      copyFailed: "copy failed",
      resize: "Resize input and output panes",
      emptyInput: "Paste something on the left to see it rendered here.",
    },
    markdown: {
      output: "Preview",
      placeholder: "Paste Markdown here…",
    },
    mermaid: {
      output: "Diagram",
      placeholder:
        "Paste Mermaid source here, for example:\ngraph TD\n  A --> B",
      zoomIn: "Zoom in",
      zoomOut: "Zoom out",
      zoomReset: "Reset zoom",
      loadError: "Failed to load the Mermaid renderer.",
      renderError: "Could not render this diagram. Check the syntax.",
    },
    json: {
      output: "Output",
      placeholder: "Paste JSON or YAML here…",
      outputFormat: "output format",
      asJson: "JSON",
      asYaml: "YAML",
      minify: "minify",
      minifyTitle: "Emit JSON on a single line",
      minifyYamlTitle: "Minify applies to JSON output only",
      parsedAsJson: "read as JSON",
      parsedAsYaml: "read as YAML",
      invalid: (message: string) => `Invalid input: ${message}`,
      loadError: "Failed to load the YAML parser.",
    },
  },
  ja: {
    title: "ツール",
    open: "ツール (Markdown / Mermaid / JSON)",
    close: "閉じる",
    resizeSheet: "ツールの幅を変える",
    saveFailed: "この下書きを保存できません",
    loadFailed: "保存済みの下書きを読み出せません",
    tabs: {
      markdown: "Markdown",
      mermaid: "Mermaid",
      json: "JSON / YAML",
    },
    pane: {
      input: "入力",
      clear: "クリア",
      clearTitle: "入力を空にする",
      copy: "コピー",
      copyTitle: "出力をコピーする",
      copied: "コピーしました",
      copyFailed: "コピーできません",
      resize: "入力と出力の幅を変える",
      emptyInput: "左に貼り付けると、ここに結果が出ます。",
    },
    markdown: {
      output: "プレビュー",
      placeholder: "Markdown を貼り付け…",
    },
    mermaid: {
      output: "図",
      placeholder: "Mermaid の記法を貼り付け。例:\ngraph TD\n  A --> B",
      zoomIn: "拡大",
      zoomOut: "縮小",
      zoomReset: "等倍に戻す",
      loadError: "Mermaid の読み込みに失敗しました。",
      renderError: "この図を描けませんでした。記法を確認してください。",
    },
    json: {
      output: "出力",
      placeholder: "JSON か YAML を貼り付け…",
      outputFormat: "出力形式",
      asJson: "JSON",
      asYaml: "YAML",
      minify: "1行化",
      minifyTitle: "JSON を1行で出力する",
      minifyYamlTitle: "1行化は JSON 出力のときだけ効きます",
      parsedAsJson: "JSON として解釈",
      parsedAsYaml: "YAML として解釈",
      invalid: (message: string) => `解釈できません: ${message}`,
      loadError: "YAML パーサの読み込みに失敗しました。",
    },
  },
};

export function toolsText(lang: ToolsLang): ToolsText {
  return TEXT[lang];
}
