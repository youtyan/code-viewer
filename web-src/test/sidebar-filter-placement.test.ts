import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const appSource = readFileSync("web-src/app.ts", "utf8");
const sidebarSource = readFileSync("web-src/views/sidebar.ts", "utf8");
const style = readFileSync("web/style.css", "utf8");

// Repo pages move .sb-filter-wrap inside .sb-head (grid layout); every other
// page expects it back outside as the sticky sibling. setPageMode() is the
// single place body page classes flip during SPA navigation, so it must also
// re-place the filter — otherwise navigating repo → diff/history/help leaves
// the filter stranded inside .sb-head until a full reload.
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

  test("placeSidebarFilter moves the filter wrap by sidebar mode", () => {
    const body = functionBody(sidebarSource, "placeSidebarFilter");
    expect(body.includes("sidebarHead.appendChild(filter)")).toBe(true);
    expect(body.includes("sidebarHead.after(filter)")).toBe(true);
  });

  test("setPageMode re-places the sidebar filter after page classes change", () => {
    const body = functionBody(appSource, "setPageMode");
    expect(body.includes("placeSidebarToggle()")).toBe(true);
  });

  test("setPageMode re-syncs the sidebar header height", () => {
    const body = functionBody(appSource, "setPageMode");
    expect(body.includes("syncSidebarHeaderHeight()")).toBe(true);
  });

  test("setPageMode marks diff pages and clears stale repository target", () => {
    const body = functionBody(appSource, "setPageMode");
    expect(body.includes('"gdp-diff-page"')).toBe(true);
    expect(body.includes("repoTargetWrap.hidden = true")).toBe(true);
  });

  // The base .sb-filter-wrap rule is sticky with top: var(--sidebar-head-h);
  // the repo-grid override switches to relative and must zero out that top
  // offset, or the filter renders below the .sb-head grid row.
  test("repo-mode filter override resets the sticky top offset", () => {
    const start = style.indexOf("body.gdp-repo-page .sb-filter-wrap,");
    expect(start > -1).toBe(true);
    const block = style.slice(start, style.indexOf("}", start));
    expect(block.includes("position: relative")).toBe(true);
    expect(block.includes("top: 0")).toBe(true);
  });

  test("repo-mode filter re-positions the magnifier glyph", () => {
    expect(style.includes("body.gdp-repo-page .sb-filter-wrap::before")).toBe(
      true,
    );
    expect(style.includes("body.gdp-repo-page .sb-filter-wrap::after")).toBe(
      true,
    );
  });
});
