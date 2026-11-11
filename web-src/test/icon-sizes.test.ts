// 小さな絵の大きさは 5 段 (--icon-sm 12・--icon-md 14・--icon-lg 16・--icon-xl 18・
// --icon-2xl 20。既定の密度の値) だけ。段の名前は密度で比例するので、生の px で書いた
// 絵は密度を変えても大きさが変わらず、隣の文字とずれる。13px や 22px のような段の
// 外の大きさも並べると不ぞろいに見えた。文字の大きさ (em・--ui-font-*) や余白の段
// (--space-*) で決めた絵も、段の名前と別の大きさになる。空の状態の大きな絵・分割の
// 落とし先の絵・読めなかった画像の札の絵は挿し絵で、段の外。

import { expect, test } from "vitest";
import { loadStyleSheet } from "./_css-fixture";

const ICON = /svg|icon|octicon/;
const ILLUSTRATIONS = new Set([
  ".empty .empty-icon",
  ".db-pane-empty-icon .octicon",
  ".main-split-drop-icon svg",
  ".terminal-image-shelf-failed-icon",
]);
// 段の名前の外で絵の大きさを決める書き方: 生の px・文字の大きさ・余白の段。
// (押せる箱の寸法 calc(var(--statusbar-h) - …) などは絵の大きさではないので見ない)
const OFF_STEP =
  /^\d+(\.\d+)?(px|em)$|^var\(--(ui-font|space)-[a-z0-9]+\)$|^calc\(var\(--space-unit\) \* [\d.]+\)$/;

test("icons are sized by the icon steps, not raw px, em or other steps", () => {
  const offenders = loadStyleSheet()
    .filter(
      (rule) => ICON.test(rule.selector) && !ILLUSTRATIONS.has(rule.selector),
    )
    .flatMap((rule) => {
      const width = rule.declarations.get("width");
      const height = rule.declarations.get("height");
      return width && width === height && OFF_STEP.test(width)
        ? [`${rule.selector} { width/height: ${width} }`]
        : [];
    });
  expect(offenders).toEqual([]);
});
