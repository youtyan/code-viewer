// 一覧の列の、一覧と変更ファイルの一覧を手で畳む / 開くボタン (ui-layout.md の
// 「一覧の列」)。
//
// - 畳むボタン (createColumnFold): 列の右端の線の中ほどに重ねる小さなボタン。
//   押す (Enter / Space も button なので同じ) と列を畳み、同じ場所に帯が出る
// - 開くボタン (createColumnOpen): 畳んだ列の帯そのもの。押すと列を開き、開いた
//   列の止まり場所の行 (選んでいる行、無ければ先頭の行) へフォーカスを移す
//
// どちらも Tab の順が見た目の位置 (ファイル一覧 → 一覧 → 変更ファイルの一覧 →
// 本文) と合うよう、DOM では受け持つ列の直後に置く。History・作業ツリーの変更
// ファイルの一覧を開く帯は createListTreeOpen (幅が足りずに畳んだときも出る)。

import {
  iconSvg,
  SIDEBAR_HIDE_16_PATHS,
  SIDEBAR_SHOW_16_PATHS,
} from "../core/icons";

export type ListTreeOpenOptions = {
  /** 列を開く (このセッションは畳まない)。呼んだ後に列が見えている。 */
  open(): void;
  /** ボタンの名前 (title と aria-label)。 */
  label(): string;
};

function requireById(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`#${id} is missing from index.html`);
  return element;
}

/**
 * 畳んだ列の帯の開くボタン。after (DOM で直後に置く要素) の後に置き、押したら
 * 開いた列の止まり場所 (focusStop) へフォーカスを移す。
 */
export function createColumnOpen(
  options: ListTreeOpenOptions & {
    className: string;
    after: HTMLElement;
    focusStop: () => HTMLElement;
  },
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = options.className;
  button.innerHTML = iconSvg("list-tree-open-icon", SIDEBAR_SHOW_16_PATHS);
  button.addEventListener("click", () => {
    options.open();
    options.focusStop().focus();
  });
  options.after.after(button);
  localizeListTreeOpen(button, options.label());
  return button;
}

/** 列の右端の線の中ほどの畳むボタン。after の直後に置く。 */
export function createColumnFold(options: {
  className: string;
  after: HTMLElement;
  fold(): void;
  label(): string;
}): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `list-column-fold ${options.className}`;
  button.innerHTML = iconSvg("list-column-fold-icon", SIDEBAR_HIDE_16_PATHS);
  button.addEventListener("click", () => options.fold());
  options.after.after(button);
  localizeListTreeOpen(button, options.label());
  return button;
}

/**
 * History・作業ツリーの変更ファイルの一覧 (#sidebar) を畳んだ帯の開くボタン。
 * #sidebar の直後に置く。
 */
export function createListTreeOpen(
  options: ListTreeOpenOptions,
): HTMLButtonElement {
  const sidebar = requireById("sidebar");
  return createColumnOpen({
    ...options,
    className: "list-tree-open",
    after: sidebar,
    focusStop: () =>
      sidebar.querySelector<HTMLElement>('#filelist [tabindex="0"]') ??
      sidebar.querySelector<HTMLElement>("#filelist li") ??
      sidebar,
  });
}

/** 言語の切替で名前を付け直す。 */
export function localizeListTreeOpen(button: HTMLElement, label: string): void {
  button.title = label;
  button.setAttribute("aria-label", label);
}
