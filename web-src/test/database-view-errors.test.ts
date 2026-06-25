import { afterEach, describe, expect, test } from "bun:test";
import { createDatabaseView } from "../views/database/database-view";

const originalDocument = globalThis.document;
const originalWindow = globalThis.window;
const originalLocalStorage = globalThis.localStorage;
const originalNavigator = globalThis.navigator;
const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;
const originalFetch = globalThis.fetch;
const originalNode = globalThis.Node;

afterEach(() => {
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    writable: true,
    value: originalDocument,
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    writable: true,
    value: originalWindow,
  });
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    writable: true,
    value: originalLocalStorage,
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    writable: true,
    value: originalNavigator,
  });
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
  Object.defineProperty(globalThis, "Node", {
    configurable: true,
    writable: true,
    value: originalNode,
  });
});

class FakeClassList {
  private classes = new Set<string>();

  constructor(value = "") {
    this.set(value);
  }

  set(value: string) {
    this.classes = new Set(value.split(/\s+/).filter(Boolean));
  }

  add(...names: string[]) {
    for (const name of names) this.classes.add(name);
  }

  remove(...names: string[]) {
    for (const name of names) this.classes.delete(name);
  }

  contains(name: string) {
    return this.classes.has(name);
  }

  toggle(name: string, force?: boolean) {
    const next = force ?? !this.classes.has(name);
    if (next) this.classes.add(name);
    else this.classes.delete(name);
    return next;
  }

  toString() {
    return Array.from(this.classes).join(" ");
  }
}

type FakeNode = FakeElement | FakeText;
type FakeAppendChild = FakeNode | string;

class FakeText {
  readonly nodeType = 3;
  parentElement: FakeElement | null = null;

  constructor(public textContent = "") {}

  remove() {
    this.parentElement?.removeChild(this);
  }
}

class FakeElement {
  readonly nodeType = 1;
  children: FakeNode[] = [];
  classList = new FakeClassList();
  dataset: Record<string, string> = {};
  attributes: Record<string, string> = {};
  parentElement: FakeElement | null = null;
  style: Record<string, string> = {};
  title = "";
  type = "";
  value = "";
  placeholder = "";
  autocomplete = "";
  spellcheck = false;
  rows = 0;
  disabled = false;
  hidden = false;
  tabIndex = 0;
  draggable = false;
  href = "";
  download = "";
  scrollTop = 0;
  scrollLeft = 0;
  clientHeight = 0;
  offsetHeight = 120;
  offsetWidth = 80;
  private listeners: Record<
    string,
    Array<(event: Record<string, unknown>) => unknown>
  > = {};
  private classValue = "";
  private textValue = "";

  constructor(
    public tagName = "div",
    public id = "",
  ) {}

  get className() {
    return this.classValue;
  }

  set className(value: string) {
    this.classValue = value;
    this.classList.set(value);
  }

  get textContent(): string {
    if (this.textValue) return this.textValue;
    return this.children.map((child) => child.textContent).join("");
  }

  set textContent(value: string | null) {
    this.textValue = value ?? "";
    this.children = [];
  }

  get innerHTML(): string {
    return this.textContent;
  }

  set innerHTML(value: string) {
    this.textValue = value;
    this.children = [];
  }

  get firstChild(): FakeNode | null {
    return this.children[0] ?? null;
  }

  get nextSibling(): FakeNode | null {
    if (!this.parentElement) return null;
    const siblings = this.parentElement.children;
    const index = siblings.indexOf(this);
    return index >= 0 ? (siblings[index + 1] ?? null) : null;
  }

  appendChild(child: FakeAppendChild) {
    const node = this.normalizeChild(child);
    this.detachChildFromParent(node);
    node.parentElement = this;
    this.children.push(node);
    return node;
  }

  append(...children: FakeAppendChild[]) {
    for (const child of children) this.appendChild(child);
  }

  prepend(child: FakeAppendChild) {
    const node = this.normalizeChild(child);
    this.detachChildFromParent(node);
    node.parentElement = this;
    this.children.unshift(node);
  }

