// datastore の Data グリッドで、矢印キーが「いまどのデータセルに居るか」を
// 動かすことを happy-dom 上の実描画で確認する。文字列の存在ではなく、
// db-grid-cell-active が付くセルの位置と、詳細フッタが何を出しているかで見る。

import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, describe, expect, test } from "vitest";
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

const COLUMNS: DbColumn[] = [
  {
    name: "id",
    type: "INTEGER",
    nullable: false,
    primaryKey: true,
    defaultValue: null,
  },
  {
    name: "owner_id",
    type: "INTEGER",
    nullable: true,
    primaryKey: false,
    defaultValue: null,
  },
  {
    name: "label",
    type: "TEXT",
    nullable: true,
    primaryKey: false,
    defaultValue: null,
  },
];

// 3 列 x 4 行。上下左右すべてに「まだ動ける先」と「端」の両方がある大きさ。
const ROWS = [
  [1, 10, "alpha"],
  [2, 11, "bravo"],
  [3, 12, "charlie"],
  [4, 13, "delta"],
];

function initialData(): DbTableDataResponse {
  return tableData({
    dbId: "sample.db",
    table: "sample_table",
    columns: COLUMNS,
    rows: ROWS,
  });
}

type Setup = {
  fk?: DbForeignKey[];
  editable?: boolean;
};

function setup(opts: Setup = {}) {
  const relatedCalls: Array<{ table: string; eq: GridExactFilter[] }> = [];
  const grid = createTableGrid({
    fetchPage: async () => initialData(),
    getDbId: () => "sample.db",
    getColumnWidths: () => ({}),
    setColumnWidths: () => undefined,
    getText: () => dbText("en"),
    getForeignKeys: () => opts.fk ?? [],
    getEditable: () => opts.editable === true,
    applyMutations: async () => undefined,
    fetchRelatedPage: async (table, _offset, _limit, _sort, _filters, eq) => {
      relatedCalls.push({ table, eq });
      return initialData();
    },
  });
  document.body.appendChild(grid.el);
  grid.load("sample_table", initialData());
  return { grid, relatedCalls };
}

/** 描画済みグリッドで active セルが何行目・何列目かを返す。 */
function activePos(root: HTMLElement): { row: number; col: number } | null {
  const body = q<HTMLElement>(root, ".db-grid-body");
  const rows = Array.from(body.querySelectorAll<HTMLElement>(".db-grid-row"));
  for (let r = 0; r < rows.length; r++) {
    const cells = Array.from(rows[r].children) as HTMLElement[];
    const col = cells.findIndex((c) =>
      c.classList.contains("db-grid-cell-active"),
    );
    // 先頭は行番号セルなので 1 引いてデータ列の index にする。
    if (col >= 0) return { row: r, col: col - 1 };
  }
  return null;
}

function press(
  root: HTMLElement,
  key: string,
  init: KeyboardEventInit = {},
): void {
  q<HTMLElement>(root, ".db-grid-viewport").dispatchEvent(
    new KeyboardEvent("keydown", { key, bubbles: true, ...init }),
  );
}

