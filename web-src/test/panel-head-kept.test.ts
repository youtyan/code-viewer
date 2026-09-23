// ファイル一覧を畳む = 頭の下の一覧だけを畳む。一覧の列の頭 (#panel-head: 画面の
// 入口の絵柄と畳むボタン。タブ列の行の左端) は同じ場所と幅で残り、タブ列の左端
// (名前の枠)・右端 (分割のボタン) は動かない (ui-layout.md の「一覧の列」)。本文は
// 一覧の列の残りの右から使う。
//
// 状態は body の印の組み合わせ (ファイル一覧を畳んだ・2 面・一覧を出す画面・一覧や
// 変更ファイルの一覧を畳んだ)。値は固定せず、骨格の変数から組み立てた式と比べる。

import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import {
  baseRules,
  cascadedDeclarations,
  loadStyleSheet,
  resolveVar,
} from "./_css-fixture";

const sheet = loadStyleSheet();
const rules = baseRules(sheet);

const FOLDED = "body.gdp-sidebar-hidden";
const SPLIT = "body.main-split";
const LIST = "body[data-list-column]:not([data-list-column-hidden])";
const LIST_FOLDED = "body[data-list-column][data-list-column-hidden]";
const TREE_FOLDED = "body[data-list-tree-folded]";

const STATES = [
  { name: "ファイル一覧だけ", marks: [] },
  { name: "ファイル一覧を畳んだ", marks: [FOLDED] },
  { name: "2 面", marks: [SPLIT] },
  { name: "2 面・ファイル一覧を畳んだ", marks: [SPLIT, FOLDED] },
  { name: "一覧の画面", marks: [LIST] },
  {
    name: "一覧の画面・変更ファイルの一覧を畳んだ",
    marks: [LIST, TREE_FOLDED],
  },
  { name: "一覧の画面・一覧を畳んだ", marks: [LIST_FOLDED] },
  {
    name: "一覧の画面・2 面・全部畳んだ",
    marks: [LIST, SPLIT, FOLDED, TREE_FOLDED],
  },
];

/** その状態の body の変数 (:root と html を継ぎ、body と印の宣言を重ねる)。 */
function variables(marks: string[]): Map<string, string> {
  return new Map([
    ...cascadedDeclarations(rules, (s) => s === ":root" || s === "html"),
    ...cascadedDeclarations(rules, (s) => s === "body" || marks.includes(s)),
  ]);
}

/** その状態で element に当たる宣言 (element 単独と、印の付いた規則)。 */
function declarationsOn(element: string, marks: string[]) {
  const scoped = marks.map((mark) => `${mark} ${element}`);
  return cascadedDeclarations(
    rules,
    (s) => s === element || scoped.includes(s),
  );
}

function resolved(value: string | undefined, marks: string[]): string {
  if (value === undefined) throw new Error("no declaration");
  return resolveVar(value, variables(marks));
}

describe("一覧の列の頭の行は畳んでも残る", () => {
  const headLeft = resolved("var(--chrome-left)", []);
  const headWidth = resolved("var(--column-head-w)", []);

  test.each(
    STATES,
  )("$name: 頭の左端と幅、タブ列の左端と右端はファイル一覧だけのときと同じ", ({
    marks,
  }) => {
    const head = declarationsOn("#panel-head", marks);
    const tabs = declarationsOn("#main-tabs", marks);
    expect({
      headLeft: resolved(head.get("left"), marks),
      headWidth: resolved(head.get("width"), marks),
      tabsLeft: resolved(tabs.get("left"), marks),
      tabsRight: resolved(tabs.get("right"), marks),
    }).toEqual({
      headLeft,
      headWidth,
      tabsLeft: resolved("calc(var(--chrome-left) + var(--column-head-w))", []),
      tabsRight: "0px",
    });
  });

  test.each(STATES)("$name: 頭の行は 1 段のまま (高さ・下端を変えない)", ({
    marks,
  }) => {
    const on = declarationsOn("#panel-head", marks);
    expect({
      height: resolved(on.get("height"), marks),
      bottom: on.get("bottom"),
    }).toEqual({
      height: resolved("var(--global-header-h)", marks),
      bottom: undefined,
    });
  });

  test.each(
    STATES,
  )("$name: ファイル一覧の幅は開いていれば --sidebar-w、畳めば 0", ({
    marks,
  }) => {
    expect(resolved("var(--files-shown)", marks)).toBe(
      marks.includes(FOLDED) ? "0px" : resolved("var(--sidebar-w)", []),
    );
  });

  test("右端に列は無い: 1 面の本文は窓の右端まで", () => {
    expect([
      resolved("var(--page-right)", []),
      resolved("var(--page-right)", [FOLDED]),
    ]).toEqual(["0px", "0px"]);
  });
});

// 縦の帯 (#panel-rail) と右の列は無くした。畳むボタンは頭の行の右端に 1 つだけ。
describe("縦の帯と右の列の痕跡が無い", () => {
  test("style.css に右の列の変数 (--panelcol-shown・--panelcol-head-w) が無い", () => {
    const css = readFileSync("web/style.css", "utf8");
    expect(
      ["--panelcol-shown", "--panelcol-head-w", "--panelcol-w:"].filter(
        (name) => css.includes(name),
      ),
    ).toEqual([]);
  });

  test("style.css に .panel-rail の規則が無い", () => {
    expect(
      sheet
        .filter((rule) => rule.selector.includes("panel-rail"))
        .map((rule) => rule.selector),
    ).toEqual([]);
  });

  test("index.html に #panel-rail が無い", () => {
    expect(readFileSync("web/index.html", "utf8").includes("panel-rail")).toBe(
      false,
    );
  });
});
