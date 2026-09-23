// 狭い面・狭い帯でも、中身が面の外へはみ出したり語が潰れたりしないための宣言。
import { expect, test } from "vitest";
import {
  baseRules,
  cascadedDeclarations,
  loadStyleSheet,
  resolveVar,
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
  // 本文は窓ではなく自分の箱でスクロールする (縦のスクロールバーを窓の右端に
  // 出さない)。箱の端は本文の端の変数だけを読む
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
  // ファイル一覧と変更ファイルの一覧の見出しも実幅で (件数を省く段階)
  [
    ":is(#sidebar, #file-list) .sb-head",
    "container",
    "sidebar-head / inline-size",
  ],
  // ファイル一覧を畳んでも頭の行 (画面の入口の絵柄と畳むボタン) は横に並んだまま
  // (web-src/test/panel-head-kept.test.ts)。畳んだ列の帯の幅は押せる領域の
  // 大きさ (密度で変わる。特大で絵柄がはみ出した)
  ["#panel-head > #view-head", "flex-direction", "row"],
  ["body", "--panelcol-rail-w", "var(--ui-control-sm)"],
  // プロジェクト名と枝の名前の幅は views/brand-fit.ts が一覧の列の頭の 1 段目の
  // 幅で分ける。枝は自然な幅 (上限は約 40%) まで出して縮めず、名前が残りで省略
  // する (枝が「m」になった)。枝は右寄せ
  [".brand .title", "max-width", "var(--brand-name-max, none)"],
  [".brand .title", "text-overflow", "ellipsis"],
  [".project-branch", "flex", "0 0 auto"],
  [".project-branch", "max-width", "var(--brand-branch-max, 40%)"],
  [".project-branch", "margin-left", "auto"],
  // Diff から開いたファイルの「差分を見る」は自分の欄に置く (欄が無いと空の
  // 間 (0 まで縮む) に自動で置かれ、情報の丸と表示の切替に重なった)
  [
    ".gdp-file-detail-sticky .gdp-file-detail-header > .gdp-view-file",
    "grid-area",
    "back",
  ],
  [
    ".gdp-file-detail-wrapper > .gdp-file-detail-sticky:not(:has(#sidebar-toggle))",
    "grid-template-areas",
    '"path info back tabs nav trash"',
  ],
  // Tools の入力・出力の並べ方は面の実幅で決める。見出しの語は折らない
  [".tools-body", "container", "tools-pane / inline-size"],
  [".tools-pane-title", "white-space", "nowrap"],
  // タブの幅は中身か、列に入らないときに fitTabs が書く --main-tab-w (flex では
  // 縮めない: 縮め方は core/tab-widths.ts)。名前は幅の中で省略する
  [".main-tab", "flex", "0 0 auto"],
  [".main-tab-name", "min-width", "0"],
  [".main-tab-icon", "flex", "0 0 auto"],
  [".main-tab-close", "flex", "0 0 auto"],
  [".main-tab-name", "text-overflow", "ellipsis"],
  // 一覧の見出しが狭い (日本語・特大) とき縮むのは題 (右端の切替を押し出さない)
  [":is(#sidebar, #file-list) .sb-head > .sb-title", "min-width", "0"],
  [
    ":is(#sidebar, #file-list) .sb-head > .sb-title",
    "text-overflow",
    "ellipsis",
  ],
  // 全体ボード: 狭い面では絞り込みを折り返し、アカウントのカードは行を折る
  [".agents-toolbar", "flex-wrap", "wrap"],
  [".agents-filter", "flex-wrap", "wrap"],
  // フォルダ表示もファイル表示と同じ本文の左右の余白 (左端が 8px ずれていた)
  [
    "body.gdp-repo-page #content",
    "padding",
    "var(--content-top-gap) var(--content-pad-x) 48px",
  ],
  // 一覧の見出し: 「ツリー / 一覧」と題の語を折らない
  [
    ":is(#sidebar, #file-list) .sb-head .sb-view-seg",
    "min-width",
    "max-content",
  ],
  [":is(#sidebar, #file-list) .sb-head > .sb-title", "white-space", "nowrap"],
])("%s has %s: %s", (selector, property, expected) => {
  expect(
    cascadedDeclarations(rules, (candidate) => candidate === selector).get(
      property,
    ),
  ).toBe(expected);
});

