import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import { createSidebar, type SidebarDeps } from "../views/sidebar";

beforeAll(() => {
  GlobalRegistrator.register();
});

afterAll(() => {
  GlobalRegistrator.unregister();
});

afterEach(() => {
  document.body.innerHTML = "";
});

function installSidebarDom() {
  document.body.innerHTML = `
    <aside id="sidebar">
      <div class="sb-head">
        <span class="sb-title">Files</span>
        <span id="totals"></span>
        <div id="repo-target-wrap" data-ref-selector>
          <input id="repo-target" value="worktree" />
        </div>
        <div class="sb-actions" role="group">
          <button id="sb-expand-all" class="sb-tree-action"></button>
          <button id="sb-collapse-all" class="sb-tree-action"></button>
        </div>
        <div class="seg sb-view-seg">
          <button data-view="tree"></button>
          <button data-view="flat"></button>
        </div>
      </div>
      <div class="sb-filter-wrap">
        <input id="sb-filter" value="" />
        <button id="sb-filter-clear" type="button" hidden>Clear</button>
      </div>
      <ul id="filelist"></ul>
    </aside>
  `;
}

function createSidebarForTest() {
  const state = {
    sbView: "tree" as const,
    sbWidth: 280,
    sidebarHidden: false,
    collapsedDirs: new Set<string>(),
    files: [],
    activeFile: null,
    hideTests: false,
    viewedFiles: new Set<string>(),
    lazyExpandedDirs: new Set<string>(),
  };
  return createSidebar({
    STATE: state,
    scrollToFile() {
      /* noop */
    },
    prefetchByPath() {
      /* noop */
    },
    fileBadge(status) {
      const badge = document.createElement("span");
      badge.className = `badge ${status || "M"}`;
      badge.textContent = status || "";
      return badge;
    },
    fileEntryIcon: () => '<svg class="octicon-file"></svg>',
    applyViewedState() {
      /* noop */
    },
    persistCollapsedDirs() {
      /* noop */
    },
    persistLazyExpandedDirs() {
      /* noop */
    },
    appendScopeParams() {
      /* noop */
    },
    createOpenPathButton() {
      return document.createElement("button");
    },
    normalizeViewerFontSize: () => "regular",
    getSidebarFontSize: () => "regular",
    persistSidebarHidden() {
      /* noop */
    },
    persistSidebarWidth() {
      /* noop */
    },
    scheduleMainSurfaceFocus() {
      /* noop */
    },
    setChevronIcon(el) {
      el.textContent = ">";
    },
    trackLoad: (promise) => promise,
    getRepoSidebarRef: () => null,
    setRepoSidebarRef() {
      /* noop */
    },
    isTestPath: () => false,
    filterCountTitle: () => "",
    sidebarToggleTitle: (hidden) => (hidden ? "show sidebar" : "hide sidebar"),
    openDirectoryInOsTitle: () => "open this folder in OS",
    omittedDirectoryBadge: () => ({ label: "skipped", title: "skipped" }),
    commitEntryBadge: () => ({ label: "GIT", title: "Git commit entry" }),
    $: <T extends Element = HTMLElement>(selector: string): T => {
      const el = document.querySelector(selector);
      if (!el) throw new Error(`missing ${selector}`);
      return el as T;
    },
    $$: <T extends Element = HTMLElement>(selector: string): T[] =>
      Array.from(document.querySelectorAll(selector)) as T[],
  } satisfies SidebarDeps);
}

describe("sidebar tree symlink rows", () => {
  test("a symlink-to-file row shows a link icon, target label, and is clickable", () => {
    installSidebarDom();
    const sidebar = createSidebarForTest();
    const clicks: string[] = [];

    sidebar.renderSidebar(
      [
        {
          path: "link-to-file.txt",
          type: "blob",
          is_symlink: true,
          symlink_target: "real.txt",
          symlink_target_type: "blob",
        },
      ],
      (file) => clicks.push(file.path),
    );

    const row = document.querySelector<HTMLElement>(
      '#filelist li[data-path="link-to-file.txt"]',
    );
    expect(row).toBeTruthy();
    expect(
      row
        ?.querySelector(".d2h-icon-wrapper svg")
        ?.getAttribute("class")
        ?.includes("octicon-link"),
    ).toBe(true);
    expect(row?.querySelector(".symlink-target")?.textContent).toBe(
      "→ real.txt",
    );
    expect(row?.classList.contains("symlink-broken-row")).toBe(false);
    expect(row?.hasAttribute("aria-disabled")).toBe(false);

    row?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(clicks).toEqual(["link-to-file.txt"]);
  });

  test("a symlink-to-directory row shows the target label next to the dir name", () => {
    installSidebarDom();
    const sidebar = createSidebarForTest();
    const clicks: string[] = [];

    sidebar.renderSidebar(
      [
        {
          path: "link-to-dir",
          type: "tree",
          is_symlink: true,
          symlink_target: "real-dir",
          symlink_target_type: "tree",
        },
      ],
      (file) => clicks.push(file.path),
    );

    const row = document.querySelector<HTMLElement>(
      '#filelist li.tree-dir[data-dirpath="link-to-dir"]',
    );
    expect(row).toBeTruthy();
    expect(row?.querySelector(".symlink-target")?.textContent).toBe(
      "→ real-dir",
    );

    row?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(clicks).toEqual(["link-to-dir"]);
  });

  test("a broken symlink row is visually marked and does not dispatch clicks", () => {
    installSidebarDom();
    const sidebar = createSidebarForTest();
    const clicks: string[] = [];

    sidebar.renderSidebar(
      [
        {
          path: "link-broken.txt",
          type: "blob",
          is_symlink: true,
          symlink_target: "missing.txt",
          symlink_target_type: "missing",
        },
      ],
      (file) => clicks.push(file.path),
    );

    const row = document.querySelector<HTMLElement>(
      '#filelist li[data-path="link-broken.txt"]',
    );
    expect(row?.classList.contains("symlink-broken-row")).toBe(true);
    expect(row?.getAttribute("aria-disabled")).toBe("true");
    expect(row?.querySelector(".symlink-target.broken")?.textContent).toBe(
      "→ missing.txt",
    );

    row?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(clicks).toEqual([]);
  });

  test("a regular file row has no symlink target label", () => {
    installSidebarDom();
    const sidebar = createSidebarForTest();

    sidebar.renderSidebar([{ path: "plain.txt", type: "blob" }], () => {
      /* noop: repository sidebar mode */
    });

    const row = document.querySelector<HTMLElement>(
      '#filelist li[data-path="plain.txt"]',
    );
    expect(row?.querySelector(".symlink-target")).toBeNull();
  });

  test("a pending git change badge still wins over the symlink icon", () => {
    installSidebarDom();
    const sidebar = createSidebarForTest();

    sidebar.renderSidebar(
      [
        {
          path: "link-to-file.txt",
          type: "blob",
          status: "M",
          is_symlink: true,
          symlink_target: "real.txt",
          symlink_target_type: "blob",
        },
      ],
      () => {
        /* noop: repository sidebar mode */
      },
    );

    const row = document.querySelector<HTMLElement>(
      '#filelist li[data-path="link-to-file.txt"]',
    );
    expect(row?.querySelector(".badge.M")).toBeTruthy();
    expect(row?.querySelector(".d2h-icon-wrapper")).toBeNull();
    expect(row?.querySelector(".symlink-target")?.textContent).toBe(
      "→ real.txt",
    );
  });
});

