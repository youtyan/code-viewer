// ヘッダ行 / 列フィルタ行 / 本文の横位置が揃い続けることを検証する。
// 実機で確認した崩れ方は 2 つ:
//   1. 本文だけが縦スクロールバーぶん狭く、右端で列がスクロールバー幅ずれる
//      (幅の一致は CSS + 実測値 --db-grid-scrollbar-w が担当。ここでは実測値を
//       上書きしない ＝ 測れないときに壊さないことだけ見る)
//   2. 列フィルタ入力へフォーカスが入ると、overflow:hidden のラップをブラウザが
//      勝手に横スクロールさせ、フィルタ行だけが取り残される
// 文字列ではなく scrollLeft の同期という振る舞いで見る。

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

  test("scrolling the body carries the header and the filter row along", async () => {
    const { grid, viewport, headerWrap, filterWrap } = setup();
    await tick();
    viewport.scrollLeft = 120;
    viewport.dispatchEvent(new Event("scroll"));
    expect(headerWrap.scrollLeft).toBe(120);
    expect(filterWrap.scrollLeft).toBe(120);
    grid.destroy();
  });

  // 列フィルタ入力へのフォーカスでラップだけがスクロールしたときは、
  // 「グリッド全体をその列まで動かす」のが正しい (フィルタ行だけ置き去りに
  // しない)。ヘッダ側も同じ経路を通る。
  for (const wrapSelector of [
    ".db-grid-filter-row-wrap",
    ".db-grid-header-wrap",
  ]) {
    test(`a scroll started on ${wrapSelector} moves the whole grid`, async () => {
      const { grid, viewport, headerWrap, filterWrap } = setup();
      await tick();
      const wrap = q<HTMLElement>(grid.el, wrapSelector);
      wrap.scrollLeft = 90;
      wrap.dispatchEvent(new Event("scroll"));
      expect(viewport.scrollLeft).toBe(90);
      expect(headerWrap.scrollLeft).toBe(90);
      expect(filterWrap.scrollLeft).toBe(90);
      grid.destroy();
    });
  }

  test("a redraw re-asserts the header position instead of leaving it behind", async () => {
    const { grid, viewport, headerWrap, filterWrap } = setup();
    await tick();
    viewport.scrollLeft = 150;
    viewport.dispatchEvent(new Event("scroll"));
    await tick();
    // 幅が変わったときにブラウザがラップ側だけ clamp する状況を模す。
    headerWrap.scrollLeft = 0;
    filterWrap.scrollLeft = 0;
    await grid.refresh();
    await tick();
    expect(headerWrap.scrollLeft).toBe(150);
    expect(filterWrap.scrollLeft).toBe(150);
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

  test("the measured scrollbar width is not clobbered when it cannot be measured", async () => {
    const { grid } = setup();
    await tick();
    // happy-dom では offsetWidth が 0 なので実測できない。非表示のタブでも
    // 同じ状態になるため、そのときは前回の実測値を残す (0px で上書きしない)。
    grid.el.style.setProperty("--db-grid-scrollbar-w", "10px");
    grid.load("sample_table", initialData());
    await tick();
    expect(grid.el.style.getPropertyValue("--db-grid-scrollbar-w")).toBe(
      "10px",
    );
    grid.destroy();
  });
});
