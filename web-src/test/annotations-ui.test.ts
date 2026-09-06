import { readFileSync } from "node:fs";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import type { AnnotationsUiDeps } from "../views/annotations-ui";
import { createAnnotationsUi } from "../views/annotations-ui";
import { clickDialogCancel, clickDialogConfirm } from "./_dialog-helpers";
import { deferred, q } from "./_test-helpers";

beforeAll(() => {
  GlobalRegistrator.register({ url: "http://localhost/" });
});

afterAll(() => {
  GlobalRegistrator.unregister();
});

let originalTestFetch: typeof fetch;
beforeEach(() => {
  originalTestFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ version: 1, sessions: [] }));
});

afterEach(() => {
  globalThis.fetch = originalTestFetch;
  document.body.innerHTML = "";
  document.body.className = "";
  window.history.replaceState(null, "", "/");
});

function setupDom() {
  document.body.innerHTML = `
    <aside id="annotation-panel" hidden>
      <button id="annotations-toggle" type="button"></button>
      <button id="annotation-panel-close" type="button"></button>
      <button id="annotation-add" type="button" hidden></button>
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
    diffCardSelector: () => ".missing-diff-card",
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

describe("annotation URL state", () => {
  test("writes panel and selected annotation state into the current URL", async () => {
    setupDom();
    window.history.replaceState(null, "", "/file?path=sample.ts");
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
                  body: "Sample body",
                  created_at: "2026-01-01T00:00:00.000Z",
                },
              ],
            },
          ],
        }),
      }) as Response) as unknown as typeof fetch;
    try {
      const ui = createAnnotationsUi(createDeps());
      await ui.refreshAnnotations();

      q<HTMLButtonElement>(document, "#annotations-toggle").click();
      expect(
        new URLSearchParams(window.location.search).get("annotations"),
      ).toBe("open");

      await ui.openAnnotationEntry("entry-1");
      const selectedParams = new URLSearchParams(window.location.search);
      expect(selectedParams.get("annotations")).toBe("open");
      expect(selectedParams.get("annotationSession")).toBe("session-1");
      expect(selectedParams.get("annotation")).toBe("entry-1");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test.each([
    {
      name: "open panel",
      url: "/file?path=sample.ts&annotations=open",
      expectedDetailHidden: true,
      expectedActiveEntry: null,
    },
    {
      name: "selected annotation",
      url: "/file?path=sample.ts&annotations=open&annotationSession=session-1&annotation=entry-1",
      expectedDetailHidden: false,
      expectedActiveEntry: "entry-1",
    },
  ])("restores $name after reload", async ({
    url,
    expectedDetailHidden,
    expectedActiveEntry,
  }) => {
    setupDom();
    window.history.replaceState(null, "", url);
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
                  body: "Sample body",
                  created_at: "2026-01-01T00:00:00.000Z",
                },
              ],
            },
          ],
        }),
      }) as Response) as unknown as typeof fetch;
    try {
      const ui = createAnnotationsUi(createDeps());
      await ui.refreshAnnotations();

      expect(q<HTMLElement>(document, "#annotation-panel").hidden).toBe(false);
      expect(q<HTMLElement>(document, "#annotation-detail").hidden).toBe(
        expectedDetailHidden,
      );
      expect(
        document.querySelector<HTMLElement>(".annotation-entries li.active")
          ?.dataset.entryId ?? null,
      ).toBe(expectedActiveEntry);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("inline annotation rendering", () => {
  test("dedupes concurrent annotation refresh requests", async () => {
    setupDom();
    const originalFetch = globalThis.fetch;
    const response = deferred<Response>();
    let fetchCount = 0;
    globalThis.fetch = (async () => {
      fetchCount++;
      return response.promise;
    }) as unknown as typeof fetch;
    try {
      const ui = createAnnotationsUi(createDeps());
      const first = ui.refreshAnnotations();
      const second = ui.refreshAnnotations();

      expect(fetchCount).toBe(1);

      response.resolve({
        ok: true,
        json: async () => ({ version: 1, sessions: [] }),
      } as Response);
      await Promise.all([first, second]);

      expect(fetchCount).toBe(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

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

  test("shows the walkthrough order on inline rows and the session head", async () => {
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
    const entry = (id: string, line: number, body: string) => ({
      id,
      path: "sample.ts",
      line: { start: line, end: line },
      range: { from: "HEAD", to: "worktree" },
      title: "",
      body,
      created_at: "2026-01-01T00:00:00.000Z",
    });
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
                entry("entry-1", 1, "First body"),
                entry("entry-2", 2, "Second body"),
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
      await ui.openAnnotationEntry("entry-2");

      // Each inline box carries a "n/total" chip in session order.
      const rows = [
        ...document.querySelectorAll<HTMLElement>(
          ".gdp-annotation-row:not(.gdp-annotation-spacer)",
        ),
      ];
      expect(rows.length).toBe(2);
      const chips = rows.map((row) =>
        row.querySelector<HTMLButtonElement>(".gdp-annotation-step"),
      );
      expect(chips.map((chip) => chip?.textContent)).toEqual(["1/2", "2/2"]);
      expect(rows[0].classList.contains("active")).toBe(false);
      expect(rows[1].classList.contains("active")).toBe(true);

      // Clicking the first chip opens that entry in the detail dock.
      chips[0]?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(q<HTMLElement>(document, "#annotation-detail").hidden).toBe(false);
      expect(
        q<HTMLElement>(document, "#annotation-detail-step").textContent,
      ).toBe("1/2");
      // Inline rows are rebuilt on navigation; re-query the active one.
      const activeRow = document.querySelector<HTMLElement>(
        ".gdp-annotation-row.active",
      );
      expect(activeRow?.dataset.annotationId).toBe("entry-1");

      // The session head shows the total step count.
      expect(
        q<HTMLElement>(document, ".annotation-session-count").textContent,
      ).toBe("2");
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

const noteSession = {
  id: "session-example",
  title: "Reading session",
  created_at: "2026-01-01T00:00:00.000Z",
  entries: [
    {
      id: "note-alpha",
      path: "src/example.ts",
      title: "Alpha",
      body: "First explanation\nDetailed finding",
    },
    {
      id: "note-beta",
      path: "src/second.ts",
      title: "Beta",
      body: "Second explanation",
    },
    {
      id: "note-gamma",
      path: "src/example.ts",
      title: "Gamma",
      body: "Third explanation",
    },
  ].map((entry) => ({
    ...entry,
    range: { from: "HEAD", to: "worktree" },
    line: { start: 2, end: 4 },
    created_at: "2026-01-01T00:00:00.000Z",
  })),
};

async function annotationHarness(overrides: Partial<AnnotationsUiDeps> = {}) {
  setupDom();
  const state = {
    version: 1 as const,
    sessions: [structuredClone(noteSession)],
  };
  globalThis.fetch = async () => new Response(JSON.stringify(state));
  const ui = createAnnotationsUi(
    createDeps({
      getRoute: () => ({
        screen: "file",
        path: "src/example.ts",
        ref: "worktree",
        range: { from: "HEAD", to: "worktree" },
        line: { start: 2, end: 4 },
      }),
      ...overrides,
    }),
  );
  await ui.refreshAnnotations();
  ui.setAnnotationPanelOpen(true);
  return { ui, state };
}

function inputNote(name: string, value: string) {
  const input = q<HTMLInputElement | HTMLTextAreaElement>(
    document,
    `.annotation-edit-form [name="${name}"]`,
  );
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  return input;
}

async function openNoteEditor(
  ui: ReturnType<typeof createAnnotationsUi>,
  edit = false,
) {
  if (edit) {
    await ui.openAnnotationEntry("note-alpha");
    q<HTMLButtonElement>(document, '[aria-label="Edit note"]').click();
  } else q<HTMLButtonElement>(document, "#annotation-add").click();
  await vi.waitFor(() =>
    expect(document.querySelector(".annotation-edit-form")).toBeTruthy(),
  );
}

const searchQueries = [
  "",
  "no match",
  "ALPHA",
  "detailed FINDING",
  "reading SESSION",
  "src/SECOND.ts",
  ...["Alpha", "Beta", "Gamma"].flatMap((word) =>
    Array.from({ length: word.length }, (_, index) =>
      word.slice(0, index + 1).toUpperCase(),
    ),
  ),
];

describe("annotation library workflow", () => {
  test.each(
    searchQueries,
  )("searches the complete library for %j and keeps original step numbers", async (query) => {
    await annotationHarness();
    const input = q<HTMLInputElement>(document, "#annotation-search");
    input.value = query;
    input.dispatchEvent(new Event("input"));
    const literal = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const oracle = new RegExp(literal, "i");
    const expected = noteSession.entries.filter((entry) =>
      oracle.test(
        [noteSession.title, entry.title, entry.body, entry.path].join("\n"),
      ),
    );
    expect(
      [...document.querySelectorAll<HTMLElement>(".annotation-entries li")].map(
        (row) => row.dataset.entryId,
      ),
    ).toEqual(expected.map((entry) => entry.id));
    expect(
      [...document.querySelectorAll<HTMLElement>(".annotation-entry-open")].map(
        (button) => Number(button.dataset.step),
      ),
    ).toEqual(expected.map((entry) => noteSession.entries.indexOf(entry) + 1));
    expect(q(document, "#annotation-list-count").textContent).toBe(
      `${expected.length} / 3 notes`,
    );
  });

  test("scopes notes to the current file and restores all locations", async () => {
    await annotationHarness();
    q<HTMLButtonElement>(document, "#annotation-scope-current").click();
    expect(
      [...document.querySelectorAll<HTMLElement>(".annotation-entries li")].map(
        (row) => row.dataset.entryId,
      ),
    ).toEqual(["note-alpha", "note-gamma"]);
    q<HTMLButtonElement>(document, "#annotation-scope-all").click();
    expect(document.querySelectorAll(".annotation-entry-open")).toHaveLength(3);
  });

  test("collapses sessions while search reveals matching entries", async () => {
    const { ui } = await annotationHarness();
    q<HTMLButtonElement>(document, ".annotation-session-collapse").click();
    expect(q<HTMLElement>(document, ".annotation-entries").hidden).toBe(true);
    const search = q<HTMLInputElement>(document, "#annotation-search");
    search.value = "Gamma";
    search.dispatchEvent(new Event("input"));
    expect(q<HTMLElement>(document, ".annotation-entries").hidden).toBe(false);
    await ui.openAnnotationEntry("note-gamma");
    q<HTMLButtonElement>(document, "#annotation-detail-close").click();
    await vi.waitFor(() =>
      expect(q<HTMLElement>(document, "#annotation-detail").hidden).toBe(true),
    );
    expect(search.value).toBe("Gamma");
    expect(document.querySelectorAll(".annotation-entry-open")).toHaveLength(1);
  });
});

describe("annotation editor workflow", () => {
  test.each([
    false,
    true,
  ])("preserves Markdown when switching preview and refreshing (edit=%s)", async (edit) => {
    const { ui, state } = await annotationHarness({
      getAnnotationFollow: () => true,
    });
    await openNoteEditor(ui, edit);
    const body = inputNote("body", "## Finding\n\n**Keep this draft**");
    q<HTMLButtonElement>(
      document,
      ".annotation-editor-tabs button:last-child",
    ).click();
    expect(q(document, ".annotation-editor-preview h2").textContent).toBe(
      "Finding #",
    );
    expect(q(document, ".annotation-editor-preview strong").textContent).toBe(
      "Keep this draft",
    );
    state.sessions[0].entries[0].body = "Background update";
    ui.handleSse(JSON.stringify({ kind: "add", entry_id: "note-beta" }));
    await ui.refreshAnnotations();
    expect(q(document, '.annotation-edit-form [name="body"]')).toBe(body);
    expect(body.value).toBe("## Finding\n\n**Keep this draft**");
    expect(ui.getActiveSessionEntries()).toEqual([]);
    q<HTMLButtonElement>(
      document,
      ".annotation-editor-tabs button:first-child",
    ).click();
    expect(body.hidden).toBe(false);
  });

  test.each([
    { start: "", end: "", valid: true, line: undefined },
    { start: "1", end: "", valid: true, line: { start: 1, end: 1 } },
    { start: "2", end: "4", valid: true, line: { start: 2, end: 4 } },
    { start: "4", end: "2", valid: false },
    { start: "", end: "2", valid: false },
    { start: "0", end: "2", valid: false },
    { start: "1.5", end: "2", valid: false },
  ])("validates line bounds $start–$end before saving", async ({
    start,
    end,
    valid,
    line,
  }) => {
    const { ui, state } = await annotationHarness();
    const posted: Record<string, unknown>[] = [];
    globalThis.fetch = async (_input, init) => {
      if (init?.method === "POST") {
        const payload = JSON.parse(String(init.body));
        posted.push(payload);
        return new Response(
          JSON.stringify({
            entry: state.sessions[0].entries[0],
            session_id: noteSession.id,
            session_title: noteSession.title,
          }),
        );
      }
      return new Response(JSON.stringify(state));
    };
    await openNoteEditor(ui);
    inputNote("body", "A new note");
    inputNote("start", start);
    inputNote("end", end);
    q<HTMLFormElement>(document, ".annotation-edit-form").dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
    await vi.waitFor(() => expect(posted.length).toBe(valid ? 1 : 0));
    if (valid) {
      expect(posted[0]).toMatchObject({
        action: "add",
        path: "src/example.ts",
        body: "A new note",
        range: { from: "HEAD~1", to: "worktree" },
      });
      expect(posted[0].line).toEqual(line);
    } else
      expect(
        q<HTMLFormElement>(document, ".annotation-edit-form").checkValidity(),
      ).toBe(false);
  });

  test("captures the data target including filters without adding a code line", async () => {
    const target = {
      kind: "database" as const,
      db: "sample.db",
      table: "sample_table",
      tab: "data" as const,
      data: { search: "example" },
    };
    const { ui, state } = await annotationHarness({
      getRoute: () => ({
        screen: "database",
        db: target.db,
        table: target.table,
        tab: "data",
        range: { from: "HEAD", to: "worktree" },
      }),
      captureDatabaseAnnotationTarget: () => target,
    });
    const posted: Record<string, unknown>[] = [];
    globalThis.fetch = async (_input, init) => {
      if (init?.method === "POST") {
        posted.push(JSON.parse(String(init.body)));
        return new Response(
          JSON.stringify({
            entry: state.sessions[0].entries[0],
            session_id: noteSession.id,
          }),
        );
      }
      return new Response(JSON.stringify(state));
    };
    await openNoteEditor(ui);
    expect(
      document.querySelector('.annotation-edit-form [name="path"]'),
    ).toBeNull();
    inputNote("body", "Data finding");
    q<HTMLFormElement>(document, ".annotation-edit-form").requestSubmit();
    await vi.waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toMatchObject({
      action: "add",
      target,
      body: "Data finding",
    });
    expect(posted[0].line).toBeUndefined();
  });

  test("keeps the full error and draft after a rejected save and permits correction", async () => {
    const { ui } = await annotationHarness();
    await openNoteEditor(ui);
    const body = inputNote("body", "Keep this input");
    const errors = {
      errors: [
        { code: "first", field: "body" },
        { code: "second", field: "path" },
      ],
    };
    globalThis.fetch = async () =>
      new Response(JSON.stringify(errors), { status: 400 });
    const form = q<HTMLFormElement>(document, ".annotation-edit-form");
    form.requestSubmit();
    await vi.waitFor(() =>
      expect(q<HTMLElement>(document, "#annotation-error").hidden).toBe(false),
    );
    expect(q(document, "#annotation-error pre").textContent).toContain(
      JSON.stringify(errors),
    );
    expect(q(document, "#annotation-error pre").textContent).toContain(
      "HTTP 400",
    );
    expect(q(document, '.annotation-edit-form [name="body"]')).toBe(body);
    expect(body.value).toBe("Keep this input");
    expect(q<HTMLButtonElement>(form, '[type="submit"]').disabled).toBe(false);
  });

  test("commits a successful save before a failed refresh so it cannot be submitted twice", async () => {
    const { ui, state } = await annotationHarness();
    await openNoteEditor(ui);
    inputNote("body", "Saved finding");
    let posts = 0;
    globalThis.fetch = async (_input, init) => {
      if (init?.method === "POST") {
        posts++;
        return new Response(
          JSON.stringify({
            session_id: noteSession.id,
            entry: { ...state.sessions[0].entries[0], body: "Saved finding" },
          }),
        );
      }
      return new Response("read failure", { status: 503 });
    };
    q<HTMLFormElement>(document, ".annotation-edit-form").requestSubmit();
    await vi.waitFor(() =>
      expect(q<HTMLElement>(document, "#annotation-error").hidden).toBe(false),
    );
    expect(document.querySelector(".annotation-edit-form")).toBeNull();
    expect(q(document, "#annotation-detail-body").textContent).toContain(
      "Saved finding",
    );
    expect(posts).toBe(1);
  });

  test("waits for explicit discard and retains a draft when the panel is closed", async () => {
    const { ui } = await annotationHarness();
    await openNoteEditor(ui);
    const body = inputNote("body", "Unsaved draft");
    ui.setAnnotationPanelOpen(false);
    ui.setAnnotationPanelOpen(true);
    expect(q(document, '.annotation-edit-form [name="body"]')).toBe(body);
    q<HTMLButtonElement>(document, "#annotation-detail-close").click();
    await vi.waitFor(() =>
      expect(document.querySelector(".gdp-dialog-backdrop")).toBeTruthy(),
    );
    clickDialogCancel();
    expect(body.value).toBe("Unsaved draft");
    await vi.waitFor(() =>
      expect(document.querySelector(".gdp-dialog-backdrop")).toBeNull(),
    );
    q<HTMLButtonElement>(document, "#annotation-detail-close").click();
    await vi.waitFor(() =>
      expect(document.querySelector(".gdp-dialog-backdrop")).toBeTruthy(),
    );
    clickDialogConfirm();
    await vi.waitFor(() =>
      expect(q<HTMLElement>(document, "#annotation-detail").hidden).toBe(true),
    );
  });

  test.each([
    { ctrlKey: true, metaKey: false, isComposing: false, expected: 1 },
    { ctrlKey: false, metaKey: true, isComposing: false, expected: 1 },
    { ctrlKey: true, metaKey: false, isComposing: true, expected: 0 },
    { ctrlKey: false, metaKey: false, isComposing: false, expected: 0 },
  ])("saves with the platform shortcut without interrupting composition: %j", async ({
    expected,
    ...modifiers
  }) => {
    const { ui, state } = await annotationHarness();
    await openNoteEditor(ui);
    const body = inputNote("body", "Keyboard note");
    let posts = 0;
    globalThis.fetch = async (_input, init) => {
      if (init?.method === "POST") {
        posts++;
        return new Response(
          JSON.stringify({
            session_id: noteSession.id,
            entry: state.sessions[0].entries[0],
          }),
        );
      }
      return new Response(JSON.stringify(state));
    };
    body.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        ...modifiers,
      }),
    );
    await vi.waitFor(() => expect(posts).toBe(expected));
  });
});

describe("reading notes beneath code", () => {
  let style: HTMLStyleElement;
  beforeEach(() => {
    style = document.createElement("style");
    style.textContent = readFileSync("web/style.css", "utf8");
    document.head.appendChild(style);
  });
  afterEach(() => style.remove());

  async function inlineHarness(overrides: Partial<AnnotationsUiDeps> = {}) {
    const harness = await annotationHarness({
      diffCardSelector: () => ".gdp-file-shell",
      ...overrides,
    });
    document.body.insertAdjacentHTML(
      "beforeend",
      '<div class="gdp-file-shell gdp-standalone-source" data-path="src/example.ts"><div style="overflow-x:auto"><table class="gdp-source-table"><tbody><tr data-line="4"><td>example</td></tr></tbody></table></div></div>',
    );
    return harness;
  }

  test.each([
    { language: "en" as const, expected: "Lines 2–4", read: "Read in panel" },
    { language: "ja" as const, expected: "2–4行の注釈", read: "パネルで読む" },
  ])("shows readable text and target lines with the panel open: $language", async ({
    language,
    expected,
    read,
  }) => {
    const { ui } = await inlineHarness({ getLanguage: () => language });
    await ui.openAnnotationEntry("note-alpha");
    const row = q(
      document,
      '.gdp-annotation-row[data-annotation-id="note-alpha"]',
    );
    const body = q<HTMLElement>(row, ".gdp-annotation-inline-body");
    const toggle = q<HTMLButtonElement>(row, ".gdp-annotation-expand");
    expect(body.hidden).toBe(false);
    expect(body.textContent).toContain("Detailed finding");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(
      document.getElementById(toggle.getAttribute("aria-controls") || ""),
    ).toBe(body);
    expect(q(row, ".gdp-annotation-inline-location").textContent).toBe(
      expected,
    );
    expect(q(row, ".gdp-annotation-read").textContent).toBe(read);
    expect(q(row, '[role="note"]').getAttribute("aria-labelledby")).toBe(
      q(row, ".gdp-annotation-inline-title").id,
    );
  });

  test.each([
    {
      title:
        "A long explanation about the input, its transformation, and the returned value that must remain readable without losing the final words",
      expected:
        "A long explanation about the input, its transformation, and the returned value that must remain readable without losing the final words",
    },
    { title: "", expected: "Note" },
  ])("wraps the complete title without substituting raw Markdown: $title", async ({
    title,
    expected,
  }) => {
    const { ui, state } = await inlineHarness();
    state.sessions[0].entries[0].title = title;
    state.sessions[0].entries[0].body =
      "## Example heading\n\n**Example explanation**";
    await ui.refreshAnnotations();
    await ui.openAnnotationEntry("note-alpha");
    const heading = q(
      document,
      '.gdp-annotation-row[data-annotation-id="note-alpha"] .gdp-annotation-inline-title',
    );
    expect(heading.textContent).toBe(expected);
    expect(getComputedStyle(heading).whiteSpace).toBe("normal");
    expect(getComputedStyle(heading).overflowWrap).toBe("anywhere");
  });

  test("keeps each explicit collapse choice through updates and panel changes", async () => {
    const { ui } = await inlineHarness();
    await ui.openAnnotationEntry("note-alpha");
    q<HTMLButtonElement>(
      document,
      '.gdp-annotation-row[data-annotation-id="note-alpha"] .gdp-annotation-expand',
    ).click();
    for (const panelOpen of [false, true, false, true]) {
      ui.setAnnotationPanelOpen(panelOpen);
      await ui.refreshAnnotations();
      const collapsed = q<HTMLElement>(
        document,
        '.gdp-annotation-row[data-annotation-id="note-alpha"] .gdp-annotation-inline-body',
      );
      expect(collapsed.hidden).toBe(true);
      expect(getComputedStyle(collapsed).display).toBe("none");
      expect(
        q<HTMLElement>(
          document,
          '.gdp-annotation-row[data-annotation-id="note-gamma"] .gdp-annotation-inline-body',
        ).hidden,
      ).toBe(false);
    }
    q<HTMLButtonElement>(
      document,
      '.gdp-annotation-row[data-annotation-id="note-alpha"] .gdp-annotation-expand',
    ).click();
    ui.applyInlineAnnotations();
    expect(
      q<HTMLElement>(
        document,
        '.gdp-annotation-row[data-annotation-id="note-alpha"] .gdp-annotation-inline-body',
      ).hidden,
    ).toBe(false);
  });

  test("renders paragraphs, code, and tables as prose inside a code table", async () => {
    const { ui, state } = await inlineHarness();
    state.sessions[0].entries[0].body =
      "A **finding**.\n\n- First\n- Second\n\n```ts\nconst example = 1;\n```\n\n| Input | Output |\n| --- | --- |\n| empty | none |";
    await ui.refreshAnnotations();
    await ui.openAnnotationEntry("note-alpha");
    const body = q<HTMLElement>(
      document,
      '.gdp-annotation-row[data-annotation-id="note-alpha"] .gdp-annotation-inline-body',
    );
    expect(q(body, "strong").textContent).toBe("finding");
    expect(body.querySelectorAll("li")).toHaveLength(2);
    expect(q(body, "pre code").textContent).toBe("const example = 1;\n");
    expect(getComputedStyle(q(body, "pre")).borderTopStyle).toBe("solid");
    expect(getComputedStyle(q(body, "pre")).overflowX).toBe("auto");
    expect(getComputedStyle(q(body, "td")).padding).toBe("8px 12px");
    expect(getComputedStyle(q(body, "table")).overflowX).toBe("auto");
    expect(q(body, "table").textContent).toContain("none");
  });

  test("opens the same note from the inline reader action", async () => {
    const { ui } = await inlineHarness();
    await ui.openAnnotationEntry("note-alpha");
    ui.setAnnotationPanelOpen(false);
    q<HTMLButtonElement>(
      document,
      '.gdp-annotation-row[data-annotation-id="note-alpha"] .gdp-annotation-read',
    ).click();
    await vi.waitFor(() =>
      expect(ui.getActiveAnnotationId()).toBe("note-alpha"),
    );
    expect(q<HTMLElement>(document, "#annotation-panel").hidden).toBe(false);
    expect(q(document, "#annotation-detail-body").textContent).toContain(
      "Detailed finding",
    );
  });

  test("updates inline controls when the language changes", async () => {
    let language: "en" | "ja" = "en";
    const { ui } = await inlineHarness({ getLanguage: () => language });
    await ui.openAnnotationEntry("note-alpha");
    language = "ja";
    ui.localize();
    const row = q(
      document,
      '.gdp-annotation-row[data-annotation-id="note-alpha"]',
    );
    expect(q(row, ".gdp-annotation-read").textContent).toBe("パネルで読む");
    expect(q(row, ".gdp-annotation-step").getAttribute("aria-label")).toBe(
      "3件中1件目の注釈をパネルで読む",
    );
    expect(q(row, ".gdp-annotation-inline-location").textContent).toBe(
      "2–4行の注釈",
    );
  });
});
