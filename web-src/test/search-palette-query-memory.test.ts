import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import type { FileRangeResponse, FileSearchListResponse } from "../core/types";
import type { PaletteCommand } from "../views/search-palette-ui";
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

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
  });
}

async function setup(options: {
  files: string[];
  truncated?: boolean;
  fileSelectionHistory?: string[];
  commands?: PaletteCommand[];
}) {
  const fileRequests: string[] = [];
  const persisted: unknown[] = [];
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
          end: 1,
          lines: ["export const sample = true;"],
          total: 1,
          complete: true,
          generation: 1,
        };
        return Promise.resolve(jsonResponse(body));
      }
      if (url.startsWith("/_grep?")) {
        return Promise.resolve(
          jsonResponse({
            ref: "worktree",
            engine: "rg",
            truncated: false,
            matches: [],
            generation: 1,
          }),
        );
      }
      if (!url.startsWith("/_files?"))
        throw new Error(`unexpected request: ${url}`);
      fileRequests.push(url);
      const body: FileSearchListResponse = {
        ref: "worktree",
        generation: 1,
        files: options.files.map((path) => ({ path, type: "blob" })),
        truncated: options.truncated === true,
      };
      return Promise.resolve(jsonResponse(body));
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
    openingNewTab: (run) => run(),
    currentRange: () => ({ from: "HEAD", to: "worktree" }),
    appendScopeParams: () => undefined,
    isAbortError: () => false,
    scrollToFile: () => undefined,
    openDiffFile: () => undefined,
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
    getFileSelectionHistory: () => options.fileSelectionHistory ?? [],
    getGrepSelectionHistory: () => [],
    getGrepRegex: () => false,
    getGrepCaseSensitive: () => false,
    getGrepWholeWord: () => false,
    getGrepHideTests: () => false,
    getGrepGroupByFile: () => false,
    getGrepPaletteWidth: () => undefined,
    getGrepPaletteHeight: () => undefined,
    persistGrepSettings: async (patch) => {
      persisted.push(patch);
    },
    applyGrepHideTests: () => undefined,
    ...(options.commands
      ? { getPaletteCommands: () => options.commands ?? [] }
      : {}),
  });
  return { palette, fileRequests, persisted };
}

function input(): HTMLInputElement {
  return q<HTMLInputElement>(document, ".gdp-palette-input");
}

function typeQuery(value: string) {
  const el = input();
  el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function status(): string {
  return q(document, ".gdp-palette-status").textContent || "";
}

function activeModeSwitch(): string {
  return (
    q(document, '.gdp-palette-mode-switch[aria-pressed="true"]').textContent ||
    ""
  );
}

// ai-dup-check: allow -- ok:別画面の要素を別セレクタで読む 2 行のテスト用ヘルパ。
// 共有化するほどの中身が無い。
function rowPaths(): string[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>(".gdp-palette-row-detail"),
  ).map((el) => el.textContent || "");
}

describe("search palette query memory", () => {
  test("reopening a palette restores the last query of that mode, selected", async () => {
    const { palette } = await setup({ files: ["src/sample.ts"] });
    try {
      palette.openSearchPalette("file");
      typeQuery("samp");
      await waitFor(() => status() === "1 results");
      palette.closeSearchPalette();

      palette.openSearchPalette("file");
      expect(input().value).toBe("samp");
      expect(input().selectionStart).toBe(0);
      expect(input().selectionEnd).toBe(4);
      await waitFor(() => status() === "1 results");
    } finally {
      palette.closeSearchPalette();
    }
  });

  test("each mode remembers its own last query", async () => {
    const { palette } = await setup({ files: ["src/sample.ts"] });
    try {
      palette.openSearchPalette("file");
      typeQuery("files-query");
      palette.closeSearchPalette();
      palette.openSearchPalette("grep");
      typeQuery("grep-query");
      palette.closeSearchPalette();

      palette.openSearchPalette("file");
      expect(input().value).toBe("files-query");
      // Close before opening the other mode: switching while open would
      // carry the live query over instead of restoring the remembered one.
      palette.closeSearchPalette();
      palette.openSearchPalette("grep");
      expect(input().value).toBe("grep-query");
    } finally {
      palette.closeSearchPalette();
    }
  });

  test.each([
    { name: "file -> grep", from: "file" as const, to: "grep" as const },
    { name: "grep -> file", from: "grep" as const, to: "file" as const },
  ])("switching mode while open carries the live query over ($name)", async ({
    from,
    to,
  }) => {
    const { palette } = await setup({ files: ["src/sample.ts"] });
    try {
      palette.openSearchPalette(from);
      typeQuery("carried");
      palette.openSearchPalette(to);
      expect(palette.paletteMode()).toBe(to);
      expect(input().value).toBe("carried");
      expect(input().selectionEnd).toBe("carried".length);
    } finally {
      palette.closeSearchPalette();
    }
  });

  test("the label row offers mode-switch buttons that change the palette mode", async () => {
    const { palette } = await setup({ files: ["src/sample.ts"] });
    try {
      palette.openSearchPalette("file");
      expect(activeModeSwitch()).toBe("Files");
      typeQuery("sample");
      const grepSwitch = Array.from(
        document.querySelectorAll<HTMLButtonElement>(
          ".gdp-palette-mode-switch",
        ),
      ).find((button) => button.textContent === "Grep");
      if (!grepSwitch) throw new Error("grep switch is missing");
      grepSwitch.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      expect(palette.paletteMode()).toBe("grep");
      expect(activeModeSwitch()).toBe("Grep");
      expect(input().value).toBe("sample");
    } finally {
      palette.closeSearchPalette();
    }
  });
});

