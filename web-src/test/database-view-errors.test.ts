import { afterEach, describe, expect, test } from "bun:test";
import {
  createDatabaseView,
  TABLE_SELECT_FETCH_DELAY_MS,
} from "../views/database/database-view";
import { closestFor, removeListenerFrom } from "./_fake-dom";

const originalDocument = globalThis.document;
const originalWindow = globalThis.window;
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

  // ai-dup-check: allow -- local fake DOM class list for database view tests.
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
    removeListenerFrom(this.listeners, event, listener);
  }

  async click() {
    const event = {
      target: this,
      button: 0,
      preventDefault() {
        /* noop */
      },
      stopPropagation() {
        /* noop */
      },
    };
    for (const listener of this.listeners.click || []) {
      await listener(event);
    }
  }

  focus() {
    /* noop */
  }

  querySelector(selector: string) {
    return this.querySelectorAll(selector)[0] || null;
  }

  // ai-dup-check: allow -- local fake DOM selector traversal for database view tests.
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

  closest(selector: string): FakeElement | null {
    return closestFor<FakeElement>(this, selector);
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

  // ai-dup-check: allow -- local fake DOM parent bookkeeping for database view tests.
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
  const windowListeners: Record<string, Array<() => void>> = {};

  const fakeDocument = {
    body,
    createElement: (tagName: string) => new FakeElement(tagName),
    createElementNS: (_ns: string, tagName: string) => new FakeElement(tagName),
    createDocumentFragment: () => new FakeElement("fragment"),
    createTextNode: (text: string) => new FakeText(text),
    getElementById: (id: string) => body.querySelector(`#${id}`),
    querySelector: (selector: string) => body.querySelector(selector),
    querySelectorAll: (selector: string) => body.querySelectorAll(selector),
    addEventListener() {
      /* noop */
    },
    removeEventListener() {
      /* noop */
    },
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
      addEventListener(event: string, listener: () => void) {
        windowListeners[event] = [...(windowListeners[event] || []), listener];
      },
      removeEventListener(event: string, listener: () => void) {
        windowListeners[event] = (windowListeners[event] || []).filter(
          (current) => current !== listener,
        );
      },
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
    value: () => undefined,
  });
  Object.defineProperty(globalThis, "Node", {
    configurable: true,
    writable: true,
    value: { TEXT_NODE: 3 },
  });

  return { body, windowListeners };
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
    setRoute() {
      /* noop */
    },
    setPageMode() {
      /* noop */
    },
    currentRange: () => ({ from: "HEAD", to: "worktree" }),
    trackLoad: (promise) => promise,
    syncHeaderMenu() {
      /* noop */
    },
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

