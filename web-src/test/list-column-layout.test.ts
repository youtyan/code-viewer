import { describe, expect, test } from "vitest";
import { BRANCH_SHARE } from "../core/brand-fit";
import {
  baseRules,
  cascadedDeclarations,
  loadStyleSheet,
  resolveVar,
} from "./_css-fixture";

// 一覧の列 (ui-layout.md の「一覧の列」)。左のサイドバーの右に、ファイル一覧
// (どの画面でも)・一覧 (Diff の変更ファイルの一覧・History のコミット・選んで
// いる作業ツリー)・変更ファイルの一覧 (History・作業ツリーだけ) の順に置き、本文の
// 左端 (--page-left) はその右。値そのものは固定せず、骨格の変数から組み立てた式と
// 比べる (幅を調整しただけでは落ちず、構造が壊れたときに落ちる)。

const rules = baseRules(loadStyleSheet());

/** 一覧の列の状態 (body の属性)。 */
type Page =
  | "none"
  | "none-files-folded"
  | "sidebar"
  | "sidebar-list-folded"
  | "history"
  | "history-folded"
  | "history-files-folded";

/** その状態の body に当たる規則のセレクタ。 */
function bodySelectors(page: Page): string[] {
  const filesFolded = page.endsWith("files-folded")
    ? ["body.gdp-sidebar-hidden"]
    : [];
  if (page.startsWith("none")) return filesFolded;
  const list = page.startsWith("sidebar") ? "sidebar" : "history";
  const listFolded = page === "sidebar-list-folded";
  return [
    "body[data-list-column]",
    listFolded
      ? "body[data-list-column][data-list-column-hidden]"
      : "body[data-list-column]:not([data-list-column-hidden])",
    ...(listFolded ? ["body[data-list-column-hidden]"] : []),
    `body[data-list-column="${list}"]`,
    ...(listFolded
      ? [`body[data-list-column="${list}"][data-list-column-hidden]`]
      : []),
    ...(page === "history-folded" ? ["body[data-list-tree-folded]"] : []),
    ...filesFolded,
  ];
}

/**
 * body に載る変数。:root (html) の値を継承し、その上に body 自身の宣言
 * (html, body と、その画面の上書き) を重ねる。1 回のカスケードで比べると、
 * 別の要素の :root が詳細度で body の属性つきの規則に勝ってしまう。
 */
function bodyVariables(page: Page): Map<string, string> {
  const extra = bodySelectors(page);
  const inherited = cascadedDeclarations(
    rules,
    (selector) => selector === ":root" || selector === "html",
  );
  const own = cascadedDeclarations(
    rules,
    (selector) => selector === "body" || extra.includes(selector),
  );
  return new Map([...inherited, ...own]);
}

function resolved(name: string, page: Page): string {
  return resolveVar(`var(${name})`, bodyVariables(page));
}

/** その画面で element に当たる宣言 (element 単独と、画面の属性つきの規則)。 */
/** display の値 (!important を外す。宣言が無ければ undefined)。 */
function displayOf(box: Map<string, string>): string | undefined {
  return box.get("display")?.replace(/\s*!important$/, "");
}

function declarationsOn(element: string, page: Page): Map<string, string> {
  const scoped = bodySelectors(page).map((body) => `${body} ${element}`);
  return cascadedDeclarations(
    rules,
    (selector) => selector === element || scoped.includes(selector),
  );
}

