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

function mockFetch(handler: (url: string, init?: RequestInit) => Response) {
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

function createViewForTest() {
  return createDatabaseView({
    setRoute() {},
    setPageMode() {},
    currentRange: () => ({ from: "HEAD", to: "worktree" }),
    trackLoad: (promise) => promise,
    syncHeaderMenu() {},
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
