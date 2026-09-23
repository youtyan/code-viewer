// tools オーバーレイの Mermaid プレビュー。貼り付けた Mermaid 記法をそのまま
// 1 枚の図として描く。ズーム / ドラッグパンは ER 図と同じ core の
// createDiagramViewport を使うので、操作感は DB の ER タブと揃う。

import { createDiagramViewport } from "../../core/diagram-viewport";
import { errorWithCause, formatErrorDetail } from "../../core/error-detail";
import { loadMermaid } from "../../core/mermaid-loader";
import type { ToolsText } from "./i18n";
import {
  createPaneAction,
  createScratchpadPane,
  type ScratchpadPane,
} from "./scratchpad-pane";

export type MermaidTool = ScratchpadPane & {
  /** 言語切替でズームボタンの title と文言を貼り直す。 */
  localizeActions(text: ToolsText): void;
};

export function createMermaidTool(
  text: ToolsText,
  initialText: string,
  onInput: (value: string) => void,
): MermaidTool {
  let currentText = text;

  const viewport = createDiagramViewport({
    containerClassName: "tools-mermaid-container",
    contentClassName: "tools-mermaid-canvas",
  });

  const zoomIn = createPaneAction("+", text.mermaid.zoomIn);
  const zoomOut = createPaneAction("−", text.mermaid.zoomOut);
  const zoomReset = createPaneAction("1:1", text.mermaid.zoomReset);
  zoomIn.addEventListener("click", () => viewport.zoomIn());
  zoomOut.addEventListener("click", () => viewport.zoomOut());
  zoomReset.addEventListener("click", () => viewport.reset());

  const pane = createScratchpadPane(
    text,
    text.mermaid.output,
    text.mermaid.placeholder,
    {
      toolClassName: "tools-pane-mermaid",
      initialText,
      onInput,
      outputActions: [zoomIn, zoomOut, zoomReset],
      render: async (value, output, signal) => {
        let mermaid: Awaited<ReturnType<typeof loadMermaid>>;
        try {
          mermaid = await loadMermaid();
        } catch (error) {
          // 投げ直した失敗は createScratchpadPane が console とステータス行に出す。
          throw errorWithCause(currentText.mermaid.loadError, error);
        }
        if (signal.aborted) return;
        const node = document.createElement("div");
        node.className = "mermaid";
        node.textContent = value;
        viewport.content.replaceChildren(node);
        viewport.reset();
        output.replaceChildren(viewport.container);
        try {
          // suppressErrors: false だと mermaid が図の代わりにエラー画像を
          // 差し込むので、失敗はこちらのステータス行だけで伝える。
          await mermaid.run({ nodes: [node], suppressErrors: true });
        } catch (error) {
          throw errorWithCause(currentText.mermaid.renderError, error);
        }
        if (signal.aborted) return;
        // 解析に失敗したときは例外ではなく「SVG が生えない」形で返ってくる。
        if (node.querySelector("svg")) {
          pane.setStatus("");
          return;
        }
        // 記法の誤りは利用者の入力なので console には出さず、parse の理由を
        // ステータス行に添える (理由が取れないときは案内だけ)。
        let syntaxError: unknown = null;
        try {
          await mermaid.parse?.(value);
        } catch (error) {
          syntaxError = error;
        }
        if (signal.aborted) return;
        pane.setStatus(
          syntaxError === null
            ? currentText.mermaid.renderError
            : `${currentText.mermaid.renderError}\n${formatErrorDetail(syntaxError)}`,
          "error",
        );
      },
    },
  );

  const disposePane = pane.dispose;
  return {
    ...pane,
    localizeActions(nextText: ToolsText) {
      currentText = nextText;
      zoomIn.title = nextText.mermaid.zoomIn;
      zoomOut.title = nextText.mermaid.zoomOut;
      zoomReset.title = nextText.mermaid.zoomReset;
    },
    dispose() {
      disposePane();
      viewport.dispose();
    },
  };
}