// 入力欄は placeholder だけでは名前にならない (入力すると消える)。
describe("search palette input name", () => {
  test.each<["file" | "grep", boolean, string]>([
    ["file", false, "Search files"],
    ["grep", false, "Search text"],
    ["file", true, "Search projects, agents, sessions, files, actions…"],
  ])("%s mode (commands: %s) is named %s", async (mode, commands, name) => {
    const { palette } = await setup({
      files: ["src/sample.ts"],
      ...(commands ? { commands: [] } : {}),
    });
    try {
      palette.openSearchPalette(mode);
      expect({
        label: input().getAttribute("aria-label"),
        placeholder: input().placeholder,
      }).toEqual({ label: name, placeholder: name });
    } finally {
      palette.closeSearchPalette();
    }
  });
});

describe("repository palette recent files", () => {
  test("an empty query lists recently opened files, newest first, skipping files that no longer exist", async () => {
    const { palette } = await setup({
      files: ["src/a.ts", "src/b.ts", "src/c.ts"],
      fileSelectionHistory: ["old/gone.ts", "src/a.ts", "src/b.ts"],
    });
    try {
      palette.openSearchPalette("file");
      await waitFor(() => status() === "Recent files - 2");
      expect(rowPaths()).toEqual(["src/b.ts", "src/a.ts"]);
    } finally {
      palette.closeSearchPalette();
    }
  });

  test("an empty query with no history keeps the type-to-search hint and sends no file-list request", async () => {
    const { palette, fileRequests } = await setup({ files: ["src/a.ts"] });
    try {
      palette.openSearchPalette("file");
      expect(status()).toBe("Type to search repository files");
      expect(fileRequests).toEqual([]);
    } finally {
      palette.closeSearchPalette();
    }
  });
});

describe("repository palette result counts", () => {
  test.each([
    {
      name: "fewer matches than the limit",
      fileCount: 3,
      truncated: false,
      expected: "3 results",
    },
    {
      name: "exactly the limit",
      fileCount: 50,
      truncated: false,
      expected: "50 results",
    },
    {
      name: "one more than the limit",
      fileCount: 51,
      truncated: false,
      expected: "50 of 51 results",
    },
    {
      name: "server-side file list cap reached",
      fileCount: 60,
      truncated: true,
      expected: "50 of 60 results · file list truncated",
    },
  ])("$name", async ({ fileCount, truncated, expected }) => {
    const files = Array.from(
      { length: fileCount },
      (_, index) => `src/file-${String(index).padStart(3, "0")}.ts`,
    );
    const { palette } = await setup({ files, truncated });
    try {
      palette.openSearchPalette("file");
      typeQuery("file");
      await waitFor(() => status() === expected);
      expect(status()).toBe(expected);
    } finally {
      palette.closeSearchPalette();
    }
  });
});

