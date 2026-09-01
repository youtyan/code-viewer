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
import type { AppRoute } from "../core/routes";
import type { GrepMatch, GrepResponse } from "../core/types";
import { closeContextMenu, showContextMenu } from "../views/context-menu";
import {
  createDefinitionJump,
  type DefinitionJumpDeps,
  diffCellContext,
  offsetInCell,
  sourceCellContext,
} from "../views/definition-jump";
import { definitionJumpText } from "../views/definition-jump-i18n";
import { deferred, q, waitFor } from "./_test-helpers";

const originalFetch = globalThis.fetch;

beforeAll(() => {
  GlobalRegistrator.register({ url: "http://localhost/" });
});

afterAll(() => {
  GlobalRegistrator.unregister();
});

afterEach(() => {
  window.dispatchEvent(new Event("blur"));
  closeContextMenu();
  document.body.innerHTML = "";
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    writable: true,
    value: originalFetch,
  });
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("context menu extension", () => {
  test("positions a menu at explicit pointer coordinates", () => {
    const anchor = document.createElement("button");
    document.body.appendChild(anchor);

    const menu = showContextMenu(
      anchor,
      [{ label: "Open", onSelect: vi.fn() }],
      {
        at: { x: 120, y: 75 },
      },
    );

    expect({ left: menu.style.left, top: menu.style.top }).toEqual({
      left: "120px",
      top: "75px",
    });
  });

  test("does not return focus when focusReturn is null", () => {
    const anchor = document.createElement("button");
    const focus = vi.spyOn(anchor, "focus");
    document.body.appendChild(anchor);
    showContextMenu(anchor, [{ label: "Open", onSelect: vi.fn() }], {
      focusReturn: null,
    });

    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );

    expect(focus).not.toHaveBeenCalled();
  });

  test("keeps the existing two-argument call behavior", () => {
    const anchor = document.createElement("button");
    const onSelect = vi.fn();
    document.body.appendChild(anchor);
    const menu = showContextMenu(anchor, [{ label: "Open", onSelect }]);

    q<HTMLButtonElement>(menu, "button").click();

    expect(onSelect).toHaveBeenCalledOnce();
    expect(menu.isConnected).toBe(false);
  });
});

describe("definition jump text", () => {
  test.each([
    {
      name: "English",
      language: "en" as const,
      expected: "Search this symbol in the search panel",
    },
    {
      name: "Japanese",
      language: "ja" as const,
      expected: "このシンボル名で検索パネルを開く",
    },
  ])("provides the search-panel action in $name", ({ language, expected }) => {
    expect(definitionJumpText(language).openSearchPanel).toBe(expected);
  });
});

describe("definition cell offsets", () => {
  test.each([
    { name: "first text node", part: "first", nodeOffset: 1, expected: 1 },
    { name: "nested span", part: "middle", nodeOffset: 1, expected: 3 },
    { name: "nested mark", part: "marked", nodeOffset: 2, expected: 6 },
    { name: "last text node", part: "last", nodeOffset: 1, expected: 7 },
    { name: "cell element boundary", part: "cell", nodeOffset: 3, expected: 8 },
  ])("normalizes the $name to a cell offset", ({
    part,
    nodeOffset,
    expected,
  }) => {
    document.body.innerHTML = `
        <code class="target"><span data-part="first">ab</span><span data-part="middle">cd<mark data-part="marked">ef</mark></span><span data-part="last">gh</span></code>
      `;
    const cell = q<HTMLElement>(document, ".target");
    const partElement =
      part === "cell" ? cell : q<HTMLElement>(cell, `[data-part="${part}"]`);
    const node = part === "cell" ? partElement : partElement.firstChild;
    if (!node) throw new Error(`missing text node for ${part}`);

    expect(offsetInCell(cell, node, nodeOffset)).toBe(expected);
  });
});

