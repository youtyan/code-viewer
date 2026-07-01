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
import type { RepoTreeResponse, SidebarItem } from "../core/types";
import { createRepoView, type RepoViewDeps } from "../views/repo-view";

const range = { from: "HEAD", to: "worktree" };

const originalFetch = globalThis.fetch;

beforeAll(() => {
  GlobalRegistrator.register();
});

afterAll(() => {
  GlobalRegistrator.unregister();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  document.body.innerHTML = "";
});

function response(data: RepoTreeResponse): Response {
  return {
    ok: true,
    json: async () => data,
  } as Response;
}

function setupDom() {
  document.body.innerHTML = `
    <div id="empty"></div>
    <div id="totals"></div>
    <div id="diff"></div>
    <ul id="filelist"></ul>
  `;
}

function makeRepoView(
  route: AppRoute,
  overrides: Partial<
    Pick<
      RepoViewDeps,
      "emptyDirectoryLabel" | "sortColumnLabels" | "commitEntryMeta"
    >
  > = {},
) {
  const state: RepoViewDeps["STATE"] = {
    route,
    files: [],
    syntaxHighlight: false,
  };
  const calls = {
    renderedFiles: [] as SidebarItem[][],
    standaloneSources: [] as string[],
  };
  const view = createRepoView({
    STATE: state,
    setRoute(nextRoute) {
      state.route = nextRoute;
    },
    setPageMode() {
      /* noop */
    },
    setStatus() {
      /* noop */
    },
    setProjectName() {
      /* noop */
    },
    currentRange: () => range,
    appendScopeParams() {
      /* noop */
    },
    markActive() {
      /* noop */
    },
    applyFilter() {
      /* noop */
    },
    renderSidebar(files) {
      calls.renderedFiles.push(files);
    },
    rerenderVirtualSidebar() {
      /* noop */
    },
    ensureVirtualSidebarDirLoaded: async () => undefined,
    scrollVirtualSidebarPathIntoView() {
      /* noop */
    },
    shouldLazyLoadSidebarDir: () => false,
    setFolderIcon(el) {
      el.textContent = "folder";
    },
    isRepositorySidebarMode: () => true,
    placeSidebarToggle() {
      /* noop */
    },
    createOpenPathButton: () => document.createElement("button"),
    removeStandaloneSource() {
      /* noop */
    },
    renderStandaloneSource: async (target) => {
      calls.standaloneSources.push(target.path);
    },
    repoFileTargetFromRoute: () => null,
    trackLoad: (promise) => promise,
    setRepoSidebarRef() {
      /* noop */
    },
    getSidebarOnFileClick: () => () => undefined,
    syncHeaderMenu() {
      /* noop */
    },
    getSidebarRowByPath: () => undefined,
    getSidebarVirtualActivePath: () => null,
    pushUndo() {
      /* noop */
    },
    getRepoSidebarRef: () => "worktree",
    getProjectName: () => "sample-repo",
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
    $: <T extends Element = HTMLElement>(selector: string): T => {
      const element = document.querySelector<T>(selector);
      if (!element) throw new Error(`missing ${selector}`);
      return element;
    },
    ...overrides,
  });
  return { view, state, calls };
}

