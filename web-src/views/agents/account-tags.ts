// アカウントに付けたタグの札 (全体ボードの行・アカウントのカード・設定の
// アカウントの表) と、タグの小窓の入力欄。色はプロジェクトの色の名前
// (core/project-colors.ts) をそのまま使い、札の地と文字の濃さはプロジェクトの
// 頭文字の四角と同じ (style.css の .account-tag)。
//
// 入力欄 (createAccountTagEditor):
//
//   ┌────────────────────────────────────────┐
//   │ [仕事 ×] [検証 ×]  タグを入力して Enter   │  打って Enter・読点・カンマで足す
//   └────────────────────────────────────────┘  空の欄の Backspace で最後を消す
//   「検証」の色  ○ ● ● ● ● ● ● ● ● ●          札を押すとその札の色を選ぶ
//   ほかのアカウントのタグ  [api]                 押すと足す (その色のまま)

import {
  type AccountTag,
  MAX_ACCOUNT_TAG,
  MAX_ACCOUNT_TAGS,
} from "../../core/agent-accounts";
import { iconSvg, X_16_PATH } from "../../core/icons";
import { isImeComposing } from "../../core/keyboard";
import { PROJECT_COLORS, type ProjectColor } from "../../core/project-colors";
import { paintProjectColor } from "../projects/project-looks";
import type { AccountsText } from "./accounts-i18n";

/** タグ 1 つの札。 */
export function accountTagChip(tag: AccountTag): HTMLElement {
  const chip = document.createElement("span");
  chip.className = "account-tag";
  chip.textContent = tag.name;
  paintProjectColor(chip, tag.color);
  return chip;
}

/** タグの札を並べたもの。タグが無ければ null。 */
export function accountTagList(
  tags: readonly AccountTag[] | undefined,
): HTMLElement | null {
  if (!tags?.length) return null;
  const list = document.createElement("span");
  list.className = "account-tags";
  list.append(...tags.map(accountTagChip));
  return list;
}

export type AccountTagEditor = {
  element: HTMLElement;
  input: HTMLInputElement;
  /** 今のタグ。欄に打ちかけの名前があれば、それも足した形で返す (保存で落とさない)。 */
  value(): AccountTag[];
};

const ADD_KEYS = new Set(["Enter", ",", "、"]);

function button(className: string): HTMLButtonElement {
  const node = document.createElement("button");
  node.type = "button";
  node.className = className;
  return node;
}

