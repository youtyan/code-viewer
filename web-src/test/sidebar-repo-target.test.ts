import { readFileSync } from "node:fs";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import { createSidebar, type SidebarDeps } from "../views/sidebar";

const styleCss = readFileSync("web/style.css", "utf8");

beforeAll(() => {
  GlobalRegistrator.register();
});

afterAll(() => {
  GlobalRegistrator.unregister();
});

afterEach(() => {
  document.body.innerHTML = "";
  document.head.innerHTML = "";
});

function installSidebarDom() {
  document.body.innerHTML = `
    <aside id="sidebar">
      <div class="sb-head">
        <span class="sb-title">Files</span>
        <span id="totals"></span>
        <div id="repo-target-wrap" data-ref-selector>
          <input id="repo-target" value="HEAD" />
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
    <div id="sidebar-resizer"></div>
    <aside id="history-panel"></aside>
  `;
}

function installStyleCss() {
  const style = document.createElement("style");
  style.textContent = styleCss;
  document.head.appendChild(style);
}

function computedDisplayForBodyClass(selector: string, className: string) {
  document.body.innerHTML = "";
  document.head.innerHTML = "";
  document.body.className = className;
  installSidebarDom();
  installStyleCss();
  const el = document.querySelector<HTMLElement>(selector);
  if (!el) throw new Error(`missing ${selector}`);
  el.hidden = false;
  return getComputedStyle(el).display;
}

function repoTargetDisplayForBodyClass(className: string) {
  return computedDisplayForBodyClass("#repo-target-wrap", className);
}

function createSidebarForTest(
  overrides: Partial<
    Pick<
      SidebarDeps,
      | "omittedDirectoryBadge"
      | "openDirectoryInOsTitle"
      | "commitEntryBadge"
      | "openDiffFile"
    >
  > = {},
) {
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
    openDiffFile: overrides.openDiffFile ?? (() => undefined),
    sidebarItemHref: (item, mode) => `/link/${mode}/${item.path}`,
    prefetchByPath() {
      /* noop */
    },
    fileBadge(status) {
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = status || "";
      return badge;
    },
    fileEntryIcon: () => "",
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
    createOpenPathButton(_path, _kind, title) {
      const button = document.createElement("button");
      button.className = "gdp-open-path";
      if (title) {
        button.title = title;
        button.setAttribute("aria-label", title);
      }
      return button;
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
    openDirectoryInOsTitle:
      overrides.openDirectoryInOsTitle ?? (() => "open this folder in OS"),
    omittedDirectoryBadge:
      overrides.omittedDirectoryBadge ??
      ((reason) =>
        reason === "heavy"
          ? {
              label: "skipped",
              title:
                "Tree expansion is skipped, but the directory detail can be opened",
            }
          : {
              label: "private",
              title: "This directory cannot be opened from the browser",
            }),
    commitEntryBadge:
      overrides.commitEntryBadge ??
      ((submodule) =>
        submodule
          ? { label: "SUB", title: "Git submodule pinned to a commit" }
          : { label: "GIT", title: "Git commit entry" }),
    $: <T extends Element = HTMLElement>(selector: string): T => {
      const el = document.querySelector(selector);
      if (!el) throw new Error(`missing ${selector}`);
      return el as T;
    },
    $$: <T extends Element = HTMLElement>(selector: string): T[] =>
      Array.from(document.querySelectorAll(selector)) as T[],
  });
}