/** データセルをクリックして現在地を作る (矢印キーの起点)。 */
function clickCell(root: HTMLElement, row: number, col: number): void {
  const body = q<HTMLElement>(root, ".db-grid-body");
  const rows = body.querySelectorAll<HTMLElement>(".db-grid-row");
  const cell = rows[row].children[col + 1] as HTMLElement;
  cell.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

describe("table-grid arrow-key cell navigation", () => {
  afterAll(() => {
    GlobalRegistrator.unregister();
  });

  test("row details show every column and follow the active row", async () => {
    const { grid } = setup();
    await tick();
    clickCell(grid.el, 0, 2);
    q<HTMLButtonElement>(grid.el, ".db-detail-tab:nth-child(2)").click();
    const values = () =>
      Array.from(
        grid.el.querySelectorAll(".db-grid-row-detail tbody tr"),
        (row) => Array.from(row.children, (cell) => cell.textContent),
      );
    expect(values()).toEqual([
      ["id", "1"],
      ["owner_id", "10"],
      ["label", "alpha"],
    ]);
    expect(document.activeElement).toBe(q(grid.el, ".db-grid-viewport"));
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );
    expect(values()).toEqual([
      ["id", "2"],
      ["owner_id", "11"],
      ["label", "bravo"],
    ]);
    expect(q(grid.el, ".db-grid-detail-title").textContent).toBe("Row 2");
    q<HTMLButtonElement>(grid.el, ".db-detail-tab:first-child").click();
    expect(q(grid.el, ".db-grid-detail-content").textContent).toBe("bravo");
    grid.destroy();
    grid.el.remove();
  });

  test.each([
    [null, "NULL"],
    ["", "(empty string)"],
    [false, "false"],
    [0, "0"],
  ])("row details preserve %s as %s", async (value, expected) => {
    const { grid } = setup();
    grid.load(
      "sample_table",
      tableData({
        dbId: "sample.db",
        table: "sample_table",
        columns: COLUMNS,
        rows: [[1, 10, value]],
      }),
    );
    await tick();
    clickCell(grid.el, 0, 2);
    q<HTMLButtonElement>(grid.el, ".db-detail-tab:nth-child(2)").click();
    expect(
      q(grid.el, ".db-grid-row-detail tbody tr:last-child td:last-child")
        .textContent,
    ).toBe(expected);
    grid.destroy();
    grid.el.remove();
  });

  test("the first arrow press enters the grid at the first data cell", async () => {
    const { grid } = setup();
    await tick();
    expect(activePos(grid.el)).toBeNull();
    press(grid.el, "ArrowDown");
    await tick();
    expect(activePos(grid.el)).toEqual({ row: 0, col: 0 });
    grid.destroy();
  });

  for (const [key, expected] of [
    ["ArrowUp", { row: 0, col: 1 }],
    ["ArrowDown", { row: 2, col: 1 }],
    ["ArrowLeft", { row: 1, col: 0 }],
    ["ArrowRight", { row: 1, col: 2 }],
  ] as const) {
    test(`${key} moves one data cell from (1, 1)`, async () => {
      const { grid } = setup();
      await tick();
      clickCell(grid.el, 1, 1);
      await tick();
      expect(activePos(grid.el)).toEqual({ row: 1, col: 1 });
      press(grid.el, key);
      await tick();
      expect(activePos(grid.el)).toEqual(expected);
      grid.destroy();
    });
  }

  for (const [from, key] of [
    [{ row: 0, col: 0 }, "ArrowUp"],
    [{ row: 0, col: 0 }, "ArrowLeft"],
    [{ row: 3, col: 2 }, "ArrowDown"],
    [{ row: 3, col: 2 }, "ArrowRight"],
  ] as const) {
    test(`${key} at (${from.row}, ${from.col}) stops at the edge`, async () => {
      const { grid } = setup();
      await tick();
      clickCell(grid.el, from.row, from.col);
      await tick();
      press(grid.el, key);
      await tick();
      expect(activePos(grid.el)).toEqual({ row: from.row, col: from.col });
      grid.destroy();
    });
  }

  test("the detail footer follows the cell the arrow keys land on", async () => {
    const { grid } = setup();
    await tick();
    clickCell(grid.el, 0, 0);
    await tick();
    expect(q<HTMLElement>(grid.el, ".db-grid-detail-title").textContent).toBe(
      "id (INTEGER)",
    );
    press(grid.el, "ArrowRight");
    press(grid.el, "ArrowRight");
    press(grid.el, "ArrowDown");
    await tick();
    expect(activePos(grid.el)).toEqual({ row: 1, col: 2 });
    expect(q<HTMLElement>(grid.el, ".db-grid-detail-title").textContent).toBe(
      "label (TEXT)",
    );
    expect(q<HTMLElement>(grid.el, ".db-grid-detail-content").textContent).toBe(
      "bravo",
    );
    grid.destroy();
  });

  test.each([
    ["before the pinned gutter", 2, "ArrowLeft", 109, 109],
    ["at the pinned gutter", 2, "ArrowLeft", 110, 110],
    ["one pixel behind the gutter", 2, "ArrowLeft", 111, 110],
    ["partly behind the gutter", 2, "ArrowLeft", 140, 110],
    ["outside the left edge", 2, "ArrowLeft", 200, 110],
    ["back to the first column", 1, "ArrowLeft", 110, 0],
    ["outside the right edge", 0, "ArrowRight", 0, 70],
  ])("keeps the active cell visible: %s", async (_name, column, key, offset, expected) => {
    const { grid } = setup();
    try {
      await expect
        .poll(() => grid.el.querySelectorAll(".db-grid-row").length)
        .toBe(4);
      const viewport = q<HTMLElement>(grid.el, ".db-grid-viewport");
      Object.defineProperty(viewport, "clientWidth", { value: 200 });
      clickCell(grid.el, 0, column);
      viewport.scrollLeft = offset;
      press(grid.el, key);
      expect(viewport.scrollLeft).toBe(expected);
    } finally {
      grid.destroy();
    }
  });

  // Ctrl / Meta / Alt / Shift 付きの矢印はアプリ側のスクロール等に予約されて
  // いるので、グリッドは触らない。
  for (const modifier of [
    "ctrlKey",
    "metaKey",
    "altKey",
    "shiftKey",
  ] as const) {
    test(`${modifier} + ArrowDown does not move the cell`, async () => {
      const { grid } = setup();
      await tick();
      clickCell(grid.el, 1, 1);
      await tick();
      press(grid.el, "ArrowDown", { [modifier]: true });
      await tick();
      expect(activePos(grid.el)).toEqual({ row: 1, col: 1 });
      grid.destroy();
    });
  }

  test("arrow keys inside a cell input move the caret, not the cell", async () => {
    const { grid } = setup({ editable: true });
    await tick();
    await grid.setEditMode(true);
    await tick();
    clickCell(grid.el, 1, 2);
    await tick();
    const body = q<HTMLElement>(grid.el, ".db-grid-body");
    const cell = body.querySelectorAll<HTMLElement>(".db-grid-row")[1]
      .children[3] as HTMLElement;
    cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    await tick();
    const input = q<HTMLInputElement>(
      body.querySelectorAll<HTMLElement>(".db-grid-row")[1],
      ".db-grid-cell-input",
    );
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
    );
    await tick();
    // 入力モード中のセルには active クラスを付けない仕様なので、
    // 「どこかへ移動していれば、その別セルに付く」ことを使って判定する。
    expect(activePos(grid.el)).toBeNull();
    // Escape で入力モードを抜けると、現在地は動いていない (行 1 / 列 2)。
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    await tick();
    expect(activePos(grid.el)).toEqual({ row: 1, col: 2 });
    grid.destroy();
  });

  test("moving onto a foreign-key cell does not fetch the related table", async () => {
    const fk: DbForeignKey[] = [
      {
        fromTable: "sample_table",
        fromColumn: "owner_id",
        toTable: "sample_owners",
        toColumn: "id",
      },
    ];
    const { grid, relatedCalls } = setup({ fk });
    await tick();
    clickCell(grid.el, 0, 0);
    await tick();
    press(grid.el, "ArrowRight");
    await tick();
    expect(activePos(grid.el)).toEqual({ row: 0, col: 1 });
    expect(relatedCalls).toEqual([]);
    // 値そのものは詳細フッタに出る。
    expect(q<HTMLElement>(grid.el, ".db-grid-detail-title").textContent).toBe(
      "owner_id (INTEGER)",
    );
    // クリックなら従来どおり関連パネルを開く。
    clickCell(grid.el, 0, 1);
    await tick();
    expect(relatedCalls.map((c) => c.table)).toEqual(["sample_owners"]);
    grid.destroy();
  });

  test("sorting clears the cell cursor instead of leaving it on a moved row", async () => {
    const { grid } = setup();
    await tick();
    clickCell(grid.el, 1, 1);
    await tick();
    expect(activePos(grid.el)).toEqual({ row: 1, col: 1 });
    q<HTMLElement>(grid.el, ".db-grid-header-cell").dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
    await tick();
    expect(activePos(grid.el)).toBeNull();
    grid.destroy();
  });
});