  insertBefore(child: FakeAppendChild, before: FakeNode | null) {
    const node = this.normalizeChild(child);
    this.detachChildFromParent(node);
    node.parentElement = this;
    if (!before) {
      this.children.push(node);
      return node;
    }
    const index = this.children.indexOf(before);
    if (index < 0) this.children.push(node);
    else this.children.splice(index, 0, node);
    return node;
  }

  removeChild(child: FakeNode) {
    this.children = this.children.filter((existing) => existing !== child);
    child.parentElement = null;
    return child;
  }

  remove() {
    this.parentElement?.removeChild(this);
  }

  setAttribute(name: string, value: string) {
    this.attributes[name] = value;
    if (name === "id") this.id = value;
    if (name === "class") this.className = value;
  }

  getAttribute(name: string) {
    return this.attributes[name] ?? null;
  }

  addEventListener(
    event: string,
    listener: (event: Record<string, unknown>) => unknown,
  ) {
    this.listeners[event] = [...(this.listeners[event] || []), listener];
  }

  removeEventListener(
    event: string,
    listener: (event: Record<string, unknown>) => unknown,
  ) {
    this.listeners[event] = (this.listeners[event] || []).filter(
      (current) => current !== listener,
    );
  }

  async click() {
    const event = {
      target: this,
      button: 0,
      preventDefault() {},
      stopPropagation() {},
    };
    for (const listener of this.listeners.click || []) {
      await listener(event);
    }
  }

  focus() {}

  querySelector(selector: string) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector: string) {
    const selectors = selector.split(",").map((part) => part.trim());
    const found: FakeElement[] = [];
    const visit = (node: FakeElement) => {
      for (const child of node.children) {
        if (!(child instanceof FakeElement)) continue;
        if (selectors.some((part) => child.matches(part))) found.push(child);
        visit(child);
      }
    };
    visit(this);
    return found;
  }

  matches(selector: string) {
    if (selector.startsWith("#")) return this.id === selector.slice(1);
    if (selector.startsWith(".")) {
      return selector
        .slice(1)
        .split(".")
        .every((name) => this.classList.contains(name));
    }
    return this.tagName.toLowerCase() === selector.toLowerCase();
  }

  closest(selector: string) {
    let node: FakeElement | null = this;
    while (node) {
      if (node.matches(selector)) return node;
      node = node.parentElement;
    }
    return null;
  }

  contains(target: FakeNode | null) {
    if (!target) return false;
    let node: FakeNode | null = target;
    while (node) {
      if (node === this) return true;
      node = node.parentElement;
    }
    return false;
  }

  getBoundingClientRect() {
    return { left: 0, width: 100 };
  }

  private normalizeChild(child: FakeAppendChild): FakeNode {
    return typeof child === "string" ? new FakeText(child) : child;
  }

  private detachChildFromParent(child: FakeNode) {
    if (!child.parentElement) return;
    child.parentElement.children = child.parentElement.children.filter(
      (existing) => existing !== child,
    );
  }
}

function installDatabaseDom() {
  const body = new FakeElement("body");
  const content = new FakeElement("div", "content");
  const diff = new FakeElement("div", "diff");
  const empty = new FakeElement("div", "empty");
  body.append(content, diff, empty);

  const fakeDocument = {
    body,
    createElement: (tagName: string) => new FakeElement(tagName),
    createElementNS: (_ns: string, tagName: string) => new FakeElement(tagName),
    createTextNode: (text: string) => new FakeText(text),
    getElementById: (id: string) => body.querySelector(`#${id}`),
    querySelector: (selector: string) => body.querySelector(selector),
    querySelectorAll: (selector: string) => body.querySelectorAll(selector),
    addEventListener() {},
    removeEventListener() {},
  };
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    writable: true,
    value: fakeDocument,
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    writable: true,
    value: {
      addEventListener() {},
      removeEventListener() {},
    },
  });
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    writable: true,
    value: {
      setItem() {},
      getItem() {
        return null;
      },
      removeItem() {},
    },
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    writable: true,
    value: {
      clipboard: {
        writeText: () => Promise.resolve(),
      },
      sendBeacon: () => false,
    },
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
    value: () => {},
  });
  Object.defineProperty(globalThis, "Node", {
    configurable: true,
    writable: true,
    value: { TEXT_NODE: 3 },
  });

  return { body };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
  });
}