// 帯が狭いときの段。68em 以下 (1280px の窓で列を開いた 1 面の帯 58.5em を
// 含む): Split / Unified は絵だけにし、次の未閲覧を省く (上の段の中身は約 67em で、
// 入らない分の Split / Unified が帯の外へ押し出されていた)。56em 以下 (2 面の
// 左の面など): 選択欄の頭の絵も省いて枝の名前に幅を回す。
test.each([
  // 80em 以下 (一覧が左の列に移った 1600px の帯 74.8em を含む): 閲覧の数を省く
  ["80em", "#topbar #meta .chip-viewed", "display", "none"],
  ["68em", "#topbar .seg .seg-icon", "display", "block"],
  ["68em", "#topbar .seg .seg-label", "display", "none"],
  ["68em", "#topbar #meta .chip-next-unviewed", "display", "none"],
  ["56em", "#topbar .ref-selector .ref-selector-icon", "display", "none"],
])("narrow topbar (%s): %s has %s: %s", (width, selector, property, expected) => {
  expect(
    cascadedDeclarations(
      allRules.filter(
        (rule) => rule.atRule === `@container topbar (max-width: ${width})`,
      ),
      (candidate) => candidate === selector,
    ).get(property),
  ).toBe(expected);
});

// ファイルの見出しの 2 段目 (Code / Blame / History・行数・行へ移動・コピー): 行数が
// 4 桁以上だと 31em〜約 33em で入らず、コピーだけが 2 行目に落ちた。34em 以下では
// 「行へ移動」の文字だけを先に畳み、31em 以下で行数も畳む。
test.each([
  ["34em", ".gdp-file-detail-sticky .gdp-source-line-jump-label", "none"],
  ["34em", ".gdp-file-detail-sticky .gdp-source-line-count", undefined],
  ["31em", ".gdp-file-detail-sticky .gdp-source-line-jump-label", "none"],
  ["31em", ".gdp-file-detail-sticky .gdp-source-line-count", "none"],
])("narrow file tabs (%s): %s display is %s", (width, selector, expected) => {
  expect(
    cascadedDeclarations(
      allRules.filter(
        (rule) =>
          rule.atRule === `@container file-detail-tabs (max-width: ${width})`,
      ),
      (candidate) => candidate === selector,
    ).get("display"),
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

// タブの幅は中身 (絵・名前の全文・閉じる) で決める。上限は 200 (ターミナルは 240)。
// 列に入りきらないときだけ main-tabs-view.ts の fitTabs が同じ割合で縮めた幅を
// --main-tab-w に書く (縮め方の表は main-tab-widths.test.ts)。前は列の幅をタブの数で
// 割った幅 (88〜120) にしていて、1280 で名前が 1〜2 文字しか読めなかった。
// 宣言を文字列で固定せず、変数を解いて数で比べる。
const tokens = cascadedDeclarations(
  rules,
  (candidate) =>
    candidate === ":root" || candidate === "html" || candidate === "body",
);
/** calc と px だけの式を数にする。 */
function evalCss(expression: string): number {
  const js = expression.replace(/calc\(/g, "(").replace(/(\d*\.?\d+)px/g, "$1");
  if (!/^[\d\s.+\-*/()]*$/.test(js))
    throw new Error(`not a plain length expression: ${expression}`);
  return Function(`return ${js};`)() as number;
}
const px = (value: string) => evalCss(resolveVar(value, tokens));
const unitPx = () => px("var(--space-unit)");

test("main tab width follows its content, capped, and is narrowed only through --main-tab-w", () => {
  const tab = cascadedDeclarations(rules, (c) => c === ".main-tab");
  const terminal = cascadedDeclarations(
    rules,
    (c) => c === '.main-tab[data-kind="terminal"]',
  );
  const maxWidth = px(tab.get("max-width") ?? "");
  expect({
    flex: tab.get("flex"),
    width: tab.get("width"),
    // 列の幅をタブの数で割る最小幅は持たない (名前を削りすぎた)。
    minWidth: tab.get("min-width") ?? null,
    maxInRange: maxWidth >= unitPx() * 50 && maxWidth <= unitPx() * 60,
    terminalMax: px(terminal.get("max-width") ?? "") / unitPx(),
  }).toEqual({
    flex: "0 0 auto",
    width: "var(--main-tab-w, auto)",
    minWidth: null,
    maxInRange: true,
    terminalMax: 60,
  });
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
    '"crumb crumb crumb crumb crumb crumb" "copy open info back nav trash" "tabs tabs tabs tabs tabs tabs"',
  ],
  [
    ".gdp-file-detail-wrapper > .gdp-file-detail-sticky:has(#sidebar-toggle)",
    "grid-template-areas",
    '"toggle crumb crumb crumb crumb crumb crumb" "copy open info back . nav trash" "tabs tabs tabs tabs tabs tabs tabs"',
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

// フォルダの一覧: 名前の欄は 12ch を残し、狭い一覧では日時の欄から省く (名前が
// 0 まで縮み、2 面・特大で名前が消えた)。境目は一覧の実幅と行の文字の大きさ。
test.each([
  [
    null,
    ".gdp-repo-shell .gdp-repo-file-list",
    "container",
    "repo-list / inline-size",
  ],
  [
    null,
    ".gdp-repo-shell .gdp-repo-file-list",
    "font-size",
    "var(--ui-font-md)",
  ],
  [null, ".gdp-repo-shell .gdp-repo-search-bar", "flex-wrap", "wrap"],
  [
    null,
    ".gdp-repo-shell .gdp-repo-row",
    "grid-template-columns",
    "var(--icon-md) minmax(12ch, 1fr) minmax(18ch, 23ch) minmax(18ch, 23ch) 8ch",
  ],
  ["41em", ".gdp-repo-shell .gdp-repo-row > .meta", "display", "none"],
  [
    "41em",
    ".gdp-repo-shell .gdp-repo-row",
    "grid-template-columns",
    "var(--icon-md) minmax(12ch, 1fr) minmax(18ch, 23ch) 8ch",
  ],
  ["29em", ".gdp-repo-shell .gdp-repo-row > .commit-date", "display", "none"],
  [
    "29em",
    ".gdp-repo-shell .gdp-repo-row",
    "grid-template-columns",
    "var(--icon-md) minmax(12ch, 1fr) 8ch",
  ],
])("repo list (%s): %s has %s: %s", (width, selector, property, expected) => {
  const scope =
    width === null
      ? rules
      : allRules.filter(
          (rule) =>
            rule.atRule === `@container repo-list (max-width: ${width})`,
        );
  expect(
    (
      cascadedDeclarations(scope, (candidate) => candidate === selector).get(
        property,
      ) ?? ""
    ).replace(/\s+/g, " "),
  ).toBe(expected);
});

// Diff のカードの見出しの 2 段化: 境目の em は見出しの文字の大きさ (密度で変わる)
// で数え、名前 12ch と操作が 1 段に入らない幅 (48em) から 2 段にする。特大では
// 1 段のまま名前が 32px (「doc…」) になり、2 段にすると折り畳みのボタンだけが
// 1 段目に残った。
test.each([
  [
    null,
    ".d2h-file-wrapper:has(> .d2h-file-header)",
    "font-size",
    "var(--ui-font-md)",
  ],
  ["48em", ".d2h-file-header", "flex-wrap", "wrap"],
  [
    "48em",
    ".d2h-file-header .d2h-file-name-wrapper",
    "flex",
    "1 1 calc(100% - var(--ui-control-sm) - var(--space-2))",
  ],
])("diff card head (%s): %s has %s: %s", (width, selector, property, expected) => {
  const scope =
    width === null
      ? rules
      : allRules.filter(
          (rule) =>
            rule.atRule === `@container diff-file (max-width: ${width})`,
        );
  expect(
    cascadedDeclarations(scope, (candidate) => candidate === selector).get(
      property,
    ),
  ).toBe(expected);
});

// 見出しの件数を省く境目は見出しの文字の大きさに比例 (px だと特大で件数が残り、
// 左の列 319px の題が切れた)。
test("the sidebar head drops the totals below 22em", () => {
  expect(
    cascadedDeclarations(
      allRules.filter(
        (rule) => rule.atRule === "@container sidebar-head (max-width: 22em)",
      ),
      (candidate) =>
        candidate ===
        ":is(#sidebar, #file-list) .sb-head > :is(#totals, #file-list-totals)",
    ).get("display"),
  ).toBe("none");
});

// 一覧の見出し: 題は省略しない。大・特大の既定の幅 (17.5em 以下) では、全部
// 開く / 畳むを 2 段目へ下ろす (日本語・特大で題が「フ…」になった)。素の規則と
// 合わせて重ねて、段の規則が勝つこと (前に書くと詳細度が同じ素の grid-area が
// 勝ち、段が効かなかった)。
test.each([
  [":is(#sidebar, #file-list) .sb-head > .sb-actions", "2 / 5 / auto / 7"],
  [":is(#sidebar, #file-list) .sb-head > .sb-filter-wrap", "2 / 1 / auto / 5"],
])("narrow sidebar head: %s is placed at %s", (selector, expected) => {
  expect(
    cascadedDeclarations(
      allRules.filter(
        (rule) =>
          rule.atRule === null ||
          rule.atRule === "@container sidebar-head (max-width: 17.5em)",
      ),
      (candidate) => candidate === selector,
    ).get("grid-area"),
  ).toBe(expected);
});

// 設定・ヘルプ: 面が 640px 未満 (箱 580px 未満) なら目次を本文の上に畳む (2 面の
// 面で目次 208px の横の本文が 186px になった)。広い面では開閉の 1 行を出さない。
test.each([
  [null, ".gdp-help-shell", "container", "help-shell / inline-size"],
  [null, ".gdp-help-nav-toggle", "display", "none"],
  ["579px", ".gdp-help-layout", "grid-template-columns", "minmax(0, 1fr)"],
  ["579px", ".gdp-help-nav-toggle", "display", "flex"],
  [
    "579px",
    ".gdp-help-layout:not(.gdp-help-nav-open) > .gdp-help-nav",
    "display",
    "none",
  ],
  ["579px", ".gdp-help-nav", "position", "static"],
])("help layout (%s): %s has %s: %s", (width, selector, property, expected) => {
  const scope =
    width === null
      ? rules
      : allRules.filter(
          (rule) =>
            rule.atRule === `@container help-shell (max-width: ${width})`,
        );
  expect(
    cascadedDeclarations(scope, (candidate) => candidate === selector).get(
      property,
    ),
  ).toBe(expected);
});

// Data の表の検索欄は横の操作に押されて潰れない (2 面の左で 18px になった)。
// 面が狭いときは操作を次の行へ折る。
test.each([
  [null, ".db-grid-filter-input", "min-width", "min(100%, 12em)"],
  ["560px", ".db-grid-filter-bar", "flex-wrap", "wrap"],
  ["560px", ".db-grid-edit-controls", "flex-wrap", "wrap"],
])("data grid filter (%s): %s has %s: %s", (width, selector, property, expected) => {
  const scope =
    width === null
      ? rules
      : allRules.filter(
          (rule) => rule.atRule === `@container db-pane (max-width: ${width})`,
        );
  expect(
    cascadedDeclarations(scope, (candidate) => candidate === selector).get(
      property,
    ),
  ).toBe(expected);
});

// Markdown の見出しへ URL の # で送ったとき、貼り付いたファイルの見出しの下に
// 潜らない (見出しの高さは source-view.ts が --doc-head-h に書く)。目次で送る
// とき (markdown-preview.ts) と同じく、その下に 12px 空ける。
test("markdown headings leave room for the sticky file head", () => {
  expect(
    cascadedDeclarations(
      rules,
      (candidate) => candidate === ".gdp-markdown-preview h2",
    ).get("scroll-margin-top"),
  ).toBe("calc(var(--doc-head-h, 0px) + var(--space-3))");
});

// Data の空の面の案内は行の長さをそろえる (最後の行に「+.」だけが残った)。
test("the data pane hint balances its lines", () => {
  expect(
    cascadedDeclarations(
      rules,
      (candidate) => candidate === ".db-pane-empty-hint",
    ).get("text-wrap"),
  ).toBe("balance");
});
