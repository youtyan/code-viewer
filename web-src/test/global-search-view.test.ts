// Data の全体検索の画面を happy-dom の実描画で確かめる。

import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, afterEach, describe, expect, test, vi } from "vitest";
import { q, waitFor } from "./_test-helpers";

GlobalRegistrator.register();

const { createGlobalSearchView } = await import(
  "../views/database/global-search-view"
);

const originalFetch = globalThis.fetch;

describe("global search view", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  afterAll(() => {
    GlobalRegistrator.unregister();
  });

  // 直す前は err.message だけを出し、console にも cause にも何も残らなかった。
  test("検索を始められなかったら、理由を cause ごと画面と console に出す", async () => {
    const failure = Object.assign(new Error("search start request failed"), {
      cause: new Error("network is unreachable"),
    });
    globalThis.fetch = (() => Promise.reject(failure)) as typeof fetch;
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const view = createGlobalSearchView({
      getDbId: () => "sample.db",
      getSchema: () => null,
    });
    document.body.appendChild(view.el);

    view.setSearch("sample", { autoRun: true });
    const progress = () =>
      q<HTMLElement>(view.el, ".db-global-search-progress").textContent ?? "";
    await waitFor(() => progress().includes("Caused by"));

    expect(progress()).toContain("search start request failed");
    expect(progress()).toContain("network is unreachable");
    const logs = consoleError.mock.calls.filter(
      (args) => args[0] === "[code-viewer] SQL search start failed",
    );
    expect(logs.length).toBe(1);
    expect(logs[0]?.[logs[0].length - 1]).toBe(failure);
    view.dispose();
  });
});
