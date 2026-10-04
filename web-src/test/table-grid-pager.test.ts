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
const { rowHeightFor } = await import("../views/shell/row-height");

/** 行の高さは表示密度の値 (views/shell/row-height.ts)。各テストで密度を決める。 */
let ROW = rowHeightFor("regular");
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

  test.each(["compact", "regular", "large", "xlarge"] as const)(
    "shows the visible rows and moves one screen per button at the $0 density",
    async (density) => {
      document.body.dataset.sidebarFontSize = density;
      ROW = rowHeightFor(density);
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
      grid.destroy();
      grid.el.remove();
      delete document.body.dataset.sidebarFontSize;
    },
  );

  test("follows a density change after the table is drawn", async () => {
    document.body.dataset.sidebarFontSize = "regular";
    ROW = rowHeightFor("regular");
    const { grid, viewport, scrollTo } = setup(50, 10);
    await scrollTo(0);
    const spacer = q<HTMLElement>(grid.el, ".db-grid-spacer");
    expect(spacer.style.height).toBe(`${50 * rowHeightFor("regular")}px`);
    document.body.dataset.sidebarFontSize = "xlarge";
    await tick();
    expect(spacer.style.height).toBe(`${50 * rowHeightFor("xlarge")}px`);
    q<HTMLButtonElement>(grid.el, ".db-grid-pager-next").click();
    expect(viewport.scrollTop).toBe(10 * ROW - rowHeightFor("xlarge"));
    grid.destroy();
    grid.el.remove();
    delete document.body.dataset.sidebarFontSize;
  });

  test("hides the pager for an empty table", async () => {
    const { grid, scrollTo } = setup(0, 10);
    await scrollTo(0);
    expect(q<HTMLElement>(grid.el, ".db-grid-pager").hidden).toBe(true);
  });

  // 描いた行 (見える範囲の上下 20 行ずつ) が見える範囲を覆っている間は、スクロール
  // で行を作り直さない。毎フレーム作り直して、スマホでカクついた。
  test.each([
    { name: "within the drawn rows", to: 5, rebuilt: false, range: "6–15" },
    { name: "past the drawn rows", to: 40, rebuilt: true, range: "41–50" },
  ])("scrolling $name", async ({ to, rebuilt, range }) => {
    const { grid, pager, scrollTo } = setup(500, 10);
    await scrollTo(0);
    const first = grid.el.querySelector(".db-grid-row");
    await scrollTo(to * ROW);
    expect({
      rebuilt: grid.el.querySelector(".db-grid-row") !== first,
      range: pager().range,
    }).toEqual({ rebuilt, range: `${range} of 500 rows` });
    grid.destroy();
    grid.el.remove();
  });

  test("a reload in the same frame as a scroll still redraws the rows", async () => {
    const { grid, viewport, scrollTo } = setup(500, 10);
    await scrollTo(0);
    const first = grid.el.querySelector(".db-grid-row");
    grid.load(
      "sample_table",
      tableData({
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
        rows: [[1000]],
      }),
    );
    viewport.scrollTop = 0;
    viewport.dispatchEvent(new Event("scroll"));
    await tick();
    expect(grid.el.querySelector(".db-grid-row") !== first).toBe(true);
    grid.destroy();
    grid.el.remove();
  });
});
