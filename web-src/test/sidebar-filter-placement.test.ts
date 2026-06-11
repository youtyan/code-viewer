import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const appSource = readFileSync("web-src/app.ts", "utf8");
const sidebarSource = readFileSync("web-src/views/sidebar.ts", "utf8");

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
});
