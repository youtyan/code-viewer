// セルの詳細の「行全体」(views/database/row-detail.ts)。happy-dom の実描画で、
// 列ごとの値の出し方 (JSON・日時・NULL)・今の列・外部キーの関連・絞り込み・
// 値のコピーを見る。時計は Date だけ止める。

import { GlobalRegistrator } from "@happy-dom/global-registrator";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import { tableData } from "./_table-grid-fixture";
import { q } from "./_test-helpers";

GlobalRegistrator.register();

const { createTableGrid } = await import("../views/database/table-grid");
const { dbText } = await import("../views/database/i18n");

import type { DbColumn, DbForeignKey, DbValue } from "../core/database/types";

/** 2026-10-02T00:00:00Z */
const NOW = 1790899200000;
const tick = () => new Promise((r) => setTimeout(r, 20));

function column(name: string, type: string, primaryKey = false): DbColumn {
  return { name, type, nullable: true, primaryKey, defaultValue: null };
}

const COLUMNS = [
  column("id", "INTEGER", true),
  column("owner_id", "INTEGER"),
  column("payload", "TEXT"),
  column("updated_at", "TEXT"),
  column("note", "TEXT"),
];
const ROW: DbValue[] = [
  1,
  10,
  '{"kind":"sample","lines":[1,2]}',
  "2026-10-01 23:55:00",
  null,
];
const FK: DbForeignKey[] = [
  {
    fromTable: "sample_table",
    fromColumn: "owner_id",
    toTable: "sample_owner",
    toColumn: "id",
  },
];

function setup(columns = COLUMNS, row = ROW, timeZone = "") {
  const related: string[] = [];
  const grid = createTableGrid({
    fetchPage: async () =>
      tableData({
        dbId: "sample.db",
        table: "sample_table",
        columns,
        rows: [row],
      }),
    getDbId: () => "sample.db",
    getColumnWidths: () => ({}),
    setColumnWidths: () => undefined,
    getText: () => dbText("en"),
    getForeignKeys: () => FK,
    getTimeZone: () => timeZone,
    fetchRelatedPage: async (table) => {
      related.push(table);
      return tableData({
        dbId: "sample.db",
        table,
        columns: [column("id", "INTEGER", true)],
        rows: [[10]],
      });
    },
  });
  document.body.appendChild(grid.el);
  grid.load(
    "sample_table",
    tableData({
      dbId: "sample.db",
      table: "sample_table",
      columns,
      rows: [row],
    }),
    null,
  );
  const openRow = async (col: number) => {
    await tick();
    const cells = q<HTMLElement>(
      grid.el,
      ".db-grid-body .db-grid-row",
    ).children;
    // 列: # | Changed (updated_at があるとき) | データの列
    const lead = grid.el.querySelector(".db-grid-recency-header") ? 2 : 1;
    (cells[col + lead] as HTMLElement).dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
    q<HTMLButtonElement>(grid.el, ".db-detail-tab:nth-child(2)").click();
  };
  const item = (name: string) =>
    [...grid.el.querySelectorAll<HTMLElement>(".db-row-detail-item")].find(
      (el) => el.querySelector(".db-row-detail-name")?.textContent === name,
    );
  const done = () => {
    grid.destroy();
    grid.el.remove();
  };
  return { grid, related, openRow, item, done };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
afterAll(() => {
  GlobalRegistrator.unregister();
});

describe("row detail", () => {
  test("shows each column with its type and a readable value", async () => {
    const t = setup();
    await t.openRow(4);
    const rows = [
      ...t.grid.el.querySelectorAll<HTMLElement>(".db-row-detail-item"),
    ].map((el) => [
      el.querySelector(".db-row-detail-name")?.textContent,
      el.querySelector(".db-row-detail-type")?.textContent,
      el.querySelector(".db-row-detail-pk") !== null,
    ]);
    expect(rows).toEqual([
      ["id", "INTEGER", true],
      ["owner_id", "INTEGER", false],
      ["payload", "TEXT", false],
      ["updated_at", "TEXT", false],
      ["note", "TEXT", false],
    ]);
    t.done();
  });

  test("pretty prints JSON values", async () => {
    const t = setup();
    await t.openRow(0);
    expect(q(t.item("payload") as HTMLElement, "pre").textContent).toBe(
      '{\n  "kind": "sample",\n  "lines": [\n    1,\n    2\n  ]\n}',
    );
    t.done();
  });

  test.each([
    {
      name: "the stored value",
      zone: "",
      expected: "2026-10-01 23:55:005m ago",
    },
    {
      name: "the table's time zone",
      zone: "Asia/Tokyo",
      expected: "2026-10-02 08:55:005m ago",
    },
  ])("dates show $name with how long ago", async ({ zone, expected }) => {
    const t = setup(COLUMNS, ROW, zone);
    await t.openRow(0);
    expect(
      q(t.item("updated_at") as HTMLElement, ".db-row-detail-value")
        .textContent,
    ).toBe(expected);
    t.done();
  });

  test("marks the column of the selected cell", async () => {
    const t = setup();
    await t.openRow(2);
    expect(
      [
        ...t.grid.el.querySelectorAll(
          ".db-row-detail-item.is-active .db-row-detail-name",
        ),
      ].map((el) => el.textContent),
    ).toEqual(["payload"]);
    t.done();
  });

  test("a foreign key opens the related rows", async () => {
    const t = setup();
    await t.openRow(0);
    const owner = t.item("owner_id") as HTMLElement;
    const buttons = owner.querySelectorAll<HTMLButtonElement>(
      ".db-row-detail-action",
    );
    expect(buttons.length).toBe(2);
    buttons[0].click();
    await tick();
    expect([
      t.related,
      q<HTMLElement>(t.grid.el, ".db-related-panel").hidden,
    ]).toEqual([["sample_owner"], false]);
    t.done();
  });

  test("copies one value with its button", async () => {
    const written: string[] = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (value: string) => written.push(value) },
    });
    const t = setup();
    await t.openRow(0);
    const note = t.item("note") as HTMLElement;
    q<HTMLButtonElement>(note, ".db-row-detail-action").click();
    q<HTMLButtonElement>(
      t.item("id") as HTMLElement,
      ".db-row-detail-action",
    ).click();
    await tick();
    expect(written).toEqual(["", "1"]);
    t.done();
  });

  test("filters the columns of a wide row by name", async () => {
    const wide = Array.from({ length: 14 }, (_, i) =>
      column(i === 0 ? "id" : `sample_col_${i}`, "TEXT", i === 0),
    );
    const row = wide.map((_, i) => `value ${i}`);
    const t = setup(wide, row);
    await t.openRow(0);
    const filter = q<HTMLInputElement>(t.grid.el, ".db-row-detail-filter");
    filter.value = "sample_col_1";
    filter.dispatchEvent(new Event("input"));
    expect(
      [...t.grid.el.querySelectorAll<HTMLElement>(".db-row-detail-item")]
        .filter((el) => !el.hidden)
        .map((el) => el.querySelector(".db-row-detail-name")?.textContent),
    ).toEqual([
      "sample_col_1",
      "sample_col_10",
      "sample_col_11",
      "sample_col_12",
      "sample_col_13",
    ]);
    t.done();
  });
});
