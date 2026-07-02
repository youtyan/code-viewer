import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { AnnotationsUiDeps } from "../views/annotations-ui";
import { createAnnotationsUi } from "../views/annotations-ui";
import { q } from "./_test-helpers";

beforeAll(() => {
  GlobalRegistrator.register();
});

afterAll(() => {
  GlobalRegistrator.unregister();
});

afterEach(() => {
  document.body.innerHTML = "";
  window.history.replaceState(null, "", "/");
});

function setupDom() {
  document.body.innerHTML = `
    <aside id="annotation-panel" hidden>
      <button id="annotations-toggle" type="button"></button>
      <button id="annotation-panel-close" type="button"></button>
      <button id="annotation-capture-db" type="button" hidden></button>
      <input id="annotation-follow" type="checkbox" />
      <button id="annotation-clear" type="button"></button>
      <span id="annotations-count"></span>
      <span id="annotation-list-count"></span>
      <div id="annotation-sessions"></div>
      <div id="annotation-detail" hidden>
        <div class="annotation-detail-head">
          <span id="annotation-detail-session"></span>
          <span id="annotation-detail-time"></span>
          <span id="annotation-detail-step"></span>
          <button id="annotation-detail-prev" type="button" title="legacy">‹</button>
          <button id="annotation-detail-next" type="button" title="legacy">›</button>
          <button id="annotation-detail-close" type="button">close</button>
        </div>
        <a id="annotation-detail-location" href="#"></a>
        <div id="annotation-detail-body"></div>
      </div>
    </aside>
  `;
}

function createDeps(
  overrides: Partial<AnnotationsUiDeps> = {},
): AnnotationsUiDeps {
  return {
    $: <T extends Element = HTMLElement>(sel: string) => q<T>(document, sel),
    diffCardSelector: () => "",
    diffRowLineNumber: () => null,
    focusDiffLine: () => false,
    scrollDiffElementIntoView: () => undefined,
    expandAllFileContext: () => Promise.resolve(),
    loadDiffFile: () => Promise.resolve(false),
    scrollToFile: () => undefined,
    renderStandaloneSource: () => Promise.resolve(undefined),
    removeStandaloneSource: () => undefined,
    cancelActiveSourceLoad: () => false,
    setRoute: () => undefined,
    setPageMode: () => undefined,
    syncRefInputs: () => undefined,
    load: () => Promise.resolve(undefined),
    currentRange: () => ({ from: "HEAD~1", to: "HEAD" }),
    getFiles: () => [],
    getRoute: () => ({ screen: "diff", range: { from: "HEAD~1", to: "HEAD" } }),
    setRange: () => undefined,
    getAnnotationPanelOpen: () => false,
    setAnnotationPanelOpenState: () => undefined,
    getAnnotationPanelWidth: () => undefined,
    setAnnotationPanelWidth: () => undefined,
    getAnnotationFollow: () => false,
    setAnnotationFollow: () => undefined,
    leaveDatabaseView: () => undefined,
    openDatabaseAnnotation: () => Promise.resolve(),
    captureDatabaseAnnotationTarget: () => null,
    ...overrides,
  };
}

describe("annotations detail panel nav buttons", () => {
  test("renders icon-only prev/next controls with accessible labels", () => {
    setupDom();
    createAnnotationsUi(createDeps());

    const prev = q<HTMLButtonElement>(document, "#annotation-detail-prev");
    const next = q<HTMLButtonElement>(document, "#annotation-detail-next");

    expect(prev.querySelector("svg.octicon-skip-back")).toBeTruthy();
    expect(next.querySelector("svg.octicon-skip-forward")).toBeTruthy();
    expect([prev, next].map((el) => el.textContent).join("")).toBe("");
    expect(prev.getAttribute("aria-label")).toBe("previous annotation");
    expect(next.getAttribute("aria-label")).toBe("next annotation");
    expect(prev.title).toBe("previous annotation");
    expect(next.title).toBe("next annotation");
  });
});

