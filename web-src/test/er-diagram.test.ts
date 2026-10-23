import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, afterEach, describe, expect, test, vi } from "vitest";
import type { DbColumn, DbSchemaResponse } from "../core/database/types";
import type { ErOption } from "../views/database/er-diagram";
import { q } from "./_test-helpers";

GlobalRegistrator.register();

const { createErDiagram } = await import("../views/database/er-diagram");
const { dbText } = await import("../views/database/i18n");

function column(
  name: string,
  type: string,
  extra: Partial<DbColumn> = {},
): DbColumn {
  return {
    name,
    type,
    nullable: false,
    primaryKey: false,
    defaultValue: null,
    ...extra,
  };
}

const SAMPLE_SCHEMA: DbSchemaResponse = {
  dbId: "sample.db",
  tables: [
    {
      name: "sample_parent",
      type: "table",
      rowCount: 1234,
      comment: "sample parent table",
    },
    { name: "sample_child", type: "table", rowCount: null },
    { name: "sample_view", type: "view", rowCount: null },
  ],
  indexes: [
    {
      name: "sample_parent_pkey",
      table: "sample_parent",
      columns: ["id"],
      unique: true,
    },
    {
      name: "sample_parent_label_key",
      table: "sample_parent",
      columns: ["label"],
      unique: true,
    },
  ],
  foreignKeys: [
    {
      fromTable: "sample_child",
      fromColumn: "sample_parent_id",
      toTable: "sample_parent",
      toColumn: "id",
    },
    // 同じ FK が 2 回届いても線は 1 本。
    {
      fromTable: "sample_child",
      fromColumn: "sample_parent_id",
      toTable: "sample_parent",
      toColumn: "id",
    },
    {
      fromTable: "sample_child",
      fromColumn: "sample_other_id",
      toTable: "sample_parent",
      toColumn: "id",
      inferred: "rails",
    },
    {
      fromTable: "sample_child",
      fromColumn: "sample_parent_code",
      toTable: "sample_parent",
      toColumn: "code",
    },
    {
      fromTable: "sample_view",
      fromColumn: "sample_parent_id",
      toTable: "sample_parent",
      toColumn: "id",
    },
  ],
};

const SAMPLE_COLUMNS = new Map<string, DbColumn[]>([
  [
    "sample_parent",
    [
      column("id", "integer", {
        primaryKey: true,
        comment: "sample parent id",
      }),
      column("label", "character varying", { nullable: true }),
      column("code", "varchar(8)"),
    ],
  ],
  [
    "sample_child",
    [
      column("id", "bigint", { primaryKey: true }),
      column("sample_parent_id", "bigint"),
      column("sample_other_id", "integer", { nullable: true }),
      column("sample_parent_code", "varchar(8)"),
      column("note", "text", {
        nullable: true,
        comment: "sample note\nsecond line",
      }),
      column("sample_flag", "boolean", { defaultValue: "false" }),
    ],
  ],
  ["sample_view", [column("sample_parent_id", "bigint")]],
]);

function rowCells(el: HTMLElement, table: string, name: string): string[] {
  const row = el.querySelector(
    `.db-er-table[data-table="${table}"] tr[data-column="${name}"]`,
  );
  if (!row) throw new Error(`no row ${table}.${name}`);
  return [...row.children].map((cell) => cell.textContent ?? "");
}

function shownColumns(el: HTMLElement, table: string): string[] {
  return [
    ...el.querySelectorAll<HTMLElement>(
      `.db-er-table[data-table="${table}"] tr[data-column]`,
    ),
  ].map((row) => row.dataset.column ?? "");
}

function toggle(el: HTMLElement, option: ErOption): HTMLButtonElement {
  return q<HTMLButtonElement>(el, `.db-er-toggle[data-option="${option}"]`);
}

function setup(deps: Parameters<typeof createErDiagram>[0] = {}) {
  const diagram = createErDiagram(deps);
  document.body.appendChild(diagram.el);
  diagram.render(SAMPLE_SCHEMA, SAMPLE_COLUMNS);
  return diagram;
}