describe("diff sidebar repository target", () => {
  test("hides the repository target selector when rendering the diff sidebar", () => {
    installSidebarDom();
    const sidebar = createSidebarForTest();
    const wrap = document.querySelector<HTMLElement>("#repo-target-wrap");
    if (!wrap) throw new Error("missing repo target wrap");
    wrap.hidden = false;

    sidebar.renderSidebar([
      {
        path: "sample.ts",
        display_path: "sample.ts",
        status: "M",
      },
    ]);

    expect(wrap.hidden).toBe(true);
    expect(wrap.style.display).toBe("none");
    expect(
      document.querySelector('#filelist li[data-path="sample.ts"]'),
    ).toBeTruthy();
  });

  test("keeps file counts out of repository sidebars", () => {
    installSidebarDom();
    const sidebar = createSidebarForTest();

    sidebar.renderSidebar(
      [
        { path: "src", type: "tree" },
        { path: "README.md", type: "blob" },
      ],
      () => {
        /* noop: presence forces repository sidebar mode */
      },
    );

    expect(document.querySelector("#totals")?.textContent).toBe("");
  });

  test("keeps file counts in diff sidebars", () => {
    installSidebarDom();
    const sidebar = createSidebarForTest();

    sidebar.renderSidebar([
      { path: "sample-a.ts", display_path: "sample-a.ts", status: "M" },
      { path: "sample-b.ts", display_path: "sample-b.ts", status: "A" },
    ]);

    expect(document.querySelector("#totals")?.textContent).toBe("2 files");
  });

  test("keeps the repository target visually hidden outside repository pages", () => {
    expect(repoTargetDisplayForBodyClass("gdp-repo-page")).toBe("flex");
    expect(repoTargetDisplayForBodyClass("")).toBe("none");
    expect(repoTargetDisplayForBodyClass("gdp-diff-page")).toBe("none");
    expect(repoTargetDisplayForBodyClass("gdp-diff-page gdp-repo-page")).toBe(
      "none",
    );
    expect(repoTargetDisplayForBodyClass("gdp-repo-blob-page")).toBe("none");
    expect(
      repoTargetDisplayForBodyClass("gdp-file-detail-page gdp-repo-blob-page"),
    ).toBe("flex");
  });

  // The diff file list stays on screen in the source view opened from the
  // diff ("View File"); only the user's toggle and pages without a file
  // list hide it.
  test.each([
    ["", "block"],
    ["gdp-diff-page", "block"],
    ["gdp-file-detail-page", "block"],
    ["gdp-file-detail-page gdp-repo-blob-page", "block"],
    ["gdp-history-page gdp-file-detail-page", "block"],
    ["gdp-file-detail-page gdp-sidebar-hidden", "none"],
    ["gdp-help-page", "none"],
  ])("sidebar display for body class %j", (className, display) => {
    expect(computedDisplayForBodyClass("#sidebar", className)).toBe(display);
    expect(computedDisplayForBodyClass("#sidebar-resizer", className)).toBe(
      display,
    );
  });

  // Rows carry their route as a real link so the browser can open it in a
  // new tab (Cmd/Ctrl/middle click); the app keeps only the plain click.
  const repoClick = () => undefined;
  test.each([
    [
      "diff sidebar file",
      undefined,
      'li[data-path="src/alpha.ts"] a.name',
      "/link/diff/src/alpha.ts",
    ],
    [
      "repository sidebar file",
      repoClick,
      'li[data-path="src/alpha.ts"] a.name',
      "/link/repo/src/alpha.ts",
    ],
    [
      "repository sidebar directory",
      repoClick,
      '.tree-dir[data-dirpath="src"] a.dir-name',
      "/link/repo/src",
    ],
  ])("%s carries its route as href", (_label, onFileClick, selector, href) => {
    installSidebarDom();
    const sidebar = createSidebarForTest();
    sidebar.renderSidebar(
      [{ path: "src/alpha.ts", type: "blob", status: "M" }],
      onFileClick,
    );
    expect(
      document.querySelector(`#filelist ${selector}`)?.getAttribute("href"),
    ).toBe(href);
  });

  test.each([
    [
      "diff sidebar directory (a click only folds it)",
      undefined,
      { path: "src/alpha.ts", status: "M" },
      '.tree-dir[data-dirpath="src"] .dir-name',
    ],
    [
      "deleted repository entry",
      repoClick,
      { path: "src/alpha.ts", type: "blob" as const, status: "D" },
      'li[data-path="src/alpha.ts"] .name',
    ],
  ])("%s stays plain text", (_label, onFileClick, item, selector) => {
    installSidebarDom();
    const sidebar = createSidebarForTest();
    sidebar.renderSidebar([item], onFileClick);
    const label = document.querySelector(`#filelist ${selector}`);
    expect(label?.tagName).toBe("SPAN");
  });

  test.each([
    ["plain click", {}, 1, true],
    ["Cmd+click", { metaKey: true }, 0, false],
    ["Ctrl+click", { ctrlKey: true }, 0, false],
    ["Shift+click", { shiftKey: true }, 0, false],
    ["middle click", { button: 1 }, 0, false],
  ])("%s on a row: opened %i time(s), default prevented %s", (_label, init, opens, prevented) => {
    installSidebarDom();
    const opened: string[] = [];
    const sidebar = createSidebarForTest({
      openDiffFile: (path) => {
        opened.push(path);
      },
    });
    sidebar.renderSidebar([{ path: "src/alpha.ts", status: "M" }]);
    const link = document.querySelector(
      '#filelist li[data-path="src/alpha.ts"] a.name',
    );
    if (!link) throw new Error("missing row link");
    const event = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      ...init,
    });
    link.dispatchEvent(event);
    expect(opened).toHaveLength(opens);
    expect(event.defaultPrevented).toBe(prevented);
  });

  // The commit list stays while the history screen shows a source view.
  test.each([
    ["gdp-history-page", "flex"],
    ["gdp-history-page gdp-file-detail-page", "flex"],
    ["gdp-file-detail-page", "none"],
  ])("history panel display for body class %j", (className, display) => {
    expect(computedDisplayForBodyClass("#history-panel", className)).toBe(
      display,
    );
  });

  test("clears the file filter and restores hidden sidebar rows", () => {
    installSidebarDom();
    const sidebar = createSidebarForTest();

    sidebar.renderSidebar([
      { path: "src/alpha.ts", status: "M" },
      { path: "src/beta.ts", status: "M" },
    ]);

    const input = document.querySelector<HTMLInputElement>("#sb-filter");
    const clearButton =
      document.querySelector<HTMLButtonElement>("#sb-filter-clear");
    const alpha = document.querySelector<HTMLElement>(
      '#filelist li[data-path="src/alpha.ts"]',
    );
    const beta = document.querySelector<HTMLElement>(
      '#filelist li[data-path="src/beta.ts"]',
    );
    if (!input || !clearButton || !alpha || !beta)
      throw new Error("missing sidebar filter test elements");
    let inputEvents = 0;
    input.addEventListener("input", () => inputEvents++);

    sidebar.syncSidebarFilterClearButton();
    expect(clearButton.hidden).toBe(true);

    input.value = "beta";
    sidebar.applyFilter();

    expect(clearButton.hidden).toBe(false);
    expect(alpha.classList.contains("hidden")).toBe(true);
    expect(beta.classList.contains("hidden")).toBe(false);

    sidebar.clearSidebarFilter();

    expect(input.value).toBe("");
    expect(clearButton.hidden).toBe(true);
    expect(alpha.classList.contains("hidden")).toBe(false);
    expect(beta.classList.contains("hidden")).toBe(false);
    expect(document.activeElement).toBe(input);
    expect(inputEvents).toBe(1);
  });
});

