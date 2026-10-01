// Data の表で範囲を選んでコピーする操作 (views/database/grid-range-select.ts)。
// happy-dom の実描画で、範囲の色が付いたセルと、クリップボードに入った文字
// (Excel に貼るタブ区切り) を見る。

import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, afterEach, describe, expect, test, vi } from "vitest";
import { tableData } from "./_table-grid-fixture";
import { q } from "./_test-helpers";

GlobalRegistrator.register();

const { createTableGrid } = await import("../views/database/table-grid");
const { dbText } = await import("../views/database/i18n");

import type { DbColumn, DbValue } from "../core/database/types";

const tick = () => new Promise((r) => setTimeout(r, 20));

function column(name: string, type: string, primaryKey = false): DbColumn {
  return { name, type, nullable: true, primaryKey, defaultValue: null };
}

const COLUMNS = [
  column("id", "INTEGER", true),
  column("label", "TEXT"),
  column("note", "TEXT"),
];
const ROWS: DbValue[][] = [
  [1, "alpha", "plain"],
  [2, "bravo", null],
  [3, "charlie", 'say "hi"\tnow'],
  [4, "delta", "two\nlines"],
];

function setup(rows: DbValue[][] = ROWS) {
  const fetched: number[] = [];
  const grid = createTableGrid({
    fetchPage: async (_table, offset, limit) => {
      fetched.push(offset);
      return {
        ...tableData({
          dbId: "sample.db",
          table: "sample_table",
          columns: COLUMNS,
          rows: rows.slice(offset, offset + limit),
        }),
        totalRows: rows.length,
        offset,
      };
    },
    getDbId: () => "sample.db",
    getColumnWidths: () => ({}),
    setColumnWidths: () => undefined,
    getText: () => dbText("en"),
    getForeignKeys: () => [],
    getEditable: () => false,
  });
  document.body.appendChild(grid.el);
  const viewport = q<HTMLElement>(grid.el, ".db-grid-viewport");
  Object.defineProperty(viewport, "clientHeight", {
    configurable: true,
    value: 400,
  });
  const written: string[] = [];
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: async (value: string) => {
        written.push(value);
      },
    },
  });
  const rowEl = (row: number) =>
    grid.el.querySelectorAll<HTMLElement>(".db-grid-body .db-grid-row")[row];
  // 列: # | id | label | note (この表に時刻の列は無いので「変更」の列は無い)
  const cellEl = (row: number, col: number) =>
    rowEl(row).children[col + 1] as HTMLElement;
  const mouse = (target: HTMLElement, type: string, init: MouseEventInit) =>
    target.dispatchEvent(
      new MouseEvent(type, { bubbles: true, button: 0, ...init }),
    );
  const drag = (from: HTMLElement, to: HTMLElement) => {
    mouse(from, "mousedown", { buttons: 1 });
    mouse(to, "mousemove", { buttons: 1 });
    mouse(to, "mouseup", { buttons: 0 });
  };
  const key = (name: string, init: KeyboardEventInit = {}) =>
    viewport.dispatchEvent(
      new KeyboardEvent("keydown", { key: name, bubbles: true, ...init }),
    );
  const inRange = () =>
    [...grid.el.querySelectorAll<HTMLElement>(".db-grid-cell.in-range")].map(
      (cell) => cell.textContent,
    );
  const status = () => q(grid.el, ".db-grid-status").textContent ?? "";
  const done = () => {
    grid.destroy();
    grid.el.remove();
  };
  return {
    grid,
    fetched,
    written,
    cellEl,
    rowEl,
    mouse,
    drag,
    key,
    inRange,
    status,
    done,
  };
}

async function loaded(rows: DbValue[][] = ROWS) {
  const t = setup(rows);
  t.grid.load(
    "sample_table",
    {
      ...tableData({
        dbId: "sample.db",
        table: "sample_table",
        columns: COLUMNS,
        rows: rows.slice(0, 200),
      }),
      totalRows: rows.length,
    },
    null,
  );
  await tick();
  return t;
}

afterEach(() => {
  vi.restoreAllMocks();
});
afterAll(() => {
  GlobalRegistrator.unregister();
});

