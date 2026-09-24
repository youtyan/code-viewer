// 面・帯の端に操作を接させない (ui-layout.md「面の端に要素を接させない」)。
// 設定の保存の帯が左右の余白 0 で、「変更を保存」が帯の右端にぴったり付いていた。
//
// 実物の style.css のカスケードで、主な帯・面の部品の左右の内側の余白を px に解き、
// 面の角丸以上 (角丸が無ければ 1px 以上) であることを見る。行の面が自分の角丸を持つ
// 一覧 (メニュー・フォルダの一覧) は、余白 + 行の角丸 ≥ 面の角丸 (行の角が面の曲線の
// 内側に収まる) で見る。
import { describe, expect, test } from "vitest";
import {
  baseRules,
  cascadedDeclarations,
  loadStyleSheet,
  resolvePx,
} from "./_css-fixture";

const rules = baseRules(loadStyleSheet());
const tokens = cascadedDeclarations(
  rules,
  (selector) =>
    selector === ":root" || selector === "html" || selector === "body",
);
const declarations = (selector: string) =>
  cascadedDeclarations(rules, (candidate) => candidate === selector);

/** 左右の padding (padding-left / padding-inline / padding の順に読む)。 */
function inlinePadding(selector: string): { left: number; right: number } {
  const block = declarations(selector);
  const inline = block
    .get("padding-inline")
    ?.trim()
    .split(/\s+(?![^(]*\))/);
  const all = block
    .get("padding")
    ?.trim()
    .split(/\s+(?![^(]*\))/);
  const fromShorthand = (side: "left" | "right") => {
    if (!all) return undefined;
    if (all.length === 1) return all[0];
    if (all.length <= 3) return all[1];
    return side === "left" ? all[3] : all[1];
  };
  const side = (name: "left" | "right") => {
    const value =
      block.get(`padding-${name}`) ??
      (inline
        ? name === "left"
          ? inline[0]
          : (inline[1] ?? inline[0])
        : undefined) ??
      fromShorthand(name);
    if (value === undefined)
      throw new Error(`${selector} declares no ${name} padding`);
    return resolvePx(value, tokens);
  };
  return { left: side("left"), right: side("right") };
}

function radius(selector: string): number {
  const value = declarations(selector).get("border-radius");
  return value ? resolvePx(value.trim().split(/\s+(?![^(]*\))/)[0], tokens) : 0;
}

describe("bars and surfaces keep their controls off their left and right edges", () => {
  test.each([
    ".scope-settings-footer",
    ".gdp-dialog",
    "#topbar",
    "#statusbar",
    ".sb-head",
    ".tools-pane-head",
    ".db-toolbar",
    ".db-tab-bar",
    ".db-icon-toolbar",
    ".db-grid-filter-bar",
    ".db-query-history-toolbar",
  ])("%s", (selector) => {
    const least = Math.max(radius(selector), 1);
    const { left, right } = inlinePadding(selector);
    expect({ left: left >= least, right: right >= least }).toEqual({
      left: true,
      right: true,
    });
  });

  test.each([
    [".gdp-context-menu", ".gdp-context-menu button"],
    [".project-directory-list", ".project-directory-row"],
  ])("the rows of %s sit inside its rounded corners", (surface, row) => {
    const { left, right } = inlinePadding(surface);
    const outer = radius(surface);
    const inner = radius(row);
    expect({
      left: left + inner >= outer && left > 0,
      right: right + inner >= outer && right > 0,
    }).toEqual({ left: true, right: true });
  });
});
