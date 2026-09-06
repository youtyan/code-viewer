import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import type { AppRoute } from "../core/routes";
import type { ShikiHighlighter } from "../core/shiki-loader";
import type { SourceViewDeps } from "../views/source-view";
import { createSourceView } from "../views/source-view";
import { deferred, waitFor } from "./_test-helpers";

beforeAll(() => {
  GlobalRegistrator.register();
});

afterAll(() => {
  GlobalRegistrator.unregister();
});

afterEach(() => {
  document.body.innerHTML = "";
  document.body.removeAttribute("style");
});

const HISTORY_SOURCE_RANGE = { from: "p1", to: "abc1234" };
const HISTORY_SOURCE_FILES = [
  { path: "src/kept.ts", status: "M", additions: 1, deletions: 0 },
  {
    path: "src/gone.ts",
    old_path: "src/gone.ts",
    status: "D",
    additions: 0,
    deletions: 1,
  },
] as SourceViewDeps["STATE"]["files"];

function historySourceRoute(source?: string): AppRoute {
  return {
    screen: "history",
    ref: "main",
    commit: "abc1234",
    ...(source ? { source } : {}),
    range: HISTORY_SOURCE_RANGE,
  };
}

describe("sourceTargetFromRoute on the history screen", () => {
  test.each([
    [
      "a modified file reads the commit side",
      "src/kept.ts",
      { path: "src/kept.ts", ref: "abc1234" },
    ],
    [
      "a deleted file reads the parent side",
      "src/gone.ts",
      { path: "src/gone.ts", ref: "p1" },
    ],
    ["a file outside the diff resolves to nothing", "src/other.ts", null],
    ["no source keeps the diff cards", undefined, null],
  ])("%s", (_label, source, expected) => {
    const view = createSourceViewForCursorTest(historySourceRoute(source), {
      STATE: {
        route: historySourceRoute(source),
        from: HISTORY_SOURCE_RANGE.from,
        to: HISTORY_SOURCE_RANGE.to,
        files: HISTORY_SOURCE_FILES,
        syntaxHighlight: false,
      },
    });
    expect(view.sourceTargetFromRoute()).toEqual(expected);
  });
});

function createSourceViewForCursorTest(
  route: AppRoute,
  overrides: Partial<SourceViewDeps> = {},
) {
  const state: SourceViewDeps["STATE"] = {
    route,
    from: "HEAD",
    to: "worktree",
    files: [],
    syntaxHighlight: false,
  };
  return createSourceView({
    $: <T extends Element = HTMLElement>(sel: string): T => {
      const el = document.querySelector<T>(sel);
      if (!el) throw new Error(`missing ${sel}`);
      return el;
    },
    $$: <T extends Element = HTMLElement>(sel: string): T[] =>
      Array.from(document.querySelectorAll<T>(sel)),
    STATE: state,
    setRoute(nextRoute) {
      state.route = nextRoute;
    },
    setPageMode() {
      /* noop */
    },
    currentRange: () => ({ from: "HEAD", to: "worktree" }),
    trackLoad: (promise) => promise,
    isAbortError: () => false,
    loadRepo: async () => undefined,
    repoRoute: (ref, path) => ({
      screen: "repo",
      ref,
      path,
      range: { from: "HEAD", to: "worktree" },
    }),
    repoFileTargetFromRoute: () => null,
    renderRepoBlobSidebar: async () => undefined,
    placeSidebarToggle() {
      /* noop */
    },
    createFileBreadcrumb: () => document.createElement("nav"),
    createFileDetailMeta: () => document.createElement("div"),
    createOpenPathButton: () => document.createElement("button"),
    createMoveToTrashButton: () => document.createElement("button"),
    canTrashWorktreeRef: () => false,
    loadRawFileInfo: async () => ({
      type: "text",
      size: 0,
      metadata: {},
    }),
    loadSyntaxHighlighter: async () => null,
    setViewFileButtonState() {
      /* noop */
    },
    scrollMainPanel() {
      /* noop */
    },
    focusMainSurface() {
      /* noop */
    },
    isPaletteOpen: () => false,
    getLanguage: () => "en",
    ...overrides,
  });
}

