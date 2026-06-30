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
import type { DiffCardElement, DiffMeta, FileMeta } from "../core/types";
import {
  createDiffView,
  isDiffShellDomIntact,
  shouldRenderDiffSidebar,
} from "../views/diff-view";
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

function element(className: string, key?: string): Element {
  const classes = new Set(className.split(/\s+/).filter(Boolean));
  return {
    classList: {
      contains(name: string) {
        return classes.has(name);
      },
    },
    dataset: key ? { key } : {},
  } as unknown as Element;
}

function target(children: Element[]): Element {
  return { children } as unknown as Element;
}

function setupDiffDom() {
  document.body.innerHTML = `
    <div id="meta"></div>
    <div id="diff"></div>
    <div id="empty"></div>
    <ul id="filelist"></ul>
  `;
}

function makeFile(
  path: string,
  additions: number,
  deletions: number,
  loadUrl: string,
  key?: string,
): FileMeta {
  const file: FileMeta = {
    path,
    status: "M",
    additions,
    deletions,
    size_class: "small",
    load_url: loadUrl,
  };
  if (key !== undefined) file.key = key;
  return file;
}

function makeMeta(files: FileMeta[]): DiffMeta {
  return {
    files,
    totals: {
      files: files.length,
      additions: files.reduce((sum, file) => sum + (file.additions || 0), 0),
      deletions: files.reduce((sum, file) => sum + (file.deletions || 0), 0),
    },
    generation: 1,
  };
}

function createDiffViewForShellTest() {
  const route: AppRoute = {
    screen: "diff",
    range: { from: "base", to: "head" },
  };
  const state = {
    route,
    files: [] as FileMeta[],
    layout: "line-by-line",
    ignoreWs: false,
    syntaxHighlight: false,
    collapsed: false,
    viewedFiles: new Set<string>(),
  };
  let serverGeneration = 1;
  let sidebarRenders = 0;
  const view = createDiffView({
    STATE: state,
    setRoute() {
      /* noop */
    },
    currentRange: () => route.range,
    escapeHtml: (value) => String(value ?? ""),
    trackLoad: (promise) => promise,
    diffCardSelector: (path) =>
      `.gdp-file-shell[data-path="${CSS.escape(path)}"]`,
    getHljs: () => null,
    inferLang: () => null,
    lineTargetStart: () => null,
    fileSourceTarget: (file) => ({ path: file.path, ref: "head" }),
    applySourceRouteToShell() {
      /* noop */
    },
    setupHunkExpand() {
      /* noop */
    },
    applyInlineAnnotations() {
      /* noop */
    },
    applyFilter() {
      /* noop */
    },
    markActive() {
      /* noop */
    },
    renderSidebar() {
      sidebarRenders++;
    },
    isRepositorySidebarMode: () => false,
    loadRepo: async () => undefined,
    repoRoute: (ref, path) => ({
      screen: "repo",
      ref,
      path,
      range: route.range,
    }),
    setProjectName() {
      /* noop */
    },
    getProjectName: () => "",
    createOpenPathButton: () => document.createElement("button"),
    persistViewedFiles() {
      /* noop */
    },
    applyHideTests() {
      /* noop */
    },
    getServerGeneration: () => serverGeneration,
    setServerGeneration: (generation) => {
      serverGeneration = generation;
    },
    invalidateRepoSidebar() {
      /* noop */
    },
    $: <T extends Element = HTMLElement>(sel: string): T => {
      const found = document.querySelector<T>(sel);
      if (!found) throw new Error(`missing ${sel}`);
      return found;
    },
    $$: <T extends Element = HTMLElement>(sel: string): T[] =>
      Array.from(document.querySelectorAll<T>(sel)),
  });
  return { view, sidebarRenders: () => sidebarRenders };
}