describe("ER diagram", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  afterAll(() => {
    GlobalRegistrator.unregister();
  });

  test.each([
    {
      name: "a primary key with a comment",
      table: "sample_parent",
      column: "id",
      cells: ["PK", "id", "integer", "", "sample parent id"],
    },
    {
      name: "a unique nullable column with the long PostgreSQL type name",
      table: "sample_parent",
      column: "label",
      cells: ["UQ", "label", "varchar", "NULL", ""],
    },
    {
      name: "a required foreign key",
      table: "sample_child",
      column: "sample_parent_id",
      cells: ["FK", "sample_parent_id", "bigint", "", ""],
    },
    {
      name: "a guessed foreign key",
      table: "sample_child",
      column: "sample_other_id",
      cells: ["FK", "sample_other_id", "integer", "NULL", ""],
    },
    {
      name: "a plain column with a two-line comment",
      table: "sample_child",
      column: "note",
      cells: ["", "note", "text", "NULL", "sample note"],
    },
  ])("shows $name", ({ table, column: name, cells }) => {
    const diagram = setup();

    expect(rowCells(diagram.el, table, name)).toEqual(cells);
    diagram.dispose();
  });

  test("the card header shows the name, the row count and the table comment", () => {
    const diagram = setup();

    const head = diagram.el.querySelector(
      '.db-er-table[data-table="sample_parent"] .db-er-table-head',
    );
    expect(
      [...(head?.querySelectorAll("span") ?? [])].map((s) => s.textContent),
    ).toEqual(["sample_parent", "1.2K", "sample parent table"]);
    diagram.dispose();
  });

  test("a row's tooltip carries the full type, NULL, default, target and comment", () => {
    const diagram = setup();

    const title = (name: string) =>
      diagram.el.querySelector<HTMLElement>(
        `.db-er-table[data-table="sample_child"] tr[data-column="${name}"]`,
      )?.title;
    expect({
      other: title("sample_other_id"),
      note: title("note"),
      flag: title("sample_flag"),
    }).toEqual({
      other:
        "sample_other_id  integer\nNULL allowed\nReferences sample_parent.id (Guessed from the column name)",
      note: "note  text\nNULL allowed\nsample note\nsecond line",
      flag: "sample_flag  boolean\nDefault: false",
    });
    diagram.dispose();
  });

  test("draws one line per distinct foreign key between drawn tables, guessed ones marked", () => {
    const diagram = setup();

    expect({
      edges: diagram.el.querySelectorAll(".db-er-edge").length,
      inferred: diagram.el.querySelectorAll(".db-er-edge.is-inferred").length,
      cards: [...diagram.el.querySelectorAll<HTMLElement>(".db-er-table")].map(
        (card) => card.dataset.table,
      ),
    }).toEqual({
      edges: 3,
      inferred: 1,
      cards: ["sample_parent", "sample_child"],
    });
    diagram.dispose();
  });

  test.each([
    {
      name: "only views",
      schema: {
        ...SAMPLE_SCHEMA,
        tables: [
          { name: "sample_view", type: "view" as const, rowCount: null },
        ],
      },
    },
    {
      name: "tables whose columns did not load",
      schema: {
        ...SAMPLE_SCHEMA,
        tables: [
          { name: "sample_missing", type: "table" as const, rowCount: null },
        ],
      },
    },
  ])("says there is nothing to draw for $name", ({ schema }) => {
    const diagram = createErDiagram();
    document.body.appendChild(diagram.el);

    diagram.render(schema, SAMPLE_COLUMNS);

    expect(diagram.el.querySelector(".db-er-canvas")?.textContent).toBe(
      "No tables to display.",
    );
    diagram.dispose();
  });

  test("turning comments off hides every comment and remembers the choice", async () => {
    const saveOption = vi.fn(() => Promise.resolve());
    const diagram = setup({ saveOption });

    const button = toggle(diagram.el, "erShowComments");
    button.click();
    await Promise.resolve();

    expect({
      pressed: button.getAttribute("aria-pressed"),
      columnComments: diagram.el.querySelectorAll(".db-er-col-comment").length,
      tableComments: diagram.el.querySelectorAll(".db-er-table-comment").length,
      saved: saveOption.mock.calls,
    }).toEqual({
      pressed: "false",
      columnComments: 0,
      tableComments: 0,
      saved: [["erShowComments", false]],
    });
    diagram.dispose();
  });

  test("keys only keeps key and referenced columns and counts the rest", () => {
    const diagram = setup();

    toggle(diagram.el, "erKeysOnly").click();

    expect({
      parent: shownColumns(diagram.el, "sample_parent"),
      child: shownColumns(diagram.el, "sample_child"),
      more: [...diagram.el.querySelectorAll(".db-er-more")].map(
        (m) => m.textContent,
      ),
    }).toEqual({
      parent: ["id", "label", "code"],
      child: [
        "id",
        "sample_parent_id",
        "sample_other_id",
        "sample_parent_code",
      ],
      more: ["2 more columns"],
    });
    diagram.dispose();
  });

  test("starts from the remembered choices", () => {
    const diagram = setup({
      getOption: (key) => key === "erKeysOnly",
    });

    expect({
      comments: toggle(diagram.el, "erShowComments").getAttribute(
        "aria-pressed",
      ),
      keys: toggle(diagram.el, "erKeysOnly").getAttribute("aria-pressed"),
      child: shownColumns(diagram.el, "sample_child"),
      columnComments: diagram.el.querySelectorAll(".db-er-col-comment").length,
    }).toEqual({
      comments: "false",
      keys: "true",
      child: [
        "id",
        "sample_parent_id",
        "sample_other_id",
        "sample_parent_code",
      ],
      columnComments: 0,
    });
    diagram.dispose();
  });

  test("a choice that could not be saved says why on the toggle and in the console", async () => {
    const failure = new Error("sample save refused");
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const diagram = setup({ saveOption: () => Promise.reject(failure) });

    const button = toggle(diagram.el, "erKeysOnly");
    button.click();
    await Promise.resolve();
    await Promise.resolve();

    expect({
      failed: button.dataset.saveFailed,
      title: button.title,
      logged: consoleError.mock.calls,
    }).toEqual({
      failed: "1",
      title: "Could not remember this choice: Error: sample save refused",
      logged: [
        [
          "[code-viewer] SQL remember ER diagram option erKeysOnly failed",
          true,
          failure,
        ],
      ],
    });
    diagram.dispose();
  });

  test.each([
    {
      name: "double-click",
      act: (head: HTMLElement) =>
        head.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })),
    },
    {
      name: "Enter",
      act: (head: HTMLElement) =>
        head.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
        ),
    },
  ])("$name on a card header opens that table", ({ act }) => {
    const onOpenTable = vi.fn();
    const diagram = setup({ onOpenTable });

    const head = diagram.el.querySelector<HTMLElement>(
      '.db-er-table[data-table="sample_child"] .db-er-table-head',
    );
    if (!head) throw new Error("no card header");
    act(head);

    expect(onOpenTable.mock.calls).toEqual([["sample_child"]]);
    diagram.dispose();
  });

  test.each([
    { name: "the table name", query: "CHILD", match: "sample_child" },
    {
      name: "the table comment",
      query: "parent table",
      match: "sample_parent",
    },
  ])("finding by $name dims the other tables", ({ query, match }) => {
    const diagram = setup();

    const find = diagram.el.querySelector<HTMLInputElement>(".db-er-find");
    if (!find) throw new Error("no find box");
    find.value = query;
    find.dispatchEvent(new Event("input"));

    const state = Object.fromEntries(
      [...diagram.el.querySelectorAll<HTMLElement>(".db-er-table")].map(
        (card) => [
          card.dataset.table,
          card.classList.contains("is-match")
            ? "match"
            : card.classList.contains("is-dimmed")
              ? "dimmed"
              : "plain",
        ],
      ),
    );
    expect(state[match]).toBe("match");
    expect(Object.values(state).filter((s) => s === "dimmed")).toHaveLength(1);
    diagram.dispose();
  });

  test("Copy Mermaid writes the tables with real types, keys, comments and cardinality", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const diagram = setup();

    diagram.el.querySelector<HTMLButtonElement>(".db-er-copy")?.click();
    await Promise.resolve();

    expect(writeText.mock.calls).toEqual([
      [
        [
          "erDiagram",
          "  sample_parent {",
          '    integer id PK "sample parent id"',
          "    character_varying label UK",
          "    varchar(8) code",
          "  }",
          "  sample_child {",
          "    bigint id PK",
          "    bigint sample_parent_id FK",
          "    integer sample_other_id FK",
          "    varchar(8) sample_parent_code FK",
          '    text note "sample note second line"',
          "    boolean sample_flag",
          "  }",
          '  sample_parent ||--o{ sample_child : "sample_parent_id"',
        ].join("\n"),
      ],
    ]);
    diagram.dispose();
  });

  test("shows the Mermaid clipboard failure reason", async () => {
    const failure = new DOMException(
      "clipboard permission denied",
      "NotAllowedError",
    );
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: () => Promise.reject(failure) },
    });
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const diagram = setup();

    const copy = diagram.el.querySelector<HTMLButtonElement>(".db-er-copy");
    copy?.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(copy?.classList.contains("failed")).toBe(true);
    expect(copy?.title).toContain(
      "NotAllowedError: clipboard permission denied",
    );
    expect(consoleError).toHaveBeenCalledWith(
      "Failed to copy Mermaid source",
      failure,
    );
    diagram.dispose();
  });

  test("switching the language relabels the toolbar and the cards", () => {
    let lang: "en" | "ja" = "en";
    const diagram = setup({
      getText: () => dbText(lang),
      getOption: (key) => key === "erKeysOnly",
    });

    lang = "ja";
    diagram.localize();

    expect({
      toggles: [...diagram.el.querySelectorAll(".db-er-toggle")].map(
        (b) => b.textContent,
      ),
      more: diagram.el.querySelector(".db-er-more")?.textContent,
      find: diagram.el.querySelector<HTMLInputElement>(".db-er-find")
        ?.placeholder,
    }).toEqual({
      toggles: ["コメント", "キー列だけ"],
      more: "ほか 2 列",
      find: "テーブルを探す",
    });
    diagram.dispose();
  });
});
