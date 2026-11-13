// cv-button: ボタン 1 つ。中は標準の <button type="button">。
//
// 種類 (主・薄塗り・枠線・小・文字だけ・アイコン) は、置き場所のクラス (cls) が
// web/style.css の「ボタンの種類」の節の並びに入っていることで決まる。この部品は
// 色を持たない。押したことは中の <button> の click がそのまま外へ届く
// (無効の間は届かない)。

import { ifDefined } from "lit/directives/if-defined.js";
import { html, nothing } from "lit/html.js";
import { defineElement } from "./element";
import { iconTemplate } from "./icon";

export const CV_BUTTON = "cv-button";

export type CvButtonProps = {
  /** 中の <button> のクラス。種類はこのクラスで決まる。 */
  cls?: string;
  label?: string;
  /** 説明の吹き出し (title 属性)。 */
  title?: string;
  /** 文字の無いボタンの名前 (aria-label)。 */
  ariaLabel?: string;
  /** 文字の前に置く絵 (core/icons.ts の path)。 */
  icon?: string | readonly string[];
  /** 絵のクラス (octicon の後ろに足す)。 */
  iconCls?: string;
  disabled?: boolean;
  /** 押されている間か。undefined なら aria-pressed を付けない。 */
  pressed?: boolean;
  /** 選んでいる印の active クラスを付けるか。 */
  active?: boolean;
};

export function defineCvButton(): void {
  defineElement(
    CV_BUTTON,
    (Base) =>
      class CvButton extends Base {
        static props = [
          "cls",
          "label",
          "title",
          "ariaLabel",
          "icon",
          "iconCls",
          "disabled",
          "pressed",
          "active",
        ];
        declare cls: CvButtonProps["cls"];
        declare label: CvButtonProps["label"];
        declare title: string;
        declare ariaLabel: string | null;
        declare icon: CvButtonProps["icon"];
        declare iconCls: CvButtonProps["iconCls"];
        declare disabled: CvButtonProps["disabled"];
        declare pressed: CvButtonProps["pressed"];
        declare active: CvButtonProps["active"];

        protected template() {
          const cls = [this.cls, this.active ? "active" : ""]
            .filter(Boolean)
            .join(" ");
          return html`<button
            type="button"
            class=${ifDefined(cls || undefined)}
            title=${ifDefined(this.title || undefined)}
            aria-label=${ifDefined(this.ariaLabel || undefined)}
            aria-pressed=${this.pressed === undefined ? nothing : String(this.pressed)}
            ?disabled=${!!this.disabled}
          >${this.icon ? iconTemplate(this.icon, this.iconCls) : nothing}${this.label ?? nothing}</button>`;
        }

        /** 中のボタンにフォーカスを移す。 */
        focus(options?: FocusOptions): void {
          this.querySelector("button")?.focus(options);
        }
      },
  );
}
