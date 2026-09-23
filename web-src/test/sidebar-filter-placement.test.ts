import { readFileSync } from "node:fs";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { describe, expect, test } from "vitest";
import { pageModeClasses } from "../core/page-mode";
import {
  baseRules,
  cascadedDeclarations,
  loadStyleSheet,
} from "./_css-fixture";

const appSource = readFileSync("web-src/app.ts", "utf8");
const html = readFileSync("web/index.html", "utf8");

// 絞り込み欄は動かさない: ファイル一覧 (#file-list) は見出し (.sb-head) の中の
// 2 段目、変更ファイルの一覧 (#sidebar) は見出しの下に貼り付く兄弟。前は 1 つの
// #sidebar を使い回し、画面が変わるたびに placeSidebarFilter が移していた
// (移し忘れると見出しの中に取り残された)。
describe("sidebar filter placement on navigation", () => {
  function functionBody(source: string, name: string): string {
    const start = source.indexOf(`function ${name}(`);
    expect(start > -1).toBe(true);
    const open = source.indexOf("{", start);
    let depth = 0;
    for (let i = open; i < source.length; i++) {
      if (source[i] === "{") depth++;
      else if (source[i] === "}" && --depth === 0)
        return source.slice(open, i + 1);
    }
    throw new Error(`unbalanced braces in ${name}`);
  }

  test.each([
    { list: "file-list", inHead: true },
    { list: "sidebar", inHead: false },
  ])("#$list: the filter is in the head $inHead", ({ list, inHead }) => {
    GlobalRegistrator.register();
    try {
      const page = new DOMParser().parseFromString(html, "text/html");
      const filter = page.querySelector(`#${list} .sb-filter-wrap`);
      expect({
        inHead: filter?.parentElement?.classList.contains("sb-head"),
        besideHead:
          filter?.previousElementSibling?.classList.contains("sb-head") ??
          false,
      }).toEqual({ inHead, besideHead: !inHead });
    } finally {
      GlobalRegistrator.unregister();
    }
  });

  test("setPageMode re-places the file list toggle after page classes change", () => {
    const body = functionBody(appSource, "setPageMode");
    expect(body.includes("placeSidebarToggle()")).toBe(true);
  });

  test("setPageMode re-syncs the sidebar header height", () => {
    const body = functionBody(appSource, "setPageMode");
    expect(body.includes("syncSidebarHeaderHeight()")).toBe(true);
  });

  // 画面の印は core/page-mode.ts の pageModeClasses が決める (index.html の早い
  // スクリプトと共有。web-src/test/first-screen.test.ts)。ここは Diff の印だけを
  // 振る舞いで見る。
  test("setPageMode marks diff pages and clears stale repository target", () => {
    const diff = pageModeClasses(
      { screen: "diff", range: { from: "HEAD", to: "worktree" } },
      false,
    );
    expect([diff.has("gdp-diff-page"), diff.has("gdp-repo-page")]).toEqual([
      true,
      false,
    ]);
    const body = functionBody(appSource, "setPageMode");
    expect(body.includes("repoTargetWrap.hidden = true")).toBe(true);
  });

  // The base .sb-filter-wrap rule is sticky with top: var(--sidebar-head-h);
  // the file list keeps its filter inside the .sb-head grid, so it switches to
  // relative and must zero out that top offset, or the filter renders below
  // the grid row. The magnifier glyph moves with the dropped padding.
  const rules = baseRules(loadStyleSheet());
  const declarations = (selector: string) =>
    cascadedDeclarations(rules, (candidate) => candidate === selector);
  test("the file list filter resets the sticky top offset", () => {
    const wrap = declarations("#file-list .sb-filter-wrap");
    expect([wrap.get("position"), wrap.get("top")]).toEqual(["relative", "0"]);
  });

  test.each([
    "#file-list .sb-filter-wrap::before",
    "#file-list .sb-filter-wrap::after",
  ])("%s re-positions the magnifier glyph", (selector) => {
    const glyph = declarations(selector);
    expect([glyph.has("left"), glyph.has("top")]).toEqual([true, true]);
  });
});
