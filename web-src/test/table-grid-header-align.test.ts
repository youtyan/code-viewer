// ヘッダ行 / 列フィルタ行 / 本文の横位置が揃い続けることを検証する。
// 揃えるのはブラウザ (3 つを同じスクロールの箱に入れる) で、ここでは箱の
// 組み方と、本文に焼く幅が列の合計であることを見る。

import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, describe, expect, test } from "vitest";
import { tableData } from "./_table-grid-fixture";
import { q } from "./_test-helpers";

GlobalRegistrator.register();

const { createTableGrid } = await import("../views/database/table-grid");
const { dbText } = await import("../views/database/i18n");

import type { DbColumn, DbTableDataResponse } from "../core/database/types";

const tick = () => new Promise((r) => setTimeout(r, 20));

// happy-dom はレイアウトを持たないので、幅の測定だけ差し替える。
function fakeRect(width: number): DOMRect {
  return {
    x: 0,
    y: 0,
    width,
    height: 0,
    top: 0,
    right: width,
    bottom: 0,
    left: 0,
    toJSON: () => ({}),
  };
}

const COLUMNS: DbColumn[] = [
  {
    name: "id",
    type: "INTEGER",
    nullable: false,
    primaryKey: true,
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

function initialData(): DbTableDataResponse {
  return tableData({
    dbId: "sample.db",
    table: "sample_table",
    columns: COLUMNS,
    rows: [
      [1, "alpha"],
      [2, "bravo"],
    ],
  });
}

function setup() {
  const grid = createTableGrid({
    fetchPage: async () => initialData(),
    getDbId: () => "sample.db",
    getColumnWidths: () => ({}),
    setColumnWidths: () => undefined,
    getText: () => dbText("en"),
  });
  document.body.appendChild(grid.el);
  grid.load("sample_table", initialData());
  const viewport = q<HTMLElement>(grid.el, ".db-grid-viewport");
  const headerWrap = q<HTMLElement>(grid.el, ".db-grid-header-wrap");
  const filterWrap = q<HTMLElement>(grid.el, ".db-grid-filter-row-wrap");
  return { grid, viewport, headerWrap, filterWrap };
}

describe("table-grid horizontal alignment", () => {
  afterAll(() => {
    GlobalRegistrator.unregister();
  });

  // 列の見出しと絞り込みの行は、本文と同じスクロールの箱の中の頭 (上に貼り付け)
  // にあり、横にはブラウザが本文と一緒に動かす。別の箱にして本文の scroll の
  // たびに JS で scrollLeft を合わせていた頃は、iPhone の Safari で横に送ると
  // 見出しが遅れて引っかかり、遅かった。行は頭の下の箱にある。
  test("the header and the filter row live in the body's scroll box, above the rows", () => {
    const { grid, viewport, headerWrap, filterWrap } = setup();
    const head = q<HTMLElement>(grid.el, ".db-grid-head");
    expect({
      headParent: head.parentElement === viewport,
      inHead: [headerWrap.parentElement, filterWrap.parentElement].every(
        (parent) => parent === head,
      ),
      order: [...viewport.children].map((child) => child.className),
      rowsHoldBody: q<HTMLElement>(grid.el, ".db-grid-body").parentElement
        ?.className,
    }).toEqual({
      headParent: true,
      inHead: true,
      order: ["db-grid-head", "db-grid-rows", "db-pane-empty"],
      rowsHoldBody: "db-grid-rows",
    });
    grid.destroy();
  });

  // 実機で出た崩れ: 枠が列より広い状態で焼かれた min-width が、枠を狭めても
  // 縮まず、本文だけヘッダより余分に横スクロールできる (実測で 333px ずれた)。
  // 焼く値は「列の合計」であって「枠の幅」ではない。
  test("the baked content width comes from the columns, not from a wider container", async () => {
    const { grid } = setup();
    // renderHeader は load() の中で同期的に走り、幅の確定は次の rAF。
    // その前に、列の実寸と「枠まで膨らんだ行の幅」を用意する。
    const headerRow = q<HTMLElement>(grid.el, ".db-grid-header");
    const cellWidths = [50, 100, 100]; // 行番号セル + 2 列
    const cells = Array.from(headerRow.children) as HTMLElement[];
    expect(cells).toHaveLength(cellWidths.length);
    cells.forEach((cell, i) => {
      cell.getBoundingClientRect = () => fakeRect(cellWidths[i]);
    });
    Object.defineProperty(headerRow, "scrollWidth", {
      value: 800,
      configurable: true,
    });
    await tick();
    for (const selector of [
      ".db-grid-body",
      ".db-grid-filter-row",
      ".db-grid-spacer",
    ]) {
      expect(q<HTMLElement>(grid.el, selector).style.minWidth).toBe("250px");
    }
    grid.destroy();
  });
});
