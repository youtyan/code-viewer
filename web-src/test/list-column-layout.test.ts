import { describe, expect, test } from "vitest";
import { BRANCH_SHARE } from "../core/brand-fit";
import {
  baseRules,
  cascadedDeclarations,
  loadStyleSheet,
  resolveVar,
} from "./_css-fixture";

// 本文の左の一覧の列 (ui-layout.md の「一覧の列と右の列」)。一覧 (Diff の変更
// ファイル・History のコミット・選んでいる作業ツリー) は左のサイドバーの右に
// 置き、本文の左端 (--page-left) はその右。値そのものは固定せず、骨格の変数から
// 組み立てた式と比べる (幅を調整しただけでは落ちず、構造が壊れたときに落ちる)。

const rules = baseRules(loadStyleSheet());

/** 一覧の列を出す画面の状態 (body の属性)。 */
type Page = "none" | "sidebar" | "history" | "history-folded";

/** その状態の body に当たる規則のセレクタ。 */
function bodySelectors(page: Page): string[] {
  if (page === "none") return [];
  const list = page === "sidebar" ? "sidebar" : "history";
  return [
    "body[data-list-column]:not([data-list-column-hidden])",
    `body[data-list-column="${list}"]`,
    ...(page === "history-folded" ? ["body[data-list-tree-folded]"] : []),
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
function declarationsOn(element: string, page: Page): Map<string, string> {
  const scoped = bodySelectors(page).map((body) => `${body} ${element}`);
  return cascadedDeclarations(
    rules,
    (selector) => selector === element || scoped.includes(selector),
  );
}

describe("list column layout", () => {
  // 本文の左端 = 左のサイドバーの右 + 一覧 + 変更ファイルの木 (木の無い画面は 0、
  // 畳んだら帯の幅)。
  test.each([
    { page: "none", list: "0px", tree: "0px" },
    { page: "sidebar", list: "--list-w", tree: "0px" },
    { page: "history", list: "--list-w", tree: "--sidebar-w" },
    { page: "history-folded", list: "--list-w", tree: "--panelcol-rail-w" },
  ] as const)("$page: 本文の左端は一覧と木の右", ({ page, list, tree }) => {
    const value = (name: string) =>
      name.startsWith("--") ? resolved(name, page) : name;
    expect(resolved("--page-left", page)).toBe(
      `calc(${resolved("--chrome-left", page)} + calc(${value(list)} + ${value(tree)}))`,
    );
  });

  test.each([
    { page: "history", element: "#history-panel" },
    { page: "history", element: "#worktree-panel" },
    { page: "sidebar", element: "#sidebar" },
  ] as const)("$page: 一覧 $element は左のサイドバーの右に一覧の幅で置く", ({
    page,
    element,
  }) => {
    const box = declarationsOn(element, page);
    const vars = bodyVariables(page);
    expect({
      left: resolveVar(box.get("left") ?? "", vars),
      width: resolveVar(box.get("width") ?? "", vars),
    }).toEqual({
      left: resolved("--chrome-left", page),
      width: resolved("--list-w", page),
    });
  });

  test("History: 変更ファイルの木は一覧の右、本文の左端の手前に置く", () => {
    const vars = bodyVariables("history");
    const tree = declarationsOn("#sidebar", "history");
    const left = resolveVar(tree.get("left") ?? "", vars);
    const width = resolveVar(tree.get("width") ?? "", vars);
    expect({
      left,
      width,
      top: resolveVar(tree.get("top") ?? "", vars),
    }).toEqual({
      left: `calc(${resolved("--chrome-left", "history")} + ${resolved("--list-w", "history")})`,
      width: resolved("--sidebar-w", "history"),
      top: resolved("--global-header-h", "history"),
    });
  });

  test("History: 木を畳んだら木を隠し、開くボタンの帯を木の場所に出す", () => {
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
      left: `calc(${resolved("--chrome-left", "history-folded")} + ${resolved("--list-w", "history-folded")})`,
      width: resolved("--panelcol-rail-w", "history-folded"),
    });
  });

  test("掴み: 一覧の掴みは一覧の右端、木の掴みは本文の左端", () => {
    const vars = bodyVariables("history");
    const space = resolved("--space-1", "history");
    expect({
      list: resolveVar(
        declarationsOn("#history-resizer", "history").get("left") ?? "",
        vars,
      ),
      tree: resolveVar(
        declarationsOn("#sidebar-resizer", "history").get("left") ?? "",
        vars,
      ),
    }).toEqual({
      list: `calc(${resolved("--chrome-left", "history")} + ${resolved("--list-w", "history")} - ${space})`,
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
