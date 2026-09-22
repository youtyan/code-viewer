import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import { createSidebarForTest, installSidebarDom } from "./_sidebar-fixture";

beforeAll(() => {
  GlobalRegistrator.register();
});

afterAll(() => {
  GlobalRegistrator.unregister();
});

afterEach(() => {
  document.body.innerHTML = "";
});

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