describe("inline annotation rendering", () => {
  test("keeps code inline annotations mounted while the annotation panel is open", async () => {
    setupDom();
    document.body.insertAdjacentHTML(
      "beforeend",
      `
        <article class="gdp-file-shell loaded" data-path="sample.ts">
          <table class="d2h-diff-table">
            <tbody>
              <tr><td class="d2h-code-linenumber d2h-ins"><span class="line-num2">1</span></td><td>one</td></tr>
              <tr><td class="d2h-code-linenumber d2h-ins"><span class="line-num2">2</span></td><td>two</td></tr>
            </tbody>
          </table>
        </article>
      `,
    );
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      ({
        ok: true,
        json: async () => ({
          version: 1,
          sessions: [
            {
              id: "session-1",
              title: "Sample session",
              created_at: "2026-01-01T00:00:00.000Z",
              entries: [
                {
                  id: "entry-1",
                  path: "sample.ts",
                  line: { start: 2, end: 2 },
                  range: { from: "HEAD", to: "worktree" },
                  title: "Sample note",
                  body: "Inline body",
                  created_at: "2026-01-01T00:00:00.000Z",
                },
              ],
            },
          ],
        }),
      }) as Response) as unknown as typeof fetch;
    try {
      const ui = createAnnotationsUi(
        createDeps({
          diffCardSelector: () => ".gdp-file-shell",
          diffRowLineNumber: (row) => {
            const raw =
              row.querySelector<HTMLElement>(".line-num2")?.textContent || "";
            const line = Number(raw.trim());
            return Number.isInteger(line) && line > 0 ? line : null;
          },
          getFiles: () => [
            {
              path: "sample.ts",
              additions: 1,
              deletions: 0,
              load_url: "/file_diff?path=sample.ts",
            },
          ],
        }),
      );

      await ui.refreshAnnotations();
      await ui.openAnnotationEntry("entry-1");

      expect(q<HTMLElement>(document, "#annotation-panel").hidden).toBe(false);
      const row = q<HTMLElement>(document, ".gdp-annotation-row");
      expect(row.textContent?.includes("Inline body")).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("falls back to source view when the target range is not an after-side diff change", async () => {
    setupDom();
    document.body.insertAdjacentHTML(
      "beforeend",
      `
        <article class="gdp-file-shell loaded diff-card" data-path="sample.ts">
          <div class="d2h-file-wrapper">
            <div class="d2h-file-side-diff">
              <table class="d2h-diff-table"><tbody>
                <tr><td class="d2h-code-side-linenumber d2h-del">10</td><td>removed</td></tr>
                <tr><td class="d2h-code-side-linenumber d2h-del">11</td><td>removed</td></tr>
              </tbody></table>
            </div>
            <div class="d2h-file-side-diff">
              <table class="d2h-diff-table"><tbody>
                <tr><td class="d2h-code-side-linenumber d2h-cntx">10</td><td>current</td></tr>
              </tbody></table>
            </div>
          </div>
        </article>
      `,
    );
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      ({
        ok: true,
        json: async () => ({
          version: 1,
          sessions: [
            {
              id: "session-1",
              title: "Sample session",
              created_at: "2026-01-01T00:00:00.000Z",
              entries: [
                {
                  id: "entry-1",
                  path: "sample.ts",
                  line: { start: 10, end: 11 },
                  range: { from: "HEAD", to: "worktree" },
                  title: "Stale diff target",
                  body: "Source body",
                  created_at: "2026-01-01T00:00:00.000Z",
                },
              ],
            },
          ],
        }),
      }) as Response) as unknown as typeof fetch;
    const renderedSources: Array<{ path: string; ref: string }> = [];
    const routes: Array<Parameters<AnnotationsUiDeps["setRoute"]>[0]> = [];
    try {
      const ui = createAnnotationsUi(
        createDeps({
          diffCardSelector: () => ".gdp-file-shell",
          diffRowLineNumber: (row) => {
            const side = row.closest(".d2h-file-side-diff");
            const wrapper = row.closest(".d2h-file-wrapper");
            if (!side || !wrapper) return null;
            const sides = Array.from(
              wrapper.querySelectorAll(".d2h-file-side-diff"),
            );
            if (side !== sides[1]) return null;
            const raw =
              row.querySelector<HTMLElement>("td.d2h-code-side-linenumber")
                ?.textContent || "";
            const line = Number(raw.trim());
            return Number.isInteger(line) && line > 0 ? line : null;
          },
          getFiles: () => [
            {
              path: "sample.ts",
              additions: 0,
              deletions: 2,
              load_url: "/file_diff?path=sample.ts",
            },
          ],
          currentRange: () => ({ from: "HEAD", to: "worktree" }),
          setRoute: (route) => {
            routes.push(route);
          },
          renderStandaloneSource: async (target) => {
            renderedSources.push(target);
            q<HTMLElement>(document, ".diff-card").remove();
            document.body.insertAdjacentHTML(
              "beforeend",
              `
                <article class="gdp-file-shell gdp-standalone-source" data-path="sample.ts">
                  <table class="gdp-source-table"><tbody>
                    <tr data-line="11"><td>current source</td></tr>
                  </tbody></table>
                </article>
              `,
            );
          },
        }),
      );

      await ui.refreshAnnotations();
      await ui.openAnnotationEntry("entry-1");

      expect(renderedSources).toEqual([{ path: "sample.ts", ref: "worktree" }]);
      expect(routes.map((route) => route.screen)).toEqual(["file"]);
      expect(document.querySelector(".diff-card .gdp-annotation-row")).toBe(
        null,
      );
      const row = q<HTMLElement>(
        document,
        ".gdp-standalone-source .gdp-annotation-row",
      );
      expect(row.textContent?.includes("Source body")).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
