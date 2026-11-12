import "./_dom";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { ContextMenuItem } from "../views/context-menu";
import {
  createDatabaseView,
  DEFAULT_VIEW,
  TABLE_SELECT_FETCH_DELAY_MS,
} from "../views/database/database-view";
import { waitFor } from "./_test-helpers";

// 共有のメニュー (views/context-menu.ts) は lit で描くので、このファイルの偽の
// DOM には描けない。開いたメニューの項目だけを受け取り、項目を選ぶ所はテストが
// 項目の onSelect を呼ぶ。メニューそのものの動きは context-menu.test.ts が見る。
const openedMenus = vi.hoisted(() => [] as ContextMenuItem[][]);
vi.mock("../views/context-menu", () => ({
  showContextMenu: (_anchor: unknown, items: ContextMenuItem[]) => {
    openedMenus.push(items);
    return { isConnected: true };
  },
  closeContextMenu: () => undefined,
  isContextMenuOpen: () => false,
}));

const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;
const originalFetch = globalThis.fetch;

afterEach(() => {
  Object.defineProperty(globalThis, "requestAnimationFrame", {
    configurable: true,
    writable: true,
    value: originalRequestAnimationFrame,
  });
  Object.defineProperty(globalThis, "cancelAnimationFrame", {
    configurable: true,
    writable: true,
    value: originalCancelAnimationFrame,
  });
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    writable: true,
    value: originalFetch,
  });
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

/**
 * 押して、押した後の非同期の処理 (取得の偽物はすぐ返る) が片付くまで待つ。
 * 前の偽の DOM の click() は、非同期の listener を待ってから返していた。
 */
async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++)
    await new Promise((resolve) => setTimeout(resolve, 0));
}

async function press(el: Element | null | undefined): Promise<void> {
  (el as HTMLElement | null | undefined)?.click();
  await settle();
}

async function typeIn(el: Element | null | undefined): Promise<void> {
  el?.dispatchEvent(new Event("input", { bubbles: true }));
  await settle();
}

async function openContextMenu(el: Element | null | undefined): Promise<void> {
  el?.dispatchEvent(
    new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: 10,
      clientY: 10,
    }),
  );
  await settle();
}

async function doubleClick(el: Element | null | undefined): Promise<void> {
  el?.dispatchEvent(
    new MouseEvent("dblclick", { bubbles: true, cancelable: true }),
  );
  await settle();
}

function installDatabaseDom() {
  document.body.innerHTML =
    '<div id="content"></div><div id="diff"></div><div id="empty"></div>';
  // 保存は sendBeacon ではなく keepalive の fetch で送る (テストが要求を数える)。
  Object.defineProperty(navigator, "sendBeacon", {
    configurable: true,
    writable: true,
    value: () => false,
  });
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    writable: true,
    value: { writeText: () => Promise.resolve() },
  });
  Object.defineProperty(globalThis, "requestAnimationFrame", {
    configurable: true,
    writable: true,
    value: (cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    },
  });
  Object.defineProperty(globalThis, "cancelAnimationFrame", {
    configurable: true,
    writable: true,
    value: () => undefined,
  });
  // 表は表示密度 (body の data-sidebar-font-size) の変化を見張る。このテストでは
  // 密度を変えないので、見張りは何もしない。
  Object.defineProperty(globalThis, "MutationObserver", {
    configurable: true,
    writable: true,
    value: class {
      observe() {
        /* 密度はこのテストでは変わらない */
      }
      disconnect() {
        /* 同上 */
      }
    },
  });
  return { body: document.body };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
  });
}

function mockFetch(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
  options: { handleDbUi?: boolean; handleDbHistory?: boolean } = {},
) {
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    writable: true,
    value: ((input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      if (url === "/_db/ui" && options.handleDbUi !== true) {
        return Promise.resolve(
          jsonResponse({ version: 1, columnWidths: {}, prefs: {} }),
        );
      }
      if (
        url.startsWith("/_db/history") &&
        !init?.method &&
        options.handleDbHistory !== true
      ) {
        return Promise.resolve(jsonResponse({ entries: [] }));
      }
      return Promise.resolve(handler(url, init));
    }) as typeof fetch,
  });
}

function restoredTabLabels(): string[] {
  return Array.from(document.querySelectorAll(".db-tabs-chip-label")).map(
    (label) => label.textContent,
  );
}

function createViewForTest(
  overrides: Partial<Parameters<typeof createDatabaseView>[0]> = {},
  look: Parameters<typeof createDatabaseView>[1] = DEFAULT_VIEW,
) {
  return createDatabaseView(
    {
      setRoute() {
        /* noop */
      },
      setPageMode() {
        /* noop */
      },
      currentRange: () => ({ from: "HEAD", to: "worktree" }),
      trackLoad: (promise) => promise,
      syncHeaderMenu() {
        /* noop */
      },
      ...overrides,
    },
    look,
  );
}

function baseFilesResponse() {
  return {
    files: [
      {
        id: "docker:db",
        path: "docker-compose.yml",
        name: "db",
        sizeBytes: 0,
        kind: "mysql",
      },
    ],
  };
}

function baseSchemaResponse() {
  return {
    tables: [{ name: "users", type: "table", rowCount: 1 }],
    indexes: [],
    foreignKeys: [],
    columnsMap: {
      users: [{ name: "id", type: "integer", primaryKey: true }],
    },
  };
}

function baseTableResponse() {
  return {
    dbId: "docker:db",
    table: "users",
    columns: [{ name: "id", type: "integer", primaryKey: true }],
    rows: [[1]],
    totalRows: 1,
    offset: 0,
    limit: 200,
    hasMore: false,
    executedSql: [
      "SELECT * FROM users LIMIT ? OFFSET ?",
      "SELECT COUNT(*) FROM users",
    ],
  };
}

async function leaveView(view: ReturnType<typeof createDatabaseView>) {
  view.leave();
  await Promise.resolve();
}

async function flushMicrotasks(count = 8) {
  for (let i = 0; i < count; i++) await Promise.resolve();
}

