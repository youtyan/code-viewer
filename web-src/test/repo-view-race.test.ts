import { afterEach, describe, expect, test, vi } from "vitest";
import type { AppRoute } from "../core/routes";
import type { RepoTreeResponse, SidebarItem } from "../core/types";
import { createRepoView, type RepoViewDeps } from "../views/repo-view";
import { deferred } from "./_test-helpers";

const range = { from: "HEAD", to: "worktree" };
const diffRoute: AppRoute = { screen: "diff", range };

function treeResponse(path = "README.md"): RepoTreeResponse {
  return {
    ref: "worktree",
    path: "",
    project: "code-viewer",
    entries: [{ name: path.split("/").pop() || path, path, type: "blob" }],
  };
}

function jsonResponse(data: RepoTreeResponse) {
  return {
    ok: true,
    json: async () => data,
  } as Response;
}

const originalFetch = globalThis.fetch;
const originalDocument = globalThis.document;

afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.document = originalDocument;
});

function installNullDocument() {
  globalThis.document = {
    querySelector: () => null,
  } as unknown as Document;
}

function installFilelistDocument(hasEntries: () => boolean) {
  globalThis.document = {
    querySelector: (selector: string) =>
      selector === "#file-list-rows"
        ? ({
            querySelector: () => (hasEntries() ? ({} as Element) : null),
          } as unknown as HTMLElement)
        : null,
  } as unknown as Document;
}

function makeRepoView(
  route: AppRoute,
  options: {
    repoMode?: boolean;
    repoSidebarRef?: string | null;
    repoSidebarDomReady?: boolean;
    polluteSidebarAfterRender?: boolean;
    sidebarRows?: Record<string, { kind: "dir"; dir: { path: string } }>;
    /** `$` が返す要素 (指定した selector だけ)。ほかは今までどおり投げる。 */
    elements?: Record<string, HTMLElement>;
    lazyDirPaths?: Set<string>;
    lazyLoadChildren?: Record<string, string[]>;
    /** Files とファイルの画面の外でファイル一覧に出す ref (app.ts は常に出す)。 */
    filesColumnRef?: string | null;
  } = {},
) {
  let repoSidebarRef: string | null = options.repoSidebarRef ?? null;
  let repoSidebarDomReady = !!options.repoSidebarDomReady;
  const sidebarRows = options.sidebarRows ?? {};
  const state: RepoViewDeps["STATE"] = {
    route,
    files: [],
    syntaxHighlight: false,
    language: "en",
  };
  const calls = {
    statuses: [] as Array<"live" | "refreshing" | "error" | null>,
    sidebarRenders: [] as SidebarItem[][],
    activePaths: [] as string[],
    headerSyncs: 0,
    projectNames: [] as string[],
    lazyLoads: [] as string[],
    virtualRenders: 0,
  };
  const deps: RepoViewDeps = {
    STATE: state,
    openTreeFileAs() {
      /* noop */
    },
    setRoute(nextRoute) {
      state.route = nextRoute;
    },
    setPageMode() {
      /* noop */
    },
    setStatus(status) {
      calls.statuses.push(status);
    },
    setProjectName(project) {
      calls.projectNames.push(project);
    },
    currentRange() {
      return range;
    },
    appendScopeParams() {
      /* noop */
    },
    markActive(path) {
      calls.activePaths.push(path);
    },
    applyFilter() {
      /* noop */
    },
    renderSidebar(files) {
      calls.sidebarRenders.push(files);
    },
    refreshRepoSidebarTree: async () => undefined,
    rerenderVirtualSidebar() {
      calls.virtualRenders++;
    },
    ensureVirtualSidebarDirLoaded: async (dir: unknown) => {
      const path = (dir as { path?: string })?.path || "";
      calls.lazyLoads.push(path);
      options.lazyDirPaths?.delete(path);
      for (const child of options.lazyLoadChildren?.[path] || []) {
        sidebarRows[child] = { kind: "dir", dir: { path: child } };
      }
    },
    scrollVirtualSidebarPathIntoView() {
      /* noop */
    },
    shouldLazyLoadSidebarDir: (dir: unknown) =>
      options.lazyDirPaths?.has((dir as { path?: string })?.path || "") ??
      false,
    setFolderIcon() {
      /* noop */
    },
    isRepositorySidebarMode: () => !!options.repoMode,
    placeSidebarToggle() {
      /* noop */
    },
    createOpenPathButton: () => ({}) as HTMLElement,
    removeStandaloneSource() {
      /* noop */
    },
    renderStandaloneSource: async () => undefined,
    filesColumnRef: () => options.filesColumnRef ?? null,
    repoFileTargetFromRoute: () =>
      state.route.screen === "file" && state.route.view === "blob"
        ? state.route.ref
        : null,
    trackLoad: (promise) => promise,
    isAbortError: () => false,
    setRepoSidebarRef(ref) {
      repoSidebarRef = ref;
    },
    getSidebarOnFileClick: () =>
      repoSidebarDomReady ? ((() => undefined) as unknown) : null,
    syncHeaderMenu() {
      calls.headerSyncs++;
    },
    getSidebarRowByPath: (path) => sidebarRows[path],
    getSidebarVirtualActivePath: () => null,
    pushUndo() {
      /* noop */
    },
    getRepoSidebarRef: () => repoSidebarRef,
    getProjectName: () => "code-viewer",
    clearLoadQueue() {
      /* noop */
    },
    syncSidebarHeaderHeight() {
      /* noop */
    },
    newFolderButtonTitle: () => "new folder",
    openDirectoryInOsTitle: () => "open this folder in OS",
    moveFolderToTrashTitle: () => "move folder to Trash",
    uploadButtonLabel: () => "Upload files",
    dropFilesIntoCopy: (target) => `Drop files into ${target}`,
    uploadFailedMessage: () => "Upload failed",
    emptyDirectoryLabel: () => "No files in this directory.",
    uploadConfirmText: (count, target) => ({
      title: "Upload files?",
      body: `Upload ${count} file(s) into ${target}?`,
      confirmLabel: "Upload",
    }),
    sortColumnLabels: () => ({
      name: "Name",
      updated: "Updated",
      committed: "Last committed",
      committedHint: "Last commit at the selected revision",
      updatedHint: "Local filesystem time",
      noCommit: "No commit history",
      filterPlaceholder: "Filter this folder…",
      clearFilter: "Clear filter",
      noMatches: "No matches",
      entryCount: (visible, total) => `${visible} / ${total} items`,
      size: "Size",
    }),
    repositoryFallback: () => "repository",
    repositoryRootFallback: () => "repository root",
    commitEntryMeta: (submodule) =>
      submodule
        ? {
            label: "submodule",
            title: "Git submodule pinned to a commit",
          }
        : {
            label: "gitlink",
            title: "Git commit entry is not directly browsable at this ref",
          },
    repositoryWebTarget: () => null,
    openGithubLabel: () => "Open on GitHub",
    openRepositoryWebLabel: () => "Open repository web page",
    folderHistoryLabel: () => "",
    folderHistoryTitle: () => "",
    openFolderHistory: () => undefined,
    fileBadge: () => {
      throw new Error("stale repository render touched the DOM");
    },
    $: ((selector: string) => {
      const element = options.elements?.[selector];
      if (element) return element;
      throw new Error("stale repository render touched the DOM");
    }) as RepoViewDeps["$"],
  };
  return {
    view: createRepoView({
      ...deps,
      renderSidebar(files, onFileClick) {
        calls.sidebarRenders.push(files);
        repoSidebarDomReady = !!onFileClick;
        if (options.polluteSidebarAfterRender) repoSidebarDomReady = false;
      },
    }),
    state,
    calls,
  };
}

