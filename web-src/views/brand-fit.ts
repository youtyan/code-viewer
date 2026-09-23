// 一覧の列の頭の 1 段目 (#project-head) で、プロジェクト名 (切替のボタンの中) と
// 右寄せの枝の名前の幅を、段の幅に合わせて分ける (決め方は core/brand-fit.ts)。
// 段の幅 (左のサイドバーを畳んだときの開くボタン・密度) や名前・枝が変わる
// たびに測り直す。
//
// 分けた幅は段の CSS 変数 (--brand-name-max / --brand-branch-max) へ書く
// (style.css の .brand .title / .project-branch が読む)。

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

/** 名前と枝の幅を合わせ続ける。段は 1 つなので、起動時に 1 回呼ぶ。 */
export function fitBrand(row: HTMLElement): void {
  const title = row.querySelector<HTMLElement>(".title");
  const branch = row.querySelector<HTMLElement>(".project-branch");
  const branchName = branch?.querySelector<HTMLElement>(".project-branch-name");
  if (!title || !branch || !branchName)
    throw new Error(
      "project head: the name (.title) or the branch (.project-branch .project-branch-name) is missing",
    );

  const refit = () => {
    // 一度上限を外して、名前・枝の自然な幅と、段に使える幅を測る。
    row.style.removeProperty("--brand-name-max");
    row.style.removeProperty("--brand-branch-max");
    if (branch.hidden || !row.getClientRects().length) return;
    // 上限を外して何も省略されていなければ、入りきっている (測り直さない)。
    // 箱の幅と比べると丸めの差で「入りきらない」と出る。scrollWidth も整数に
    // 丸めるので、文字の本当の幅 (端数つき) と箱の幅で比べる (「main」が 0.4px
    // だけ切れて「ma…」になった)。
    const cut = (element: HTMLElement) =>
      textWidth(element) > element.getBoundingClientRect().width + 0.01;
    if (!cut(title) && !cut(branchName)) return;
    const gap = Number.parseFloat(getComputedStyle(row).columnGap) || 0;
    // 名前と枝のほかに段に並ぶもの (サイドバーを出すボタン・切替のボタンの中の
    // 四角・山形・余白) の幅。
    let others = 0;
    let visible = 0;
    for (const child of row.children) {
      if (!(child instanceof HTMLElement) || !child.getClientRects().length)
        continue;
      visible++;
      if (child === branch) continue;
      const width = child.getBoundingClientRect().width;
      others += child.contains(title)
        ? width - title.getBoundingClientRect().width
        : width;
    }
    const gaps = gap * Math.max(0, visible - 1);
    const available =
      row.clientWidth - horizontalPadding(row) - others - (gaps - gap);
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
    row.style.setProperty("--brand-name-max", `${nameMax}px`);
    row.style.setProperty("--brand-branch-max", `${branchMax}px`);
  };

  // 段の幅が変わったら測り直す (同じ幅なら同じ結果なので、通知は止まる)。
  if (typeof ResizeObserver !== "undefined")
    new ResizeObserver(refit).observe(row);
  // 名前・枝が変わった (プロジェクトの読み込み・枝の切り替え)・サイドバーを出す
  // ボタンが出た / 消えた。
  new MutationObserver(refit).observe(row, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["hidden"],
  });
}