function mockFetch(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
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
) {
  return createDatabaseView({
    setRoute() {},
    setPageMode() {},
    currentRange: () => ({ from: "HEAD", to: "worktree" }),
    trackLoad: (promise) => promise,
    syncHeaderMenu() {},
    ...overrides,
  });
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
    table: "users",
    columns: [{ name: "id", type: "integer", primaryKey: true }],
    rows: [[1]],
    totalRows: 1,
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
    ) as unknown as FakeElement[];
    expect(errors).toHaveLength(2);
    expect(errors.every((error) => error.textContent === "schema failed")).toBe(
      true,
    );
    await leaveView(view);
  });

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

    const root = document.querySelector(".db-root") as unknown as FakeElement;
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

    expect(restoredTabLabels()).toEqual(["db", "(empty)"]);

    view.suspend();
    await view.enter();

    expect(restoredTabLabels()).toEqual(["db", "(empty)"]);
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
              table: "course_categories",
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
            { name: "course_categories", type: "table", rowCount: 52 },
          ],
          columnsMap: {
            users: [{ name: "id", type: "integer", primaryKey: true }],
            course_categories: [
              { name: "id", type: "integer", primaryKey: true },
            ],
          },
        });
      if (url.startsWith("/_db/table"))
        return jsonResponse({
          ...baseTableResponse(),
          table: "course_categories",
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
      table: "course_categories",
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
    expect(fetchedTables).toEqual(["users", "bookings"]);
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
            { name: "course_categories", type: "table", rowCount: 52 },
          ],
          columnsMap: {
            users: [{ name: "id", type: "integer", primaryKey: true }],
            course_categories: [
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
    await view.enter("docker:db", undefined, "course_categories");

    const sawRestoredSearchRoute = routes.some(
      (route) =>
        typeof route === "object" &&
        route !== null &&
        (route as { tab?: unknown }).tab === "search",
    );
    expect(document.querySelectorAll(".db-tabs-chip")).toHaveLength(1);
    expect(fetchedTables.includes("course_categories")).toBe(true);
    expect(sawRestoredSearchRoute).toBe(false);
    expect(routes[routes.length - 1]).toEqual({
      screen: "database",
      db: "docker:db",
      table: "course_categories",
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
              table: "cancel_bookings",
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
      "cancel_bookings",
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
              dbId: "docker:db:reraku_v2_development",
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
    await flushMicrotasks();

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

  test("loads the restored active tab before background tabs", async () => {
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
        return jsonResponse({
          ...baseSchemaResponse(),
          tables: [
            { name: "users", type: "table", rowCount: 1 },
            { name: "bookings", type: "table", rowCount: 1 },
          ],
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
    await leaveView(view);
  });

  test("renders query fetch errors returned as plain text", async () => {
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
      if (url === "/_db/query")
        return new Response("query failed", { status: 500 });
      return new Response("unexpected request", { status: 500 });
    });

    const view = createViewForTest();
    await view.enter("docker:db");

    const queryButton = document.querySelectorAll(
      ".db-icon-btn",
    )[0] as unknown as FakeElement | undefined;
    await queryButton?.click();
    const textarea = document.querySelector(
      "textarea",
    ) as unknown as FakeElement | null;
    if (textarea) textarea.value = "select 1";
    const runButton = document.querySelector(
      ".db-query-run",
    ) as unknown as FakeElement | null;
    await runButton?.click();

    expect(document.querySelector(".db-query-error")?.textContent).toBe(
      "query failed",
    );
    await leaveView(view);
  });
});