describe("repo view route races", () => {
  test("loadRepo drops a tree response when the route leaves repo before fetch resolves", async () => {
    const pending = deferred<Response>();
    globalThis.fetch = (() => pending.promise) as unknown as typeof fetch;
    const { view, state, calls } = makeRepoView({
      screen: "repo",
      ref: "worktree",
      path: "",
      range,
    });

    const load = view.loadRepo();
    state.route = diffRoute;
    pending.resolve(jsonResponse(treeResponse()));
    await load;

    expect(calls.statuses).toEqual(["refreshing"]);
    expect(calls.projectNames).toEqual([]);
    expect(calls.headerSyncs).toBe(0);
  });

  test("renderRepoBlobSidebar drops in-flight sidebar work after leaving blob view", async () => {
    installNullDocument();
    const pending = deferred<Response>();
    globalThis.fetch = (() => pending.promise) as unknown as typeof fetch;
    const { view, state, calls } = makeRepoView({
      screen: "file",
      path: "README.md",
      ref: "worktree",
      view: "blob",
      range,
    });

    const firstLoad = view.renderRepoBlobSidebar("README.md", "worktree");
    const sharedLoad = view.renderRepoBlobSidebar("src/index.ts", "worktree");
    state.route = diffRoute;
    pending.resolve(jsonResponse(treeResponse()));
    await Promise.all([firstLoad, sharedLoad]);

    expect(calls.sidebarRenders).toEqual([]);
    expect(calls.activePaths).toEqual([]);
  });

  test("renderRepoBlobSidebar loads a direct tree instead of recursive worktree data", async () => {
    installNullDocument();
    const urls: string[] = [];
    globalThis.fetch = ((input: RequestInfo | URL) => {
      urls.push(String(input));
      return Promise.resolve(jsonResponse(treeResponse("src")));
    }) as unknown as typeof fetch;
    const { view } = makeRepoView({
      screen: "file",
      path: "src/index.ts",
      ref: "worktree",
      view: "blob",
      range,
    });

    await view.renderRepoBlobSidebar("src/index.ts", "worktree");

    expect(urls).toHaveLength(1);
    const url = new URL(urls[0], "http://localhost");
    expect(url.pathname).toBe("/_tree");
    expect(url.searchParams.get("ref")).toBe("worktree");
    expect(url.searchParams.has("recursive")).toBe(false);
  });

  test("renderRepoBlobSidebar lazy-loads current file ancestors with one rerender", async () => {
    installNullDocument();
    globalThis.fetch = (() =>
      Promise.resolve(
        jsonResponse({
          ...treeResponse("src"),
          entries: [{ name: "src", path: "src", type: "tree" }],
        }),
      )) as unknown as typeof fetch;
    const lazyDirPaths = new Set(["src", "src/lib", "src/lib/deep"]);
    const { view, calls } = makeRepoView(
      {
        screen: "file",
        path: "src/lib/deep/index.ts",
        ref: "worktree",
        view: "blob",
        range,
      },
      {
        sidebarRows: { src: { kind: "dir", dir: { path: "src" } } },
        lazyDirPaths,
        lazyLoadChildren: {
          src: ["src/lib"],
          "src/lib": ["src/lib/deep"],
        },
      },
    );

    await view.renderRepoBlobSidebar("src/lib/deep/index.ts", "worktree");

    expect(calls.sidebarRenders[0].map((file) => file.path)).toEqual(["src"]);
    expect(calls.lazyLoads).toEqual(["src", "src/lib", "src/lib/deep"]);
    expect(calls.virtualRenders).toBe(1);
    expect(calls.activePaths.includes("src/lib/deep/index.ts")).toBe(true);
  });

  test("renderRepoBlobSidebar does not reuse a matching ref when the sidebar is no longer repo-rendered", async () => {
    installFilelistDocument(() => true);
    let fetches = 0;
    globalThis.fetch = (() => {
      fetches++;
      return Promise.resolve(jsonResponse(treeResponse("src/repo.ts")));
    }) as unknown as typeof fetch;
    const { view, calls } = makeRepoView(
      {
        screen: "repo",
        ref: "worktree",
        path: "",
        range,
      },
      {
        repoMode: true,
        repoSidebarRef: "worktree",
        repoSidebarDomReady: false,
      },
    );

    await view.renderRepoBlobSidebar("", "worktree");

    expect(fetches).toBe(1);
    expect(calls.sidebarRenders).toHaveLength(1);
    expect(calls.sidebarRenders[0].map((file) => file.path)).toEqual([
      "src/repo.ts",
    ]);
  });

  test("renderRepoBlobSidebar refreshes after a shared pending load leaves polluted sidebar state", async () => {
    installFilelistDocument(() => true);
    const pending = deferred<Response>();
    let fetches = 0;
    globalThis.fetch = (() => {
      fetches++;
      return fetches === 1
        ? pending.promise
        : Promise.resolve(jsonResponse(treeResponse("src/fresh.ts")));
    }) as unknown as typeof fetch;
    const { view, calls } = makeRepoView(
      {
        screen: "repo",
        ref: "worktree",
        path: "",
        range,
      },
      { repoMode: true, polluteSidebarAfterRender: true },
    );

    const firstLoad = view.renderRepoBlobSidebar("", "worktree");
    const sharedLoad = view.renderRepoBlobSidebar("src/fresh.ts", "worktree");
    pending.resolve(jsonResponse(treeResponse("src/stale.ts")));
    await Promise.all([firstLoad, sharedLoad]);

    expect(fetches).toBe(2);
    expect(calls.sidebarRenders.map((files) => files[0]?.path)).toEqual([
      "src/stale.ts",
      "src/fresh.ts",
    ]);
  });
});

