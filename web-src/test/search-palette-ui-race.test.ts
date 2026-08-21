import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import type { ShikiHighlighter } from "../core/shiki-loader";
import type {
  FileRangeResponse,
  FileSearchListResponse,
  GrepResponse,
} from "../core/types";
import { deferred, q, waitFor } from "./_test-helpers";

beforeAll(() => {
  GlobalRegistrator.register();
});

afterAll(() => {
  GlobalRegistrator.unregister();
});

afterEach(() => {
  document.body.innerHTML = "";
});

function response(files: string[]): Response {
  const body: FileSearchListResponse = {
    ref: "worktree",
    generation: 1,
    files: files.map((path) => ({ path, type: "blob" })),
    truncated: false,
  };
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
  });
}

async function setup() {
  const first = deferred<Response>();
  const second = deferred<Response>();
  const requests = [first, second];
  let requestIndex = 0;
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    writable: true,
    value: (input: string | URL | Request) => {
      const url = String(input);
      if (url.startsWith("/file_range?")) {
        const body: FileRangeResponse = {
          path: "src/sample.ts",
          ref: "worktree",
          start: 1,
          end: 2,
          lines: ["export const sample = true;", ""],
          total: 2,
          complete: true,
          generation: 1,
        };
        return Promise.resolve(
          new Response(JSON.stringify(body), {
            headers: { "content-type": "application/json" },
          }),
        );
      }
      if (!url.startsWith("/_files?"))
        throw new Error(`unexpected request: ${url}`);
      const request = requests[requestIndex++];
      if (!request) throw new Error("unexpected file-list request");
      return request.promise;
    },
  });
  const { createSearchPalette } = await import("../views/search-palette-ui");
  const palette = createSearchPalette({
    STATE: {
      route: {
        screen: "repo",
        ref: "worktree",
        path: "",
        range: { from: "HEAD", to: "worktree" },
      },
      files: [],
      repoRef: "worktree",
      to: "worktree",
    },
    setRoute: () => undefined,
    currentRange: () => ({ from: "HEAD", to: "worktree" }),
    appendScopeParams: () => undefined,
    isAbortError: () => false,
    scrollToFile: () => undefined,
    applySourceRouteToShell: () => undefined,
    fileSourceTarget: (file) => ({ path: file.path, ref: "worktree" }),
    renderStandaloneSource: async () => undefined,
    repoFileCacheKey: (ref) => ref,
    trackLoad: (promise) => promise,
    getServerGeneration: () => 1,
    getSyntaxHighlight: () => false,
    inferLang: () => null,
    loadSourceShikiHighlighter: async () => null,
    sourceShikiLines: () => null,
    getLanguage: () => "en",
    getFileSelectionHistory: () => [],
    getGrepSelectionHistory: () => [],
    getGrepRegex: () => false,
    getGrepHideTests: () => false,
    getGrepGroupByFile: () => false,
    getGrepPaletteWidth: () => undefined,
    getGrepPaletteHeight: () => undefined,
    persistGrepSettings: async () => undefined,
    applyGrepHideTests: () => undefined,
  });
  palette.openSearchPalette("file");
  const input = q<HTMLInputElement>(document, ".gdp-palette-input");
  input.value = "sample";
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await waitFor(() => requestIndex === 2);
  return { input, palette, first, second, requestCount: () => requestIndex };
}

