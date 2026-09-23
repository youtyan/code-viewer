import { describe, expect, test } from "vitest";
import { panelColumnBodyWidth } from "../core/panel-column-policy";

// 右の列が本文の横に取る幅 (core/panel-column-policy.ts)。畳むのは本体 (木) だけで、
// 頭の行 (#panel-head) は同じ幅で残る。本文の幅 (2 面の面の幅・一覧の列の決まり) は
// 本体の幅で数える: 畳めば 0 (頭の行の下から右端まで本文)。電話の幅では右の列は
// 重ねて出す面なので、これまでどおり頭の実幅を引く (2 面を出さない)。
describe("panelColumnBodyWidth", () => {
  test.each([
    { name: "開いている", hidden: false, overlaid: false, width: 240 },
    { name: "畳んだ (自動・手)", hidden: true, overlaid: false, width: 0 },
    { name: "電話・開いている", hidden: false, overlaid: true, width: 240 },
    { name: "電話・畳んだ", hidden: true, overlaid: true, width: 240 },
  ])("$name → $width", ({ hidden, overlaid, width }) => {
    expect(panelColumnBodyWidth({ hidden, overlaid, headWidth: 240 })).toBe(
      width,
    );
  });

  test("頭の幅に付いて行く (木の幅を変えたとき)", () => {
    expect(
      [180, 240, 400].map((headWidth) =>
        panelColumnBodyWidth({ hidden: false, overlaid: false, headWidth }),
      ),
    ).toEqual([180, 240, 400]);
    expect(
      [180, 240, 400].map((headWidth) =>
        panelColumnBodyWidth({ hidden: true, overlaid: false, headWidth }),
      ),
    ).toEqual([0, 0, 0]);
  });
});