// ファイル一覧はどの画面でも出す (Diff・History なども)。その画面へ移るたびに
// app.ts が ensureFileList を呼ぶ。
describe("the file list on screens other than Files", () => {
  test.each([
    {
      name: "already loaded for the ref",
      loaded: true,
      fetches: 0,
      renders: 0,
    },
    { name: "not loaded yet", loaded: false, fetches: 1, renders: 1 },
  ])("$name: fetches $fetches, renders $renders", async ({
    loaded,
    fetches,
    renders,
  }) => {
    installFilelistDocument(() => loaded);
    const urls: string[] = [];
    globalThis.fetch = ((input: RequestInfo | URL) => {
      urls.push(String(input));
      return Promise.resolve(jsonResponse(treeResponse()));
    }) as unknown as typeof fetch;
    const { view, calls } = makeRepoView(diffRoute, {
      repoMode: true,
      repoSidebarRef: loaded ? "worktree" : null,
      repoSidebarDomReady: loaded,
      filesColumnRef: "worktree",
    });

    await view.ensureFileList("worktree");

    expect({
      fetches: urls.length,
      renders: calls.sidebarRenders.length,
      // 読み込み済みなら選んでいる行を付け直さない (スクロールも動かさない)。
      marked: loaded ? calls.activePaths : [],
    }).toEqual({ fetches, renders, marked: [] });
  });
});