describe("list column layout", () => {
  // 本文の左端 = 左のサイドバーの右 + ファイル一覧 + 一覧 + 変更ファイルの一覧
  // (無い列は 0、畳んだファイル一覧は画面の入口の縦の帯の幅、畳んだ一覧と変更ファイルの一覧は帯の幅)。
  test.each([
    { page: "none", files: "--sidebar-w", list: "0px", tree: "0px" },
    {
      page: "none-files-folded",
      files: "--view-rail-w",
      list: "0px",
      tree: "0px",
    },
    { page: "sidebar", files: "--sidebar-w", list: "--list-w", tree: "0px" },
    {
      page: "sidebar-list-folded",
      files: "--sidebar-w",
      list: "--panelcol-rail-w",
      tree: "0px",
    },
    {
      page: "history",
      files: "--sidebar-w",
      list: "--list-w",
      tree: "--sidebar-w",
    },
    {
      page: "history-folded",
      files: "--sidebar-w",
      list: "--list-w",
      tree: "--panelcol-rail-w",
    },
    {
      page: "history-files-folded",
      files: "--view-rail-w",
      list: "--list-w",
      tree: "--sidebar-w",
    },
  ] as const)("$page: 本文の左端はファイル一覧・一覧・変更ファイルの一覧の右", ({
    page,
    files,
    list,
    tree,
  }) => {
    const value = (name: string) =>
      name.startsWith("--") ? resolved(name, page) : name;
    expect(resolved("--page-left", page)).toBe(
      `calc(${resolved("--chrome-left", page)} + calc(${value(files)} + ${value(list)} + ${value(tree)}))`,
    );
  });

  test.each([
    { page: "none", display: "block" },
    { page: "history", display: "block" },
    { page: "none-files-folded", display: "none" },
    { page: "history-files-folded", display: "none" },
  ] as const)("$page: ファイル一覧は左のサイドバーのすぐ右 (畳めば出さない: $display)", ({
    page,
    display,
  }) => {
    const box = declarationsOn("#file-list", page);
    const vars = bodyVariables(page);
    expect({
      left: resolveVar(box.get("left") ?? "", vars),
      width: resolveVar(box.get("width") ?? "", vars),
      display: displayOf(box) ?? "block",
    }).toEqual({
      left: resolved("--chrome-left", page),
      width: resolved("--sidebar-w", page),
      display,
    });
  });

  test.each([
    { page: "history", element: "#history-panel" },
    { page: "history", element: "#worktree-panel" },
    { page: "history-files-folded", element: "#history-panel" },
    { page: "sidebar", element: "#sidebar" },
  ] as const)("$page: 一覧 $element はファイル一覧の右に一覧の幅で置く", ({
    page,
    element,
  }) => {
    const box = declarationsOn(element, page);
    const vars = bodyVariables(page);
    expect({
      left: resolveVar(box.get("left") ?? "", vars),
      width: resolveVar(box.get("width") ?? "", vars),
    }).toEqual({
      left: `calc(${resolved("--chrome-left", page)} + ${resolved("--files-shown", page)})`,
      width: resolved("--list-w", page),
    });
  });

  test("History: 変更ファイルの一覧は一覧の右、本文の左端の手前、一覧の列の頭の下に置く", () => {
    const vars = bodyVariables("history");
    const tree = declarationsOn("#sidebar", "history");
    expect({
      left: resolveVar(tree.get("left") ?? "", vars),
      width: resolveVar(tree.get("width") ?? "", vars),
      top: resolveVar(tree.get("top") ?? "", vars),
    }).toEqual({
      left: `calc(${resolved("--chrome-left", "history")} + ${resolved("--files-shown", "history")} + ${resolved("--list-w", "history")})`,
      width: resolved("--sidebar-w", "history"),
      top: resolved("--panel-body-top", "history"),
    });
  });

  test("History: 変更ファイルの一覧を畳んだら隠し、開くボタンの帯をその場所に出す", () => {
    const vars = bodyVariables("history-folded");
    const tree = declarationsOn("#sidebar", "history-folded");
    const rail = declarationsOn(".list-tree-open", "history-folded");
    expect({
      tree: tree.get("display"),
      rail: rail.get("display"),
      left: resolveVar(rail.get("left") ?? "", vars),
      width: resolveVar(rail.get("width") ?? "", vars),
    }).toEqual({
      tree: "none",
      rail: "flex",
      left: `calc(${resolved("--chrome-left", "history-folded")} + ${resolved("--files-shown", "history-folded")} + ${resolved("--list-w", "history-folded")})`,
      width: resolved("--panelcol-rail-w", "history-folded"),
    });
  });

  test("Diff: 一覧を手で畳んだら隠し、開くボタンの帯をその場所に出す", () => {
    const page = "sidebar-list-folded";
    const vars = bodyVariables(page);
    const list = declarationsOn("#sidebar", page);
    const rail = declarationsOn(".sidebar-open", page);
    expect({
      list: displayOf(list),
      rail: rail.get("display"),
      left: resolveVar(rail.get("left") ?? "", vars),
      width: resolveVar(rail.get("width") ?? "", vars),
    }).toEqual({
      list: "none",
      rail: "flex",
      left: `calc(${resolved("--chrome-left", page)} + ${resolved("--files-shown", page)})`,
      width: resolved("--panelcol-rail-w", page),
    });
  });

  test("掴み: ファイル一覧・一覧の掴みはそれぞれの右端、変更ファイルの一覧の掴みは本文の左端", () => {
    const vars = bodyVariables("history");
    const space = resolved("--space-1", "history");
    const left = (element: string) =>
      resolveVar(declarationsOn(element, "history").get("left") ?? "", vars);
    expect({
      files: left("#file-list-resizer"),
      list: left("#history-resizer"),
      tree: left("#sidebar-resizer"),
    }).toEqual({
      files: `calc(${resolved("--chrome-left", "history")} + ${resolved("--sidebar-w", "history")} - ${space})`,
      list: `calc(${resolved("--chrome-left", "history")} + ${resolved("--files-shown", "history")} + ${resolved("--list-w", "history")} - ${space})`,
      tree: `calc(${resolved("--page-left", "history")} - ${space})`,
    });
  });
});

