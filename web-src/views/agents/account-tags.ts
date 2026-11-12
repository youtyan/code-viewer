// アカウントに付けたタグの札 (全体ボードの行・アカウントのカード・設定の
// アカウントの表) と、タグの小窓の入力欄。色はプロジェクトの色の名前
// (core/project-colors.ts) をそのまま使い、札の地と文字の濃さはプロジェクトの
// 頭文字の四角と同じ (style.css の .account-tag)。
//
// 入力欄 (cv-account-tags-editor。createAccountTagEditor が作る):
//
//   ┌────────────────────────────────────────┐
//   │ [仕事 ×] [検証 ×]  タグを入力して Enter   │  打って Enter・読点・カンマで足す
//   └────────────────────────────────────────┘  空の欄の Backspace で最後を消す
//   「検証」の色  ○ ● ● ● ● ● ● ● ● ●          札を押すとその札の色を選ぶ
//   ほかのアカウントのタグ  [api]                 押すと足す (その色のまま)

import { html, nothing, type TemplateResult } from "lit/html.js";
import {
  type AccountTag,
  MAX_ACCOUNT_TAG,
  MAX_ACCOUNT_TAGS,
} from "../../core/agent-accounts";
import { X_16_PATH } from "../../core/icons";
import { isImeComposing } from "../../core/keyboard";
import { PROJECT_COLORS, type ProjectColor } from "../../core/project-colors";
import { defineElement } from "../ui/element";
import { iconTemplate } from "../ui/icon";
import { templateElement } from "../ui/renderer";
import type { AccountsText } from "./accounts-i18n";

export const CV_ACCOUNT_TAGS_EDITOR = "cv-account-tags-editor";

/** タグ 1 つの札。 */
export function accountTagChipTemplate(tag: AccountTag): TemplateResult {
  return html`<span
    class="account-tag"
    data-project-color=${tag.color ?? "none"}
  >${tag.name}</span>`;
}

/** タグの札を並べたもの。タグが無ければ何も出さない。 */
export function accountTagListTemplate(
  tags: readonly AccountTag[] | undefined,
): TemplateResult | typeof nothing {
  if (!tags?.length) return nothing;
  return html`<span class="account-tags">${tags.map(accountTagChipTemplate)}</span>`;
}

/**
 * まだ宣言的に描いていない画面のための、札の並びの要素を返す形。タグが無ければ
 * null。宣言的に描く画面は accountTagListTemplate を使う。
 */
export function accountTagList(
  tags: readonly AccountTag[] | undefined,
): HTMLElement | null {
  if (!tags?.length) return null;
  return templateElement(accountTagListTemplate(tags));
}

export type AccountTagEditor = {
  element: HTMLElement;
  input: HTMLInputElement;
  /** 今のタグ。欄に打ちかけの名前があれば、それも足した形で返す (保存で落とさない)。 */
  value(): AccountTag[];
};

type CvAccountTagsEditor = HTMLElement & {
  tags: readonly AccountTag[];
  others: ReadonlyMap<string, ProjectColor | null>;
  text: AccountsText;
  value(): AccountTag[];
  input(): HTMLInputElement | null;
};

const ADD_KEYS = new Set(["Enter", ",", "、"]);

