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

/** OKLab (知覚的に均等な色の座標)。#rrggbb だけを読む。 */
export function oklab(hex: string): [number, number, number] {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) throw new Error(`color contrast: cannot read ${hex}`);
  const [r, g, b] = [0, 2, 4].map((at) =>
    channel(Number.parseInt(match[1].slice(at, at + 2), 16)),
  );
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** 2 つの色の色相の差 (OKLCH の度。0〜180)。 */
export function hueGap(a: string, b: string): number {
  const hue = (hex: string) => {
    const [, x, y] = oklab(hex);
    return (Math.atan2(y, x) * 180) / Math.PI;
  };
  const d = Math.abs(hue(a) - hue(b)) % 360;
  return Math.min(d, 360 - d);
}

/** 2 つの色の OKLab の距離 (面どうしが見分けられるか)。 */
export function oklabDistance(a: string, b: string): number {
  const [p, q] = [oklab(a), oklab(b)];
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}
