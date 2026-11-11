// 小さな絵の大きさは 5 段 (--icon-sm 12・--icon-md 14・--icon-lg 16・--icon-xl 18・
// --icon-2xl 20。既定の密度の値) だけ。段の名前は密度で比例するので、生の px で書いた
// 絵は密度を変えても大きさが変わらず、隣の文字とずれる。13px や 22px のような段の
// 外の大きさも並べると不ぞろいに見えた。空の状態の大きな絵は挿し絵で、段の外。

import { expect, test } from "vitest";
import { loadStyleSheet } from "./_css-fixture";

const ICON = /svg|icon|octicon/;
const ILLUSTRATIONS = new Set([
  ".empty .empty-icon",
  ".db-pane-empty-icon .octicon",
]);

test("icons are sized by the icon steps, not raw px", () => {
  const offenders = loadStyleSheet()
    .filter(
      (rule) => ICON.test(rule.selector) && !ILLUSTRATIONS.has(rule.selector),
    )
    .flatMap((rule) => {
      const width = rule.declarations.get("width");
      const height = rule.declarations.get("height");
      return width && width === height && /^\d+(\.\d+)?px$/.test(width)
        ? [`${rule.selector} { width/height: ${width} }`]
        : [];
    });
  expect(offenders).toEqual([]);
});
