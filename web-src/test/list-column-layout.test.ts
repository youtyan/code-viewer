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

const LIST_PAGE = "body[data-list-column]:not([data-list-column-hidden])";

/** body に載る変数。listPage なら一覧の列を出している画面の上書きも載せる。 */
function bodyVariables(listPage: boolean): Map<string, string> {
  return cascadedDeclarations(
    rules,
    (selector) =>
      selector === ":root" ||
      selector === "html" ||
      selector === "body" ||
      (listPage && selector === LIST_PAGE),
  );
}

function resolved(name: string, listPage: boolean): string {
  return resolveVar(`var(${name})`, bodyVariables(listPage));
}

function declarations(selectors: string[]): Map<string, string> {
  return cascadedDeclarations(rules, (selector) =>
    selectors.includes(selector),
  );
}

describe("list column layout", () => {
  test.each([
    { name: "一覧の画面", listPage: true },
    { name: "一覧の無い画面", listPage: false },
  ])("$name: 本文の左端は左のサイドバーの右 + 一覧の列の幅", ({ listPage }) => {
    const chromeLeft = resolved("--chrome-left", listPage);
    const list = listPage ? resolved("--list-w", true) : "0px";
    expect(resolved("--page-left", listPage)).toBe(
      `calc(${chromeLeft} + ${list})`,
    );
  });

  test.each([
    { list: "history", element: "#history-panel" },
    { list: "worktree", element: "#worktree-panel" },
    { list: "sidebar", element: "#sidebar" },
  ])("$list: 一覧は左のサイドバーの右に一覧の列の幅で置く", ({
    list,
    element,
  }) => {
    const box = declarations([
      element,
      `body[data-list-column="${list}"] ${element}`,
    ]);
    const vars = bodyVariables(true);
    expect({
      left: resolveVar(box.get("left") ?? "", vars),
      right: box.get("right"),
      width: resolveVar(box.get("width") ?? "", vars),
    }).toEqual({
      left: resolved("--chrome-left", true),
      right: list === "sidebar" ? "auto" : undefined,
      width: resolved("--list-w", true),
    });
  });

  test("一覧の列の掴みは一覧の列の右端 (本文の左端) に重なる", () => {
    const resizer = declarations(["#history-resizer"]);
    expect(resolveVar(resizer.get("left") ?? "", bodyVariables(true))).toBe(
      `calc(${resolved("--page-left", true)} - ${resolved("--space-1", true)})`,
    );
  });
});

// 枝の札と件名の分け方 (core/brand-fit.ts の fitBrandWidths と同じ決まり)。
// 札は先に縮む (縮みやすさが件名より大きい) が、自動の最小幅 (中身と、件名と札の
// 箱の 40% の小さいほう) で止まる。自動の最小幅が効くには、札の列がスクロール
// する箱であってはならない (overflow は visible か clip)。
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
    const vars = bodyVariables(false);
    const gap = resolveVar(title.get("column-gap") ?? "", vars);
    expect(resolveVar(refs.get("width") ?? "", vars)).toBe(
      `calc((100% - ${gap}) * ${BRANCH_SHARE})`,
    );
  });
});