// 枝の札と件名の分け方 (core/brand-fit.ts の fitBrandWidths と同じ決まり)。
// 札は先に縮む (縮みやすさが件名より大きい) が、自動の最小幅 (中身と、件名と札の
// 箱の 40% の小さいほう) で止まる。自動の最小幅が効くには、札の列がスクロール
// する箱であってはならない (overflow は visible か clip)。
function declarations(selectors: string[]): Map<string, string> {
  return cascadedDeclarations(rules, (selector) =>
    selectors.includes(selector),
  );
}

describe("history ref chips", () => {
  const scope = "#history-panel .history-item";
  const refs = declarations([
    ".history-item .history-refs",
    `${scope} .history-refs`,
  ]);
  const subject = declarations([".history-item .subject", `${scope} .subject`]);
  const title = declarations([`${scope} .history-title`]);

  function flexPart(value: string | undefined, index: number): string {
    const parts = (value ?? "").split(/\s+/);
    if (parts.length !== 3) throw new Error(`flex is not 3 values: ${value}`);
    return parts[index];
  }

  test("札は件名より先に縮み、中身の幅から縮み始める", () => {
    expect({
      refsShrinksFirst:
        Number(flexPart(refs.get("flex"), 1)) >
        Number(flexPart(subject.get("flex"), 1)),
      refsBasis: flexPart(refs.get("flex"), 2),
      subjectMin: subject.get("min-width"),
    }).toEqual({
      refsShrinksFirst: true,
      refsBasis: "content",
      subjectMin: "0",
    });
  });

  // 入りきらない札は縮めて細い線にせず、数を減らす: 札は縮めず 1 行の高さで
  // 折り返し、次の行ごと切る。今の枝の札は先頭。
  test("入りきらない札は数を減らす (縮めない・1 行で折り返して切る)", () => {
    const chip = declarations([
      ".history-ref",
      "#history-panel .history-ref",
      "#history-panel .history-item .history-ref",
    ]);
    const head = declarations([
      "#history-panel .history-item .history-ref-head",
    ]);
    const vars = bodyVariables("none");
    expect({
      wrap: refs.get("flex-wrap"),
      overflow: refs.get("overflow"),
      rowHeight:
        resolveVar(refs.get("height") ?? "", vars) ===
        resolveVar(chip.get("line-height") ?? "", vars),
      chipFlex: chip.get("flex"),
      chipMax: chip.get("max-width"),
      headOrder: head.get("order"),
    }).toEqual({
      wrap: "wrap",
      overflow: "clip",
      rowHeight: true,
      chipFlex: "none",
      chipMax: "100%",
      headOrder: "-1",
    });
  });

  test("札の自動の最小幅が効く (min-width: auto・スクロールしない overflow)", () => {
    expect({
      minWidth: refs.get("min-width"),
      notScrollContainer: ["visible", "clip"].includes(
        refs.get("overflow") ?? "",
      ),
    }).toEqual({ minWidth: "auto", notScrollContainer: true });
  });

  test("札に残す幅は、件名と札の箱から間を除いた幅の 40%", () => {
    const vars = bodyVariables("none");
    const gap = resolveVar(title.get("column-gap") ?? "", vars);
    expect(resolveVar(refs.get("width") ?? "", vars)).toBe(
      `calc((100% - ${gap}) * ${BRANCH_SHARE})`,
    );
  });
});

// 1280px の窓で一覧の列を出した 1 面の Diff の帯 (約 50em) は、件数が大きいと
// 全部の段を当てても中身が余った。54em 以下の段で比較対象の選択欄の文字の欄を
// 狭め、選択欄の内側の余白と間隔を詰める (素の決まりより狭いこと)。
describe("the Diff bar at about 50em", () => {
  const all = loadStyleSheet();
  const stage = all.filter(
    (rule) => rule.atRule === "@container topbar (max-width: 54em)",
  );
  const base = baseRules(all);
  const at = (rules: typeof all, selector: string, prop: string) =>
    cascadedDeclarations(rules, (candidate) => candidate === selector).get(
      prop,
    );
  const ch = (value: string | undefined) =>
    Number.parseFloat((value ?? "").replace("ch", ""));
  test("the ref field, its padding and the gap get narrower", () => {
    expect({
      field:
        ch(at(stage, "#topbar .ref-selector .ref-input", "min-width")) <
        ch(at(base, "#topbar .ref-selector .ref-input", "min-width")),
      padding: [
        at(base, "#topbar .ref-selector", "padding"),
        at(stage, "#topbar .ref-selector", "padding"),
      ],
      gap: [
        at(base, "#topbar > .ref-pickers", "gap"),
        at(stage, "#topbar > .ref-pickers", "gap"),
      ],
    }).toEqual({
      field: true,
      padding: ["0 var(--space-3)", "0 var(--space-2)"],
      gap: ["var(--space-2)", "var(--space-1)"],
    });
  });
});
