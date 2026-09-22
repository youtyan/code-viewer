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
  // 畳んだ右の列 (帯) は開くボタンと画面の入口の絵柄を縦に並べる (絵柄をタブ列の
  // 左へ移すと、2 面の狭い面でタブが 38px まで潰れた)。帯の幅は押せる領域の
  // 大きさ (密度で変わる。特大で絵柄がはみ出した)
  ["body.gdp-sidebar-hidden .panel-rail", "flex-direction", "column"],
  [".panel-rail > .view-strip", "flex-direction", "column"],
  ["body", "--panelcol-rail-w", "var(--ui-control-sm)"],
  // プロジェクト名と枝の名前の幅は views/brand-fit.ts が分ける。枝は自然な幅
  // (上限は約 40%) まで出して縮めず、名前が残りで省略する (枝が「m」になった)
  [".brand .title", "max-width", "var(--brand-name-max, 60%)"],
  [".project-branch", "flex", "0 0 auto"],
  [".project-branch", "max-width", "var(--brand-branch-max, min(20vw, 260px))"],
  // Tools の入力・出力の並べ方は面の実幅で決める。見出しの語は折らない
  [".tools-body", "container", "tools-pane / inline-size"],
  [".tools-pane-title", "white-space", "nowrap"],
  // タブの最小幅は列の幅から決める (列が入れ物)。入らないときタブは縮む
  [".main-tabs-strip", "container-type", "inline-size"],
  [".main-tab", "flex", "0 1 auto"],
  [".main-tab-icon", "flex", "0 0 auto"],
  [".main-tab-close", "flex", "0 0 auto"],
  [".main-tab-name", "text-overflow", "ellipsis"],
  // 木の見出しが狭い (日本語・特大) とき縮むのは題 (右端の切替を押し出さない)
  ["#sidebar .sb-head > .sb-title", "min-width", "0"],
  ["#sidebar .sb-head > .sb-title", "text-overflow", "ellipsis"],
  // 全体ボード: 狭い面では絞り込みを折り返し、アカウントのカードは行を折る
  [".agents-toolbar", "flex-wrap", "wrap"],
  [".agents-filter", "flex-wrap", "wrap"],
  // フォルダ表示もファイル表示と同じ本文の左右の余白 (左端が 8px ずれていた)
  [
    "body.gdp-repo-page #content",
    "padding",
    "var(--content-top-gap) var(--content-pad-x) 48px",
  ],
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

// アカウントのカードは 1 行に最大 4 枚で、1 枚が最小の幅を下回るなら行を折る
// (4 列固定だと面 486px で 1 枚 101px になり、使用量の文字がはみ出した)。
test("account cards wrap instead of shrinking below their minimum width", () => {
  const columns =
    cascadedDeclarations(
      rules,
      (candidate) => candidate === ".agents-accounts-cards",
    ).get("grid-template-columns") ?? "";
  expect([
    columns.replace(/\s+/g, " ").startsWith("repeat( auto-fill,"),
    columns.includes("var(--agents-account-card-min)"),
  ]).toEqual([true, true]);
});

// タブの最小幅: ふだん 120、列に全部が 120 で入らないときは列の幅をタブの数で
// 割った幅まで、88 で止める (畳んだ 1280 の左の面でタブが 120 固定で 1.8 枚
// しか見えなかった)。タブの数は main-tabs-view.ts が --main-tab-count へ書く。
test("main tabs shrink to the strip width divided by the tab count, down to 88px", () => {
  const minWidth = (
    cascadedDeclarations(rules, (candidate) => candidate === ".main-tab").get(
      "min-width",
    ) ?? ""
  ).replace(/\s+/g, " ");
  expect(minWidth).toBe(
    "clamp( calc(var(--space-unit) * 22), (100cqi - (var(--main-tab-count, 1) - 1) * 1px) / var(--main-tab-count, 1), calc(var(--space-unit) * 30) )",
  );
});

// Tools の面が狭い (2 面の左の面 486px など) ときは入力を上、出力を下に積む。
const narrowTools = allRules.filter(
  (rule) => rule.atRule === "@container tools-pane (max-width: 560px)",
);
test.each([
  [".tools-pane", "grid-template-columns", "minmax(0, 1fr)"],
  [".tools-pane", "grid-template-rows", "minmax(0, 1fr) minmax(0, 1fr)"],
  [".tools-pane-resizer", "display", "none"],
  [".tools-pane-output", "border-left", "0"],
])("narrow tools pane: %s has %s: %s", (selector, property, expected) => {
  expect(
    cascadedDeclarations(
      narrowTools,
      (candidate) => candidate === selector,
    ).get(property),
  ).toBe(expected);
});

// ファイルの見出しで、パンくずに 240px 残らない幅では操作 (コピー・OS で開く・
// 情報・先頭/末尾・ごみ箱) を 2 段目へ下ろす。消さずに全部残す。
const narrowDocHead = allRules.filter(
  (rule) => rule.atRule === "@container doc-head (max-width: 509px)",
);
test.each([
  [
    ".gdp-file-detail-wrapper > .gdp-file-detail-sticky:not(:has(#sidebar-toggle))",
    "grid-template-areas",
    '"crumb crumb crumb crumb crumb crumb" "copy open info . nav trash" "tabs tabs tabs tabs tabs tabs"',
  ],
  [
    ".gdp-file-detail-wrapper > .gdp-file-detail-sticky:has(#sidebar-toggle)",
    "grid-template-areas",
    '"toggle crumb crumb crumb crumb crumb crumb" "copy open info . . nav trash" "tabs tabs tabs tabs tabs tabs tabs"',
  ],
  [".gdp-file-detail-sticky .gdp-file-detail-path", "display", "contents"],
  [
    ".gdp-file-detail-sticky .gdp-file-detail-path > .gdp-copy-path",
    "grid-area",
    "copy",
  ],
  [
    ".gdp-file-detail-sticky .gdp-file-detail-path > .gdp-open-path",
    "grid-area",
    "open",
  ],
])("narrow file head: %s has %s: %s", (selector, property, expected) => {
  expect(
    (
      cascadedDeclarations(
        narrowDocHead,
        (candidate) => candidate === selector,
      ).get(property) ?? ""
    ).replace(/\s+/g, " "),
  ).toBe(expected);
});