describe("database view SQL error rendering", () => {
  test("renders schema fetch errors in the table list and grid panes", async () => {
    installDatabaseDom();
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    mockFetch((url, init) => {
      if (url === "/_db/tabs" && init?.method === "PUT")
        return jsonResponse({ ok: true });
      if (url === "/_db/tabs") return jsonResponse({ tabs: [] });
      if (url === "/_db/files") return jsonResponse(baseFilesResponse());
      if (url.startsWith("/_db/schema")) {
        return new Response("schema failed", { status: 500 });
      }
      return new Response("unexpected request", { status: 500 });
    });

    const view = createViewForTest();
    await view.enter("docker:db");

    const errors = Array.from(
      document.querySelectorAll(".db-pane-error"),
    ) as unknown as HTMLElement[];
    expect(errors).toHaveLength(2);
    expect(errors.map((error) => error.textContent)).toEqual([
      "Error: failed to fetch schema (HTTP 500): schema failed",
      "Error: failed to fetch schema (HTTP 500): schema failed",
    ]);
    expect(consoleError).toHaveBeenCalledWith(
      "Failed to fetch schema",
      expect.objectContaining({
        message: "failed to fetch schema (HTTP 500): schema failed",
      }),
    );
    await leaveView(view);
  });

  test("renders schema-list fetch errors in both panes and logs the error", async () => {
    installDatabaseDom();
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    mockFetch((url, init) => {
      if (url === "/_db/tabs" && init?.method === "PUT")
        return jsonResponse({ ok: true });
      if (url === "/_db/tabs") return jsonResponse({ tabs: [] });
      if (url === "/_db/files") {
        return jsonResponse({
          files: [
            {
              ...baseFilesResponse().files[0],
              kind: "postgresql",
            },
          ],
        });
      }
      if (url.startsWith("/_db/schemas")) {
        return new Response("schemas failed", { status: 503 });
      }
      return new Response("unexpected request", { status: 500 });
    });

    const view = createViewForTest();
    await view.enter("docker:db");

    const errors = Array.from(
      document.querySelectorAll(".db-pane-error"),
    ) as unknown as HTMLElement[];
    expect(errors).toHaveLength(2);
    expect(errors.map((error) => error.textContent)).toEqual([
      "Error: failed to fetch schemas (HTTP 503): schemas failed",
      "Error: failed to fetch schemas (HTTP 503): schemas failed",
    ]);
    expect(consoleError).toHaveBeenCalledWith(
      "Failed to fetch schemas",
      expect.objectContaining({
        message: "failed to fetch schemas (HTTP 503): schemas failed",
      }),
    );
    await leaveView(view);
  });

  // 直す前は操作名 ("failed to fetch …") が日本語の設定でも英語のままだった。
  test.each([
    {
      language: "en" as const,
      kind: "sqlite",
      failing: "/_db/schema?",
      operation: "failed to fetch schema",
    },
    {
      language: "ja" as const,
      kind: "sqlite",
      failing: "/_db/schema?",
      operation: "スキーマを取得できませんでした",
    },
    {
      language: "en" as const,
      kind: "postgresql",
      failing: "/_db/schemas",
      operation: "failed to fetch schemas",
    },
    {
      language: "ja" as const,
      kind: "postgresql",
      failing: "/_db/schemas",
      operation: "スキーマの一覧を取得できませんでした",
    },
  ])(
    "names the failed operation in the display language: $language $failing",
    async ({ language, kind, failing, operation }) => {
      installDatabaseDom();
      const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);
      mockFetch((url, init) => {
        if (url === "/_db/tabs" && init?.method === "PUT")
          return jsonResponse({ ok: true });
        if (url === "/_db/tabs") return jsonResponse({ tabs: [] });
        if (url === "/_db/files")
          return jsonResponse({
            files: [{ ...baseFilesResponse().files[0], kind }],
          });
        if (url.startsWith(failing))
          return new Response("sample failure", { status: 500 });
        return new Response("unexpected request", { status: 500 });
      });

      const view = createViewForTest({ getLanguage: () => language });
      await view.enter("docker:db");

      const shown = (
        Array.from(
          document.querySelectorAll(".db-pane-error"),
        ) as unknown as HTMLElement[]
      ).map((error) => String(error.textContent));
      // 頭の "Error:" は文言ではなく、formatErrorDetail が出す error の型名。
      expect(shown).toEqual([
        `Error: ${operation} (HTTP 500): sample failure`,
        `Error: ${operation} (HTTP 500): sample failure`,
      ]);
      expect(consoleError).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          message: `${operation} (HTTP 500): sample failure`,
        }),
      );
      await leaveView(view);
    },
  );

  // 直す前は日本語の設定でも、データストアの一覧・タブ・表示設定の読み込みの
  // 失敗の詳細に英語の操作名が残っていた。英語の出力は今までどおり。
  test.each([
    {
      language: "en" as const,
      failing: "files",
      operation: "load datastores",
    },
    {
      language: "ja" as const,
      failing: "files",
      operation: "データストアの一覧を読み込めませんでした",
    },
    {
      language: "en" as const,
      failing: "tabs",
      operation: "load database tabs",
    },
    {
      language: "ja" as const,
      failing: "tabs",
      operation: "データストアのタブを読み込めませんでした",
    },
    {
      language: "en" as const,
      failing: "ui",
      operation: "load database UI settings",
    },
    {
      language: "ja" as const,
      failing: "ui",
      operation: "Data の表示設定を読み込めませんでした",
    },
  ])(
    "names the failed $failing load in the display language: $language",
    async ({ language, failing, operation }) => {
      installDatabaseDom();
      const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);
      const failure = () => new Response("sample failure", { status: 500 });
      mockFetch(
        (url, init) => {
          if (url === "/_db/tabs" && init?.method === "PUT")
            return jsonResponse({ ok: true });
          if (url === "/_db/tabs")
            return failing === "tabs" ? failure() : jsonResponse({ tabs: [] });
          if (url === "/_db/files")
            return failing === "files"
              ? failure()
              : jsonResponse(baseFilesResponse());
          if (url === "/_db/ui")
            return failing === "ui"
              ? failure()
              : jsonResponse({ version: 1, columnWidths: {}, prefs: {} });
          if (url.startsWith("/_db/schema"))
            return jsonResponse(baseSchemaResponse());
          if (url.startsWith("/_db/table"))
            return jsonResponse(baseTableResponse());
          return new Response("unexpected request", { status: 500 });
        },
        { handleDbUi: true },
      );

      const view = createViewForTest({ getLanguage: () => language });
      await view.enter("docker:db");
      await flushMicrotasks();

      const detail = `${operation} (HTTP 500): sample failure`;
      const shown = (
        Array.from(
          document.querySelectorAll(".db-pane-error"),
        ) as unknown as HTMLElement[]
      ).map((error) => String(error.textContent));
      expect(shown.some((text) => text.includes(detail))).toBe(true);
      expect(consoleError).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ message: detail }),
      );
      await leaveView(view);
    },
  );

  // 直す前は通信の失敗を err.message だけでセッションログに載せ、cause が消えていた。
  test("keeps the whole failure with its cause in the session log", async () => {
    installDatabaseDom();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const failure = Object.assign(new TypeError("table request failed"), {
      cause: new Error("network is unreachable"),
    });
    mockFetch((url, init) => {
      if (url === "/_db/tabs" && init?.method === "PUT")
        return jsonResponse({ ok: true });
      if (url === "/_db/tabs") return jsonResponse({ tabs: [] });
      if (url === "/_db/files") return jsonResponse(baseFilesResponse());
      if (url.startsWith("/_db/schema"))
        return jsonResponse(baseSchemaResponse());
      if (url.startsWith("/_db/table")) return Promise.reject(failure);
      return new Response("unexpected request", { status: 500 });
    });

    const view = createViewForTest();
    await view.enter("docker:db");
    await flushMicrotasks();

    const entry = document.querySelector(
      ".db-session-log-entry",
    ) as unknown as HTMLElement | null;
    if (!entry) throw new Error("session log entry is missing");
    await press(entry);
    const message = document.querySelector(".db-session-log-message");
    expect(message?.textContent).toBe(
      "TypeError: table request failed\nCaused by: Error: network is unreachable",
    );
    await leaveView(view);
  });

  // 直す前は新しいタブの本文が空で、select も空の箱、タブの札は日本語でも
  // "(empty)" だった。
  test.each([
    {
      language: "en" as const,
      title: "Choose a datastore",
      hint: "Pick one in the box at the top left, or add a connection with +.",
      select: "Select datastore",
      chip: "New tab",
    },
    {
      language: "ja" as const,
      title: "データストアを選んでください",
      hint: "左上の欄から選ぶか、＋ から接続を追加してください。",
      select: "データストアを選択",
      chip: "新しいタブ",
    },
  ])(
    "guides a new tab to choose a datastore: $language",
    async ({ language, title, hint, select, chip }) => {
      installDatabaseDom();
      mockFetch((url, init) => {
        if (url === "/_db/tabs" && init?.method === "PUT")
          return jsonResponse({ ok: true });
        if (url === "/_db/tabs") return jsonResponse({ tabs: [] });
        if (url === "/_db/files") return jsonResponse(baseFilesResponse());
        if (url.startsWith("/_db/schema"))
          return jsonResponse(baseSchemaResponse());
        if (url.startsWith("/_db/table"))
          return jsonResponse(baseTableResponse());
        return new Response("unexpected request", { status: 500 });
      });

      const view = createViewForTest({ getLanguage: () => language });
      await view.enter("docker:db");
      const newTab = document.querySelector(
        ".db-tabs-new-btn",
      ) as unknown as HTMLElement | null;
      if (!newTab) throw new Error("new tab button is missing");
      await press(newTab);
      await flushMicrotasks();

      const guides = (
        Array.from(
          document.querySelectorAll(".db-no-datastores"),
        ) as unknown as HTMLElement[]
      ).filter((pane) => !pane.hidden);
      expect(guides).toHaveLength(1);
      const guide = guides[0] as unknown as HTMLElement;
      expect(guide.querySelector(".db-pane-empty-title")?.textContent).toBe(
        title,
      );
      expect(guide.querySelector(".db-pane-empty-hint")?.textContent).toBe(
        hint,
      );
      const placeholders = (
        Array.from(
          document.querySelectorAll(".db-file-select"),
        ) as unknown as HTMLElement[]
      )
        .flatMap((selectEl) => [...selectEl.children])
        .filter(
          (option): option is HTMLOptionElement =>
            option instanceof HTMLOptionElement && option.disabled,
        );
      expect(placeholders.map((option) => option.textContent)).toEqual([
        select,
      ]);
      const chips = Array.from(
        document.querySelectorAll(".db-tabs-chip-label"),
      ).map((label) => label.textContent);
      expect(chips[chips.length - 1]).toBe(chip);
      await leaveView(view);
    },
  );

  test("keeps the normal schema and first table path rendering", async () => {
    installDatabaseDom();
    mockFetch((url, init) => {
      if (url === "/_db/tabs" && init?.method === "PUT")
        return jsonResponse({ ok: true });
      if (url === "/_db/tabs") return jsonResponse({ tabs: [] });
      if (url === "/_db/files") return jsonResponse(baseFilesResponse());
      if (url.startsWith("/_db/schema"))
        return jsonResponse(baseSchemaResponse());
      if (url.startsWith("/_db/table"))
        return jsonResponse(baseTableResponse());
      return new Response("unexpected request", { status: 500 });
    });

    const view = createViewForTest();
    await view.enter("docker:db");

    expect(document.querySelector(".db-pane-error")).toBeNull();
    expect(document.querySelector(".db-table-name")?.textContent).toBe("users");
    expect(
      document.querySelector<HTMLElement>(".db-query-editor")?.hidden,
    ).toBe(false);
    expect(document.querySelector<HTMLElement>(".db-grid")?.hidden).toBe(false);
    expect(document.querySelector("textarea")?.value).toBe(
      "SELECT * FROM users LIMIT 200 OFFSET 0",
    );
    expect(
      document
        .querySelector(".db-icon-toolbar")
        ?.querySelectorAll(".db-icon-btn"),
    ).toHaveLength(3);
    await leaveView(view);
  });

  test("datastore refresh button bypasses the file list cache", async () => {
    installDatabaseDom();
    let filesFetches = 0;
    let resolveRefreshFiles: (() => void) | null = null;
    mockFetch((url, init) => {
      if (url === "/_db/tabs" && init?.method === "PUT")
        return jsonResponse({ ok: true });
      if (url === "/_db/tabs") return jsonResponse({ tabs: [] });
      if (url === "/_db/files") {
        filesFetches++;
        if (filesFetches === 2) {
          return new Promise<Response>((resolve) => {
            resolveRefreshFiles = () =>
              resolve(
                jsonResponse({
                  files: [
                    ...baseFilesResponse().files,
                    {
                      id: "app.sqlite",
                      path: "app.sqlite",
                      name: "app.sqlite",
                      sizeBytes: 4096,
                      kind: "sqlite",
                    },
                  ],
                }),
              );
          });
        }
        return jsonResponse(baseFilesResponse());
      }
      if (url.startsWith("/_db/schema"))
        return jsonResponse(baseSchemaResponse());
      if (url.startsWith("/_db/table"))
        return jsonResponse(baseTableResponse());
      return new Response("unexpected request", { status: 500 });
    });

    const view = createViewForTest();
    await view.enter("docker:db");

    const refresh = document.querySelector(
      ".db-refresh-btn",
    ) as unknown as HTMLButtonElement;
    const label = refresh.querySelector(
      ".db-refresh-label",
    ) as unknown as HTMLElement;
    const result = document.querySelector(
      ".db-refresh-result",
    ) as unknown as HTMLElement;
    expect(refresh).toBeTruthy();
    expect(refresh.getAttribute("aria-label")).toBe("Refresh datastores");
    expect(refresh.getAttribute("aria-busy")).toBe("false");
    expect(label.textContent).toBe("");
    expect(result.hidden).toBe(true);

    const refreshClick = press(refresh);
    await waitFor(() => filesFetches === 2);
    expect(refresh.disabled).toBe(true);
    expect(refresh.classList.contains("spinning")).toBe(true);
    expect(refresh.getAttribute("aria-busy")).toBe("true");
    expect(label.textContent).toBe("");

    resolveRefreshFiles?.();
    await refreshClick;
    await waitFor(() => refresh.getAttribute("aria-busy") === "false");

    expect(filesFetches).toBe(2);
    expect(refresh.disabled).toBe(false);
    expect(refresh.classList.contains("spinning")).toBe(false);
    expect(refresh.getAttribute("aria-busy")).toBe("false");
    expect(label.textContent).toBe("");
    expect(result.hidden).toBe(true);
    expect(result.textContent).toBe("");
    expect(result.classList.contains("changed")).toBe(false);
    expect(document.querySelector(".db-table-name")?.textContent).toBe("users");
    await leaveView(view);
  });

  test("shows an actionable empty state when no datastores are found", async () => {
    installDatabaseDom();
    let filesFetches = 0;
    mockFetch((url, init) => {
      if (url === "/_db/tabs" && init?.method === "PUT")
        return jsonResponse({ ok: true });
      if (url === "/_db/tabs") return jsonResponse({ tabs: [] });
      if (url === "/_db/files") {
        filesFetches++;
        return jsonResponse({ files: [] });
      }
      return new Response("unexpected request", { status: 500 });
    });

    const view = createViewForTest();
    await view.enter();

    const empty = document.querySelector(
      ".db-no-datastores",
    ) as unknown as HTMLElement;
    expect(empty).toBeTruthy();
    expect(empty.hidden).toBe(false);
    expect(empty.querySelector(".db-pane-empty-title")?.textContent).toBe(
      "No datastores found",
    );
    expect(
      empty
        .querySelector(".db-pane-empty-hint")
        ?.textContent.includes("Start a database service"),
    ).toBe(true);
    expect(restoredTabLabels()).toEqual(["No datastore"]);

    const action = empty.querySelector(
      ".db-no-datastores-action",
    ) as unknown as HTMLElement;
    expect(action.textContent).toBe("Refresh datastores");
    const click = press(action);
    await waitFor(() => filesFetches === 2);
    await click;

    expect(filesFetches).toBe(2);
    await leaveView(view);
  });

  test("syncs table list row count after an unfiltered grid reload", async () => {
    installDatabaseDom();
    let tableFetches = 0;
    let nextTotalRows = 1;
    mockFetch((url, init) => {
      if (url === "/_db/tabs" && init?.method === "PUT")
        return jsonResponse({ ok: true });
      if (url === "/_db/tabs") return jsonResponse({ tabs: [] });
      if (url === "/_db/files") return jsonResponse(baseFilesResponse());
      if (url.startsWith("/_db/schema"))
        return jsonResponse(baseSchemaResponse());
      if (url.startsWith("/_db/table")) {
        tableFetches++;
        return jsonResponse({
          ...baseTableResponse(),
          rows: Array.from({ length: nextTotalRows }, (_, i) => [i + 1]),
          totalRows: nextTotalRows,
        });
      }
      return new Response("unexpected request", { status: 500 });
    });

    const view = createViewForTest();
    await view.enter("docker:db");
    expect(document.querySelector(".db-table-count")?.textContent).toBe("1");

    nextTotalRows = 3;
    const refresh = document.querySelector(
      ".db-grid-refresh",
    ) as unknown as HTMLElement;
    await press(refresh);
    await waitFor(() => tableFetches === 2);
    // 取得が 2 回走ったことと、その結果が件数表示に入ったことは別。
    // 表示が変わるまで待つ (fetch の完了だけでは DOM はまだ古い)。
    await waitFor(
      () => document.querySelector(".db-table-count")?.textContent === "3",
    );

    expect(document.querySelector(".db-table-count")?.textContent).toBe("3");
    await leaveView(view);
  });

  test("syncs full table row count after a filtered grid reload", async () => {
    installDatabaseDom();
    let tableFetches = 0;
    let countFetches = 0;
    mockFetch((url, init) => {
      if (url === "/_db/tabs" && init?.method === "PUT")
        return jsonResponse({ ok: true });
      if (url === "/_db/tabs") return jsonResponse({ tabs: [] });
      if (url === "/_db/files") return jsonResponse(baseFilesResponse());
      if (url.startsWith("/_db/schema"))
        return jsonResponse({
          ...baseSchemaResponse(),
          tables: [{ name: "users", type: "table", rowCount: 3 }],
        });
      if (url.startsWith("/_db/table-count")) {
        countFetches++;
        return jsonResponse({
          dbId: "docker:db",
          table: "users",
          rowCount: 4,
        });
      }
      if (url.startsWith("/_db/table")) {
        tableFetches++;
        const hasFilters = new URL(url, "http://localhost").searchParams.has(
          "filters",
        );
        const totalRows = hasFilters ? (tableFetches >= 3 ? 2 : 1) : 3;
        return jsonResponse({
          ...baseTableResponse(),
          rows: Array.from({ length: totalRows }, (_, i) => [i + 1]),
          totalRows,
        });
      }
      return new Response("unexpected request", { status: 500 });
    });

    const view = createViewForTest();
    await view.enter("docker:db");
    expect(document.querySelector(".db-table-count")?.textContent).toBe("3");

    const filter = document.querySelector(
      ".db-grid-filter-input",
    ) as unknown as HTMLInputElement;
    filter.value = "sample";
    await typeIn(filter);
    await waitFor(() => tableFetches === 2);
    expect(document.querySelector(".db-table-count")?.textContent).toBe("3");

    const refresh = document.querySelector(
      ".db-grid-refresh",
    ) as unknown as HTMLElement;
    await press(refresh);
    await waitFor(() => countFetches === 1);

    expect(document.querySelector(".db-table-count")?.textContent).toBe("4");
    await leaveView(view);
  });

  test("schema refresh button reloads the current table structure", async () => {
    installDatabaseDom();
    let schemaFetches = 0;
    let resolveRefreshSchema: (() => void) | null = null;
    mockFetch((url, init) => {
      if (url === "/_db/tabs" && init?.method === "PUT")
        return jsonResponse({ ok: true });
      if (url === "/_db/tabs") return jsonResponse({ tabs: [] });
      if (url === "/_db/files") return jsonResponse(baseFilesResponse());
      if (url.startsWith("/_db/schema")) {
        schemaFetches++;
        if (schemaFetches === 2) {
          return new Promise<Response>((resolve) => {
            resolveRefreshSchema = () =>
              resolve(
                jsonResponse({
                  ...baseSchemaResponse(),
                  indexes: [
                    {
                      table: "users",
                      name: "users_name_idx",
                      columns: ["name"],
                      unique: false,
                    },
                  ],
                  columnsMap: {
                    users: [
                      { name: "id", type: "integer", primaryKey: true },
                      { name: "name", type: "text", primaryKey: false },
                    ],
                  },
                }),
              );
          });
        }
        return jsonResponse(baseSchemaResponse());
      }
      return new Response("unexpected request", { status: 500 });
    });

    const view = createViewForTest();
    await view.enter("docker:db", undefined, "users", "schema");

    const refresh = document.querySelector(
      ".db-schema-refresh",
    ) as unknown as HTMLButtonElement;
    const label = refresh.querySelector(
      ".db-grid-refresh-label",
    ) as unknown as HTMLElement;
    expect(refresh).toBeTruthy();
    expect(refresh.getAttribute("aria-label")).toBe(
      "Refresh this table schema",
    );
    expect(refresh.getAttribute("aria-busy")).toBe("false");
    expect(label.textContent).toBe("");

    void press(refresh);
    await waitFor(() => schemaFetches === 2);
    expect(refresh.disabled).toBe(true);
    expect(refresh.classList.contains("spinning")).toBe(true);
    expect(refresh.getAttribute("aria-busy")).toBe("true");
    expect(label.textContent).toBe("");

    resolveRefreshSchema?.();
    await waitFor(() => {
      const doneRefresh = document.querySelector(
        ".db-schema-refresh",
      ) as unknown as HTMLElement | null;
      return doneRefresh?.getAttribute("aria-busy") === "false";
    });

    const doneRefresh = document.querySelector(
      ".db-schema-refresh",
    ) as unknown as HTMLButtonElement;
    const doneLabel = doneRefresh.querySelector(
      ".db-grid-refresh-label",
    ) as unknown as HTMLElement;
    const schemaText = document.querySelector(".db-schema-view")?.textContent;
    expect(schemaFetches).toBe(2);
    expect(doneRefresh.disabled).toBe(false);
    expect(doneRefresh.classList.contains("spinning")).toBe(false);
    expect(doneLabel.textContent).toBe("");
    expect(schemaText || "").toMatch(/name/);
    expect(schemaText || "").toMatch(/users_name_idx/);
    await leaveView(view);
  });

  test("removes the database root from the document when suspended", async () => {
    installDatabaseDom();
    mockFetch((url, init) => {
      if (url === "/_db/tabs" && init?.method === "PUT")
        return jsonResponse({ ok: true });
      if (url === "/_db/tabs") return jsonResponse({ tabs: [] });
      if (url === "/_db/files") return jsonResponse(baseFilesResponse());
      if (url.startsWith("/_db/schema"))
        return jsonResponse(baseSchemaResponse());
      if (url.startsWith("/_db/table"))
        return jsonResponse(baseTableResponse());
      return new Response("unexpected request", { status: 500 });
    });

    const view = createViewForTest();
    await view.enter("docker:db");

    expect(document.querySelector(".db-root")).toBeTruthy();

    view.suspend();

    expect(document.querySelector(".db-root")).toBeNull();
    expect(document.body.classList.contains("gdp-database-page")).toBe(false);
    expect(document.getElementById("diff")?.hidden).toBe(false);

    await view.enter("docker:db");

    const root = document.querySelector(".db-root") as unknown as HTMLElement;
    expect(root).toBeTruthy();
    expect(root.hidden).toBe(false);
    await leaveView(view);
  });

  test("does not remount database view after suspend while tabs are restoring", async () => {
    installDatabaseDom();
    let resolveTabs!: (res: Response) => void;
    const tabsPromise = new Promise<Response>((resolve) => {
      resolveTabs = resolve;
    });
    mockFetch((url, init) => {
      if (url === "/_db/tabs" && init?.method === "PUT")
        return jsonResponse({ ok: true });
      if (url === "/_db/tabs") return tabsPromise;
      if (url === "/_db/files") return jsonResponse(baseFilesResponse());
      if (url.startsWith("/_db/schema"))
        return jsonResponse(baseSchemaResponse());
      if (url.startsWith("/_db/table"))
        return jsonResponse(baseTableResponse());
      return new Response("unexpected request", { status: 500 });
    });

    const view = createViewForTest();
    const entering = view.enter();
    await flushMicrotasks();

    expect(document.querySelector(".db-root")).toBeTruthy();

    view.suspend();
    resolveTabs(
      jsonResponse({
        version: 1,
        activeTabId: "docker",
        tabs: [{ id: "docker", dbId: "docker:db", table: "users" }],
      }),
    );
    await entering;

    expect(document.querySelector(".db-root")).toBeNull();
    expect(document.body.classList.contains("gdp-database-page")).toBe(false);
  });

  test("does not duplicate restored tabs when re-entering after suspend", async () => {
    installDatabaseDom();
    let tabFetches = 0;
    mockFetch((url, init) => {
      if (url === "/_db/tabs" && init?.method === "PUT")
        return jsonResponse({ ok: true });
      if (url === "/_db/tabs") {
        tabFetches++;
        return jsonResponse({
          version: 1,
          activeTabId: "docker",
          tabs: [
            {
              id: "docker",
              dbId: "docker:db",
              table: "users",
              view: "data",
            },
            {
              id: "empty",
              dbId: null,
              table: null,
              view: "data",
            },
          ],
        });
      }
      if (url === "/_db/files") return jsonResponse(baseFilesResponse());
      if (url.startsWith("/_db/schema"))
        return jsonResponse(baseSchemaResponse());
      if (url.startsWith("/_db/table"))
        return jsonResponse(baseTableResponse());
      return new Response("unexpected request", { status: 500 });
    });

    const view = createViewForTest();
    await view.enter();

    expect(restoredTabLabels()).toEqual(["db", "New tab"]);

    view.suspend();
    await view.enter();

    expect(restoredTabLabels()).toEqual(["db", "New tab"]);
    expect(tabFetches).toBe(1);
    await leaveView(view);
  });

  test("syncs a parameterless database route to the active tab on re-enter", async () => {
    installDatabaseDom();
    const routes: unknown[] = [];
    mockFetch((url, init) => {
      if (url === "/_db/tabs" && init?.method === "PUT")
        return jsonResponse({ ok: true });
      if (url === "/_db/tabs")
        return jsonResponse({
          version: 1,
          activeTabId: "docker",
          tabs: [
            {
              id: "docker",
              dbId: "docker:db",
              table: "sample_categories",
              view: "data",
            },
          ],
        });
      if (url === "/_db/files") return jsonResponse(baseFilesResponse());
      if (url.startsWith("/_db/schema"))
        return jsonResponse({
          ...baseSchemaResponse(),
          tables: [
            { name: "users", type: "table", rowCount: 1 },
            { name: "sample_categories", type: "table", rowCount: 52 },
          ],
          columnsMap: {
            users: [{ name: "id", type: "integer", primaryKey: true }],
            sample_categories: [
              { name: "id", type: "integer", primaryKey: true },
            ],
          },
        });
      if (url.startsWith("/_db/table"))
        return jsonResponse({
          ...baseTableResponse(),
          table: "sample_categories",
        });
      return new Response("unexpected request", { status: 500 });
    });

    const view = createViewForTest({
      setRoute(route) {
        routes.push(route);
      },
    });
    await view.enter();
    routes.length = 0;

    view.suspend();
    await view.enter();

    expect(routes[routes.length - 1]).toEqual({
      screen: "database",
      db: "docker:db",
      table: "sample_categories",
      tab: undefined,
      range: { from: "HEAD", to: "worktree" },
    });
    await leaveView(view);
  });

  test("applies routed tables to the active restored tab instead of opening duplicates", async () => {
    installDatabaseDom();
    const fetchedTables: string[] = [];
    mockFetch((url, init) => {
      if (url === "/_db/tabs" && init?.method === "PUT")
        return jsonResponse({ ok: true });
      if (url === "/_db/tabs")
        return jsonResponse({
          version: 1,
          activeTabId: "docker",
          tabs: [
            {
              id: "docker",
              dbId: "docker:db",
              table: "users",
              view: "data",
            },
          ],
        });
      if (url === "/_db/files") return jsonResponse(baseFilesResponse());
      if (url.startsWith("/_db/schema"))
        return jsonResponse({
          ...baseSchemaResponse(),
          tables: [
            { name: "users", type: "table", rowCount: 1 },
            { name: "bookings", type: "table", rowCount: 1 },
          ],
          columnsMap: {
            users: [{ name: "id", type: "integer", primaryKey: true }],
            bookings: [{ name: "id", type: "integer", primaryKey: true }],
          },
        });
      if (url.startsWith("/_db/table")) {
        const table = new URL(url, "http://localhost").searchParams.get(
          "table",
        );
        if (table) fetchedTables.push(table);
        return jsonResponse({ ...baseTableResponse(), table });
      }
      return new Response("unexpected request", { status: 500 });
    });

    const view = createViewForTest();
    await view.enter("docker:db", undefined, "bookings");

    expect(document.querySelectorAll(".db-tabs-chip")).toHaveLength(1);
    expect(fetchedTables).toEqual(["bookings"]);
    await leaveView(view);
  });

  test("routed table overrides a restored tableless search view", async () => {
    installDatabaseDom();
    const fetchedTables: string[] = [];
    const routes: unknown[] = [];
    mockFetch((url, init) => {
      if (url === "/_db/tabs" && init?.method === "PUT")
        return jsonResponse({ ok: true });
      if (url === "/_db/tabs")
        return jsonResponse({
          version: 1,
          activeTabId: "docker",
          tabs: [
            {
              id: "docker",
              dbId: "docker:db",
              table: null,
              view: "search",
            },
          ],
        });
      if (url === "/_db/files") return jsonResponse(baseFilesResponse());
      if (url.startsWith("/_db/schema"))
        return jsonResponse({
          ...baseSchemaResponse(),
          tables: [
            { name: "users", type: "table", rowCount: 1 },
            { name: "sample_categories", type: "table", rowCount: 52 },
          ],
          columnsMap: {
            users: [{ name: "id", type: "integer", primaryKey: true }],
            sample_categories: [
              { name: "id", type: "integer", primaryKey: true },
            ],
          },
        });
      if (url.startsWith("/_db/table")) {
        const table = new URL(url, "http://localhost").searchParams.get(
          "table",
        );
        if (table) fetchedTables.push(table);
        return jsonResponse({ ...baseTableResponse(), table });
      }
      return new Response("unexpected request", { status: 500 });
    });

    const view = createViewForTest({
      setRoute(route) {
        routes.push(route);
      },
    });
    await view.enter("docker:db", undefined, "sample_categories");

    const sawRestoredSearchRoute = routes.some(
      (route) =>
        typeof route === "object" &&
        route !== null &&
        (route as { tab?: unknown }).tab === "search",
    );
    expect(document.querySelectorAll(".db-tabs-chip")).toHaveLength(1);
    expect(fetchedTables.includes("sample_categories")).toBe(true);
    expect(sawRestoredSearchRoute).toBe(false);
    expect(routes[routes.length - 1]).toEqual({
      screen: "database",
      db: "docker:db",
      table: "sample_categories",
      tab: undefined,
      range: { from: "HEAD", to: "worktree" },
    });
    await leaveView(view);
  });

  test("opens a routed table without fetching the first table first", async () => {
    installDatabaseDom();
    const fetchedTables: string[] = [];
    mockFetch((url, init) => {
      if (url === "/_db/tabs" && init?.method === "PUT")
        return jsonResponse({ ok: true });
      if (url === "/_db/tabs") return jsonResponse({ tabs: [] });
      if (url === "/_db/files") return jsonResponse(baseFilesResponse());
      if (url.startsWith("/_db/schema"))
        return jsonResponse({
          ...baseSchemaResponse(),
          tables: [
            { name: "users", type: "table", rowCount: 1 },
            { name: "bookings", type: "table", rowCount: 1 },
          ],
          columnsMap: {
            users: [{ name: "id", type: "integer", primaryKey: true }],
            bookings: [{ name: "id", type: "integer", primaryKey: true }],
          },
        });
      if (url.startsWith("/_db/table")) {
        const table = new URL(url, "http://localhost").searchParams.get(
          "table",
        );
        if (table) fetchedTables.push(table);
        return jsonResponse({ ...baseTableResponse(), table });
      }
      return new Response("unexpected request", { status: 500 });
    });

    const view = createViewForTest();
    await view.enter("docker:db", undefined, "bookings");

    expect(fetchedTables).toEqual(["bookings"]);
    await leaveView(view);
  });

  test("opens a routed restored background tab when another datastore is active", async () => {
    installDatabaseDom();
    const fetchedTables: string[] = [];
    mockFetch((url, init) => {
      if (url === "/_db/tabs" && init?.method === "PUT")
        return jsonResponse({ ok: true });
      if (url === "/_db/tabs")
        return jsonResponse({
          version: 1,
          activeTabId: "minio",
          tabs: [
            {
              id: "postgres",
              dbId: "docker:postgres:demo_app",
              table: "sample_locks",
              view: "data",
            },
            {
              id: "minio",
              dbId: "docker:minio",
              table: null,
              view: "data",
            },
          ],
        });
      if (url === "/_db/files")
        return jsonResponse({
          files: [
            {
              id: "docker:postgres:demo_app",
              path: "docker-compose.yml",
              name: "postgres",
              sizeBytes: 0,
              kind: "postgres",
            },
            {
              id: "docker:minio",
              path: "docker-compose.yml",
              name: "minio",
              sizeBytes: 0,
              kind: "s3",
            },
          ],
        });
      if (url.startsWith("/_db/s3/buckets"))
        return jsonResponse({ buckets: [] });
      if (url.startsWith("/_db/schemas"))
        return jsonResponse({
          schemas: [{ name: "public" }],
          selectedSchema: "public",
        });
      if (url.startsWith("/_db/schema"))
        return jsonResponse({
          ...baseSchemaResponse(),
          schema: "public",
          tables: [
            { name: "users", type: "table", rowCount: 1 },
            { name: "sample_locks", type: "table", rowCount: 0 },
          ],
          columnsMap: {
            users: [{ name: "id", type: "integer", primaryKey: true }],
            sample_locks: [{ name: "id", type: "integer", primaryKey: true }],
          },
        });
      if (url.startsWith("/_db/table")) {
        const params = new URL(url, "http://localhost").searchParams;
        const table = params.get("table");
        if (table) fetchedTables.push(table);
        return jsonResponse({
          ...baseTableResponse(),
          table,
          rows: [],
          totalRows: 0,
        });
      }
      return new Response("unexpected request", { status: 500 });
    });

    const view = createViewForTest();
    await view.enter("docker:postgres:demo_app", "public", "sample_locks");

    expect(fetchedTables).toEqual(["sample_locks"]);
    expect(
      document.querySelector(".db-table-item.active")?.textContent,
    ).toMatch(/sample_locks/);
    expect(document.querySelector(".db-grid-status")?.textContent).toMatch(
      /0 rows/,
    );
    await leaveView(view);
  });

  test("does not sync the route while materializing a routed restored table tab", async () => {
    installDatabaseDom();
    const fetchedTables: string[] = [];
    const routeSyncs: unknown[] = [];
    mockFetch((url, init) => {
      if (url === "/_db/tabs" && init?.method === "PUT")
        return jsonResponse({ ok: true });
      if (url === "/_db/tabs")
        return jsonResponse({
          version: 1,
          activeTabId: "postgres",
          tabs: [
            {
              id: "postgres",
              dbId: "docker:postgres:demo_app",
              schema: null,
              table: "sample_locks",
              view: "data",
            },
          ],
        });
      if (url === "/_db/files")
        return jsonResponse({
          files: [
            {
              id: "docker:postgres:demo_app",
              path: "docker-compose.yml",
              name: "postgres",
              sizeBytes: 0,
              kind: "postgres",
            },
          ],
        });
      if (url.startsWith("/_db/schemas"))
        return jsonResponse({
          schemas: [{ name: "public" }],
          selectedSchema: "public",
        });
      if (url.startsWith("/_db/schema"))
        return jsonResponse({
          ...baseSchemaResponse(),
          schema: "public",
          tables: [{ name: "sample_locks", type: "table", rowCount: 0 }],
          columnsMap: {
            sample_locks: [{ name: "id", type: "integer", primaryKey: true }],
          },
        });
      if (url.startsWith("/_db/table")) {
        const table = new URL(url, "http://localhost").searchParams.get(
          "table",
        );
        if (table) fetchedTables.push(table);
        return jsonResponse({
          ...baseTableResponse(),
          table,
          rows: [],
          totalRows: 0,
        });
      }
      return new Response("unexpected request", { status: 500 });
    });

    const view = createViewForTest({
      setRoute(route) {
        routeSyncs.push(route);
      },
    });
    await view.enter("docker:postgres:demo_app", "public", "sample_locks");

    expect(routeSyncs).toEqual([]);
    expect(fetchedTables).toEqual(["sample_locks"]);
    expect(document.querySelector(".db-grid-status")?.textContent).toMatch(
      /0 rows/,
    );
    await leaveView(view);
  });

  test("opens a routed restored S3 tab when a SQL tab is active", async () => {
    installDatabaseDom();
    const s3Requests: string[] = [];
    const sqlRequests: string[] = [];
    mockFetch((url, init) => {
      if (url === "/_db/tabs" && init?.method === "PUT")
        return jsonResponse({ ok: true });
      if (url === "/_db/tabs")
        return jsonResponse({
          version: 1,
          activeTabId: "postgres",
          tabs: [
            {
              id: "postgres",
              dbId: "docker:postgres:demo_app",
              table: "sample_locks",
              view: "data",
            },
            {
              id: "minio",
              dbId: "docker:minio",
              table: null,
              view: "data",
            },
          ],
        });
      if (url === "/_db/files")
        return jsonResponse({
          files: [
            {
              id: "docker:postgres:demo_app",
              path: "docker-compose.yml",
              name: "postgres",
              sizeBytes: 0,
              kind: "postgres",
            },
            {
              id: "docker:minio",
              path: "docker-compose.yml",
              name: "minio",
              sizeBytes: 0,
              kind: "s3",
            },
          ],
        });
      if (url.startsWith("/_db/s3/buckets")) {
        s3Requests.push(url);
        return jsonResponse({ buckets: [{ name: "media" }] });
      }
      if (url.startsWith("/_db/s3/objects")) {
        s3Requests.push(url);
        return jsonResponse({
          objects: [],
          truncated: false,
          scannedObjects: 0,
          scannedPages: 1,
          sort: "updated-desc",
        });
      }
      if (url.startsWith("/_db/schemas")) {
        sqlRequests.push(url);
        return jsonResponse({
          schemas: [{ name: "public" }],
          selectedSchema: "public",
        });
      }
      if (url.startsWith("/_db/schema")) {
        sqlRequests.push(url);
        return jsonResponse({
          ...baseSchemaResponse(),
          schema: "public",
          tables: [{ name: "sample_locks", type: "table", rowCount: 0 }],
          columnsMap: {
            sample_locks: [{ name: "id", type: "integer", primaryKey: true }],
          },
        });
      }
      if (url.startsWith("/_db/table")) {
        sqlRequests.push(url);
        return jsonResponse({
          ...baseTableResponse(),
          table: "sample_locks",
          rows: [],
          totalRows: 0,
        });
      }
      return new Response("unexpected request", { status: 500 });
    });

    const view = createViewForTest();
    await view.enter("docker:minio");

    expect(s3Requests.some((url) => url.startsWith("/_db/s3/buckets"))).toBe(
      true,
    );
    expect(sqlRequests).toEqual([]);
    const activeChip = Array.from(
      document.querySelectorAll(".db-tabs-chip"),
    ).find((chip) =>
      (chip as unknown as HTMLElement).classList.contains("active"),
    ) as unknown as HTMLElement | undefined;
    expect(activeChip?.textContent).toMatch(/minio/);
    await leaveView(view);
  });

  test("aborts stale table fetches when another table is selected", async () => {
    installDatabaseDom();
    const tableRequests: Array<{
      table: string | null;
      signal?: AbortSignal;
      resolve: (res: Response) => void;
      reject: (err: unknown) => void;
    }> = [];

    mockFetch((url, init) => {
      if (url === "/_db/tabs" && init?.method === "PUT")
        return jsonResponse({ ok: true });
      if (url === "/_db/tabs") return jsonResponse({ tabs: [] });
      if (url === "/_db/files") return jsonResponse(baseFilesResponse());
      if (url.startsWith("/_db/schema"))
        return jsonResponse({
          ...baseSchemaResponse(),
          tables: [
            { name: "users", type: "table", rowCount: 1 },
            { name: "bookings", type: "table", rowCount: 1 },
          ],
          columnsMap: {
            users: [{ name: "id", type: "integer", primaryKey: true }],
            bookings: [{ name: "id", type: "integer", primaryKey: true }],
          },
        });
      if (url.startsWith("/_db/table")) {
        const table = new URL(url, "http://localhost").searchParams.get(
          "table",
        );
        return new Promise<Response>((resolve, reject) => {
          tableRequests.push({
            table,
            signal: init?.signal,
            resolve,
            reject,
          });
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("aborted", "AbortError")),
            { once: true },
          );
        });
      }
      return new Response("unexpected request", { status: 500 });
    });

    const view = createViewForTest();
    const entering = view.enter("docker:db", undefined, "users");
    await waitFor(() => tableRequests.length > 0);

    expect(tableRequests.map((req) => req.table)).toEqual(["users"]);
    const bookingsRow = Array.from(
      document.querySelectorAll(".db-table-item"),
    ).find(
      (row) => (row as unknown as HTMLElement).dataset.table === "bookings",
    ) as unknown as HTMLElement | undefined;
    expect(bookingsRow).toBeTruthy();

    const clicking = press(bookingsRow);
    await waitFor(() => tableRequests.length > 1);

    expect(tableRequests[0].signal?.aborted).toBe(true);
    expect(tableRequests.map((req) => req.table)).toEqual([
      "users",
      "bookings",
    ]);

    tableRequests[1].resolve(
      jsonResponse({ ...baseTableResponse(), table: "bookings" }),
    );
    await clicking;
    await entering;

    expect(document.querySelector(".db-pane-error")).toBeNull();
    await leaveView(view);
  });

  test("does not let a stale table response overwrite row counts", async () => {
    installDatabaseDom();
    const tableRequests: Array<{
      table: string | null;
      resolve: (res: Response) => void;
    }> = [];

    mockFetch((url, init) => {
      if (url === "/_db/tabs" && init?.method === "PUT")
        return jsonResponse({ ok: true });
      if (url === "/_db/tabs") return jsonResponse({ tabs: [] });
      if (url === "/_db/files") return jsonResponse(baseFilesResponse());
      if (url.startsWith("/_db/schema"))
        return jsonResponse({
          ...baseSchemaResponse(),
          tables: [
            { name: "users", type: "table", rowCount: 1 },
            { name: "bookings", type: "table", rowCount: 1 },
          ],
          columnsMap: {
            users: [{ name: "id", type: "integer", primaryKey: true }],
            bookings: [{ name: "id", type: "integer", primaryKey: true }],
          },
        });
      if (url.startsWith("/_db/table")) {
        const table = new URL(url, "http://localhost").searchParams.get(
          "table",
        );
        return new Promise<Response>((resolve) => {
          tableRequests.push({ table, resolve });
        });
      }
      return new Response("unexpected request", { status: 500 });
    });

    const view = createViewForTest();
    const entering = view.enter("docker:db", undefined, "users");
    await waitFor(() => tableRequests.length > 0);

    const bookingsRow = Array.from(
      document.querySelectorAll(".db-table-item"),
    ).find(
      (row) => (row as unknown as HTMLElement).dataset.table === "bookings",
    ) as unknown as HTMLElement | undefined;
    expect(bookingsRow).toBeTruthy();

    const clicking = press(bookingsRow);
    await waitFor(() => tableRequests.length > 1);

    tableRequests[1].resolve(
      jsonResponse({
        ...baseTableResponse(),
        table: "bookings",
        rows: Array.from({ length: 7 }, (_, i) => [i + 1]),
        totalRows: 7,
      }),
    );
    await clicking;

    tableRequests[0].resolve(
      jsonResponse({
        ...baseTableResponse(),
        table: "users",
        rows: Array.from({ length: 99 }, (_, i) => [i + 1]),
        totalRows: 99,
      }),
    );
    await entering;

    const counts = Array.from(document.querySelectorAll(".db-table-count")).map(
      (count) => count.textContent,
    );
    expect(counts).toEqual(["1", "7"]);
    await leaveView(view);
  });

  test("coalesces rapid table clicks into a single final table fetch", async () => {
    installDatabaseDom();
    const tableRequests: Array<{
      table: string | null;
      signal?: AbortSignal;
      resolve: (res: Response) => void;
      reject: (err: unknown) => void;
    }> = [];
    mockFetch((url, init) => {
      if (url === "/_db/tabs" && init?.method === "PUT")
        return jsonResponse({ ok: true });
      if (url === "/_db/tabs") return jsonResponse({ tabs: [] });
      if (url === "/_db/files") return jsonResponse(baseFilesResponse());
      if (url.startsWith("/_db/schema"))
        return jsonResponse({
          ...baseSchemaResponse(),
          tables: [
            { name: "users", type: "table", rowCount: 1 },
            { name: "brands", type: "table", rowCount: 40 },
            { name: "cities", type: "table", rowCount: 150_000 },
          ],
          columnsMap: {
            users: [{ name: "id", type: "integer", primaryKey: true }],
            brands: [{ name: "id", type: "integer", primaryKey: true }],
            cities: [{ name: "id", type: "integer", primaryKey: true }],
          },
        });
      if (url.startsWith("/_db/table")) {
        const table = new URL(url, "http://localhost").searchParams.get(
          "table",
        );
        return new Promise<Response>((resolve, reject) => {
          tableRequests.push({
            table,
            signal: init?.signal,
            resolve,
            reject,
          });
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("aborted", "AbortError")),
            { once: true },
          );
        });
      }
      return new Response("unexpected request", { status: 500 });
    });

    const view = createViewForTest();
    const entering = view.enter("docker:db", undefined, "users");
    await waitFor(() => tableRequests.length === 1);
    expect(tableRequests.map((req) => req.table)).toEqual(["users"]);
    tableRequests[0].resolve(jsonResponse(baseTableResponse()));
    await entering;
    tableRequests.length = 0;

    const tableRows = Array.from(
      document.querySelectorAll(".db-table-item"),
    ) as unknown as HTMLElement[];
    const brandsRow = tableRows.find((row) => row.dataset.table === "brands");
    const citiesRow = tableRows.find((row) => row.dataset.table === "cities");
    expect(brandsRow).toBeTruthy();
    expect(citiesRow).toBeTruthy();

    const clickCount = 30;
    const lastTable = (clickCount - 1) % 2 ? "cities" : "brands";
    const noExtraFetchWindowMs = TABLE_SELECT_FETCH_DELAY_MS + 25;
    const clicks: Array<Promise<void>> = [];
    for (let i = 0; i < clickCount; i++) {
      clicks.push(press(i % 2 ? citiesRow : brandsRow));
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    await waitFor(() => tableRequests.length >= 1);
    expect(tableRequests.length > 0).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, noExtraFetchWindowMs));

    expect(tableRequests).toHaveLength(1);
    expect(tableRequests[0].table).toBe(lastTable);
    expect(tableRequests[0].signal?.aborted).toBe(false);
    expect(
      (
        document.querySelector(
          ".db-table-item.active",
        ) as unknown as HTMLElement
      )?.dataset.table,
    ).toBe(lastTable);
    tableRequests[0].resolve(
      jsonResponse({ ...baseTableResponse(), table: lastTable }),
    );
    await Promise.all(clicks);
    expect(document.querySelector(".db-pane-error")).toBeNull();
    await leaveView(view);
  });

  test("sends a keepalive tabs save even when the same state is already pending", async () => {
    installDatabaseDom();
    const tabPuts: RequestInit[] = [];
    mockFetch((url, init) => {
      if (url === "/_db/tabs" && init?.method === "PUT") {
        tabPuts.push(init);
        if (init.keepalive) return jsonResponse({ ok: true });
        return new Promise<Response>((resolve, reject) => {
          init.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("aborted", "AbortError")),
            { once: true },
          );
          setTimeout(() => resolve(jsonResponse({ ok: true })), 5000);
        });
      }
      if (url === "/_db/tabs") return jsonResponse({ tabs: [] });
      if (url === "/_db/files") return jsonResponse(baseFilesResponse());
      if (url.startsWith("/_db/schema"))
        return jsonResponse(baseSchemaResponse());
      if (url.startsWith("/_db/table"))
        return jsonResponse(baseTableResponse());
      return new Response("unexpected request", { status: 500 });
    });

    const view = createViewForTest();
    await view.enter("docker:db");
    // 開いて自動で選んだだけでは保存しない (リポジトリに tabs.json を作らない)。
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(tabPuts).toHaveLength(0);
    document.querySelector<HTMLButtonElement>(".db-tabs-new-btn")?.click();
    await waitFor(() => tabPuts.length === 1);
    expect(Boolean(tabPuts[0]?.keepalive)).toBe(false);

    window.dispatchEvent(new Event("beforeunload"));
    await waitFor(() => tabPuts.length === 2);

    expect(tabPuts[0]?.signal?.aborted).toBe(true);
    expect(tabPuts[1]?.keepalive).toBe(true);
    await leaveView(view);
  });

  test("restores an old query route into the combined data screen", async () => {
    installDatabaseDom();
    const fetchedTables: string[] = [];
    mockFetch((url, init) => {
      if (url === "/_db/tabs" && init?.method === "PUT")
        return jsonResponse({ ok: true });
      if (url === "/_db/tabs") return jsonResponse({ tabs: [] });
      if (url === "/_db/files") return jsonResponse(baseFilesResponse());
      if (url.startsWith("/_db/schema"))
        return jsonResponse({
          ...baseSchemaResponse(),
          tables: [
            { name: "users", type: "table", rowCount: 1 },
            { name: "bookings", type: "table", rowCount: 1 },
          ],
        });
      if (url.startsWith("/_db/table")) {
        const table = new URL(url, "http://localhost").searchParams.get(
          "table",
        );
        if (table) fetchedTables.push(table);
        return jsonResponse({ ...baseTableResponse(), table });
      }
      return new Response("unexpected request", { status: 500 });
    });

    const view = createViewForTest();
    await view.enter("docker:db", undefined, undefined, "query");

    expect(fetchedTables).toEqual(["users"]);
    expect(
      document.querySelector<HTMLElement>(".db-query-editor")?.hidden,
    ).toBe(false);
    expect(document.querySelector<HTMLElement>(".db-grid")?.hidden).toBe(false);
    await leaveView(view);
  });

  test("keeps a restored SQL draft when loading its table", async () => {
    installDatabaseDom();
    mockFetch((url, init) => {
      if (url === "/_db/tabs" && init?.method === "PUT")
        return jsonResponse({ ok: true });
      if (url === "/_db/tabs")
        return jsonResponse({
          version: 1,
          activeTabId: "sample-tab",
          tabs: [
            {
              id: "sample-tab",
              dbId: "docker:db",
              table: "users",
              view: "data",
              sqlDraft: "SELECT id FROM sample_table",
            },
          ],
        });
      if (url === "/_db/files") return jsonResponse(baseFilesResponse());
      if (url.startsWith("/_db/schema"))
        return jsonResponse(baseSchemaResponse());
      if (url.startsWith("/_db/table"))
        return jsonResponse(baseTableResponse());
      return new Response("unexpected request", { status: 500 });
    });

    const view = createViewForTest();
    await view.enter();

    expect(document.querySelector("textarea")?.value).toBe(
      "SELECT id FROM sample_table",
    );
    await leaveView(view);
  });

  test("does not fallback stale restored tabs to the first database", async () => {
    installDatabaseDom();
    const fetchedTables: string[] = [];
    mockFetch((url, init) => {
      if (url === "/_db/tabs" && init?.method === "PUT")
        return jsonResponse({ ok: true });
      if (url === "/_db/tabs")
        return jsonResponse({
          version: 1,
          activeTabId: "stale",
          tabs: [
            {
              id: "stale",
              dbId: ".code-viewer/db-snapshots.sqlite",
              table: "sample_bookings",
              view: "data",
            },
          ],
        });
      if (url === "/_db/files") return jsonResponse(baseFilesResponse());
      if (url.startsWith("/_db/table")) {
        const table = new URL(url, "http://localhost").searchParams.get(
          "table",
        );
        if (table) fetchedTables.push(table);
        return jsonResponse({ ...baseTableResponse(), table });
      }
      return new Response("unexpected request", { status: 500 });
    });

    const view = createViewForTest();
    await view.enter();

    expect(fetchedTables).toEqual([]);
    await leaveView(view);
  });

  test("does not fallback an invalid routed database when restored tabs exist", async () => {
    installDatabaseDom();
    const fetchedTables: string[] = [];
    mockFetch((url, init) => {
      if (url === "/_db/tabs" && init?.method === "PUT")
        return jsonResponse({ ok: true });
      if (url === "/_db/tabs")
        return jsonResponse({
          version: 1,
          activeTabId: "empty",
          tabs: [{ id: "empty", dbId: null, table: null, view: "data" }],
        });
      if (url === "/_db/files") return jsonResponse(baseFilesResponse());
      if (url.startsWith("/_db/table")) {
        const table = new URL(url, "http://localhost").searchParams.get(
          "table",
        );
        if (table) fetchedTables.push(table);
        return jsonResponse({ ...baseTableResponse(), table });
      }
      return new Response("unexpected request", { status: 500 });
    });

    const view = createViewForTest();
    await view.enter(
      ".code-viewer/db-snapshots.sqlite",
      undefined,
      "sample_bookings",
    );

    expect(fetchedTables).toEqual([]);
    await leaveView(view);
  });

  test("shows restored tab labels before database files finish loading", async () => {
    installDatabaseDom();
    let resolveFiles!: (res: Response) => void;
    const filesPromise = new Promise<Response>((resolve) => {
      resolveFiles = resolve;
    });
    mockFetch((url, init) => {
      if (url === "/_db/tabs" && init?.method === "PUT")
        return jsonResponse({ ok: true });
      if (url === "/_db/tabs")
        return jsonResponse({
          version: 1,
          activeTabId: "sqlite",
          tabs: [
            {
              id: "docker",
              dbId: "docker:db:sample_v2_development",
              table: "users",
              view: "data",
            },
            {
              id: "sqlite",
              dbId: "data/app.sqlite",
              table: "users",
              view: "data",
            },
          ],
        });
      if (url === "/_db/files") return filesPromise;
      if (url.startsWith("/_db/schema"))
        return jsonResponse(baseSchemaResponse());
      if (url.startsWith("/_db/table"))
        return jsonResponse(baseTableResponse());
      return new Response("unexpected request", { status: 500 });
    });

    const view = createViewForTest();
    const entering = view.enter();
    await waitFor(() => restoredTabLabels().length === 2);

    expect(restoredTabLabels()).toEqual(["db", "app.sqlite"]);

    resolveFiles(
      jsonResponse({
        files: [
          ...baseFilesResponse().files,
          {
            id: "data/app.sqlite",
            path: "data/app.sqlite",
            name: "app.sqlite",
            sizeBytes: 100,
            kind: "sqlite",
          },
        ],
      }),
    );
    await entering;
    await leaveView(view);
  });

  test("loads restored background tabs lazily when selected", async () => {
    installDatabaseDom();
    const events: string[] = [];
    mockFetch((url, init) => {
      if (url === "/_db/tabs" && init?.method === "PUT")
        return jsonResponse({ ok: true });
      if (url === "/_db/tabs")
        return jsonResponse({
          version: 1,
          activeTabId: "analytics",
          tabs: [
            {
              id: "main",
              dbId: "docker:db",
              table: "users",
              view: "data",
            },
            {
              id: "analytics",
              dbId: "docker:analytics",
              table: "bookings",
              view: "data",
            },
          ],
        });
      if (url === "/_db/files")
        return jsonResponse({
          files: [
            ...baseFilesResponse().files,
            {
              id: "docker:analytics",
              path: "docker-compose.yml",
              name: "analytics",
              sizeBytes: 0,
              kind: "mysql",
            },
          ],
        });
      if (url.startsWith("/_db/schema")) {
        const db = new URL(url, "http://localhost").searchParams.get("db");
        events.push(`schema:${db}`);
        // 実際のサーバと同じく、全部のテーブルの列を付ける (列が分からない表は
        // 「新しい順」を決めるために取り直す)。
        return jsonResponse({
          ...baseSchemaResponse(),
          tables: [
            { name: "users", type: "table", rowCount: 1 },
            { name: "bookings", type: "table", rowCount: 1 },
          ],
          columnsMap: {
            users: [{ name: "id", type: "integer", primaryKey: true }],
            bookings: [{ name: "id", type: "integer", primaryKey: true }],
          },
        });
      }
      if (url.startsWith("/_db/table")) {
        const params = new URL(url, "http://localhost").searchParams;
        events.push(`table:${params.get("db")}:${params.get("table")}`);
        return jsonResponse({
          ...baseTableResponse(),
          table: params.get("table"),
        });
      }
      return new Response("unexpected request", { status: 500 });
    });

    const view = createViewForTest();
    await view.enter();

    expect(events.slice(0, 2)).toEqual([
      "schema:docker:analytics",
      "table:docker:analytics:bookings",
    ]);
    expect(events).toEqual([
      "schema:docker:analytics",
      "table:docker:analytics:bookings",
    ]);

    const mainTab = document.querySelectorAll(
      ".db-tabs-chip",
    )[0] as unknown as HTMLElement;
    await press(mainTab);
    await waitFor(() => events.includes("table:docker:db:users"));
    expect(events).toEqual([
      "schema:docker:analytics",
      "table:docker:analytics:bookings",
      "schema:docker:db",
      "table:docker:db:users",
    ]);
    await leaveView(view);
  });

  test("renders query fetch errors returned as plain text", async () => {
    installDatabaseDom();
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    mockFetch((url, init) => {
      if (url === "/_db/tabs" && init?.method === "PUT")
        return jsonResponse({ ok: true });
      if (url === "/_db/tabs") return jsonResponse({ tabs: [] });
      if (url === "/_db/files") return jsonResponse(baseFilesResponse());
      if (url.startsWith("/_db/schema"))
        return jsonResponse(baseSchemaResponse());
      if (url.startsWith("/_db/table"))
        return jsonResponse(baseTableResponse());
      if (url === "/_db/query")
        return new Response("query failed", { status: 500 });
      return new Response("unexpected request", { status: 500 });
    });

    const view = createViewForTest();
    await view.enter("docker:db");

    const textarea = document.querySelector(
      "textarea",
    ) as unknown as HTMLTextAreaElement | null;
    if (textarea) textarea.value = "select 1";
    const runButton = document.querySelector(
      ".db-query-run",
    ) as unknown as HTMLElement | null;
    await press(runButton);

    // 画面には error の型名から始まる全文を出す (cause があれば続く)。
    expect(document.querySelector(".db-query-error")?.textContent).toBe(
      "Error: failed to execute query (HTTP 500): query failed",
    );
    expect(document.querySelector<HTMLElement>(".db-grid")?.hidden).toBe(true);
    expect(
      document.querySelector<HTMLElement>(".db-query-editor")?.hidden,
    ).toBe(false);

    const dataTab = document.querySelector(
      ".db-tab",
    ) as unknown as HTMLElement | null;
    await press(dataTab);

    expect(document.querySelector<HTMLElement>(".db-grid")?.hidden).toBe(false);
    expect(
      document.querySelector<HTMLElement>(".db-query-editor")?.hidden,
    ).toBe(false);
    expect(
      document.querySelector<HTMLElement>(".db-query-result")?.hidden,
    ).toBe(true);
    expect(consoleError).toHaveBeenCalledWith(
      "Failed to execute query",
      expect.objectContaining({
        message: "failed to execute query (HTTP 500): query failed",
      }),
    );
    await leaveView(view);
  });

  test("loads and saves database UI preferences as one explicit operation", async () => {
    installDatabaseDom();
    let savedBody = "";
    let trackedRequests = 0;
    mockFetch(
      (url, init) => {
        if (url !== "/_db/ui")
          return new Response("unexpected request", { status: 500 });
        if (init?.method === "PATCH") {
          savedBody = String(init.body);
          return jsonResponse({
            version: 1,
            columnWidths: {},
            prefs: { inferFkRails: true, s3TooltipEnabled: false },
          });
        }
        return jsonResponse({
          version: 1,
          columnWidths: {},
          prefs: { inferFkRails: false, s3TooltipEnabled: true },
        });
      },
      { handleDbUi: true },
    );
    const view = createViewForTest({
      trackLoad: async (promise) => {
        trackedRequests++;
        return await promise;
      },
    });

    await view.loadDbUiPrefs();
    expect(view.getDbUiPref("inferFkRails", true)).toBe(false);
    await view.saveDbUiPrefs({
      inferFkRails: true,
      s3TooltipEnabled: false,
    });

    expect(JSON.parse(savedBody)).toEqual({
      prefs: { inferFkRails: true, s3TooltipEnabled: false },
    });
    expect(view.getDbUiPref("inferFkRails", false)).toBe(true);
    expect(view.getDbUiPref("s3TooltipEnabled", true)).toBe(false);
    expect(trackedRequests).toBe(2);
    await leaveView(view);
  });

  test("surfaces every database UI preference save error detail", async () => {
    installDatabaseDom();
    mockFetch(
      () =>
        new Response(
          JSON.stringify({
            errors: [
              { code: "invalid_pref", field: "prefs.inferFkRails" },
              {
                code: "invalid_value",
                field: "prefs.s3TooltipEnabled",
              },
            ],
          }),
          {
            status: 422,
            headers: { "Content-Type": "application/json" },
          },
        ),
      { handleDbUi: true },
    );
    const view = createViewForTest();
    let failure: unknown;
    try {
      await view.saveDbUiPrefs({ inferFkRails: true });
    } catch (error) {
      failure = error;
    }

    expect(failure).toMatchObject({
      message: expect.stringContaining("invalid_pref"),
    });
    expect(failure).toMatchObject({
      message: expect.stringContaining("invalid_value"),
    });
    await leaveView(view);
  });

  test("retries a database UI preference load after preserving its failure", async () => {
    installDatabaseDom();
    let requestCount = 0;
    mockFetch(
      () => {
        requestCount++;
        if (requestCount === 1)
          return new Response("temporary load failure", { status: 503 });
        return jsonResponse({
          version: 1,
          columnWidths: {},
          prefs: { inferFkRails: true },
        });
      },
      { handleDbUi: true },
    );
    const view = createViewForTest();

    await expect(view.loadDbUiPrefs()).rejects.toThrow(
      "temporary load failure",
    );
    await view.loadDbUiPrefs();

    expect(requestCount).toBe(2);
    expect(view.getDbUiPref("inferFkRails", false)).toBe(true);
    await leaveView(view);
  });

  test("shows datastore list failures and retries instead of caching an empty list", async () => {
    installDatabaseDom();
    let filesFetches = 0;
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    mockFetch((url, init) => {
      if (url === "/_db/tabs" && init?.method === "PUT")
        return jsonResponse({ ok: true });
      if (url === "/_db/tabs") return jsonResponse({ tabs: [] });
      if (url === "/_db/files") {
        filesFetches++;
        if (filesFetches === 1) {
          return new Response("list reason\nlist detail", { status: 503 });
        }
        return jsonResponse(baseFilesResponse());
      }
      if (url.startsWith("/_db/schema"))
        return jsonResponse(baseSchemaResponse());
      if (url.startsWith("/_db/table"))
        return jsonResponse(baseTableResponse());
      return new Response("unexpected request", { status: 500 });
    });

    const view = createViewForTest();
    await view.enter();

    const unavailable = document.querySelector(
      ".db-no-datastores",
    ) as unknown as HTMLElement;
    expect(unavailable.hidden).toBe(false);
    expect(
      (unavailable.querySelector(".db-pane-error")?.textContent || "").includes(
        "list reason\nlist detail",
      ),
    ).toBe(true);
    expect(consoleError).toHaveBeenCalledWith(
      "Failed to load datastores",
      expect.any(Error),
    );

    await view.refresh();
    expect(filesFetches).toBe(2);
    // 失敗の文は消え、データストアを選んでいないタブとして案内を出す。
    expect(unavailable.querySelector(".db-pane-error")).toBeNull();
    expect(unavailable.querySelector(".db-pane-empty-title")?.textContent).toBe(
      "Choose a datastore",
    );
    expect(
      (
        document.querySelector(
          ".db-file-select",
        ) as unknown as HTMLSelectElement
      ).disabled,
    ).toBe(false);
    await leaveView(view);
  });

  test("shows column and DDL fetch failures in the schema pane", async () => {
    installDatabaseDom();
    let ddlFails = false;
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    mockFetch((url, init) => {
      if (url === "/_db/tabs" && init?.method === "PUT")
        return jsonResponse({ ok: true });
      if (url === "/_db/tabs") return jsonResponse({ tabs: [] });
      if (url === "/_db/files") return jsonResponse(baseFilesResponse());
      if (url.startsWith("/_db/schema")) {
        return jsonResponse({ ...baseSchemaResponse(), columnsMap: undefined });
      }
      if (url.startsWith("/_db/columns")) {
        return ddlFails
          ? jsonResponse({ columns: baseTableResponse().columns })
          : new Response("column reason\ncolumn detail", { status: 502 });
      }
      if (url.startsWith("/_db/ddl")) {
        return new Response("DDL reason\nDDL detail", { status: 500 });
      }
      if (url.startsWith("/_db/table"))
        return jsonResponse(baseTableResponse());
      return new Response("unexpected request", { status: 500 });
    });

    const view = createViewForTest();
    await view.enter("docker:db", undefined, "users", "schema");
    const schema = document.querySelector(
      ".db-schema-view",
    ) as unknown as HTMLElement;
    expect(
      (schema.querySelector(".db-pane-error")?.textContent || "").includes(
        "column reason\ncolumn detail",
      ),
    ).toBe(true);

    ddlFails = true;
    await view.enter("docker:db", undefined, "users", "data");
    const table = document.querySelector(
      ".db-table-item",
    ) as unknown as HTMLElement;
    await openContextMenu(table);
    const createItem = openedMenus[openedMenus.length - 1]?.find(
      (item) => item.kind !== "separator" && item.label === "View CREATE TABLE",
    );
    if (!createItem || createItem.kind === "separator")
      throw new Error("the table menu has no View CREATE TABLE item");
    createItem.onSelect();
    await waitFor(() =>
      Boolean(
        schema
          .querySelector(".db-pane-error")
          ?.textContent.includes("DDL detail"),
      ),
    );
    expect(
      consoleError.mock.calls.some((call) => call[1] instanceof Error),
    ).toBe(true);
    await leaveView(view);
  });

  test("shows row count refresh failures without replacing the known count", async () => {
    installDatabaseDom();
    let tableFetches = 0;
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    mockFetch((url, init) => {
      if (url === "/_db/tabs" && init?.method === "PUT")
        return jsonResponse({ ok: true });
      if (url === "/_db/tabs") return jsonResponse({ tabs: [] });
      if (url === "/_db/files") return jsonResponse(baseFilesResponse());
      if (url.startsWith("/_db/schema"))
        return jsonResponse(baseSchemaResponse());
      if (url.startsWith("/_db/table-count"))
        return new Response("count reason\ncount detail", { status: 503 });
      if (url.startsWith("/_db/table")) {
        tableFetches++;
        return jsonResponse(baseTableResponse());
      }
      return new Response("unexpected request", { status: 500 });
    });

    const view = createViewForTest();
    await view.enter("docker:db");
    const filter = document.querySelector(
      ".db-grid-filter-input",
    ) as unknown as HTMLInputElement;
    filter.value = "sample";
    await typeIn(filter);
    await waitFor(() => tableFetches === 2);
    await press(document.querySelector(".db-grid-refresh"));
    await waitFor(() =>
      Boolean(
        document
          .querySelector(".db-refresh-result.db-pane-error")
          ?.textContent.includes("count detail"),
      ),
    );
    expect(document.querySelector(".db-table-count")?.textContent).toBe("1");
    expect(consoleError).toHaveBeenCalledWith(
      "Failed to refresh table count",
      expect.any(Error),
    );
    await leaveView(view);
  });

  test("shows tab save failures while leaving the current screen usable", async () => {
    installDatabaseDom();
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    mockFetch((url, init) => {
      if (url === "/_db/tabs" && init?.method === "PUT") {
        return new Response("save reason\nsave detail", { status: 507 });
      }
      if (url === "/_db/tabs") return jsonResponse({ tabs: [] });
      if (url === "/_db/files") return jsonResponse(baseFilesResponse());
      if (url.startsWith("/_db/schema"))
        return jsonResponse(baseSchemaResponse());
      if (url.startsWith("/_db/table"))
        return jsonResponse(baseTableResponse());
      return new Response("unexpected request", { status: 500 });
    });

    const view = createViewForTest();
    await view.enter("docker:db");
    document.querySelector<HTMLButtonElement>(".db-tabs-new-btn")?.click();
    await waitFor(() =>
      Boolean(
        document
          .querySelector(".db-refresh-result.db-pane-error")
          ?.textContent.includes("save detail"),
      ),
    );
    expect(document.querySelector(".db-table-name")?.textContent).toBe("users");
    expect(consoleError).toHaveBeenCalledWith(
      "Failed to save database tabs",
      expect.any(Error),
    );
    await leaveView(view);
  });

  test("reports failed expanded-state and column-width persistence", async () => {
    installDatabaseDom();
    let patchAttempts = 0;
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    mockFetch(
      (url, init) => {
        if (url === "/_db/ui" && init?.method === "PATCH") {
          patchAttempts++;
          return new Response("settings reason\nsettings detail", {
            status: 507,
          });
        }
        if (url === "/_db/ui") {
          return jsonResponse({ version: 1, columnWidths: {}, prefs: {} });
        }
        if (url === "/_db/tabs" && init?.method === "PUT")
          return jsonResponse({ ok: true });
        if (url === "/_db/tabs") return jsonResponse({ tabs: [] });
        if (url === "/_db/files") return jsonResponse(baseFilesResponse());
        if (url.startsWith("/_db/schema"))
          return jsonResponse(baseSchemaResponse());
        if (url.startsWith("/_db/table"))
          return jsonResponse(baseTableResponse());
        return new Response("unexpected request", { status: 500 });
      },
      { handleDbUi: true },
    );

    const view = createViewForTest();
    await view.enter("docker:db");
    await press(document.querySelector(".db-table-arrow"));
    await waitFor(() => patchAttempts === 1);

    const header = document.querySelector(
      ".db-grid-header-cell",
    ) as unknown as HTMLElement;
    const resize = header.querySelector(
      ".db-grid-resize-handle",
    ) as unknown as HTMLElement;
    await doubleClick(resize);
    await waitFor(() => patchAttempts === 2);
    await waitFor(() => consoleError.mock.calls.length === 2);

    const status = document.querySelector(".db-refresh-result.db-pane-error");
    expect(
      (status?.textContent || "").includes("settings reason\nsettings detail"),
    ).toBe(true);
    expect(consoleError).toHaveBeenCalledTimes(2);
    await leaveView(view);
  });

  test("reports tab restore and datastore close failures", async () => {
    installDatabaseDom();
    let closeAttempts = 0;
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    mockFetch((url, init) => {
      if (url === "/_db/tabs" && !init?.method)
        return new Response("restore reason\nrestore detail", { status: 500 });
      if (url === "/_db/tabs" && init?.method === "PUT")
        return jsonResponse({ ok: true });
      if (url === "/_db/files") return jsonResponse(baseFilesResponse());
      if (url.startsWith("/_db/schema"))
        return jsonResponse(baseSchemaResponse());
      if (url.startsWith("/_db/table"))
        return jsonResponse(baseTableResponse());
      if (url === "/_db/close") {
        closeAttempts++;
        return new Response("close reason\nclose detail", { status: 503 });
      }
      return new Response("unexpected request", { status: 500 });
    });

    const view = createViewForTest();
    await view.enter("docker:db");
    expect(
      (
        document.querySelector(".db-refresh-result.db-pane-error")
          ?.textContent || ""
      ).includes("restore reason\nrestore detail"),
    ).toBe(true);

    await press(document.querySelector(".db-tabs-chip-close"));
    await waitFor(() => closeAttempts === 1);
    await waitFor(() =>
      consoleError.mock.calls.some((call) =>
        String(call[0]).includes("Failed to close datastore"),
      ),
    );
    expect(
      (
        document.querySelector(".db-refresh-result.db-pane-error")
          ?.textContent || ""
      ).includes("close reason\nclose detail"),
    ).toBe(true);
    await leaveView(view);
  });

  test("logs malformed database events with the body and triggers a full refresh", async () => {
    installDatabaseDom();
    let filesFetches = 0;
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    mockFetch((url, init) => {
      if (url === "/_db/tabs" && init?.method === "PUT")
        return jsonResponse({ ok: true });
      if (url === "/_db/tabs") return jsonResponse({ tabs: [] });
      if (url === "/_db/files") {
        filesFetches++;
        return jsonResponse(baseFilesResponse());
      }
      if (url.startsWith("/_db/schema"))
        return jsonResponse(baseSchemaResponse());
      if (url.startsWith("/_db/table"))
        return jsonResponse(baseTableResponse());
      return new Response("unexpected request", { status: 500 });
    });

    const view = createViewForTest();
    await view.enter("docker:db");
    view.handleSse("db-change", "{malformed event body");
    await waitFor(() => filesFetches === 2);

    expect(consoleError).toHaveBeenCalledWith(
      "Failed to parse database event",
      expect.objectContaining({
        message: expect.stringContaining("{malformed event body"),
      }),
    );
    await leaveView(view);
  });

  test("preserves the Local History HTTP failure body in the editor", async () => {
    installDatabaseDom();
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    mockFetch(
      (url, init) => {
        if (url === "/_db/tabs" && init?.method === "PUT")
          return jsonResponse({ ok: true });
        if (url === "/_db/tabs") return jsonResponse({ tabs: [] });
        if (url === "/_db/files") return jsonResponse(baseFilesResponse());
        if (url.startsWith("/_db/schema"))
          return jsonResponse(baseSchemaResponse());
        if (url.startsWith("/_db/table"))
          return jsonResponse(baseTableResponse());
        if (url.startsWith("/_db/history")) {
          return new Response("history reason\nhistory detail", {
            status: 502,
          });
        }
        return new Response("unexpected request", { status: 500 });
      },
      { handleDbHistory: true },
    );

    const view = createViewForTest();
    await view.enter("docker:db");
    await press(document.querySelector(".db-query-history-btn"));
    await waitFor(() =>
      Boolean(
        document
          .querySelector(".db-query-history-dropdown")
          ?.textContent.includes("history detail"),
      ),
    );
    expect(
      consoleError.mock.calls.some((call) =>
        String(call[0]).includes("Local History"),
      ),
    ).toBe(true);
    await leaveView(view);
  });
});

