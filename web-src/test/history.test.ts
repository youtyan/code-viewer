import { afterEach, describe, expect, test } from "bun:test";
import {
  commitDiffRange,
  EMPTY_TREE_SHA,
  HISTORY_AUTO_LOAD_MAX_PAGES,
  historyGroupLabel,
  shouldContinueAutoLoad,
} from "../core/history";
import { renderMarkdownHtml } from "../core/markdown-preview";
import type { AppRoute } from "../core/routes";
import {
  buildExpandableHistoryBody,
  createHistoryView,
  HISTORY_BODY_COLLAPSE_LINES,
  historyBodyLineCount,
} from "../views/history-view";

const originalDocument = globalThis.document;
const originalFetch = globalThis.fetch;
const OriginalIntersectionObserver = globalThis.IntersectionObserver;

afterEach(() => {
  globalThis.document = originalDocument;
  globalThis.fetch = originalFetch;
  globalThis.IntersectionObserver = OriginalIntersectionObserver;
});

class FakeClassList {
  private classes = new Set<string>();

  constructor(value = "") {
    this.set(value);
  }

  set(value: string) {
    this.classes = new Set(value.split(/\s+/).filter(Boolean));
  }

  contains(name: string) {
    return this.classes.has(name);
  }

  toggle(name: string) {
    if (this.classes.has(name)) {
      this.classes.delete(name);
      return false;
    }
    this.classes.add(name);
    return true;
  }
}

class FakeElement {
  children: FakeElement[] = [];
  classList = new FakeClassList();
  textContent = "";
  innerHTML = "";
  hidden = false;
  type = "";
  dataset: Record<string, string> = {};
  attributes: Record<string, string> = {};
  preventDefaultCount = 0;
  private listeners: Record<string, Array<(event?: unknown) => void>> = {};
  private classValue = "";

  get className() {
    return this.classValue;
  }

  set className(value: string) {
    this.classValue = value;
    this.classList.set(value);
  }

  appendChild(child: FakeElement) {
    this.children.push(child);
    return child;
  }

  append(...children: FakeElement[]) {
    this.children.push(...children);
  }

  addEventListener(event: string, listener: (event?: unknown) => void) {
    this.listeners[event] = [...(this.listeners[event] || []), listener];
  }

  click() {
    for (const listener of this.listeners.click || []) listener();
  }

  keyDown(key: string) {
    const event = {
      key,
      preventDefault: () => {
        this.preventDefaultCount++;
      },
    };
    for (const listener of this.listeners.keydown || []) listener(event);
  }

  setAttribute(name: string, value: string) {
    this.attributes[name] = value;
  }

  replaceChildren(...children: FakeElement[]) {
    this.children = children;
  }

  querySelector(_selector: string) {
    return null;
  }

  querySelectorAll(_selector: string) {
    return [];
  }
}

function installFakeDocument() {
  globalThis.document = {
    createElement: () => new FakeElement(),
  } as unknown as Document;
}

describe("commitDiffRange", () => {
  test("uses first parent as from", () => {
    expect(commitDiffRange({ sha: "abc", parents: ["p1", "p2"] })).toEqual({
      from: "p1",
      to: "abc",
    });
  });

  test("uses the empty tree for root commits", () => {
    expect(commitDiffRange({ sha: "abc", parents: [] })).toEqual({
      from: EMPTY_TREE_SHA,
      to: "abc",
    });
  });
});

describe("shouldContinueAutoLoad", () => {
  test("continues while target is missing and pages remain", () => {
    expect(
      shouldContinueAutoLoad({ pagesLoaded: 1, found: false, hasMore: true }),
    ).toBe(true);
  });
  test("stops once the target is found", () => {
    expect(
      shouldContinueAutoLoad({ pagesLoaded: 1, found: true, hasMore: true }),
    ).toBe(false);
  });
  test("stops when the server has no more commits", () => {
    expect(
      shouldContinueAutoLoad({ pagesLoaded: 1, found: false, hasMore: false }),
    ).toBe(false);
  });
  test("stops at the page cap", () => {
    expect(
      shouldContinueAutoLoad({
        pagesLoaded: HISTORY_AUTO_LOAD_MAX_PAGES,
        found: false,
        hasMore: true,
      }),
    ).toBe(false);
  });
});

