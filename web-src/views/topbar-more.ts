// 上の帯 (#topbar) の「⋯」: 帯が狭くて外した操作を 1 つのメニューにまとめる。どれを
// 外すかは帯の実幅で style.css の `@container topbar` の段が決め、メニューはそのとき
// 帯に見えていない操作だけを並べる。選ぶと帯の同じボタンを押す (状態の切替と保存は
// 今のボタンのまま。メニューは写しを持たない)。

import { type ContextMenuItem, showContextMenu } from "./context-menu";

/** 状態を持つ切替 (メニューでは今の状態に印を付ける)。 */
const TOGGLES =
  "#topbar .seg button, #ignore-ws, #syntax-highlight, #hide-tests";
/** 外すことのある帯の操作 (DOM の順にメニューへ並べる)。 */
const FOLDABLE = `#ref-reset, #reload-prom, ${TOGGLES}`;

/** 帯で見えていない操作のメニューの項目。 */
export function topbarMoreItems(root: ParentNode): ContextMenuItem[] {
  return [...root.querySelectorAll<HTMLButtonElement>(FOLDABLE)]
    .filter((button) => button.getClientRects().length === 0)
    .map((button) => ({
      // 文字の切替は帯と同じ名前、絵だけのボタンは読み上げの名前。
      label:
        button.textContent?.trim() || button.getAttribute("aria-label") || "",
      title: button.title,
      ...(button.matches(TOGGLES)
        ? { checked: button.classList.contains("active") }
        : {}),
      onSelect: () => button.click(),
    }));
}

/** 「⋯」を押したら、帯で見えていない操作のメニューを開く。 */
export function mountTopbarMore(button: HTMLButtonElement): void {
  button.addEventListener("click", () => {
    showContextMenu(button, topbarMoreItems(document));
  });
}
