// History・作業ツリーの変更ファイルの木を畳んだ帯の「開く」ボタン
// (ui-layout.md の「一覧の列と右の列」)。押す (Enter / Space も button なので
// 同じ) と木を開き、開いた木の止まり場所の行 (選んでいる行、無ければ先頭の行)
// へフォーカスを移す。Tab の順が見た目の位置 (一覧 → 木 → 本文) と合うよう、
// 木 (#sidebar) の直後に置く。

import { iconSvg, SIDEBAR_SHOW_16_PATHS } from "../core/icons";

export type ListTreeOpenOptions = {
  /** 木を開く (このセッションは畳まない)。呼んだ後に木が見えている。 */
  open(): void;
  /** ボタンの名前 (title と aria-label)。 */
  label(): string;
};

export function createListTreeOpen(
  options: ListTreeOpenOptions,
): HTMLButtonElement {
  const sidebar = document.getElementById("sidebar");
  if (!sidebar) throw new Error("#sidebar is missing from index.html");
  const button = document.createElement("button");
  button.type = "button";
  button.className = "list-tree-open";
  button.innerHTML = iconSvg("list-tree-open-icon", SIDEBAR_SHOW_16_PATHS);
  button.addEventListener("click", () => {
    options.open();
    const stop =
      sidebar.querySelector<HTMLElement>('#filelist [tabindex="0"]') ??
      sidebar.querySelector<HTMLElement>("#filelist li") ??
      sidebar;
    stop.focus();
  });
  sidebar.after(button);
  localizeListTreeOpen(button, options.label());
  return button;
}

/** 言語の切替で名前を付け直す。 */
export function localizeListTreeOpen(button: HTMLElement, label: string): void {
  button.title = label;
  button.setAttribute("aria-label", label);
}
