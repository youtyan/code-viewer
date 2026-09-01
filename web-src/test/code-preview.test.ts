import { GlobalRegistrator } from "@happy-dom/global-registrator";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import type { FileRangeResponse } from "../core/types";
import {
  type CodePreviewRequest,
  createCodePreview,
} from "../views/code-preview";
import { deferred, q, waitFor } from "./_test-helpers";

const originalFetch = globalThis.fetch;

beforeAll(() => {
  GlobalRegistrator.register({ url: "http://localhost/" });
});

afterAll(() => {
  GlobalRegistrator.unregister();
});

afterEach(() => {
  document.body.innerHTML = "";
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    writable: true,
    value: originalFetch,
  });
  vi.restoreAllMocks();
});

function rangeResponse(
  lines = [
    "export const sampleBefore = true;",
    "export function sampleThing() {}",
    "export const sampleAfter = true;",
  ],
): Response {
  const body: FileRangeResponse = {
    path: "src/sample.ts",
    ref: "sample-ref",
    start: 9,
    end: 11,
    lines,
    total: 40,
    complete: true,
    generation: 1,
  };
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
  });
}

function installFetch(
  request: (url: URL, signal: AbortSignal, index: number) => Promise<Response>,
): Array<{ url: URL; signal: AbortSignal }> {
  const requests: Array<{ url: URL; signal: AbortSignal }> = [];
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    writable: true,
    value: (input: RequestInfo | URL, init?: RequestInit) => {
      if (!(init?.signal instanceof AbortSignal))
        throw new Error("code preview request has no abort signal");
      const recorded = {
        url: new URL(String(input), "http://localhost/"),
        signal: init.signal,
      };
      requests.push(recorded);
      return request(recorded.url, recorded.signal, requests.length - 1);
    },
  });
  return requests;
}

function createPreview(options: { stale?: boolean } = {}) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const tracked: Promise<unknown>[] = [];
  const preview = createCodePreview(host, {
    trackLoad: (promise) => {
      tracked.push(promise);
      return promise;
    },
    isAbortError: (error) =>
      error instanceof DOMException && error.name === "AbortError",
    getLanguage: () => "en",
    getSyntaxHighlight: () => true,
    inferLang: () => "typescript",
    loadSourceShikiHighlighter: async () => ({ codeToHtml: () => "" }),
    sourceShikiLines: (textValue) =>
      textValue
        .split("\n")
        .map((line) => `<span class="token">${line || " "}</span>`),
    isStaleGeneration: () => options.stale === true,
  });
  return { host, preview, tracked };
}

const SAMPLE_REQUEST: CodePreviewRequest = {
  target: {
    path: "src/sample.ts",
    ref: "sample-ref",
    line: 10,
    column: 17,
  },
  match: { text: "sampleThing", caseSensitive: true },
};

