// cv-empty-state: 空の状態の案内 (何も無い場所で、次に何をするか)。絵・一行・
// 補足・主な操作のボタン (2 つまで)・主なキー (3 つまでをキーキャップで) を縦に
// 並べる。形は既存の .empty (Diff が空のとき・裏の起動の案内と同じ部品) を使い、
// キーの行だけを足す (style.css の「空の状態の案内」の節)。文言は呼び出し側が
// 自分の i18n から渡す (ここは言語を持たない)。

import { html, nothing, render } from "lit/html.js";
import { ifDefined } from "lit/directives/if-defined.js";
import { defineElement } from "./element";
import { iconTemplate } from "./icon";

export const CV_EMPTY_STATE = "cv-empty-state";

export type EmptyStateAction = {
  label: string;
  run(): void;
  /** 主な操作 (塗りのボタン)。無ければ枠のボタン。 */
  primary?: boolean;
  title?: string;
};

export type EmptyStateKey = {
  /**
   * キーの並び。空白で区切ると別のキーキャップ (順に押す: `g d`)、`+` で
   * つないだものは 1 つのキーキャップ (同時に押す: `⌘K`・`Ctrl+\``)。
   */
  keys: string;
  label: string;
};

export type EmptyStateOptions = {
  /** 絵の path (core/icons.ts の定数)。 */
  icon?: string | string[];
  title: string;
  hint?: string;
  actions?: readonly EmptyStateAction[];
  keys?: readonly EmptyStateKey[];
  /** キーの一覧の名前 (読み上げ用)。keys を渡すときは必須。 */
  keysLabel?: string;
  /** 画面の一部に置く (余白を詰める)。画面いっぱいなら false。 */
  compact?: boolean;
};

/** 操作は 2 つ、キーは 3 つまで (それより多いと「次にやること」がぼやける)。 */
export const EMPTY_STATE_MAX_ACTIONS = 2;
export const EMPTY_STATE_MAX_KEYS = 3;

/** 案内のテンプレート。数の決まりを外れたら投げる。 */
export function emptyStateTemplate(options: EmptyStateOptions): unknown {
  const actions = options.actions ?? [];
  const keys = options.keys ?? [];
  if (actions.length > EMPTY_STATE_MAX_ACTIONS)
    throw new Error(
      `empty state "${options.title}": ${actions.length} actions (at most ${EMPTY_STATE_MAX_ACTIONS})`,
    );
  if (keys.length > EMPTY_STATE_MAX_KEYS)
    throw new Error(
      `empty state "${options.title}": ${keys.length} keys (at most ${EMPTY_STATE_MAX_KEYS})`,
    );
  if (keys.length > 0 && !options.keysLabel)
    throw new Error(`empty state "${options.title}": keys need a keysLabel`);

  const cls = [
    "empty",
    "empty-with-actions",
    "empty-state",
    ...(options.compact ? ["empty-compact"] : []),
  ].join(" ");
  return html`<section class=${cls}>${
    options.icon
      ? html`<div class="empty-icon" aria-hidden="true">${iconTemplate(options.icon)}</div>`
      : nothing
  }<h2>${options.title}</h2>${options.hint ? html`<p>${options.hint}</p>` : nothing}${
    actions.length > 0
      ? html`<div class="empty-actions">${actions.map(
          (action) =>
            html`<button
              type="button"
              class=${action.primary ? "empty-action empty-action-primary" : "empty-action"}
              title=${ifDefined(action.title || undefined)}
              @click=${() => action.run()}
            ><span class="empty-action-label">${action.label}</span></button>`,
        )}</div>`
      : nothing
  }${
    keys.length > 0
      ? // キーの説明は指の画面では出さない (style.css の gdp-key-hint)。
        html`<dl class="empty-keys gdp-key-hint" aria-label=${options.keysLabel as string}>${keys.map(
          (key) =>
            html`<div class="empty-key"><dt>${key.keys
              .split(/\s+/)
              .map(
                (part, index) =>
                  html`${index > 0 ? " " : nothing}<kbd>${part}</kbd>`,
              )}</dt><dd>${key.label}</dd></div>`,
        )}</dl>`
      : nothing
  }</section>`;
}

/**
 * まだ宣言的に描いていない画面のための、案内の要素を 1 つ返す形。
 * 宣言的に描く画面は <cv-empty-state .options=${…}> を使う。
 */
export function renderEmptyState(options: EmptyStateOptions): HTMLElement {
  const fragment = document.createDocumentFragment();
  render(emptyStateTemplate(options), fragment);
  return fragment.querySelector("section") as HTMLElement;
}

export function defineCvEmptyState(): void {
  defineElement(
    CV_EMPTY_STATE,
    (Base) =>
      class CvEmptyState extends Base {
        static props = ["options"];
        declare options: EmptyStateOptions;

        protected template() {
          return this.options ? emptyStateTemplate(this.options) : nothing;
        }
      },
  );
}
