// 関連パネルの左の一覧と右の見出し (views/database/related-list.ts)。happy-dom の
// 実描画で、2 つに分けた一覧・件数・0 件を隠す切り替え・見出しの文・空表示を見る。

import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, afterEach, describe, expect, test, vi } from "vitest";
import { tableData } from "./_table-grid-fixture";
import { q } from "./_test-helpers";

GlobalRegistrator.register();

const { createTableGrid } = await import("../views/database/table-grid");
const { dbText } = await import("../views/database/i18n");

import type {
  DbColumn,
  DbForeignKey,
  DbTableDataResponse,
} from "../core/database/types";
import type { GridExactFilter } from "../views/database/table-grid";

const tick = () => new Promise((r) => setTimeout(r, 20));

function column(name: string, primaryKey = false): DbColumn {
  return {
    name,
    type: "INTEGER",
    nullable: !primaryKey,
    primaryKey,
    defaultValue: null,
  };
}

const COLUMNS = [column("id", true), column("owner_id"), column("label")];

// sample_table の行 (id 1, owner_id 10) から見た関係:
//   出ていく: owner_id → sample_owner.id (1 件)
//   入ってくる: sample_child.sample_parent_id → id (2 件)、
//               sample_note.sample_parent_id → id (推測・0 件)
const FK: DbForeignKey[] = [
  {
    fromTable: "sample_table",
    fromColumn: "owner_id",
    toTable: "sample_owner",
    toColumn: "id",
  },
  {
    fromTable: "sample_child",
    fromColumn: "sample_parent_id",
    toTable: "sample_table",
    toColumn: "id",
  },
  {
    fromTable: "sample_note",
    fromColumn: "sample_parent_id",
    toTable: "sample_table",
    toColumn: "id",
    inferred: "rails",
  },
];

const ROWS_BY_TABLE: Record<string, number> = {
  sample_owner: 1,
  sample_child: 2,
  sample_note: 0,
};

function rowsFor(table: string, count: number): DbTableDataResponse {
  return tableData({
    dbId: "sample.db",
    table,
    columns: [column("id", true), column("sample_parent_id")],
    rows: Array.from({ length: count }, (_, i) => [i + 1, 1]),
  });
}

type RelatedCall = { table: string; limit: number; eq: GridExactFilter[] };

function setup(failCountFor?: string) {
  const calls: RelatedCall[] = [];
  const grid = createTableGrid({
    fetchPage: async () =>
      tableData({
        dbId: "sample.db",
        table: "sample_table",
        columns: COLUMNS,
        rows: [[1, 10, "alpha"]],
      }),
    getDbId: () => "sample.db",
    getColumnWidths: () => ({}),
    setColumnWidths: () => undefined,
    getText: () => dbText("en"),
    getForeignKeys: () => FK,
    fetchRelatedPage: async (table, _offset, limit, _sort, _filters, eq) => {
      calls.push({ table, limit, eq });
      if (table === failCountFor && limit === 1)
        throw new Error("permission denied for table");
      return rowsFor(table, ROWS_BY_TABLE[table] ?? 0);
    },
  });
  document.body.appendChild(grid.el);
  grid.load(
    "sample_table",
    tableData({
      dbId: "sample.db",
      table: "sample_table",
      columns: COLUMNS,
      rows: [[1, 10, "alpha"]],
    }),
    null,
  );
  const clickCell = (col: number) =>
    (
      q<HTMLElement>(grid.el, ".db-grid-body .db-grid-row").children[
        col + 1
      ] as HTMLElement
    ).dispatchEvent(new MouseEvent("click", { bubbles: true }));
  const items = () =>
    [...grid.el.querySelectorAll<HTMLElement>(".db-related-item")].map(
      (item) => ({
        table: q(item, ".db-related-item-table").textContent,
        count: q(item, ".db-related-item-count").textContent,
        inferred: item.querySelector(".db-related-inferred") !== null,
        active: item.classList.contains("is-active"),
      }),
    );
  const groups = () =>
    [...grid.el.querySelectorAll<HTMLElement>(".db-related-group")].map(
      (group) => group.textContent,
    );
  const head = () =>
    [...q(grid.el, ".db-related-head").children]
      .map((part) => part.textContent)
      .filter(Boolean)
      .join(" | ");
  const toggle = () =>
    grid.el.querySelector<HTMLButtonElement>(".db-related-empty-toggle");
  const done = () => {
    grid.destroy();
    grid.el.remove();
  };
  return { grid, calls, clickCell, items, groups, head, toggle, done };
}

