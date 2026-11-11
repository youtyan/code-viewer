// cv-diagram-viewport: 画面より大きくなりうる 1 枚 (mermaid の図・ER 図・画像) を、
// ボタン / ctrl+wheel のズームとドラッグパンで見て回る枠。中は
// <div class=containerCls><div class=contentCls>中身</div></div>。操作は
// core/diagram-viewport.ts の attachDiagramViewport (つながっている間だけ)。

import { html } from "lit/html.js";
import {
  attachDiagramViewport,
  type DiagramViewportControls,
} from "../../core/diagram-viewport";
import { defineElement } from "./element";

export const CV_DIAGRAM_VIEWPORT = "cv-diagram-viewport";

export type CvDiagramViewportProps = {
  /** スクロールの箱のクラス。ドラッグパンを受ける。 */
  containerCls: string;
  /** 拡大縮小される中身の箱のクラス。 */
  contentCls: string;
  /** 中身 (テンプレート・要素)。 */
  content: unknown;
  /** 倍率が変わったとき。 */
  onScaleChange?: (scale: number) => void;
};

export type CvDiagramViewport = HTMLElement &
  CvDiagramViewportProps &
  DiagramViewportControls & {
    /** 中身の箱 (描いた図を測るときに使う)。 */
    contentBox(): HTMLElement | null;
  };

export function defineCvDiagramViewport(): void {
  defineElement(
    CV_DIAGRAM_VIEWPORT,
    (Base) =>
      class extends Base {
        static props = ["containerCls", "contentCls", "content"];
        declare containerCls: string;
        declare contentCls: string;
        declare content: unknown;
        onScaleChange: CvDiagramViewportProps["onScaleChange"];
        #controls: DiagramViewportControls | null = null;
        // つながる前に押されたズームは、つながった時の倍率として持っておく。
        #scale = 1;

        protected template() {
          return html`<div class=${this.containerCls}><div class=${this.contentCls}>${this.content}</div></div>`;
        }

        protected rendered(): void {
          if (this.#controls) return;
          const container = this.firstElementChild as HTMLElement | null;
          const content = container?.firstElementChild as HTMLElement | null;
          if (!container || !content) return;
          this.#controls = attachDiagramViewport(container, content, {
            onScaleChange: (scale) => {
              this.#scale = scale;
              this.onScaleChange?.(scale);
            },
          });
          if (this.#scale !== 1) this.#controls.zoomTo(this.#scale);
        }

        disconnectedCallback(): void {
          super.disconnectedCallback();
          this.#controls?.dispose();
          this.#controls = null;
        }

        contentBox(): HTMLElement | null {
          return (this.firstElementChild?.firstElementChild ??
            null) as HTMLElement | null;
        }

        zoomIn(): void {
          this.#controls?.zoomIn();
        }
        zoomOut(): void {
          this.#controls?.zoomOut();
        }
        reset(): void {
          this.#controls?.reset();
        }
        zoomTo(scale: number): void {
          if (this.#controls) this.#controls.zoomTo(scale);
          else this.#scale = scale;
        }
        scale(): number {
          return this.#controls?.scale() ?? this.#scale;
        }
        dispose(): void {
          this.#controls?.dispose();
          this.#controls = null;
        }
      },
  );
}