async function waitUntil(predicate: () => boolean, timeoutMs = 1000) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
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
    expect(fetchedTables).toEqual(["bookings"]);
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

  test("opens a routed restored background tab when another datastore is active", async () => {
    installDatabaseDom();
    const fetchedTables: string[] = [];
    mockFetch((url, init) => {
      if (url === "/_db/tabs" && init?.method === "PUT")
        return jsonResponse({ ok: true });
      if (url === "/_db/tabs")
        return jsonResponse({
          version: 1,
          activeTabId: "minio",
          tabs: [
            {
              id: "postgres",
              dbId: "docker:postgres:demo_app",
              table: "queue_locks",
              view: "data",
            },
            {
              id: "minio",
              dbId: "docker:minio",
              table: null,
              view: "data",
            },
          ],
        });
      if (url === "/_db/files")
        return jsonResponse({
          files: [
            {
              id: "docker:postgres:demo_app",
              path: "docker-compose.yml",
              name: "postgres",
              sizeBytes: 0,
              kind: "postgres",
            },
            {
              id: "docker:minio",
              path: "docker-compose.yml",
              name: "minio",
              sizeBytes: 0,
              kind: "s3",
            },
          ],
        });
      if (url.startsWith("/_db/s3/buckets"))
        return jsonResponse({ buckets: [] });
      if (url.startsWith("/_db/schemas"))
        return jsonResponse({
          schemas: [{ name: "public" }],
          selectedSchema: "public",
        });
      if (url.startsWith("/_db/schema"))
        return jsonResponse({
          ...baseSchemaResponse(),
          schema: "public",
          tables: [
            { name: "users", type: "table", rowCount: 1 },
            { name: "queue_locks", type: "table", rowCount: 0 },
          ],
          columnsMap: {
            users: [{ name: "id", type: "integer", primaryKey: true }],
            queue_locks: [{ name: "id", type: "integer", primaryKey: true }],
          },
        });
      if (url.startsWith("/_db/table")) {
        const params = new URL(url, "http://localhost").searchParams;
        const table = params.get("table");
        if (table) fetchedTables.push(table);
        return jsonResponse({
          ...baseTableResponse(),
          table,
          rows: [],
          totalRows: 0,
        });
      }
      return new Response("unexpected request", { status: 500 });
    });

    const view = createViewForTest();
    await view.enter("docker:postgres:demo_app", "public", "queue_locks");

    expect(fetchedTables).toEqual(["queue_locks"]);
    expect(
      document.querySelector(".db-table-item.active")?.textContent,
    ).toMatch(/queue_locks/);
    expect(document.querySelector(".db-grid-status")?.textContent).toMatch(
      /0 rows/,
    );
    await leaveView(view);
  });

  test("does not sync the route while materializing a routed restored table tab", async () => {
    installDatabaseDom();
    const fetchedTables: string[] = [];
    const routeSyncs: unknown[] = [];
    mockFetch((url, init) => {
      if (url === "/_db/tabs" && init?.method === "PUT")
        return jsonResponse({ ok: true });
      if (url === "/_db/tabs")
        return jsonResponse({
          version: 1,
          activeTabId: "postgres",
          tabs: [
            {
              id: "postgres",
              dbId: "docker:postgres:demo_app",
              schema: null,
              table: "queue_locks",
              view: "data",
            },
          ],
        });
      if (url === "/_db/files")
        return jsonResponse({
          files: [
            {
              id: "docker:postgres:demo_app",
              path: "docker-compose.yml",
              name: "postgres",
              sizeBytes: 0,
              kind: "postgres",
            },
          ],
        });
      if (url.startsWith("/_db/schemas"))
        return jsonResponse({
          schemas: [{ name: "public" }],
          selectedSchema: "public",
        });
      if (url.startsWith("/_db/schema"))
        return jsonResponse({
          ...baseSchemaResponse(),
          schema: "public",
          tables: [{ name: "queue_locks", type: "table", rowCount: 0 }],
          columnsMap: {
            queue_locks: [{ name: "id", type: "integer", primaryKey: true }],
          },
        });
      if (url.startsWith("/_db/table")) {
        const table = new URL(url, "http://localhost").searchParams.get(
          "table",
        );
        if (table) fetchedTables.push(table);
        return jsonResponse({
          ...baseTableResponse(),
          table,
          rows: [],
          totalRows: 0,
        });
      }
      return new Response("unexpected request", { status: 500 });
    });

    const view = createViewForTest({
      setRoute(route) {
        routeSyncs.push(route);
      },
    });
    await view.enter("docker:postgres:demo_app", "public", "queue_locks");

    expect(routeSyncs).toEqual([]);
    expect(fetchedTables).toEqual(["queue_locks"]);
    expect(document.querySelector(".db-grid-status")?.textContent).toMatch(
      /0 rows/,
    );
    await leaveView(view);
  });

  test("opens a routed restored S3 tab when a SQL tab is active", async () => {
    installDatabaseDom();
    const s3Requests: string[] = [];
    const sqlRequests: string[] = [];
    mockFetch((url, init) => {
      if (url === "/_db/tabs" && init?.method === "PUT")
        return jsonResponse({ ok: true });
      if (url === "/_db/tabs")
        return jsonResponse({
          version: 1,
          activeTabId: "postgres",
          tabs: [
            {
              id: "postgres",
              dbId: "docker:postgres:demo_app",
              table: "queue_locks",
              view: "data",
            },
            {
              id: "minio",
              dbId: "docker:minio",
              table: null,
              view: "data",
            },
          ],
        });
      if (url === "/_db/files")
        return jsonResponse({
          files: [
            {
              id: "docker:postgres:demo_app",
              path: "docker-compose.yml",
              name: "postgres",
              sizeBytes: 0,
              kind: "postgres",
            },
            {
              id: "docker:minio",
              path: "docker-compose.yml",
              name: "minio",
              sizeBytes: 0,
              kind: "s3",
            },
          ],
        });
      if (url.startsWith("/_db/s3/buckets")) {
        s3Requests.push(url);
        return jsonResponse({ buckets: [{ name: "media" }] });
      }
      if (url.startsWith("/_db/s3/objects")) {
        s3Requests.push(url);
        return jsonResponse({ objects: [], truncated: false });
      }
      if (url.startsWith("/_db/schemas")) {
        sqlRequests.push(url);
        return jsonResponse({
          schemas: [{ name: "public" }],
          selectedSchema: "public",
        });
      }
      if (url.startsWith("/_db/schema")) {
        sqlRequests.push(url);
        return jsonResponse({
          ...baseSchemaResponse(),
          schema: "public",
          tables: [{ name: "queue_locks", type: "table", rowCount: 0 }],
          columnsMap: {
            queue_locks: [{ name: "id", type: "integer", primaryKey: true }],
          },
        });
      }
      if (url.startsWith("/_db/table")) {
        sqlRequests.push(url);
        return jsonResponse({
          ...baseTableResponse(),
          table: "queue_locks",
          rows: [],
          totalRows: 0,
        });
      }
      return new Response("unexpected request", { status: 500 });
    });

    const view = createViewForTest();
    await view.enter("docker:minio");

    expect(s3Requests.some((url) => url.startsWith("/_db/s3/buckets"))).toBe(
      true,
    );
    expect(sqlRequests).toEqual([]);
    const activeChip = Array.from(
      document.querySelectorAll(".db-tabs-chip"),
    ).find((chip) =>
      (chip as unknown as FakeElement).classList.contains("active"),
    ) as unknown as FakeElement | undefined;
    expect(activeChip?.textContent).toMatch(/minio/);
    await leaveView(view);
  });

  test("aborts stale table fetches when another table is selected", async () => {
    installDatabaseDom();
    const tableRequests: Array<{
      table: string | null;
      signal?: AbortSignal;
      resolve: (res: Response) => void;
      reject: (err: unknown) => void;
    }> = [];

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
        return new Promise<Response>((resolve, reject) => {
          tableRequests.push({
            table,
            signal: init?.signal,
            resolve,
            reject,
          });
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("aborted", "AbortError")),
            { once: true },
          );
        });
      }
      return new Response("unexpected request", { status: 500 });
    });

    const view = createViewForTest();
    const entering = view.enter("docker:db", undefined, "users");
    await waitUntil(() => tableRequests.length > 0);

    expect(tableRequests.map((req) => req.table)).toEqual(["users"]);
    const bookingsRow = Array.from(
      document.querySelectorAll(".db-table-item"),
    ).find(
      (row) => (row as unknown as FakeElement).dataset.table === "bookings",
    ) as unknown as FakeElement | undefined;
    expect(bookingsRow).toBeTruthy();

    const clicking = bookingsRow?.click();
    await waitUntil(() => tableRequests.length > 1);

    expect(tableRequests[0].signal?.aborted).toBe(true);
    expect(tableRequests.map((req) => req.table)).toEqual([
      "users",
      "bookings",
    ]);

    tableRequests[1].resolve(
      jsonResponse({ ...baseTableResponse(), table: "bookings" }),
    );
    await clicking;
    await entering;

    expect(document.querySelector(".db-pane-error")).toBeNull();
    await leaveView(view);
  });

  test("coalesces rapid table clicks into a single final table fetch", async () => {
    installDatabaseDom();
    const tableRequests: Array<{
      table: string | null;
      signal?: AbortSignal;
      resolve: (res: Response) => void;
      reject: (err: unknown) => void;
    }> = [];
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
            { name: "brands", type: "table", rowCount: 40 },
            { name: "cities", type: "table", rowCount: 150_000 },
          ],
          columnsMap: {
            users: [{ name: "id", type: "integer", primaryKey: true }],
            brands: [{ name: "id", type: "integer", primaryKey: true }],
            cities: [{ name: "id", type: "integer", primaryKey: true }],
          },
        });
      if (url.startsWith("/_db/table")) {
        const table = new URL(url, "http://localhost").searchParams.get(
          "table",
        );
        return new Promise<Response>((resolve, reject) => {
          tableRequests.push({
            table,
            signal: init?.signal,
            resolve,
            reject,
          });
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("aborted", "AbortError")),
            { once: true },
          );
        });
      }
      return new Response("unexpected request", { status: 500 });
    });

    const view = createViewForTest();
    const entering = view.enter("docker:db", undefined, "users");
    await waitUntil(() => tableRequests.length === 1);
    expect(tableRequests.map((req) => req.table)).toEqual(["users"]);
    tableRequests[0].resolve(jsonResponse(baseTableResponse()));
    await entering;
    tableRequests.length = 0;

    const tableRows = Array.from(
      document.querySelectorAll(".db-table-item"),
    ) as unknown as FakeElement[];
    const brandsRow = tableRows.find((row) => row.dataset.table === "brands");
    const citiesRow = tableRows.find((row) => row.dataset.table === "cities");
    expect(brandsRow).toBeTruthy();
    expect(citiesRow).toBeTruthy();

    const clickCount = 30;
    const lastTable = (clickCount - 1) % 2 ? "cities" : "brands";
    const noExtraFetchWindowMs = TABLE_SELECT_FETCH_DELAY_MS + 25;
    const clicks: Array<Promise<void>> = [];
    for (let i = 0; i < clickCount; i++) {
      clicks.push(
        (i % 2 ? citiesRow : brandsRow)?.click() ?? Promise.resolve(),
      );
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    await waitUntil(() => tableRequests.length >= 1);
    expect(tableRequests.length > 0).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, noExtraFetchWindowMs));

    expect(tableRequests).toHaveLength(1);
    expect(tableRequests[0].table).toBe(lastTable);
    expect(tableRequests[0].signal?.aborted).toBe(false);
    expect(
      (
        document.querySelector(
          ".db-table-item.active",
        ) as unknown as FakeElement
      )?.dataset.table,
    ).toBe(lastTable);
    tableRequests[0].resolve(
      jsonResponse({ ...baseTableResponse(), table: lastTable }),
    );
    await Promise.all(clicks);
    expect(document.querySelector(".db-pane-error")).toBeNull();
    await leaveView(view);
  });

  test("sends a keepalive tabs save even when the same state is already pending", async () => {
    const { windowListeners } = installDatabaseDom();
    const tabPuts: RequestInit[] = [];
    mockFetch((url, init) => {
      if (url === "/_db/tabs" && init?.method === "PUT") {
        tabPuts.push(init);
        if (init.keepalive) return jsonResponse({ ok: true });
        return new Promise<Response>((resolve, reject) => {
          init.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("aborted", "AbortError")),
            { once: true },
          );
          setTimeout(() => resolve(jsonResponse({ ok: true })), 5000);
        });
      }
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
    await waitUntil(() => tabPuts.length === 1);
    expect(Boolean(tabPuts[0]?.keepalive)).toBe(false);

    windowListeners.beforeunload?.[0]?.();
    await waitUntil(() => tabPuts.length === 2);

    expect(tabPuts[0]?.signal?.aborted).toBe(true);
    expect(tabPuts[1]?.keepalive).toBe(true);
    await leaveView(view);
  });

  test("opens a query view without fetching the first table", async () => {
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
    await view.enter("docker:db", undefined, undefined, "query");

    expect(fetchedTables).toEqual([]);
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
              dbId: "docker:db:sample_v2_development",
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

  test("loads restored background tabs lazily when selected", async () => {
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
    expect(events).toEqual([
      "schema:docker:analytics",
      "table:docker:analytics:bookings",
    ]);

    const mainTab = document.querySelectorAll(
      ".db-tabs-chip",
    )[0] as unknown as FakeElement;
    await mainTab.click();
    await waitUntil(() => events.includes("table:docker:db:users"));
    expect(events).toEqual([
      "schema:docker:analytics",
      "table:docker:analytics:bookings",
      "schema:docker:db",
      "table:docker:db:users",
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
