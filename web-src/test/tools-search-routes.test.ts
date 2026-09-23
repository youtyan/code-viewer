// Tools と Search はメインの面のタブ (page の画面) で、route は /tools?tool= と
// /search?q=。下パネルだった頃の URL (?tools= / ?results=) は、そのタブの route に
// 読み替える (core/routes.ts の legacyPanelRoute)。
import { describe, expect, test } from "vitest";
import { buildRoute, legacyPanelRoute, parseRoute } from "../core/routes";

const RANGE = { from: "HEAD", to: "worktree" };

describe("the old bottom panel URL opens the tab", () => {
  test.each([
    {
      name: "markdown tool",
      search: "?tools=markdown",
      expected: { screen: "tools", tool: "markdown" },
    },
    {
      name: "mermaid tool",
      search: "?tools=mermaid",
      expected: { screen: "tools", tool: "mermaid" },
    },
    {
      name: "json tool",
      search: "?tools=json",
      expected: { screen: "tools", tool: "json" },
    },
    {
      name: "the tool among other params",
      search: "?from=HEAD&tools=json&to=worktree",
      expected: { screen: "tools", tool: "json" },
    },
    {
      name: "an unknown tool is nothing",
      search: "?tools=nope",
      expected: null,
    },
    { name: "an empty tool is nothing", search: "?tools=", expected: null },
    { name: "no param is nothing", search: "?from=HEAD", expected: null },
    { name: "an empty query string is nothing", search: "", expected: null },
    {
      name: "an empty results value opens Search",
      search: "?results=",
      expected: { screen: "search" },
    },
    {
      name: "the results value is the grep query",
      search: "?results=needle%20path%3Asrc%2F",
      expected: { screen: "search", q: "needle path:src/" },
    },
  ])("$name", ({ search, expected }) => {
    const route = legacyPanelRoute(search, RANGE);
    expect(route).toEqual(expected ? { ...expected, range: RANGE } : null);
  });
});

describe("the Tools and Search routes", () => {
  test.each([
    {
      name: "Tools",
      route: { screen: "tools" as const, range: RANGE },
      url: "/tools",
    },
    {
      name: "Tools with a tool",
      route: { screen: "tools" as const, tool: "json" as const, range: RANGE },
      url: "/tools?tool=json",
    },
    {
      name: "Search",
      route: { screen: "search" as const, range: RANGE },
      url: "/search",
    },
    {
      name: "Search with a query",
      route: { screen: "search" as const, q: "needle path:src/", range: RANGE },
      url: "/search?q=needle+path%3Asrc%2F",
    },
  ])("$name: builds $url and parses back", ({ route, url }) => {
    expect(buildRoute(route)).toBe(url);
    const [pathname, search = ""] = url.split("?");
    expect(
      parseRoute(pathname ?? "", search ? `?${search}` : "", RANGE),
    ).toEqual(route);
  });

  test("an unknown tool in the URL opens Tools with its default tool", () => {
    expect(parseRoute("/tools", "?tool=nope", RANGE)).toEqual({
      screen: "tools",
      range: RANGE,
    });
  });
});
