// cv-resizer: ドラッグと矢印キーで隣の面の大きさを変えるつまみ。中は
// <div role="separator" tabindex="0">。ポインタとキーの扱いは
// core/drag-resizer.ts の attachDragResizer をそのまま使う (つながっている間だけ)。

import { html } from "lit/html.js";
import { ifDefined } from "lit/directives/if-defined.js";
import { attachDragResizer } from "../../core/drag-resizer";
import { defineElement } from "./element";

export const CV_RESIZER = "cv-resizer";

export type CvResizerProps = {
  /** つまみの <div> のクラス。 */
  cls: string;
  /** つまみの名前 (aria-label)。 */
  label?: string;
  /** "x" は左右 (縦の仕切り)、"y" は上下 (横の仕切り)。既定は "x"。 */
  axis?: "x" | "y";
  /** つまみを右 (y なら下) へ動かすと大きくなるなら 1、小さくなるなら -1。 */
  direction: 1 | -1;
  /** 動かし始めの大きさ。 */
  getSize: () => number;
  /** 求めた大きさを当てる (上限・下限はここで決める)。 */
  applySize: (size: number) => void;
  /** 動かし終わったとき (覚えるならここ)。 */
  onEnd?: () => void;
  keyboardStep?: number;
  /** 動かしている間だけ activeClassName を付ける要素。 */
  activeTarget?: () => HTMLElement | null;
  activeClassName?: string;
};

export function defineCvResizer(): void {
  defineElement(
    CV_RESIZER,
    (Base) =>
      class CvResizer extends Base {
        static props = ["cls", "label", "axis"];
        declare cls: CvResizerProps["cls"];
        declare label: CvResizerProps["label"];
        declare axis: CvResizerProps["axis"];
        // 下の関数は描き直しを起こさない (つまみの見た目は変わらない)。
        direction: CvResizerProps["direction"] = 1;
        getSize: CvResizerProps["getSize"] = () => 0;
        applySize: CvResizerProps["applySize"] = () => undefined;
        onEnd: CvResizerProps["onEnd"];
        keyboardStep: CvResizerProps["keyboardStep"];
        activeTarget: CvResizerProps["activeTarget"];
        activeClassName: CvResizerProps["activeClassName"];
        #detach: (() => void) | null = null;

        protected template() {
          return html`<div
            class=${this.cls}
            role="separator"
            tabindex="0"
            aria-orientation=${this.axis === "y" ? "horizontal" : "vertical"}
            aria-label=${ifDefined(this.label || undefined)}
          ></div>`;
        }

        protected rendered(): void {
          if (this.#detach) return;
          const handle = this.firstElementChild as HTMLElement | null;
          if (!handle) return;
          // 設定は呼ばれた時点の property を読む (後から差し替えても効く)。
          const activeTarget = this.activeTarget?.() ?? undefined;
          this.#detach = attachDragResizer({
            handle,
            axis: this.axis,
            direction: this.direction,
            getSize: () => this.getSize(),
            applySize: (size) => this.applySize(size),
            onEnd: () => this.onEnd?.(),
            keyboardStep: this.keyboardStep,
            activeClassTarget: activeTarget,
            activeClassName: this.activeClassName,
          });
        }

        disconnectedCallback(): void {
          super.disconnectedCallback();
          this.#detach?.();
          this.#detach = null;
        }
      },
  );
}
