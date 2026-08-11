// 行から開く操作メニュー。
//
// 見た目は `.gdp-context-menu` (web/style.css) をそのまま使う。この形は
// Repository 画面が先に持っていたものだが、あちらはメニューの中身と組み立てが
// 1 つの関数に埋まっていて外から使えない。ここは**中身を渡す側と、開いて閉じる
// 側を分けただけ**で、新しい見た目は作らない。
//
// 同時に 2 枚開かない。開いている間に外側をクリックするか Escape を押すか、
// 画面が動いたら閉じる。閉じたらフォーカスは開いたボタンへ戻す (キーボードで
// 辿ってきた人が、メニューを閉じた瞬間に居場所を失わないように)。

/** メニュー 1 項目。区切りは `separator` で表す。 */
export type ContextMenuItem =
  | {
      kind?: "item";
      label: string;
      /** ホバーで出す説明。何が起きるかを 1 文で。 */
      title?: string;
      /** 取り返しのつかない操作。`.danger` が付いて色が変わる。 */
      danger?: boolean;
      disabled?: boolean;
      onSelect(): void;
    }
  | { kind: "separator" };

type OpenMenu = {
  element: HTMLElement;
  cleanup(): void;
};

let open: OpenMenu | null = null;

export function closeContextMenu(): void {
  if (!open) return;
  const closing = open;
  open = null;
  closing.cleanup();
  closing.element.remove();
}

export function isContextMenuOpen(): boolean {
  return open !== null;
}

/**
 * `anchor` の下に開く。画面の端に寄っているときは内側へ寄せる。
 * 開いたボタン自身を渡すこと (閉じたときのフォーカス戻し先になる)。
 */
export function showContextMenu(
  anchor: HTMLElement,
  items: ContextMenuItem[],
): void {
  closeContextMenu();

  const menu = document.createElement("div");
  menu.className = "gdp-context-menu";
  menu.setAttribute("role", "menu");

  for (const item of items) {
    if (item.kind === "separator") {
      const line = document.createElement("hr");
      line.className = "gdp-context-menu-sep";
      menu.appendChild(line);
      continue;
    }
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("role", "menuitem");
    button.textContent = item.label;
    if (item.title) button.title = item.title;
    if (item.danger) button.classList.add("danger");
    button.disabled = !!item.disabled;
    button.addEventListener("click", () => {
      closeContextMenu();
      item.onSelect();
    });
    menu.appendChild(button);
  }

  document.body.appendChild(menu);

  // 置いてから測る。幅も高さも中身で決まるので、先に測れない。
  const rect = menu.getBoundingClientRect();
  const from = anchor.getBoundingClientRect();
  const left = Math.min(
    from.right - rect.width,
    window.innerWidth - rect.width - 8,
  );
  const top = Math.min(from.bottom + 4, window.innerHeight - rect.height - 8);
  menu.style.left = `${Math.max(8, left)}px`;
  menu.style.top = `${Math.max(8, top)}px`;

  const onPointerDown = (event: Event) => {
    if (menu.contains(event.target as Node)) return;
    closeContextMenu();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    event.stopPropagation();
    closeContextMenu();
    anchor.focus();
  };
  // スクロールで画面が動くと、位置が合わなくなる。追従させずに閉じる。
  const onScroll = () => closeContextMenu();

  // 捕捉フェーズで拾う。行のクリックハンドラより先に閉じないと、メニューを
  // 閉じるつもりのクリックが行の選択として通ってしまう。
  document.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("scroll", onScroll, true);
  window.addEventListener("resize", onScroll);

  open = {
    element: menu,
    cleanup() {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    },
  };

  menu.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
}