describe("diff sidebar file kind indicators", () => {
  test("shows a heavy indicator for a large/huge diff file", () => {
    installSidebarDom();
    const sidebar = createSidebarForTest();

    sidebar.renderSidebar([
      { path: "big.ts", status: "M", size_class: "large" },
    ]);

    const tag = document.querySelector<HTMLElement>(
      '#filelist li[data-path="big.ts"] .kind-tag',
    );
    expect(tag?.classList.contains("heavy")).toBe(true);
    expect(tag?.classList.contains("binary")).toBe(false);
  });

  test("shows a binary indicator for a binary file", () => {
    installSidebarDom();
    const sidebar = createSidebarForTest();

    sidebar.renderSidebar([
      { path: "archive.zip", status: "M", size_class: "binary" },
    ]);

    const tag = document.querySelector<HTMLElement>(
      '#filelist li[data-path="archive.zip"] .kind-tag',
    );
    expect(tag?.classList.contains("binary")).toBe(true);
    expect(tag?.classList.contains("heavy")).toBe(false);
  });

  test("shows a binary indicator for a media file", () => {
    installSidebarDom();
    const sidebar = createSidebarForTest();

    sidebar.renderSidebar([
      { path: "logo.png", status: "M", media_kind: "image" },
    ]);

    const tag = document.querySelector<HTMLElement>(
      '#filelist li[data-path="logo.png"] .kind-tag',
    );
    expect(tag?.classList.contains("binary")).toBe(true);
  });

  test("omits the indicator for an ordinary small text diff", () => {
    installSidebarDom();
    const sidebar = createSidebarForTest();

    sidebar.renderSidebar([
      { path: "small.ts", status: "M", size_class: "small" },
    ]);

    expect(
      document.querySelector('#filelist li[data-path="small.ts"] .kind-tag'),
    ).toBeNull();
  });

  test("shows a submodule indicator for a commit entry", () => {
    installSidebarDom();
    const sidebar = createSidebarForTest();

    sidebar.renderSidebar([
      { path: "vendor/tooling", type: "commit", submodule: true },
    ]);

    const row = document.querySelector<HTMLElement>(
      '#filelist li[data-path="vendor/tooling"]',
    );
    const tag = row?.querySelector<HTMLElement>(".kind-tag.submodule");
    expect(row?.dataset.type).toBe("commit");
    expect(row?.querySelector(".octicon-git-branch")).toBeTruthy();
    expect(row?.querySelector(".octicon-file")).toBeNull();
    expect(row?.title).toBe("Git submodule pinned to a commit");
    expect(tag?.textContent).toBe("SUB");
    expect(tag?.title).toBe("Git submodule pinned to a commit");
  });

  test("shows a gitlink indicator for a non-submodule commit entry", () => {
    installSidebarDom();
    const sidebar = createSidebarForTest();

    sidebar.renderSidebar([{ path: "vendor/nested-repo", type: "commit" }]);

    const row = document.querySelector<HTMLElement>(
      '#filelist li[data-path="vendor/nested-repo"]',
    );
    const tag = row?.querySelector<HTMLElement>(".kind-tag.gitlink");
    expect(row?.dataset.type).toBe("commit");
    expect(row?.title).toBe("Git commit entry");
    expect(tag?.textContent).toBe("GIT");
    expect(tag?.title).toBe("Git commit entry");
  });
});

