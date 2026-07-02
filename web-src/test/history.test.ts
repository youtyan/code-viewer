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
  HISTORY_WORKTREE_COMMIT,
  historyBodyLineCount,
  historyWorktreeLabel,
} from "../views/history-view";
import { closestFor, removeListenerFrom } from "./_fake-dom";
import { deferred, waitFor } from "./_test-helpers";

const JA_WORKTREE_LABEL = historyWorktreeLabel("ja");

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

  add(...names: string[]) {
    for (const name of names) this.classes.add(name);
  }

  remove(...names: string[]) {
    for (const name of names) this.classes.delete(name);
  }

  toggle(name: string, force?: boolean) {
    const next = force ?? !this.classes.has(name);
    if (!next) {
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
  id = "";
  title = "";
  textContent = "";
  private htmlValue = "";
  hidden = false;
  disabled = false;
  type = "";
  dataset: Record<string, string> = {};
  attributes: Record<string, string> = {};
  preventDefaultCount = 0;
  parentElement: FakeElement | null = null;
  value = "";
  private listeners: Record<string, Array<(event?: unknown) => void>> = {};
  private classValue = "";

  get innerHTML() {
    return this.htmlValue;
  }

  set innerHTML(value: string) {
    this.htmlValue = value;
    if (!value.includes("<li")) return;
    this.children = [];
    const rowRe = /<li\s+([^>]*)>([\s\S]*?)<\/li>/g;
    let match: RegExpExecArray | null;
    for (;;) {
      match = rowRe.exec(value);
      if (!match) break;
      const row = new FakeElement();
      const attrs = match[1];
      const classMatch = /\bclass="([^"]*)"/.exec(attrs);
      if (classMatch) row.className = classMatch[1];
      const shaMatch = /\bdata-sha="([^"]*)"/.exec(attrs);
      if (shaMatch) row.dataset.sha = shaMatch[1];
      row.textContent = match[2].replace(/<[^>]*>/g, "");
      this.appendChild(row);
    }
  }

  get className() {
    return this.classValue;
  }

  set className(value: string) {
    this.classValue = value;
    this.classList.set(value);
  }

  appendChild(child: FakeElement) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  append(...children: FakeElement[]) {
    for (const child of children) this.appendChild(child);
  }

  addEventListener(event: string, listener: (event?: unknown) => void) {
    this.listeners[event] = [...(this.listeners[event] || []), listener];
  }

  removeEventListener(event: string, listener: (event?: unknown) => void) {
    removeListenerFrom(this.listeners, event, listener);
  }

  click() {
    for (const listener of this.listeners.click || []) listener();
  }

  dispatch(event: string, payload: unknown) {
    for (const listener of this.listeners[event] || []) listener(payload);
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
    if (name === "hidden") this.hidden = true;
  }

  removeAttribute(name: string) {
    delete this.attributes[name];
    if (name === "hidden") this.hidden = false;
  }

  replaceChildren(...children: FakeElement[]) {
    this.children = [];
    this.append(...children);
  }

  matches(selector: string) {
    const idMatch = /^#([\w-]+)$/.exec(selector);
    if (idMatch) return this.id === idMatch[1];
    const classDataMatch = /^\.([\w-]+)\[data-sha="([^"]+)"\]$/.exec(selector);
    if (classDataMatch)
      return (
        this.classList.contains(classDataMatch[1]) &&
        this.dataset.sha === classDataMatch[2]
      );
    const classMatch = /^\.([\w-]+)$/.exec(selector);
    if (classMatch) return this.classList.contains(classMatch[1]);
    return false;
  }

  closest(selector: string): FakeElement | null {
    return closestFor<FakeElement>(this, selector);
  }

  querySelector(selector: string): FakeElement | null {
    for (const child of this.children) {
      if (child.matches(selector)) return child;
      const found = child.querySelector(selector);
      if (found) return found;
    }
    return null;
  }

  querySelectorAll(selector: string): FakeElement[] {
    const result: FakeElement[] = [];
    for (const child of this.children) {
      if (child.matches(selector)) result.push(child);
      result.push(...child.querySelectorAll(selector));
    }
    return result;
  }

  scrollIntoView() {
    // no-op in unit tests
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
      buildExpandableHistoryBody(rendered as unknown as HTMLElement, raw, "ja"),
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
      "ja",
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

function installHistoryViewDom() {
  const panel = new FakeElement();
  const list = new FakeElement();
  const banner = new FakeElement();
  const status = new FakeElement();
  const sentinel = new FakeElement();
  const refreshButton = new FakeElement();
  const refreshLabel = new FakeElement();
  const refreshResult = new FakeElement();
  const info = new FakeElement();
  const documentListeners: Record<string, Array<(event: unknown) => void>> = {};
  const head = new FakeElement();
  const sha = new FakeElement();
  const author = new FakeElement();
  const date = new FakeElement();
  const subject = new FakeElement();
  const body = new FakeElement();
  info.id = "history-commit-info";
  head.className = "hci-head";
  sha.className = "hci-sha";
  author.className = "hci-author";
  date.className = "hci-date";
  subject.className = "hci-subject";
  body.className = "hci-body";
  refreshButton.className = "history-refresh";
  refreshLabel.className = "history-refresh-label";
  refreshResult.className = "db-refresh-result history-refresh-result";
  refreshResult.hidden = true;
  refreshButton.appendChild(refreshLabel);
  head.append(sha, author, date);
  info.append(head, subject, body);

  globalThis.document = {
    querySelector: (selector: string) =>
      selector === "#history-commit-info"
        ? info
        : selector === ".history-refresh"
          ? refreshButton
          : selector === ".history-refresh-result"
            ? refreshResult
            : null,
    createElement: () => new FakeElement(),
    addEventListener: (event: string, listener: (event: unknown) => void) => {
      documentListeners[event] = [
        ...(documentListeners[event] || []),
        listener,
      ];
    },
  } as unknown as Document;
  globalThis.IntersectionObserver = class {
    observe() {
      /* noop */
    }
    disconnect() {
      /* noop */
    }
    unobserve() {
      /* noop */
    }
    takeRecords() {
      return [];
    }
  } as unknown as typeof IntersectionObserver;

  return {
    panel,
    list,
    banner,
    status,
    sentinel,
    refreshButton,
    refreshLabel,
    refreshResult,
    info,
    head,
    subject,
    body,
    keyDownDocument(key: string) {
      let preventDefaultCount = 0;
      const event = {
        key,
        target: panel,
        preventDefault: () => {
          preventDefaultCount++;
        },
      };
      for (const listener of documentListeners.keydown || []) listener(event);
      return { preventDefaultCount };
    },
  };
}

describe("history view lifecycle", () => {
  test("renders a fixed worktree row and selecting it shows the worktree diff in history", async () => {
    const { panel, list, banner, status, sentinel, head, subject, body } =
      installHistoryViewDom();
    const commit = {
      sha: "abc1234567890",
      parents: ["parent1"],
      subject: "normal commit",
      body: "",
      author: "Alice",
      when: new Date().toISOString(),
    };
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(JSON.stringify({ commits: [commit], hasMore: false }), {
          status: 200,
        }),
      )) as unknown as typeof fetch;
    let route: AppRoute = {
      screen: "history",
      ref: "HEAD",
      range: { from: "HEAD", to: "worktree" },
    };
    const routes: Array<{ route: AppRoute; replace?: boolean }> = [];
    const appliedRanges: Array<{ from: string; to: string }> = [];
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
      setRoute: (next, replace) => {
        route = next;
        routes.push({ route: next, replace });
      },
      applyCommitRange: async (range) => {
        appliedRanges.push(range);
      },
      showEmptyDiffPane: () => {
        emptyDiffRenders++;
      },
      getSyntaxHighlight: () => false,
      getLanguage: () => "ja",
      trackLoad: (promise) => promise,
    });

    await view.enterHistory();

    const rows = list.querySelectorAll(".history-item");
    expect(rows.map((row) => row.dataset.sha)).toEqual([
      HISTORY_WORKTREE_COMMIT,
      commit.sha,
    ]);
    expect(rows[0].textContent.includes(JA_WORKTREE_LABEL)).toBe(true);
    expect(emptyDiffRenders).toBe(1);

    list.dispatch("click", { target: rows[0] });
    await Promise.resolve();

    expect(view.isWorktreeSelected()).toBe(true);
    expect(rows[0].classList.contains("active")).toBe(true);
    expect(routes).toEqual([
      {
        route: {
          screen: "history",
          ref: "HEAD",
          commit: HISTORY_WORKTREE_COMMIT,
          range: { from: "HEAD", to: "worktree" },
        },
        replace: true,
      },
    ]);
    expect(appliedRanges).toEqual([{ from: "HEAD", to: "worktree" }]);
    expect(head.hidden).toBe(true);
    expect(subject.textContent).toBe(JA_WORKTREE_LABEL);
    expect(body.hidden).toBe(true);
  });

  test("deep link commit=worktree restores the worktree selection", async () => {
    const { panel, list, banner, status, sentinel } = installHistoryViewDom();
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(JSON.stringify({ commits: [], hasMore: false }), {
          status: 200,
        }),
      )) as unknown as typeof fetch;
    const route: AppRoute = {
      screen: "history",
      ref: "HEAD",
      commit: HISTORY_WORKTREE_COMMIT,
      range: { from: "HEAD", to: "worktree" },
    };
    const appliedRanges: Array<{ from: string; to: string }> = [];
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
      setRoute: () => {
        throw new Error("worktree deep links should not rewrite the URL");
      },
      applyCommitRange: async (range) => {
        appliedRanges.push(range);
      },
      showEmptyDiffPane: () => {
        emptyDiffRenders++;
      },
      getSyntaxHighlight: () => false,
      getLanguage: () => "ja",
      trackLoad: (promise) => promise,
    });

    await view.enterHistory();

    const rows = list.querySelectorAll(".history-item");
    expect(view.isWorktreeSelected()).toBe(true);
    expect(rows[0].dataset.sha).toBe(HISTORY_WORKTREE_COMMIT);
    expect(rows[0].classList.contains("active")).toBe(true);
    expect(appliedRanges).toEqual([{ from: "HEAD", to: "worktree" }]);
    expect(emptyDiffRenders).toBe(0);
  });

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
      observe() {
        /* noop */
      }
      disconnect() {
        /* noop */
      }
      unobserve() {
        /* noop */
      }
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
      setRoute: () => undefined,
      applyCommitRange: async () => undefined,
      showEmptyDiffPane: () => {
        emptyDiffRenders++;
      },
      getSyntaxHighlight: () => false,
      getLanguage: () => "ja",
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

  test("file history mode keeps the /file URL and applies a path-filtered diff range", async () => {
    const { panel, list, banner, status, sentinel } = installHistoryViewDom();
    const commit = {
      sha: "abc1234567890",
      parents: ["parent1"],
      subject: "touch README",
      body: "",
      author: "Alice",
      when: new Date().toISOString(),
    };
    const requests: string[] = [];
    globalThis.fetch = ((input: RequestInfo | URL) => {
      requests.push(String(input));
      return Promise.resolve(
        new Response(JSON.stringify({ commits: [commit], hasMore: false }), {
          status: 200,
        }),
      );
    }) as unknown as typeof fetch;
    let route: AppRoute = {
      screen: "file",
      path: "README.md",
      ref: "worktree",
      view: "history",
      range: { from: "HEAD", to: "worktree" },
    };
    const routes: Array<{ route: AppRoute; replace?: boolean }> = [];
    const applied: Array<{
      range: { from: string; to: string };
      pathFilter?: string;
    }> = [];
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
      setRoute: (next, replace) => {
        route = next;
        routes.push({ route: next, replace });
      },
      applyCommitRange: async (range, pathFilter) => {
        applied.push({ range, pathFilter });
      },
      showEmptyDiffPane: () => {
        emptyDiffRenders++;
      },
      getSyntaxHighlight: () => false,
      getLanguage: () => "ja",
      trackLoad: (promise) => promise,
    });

    await view.enterHistory();

    const logUrl = new URL(requests[0], "http://localhost");
    expect(logUrl.pathname).toBe("/_log");
    expect(logUrl.searchParams.get("ref")).toBe("HEAD");
    expect(logUrl.searchParams.get("path")).toBe("README.md");
    expect(logUrl.searchParams.get("worktree")).toBe("1");
    expect(
      list.querySelectorAll(".history-item").map((row) => row.dataset.sha),
    ).toEqual([commit.sha]);
    expect(emptyDiffRenders).toBe(1);

    const row = list.querySelector(".history-item");
    list.dispatch("click", { target: row });
    await Promise.resolve();

    expect(routes).toEqual([
      {
        route: {
          screen: "file",
          path: "README.md",
          ref: "worktree",
          view: "history",
          commit: commit.sha,
          range: { from: "parent1", to: commit.sha },
        },
        replace: true,
      },
    ]);
    expect(applied).toEqual([
      {
        range: { from: "parent1", to: commit.sha },
        pathFilter: "README.md",
      },
    ]);
  });

  test("newer commit selection wins while an older commit body is still rendering", async () => {
    const { panel, list, banner, status, sentinel } = installHistoryViewDom();
    const slowCommit = {
      sha: "aaa111",
      parents: ["parent-a"],
      subject: "slow body",
      body: "```ts\nconst value = 1;\n```",
      author: "Alice",
      when: new Date().toISOString(),
    };
    const fastCommit = {
      sha: "bbb222",
      parents: ["parent-b"],
      subject: "fast body",
      body: "",
      author: "Bob",
      when: new Date().toISOString(),
    };
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            commits: [slowCommit, fastCommit],
            hasMore: false,
          }),
          { status: 200 },
        ),
      )) as unknown as typeof fetch;
    let route: AppRoute = {
      screen: "history",
      ref: "HEAD",
      range: { from: "HEAD", to: "worktree" },
    };
    const routes: AppRoute[] = [];
    const applied: Array<{ from: string; to: string }> = [];
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
      setRoute: (next) => {
        route = next;
        routes.push(next);
      },
      applyCommitRange: async (range) => {
        applied.push(range);
      },
      showEmptyDiffPane: () => undefined,
      getSyntaxHighlight: () => true,
      getLanguage: () => "ja",
      trackLoad: (promise) => promise,
    });

    await view.enterHistory();

    const rows = list.querySelectorAll(".history-item");
    list.dispatch("click", { target: rows[1] });
    list.dispatch("click", { target: rows[2] });

    await waitFor(() => applied.length === 1);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(
      routes.map((item) => (item.screen === "history" ? item.commit : "")),
    ).toEqual([fastCommit.sha]);
    expect(applied).toEqual([{ from: "parent-b", to: fastCommit.sha }]);
    expect(rows[1].classList.contains("active")).toBe(false);
    expect(rows[2].classList.contains("active")).toBe(true);
  });

  test("re-entering the same file history scope keeps the rendered commit list", async () => {
    const { panel, list, banner, status, sentinel } = installHistoryViewDom();
    const commit = {
      sha: "abc1234567890",
      parents: ["parent1"],
      subject: "touch README",
      body: "",
      author: "Alice",
      when: new Date().toISOString(),
    };
    let fetchCount = 0;
    globalThis.fetch = (() => {
      fetchCount++;
      return Promise.resolve(
        new Response(
          JSON.stringify({
            commits: [commit],
            hasMore: false,
            generation: 1,
          }),
          { status: 200 },
        ),
      );
    }) as unknown as typeof fetch;
    const route: AppRoute = {
      screen: "file",
      path: "README.md",
      ref: "worktree",
      view: "history",
      range: { from: "HEAD", to: "worktree" },
    };
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
      setRoute: () => undefined,
      applyCommitRange: async () => undefined,
      showEmptyDiffPane: () => undefined,
      getSyntaxHighlight: () => false,
      getLanguage: () => "ja",
      trackLoad: (promise) => promise,
    });

    await view.enterHistory();
    await view.enterHistory();

    expect(fetchCount).toBe(1);
    expect(
      list.querySelectorAll(".history-item").map((row) => row.dataset.sha),
    ).toEqual([commit.sha]);
  });

  test("refresh button forces the current history scope to reload", async () => {
    const {
      panel,
      list,
      banner,
      status,
      sentinel,
      refreshButton,
      refreshResult,
    } = installHistoryViewDom();
    const commit = {
      sha: "abc123",
      parents: ["parent-a"],
      subject: "first",
      body: "",
      author: "Alice",
      when: new Date().toISOString(),
    };
    let fetchCount = 0;
    globalThis.fetch = (() => {
      fetchCount++;
      return Promise.resolve(
        new Response(JSON.stringify({ commits: [commit], hasMore: false }), {
          status: 200,
        }),
      );
    }) as unknown as typeof fetch;
    const route: AppRoute = {
      screen: "history",
      ref: "HEAD",
      range: { from: "HEAD", to: "worktree" },
    };
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
      setRoute: () => undefined,
      applyCommitRange: async () => undefined,
      showEmptyDiffPane: () => undefined,
      getSyntaxHighlight: () => false,
      getLanguage: () => "ja",
      trackLoad: (promise) => promise,
    });

    await view.enterHistory();
    refreshButton.click();

    await waitFor(() => fetchCount === 2);
    expect(refreshButton.attributes["aria-label"]).toBe("コミット履歴を更新");
    expect(
      refreshButton.querySelector(".history-refresh-label")?.textContent,
    ).toBe("");
    expect(status.hidden).toBe(true);
    expect(status.textContent).toBe("");
    expect(refreshResult.hidden).toBe(true);
    expect(refreshResult.textContent).toBe("");
    expect(refreshResult.classList.contains("changed")).toBe(false);
    expect(
      list.querySelectorAll(".history-item").map((row) => row.dataset.sha),
    ).toEqual([HISTORY_WORKTREE_COMMIT, commit.sha]);
    expect(
      list
        .querySelector(`.history-item[data-sha="${commit.sha}"]`)
        ?.classList.contains("history-item-fresh"),
    ).toBe(false);
  });

  test("refresh result announces a newer top commit and highlights its row", async () => {
    const {
      panel,
      list,
      banner,
      status,
      sentinel,
      refreshButton,
      refreshResult,
    } = installHistoryViewDom();
    const firstCommit = {
      sha: "aaa1111aaaa",
      parents: ["parent-a"],
      subject: "first",
      body: "",
      author: "Alice",
      when: new Date().toISOString(),
    };
    const newerCommit = {
      sha: "bbb2222bbbb",
      parents: ["parent-b"],
      subject: "second",
      body: "",
      author: "Bob",
      when: new Date().toISOString(),
    };
    let fetchCount = 0;
    globalThis.fetch = (() => {
      fetchCount++;
      const commit = fetchCount === 1 ? firstCommit : newerCommit;
      return Promise.resolve(
        new Response(JSON.stringify({ commits: [commit], hasMore: false }), {
          status: 200,
        }),
      );
    }) as unknown as typeof fetch;
    const route: AppRoute = {
      screen: "history",
      ref: "HEAD",
      range: { from: "HEAD", to: "worktree" },
    };
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
      setRoute: () => undefined,
      applyCommitRange: async () => undefined,
      showEmptyDiffPane: () => undefined,
      getSyntaxHighlight: () => false,
      getLanguage: () => "ja",
      trackLoad: (promise) => promise,
    });

    await view.enterHistory();
    expect(status.hidden).toBe(true);

    refreshButton.click();

    await waitFor(() =>
      list
        .querySelectorAll(".history-item")
        .some((row) => row.dataset.sha === newerCommit.sha),
    );
    expect(fetchCount).toBe(2);
    expect(status.hidden).toBe(true);
    expect(status.textContent).toBe("");
    expect(refreshResult.hidden).toBe(true);
    expect(refreshResult.textContent).toBe("");
    expect(refreshResult.classList.contains("changed")).toBe(false);
    const rows = list.querySelectorAll(".history-item");
    expect(rows.map((row) => row.dataset.sha)).toEqual([
      HISTORY_WORKTREE_COMMIT,
      newerCommit.sha,
    ]);
    expect(rows[0].classList.contains("history-item-fresh")).toBe(false);
    expect(rows[1].classList.contains("history-item-fresh")).toBe(true);
  });

  test("stale refresh results do not overwrite after the commit filter changes", async () => {
    const {
      panel,
      list,
      banner,
      status,
      sentinel,
      refreshButton,
      refreshResult,
      info,
    } = installHistoryViewDom();
    const filterInput = new FakeElement();
    const filterClearButton = new FakeElement();
    const firstCommit = {
      sha: "aaa1111aaaa",
      parents: ["parent-a"],
      subject: "first",
      body: "",
      author: "Alice",
      when: new Date().toISOString(),
    };
    const staleCommit = {
      sha: "ccc3333cccc",
      parents: ["parent-c"],
      subject: "stale",
      body: "",
      author: "Carol",
      when: new Date().toISOString(),
    };
    const filteredCommit = {
      sha: "bbb2222bbbb",
      parents: ["parent-b"],
      subject: "filtered",
      body: "",
      author: "Bob",
      when: new Date().toISOString(),
    };
    const pendingRefresh = deferred<Response>();
    const fetchedUrls: string[] = [];
    globalThis.fetch = ((input: RequestInfo | URL) => {
      const url = String(input);
      fetchedUrls.push(url);
      if (fetchedUrls.length === 1) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ commits: [firstCommit], hasMore: false }),
            { status: 200 },
          ),
        );
      }
      if (fetchedUrls.length === 2) return pendingRefresh.promise;
      return Promise.resolve(
        new Response(
          JSON.stringify({ commits: [filteredCommit], hasMore: false }),
          { status: 200 },
        ),
      );
    }) as unknown as typeof fetch;
    const route: AppRoute = {
      screen: "history",
      ref: "HEAD",
      range: { from: "HEAD", to: "worktree" },
    };
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
      setRoute: () => undefined,
      applyCommitRange: async () => undefined,
      showEmptyDiffPane: () => undefined,
      getSyntaxHighlight: () => false,
      getLanguage: () => "ja",
      trackLoad: (promise) => promise,
    });

    await view.enterHistory({
      mount: {
        panel: panel as unknown as HTMLElement,
        list: list as unknown as HTMLOListElement,
        banner: banner as unknown as HTMLElement,
        status: status as unknown as HTMLElement,
        sentinel: sentinel as unknown as HTMLElement,
        filterInput: filterInput as unknown as HTMLInputElement,
        filterClearButton: filterClearButton as unknown as HTMLButtonElement,
        refreshButton: refreshButton as unknown as HTMLButtonElement,
        refreshResult: refreshResult as unknown as HTMLElement,
        commitInfo: info as unknown as HTMLElement,
      },
    });

    refreshButton.click();
    await waitFor(() => fetchedUrls.length === 2);

    filterInput.value = "bbb";
    filterInput.dispatch("input", { target: filterInput });
    await waitFor(() => fetchedUrls.length === 3);
    await waitFor(() =>
      list
        .querySelectorAll(".history-item")
        .some((row) => row.dataset.sha === filteredCommit.sha),
    );

    pendingRefresh.resolve(
      new Response(JSON.stringify({ commits: [staleCommit], hasMore: false }), {
        status: 200,
      }),
    );
    await waitFor(() => refreshButton.disabled === false);

    const rows = list.querySelectorAll(".history-item");
    expect(fetchedUrls.some((url) => url.includes("q=bbb"))).toBe(true);
    expect(rows.map((row) => row.dataset.sha)).toEqual([
      HISTORY_WORKTREE_COMMIT,
      filteredCommit.sha,
    ]);
    expect(refreshResult.hidden).toBe(true);
    expect(refreshResult.textContent).toBe("");
    expect(
      rows.some((row) => row.classList.contains("history-item-fresh")),
    ).toBe(false);
  });

  test("notePossibleUpdate flags the refresh button, and refreshing clears it", async () => {
    const {
      panel,
      list,
      banner,
      status,
      sentinel,
      refreshButton,
      refreshResult,
    } = installHistoryViewDom();
    const commit = {
      sha: "abc123",
      parents: ["parent-a"],
      subject: "first",
      body: "",
      author: "Alice",
      when: new Date().toISOString(),
    };
    let fetchCount = 0;
    globalThis.fetch = (() => {
      fetchCount++;
      return Promise.resolve(
        new Response(JSON.stringify({ commits: [commit], hasMore: false }), {
          status: 200,
        }),
      );
    }) as unknown as typeof fetch;
    const route: AppRoute = {
      screen: "history",
      ref: "HEAD",
      range: { from: "HEAD", to: "worktree" },
    };
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
      setRoute: () => undefined,
      applyCommitRange: async () => undefined,
      showEmptyDiffPane: () => undefined,
      getSyntaxHighlight: () => false,
      getLanguage: () => "ja",
      trackLoad: (promise) => promise,
    });

    await view.enterHistory();
    expect(refreshButton.classList.contains("has-update")).toBe(false);
    expect(refreshButton.title).toBe("コミット履歴を更新");
    expect(refreshButton.attributes["aria-label"]).toBe("コミット履歴を更新");
    expect(
      refreshButton.querySelector(".history-refresh-label")?.textContent,
    ).toBe("");
    expect(status.hidden).toBe(true);
    expect(refreshResult.hidden).toBe(true);
    expect(refreshResult.textContent).toBe("");

    view.notePossibleUpdate();
    expect(refreshButton.classList.contains("has-update")).toBe(true);
    expect(refreshButton.title).toBe("新しい履歴がある可能性があります。更新");
    expect(refreshButton.attributes["aria-label"]).toBe(
      "新しい履歴がある可能性があります。更新",
    );
    expect(
      refreshButton.querySelector(".history-refresh-label")?.textContent,
    ).toBe("");
    expect(status.hidden).toBe(true);
    expect(status.textContent).toBe("");
    expect(refreshResult.hidden).toBe(true);
    expect(refreshResult.textContent).toBe("");
    expect(refreshResult.classList.contains("pending")).toBe(false);
    expect(refreshResult.classList.contains("changed")).toBe(false);

    refreshButton.click();
    await waitFor(() => fetchCount === 2);
    expect(refreshButton.classList.contains("has-update")).toBe(false);
    expect(refreshButton.title).toBe("コミット履歴を更新");
    expect(refreshButton.attributes["aria-label"]).toBe("コミット履歴を更新");
    expect(
      refreshButton.querySelector(".history-refresh-label")?.textContent,
    ).toBe("");
    expect(status.hidden).toBe(true);
    expect(status.textContent).toBe("");
    expect(refreshResult.hidden).toBe(true);
    expect(refreshResult.textContent).toBe("");
    expect(refreshResult.classList.contains("pending")).toBe(false);
  });

  test("notePossibleUpdate hides empty state text while the refresh dot is active", async () => {
    const { panel, list, banner, status, sentinel, refreshButton } =
      installHistoryViewDom();
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(JSON.stringify({ commits: [], hasMore: false }), {
          status: 200,
        }),
      )) as unknown as typeof fetch;
    const route: AppRoute = {
      screen: "history",
      ref: "HEAD",
      range: { from: "HEAD", to: "worktree" },
    };
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
      setRoute: () => undefined,
      applyCommitRange: async () => undefined,
      showEmptyDiffPane: () => undefined,
      getSyntaxHighlight: () => false,
      getLanguage: () => "ja",
      trackLoad: (promise) => promise,
    });

    await view.enterHistory();
    expect(status.hidden).toBe(false);
    expect(status.textContent).toBe("no commits");

    view.notePossibleUpdate();
    expect(refreshButton.classList.contains("has-update")).toBe(true);
    expect(status.hidden).toBe(true);
    expect(status.textContent).toBe("");
  });

  test("arrow keys select commits in file history mode without leaving the /file route", async () => {
    const { panel, list, banner, status, sentinel, keyDownDocument } =
      installHistoryViewDom();
    const commits = [
      {
        sha: "aaa111",
        parents: ["parent-a"],
        subject: "first",
        body: "",
        author: "Alice",
        when: new Date().toISOString(),
      },
      {
        sha: "bbb222",
        parents: ["parent-b"],
        subject: "second",
        body: "",
        author: "Bob",
        when: new Date().toISOString(),
      },
    ];
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(JSON.stringify({ commits, hasMore: false }), {
          status: 200,
        }),
      )) as unknown as typeof fetch;
    let route: AppRoute = {
      screen: "file",
      path: "README.md",
      ref: "worktree",
      view: "history",
      range: { from: "HEAD", to: "worktree" },
    };
    const routes: AppRoute[] = [];
    const applied: Array<{ from: string; to: string; pathFilter?: string }> =
      [];
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
      setRoute: (next) => {
        route = next;
        routes.push(next);
      },
      applyCommitRange: async (range, pathFilter) => {
        applied.push({ ...range, pathFilter });
      },
      showEmptyDiffPane: () => undefined,
      getSyntaxHighlight: () => false,
      getLanguage: () => "ja",
      trackLoad: (promise) => promise,
    });

    await view.enterHistory();

    const firstKey = keyDownDocument("ArrowDown");
    await Promise.resolve();
    expect(firstKey.preventDefaultCount).toBe(1);
    expect(routes[0]).toEqual({
      screen: "file",
      path: "README.md",
      ref: "worktree",
      view: "history",
      commit: commits[0].sha,
      range: { from: "parent-a", to: commits[0].sha },
    });
    expect(applied[0]).toEqual({
      from: "parent-a",
      to: commits[0].sha,
      pathFilter: "README.md",
    });

    keyDownDocument("ArrowDown");
    await Promise.resolve();
    expect(routes[1]).toEqual({
      screen: "file",
      path: "README.md",
      ref: "worktree",
      view: "history",
      commit: commits[1].sha,
      range: { from: "parent-b", to: commits[1].sha },
    });
    expect(applied[1]).toEqual({
      from: "parent-b",
      to: commits[1].sha,
      pathFilter: "README.md",
    });
  });

  test("file history mount filter input reloads the path-filtered commit list", async () => {
    const { panel, list, banner, status, sentinel, info } =
      installHistoryViewDom();
    const filePanel = new FakeElement();
    const fileList = new FakeElement();
    const fileBanner = new FakeElement();
    const fileStatus = new FakeElement();
    const fileSentinel = new FakeElement();
    const fileFilterInput = new FakeElement();
    const fileFilterClearButton = new FakeElement();
    const commits = [
      {
        sha: "aaa111",
        parents: ["parent-a"],
        subject: "first",
        body: "",
        author: "Alice",
        when: new Date().toISOString(),
      },
      {
        sha: "bbb222",
        parents: ["parent-b"],
        subject: "second",
        body: "",
        author: "Bob",
        when: new Date().toISOString(),
      },
    ];
    const fetchedUrls: string[] = [];
    globalThis.fetch = ((input: string | URL | Request) => {
      const url = String(input);
      fetchedUrls.push(url);
      const params = new URLSearchParams(url.split("?")[1] || "");
      const filtered =
        params.get("q") === "bbb"
          ? commits.filter((commit) => commit.sha.startsWith("bbb"))
          : commits;
      return Promise.resolve(
        new Response(JSON.stringify({ commits: filtered, hasMore: false }), {
          status: 200,
        }),
      );
    }) as unknown as typeof fetch;
    const route: AppRoute = {
      screen: "file",
      path: "README.md",
      ref: "worktree",
      view: "history",
      range: { from: "HEAD", to: "worktree" },
    };
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
      setRoute: () => undefined,
      applyCommitRange: async () => undefined,
      showEmptyDiffPane: () => undefined,
      getSyntaxHighlight: () => false,
      getLanguage: () => "ja",
      trackLoad: (promise) => promise,
    });

    await view.enterHistory({
      mount: {
        panel: filePanel as unknown as HTMLElement,
        list: fileList as unknown as HTMLOListElement,
        banner: fileBanner as unknown as HTMLElement,
        status: fileStatus as unknown as HTMLElement,
        sentinel: fileSentinel as unknown as HTMLElement,
        filterInput: fileFilterInput as unknown as HTMLInputElement,
        filterClearButton:
          fileFilterClearButton as unknown as HTMLButtonElement,
        commitInfo: info as unknown as HTMLElement,
      },
    });

    expect(fileList.querySelectorAll(".history-item").length).toBe(2);
    expect(fileFilterClearButton.hidden).toBe(true);

    fileFilterInput.value = "bbb";
    fileFilterInput.dispatch("input", { target: fileFilterInput });
    await new Promise((resolve) => setTimeout(resolve, 300));

    const rows = fileList.querySelectorAll(".history-item");
    expect(rows.map((row) => row.dataset.sha)).toEqual(["bbb222"]);
    expect(fetchedUrls.some((url) => url.includes("q=bbb"))).toBe(true);
    expect(fileFilterClearButton.hidden).toBe(false);
    expect(fileFilterClearButton.textContent).toBe("解除");
    expect(fileFilterClearButton.attributes["aria-label"]).toBe(
      "コミットフィルタを解除",
    );

    fileFilterClearButton.click();
    await waitFor(
      () => fileList.querySelectorAll(".history-item").length === 2,
    );

    expect(fileFilterInput.value).toBe("");
    expect(fileFilterClearButton.hidden).toBe(true);
    const latestUrl = fetchedUrls[fetchedUrls.length - 1] || "";
    const latestParams = new URLSearchParams(latestUrl.split("?")[1] || "");
    expect(latestParams.has("q")).toBe(false);
  });
});
