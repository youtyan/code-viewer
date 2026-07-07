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
  type DiffViewDeps,
  type DiffViewText,
  isDiffShellDomIntact,
  shouldRenderDiffSidebar,
} from "../views/diff-view";
import { deferred, makeDiffMeta, waitFor } from "./_test-helpers";

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
  overrides?: Partial<
    Pick<FileMeta, "status" | "size_class" | "media_kind" | "binary">
  >,
): FileMeta {
  const file: FileMeta = {
    path,
    status: "M",
    additions,
    deletions,
    size_class: "small",
    load_url: loadUrl,
    ...overrides,
  };
  if (key !== undefined) file.key = key;
  return file;
}

function makeMeta(files: FileMeta[]): DiffMeta {
  return makeDiffMeta(files, { generation: 1 });
}

const defaultDiffText: DiffViewText = {
  files: (count) => `${count} file${count === 1 ? "" : "s"}`,
  updated: (time) => `updated ${time}`,
  updatedTitle: "last updated",
  kindAdded: "added",
  kindDeleted: "deleted",
  kindRenamed: "renamed",
  kindHeavy: "heavy",
  kindBinary: "binary",
  kindMedia: "media",
  viewedProgress: (viewed, total) => `${viewed}/${total} viewed`,
  viewedProgressTitle: "review progress",
  nextUnviewed: "next unviewed",
  nextUnviewedTitle: "Jump to the next unviewed file (n)",
  allViewed: "all viewed",
  allViewedTitle: "All visible files are viewed",
};

function createDiffViewForShellTest(
  text: DiffViewText = defaultDiffText,
  overrides: Partial<
    Pick<DiffViewDeps, "getHljs" | "inferLang"> & {
      syntaxHighlight: boolean;
    }
  > = {},
) {
  const route: AppRoute = {
    screen: "diff",
    range: { from: "base", to: "head" },
  };
  const state: DiffViewDeps["STATE"] = {
    route,
    files: [] as FileMeta[],
    layout: "line-by-line",
    ignoreWs: false,
    syntaxHighlight: overrides.syntaxHighlight ?? false,
    collapsed: false,
    viewedFiles: new Set<string>(),
  };
  let serverGeneration = 1;
  let sidebarRenders = 0;
  const markActiveCalls: Array<{
    path: string;
    options?: { reveal?: boolean };
  }> = [];
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
    getHljs: overrides.getHljs ?? (() => null),
    inferLang: overrides.inferLang ?? (() => null),
    lineTargetStart: (line) => {
      if (!line) return null;
      return typeof line === "number" ? line : line.start;
    },
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
    markActive(path, options) {
      markActiveCalls.push({ path, options });
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
    diffText: () => text,
    $: <T extends Element = HTMLElement>(sel: string): T => {
      const found = document.querySelector<T>(sel);
      if (!found) throw new Error(`missing ${sel}`);
      return found;
    },
    $$: <T extends Element = HTMLElement>(sel: string): T[] =>
      Array.from(document.querySelectorAll<T>(sel)),
  });
  return {
    view,
    state,
    sidebarRenders: () => sidebarRenders,
    markActiveCalls: () => markActiveCalls,
  };
}

