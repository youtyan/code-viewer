// Tools の画面の表示。tools-presenter が渡す値 (ToolsViewProps) だけから描く。
// 状態もサーバとのやり取りも持たない。

import { html } from "lit/html.js";
import { TOOL_IDS, type ToolId } from "../../core/tools";
import type { ToolsText } from "./i18n";
import type { StructuredFormat } from "./structured-text";
import type {
  DraftInputEvent,
  ScratchpadFlash,
  ScratchpadRender,
} from "./scratchpad-pane";

export type ToolsViewProps = {
  text: ToolsText;
  activeTool: ToolId;
  drafts: Partial<Record<ToolId, string>>;
  /** 全部の道具に出し続ける文言 (読めない・保存できない)。無ければ null。 */
  pinnedStatus: string | null;
  refreshKeys: Record<ToolId, number>;
  focusKeys: Record<ToolId, number>;
  renderers: Record<ToolId, ScratchpadRender>;
  json: {
    format: StructuredFormat;
    minify: boolean;
    flash: ScratchpadFlash | null;
  };
  onSelectTool(tool: ToolId): void;
  onDraftInput(tool: ToolId, value: string): void;
  onJsonFormat(format: StructuredFormat): void;
  onToggleMinify(): void;
  onCopyJson(): void;
  onZoomIn(): void;
  onZoomOut(): void;
  onZoomReset(): void;
};

export type ToolsView = (props: ToolsViewProps) => unknown;

function outputTitle(text: ToolsText, tool: ToolId): string {
  return text[tool].output;
}

function placeholder(text: ToolsText, tool: ToolId): string {
  return text[tool].placeholder;
}

function actions(props: ToolsViewProps, tool: ToolId): unknown {
  const { text } = props;
  if (tool === "mermaid")
    return html`<cv-button
        .cls=${"tools-pane-action"}
        .label=${"+"}
        .title=${text.mermaid.zoomIn}
        @click=${props.onZoomIn}
      ></cv-button
      ><cv-button
        .cls=${"tools-pane-action"}
        .label=${"−"}
        .title=${text.mermaid.zoomOut}
        @click=${props.onZoomOut}
      ></cv-button
      ><cv-button
        .cls=${"tools-pane-action"}
        .label=${"1:1"}
        .title=${text.mermaid.zoomReset}
        @click=${props.onZoomReset}
      ></cv-button>`;
  if (tool === "json") {
    const { format, minify } = props.json;
    return html`<cv-segmented
        .label=${text.json.outputFormat}
        .value=${format}
        .options=${[
          { value: "json", label: text.json.asJson },
          { value: "yaml", label: text.json.asYaml },
        ]}
        @cv-select=${(event: CustomEvent<{ value: string }>) =>
          props.onJsonFormat(event.detail.value as StructuredFormat)}
      ></cv-segmented
      ><cv-button
        .cls=${"tools-pane-action"}
        .label=${text.json.minify}
        .title=${format === "yaml" ? text.json.minifyYamlTitle : text.json.minifyTitle}
        .active=${minify}
        .pressed=${minify}
        .disabled=${format === "yaml"}
        @click=${props.onToggleMinify}
      ></cv-button
      ><cv-button
        .cls=${"tools-pane-action"}
        .label=${text.pane.copy}
        .title=${text.pane.copyTitle}
        @click=${props.onCopyJson}
      ></cv-button>`;
  }
  return null;
}

/** 既定の表示。見出しと閉じるはパネルのタブ列が持つので、ここはツールのタブと
 * 道具の 2 面だけ。 */
export const DEFAULT_VIEW: ToolsView = (props) => {
  const { text } = props;
  return html`<header class="tools-header">
      <cv-segmented
        .cls=${"tools-tabs"}
        .label=${text.title}
        .value=${props.activeTool}
        .marksPressed=${true}
        .options=${TOOL_IDS.map((id) => ({ value: id, label: text.tabs[id] }))}
        @cv-select=${(event: CustomEvent<{ value: string }>) =>
          props.onSelectTool(event.detail.value as ToolId)}
      ></cv-segmented>
    </header>
    <div class="tools-body">
      ${TOOL_IDS.map(
        (id) => html`<cv-scratchpad-pane
          .toolClass=${`tools-pane-${id}`}
          .text=${text}
          .outputTitle=${outputTitle(text, id)}
          .placeholder=${placeholder(text, id)}
          .value=${props.drafts[id] ?? ""}
          .active=${id === props.activeTool}
          .renderOutput=${props.renderers[id]}
          .actions=${actions(props, id)}
          .pinnedStatus=${props.pinnedStatus}
          .flash=${id === "json" ? props.json.flash : null}
          .refreshKey=${props.refreshKeys[id]}
          .focusKey=${props.focusKeys[id]}
          @cv-draft-input=${(event: DraftInputEvent) =>
            props.onDraftInput(id, event.detail.value)}
        ></cv-scratchpad-pane>`,
      )}
    </div>`;
};
