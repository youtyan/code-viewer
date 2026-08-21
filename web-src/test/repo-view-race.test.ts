import { afterEach, describe, expect, test } from "vitest";
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
    sidebarRows?: Record<string, { kind: "dir"; dir: { path: string } }>;
    lazyDirPaths?: Set<string>;
    lazyLoadChildren?: Record<string, string[]>;
  } = {},
) {
  let repoSidebarRef: string | null = options.repoSidebarRef ?? null;
  let repoSidebarDomReady = !!options.repoSidebarDomReady;
  const sidebarRows = options.sidebarRows ?? {};
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
    lazyLoads: [] as string[],
    virtualRenders: 0,
  };
  const deps: RepoViewDeps = {
    STATE: state,
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