describe("definition source context", () => {
  test.each([
    { name: "table renderer", cellClass: "gdp-source-line-code" },
    { name: "virtual renderer", cellClass: "gdp-source-virtual-line-code" },
    { name: "paged renderer", cellClass: "gdp-source-line-code" },
  ])("resolves the $name", ({ cellClass }) => {
    document.body.innerHTML = `
      <article class="gdp-standalone-source" data-path="src/sample.ts" data-source-ref="sample-ref">
        <div data-line="17"><code class="${cellClass}">sampleThing</code></div>
      </article>
    `;

    expect(sourceCellContext(q(document, `.${cellClass}`))).toEqual({
      path: "src/sample.ts",
      ref: "sample-ref",
      line: 17,
    });
  });

  test("returns null outside a standalone source card", () => {
    document.body.innerHTML =
      '<div data-line="4"><code class="gdp-source-line-code">sampleThing</code></div>';
    expect(sourceCellContext(q(document, ".gdp-source-line-code"))).toBeNull();
  });
});

describe("definition diff context", () => {
  test.each([
    {
      name: "unified deletion",
      html: `
        <table><tr>
          <td class="d2h-code-linenumber"><span class="line-num1">7</span><span class="line-num2"></span></td>
          <td class="d2h-code-line d2h-del"><span class="d2h-code-line-ctn target">sampleThing</span></td>
        </tr></table>`,
      expected: {
        path: "src/sample-old.ts",
        ref: "sample-base",
        line: 7,
        side: "old" as const,
      },
    },
    {
      name: "unified addition",
      html: `
        <table><tr>
          <td class="d2h-code-linenumber"><span class="line-num1"></span><span class="line-num2">8</span></td>
          <td class="d2h-code-line d2h-ins"><span class="d2h-code-line-ctn target">sampleThing</span></td>
        </tr></table>`,
      expected: {
        path: "src/sample.ts",
        ref: "sample-target",
        line: 8,
        side: "new" as const,
      },
    },
    {
      name: "unified inserted context",
      html: `
        <table><tr class="gdp-inserted-ctx">
          <td class="d2h-code-linenumber"><span class="line-num1">11</span><span class="line-num2">12</span></td>
          <td class="d2h-code-line d2h-cntx"><span class="d2h-code-line-ctn target">sampleThing</span></td>
        </tr></table>`,
      expected: {
        path: "src/sample.ts",
        ref: "sample-target",
        line: 12,
        side: "new" as const,
      },
    },
    {
      name: "split old side",
      html: `
        <div class="d2h-file-wrapper">
          <div class="d2h-file-side-diff"><table><tr><td class="d2h-code-side-linenumber">21</td><td><span class="d2h-code-line-ctn target">sampleThing</span></td></tr></table></div>
          <div class="d2h-file-side-diff"><table><tr><td class="d2h-code-side-linenumber">22</td><td><span class="d2h-code-line-ctn">sampleThing</span></td></tr></table></div>
        </div>`,
      expected: {
        path: "src/sample-old.ts",
        ref: "sample-base",
        line: 21,
        side: "old" as const,
      },
    },
    {
      name: "split new side",
      html: `
        <div class="d2h-file-wrapper">
          <div class="d2h-file-side-diff"><table><tr><td class="d2h-code-side-linenumber">21</td><td><span class="d2h-code-line-ctn">sampleThing</span></td></tr></table></div>
          <div class="d2h-file-side-diff"><table><tr><td class="d2h-code-side-linenumber">22</td><td><span class="d2h-code-line-ctn target">sampleThing</span></td></tr></table></div>
        </div>`,
      expected: {
        path: "src/sample.ts",
        ref: "sample-target",
        line: 22,
        side: "new" as const,
      },
    },
  ])("resolves the $name", ({ html, expected }) => {
    document.body.innerHTML = `
      <main id="diff">
        <article class="gdp-file-shell" data-path="src/sample.ts">${html}</article>
      </main>
    `;
    const card = q<HTMLElement>(document, ".gdp-file-shell") as HTMLElement & {
      _file?: { path: string; old_path: string; load_url: string };
    };
    card._file = {
      path: "src/sample.ts",
      old_path: "src/sample-old.ts",
      load_url: "sample",
    };

    expect(
      diffCellContext(q(document, ".target"), {
        from: "sample-base",
        to: "sample-target",
      }),
    ).toEqual(expected);
  });

  test("returns null for a diff-shaped cell outside the main diff", () => {
    document.body.innerHTML = `
      <article class="gdp-file-shell" data-path="src/sample.ts">
        <table><tr><td class="d2h-code-linenumber"><span class="line-num2">8</span></td><td class="d2h-ins"><span class="d2h-code-line-ctn">sampleThing</span></td></tr></table>
      </article>
    `;
    expect(
      diffCellContext(q(document, ".d2h-code-line-ctn"), {
        from: "sample-base",
        to: "sample-target",
      }),
    ).toBeNull();
  });
});