describe("the database view's view", () => {
  test("passes the opened tab and the datastores to the view", async () => {
    installDatabaseDom();
    mockFetch((url, init) => {
      if (url === "/_db/tabs" && init?.method === "PUT")
        return jsonResponse({ ok: true });
      if (url === "/_db/tabs") return jsonResponse({ tabs: [] });
      if (url === "/_db/files") return jsonResponse(baseFilesResponse());
      if (url.startsWith("/_db/schema"))
        return jsonResponse(baseSchemaResponse());
      if (url.startsWith("/_db/table"))
        return jsonResponse(baseTableResponse());
      return jsonResponse({});
    });
    const chips: Parameters<(typeof DEFAULT_VIEW)["tabChip"]>[0][] = [];
    const options: Parameters<(typeof DEFAULT_VIEW)["options"]>[0][] = [];
    const view = createViewForTest(
      {},
      {
        ...DEFAULT_VIEW,
        tabChip: (props) => {
          chips.push(props);
          return DEFAULT_VIEW.tabChip(props);
        },
        options: (list) => {
          options.push(list);
          return DEFAULT_VIEW.options(list);
        },
      },
    );
    await view.enter("docker:db");
    // 接続の選択肢 (スキーマの選択肢も同じ部品で描く)。
    const datastores = () =>
      options.find((list) =>
        list.some((option) => option.value === "docker:db"),
      );
    await waitFor(() => datastores() !== undefined);
    expect([chips.length, datastores()?.map((option) => option.label)]).toEqual(
      [1, ["db (Docker)"]],
    );
    await leaveView(view);
  });
});
