import { FILE_16_PATH, iconSvg } from "../../core/icons";

export function setPaneStatus(
  el: HTMLElement,
  message: string,
  options: { error?: boolean; afterClear?: () => void } = {},
): void {
  el.innerHTML = "";
  options.afterClear?.();
  const note = document.createElement("div");
  note.className = options.error ? "db-pane-error" : "db-pane-note";
  note.textContent = message;
  el.appendChild(note);
}

// 「何かを選択してください」系の空状態を、各 explorer の詳細/プレビュー pane で
// 統一されたデザイン (中央寄せのアイコン + メッセージ) で表示する。
export function setPaneEmpty(
  el: HTMLElement,
  message: string,
  options: { hint?: string; iconPath?: string | string[] } = {},
): void {
  el.innerHTML = "";
  const empty = document.createElement("div");
  empty.className = "db-pane-empty";
  const icon = document.createElement("div");
  icon.className = "db-pane-empty-icon";
  icon.innerHTML = iconSvg("octicon", options.iconPath ?? FILE_16_PATH);
  const title = document.createElement("div");
  title.className = "db-pane-empty-title";
  title.textContent = message;
  empty.append(icon, title);
  if (options.hint) {
    const hint = document.createElement("div");
    hint.className = "db-pane-empty-hint";
    hint.textContent = options.hint;
    empty.appendChild(hint);
  }
  el.appendChild(empty);
}