type RecordedRequest = {
  url: URL;
  signal: AbortSignal;
};

function grepResponse(
  matches: GrepMatch[],
  engine: GrepResponse["engine"] = "rg",
  truncated = false,
): Response {
  return new Response(
    JSON.stringify({
      ref: "sample-ref",
      engine,
      truncated,
      generation: 1,
      matches,
    } satisfies GrepResponse),
    { headers: { "content-type": "application/json" } },
  );
}

function definitionMatch(
  path: string,
  line: number,
  preview = "function sampleThing() {}",
): GrepMatch {
  return { path, line, column: 10, preview, matchText: "sampleThing" };
}

function defaultFileRoute(): AppRoute {
  return {
    screen: "file",
    path: "src/sample.ts",
    ref: "sample-ref",
    view: "blob",
    range: { from: "sample-base", to: "sample-target" },
  };
}

function setupDefinitionFlow(
  fetchResponse: (request: RecordedRequest, index: number) => Promise<Response>,
  options: {
    route?: AppRoute;
    html?: string;
    cellSelector?: string;
  } = {},
) {
  document.body.innerHTML =
    options.html ??
    `<main id="content" tabindex="0">
      <article class="gdp-standalone-source" data-path="src/sample.ts" data-source-ref="sample-ref">
        <div data-line="12"><code class="gdp-source-line-code">sampleThing()</code></div>
      </article>
    </main>`;
  const content = q<HTMLElement>(document, "#content");
  const cell = q<HTMLElement>(
    document,
    options.cellSelector ?? ".gdp-source-line-code",
  );
  const textNode = cell.firstChild;
  if (!textNode) throw new Error("missing sample symbol text node");

  const requests: RecordedRequest[] = [];
  const loads: Promise<unknown>[] = [];
  const scopeAppends = { count: 0 };
  const opened: Array<{
    path: string;
    ref: string;
    line: number;
    hl?: string;
  }> = [];
  const searchSheets: string[] = [];
  const state: DefinitionJumpDeps["STATE"] = {
    route: options.route ?? defaultFileRoute(),
    from: "sample-base",
    to: "sample-target",
    language: "en",
  };
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    writable: true,
    value: (input: RequestInfo | URL, init?: RequestInit) => {
      if (!(init?.signal instanceof AbortSignal)) {
        throw new Error("definition request has no abort signal");
      }
      const request = {
        url: new URL(String(input), "http://localhost/"),
        signal: init.signal,
      };
      requests.push(request);
      return fetchResponse(request, requests.length - 1);
    },
  });
  const jump = createDefinitionJump({
    STATE: state,
    trackLoad: (promise) => {
      loads.push(promise);
      return promise;
    },
    isAbortError: (error) =>
      error instanceof DOMException && error.name === "AbortError",
    appendScopeParams: () => {
      scopeAppends.count += 1;
    },
    inferLang: () => "typescript",
    openMatch: (match) => opened.push(match),
    openSearchSheet: (query) => searchSheets.push(query),
    caretFromPoint: () => ({ node: textNode, offset: 3 }),
  });
  jump.install(content);

  return {
    cell,
    content,
    jump,
    loads,
    opened,
    requests,
    searchSheets,
    scopeAppends,
    state,
    click() {
      const event = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        clientX: 80,
        clientY: 40,
        metaKey: true,
      });
      cell.dispatchEvent(event);
      return event;
    },
  };
}