describe("repository search palette request ordering", () => {
  test("switches the file-search hint when a glob query is entered", async () => {
    const { input, palette } = await setup();
    try {
      expect(q(document, ".gdp-palette-mode-hint").textContent).toBe(
        "Fuzzy path search",
      );

      input.value = "sample*";
      input.dispatchEvent(new Event("input", { bubbles: true }));

      expect(q(document, ".gdp-palette-mode-hint").textContent).toBe(
        "Glob: * ? []",
      );
    } finally {
      palette.closeSearchPalette();
    }
  });

  test("an older same-query response cannot replace the newer result or cache", async () => {
    const { input, palette, first, second, requestCount } = await setup();
    try {
      second.resolve(response(["sample_fresh.ts"]));
      await waitFor(
        () => q(document, ".gdp-palette-status").textContent === "1 results",
      );
      first.resolve(response(["sample_stale.ts"]));
      await first.promise;

      expect(q(document, ".gdp-palette-row-title").textContent).toBe(
        "sample_fresh.ts",
      );
      input.value = "fresh";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      await waitFor(
        () => q(document, ".gdp-palette-status").textContent === "1 results",
      );
      expect(requestCount()).toBe(2);
      expect(q(document, ".gdp-palette-row-title").textContent).toBe(
        "sample_fresh.ts",
      );
    } finally {
      palette.closeSearchPalette();
    }
  });

  test("an older same-query failure cannot replace a successful status", async () => {
    const { palette, first, second } = await setup();
    try {
      second.resolve(response(["sample_fresh.ts"]));
      await waitFor(
        () => q(document, ".gdp-palette-status").textContent === "1 results",
      );
      first.reject(new Error("stale request failed"));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(q(document, ".gdp-palette-status").textContent).toBe("1 results");
      expect(q(document, ".gdp-palette-row-title").textContent).toBe(
        "sample_fresh.ts",
      );
    } finally {
      palette.closeSearchPalette();
    }
  });
});

async function setupFilePalette(
  options: {
    history?: string[];
    hideTests?: boolean;
    paletteWidth?: number;
    paletteHeight?: number;
  } = {},
) {
  const urls: string[] = [];
  const patches: Array<{
    fileSelectionHistory?: string[];
    grepRegex?: boolean;
    hideTests?: boolean;
    grepPaletteWidth?: number;
    grepPaletteHeight?: number;
  }> = [];
  const routes: unknown[] = [];
  const rendered: Array<{ path: string; ref: string }> = [];
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    writable: true,
    value: (input: string | URL | Request) => {
      const url = String(input);
      urls.push(url);
      if (url.startsWith("/_files?")) {
        const body: FileSearchListResponse = {
          ref: "worktree",
          generation: 1,
          files: [
            { path: "src/plain.ts", type: "blob" },
            { path: "src/recent.ts", type: "blob" },
            { path: "src/sample.test.ts", type: "blob" },
          ],
          truncated: false,
        };
        return Promise.resolve(
          new Response(JSON.stringify(body), {
            headers: { "content-type": "application/json" },
          }),
        );
      }
      if (url.startsWith("/file_range?")) {
        const body: FileRangeResponse = {
          path: "src/sample.ts",
          ref: "worktree",
          start: 1,
          end: 3,
          lines: ["export function sample() {", "  return true;", "}"],
          total: 3,
          complete: true,
          generation: 1,
        };
        return Promise.resolve(
          new Response(JSON.stringify(body), {
            headers: { "content-type": "application/json" },
          }),
        );
      }
      throw new Error(`unexpected request: ${url}`);
    },
  });
  const { createSearchPalette } = await import("../views/search-palette-ui");
  const palette = createSearchPalette({
    STATE: {
      route: {
        screen: "repo",
        ref: "worktree",
        path: "",
        range: { from: "HEAD", to: "worktree" },
      },
      files: [],
      repoRef: "worktree",
      to: "worktree",
    },
    setRoute: (route) => routes.push(route),
    currentRange: () => ({ from: "HEAD", to: "worktree" }),
    appendScopeParams: () => undefined,
    isAbortError: (err) =>
      err instanceof DOMException && err.name === "AbortError",
    scrollToFile: () => undefined,
    applySourceRouteToShell: () => undefined,
    fileSourceTarget: (file) => ({ path: file.path, ref: "worktree" }),
    renderStandaloneSource: async (target) => {
      rendered.push(target);
    },
    repoFileCacheKey: (ref) => ref,
    trackLoad: (promise) => promise,
    getServerGeneration: () => 1,
    getSyntaxHighlight: () => true,
    inferLang: (path) => (path.endsWith(".ts") ? "typescript" : null),
    loadSourceShikiHighlighter: async () => ({ codeToHtml: () => "" }),
    sourceShikiLines: (textValue) =>
      textValue
        .split("\n")
        .map((line) => `<span class="tok">${line || " "}</span>`),
    getLanguage: () => "en",
    getFileSelectionHistory: () => options.history || [],
    getGrepSelectionHistory: () => [],
    getGrepRegex: () => false,
    getGrepHideTests: () => options.hideTests === true,
    getGrepGroupByFile: () => false,
    getGrepPaletteWidth: () => options.paletteWidth,
    getGrepPaletteHeight: () => options.paletteHeight,
    persistGrepSettings: async (patch) => {
      patches.push(patch);
    },
    applyGrepHideTests: () => undefined,
  });
  palette.clearRepoFileCache();
  palette.openSearchPalette("file");
  const input = q<HTMLInputElement>(document, ".gdp-palette-input");
  input.value = "src";
  input.dispatchEvent(new Event("input", { bubbles: true }));
  const expectedCount = options.hideTests ? 2 : 3;
  await waitFor(
    () =>
      q(document, ".gdp-palette-status").textContent ===
      `${expectedCount} results`,
  );
  await waitFor(
    () => document.querySelectorAll(".gdp-source-line-code.shiki").length === 3,
  );
  return { input, palette, patches, rendered, routes, urls };
}

