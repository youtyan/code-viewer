// プロジェクト名と枝の名前の幅の分け方 (core/brand-fit.ts)。枝は自然な幅
// (上限は約 40%。名前が短ければ余りも使う) まで出し、残りを名前が使う。
import { expect, test } from "vitest";
import { fitBrandWidths } from "../core/brand-fit";

// 使える幅 148 (右の列の頭 240px のとき) と 124 (畳んだときのタブ列の左)。
// 間は 5。名前 48 / 148 / 322、枝 (絵柄込み) main 54・develop 72・feature 150。
test.each([
  // 入りきる: そのまま
  { available: 148, name: 48, branch: 54, expected: { name: 48, branch: 54 } },
  { available: 148, name: 48, branch: 72, expected: { name: 48, branch: 72 } },
  // 名前が短い: 枝は 40% を超えて余りまで使う
  { available: 148, name: 48, branch: 150, expected: { name: 48, branch: 95 } },
  // 名前が長い: main は必ず全部出し、残りを名前が使う (「m」にしない)
  { available: 148, name: 148, branch: 54, expected: { name: 89, branch: 54 } },
  { available: 148, name: 322, branch: 54, expected: { name: 89, branch: 54 } },
  // 名前が長く枝も長い: 枝は約 40% まで
  {
    available: 148,
    name: 148,
    branch: 72,
    expected: { name: 85.8, branch: 57.2 },
  },
  {
    available: 148,
    name: 322,
    branch: 150,
    expected: { name: 85.8, branch: 57.2 },
  },
  // 狭い: 枝の自然な幅 (54) が上限 (119 の 40% = 47.6) を超えるので上限まで
  {
    available: 124,
    name: 148,
    branch: 54,
    expected: { name: 71.4, branch: 47.6 },
  },
  { available: 124, name: 148, branch: 43, expected: { name: 76, branch: 43 } },
  {
    available: 124,
    name: 322,
    branch: 150,
    expected: { name: 71.4, branch: 47.6 },
  },
  // 使える幅が無い
  { available: 0, name: 48, branch: 54, expected: { name: 0, branch: 0 } },
])("使える幅 $available・名前 $name・枝 $branch → $expected", ({
  available,
  name,
  branch,
  expected,
}) => {
  // 丸めずに返す (端数は画面に当てる側で扱う)。比べるのは小数 1 桁まで。
  const widths = fitBrandWidths({ available, name, branch, gap: 5 });
  expect({
    name: Math.round(widths.name * 10) / 10,
    branch: Math.round(widths.branch * 10) / 10,
  }).toEqual(expected);
});
