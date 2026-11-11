// 行から開く操作メニュー。
//
// 見た目は `.gdp-context-menu` (web/style.css) をそのまま使う。この形は
// Repository 画面が先に持っていたものだが、あちらはメニューの中身と組み立てが
// 1 つの関数に埋まっていて外から使えない。ここは**中身を渡す側と、開いて閉じる
// 側を分けただけ**で、新しい見た目は作らない。
//
// 同時に 2 枚開かない。開いている間に外側をクリックするか Escape か Tab を押すか、
// 画面が動いたら閉じる。閉じたらフォーカスは既定で開いたボタンへ戻す
// (キーボードで辿ってきた人が、メニューを閉じた瞬間に居場所を失わないように)。

//
// 中身は部品 cv-menu、置き場所は重ね合わせの層 (views/ui/layer.ts) が描く。

import { html } from "lit/html.js";
import { createLayer } from "./ui/layer";
import type { MenuItem } from "./ui/menu";

export type { MenuItem as ContextMenuItem } from "./ui/menu";

type OpenMenu = {
  cleanup(): void;
  onClose?(): void;
};

let open: OpenMenu | null = null;
const layer = createLayer("context-menu");

export function closeContextMenu(): void {
  if (!open) return;
  const closing = open;
  open = null;
  closing.cleanup();
  layer.hide();
  closing.onClose?.();
}

export function isContextMenuOpen(): boolean {
  return open !== null;
}

/**
 * 既定では `anchor` の下に開く。`at` はポインタ座標を直接指定し、
 * `focusReturn` は Escape 時の戻り先を上書きする (`null` は戻さない)。
 * どちらの配置も画面の端では内側へ寄せる。
 */
export function showContextMenu(
  anchor: HTMLElement,
  items: MenuItem[],
  options: {
    at?: { x: number; y: number };
    focusReturn?: HTMLElement | null;
    onHighlight?: (index: number) => void;
    onClose?: () => void;
  } = {},
): HTMLElement {
  closeContextMenu();

  let position: { left: number; top: number } | null = null;
  layer.show(
    () =>
      html`<cv-menu
        .items=${items}
        .position=${position}
        .onHighlight=${options.onHighlight}
        .onChoose=${closeContextMenu}
      ></cv-menu>`,
  );
  const menu = layer.host()?.querySelector<HTMLElement>(".gdp-context-menu");
  if (!menu) throw new Error("context menu: the menu box was not drawn");

  // 置いてから測る。幅も高さも中身で決まるので、先に測れない。
  const rect = menu.getBoundingClientRect();
  const from = anchor.getBoundingClientRect();
  const originLeft = options.at?.x ?? from.right - rect.width;
  const originTop = options.at?.y ?? from.bottom + 4;
  const left = Math.min(originLeft, window.innerWidth - rect.width - 8);
  const top = Math.min(originTop, window.innerHeight - rect.height - 8);
  position = { left: Math.max(8, left), top: Math.max(8, top) };
  layer.update();

  const focusReturn =
    options.focusReturn === undefined ? anchor : options.focusReturn;

  const onPointerDown = (event: Event) => {
    if (menu.contains(event.target as Node)) return;
    closeContextMenu();
  };
  // キーだけで選べるようにする: 上下の矢印・Home・End で押せる項目だけを巡り
  // (端では反対の端へ)、Enter で選ぶ。Enter はボタンの既定の動作に任せず
  // ここで押す (既定の動作を止めるので 2 回は押されない)。使ったキーはページの
  // キー操作へ渡さない。
  const onKeyDown = (event: KeyboardEvent) => {
    // Tab も Escape と同じく閉じて戻す。項目の中を Tab で進めると、開いたまま
    // メニューの外 (後ろの画面) へ抜けていた。
    if (event.key === "Escape" || event.key === "Tab") {
      event.preventDefault();
      event.stopPropagation();
      closeContextMenu();
      focusReturn?.focus();
      return;
    }
    const buttons = [
      ...menu.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"),
    ];
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const last = buttons.length - 1;
    let next: number;
    switch (event.key) {
      case "ArrowDown":
        next = at < 0 || at === last ? 0 : at + 1;
        break;
      case "ArrowUp":
        next = at <= 0 ? last : at - 1;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = last;
        break;
      case "Enter":
        if (at < 0) return;
        event.preventDefault();
        event.stopPropagation();
        buttons[at].click();
        return;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
    buttons[next]?.focus();
  };
  // スクロールで anchor が動くと、位置が合わなくなる。追従させずに閉じる。
  // anchor を含まない箱のスクロール (タブの列の描き直しなど) では閉じない:
  // 裏の更新で開いた直後に閉じ、押した項目が届かなくなる。
  const onScroll = (event: Event) => {
    const target = event.target;
    if (
      target instanceof Node &&
      target !== document &&
      !target.contains(anchor)
    )
      return;
    closeContextMenu();
  };

  // 捕捉フェーズで拾う。行のクリックハンドラより先に閉じないと、メニューを
  // 閉じるつもりのクリックが行の選択として通ってしまう。
  document.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("scroll", onScroll, true);
  window.addEventListener("resize", onScroll);

  open = {
    cleanup() {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    },
    onClose: options.onClose,
  };

  menu.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  return menu;
}
