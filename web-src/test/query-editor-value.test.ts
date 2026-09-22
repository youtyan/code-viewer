import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, afterEach, describe, expect, test, vi } from "vitest";
import type { DbValue } from "../core/database/types";

GlobalRegistrator.register();

const { createQueryEditor } = await import("../views/database/query-editor");

describe("query editor value display", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  afterAll(() => {
    GlobalRegistrator.unregister();
  });

  test.each([
    { name: "null uses the SQL null marker", value: null, expected: "NULL" },
    {
      name: "binary values show their byte length",
      value: new Uint8Array([1, 2, 3]),
      expected: "<blob 3 bytes>",
    },
    { name: "true stays lowercase", value: true, expected: "true" },
    { name: "false stays lowercase", value: false, expected: "false" },
    { name: "strings remain unchanged", value: "sample", expected: "sample" },
    { name: "numbers use decimal text", value: 42, expected: "42" },
  ])("$name", async ({ value, expected }) => {
    const editor = createQueryEditor({
      executeQuery: async () => ({
        dbId: "sample.db",
        columns: ["sample_column"],
        columnTypes: ["TEXT"],
        rows: [[value as DbValue]],
        rowCount: 1,
        truncated: false,
        elapsedMs: 1,
      }),
    });
    document.body.appendChild(editor.el);
    editor.setSql("SELECT sample_column FROM sample_table");

    await editor.run();

    const cells = editor.el.querySelectorAll("tbody td");
    expect(cells[1]?.textContent).toBe(expected);
    editor.dispose();
  });

  test("collapses and expands the SQL input", async () => {
    const editor = createQueryEditor({
      executeQuery: async () => ({
        dbId: "sample.db",
        columns: [],
        columnTypes: [],
        rows: [],
        rowCount: 0,
        truncated: false,
        elapsedMs: 1,
      }),
    });
    document.body.appendChild(editor.el);

    const toggle =
      editor.el.querySelector<HTMLButtonElement>(".db-query-collapse");
    const editorWrap = editor.el.querySelector<HTMLElement>(
      ".db-query-editor-wrap",
    );
    const resizer = editor.el.querySelector<HTMLElement>(".db-query-resize");

    expect(toggle?.getAttribute("aria-expanded")).toBe("true");
    expect(editorWrap?.hidden).toBe(false);
    expect(resizer?.hidden).toBe(false);

    toggle?.click();

    expect(toggle?.getAttribute("aria-expanded")).toBe("false");
    expect(editorWrap?.hidden).toBe(true);
    expect(resizer?.hidden).toBe(true);

    toggle?.click();

    expect(toggle?.getAttribute("aria-expanded")).toBe("true");
    expect(editorWrap?.hidden).toBe(false);
    expect(resizer?.hidden).toBe(false);
    editor.dispose();
  });

  test("resizes the SQL input from the keyboard", () => {
    const editor = createQueryEditor({
      executeQuery: async () => ({
        dbId: "sample.db",
        columns: [],
        columnTypes: [],
        rows: [],
        rowCount: 0,
        truncated: false,
        elapsedMs: 1,
      }),
    });
    document.body.appendChild(editor.el);
    const input = editor.el.querySelector<HTMLElement>(".db-query-input");
    const resizer = editor.el.querySelector<HTMLElement>(".db-query-resize");
    const event = new KeyboardEvent("keydown", {
      key: "ArrowDown",
      bubbles: true,
      cancelable: true,
    });

    resizer?.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(input?.style.height).toBe("120px");
    editor.dispose();
  });

  test("returns from query results to the table grid", async () => {
    let resultShown = 0;
    const editor = createQueryEditor({
      executeQuery: async () => ({
        dbId: "sample.db",
        columns: ["sample_column"],
        columnTypes: ["TEXT"],
        rows: [["sample"]],
        rowCount: 1,
        truncated: false,
        elapsedMs: 1,
      }),
      onResultShown: () => {
        resultShown++;
      },
    });
    document.body.appendChild(editor.el);
    editor.setSql("SELECT sample_column FROM sample_table");

    await editor.run();

    expect(resultShown).toBe(1);
    expect(editor.el.classList.contains("has-result")).toBe(true);
    expect(
      editor.el.querySelector<HTMLElement>(".db-query-result")?.hidden,
    ).toBe(false);

    editor.showTableResult();

    expect(editor.el.classList.contains("has-result")).toBe(false);
    expect(
      editor.el.querySelector<HTMLElement>(".db-query-result")?.hidden,
    ).toBe(true);
    editor.dispose();
  });

  test.each([
    "ctrlKey",
    "metaKey",
  ] as const)("%s + Enter runs the query", async (modifier) => {
    let executions = 0;
    const editor = createQueryEditor({
      executeQuery: async () => {
        executions++;
        return {
          dbId: "sample.db",
          columns: [],
          columnTypes: [],
          rows: [],
          rowCount: 0,
          truncated: false,
          elapsedMs: 1,
        };
      },
    });
    document.body.appendChild(editor.el);
    editor.setSql("SELECT sample_column FROM sample_table");

    editor.el.querySelector("textarea")?.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        [modifier]: true,
        bubbles: true,
      }),
    );
    await Promise.resolve();

    expect(executions).toBe(1);
    editor.dispose();
  });

  test("shows the complete Local History load failure", async () => {
    const failure = new TypeError("history connection lost");
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const editor = createQueryEditor({
      executeQuery: async () => ({
        dbId: "sample.db",
        columns: [],
        columnTypes: [],
        rows: [],
        rowCount: 0,
        truncated: false,
        elapsedMs: 1,
      }),
      loadHistory: () => Promise.reject(failure),
    });
    document.body.appendChild(editor.el);

    editor.el
      .querySelector<HTMLButtonElement>(".db-query-history-btn")
      ?.click();
    await Promise.resolve();
    await Promise.resolve();

    const message = editor.el.querySelector(".db-query-history-empty");
    expect(message?.textContent).toContain(
      "TypeError: history connection lost",
    );
    expect(message?.classList.contains("db-pane-error")).toBe(true);
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("Local History"),
      failure,
    );
    editor.dispose();
  });

  test.each([
    {
      name: "Run",
      invoke: (editor: ReturnType<typeof createQueryEditor>) => editor.run(),
      expectedOperation: "Failed to execute query",
    },
    {
      name: "Explain",
      invoke: (editor: ReturnType<typeof createQueryEditor>) =>
        editor.explain(),
      expectedOperation: "Failed to explain query",
    },
  ])("$name keeps the screen message and complete error in the console", async ({
    invoke,
    expectedOperation,
  }) => {
    const cause = new TypeError("database connection lost");
    const failure = Object.assign(new Error("query request failed"), {
      cause,
    });
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const editor = createQueryEditor({
      executeQuery: () => Promise.reject(failure),
    });
    document.body.appendChild(editor.el);
    editor.setSql("SELECT sample_column FROM sample_table");

    await invoke(editor);

    expect(editor.el.querySelector(".db-query-error")?.textContent).toBe(
      "query request failed",
    );
    expect(consoleError).toHaveBeenCalledWith(expectedOperation, failure);
    expect(consoleError.mock.calls[0]?.[1]).toBe(failure);
    const logged = consoleError.mock.calls[0]?.[1] as Error & {
      cause?: unknown;
    };
    expect(logged.cause).toBe(cause);
    expect(logged.stack).toBe(failure.stack);
    editor.dispose();
  });
});
