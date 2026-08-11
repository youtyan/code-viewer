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
    lastTouched: null,
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
  postResponse: Record<string, unknown> = {},
): { diffUrls: string[]; posts: Array<{ url: string; body: unknown }> } {
  const diffUrls: string[] = [];
  const posts: Array<{ url: string; body: unknown }> = [];
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    writable: true,
    value: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "POST") {
        posts.push({
          url,
          body: init.body ? JSON.parse(String(init.body)) : null,
        });
        return new Response(JSON.stringify(postResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
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
  return { diffUrls, posts };
}

type Mounted = {
  panel: HTMLElement;
  filelist: HTMLElement;
  diff: HTMLElement;
  routes: AppRoute[];
  diffUrls: string[];
  posts: Array<{ url: string; body: unknown }>;
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
    /** POST の応答 (add が返す path など)。 */
    postResponse?: Record<string, unknown>;
    /** topbar の「テスト非表示」。 */
    hideTests?: boolean;
    /** サイドバーの ツリー / 一覧。 */
    sidebarView?: "tree" | "flat";
    highlighter?: unknown;
  } = {},
): Promise<Mounted> {
  installDiff2Html();
  installIntersectionObserver();
  const { diffUrls, posts } = stubFetch(
    list,
    options.diff,
    options.postResponse ?? {},
  );
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
    // 実物 (app.ts) と同じ形のボタンを返す。中身の挙動はここでは見ない。
    createOpenPathButton: (_path, _kind, title) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "gdp-file-header-icon gdp-open-path";
      if (title) {
        button.title = title;
        button.setAttribute("aria-label", title);
      }
      return button;
    },
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
    posts,
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

/** 行の「…」を押してメニューを開き、並んだ項目の文言を返す。 */
function openRowMenu(panel: HTMLElement, rowIndex: number): string[] {
  const buttons = panel.querySelectorAll<HTMLButtonElement>(
    ".history-item .worktree-row-menu",
  );
  const button = buttons[rowIndex];
  if (!button) throw new Error(`row ${rowIndex} has no menu button`);
  button.click();
  const menu = document.querySelector(".gdp-context-menu");
  if (!menu) throw new Error("the menu did not open");
  return texts(menu, "button");
}

/** 開いているメニューの項目を文言で取る。 */
function menuItem(label: string): HTMLButtonElement {
  const found = Array.from(
    document.querySelectorAll<HTMLButtonElement>(".gdp-context-menu button"),
  ).find((button) => button.textContent === label);
  if (!found) throw new Error(`the menu has no "${label}"`);
  return found;
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

  test("shows the folder path on its own line, in full, not relative", async () => {
    const { panel } = await mountWith(
      response([
        item({
          name: "feature-x",
          path: "/repo/.worktrees/feature-x",
          displayPath: ".worktrees/feature-x",
        }),
      ]),
    );
    // 相対パスだと、リポジトリがどこにあるかを知っている人にしか読めない。
    const line = panel.querySelector<HTMLElement>(".worktree-row-path");
    expect(line?.textContent).toBe("/repo/.worktrees/feature-x");
    expect(line?.title).toBe("/repo/.worktrees/feature-x");
  });

  test("shows a real path for the main worktree too, not a bare dot", async () => {
    const { panel } = await mountWith(
      response([item({ name: "repo", path: "/repo", displayPath: "." })]),
    );
    // displayPath はリポジトリルート自身に "." を返す。それを出すと、
    // 本体の行だけ場所が分からない行になる。
    const line = panel.querySelector<HTMLElement>(".worktree-row-path");
    expect(line?.textContent).toBe("/repo");
  });

  test("explains each badge on hover", async () => {
    const { panel } = await mountWith(
      response([
        item({ name: "repo", current: true }),
        item({
          name: "other",
          path: "/repo/.worktrees/other",
          branch: "",
          detached: true,
        }),
      ]),
    );
    const rows = panel.querySelectorAll(".history-item");
    const badge = rows[0].querySelector<HTMLElement>(".worktree-badge");
    expect(badge?.textContent).toBe(TEXT.badges.current);
    expect(badge?.title).toBe(TEXT.badges.currentTitle);
    // detached の行はブランチ名の代わりに「ブランチなし」を出す。
    expect(rows[1].querySelector(".sha")?.textContent).toBe(
      TEXT.badges.detached,
    );
  });

  test("shows when files were last touched, next to the last commit", async () => {
    const touchedIso = new Date().toISOString();
    const { panel } = await mountWith(
      response([
        item({
          lastTouched: touchedIso,
          lastCommit: {
            sha: "abc1234def",
            subject: "sample subject",
            author: "sample author",
            when: "2026-08-10T00:00:00.000Z",
          },
        }),
      ]),
    );
    const whens = panel.querySelectorAll<HTMLElement>(".history-item .when");
    // 最終コミットの相対時刻と、mtime ベースの最終更新の両方が出る。
    expect(whens).toHaveLength(2);
    expect(whens[1].textContent).toBe(TEXT.lastTouched("just now"));
    expect(whens[1].title).toBe(
      new Date(Date.parse(touchedIso)).toLocaleString(),
    );
    // 最終コミットの title は件名と絶対日時の両方を持つ。
    expect(whens[0].title).toContain("sample subject");
    expect(whens[0].title).toContain(
      new Date("2026-08-10T00:00:00.000Z").toLocaleString(),
    );
  });

  test("offers every action from the row's own menu, without picking it", async () => {
    const { panel } = await mountWith(
      response([
        item({ name: "repo", current: true }),
        item({ name: "other", path: "/repo/.worktrees/other" }),
      ]),
    );
    // 選んでいない行でも、その行の「…」から操作できる。
    const labels = openRowMenu(panel, 1);
    expect(labels).toContain(TEXT.open);
    expect(labels).toContain(TEXT.actions.openFolder);
    expect(labels).toContain(TEXT.actions.copyPath);
    expect(labels).toContain(TEXT.remove);
  });

  test("never offers to remove the worktree this server serves", async () => {
    const { panel } = await mountWith(
      response([item({ name: "repo", current: true })]),
    );
    expect(openRowMenu(panel, 0)).not.toContain(TEXT.remove);
  });

  test("offers to stop a running server, and asks the server to stop it", async () => {
    const { panel, posts } = await mountWith(
      response([
        item({ name: "repo", current: true }),
        item({
          name: "other",
          path: "/repo/.worktrees/other",
          serverUrl: "http://127.0.0.1:5050/",
        }),
      ]),
    );
    openRowMenu(panel, 1);
    menuItem(TEXT.actions.stopServer).click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(posts).toContainEqual({
      url: "/_worktree/stop",
      body: { path: "/repo/.worktrees/other" },
    });
  });

  test("never offers to stop the server that is serving this screen", async () => {
    const { panel } = await mountWith(
      response([
        item({
          name: "repo",
          current: true,
          serverUrl: "http://127.0.0.1:64160/",
        }),
      ]),
    );
    expect(openRowMenu(panel, 0)).not.toContain(TEXT.actions.stopServer);
  });

  test("closes the menu when the screen goes away", async () => {
    const { panel, view } = await mountWith(
      response([
        item({ name: "repo", current: true }),
        item({ name: "other", path: "/repo/.worktrees/other" }),
      ]),
    );
    openRowMenu(panel, 1);
    expect(document.querySelector(".gdp-context-menu")).not.toBeNull();
    // メニューは body 直下に居るので、畳んだ画面と一緒には消えない。
    view.suspend();
    expect(document.querySelector(".gdp-context-menu")).toBeNull();
  });
});

