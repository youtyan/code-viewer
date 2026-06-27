import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import {
  type AppRoute,
  buildRoute,
  type DiffRange,
  type SourceLineTarget,
} from "../core/routes";
import type { SourceBlobTab } from "../views/file-shell";

GlobalRegistrator.register();

const { createBlameView } = await import("../views/blame-view");
const { isBlobOrBlameFileRoute } = await import("../views/file-shell");

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
        return json({
          diff:
            "diff --git a/README.md b/README.md\n" +
            "@@ -1,1 +1,1 @@\n" +
            "-one\n" +
            "+two\n",
        });
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

function activeSourceTab(): string | undefined {
  return document.querySelector<HTMLElement>(".gdp-source-tabs button.active")
    ?.dataset.sourceTab;
}

function tabLabels(): string[] {
  return Array.from(
    document.querySelectorAll<HTMLButtonElement>(".gdp-source-tabs button"),
  ).map((button) => button.textContent || "");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function testDeps(
  state: { route: AppRoute },
  sidebarCalls: SidebarCall[],
  preferredTabs: SourceBlobTab[] = [],
  appliedRoutes: AppRoute[] = [],
) {
  let dragStart: number | null = null;
  const sourceTargetMatches = (path: string, ref: string) =>
    state.route.screen === "file" &&
    state.route.path === path &&
    state.route.ref === ref;
  const lineInSourceTarget = (
    lineNumber: number,
    target: SourceLineTarget | undefined,
  ) => {
    if (!target) return false;
    if (typeof target === "number") return lineNumber === target;
    return lineNumber >= target.start && lineNumber <= target.end;
  };
  const syncHighlights = (card: HTMLElement) => {
    const target = state.route.screen === "file" ? state.route.line : undefined;
    card.querySelectorAll<HTMLElement>("[data-line]").forEach((row) => {
      const line = Number(row.dataset.line || "0");
      row.classList.toggle(
        "gdp-source-line-target",
        lineInSourceTarget(line, target),
      );
    });
  };
  const setLineRoute = (
    card: HTMLElement,
    path: string,
    ref: string,
    line: SourceLineTarget,
  ) => {
    const route: AppRoute = {
      screen: "file",
      path,
      ref,
      view: state.route.screen === "file" ? state.route.view : "blame",
      range: RANGE,
      line,
    };
    state.route = route;
    window.history.replaceState(null, "", buildRoute(route));
    syncHighlights(card);
  };
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
    applyRouteFromLocation() {
      appliedRoutes.push(state.route);
    },
    setPageMode() {
      document.body.classList.toggle("gdp-file-detail-page", true);
    },
    currentRange: () => RANGE,
    trackLoad: <T>(promise: Promise<T>) => promise,
    getDiffLayout: () => "line-by-line",
    getIgnoreWhitespace: () => false,
    getSyntaxHighlight: () => true,
    getHljs: () => ({
      getLanguage: () => true,
      highlight: (code: string) => ({
        value: `<span class="tok">${escapeHtml(code || " ")}</span>`,
      }),
    }),
    loadSourceShikiHighlighter: () =>
      Promise.resolve({
        codeToHtml: () => "",
      }),
    sourceShikiLines: (textValue: string) =>
      textValue
        .split("\n")
        .map((line) => `<span class="tok">${escapeHtml(line || " ")}</span>`),
    inferLang: () => "markdown",
    currentSourceLineTarget(target: { path: string; ref: string }) {
      return sourceTargetMatches(target.path, target.ref) &&
        state.route.screen === "file"
        ? state.route.line
        : undefined;
    },
    lineInSourceTarget,
    bindSourceLineNumber(
      num: HTMLElement,
      card: HTMLElement,
      target: { path: string; ref: string },
      line: number,
    ) {
      num.addEventListener("mousedown", (event) => {
        event.preventDefault();
        dragStart = line;
        setLineRoute(card, target.path, target.ref, line);
      });
      num.addEventListener("mouseenter", () => {
        if (dragStart === null) return;
        const start = Math.min(dragStart, line);
        const end = Math.max(dragStart, line);
        setLineRoute(
          card,
          target.path,
          target.ref,
          start === end ? start : { start, end },
        );
      });
    },
    setPreferredSourceTab(tab: SourceBlobTab) {
      preferredTabs.push(tab);
    },
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
      return isBlobOrBlameFileRoute(state.route) ? state.route.ref : null;
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  (
    window as unknown as { happyDOM: { setURL(url: string): void } }
  ).happyDOM.setURL("http://localhost/");
  document.body.innerHTML =
    '<aside id="sidebar"><div id="filelist"></div></aside><main id="content"><div id="diff"></div></main>';
  Object.defineProperty(window, "Diff2HtmlUI", {
    configurable: true,
    writable: true,
    value: class {
      private readonly element: HTMLElement;

      constructor(element: HTMLElement) {
        this.element = element;
      }

      draw() {
        this.element.innerHTML =
          '<div class="d2h-file-wrapper"><div class="d2h-files-diff"><table class="d2h-diff-table"><tbody>' +
          '<tr><td class="d2h-code-linenumber">1</td><td class="d2h-code-line"><span class="d2h-code-line-prefix">-</span><span class="d2h-code-line-ctn hljs plaintext">one</span></td></tr>' +
          "</tbody></table></div></div>";
      }

      highlightCode() {
        const span =
          this.element.querySelector<HTMLElement>(".d2h-code-line-ctn");
        if (!span) return;
        span.classList.remove("plaintext");
        span.classList.add("language-markdown");
        span.innerHTML = '<span class="tok">one</span>';
      }
    },
  });
  installFetchMock();
});