describe("lazily loaded directory children keep their status and symlink metadata", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    document.body.classList.remove("gdp-repo-page");
  });

  test("a file fetched via ensureVirtualSidebarDirLoaded keeps its git status badge", async () => {
    installSidebarDom();
    document.body.classList.add("gdp-repo-page");
    const sidebar = createSidebarForTest();
    globalThis.fetch = (async () =>
      ({
        ok: true,
        json: async () => ({
          ref: "worktree",
          path: "hoge",
          project: "sample-repo",
          entries: [
            { name: "abc", path: "hoge/abc", type: "blob", status: "A" },
          ],
        }),
      }) as unknown as Response) as unknown as typeof fetch;

    sidebar.renderSidebar([{ path: "hoge", type: "tree" }], () => {
      /* noop: repository sidebar mode */
    });

    const dirRow = sidebar.getSidebarRowByPath("hoge");
    if (dirRow?.kind !== "dir" || !dirRow.dir)
      throw new Error("expected hoge to be a lazily loadable dir row");
    await sidebar.ensureVirtualSidebarDirLoaded(dirRow.dir);
    sidebar.rerenderVirtualSidebar();

    const childRow = sidebar.getSidebarRowByPath("hoge/abc");
    expect(childRow?.file?.status).toBe("A");
  });

  test("a symlink fetched via ensureVirtualSidebarDirLoaded keeps its symlink metadata", async () => {
    installSidebarDom();
    document.body.classList.add("gdp-repo-page");
    const sidebar = createSidebarForTest();
    globalThis.fetch = (async () =>
      ({
        ok: true,
        json: async () => ({
          ref: "worktree",
          path: "hoge",
          project: "sample-repo",
          entries: [
            {
              name: "link.txt",
              path: "hoge/link.txt",
              type: "blob",
              is_symlink: true,
              symlink_target: "real.txt",
              symlink_target_type: "blob",
            },
          ],
        }),
      }) as unknown as Response) as unknown as typeof fetch;

    sidebar.renderSidebar([{ path: "hoge", type: "tree" }], () => {
      /* noop: repository sidebar mode */
    });

    const dirRow = sidebar.getSidebarRowByPath("hoge");
    if (dirRow?.kind !== "dir" || !dirRow.dir)
      throw new Error("expected hoge to be a lazily loadable dir row");
    await sidebar.ensureVirtualSidebarDirLoaded(dirRow.dir);
    sidebar.rerenderVirtualSidebar();

    const childRow = sidebar.getSidebarRowByPath("hoge/link.txt");
    expect(childRow?.file?.is_symlink).toBe(true);
    expect(childRow?.file?.symlink_target).toBe("real.txt");
    expect(childRow?.file?.symlink_target_type).toBe("blob");
  });
});

describe("sidebar tree deleted entry rows", () => {
  test("a deleted entry (status D) in repository sidebar mode is disabled and does not dispatch clicks", () => {
    installSidebarDom();
    const sidebar = createSidebarForTest();
    const clicks: string[] = [];

    sidebar.renderSidebar(
      [{ path: "gone.txt", type: "blob", status: "D" }],
      (file) => clicks.push(file.path),
    );

    const row = document.querySelector<HTMLElement>(
      '#filelist li[data-path="gone.txt"]',
    );
    expect(row?.classList.contains("gdp-row-disabled")).toBe(true);
    expect(row?.getAttribute("aria-disabled")).toBe("true");

    row?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(clicks).toEqual([]);
  });

  test("a deleted entry (status D) in diff sidebar mode (no onFileClick) still scrolls instead of being disabled", () => {
    installSidebarDom();
    const sidebar = createSidebarForTest();

    sidebar.renderSidebar([{ path: "gone.txt", type: "blob", status: "D" }]);

    const row = document.querySelector<HTMLElement>(
      '#filelist li[data-path="gone.txt"]',
    );
    expect(row?.classList.contains("gdp-row-disabled")).toBe(false);
    expect(row?.hasAttribute("aria-disabled")).toBe(false);
  });
});