export function defineCvAccountTagsEditor(): void {
  defineElement(
    CV_ACCOUNT_TAGS_EDITOR,
    (Base) =>
      class extends Base {
        static props = ["text"];
        declare text: AccountsText;
        others: ReadonlyMap<string, ProjectColor | null> = new Map();
        #tags: AccountTag[] = [];
        /** 色を選ぶ札 (無ければ -1)。 */
        #selected = -1;

        /** 始めのタグ (受け取ったときに写す。以後はこの部品が持つ)。 */
        set tags(next: readonly AccountTag[]) {
          this.#tags = next.map((tag) => ({ ...tag }));
          this.#selected = this.#tags.length > 0 ? 0 : -1;
          this.requestRender();
        }
        get tags(): readonly AccountTag[] {
          return this.#tags;
        }

        input(): HTMLInputElement | null {
          return this.querySelector(".account-tags-input");
        }

        #indexOf(name: string): number {
          const key = name.trim().toLocaleLowerCase();
          return this.#tags.findIndex(
            (tag) => tag.name.toLocaleLowerCase() === key,
          );
        }

        /** 足す。同じ名前が既にあれば、それを選ぶだけ。 */
        #add(name: string, color: ProjectColor | null | undefined): void {
          const tag = name.trim();
          if (!tag) return;
          const existing = this.#indexOf(tag);
          if (existing >= 0) {
            this.#selected = existing;
          } else if (this.#tags.length < MAX_ACCOUNT_TAGS) {
            this.#tags.push({
              name: tag,
              color: color ?? this.others.get(tag) ?? null,
            });
            this.#selected = this.#tags.length - 1;
          }
          this.renderNow();
        }

        #remove(index: number): void {
          this.#tags.splice(index, 1);
          if (this.#selected >= this.#tags.length)
            this.#selected = this.#tags.length - 1;
          this.renderNow();
          this.input()?.focus();
        }

        value(): AccountTag[] {
          const pending = this.input()?.value.trim() ?? "";
          return pending && this.#indexOf(pending) < 0
            ? [
                ...this.#tags,
                { name: pending, color: this.others.get(pending) ?? null },
              ]
            : this.#tags.map((tag) => ({ ...tag }));
        }

        #onKeydown = (event: KeyboardEvent) => {
          if (isImeComposing(event)) return;
          const input = event.currentTarget as HTMLInputElement;
          if (ADD_KEYS.has(event.key) && input.value.trim()) {
            // 小窓の Enter (保存) まで届かせない。空の欄の Enter は保存のまま。
            event.preventDefault();
            event.stopPropagation();
            this.#add(input.value, undefined);
            input.value = "";
            return;
          }
          if (
            event.key === "Backspace" &&
            !input.value &&
            this.#tags.length > 0
          )
            this.#remove(this.#tags.length - 1);
        };

        #chip(tag: AccountTag, index: number): TemplateResult {
          const t = this.text;
          const selected = index === this.#selected;
          return html`<span
            class=${selected ? "account-tag account-tag-editable is-selected" : "account-tag account-tag-editable"}
            data-project-color=${tag.color ?? "none"}
          ><button
            type="button"
            class="account-tag-pick"
            title=${t.tagColorFor(tag.name)}
            aria-pressed=${String(selected)}
            @click=${() => {
              this.#selected = index;
              this.renderNow();
            }}
          >${tag.name}</button><button
            type="button"
            class="account-tag-remove"
            title=${t.tagRemove(tag.name)}
            aria-label=${t.tagRemove(tag.name)}
            @click=${() => this.#remove(index)}
          >${iconTemplate(X_16_PATH, "account-tag-remove-icon")}</button></span>`;
        }

        #swatch(color: ProjectColor | null): TemplateResult {
          const t = this.text;
          const name = color ? t.colorNames[color] : t.tagNoColor;
          return html`<button
            type="button"
            class="account-tag-swatch"
            data-project-color=${color ?? "none"}
            title=${name}
            aria-label=${name}
            aria-pressed=${String((this.#tags[this.#selected]?.color ?? null) === color)}
            @click=${() => {
              const target = this.#tags[this.#selected];
              if (!target) return;
              target.color = color;
              this.renderNow();
            }}
          ></button>`;
        }

        protected template() {
          const t = this.text;
          if (!t) return nothing;
          const full = this.#tags.length >= MAX_ACCOUNT_TAGS;
          const target = this.#tags[this.#selected];
          const rest = [...this.others].filter(
            ([name]) => this.#indexOf(name) < 0,
          );
          return html`<div class="account-tags-editor"><div
            class="account-tags-field"
            @click=${(event: MouseEvent) => {
              // 札と札の間の空いた所を押しても打てるようにする。
              if (event.target === event.currentTarget) this.input()?.focus();
            }}
          >${this.#tags.map((tag, index) => this.#chip(tag, index))}<input
            type="text"
            class="account-tags-input"
            maxlength=${MAX_ACCOUNT_TAG}
            spellcheck="false"
            autocomplete="off"
            aria-label=${t.tagName}
            ?disabled=${full}
            placeholder=${full ? t.tagFull(MAX_ACCOUNT_TAGS) : t.tagPlaceholder}
            @keydown=${this.#onKeydown}
          /></div><div class="account-tags-colors" ?hidden=${!target}><span
            class="account-tags-label"
          >${target ? t.tagColorFor(target.name) : ""}</span><span class="account-tags-swatches">${
            target
              ? [
                  this.#swatch(null),
                  ...PROJECT_COLORS.map((c) => this.#swatch(c)),
                ]
              : nothing
          }</span></div><div class="account-tags-others" ?hidden=${rest.length === 0}><span
            class="account-tags-label"
          >${t.tagUsed}</span><span class="account-tags-chips">${rest.map(
            ([name, color]) => html`<button
              type="button"
              class="account-tags-suggest"
              ?disabled=${full}
              @click=${() => {
                this.#add(name, color);
                this.input()?.focus();
              }}
            >${accountTagChipTemplate({ name, color })}</button>`,
          )}</span></div></div>`;
        }
      },
  );
}

/** タグの小窓の入力欄 (部品 cv-account-tags-editor) を作る。 */
export function createAccountTagEditor(options: {
  tags: readonly AccountTag[];
  /** ほかのアカウントで使っているタグと、その色。 */
  others: ReadonlyMap<string, ProjectColor | null>;
  text: AccountsText;
}): AccountTagEditor {
  defineCvAccountTagsEditor();
  const element = templateElement<CvAccountTagsEditor>(
    html`<cv-account-tags-editor
      .others=${options.others}
      .tags=${options.tags}
      .text=${options.text}
    ></cv-account-tags-editor>`,
  );
  // 置いてから描く部品なので、入力の欄を今ここで描いておく (小窓が最初に焦点を置く)。
  (element as unknown as { renderNow(): void }).renderNow();
  const input = element.input();
  if (!input) throw new Error("account tags editor: the input was not drawn");
  return {
    element,
    input,
    value: () => element.value(),
  };
}
