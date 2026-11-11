// データストアの表 (views/database/table-grid.ts) の view。表は要素を作って直接
// 書き換えるので、view は要素の形だけを持つ。描き方を記録する view に差し替え、
// 見出しと読み取りの行のセルに presenter が渡す値と、押したときの呼び出しを見る。

import "./_dom";
import { afterEach, describe, expect, test } from "vitest";
import type { DbColumn } from "../core/database/types";
import { tableData } from "./_table-grid-fixture";

const { createTableGrid, DEFAULT_VIEW } = await import(
  "../views/database/table-grid"
);
const { dbText } = await import("../views/database/i18n");

type GridView = typeof DEFAULT_VIEW;
const tick = () => new Promise((r) => setTimeout(r, 20));

function column(name: string, type: string, primaryKey = false): DbColumn {
  return { name, type, nullable: true, primaryKey, defaultValue: null };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("the table grid view", () => {
  test("passes the column headers and the read-only cells to the view", async () => {
    const headers: Parameters<GridView["header"]>[0][] = [];
    const cells: Parameters<GridView["dataCells"]>[0][] = [];
    const data = tableData({
      dbId: "sample.db",
      table: "sample_table",
      columns: [column("id", "INTEGER", true), column("label", "TEXT")],
      rows: [
        [1, "first"],
        [2, null],
      ],
    });
    const grid = createTableGrid(
      {
        fetchPage: async () => data,
        getDbId: () => "sample.db",
        getColumnWidths: () => ({}),
        setColumnWidths: () => undefined,
        getText: () => dbText("en"),
        getForeignKeys: () => [],
      },
      {},
      {
        ...DEFAULT_VIEW,
        header: (props) => {
          headers.push(props);
          return DEFAULT_VIEW.header(props);
        },
        dataCells: (props) => {
          cells.push(props);
          return DEFAULT_VIEW.dataCells(props);
        },
      },
    );
    document.body.append(grid.el);
    grid.load("sample_table", data);
    await tick();

    const header = headers[headers.length - 1];
    expect(header?.columns.map((col) => [col.name, col.sort])).toEqual([
      ["id", null],
      ["label", null],
    ]);
    expect(
      cells.slice(-2).map((row) => row.cells.map((cell) => cell.value)),
    ).toEqual([
      [1, "first"],
      [2, null],
    ]);

    // 見出しを押すと、その列で並べ替えた見出しを描き直す。
    header?.columns[1]?.onSort();
    await tick();
    expect(headers[headers.length - 1]?.columns.map((col) => col.sort)).toEqual(
      [null, "asc"],
    );
    grid.destroy();
  });
});