describe("code preview", () => {
  test("renders range metadata, Shiki markup, target line, match mark, and optional action", async () => {
    const requests = installFetch(async () => rangeResponse());
    const { preview } = createPreview();
    const selected = vi.fn();

    preview.show({
      ...SAMPLE_REQUEST,
      action: { label: "Open file", onSelect: selected },
    });
    await waitFor(
      () =>
        document.querySelectorAll(".gdp-source-line-code.shiki").length === 3,
    );

    expect(requests[0]?.url.pathname).toBe("/file_range");
    expect(Object.fromEntries(requests[0]?.url.searchParams ?? [])).toEqual({
      path: "src/sample.ts",
      ref: "sample-ref",
      start: "5",
      end: "15",
    });
    expect(q(document, ".gdp-code-preview-location").textContent).toBe(
      "src/sample.ts:10",
    );
    expect(q(document, ".gdp-code-preview-meta").textContent).toBe(
      "Lines 9-11 of 40",
    );
    expect(
      q(document, '.gdp-source-line-target[data-line="10"] .token').textContent,
    ).toBe("export function sampleThing() {}");
    expect(q(document, ".gdp-grep-match").textContent).toBe("sampleThing");
    q<HTMLButtonElement>(document, ".gdp-code-preview-header button").click();
    expect(selected).toHaveBeenCalledOnce();
  });

  test("deduplicates an identical preview request", () => {
    const pending = deferred<Response>();
    const requests = installFetch(async () => pending.promise);
    const { preview } = createPreview();

    preview.show(SAMPLE_REQUEST);
    preview.show(SAMPLE_REQUEST);

    expect(requests).toHaveLength(1);
  });

  test.each([
    {
      name: "column changes",
      changed: {
        ...SAMPLE_REQUEST,
        target: { ...SAMPLE_REQUEST.target, column: 18 },
      },
    },
    {
      name: "match text changes",
      changed: {
        ...SAMPLE_REQUEST,
        match: { text: "sampleOther", caseSensitive: true },
      },
    },
  ])("starts a new preview when $name", ({ changed }) => {
    const requests = installFetch(async () => deferred<Response>().promise);
    const { preview } = createPreview();

    preview.show(SAMPLE_REQUEST);
    preview.show(changed);

    expect(requests).toHaveLength(2);
    expect(requests[0]?.signal.aborted).toBe(true);
  });

  test("aborts the older request and ignores its later response", async () => {
    const first = deferred<Response>();
    const second = deferred<Response>();
    const requests = installFetch(async (_url, _signal, index) =>
      index === 0 ? first.promise : second.promise,
    );
    const { preview } = createPreview();

    preview.show(SAMPLE_REQUEST);
    preview.show({
      ...SAMPLE_REQUEST,
      target: { ...SAMPLE_REQUEST.target, path: "src/sample-new.ts" },
    });
    second.resolve(rangeResponse(["export function sampleNew() {}"]));
    await waitFor(
      () =>
        document.querySelector(".gdp-source-line-code")?.textContent ===
        "export function sampleNew() {}",
    );
    first.resolve(rangeResponse(["export function sampleOld() {}"]));
    await first.promise;
    await Promise.resolve();

    expect(requests[0]?.signal.aborted).toBe(true);
    expect(q(document, ".gdp-code-preview-location").textContent).toBe(
      "src/sample-new.ts:10",
    );
    expect(q(document, ".gdp-source-line-code").textContent).toBe(
      "export function sampleNew() {}",
    );
  });

  test("dispose aborts the request and removes the preview content", () => {
    const requests = installFetch(async () => deferred<Response>().promise);
    const { host, preview } = createPreview();
    preview.show(SAMPLE_REQUEST);

    preview.dispose();

    expect(requests[0]?.signal.aborted).toBe(true);
    expect(host.childElementCount).toBe(0);
  });

  test("renders the stale-generation terminal state", async () => {
    installFetch(async () => rangeResponse());
    const { preview } = createPreview({ stale: true });

    preview.show(SAMPLE_REQUEST);
    await waitFor(() =>
      q(document, ".gdp-code-preview-message").textContent.includes(
        "The file changed",
      ),
    );

    expect(document.querySelector(".gdp-source-table")).toBeNull();
  });

  test("keeps HTTP status and response body in the visible error", async () => {
    const logged = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    installFetch(
      async () =>
        new Response("sample range detail", {
          status: 503,
          statusText: "Service Unavailable",
        }),
    );
    const { preview } = createPreview();

    preview.show(SAMPLE_REQUEST);
    await waitFor(() => logged.mock.calls.length === 1);

    expect(q(document, ".gdp-code-preview-message").textContent).toContain(
      "HTTP 503 Service Unavailable",
    );
    expect(q(document, ".gdp-code-preview-message").textContent).toContain(
      "sample range detail",
    );
    expect(logged.mock.calls[0]?.[1]).toBeInstanceOf(Error);
  });

  test("keeps JSON parse failure as the error cause", async () => {
    const logged = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    installFetch(
      async () =>
        new Response("{", {
          headers: { "content-type": "application/json" },
        }),
    );
    const { preview } = createPreview();

    preview.show(SAMPLE_REQUEST);
    await waitFor(() => logged.mock.calls.length === 1);

    const error = logged.mock.calls[0]?.[1] as Error & { cause?: unknown };
    expect(error.message).toContain("could not be parsed (HTTP 200)");
    expect(error.cause).toBeInstanceOf(SyntaxError);
    expect(q(document, ".gdp-code-preview-message").textContent).toContain(
      "could not be parsed (HTTP 200)",
    );
  });
});
