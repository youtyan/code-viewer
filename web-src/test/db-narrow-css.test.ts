// Data の狭い列 (1280 の 2 面の左の面など) で、欄が潰れたり文が途中で切れたり
// しないための宣言。要素に当たる規則の集まりで、勝ち残る値を見る。
import { expect, test } from "vitest";
import {
  baseRules,
  cascadedDeclarations,
  loadStyleSheet,
} from "./_css-fixture";

const rules = baseRules(loadStyleSheet());

// 要素ごとに当たる規則のセレクタ (後ろの節の `.db-root` の上書きも含める)。
const ELEMENTS = {
  selectRow: [".db-select-row"],
  datastoreSelect: [
    ".db-file-select",
    ".db-select-row .db-file-select",
    ".db-root .db-file-select",
  ],
  failedRefresh: [
    ".db-refresh-result",
    ".db-pane-error",
    ".db-refresh-result.db-pane-error",
    ".db-root .db-pane-error",
  ],
  s3SortSelect: [".s3-sort-select", ".db-root .s3-sort-select"],
};

test.each([
  // 失敗の文を次の行へ送れるよう、行は折り返す
  ["selectRow", "flex-wrap", "wrap"],
  // データストアの select は一番長い選択肢の幅を取らず (ボタンを次の行へ
  // 落とさない)、名前が読める幅より縮まない (34px の空の箱になった)
  ["datastoreSelect", "flex", "1 1 0"],
  ["datastoreSelect", "min-width", "min(100%, 8em)"],
  // 失敗の文は行いっぱいで折り返す (1 行のまま select を押し潰して切れた)
  ["failedRefresh", "flex", "1 1 100%"],
  ["failedRefresh", "white-space", "normal"],
  ["failedRefresh", "overflow-wrap", "anywhere"],
  // S3 の並び順は名前を削らない (「更」まで潰れた)。収まらなければ次の行へ
  ["s3SortSelect", "flex", "1 0 auto"],
] as const)("%s: %s is %s", (element, property, value) => {
  const selectors = new Set<string>(ELEMENTS[element]);
  const declarations = cascadedDeclarations(rules, (selector) =>
    selectors.has(selector),
  );
  expect(declarations.get(property)).toBe(value);
});

test("the S3 option row wraps so the sort select can take its own line", () => {
  const declarations = cascadedDeclarations(
    rules,
    (selector) => selector === ".s3-options-row",
  );
  expect(declarations.get("flex-wrap")).toBe("wrap");
});
