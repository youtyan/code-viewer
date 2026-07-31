import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import type { FileSearchListResponse } from "../core/types";
import { deferred, q, waitFor } from "./_test-helpers";

beforeAll(() => {
  GlobalRegistrator.register();
});

afterAll(() => {
  GlobalRegistrator.unregister();
});

afterEach(() => {
  document.body.innerHTML = "";
});

function response(files: string[]): Response {
  const body: FileSearchListResponse = {
    ref: "worktree",
    generation: 1,
    files: files.map((path) => ({ path, type: "blob" })),
    truncated: false,
  };
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
  });
}

async function setup() {
  const first = deferred<Response>();
  const second = deferred<Response>();
  const requests = [first, second];
  let requestIndex = 0;
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    writable: true,
    value: () => {
      const request = requests[requestIndex++];
      if (!request) throw new Error("unexpected file-list request");
      return request.promise;
    },
  });
  const { createSearchPalette } = await import("../views/search-palette-ui");
  const palette = createSearchPalette({
    STATE: {
      route: {
        screen: "repo",
        ref: "worktree",
        path: "",
        range: { from: "HEAD", to: "worktree" },
      },
      files: [],
      repoRef: "worktree",
      to: "worktree",
    },
    setRoute: () => undefined,
    currentRange: () => ({ from: "HEAD", to: "worktree" }),
    appendScopeParams: () => undefined,
    isAbortError: () => false,
    scrollToFile: () => undefined,
    applySourceRouteToShell: () => undefined,
    fileSourceTarget: (file) => ({ path: file.path, ref: "worktree" }),
    renderStandaloneSource: async () => undefined,
    repoFileCacheKey: (ref) => ref,
    trackLoad: (promise) => promise,
    getServerGeneration: () => 1,
  });
  palette.openSearchPalette("file");
  const input = q<HTMLInputElement>(document, ".gdp-palette-input");
  input.value = "sample";
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await waitFor(() => requestIndex === 2);
  return { input, palette, first, second, requestCount: () => requestIndex };
}

describe("repository search palette request ordering", () => {
  test("an older same-query response cannot replace the newer result or cache", async () => {
    const { input, palette, first, second, requestCount } = await setup();
    try {
      second.resolve(response(["sample_fresh.ts"]));
      await waitFor(
        () => q(document, ".gdp-palette-status").textContent === "1 results",
      );
      first.resolve(response(["sample_stale.ts"]));
      await first.promise;

      expect(q(document, ".gdp-palette-row-title").textContent).toBe(
        "sample_fresh.ts",
      );
      input.value = "fresh";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      await waitFor(
        () => q(document, ".gdp-palette-status").textContent === "1 results",
      );
      expect(requestCount()).toBe(2);
      expect(q(document, ".gdp-palette-row-title").textContent).toBe(
        "sample_fresh.ts",
      );
    } finally {
      palette.closeSearchPalette();
    }
  });

  test("an older same-query failure cannot replace a successful status", async () => {
    const { palette, first, second } = await setup();
    try {
      second.resolve(response(["sample_fresh.ts"]));
      await waitFor(
        () => q(document, ".gdp-palette-status").textContent === "1 results",
      );
      first.reject(new Error("stale request failed"));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(q(document, ".gdp-palette-status").textContent).toBe("1 results");
      expect(q(document, ".gdp-palette-row-title").textContent).toBe(
        "sample_fresh.ts",
      );
    } finally {
      palette.closeSearchPalette();
    }
  });
});