describe("source view cursor", () => {
  test.each([
    {
      name: "visible source table",
      html: `
        <main id="content">
          <table class="gdp-source-table"><tbody>
            <tr data-line="1"><td>line</td></tr>
          </tbody></table>
        </main>
      `,
      bodyStyle: "--code-line-height: 24px",
      expected: 20,
    },
    {
      name: "hidden source table falls through to preview",
      html: `
        <main id="content">
          <table class="gdp-source-table" hidden><tbody>
            <tr data-line="1"><td>hidden</td></tr>
          </tbody></table>
          <div class="gdp-markdown-preview" style="line-height: 31px">preview</div>
        </main>
      `,
      bodyStyle: "--code-line-height: 24px",
      expected: 31,
    },
    {
      name: "configured code line height when no source surface is mounted",
      html: '<main id="content"></main>',
      bodyStyle: "--code-line-height: 24px",
      expected: 24,
    },
  ])("reads the row height from the $name", ({ html, bodyStyle, expected }) => {
    document.body.innerHTML = html;
    document.body.style.cssText = bodyStyle;
    const route: AppRoute = {
      screen: "file",
      path: "src/example.ts",
      ref: "worktree",
      view: "blob",
      range: { from: "HEAD", to: "worktree" },
    };
    const view = createSourceViewForCursorTest(route);

    expect(view.sourceLineScrollAmount()).toBe(expected);
  });

  test("sizes the virtual source spacer from the configured code line height", async () => {
    document.body.innerHTML = '<div id="diff"></div>';
    document.body.style.setProperty("--code-line-height", "24px");
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      writable: true,
      value: (async (input: RequestInfo | URL) => {
        const url = new URL(String(input), "http://localhost");
        if (url.pathname === "/file_range") {
          return new Response(
            JSON.stringify({
              path: "big.txt",
              ref: "worktree",
              start: 1,
              end: 100,
              lines: ["line one"],
              total: 100,
              complete: true,
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          );
        }
        return new Response("{}", { status: 200 });
      }) as typeof fetch,
    });
    const view = createSourceViewForCursorTest(blobRoute("big.txt"), {
      loadRawFileInfo: async () => ({ size: 2 * 1024 * 1024 }),
    });

    await view.renderStandaloneSource({ path: "big.txt", ref: "worktree" });

    expect(
      document.querySelector<HTMLElement>(".gdp-source-virtual-spacer")?.style
        .height,
    ).toBe("2400px");
  });

  test("updates only rendered source rows when syncing the cursor", () => {
    document.body.innerHTML = `
      <main id="content">
        <table class="gdp-source-table"><tbody>
          <tr data-line="1" class="gdp-source-cursor"><td>old</td></tr>
          <tr data-line="2"><td>next</td></tr>
        </tbody></table>
        <div class="gdp-source-virtual-window">
          <div class="gdp-source-virtual-row" data-line="1"></div>
          <div class="gdp-source-virtual-row" data-line="2"></div>
          <div class="gdp-source-virtual-row gdp-source-cursor" data-line="3"></div>
        </div>
        <div class="gdp-annotation-row gdp-source-cursor" data-line="2"></div>
      </main>
    `;
    const route: AppRoute = {
      screen: "file",
      path: "src/example.ts",
      ref: "worktree",
      view: "blob",
      range: { from: "HEAD", to: "worktree" },
      line: 2,
    };
    const view = createSourceViewForCursorTest(route);
    const target = { path: "src/example.ts", ref: "worktree" };

    view.resetSourceCursorForTarget(target, 3);
    view.syncSourceCursorRows(target);

    expect(
      Array.from(
        document.querySelectorAll<HTMLElement>(
          ".gdp-source-table tr.gdp-source-cursor, .gdp-source-virtual-row.gdp-source-cursor",
        ),
      ).map((row) => row.dataset.line),
    ).toEqual(["2", "2"]);
    expect(
      document
        .querySelector<HTMLElement>(".gdp-annotation-row")
        ?.classList.contains("gdp-source-cursor"),
    ).toBe(true);
  });
});

// --- renderStandaloneSource idempotency (AGENTS.md Request Lifecycle) ---
// setRoute() dispatches a render and click handlers also call
// renderStandaloneSource directly; the mounted-card guard must collapse the
// duplicate invocation into a no-op without breaking refresh or retry.

function blobRoute(path: string): AppRoute {
  return {
    screen: "file",
    path,
    ref: "worktree",
    view: "blob",
    range: { from: "HEAD", to: "worktree" },
  };
}

