// worktree 画面が、サーバから返ったものをどう描き、選択をどう URL に載せるか。
//
// 見た目は History / Repository の資材をそのまま使っているので、テストが指すのも
// 同じクラス。左は .history-item、中央のサイドバーは .tree-file、右は
// .gdp-file-shell。文言はテスト用に作らず実物の i18n を通す。
//
// 差分の描画そのもの (diff2html) はベンダーのライブラリなので、ここでは
// 「何を渡したか」だけを見る。

import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import type { AppRoute, DiffRange } from "../core/routes";
import type { WorktreesResponse } from "../core/types";
import type { WorktreeFileChange, WorktreeItem } from "../core/worktree";
import { worktreeText } from "../views/worktree-i18n";
import {
  createWorktreeView,
  type WorktreeView,
  type WorktreeViewOptions,
} from "../views/worktree-view";

GlobalRegistrator.register();

afterAll(() => {
  GlobalRegistrator.unregister();
});

const TEXT = worktreeText("en");
const RANGE: DiffRange = { from: "HEAD", to: "worktree" };

type WorktreeRoute = Extract<AppRoute, { screen: "worktree" }>;

function file(overrides: Partial<WorktreeFileChange> = {}): WorktreeFileChange {
  return {
    path: "src/sample.ts",
    status: "M",
    additions: 3,
    deletions: 1,
    origin: "uncommitted",
    ...overrides,
  };
}

function item(overrides: Partial<WorktreeItem> = {}): WorktreeItem {
  const files = overrides.files ?? [];
  const name = overrides.name ?? "repo";
  const path =
    overrides.path ?? (name === "repo" ? "/repo" : `/repo/.worktrees/${name}`);
  return {
    path,
    id: overrides.id ?? path,
    head: "abc1234def",
    branch: "main",
    detached: false,
    bare: false,
    locked: false,
    lockedReason: "",
    prunable: false,
    prunableReason: "",
    name,
    displayPath: ".",
    current: false,
    missing: false,
    changedCount: files.filter((f) => f.origin === "uncommitted").length,
    error: "",
    lastCommit: null,
    serverUrl: "",
    divergence: null,
    fileCount: files.length,
    ...overrides,
    files,
  };
}

function response(
  worktrees: WorktreeItem[],
  overrides: Partial<WorktreesResponse> = {},
): WorktreesResponse {
  return {
    worktrees,
    repoRoot: "/repo",
    addParent: "/repo/.worktrees",
    baseBranch: "main",
    overlaps: [],
    generation: 1,
    ...overrides,
  };
}

/** 画面が使う既存の箱をひととおり置く (index.html と同じ id)。 */
function installDom(): void {
  document.body.innerHTML = `
    <aside id="worktree-panel" hidden></aside>
    <aside id="sidebar">
      <div class="sb-head">
        <span class="sb-title">Files</span><span id="totals"></span>
        <div class="sb-actions">
          <button id="sb-expand-all" class="sb-tree-action"></button>
          <button id="sb-collapse-all" class="sb-tree-action"></button>
        </div>
        <div class="sb-view-seg">
          <button data-view="tree"></button>
          <button data-view="flat"></button>
        </div>
      </div>
      <div class="sb-filter-wrap">
        <input id="sb-filter" type="search" />
        <button id="sb-filter-clear" type="button"></button>
      </div>
      <ul id="filelist"></ul>
    </aside>
    <main id="content"><section id="diff"></section></main>
    <section id="empty"></section>
    <section id="history-commit-info"></section>
  `;
}

/** diff2html に何を渡したか。実物は DOM を作るので描画そのものは見ない。 */
const draws: Array<{
  host: HTMLElement;
  diff: string;
  outputFormat: string;
  highlight: boolean;
}> = [];

function installDiff2Html(): void {
  draws.length = 0;
  (window as unknown as { Diff2HtmlUI: unknown }).Diff2HtmlUI =
    class FakeDiff2HtmlUI {
      constructor(
        host: HTMLElement,
        diffInput: string,
        options: { outputFormat: string; highlight: boolean },
      ) {
        draws.push({
          host,
          diff: diffInput,
          outputFormat: options.outputFormat,
          highlight: options.highlight,
        });
      }
      draw(): void {
        // 実物は DOM を組み立てる。ここで見たいのは「何を渡したか」だけ。
      }
      highlightCode(): void {
        // 同上。
      }
    };
}

