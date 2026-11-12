import { html, nothing } from "lit/html.js";
import { FILE_16_PATH } from "../../core/icons";
import { iconTemplate } from "../ui/icon";
import { templateElement } from "../ui/renderer";

/** 読み込み中・失敗などの 1 行の札 (失敗は db-pane-error、ほかは db-pane-note)。 */
export function paneStatusTemplate(message: string, error = false): unknown {
  return html`<div class=${error ? "db-pane-error" : "db-pane-note"}
    >${message}</div
  >`;
}

export function setPaneStatus(
  el: HTMLElement,
  message: string,
  options: { error?: boolean; afterClear?: () => void } = {},
): void {
  el.replaceChildren();
  options.afterClear?.();
  el.appendChild(templateElement(paneStatusTemplate(message, options.error)));
}

export type PaneEmptyOptions = { hint?: string; iconPath?: string | string[] };

// 「何かを選択してください」系の空状態を、各 explorer の詳細/プレビュー pane で
// 統一されたデザイン (中央寄せのアイコン + メッセージ) で表示する。
export function paneEmptyTemplate(
  message: string,
  options: PaneEmptyOptions = {},
): unknown {
  return html`<div class="db-pane-empty"><div class="db-pane-empty-icon">${iconTemplate(
    options.iconPath ?? FILE_16_PATH,
    "octicon",
  )}</div><div class="db-pane-empty-title">${message}</div>${
    options.hint
      ? html`<div class="db-pane-empty-hint">${options.hint}</div>`
      : nothing
  }</div>`;
}

export function setPaneEmpty(
  el: HTMLElement,
  message: string,
  options: PaneEmptyOptions = {},
): void {
  el.replaceChildren(templateElement(paneEmptyTemplate(message, options)));
}