describe("merge command", () => {
  const clean = {
    base: "main",
    ahead: 2,
    behind: 0,
    mergeState: "clean" as const,
    conflicts: [],
  };

  function mergeButtons(panel: HTMLElement): HTMLButtonElement[] {
    return Array.from(
      panel.querySelectorAll<HTMLButtonElement>(".meta2 > .gdp-copy-path"),
    );
  }

  test("copies the command that merges a clean worktree back", async () => {
    const writes: string[] = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: (value: string) => {
          writes.push(value);
          return Promise.resolve();
        },
      },
    });
    const { panel } = await mountWith(
      response([
        item({
          name: "other",
          path: "/repo/.worktrees/other",
          branch: "feature-x",
          divergence: clean,
        }),
      ]),
    );
    const [button] = mergeButtons(panel);
    if (!button) throw new Error("merge copy button is missing");
    expect(button.title).toBe(TEXT.actions.copyMergeTitle("main", "feature-x"));
    button.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(writes).toEqual(["git switch main && git merge feature-x"]);
  });

  test("stays out of rows that would conflict or cannot be compared", async () => {
    const { panel } = await mountWith(
      response([
        item({
          name: "conflicting",
          path: "/repo/.worktrees/conflicting",
          branch: "feature-y",
          divergence: {
            ...clean,
            mergeState: "conflict",
            conflicts: ["src/sample.ts"],
          },
        }),
        item({
          name: "unknown",
          path: "/repo/.worktrees/unknown",
          branch: "feature-z",
          divergence: { ...clean, mergeState: "unknown" },
        }),
        item({ name: "plain", path: "/repo/.worktrees/plain" }),
      ]),
    );
    expect(mergeButtons(panel)).toHaveLength(0);
  });

  test("stays out of a detached worktree, which has no branch to merge", async () => {
    const { panel } = await mountWith(
      response([
        item({
          name: "detached",
          path: "/repo/.worktrees/detached",
          branch: "",
          detached: true,
          divergence: clean,
        }),
      ]),
    );
    expect(mergeButtons(panel)).toHaveLength(0);
  });
});

