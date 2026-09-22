// プロジェクト名と枝の名前 (#project-switcher) の幅を、使える幅に合わせて分ける
// (決め方は core/brand-fit.ts)。右の列の頭でも、畳んだときのタブ列の左でも
// 同じ部品なので、置き場所が変わって幅が変わるたびに測り直す。
//
// 分けた幅は部品の CSS 変数 (--brand-name-max / --brand-branch-max) へ書く
// (style.css の .brand .title / .brand .project-branch が読む)。

import { fitBrandWidths } from "../core/brand-fit";

function horizontalPadding(element: HTMLElement): number {
  const style = getComputedStyle(element);
  return (
    (Number.parseFloat(style.paddingLeft) || 0) +
    (Number.parseFloat(style.paddingRight) || 0)
  );
}

/** 文字の本当の幅 (端数つき)。箱で切れていても全体の幅。 */
function textWidth(element: HTMLElement): number {
  const range = document.createRange();
  range.selectNodeContents(element);
  return range.getBoundingClientRect().width;
}

/** 名前と枝の幅を合わせ続ける。部品は 1 つなので、起動時に 1 回呼ぶ。 */
export function fitBrand(button: HTMLElement): void {
  const title = button.querySelector<HTMLElement>(".title");
  const branch = button.querySelector<HTMLElement>(".project-branch");
  if (!title || !branch) return;

  const branchName = branch.querySelector<HTMLElement>(".project-branch-name");

  const refit = () => {
    // 一度上限を外して、名前・枝の自然な幅と、部品に使える幅を測る。
    button.style.removeProperty("--brand-name-max");
    button.style.removeProperty("--brand-branch-max");
    if (branch.hidden || !branchName || !button.getClientRects().length) return;
    // 上限を外して何も省略されていなければ、入りきっている (測り直さない)。
    // 部品の今の幅は中身と同じなので、それを使える幅として比べると丸めの差で
    // 「入りきらない」と出る。scrollWidth も整数に丸めるので、文字の本当の幅
    // (端数つき) と箱の幅で比べる (「main」が 0.4px だけ切れて「ma…」になった)。
    const cut = (element: HTMLElement) =>
      textWidth(element) > element.getBoundingClientRect().width + 0.01;
    if (!cut(title) && !cut(branchName)) return;
    const gap = Number.parseFloat(getComputedStyle(button).columnGap) || 0;
    // 名前と枝のほかに並ぶもの (開くことを示す山形) の幅。
    let others = 0;
    let visible = 0;
    for (const child of button.children) {
      if (!(child instanceof HTMLElement) || !child.getClientRects().length)
        continue;
      visible++;
      if (child !== title && child !== branch)
        others += child.getBoundingClientRect().width;
    }
    const gaps = gap * Math.max(0, visible - 1);
    const available =
      button.clientWidth - horizontalPadding(button) - others - (gaps - gap);
    // 枝の自然な幅 = 枝の箱の今の幅 (縮めない箱) から名前の箱の幅を引き、名前の
    // 文字の本当の幅を足したもの (中の名前が切れていても全体の幅になる)。
    const branchNatural =
      branch.getBoundingClientRect().width -
      branchName.getBoundingClientRect().width +
      textWidth(branchName);
    const natural = { name: textWidth(title), branch: branchNatural };
    const widths = fitBrandWidths({ available, ...natural, gap });
    // 自然な幅のまま出す側は切り上げて 1px の余裕を持たせ (端数で最後の 1 文字が
    // 省略記号にならないように)、その分は省略する側から引く。
    const nameFits = widths.name >= natural.name - 0.01;
    const branchFits = widths.branch >= natural.branch - 0.01;
    const nameMax = nameFits
      ? Math.ceil(natural.name) + 1
      : Math.max(0, Math.floor(widths.name) - (branchFits ? 2 : 0));
    const branchMax = branchFits
      ? Math.ceil(natural.branch) + 1
      : Math.max(0, Math.floor(widths.branch) - (nameFits ? 2 : 0));
    button.style.setProperty("--brand-name-max", `${nameMax}px`);
    button.style.setProperty("--brand-branch-max", `${branchMax}px`);
  };

  if (typeof ResizeObserver !== "undefined") {
    // 置き場所 (右の列の頭 / タブ列の左) と、その幅が変わったら測り直す。
    // 測り直しは同じ幅なら同じ結果なので、部品の幅は変わらず通知は止まる。
    let observedParent: Element | null = null;
    const observer = new ResizeObserver(() => {
      const parent = button.parentElement;
      if (parent && parent !== observedParent) {
        if (observedParent) observer.unobserve(observedParent);
        observedParent = parent;
        observer.observe(parent);
      }
      refit();
    });
    observer.observe(button);
  }
  // 名前・枝が変わったら (プロジェクトの読み込み・枝の切り替え)。
  new MutationObserver(refit).observe(button, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["hidden"],
  });
}
