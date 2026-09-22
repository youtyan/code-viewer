// Query history pane の実DOM挙動を happy-dom 上で検証する。
// 更新ボタンはサーバの履歴再取得を使い、更新中フィードバックを出す。

import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, afterEach, describe, expect, test, vi } from "vitest";
import { q } from "./_test-helpers";

GlobalRegistrator.register();

const { createQueryHistoryView } = await import(
  "../views/database/query-history-view"
);
const { dbText } = await import("../views/database/i18n");

const originalFetch = globalThis.fetch;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("query history view", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  afterAll(() => {
    GlobalRegistrator.unregister();
  });

  test("refresh button identifies query history and shows in-flight feedback", async () => {
    const fetchWait = deferred<Response>();
    const urls: string[] = [];
    globalThis.fetch = ((input: RequestInfo | URL) => {
      urls.push(String(input));
      return fetchWait.promise;
    }) as typeof fetch;

    const view = createQueryHistoryView({
      getDbId: () => "sample.db",
      getSchema: () => "public",
      copySqlToQuery: () => undefined,
      getText: () => dbText("en"),
    });
    document.body.appendChild(view.el);

    const refresh = q<HTMLButtonElement>(view.el, ".db-query-history-refresh");
    expect(refresh.textContent || "").toMatch(/Refresh history/);
    expect(refresh.title).toBe("Refresh query history");
    expect(refresh.getAttribute("aria-label")).toBe("Refresh query history");
    expect(refresh.getAttribute("aria-busy")).toBe("false");
    const result = q<HTMLElement>(view.el, ".db-query-history-refresh-result");
    expect(result.hidden).toBe(true);

    refresh.click();
    expect(urls).toEqual(["/_db/history?db=sample.db&schema=public"]);
    expect(refresh.disabled).toBe(true);
    expect(refresh.classList.contains("spinning")).toBe(true);
    expect(refresh.getAttribute("aria-busy")).toBe("true");

    fetchWait.resolve(
      new Response(JSON.stringify({ entries: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    await flush();

    expect(refresh.disabled).toBe(false);
    expect(refresh.classList.contains("spinning")).toBe(false);
    expect(refresh.getAttribute("aria-busy")).toBe("false");
    expect(result.hidden).toBe(false);
    expect(result.textContent).toBe("No new queries");
    expect(result.classList.contains("changed")).toBe(false);

    view.clear();
    expect(result.hidden).toBe(true);
    expect(result.textContent).toBe("");
  });

  test("manual refresh announces newly added query history entries", async () => {
    const firstEntry = {
      id: "sample-entry-1",
      dbId: "sample.db",
      schema: "public",
      sql: "SELECT id FROM sample_table",
      columns: ["id"],
      rowsPreview: [[1]],
      rowCount: 1,
      savedRows: 1,
      truncated: false,
      elapsedMs: 3,
      executedAt: "2026-01-02T03:04:05",
      executedBy: "user",
      source: "browser",
    };
    const secondEntry = {
      ...firstEntry,
      id: "sample-entry-2",
      sql: "SELECT name FROM sample_table",
    };
    const states = [
      { entries: [firstEntry] },
      { entries: [secondEntry, firstEntry] },
    ];
    globalThis.fetch = ((_input: RequestInfo | URL) =>
      Promise.resolve(
        new Response(JSON.stringify(states.shift()), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )) as typeof fetch;

    const view = createQueryHistoryView({
      getDbId: () => "sample.db",
      getSchema: () => "public",
      copySqlToQuery: () => undefined,
      getText: () => dbText("en"),
    });
    document.body.appendChild(view.el);

    await view.refresh({ force: true });
    const result = q<HTMLElement>(view.el, ".db-query-history-refresh-result");
    expect(result.hidden).toBe(true);

    q<HTMLButtonElement>(view.el, ".db-query-history-refresh").click();
    await flush();

    expect(result.hidden).toBe(false);
    expect(result.textContent).toBe("+1 queries");
    expect(result.classList.contains("changed")).toBe(true);
  });

  test("selected query details show execution metadata", async () => {
    globalThis.fetch = ((_input: RequestInfo | URL) =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            entries: [
              {
                id: "sample-entry",
                dbId: "sample.db",
                schema: "public",
                sql: "SELECT id FROM sample_table ORDER BY id",
                columns: ["id"],
                rowsPreview: [[1], [2]],
                rowCount: 12,
                savedRows: 2,
                truncated: true,
                elapsedMs: 34,
                executedAt: "2026-01-02T03:04:05",
                executedBy: "ai",
                source: "browser",
              },
            ],
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      )) as typeof fetch;

    const view = createQueryHistoryView({
      getDbId: () => "sample.db",
      getSchema: () => "public",
      copySqlToQuery: () => undefined,
      getText: () => dbText("en"),
    });
    document.body.appendChild(view.el);

    await view.refresh({ force: true });
    q<HTMLElement>(view.el, ".db-query-history-entry").click();

    const meta = q<HTMLElement>(view.el, ".db-query-history-detail-meta");
    expect(meta.textContent || "").toMatch(/AI/);
    expect(meta.textContent || "").toMatch(/2026-01-02 03:04:05/);
    expect(meta.textContent || "").toMatch(/12\+ rows/);
    expect(meta.textContent || "").toMatch(/34ms/);
  });

  test("keeps an invalid execution time visible and reports the reason", async () => {
    const invalidTime = "invalid-timestamp";
    globalThis.fetch = ((_input: RequestInfo | URL) =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            entries: [
              {
                id: "sample-entry",
                dbId: "sample.db",
                schema: "public",
                sql: "SELECT id FROM sample_table",
                columns: ["id"],
                rowsPreview: [[1]],
                rowCount: 1,
                savedRows: 1,
                truncated: false,
                elapsedMs: 3,
                executedAt: invalidTime,
                executedBy: "user",
                source: "browser",
              },
            ],
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      )) as typeof fetch;
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const view = createQueryHistoryView({
      getDbId: () => "sample.db",
      getSchema: () => "public",
      copySqlToQuery: () => undefined,
      getText: () => dbText("en"),
    });
    document.body.appendChild(view.el);

    await view.refresh({ force: true });

    const time = q<HTMLElement>(view.el, ".db-query-history-time");
    expect(time.textContent).toBe(invalidTime);
    expect(time.title).toBe(invalidTime);
    expect(consoleError).toHaveBeenCalledWith(
      "Failed to format query history timestamp",
      expect.objectContaining({
        message: "Invalid query history timestamp: invalid-timestamp",
      }),
    );
  });

  test("keeps history and reports refresh, delete, and clear failures", async () => {
    const entry = {
      id: "sample-entry",
      dbId: "sample.db",
      schema: "public",
      sql: "SELECT id FROM sample_table",
      columns: ["id"],
      rowsPreview: [[1]],
      rowCount: 1,
      savedRows: 1,
      truncated: false,
      elapsedMs: 3,
      executedAt: "2026-01-02T03:04:05",
      executedBy: "user",
      source: "browser",
    };
    let initialLoad = true;
    globalThis.fetch = ((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/_db/history?") && initialLoad) {
        initialLoad = false;
        return Promise.resolve(
          new Response(JSON.stringify({ entries: [entry] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      if (url.startsWith("/_db/history?")) {
        return Promise.resolve(
          new Response("refresh reason\nrefresh detail", { status: 503 }),
        );
      }
      if (url === "/_db/history/delete") {
        return Promise.resolve(
          new Response("delete reason\ndelete detail", { status: 409 }),
        );
      }
      return Promise.reject(new TypeError("clear connection lost"));
    }) as typeof fetch;
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    const view = createQueryHistoryView({
      getDbId: () => "sample.db",
      getSchema: () => "public",
      copySqlToQuery: () => undefined,
      getText: () => dbText("en"),
    });
    document.body.appendChild(view.el);
    await view.refresh({ force: true });

    q<HTMLButtonElement>(view.el, ".db-query-history-refresh").click();
    await flush();
    const result = q<HTMLElement>(view.el, ".db-query-history-refresh-result");
    expect(result.textContent).toContain("refresh reason\nrefresh detail");
    expect(result.classList.contains("db-pane-error")).toBe(true);
    expect(view.el.querySelectorAll(".db-query-history-entry")).toHaveLength(1);

    q<HTMLElement>(view.el, ".db-query-history-entry").click();
    const deleteButton = q<HTMLButtonElement>(
      view.el,
      ".db-query-history-detail-actions .db-query-history-danger",
    );
    deleteButton.click();
    deleteButton.click();
    await flush();
    expect(result.textContent).toContain("delete reason\ndelete detail");
    expect(view.el.querySelectorAll(".db-query-history-entry")).toHaveLength(1);

    const clearButton = q<HTMLButtonElement>(
      view.el,
      ".db-query-history-toolbar .db-query-history-danger",
    );
    clearButton.click();
    clearButton.click();
    await flush();
    expect(result.textContent).toContain("TypeError: clear connection lost");
    expect(view.el.querySelectorAll(".db-query-history-entry")).toHaveLength(1);
    expect(consoleError).toHaveBeenCalledTimes(3);
    for (const call of consoleError.mock.calls) {
      expect(call.some((value) => value instanceof Error)).toBe(true);
    }
  });

  // 直す前は日本語の設定でも、失敗の詳細の頭に英語の操作名が残っていた。
  test.each([
    {
      language: "en" as const,
      refresh: "refresh query history",
      remove: "delete query history entry",
      clear: "clear query history",
    },
    {
      language: "ja" as const,
      refresh: "クエリ履歴を更新できませんでした",
      remove: "クエリ履歴の項目を削除できませんでした",
      clear: "クエリ履歴を消去できませんでした",
    },
  ])("names the failed operation in the display language: $language", async ({
    language,
    refresh,
    remove,
    clear,
  }) => {
    const entry = {
      id: "sample-entry",
      dbId: "sample.db",
      schema: "public",
      sql: "SELECT id FROM sample_table",
      columns: ["id"],
      rowsPreview: [[1]],
      rowCount: 1,
      savedRows: 1,
      truncated: false,
      elapsedMs: 3,
      executedAt: "2026-01-02T03:04:05",
      executedBy: "user",
      source: "browser",
    };
    let initialLoad = true;
    globalThis.fetch = ((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/_db/history?") && initialLoad) {
        initialLoad = false;
        return Promise.resolve(
          new Response(JSON.stringify({ entries: [entry] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      return Promise.resolve(new Response("sample failure", { status: 500 }));
    }) as typeof fetch;
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const view = createQueryHistoryView({
      getDbId: () => "sample.db",
      getSchema: () => "public",
      copySqlToQuery: () => undefined,
      getText: () => dbText(language),
    });
    document.body.appendChild(view.el);
    await view.refresh({ force: true });
    const result = q<HTMLElement>(view.el, ".db-query-history-refresh-result");

    q<HTMLButtonElement>(view.el, ".db-query-history-refresh").click();
    await flush();
    expect(result.textContent).toContain(
      `${refresh} (HTTP 500): sample failure`,
    );

    q<HTMLElement>(view.el, ".db-query-history-entry").click();
    const deleteButton = q<HTMLButtonElement>(
      view.el,
      ".db-query-history-detail-actions .db-query-history-danger",
    );
    deleteButton.click();
    deleteButton.click();
    await flush();
    expect(result.textContent).toContain(
      `${remove} (HTTP 500): sample failure`,
    );

    const clearButton = q<HTMLButtonElement>(
      view.el,
      ".db-query-history-toolbar .db-query-history-danger",
    );
    clearButton.click();
    clearButton.click();
    await flush();
    expect(result.textContent).toContain(`${clear} (HTTP 500): sample failure`);
  });
});
