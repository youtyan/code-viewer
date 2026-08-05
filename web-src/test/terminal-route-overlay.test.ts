// ?terminal= に載るのは、このドロワーが開いたシェルの ID だけ。
//
// tmux ペインは URL の識別子にならない。ペインはシェルの中の tmux が見せて
// いるもので、開き直すと別のペインを見ていることがあるため、URL に持たせても
// 復元できない。ペイン ID を載せていた古い URL は「開いているだけ」に落ちる。

import { describe, expect, test } from "vitest";
import { parseTerminalOverlay, withTerminalOverlay } from "../core/routes";

describe("terminal overlay query parsing", () => {
  test.each([
    {
      name: "reads the selected shell",
      search: "?terminal=shell-ab12cd",
      expected: "shell-ab12cd",
    },
    {
      name: "keeps the shell when other params are present",
      search: "?from=HEAD&terminal=shell-ab12cd&to=worktree",
      expected: "shell-ab12cd",
    },
    {
      name: "treats an explicit open marker as open without a target",
      search: "?terminal=open",
      expected: "open",
    },
    {
      name: "treats an empty value as open without a target",
      search: "?terminal=",
      expected: "open",
    },
    {
      name: "treats a non shell value as open without a target",
      search: "?terminal=nope",
      expected: "open",
    },
    {
      // ドロワーが tmux ペインを直接映していた頃の URL。ブックマークや履歴に
      // 残っていても、開いているだけの状態として扱う。
      name: "treats a legacy tmux pane id as open without a target",
      search: "?terminal=%2514",
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
      name: "adds the shell to a bare path",
      url: "/",
      state: "shell-ab12cd" as const,
      expected: "/?terminal=shell-ab12cd",
    },
    {
      name: "marks the drawer open before a shell is chosen",
      url: "/",
      state: "open" as const,
      expected: "/?terminal=open",
    },
    {
      name: "replaces an existing shell",
      url: "/?terminal=shell-ab12cd",
      state: "shell-ef34gh" as const,
      expected: "/?terminal=shell-ef34gh",
    },
    {
      name: "keeps the other query params",
      url: "/todif?from=HEAD&to=worktree",
      state: "shell-ab12cd" as const,
      expected: "/todif?from=HEAD&to=worktree&terminal=shell-ab12cd",
    },
    {
      name: "coexists with the tools overlay",
      url: "/?tools=markdown",
      state: "shell-ab12cd" as const,
      expected: "/?tools=markdown&terminal=shell-ab12cd",
    },
    {
      name: "removes the shell and keeps the rest",
      url: "/todif?from=HEAD&terminal=shell-ab12cd",
      state: null,
      expected: "/todif?from=HEAD",
    },
    {
      name: "drops the query entirely when nothing is left",
      url: "/?terminal=shell-ab12cd",
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

  test("round-trips a shell id through parse", () => {
    for (const shell of ["shell-a1b2c3", "shell-000000", "shell-zz99zz00"]) {
      const url = withTerminalOverlay("/history?ref=main", shell);
      expect(parseTerminalOverlay(url.slice(url.indexOf("?")))).toBe(shell);
    }
  });
});
