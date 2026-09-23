// メインの面のタブの幅 (純ロジック)。DOM に触らない。配線は
// views/main-tabs/main-tabs-view.ts の fitTabs。
//
// タブの幅はふだん中身 (絵・名前の全文・閉じる) の幅で、上限は CSS の max-width。
// 列に入りきらないときだけ、全部のタブを同じ割合で縮める (ブラウザのタブと同じ)。
// ただし名前が 8 文字ほど (日本語なら 5〜6 文字) 読める下限 (floor) で止め、それでも
// 入らなければ列を横に送る。もともと下限より細いタブはそのまま。
//
// 畳んだグループのタブも数に入れる (描いていないタブの中身の幅も natural に入れる):
// 畳む・開くで割合が変わると、畳んだグループより左のタブの幅が変わって札が動く。

/** 名前が 8 文字ほど読める下限を、余白の単位 (--space-unit) の何倍にするか。 */
export const TAB_FLOOR_UNITS = 36;

/**
 * natural: タブごとの中身の幅 (上限で切った後。畳んだグループのタブも含める)。
 * available: タブに使える幅 (列の幅から札・＋・隙間を除いた幅)。
 * 返すのは natural と同じ順の幅。入りきるなら null (中身の幅のまま)。
 */
export function fitTabWidths(
  natural: readonly number[],
  available: number,
  floor: number,
): number[] | null {
  if (!(floor > 0) || !Number.isFinite(available))
    throw new Error(
      `tab widths: floor ${floor} and available ${available} must be finite and floor positive`,
    );
  const total = natural.reduce((sum, width) => sum + width, 0);
  if (total <= available) return null;
  const ratio = Math.max(0, available) / total;
  return natural.map((width) =>
    Math.max(Math.min(width, floor), Math.floor(width * ratio * 100) / 100),
  );
}