describe("virtual tree sidebar file kind indicators (createTreeFileRow)", () => {
  test("shows a heavy indicator for a large/huge diff file", () => {
    installSidebarDom();
    const sidebar = createSidebarForTest();

    sidebar.renderSidebar(
      [{ path: "big.ts", status: "M", size_class: "large" }],
      () => {
        /* noop: presence forces the virtual repo-mode tree */
      },
    );

    expect(sidebar.isVirtualSidebarActive()).toBe(true);
    const tag = document.querySelector<HTMLElement>(
      '#filelist li[data-path="big.ts"] .kind-tag',
    );
    expect(tag?.classList.contains("heavy")).toBe(true);
    expect(tag?.classList.contains("binary")).toBe(false);
  });

  test("shows a binary indicator for a binary file", () => {
    installSidebarDom();
    const sidebar = createSidebarForTest();

    sidebar.renderSidebar(
      [{ path: "archive.zip", status: "M", size_class: "binary" }],
      () => {
        /* noop: presence forces the virtual repo-mode tree */
      },
    );

    expect(sidebar.isVirtualSidebarActive()).toBe(true);
    const tag = document.querySelector<HTMLElement>(
      '#filelist li[data-path="archive.zip"] .kind-tag',
    );
    expect(tag?.classList.contains("binary")).toBe(true);
    expect(tag?.classList.contains("heavy")).toBe(false);
  });

  test("shows a binary indicator for a media file", () => {
    installSidebarDom();
    const sidebar = createSidebarForTest();

    sidebar.renderSidebar(
      [{ path: "logo.png", status: "M", media_kind: "image" }],
      () => {
        /* noop: presence forces the virtual repo-mode tree */
      },
    );

    expect(sidebar.isVirtualSidebarActive()).toBe(true);
    const tag = document.querySelector<HTMLElement>(
      '#filelist li[data-path="logo.png"] .kind-tag',
    );
    expect(tag?.classList.contains("binary")).toBe(true);
  });

  test("omits the indicator for an ordinary small text diff", () => {
    installSidebarDom();
    const sidebar = createSidebarForTest();

    sidebar.renderSidebar(
      [{ path: "small.ts", status: "M", size_class: "small" }],
      () => {
        /* noop: presence forces the virtual repo-mode tree */
      },
    );

    expect(sidebar.isVirtualSidebarActive()).toBe(true);
    expect(
      document.querySelector('#filelist li[data-path="small.ts"] .kind-tag'),
    ).toBeNull();
  });

  test("shows a submodule indicator for a commit entry", () => {
    installSidebarDom();
    const sidebar = createSidebarForTest();

    sidebar.renderSidebar(
      [{ path: "vendor/tooling", type: "commit", submodule: true }],
      () => {
        /* noop: presence forces the virtual repo-mode tree */
      },
    );

    expect(sidebar.isVirtualSidebarActive()).toBe(true);
    const row = document.querySelector<HTMLElement>(
      '#filelist li[data-path="vendor/tooling"]',
    );
    const tag = row?.querySelector<HTMLElement>(".kind-tag.submodule");
    expect(row?.dataset.type).toBe("commit");
    expect(row?.querySelector(".octicon-git-branch")).toBeTruthy();
    expect(row?.querySelector(".octicon-file")).toBeNull();
    expect(row?.title).toBe("Git submodule pinned to a commit");
    expect(tag?.textContent).toBe("SUB");
    expect(tag?.title).toBe("Git submodule pinned to a commit");
  });

  test("shows a gitlink indicator for a non-submodule commit entry", () => {
    installSidebarDom();
    const sidebar = createSidebarForTest();

    sidebar.renderSidebar(
      [{ path: "vendor/nested-repo", type: "commit" }],
      () => {
        /* noop: presence forces the virtual repo-mode tree */
      },
    );

    expect(sidebar.isVirtualSidebarActive()).toBe(true);
    const row = document.querySelector<HTMLElement>(
      '#filelist li[data-path="vendor/nested-repo"]',
    );
    const tag = row?.querySelector<HTMLElement>(".kind-tag.gitlink");
    expect(row?.dataset.type).toBe("commit");
    expect(row?.title).toBe("Git commit entry");
    expect(tag?.textContent).toBe("GIT");
    expect(tag?.title).toBe("Git commit entry");
  });
});

