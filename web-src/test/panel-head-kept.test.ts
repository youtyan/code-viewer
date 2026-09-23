// 右の列を畳む = 本体 (木) だけを畳む。頭の行 (#panel-head: 画面の入口の絵柄と
// 畳むボタン) は同じ幅で残り、タブ列の右端・分割のボタン・絵柄は動かない
// (ui-layout.md の「一覧の列と右の列」)。本文は頭の行の下から右端まで使う。
//
// 状態は body の印の組み合わせ (右の列を畳んだ・2 面・一覧の列を出す画面)。値は
// 固定せず、骨格の変数から組み立てた式と比べる。

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

const STATES = [
  { name: "開いた右の列", marks: [] },
  { name: "畳んだ右の列", marks: [FOLDED] },
  { name: "2 面", marks: [SPLIT] },
  { name: "2 面・畳んだ", marks: [SPLIT, FOLDED] },
  { name: "一覧の画面 (自動で畳んだ)", marks: [LIST, FOLDED] },
  { name: "一覧の画面・2 面", marks: [LIST, SPLIT, FOLDED] },
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

describe("右の列の頭の行は畳んでも残る", () => {
  const head = resolved("var(--panelcol-w)", []);

  test.each(STATES)("$name: 頭の行の幅とタブ列の右端は開いたときと同じ", ({
    marks,
  }) => {
    expect({
      head: resolved(declarationsOn("#panel-head", marks).get("width"), marks),
      tabsRight: resolved(
        declarationsOn("#main-tabs", marks).get("right"),
        marks,
      ),
    }).toEqual({ head, tabsRight: head });
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

  test.each(STATES)("$name: 本体の幅は開いていれば頭と同じ、畳めば 0", ({
    marks,
  }) => {
    expect(resolved("var(--panelcol-shown)", marks)).toBe(
      marks.includes(FOLDED) ? "0px" : head,
    );
  });

  test("畳んだ 1 面の本文は右端まで", () => {
    expect(resolved("var(--page-right)", [FOLDED])).toBe("0px");
  });
});

// 縦の帯 (#panel-rail) は無くした。畳むボタンは頭の行の右端に 1 つだけ。
describe("縦の帯の痕跡が無い", () => {
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