describe("file search palette master/detail behavior", () => {
  test("uses the saved wide layout and previews the recent file with syntax colors", async () => {
    const { palette } = await setupFilePalette({
      history: ["src/recent.ts"],
      paletteWidth: 900,
      paletteHeight: 640,
    });
    try {
      const dialog = q<HTMLElement>(document, ".gdp-palette-wide");
      expect(dialog.style.width).toBe("900px");
      expect(dialog.style.height).toBe("640px");
      expect(document.querySelectorAll(".gdp-palette-body > *")).toHaveLength(
        2,
      );
      expect(q(document, ".gdp-palette-row-title").textContent).toBe(
        "recent.ts",
      );
      expect(q(document, ".gdp-palette-preview-location").textContent).toBe(
        "src/recent.ts",
      );
      expect(q(document, ".gdp-source-line-code.shiki .tok").textContent).toBe(
        "export function sample() {",
      );
      expect(document.querySelectorAll(".gdp-palette-resizer")).toHaveLength(2);
    } finally {
      palette.closeSearchPalette();
    }
  });

  test("saves file history and opens a result with one click", async () => {
    const { palette, patches, rendered, routes } = await setupFilePalette();
    try {
      q<HTMLElement>(document, ".gdp-palette-row").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await waitFor(() => routes.length === 1);
      expect(patches).toEqual([{ fileSelectionHistory: ["src/plain.ts"] }]);
      expect(routes[0]).toMatchObject({
        screen: "file",
        path: "src/plain.ts",
        view: "blob",
      });
      expect(rendered).toEqual([{ path: "src/plain.ts", ref: "worktree" }]);
    } finally {
      palette.closeSearchPalette();
    }
  });

  test("excludes test files and saves the shared test setting", async () => {
    const { palette, patches } = await setupFilePalette();
    try {
      const button = Array.from(
        document.querySelectorAll<HTMLButtonElement>(
          ".gdp-palette-mode-button",
        ),
      ).find((candidate) => candidate.textContent === "No test");
      if (!button) throw new Error("missing test exclusion button");
      button.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      await waitFor(() => patches.length === 1);
      await waitFor(
        () => q(document, ".gdp-palette-status").textContent === "2 results",
      );
      expect(patches).toEqual([{ hideTests: true }]);
      expect(
        Array.from(
          document.querySelectorAll<HTMLElement>(".gdp-palette-row-detail"),
        ).map((row) => row.textContent),
      ).not.toContain("src/sample.test.ts");
    } finally {
      palette.closeSearchPalette();
    }
  });
});

