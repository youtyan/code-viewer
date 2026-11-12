// cv-icon: 絵 1 つ。中は <svg class="octicon …"> に core/icons.ts の path を入れたもの。
// 大きさは web/style.css のアイコンの段 (--icon-*) が決める。

import { html, svg } from "lit/html.js";
import { defineElement } from "./element";

export const CV_ICON = "cv-icon";

export type CvIconProps = {
  /** core/icons.ts の path (1 つか複数)。 */
  paths: string | readonly string[];
  /** octicon の後ろに足すクラス。 */
  cls?: string;
};

/** 絵のテンプレート。部品の中 (ボタンの絵など) で、要素を 1 つ増やさずに
 * 絵を置くときに使う。 */
export function iconTemplate(
  paths: string | readonly string[],
  cls?: string,
  /** 絵の元の大きさ (core/icons.ts の path が描かれた枠。12 か 16)。 */
  size: 12 | 16 = 16,
): unknown {
  const list = typeof paths === "string" ? [paths] : paths;
  return html`<svg
    class=${cls ? `octicon ${cls}` : "octicon"}
    viewBox=${`0 0 ${size} ${size}`}
    width=${size}
    height=${size}
    fill="currentColor"
    aria-hidden="true"
  >${list.map((path) => svg`<path fill="currentColor" d=${path}></path>`)}</svg>`;
}

export function defineCvIcon(): void {
  defineElement(
    CV_ICON,
    (Base) =>
      class CvIcon extends Base {
        static props = ["paths", "cls"];
        declare paths: CvIconProps["paths"];
        declare cls: CvIconProps["cls"];

        protected template() {
          return iconTemplate(this.paths ?? [], this.cls);
        }
      },
  );
}