/**
 * happy-dom の IntersectionObserver は登録できるだけで発火しない。実画面では
 * 見えた分から差分が読まれるので、テストでは observe した時点で「見えた」と
 * して呼び戻す。
 */
function installIntersectionObserver(): void {
  (
    globalThis as unknown as { IntersectionObserver: unknown }
  ).IntersectionObserver = class FakeIntersectionObserver {
    constructor(private readonly callback: IntersectionObserverCallback) {}
    observe(target: Element): void {
      this.callback(
        [{ isIntersecting: true, target } as IntersectionObserverEntry],
        this as unknown as IntersectionObserver,
      );
    }
    unobserve(): void {
      // 1 回発火したら用済み。
    }
    disconnect(): void {
      // 同上。
    }
  };
}

type DiffPayload = {
  diff: string;
  totalHunks?: number;
  renderedHunks?: number;
  truncated?: boolean;
};

function stubFetch(
  list: WorktreesResponse | { status: number; body: string },
  diff?: DiffPayload | { status: number; body: string },
): { diffUrls: string[] } {
  const diffUrls: string[] = [];
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    writable: true,
    value: (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/_worktree/diff")) {
        diffUrls.push(url);
        if (!diff) return new Response("no diff stubbed", { status: 500 });
        if ("status" in diff) {
          return new Response(diff.body, { status: diff.status });
        }
        return new Response(
          JSON.stringify({
            file: "src/sample.ts",
            origin: "uncommitted",
            totalHunks: diff.totalHunks ?? 1,
            renderedHunks: diff.renderedHunks ?? 1,
            truncated: diff.truncated ?? false,
            diff: diff.diff,
            generation: "status" in list ? 0 : list.generation,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if ("status" in list) {
        return new Response(list.body, { status: list.status });
      }
      return new Response(JSON.stringify(list), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch,
  });
  return { diffUrls };
}

type Mounted = {
  panel: HTMLElement;
  filelist: HTMLElement;
  diff: HTMLElement;
  routes: AppRoute[];
  diffUrls: string[];
  view: WorktreeView;
  setCurrentRoute(route: AppRoute): void;
  setDisplayOptions(
    options: Partial<{
      layout: "line-by-line" | "side-by-side";
      ignoreWs: boolean;
      hideTests: boolean;
      syntax: boolean;
    }>,
  ): void;
};

async function mountWith(
  list: WorktreesResponse | { status: number; body: string },
  options: {
    route?: Partial<WorktreeRoute>;
    diff?: DiffPayload | { status: number; body: string };
    /** topbar の「テスト非表示」。 */
    hideTests?: boolean;
    /** サイドバーの ツリー / 一覧。 */
    sidebarView?: "tree" | "flat";
    highlighter?: unknown;
  } = {},
): Promise<Mounted> {
  installDiff2Html();
  installIntersectionObserver();
  const { diffUrls } = stubFetch(list, options.diff);
  let current: WorktreeRoute = {
    screen: "worktree",
    range: RANGE,
    ...options.route,
  };
  const routes: AppRoute[] = [];
  let displayOptions: WorktreeViewOptions = {
    layout: "line-by-line",
    ignoreWs: false,
    hideTests: options.hideTests ?? false,
    syntax: false,
  };
  const view = createWorktreeView({
    getRoute: () => current,
    getOptions: () => displayOptions,
    isTestPath: (path: string) => path.includes(".test."),
    getSidebarView: () => options.sidebarView ?? "flat",
    loadHljs: () => Promise.resolve(options.highlighter ?? null),
    setRoute: (next) => {
      routes.push(next);
      if (next.screen === "worktree") current = next;
    },
    currentRange: () => RANGE,
    trackLoad: (promise) => promise,
    getText: () => TEXT,
    setPageMode: () => undefined,
    syncHeaderMenu: () => undefined,
    setStatus: () => undefined,
  });
  await view.enter();
  // 差分は「見えたものから」読む。IntersectionObserver の無い環境では全部
  // 読みに行く実装なので、その fetch と json() が片付くまで回す。
  for (let i = 0; i < 8; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  const panel = document.getElementById("worktree-panel");
  const filelist = document.getElementById("filelist");
  const diff = document.getElementById("diff");
  if (!panel || !filelist || !diff) throw new Error("boxes were not mounted");
  return {
    panel,
    filelist,
    diff,
    routes,
    diffUrls,
    view,
    setCurrentRoute(next) {
      if (next.screen === "worktree") current = next;
    },
    setDisplayOptions(next) {
      displayOptions = { ...displayOptions, ...next };
    },
  };
}

function texts(root: ParentNode, selector: string): string[] {
  return Array.from(root.querySelectorAll(selector)).map(
    (el) => el.textContent || "",
  );
}

function lastRoute(routes: AppRoute[]): AppRoute | undefined {
  return routes[routes.length - 1];
}

beforeEach(() => {
  installDom();
});

describe("worktree list panel", () => {
  test("draws one history row per worktree", async () => {
    const { panel } = await mountWith(
      response([
        item({ name: "repo", current: true }),
        item({
          name: "feature-x",
          path: "/repo/.worktrees/feature-x",
          displayPath: ".worktrees/feature-x",
          branch: "feature-x",
        }),
      ]),
    );
    expect(panel.querySelectorAll(".history-item")).toHaveLength(2);
    expect(texts(panel, ".history-item .subject")).toEqual([
      "repo",
      "feature-x",
    ]);
    expect(texts(panel, ".history-item .sha")).toEqual(["main", "feature-x"]);
  });

  test("filters by name, branch, or path", async () => {
    const { panel } = await mountWith(
      response([
        item({ name: "repo", branch: "main" }),
        item({
          name: "feature-x",
          path: "/repo/.worktrees/feature-x",
          displayPath: ".worktrees/feature-x",
          branch: "topic/login",
        }),
      ]),
    );
    const input = panel.querySelector<HTMLInputElement>(".history-filter");
    if (!input) throw new Error("filter input is missing");
    input.value = "login";
    input.dispatchEvent(new Event("input"));
    expect(texts(panel, ".history-item .subject")).toEqual(["feature-x"]);
  });

  test("puts the picked worktree in the URL", async () => {
    const { panel, routes } = await mountWith(
      response([item({ name: "repo" }), item({ name: "other" })]),
    );
    panel.querySelectorAll<HTMLElement>(".history-item")[1].click();
    expect(lastRoute(routes)).toEqual({
      screen: "worktree",
      wt: "/repo/.worktrees/other",
      range: RANGE,
    });
  });

  test("marks the picked worktree as active", async () => {
    const { panel } = await mountWith(
      response([item({ name: "repo" }), item({ name: "other" })]),
      { route: { wt: "/repo/.worktrees/other" } },
    );
    const rows = panel.querySelectorAll(".history-item");
    expect(rows[0].classList.contains("active")).toBe(false);
    expect(rows[1].classList.contains("active")).toBe(true);
  });

  test("keeps worktrees with the same basename separately selectable", async () => {
    const first = "/repo/first/shared";
    const second = "/repo/second/shared";
    const { panel, routes } = await mountWith(
      response([
        item({ id: first, path: first, name: "shared", displayPath: first }),
        item({ id: second, path: second, name: "shared", displayPath: second }),
      ]),
    );

    panel.querySelectorAll<HTMLElement>(".history-item")[1].click();

    expect(lastRoute(routes)).toEqual({
      screen: "worktree",
      wt: second,
      range: RANGE,
    });
  });

  test("offers open and remove for the picked worktree only", async () => {
    const { panel } = await mountWith(
      response([
        item({ name: "repo", current: true }),
        item({ name: "other", path: "/repo/.worktrees/other" }),
      ]),
      { route: { wt: "/repo/.worktrees/other" } },
    );
    const labels = texts(panel, "button.worktree-head-btn");
    expect(labels).toContain(TEXT.open);
    expect(labels).toContain(TEXT.remove);
  });

  test("never offers to remove the worktree this server serves", async () => {
    const { panel } = await mountWith(
      response([item({ name: "repo", current: true })]),
      { route: { wt: "/repo" } },
    );
    expect(texts(panel, "button.worktree-head-btn")).not.toContain(TEXT.remove);
  });
});

describe("divergence summary", () => {
  test.each([
    {
      name: "counts both sides and says it merges",
      divergence: {
        base: "main",
        ahead: 3,
        behind: 2,
        mergeState: "clean" as const,
        conflicts: [],
      },
      expected: `${TEXT.diverge.ahead(3)} · ${TEXT.diverge.behind(2)} · ${TEXT.merge.clean("main")}`,
    },
    {
      name: "says up to date when neither side moved",
      divergence: {
        base: "main",
        ahead: 0,
        behind: 0,
        mergeState: "clean" as const,
        conflicts: [],
      },
      expected: `${TEXT.diverge.even} · ${TEXT.merge.clean("main")}`,
    },
    {
      name: "names how many files would conflict",
      divergence: {
        base: "main",
        ahead: 1,
        behind: 0,
        mergeState: "conflict" as const,
        conflicts: ["a.ts", "b.ts"],
      },
      expected: `${TEXT.diverge.ahead(1)} · ${TEXT.merge.conflict(2, "main")}`,
    },
    {
      // 調べられなかったものを「衝突しない」に寄せない。
      name: "keeps an unchecked merge as its own state",
      divergence: {
        base: "main",
        ahead: 1,
        behind: 0,
        mergeState: "unknown" as const,
        conflicts: [],
      },
      expected: `${TEXT.diverge.ahead(1)} · ${TEXT.merge.unknown}`,
    },
  ])("$name", async ({ divergence, expected }) => {
    const { panel } = await mountWith(response([item({ divergence })]));
    expect(texts(panel, ".history-item .author")).toContain(expected);
  });

  test("says so when there is nothing to compare against", async () => {
    const { panel } = await mountWith(response([item({ divergence: null })]));
    expect(texts(panel, ".history-item .author")).toContain(
      TEXT.diverge.notComparable,
    );
  });

  test("marks a conflicting worktree in the list", async () => {
    const { panel } = await mountWith(
      response([
        item({
          divergence: {
            base: "main",
            ahead: 1,
            behind: 0,
            mergeState: "conflict",
            conflicts: ["a.ts"],
          },
        }),
      ]),
    );
    expect(
      panel
        .querySelector(".history-item")
        ?.classList.contains("worktree-conflict"),
    ).toBe(true);
  });
});

describe("sidebar file list", () => {
  const withFiles = () =>
    response([
      item({
        name: "repo",
        files: [
          file({ path: "src/a.ts", origin: "uncommitted" }),
          file({ path: "src/b.ts", origin: "committed" }),
        ],
      }),
    ]);

  test("asks for a worktree before showing anything", async () => {
    const { filelist } = await mountWith(withFiles());
    expect(filelist.textContent).toContain(TEXT.panes.selectWorktree);
    expect(filelist.querySelectorAll(".tree-file[data-key]")).toHaveLength(0);
  });

  test("lists the files of the picked worktree with their status", async () => {
    const { filelist } = await mountWith(withFiles(), {
      route: { wt: "/repo" },
    });
    expect(texts(filelist, ".tree-file[data-key] .name")).toEqual([
      "src/a.ts",
      "src/b.ts",
    ]);
    expect(texts(filelist, ".tree-file[data-key] .badge")).toEqual(["M", "M"]);
  });

  test("separates uncommitted work from commits since the branch point", async () => {
    const { filelist } = await mountWith(withFiles(), {
      route: { wt: "/repo" },
    });
    const groups = texts(filelist, ".worktree-file-group");
    expect(groups).toEqual([TEXT.files.uncommitted, TEXT.files.committed]);
  });

  test("filters through the sidebar's own search box", async () => {
    const { filelist } = await mountWith(withFiles(), {
      route: { wt: "/repo" },
    });
    const input = document.querySelector<HTMLInputElement>("#sb-filter");
    if (!input) throw new Error("sidebar filter is missing");
    input.value = "src/b";
    input.dispatchEvent(new Event("input"));
    expect(texts(filelist, ".tree-file[data-key] .name")).toEqual(["src/b.ts"]);
  });

  test("records the clicked file in the URL", async () => {
    const { filelist, routes } = await mountWith(withFiles(), {
      route: { wt: "/repo" },
    });
    filelist.querySelectorAll<HTMLElement>(".tree-file[data-key]")[1].click();
    expect(lastRoute(routes)).toEqual({
      screen: "worktree",
      wt: "/repo",
      file: "src/b.ts",
      origin: "committed",
      range: RANGE,
    });
  });

  test("restores the file selection and scroll position from the URL", async () => {
    const scrolled: string[] = [];
    const original = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = function scrollIntoView() {
      scrolled.push(this.getAttribute("data-key") || "");
    };
    try {
      const { filelist } = await mountWith(withFiles(), {
        route: {
          wt: "/repo",
          file: "src/b.ts",
          origin: "committed",
        },
        diff: { diff: "@@ -1 +1 @@\n-a\n+b\n" },
      });

      const active = filelist.querySelector<HTMLElement>(".tree-file.active");
      expect(active?.dataset.key).toBe("committed:src/b.ts");
      expect(scrolled).toContain("committed:src/b.ts");
    } finally {
      HTMLElement.prototype.scrollIntoView = original;
    }
  });

  test("shows the complete file count returned by the server", async () => {
    await mountWith(
      response([item({ name: "repo", files: [file()], fileCount: 1 })]),
      { route: { wt: "/repo" } },
    );
    expect(document.getElementById("totals")?.textContent).toBe(
      TEXT.files.heading(1),
    );
  });
});

describe("diffs", () => {
  const twoFiles = () =>
    response([
      item({
        name: "repo",
        files: [
          file({ path: "src/a.ts", origin: "uncommitted" }),
          file({ path: "src/b.ts", origin: "committed" }),
        ],
      }),
    ]);

  test("stacks every changed file instead of showing one at a time", async () => {
    const { diff } = await mountWith(twoFiles(), {
      route: { wt: "/repo" },
      diff: { diff: "@@ -1 +1 @@\n-a\n+b\n" },
    });
    expect(diff.querySelectorAll(".gdp-file-shell")).toHaveLength(2);
    expect(texts(diff, ".gdp-shell-header .path")).toEqual([
      "src/a.ts",
      "src/b.ts",
    ]);
  });

  test("asks the server once per file, with its worktree and origin", async () => {
    const { diffUrls } = await mountWith(twoFiles(), {
      route: { wt: "/repo" },
      diff: { diff: "@@ -1 +1 @@\n-a\n+b\n" },
    });
    expect(diffUrls).toHaveLength(2);
    const first = new URLSearchParams(diffUrls[0].split("?")[1]);
    expect(first.get("path")).toBe("/repo");
    expect(first.get("file")).toBe("src/a.ts");
    expect(first.get("origin")).toBe("uncommitted");
    expect(new URLSearchParams(diffUrls[1].split("?")[1]).get("origin")).toBe(
      "committed",
    );
  });

  test("marks an untracked file so the server compares against nothing", async () => {
    const { diffUrls } = await mountWith(
      response([
        item({ name: "repo", files: [file({ path: "new.ts", status: "U" })] }),
      ]),
      { route: { wt: "/repo" }, diff: { diff: "@@ -0,0 +1 @@\n+a\n" } },
    );
    expect(
      new URLSearchParams(diffUrls[0].split("?")[1]).get("untracked"),
    ).toBe("1");
  });

  test("hands each diff text to the renderer", async () => {
    await mountWith(twoFiles(), {
      route: { wt: "/repo" },
      diff: { diff: "@@ -1 +1 @@\n-a\n+b\n" },
    });
    expect(draws).toHaveLength(2);
    expect(draws[0].diff).toBe("@@ -1 +1 @@\n-a\n+b\n");
  });

  test.each([
    {
      name: "switches loaded cards to split layout",
      options: { layout: "side-by-side" as const },
      expected: { outputFormat: "side-by-side", highlight: false },
    },
    {
      name: "enables syntax highlighting on loaded cards",
      options: { syntax: true },
      expected: { outputFormat: "line-by-line", highlight: true },
    },
  ])("$name", async ({ options, expected }) => {
    const mounted = await mountWith(
      response([item({ name: "repo", files: [file()] })]),
      {
        route: { wt: "/repo" },
        diff: { diff: "@@ -1 +1 @@\n-a\n+b\n" },
        highlighter: {},
      },
    );
    mounted.setDisplayOptions(options);
    mounted.view.displayOptionsChanged();
    for (let i = 0; i < 4; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    expect(draws[draws.length - 1]).toMatchObject(expected);
  });

  test("says so when a file has no textual diff", async () => {
    const { diff } = await mountWith(
      response([item({ name: "repo", files: [file()] })]),
      { route: { wt: "/repo" }, diff: { diff: "" } },
    );
    expect(diff.textContent).toContain(TEXT.panes.diffEmpty);
    expect(draws).toHaveLength(0);
  });

  test("surfaces the reason on the file that failed", async () => {
    const { diff } = await mountWith(
      response([item({ name: "repo", files: [file()] })]),
      {
        route: { wt: "/repo" },
        diff: { status: 500, body: "git diff failed" },
      },
    );
    expect(diff.textContent).toContain("git diff failed");
    expect(diff.textContent).not.toContain(TEXT.panes.diffLoading);
  });

  test("says when a diff was cut short", async () => {
    const { diff } = await mountWith(
      response([item({ name: "repo", files: [file()] })]),
      {
        route: { wt: "/repo" },
        diff: {
          diff: "@@ -1 +1 @@\n-a\n+b\n",
          totalHunks: 900,
          renderedHunks: 200,
          truncated: true,
        },
      },
    );
    expect(diff.textContent).toContain(TEXT.panes.diffTruncated(200, 900));
  });

  test("asks for a worktree before loading anything", async () => {
    const { diff, diffUrls } = await mountWith(twoFiles());
    expect(diff.textContent).toContain(TEXT.panes.selectWorktree);
    expect(diffUrls).toEqual([]);
  });
});

describe("overlapping files", () => {
  const overlapping = () =>
    response(
      [
        item({ name: "a", files: [file({ path: "src/shared.ts" })] }),
        item({
          name: "b",
          path: "/repo/.worktrees/b",
          files: [file({ path: "src/shared.ts" })],
        }),
      ],
      {
        overlaps: [
          {
            path: "src/shared.ts",
            worktreeIds: ["/repo/.worktrees/a", "/repo/.worktrees/b"],
          },
        ],
      },
    );

  test("warns once above the list", async () => {
    const { panel } = await mountWith(overlapping());
    const banner = panel.querySelector(".history-banner");
    expect(banner?.textContent).toContain(TEXT.overlaps.heading(1));
    expect(banner?.getAttribute("title")).toBe(
      TEXT.overlaps.entry("src/shared.ts", ["a", "b"]),
    );
  });

  test("marks the file with the other worktrees that touch it", async () => {
    const { filelist } = await mountWith(overlapping(), {
      route: { wt: "/repo/.worktrees/a" },
      diff: { diff: "@@ -1 +1 @@\n-a\n+b\n" },
    });
    const row = filelist.querySelector(".tree-file[data-key]");
    const mark = row?.querySelector(".worktree-overlap-count");
    // 自分自身は「他で触っている」に数えないので、相手は 1 本。
    expect(mark?.textContent).toBe("1");
    expect(mark?.getAttribute("title")).toBe(TEXT.files.overlapTitle(["b"]));
  });

  test("leaves the banner out when nothing overlaps", async () => {
    const { panel } = await mountWith(response([item({ files: [file()] })]));
    expect(panel.querySelector(".history-banner")).toBeNull();
  });
});

describe("page level state", () => {
  test("reports a failed load instead of leaving the loading text up", async () => {
    const { panel } = await mountWith({
      status: 500,
      body: "git is unavailable",
    });
    expect(texts(panel, ".history-status")).toContain("git is unavailable");
    expect(panel.querySelectorAll(".history-item")).toHaveLength(0);
  });

  test("surfaces a per-worktree failure on its own row", async () => {
    const { panel } = await mountWith(
      response([item({ error: "git status failed" })]),
    );
    expect(texts(panel, ".history-item .author")).toContain(
      "git status failed",
    );
  });

  test.each([
    {
      name: "names the base branch it compared against",
      baseBranch: "main",
      expected: TEXT.baseLabel("main"),
    },
    {
      name: "says when no base branch could be found",
      baseBranch: "",
      expected: TEXT.baseUnknown,
    },
  ])("$name", async ({ baseBranch, expected }) => {
    const { panel } = await mountWith(response([item()], { baseBranch }));
    expect(texts(panel, ".history-status")).toContain(expected);
  });

  test("says so when the repository has no worktrees at all", async () => {
    const { panel } = await mountWith(response([]));
    expect(texts(panel, ".history-status")).toContain(TEXT.empty);
  });

  test("fetches a fresh list after leaving and re-entering", async () => {
    const mounted = await mountWith(response([item()]));
    const requests: string[] = [];
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      writable: true,
      value: (async (input: RequestInfo | URL) => {
        requests.push(String(input));
        return new Response(
          JSON.stringify(response([item({ name: "fresh" })])),
          {
            headers: { "Content-Type": "application/json" },
          },
        );
      }) as typeof fetch,
    });

    mounted.view.suspend();
    await mounted.view.enter();

    expect(requests).toEqual(["/_worktree/list"]);
    expect(texts(mounted.panel, ".history-item .subject")).toEqual(["fresh"]);
  });

  test("reload fetches a fresh list while the view stays mounted", async () => {
    const mounted = await mountWith(response([item({ name: "old" })]));
    const requests: string[] = [];
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      writable: true,
      value: (async (input: RequestInfo | URL) => {
        requests.push(String(input));
        return new Response(
          JSON.stringify(response([item({ name: "fresh" })])),
          {
            headers: { "Content-Type": "application/json" },
          },
        );
      }) as typeof fetch,
    });

    await mounted.view.reload();

    expect(requests).toEqual(["/_worktree/list"]);
    expect(texts(mounted.panel, ".history-item .subject")).toEqual(["fresh"]);
  });

  test("serializes overlapping refresh requests and coalesces the queued work", async () => {
    const mounted = await mountWith(response([item({ name: "old" })]));
    const requests: string[] = [];
    const pending: Array<(body: WorktreesResponse) => void> = [];
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      writable: true,
      value: (async (input: RequestInfo | URL) => {
        requests.push(String(input));
        return await new Promise<Response>((resolve) => {
          pending.push((body) =>
            resolve(
              new Response(JSON.stringify(body), {
                headers: { "Content-Type": "application/json" },
              }),
            ),
          );
        });
      }) as typeof fetch,
    });

    const first = mounted.view.reload();
    const second = mounted.view.reload();
    expect(requests).toEqual(["/_worktree/list"]);

    pending[0](response([item({ name: "middle" })], { generation: 2 }));
    for (let i = 0; i < 8 && requests.length < 2; i += 1) {
      await Promise.resolve();
    }
    expect(requests).toEqual(["/_worktree/list", "/_worktree/list"]);

    pending[1](response([item({ name: "fresh" })], { generation: 3 }));
    await Promise.all([first, second]);

    expect(texts(mounted.panel, ".history-item .subject")).toEqual(["fresh"]);
  });

  test("rejects a list response older than the last applied server generation", async () => {
    const mounted = await mountWith(
      response([item({ name: "current" })], { generation: 2 }),
    );
    stubFetch(response([item({ name: "stale" })], { generation: 1 }));

    mounted.view.suspend();
    await mounted.view.enter();

    expect(texts(mounted.panel, ".history-item .subject")).toEqual(["current"]);
    expect(mounted.panel.textContent).toContain(
      "stale worktree response generation 1; current is 2",
    );
  });
});