describe("selecting a range", () => {
  test("dragging across cells colors the rectangle", async () => {
    const t = await loaded();
    t.drag(t.cellEl(0, 1), t.cellEl(1, 2));
    expect(t.inRange()).toEqual(["alpha", "plain", "bravo", "NULL"]);
    t.done();
  });

  test("Shift+click extends from the first cell", async () => {
    const t = await loaded();
    t.mouse(t.cellEl(0, 0), "mousedown", { buttons: 1 });
    t.mouse(t.cellEl(0, 0), "mouseup", {});
    t.mouse(t.cellEl(2, 1), "mousedown", { buttons: 1, shiftKey: true });
    t.mouse(t.cellEl(2, 1), "mouseup", { shiftKey: true });
    expect(t.inRange()).toEqual(["1", "alpha", "2", "bravo", "3", "charlie"]);
    t.done();
  });

  test("Shift+arrow keys extend and Escape goes back to one cell", async () => {
    const t = await loaded();
    t.drag(t.cellEl(1, 0), t.cellEl(1, 0));
    t.key("ArrowRight", { shiftKey: true });
    t.key("ArrowDown", { shiftKey: true });
    expect(t.inRange()).toEqual(["2", "bravo", "3", "charlie"]);
    t.key("Escape");
    expect(t.inRange()).toEqual([]);
    t.done();
  });

  test("a plain arrow key leaves the range", async () => {
    const t = await loaded();
    t.drag(t.cellEl(0, 0), t.cellEl(1, 1));
    t.key("ArrowDown");
    expect(t.inRange()).toEqual([]);
    t.done();
  });

  test("the row number selects the whole rows", async () => {
    const t = await loaded();
    const rowNumber = (row: number) => t.rowEl(row).children[0] as HTMLElement;
    t.drag(rowNumber(1), rowNumber(2));
    expect(t.inRange()).toEqual([
      "2",
      "bravo",
      "NULL",
      "3",
      "charlie",
      'say "hi"\tnow',
    ]);
    t.done();
  });
});

describe("copying", () => {
  test("copies the range as tab separated text that Excel reads", async () => {
    const t = await loaded();
    t.drag(t.cellEl(1, 1), t.cellEl(3, 2));
    t.key("c", { metaKey: true });
    await tick();
    expect(t.written).toEqual([
      'bravo\t\ncharlie\t"say ""hi""\tnow"\ndelta\t"two\nlines"',
    ]);
    expect(t.status()).toContain(
      "Copied 3 × 2 cells (add Shift for column names)",
    );
    t.done();
  });

  test("Shift adds the column names as the first row", async () => {
    const t = await loaded();
    t.drag(t.cellEl(0, 0), t.cellEl(1, 1));
    t.key("C", { ctrlKey: true, shiftKey: true });
    await tick();
    expect(t.written).toEqual(["id\tlabel\n1\talpha\n2\tbravo"]);
    t.done();
  });

  test("one cell copies its value as is", async () => {
    const t = await loaded();
    t.drag(t.cellEl(3, 2), t.cellEl(3, 2));
    t.key("c", { metaKey: true });
    await tick();
    expect(t.written).toEqual(["two\nlines"]);
    t.done();
  });

  test("select all copies rows that were not loaded yet", async () => {
    const many: DbValue[][] = Array.from({ length: 450 }, (_, i) => [
      i + 1,
      `row ${i + 1}`,
      null,
    ]);
    const t = await loaded(many);
    t.drag(t.cellEl(0, 0), t.cellEl(0, 0));
    t.key("a", { metaKey: true });
    t.key("c", { metaKey: true });
    await tick();
    await tick();
    const lines = t.written[0]?.split("\n") ?? [];
    expect([lines.length, lines[0], lines[449]]).toEqual([
      450,
      "1\trow 1\t",
      "450\trow 450\t",
    ]);
    expect(t.fetched).toEqual([200, 400]);
    t.done();
  });

  test("a clipboard failure stays on the status line with the reason", async () => {
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const t = await loaded();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async () => {
          throw new Error("Document is not focused.");
        },
      },
    });
    t.drag(t.cellEl(0, 0), t.cellEl(1, 1));
    t.key("c", { metaKey: true });
    await tick();
    expect(t.status()).toContain(
      "Copy failed: Error: Document is not focused.",
    );
    expect(error).toHaveBeenCalledWith(
      "[code-viewer] SQL copy cells failed",
      "sample_table",
      { top: 0, bottom: 1, left: 0, right: 1 },
      expect.any(Error),
    );
    t.done();
  });
});