describe("historyGroupLabel", () => {
  // Friday 2026-06-12 15:00 local time.
  const now = new Date(2026, 5, 12, 15, 0, 0);

  test("groups commits from the same day as Today", () => {
    expect(
      historyGroupLabel(new Date(2026, 5, 12, 0, 30).toISOString(), now),
    ).toBe("Today");
    expect(
      historyGroupLabel(new Date(2026, 5, 12, 23, 0).toISOString(), now),
    ).toBe("Today");
  });

  test("groups future timestamps (clock skew) as Today", () => {
    expect(
      historyGroupLabel(new Date(2026, 5, 13, 1, 0).toISOString(), now),
    ).toBe("Today");
  });

  test("groups the previous day as Yesterday", () => {
    expect(
      historyGroupLabel(new Date(2026, 5, 11, 23, 59).toISOString(), now),
    ).toBe("Yesterday");
    expect(
      historyGroupLabel(new Date(2026, 5, 11, 0, 0).toISOString(), now),
    ).toBe("Yesterday");
  });

  test("groups the last 7 days as This week", () => {
    expect(
      historyGroupLabel(new Date(2026, 5, 10, 12, 0).toISOString(), now),
    ).toBe("This week");
    expect(
      historyGroupLabel(new Date(2026, 5, 6, 0, 0).toISOString(), now),
    ).toBe("This week");
  });

  test("groups older commits in the same month as This month", () => {
    expect(
      historyGroupLabel(new Date(2026, 5, 1, 12, 0).toISOString(), now),
    ).toBe("This month");
  });

  test("groups older commits by month and year", () => {
    expect(historyGroupLabel(new Date(2026, 4, 20).toISOString(), now)).toBe(
      "May 2026",
    );
    expect(historyGroupLabel(new Date(2025, 11, 31).toISOString(), now)).toBe(
      "December 2025",
    );
  });

  test("falls back for unparsable dates", () => {
    expect(historyGroupLabel("not-a-date", now)).toBe("Unknown date");
  });
});

