// Data の全体検索の画面を happy-dom の実描画で確かめる。

import "./_dom";
import { afterEach, describe, expect, test, vi } from "vitest";
import { q, waitFor } from "./_test-helpers";

const { createGlobalSearchView, DEFAULT_VIEW } = await import(
  "../views/database/global-search-view"
);
type GlobalSearchProps = Parameters<typeof DEFAULT_VIEW>[0];

const originalFetch = globalThis.fetch;

type Route = (url: string) => Response | Promise<Response> | undefined;

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

const RUNNING = {
  scannedTables: 0,
  totalTables: 1,
  currentTable: "sample_table",
  hits: [],
  done: false,
};

function mountSearch(route: Route) {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    const response = await route(url);
    if (!response) throw new Error(`unexpected request: ${url}`);
    return response;
  }) as typeof fetch;
  const consoleError = vi
    .spyOn(console, "error")
    .mockImplementation(() => undefined);
  const view = createGlobalSearchView({
    getDbId: () => "sample.db",
    getSchema: () => null,
  });
  document.body.appendChild(view.el);
  const progress = () =>
    q<HTMLElement>(view.el, ".db-global-search-progress").textContent ?? "";
  const logs = (operation: string) =>
    consoleError.mock.calls.filter(
      (args) => args[0] === `[code-viewer] SQL ${operation} failed`,
    );
  return { view, progress, logs };
}

describe("global search view", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  // 直す前は err.message だけを出し、console にも cause にも何も残らなかった。
  test("検索を始められなかったら、理由を cause ごと画面と console に出す", async () => {
    const failure = Object.assign(new Error("search start request failed"), {
      cause: new Error("network is unreachable"),
    });
    const { view, progress, logs } = mountSearch(() => Promise.reject(failure));

    view.setSearch("sample", { autoRun: true });
    await waitFor(() => progress().includes("Caused by"));

    expect(progress()).toBe(
      "Error: search start request failed\nCaused by: Error: network is unreachable",
    );
    expect(logs("search start").length).toBe(1);
    expect(logs("search start")[0]?.slice(-1)[0]).toBe(failure);
    view.dispose();
  });

  // 直す前は HTTP の失敗の本文だけを出し、操作も状態も console も無かった。
  // 進み具合の取得は失敗しても黙って止まり、中止の失敗は黙って「中止しました」を出した。
  test.each([
    {
      operation: "search start",
      route: (url: string) =>
        url.startsWith("/_db/search/start")
          ? new Response("sample failure", { status: 500 })
          : undefined,
      act: async () => {
        // 始めるだけ (始めたところで失敗する)。
      },
      detail: "start search (HTTP 500): sample failure",
    },
    {
      operation: "search status",
      route: (url: string) =>
        url.startsWith("/_db/search/start")
          ? json({ jobId: "sample-job" })
          : url.startsWith("/_db/search/status")
            ? new Response("sample failure", { status: 404 })
            : undefined,
      act: async () => {
        // 始めるだけ (進み具合を取りに行ったところで失敗する)。
      },
      detail: "read search progress (HTTP 404): sample failure",
    },
    {
      operation: "search cancel",
      route: (url: string) =>
        url.startsWith("/_db/search/start")
          ? json({ jobId: "sample-job" })
          : url.startsWith("/_db/search/status")
            ? json(RUNNING)
            : url.startsWith("/_db/search/cancel")
              ? new Response("sample failure", { status: 500 })
              : undefined,
      act: async (
        view: ReturnType<typeof createGlobalSearchView>,
        progress: () => string,
      ) => {
        const cancel = q<HTMLButtonElement>(
          view.el,
          ".db-global-search-cancel",
        );
        // 仕事の番号が決まって進み具合が出てから押す。
        await waitFor(() => progress().includes("sample_table"));
        cancel.click();
      },
      detail: "cancel search (HTTP 500): sample failure",
    },
  ])(
    "$operation の HTTP の失敗は諦めて、理由を画面と console に出す",
    async ({ operation, route, act, detail }) => {
      const { view, progress, logs } = mountSearch(route);

      view.setSearch("sample", { autoRun: true });
      await act(view, progress);
      await waitFor(() => progress().includes("HTTP"));

      expect(progress()).toBe(`Error: ${detail}`);
      expect(
        q<HTMLButtonElement>(view.el, ".db-global-search-cancel").hidden,
      ).toBe(true);
      expect(logs(operation).length).toBe(1);
      expect((logs(operation)[0].slice(-1)[0] as Error).message).toBe(detail);
      view.dispose();
    },
  );

  test("進み具合を取りに行けなかったら、理由を console に出して取り直す", async () => {
    const failure = new TypeError("network is unreachable");
    let statusCalls = 0;
    const { view, progress, logs } = mountSearch((url) => {
      if (url.startsWith("/_db/search/start"))
        return json({ jobId: "sample-job" });
      if (url.startsWith("/_db/search/status")) {
        statusCalls += 1;
        if (statusCalls === 1) return Promise.reject(failure);
        return json({ ...RUNNING, scannedTables: 1, done: true });
      }
      return undefined;
    });

    view.setSearch("sample", { autoRun: true });
    await waitFor(() => progress().startsWith("Done."), 3000);

    expect(statusCalls).toBe(2);
    expect(logs("search status").length).toBe(1);
    expect(logs("search status")[0]?.slice(-1)[0]).toBe(failure);
    view.dispose();
  });

  test("passes running state and hits grouped by table to the view", async () => {
    const shown: GlobalSearchProps[] = [];
    const hit = (table: string, column: string) => ({
      table,
      column,
      valuePreview: "sample value",
      rowPreview: [],
    });
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/_db/search/start")) return json({ jobId: "job" });
      // 終わった後に閉じても、前と同じく中止を送る。
      if (url.startsWith("/_db/search/cancel")) return json({});
      if (url.startsWith("/_db/search/status"))
        return json({
          scannedTables: 2,
          totalTables: 2,
          hits: [
            hit("sample_table", "sample_column"),
            hit("sample_other_table", "sample_column"),
            hit("sample_table", "sample_other_column"),
          ],
          done: true,
        });
      throw new Error(`unexpected request: ${url}`);
    }) as typeof fetch;
    const view = createGlobalSearchView(
      { getDbId: () => "sample.db", getSchema: () => null },
      (props) => {
        shown.push(props);
        return DEFAULT_VIEW(props);
      },
    );
    const last = () => shown[shown.length - 1] as GlobalSearchProps;
    expect([last().running, last().progress]).toEqual([false, null]);

    view.setSearch("sample", { autoRun: true });
    expect(last().running).toBe(true);
    await waitFor(() => !last().running);
    expect(
      last().tables.map((table) => [
        table.label,
        table.hits.map((h) => h.column),
      ]),
    ).toEqual([
      ["sample_table (2)", ["sample_column", "sample_other_column"]],
      ["sample_other_table (1)", ["sample_column"]],
    ]);
    view.dispose();
  });
});