async function setupGrep(
  options: {
    history?: string[];
    hideTests?: boolean;
    serverGeneration?: number;
    grepGeneration?: number;
    rangeRequest?: (url: string) => Promise<Response>;
    highlightRequest?: () => Promise<ShikiHighlighter | null>;
    waitForPreview?: boolean;
    matches?: GrepResponse["matches"];
    groupByFile?: boolean;
    regex?: boolean;
    paletteWidth?: number;
    paletteHeight?: number;
    language?: "en" | "ja";
  } = {},
) {
  const urls: string[] = [];
  const patches: Array<{
    fileSelectionHistory?: string[];
    grepSelectionHistory?: string[];
    grepRegex?: boolean;
    hideTests?: boolean;
    grepGroupByFile?: boolean;
    grepPaletteWidth?: number;
    grepPaletteHeight?: number;
  }> = [];
  const routes: unknown[] = [];
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    writable: true,
    value: (input: string | URL | Request) => {
      const url = String(input);
      urls.push(url);
      if (url.startsWith("/_grep?")) {
        const body: GrepResponse = {
          ref: "worktree",
          engine: "rg",
          truncated: false,
          generation: options.grepGeneration ?? 1,
          matches: options.matches ?? [
            {
              path: "src/plain.ts",
              line: 2,
              column: 1,
              preview: "needle in plain file",
            },
            {
              path: "src/recent.ts",
              line: 4,
              column: 7,
              preview: "const needle = true;",
            },
          ],
        };
        return Promise.resolve(
          new Response(JSON.stringify(body), {
            headers: { "content-type": "application/json" },
          }),
        );
      }
      if (url.startsWith("/file_range?")) {
        if (options.rangeRequest) return options.rangeRequest(url);
        const body: FileRangeResponse = {
          path: "src/recent.ts",
          ref: "worktree",
          start: 1,
          end: 5,
          lines: [
            "export function sample() {",
            "  const before = true;",
            "  if (before) {",
            "    const needle = true;",
            "  }",
          ],
          total: 5,
          complete: true,
          generation: 1,
        };
        return Promise.resolve(
          new Response(JSON.stringify(body), {
            headers: { "content-type": "application/json" },
          }),
        );
      }
      throw new Error(`unexpected request: ${url}`);
    },
  });
  const { createSearchPalette } = await import("../views/search-palette-ui");
  const palette = createSearchPalette({
    STATE: {
      route: {
        screen: "repo",
        ref: "worktree",
        path: "",
        range: { from: "HEAD", to: "worktree" },
      },
      files: [],
      repoRef: "worktree",
      to: "worktree",
    },
    setRoute: (route) => routes.push(route),
    currentRange: () => ({ from: "HEAD", to: "worktree" }),
    appendScopeParams: () => undefined,
    isAbortError: (err) =>
      err instanceof DOMException && err.name === "AbortError",
    scrollToFile: () => undefined,
    applySourceRouteToShell: () => undefined,
    fileSourceTarget: (file) => ({ path: file.path, ref: "worktree" }),
    renderStandaloneSource: async () => undefined,
    repoFileCacheKey: (ref) => ref,
    trackLoad: (promise) => promise,
    getServerGeneration: () => options.serverGeneration ?? 1,
    getSyntaxHighlight: () => true,
    inferLang: (path) => (path.endsWith(".ts") ? "typescript" : null),
    loadSourceShikiHighlighter:
      options.highlightRequest ||
      (async () => ({
        codeToHtml: () => "",
      })),
    sourceShikiLines: (textValue) =>
      textValue
        .split("\n")
        .map((line) => `<span class="tok">${line || " "}</span>`),
    getLanguage: () => options.language ?? "en",
    getFileSelectionHistory: () => [],
    getGrepSelectionHistory: () => options.history || [],
    getGrepRegex: () => options.regex === true,
    getGrepHideTests: () => options.hideTests === true,
    getGrepGroupByFile: () => options.groupByFile === true,
    getGrepPaletteWidth: () => options.paletteWidth,
    getGrepPaletteHeight: () => options.paletteHeight,
    persistGrepSettings: async (patch) => {
      patches.push(patch);
    },
    applyGrepHideTests: () => undefined,
  });
  palette.openSearchPalette("grep");
  const input = q<HTMLInputElement>(document, ".gdp-palette-input");
  input.value = "needle";
  input.dispatchEvent(new Event("input", { bubbles: true }));
  const expectedResultCount = options.matches?.length ?? 2;
  const expectedResultText =
    options.language === "ja"
      ? `${expectedResultCount} 件`
      : `${expectedResultCount} results`;
  await waitFor(
    () =>
      q(document, ".gdp-palette-status").textContent?.includes(
        expectedResultText,
      ) === true,
  );
  if (options.waitForPreview !== false) {
    await waitFor(
      () => document.querySelectorAll(".gdp-source-table tr").length === 5,
    );
    await waitFor(
      () => !!document.querySelector(".gdp-source-line-code.shiki"),
    );
  }
  return { input, palette, patches, routes, urls };
}

