// Tools の Mermaid プレビューの結果の描き方。貼り付けた Mermaid 記法をそのまま
// 1 枚の図として描く。ズーム / ドラッグパンは ER 図と同じ cv-diagram-viewport を
// 使うので、操作感は DB の ER タブと揃う。図の SVG は mermaid が作るもの (外の部品)。

import { html } from "lit/html.js";
import { keyed } from "lit/directives/keyed.js";
import { createRef, ref } from "lit/directives/ref.js";
import { errorWithCause, formatErrorDetail } from "../../core/error-detail";
import { loadMermaid } from "../../core/mermaid-loader";
import { phoneMediaQuery } from "../shell/workspace";
import type { CvDiagramViewport } from "../ui/diagram-viewport";
import { flushRenders } from "../ui/render-queue";
import type { ToolsText } from "./i18n";
import type { ScratchpadRender } from "./scratchpad-pane";

export type MermaidOutput = {
  render: ScratchpadRender;
  zoomIn(): void;
  zoomOut(): void;
  zoomReset(): void;
};

/** Mermaid の結果の描き方と、その図のズームの操作。text() は描くたびに読む。 */
export function mermaidOutput(text: () => ToolsText): MermaidOutput {
  const viewportRef = createRef<CvDiagramViewport>();
  // mermaid は描いた図で中身の箱を置き換える (lit の印ごと)。描くたびに枠を
  // 作り直し、前の図の上に描き足さない。
  let drawSeq = 0;

  const render: ScratchpadRender = async (
    value,
    { signal, show, setStatus },
  ) => {
    let mermaid: Awaited<ReturnType<typeof loadMermaid>>;
    try {
      mermaid = await loadMermaid();
    } catch (error) {
      // 投げ直した失敗は cv-scratchpad-pane が console と状態の欄に出す。
      throw errorWithCause(text().mermaid.loadError, error);
    }
    if (signal.aborted) return;
    drawSeq += 1;
    show(
      keyed(
        drawSeq,
        html`<cv-diagram-viewport
          ${ref(viewportRef)}
          .containerCls=${"tools-mermaid-container"}
          .contentCls=${"tools-mermaid-canvas"}
          .content=${
            // 記法は textContent で入れる。子として描くと lit の印 (コメント) が
            // 中に入り、mermaid が innerHTML を読んで記法の誤りにする。
            html`<div class="mermaid" .textContent=${value}></div>`
          }
        ></cv-diagram-viewport>`,
      ),
    );
    // mermaid は置いた要素を測って描くので、描き直しを待たずにいま置く。
    flushRenders();
    const node = viewportRef.value?.querySelector<HTMLElement>(".mermaid");
    if (!node) throw new Error("mermaid output: the diagram box was not drawn");
    viewportRef.value?.reset();
    try {
      // suppressErrors: false だと mermaid が図の代わりにエラー画像を
      // 差し込むので、失敗はこちらの状態の欄だけで伝える。
      await mermaid.run({ nodes: [node], suppressErrors: true });
    } catch (error) {
      throw errorWithCause(text().mermaid.renderError, error);
    }
    if (signal.aborted) return;
    // 解析に失敗したときは例外ではなく「SVG が生えない」形で返ってくる。
    const svg = node.querySelector("svg");
    if (svg) {
      // 電話の段では図をもとの大きさで描き、指で動かして読む (面の幅に縮める
      // とノードの文字が 5px になった)。mermaid はもとの幅を max-width に書く。
      if (phoneMediaQuery().matches && svg.style.maxWidth) {
        svg.style.width = svg.style.maxWidth;
        svg.style.maxWidth = "none";
      }
      setStatus("");
      return;
    }
    // 記法の誤りは利用者の入力なので console には出さず、parse の理由を
    // 状態の欄に添える (理由が取れないときは案内だけ)。
    let syntaxError: unknown = null;
    try {
      await mermaid.parse?.(value);
    } catch (error) {
      syntaxError = error;
    }
    if (signal.aborted) return;
    setStatus(
      syntaxError === null
        ? text().mermaid.renderError
        : `${text().mermaid.renderError}\n${formatErrorDetail(syntaxError)}`,
      "error",
    );
  };

  return {
    render,
    zoomIn: () => viewportRef.value?.zoomIn(),
    zoomOut: () => viewportRef.value?.zoomOut(),
    zoomReset: () => viewportRef.value?.reset(),
  };
}
