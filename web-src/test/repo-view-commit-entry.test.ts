import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
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
      | "emptyDirectoryLabel"
      | "sortColumnLabels"
      | "commitEntryMeta"
      | "repositoryWebTarget"
      | "openGithubLabel"
      | "openRepositoryWebLabel"
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
    refreshRepoSidebarTree: async () => undefined,
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
    isAbortError: () => false,
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
    repositoryWebTarget: () => null,
    openGithubLabel: () => "Open on GitHub",
    openRepositoryWebLabel: () => "Open repository web page",
    folderHistoryLabel: () => "",
    folderHistoryTitle: () => "",
    openFolderHistory: () => undefined,
    fileBadge: (status) => {
      const span = document.createElement("span");
      span.className = `badge ${status || "M"}`;
      return span;
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
    // browsable な commit entry (worktree, non-submodule) は通常フォルダ扱いの
    // ままで、非 browsable 用の区別 class / aria-disabled は付かない。
    expect(row?.classList.contains("gdp-repo-row-gitlink")).toBe(false);
    expect(row?.hasAttribute("aria-disabled")).toBe(false);
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
    // 非 browsable な commit 行は、通常のファイル/フォルダ行と混同されないよう
    // 専用 class + aria-disabled で区別される。
    expect(row?.classList.contains("gdp-repo-row-gitlink")).toBe(true);
    expect(row?.getAttribute("aria-disabled")).toBe("true");
    expect(
      row
        ?.querySelector(".d2h-icon-wrapper")
        ?.classList.contains("gdp-repo-row-gitlink-icon"),
    ).toBe(true);
    expect(
      row
        ?.querySelector(".meta")
        ?.classList.contains("gdp-repo-row-gitlink-badge"),
    ).toBe(true);
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
    expect(row?.classList.contains("gdp-repo-row-gitlink")).toBe(true);
    expect(row?.getAttribute("aria-disabled")).toBe("true");
    expect(
      row
        ?.querySelector(".d2h-icon-wrapper")
        ?.classList.contains("gdp-repo-row-gitlink-icon"),
    ).toBe(true);
    expect(
      row
        ?.querySelector(".meta")
        ?.classList.contains("gdp-repo-row-gitlink-badge"),
    ).toBe(true);
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
  test("shows the injected repository web target in the toolbar", async () => {
    setupDom();
    const root: RepoTreeResponse = {
      ref: "worktree",
      path: "src",
      project: "sample-repo",
      entries: [],
    };
    globalThis.fetch = (async () => response(root)) as unknown as typeof fetch;

    const { view } = makeRepoView(
      {
        screen: "repo",
        ref: "worktree",
        path: "src",
        range,
      },
      {
        repositoryWebTarget: () => ({
          url: "https://github.com/example/sample/tree/main/src",
          provider: "github",
        }),
        openGithubLabel: () => "Open on GitHub",
      },
    );

    await view.loadRepo();

    const link = document.querySelector<HTMLAnchorElement>(
      ".gdp-repo-toolbar .gdp-repo-web-link",
    );
    expect(link?.href).toBe("https://github.com/example/sample/tree/main/src");
    expect(link?.textContent).toBe("Open on GitHub");
    expect(link?.target).toBe("_blank");
  });

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

describe("repo view symlink entries", () => {
  test("a symlink-to-file row shows a link icon and its target, and is browsable", async () => {
    setupDom();
    const root: RepoTreeResponse = {
      ref: "worktree",
      path: "",
      project: "sample-repo",
      entries: [
        {
          name: "link-to-file.txt",
          path: "link-to-file.txt",
          type: "blob",
          is_symlink: true,
          symlink_target: "real.txt",
          symlink_target_type: "blob",
        },
      ],
    };
    globalThis.fetch = (async () => response(root)) as unknown as typeof fetch;

    const { view, calls } = makeRepoView({
      screen: "repo",
      ref: "worktree",
      path: "",
      range,
    });

    await view.loadRepo();

    const row = document.querySelector<HTMLElement>(".gdp-repo-row.blob");
    expect(
      row?.querySelector(".d2h-icon-wrapper svg")?.getAttribute("class"),
    ).toBe("octicon octicon-link");
    expect(row?.querySelector(".meta.symlink-target")?.textContent).toBe(
      "→ real.txt",
    );
    expect(row?.hasAttribute("aria-disabled")).toBe(false);

    row?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(calls.standaloneSources).toEqual(["link-to-file.txt"]);
  });

  test("a symlink-to-directory row is browsable like a regular directory", async () => {
    setupDom();
    const root: RepoTreeResponse = {
      ref: "worktree",
      path: "",
      project: "sample-repo",
      entries: [
        {
          name: "link-to-dir",
          path: "link-to-dir",
          type: "tree",
          is_symlink: true,
          symlink_target: "real-dir",
          symlink_target_type: "tree",
        },
      ],
    };
    globalThis.fetch = (async () => response(root)) as unknown as typeof fetch;

    const { view, state } = makeRepoView({
      screen: "repo",
      ref: "worktree",
      path: "",
      range,
    });

    await view.loadRepo();

    const row = document.querySelector<HTMLElement>(".gdp-repo-row.tree");
    expect(row?.querySelector(".meta.symlink-target")?.textContent).toBe(
      "→ real-dir",
    );

    row?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(state.route).toEqual({
      screen: "repo",
      ref: "worktree",
      path: "link-to-dir",
      range,
    });
  });

  test("a committed-ref directory symlink navigates via resolved_path, not its own path", async () => {
    setupDom();
    const root: RepoTreeResponse = {
      ref: "abc1234",
      path: "",
      project: "sample-repo",
      entries: [
        {
          name: "link-to-dir",
          path: "link-to-dir",
          type: "tree",
          is_symlink: true,
          symlink_target: "real-dir",
          symlink_target_type: "tree",
          resolved_path: "real-dir",
        },
      ],
    };
    globalThis.fetch = (async () => response(root)) as unknown as typeof fetch;

    const { view, state } = makeRepoView({
      screen: "repo",
      ref: "abc1234",
      path: "",
      range,
    });

    await view.loadRepo();

    const row = document.querySelector<HTMLElement>(".gdp-repo-row.tree");
    row?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(state.route).toEqual({
      screen: "repo",
      ref: "abc1234",
      path: "real-dir",
      range,
    });
  });

  test("a broken symlink row is disabled and does not navigate on click", async () => {
    setupDom();
    const root: RepoTreeResponse = {
      ref: "worktree",
      path: "",
      project: "sample-repo",
      entries: [
        {
          name: "link-broken.txt",
          path: "link-broken.txt",
          type: "blob",
          is_symlink: true,
          symlink_target: "missing.txt",
          symlink_target_type: "missing",
        },
      ],
    };
    globalThis.fetch = (async () => response(root)) as unknown as typeof fetch;

    const { view, calls } = makeRepoView({
      screen: "repo",
      ref: "worktree",
      path: "",
      range,
    });

    await view.loadRepo();

    const row = document.querySelector<HTMLElement>(".gdp-repo-row.blob");
    expect(row?.classList.contains("symlink-broken-row")).toBe(true);
    expect(row?.getAttribute("aria-disabled")).toBe("true");
    expect(row?.querySelector(".meta.symlink-target.broken")?.textContent).toBe(
      "→ missing.txt",
    );

    row?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(calls.standaloneSources).toEqual([]);
  });

  test("a pending git change badge wins over the symlink icon", async () => {
    setupDom();
    const root: RepoTreeResponse = {
      ref: "worktree",
      path: "",
      project: "sample-repo",
      entries: [
        {
          name: "link-to-file.txt",
          path: "link-to-file.txt",
          type: "blob",
          status: "M",
          is_symlink: true,
          symlink_target: "real.txt",
          symlink_target_type: "blob",
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

    const row = document.querySelector<HTMLElement>(".gdp-repo-row.blob");
    expect(row?.querySelector(".badge.M")).toBeTruthy();
    expect(row?.querySelector(".d2h-icon-wrapper")).toBeNull();
    expect(row?.querySelector(".meta.symlink-target")?.textContent).toBe(
      "→ real.txt",
    );
  });
});

describe("repo view deleted entries", () => {
  test("a deleted-but-uncommitted entry (status D) is disabled and does not navigate on click", async () => {
    setupDom();
    const root: RepoTreeResponse = {
      ref: "worktree",
      path: "",
      project: "sample-repo",
      entries: [
        {
          name: "gone.txt",
          path: "gone.txt",
          type: "blob",
          status: "D",
        },
      ],
    };
    globalThis.fetch = (async () => response(root)) as unknown as typeof fetch;

    const { view, calls } = makeRepoView({
      screen: "repo",
      ref: "worktree",
      path: "",
      range,
    });

    await view.loadRepo();

    const row = document.querySelector<HTMLElement>(".gdp-repo-row.blob");
    expect(row?.classList.contains("gdp-row-disabled")).toBe(true);
    expect(row?.getAttribute("aria-disabled")).toBe("true");
    expect(row?.querySelector(".badge.D")).toBeTruthy();

    row?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(calls.standaloneSources).toEqual([]);
  });
});

describe("repo view re-render suppression", () => {
  function rootResponse(updatedAt: string): RepoTreeResponse {
    return {
      ref: "worktree",
      path: "",
      project: "sample-repo",
      entries: [
        {
          name: "sample.txt",
          path: "sample.txt",
          type: "blob",
          updated_at: updatedAt,
        },
      ],
    };
  }

  test("keeps the rendered panel DOM when a reload returns identical content", async () => {
    setupDom();
    globalThis.fetch = (async () =>
      response(rootResponse("2026-07-01"))) as unknown as typeof fetch;
    const { view } = makeRepoView({
      screen: "repo",
      ref: "worktree",
      path: "",
      range,
    });

    await view.loadRepo();
    const firstShell = document.querySelector("#diff > .gdp-repo-shell");
    expect(firstShell).not.toBeNull();

    // SSE 起因の再読込で内容が同じなら、一覧を作り直さず同じ DOM を保つ
    // (作り直すと画面がガクつき、フォーカスやソート操作も失われる)。
    await view.loadRepo();
    const secondShell = document.querySelector("#diff > .gdp-repo-shell");
    expect(secondShell).toBe(firstShell as Element);
  });

  test("rebuilds the panel in one swap when the tree content changes", async () => {
    setupDom();
    // メイン fetch とサイドバー fetch の両方が同じモックを消費するため、
    // 応答は配列消費ではなく「その時点の応答」を丸ごと差し替えて切り替える。
    globalThis.fetch = (async () =>
      response(rootResponse("2026-07-01"))) as unknown as typeof fetch;
    const { view } = makeRepoView({
      screen: "repo",
      ref: "worktree",
      path: "",
      range,
    });

    await view.loadRepo();
    const firstShell = document.querySelector("#diff > .gdp-repo-shell");

    globalThis.fetch = (async () =>
      response(rootResponse("2026-07-02"))) as unknown as typeof fetch;
    await view.loadRepo();
    const secondShell = document.querySelector("#diff > .gdp-repo-shell");
    expect(secondShell).not.toBeNull();
    expect(secondShell).not.toBe(firstShell as Element);
    // 差し替え後も一覧は 1 つだけ (先に消してから作る白抜け方式ではない)。
    expect(document.querySelectorAll("#diff > .gdp-repo-shell").length).toBe(1);
  });
});