describe("repo view commit entries", () => {
  test("opens a worktree commit entry as a browsable directory", async () => {
    setupDom();
    const root: RepoTreeResponse = {
      ref: "worktree",
      path: "",
      project: "sample-repo",
      entries: [
        {
          name: "nested-repo",
          path: "nested-repo",
          type: "commit",
        },
      ],
    };
    const nested: RepoTreeResponse = {
      ref: "worktree",
      path: "nested-repo",
      project: "sample-repo",
      entries: [],
    };
    const responses = [root, root, nested];
    globalThis.fetch = (async () =>
      response(responses.shift() ?? nested)) as unknown as typeof fetch;

    const { view, state, calls } = makeRepoView({
      screen: "repo",
      ref: "worktree",
      path: "",
      range,
    });

    await view.loadRepo();

    const row = document.querySelector<HTMLButtonElement>(
      ".gdp-repo-row.commit",
    );
    expect(row?.querySelector(".dir-icon")?.textContent).toBe("folder");
    expect(row?.querySelector(".d2h-icon-wrapper")).toBeNull();
    expect(calls.renderedFiles[calls.renderedFiles.length - 1]?.[0]?.type).toBe(
      "tree",
    );

    row?.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
    );
    expect(document.querySelector(".gdp-context-menu")).toBeNull();

    row?.click();

    expect(state.route).toEqual({
      screen: "repo",
      ref: "worktree",
      path: "nested-repo",
      range,
    });
    expect(calls.standaloneSources).toEqual([]);
  });

  test("does not open a worktree submodule commit entry as a directory", async () => {
    setupDom();
    const root: RepoTreeResponse = {
      ref: "worktree",
      path: "",
      project: "sample-repo",
      entries: [
        {
          name: "nested-repo",
          path: "nested-repo",
          type: "commit",
          submodule: true,
        },
      ],
    };
    globalThis.fetch = (async () => response(root)) as unknown as typeof fetch;

    const initialRoute: AppRoute = {
      screen: "repo",
      ref: "worktree",
      path: "",
      range,
    };
    const { view, state, calls } = makeRepoView(initialRoute);

    await view.loadRepo();

    const row = document.querySelector<HTMLButtonElement>(
      ".gdp-repo-row.commit",
    );
    expect(row?.querySelector(".dir-icon")).toBeNull();
    expect(row?.querySelector(".d2h-icon-wrapper")).toBeTruthy();
    expect(row?.querySelector(".octicon-git-branch")).toBeTruthy();
    expect(row?.querySelector(".octicon-file")).toBeNull();
    expect(row?.title).toBe("Git submodule pinned to a commit");
    expect(row?.querySelector(".meta")?.textContent).toBe("submodule");
    expect(calls.renderedFiles[calls.renderedFiles.length - 1]?.[0]?.type).toBe(
      "commit",
    );
    expect(
      calls.renderedFiles[calls.renderedFiles.length - 1]?.[0]?.submodule,
    ).toBe(true);

    row?.click();

    expect(state.route).toEqual(initialRoute);
    expect(calls.standaloneSources).toEqual([]);
  });

  test("does not open a non-worktree commit entry as a directory", async () => {
    setupDom();
    const root: RepoTreeResponse = {
      ref: "HEAD",
      path: "",
      project: "sample-repo",
      entries: [
        {
          name: "nested-repo",
          path: "nested-repo",
          type: "commit",
        },
      ],
    };
    globalThis.fetch = (async () => response(root)) as unknown as typeof fetch;

    const initialRoute: AppRoute = {
      screen: "repo",
      ref: "HEAD",
      path: "",
      range,
    };
    const { view, state, calls } = makeRepoView(initialRoute);

    await view.loadRepo();

    const row = document.querySelector<HTMLButtonElement>(
      ".gdp-repo-row.commit",
    );
    expect(row?.querySelector(".dir-icon")).toBeNull();
    expect(row?.querySelector(".d2h-icon-wrapper")).toBeTruthy();
    expect(row?.querySelector(".octicon-git-branch")).toBeTruthy();
    expect(row?.querySelector(".octicon-file")).toBeNull();
    expect(row?.title).toBe(
      "Git commit entry is not directly browsable at this ref",
    );
    expect(row?.querySelector(".meta")?.textContent).toBe("gitlink");
    const latestSidebarFiles =
      calls.renderedFiles[calls.renderedFiles.length - 1] || [];
    expect(latestSidebarFiles[0]?.type).toBe("commit");

    row?.click();

    expect(state.route).toEqual(initialRoute);
    expect(calls.standaloneSources).toEqual([]);
  });

  test("shows an updated date for a browsable worktree commit entry", async () => {
    setupDom();
    const root: RepoTreeResponse = {
      ref: "worktree",
      path: "",
      project: "sample-repo",
      entries: [
        {
          name: "nested-repo",
          path: "nested-repo",
          type: "commit",
          updated_at: "2026-06-01T00:00:00.000Z",
        },
      ],
    };
    globalThis.fetch = (async () => response(root)) as unknown as typeof fetch;

    const { view } = makeRepoView({
      screen: "repo",
      ref: "worktree",
      path: "",
      range,
    });

    await view.loadRepo();

    const meta = document.querySelector<HTMLElement>(
      ".gdp-repo-row.commit .meta",
    );
    expect(meta?.textContent === "-" || !meta?.textContent).toBe(false);
  });

  test("labels a worktree submodule commit entry", async () => {
    setupDom();
    const root: RepoTreeResponse = {
      ref: "worktree",
      path: "",
      project: "sample-repo",
      entries: [
        {
          name: "nested-repo",
          path: "nested-repo",
          type: "commit",
          submodule: true,
        },
      ],
    };
    globalThis.fetch = (async () => response(root)) as unknown as typeof fetch;

    const { view } = makeRepoView({
      screen: "repo",
      ref: "worktree",
      path: "",
      range,
    });

    await view.loadRepo();

    const meta = document.querySelector<HTMLElement>(
      ".gdp-repo-row.commit .meta",
    );
    expect(meta?.textContent).toBe("submodule");
    expect(meta?.title).toBe("Git submodule pinned to a commit");
  });
});

describe("repo view localized labels", () => {
  test("sort headers and the empty-directory message use injected labels", async () => {
    setupDom();
    const root: RepoTreeResponse = {
      ref: "worktree",
      path: "",
      project: "sample-repo",
      entries: [],
    };
    globalThis.fetch = (async () => response(root)) as unknown as typeof fetch;

    const { view } = makeRepoView(
      {
        screen: "repo",
        ref: "worktree",
        path: "",
        range,
      },
      {
        sortColumnLabels: () => ({
          name: "サンプル名前",
          updated: "サンプル更新日時",
          size: "サンプルサイズ",
        }),
        emptyDirectoryLabel: () => "サンプル空ディレクトリ",
      },
    );

    await view.loadRepo();

    expect(
      document.querySelector('[data-repo-sort="updated"]')?.textContent,
    ).toBe("サンプル更新日時");
    expect(document.querySelector('[data-repo-sort="size"]')?.textContent).toBe(
      "サンプルサイズ",
    );
    expect(document.querySelector(".gdp-repo-empty")?.textContent).toBe(
      "サンプル空ディレクトリ",
    );
  });

  test("commit entry metadata uses injected labels", async () => {
    setupDom();
    const root: RepoTreeResponse = {
      ref: "HEAD",
      path: "",
      project: "sample-repo",
      entries: [
        {
          name: "nested-repo",
          path: "nested-repo",
          type: "commit",
        },
      ],
    };
    globalThis.fetch = (async () => response(root)) as unknown as typeof fetch;

    const { view } = makeRepoView(
      {
        screen: "repo",
        ref: "HEAD",
        path: "",
        range,
      },
      {
        commitEntryMeta: () => ({
          label: "固定コミット",
          title: "サンプル固定コミット説明",
        }),
      },
    );

    await view.loadRepo();

    const row = document.querySelector<HTMLElement>(".gdp-repo-row.commit");
    const meta = row?.querySelector<HTMLElement>(".meta");
    expect(row?.title).toBe("サンプル固定コミット説明");
    expect(meta?.textContent).toBe("固定コミット");
    expect(meta?.title).toBe("サンプル固定コミット説明");
  });
});
