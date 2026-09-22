// 狭い面・狭い帯でも、中身が面の外へはみ出したり語が潰れたりしないための宣言。
import { expect, test } from "vitest";
import {
  baseRules,
  cascadedDeclarations,
  loadStyleSheet,
} from "./_css-fixture";

const allRules = loadStyleSheet();
const rules = baseRules(allRules);

test.each([
  // fit は親の computed の寸法から行・桁を決め、親の余白を引かない
  [".terminal-screen-row > .terminal-screen", "box-sizing", "content-box"],
  // 画像のタブの 2 段目: 縮むのはパスだけ
  [".image-tab-actions", "flex", "none"],
  // Diff の帯の詰め方は窓でなく帯の実幅 (@container topbar) で決める
  ["#topbar", "container", "topbar / inline-size"],
  // 入らない分は帯の中を横に送る (面の外に押し出さない)
  ["#topbar", "overflow-x", "auto"],
  // 比較対象の選択欄は枝の名前の先頭が読める幅より縮まない (0 だと「|」だけに
  // なった)。選択欄と塊の最小は中身から出す (width で決めると縮めない)
  ["#topbar .ref-selector .ref-input", "min-width", "7ch"],
  ["#topbar .ref-pickers > .ref-selector", "width", "auto"],
  ["#topbar .ref-pickers > .ref-selector", "min-width", "min-content"],
  ["#topbar > .ref-pickers", "min-width", "min-content"],
  // Split / Unified は広い帯では文字だけ
  ["#topbar .seg .seg-icon", "display", "none"],
  // ファイルの見出しの 2 段化は窓でなく箱の幅 (@container diff-file) で決める
  [".d2h-file-wrapper", "container", "diff-file / inline-size"],
  // 作業ツリーの一覧は 2 面なら左の面まで (右の面の下に潜らない)。列は箱の幅で畳む
  [
    "body[data-worktree-overview] #worktree-panel",
    "right",
    "var(--page-right)",
  ],
  [
    "body[data-worktree-overview] #worktree-panel",
    "container",
    "worktree-overview / inline-size",
  ],
  // 本文は窓ではなく自分の箱でスクロールする (縦のスクロールバーを右の列の
  // さらに右に出さない)。箱の端は本文の端の変数だけを読む
  ["#content", "position", "fixed"],
  ["#content", "overflow", "auto"],
  ["#content", "top", "var(--chrome-h)"],
  ["#content", "left", "var(--page-left)"],
  ["#content", "right", "var(--page-right)"],
  ["#content", "bottom", "var(--chrome-bottom)"],
  ["html", "overflow", "hidden"],
  ["body", "overflow", "hidden"],
  // 箱の中の sticky な見出しは、箱の上端 (上の余白の分だけ上) が基準。
  // chrome の変数を読まない
  [".gdp-shell-header", "top", "calc(0px - var(--content-top-gap, 0px))"],
  [".gdp-file-detail-sticky", "top", "calc(0px - var(--content-top-gap, 0px))"],
  // Data は面の実幅で詰め方を決める (2 面の左の面で欄が潰れない)
  [".db-root", "container", "db-pane / inline-size"],
  // 右の列の見出しも実幅で (件数を省く段階)
  ["#sidebar .sb-head", "container", "sidebar-head / inline-size"],
  // 右の列の見出し: 「ツリー / 一覧」と題の語を折らない
  ["#sidebar .sb-head .sb-view-seg", "min-width", "max-content"],
  ["#sidebar .sb-head > .sb-title", "white-space", "nowrap"],
])("%s has %s: %s", (selector, property, expected) => {
  expect(
    cascadedDeclarations(rules, (candidate) => candidate === selector).get(
      property,
    ),
  ).toBe(expected);
});

// 2 面の左の面ほど帯が狭いとき (56em 以下): Split / Unified は絵だけにし、選択欄の
// 頭の絵を省いて枝の名前に幅を回す。
const narrowTopbar = allRules.filter(
  (rule) => rule.atRule === "@container topbar (max-width: 56em)",
);
test.each([
  ["#topbar .seg .seg-icon", "display", "block"],
  ["#topbar .seg .seg-label", "display", "none"],
  ["#topbar .ref-selector .ref-selector-icon", "display", "none"],
])("narrow topbar: %s has %s: %s", (selector, property, expected) => {
  expect(
    cascadedDeclarations(
      narrowTopbar,
      (candidate) => candidate === selector,
    ).get(property),
  ).toBe(expected);
});
