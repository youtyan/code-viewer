import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { AppRoute } from "../core/routes";
import type { SourceViewDeps } from "../views/source-view";
import { createSourceView } from "../views/source-view";

beforeAll(() => {
  GlobalRegistrator.register();
});

afterAll(() => {
  GlobalRegistrator.unregister();
});

afterEach(() => {
  document.body.innerHTML = "";
});

function createSourceViewForCursorTest(route: AppRoute) {
  const state: SourceViewDeps["STATE"] = {
    route,
    from: "HEAD",
    to: "worktree",
    syntaxHighlight: false,
  };
  return createSourceView({
    $: <T extends Element = HTMLElement>(sel: string): T => {
      const el = document.querySelector<T>(sel);
      if (!el) throw new Error(`missing ${sel}`);
      return el;
    },
    $$: <T extends Element = HTMLElement>(sel: string): T[] =>
      Array.from(document.querySelectorAll<T>(sel)),
    STATE: state,
    setRoute(nextRoute) {
      state.route = nextRoute;
    },
    setPageMode() {
      /* noop */
    },
    currentRange: () => ({ from: "HEAD", to: "worktree" }),
    trackLoad: (promise) => promise,
    isAbortError: () => false,
    loadRepo: async () => undefined,
    repoRoute: (ref, path) => ({
      screen: "repo",
      ref,
      path,
      range: { from: "HEAD", to: "worktree" },
    }),
    repoFileTargetFromRoute: () => null,
    renderRepoBlobSidebar: async () => undefined,
    placeSidebarToggle() {
      /* noop */
    },
    createFileBreadcrumb: () => document.createElement("nav"),
    createFileDetailMeta: () => document.createElement("div"),
    createOpenPathButton: () => document.createElement("button"),
    createMoveToTrashButton: () => document.createElement("button"),
    canTrashWorktreeRef: () => false,
    loadRawFileInfo: async () => ({
      type: "text",
      size: 0,
      metadata: {},
    }),
    loadSyntaxHighlighter: async () => null,
    setViewFileButtonState() {
      /* noop */
    },
    scrollMainPanel() {
      /* noop */
    },
    focusMainSurface() {
      /* noop */
    },
    isPaletteOpen: () => false,
  });
}

describe("source view cursor", () => {
  test.each([
    {
      name: "visible source table",
      html: `
        <main id="content">
          <table class="gdp-source-table"><tbody>
            <tr data-line="1"><td>line</td></tr>
          </tbody></table>
        </main>
      `,
      expected: 20,
    },
    {
      name: "hidden source table falls through to preview",
      html: `
        <main id="content">
          <table class="gdp-source-table" hidden><tbody>
            <tr data-line="1"><td>hidden</td></tr>
          </tbody></table>
          <div class="gdp-markdown-preview" style="line-height: 31px">preview</div>
        </main>
      `,
      expected: 31,
    },
  ])("reads the row height from the $name", ({ html, expected }) => {
    document.body.innerHTML = html;
    const route: AppRoute = {
      screen: "file",
      path: "src/example.ts",
      ref: "worktree",
      view: "blob",
      range: { from: "HEAD", to: "worktree" },
    };
    const view = createSourceViewForCursorTest(route);

    expect(view.sourceLineScrollAmount()).toBe(expected);
  });

  test("updates only rendered source rows when syncing the cursor", () => {
    document.body.innerHTML = `
      <main id="content">
        <table class="gdp-source-table"><tbody>
          <tr data-line="1" class="gdp-source-cursor"><td>old</td></tr>
          <tr data-line="2"><td>next</td></tr>
        </tbody></table>
        <div class="gdp-source-virtual-window">
          <div class="gdp-source-virtual-row" data-line="1"></div>
          <div class="gdp-source-virtual-row" data-line="2"></div>
          <div class="gdp-source-virtual-row gdp-source-cursor" data-line="3"></div>
        </div>
        <div class="gdp-annotation-row gdp-source-cursor" data-line="2"></div>
      </main>
    `;
    const route: AppRoute = {
      screen: "file",
      path: "src/example.ts",
      ref: "worktree",
      view: "blob",
      range: { from: "HEAD", to: "worktree" },
      line: 2,
    };
    const view = createSourceViewForCursorTest(route);
    const target = { path: "src/example.ts", ref: "worktree" };

    view.resetSourceCursorForTarget(target, 3);
    view.syncSourceCursorRows(target);

    expect(
      Array.from(
        document.querySelectorAll<HTMLElement>(
          ".gdp-source-table tr.gdp-source-cursor, .gdp-source-virtual-row.gdp-source-cursor",
        ),
      ).map((row) => row.dataset.line),
    ).toEqual(["2", "2"]);
    expect(
      document
        .querySelector<HTMLElement>(".gdp-annotation-row")
        ?.classList.contains("gdp-source-cursor"),
    ).toBe(true);
  });
});
