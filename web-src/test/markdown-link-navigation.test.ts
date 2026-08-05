import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import type { MarkdownNavigationTarget } from "../core/markdown-preview";
import type { AppRoute } from "../core/routes";
import {
  type MarkdownLinkNavigationDeps,
  openMarkdownLink,
} from "../views/markdown-link-navigation";

beforeAll(() => {
  GlobalRegistrator.register({ url: "http://localhost/?path=docs" });
});

afterAll(() => {
  GlobalRegistrator.unregister();
});

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

type Recorded = {
  routes: AppRoute[];
  repoLoads: number;
  opened: { path: string; ref: string }[];
  headRequests: string[];
};

function harness(headStatus?: number): {
  deps: MarkdownLinkNavigationDeps;
  recorded: Recorded;
} {
  const recorded: Recorded = {
    routes: [],
    repoLoads: 0,
    opened: [],
    headRequests: [],
  };
  globalThis.fetch = (async (input: string, init?: { method?: string }) => {
    recorded.headRequests.push(`${init?.method ?? "GET"} ${input}`);
    return new Response(null, { status: headStatus ?? 404 });
  }) as unknown as typeof fetch;
  return {
    recorded,
    deps: {
      setRoute(route) {
        recorded.routes.push(route);
      },
      currentRange: () => ({ from: "HEAD", to: "worktree" }),
      async loadRepo() {
        recorded.repoLoads++;
      },
      repoRoute: (ref, path) => ({
        screen: "repo",
        ref,
        path,
        range: { from: "HEAD", to: "worktree" },
      }),
      async renderStandaloneSource(target) {
        recorded.opened.push({ path: target.path, ref: target.ref });
        return undefined;
      },
      trackLoad: (promise) => promise,
      isAbortError: (err) =>
        err && typeof err === "object" && "name" in err
          ? (err as { name?: unknown }).name === "AbortError"
          : false,
    },
  };
}

function link(
  overrides: Partial<MarkdownNavigationTarget>,
): MarkdownNavigationTarget {
  return {
    path: "docs/guide.md",
    ref: "worktree",
    hash: "",
    directory: false,
    ...overrides,
  };
}

