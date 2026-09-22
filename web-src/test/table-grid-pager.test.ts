// datastore の Data グリッドの足元のページ送り。表は仮想表示で全部の行を
// スクロールで読むので、ページ送りは「いま見えている行の範囲」の表示と、
// 1 画面ぶんのスクロールだけ。happy-dom は寸法を持たないので、表の高さと
// スクロール量を与えて、範囲の文字とボタンの押せる・押せないで見る。

import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, describe, expect, test } from "vitest";
import { tableData } from "./_table-grid-fixture";
import { q } from "./_test-helpers";

GlobalRegistrator.register();

const { createTableGrid } = await import("../views/database/table-grid");
const { dbText } = await import("../views/database/i18n");

/** table-grid.ts の ROW_HEIGHT (行の高さの出所) と同じ値。 */
const ROW = 28;
const tick = () => new Promise((r) => setTimeout(r, 20));

function setup(rowCount: number, visibleRows: number) {
  const data = tableData({
    dbId: "sample.db",
    table: "sample_table",
    columns: [
      {
        name: "id",
        type: "INTEGER",
        nullable: false,
        primaryKey: true,
        defaultValue: null,
      },
    ],
    rows: Array.from({ length: rowCount }, (_, index) => [index + 1]),
  });
  const grid = createTableGrid({
    fetchPage: async () => data,
    getDbId: () => "sample.db",
    getColumnWidths: () => ({}),
    setColumnWidths: () => undefined,
    getText: () => dbText("en"),
    getForeignKeys: () => [],
    getEditable: () => false,
    applyMutations: async () => undefined,
    fetchRelatedPage: async () => data,
  });
  document.body.appendChild(grid.el);
  const viewport = q<HTMLElement>(grid.el, ".db-grid-viewport");
  Object.defineProperty(viewport, "clientHeight", {
    configurable: true,
    value: visibleRows * ROW,
  });
  grid.load("sample_table", data);
  const pager = () => ({
    range: q(grid.el, ".db-grid-pager-range").textContent,
    prev: q<HTMLButtonElement>(grid.el, ".db-grid-pager-prev").disabled,
    next: q<HTMLButtonElement>(grid.el, ".db-grid-pager-next").disabled,
  });
  const scrollTo = async (top: number) => {
    viewport.scrollTop = top;
    viewport.dispatchEvent(new Event("scroll"));
    await tick();
  };
  return { grid, viewport, pager, scrollTo };
}

describe("table-grid pager", () => {
  afterAll(() => {
    GlobalRegistrator.unregister();
  });

  test("shows the visible rows and moves one screen per button", async () => {
    const { grid, viewport, pager, scrollTo } = setup(50, 10);
    await scrollTo(0);
    expect(pager()).toEqual({
      range: "1–10 of 50 rows",
      prev: true,
      next: false,
    });
    q<HTMLButtonElement>(grid.el, ".db-grid-pager-next").click();
    // 1 画面から 1 行引いた分 (最後に見えていた行が次の画面の先頭に残る)。
    expect(viewport.scrollTop).toBe(9 * ROW);
    await scrollTo(viewport.scrollTop);
    expect(pager()).toEqual({
      range: "10–19 of 50 rows",
      prev: false,
      next: false,
    });
    await scrollTo(40 * ROW);
    expect(pager()).toEqual({
      range: "41–50 of 50 rows",
      prev: false,
      next: true,
    });
  });

  test("hides the pager for an empty table", async () => {
    const { grid, scrollTo } = setup(0, 10);
    await scrollTo(0);
    expect(q<HTMLElement>(grid.el, ".db-grid-pager").hidden).toBe(true);
  });
});
