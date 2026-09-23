// パンくずが入りきらないとき、真ん中の段を「…」1 つに畳む (決め方は
// core/breadcrumb-fit.ts)。Diff・ファイル表示 (diff-view.ts) とフォルダ表示
// (repo-view.ts) のパンくずの両方が使う。
//
// 形は「段 区切り 段 区切り … 段」(.gdp-file-breadcrumb-part /
// .gdp-file-breadcrumb-current と .gdp-file-breadcrumb-sep)。畳んだ段とその間の
// 区切りを隠し、畳んだ所に「…」(title に全体のパス) を置く。幅が変わるたびに
// 測り直す。
//
// 「…」は押せる (Tab で届く・Enter / Space / クリック)。押すと畳んだ段のメニューを
// 開き、選ぶとその段を押したのと同じ。隠した段はキーでも読み上げでも届かない
// ので、ここが畳んだ段への唯一の入口になる。読み上げの名前は全体のパス。

import { collapsedBreadcrumbRange } from "../core/breadcrumb-fit";
import { showContextMenu } from "./context-menu";

const CRUMB_SELECTOR =
  ":scope > .gdp-file-breadcrumb-part, :scope > .gdp-file-breadcrumb-current";
const SEPARATOR_SELECTOR = ":scope > .gdp-file-breadcrumb-sep";

/** 要素の外側の幅 (左右の margin を含む)。 */
function outerWidth(element: HTMLElement): number {
  const style = getComputedStyle(element);
  return (
    element.getBoundingClientRect().width +
    (Number.parseFloat(style.marginLeft) || 0) +
    (Number.parseFloat(style.marginRight) || 0)
  );
}

/**
 * そのパンくずを幅に合わせて畳む。描いた直後に呼ぶ (まだ画面に無くてよい。
 * 箱が付いたときに測る)。fullPath は「…」の title に出す全体のパス。
 */
export function fitBreadcrumb(nav: HTMLElement, fullPath: string): void {
  const ellipsis = document.createElement("span");
  ellipsis.className = "gdp-file-breadcrumb-ellipsis";
  ellipsis.textContent = "…";
  ellipsis.title = fullPath;
  ellipsis.tabIndex = 0;
  ellipsis.setAttribute("role", "button");
  ellipsis.setAttribute("aria-haspopup", "menu");
  ellipsis.setAttribute("aria-label", fullPath);
  const openHidden = () => {
    const hidden = Array.from(
      nav.querySelectorAll<HTMLElement>(CRUMB_SELECTOR),
    ).filter((crumb) => crumb.hidden);
    showContextMenu(
      ellipsis,
      hidden.map((crumb) => ({
        label: crumb.textContent ?? "",
        onSelect: () => crumb.click(),
      })),
    );
  };
  ellipsis.addEventListener("click", openHidden);
  ellipsis.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    openHidden();
  });

  const refit = () => {
    const crumbs = Array.from(
      nav.querySelectorAll<HTMLElement>(CRUMB_SELECTOR),
    );
    if (crumbs.length === 0) return;
    // 測り直しで「…」を外して付け直すので、フォーカスがあれば戻す (幅が
    // 変わるたびにキーの居場所が消えないように)。
    const focused = document.activeElement === ellipsis;
    // 一度全部を出してから測る (前に畳んだ分を戻す)。
    ellipsis.remove();
    nav.classList.remove("is-collapsed");
    for (const element of nav.children) (element as HTMLElement).hidden = false;
    const separators = Array.from(
      nav.querySelectorAll<HTMLElement>(SEPARATOR_SELECTOR),
    );
    nav.insertBefore(ellipsis, crumbs[1] ?? null);
    const range = collapsedBreadcrumbRange({
      // 省略記号で縮んでいても、scrollWidth は文字の全体の幅。
      parts: crumbs.map((crumb) => crumb.scrollWidth),
      separator: separators[0] ? outerWidth(separators[0]) : 0,
      ellipsis: outerWidth(ellipsis),
      available: nav.clientWidth,
    });
    if (!range) {
      ellipsis.remove();
      return;
    }
    // 段 i の前の区切りは separators[i - 1]。畳んだ段と、その間の区切りを隠す
    // (畳んだ範囲の前後の区切りは「…」の両側として残す)。
    for (let index = range.from; index < range.to; index++) {
      const crumb = crumbs[index];
      if (crumb) crumb.hidden = true;
      if (index > range.from) {
        const separator = separators[index - 1];
        if (separator) separator.hidden = true;
      }
    }
    nav.insertBefore(ellipsis, crumbs[range.from] ?? null);
    nav.classList.add("is-collapsed");
    if (focused) ellipsis.focus({ preventScroll: true });
  };

  if (typeof ResizeObserver === "undefined") return;
  // 使える幅は、親の幅と、後から並ぶ横の部品 (コピー・前後のボタン) で決まる。
  // どちらが変わってもパンくずの箱の幅が変わるので、箱と親を見て測り直す。
  // 測り直しは同じ幅なら同じ形に戻るので、箱の幅は変わらず通知は止まる。
  let observedParent: Element | null = null;
  const observer = new ResizeObserver(() => {
    const parent = nav.parentElement;
    if (parent && parent !== observedParent) {
      observedParent = parent;
      observer.observe(parent);
    }
    refit();
  });
  observer.observe(nav);
}
