// タブをドラッグしている間の見た目 (ui-surface.md の「タブの決まり」)。
// 右に分割のドロップ先は右の端 0 に置かれ、右の列 (木) を覆っていた。
// (画面全体が薄くならないことは main-tabs-view.test.ts のドラッグの検査。)

import { describe, expect, test } from "vitest";
import {
  baseRules,
  cascadedDeclarations,
  loadStyleSheet,
} from "./_css-fixture";

describe("main tabs while a tab is dragged", () => {
  // 右の端は本文の面の箱と同じ (本文の右の端 = 右の列の本体の左。右の列を畳めば
  // 窓の右端)。タブ列の右端は右の列の頭の左で、畳んでも動かないので比べない。
  // 値は固定しない。
  test("the split drop zone ends where the main area ends, left of the right column", () => {
    const rules = baseRules(loadStyleSheet());
    const right = (selector: string) =>
      cascadedDeclarations(rules, (candidate) => candidate === selector).get(
        "right",
      );
    expect(right(".main-split-drop")).toBe(right(".main-pane-host"));
  });
});

// 2 面のとき、フォーカスのある面のタブ列の下端の線 (ui-surface.md の「タブの決まり」)。
// happy-dom は ::after の計算値を返さない (要素の値が返る) ので、解決した宣言で見る。
// 前面のタブの上端の線と同じ色・太さにする (値そのものは固定しない)。
describe("the focused side mark while split", () => {
  test("draws a line as wide as the pane, in the same colour and weight as the focused tab line", () => {
    const rules = baseRules(loadStyleSheet());
    const declarations = (selector: string) =>
      cascadedDeclarations(rules, (candidate) => candidate === selector);
    const line = declarations(
      "body.main-split .main-tabs-pane.main-tabs-pane-focused::after",
    );
    const tabLine = declarations(".main-tab.main-tab-focused::before");
    expect([
      declarations(".main-tabs-pane").get("position"),
      line.get("position"),
      line.get("left"),
      line.get("right"),
      line.get("background"),
      line.get("height"),
    ]).toEqual([
      "relative",
      "absolute",
      "0",
      "0",
      tabLine.get("background"),
      tabLine.get("height"),
    ]);
  });
});
