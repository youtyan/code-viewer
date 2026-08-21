import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import type { GrepResponse } from "../core/types";
import { createSearchResultsView } from "../views/search-results-view";
import { q, waitFor } from "./_test-helpers";

beforeAll(() => {
  GlobalRegistrator.register();
});

afterAll(() => {
  GlobalRegistrator.unregister();
});

afterEach(() => {
  document.body.innerHTML = "";
});

function setup(
  options: { regex?: boolean; matches?: GrepResponse["matches"] } = {},
) {
  document.body.innerHTML =
    '<aside id="search-sheet" hidden aria-hidden="true" inert></aside>';
  const urls: string[] = [];
  const opened: Array<{ path: string; line: number; hl?: string }> = [];
  const patches: unknown[] = [];
  const queries: string[] = [];
  let regex = options.regex === true;
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    writable: true,
    value: (input: string | URL | Request) => {
      const url = String(input);
      urls.push(url);
      const body: GrepResponse = {
        ref: "worktree",
        engine: "rg",
        truncated: false,
        generation: 1,
        matches: options.matches ?? [
          {
            path: "src/a.ts",
            line: 3,
            column: 2,
            preview: "const needle = 1;",
            matchText: "needle",
          },
          { path: "src/a.ts", line: 9, column: 1, preview: "needle();" },
          { path: "lib/b.ts", line: 1, column: 5, preview: "// needle" },
        ],
      };
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          headers: { "content-type": "application/json" },
        }),
      );
    },
  });
  const view = createSearchResultsView({
    $: (sel) => document.querySelector(sel),
    trackLoad: (promise) => promise,
    getLanguage: () => "en",
    appendScopeParams: () => undefined,
    getRef: () => "worktree",
    getServerGeneration: () => 1,
    isAbortError: () => false,
    getGrepRegex: () => regex,
    getGrepCaseSensitive: () => false,
    getGrepWholeWord: () => false,
    getGrepHideTests: () => false,
    persistGrepSettings: async (patch) => {
      patches.push(patch);
      if (patch.grepRegex !== undefined) regex = patch.grepRegex;
    },
    openMatch: (match) => {
      opened.push(match);
    },
    onQueryChange: (query) => {
      queries.push(query);
    },
  });
  return { view, urls, opened, patches, queries };
}

describe("search results sheet", () => {
  test("opening with a query runs it, groups hits by file and reports the count", async () => {
    const { view, urls, queries } = setup();
    view.open("needle path:src/");
    const sheet = q<HTMLElement>(document, "#search-sheet");
    expect(sheet.hidden).toBe(false);
    expect(sheet.getAttribute("aria-hidden")).toBe("false");
    await waitFor(
      () => document.querySelectorAll(".gdp-palette-row").length === 3,
    );
    const request = new URL(urls[0], "http://localhost");
    expect(request.searchParams.get("q")).toBe("needle");
    expect(request.searchParams.getAll("path")).toEqual(["src/"]);
    expect(
      Array.from(
        document.querySelectorAll(".gdp-palette-file-heading-name"),
      ).map((el) => el.textContent),
    ).toEqual(["src/a.ts", "lib/b.ts"]);
    expect(q(document, ".search-results-status").textContent).toContain(
      "3 results",
    );
    expect(queries).toEqual(["needle path:src/"]);
    expect(q<HTMLInputElement>(document, ".search-results-input").value).toBe(
      "needle path:src/",
    );
  });

  test("clicking a hit opens the file at that line with the hit text to mark", async () => {
    const { view, opened } = setup();
    view.open("needle");
    await waitFor(
      () => document.querySelectorAll(".gdp-palette-row").length === 3,
    );
    const rows =
      document.querySelectorAll<HTMLButtonElement>(".gdp-palette-row");
    rows[0].click();
    rows[1].click();
    expect(opened).toEqual([
      { path: "src/a.ts", line: 3, hl: "needle" },
      { path: "src/a.ts", line: 9, hl: "needle" },
    ]);
  });

  test("a regex hit without engine match text is opened without hl", async () => {
    const { view, opened } = setup({
      regex: true,
      matches: [{ path: "src/a.ts", line: 3, column: 2, preview: "x" }],
    });
    view.open("nee.le");
    await waitFor(
      () => document.querySelectorAll(".gdp-palette-row").length === 1,
    );
    q<HTMLButtonElement>(document, ".gdp-palette-row").click();
    expect(opened).toEqual([{ path: "src/a.ts", line: 3 }]);
  });

  test("Enter in the query box re-runs the search and the URL hook sees it", async () => {
    const { view, urls, queries } = setup();
    view.open();
    expect(q(document, ".search-results-status").textContent).toBe(
      "Type a search and press Enter",
    );
    const input = q<HTMLInputElement>(document, ".search-results-input");
    input.value = "other";
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    await waitFor(() => urls.length === 1);
    expect(new URL(urls[0], "http://localhost").searchParams.get("q")).toBe(
      "other",
    );
    expect(queries).toEqual(["other"]);
  });

  test("toggling an option persists it and re-runs the search with the new flag", async () => {
    const { view, urls, patches } = setup();
    view.open("needle");
    await waitFor(() => urls.length === 1);
    const regexButton = Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        ".search-results-controls .gdp-palette-mode-button",
      ),
    ).find((b) => b.textContent === ".* Regex");
    if (!regexButton) throw new Error("regex toggle missing");
    regexButton.click();
    await waitFor(() => urls.length === 2);
    expect(patches).toEqual([{ grepRegex: true }]);
    expect(new URL(urls[1], "http://localhost").searchParams.get("regex")).toBe(
      "1",
    );
  });

  test("close hides the sheet and open again restores the last results without refetching", async () => {
    const { view, urls } = setup();
    view.open("needle");
    await waitFor(
      () => document.querySelectorAll(".gdp-palette-row").length === 3,
    );
    view.close();
    const sheet = q<HTMLElement>(document, "#search-sheet");
    expect(sheet.hidden).toBe(true);
    expect(view.isOpen()).toBe(false);
    view.open();
    expect(view.isOpen()).toBe(true);
    expect(document.querySelectorAll(".gdp-palette-row").length).toBe(3);
    expect(urls.length).toBe(1);
  });
});
