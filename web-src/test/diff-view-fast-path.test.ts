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
): FileMeta {
  return {
    path,
    status: "M",
    additions,
    deletions,
    size_class: "small",
    load_url: loadUrl,
  };
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
});