describe("remove dialog", () => {
  function openDialog(): HTMLElement {
    const backdrop = document.querySelector<HTMLElement>(
      ".gdp-dialog-backdrop",
    );
    if (!backdrop) throw new Error("no dialog open");
    return backdrop;
  }

  async function openRemoveDialog(
    list: WorktreesResponse,
    wt: string,
  ): Promise<Mounted> {
    const mounted = await mountWith(list, { route: { wt } });
    // 削除はその行のメニューの中にある。
    const rows = Array.from(
      mounted.panel.querySelectorAll<HTMLElement>(".history-item"),
    );
    const index = rows.findIndex((row) => row.dataset.wt === wt);
    if (index < 0) throw new Error(`no row for ${wt}`);
    openRowMenu(mounted.panel, index);
    const button = menuItem(TEXT.remove);
    button.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    return mounted;
  }

  function dialogSubmit(dialog: HTMLElement): HTMLButtonElement {
    const buttons = dialog.querySelectorAll<HTMLButtonElement>(
      ".gdp-dialog-actions button",
    );
    const submit = buttons[buttons.length - 1];
    if (!submit) throw new Error("submit button is missing");
    return submit;
  }

  async function flush(): Promise<void> {
    for (let i = 0; i < 8; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  test("says the folder is deleted from disk and cannot be undone", async () => {
    await openRemoveDialog(
      response([
        item({ name: "repo", current: true }),
        item({
          name: "feature-x",
          path: "/repo/.worktrees/feature-x",
          branch: "feature-x",
        }),
      ]),
      "/repo/.worktrees/feature-x",
    );
    const dialog = openDialog();
    const text = dialog.textContent || "";
    expect(text).toContain('Delete the worktree "feature-x"?');
    expect(text).toContain("/repo/.worktrees/feature-x");
    expect(text).toContain("cannot be undone");
    expect(text).toContain("The branch feature-x");
    // 削除は不可逆なので確定ボタンは常に危険色。
    expect(dialogSubmit(dialog).classList.contains("gdp-dialog-danger")).toBe(
      true,
    );
    // 変更が無いのに強制の選択肢は出さない。
    expect(dialog.querySelector("input[type=checkbox]")).toBeNull();
  });

  test("blocks the submit until the dirty checkbox is checked", async () => {
    const mounted = await openRemoveDialog(
      response([
        item({ name: "repo", current: true }),
        item({
          name: "feature-x",
          path: "/repo/.worktrees/feature-x",
          branch: "feature-x",
          files: [file()],
        }),
      ]),
      "/repo/.worktrees/feature-x",
    );
    const dialog = openDialog();
    // 警告は最初から出ている。チェックで出現させない。
    expect(dialog.textContent).toContain("will lose them");
    const checkbox = dialog.querySelector<HTMLInputElement>(
      "input[type=checkbox]",
    );
    if (!checkbox) throw new Error("force checkbox is missing");
    const submit = dialogSubmit(dialog);

    submit.click();
    await flush();
    expect(dialog.querySelector(".gdp-dialog-error")?.textContent).toBe(
      TEXT.removeDialog.forceRequired,
    );
    expect(mounted.posts).toHaveLength(0);

    checkbox.checked = true;
    submit.click();
    await flush();
    expect(mounted.posts).toEqual([
      {
        url: "/_worktree/remove",
        body: { path: "/repo/.worktrees/feature-x", force: true },
      },
    ]);
  });

  test("says only the git entry is removed when the folder is gone", async () => {
    await openRemoveDialog(
      response([
        item({ name: "repo", current: true }),
        item({
          name: "feature-x",
          path: "/repo/.worktrees/feature-x",
          branch: "feature-x",
          missing: true,
        }),
      ]),
      "/repo/.worktrees/feature-x",
    );
    const text = openDialog().textContent || "";
    expect(text).toContain('Remove the entry for "feature-x"?');
    expect(text).toContain("already gone from disk");
    // ディスクから消えるとは言えないので、不可逆の文言も出さない。
    expect(text).not.toContain("cannot be undone");
  });

  test("counts the other stale entries that prune will also remove", async () => {
    await openRemoveDialog(
      response([
        item({ name: "repo", current: true }),
        item({
          name: "feature-x",
          path: "/repo/.worktrees/feature-x",
          branch: "feature-x",
          missing: true,
        }),
        item({
          name: "feature-y",
          path: "/repo/.worktrees/feature-y",
          branch: "feature-y",
          missing: true,
        }),
      ]),
      "/repo/.worktrees/feature-x",
    );
    // prune は対象を絞れないので、まとめて消える件数を先に伝える。
    expect(openDialog().textContent).toContain(
      TEXT.removeDialog.missingOthers(1),
    );
  });

  test("leaves locked entries out of the count, because prune skips them", async () => {
    await openRemoveDialog(
      response([
        item({ name: "repo", current: true }),
        item({
          name: "feature-x",
          path: "/repo/.worktrees/feature-x",
          branch: "feature-x",
          missing: true,
        }),
        item({
          name: "feature-y",
          path: "/repo/.worktrees/feature-y",
          branch: "feature-y",
          missing: true,
          locked: true,
        }),
      ]),
      "/repo/.worktrees/feature-x",
    );
    // ロックされた登録は prune が飛ばすので、まとめて消える数に入れない。
    expect(openDialog().textContent).not.toContain(
      TEXT.removeDialog.missingOthers(1),
    );
  });

  test("says up front that a locked entry will not go away", async () => {
    await openRemoveDialog(
      response([
        item({ name: "repo", current: true }),
        item({
          name: "feature-x",
          path: "/repo/.worktrees/feature-x",
          branch: "feature-x",
          missing: true,
          locked: true,
        }),
      ]),
      "/repo/.worktrees/feature-x",
    );
    expect(openDialog().textContent).toContain(TEXT.removeDialog.lockedNote);
  });
});

describe("row actions", () => {
  test("shows no action until the menu is opened", async () => {
    const { panel } = await mountWith(
      response([
        item({ name: "repo", current: true }),
        item({
          name: "other",
          path: "/repo/.worktrees/other",
          branch: "other",
        }),
      ]),
      { route: { wt: "/repo/.worktrees/other" } },
    );
    // 行に並ぶボタンは「…」だけ。選んだ瞬間にボタンが増えると誤爆する。
    for (const row of panel.querySelectorAll(".history-item")) {
      expect(texts(row, "button")).toEqual([""]);
      expect(row.querySelector(".worktree-row-menu")).not.toBeNull();
    }
    // 一覧の上に固定した帯も持たない (削除が画面で一番目立つ位置に居座る)。
    expect(panel.querySelector(".worktree-actions")).toBeNull();
    expect(document.querySelector(".gdp-context-menu")).toBeNull();
  });

  test("puts delete below a separator, away from the everyday actions", async () => {
    const { panel } = await mountWith(
      response([
        item({ name: "repo", current: true }),
        item({ name: "other", path: "/repo/.worktrees/other" }),
      ]),
    );
    openRowMenu(panel, 1);
    const menu = document.querySelector(".gdp-context-menu");
    if (!menu) throw new Error("the menu did not open");
    const nodes = Array.from(menu.children);
    const separator = nodes.findIndex((node) =>
      node.classList.contains("gdp-context-menu-sep"),
    );
    const remove = nodes.findIndex((node) => node.textContent === TEXT.remove);
    expect(separator).toBeGreaterThan(-1);
    expect(remove).toBeGreaterThan(separator);
    expect(menuItem(TEXT.remove).classList.contains("danger")).toBe(true);
  });

  test("selects the worktree it just created", async () => {
    const mounted = await mountWith(
      response([
        item({ name: "repo", current: true }),
        item({
          name: "new-one",
          path: "/repo/.worktrees/new-one",
          branch: "new-one",
        }),
      ]),
      { postResponse: { path: "/repo/.worktrees/new-one" } },
    );
    const add = Array.from(
      mounted.panel.querySelectorAll<HTMLButtonElement>(
        "button.worktree-head-btn",
      ),
    ).find((candidate) => candidate.textContent === TEXT.add);
    if (!add) throw new Error("add button is missing");
    add.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const dialog = document.querySelector<HTMLElement>(".gdp-dialog-backdrop");
    if (!dialog) throw new Error("no dialog open");
    const input = dialog.querySelector<HTMLInputElement>("input");
    if (!input) throw new Error("name input is missing");
    input.value = "new-one";
    input.dispatchEvent(new Event("input"));
    const buttons = dialog.querySelectorAll<HTMLButtonElement>(
      ".gdp-dialog-actions button",
    );
    buttons[buttons.length - 1].click();
    for (let i = 0; i < 8; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    expect(lastRoute(mounted.routes)).toEqual({
      screen: "worktree",
      wt: "/repo/.worktrees/new-one",
      range: RANGE,
    });
  });
});

describe("empty diff guidance", () => {
  test("tells what to do next when a worktree has no changes yet", async () => {
    const { diff } = await mountWith(
      response([
        item({ name: "repo", current: true }),
        item({
          name: "fresh",
          path: "/repo/.worktrees/fresh",
          branch: "fresh",
        }),
      ]),
      { route: { wt: "/repo/.worktrees/fresh" } },
    );
    const card = diff.querySelector(".worktree-empty-diff");
    if (!card) throw new Error("empty diff card is missing");
    expect(card.textContent).toContain(TEXT.emptyDiff.title);
    expect(card.textContent).toContain("/repo/.worktrees/fresh");
    const labels = texts(card, "button");
    expect(labels).toContain(TEXT.actions.openFolder);
    expect(labels).toContain(TEXT.actions.copyPath);
  });
});

describe("first-run introduction", () => {
  test("shows the intro card only when there is exactly one worktree", async () => {
    const { diff } = await mountWith(
      response([item({ name: "repo", current: true })]),
    );
    const card = diff.querySelector(".worktree-intro");
    if (!card) throw new Error("intro card is missing");
    expect(card.textContent).toContain(TEXT.intro.cardTitle);
    expect(texts(card, "button")).toContain(TEXT.intro.cardButton);
  });

  test("falls back to the plain prompt once a second worktree exists", async () => {
    const { diff } = await mountWith(
      response([
        item({ name: "repo", current: true }),
        item({ name: "other", path: "/repo/.worktrees/other" }),
      ]),
    );
    expect(diff.querySelector(".worktree-intro")).toBeNull();
    expect(diff.textContent).toContain(TEXT.panes.selectWorktree);
  });

  test("says under the list that new worktrees will appear there", async () => {
    const { panel } = await mountWith(
      response([item({ name: "repo", current: true })]),
    );
    expect(texts(panel, ".history-status")).toContain(TEXT.intro.listNote);
  });

  test("opens the add dialog from the card", async () => {
    const { diff } = await mountWith(
      response([item({ name: "repo", current: true })]),
    );
    const button = Array.from(
      diff.querySelectorAll<HTMLButtonElement>(".worktree-intro button"),
    ).find((candidate) => candidate.textContent === TEXT.intro.cardButton);
    if (!button) throw new Error("intro button is missing");
    button.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(
      document.querySelector(".gdp-dialog-backdrop")?.textContent,
    ).toContain(TEXT.addDialog.title);
  });

  test("shows where the folder will be created, as the name is typed", async () => {
    const { panel } = await mountWith(
      response([item({ name: "repo", current: true })]),
    );
    const add = Array.from(
      panel.querySelectorAll<HTMLButtonElement>("button.worktree-head-btn"),
    ).find((button) => button.textContent === TEXT.add);
    if (!add) throw new Error("add button is missing");
    add.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const target = document.querySelector<HTMLElement>(".worktree-target-path");
    const name = document.querySelector<HTMLInputElement>(
      ".worktree-field .gdp-dialog-input",
    );
    if (!target || !name) throw new Error("add dialog is missing its fields");
    // 名前を入れる前は、末尾がまだ決まっていないことが分かる形で出す。
    expect(target.textContent).toBe(
      TEXT.addDialog.targetPending("/repo/.worktrees"),
    );
    name.value = "feature-x";
    name.dispatchEvent(new Event("input"));
    expect(target.textContent).toBe("/repo/.worktrees/feature-x");
  });
});

describe("overlap legend", () => {
  test("explains the mark when any file is shared, and stays quiet otherwise", async () => {
    const shared = await mountWith(
      response(
        [
          item({
            name: "repo",
            current: true,
            files: [file()],
          }),
          item({ name: "other", path: "/repo/.worktrees/other" }),
        ],
        {
          overlaps: [
            {
              path: "src/sample.ts",
              worktreeIds: ["/repo", "/repo/.worktrees/other"],
            },
          ],
        },
      ),
      { route: { wt: "/repo" } },
    );
    expect(texts(shared.filelist, ".worktree-overlap-legend")).toEqual([
      TEXT.intro.overlapLegend,
    ]);

    const quiet = await mountWith(
      response([
        item({ name: "repo", current: true, files: [file()] }),
        item({ name: "other", path: "/repo/.worktrees/other" }),
      ]),
      { route: { wt: "/repo" } },
    );
    expect(quiet.filelist.querySelector(".worktree-overlap-legend")).toBeNull();
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
      expected: `${TEXT.merge.clean} · ${TEXT.diverge.ahead(3, "main")} · ${TEXT.diverge.behind(2, "main")}`,
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
      expected: `${TEXT.merge.clean} · ${TEXT.diverge.even("main")}`,
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
      expected: `${TEXT.merge.conflict(2)} · ${TEXT.diverge.ahead(1, "main")}`,
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
      expected: `${TEXT.merge.unknown} · ${TEXT.diverge.ahead(1, "main")}`,
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
    // 2 本あれば初回説明ではなく、いつもの選択プロンプトが出る。
    const { diff, diffUrls } = await mountWith(
      response([
        item({ name: "repo" }),
        item({ name: "other", path: "/repo/.worktrees/other" }),
      ]),
    );
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

  test("names the base branch on each row instead of a note above the list", async () => {
    const { panel } = await mountWith(
      response(
        [
          item({
            divergence: {
              base: "main",
              ahead: 1,
              behind: 0,
              mergeState: "clean",
              conflicts: [],
            },
          }),
          item({ name: "other", path: "/repo/.worktrees/other" }),
        ],
        { baseBranch: "main" },
      ),
    );
    expect(texts(panel, ".history-item .author")).toContain(
      `${TEXT.merge.clean} · ${TEXT.diverge.ahead(1, "main")}`,
    );
    // 上部に「main と比較」の行は出さない。同じ情報が各行に載るため。
    expect(texts(panel, ".history-status")).toHaveLength(0);
  });

  test("says when no base branch could be found", async () => {
    const { panel } = await mountWith(response([item()], { baseBranch: "" }));
    expect(texts(panel, ".history-status")).toContain(TEXT.baseUnknown);
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
      openRowMenu(mounted.panel, 0);
      menuItem(TEXT.open).click();
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