describe("grep search palette master/detail behavior", () => {
  test("uses Japanese grep labels when the viewer language is Japanese", async () => {
    const { input, palette } = await setupGrep({ language: "ja" });
    try {
      expect(input.placeholder).toBe("コードを検索");
      expect(
        Array.from(
          document.querySelectorAll<HTMLElement>(
            ".gdp-palette-controls .gdp-palette-mode-button",
          ),
        ).map((button) => button.textContent),
      ).toEqual(["通常", ".* 正規表現", "テスト除外", "ファイル別"]);
      expect(
        Array.from(
          document.querySelectorAll<HTMLElement>(
            ".gdp-palette-label .gdp-palette-mode-switch",
          ),
        ).map((button) => button.textContent),
      ).toEqual(["ファイル", "GREP"]);
      expect(q(document, ".gdp-palette-status").textContent).toContain("2 件");
    } finally {
      palette.closeSearchPalette();
    }
  });

  test("searches before the client has learned the server generation", async () => {
    const { palette } = await setupGrep({ serverGeneration: 0 });
    try {
      expect(q(document, ".gdp-palette-status").textContent).toContain(
        "2 results",
      );
    } finally {
      palette.closeSearchPalette();
    }
  });

  test("widens into result and code panes and ranks recent selections first", async () => {
    const { palette, urls } = await setupGrep({
      history: ["src/recent.ts"],
      hideTests: true,
    });
    try {
      expect(
        q(document, ".gdp-palette").classList.contains("gdp-palette-grep"),
      ).toBe(true);
      expect(document.querySelectorAll(".gdp-palette-body > *")).toHaveLength(
        2,
      );
      expect(q(document, ".gdp-palette-row-title").textContent).toBe(
        "src/recent.ts:4",
      );
      expect(
        q(document, ".gdp-source-line-target .gdp-source-line-code")
          .textContent,
      ).toBe("    const needle = true;");
      expect(
        q(document, ".gdp-source-line-target .gdp-source-line-code.shiki .tok")
          .textContent,
      ).toBe("    const needle = true;");
      expect(urls.find((url) => url.startsWith("/_grep?"))).toContain(
        "exclude_tests=1",
      );
    } finally {
      palette.closeSearchPalette();
    }
  });

  test("persists the opened grep result before navigating", async () => {
    const { input, palette, patches, routes } = await setupGrep();
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    await waitFor(() => routes.length === 1);
    expect(patches).toEqual([{ grepSelectionHistory: ["src/plain.ts"] }]);
    expect(document.querySelector(".gdp-palette")).toBeNull();
    expect(routes[0]).toMatchObject({
      screen: "file",
      path: "src/plain.ts",
      line: 2,
    });
    palette.closeSearchPalette();
  });

  test("opens a grep result with one click", async () => {
    const { palette, patches, routes } = await setupGrep();
    try {
      q<HTMLElement>(document, ".gdp-palette-row").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await waitFor(() => routes.length === 1);
      expect(patches).toEqual([{ grepSelectionHistory: ["src/plain.ts"] }]);
      expect(routes[0]).toMatchObject({
        screen: "file",
        path: "src/plain.ts",
        line: 2,
      });
    } finally {
      palette.closeSearchPalette();
    }
  });

  test("highlights the grep match inside the syntax-highlighted preview", async () => {
    const { palette } = await setupGrep({
      matches: [
        {
          path: "src/sample.ts",
          line: 4,
          column: 11,
          preview: "    const needle = true;",
          matchText: "needle",
        },
      ],
    });
    try {
      const target = q<HTMLElement>(
        document,
        ".gdp-source-line-target .gdp-source-line-code.shiki",
      );
      expect(q(target, ".gdp-grep-match").textContent).toBe("needle");
      expect(q(target, ".tok").textContent).toBe("    const needle = true;");
    } finally {
      palette.closeSearchPalette();
    }
  });

  test("groups matches under their file headings", async () => {
    const { input, palette } = await setupGrep({
      groupByFile: true,
      matches: [
        {
          path: "src/sample.ts",
          line: 2,
          column: 1,
          preview: "first match",
        },
        {
          path: "src/sample.ts",
          line: 8,
          column: 3,
          preview: "second match",
        },
        {
          path: "src/other.ts",
          line: 5,
          column: 2,
          preview: "other match",
        },
      ],
    });
    try {
      const groups = document.querySelectorAll(".gdp-palette-file-group");
      expect(groups).toHaveLength(2);
      expect(
        groups[0]?.querySelector(".gdp-palette-file-heading")?.textContent,
      ).toContain("src/sample.ts");
      expect(groups[0]?.querySelectorAll(".gdp-palette-row")).toHaveLength(2);
      expect(groups[1]?.querySelectorAll(".gdp-palette-row")).toHaveLength(1);

      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );
      expect(
        q(document, '.gdp-palette-row[aria-selected="true"]').querySelector(
          ".gdp-palette-row-title",
        )?.textContent,
      ).toBe("Line 8:3");
    } finally {
      palette.closeSearchPalette();
    }
  });

  test("keeps the file heading visible when moving up to the first grouped match", async () => {
    const { input, palette } = await setupGrep({
      groupByFile: true,
      matches: [
        {
          path: "src/sample.ts",
          line: 2,
          column: 1,
          preview: "first match",
        },
        {
          path: "src/sample.ts",
          line: 8,
          column: 3,
          preview: "second match",
        },
      ],
    });
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
    const scrolledElements: HTMLElement[] = [];
    HTMLElement.prototype.scrollIntoView = function () {
      scrolledElements.push(this);
    };
    try {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );
      scrolledElements.length = 0;

      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
      );

      const group = q<HTMLElement>(document, ".gdp-palette-file-group");
      const heading = q<HTMLElement>(group, ".gdp-palette-file-heading");
      const selected = q<HTMLElement>(
        group,
        '.gdp-palette-row[aria-selected="true"]',
      );
      expect(scrolledElements).toEqual([heading, selected]);
    } finally {
      HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
      palette.closeSearchPalette();
    }
  });

  test("stationary pointer events do not repeat a keyboard selection", async () => {
    const { input, palette } = await setupGrep({
      groupByFile: true,
      matches: [
        {
          path: "src/sample.ts",
          line: 2,
          column: 1,
          preview: "first match",
        },
        {
          path: "src/sample.ts",
          line: 4,
          column: 1,
          preview: "second match",
        },
        {
          path: "src/sample.ts",
          line: 8,
          column: 1,
          preview: "third match",
        },
        {
          path: "src/sample.ts",
          line: 14,
          column: 1,
          preview: "fourth match",
        },
      ],
    });
    try {
      const rows = document.querySelectorAll<HTMLElement>(".gdp-palette-row");
      rows[1]?.dispatchEvent(
        new MouseEvent("mouseenter", {
          clientX: 120,
          clientY: 240,
          bubbles: true,
        }),
      );
      rows[1]?.dispatchEvent(
        new MouseEvent("mousemove", {
          clientX: 120,
          clientY: 240,
          bubbles: true,
        }),
      );
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );

      rows[1]?.dispatchEvent(
        new MouseEvent("mouseenter", {
          clientX: 120,
          clientY: 240,
          bubbles: true,
        }),
      );
      rows[1]?.dispatchEvent(
        new MouseEvent("mousemove", {
          clientX: 120,
          clientY: 240,
          bubbles: true,
        }),
      );
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );

      expect(
        q(document, '.gdp-palette-row[aria-selected="true"]').querySelector(
          ".gdp-palette-row-title",
        )?.textContent,
      ).toBe("Line 14:1");

      rows[1]?.dispatchEvent(
        new MouseEvent("mousemove", {
          clientX: 124,
          clientY: 244,
          bubbles: true,
        }),
      );
      expect(
        q(document, '.gdp-palette-row[aria-selected="true"]').querySelector(
          ".gdp-palette-row-title",
        )?.textContent,
      ).toBe("Line 4:1");
    } finally {
      palette.closeSearchPalette();
    }
  });

  test("toggles file grouping and saves the choice", async () => {
    const { palette, patches } = await setupGrep({
      matches: [
        {
          path: "src/sample.ts",
          line: 2,
          column: 1,
          preview: "first match",
        },
        {
          path: "src/sample.ts",
          line: 8,
          column: 3,
          preview: "second match",
        },
      ],
    });
    try {
      const button = Array.from(
        document.querySelectorAll<HTMLButtonElement>(
          ".gdp-palette-mode-button",
        ),
      ).find((candidate) => candidate.textContent === "Group files");
      if (!button) throw new Error("missing grouping toggle");
      button.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      await waitFor(() => patches.length === 1);
      expect(patches).toEqual([{ grepGroupByFile: true }]);
      expect(document.querySelectorAll(".gdp-palette-file-group")).toHaveLength(
        1,
      );
    } finally {
      palette.closeSearchPalette();
    }
  });

  test("restores and saves grep palette dimensions", async () => {
    const { palette, patches } = await setupGrep({
      paletteWidth: 900,
      paletteHeight: 640,
    });
    try {
      const dialog = q<HTMLElement>(document, ".gdp-palette-grep");
      expect(dialog.style.width).toBe("900px");
      expect(dialog.style.height).toBe("640px");
      dialog.getBoundingClientRect = () =>
        ({
          width: Number.parseFloat(dialog.style.width),
          height: Number.parseFloat(dialog.style.height),
          top: 0,
          left: 0,
          right: Number.parseFloat(dialog.style.width),
          bottom: Number.parseFloat(dialog.style.height),
          x: 0,
          y: 0,
          toJSON: () => ({}),
        }) as DOMRect;

      q<HTMLElement>(document, ".gdp-palette-resizer-x").dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
      );
      await waitFor(() => patches.length === 1);
      q<HTMLElement>(document, ".gdp-palette-resizer-y").dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );
      await waitFor(() => patches.length === 2);

      const widthHandle = q<HTMLElement>(document, ".gdp-palette-resizer-x");
      Object.defineProperty(widthHandle, "setPointerCapture", {
        value: () => undefined,
      });
      widthHandle.dispatchEvent(
        new PointerEvent("pointerdown", {
          button: 0,
          pointerId: 1,
          clientX: 100,
          bubbles: true,
        }),
      );
      widthHandle.dispatchEvent(
        new PointerEvent("pointermove", {
          pointerId: 1,
          clientX: 80,
          bubbles: true,
        }),
      );
      widthHandle.dispatchEvent(
        new PointerEvent("pointerup", { pointerId: 1, bubbles: true }),
      );
      await waitFor(() => patches.length === 3);

      expect(dialog.style.width).toBe("896px");
      expect(dialog.style.height).toBe("656px");
      expect(patches).toEqual([
        { grepPaletteWidth: 916 },
        { grepPaletteHeight: 656 },
        { grepPaletteWidth: 896 },
      ]);
    } finally {
      palette.closeSearchPalette();
    }
  });

  test("test exclusion toggle is saved and re-runs grep with the exclusion", async () => {
    const { palette, patches, urls } = await setupGrep();
    try {
      const button = Array.from(
        document.querySelectorAll<HTMLButtonElement>(
          ".gdp-palette-mode-button",
        ),
      ).find((candidate) => candidate.textContent === "No test");
      if (!button) throw new Error("missing test exclusion button");
      button.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      await waitFor(() => patches.length === 1);
      await waitFor(
        () => urls.filter((url) => url.startsWith("/_grep?")).length === 2,
      );
      expect(patches).toEqual([{ hideTests: true }]);
      expect(urls.filter((url) => url.startsWith("/_grep?"))[1]).toContain(
        "exclude_tests=1",
      );
    } finally {
      palette.closeSearchPalette();
    }
  });

  test("Alt+R saves regex mode and re-runs grep as regex", async () => {
    const { input, palette, patches, urls } = await setupGrep();
    try {
      input.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "r",
          altKey: true,
          bubbles: true,
        }),
      );
      await waitFor(
        () => urls.filter((url) => url.startsWith("/_grep?")).length === 2,
      );
      const regexButton = Array.from(
        document.querySelectorAll<HTMLButtonElement>(
          ".gdp-palette-mode-button",
        ),
      ).find((candidate) => candidate.textContent === ".* Regex");
      expect(regexButton?.getAttribute("aria-pressed")).toBe("true");
      expect(patches).toEqual([{ grepRegex: true }]);
      expect(urls.filter((url) => url.startsWith("/_grep?"))[1]).toContain(
        "regex=1",
      );
    } finally {
      palette.closeSearchPalette();
    }
  });

  test("restores regex mode and saves switching back to plain", async () => {
    const { palette, patches, urls } = await setupGrep({ regex: true });
    try {
      expect(urls.find((url) => url.startsWith("/_grep?"))).toContain(
        "regex=1",
      );
      const plainButton = Array.from(
        document.querySelectorAll<HTMLButtonElement>(
          ".gdp-palette-mode-button",
        ),
      ).find((candidate) => candidate.textContent === "Plain");
      if (!plainButton) throw new Error("missing plain mode button");
      plainButton.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      await waitFor(() => patches.length === 1);
      await waitFor(
        () => urls.filter((url) => url.startsWith("/_grep?")).length === 2,
      );
      expect(patches).toEqual([{ grepRegex: false }]);
      expect(urls.filter((url) => url.startsWith("/_grep?"))[1]).not.toContain(
        "regex=1",
      );
    } finally {
      palette.closeSearchPalette();
    }
  });

  test("holding ArrowDown stops at the last grep result", async () => {
    const { input, palette } = await setupGrep();
    try {
      for (let press = 0; press < 4; press += 1) {
        input.dispatchEvent(
          new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
        );
      }
      expect(
        q(document, '.gdp-palette-row[aria-selected="true"]').querySelector(
          ".gdp-palette-row-title",
        )?.textContent,
      ).toBe("src/recent.ts:4");
    } finally {
      palette.closeSearchPalette();
    }
  });

  test("an older code-context response cannot replace the latest selection", async () => {
    const first = deferred<Response>();
    const second = deferred<Response>();
    const pending = [first, second];
    let requestIndex = 0;
    const { input, palette } = await setupGrep({
      waitForPreview: false,
      rangeRequest: () => {
        const request = pending[requestIndex++];
        if (!request) throw new Error("unexpected code-context request");
        return request.promise;
      },
    });
    try {
      await waitFor(() => requestIndex === 1);
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );
      await waitFor(() => requestIndex === 2);
      const latest: FileRangeResponse = {
        path: "src/recent.ts",
        ref: "worktree",
        start: 4,
        end: 4,
        lines: ["latest selected context"],
        total: 10,
        complete: true,
        generation: 1,
      };
      second.resolve(
        new Response(JSON.stringify(latest), {
          headers: { "content-type": "application/json" },
        }),
      );
      await waitFor(
        () =>
          document.querySelector(
            ".gdp-source-line-target .gdp-source-line-code",
          )?.textContent === "latest selected context",
      );
      const stale: FileRangeResponse = {
        path: "src/plain.ts",
        ref: "worktree",
        start: 2,
        end: 2,
        lines: ["stale previous context"],
        total: 10,
        complete: true,
        generation: 1,
      };
      first.resolve(
        new Response(JSON.stringify(stale), {
          headers: { "content-type": "application/json" },
        }),
      );
      await first.promise;
      expect(
        q(document, ".gdp-source-line-target .gdp-source-line-code")
          .textContent,
      ).toBe("latest selected context");
    } finally {
      palette.closeSearchPalette();
    }
  });

  test("an older syntax highlight cannot replace the latest selection", async () => {
    const highlighter = deferred<ShikiHighlighter | null>();
    const { input, palette } = await setupGrep({
      waitForPreview: false,
      highlightRequest: () => highlighter.promise,
      rangeRequest: (url) => {
        const recent = url.includes("src%2Frecent.ts");
        const body: FileRangeResponse = {
          path: recent ? "src/recent.ts" : "src/plain.ts",
          ref: "worktree",
          start: recent ? 4 : 2,
          end: recent ? 4 : 2,
          lines: [
            recent ? "latest selected context" : "stale previous context",
          ],
          total: 10,
          complete: true,
          generation: 1,
        };
        return Promise.resolve(
          new Response(JSON.stringify(body), {
            headers: { "content-type": "application/json" },
          }),
        );
      },
    });
    try {
      await waitFor(
        () =>
          document.querySelector(".gdp-source-line-code")?.textContent ===
          "stale previous context",
      );
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );
      await waitFor(
        () =>
          document.querySelector(".gdp-source-line-code")?.textContent ===
          "latest selected context",
      );
      highlighter.resolve({ codeToHtml: () => "" });
      await waitFor(
        () => !!document.querySelector(".gdp-source-line-code.shiki"),
      );
      expect(
        q(document, ".gdp-source-line-target .gdp-source-line-code.shiki")
          .textContent,
      ).toBe("latest selected context");
    } finally {
      palette.closeSearchPalette();
    }
  });
});