describe("history commit body rendering", () => {
  test("short commit bodies do not get an expander", () => {
    installFakeDocument();
    const rendered = new FakeElement();
    const raw = Array.from(
      { length: HISTORY_BODY_COLLAPSE_LINES },
      (_, i) => `line ${i + 1}`,
    ).join("\n");

    expect(historyBodyLineCount(raw)).toBe(HISTORY_BODY_COLLAPSE_LINES);
    expect(
      buildExpandableHistoryBody(rendered as unknown as HTMLElement, raw),
    ).toBe(rendered);
  });

  test("long commit bodies get a Japanese expand/collapse toggle", () => {
    installFakeDocument();
    const rendered = new FakeElement();
    const raw = Array.from(
      { length: HISTORY_BODY_COLLAPSE_LINES + 2 },
      (_, i) => `line ${i + 1}`,
    ).join("\n");

    const wrapped = buildExpandableHistoryBody(
      rendered as unknown as HTMLElement,
      raw,
    ) as unknown as FakeElement;
    const collapsible = wrapped.children[0];
    const toggle = wrapped.children[1];

    expect(wrapped.className).toBe("hci-body-expandable");
    expect(collapsible.className).toBe("hci-body-collapsible");
    expect(collapsible.children).toEqual([rendered]);
    expect(toggle.className).toBe("hci-body-toggle");
    expect(toggle.attributes.role).toBe("button");
    expect(toggle.attributes.tabindex).toBe("0");
    expect(toggle.textContent).toBe("もっと見る (2 行)");
    expect(toggle.attributes["aria-expanded"]).toBe("false");

    toggle.click();
    expect(collapsible.classList.contains("expanded")).toBe(true);
    expect(toggle.textContent).toBe("閉じる");
    expect(toggle.attributes["aria-expanded"]).toBe("true");

    toggle.click();
    expect(collapsible.classList.contains("expanded")).toBe(false);
    expect(toggle.textContent).toBe("もっと見る (2 行)");
    expect(toggle.attributes["aria-expanded"]).toBe("false");

    toggle.keyDown("Enter");
    expect(collapsible.classList.contains("expanded")).toBe(true);
    expect(toggle.textContent).toBe("閉じる");
    expect(toggle.attributes["aria-expanded"]).toBe("true");
    expect(toggle.preventDefaultCount).toBe(1);

    toggle.keyDown(" ");
    expect(collapsible.classList.contains("expanded")).toBe(false);
    expect(toggle.textContent).toBe("もっと見る (2 行)");
    expect(toggle.attributes["aria-expanded"]).toBe("false");
    expect(toggle.preventDefaultCount).toBe(2);

    toggle.keyDown("Escape");
    expect(collapsible.classList.contains("expanded")).toBe(false);
    expect(toggle.attributes["aria-expanded"]).toBe("false");
    expect(toggle.preventDefaultCount).toBe(2);
  });

  test("commit body markdown renders headings, bold text, and code blocks", () => {
    const html = renderMarkdownHtml(
      "# Heading\n\n**bold**\n\n```ts\nconst value = 1;\n```",
      { path: "COMMIT_MSG", ref: "abc123" },
      null,
    );

    expect(html.includes('<h1 id="heading"')).toBe(true);
    expect(html.includes("<strong>bold</strong>")).toBe(true);
    expect(html.includes("<pre><code>const value = 1;")).toBe(true);
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("history view lifecycle", () => {
  test("leaveHistory prevents an in-flight enter from showing stale empty diff state", async () => {
    const panel = new FakeElement();
    const list = new FakeElement();
    const banner = new FakeElement();
    const status = new FakeElement();
    const sentinel = new FakeElement();
    const info = new FakeElement();
    const body = new FakeElement();
    info.querySelector = ((selector: string) =>
      selector === ".hci-body" ? body : null) as typeof info.querySelector;
    globalThis.document = {
      querySelector: (selector: string) =>
        selector === "#history-commit-info" ? info : null,
      createElement: () => new FakeElement(),
    } as unknown as Document;
    globalThis.IntersectionObserver = class {
      observe() {}
      disconnect() {}
      unobserve() {}
      takeRecords() {
        return [];
      }
    } as unknown as typeof IntersectionObserver;
    const pending = deferred<Response>();
    globalThis.fetch = (() => pending.promise) as unknown as typeof fetch;
    let route: AppRoute = {
      screen: "history",
      ref: "HEAD",
      range: { from: "HEAD", to: "worktree" },
    };
    let emptyDiffRenders = 0;
    const view = createHistoryView({
      $: (selector) => {
        if (selector === "#history-panel") return panel as unknown as never;
        if (selector === "#history-list") return list as unknown as never;
        if (selector === "#history-banner") return banner as unknown as never;
        if (selector === "#history-status") return status as unknown as never;
        if (selector === "#history-sentinel")
          return sentinel as unknown as never;
        throw new Error(`unexpected selector: ${selector}`);
      },
      escapeHtml: (value) => String(value),
      getRoute: () => route,
      setRoute: () => {},
      applyCommitRange: async () => {},
      showEmptyDiffPane: () => {
        emptyDiffRenders++;
      },
      getSyntaxHighlight: () => false,
      trackLoad: (promise) => promise,
    });

    const entering = view.enterHistory();
    view.leaveHistory();
    route = {
      screen: "database",
      range: { from: "HEAD", to: "worktree" },
    };
    pending.resolve(
      new Response(JSON.stringify({ commits: [], hasMore: false }), {
        status: 200,
      }),
    );
    await entering;

    expect(emptyDiffRenders).toBe(0);
    expect(info.hidden).toBe(true);
  });
});