function installRawFileFetchMock(responses?: { failFirst?: boolean }): {
  calls: () => number;
} {
  let calls = 0;
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    writable: true,
    value: (async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");
      if (url.pathname === "/_file") {
        calls++;
        if (responses?.failFirst && calls === 1) {
          return new Response("boom", { status: 500 });
        }
        return new Response("line one\nline two\n", { status: 200 });
      }
      return new Response("{}", {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch,
  });
  return { calls: () => calls };
}

describe("internal source paths", () => {
  test.each([
    {
      name: "tool-managed state is rendered as source",
      path: ".code-viewer/view-state.json",
      expectedRawFileCalls: 1,
      expectedCode: "line one",
      expectedUnavailable: false,
    },
    {
      name: "git internals remain unavailable",
      path: ".git/config",
      expectedRawFileCalls: 0,
      expectedCode: null,
      expectedUnavailable: true,
    },
  ])("$name", async ({
    path,
    expectedRawFileCalls,
    expectedCode,
    expectedUnavailable,
  }) => {
    document.body.innerHTML = '<div id="diff"></div>';
    const fetchMock = installRawFileFetchMock();
    const view = createSourceViewForCursorTest(blobRoute(path));

    await view.renderStandaloneSource({ path, ref: "worktree" });

    expect(fetchMock.calls()).toBe(expectedRawFileCalls);
    expect(
      document.querySelector<HTMLElement>(".gdp-source-line-code")
        ?.textContent ?? null,
    ).toBe(expectedCode);
    expect(
      document.querySelector(".gdp-source-viewer.unsupported") !== null,
    ).toBe(expectedUnavailable);
    expect(
      document.querySelector<HTMLElement>(".gdp-standalone-source")?.dataset
        .sourceState,
    ).toBe("done");
  });
});

describe("renderStandaloneSource idempotency", () => {
  test("re-invoking with the mounted target is a no-op (single load, single card)", async () => {
    document.body.innerHTML = '<div id="diff"></div>';
    const fetchMock = installRawFileFetchMock();
    const view = createSourceViewForCursorTest(blobRoute("a.txt"));
    const target = { path: "a.txt", ref: "worktree" };

    await view.renderStandaloneSource(target);
    await view.renderStandaloneSource(target);

    expect(fetchMock.calls()).toBe(1);
    expect(document.querySelectorAll(".gdp-standalone-source").length).toBe(1);
    expect(
      document.querySelector<HTMLElement>(".gdp-standalone-source")?.dataset
        .sourceState,
    ).toBe("done");
  });

  test("refresh: true re-renders the mounted target", async () => {
    document.body.innerHTML = '<div id="diff"></div>';
    const fetchMock = installRawFileFetchMock();
    const view = createSourceViewForCursorTest(blobRoute("a.txt"));
    const target = { path: "a.txt", ref: "worktree" };

    await view.renderStandaloneSource(target);
    await view.renderStandaloneSource(target, { refresh: true });

    expect(fetchMock.calls()).toBe(2);
    expect(document.querySelectorAll(".gdp-standalone-source").length).toBe(1);
  });

  test("a different target renders normally after the first", async () => {
    document.body.innerHTML = '<div id="diff"></div>';
    const fetchMock = installRawFileFetchMock();
    const route = blobRoute("a.txt") as Extract<AppRoute, { screen: "file" }>;
    const view = createSourceViewForCursorTest(route);

    await view.renderStandaloneSource({ path: "a.txt", ref: "worktree" });
    // Real navigation updates the route before the render call fires.
    route.path = "b.txt";
    await view.renderStandaloneSource({ path: "b.txt", ref: "worktree" });

    expect(fetchMock.calls()).toBe(2);
    expect(
      document.querySelector<HTMLElement>(".gdp-standalone-source")?.dataset
        .path,
    ).toBe("b.txt");
  });

  test("an errored render is retried on the next invocation", async () => {
    document.body.innerHTML = '<div id="diff"></div>';
    const fetchMock = installRawFileFetchMock({ failFirst: true });
    const view = createSourceViewForCursorTest(blobRoute("a.txt"));
    const target = { path: "a.txt", ref: "worktree" };

    await view.renderStandaloneSource(target);
    expect(
      document.querySelector<HTMLElement>(".gdp-standalone-source")?.dataset
        .sourceState,
    ).toBe("error");

    await view.renderStandaloneSource(target);

    expect(fetchMock.calls()).toBe(2);
    expect(
      document.querySelector<HTMLElement>(".gdp-standalone-source")?.dataset
        .sourceState,
    ).toBe("done");
  });

  test("a png target renders the media preview with a Preview-only tab row", async () => {
    document.body.innerHTML = '<div id="diff"></div>';
    const fetchMock = installRawFileFetchMock();
    const view = createSourceViewForCursorTest(blobRoute("assets/photo.png"));

    await view.renderStandaloneSource({
      path: "assets/photo.png",
      ref: "worktree",
    });

    expect(fetchMock.calls()).toBe(0);
    expect(document.querySelector(".gdp-source-viewer.media.image")).not.toBe(
      null,
    );
    expect(
      Array.from(
        document.querySelectorAll<HTMLButtonElement>(".gdp-source-tabs button"),
      ).map((button) => button.textContent),
    ).toEqual(["Preview", "Blame", "History"]);
    expect(
      document.querySelector<HTMLButtonElement>(
        ".gdp-source-tabs button.active",
      )?.textContent,
    ).toBe("Preview");
    expect(
      document.querySelector<HTMLElement>(".gdp-standalone-source")?.dataset
        .sourceState,
    ).toBe("done");
  });

  test.each([
    {
      name: "CSV",
      path: "data/sample.csv",
      body: 'name,note\nalpha,"one, two"\n',
      expectedCells: ["alpha", "one, two"],
    },
    {
      name: "TSV",
      path: "data/sample.tsv",
      body: 'name\tnote\nalpha\t"one\ttwo"\n',
      expectedCells: ["alpha", "one\ttwo"],
    },
  ])("a $name target renders a table in the active Preview tab", async ({
    path,
    body,
    expectedCells,
  }) => {
    document.body.innerHTML = '<div id="diff"></div>';
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      writable: true,
      value: (async () =>
        new Response(body, {
          status: 200,
        })) as typeof fetch,
    });
    const route = {
      ...blobRoute(path),
      preview: true as const,
    };
    let markdownRenderCalls = 0;
    const view = createSourceViewForCursorTest(route, {
      STATE: {
        route,
        from: "HEAD",
        to: "worktree",
        files: [],
        syntaxHighlight: true,
      },
      loadRawFileInfo: async () => ({ size: body.length }),
      renderMarkdownPreview: async () => {
        markdownRenderCalls++;
        return document.createElement("div");
      },
    });

    await view.renderStandaloneSource({
      path,
      ref: "worktree",
    });

    expect(
      Array.from(
        document.querySelectorAll<HTMLButtonElement>(
          ".gdp-source-tabs button[data-source-tab]",
        ),
      ).map((button) => button.textContent),
    ).toEqual(["Preview", "Code", "Blame", "History"]);
    expect(
      document.querySelector<HTMLButtonElement>(
        ".gdp-source-tabs button.active",
      )?.textContent,
    ).toBe("Preview");
    expect(
      Array.from(
        document.querySelectorAll(".gdp-csv-table tbody td"),
        (cell) => cell.textContent,
      ),
    ).toEqual(expectedCells);
    expect(
      document.querySelector<HTMLElement>(
        '.gdp-source-table[data-source-pane="code"]',
      )?.hidden,
    ).toBe(true);
    expect(markdownRenderCalls).toBe(0);
  });
});

