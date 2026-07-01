import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "bun:test";
import { readFileSync } from "node:fs";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { createSidebar } from "../views/sidebar";

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
      </div>
      <ul id="filelist"></ul>
    </aside>
  `;
}

function installStyleCss() {
  const style = document.createElement("style");
  style.textContent = styleCss;
  document.head.appendChild(style);
}

function repoTargetDisplayForBodyClass(className: string) {
  document.body.innerHTML = "";
  document.head.innerHTML = "";
  document.body.className = className;
  installSidebarDom();
  installStyleCss();
  const wrap = document.querySelector<HTMLElement>("#repo-target-wrap");
  if (!wrap) throw new Error("missing repo target wrap");
  wrap.hidden = false;
  return getComputedStyle(wrap).display;
}

function createSidebarForTest(
  overrides: { openDirectoryInOsTitle?: () => string } = {},
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
    scrollToFile() {
      /* noop */
    },
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
    sidebarToggleTitle: (hidden) => (hidden ? "show sidebar" : "hide sidebar"),
    openDirectoryInOsTitle:
      overrides.openDirectoryInOsTitle ?? (() => "open this folder in OS"),
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