describe("definition search flow", () => {
  test("opens a single definition immediately with the originating ref", async () => {
    const flow = setupDefinitionFlow(async () =>
      grepResponse([definitionMatch("src/sample-target.ts", 8)]),
    );

    const click = flow.click();
    await waitFor(() => flow.opened.length === 1);

    expect(click.defaultPrevented).toBe(true);
    expect(flow.opened).toEqual([
      {
        path: "src/sample-target.ts",
        ref: "sample-ref",
        line: 8,
        hl: "sampleThing",
      },
    ]);
    expect(flow.loads).toHaveLength(1);
    const params = flow.requests[0].url.searchParams;
    expect({
      regex: params.get("regex"),
      caseSensitive: params.get("case"),
      wholeWord: params.get("word"),
      max: params.get("max"),
      paths: params.getAll("path"),
    }).toEqual({
      regex: "1",
      caseSensitive: "1",
      wholeWord: null,
      max: "50",
      paths: [],
    });
    expect(flow.scopeAppends.count).toBe(1);
  });

  test("shows ranked menu choices for multiple definitions", async () => {
    const flow = setupDefinitionFlow(async () =>
      grepResponse([
        definitionMatch("src/sample-a.ts", 4),
        definitionMatch("src/sample-b.ts", 9),
      ]),
    );

    flow.click();
    await waitFor(
      () =>
        document.querySelectorAll(".gdp-context-menu button:not(:disabled)")
          .length === 2,
    );

    expect(
      Array.from(
        document.querySelectorAll<HTMLButtonElement>(
          ".gdp-context-menu button:not(:disabled)",
        ),
      ).map((button) => button.textContent),
    ).toEqual(["src/sample-a.ts:4", "src/sample-b.ts:9"]);
  });

  test("falls back to references and opens the search panel by symbol name", async () => {
    const flow = setupDefinitionFlow(async (_request, index) =>
      index === 0
        ? grepResponse([])
        : grepResponse([
            definitionMatch("src/sample-use.ts", 30, "sampleThing();"),
          ]),
    );

    flow.click();
    await waitFor(() => flow.requests.length === 2);
    await waitFor(() =>
      Array.from(
        document.querySelectorAll<HTMLButtonElement>(
          ".gdp-context-menu button",
        ),
      ).some(
        (button) =>
          button.textContent === "Search this symbol in the search panel",
      ),
    );

    const referenceParams = flow.requests[1].url.searchParams;
    expect({
      regex: referenceParams.get("regex"),
      wholeWord: referenceParams.get("word"),
      max: referenceParams.get("max"),
      paths: referenceParams.getAll("path"),
    }).toEqual({ regex: null, wholeWord: "1", max: "100", paths: [] });
    const openSearch = Array.from(
      document.querySelectorAll<HTMLButtonElement>(".gdp-context-menu button"),
    ).find(
      (button) =>
        button.textContent === "Search this symbol in the search panel",
    );
    if (!openSearch) throw new Error("missing search-panel action");
    openSearch.click();
    expect(flow.searchSheets).toEqual(["sampleThing"]);
  });

  test("degrades a fallback regex response to a fixed-string definition search", async () => {
    const flow = setupDefinitionFlow(async (_request, index) =>
      index === 0
        ? grepResponse([], "fallback")
        : grepResponse(
            [definitionMatch("src/sample-target.ts", 8)],
            "fallback",
          ),
    );

    flow.click();
    await waitFor(() => flow.opened.length === 1);

    expect(flow.requests).toHaveLength(2);
    const first = flow.requests[0].url.searchParams;
    const second = flow.requests[1].url.searchParams;
    expect({
      firstPaths: first.getAll("path"),
      regex: second.get("regex"),
      wholeWord: second.get("word"),
      max: second.get("max"),
      secondPaths: second.getAll("path"),
    }).toEqual({
      firstPaths: [],
      regex: null,
      wholeWord: "1",
      max: "200",
      secondPaths: [],
    });
  });

  test("aborts the first request when definition lookup is triggered again", async () => {
    const first = deferred<Response>();
    const flow = setupDefinitionFlow(async (_request, index) =>
      index === 0
        ? first.promise
        : grepResponse([definitionMatch("src/sample-target.ts", 8)]),
    );

    flow.click();
    flow.click();
    await waitFor(() => flow.opened.length === 1);

    expect(flow.requests[0].signal.aborted).toBe(true);
    expect(flow.requests[1].signal.aborted).toBe(false);
    first.resolve(grepResponse([]));
    await first.promise;
  });

  test("discards a response after the route context changes", async () => {
    vi.useFakeTimers();
    const pending = deferred<Response>();
    const flow = setupDefinitionFlow(async () => pending.promise);
    flow.click();
    flow.state.route = {
      screen: "help",
      range: { from: "sample-base", to: "sample-target" },
      lang: "en",
      section: "usage",
    };
    await vi.advanceTimersByTimeAsync(151);
    expect(document.querySelector(".gdp-context-menu")).toBeNull();

    pending.resolve(grepResponse([definitionMatch("src/sample-target.ts", 8)]));
    await flow.loads[0];
    await Promise.resolve();

    expect(flow.opened).toEqual([]);
    expect(document.querySelector(".gdp-context-menu")).toBeNull();
  });

  test("discards a response after the searching menu is manually closed", async () => {
    vi.useFakeTimers();
    const pending = deferred<Response>();
    const flow = setupDefinitionFlow(async () => pending.promise);
    flow.click();
    await vi.advanceTimersByTimeAsync(151);
    expect(document.querySelector(".gdp-context-menu")).not.toBeNull();
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(document.querySelector(".gdp-context-menu")).toBeNull();

    pending.resolve(grepResponse([definitionMatch("src/sample-target.ts", 8)]));
    await flow.loads[0];
    await Promise.resolve();

    expect(flow.opened).toEqual([]);
    expect(document.querySelector(".gdp-context-menu")).toBeNull();
  });

  test("shows a terminal no-definition message when references are also empty", async () => {
    const flow = setupDefinitionFlow(async () => grepResponse([]));

    flow.click();
    await waitFor(() => flow.requests.length === 2);
    await waitFor(
      () =>
        document
          .querySelector(".gdp-context-menu")
          ?.textContent?.includes("No definition found") === true,
    );

    expect(
      q(document, ".gdp-context-menu button").hasAttribute("disabled"),
    ).toBe(true);
  });

  test("preserves HTTP status and response body in the visible error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const flow = setupDefinitionFlow(
      async () =>
        new Response("sample engine detail", {
          status: 503,
          statusText: "Service Unavailable",
        }),
    );

    flow.click();
    await waitFor(() => document.querySelector(".gdp-context-menu") !== null);

    expect(q(document, ".gdp-context-menu").textContent).toContain(
      "HTTP 503 Service Unavailable",
    );
    expect(q(document, ".gdp-context-menu").textContent).toContain(
      "sample engine detail",
    );
  });

  test("keeps a response-body read failure as the error cause", async () => {
    const bodyFailure = new TypeError("sample body read failure");
    const logged = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const flow = setupDefinitionFlow(async () => {
      const response = new Response("", {
        status: 502,
        statusText: "Bad Gateway",
      });
      Object.defineProperty(response, "text", {
        value: async () => {
          throw bodyFailure;
        },
      });
      return response;
    });

    flow.click();
    await waitFor(() => logged.mock.calls.length === 1);

    const error = logged.mock.calls[0][1] as Error & { cause?: unknown };
    expect(error.cause).toBe(bodyFailure);
  });

  test("uses the same flow for a keyboard selection", async () => {
    const flow = setupDefinitionFlow(async () =>
      grepResponse([definitionMatch("src/sample-target.ts", 8)]),
    );
    const node = flow.cell.firstChild;
    if (!node) throw new Error("missing keyboard selection text");
    const range = document.createRange();
    range.setStart(node, 0);
    range.setEnd(node, 11);
    const selection = window.getSelection();
    if (!selection) throw new Error("selection API is unavailable");
    selection.removeAllRanges();
    selection.addRange(range);

    expect(flow.jump.triggerFromKeyboard()).toBe(true);
    await waitFor(() => flow.opened.length === 1);
    expect(flow.opened[0]?.hl).toBe("sampleThing");
  });

  test("does not treat a worktree #diff host as the main diff route", () => {
    const flow = setupDefinitionFlow(async () => grepResponse([]), {
      route: {
        screen: "worktree",
        range: { from: "sample-base", to: "sample-target" },
      },
      html: `<main id="content"><section id="diff"><article class="gdp-file-shell" data-path="src/sample.ts"><table><tr><td class="d2h-code-linenumber"><span class="line-num2">8</span></td><td class="d2h-ins"><span class="d2h-code-line-ctn">sampleThing()</span></td></tr></table></article></section></main>`,
      cellSelector: ".d2h-code-line-ctn",
    });

    const click = flow.click();

    expect(click.defaultPrevented).toBe(false);
    expect(flow.requests).toEqual([]);
  });
});