describe("renderStandaloneSource same-file hit navigation", () => {
  test("a second hit in the same file moves the target line and the hl mark without reloading", async () => {
    document.body.innerHTML = '<div id="diff"></div>';
    const fetchMock = installRawFileFetchMock();
    const route = {
      ...blobRoute("a.txt"),
      line: 1,
      hl: "one",
    } as Extract<AppRoute, { screen: "file" }>;
    const view = createSourceViewForCursorTest(route);
    const target = { path: "a.txt", ref: "worktree" };

    await view.renderStandaloneSource(target);
    const rows = () =>
      Array.from(
        document.querySelectorAll<HTMLElement>(
          ".gdp-source-table tr[data-line]",
        ),
      );
    const targets = () =>
      rows()
        .filter((row) => row.classList.contains("gdp-source-line-target"))
        .map((row) => row.dataset.line);
    const marks = () =>
      Array.from(document.querySelectorAll("mark.gdp-grep-match")).map(
        (mark) => mark.textContent,
      );
    expect(targets()).toEqual(["1"]);
    expect(marks()).toEqual(["one"]);

    // The palette / results sheet update the route, then re-render the
    // already mounted file.
    route.line = 2;
    route.hl = "two";
    await view.renderStandaloneSource(target);

    expect(fetchMock.calls()).toBe(1);
    expect(targets()).toEqual(["2"]);
    expect(marks()).toEqual(["two"]);
    expect(rows()[0].textContent).toContain("line one");
  });
});

