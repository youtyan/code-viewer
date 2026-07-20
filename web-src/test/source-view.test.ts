import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { AppRoute } from "../core/routes";
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
});

function createSourceViewForCursorTest(
  route: AppRoute,
  overrides: Partial<SourceViewDeps> = {},
) {
  const state: SourceViewDeps["STATE"] = {
    route,
    from: "HEAD",
    to: "worktree",
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
      expected: 31,
    },
  ])("reads the row height from the $name", ({ html, expected }) => {
    document.body.innerHTML = html;
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
});

describe("renderStandaloneSource loading-state guard and paged retry", () => {
  test("re-invoking while the mounted target is still loading is a no-op", async () => {
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
    await view.renderStandaloneSource(target);

    expect(calls).toBe(1);
    expect(
      document.querySelector<HTMLElement>(".gdp-standalone-source")?.dataset
        .sourceState,
    ).toBe("loading");

    gate.resolve(new Response("line one\n", { status: 200 }));
    await first;
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