function installSidebarFileRow(
  path: string,
  options: {
    active?: boolean;
    viewed?: boolean;
    hidden?: boolean;
    hiddenByTests?: boolean;
    // Skip when a prior renderShell() call already created the matching
    // .gdp-file-shell card - a second one here would break isDiffShellDomIntact.
    skipCard?: boolean;
  } = {},
) {
  const li = document.createElement("li");
  li.dataset.path = path;
  if (options.active) li.classList.add("active");
  if (options.viewed) li.classList.add("viewed");
  if (options.hidden) li.classList.add("hidden");
  if (options.hiddenByTests) li.classList.add("hidden-by-tests");
  document.querySelector("#filelist")?.appendChild(li);

  if (options.skipCard) return { li, card: null };
  const card = document.createElement("div");
  card.className = "gdp-file-shell";
  card.dataset.path = path;
  document.querySelector("#diff")?.appendChild(card);
  return { li, card };
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

  test("renders viewed progress from the displayed diff files", () => {
    setupDiffDom();
    const { view, state } = createDiffViewForShellTest();
    state.viewedFiles.add("src/b.ts");

    view.renderMeta(
      makeMeta([
        makeFile("src/a.ts", 2, 1, "/file_diff?path=src%2Fa.ts"),
        makeFile("src/b.ts", 4, 0, "/file_diff?path=src%2Fb.ts"),
      ]),
    );

    expect(
      document.querySelector<HTMLElement>("#meta .chip-viewed")?.textContent,
    ).toBe("1/2 viewed");
  });

  test("updates viewed progress when a file is marked viewed", () => {
    setupDiffDom();
    const { view } = createDiffViewForShellTest();
    view.renderMeta(
      makeMeta([
        makeFile("src/a.ts", 2, 1, "/file_diff?path=src%2Fa.ts"),
        makeFile("src/b.ts", 4, 0, "/file_diff?path=src%2Fb.ts"),
      ]),
    );

    expect(
      document.querySelector<HTMLElement>("#meta .chip-viewed")?.textContent,
    ).toBe("0/2 viewed");

    view.setFileViewed("src/a.ts", true);
    expect(
      document.querySelector<HTMLElement>("#meta .chip-viewed")?.textContent,
    ).toBe("1/2 viewed");

    view.setFileViewed("src/b.ts", true);
    expect(
      document.querySelector<HTMLElement>("#meta .chip-viewed")?.textContent,
    ).toBe("2/2 viewed");

    view.setFileViewed("src/a.ts", false);
    expect(
      document.querySelector<HTMLElement>("#meta .chip-viewed")?.textContent,
    ).toBe("1/2 viewed");
  });

  test("defers syntax highlighting until idle after mounting a diff", () => {
    setupDiffDom();
    const originalDiff2Html = window.Diff2HtmlUI;
    const originalRequestIdleCallback = window.requestIdleCallback;
    let highlightCodeCalls = 0;
    let renderedWithInitialHighlight: boolean | undefined;
    let idleWork: IdleRequestCallback | null = null;

    window.requestIdleCallback = ((callback: IdleRequestCallback) => {
      idleWork = callback;
      return 1;
    }) as typeof window.requestIdleCallback;
    window.Diff2HtmlUI = class {
      private readonly element: HTMLElement;
      private readonly options: { highlight?: boolean };

      constructor(
        element: HTMLElement,
        _diff: string,
        options: { highlight?: boolean },
      ) {
        this.element = element;
        this.options = options;
      }

      draw() {
        renderedWithInitialHighlight = this.options.highlight;
        this.element.innerHTML =
          '<div class="d2h-file-wrapper"><table class="d2h-diff-table"><tbody>' +
          '<tr><td class="d2h-code-line"><span class="d2h-code-line-ctn">const value = 1;</span></td></tr>' +
          "</tbody></table></div>";
      }

      highlightCode() {
        highlightCodeCalls++;
      }
    } as unknown as typeof window.Diff2HtmlUI;

    try {
      const { view } = createDiffViewForShellTest(defaultDiffText, {
        syntaxHighlight: true,
        inferLang: () => "ts",
        getHljs: () =>
          ({
            getLanguage: () => true,
            highlight: (code: string) => ({
              value: `<span class="tok">${code}</span>`,
            }),
          }) as never,
      });
      const card = document.createElement("div") as DiffCardElement;
      card.className = "gdp-file-shell";
      card.dataset.path = "src/sample.ts";
      card.innerHTML =
        '<div class="gdp-shell-header"></div><div class="gdp-shell-body"></div>';
      document.querySelector("#diff")?.appendChild(card);

      view.renderFile(
        {
          path: "src/sample.ts",
          status: "M",
          additions: 1,
          deletions: 0,
          size_class: "small",
          highlight: true,
          load_url: "/file_diff?path=src%2Fsample.ts",
        },
        {
          path: "src/sample.ts",
          status: "M",
          diff: "diff --git a/src/sample.ts b/src/sample.ts\n",
        },
        card,
      );

      const span = card.querySelector<HTMLElement>(".d2h-code-line-ctn");
      expect(renderedWithInitialHighlight).toBe(false);
      expect(highlightCodeCalls).toBe(0);
      expect(span?.dataset.gdpHl).toBeUndefined();

      idleWork?.({
        didTimeout: false,
        timeRemaining: () => 50,
      } as IdleDeadline);

      expect(span?.dataset.gdpHl).toBe("1");
      expect(span?.querySelector(".tok")?.textContent).toBe("const value = 1;");
    } finally {
      window.Diff2HtmlUI = originalDiff2Html;
      window.requestIdleCallback = originalRequestIdleCallback;
    }
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

  test("focuses every diff row in a line range", () => {
    setupDiffDom();
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = () => undefined;
    try {
      const { view } = createDiffViewForShellTest();
      const card = document.createElement("article");
      card.innerHTML = `
        <table class="d2h-diff-table">
          <tbody>
            <tr data-row="1"><td class="d2h-code-linenumber d2h-ins"><span class="line-num2">1</span></td><td>one</td></tr>
            <tr data-row="2"><td class="d2h-code-linenumber d2h-ins"><span class="line-num2">2</span></td><td>two</td></tr>
            <tr data-row="3"><td class="d2h-code-linenumber d2h-ins"><span class="line-num2">3</span></td><td>three</td></tr>
            <tr data-row="4"><td class="d2h-code-linenumber d2h-ins"><span class="line-num2">4</span></td><td>four</td></tr>
          </tbody>
        </table>
      `;

      expect(view.focusDiffLine(card, { start: 2, end: 4 })).toBe(true);

      expect(
        card
          .querySelector('tr[data-row="1"]')
          ?.classList.contains("gdp-diff-line-target"),
      ).toBe(false);
      for (const row of ["2", "3", "4"]) {
        expect(
          card
            .querySelector(`tr[data-row="${row}"]`)
            ?.classList.contains("gdp-diff-line-target"),
        ).toBe(true);
      }
    } finally {
      HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
    }
  });

  test("does not focus old-side rows as after-side diff targets", () => {
    setupDiffDom();
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = () => undefined;
    try {
      const { view } = createDiffViewForShellTest();
      const card = document.createElement("article");
      card.innerHTML = `
        <div class="d2h-file-wrapper">
          <div class="d2h-file-side-diff">
            <table class="d2h-diff-table"><tbody>
              <tr data-row="old-10"><td class="d2h-code-side-linenumber d2h-del">10</td><td>old</td></tr>
              <tr data-row="old-11"><td class="d2h-code-side-linenumber d2h-del">11</td><td>old</td></tr>
            </tbody></table>
          </div>
          <div class="d2h-file-side-diff">
            <table class="d2h-diff-table"><tbody>
              <tr data-row="new-10"><td class="d2h-code-side-linenumber d2h-cntx">10</td><td>current</td></tr>
            </tbody></table>
          </div>
        </div>
      `;

      expect(view.focusDiffLine(card, { start: 10, end: 11 })).toBe(false);
      expect(card.querySelector(".gdp-diff-line-target")).toBe(null);
    } finally {
      HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
    }
  });
});

describe("diff view meta stat strip", () => {
  test("renders files/additions/deletions as separate compact chips", () => {
    setupDiffDom();
    const { view } = createDiffViewForShellTest();

    view.renderMeta(
      makeMeta([makeFile("a.ts", 10, 3, "/a"), makeFile("b.ts", 2, 0, "/b")]),
    );

    const meta = document.querySelector("#meta");
    expect(meta?.querySelector(".chip-files")?.textContent).toBe("2 files");
    expect(meta?.querySelector(".chip-add")?.textContent).toBe("+12");
    expect(meta?.querySelector(".chip-del")?.textContent).toBe("−3");
  });

  test("uses the singular form for a single-file diff", () => {
    setupDiffDom();
    const { view } = createDiffViewForShellTest();

    view.renderMeta(makeMeta([makeFile("a.ts", 1, 0, "/a")]));

    expect(document.querySelector("#meta .chip-files")?.textContent).toBe(
      "1 file",
    );
  });

  test("renders a diff metadata error as a visible chip", () => {
    setupDiffDom();
    const { view } = createDiffViewForShellTest();

    view.renderMeta(makeDiffMeta([], { error: "git not found in PATH" }));

    expect(document.querySelector("#meta .chip-error")?.textContent).toBe(
      "git not found in PATH",
    );
  });

  test("renders the diff meta strip with injected labels", () => {
    setupDiffDom();
    const { view } = createDiffViewForShellTest({
      ...defaultDiffText,
      files: (count) => `${count}ファイル`,
      updated: (time) => `更新 ${time}`,
      updatedTitle: "最終更新",
      kindAdded: "追加",
      kindDeleted: "削除",
      kindRenamed: "名前変更",
      kindHeavy: "大容量",
      kindBinary: "バイナリ",
      kindMedia: "メディア",
      viewedProgress: (viewed, total) => `${viewed}/${total} 確認済み`,
      viewedProgressTitle: "確認進捗",
      nextUnviewed: "次の未確認",
      nextUnviewedTitle: "次の未確認ファイルへ移動 (n)",
    });

    view.renderMeta(
      makeMeta([
        makeFile("new.ts", 2, 0, "/new", undefined, { status: "A" }),
        makeFile("old.ts", 0, 1, "/old", undefined, { status: "D" }),
        makeFile("moved.ts", 1, 1, "/moved", undefined, { status: "R" }),
        makeFile("huge.ts", 1, 1, "/huge", undefined, {
          size_class: "huge",
        }),
        makeFile("archive.zip", 0, 0, "/zip", undefined, {
          size_class: "binary",
        }),
        makeFile("logo.png", 0, 0, "/png", undefined, {
          media_kind: "image",
        }),
      ]),
    );

    const meta = document.querySelector("#meta");
    expect(meta?.querySelector(".chip-files")?.textContent).toBe("6ファイル");
    expect(meta?.querySelector(".chip-added")?.textContent).toBe("1 追加");
    expect(meta?.querySelector(".chip-deleted")?.textContent).toBe("1 削除");
    expect(meta?.querySelector(".chip-renamed")?.textContent).toBe(
      "1 名前変更",
    );
    expect(meta?.querySelector(".chip-heavy")?.textContent).toBe("1 大容量");
    expect(meta?.querySelector(".chip-binary")?.textContent).toBe("1 バイナリ");
    expect(meta?.querySelector(".chip-media")?.textContent).toBe("1 メディア");
    expect(meta?.querySelector(".chip-viewed")?.textContent).toBe(
      "0/6 確認済み",
    );
    expect(meta?.querySelector(".chip-viewed")?.getAttribute("title")).toBe(
      "確認進捗",
    );
    expect(meta?.querySelector(".chip-next-unviewed")?.textContent).toBe(
      "次の未確認",
    );
    expect(
      meta?.querySelector(".chip-next-unviewed")?.getAttribute("title"),
    ).toBe("次の未確認ファイルへ移動 (n)");
    expect(meta?.querySelector(".chip-updated")?.textContent).toMatch(/^更新 /);
    expect(meta?.querySelector(".chip-updated")?.getAttribute("title")).toBe(
      "最終更新",
    );
  });

  test("clears #meta when meta is null", () => {
    setupDiffDom();
    const { view } = createDiffViewForShellTest();

    view.renderMeta(null);

    expect(document.querySelector("#meta")?.textContent).toBe("");
  });

  test("omits added/deleted/renamed/heavy/binary/media chips when every file is a plain modification", () => {
    setupDiffDom();
    const { view } = createDiffViewForShellTest();

    view.renderMeta(makeMeta([makeFile("a.ts", 10, 3, "/a")]));

    const meta = document.querySelector("#meta");
    expect(meta?.querySelector(".chip-added")).toBeNull();
    expect(meta?.querySelector(".chip-deleted")).toBeNull();
    expect(meta?.querySelector(".chip-renamed")).toBeNull();
    expect(meta?.querySelector(".chip-heavy")).toBeNull();
    expect(meta?.querySelector(".chip-binary")).toBeNull();
    expect(meta?.querySelector(".chip-media")).toBeNull();
  });

  test("renders non-zero added/deleted/renamed/heavy/binary/media chips", () => {
    setupDiffDom();
    const { view } = createDiffViewForShellTest();

    view.renderMeta(
      makeMeta([
        makeFile("new.ts", 20, 0, "/new", undefined, { status: "A" }),
        makeFile("old.ts", 0, 15, "/old", undefined, { status: "D" }),
        makeFile("moved.ts", 1, 1, "/moved", undefined, { status: "R" }),
        makeFile("huge.ts", 900, 900, "/huge", undefined, {
          size_class: "huge",
        }),
        makeFile("archive.zip", 0, 0, "/zip", undefined, {
          size_class: "binary",
        }),
        makeFile("logo.png", 0, 0, "/png", undefined, {
          media_kind: "image",
        }),
      ]),
    );

    const meta = document.querySelector("#meta");
    expect(meta?.querySelector(".chip-added")?.textContent).toBe("1 added");
    expect(meta?.querySelector(".chip-deleted")?.textContent).toBe("1 deleted");
    expect(meta?.querySelector(".chip-renamed")?.textContent).toBe("1 renamed");
    expect(meta?.querySelector(".chip-heavy")?.textContent).toBe("1 heavy");
    expect(meta?.querySelector(".chip-binary")?.textContent).toBe("1 binary");
    expect(meta?.querySelector(".chip-media")?.textContent).toBe("1 media");
  });
});

describe("diff view next-unviewed-file navigation", () => {
  test("renders an actionable next-unviewed button while files remain unviewed", () => {
    setupDiffDom();
    const { view } = createDiffViewForShellTest();

    view.renderMeta(
      makeMeta([makeFile("a.ts", 1, 0, "/a"), makeFile("b.ts", 1, 0, "/b")]),
    );

    const button = document.querySelector<HTMLButtonElement>(
      "#meta .chip-next-unviewed",
    );
    expect(button?.disabled).toBe(false);
    expect(button?.textContent).toBe("next unviewed");
  });

  test("disables the next-unviewed button once every file is viewed", () => {
    setupDiffDom();
    const { view } = createDiffViewForShellTest();

    view.renderMeta(makeMeta([makeFile("a.ts", 1, 0, "/a")]));
    view.setFileViewed("a.ts", true);

    const button = document.querySelector<HTMLButtonElement>(
      "#meta .chip-next-unviewed",
    );
    expect(button?.disabled).toBe(true);
    expect(button?.textContent).toBe("all viewed");
  });

  test("omits the next-unviewed button when there is nothing to track", () => {
    setupDiffDom();
    const { view } = createDiffViewForShellTest();

    view.renderMeta(makeMeta([]));

    expect(document.querySelector("#meta .chip-next-unviewed")).toBeNull();
  });

  test("scrolls to the next unviewed file after the active one and reveals it in the sidebar", () => {
    setupDiffDom();
    const { view, state, markActiveCalls } = createDiffViewForShellTest();
    state.viewedFiles.add("a.ts");

    installSidebarFileRow("a.ts", { active: true, viewed: true });
    installSidebarFileRow("b.ts");
    installSidebarFileRow("c.ts");

    expect(view.scrollToNextUnviewedFile()).toBe(true);

    expect(markActiveCalls()).toEqual([
      { path: "b.ts", options: { reveal: true } },
    ]);
  });

  test("wraps around to the start once the search reaches the end of the list", () => {
    setupDiffDom();
    const { view, state, markActiveCalls } = createDiffViewForShellTest();
    state.viewedFiles.add("b.ts");

    installSidebarFileRow("a.ts");
    installSidebarFileRow("b.ts", { active: true, viewed: true });

    expect(view.scrollToNextUnviewedFile()).toBe(true);

    expect(markActiveCalls()).toEqual([
      { path: "a.ts", options: { reveal: true } },
    ]);
  });

  test("skips rows hidden by the search filter or the hide-tests toggle", () => {
    setupDiffDom();
    const { view, state } = createDiffViewForShellTest();
    state.viewedFiles.add("a.ts");

    installSidebarFileRow("a.ts", { active: true, viewed: true });
    installSidebarFileRow("a.test.ts", { hiddenByTests: true });
    installSidebarFileRow("filtered-out.ts", { hidden: true });
    installSidebarFileRow("b.ts");

    const path = document.querySelector<HTMLElement>(
      "#filelist li:not(.hidden):not(.hidden-by-tests):not(.active)",
    )?.dataset.path;
    expect(path).toBe("b.ts");
    expect(view.scrollToNextUnviewedFile()).toBe(true);
  });

  test("returns false and leaves the button disabled once every visible file is viewed", () => {
    setupDiffDom();
    const { view, state } = createDiffViewForShellTest();
    state.viewedFiles.add("a.ts");
    state.viewedFiles.add("b.ts");

    installSidebarFileRow("a.ts", { active: true, viewed: true });
    installSidebarFileRow("b.ts", { viewed: true });

    expect(view.scrollToNextUnviewedFile()).toBe(false);
  });

  test("treats a DOM-marked viewed row as viewed even if STATE.viewedFiles disagrees", () => {
    setupDiffDom();
    const { view, markActiveCalls } = createDiffViewForShellTest();
    // Regression: the sidebar row shows .viewed but STATE.viewedFiles was
    // never told about it. The visible DOM state must win so a file the
    // user can see is checked off is never re-offered as "next unviewed".
    installSidebarFileRow("a.ts", { viewed: true });
    installSidebarFileRow("b.ts");

    expect(view.scrollToNextUnviewedFile()).toBe(true);

    expect(markActiveCalls()).toEqual([
      { path: "b.ts", options: { reveal: true } },
    ]);
  });

  test("disables the next-unviewed button once a search filter hides every remaining unviewed row", () => {
    setupDiffDom();
    const { view, state } = createDiffViewForShellTest();
    state.viewedFiles.add("a.ts");

    view.renderMeta(
      makeMeta([makeFile("a.ts", 1, 0, "/a"), makeFile("b.ts", 1, 0, "/b")]),
    );
    installSidebarFileRow("a.ts", { active: true, viewed: true });
    installSidebarFileRow("b.ts", { hidden: true });

    view.applyViewedState();

    const button = document.querySelector<HTMLButtonElement>(
      "#meta .chip-next-unviewed",
    );
    expect(button?.disabled).toBe(true);
    expect(view.scrollToNextUnviewedFile()).toBe(false);
  });

  test("re-enables the next-unviewed button once the filter no longer hides the remaining row", () => {
    setupDiffDom();
    const { view, state } = createDiffViewForShellTest();
    state.viewedFiles.add("a.ts");

    view.renderMeta(
      makeMeta([makeFile("a.ts", 1, 0, "/a"), makeFile("b.ts", 1, 0, "/b")]),
    );
    installSidebarFileRow("a.ts", { active: true, viewed: true });
    installSidebarFileRow("b.ts", { hidden: true });
    view.applyViewedState();
    expect(
      document.querySelector<HTMLButtonElement>("#meta .chip-next-unviewed")
        ?.disabled,
    ).toBe(true);

    document
      .querySelector<HTMLElement>('#filelist li[data-path="b.ts"]')
      ?.classList.remove("hidden");
    view.applyViewedState();

    expect(
      document.querySelector<HTMLButtonElement>("#meta .chip-next-unviewed")
        ?.disabled,
    ).toBe(false);
  });

  test("disables the next-unviewed button after a filter-preserving renderShell refresh hides every row", () => {
    setupDiffDom();
    const { view } = createDiffViewForShellTest();
    const meta = makeMeta([
      makeFile("a.ts", 1, 0, "/a"),
      makeFile("b.ts", 1, 0, "/b"),
    ]);

    // Full path: creates the .gdp-file-shell cards. #filelist rows are
    // built by the real sidebar module in production; stand them in here
    // (skipCard - renderShell() already created the matching cards).
    view.renderShell(meta, null);
    installSidebarFileRow("a.ts", { active: true, skipCard: true });
    installSidebarFileRow("b.ts", { skipCard: true });

    // A live search filter hides every row (mirrors sidebar applyFilter()).
    document
      .querySelectorAll<HTMLElement>("#filelist li[data-path]")
      .forEach((li) => {
        li.classList.add("hidden");
      });

    // Same file list and intact cards, so this refresh takes the fast path
    // inside renderShell(). renderMeta() still runs first and would recreate
    // the button as enabled from raw totals alone.
    view.renderShell(meta, null);

    const button = document.querySelector<HTMLButtonElement>(
      "#meta .chip-next-unviewed",
    );
    expect(button?.disabled).toBe(true);
  });

  test("re-syncs the next-unviewed button when renderMeta re-runs standalone after renderShell (app.ts applyHideTestsToMeta pattern)", () => {
    setupDiffDom();
    const { view } = createDiffViewForShellTest();
    const meta = makeMeta([
      makeFile("a.ts", 1, 0, "/a"),
      makeFile("b.ts", 1, 0, "/b"),
    ]);

    view.renderShell(meta, null);
    installSidebarFileRow("a.ts", { active: true, skipCard: true });
    installSidebarFileRow("b.ts", { skipCard: true });
    document
      .querySelectorAll<HTMLElement>("#filelist li[data-path]")
      .forEach((li) => {
        li.classList.add("hidden");
      });

    // app.ts function applyHideTestsToMeta() calls renderMeta() on its own,
    // outside renderShell, every time load() resolves or hide-tests toggles.
    // That alone cannot see the live sidebar filter, so the button comes
    // back enabled here - this is the bug app.ts must correct afterward.
    view.renderMeta(meta);
    expect(
      document.querySelector<HTMLButtonElement>("#meta .chip-next-unviewed")
        ?.disabled,
    ).toBe(false);

    // app.ts fix: call applyViewedState() right after that standalone
    // renderMeta() call.
    view.applyViewedState();

    expect(
      document.querySelector<HTMLButtonElement>("#meta .chip-next-unviewed")
        ?.disabled,
    ).toBe(true);
  });
});