describe("sidebar tree view", () => {
  const nested = () =>
    response([
      item({
        name: "repo",
        files: [
          file({ path: "src/a/one.ts" }),
          file({ path: "src/a/two.ts" }),
          file({ path: "src/b/three.ts" }),
          file({ path: "top.ts" }),
        ],
      }),
    ]);

  test("nests files under their directories", async () => {
    const { filelist } = await mountWith(nested(), {
      route: { wt: "/repo" },
      sidebarView: "tree",
      diff: { diff: "@@ -1 +1 @@\n-a\n+b\n" },
    });
    // src は子が 2 つあるので畳まれず、その下に a と b が並ぶ。
    expect(texts(filelist, ".tree-dir > .name")).toEqual(["src", "a", "b"]);
    expect(texts(filelist, ".tree-children .tree-file .name")).toEqual([
      "one.ts",
      "two.ts",
      "three.ts",
    ]);
    // 階層に属さないファイルは同じ段に並ぶ。
    expect(texts(filelist, "#filelist > .tree-file[data-key] .name")).toContain(
      "top.ts",
    );
    expect(
      document
        .querySelector('[data-view="tree"]')
        ?.classList.contains("active"),
    ).toBe(true);
  });

  test("keeps full paths when the flat view is picked", async () => {
    const { filelist } = await mountWith(nested(), {
      route: { wt: "/repo" },
      sidebarView: "flat",
      diff: { diff: "@@ -1 +1 @@\n-a\n+b\n" },
    });
    expect(filelist.querySelectorAll(".tree-dir")).toHaveLength(0);
    expect(texts(filelist, ".tree-file[data-key] .name")).toEqual([
      "src/a/one.ts",
      "src/a/two.ts",
      "src/b/three.ts",
      "top.ts",
    ]);
    expect(
      document
        .querySelector('[data-view="flat"]')
        ?.classList.contains("active"),
    ).toBe(true);
  });

  test("hides test files when the topbar toggle is on", async () => {
    const { filelist } = await mountWith(
      response([
        item({
          name: "repo",
          files: [file({ path: "src/a.ts" }), file({ path: "src/a.test.ts" })],
        }),
      ]),
      {
        route: { wt: "/repo" },
        hideTests: true,
        diff: { diff: "@@ -1 +1 @@\n-a\n+b\n" },
      },
    );
    expect(texts(filelist, ".tree-file[data-key] .name")).toEqual(["src/a.ts"]);
  });
});