describe("preferred source tab across files", () => {
  test("restores Preview after temporarily showing Code for a non-previewable file", async () => {
    document.body.innerHTML = '<div id="diff"></div>';
    installRawFileFetchMock();
    const state: SourceViewDeps["STATE"] = {
      route: blobRoute("first.md"),
      from: "HEAD",
      to: "worktree",
      files: [],
      syntaxHighlight: false,
    };
    const view = createSourceViewForCursorTest(state.route, {
      STATE: state,
      setRoute(nextRoute) {
        state.route = nextRoute;
      },
    });

    await view.renderStandaloneSource({ path: "first.md", ref: "worktree" });
    document
      .querySelector<HTMLButtonElement>('[data-source-tab="preview"]')
      ?.click();
    expect(
      document.querySelector<HTMLButtonElement>(
        ".gdp-source-tabs button.active",
      )?.dataset.sourceTab,
    ).toBe("preview");

    state.route = blobRoute("plain.ts");
    await view.renderStandaloneSource({ path: "plain.ts", ref: "worktree" });
    expect(
      document.querySelector<HTMLButtonElement>(
        ".gdp-source-tabs button.active",
      )?.dataset.sourceTab,
    ).toBe("code");

    state.route = blobRoute("next.md");
    await view.renderStandaloneSource({ path: "next.md", ref: "worktree" });
    expect(
      document.querySelector<HTMLButtonElement>(
        ".gdp-source-tabs button.active",
      )?.dataset.sourceTab,
    ).toBe("preview");

    state.route = blobRoute("another.md");
    await view.renderStandaloneSource({ path: "another.md", ref: "worktree" });
    expect(
      document.querySelector<HTMLButtonElement>(
        ".gdp-source-tabs button.active",
      )?.dataset.sourceTab,
    ).toBe("preview");
  });

  test("keeps Code selected when the next file also supports Preview", async () => {
    document.body.innerHTML = '<div id="diff"></div>';
    installRawFileFetchMock();
    const state: SourceViewDeps["STATE"] = {
      route: {
        screen: "file",
        path: "first.md",
        ref: "worktree",
        view: "blob",
        preview: true,
        range: { from: "HEAD", to: "worktree" },
      },
      from: "HEAD",
      to: "worktree",
      files: [],
      syntaxHighlight: false,
    };
    const view = createSourceViewForCursorTest(state.route, {
      STATE: state,
      setRoute(nextRoute) {
        state.route = nextRoute;
      },
    });

    await view.renderStandaloneSource({ path: "first.md", ref: "worktree" });
    document
      .querySelector<HTMLButtonElement>('[data-source-tab="code"]')
      ?.click();
    expect(
      document.querySelector<HTMLButtonElement>(
        ".gdp-source-tabs button.active",
      )?.dataset.sourceTab,
    ).toBe("code");

    state.route = blobRoute("plain.ts");
    await view.renderStandaloneSource({ path: "plain.ts", ref: "worktree" });

    state.route = blobRoute("next.md");
    await view.renderStandaloneSource({ path: "next.md", ref: "worktree" });
    expect(
      document.querySelector<HTMLButtonElement>(
        ".gdp-source-tabs button.active",
      )?.dataset.sourceTab,
    ).toBe("code");
  });
});

