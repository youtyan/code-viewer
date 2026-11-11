import { html, nothing } from "lit/html.js";
import { FILE_16_PATH } from "../../core/icons";
import { iconTemplate } from "../ui/icon";
import { templateElement } from "../ui/renderer";

export function setPaneStatus(
  el: HTMLElement,
  message: string,
  options: { error?: boolean; afterClear?: () => void } = {},
): void {
  el.replaceChildren();
  options.afterClear?.();
  el.appendChild(
    templateElement(
      html`<div class=${options.error ? "db-pane-error" : "db-pane-note"}
        >${message}</div
      >`,
    ),
  );
}

// 「何かを選択してください」系の空状態を、各 explorer の詳細/プレビュー pane で
// 統一されたデザイン (中央寄せのアイコン + メッセージ) で表示する。
export function setPaneEmpty(
  el: HTMLElement,
  message: string,
  options: { hint?: string; iconPath?: string | string[] } = {},
): void {
  el.replaceChildren(
    templateElement(
      html`<div class="db-pane-empty"><div class="db-pane-empty-icon">${iconTemplate(
        options.iconPath ?? FILE_16_PATH,
        "octicon",
      )}</div><div class="db-pane-empty-title">${message}</div>${
        options.hint
          ? html`<div class="db-pane-empty-hint">${options.hint}</div>`
          : nothing
      }</div>`,
    ),
  );
}
