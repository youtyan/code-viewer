import { describe, expect, test } from "bun:test";
import { parseTerminalOverlay, withTerminalOverlay } from "../core/routes";

describe("terminal overlay query parsing", () => {
  test.each([
    {
      name: "reads the selected pane",
      search: "?terminal=%251",
      expected: "%1",
    },
    {
      name: "reads a multi digit pane id",
      search: "?terminal=%25142",
      expected: "%142",
    },
    {
      name: "keeps the pane when other params are present",
      search: "?from=HEAD&terminal=%2512&to=worktree",
      expected: "%12",
    },
    {
      name: "treats an explicit open marker as open without a pane",
      search: "?terminal=open",
      expected: "open",
    },
    {
      name: "treats an empty value as open without a pane",
      search: "?terminal=",
      expected: "open",
    },
    {
      name: "treats a non pane value as open without a pane",
      search: "?terminal=nope",
      expected: "open",
    },
    {
      name: "treats a missing param as closed",
      search: "?from=HEAD",
      expected: null,
    },
    { name: "treats an empty query as closed", search: "", expected: null },
  ])("$name", ({ search, expected }) => {
    expect(parseTerminalOverlay(search)).toBe(expected);
  });
});

describe("terminal overlay url building", () => {
  test.each([
    {
      name: "adds the pane to a bare path",
      url: "/",
      state: "%1" as const,
      expected: "/?terminal=%251",
    },
    {
      name: "marks the drawer open before a pane is chosen",
      url: "/",
      state: "open" as const,
      expected: "/?terminal=open",
    },
    {
      name: "replaces an existing pane",
      url: "/?terminal=%251",
      state: "%2" as const,
      expected: "/?terminal=%252",
    },
    {
      name: "keeps the other query params",
      url: "/todif?from=HEAD&to=worktree",
      state: "%3" as const,
      expected: "/todif?from=HEAD&to=worktree&terminal=%253",
    },
    {
      name: "coexists with the tools overlay",
      url: "/?tools=markdown",
      state: "%4" as const,
      expected: "/?tools=markdown&terminal=%254",
    },
    {
      name: "removes the pane and keeps the rest",
      url: "/todif?from=HEAD&terminal=%251",
      state: null,
      expected: "/todif?from=HEAD",
    },
    {
      name: "drops the query entirely when nothing is left",
      url: "/?terminal=%251",
      state: null,
      expected: "/",
    },
    {
      name: "leaves a path without the param untouched",
      url: "/history",
      state: null,
      expected: "/history",
    },
  ])("$name", ({ url, state, expected }) => {
    expect(withTerminalOverlay(url, state)).toBe(expected);
  });

  test("round-trips a pane id through parse", () => {
    for (const pane of ["%0", "%7", "%128"]) {
      const url = withTerminalOverlay("/history?ref=main", pane);
      expect(parseTerminalOverlay(url.slice(url.indexOf("?")))).toBe(pane);
    }
  });
});