describe("renderStandaloneSource loading-state guard and paged retry", () => {
  test.each([
    { refresh: false, expected: 1 },
    { refresh: true, expected: 2 },
  ])("notifies inline readers after source rows mount, refresh=$refresh", async ({
    refresh,
    expected,
  }) => {
    document.body.innerHTML = '<div id="diff"></div>';
    installRawFileFetchMock();
    const rendered: string[][] = [];
    const view = createSourceViewForCursorTest(blobRoute("sample.ts"), {
      onSourceRendered: () => {
        rendered.push(
          [...document.querySelectorAll(".gdp-source-line-code")].map(
            (cell) => cell.textContent || "",
          ),
        );
      },
    });
    await view.renderStandaloneSource({ path: "sample.ts", ref: "worktree" });
    await view.renderStandaloneSource(
      { path: "sample.ts", ref: "worktree" },
      { refresh },
    );
    expect(rendered).toHaveLength(expected);
    for (const rows of rendered)
      expect(rows).toEqual(["line one", "line two", " "]);
  });

  test("finishes plain source first and applies syntax highlighting later", async () => {
    document.body.innerHTML = '<div id="diff"></div>';
    installRawFileFetchMock();
    const route = blobRoute("sample.md");
    const state: SourceViewDeps["STATE"] = {
      route,
      from: "HEAD",
      to: "worktree",
      files: [],
      syntaxHighlight: true,
    };
    const highlighter = deferred<ShikiHighlighter | null>();
    const requestedLanguages: string[] = [];
    const markdownHighlightModes: boolean[] = [];
    const view = createSourceViewForCursorTest(route, {
      STATE: state,
      loadSourceHighlighter: (lang) => {
        requestedLanguages.push(lang);
        return highlighter.promise;
      },
      renderMarkdownPreview: async (_textValue, _target, options) => {
        markdownHighlightModes.push(options.syntaxHighlight);
        const preview = document.createElement("div");
        preview.className = "gdp-markdown-preview";
        return preview;
      },
    });

    const rendering = view.renderStandaloneSource({
      path: "sample.md",
      ref: "worktree",
    });
    try {
      await waitFor(
        () =>
          document.querySelector<HTMLElement>(".gdp-standalone-source")?.dataset
            .sourceState === "done",
        // ハイライタは未解決のままなので、ここが成立する時点で「本文の描画が
        // ハイライトを待っていない」ことは示せる。時間そのものは環境で揺れる。
        1000,
      );
      const firstCode = document.querySelector<HTMLElement>(
        ".gdp-source-line-code",
      );
      expect(firstCode?.textContent).toBe("line one");
      expect(firstCode?.classList.contains("shiki")).toBe(false);
      expect(markdownHighlightModes[0]).toBe(false);

      await waitFor(() => requestedLanguages.length === 1);
      expect(requestedLanguages).toEqual(["markdown"]);
      highlighter.resolve({
        codeToHtml(code) {
          const renderedLines = code
            .split("\n")
            .map(
              (line) =>
                `<span class="line"><span data-test-token>${line}</span></span>`,
            )
            .join("\n");
          return `<pre><code>${renderedLines}</code></pre>`;
        },
      });
      await waitFor(() => firstCode?.classList.contains("shiki") === true);
      expect(firstCode?.querySelector("[data-test-token]")?.textContent).toBe(
        "line one",
      );
    } finally {
      highlighter.resolve(null);
      await rendering;
    }
  });

  test("does not apply a late syntax result to the next file", async () => {
    document.body.innerHTML = '<div id="diff"></div>';
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      writable: true,
      value: (async (input: RequestInfo | URL) => {
        const url = new URL(String(input), "http://localhost");
        const path = url.searchParams.get("path");
        return new Response(
          path === "first.ts" ? "first line" : "second line",
          {
            status: 200,
          },
        );
      }) as typeof fetch,
    });
    const state: SourceViewDeps["STATE"] = {
      route: blobRoute("first.ts"),
      from: "HEAD",
      to: "worktree",
      files: [],
      syntaxHighlight: true,
    };
    const highlighter = deferred<ShikiHighlighter | null>();
    let highlighterRequests = 0;
    const view = createSourceViewForCursorTest(state.route, {
      STATE: state,
      loadSourceHighlighter: () => {
        highlighterRequests++;
        return highlighter.promise;
      },
    });

    await view.renderStandaloneSource({ path: "first.ts", ref: "worktree" });
    await waitFor(() => highlighterRequests === 1);
    state.syntaxHighlight = false;
    state.route = blobRoute("second.ts");
    await view.renderStandaloneSource({ path: "second.ts", ref: "worktree" });

    highlighter.resolve({
      codeToHtml: () =>
        '<pre><code><span class="line"><span data-stale-token>stale</span></span></code></pre>',
    });
    await Promise.resolve();
    await Promise.resolve();

    const currentCode = document.querySelector<HTMLElement>(
      ".gdp-source-line-code",
    );
    expect(currentCode?.textContent).toBe("second line");
    expect(currentCode?.classList.contains("shiki")).toBe(false);
    expect(document.querySelector("[data-stale-token]")).toBeNull();
  });

  test("re-invoking while the mounted target is still loading waits for the shared render", async () => {
    document.body.innerHTML = '<div id="diff"></div>';
    let calls = 0;
    const gate = deferred<Response>();
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      writable: true,
      value: (async (input: RequestInfo | URL) => {
        const url = new URL(String(input), "http://localhost");
        if (url.pathname === "/_file") {
          calls++;
          return gate.promise;
        }
        return new Response("{}", { status: 200 });
      }) as typeof fetch,
    });
    const view = createSourceViewForCursorTest(blobRoute("a.txt"));
    const target = { path: "a.txt", ref: "worktree" };

    const first = view.renderStandaloneSource(target);
    await waitFor(() => calls === 1);
    let secondSettled = false;
    const second = view.renderStandaloneSource(target).then(() => {
      secondSettled = true;
    });
    await Promise.resolve();

    expect(calls).toBe(1);
    expect(secondSettled).toBe(false);
    expect(
      document.querySelector<HTMLElement>(".gdp-standalone-source")?.dataset
        .sourceState,
    ).toBe("loading");

    gate.resolve(new Response("line one\n", { status: 200 }));
    await Promise.all([first, second]);
    expect(secondSettled).toBe(true);
    expect(
      document.querySelector<HTMLElement>(".gdp-standalone-source")?.dataset
        .sourceState,
    ).toBe("done");
  });

  test("a failed paged initial range lands on error and the next click retries", async () => {
    document.body.innerHTML = '<div id="diff"></div>';
    let rangeCalls = 0;
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      writable: true,
      value: (async (input: RequestInfo | URL) => {
        const url = new URL(String(input), "http://localhost");
        if (url.pathname === "/file_range") {
          rangeCalls++;
          if (rangeCalls === 1) return new Response("boom", { status: 500 });
          return new Response(
            JSON.stringify({
              path: "big.txt",
              ref: "worktree",
              start: 1,
              end: 400,
              lines: ["line one"],
              total: 1,
              complete: true,
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          );
        }
        return new Response("{}", { status: 200 });
      }) as typeof fetch,
    });
    const view = createSourceViewForCursorTest(blobRoute("big.txt"), {
      // 2MB pushes the render down the paged/virtual path.
      loadRawFileInfo: async () => ({ size: 2 * 1024 * 1024 }),
    });
    const target = { path: "big.txt", ref: "worktree" };

    await view.renderStandaloneSource(target);
    expect(
      document.querySelector<HTMLElement>(".gdp-standalone-source")?.dataset
        .sourceState,
    ).toBe("error");

    await view.renderStandaloneSource(target);
    expect(rangeCalls).toBe(2);
    expect(
      document.querySelector<HTMLElement>(".gdp-standalone-source")?.dataset
        .sourceState,
    ).toBe("done");
  });
});

