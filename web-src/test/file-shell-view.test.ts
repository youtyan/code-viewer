import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { type AppRoute, buildRoute, type DiffRange } from "../core/routes";

GlobalRegistrator.register();

const { createBlameView } = await import("../views/blame-view");
const { createFileHistoryView } = await import("../views/file-history-view");
const { isRepositoryFileViewRoute } = await import("../views/file-shell");

const RANGE: DiffRange = { from: "HEAD", to: "worktree" };
const SHA = "1111111111111111111111111111111111111111";

type SidebarCall = { path: string; ref: string };

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function installFetchMock(): void {
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    writable: true,
    value: (async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");
      if (url.pathname === "/_file_blame") {
        return json({
          lines: [{ lineNo: 1, sha: SHA, isUncommitted: false }],
          commits: {
            [SHA]: {
              sha: SHA,
              author: "Alice",
              authorMail: "alice@example.com",
              authorTime: 1_700_000_000,
              summary: "Initial commit",
              isUncommitted: false,
            },
          },
        });
      }
      if (url.pathname === "/_file") return new Response("one\n");
      if (url.pathname === "/_log") {
        return json({
          commits: [
            {
              sha: SHA,
              subject: "Initial commit",
              author: "Alice",
              when: "2026-06-01T00:00:00.000Z",
              parents: ["0000000000000000000000000000000000000000"],
              body: "",
            },
          ],
          hasMore: false,
        });
      }
      if (url.pathname === "/file_diff")
        return json({ diff: "diff --git a/README.md b/README.md\n" });
      return json({});
    }) as typeof fetch,
  });
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 2000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("waitFor timed out");
}

function click(el: Element | null | undefined): void {
  (el as HTMLElement | null)?.dispatchEvent(
    new Event("click", { bubbles: true }),
  );
}

function activeFileView(): string | undefined {
  return document.querySelector<HTMLElement>(".gdp-source-tabs button.active")
    ?.dataset.fileView;
}

function testDeps(state: { route: AppRoute }, sidebarCalls: SidebarCall[]) {
  return {
    $: <T extends Element = HTMLElement>(sel: string) => {
      const el = document.querySelector<T>(sel);
      if (!el) throw new Error(`missing ${sel}`);
      return el;
    },
    STATE: state,
    setRoute(route: AppRoute, replace?: boolean) {
      state.route = route;
      const url = buildRoute(route);
      if (replace) window.history.replaceState(null, "", url);
      else window.history.pushState(null, "", url);
    },
    setPageMode() {
      document.body.classList.toggle("gdp-file-detail-page", true);
    },
    currentRange: () => RANGE,
    trackLoad: <T>(promise: Promise<T>) => promise,
    createFileBreadcrumb(path: string) {
      const span = document.createElement("span");
      span.textContent = path;
      return span;
    },
    removeStandaloneSource() {
      document.querySelectorAll(".gdp-repo-blob-layout").forEach((el) => {
        el.remove();
      });
    },
    placeSidebarToggle() {
      document.body.dataset.sidebarPlaced = "1";
    },
    escapeHtml: (value: unknown) => String(value),
    repoFileTargetFromRoute() {
      return isRepositoryFileViewRoute(state.route) ? state.route.ref : null;
    },
    renderRepoBlobSidebar(path: string, ref: string) {
      sidebarCalls.push({ path, ref });
      const filelist = document.querySelector<HTMLElement>("#filelist");
      if (filelist) {
        const row = document.createElement("button");
        row.dataset.path = path;
        row.textContent = path;
        filelist.replaceChildren(row);
      }
      return Promise.resolve();
    },
  };
}

beforeEach(() => {
  (
    window as unknown as { happyDOM: { setURL(url: string): void } }
  ).happyDOM.setURL("http://localhost/");
  document.body.innerHTML =
    '<aside id="sidebar"><div id="filelist"></div></aside><main id="content"><div id="diff"></div></main>';
  installFetchMock();
});

afterAll(() => {
  GlobalRegistrator.unregister();
});

describe("file view shell routing", () => {
  test("blame and history direct renders keep the repository sidebar populated", async () => {
    const state: { route: AppRoute } = {
      route: {
        screen: "file",
        path: "README.md",
        ref: "worktree",
        view: "blame",
        range: RANGE,
      } satisfies AppRoute,
    };
    const sidebarCalls: SidebarCall[] = [];
    const deps = testDeps(state, sidebarCalls);
    const blame = createBlameView(deps);

    await blame.renderBlamePage({ path: "README.md", ref: "worktree" });
    await waitFor(() => !!document.querySelector(".gdp-blame-table"));

    expect(activeFileView()).toBe("blame");
    expect(
      document.querySelector("#filelist [data-path='README.md']"),
    ).toBeTruthy();
    expect(sidebarCalls).toEqual([{ path: "README.md", ref: "worktree" }]);

    state.route = {
      screen: "file",
      path: "README.md",
      ref: "worktree",
      view: "history",
      range: RANGE,
    };
    const historyView = createFileHistoryView(deps);
    await historyView.renderHistoryPage({ path: "README.md", ref: "worktree" });
    await waitFor(() => !!document.querySelector(".gdp-file-history-list"));

    expect(activeFileView()).toBe("history");
    expect(
      document.querySelector("#filelist [data-path='README.md']"),
    ).toBeTruthy();
    expect(sidebarCalls[sidebarCalls.length - 1]).toEqual({
      path: "README.md",
      ref: "worktree",
    });
  });

  test("file view tabs push canonical URLs when moving blame to history to code", async () => {
    const state: { route: AppRoute } = {
      route: {
        screen: "file",
        path: "README.md",
        ref: "worktree",
        view: "blame",
        range: RANGE,
      } satisfies AppRoute,
    };
    const deps = testDeps(state, []);
    const blame = createBlameView(deps);
    await blame.renderBlamePage({ path: "README.md", ref: "worktree" });
    await waitFor(() => activeFileView() === "blame");

    click(document.querySelector("[data-file-view='history']"));
    expect(window.location.pathname + window.location.search).toBe(
      "/file?path=README.md&target=worktree&view=history",
    );

    const historyView = createFileHistoryView(deps);
    await historyView.renderHistoryPage({ path: "README.md", ref: "worktree" });
    await waitFor(() => activeFileView() === "history");

    click(document.querySelector("[data-file-view='blob']"));
    expect(window.location.pathname + window.location.search).toBe(
      "/file?path=README.md&target=worktree",
    );
  });
});
