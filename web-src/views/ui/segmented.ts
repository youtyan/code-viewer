// cv-segmented: 排他の切替を横に並べたもの (web/style.css の .seg)。中は
// <div class="seg" role="group"> に標準の <button> を直に並べる (.seg button + button
// の規則がそのまま効くよう、ボタンを cv-button で包まない)。
//
// 押したら cv-select (detail: { value }) を出す。今の値を押しても出す
// (今の値を押し直したときの扱いは使う側が決める)。

import { ifDefined } from "lit/directives/if-defined.js";
import { html, nothing } from "lit/html.js";
import { defineElement } from "./element";

export const CV_SEGMENTED = "cv-segmented";

export type CvSegmentedOption = {
  value: string;
  label: string;
  title?: string;
  disabled?: boolean;
};

export type CvSegmentedProps = {
  options: readonly CvSegmentedOption[];
  value: string;
  /** .seg の後ろに足すクラス。 */
  cls?: string;
  /** 並び全体の名前 (aria-label)。 */
  label?: string;
  /** 各ボタンに aria-pressed を付けるか。 */
  marksPressed?: boolean;
};

export type CvSelectEvent = CustomEvent<{ value: string }>;

export function defineCvSegmented(): void {
  defineElement(
    CV_SEGMENTED,
    (Base) =>
      class CvSegmented extends Base {
        static props = ["options", "value", "cls", "label", "marksPressed"];
        declare options: CvSegmentedProps["options"];
        declare value: CvSegmentedProps["value"];
        declare cls: CvSegmentedProps["cls"];
        declare label: CvSegmentedProps["label"];
        declare marksPressed: CvSegmentedProps["marksPressed"];

        protected template() {
          const pressed = Boolean(this.marksPressed);
          return html`<div
            class=${this.cls ? `seg ${this.cls}` : "seg"}
            role="group"
            aria-label=${ifDefined(this.label || undefined)}
          >${(this.options ?? []).map(
            (option) => html`<button
              type="button"
              class=${option.value === this.value ? "active" : ""}
              title=${ifDefined(option.title || undefined)}
              aria-pressed=${pressed ? String(option.value === this.value) : nothing}
              ?disabled=${!!option.disabled}
              @click=${() =>
                this.dispatchEvent(
                  new CustomEvent("cv-select", {
                    detail: { value: option.value },
                  }),
                )}
            >${option.label}</button>`,
          )}</div>`;
        }
      },
  );
}