describe("visible source line navigation", () => {
  test.each([
    ["1", 1],
    ["2", 2],
    ["3", 3],
    ["0", 1],
    ["4", 1],
    ["1.5", 1],
    ["", 1],
  ])("validates line %s before moving to %s", async (value, expected) => {
    document.body.innerHTML = '<main id="content"><div id="diff"></div></main>';
    installRawFileFetchMock();
    const target = { path: "sample.txt", ref: "worktree" };
    const view = createSourceViewForCursorTest(blobRoute(target.path));
    await view.renderStandaloneSource(target);
    const input = document.querySelector<HTMLInputElement>(
      ".gdp-source-line-jump input",
    );
    if (!input) throw new Error("missing line navigation input");
    expect(input.max).toBe("3");
    input.value = value;
    input.form?.dispatchEvent(new Event("submit", { cancelable: true }));
    expect(view.ensureSourceCursor(target).line).toBe(expected);
  });

  test("localizes the visible line controls without clearing the chosen line", async () => {
    document.body.innerHTML = '<main id="content"><div id="diff"></div></main>';
    installRawFileFetchMock();
    let language: "en" | "ja" = "en";
    const view = createSourceViewForCursorTest(blobRoute("sample.txt"), {
      getLanguage: () => language,
    });
    await view.renderStandaloneSource({ path: "sample.txt", ref: "worktree" });
    const input = document.querySelector<HTMLInputElement>(
      ".gdp-source-line-jump input",
    );
    if (!input) throw new Error("missing line navigation input");
    input.value = "2";
    language = "ja";
    view.localize();
    expect(input.value).toBe("2");
    expect(input.getAttribute("aria-label")).toBe("行へ移動");
    expect(document.querySelector(".gdp-source-line-count")?.textContent).toBe(
      "3 行",
    );
  });
});