afterAll(() => {
  GlobalRegistrator.unregister();
});

describe("file view shell routing", () => {
  test("blame direct render keeps the repository sidebar populated and uses source line selection", async () => {
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
    expect(activeSourceTab()).toBe("blame");
    expect(tabLabels()).toEqual(["Preview", "Code", "Blame", "History"]);
    expect(
      document.querySelector(".gdp-source-line-code.shiki .tok"),
    ).toBeTruthy();
    const lineNo = document.querySelector<HTMLElement>(
      ".gdp-source-line-number",
    );
    lineNo?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(window.location.pathname + window.location.search).toBe(
      "/file?path=README.md&target=worktree&view=blame&line=1",
    );
    expect(document.querySelector("tr.gdp-source-line-target")).toBeTruthy();
    expect(
      document.querySelector("#filelist [data-path='README.md']"),
    ).toBeTruthy();
    expect(sidebarCalls).toEqual([{ path: "README.md", ref: "worktree" }]);
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
    const preferredTabs: SourceBlobTab[] = [];
    const deps = testDeps(state, [], preferredTabs);
    const blame = createBlameView(deps);
    await blame.renderBlamePage({ path: "README.md", ref: "worktree" });
    await waitFor(() => activeFileView() === "blame");

    click(document.querySelector("[data-file-view='history']"));
    expect(window.location.pathname + window.location.search).toBe(
      "/file?path=README.md&target=worktree&view=history",
    );

    click(document.querySelector("[data-source-tab='preview']"));
    expect(window.location.pathname + window.location.search).toBe(
      "/file?path=README.md&target=worktree&view=blob&preview=1",
    );
    expect(preferredTabs[preferredTabs.length - 1]).toBe("preview");

    click(document.querySelector("[data-source-tab='code']"));
    expect(window.location.pathname + window.location.search).toBe(
      "/file?path=README.md&target=worktree&view=blob",
    );
    expect(preferredTabs[preferredTabs.length - 1]).toBe("code");
  });

  test("blame sha chip normalizes worktree ref and applies the history route", async () => {
    const state: { route: AppRoute } = {
      route: {
        screen: "file",
        path: "README.md",
        ref: "worktree",
        view: "blame",
        range: RANGE,
      } satisfies AppRoute,
    };
    const appliedRoutes: AppRoute[] = [];
    const deps = testDeps(state, [], [], appliedRoutes);
    const blame = createBlameView(deps);
    await blame.renderBlamePage({ path: "README.md", ref: "worktree" });
    await waitFor(() => !!document.querySelector(".gdp-blame-sha[data-sha]"));

    click(document.querySelector(".gdp-blame-sha[data-sha]"));

    expect(state.route).toEqual({
      screen: "history",
      ref: "HEAD",
      commit: SHA,
      range: RANGE,
    });
    expect(window.location.pathname + window.location.search).toBe(
      `/history?commit=${SHA}`,
    );
    expect(appliedRoutes).toEqual([state.route]);
  });

  test("previewable file tabs include Preview while non-previewable file tabs do not", async () => {
    const state: { route: AppRoute } = {
      route: {
        screen: "file",
        path: "package.json",
        ref: "worktree",
        view: "blame",
        range: RANGE,
      } satisfies AppRoute,
    };
    const deps = testDeps(state, []);
    const blame = createBlameView(deps);
    await blame.renderBlamePage({ path: "package.json", ref: "worktree" });
    await waitFor(() => activeSourceTab() === "blame");

    expect(tabLabels()).toEqual(["Code", "Blame", "History"]);
  });

  test("blame ignores an older render response after a newer render wins", async () => {
    const firstBlame = deferred<Response>();
    const secondSha = "2222222222222222222222222222222222222222";
    let blameCalls = 0;
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      writable: true,
      value: (async (input: RequestInfo | URL) => {
        const url = new URL(String(input), "http://localhost");
        if (url.pathname === "/_file_blame") {
          blameCalls++;
          if (blameCalls === 1) return firstBlame.promise;
          return json({
            generation: 2,
            lines: [{ lineNo: 1, sha: secondSha, isUncommitted: false }],
            commits: {
              [secondSha]: {
                sha: secondSha,
                author: "Alice",
                authorMail: "alice@example.com",
                authorTime: 1_700_000_000,
                summary: "Newer render",
                isUncommitted: false,
              },
            },
          });
        }
        if (url.pathname === "/_file") return new Response("one\n");
        return json({});
      }) as typeof fetch,
    });
    const state: { route: AppRoute } = {
      route: {
        screen: "file",
        path: "README.md",
        ref: "worktree",
        view: "blame",
        range: RANGE,
      } satisfies AppRoute,
    };
    const blame = createBlameView(testDeps(state, []));

    const olderRender = blame.renderBlamePage({
      path: "README.md",
      ref: "worktree",
    });
    await waitFor(() => !!document.querySelector(".gdp-blame-loading"));
    const newerRender = blame.renderBlamePage({
      path: "README.md",
      ref: "worktree",
    });
    await waitFor(
      () =>
        document.querySelector(".gdp-blame-summary")?.textContent ===
        "Newer render",
    );
    firstBlame.resolve(
      json({
        generation: 1,
        lines: [{ lineNo: 1, sha: SHA, isUncommitted: false }],
        commits: {
          [SHA]: {
            sha: SHA,
            author: "Alice",
            authorMail: "alice@example.com",
            authorTime: 1_700_000_000,
            summary: "Older render",
            isUncommitted: false,
          },
        },
      }),
    );
    await Promise.all([olderRender, newerRender]);

    expect(document.querySelector(".gdp-blame-summary")?.textContent).toBe(
      "Newer render",
    );
  });
});
