// 2 つの色の差 (WCAG 2.x のコントラスト比)。#rrggbb だけを読む。
// SP の 1 ペイン表示の「読む」画面が文字の色を読める明るさまで上げるとき
// (core/pane-reflow.ts) と、色の下限を確かめるテスト (test/_color-contrast.ts) が使う。

/** sRGB の 1 つの値 (0〜255) を、明るさの計算に使う線形の値 (0〜1) にする。 */
export function linearChannel(value: number): number {
  const s = value / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** #rrggbb を [r, g, b] (0〜255) にする。読めなければ投げる (読めない値を 0 にしない)。 */
export function parseHexColor(hex: string): [number, number, number] {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) throw new Error(`color contrast: cannot read ${hex}`);
  const value = Number.parseInt(match[1], 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/** 相対輝度。#rrggbb でなければ投げる。 */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHexColor(hex).map(linearChannel);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort(
    (x, y) => y - x,
  );
  return (hi + 0.05) / (lo + 0.05);
}
