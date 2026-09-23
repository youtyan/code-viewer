// タブの幅 (core/tab-widths.ts)。ふだんは中身の幅、列に入りきらないときだけ全部を
// 同じ割合で縮め、名前が 8 文字ほど読める下限で止める。前は列の幅をタブの数で割った
// 幅にそろえていて、1280 で名前が 1〜2 文字しか読めなかった。
import { describe, expect, test } from "vitest";
import { fitTabWidths, TAB_FLOOR_UNITS } from "../core/tab-widths";

describe("fitTabWidths", () => {
  const floor = 4 * TAB_FLOOR_UNITS; // 既定の密度の単位 4px で 144
  test.each([
    {
      name: "入りきるなら中身の幅のまま (null)",
      natural: [120, 90, 160],
      available: 400,
      expected: null,
    },
    {
      name: "あふれたら全部を同じ割合で縮める",
      natural: [200, 200, 200],
      available: 480,
      expected: [160, 160, 160],
    },
    {
      name: "下限 (名前が 8 文字ほど読める幅) で止める (その先は列を横に送る)",
      natural: [200, 200, 200, 200],
      available: 400,
      expected: [floor, floor, floor, floor],
    },
    {
      name: "もともと下限より細いタブは縮めず、そのまま",
      natural: [100, 200, 200],
      available: 400,
      expected: [100, 160, 160],
    },
  ])("$name", ({ natural, available, expected }) => {
    expect(fitTabWidths(natural, available, floor)).toEqual(expected);
  });

  test("下限は日本語の名前でも 5〜6 文字読める幅 (絵・閉じる・余白を除く)", () => {
    // タブの中: 左右の余白 12×2、絵 16、閉じる 16、間 6×2 (既定の密度)。
    const nameRoom = floor - 12 * 2 - 16 - 16 - 6 * 2;
    // 13px の字: 全角 13px、英字はおよそ 7px。
    expect([
      Math.floor(nameRoom / 13) >= 5,
      Math.floor(nameRoom / 7) >= 8,
    ]).toEqual([true, true]);
  });

  test.each([
    [0, 100],
    [144, Number.NaN],
  ])("下限と使える幅が数でなければ投げる (floor %s, available %s)", (f, a) => {
    expect(() => fitTabWidths([100], a, f)).toThrow("tab widths:");
  });
});
