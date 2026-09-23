// プロジェクト名と枝の名前 (一覧の列の頭の 1 段目) の幅の分け方。
// DOM に触らない (配線は views/brand-fit.ts)。
//
// 名前だけを縮めない決まりにしていたが、狭い見出しでは結局両方縮み、枝の名前が
// 「m」「m.」の 1 文字になった。枝の名前は自然な幅まで必ず出し (上限は見出しの
// 約 40%。名前が短くて余りがあればそれも使う)、残りを名前が使って省略する。

export type BrandWidths = {
  /** 名前と枝に使える幅 (間を含む)。 */
  available: number;
  /** 名前の自然な幅。 */
  name: number;
  /** 枝 (絵柄と名前) の自然な幅。 */
  branch: number;
  /** 名前と枝の間。 */
  gap: number;
};

/** 枝に必ず残す、見出しの幅の割合の上限。 */
export const BRANCH_SHARE = 0.4;

export function fitBrandWidths(widths: BrandWidths): {
  name: number;
  branch: number;
} {
  const { available, name, branch, gap } = widths;
  if (name + gap + branch <= available) return { name, branch };
  const room = Math.max(0, available - gap);
  const branchWidth = Math.min(
    branch,
    Math.max(room * BRANCH_SHARE, room - name),
  );
  // 丸めない (端数は画面に当てる側で扱う。丸めると自然な幅のほうが 1px 足りず
  // 最後の 1 文字が省略記号になる)。
  return { name: Math.max(0, room - branchWidth), branch: branchWidth };
}
