// 2 つの色の差 (WCAG 2.x のコントラスト比)。#rrggbb だけを読む。
//
// focus-ring-contrast.test.ts と agents-list-look.test.ts は、同じ計算を自分の
// 中に持っている (半透明の重ね・#rgb を読むため。寄せるのは別の作業)。

function channel(value: number): number {
  const s = value / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** 相対輝度。#rrggbb でなければ投げる (読めない値を 0 にしない)。 */
export function relativeLuminance(hex: string): number {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) throw new Error(`color contrast: cannot read ${hex}`);
  const [r, g, b] = [0, 2, 4].map((at) =>
    channel(Number.parseInt(match[1].slice(at, at + 2), 16)),
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort(
    (x, y) => y - x,
  );
  return (hi + 0.05) / (lo + 0.05);
}