describe("markdown link navigation", () => {
  test.each([
    {
      name: "末尾スラッシュ付きのディレクトリ",
      target: { path: "docs/sub", directory: true },
    },
    {
      name: "リポジトリルート",
      target: { path: "", directory: true },
    },
  ])("opens the repository listing without asking the server: $name", async ({
    target,
  }) => {
    const { deps, recorded } = harness();
    await openMarkdownLink(link(target), deps);
    expect(recorded.routes.map((route) => route.screen)).toEqual(["repo"]);
    expect(recorded.repoLoads).toBe(1);
    expect(recorded.opened).toEqual([]);
    expect(recorded.headRequests).toEqual([]);
  });

  test.each([
    { name: "markdown", path: "docs/guide.md" },
    { name: "json", path: "docs/assets/data.json" },
    { name: "typescript source", path: "src/app.ts" },
  ])("opens a file with an extension directly: $name", async ({ path }) => {
    const { deps, recorded } = harness();
    await openMarkdownLink(link({ path }), deps);
    expect(recorded.routes).toEqual([
      {
        screen: "file",
        path,
        ref: "worktree",
        view: "blob",
        range: { from: "HEAD", to: "worktree" },
      },
    ]);
    expect(recorded.opened).toEqual([{ path, ref: "worktree" }]);
    expect(recorded.headRequests).toEqual([]);
  });

  test("opens the rendered preview and keeps the anchor for a markdown heading link", async () => {
    const { deps, recorded } = harness();
    await openMarkdownLink(
      link({ path: "docs/guide.md", hash: "section-two" }),
      deps,
    );
    expect(window.location.hash).toBe("#section-two");
    // Code タブのままだと見出しが描画されておらずアンカーが機能しない。
    expect(recorded.routes).toEqual([
      {
        screen: "file",
        path: "docs/guide.md",
        ref: "worktree",
        view: "blob",
        preview: true,
        range: { from: "HEAD", to: "worktree" },
      },
    ]);
  });

  test("does not force the preview tab for an anchor on a non-markdown file", async () => {
    const { deps, recorded } = harness();
    await openMarkdownLink(link({ path: "src/app.ts", hash: "L10" }), deps);
    expect(recorded.routes).toEqual([
      {
        screen: "file",
        path: "src/app.ts",
        ref: "worktree",
        view: "blob",
        range: { from: "HEAD", to: "worktree" },
      },
    ]);
  });

  test("asks the server when the path has neither a slash nor an extension, and treats a 404 as a directory", async () => {
    const { deps, recorded } = harness(404);
    await openMarkdownLink(link({ path: "docs/sub", directory: false }), deps);
    expect(recorded.headRequests).toEqual([
      "HEAD /_file?path=docs%2Fsub&ref=worktree",
    ]);
    expect(recorded.routes.map((route) => route.screen)).toEqual(["repo"]);
    expect(recorded.repoLoads).toBe(1);
  });

  test("treats an extension-less path the server can serve as a file", async () => {
    const { deps, recorded } = harness(200);
    await openMarkdownLink(link({ path: "LICENSE", directory: false }), deps);
    expect(recorded.headRequests).toEqual([
      "HEAD /_file?path=LICENSE&ref=worktree",
    ]);
    expect(recorded.routes.map((route) => route.screen)).toEqual(["file"]);
    expect(recorded.opened).toEqual([{ path: "LICENSE", ref: "worktree" }]);
  });

  test("falls back to the file view when the kind probe fails", async () => {
    const { deps, recorded } = harness();
    globalThis.fetch = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    await openMarkdownLink(link({ path: "docs/sub", directory: false }), deps);
    expect(recorded.routes.map((route) => route.screen)).toEqual(["file"]);
    expect(recorded.repoLoads).toBe(0);
  });

  // 500/403 は「ディレクトリだから読めなかった」の証拠にならない。tree
  // ビューへ倒すと空の一覧が出て真因が隠れるので blob ビューで見せる。
  test("treats a server error as a file rather than a directory", async () => {
    const { deps, recorded } = harness(500);
    await openMarkdownLink(link({ path: "docs/sub", directory: false }), deps);
    expect(recorded.routes.map((route) => route.screen)).toEqual(["file"]);
    expect(recorded.repoLoads).toBe(0);
  });

  test("abandons the navigation when the kind probe is aborted", async () => {
    const { deps, recorded } = harness();
    globalThis.fetch = (async () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      throw error;
    }) as unknown as typeof fetch;
    await openMarkdownLink(link({ path: "docs/sub", directory: false }), deps);
    // キャンセルされたのに遷移すると、止めたはずの画面遷移が後から起きる。
    expect(recorded.routes).toEqual([]);
    expect(recorded.repoLoads).toBe(0);
    expect(recorded.opened).toEqual([]);
  });

  // AGENTS.md Request Lifecycle: 前のビュー向けの応答で次のビューを上書き
  // しない。判定を待つ間にユーザーが移動したら、その応答は捨てる。
  test("discards the probe result when the user navigated away while it was in flight", async () => {
    const { deps, recorded } = harness();
    globalThis.fetch = (async () => {
      // 判定の応答が返る直前に別画面へ移動した状況を再現する。
      history.replaceState(null, "", "/file?path=other.md&target=worktree");
      return new Response(null, { status: 404 });
    }) as unknown as typeof fetch;
    await openMarkdownLink(link({ path: "docs/sub", directory: false }), deps);
    expect(recorded.routes).toEqual([]);
    expect(recorded.repoLoads).toBe(0);
    expect(recorded.opened).toEqual([]);
  });
});
