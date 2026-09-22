// ファイルの表示の見出しの行 (パンくず・表示の切替・前後・削除) の格子。
//
// 表示の切替 (Code / Blame / History と行へ移る欄) の箱をサイズの container に
// すると、その箱の中身の幅は 0 とみなされる。広い見出しでは切替は中身の幅で
// 決まる列 (auto) に入るので、container にするとその列が 0 になり、ボタンが
// 列からはみ出して削除の絵柄に重なる (1 面・1600px で実際に起きた)。container に
// してよいのは、狭い見出しで切替が 2 段目の全幅を占めるときだけ (そのときは
// 箱の幅が中身から決まらないので、補助の文字を畳む判定に使える)。
import { describe, expect, test } from "vitest";
import {
  baseRules,
  type CssRule,
  cascadedDeclarations,
  loadStyleSheet,
} from "./_css-fixture";

const all = loadStyleSheet();
const NARROW_HEAD = "@container doc-head (max-width: 760px)";

const HEAD = ".gdp-file-detail-wrapper > .gdp-file-detail-sticky";
const HEAD_WITHOUT_TOGGLE = `${HEAD}:not(:has(#sidebar-toggle))`;
const TABS = ".gdp-file-detail-sticky .gdp-file-detail-tabs";
const SWITCH = `${TABS} .gdp-source-tabs`;

/** 括弧の中の空白では切らずに、トラックの並びを 1 つずつに分ける。 */
function tracks(columns: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of columns.trim()) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (/\s/.test(ch) && depth === 0) {
      if (current) out.push(current);
      current = "";
    } else current += ch;
  }
  if (current) out.push(current);
  return out;
}

/** 名前の領域が乗るトラック。1 行を全部占めるなら "whole row"。 */
function trackOfArea(areas: string, columns: string, name: string): string {
  const rows = [...areas.matchAll(/"([^"]*)"/g)].map((m) =>
    m[1].trim().split(/\s+/),
  );
  const row = rows.find((cells) => cells.includes(name));
  if (!row) throw new Error(`no ${name} area in ${areas}`);
  if (row.every((cell) => cell === name)) return "whole row";
  const sizes = tracks(columns);
  return row
    .map((cell, i) => (cell === name ? sizes[i] : null))
    .filter((size) => size !== null)
    .join(" ");
}

function head(rules: CssRule[], withToggle: boolean) {
  const decls = cascadedDeclarations(rules, (s) =>
    withToggle ? s === HEAD : s === HEAD || s === HEAD_WITHOUT_TOGGLE,
  );
  const tabs = cascadedDeclarations(rules, (s) => s === TABS);
  const items = cascadedDeclarations(rules, (s) => s === SWITCH);
  return {
    tabsTrack: trackOfArea(
      decls.get("grid-template-areas") ?? "",
      decls.get("grid-template-columns") ?? "",
      "tabs",
    ),
    tabsContainer:
      tabs.get("container") ?? tabs.get("container-type") ?? "none",
    // 2 段目で項目が箱に入りきらないとき (1280px の 2 面の Markdown など) は、
    // 窓の外へはみ出させずに折り返す。広い見出しでは列が中身の幅なので折り返さない。
    itemsWrap: items.get("flex-wrap") ?? "nowrap",
  };
}

const wide = baseRules(all);
const narrow = all.filter(
  (rule) => rule.atRule === null || rule.atRule === NARROW_HEAD,
);

describe("file detail head: the view switch box", () => {
  test.each([
    {
      name: "wide head, tree shown (no toggle in the head)",
      rules: wide,
      withToggle: false,
      expected: {
        tabsTrack: "auto",
        tabsContainer: "none",
        itemsWrap: "nowrap",
      },
    },
    {
      name: "wide head with the toggle column",
      rules: wide,
      withToggle: true,
      expected: {
        tabsTrack: "auto",
        tabsContainer: "none",
        itemsWrap: "nowrap",
      },
    },
    {
      name: "narrow head (the switch takes the whole second row)",
      rules: narrow,
      withToggle: false,
      expected: {
        tabsTrack: "whole row",
        tabsContainer: "file-detail-tabs / inline-size",
        itemsWrap: "wrap",
      },
    },
  ])("$name", ({ rules, withToggle, expected }) => {
    expect(head(rules, withToggle)).toEqual(expected);
  });
});
