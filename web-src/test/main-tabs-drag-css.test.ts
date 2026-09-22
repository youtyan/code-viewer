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
  // 右の端はタブ列と同じ (本文の右の端 = 右の列の左)。値は固定しない。
  test("the split drop zone ends where the main area ends, left of the right column", () => {
    const rules = baseRules(loadStyleSheet());
    const right = (selector: string) =>
      cascadedDeclarations(rules, (candidate) => candidate === selector).get(
        "right",
      );
    expect(right(".main-split-drop")).toBe(right("#main-tabs"));
  });
});