describe("repo sidebar refresh failures", () => {
  // 直す前は catch が引数を受け取らず、console にも画面にも理由が残らなかった
  // (同じファイルのほかの 3 か所は理由を出していた)。
  test("木の読み込みに失敗したら、理由を console とファイル一覧の件数 (#file-list-totals) の title に出す", async () => {
    installNullDocument();
    const totals = {
      textContent: "",
      title: "",
      removeAttribute(name: string) {
        if (name === "title") this.title = "";
      },
    };
    globalThis.fetch = (async () =>
      new Response("tree read failed: sample cause", {
        status: 500,
        statusText: "Internal Server Error",
      })) as typeof fetch;
    const errors = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const { view } = makeRepoView(
      {
        screen: "file",
        path: "README.md",
        ref: "worktree",
        view: "blob",
        range,
      },
      { elements: { "#file-list-totals": totals as unknown as HTMLElement } },
    );

    await view.renderRepoBlobSidebar("README.md", "worktree");

    expect(totals.textContent).toBe("Cannot load tree");
    expect(totals.title).toContain(
      "load repository tree (HTTP 500 Internal Server Error): tree read failed: sample cause",
    );
    expect(errors).toHaveBeenCalledTimes(1);
    const [message, ref, error] = errors.mock.calls[0];
    expect([message, ref, (error as Error).message]).toEqual([
      "[code-viewer] repository tree load failed",
      "worktree",
      "load repository tree (HTTP 500 Internal Server Error): tree read failed: sample cause",
    ]);
    errors.mockRestore();
  });

  test("keeps the tree and logs the HTTP status and body of a failed refresh", async () => {
    installFilelistDocument(() => true);
    globalThis.fetch = (async () =>
      new Response("tree read failed: sample cause", {
        status: 500,
        statusText: "Internal Server Error",
      })) as typeof fetch;
    const errors = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const { view, calls } = makeRepoView(
      { screen: "repo", ref: "worktree", path: "", range },
      { repoMode: true, repoSidebarRef: "worktree", repoSidebarDomReady: true },
    );

    await view.refreshRepoSidebar();

    expect(calls.sidebarRenders).toEqual([]);
    expect(errors).toHaveBeenCalledTimes(1);
    const [message, ref, error] = errors.mock.calls[0];
    expect([message, ref, (error as Error).message]).toEqual([
      "[code-viewer] repository sidebar refresh failed",
      "worktree",
      "refresh repository tree (HTTP 500 Internal Server Error): tree read failed: sample cause",
    ]);
    errors.mockRestore();
  });
});

// 1 回のファイルの表示で、見出しの情報・表示の種類の判定・変化の検知が同じ
// HEAD /_file を同時に 3 本出していた。同時の要求は 1 本にまとめ、終わったら
// 次は取り直す。
describe("file details (HEAD /_file)", () => {
  test("同じファイルへの同時の要求は 1 本にまとめ、終わった後は取り直す", async () => {
    installNullDocument();
    const { view } = makeRepoView(diffRoute);
    const gate = deferred<Response>();
    const requests: string[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init) => {
      requests.push(`${init?.method ?? "GET"} ${String(input)}`);
      return gate.promise;
    }) as typeof fetch;
    const target = { path: "src/sample.ts", ref: "worktree" };
    const pending = [
      view.loadRawFileInfo(target),
      view.loadRawFileInfo(target),
      view.loadRawFileInfo({ path: "src/other.ts", ref: "worktree" }),
    ];
    gate.resolve(
      new Response(null, {
        status: 200,
        headers: { "content-length": "12" },
      }),
    );
    const [first, second] = await Promise.all(pending);
    expect([requests.length, first, second]).toEqual([
      2,
      {
        size: 12,
        type: undefined,
        created_at: undefined,
        updated_at: undefined,
        commit_updated_at: undefined,
      },
      {
        size: 12,
        type: undefined,
        created_at: undefined,
        updated_at: undefined,
        commit_updated_at: undefined,
      },
    ]);
    await view.loadRawFileInfo(target);
    expect(requests.length).toBe(3);
  });
});