describe("definition hover affordance", () => {
  test.each([
    { name: "Meta", key: "Meta" },
    { name: "Control", key: "Control" },
  ])("toggles the body modifier class for $name", ({ key }) => {
    setupDefinitionFlow(async () => grepResponse([]));

    window.dispatchEvent(new KeyboardEvent("keydown", { key }));
    expect(document.body.classList.contains("gdp-def-mod")).toBe(true);

    window.dispatchEvent(new KeyboardEvent("keyup", { key }));
    expect(document.body.classList.contains("gdp-def-mod")).toBe(false);
  });

  test("does not render a queued underline after the modifier is released", () => {
    const frames: FrameRequestCallback[] = [];
    const cancel = vi
      .spyOn(window, "cancelAnimationFrame")
      .mockImplementation(() => undefined);
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    const flow = setupDefinitionFlow(async () => grepResponse([]));

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Meta" }));
    flow.cell.dispatchEvent(
      new MouseEvent("mousemove", { bubbles: true, clientX: 80, clientY: 40 }),
    );
    const queued = frames[0];
    if (!queued) throw new Error("missing queued hover frame");
    window.dispatchEvent(new KeyboardEvent("keyup", { key: "Meta" }));
    queued(16);

    expect(cancel).toHaveBeenCalledWith(1);
    expect(document.querySelector(".gdp-def-underline")).toBeNull();
  });

  test("draws one throttled Range overlay without changing code markup and hides it at lifecycle boundaries", () => {
    const frames: FrameRequestCallback[] = [];
    let frameId = 0;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.push(callback);
      frameId += 1;
      return frameId;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(
      () => undefined,
    );
    vi.spyOn(Range.prototype, "getBoundingClientRect").mockReturnValue(
      new DOMRect(24, 32, 88, 18),
    );
    const flow = setupDefinitionFlow(async () => grepResponse([]));
    const originalMarkup = flow.cell.innerHTML;
    const moveOverSymbol = () =>
      flow.cell.dispatchEvent(
        new MouseEvent("mousemove", {
          bubbles: true,
          clientX: 80,
          clientY: 40,
        }),
      );
    const flushFrame = () => {
      const callback = frames.shift();
      if (!callback) throw new Error("missing queued hover frame");
      callback(16);
    };

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Meta" }));
    moveOverSymbol();
    moveOverSymbol();
    expect(frames).toHaveLength(1);
    flushFrame();

    const underline = q<HTMLElement>(document, ".gdp-def-underline");
    expect({
      left: underline.style.left,
      top: underline.style.top,
      width: underline.style.width,
      height: underline.style.height,
      hidden: underline.hidden,
      overlays: document.querySelectorAll(".gdp-def-underline").length,
      markup: flow.cell.innerHTML,
    }).toEqual({
      left: "24px",
      top: "32px",
      width: "88px",
      height: "18px",
      hidden: false,
      overlays: 1,
      markup: originalMarkup,
    });

    flow.content.dispatchEvent(new Event("scroll"));
    expect(underline.hidden).toBe(true);

    moveOverSymbol();
    flushFrame();
    flow.content.dispatchEvent(
      new MouseEvent("mousemove", { bubbles: true, clientX: 4, clientY: 4 }),
    );
    expect(underline.hidden).toBe(true);

    moveOverSymbol();
    flushFrame();
    window.dispatchEvent(new Event("blur"));
    expect({
      hidden: underline.hidden,
      modifierClass: document.body.classList.contains("gdp-def-mod"),
    }).toEqual({ hidden: true, modifierClass: false });
  });
});