export function createAccountTagEditor(options: {
  tags: readonly AccountTag[];
  /** ほかのアカウントで使っているタグと、その色。 */
  others: ReadonlyMap<string, ProjectColor | null>;
  text: AccountsText;
}): AccountTagEditor {
  const t = options.text;
  const tags = options.tags.map((tag) => ({ ...tag }));
  /** 色を選ぶ札 (無ければ -1)。 */
  let selected = tags.length > 0 ? 0 : -1;

  const field = document.createElement("div");
  field.className = "account-tags-field";
  const input = document.createElement("input");
  input.type = "text";
  input.className = "account-tags-input";
  input.maxLength = MAX_ACCOUNT_TAG;
  input.spellcheck = false;
  input.autocomplete = "off";
  input.setAttribute("aria-label", t.tagName);
  // 札と札の間の空いた所を押しても打てるようにする。
  field.addEventListener("click", (event) => {
    if (event.target === field) input.focus();
  });

  const colors = document.createElement("div");
  colors.className = "account-tags-colors";
  const colorLabel = document.createElement("span");
  colorLabel.className = "account-tags-label";
  const swatches = document.createElement("span");
  swatches.className = "account-tags-swatches";
  colors.append(colorLabel, swatches);

  const others = document.createElement("div");
  others.className = "account-tags-others";
  const othersLabel = document.createElement("span");
  othersLabel.className = "account-tags-label";
  othersLabel.textContent = t.tagUsed;
  const othersList = document.createElement("span");
  othersList.className = "account-tags-chips";
  others.append(othersLabel, othersList);

  const element = document.createElement("div");
  element.className = "account-tags-editor";
  element.append(field, colors, others);

  function indexOf(name: string): number {
    const key = name.trim().toLocaleLowerCase();
    return tags.findIndex((tag) => tag.name.toLocaleLowerCase() === key);
  }

  /** 足す。同じ名前が既にあれば、それを選ぶだけ。 */
  function add(name: string, color: ProjectColor | null | undefined): void {
    const tag = name.trim();
    if (!tag) return;
    const existing = indexOf(tag);
    if (existing >= 0) {
      selected = existing;
    } else if (tags.length < MAX_ACCOUNT_TAGS) {
      tags.push({ name: tag, color: color ?? options.others.get(tag) ?? null });
      selected = tags.length - 1;
    }
    render();
  }

  function remove(index: number): void {
    tags.splice(index, 1);
    if (selected >= tags.length) selected = tags.length - 1;
    render();
    input.focus();
  }

  function chip(tag: AccountTag, index: number): HTMLElement {
    const box = accountTagChip(tag);
    box.textContent = "";
    box.classList.add("account-tag-editable");
    box.classList.toggle("is-selected", index === selected);
    const pick = button("account-tag-pick");
    pick.textContent = tag.name;
    pick.title = t.tagColorFor(tag.name);
    pick.setAttribute("aria-pressed", String(index === selected));
    pick.addEventListener("click", () => {
      selected = index;
      render();
    });
    const drop = button("account-tag-remove");
    drop.innerHTML = iconSvg("account-tag-remove-icon", X_16_PATH);
    drop.title = t.tagRemove(tag.name);
    drop.setAttribute("aria-label", drop.title);
    drop.addEventListener("click", () => remove(index));
    box.append(pick, drop);
    return box;
  }

  function swatch(color: ProjectColor | null): HTMLButtonElement {
    const node = button("account-tag-swatch");
    paintProjectColor(node, color);
    const name = color ? t.colorNames[color] : t.tagNoColor;
    node.title = name;
    node.setAttribute("aria-label", name);
    node.setAttribute(
      "aria-pressed",
      String((tags[selected]?.color ?? null) === color),
    );
    node.addEventListener("click", () => {
      const target = tags[selected];
      if (!target) return;
      target.color = color;
      render();
    });
    return node;
  }

  function render(): void {
    const full = tags.length >= MAX_ACCOUNT_TAGS;
    field.replaceChildren(...tags.map(chip), input);
    input.disabled = full;
    input.placeholder = full ? t.tagFull(MAX_ACCOUNT_TAGS) : t.tagPlaceholder;
    const target = tags[selected];
    colors.hidden = !target;
    if (target) {
      colorLabel.textContent = t.tagColorFor(target.name);
      swatches.replaceChildren(swatch(null), ...PROJECT_COLORS.map(swatch));
    }
    const rest = [...options.others].filter(([name]) => indexOf(name) < 0);
    others.hidden = rest.length === 0;
    othersList.replaceChildren(
      ...rest.map(([name, color]) => {
        const pick = button("account-tags-suggest");
        pick.disabled = full;
        pick.appendChild(accountTagChip({ name, color }));
        pick.addEventListener("click", () => {
          add(name, color);
          input.focus();
        });
        return pick;
      }),
    );
  }

  input.addEventListener("keydown", (event) => {
    if (isImeComposing(event)) return;
    if (ADD_KEYS.has(event.key) && input.value.trim()) {
      // 小窓の Enter (保存) まで届かせない。空の欄の Enter は保存のまま。
      event.preventDefault();
      event.stopPropagation();
      add(input.value, undefined);
      input.value = "";
      return;
    }
    if (event.key === "Backspace" && !input.value && tags.length > 0)
      remove(tags.length - 1);
  });

  render();
  return {
    element,
    input,
    value() {
      const pending = input.value.trim();
      return pending && indexOf(pending) < 0
        ? [
            ...tags,
            { name: pending, color: options.others.get(pending) ?? null },
          ]
        : tags.map((tag) => ({ ...tag }));
    },
  };
}
