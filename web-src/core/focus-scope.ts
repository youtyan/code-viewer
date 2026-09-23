import type { KeymapScope } from "./keymap";

export type PanelFocusScope = Extract<KeymapScope, "sidebar" | "main">;

// Panel focus scope mirrors the DOM focus owner used by Vim-style key handling.
export function isEditableKeyTarget(target: Element | null): boolean {
  if (!target || typeof target.closest !== "function") return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    target.closest('[contenteditable="true"]') != null
  );
}

// A terminal owns every key while it has focus, except keys with Meta (Cmd):
// terminals on macOS do not use Cmd, so Cmd+K / Cmd+G still reach the page
// keymap (Ctrl keys all stay in the terminal). Modal dialogs own every key,
// Meta included, so page-level shortcuts cannot run behind their local
// Escape / Enter / Tab handling. The search palette is not blocked: Ctrl/Cmd+K
// and +G are its documented mode-switch keys and are filtered by paletteOpen.
export function isPageKeymapBlockedKey(
  target: Element | null,
  metaKey: boolean,
): boolean {
  if (!target || typeof target.closest !== "function") return false;
  if (isInModalDialog(target)) return true;
  return target.closest(".xterm") !== null && !metaKey;
}

/**
 * モーダルのダイアログの中か (検索のパレットは除く)。ページのキー割り当ては
 * ここでは何も動かさない。端末の中で効くかは割り当てごとに決まる (keymap.ts の
 * terminalAllowed。既定は上の決まりと同じ: Meta 付きで入力欄でも効くキーだけ)。
 */
export function isInModalDialog(target: Element | null): boolean {
  if (!target || typeof target.closest !== "function") return false;
  return target.closest('[role="dialog"]:not(.gdp-palette)') !== null;
}

// Tab で届く、Enter で押せる部品。ページのキー割り当ての Enter (木の項目を開く) は
// 部品の外 (本文・木の行・何も選んでいないとき) のためのもので、ここで拾うと
// ボタンが押されない (New agent・画面の入口・ファイル一覧を畳むボタンが Enter で
// 動かず、木のファイルが開いていた)。木の行のリンクは tabIndex -1 で Tab に
// 入らないので、今までどおりページの Enter が開く。
const ENTER_CONTROL_SELECTOR =
  'button, a[href], select, summary, [role="button"], [role="link"], [role="menuitem"], [role="tab"], [role="option"]';

/** Enter をページのキー割り当てへ渡さず、フォーカスのある部品に押させるか。 */
export function isEnterForFocusedControl(
  target: Element | null,
  key: string,
): boolean {
  if (key !== "Enter" || !target || typeof target.matches !== "function")
    return false;
  return (
    (target as HTMLElement).tabIndex >= 0 &&
    target.matches(ENTER_CONTROL_SELECTOR)
  );
}

/** 修飾キーを問わず塞がれる対象か (Meta の例外を含めない)。 */
export function isPageKeymapBlockedTarget(target: Element | null): boolean {
  return isPageKeymapBlockedKey(target, false);
}

export function keymapScope(target: Element | null): KeymapScope {
  // Tools / Search のタブの中身 (本文 #content の中) は、下パネルだった頃と
  // 同じ "panel" の範囲 (Escape で閉じる・入力欄でも Ctrl+` を通す)。#content より
  // 先に見る。
  if (target?.closest("#tools-sheet, #search-sheet")) return "panel";
  // The commit list of the history screen, or the one embedded in a file
  // History tab (inside #content), so it must be checked before "main".
  if (target?.closest("#history-panel, .gdp-file-history-panel"))
    return "history";
  if (target?.closest("#content")) return "main";
  // 右の面のソース表示 (#content の外の 2 つ目の実体) も本文と同じキー。
  if (target?.closest(".main-pane-source")) return "main";
  // ファイル一覧 (#file-list) と変更ファイルの一覧 (#sidebar) は同じキー。
  if (target?.closest("#sidebar, #file-list")) return "sidebar";
  return "global";
}

export function prepareKeyboardPanels(doc: Document = document) {
  for (const panel of doc.querySelectorAll<HTMLElement>(
    "#sidebar, #file-list, #content",
  ))
    panel.tabIndex = -1;
}