describe("diff view fast path", () => {
  test("accepts the fast path only when direct diff cards match the file list", () => {
    expect(
      isDiffShellDomIntact(
        target([
          element("gdp-file-shell pending", "src/a.ts"),
          element("gdp-file-shell loaded", "src/b.ts"),
        ]),
        ["src/a.ts", "src/b.ts"],
      ),
    ).toBe(true);
    expect(
      isDiffShellDomIntact(
        target([
          element("gdp-file-shell pending", "src/b.ts"),
          element("gdp-file-shell loaded", "src/a.ts"),
        ]),
        ["src/a.ts", "src/b.ts"],
      ),
    ).toBe(false);
  });

  test("rejects repository shells even when they contain nested file-shell elements", () => {
    const repoShell = element("gdp-repo-shell");
    Object.assign(repoShell, {
      children: [element("gdp-file-shell loaded gdp-repo-list-shell")],
    });

    expect(isDiffShellDomIntact(target([repoShell]), ["src/a.ts"])).toBe(false);
  });

  test("refreshes the sidebar when the file list is unchanged but the diff DOM was replaced", () => {
    expect(shouldRenderDiffSidebar(true, true)).toBe(false);
    expect(shouldRenderDiffSidebar(true, false)).toBe(true);
    expect(shouldRenderDiffSidebar(false, true)).toBe(true);
  });

  test("resets a reused loaded card when full-path render changes its diff signature", () => {
    setupDiffDom();
    const originalObserver = globalThis.IntersectionObserver;
    const originalRect = HTMLElement.prototype.getBoundingClientRect;
    globalThis.IntersectionObserver = class {
      observe() {
        /* noop */
      }
      disconnect() {
        /* noop */
      }
      unobserve() {
        /* noop */
      }
    } as unknown as typeof IntersectionObserver;
    HTMLElement.prototype.getBoundingClientRect = () =>
      ({
        top: 99999,
        bottom: 100099,
        left: 0,
        right: 0,
        width: 0,
        height: 100,
        x: 0,
        y: 99999,
        toJSON: () => ({}),
      }) as DOMRect;
    try {
      const { view } = createDiffViewForShellTest();
      const firstReadme = makeFile(
        "README.md",
        35,
        5,
        "/file_diff?from=old&to=first&path=README.md",
      );
      view.renderShell(
        makeMeta([
          firstReadme,
          makeFile("web-src/server/agent-help.ts", 89, 0, "/agent-help"),
        ]),
      );
      const card = document.querySelector<DiffCardElement>(
        '.gdp-file-shell[data-path="README.md"]',
      );
      if (!card) throw new Error("missing README card");
      card.classList.remove("pending");
      card.classList.add("loaded");
      card._file = firstReadme;
      card._diffData = {
        path: "README.md",
        status: "M",
        diff: "stale +35 -5",
      } as never;
      const body = card.querySelector<HTMLElement>(".gdp-shell-body");
      if (!body) throw new Error("missing README body");
      body.innerHTML = '<div class="d2h-wrapper">stale +35 -5</div>';
      card.dataset.reqId = "123";

      const result = view.renderShell(
        makeMeta([
          makeFile(
            "README.md",
            5,
            1,
            "/file_diff?from=next&to=second&path=README.md",
          ),
          makeFile("web-src/server/cli-helpers.ts", 6, 0, "/cli-helpers"),
        ]),
      );

      const reused = document.querySelector<DiffCardElement>(
        '.gdp-file-shell[data-path="README.md"]',
      );
      expect(reused).toBe(card);
      expect(result.structureChanged).toBe(true);
      expect(result.invalidatedCards >= 2).toBe(true);
      expect(reused?.classList.contains("pending")).toBe(true);
      expect(reused?.classList.contains("loaded")).toBe(false);
      expect(reused?.querySelector(".d2h-wrapper")).toBeNull();
      expect(reused?.querySelector(".gdp-shell-body")?.textContent).toBe("");
      expect(
        reused?.querySelector(".gdp-shell-header .stats")?.textContent,
      ).toBe("+5−1");
      expect(reused?.dataset.reqId === "123").toBe(false);
    } finally {
      globalThis.IntersectionObserver = originalObserver;
      HTMLElement.prototype.getBoundingClientRect = originalRect;
    }
  });

  test("resets fast-path cards whose production keys contain NUL separators", () => {
    setupDiffDom();
    const originalObserver = globalThis.IntersectionObserver;
    const originalRect = HTMLElement.prototype.getBoundingClientRect;
    globalThis.IntersectionObserver = class {
      observe() {
        /* noop */
      }
      disconnect() {
        /* noop */
      }
      unobserve() {
        /* noop */
      }
    } as unknown as typeof IntersectionObserver;
    HTMLElement.prototype.getBoundingClientRect = () =>
      ({
        top: 99999,
        bottom: 100099,
        left: 0,
        right: 0,
        width: 0,
        height: 100,
        x: 0,
        y: 99999,
        toJSON: () => ({}),
      }) as DOMRect;
    try {
      const { view } = createDiffViewForShellTest();
      const path = "web-src/server/database/handle.ts";
      const key = `M\0\0${path}`;
      const firstFile = makeFile(
        path,
        99,
        66,
        "/file_diff?from=old&to=first&path=web-src%2Fserver%2Fdatabase%2Fhandle.ts",
        key,
      );
      view.renderShell(makeMeta([firstFile]));
      const card = document.querySelector<DiffCardElement>(".gdp-file-shell");
      if (!card) throw new Error("missing diff card");
      card.classList.remove("pending");
      card.classList.add("loaded");
      card._file = firstFile;
      card._diffData = {
        path,
        status: "M",
        diff: "stale commit diff",
      } as never;
      const body = card.querySelector<HTMLElement>(".gdp-shell-body");
      if (!body) throw new Error("missing card body");
      body.innerHTML = '<div class="d2h-wrapper">stale commit diff</div>';
      card.dataset.reqId = "123";

      const result = view.renderShell(
        makeMeta([
          makeFile(
            path,
            102,
            27,
            "/file_diff?from=first&to=second&path=web-src%2Fserver%2Fdatabase%2Fhandle.ts",
            key,
          ),
        ]),
      );

      const reused = document.querySelector<DiffCardElement>(".gdp-file-shell");
      expect(reused).toBe(card);
      expect(result.structureChanged).toBe(false);
      expect(result.invalidatedCards).toBe(1);
      expect(reused?.classList.contains("pending")).toBe(true);
      expect(reused?.classList.contains("loaded")).toBe(false);
      expect(reused?.querySelector(".d2h-wrapper")).toBeNull();
      expect(reused?.querySelector(".gdp-shell-body")?.textContent).toBe("");
      expect(
        reused?.querySelector(".gdp-shell-header .stats")?.textContent,
      ).toBe("+102−27");
      expect(reused?.dataset.reqId === "123").toBe(false);
    } finally {
      globalThis.IntersectionObserver = originalObserver;
      HTMLElement.prototype.getBoundingClientRect = originalRect;
    }
  });

  test("starts new visible loads when previous fast-path loads are still in flight", async () => {
    setupDiffDom();
    const originalObserver = globalThis.IntersectionObserver;
    const originalRect = HTMLElement.prototype.getBoundingClientRect;
    const originalFetch = globalThis.fetch;
    const requests: string[] = [];
    const pending = new Map<string, ReturnType<typeof deferred<Response>>>();
    globalThis.IntersectionObserver = class {
      observe() {
        /* noop */
      }
      disconnect() {
        /* noop */
      }
      unobserve() {
        /* noop */
      }
    } as unknown as typeof IntersectionObserver;
    HTMLElement.prototype.getBoundingClientRect = () =>
      ({
        top: 0,
        bottom: 100,
        left: 0,
        right: 0,
        width: 100,
        height: 100,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;
    globalThis.fetch = ((input: RequestInfo | URL) => {
      const url = String(input);
      requests.push(url);
      const response = deferred<Response>();
      pending.set(url, response);
      return response.promise;
    }) as typeof fetch;
    try {
      const { view } = createDiffViewForShellTest();
      view.renderShell(
        makeMeta([
          makeFile(
            "README.md",
            1,
            0,
            "/file_diff?from=base&to=first&path=README.md",
          ),
          makeFile(
            "src/a.ts",
            1,
            0,
            "/file_diff?from=base&to=first&path=src/a.ts",
          ),
        ]),
      );
      await waitFor(() => requests.length === 2);
      const readme = document.querySelector<DiffCardElement>(
        '.gdp-file-shell[data-path="README.md"]',
      );
      if (!readme) throw new Error("missing README card");
      const firstReqId = readme.dataset.reqId;

      view.renderShell(
        makeMeta([
          makeFile(
            "README.md",
            2,
            0,
            "/file_diff?from=base&to=second&path=README.md",
          ),
          makeFile(
            "src/a.ts",
            2,
            0,
            "/file_diff?from=base&to=second&path=src/a.ts",
          ),
        ]),
      );

      await waitFor(() => requests.length === 4);
      expect(requests.slice(2)).toEqual([
        "/file_diff?from=base&to=second&path=README.md",
        "/file_diff?from=base&to=second&path=src/a.ts",
      ]);
      expect(readme.dataset.reqId === firstReqId).toBe(false);
      expect(readme.classList.contains("loading")).toBe(true);
      expect(pending.size).toBe(4);
    } finally {
      globalThis.IntersectionObserver = originalObserver;
      HTMLElement.prototype.getBoundingClientRect = originalRect;
      globalThis.fetch = originalFetch;
    }
  });
});
