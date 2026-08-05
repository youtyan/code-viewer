// Query history pane の実DOM挙動を happy-dom 上で検証する。
// 更新ボタンはサーバの履歴再取得を使い、更新中フィードバックを出す。

import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, afterEach, describe, expect, test } from "vitest";
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
});