export function getPanelFocusScope(
  doc: Document = document,
): PanelFocusScope | null {
  const scope = doc.body?.dataset.focusScope;
  return scope === "sidebar" || scope === "main" ? scope : null;
}

export function setPanelFocusScope(
  scope: PanelFocusScope | null,
  doc: Document = document,
) {
  if (!doc.body) return;
  if (scope) doc.body.dataset.focusScope = scope;
  else delete doc.body.dataset.focusScope;
}

export function restorePanelFocusScope(
  scope: PanelFocusScope | null,
  doc: Document = document,
) {
  if (scope === "sidebar") focusSidebarPanel(doc);
  else if (scope === "main") focusMainPanel(doc);
  else setPanelFocusScope(null, doc);
}

/**
 * 一覧へフォーカスを移す: 一覧を出す画面 (body[data-list-column]) は変更ファイルの
 * 一覧 (#sidebar)、ほかはファイル一覧 (#file-list)。
 */
export function focusSidebarPanel(doc: Document = document) {
  const changes = doc.body?.hasAttribute("data-list-column") ?? false;
  const [root, list] = changes
    ? ["#sidebar", "#filelist"]
    : ["#file-list", "#file-list-rows"];
  const active = doc.querySelector<HTMLElement>(
    `${list} li.active[data-path], ${list} .tree-dir.active[data-dirpath]`,
  );
  const sidebar = doc.querySelector<HTMLElement>(root);
  (active || sidebar)?.focus({ preventScroll: true });
  setPanelFocusScope("sidebar", doc);
}

export function focusMainPanel(doc: Document = document) {
  doc.querySelector<HTMLElement>("#content")?.focus({ preventScroll: true });
  setPanelFocusScope("main", doc);
}

/**
 * 本文の箱。**窓ではなくこれがスクロールする** (ui-layout.md の「本文の箱」)。
 * 画面ごとの中身はこの中に描かれるので、位置を覚える・戻す・先頭へ出すのは
 * 全部この箱が基準になる。
 */
export function mainScrollBox(doc: Document = document): HTMLElement | null {
  return doc.querySelector<HTMLElement>("#content");
}

/**
 * 画面に出ているか。
 *
 * `offsetParent` は使えない: 本文の箱 (#content) は position: fixed なので、
 * 出ていても常に null になる (これで j / k・PageDown が動かなくなった)。
 * 出ていない要素は箱を 1 つも持たない。
 */
function isOnScreen(element: HTMLElement): boolean {
  return element.getClientRects().length > 0;
}

export function findMainScrollTarget(
  doc: Document = document,
): HTMLElement | null {
  const active = doc.activeElement as HTMLElement | null;
  const activeScroller = active?.closest<HTMLElement>(
    "#content .gdp-source-virtual-scroller",
  );
  if (activeScroller && isOnScreen(activeScroller)) return activeScroller;
  const sourceScroller = doc.querySelector<HTMLElement>(
    "#content .gdp-source-virtual-scroller",
  );
  if (sourceScroller && isOnScreen(sourceScroller)) return sourceScroller;
  const content = doc.querySelector<HTMLElement>("#content");
  if (!content || !isOnScreen(content)) return null;
  const isScrollable = (item: HTMLElement) => {
    if (!isOnScreen(item)) return false;
    const style = doc.defaultView?.getComputedStyle(item);
    return (
      !!style &&
      /(auto|scroll)/.test(style.overflowY) &&
      item.scrollHeight > item.clientHeight
    );
  };
  const preferred = Array.from(
    content.querySelectorAll<HTMLElement>(
      ".gdp-source-viewer, .gdp-markdown-layout, .gdp-markdown-preview, .d2h-files-diff, .d2h-file-diff",
    ),
  );
  const scrollable =
    preferred.find(isScrollable) ||
    (isScrollable(content) ? content : null) ||
    Array.from(content.querySelectorAll<HTMLElement>("*")).find(isScrollable);
  // 窓は動かないので、最後の行き先も本文の箱 (中身がまだ無いときはここ)。
  return scrollable || content;
}
