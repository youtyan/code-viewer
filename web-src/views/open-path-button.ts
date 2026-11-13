// フォルダを OS のファイルの画面で開くボタン (ファイルの頭・左のファイル一覧の
// フォルダの行)。押しても外 (行・頭) の押しには伝えない。

import { html, nothing } from "lit/html.js";
import { OPEN_EXTERNAL_16_PATH } from "../core/icons";
import { iconTemplate } from "./ui/icon";

export function openPathButtonTemplate(
  title: string,
  onOpen: (button: HTMLButtonElement) => void,
  /** 一覧の行の中のボタン。Tab の止まり場所は一覧が決める (行を描くたびに外す)。 */
  rowAction = false,
): unknown {
  return html`<button
    type="button"
    class="gdp-file-header-icon gdp-open-path"
    title=${title}
    aria-label=${title}
    tabindex=${rowAction ? "-1" : nothing}
    data-row-action=${rowAction ? "" : nothing}
    @click=${(event: MouseEvent) => {
      event.stopPropagation();
      onOpen(event.currentTarget as HTMLButtonElement);
    }}
  >${iconTemplate(OPEN_EXTERNAL_16_PATH, "octicon-link-external")}</button>`;
}