describe("event wiring", () => {
  test("does not stack click handlers as the list re-renders", async () => {
    // #filelist は画面をまたいで残る要素。描き直すたびに listener を足すと、
    // 1 クリックで route が何度も動く。
    const { filelist, routes } = await mountWith(
      response([item({ name: "repo", files: [file({ path: "src/a.ts" })] })]),
      { route: { wt: "/repo" }, diff: { diff: "@@ -1 +1 @@\n-a\n+b\n" } },
    );
    const input = document.querySelector<HTMLInputElement>("#sb-filter");
    if (!input) throw new Error("sidebar filter is missing");
    // 3 回描き直してから 1 回クリックする。
    for (const value of ["a", "", "src"]) {
      input.value = value;
      input.dispatchEvent(new Event("input"));
    }
    const before = routes.length;
    filelist.querySelector<HTMLElement>(".tree-file[data-key]")?.click();
    expect(routes.length - before).toBe(1);
  });

  test("does not refresh or rewrite the page after a suspended action finishes", async () => {
    const mounted = await mountWith(response([item({ name: "repo" })]), {
      route: { wt: "/repo" },
    });
    let finishAction: ((response: Response) => void) | null = null;
    let listRequests = 0;
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      writable: true,
      value: (async (input: RequestInfo | URL) => {
        if (String(input) === "/_worktree/open") {
          return new Promise<Response>((resolve) => {
            finishAction = resolve;
          });
        }
        listRequests++;
        return new Response(JSON.stringify(response([item()])), {
          headers: { "Content-Type": "application/json" },
        });
      }) as typeof fetch,
    });
    const originalOpen = window.open;
    Object.defineProperty(window, "open", {
      configurable: true,
      value: () => ({
        opener: null,
        location: { href: "" },
        close: () => undefined,
      }),
    });
    try {
      const openButton = Array.from(
        mounted.panel.querySelectorAll<HTMLButtonElement>(
          "button.worktree-head-btn",
        ),
      ).find((button) => button.textContent === TEXT.open);
      openButton?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      mounted.view.suspend();
      if (!finishAction) throw new Error("open action did not start");
      finishAction(
        new Response(JSON.stringify({ url: "http://127.0.0.1:4321/" }), {
          headers: { "Content-Type": "application/json" },
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(listRequests).toBe(0);
      expect(mounted.panel.hidden).toBe(true);
      expect(mounted.panel.childElementCount).toBe(0);
    } finally {
      Object.defineProperty(window, "open", {
        configurable: true,
        value: originalOpen,
      });
    }
  });
});