describe("palette projects, agents and actions", () => {
  function command(
    group: PaletteCommand["group"],
    title: string,
    detail: string,
    suggested: boolean,
    ran: string[],
  ): PaletteCommand {
    return {
      group,
      id: `${group}:${title}`,
      title,
      detail,
      iconHtml: "",
      suggested,
      run: () => {
        ran.push(title);
      },
    };
  }

  function commands(ran: string[]): PaletteCommand[] {
    return [
      command("projects", "sample-app", "~/work/sample-app", true, ran),
      command("projects", "sample-lib", "~/work/sample-lib", false, ran),
      command("agents", "sample-agent", "Review plan", true, ran),
      command("sessions", "sample-shell", "~/work/sample-app", true, ran),
      command("actions", "New agent", "", true, ran),
      command("actions", "Toggle theme", "", false, ran),
    ];
  }

  /** 見出しは "# 名前"、行は "名前|補助"、選んでいる行に " *"。 */
  function listing(): string[] {
    return Array.from(
      document.querySelectorAll<HTMLElement>(
        ".gdp-palette-list > .gdp-palette-group-heading, .gdp-palette-list > .gdp-palette-row",
      ),
      (el) =>
        el.classList.contains("gdp-palette-group-heading")
          ? `# ${el.textContent}`
          : `${el.querySelector(".gdp-palette-row-title")?.textContent}|${el.querySelector(".gdp-palette-row-detail")?.textContent}${el.getAttribute("aria-selected") === "true" ? " *" : ""}`,
    );
  }

  function key(name: string) {
    input().dispatchEvent(
      new KeyboardEvent("keydown", { key: name, bubbles: true }),
    );
  }

  test("an empty query shows the suggested ones around the recent files, with the first file selected", async () => {
    const ran: string[] = [];
    const { palette } = await setup({
      files: ["src/a.ts"],
      fileSelectionHistory: ["src/a.ts"],
      commands: commands(ran),
    });
    try {
      palette.openSearchPalette("file");
      await waitFor(() => status() === "Recent files - 1");
      expect(listing()).toEqual([
        "# Projects",
        "sample-app|~/work/sample-app",
        "# Agents",
        "sample-agent|Review plan",
        "# Sessions",
        "sample-shell|~/work/sample-app",
        "# Files",
        "a.ts|src/a.ts *",
        "# Actions",
        "New agent|",
      ]);
      expect(input().placeholder).toBe(
        "Search projects, agents, sessions, files, actions…",
      );
    } finally {
      palette.closeSearchPalette();
    }
  });

  test.each([
    {
      name: "a name matches loosely, a file stays selected",
      query: "lib",
      expected: [
        "# Projects",
        "sample-lib|~/work/sample-lib",
        "# Files",
        "lib.ts|src/lib.ts *",
      ],
    },
    {
      name: "the detail matches only as a substring",
      query: "plan",
      expected: ["# Agents", "sample-agent|Review plan *"],
    },
    {
      name: "a shell name has its own session group",
      query: "shell",
      expected: ["# Sessions", "sample-shell|~/work/sample-app *"],
    },
    {
      name: "a long detail does not match a scattered query",
      query: "theme",
      expected: ["# Actions", "Toggle theme| *"],
    },
  ])("$name", async ({ query, expected }) => {
    const ran: string[] = [];
    const { palette } = await setup({
      files: ["src/lib.ts"],
      commands: commands(ran),
    });
    try {
      palette.openSearchPalette("file");
      typeQuery(query);
      await waitFor(() => listing().join("\n") === expected.join("\n"));
      expect(listing()).toEqual(expected);
    } finally {
      palette.closeSearchPalette();
    }
  });

  test("arrow keys cross the groups and Enter runs the command without saving file history", async () => {
    const ran: string[] = [];
    const { palette, persisted } = await setup({
      files: ["src/a.ts"],
      fileSelectionHistory: ["src/a.ts"],
      commands: commands(ran),
    });
    try {
      palette.openSearchPalette("file");
      await waitFor(() => status() === "Recent files - 1");
      key("ArrowUp");
      expect(listing()).toContain("sample-shell|~/work/sample-app *");
      key("Enter");
      await waitFor(() => ran.length === 1);
      expect(ran).toEqual(["sample-shell"]);
      expect(palette.isPaletteOpen()).toBe(false);
      expect(persisted).toEqual([]);
    } finally {
      palette.closeSearchPalette();
    }
  });

  test("text search (grep) does not mix them in", async () => {
    const ran: string[] = [];
    const { palette } = await setup({
      files: ["src/a.ts"],
      commands: commands(ran),
    });
    try {
      palette.openSearchPalette("grep");
      typeQuery("sample");
      expect(
        document.querySelectorAll(
          ".gdp-palette-group-heading, .gdp-palette-row-command",
        ),
      ).toHaveLength(0);
    } finally {
      palette.closeSearchPalette();
    }
  });
});
