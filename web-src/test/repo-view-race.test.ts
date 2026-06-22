import { afterEach, describe, expect, test } from "bun:test";
import type { AppRoute } from "../core/routes";
import type { RepoTreeResponse, SidebarItem } from "../core/types";
import { createRepoView, type RepoViewDeps } from "../views/repo-view";

const range = { from: "HEAD", to: "worktree" };
const diffRoute: AppRoute = { screen: "diff", range };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

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
      selector === "#filelist"
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
  } = {},
) {
  let repoSidebarRef: string | null = options.repoSidebarRef ?? null;
  let repoSidebarDomReady = !!options.repoSidebarDomReady;
  const state: RepoViewDeps["STATE"] = {
    route,
    files: [],
    syntaxHighlight: false,
  };
  const calls = {
    statuses: [] as Array<"live" | "refreshing" | "error" | null>,
    sidebarRenders: [] as SidebarItem[][],
    activePaths: [] as string[],
    headerSyncs: 0,
    projectNames: [] as string[],
  };
  const deps: RepoViewDeps = {
    STATE: state,
    setRoute(nextRoute) {
      state.route = nextRoute;
    },
    setPageMode() {},
    setStatus(status) {
      calls.statuses.push(status);
    },
    setProjectName(project) {
      calls.projectNames.push(project);
    },
    currentRange() {
      return range;
    },
    appendScopeParams() {},
    markActive(path) {
      calls.activePaths.push(path);
    },
    applyFilter() {},
    renderSidebar(files) {
      calls.sidebarRenders.push(files);
    },
    rerenderVirtualSidebar() {},
    ensureVirtualSidebarDirLoaded: async () => {},
    scrollVirtualSidebarPathIntoView() {},
    shouldLazyLoadSidebarDir: () => false,
    setFolderIcon() {},
    isRepositorySidebarMode: () => !!options.repoMode,
    placeSidebarToggle() {},
    createOpenPathButton: () => ({}) as HTMLElement,
    removeStandaloneSource() {},
    renderStandaloneSource: async () => undefined,
    repoFileTargetFromRoute: () =>
      state.route.screen === "file" && state.route.view === "blob"
        ? state.route.ref
        : null,
    trackLoad: (promise) => promise,
    setRepoSidebarRef(ref) {
      repoSidebarRef = ref;
    },
    getSidebarOnFileClick: () =>
      repoSidebarDomReady ? ((() => {}) as unknown) : null,
    syncHeaderMenu() {
      calls.headerSyncs++;
    },
    getSidebarRowByPath: () => undefined,
    getSidebarVirtualActivePath: () => null,
    pushUndo() {},
    getRepoSidebarRef: () => repoSidebarRef,
    getProjectName: () => "code-viewer",
    clearLoadQueue() {},
    syncSidebarHeaderHeight() {},
    $: () => {
      throw new Error("stale repository render touched the DOM");
    },
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
