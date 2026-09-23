// 空の状態の案内 (何も無い場所で、次に何をするか)。絵・一行・補足・主な操作の
// ボタン (2 つまで)・主なキー (3 つまでをキーキャップで) を縦に並べる。
// 形は既存の .empty (Diff が空のとき・裏の起動の案内と同じ部品) を使い、キーの
// 行だけを足す (style.css の「空の状態の案内」の節)。文言は呼び出し側が自分の
// i18n から渡す (ここは言語を持たない)。

import { iconSvg } from "../core/icons";

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

export function renderEmptyState(options: EmptyStateOptions): HTMLElement {
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

  const box = document.createElement("section");
  box.className = [
    "empty",
    "empty-with-actions",
    "empty-state",
    ...(options.compact ? ["empty-compact"] : []),
  ].join(" ");
  if (options.icon) {
    const icon = document.createElement("div");
    icon.className = "empty-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.innerHTML = iconSvg("octicon", options.icon);
    box.appendChild(icon);
  }
  const title = document.createElement("h2");
  title.textContent = options.title;
  box.appendChild(title);
  if (options.hint) {
    const hint = document.createElement("p");
    hint.textContent = options.hint;
    box.appendChild(hint);
  }
  if (actions.length > 0) {
    const row = document.createElement("div");
    row.className = "empty-actions";
    for (const action of actions) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = action.primary
        ? "empty-action empty-action-primary"
        : "empty-action";
      const label = document.createElement("span");
      label.className = "empty-action-label";
      label.textContent = action.label;
      button.appendChild(label);
      if (action.title) button.title = action.title;
      button.addEventListener("click", () => action.run());
      row.appendChild(button);
    }
    box.appendChild(row);
  }
  if (keys.length > 0) {
    const list = document.createElement("dl");
    list.className = "empty-keys";
    list.setAttribute("aria-label", options.keysLabel as string);
    for (const key of keys) {
      const item = document.createElement("div");
      item.className = "empty-key";
      const term = document.createElement("dt");
      for (const [index, part] of key.keys.split(/\s+/).entries()) {
        if (index > 0) term.append(" ");
        const cap = document.createElement("kbd");
        cap.textContent = part;
        term.appendChild(cap);
      }
      const desc = document.createElement("dd");
      desc.textContent = key.label;
      item.append(term, desc);
      list.appendChild(item);
    }
    box.appendChild(list);
  }
  return box;
}
