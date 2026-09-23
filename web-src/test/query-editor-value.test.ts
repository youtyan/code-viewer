import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, afterEach, describe, expect, test, vi } from "vitest";
import type { DbKind, DbValue } from "../core/database/types";

GlobalRegistrator.register();

const { createQueryEditor, explainStatement } = await import(
  "../views/database/query-editor"
);
const { dbText } = await import("../views/database/i18n");

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
      getKind: () => "sqlite",
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

  // 失敗の本文がサーバの JSON なら、その error を先頭に出し、全文は「詳細」に
  // 畳む (以前は JSON をそのまま並べ、理由が末尾に埋もれた)。
  test("shows the server's reason first and folds the full detail", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const body = JSON.stringify({
      dbId: "sample.db",
      columns: [],
      rows: [],
      elapsedMs: 1,
      error: "no such table: absent",
    });
    const editor = createQueryEditor({
      getKind: () => "sqlite",
      getText: () => dbText("ja"),
      executeQuery: async () => {
        throw new Error(
          `クエリを実行できませんでした (HTTP 400 Bad Request): ${body}`,
        );
      },
    });
    document.body.appendChild(editor.el);
    editor.setSql("SELECT * FROM absent");

    await editor.run();

    const box = editor.el.querySelector<HTMLElement>(".db-query-error");
    expect([
      box?.querySelector(".db-query-error-summary")?.textContent,
      box?.querySelector("details > summary")?.textContent,
      box?.querySelector("details")?.open,
      box?.querySelector("details > pre")?.textContent,
    ]).toEqual([
      "no such table: absent",
      "詳細",
      false,
      `Error: クエリを実行できませんでした (HTTP 400 Bad Request): ${body}`,
    ]);
    editor.dispose();
  });

  test("collapses and expands the SQL input", async () => {
    const editor = createQueryEditor({
      getKind: () => "sqlite",
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
      getKind: () => "sqlite",
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
      getKind: () => "sqlite",
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
      getKind: () => "sqlite",
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
      getKind: () => "sqlite",
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
      // 直す前は err.message だけを出し、cause が画面から消えていた。
      expectedScreen:
        "Error: query request failed\nCaused by: TypeError: database connection lost",
    },
    {
      name: "Explain",
      invoke: (editor: ReturnType<typeof createQueryEditor>) =>
        editor.explain(),
      expectedOperation: "Failed to explain query",
      // 直す前は err.message だけを出し、cause が画面から消えていた。
      expectedScreen:
        "Error: query request failed\nCaused by: TypeError: database connection lost",
    },
  ])("$name keeps the screen message and complete error in the console", async ({
    invoke,
    expectedOperation,
    expectedScreen,
  }) => {
    const cause = new TypeError("database connection lost");
    const failure = Object.assign(new Error("query request failed"), {
      cause,
    });
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const editor = createQueryEditor({
      getKind: () => "sqlite",
      executeQuery: () => Promise.reject(failure),
    });
    document.body.appendChild(editor.el);
    editor.setSql("SELECT sample_column FROM sample_table");

    await invoke(editor);

    expect(editor.el.querySelector(".db-query-error")?.textContent).toBe(
      expectedScreen,
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

  // 直す前は日本語の設定でも「Explain」とその結果の状態が英語のままだった。
  test.each([
    {
      language: "en" as const,
      button: "Explain",
      status: "Explain (3ms)",
    },
    {
      language: "ja" as const,
      button: "実行計画",
      status: "実行計画 (3ms)",
    },
  ])("labels Explain and its status in the display language: $language", async ({
    language,
    button,
    status,
  }) => {
    const editor = createQueryEditor({
      getKind: () => "sqlite",
      getText: () => dbText(language),
      executeQuery: async () => ({
        dbId: "sample.db",
        columns: ["detail"],
        columnTypes: ["TEXT"],
        rows: [["SCAN sample_table"]],
        rowCount: 1,
        truncated: false,
        elapsedMs: 3,
      }),
    });
    document.body.appendChild(editor.el);
    const explain =
      editor.el.querySelector<HTMLButtonElement>(".db-query-explain");
    expect(explain?.textContent).toBe(button);

    editor.setSql("SELECT * FROM sample_table");
    await editor.explain();

    expect(editor.el.textContent).toContain(status);
    editor.dispose();
  });

  test("relabels Explain when the display language changes", () => {
    let language: "en" | "ja" = "en";
    const editor = createQueryEditor({
      getKind: () => "sqlite",
      getText: () => dbText(language),
      executeQuery: async () => {
        throw new Error("not called");
      },
    });
    const explain =
      editor.el.querySelector<HTMLButtonElement>(".db-query-explain");
    expect(explain?.textContent).toBe("Explain");
    language = "ja";
    editor.localize();
    expect(explain?.textContent).toBe("実行計画");
    expect(explain?.title).toBe("実行計画を表示");
    editor.dispose();
  });

  // 直す前は種類を見ずに EXPLAIN QUERY PLAN を送り、PostgreSQL と MySQL では
  // 構文の誤りになっていた。
  test.each([
    { kind: "sqlite", sent: "EXPLAIN QUERY PLAN SELECT * FROM sample_table" },
    { kind: "d1", sent: "EXPLAIN QUERY PLAN SELECT * FROM sample_table" },
    { kind: "postgresql", sent: "EXPLAIN SELECT * FROM sample_table" },
    { kind: "mysql", sent: "EXPLAIN SELECT * FROM sample_table" },
    { kind: "redis", sent: null },
    { kind: "elasticsearch", sent: null },
    { kind: "s3", sent: null },
    { kind: "dynamodb", sent: null },
    { kind: undefined, sent: null },
  ] satisfies {
    kind: DbKind | undefined;
    sent: string | null;
  }[])("Explain on $kind sends $sent", async ({ kind, sent }) => {
    expect(explainStatement(kind, "SELECT * FROM sample_table")).toBe(sent);
    const executed: string[] = [];
    const editor = createQueryEditor({
      getKind: () => kind,
      executeQuery: async (sql) => {
        executed.push(sql);
        return {
          dbId: "sample.db",
          columns: ["detail"],
          columnTypes: ["TEXT"],
          rows: [["SCAN sample_table"]],
          rowCount: 1,
          truncated: false,
          elapsedMs: 3,
        };
      },
    });
    document.body.appendChild(editor.el);
    editor.setSql("  SELECT * FROM sample_table  ");

    await editor.explain();

    expect(executed).toEqual(sent === null ? [] : [sent]);
    expect(editor.el.querySelector(".db-query-status")?.textContent).toBe(
      sent === null
        ? "Explain works on SQLite, D1, PostgreSQL and MySQL only"
        : "Explain (3ms)",
    );
    editor.dispose();
  });
});