describe("repository directory open-in-OS button localization", () => {
  test("uses the injected label instead of a hardcoded English string", () => {
    installSidebarDom();
    const sidebar = createSidebarForTest({
      openDirectoryInOsTitle: () => "サンプルのラベル",
    });

    sidebar.renderSidebar([{ path: "src", type: "tree" }], () => {
      /* noop: presence forces the virtual repo-mode tree */
    });

    expect(sidebar.isVirtualSidebarActive()).toBe(true);
    const button = document.querySelector<HTMLButtonElement>(
      '#filelist li[data-dirpath="src"] .gdp-open-path',
    );
    expect(button?.title).toBe("サンプルのラベル");
    expect(button?.getAttribute("aria-label")).toBe("サンプルのラベル");
  });
});

describe("repository omitted directory badge localization", () => {
  test("uses injected labels and titles for omitted directory badges", () => {
    installSidebarDom();
    const sidebar = createSidebarForTest({
      omittedDirectoryBadge: (reason) =>
        reason === "heavy"
          ? { label: "サンプル省略", title: "サンプル省略タイトル" }
          : { label: "サンプル非公開", title: "サンプル非公開タイトル" },
    });

    sidebar.renderSidebar(
      [
        {
          path: "large-dir",
          type: "tree",
          children_omitted: true,
          children_omitted_reason: "heavy",
        },
        {
          path: "internal-dir",
          type: "tree",
          children_omitted: true,
          children_omitted_reason: "internal",
        },
      ],
      () => {
        /* noop: presence forces the virtual repo-mode tree */
      },
    );

    const heavy = document.querySelector<HTMLElement>(
      '#filelist li[data-dirpath="large-dir"] .dir-omitted',
    );
    const internal = document.querySelector<HTMLElement>(
      '#filelist li[data-dirpath="internal-dir"] .dir-omitted',
    );

    expect(heavy?.textContent).toBe("サンプル省略");
    expect(heavy?.title).toBe("サンプル省略タイトル");
    expect(internal?.textContent).toBe("サンプル非公開");
    expect(internal?.title).toBe("サンプル非公開タイトル");
  });

  test("marks omitted directory rows and only opens browseable ones", () => {
    installSidebarDom();
    const clicked: Array<{
      path: string;
      type?: string;
      children_omitted?: true;
      children_omitted_reason?: string;
    }> = [];
    const sidebar = createSidebarForTest({
      omittedDirectoryBadge: (reason) => ({
        label: `${reason}-badge`,
        title: `${reason}-title`,
      }),
    });

    sidebar.renderSidebar(
      [
        {
          path: "large-dir",
          type: "tree",
          children_omitted: true,
          children_omitted_reason: "heavy",
        },
        {
          path: "internal-dir",
          type: "tree",
          children_omitted: true,
          children_omitted_reason: "internal",
        },
      ],
      (file) => clicked.push(file),
    );

    const heavy = document.querySelector<HTMLElement>(
      '#filelist li[data-dirpath="large-dir"]',
    );
    const internal = document.querySelector<HTMLElement>(
      '#filelist li[data-dirpath="internal-dir"]',
    );
    const heavyBadge = heavy?.querySelector<HTMLElement>(".dir-omitted");
    const internalBadge = internal?.querySelector<HTMLElement>(".dir-omitted");

    expect(heavy?.classList.contains("children-omitted")).toBe(true);
    expect(heavy?.classList.contains("children-omitted-heavy")).toBe(true);
    expect(heavy?.dataset.childrenOmittedReason).toBe("heavy");
    expect(heavy?.querySelector(".chev-spacer")).toBeTruthy();
    expect(heavy?.querySelector(".chev")).toBeNull();
    expect(heavyBadge?.classList.contains("dir-omitted-heavy")).toBe(true);
    expect(heavyBadge?.textContent).toBe("heavy-badge");
    expect(heavyBadge?.title).toBe("heavy-title");

    expect(internal?.classList.contains("children-omitted")).toBe(true);
    expect(internal?.classList.contains("children-omitted-internal")).toBe(
      true,
    );
    expect(internal?.dataset.childrenOmittedReason).toBe("internal");
    expect(internal?.querySelector(".chev-spacer")).toBeTruthy();
    expect(internal?.querySelector(".chev")).toBeNull();
    expect(internalBadge?.classList.contains("dir-omitted-internal")).toBe(
      true,
    );
    expect(internalBadge?.textContent).toBe("internal-badge");
    expect(internalBadge?.title).toBe("internal-title");

    heavy?.click();
    internal?.click();

    expect(clicked).toEqual([
      {
        path: "large-dir",
        display_path: "large-dir",
        type: "tree",
        children_omitted: true,
        children_omitted_reason: "heavy",
      },
    ]);
  });
});
