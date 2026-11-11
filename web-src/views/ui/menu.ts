// cv-menu: 浮くメニューの中身 (web/style.css の .gdp-context-menu)。項目は標準の
// <button>、区切りは <hr>。開く・閉じる・置く場所・キー操作は使う側
// (views/context-menu.ts の showContextMenu) が持つ。
//
// キーの割り当ては出さない (OS や環境でキーが違い、OS の決まりともぶつかる。
// キーはパレット・ヘルプのキーの一覧・title が示す)。

import { html, nothing } from "lit/html.js";
import { ifDefined } from "lit/directives/if-defined.js";
import { defineElement } from "./element";

export const CV_MENU = "cv-menu";

/** メニュー 1 項目。区切りは `separator` で表す。 */
export type MenuItem =
  | {
      kind?: "item";
      label: string;
      /** ホバーで出す説明。何が起きるかを 1 文で。 */
      title?: string;
      /** 取り返しのつかない操作。`.danger` が付いて色が変わる。 */
      danger?: boolean;
      disabled?: boolean;
      /** 文字の前に置く絵 (プロジェクトの色の四角など。テンプレートか要素)。 */
      leading?: unknown;
      /**
       * 選び方の一覧 (色など) の今の値か。持つ項目は role=menuitemradio に
       * なり、aria-checked で今の値を伝える。
       */
      checked?: boolean;
      onSelect(): void;
    }
  | { kind: "separator" };

export type CvMenuProps = {
  items: readonly MenuItem[];
  /** 位置 (px)。無ければ置かない (測る前)。 */
  position: { left: number; top: number } | null;
  /** 項目にフォーカスやポインタが乗ったとき。index は items の中の位置。 */
  onHighlight?: (index: number) => void;
  /** 項目を押したとき (選ぶ前に呼ぶ)。 */
  onChoose?: () => void;
};

export function defineCvMenu(): void {
  defineElement(
    CV_MENU,
    (Base) =>
      class CvMenu extends Base {
        static props = ["items", "position"];
        declare items: CvMenuProps["items"];
        declare position: CvMenuProps["position"];
        onHighlight: CvMenuProps["onHighlight"];
        onChoose: CvMenuProps["onChoose"];

        protected template() {
          const position = this.position;
          return html`<div
            class="gdp-context-menu"
            role="menu"
            style=${position ? `left: ${position.left}px; top: ${position.top}px;` : nothing}
          >${(this.items ?? []).map((item, index) => {
            if (item.kind === "separator")
              return html`<hr class="gdp-context-menu-sep" />`;
            const cls = [
              item.leading ? "gdp-context-menu-leading" : "",
              item.danger ? "danger" : "",
            ]
              .filter(Boolean)
              .join(" ");
            return html`<button
              type="button"
              class=${ifDefined(cls || undefined)}
              role=${item.checked === undefined ? "menuitem" : "menuitemradio"}
              aria-checked=${item.checked === undefined ? nothing : String(item.checked)}
              title=${ifDefined(item.title || undefined)}
              ?disabled=${!!item.disabled}
              @focus=${() => this.onHighlight?.(index)}
              @pointerenter=${() => this.onHighlight?.(index)}
              @click=${() => {
                this.onChoose?.();
                item.onSelect();
              }}
            >${item.leading ?? nothing}${item.label}</button>`;
          })}</div>`;
        }

        /** 中のメニューの箱 (測るとき・キーで巡るときに使う)。 */
        box(): HTMLElement | null {
          return this.querySelector(".gdp-context-menu");
        }
      },
  );
}
