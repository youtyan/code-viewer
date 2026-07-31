import { describe, expect, test } from "vitest";
import { parseToolsOverlay, withToolsOverlay } from "../core/routes";

describe("tools overlay query parsing", () => {
  test.each([
    {
      name: "reads the markdown tool",
      search: "?tools=markdown",
      expected: "markdown",
    },
    {
      name: "reads the mermaid tool",
      search: "?tools=mermaid",
      expected: "mermaid",
    },
    { name: "reads the json tool", search: "?tools=json", expected: "json" },
    {
      name: "keeps the tool when other params are present",
      search: "?from=HEAD&tools=json&to=worktree",
      expected: "json",
    },
    {
      name: "treats an unknown tool as closed",
      search: "?tools=nope",
      expected: null,
    },
    {
      name: "treats an empty value as closed",
      search: "?tools=",
      expected: null,
    },
    {
      name: "treats a missing param as closed",
      search: "?from=HEAD",
      expected: null,
    },
    { name: "treats an empty query as closed", search: "", expected: null },
  ])("$name", ({ search, expected }) => {
    expect(parseToolsOverlay(search)).toBe(expected);
  });
});

describe("tools overlay url building", () => {
  test.each([
    {
      name: "adds the tool to a bare path",
      url: "/",
      tool: "markdown" as const,
      expected: "/?tools=markdown",
    },
    {
      name: "replaces an existing tool",
      url: "/?tools=markdown",
      tool: "json" as const,
      expected: "/?tools=json",
    },
    {
      name: "keeps the other query params",
      url: "/todif?from=HEAD&to=worktree",
      tool: "json" as const,
      expected: "/todif?from=HEAD&to=worktree&tools=json",
    },
    {
      name: "coexists with the doctor overlay",
      url: "/?doctor=open",
      tool: "mermaid" as const,
      expected: "/?doctor=open&tools=mermaid",
    },
    {
      name: "removes the tool and keeps the rest",
      url: "/todif?from=HEAD&tools=json",
      tool: null,
      expected: "/todif?from=HEAD",
    },
    {
      name: "drops the query entirely when nothing is left",
      url: "/?tools=markdown",
      tool: null,
      expected: "/",
    },
    {
      name: "leaves a path without the param untouched",
      url: "/history",
      tool: null,
      expected: "/history",
    },
  ])("$name", ({ url, tool, expected }) => {
    expect(withToolsOverlay(url, tool)).toBe(expected);
  });

  test("round-trips through parse for every tool", () => {
    for (const tool of ["markdown", "mermaid", "json"] as const) {
      const url = withToolsOverlay("/history?ref=main", tool);
      expect(parseToolsOverlay(url.slice(url.indexOf("?")))).toBe(tool);
    }
  });
});