afterEach(() => {
  vi.restoreAllMocks();
});
afterAll(() => {
  GlobalRegistrator.unregister();
});

describe("related list", () => {
  test("splits the relations into the two directions with their counts and hides the empty ones", async () => {
    const t = setup();
    await tick();
    t.clickCell(0); // id → この行を参照している関係が開く
    await tick();
    await tick();
    expect(t.groups()).toEqual([
      "This row refers to1",
      "Rows that refer to this row2",
    ]);
    expect(t.items()).toEqual([
      { table: "sample_owner", count: "1", inferred: false, active: false },
      { table: "sample_child", count: "2", inferred: false, active: true },
    ]);
    expect(t.toggle()?.textContent).toBe("Show 1 hidden with no rows");
    t.done();
  });

  test("shows the empty relations on request, dimmed", async () => {
    const t = setup();
    await tick();
    t.clickCell(0);
    await tick();
    await tick();
    t.toggle()?.click();
    expect(
      t.items().map((item) => [item.table, item.count, item.inferred]),
    ).toEqual([
      ["sample_owner", "1", false],
      ["sample_child", "2", false],
      ["sample_note", "0", true],
    ]);
    expect(
      q(t.grid.el, ".db-related-item.is-empty .db-related-item-table")
        .textContent,
    ).toBe("sample_note");
    expect(t.toggle()?.textContent).toBe("Hide 1 with no rows");
    t.done();
  });

  test("counts the other relations with one-row reads and reads the chosen one once", async () => {
    const t = setup();
    await tick();
    t.clickCell(0);
    await tick();
    await tick();
    expect(
      t.calls.map((call) => [call.table, call.limit, call.eq[0]?.column]),
    ).toEqual([
      ["sample_child", 200, "sample_parent_id"],
      ["sample_owner", 1, "id"],
      ["sample_note", 1, "sample_parent_id"],
    ]);
    t.done();
  });

  test.each([
    {
      name: "a row this row points to",
      col: 1,
      expected:
        "The sample_owner row this row's owner_id points to | id = 10 | 1 row",
    },
    {
      name: "rows that point to this row",
      col: 0,
      expected:
        "sample_child rows whose sample_parent_id points to this row | sample_parent_id = 1 | 2 rows",
    },
  ])("says what the right side shows: $name", async ({ col, expected }) => {
    const t = setup();
    await tick();
    t.clickCell(col);
    await tick();
    await tick();
    expect(t.head()).toBe(expected);
    t.done();
  });

  test("an empty guessed relation says so and why it may be empty", async () => {
    const t = setup();
    await tick();
    t.clickCell(0);
    await tick();
    await tick();
    t.toggle()?.click();
    const note = [
      ...t.grid.el.querySelectorAll<HTMLElement>(".db-related-item"),
    ].find((item) => item.textContent?.includes("sample_note"));
    note?.click();
    await tick();
    const empty = q<HTMLElement>(t.grid.el, ".db-related-empty");
    expect([empty.hidden, empty.textContent]).toEqual([
      false,
      "No row refers to this rowGuessed from the column names; the database does not declare this foreign key",
    ]);
    t.done();
  });

  test("a count that fails shows ! with the reason", async () => {
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const t = setup("sample_owner");
    await tick();
    t.clickCell(0);
    await tick();
    await tick();
    const badge = [
      ...t.grid.el.querySelectorAll<HTMLElement>(".db-related-item"),
    ]
      .find((item) => item.textContent?.includes("sample_owner"))
      ?.querySelector<HTMLElement>(".db-related-item-count");
    expect([badge?.textContent, badge?.title]).toEqual([
      "!",
      "Could not count the rows: Error: permission denied for table",
    ]);
    expect(error).toHaveBeenCalledWith(
      "[code-viewer] SQL count related rows failed",
      "sample_owner",
      [{ column: "id", value: "10" }],
      expect.any(Error),
    );
    t.done();
  });
});
