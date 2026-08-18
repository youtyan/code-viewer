// 詳細フッタの JSON 表示を検証する。ハイライトは shiki の lazy bundle 頼みで、
// happy-dom では読み込めない = ハイライタが null になる。その状態でも中身が
// 欠けないこと (色が付かないだけ) が、ここで守りたい契約。

import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, describe, expect, test } from "vitest";
import { tableData } from "./_table-grid-fixture";
import { q } from "./_test-helpers";

GlobalRegistrator.register();

const { createTableGrid } = await import("../views/database/table-grid");
const { dbText } = await import("../views/database/i18n");

import type { DbColumn, DbTableDataResponse } from "../core/database/types";

const tick = () => new Promise((r) => setTimeout(r, 20));

const COLUMNS: DbColumn[] = [
  {
    name: "payload",
    type: "TEXT",
    nullable: true,
    primaryKey: false,
    defaultValue: null,
  },
];

const OBJECT_JSON = '{"id":1,"name":"example","nested":{"level":2}}';
const ARRAY_JSON = '[{"id":1},{"id":2}]';

function initialData(rows: string[][]): DbTableDataResponse {
  return tableData({
    dbId: "sample.db",
    table: "sample_table",
    columns: COLUMNS,
    rows,
  });
}

function setup(rows: string[][]) {
  const grid = createTableGrid({
    fetchPage: async () => initialData(rows),
    getDbId: () => "sample.db",
    getColumnWidths: () => ({}),
    setColumnWidths: () => undefined,
    getText: () => dbText("en"),
  });
  document.body.appendChild(grid.el);
  grid.load("sample_table", initialData(rows));
  return grid;
}

function clickFirstCell(root: HTMLElement, rowIndex = 0) {
  const rows = q<HTMLElement>(
    root,
    ".db-grid-body",
  ).querySelectorAll<HTMLElement>(".db-grid-row");
  (rows[rowIndex].children[1] as HTMLElement).dispatchEvent(
    new MouseEvent("click", { bubbles: true }),
  );
}

describe("table-grid detail footer JSON", () => {
  afterAll(() => {
    GlobalRegistrator.unregister();
  });

  for (const [label, raw, expected] of [
    ["object", OBJECT_JSON, JSON.stringify(JSON.parse(OBJECT_JSON), null, 2)],
    ["array", ARRAY_JSON, JSON.stringify(JSON.parse(ARRAY_JSON), null, 2)],
  ] as const) {
    test(`a JSON ${label} is pretty-printed and keeps every character without a highlighter`, async () => {
      const grid = setup([[raw]]);
      await tick();
      clickFirstCell(grid.el);
      await tick();
      const pre = q<HTMLElement>(grid.el, ".db-grid-detail-json");
      expect(pre.textContent).toBe(expected);
      grid.destroy();
    });
  }

  test("text that only looks like JSON stays plain text", async () => {
    const grid = setup([["{not json at all"]]);
    await tick();
    clickFirstCell(grid.el);
    await tick();
    expect(grid.el.querySelector(".db-grid-detail-json")).toBeNull();
    expect(q<HTMLElement>(grid.el, ".db-grid-detail-content").textContent).toBe(
      "{not json at all",
    );
    grid.destroy();
  });

  test("moving off a JSON cell drops the JSON block", async () => {
    const grid = setup([[OBJECT_JSON], ["plain text"]]);
    await tick();
    clickFirstCell(grid.el, 0);
    await tick();
    expect(grid.el.querySelector(".db-grid-detail-json")).not.toBeNull();
    // 矢印キーで次の行 (非 JSON) へ移ると、JSON ブロックは残らない。
    q<HTMLElement>(
      grid.el,
      ".db-grid-grid-viewport, .db-grid-viewport",
    ).dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );
    await tick();
    expect(grid.el.querySelector(".db-grid-detail-json")).toBeNull();
    expect(q<HTMLElement>(grid.el, ".db-grid-detail-content").textContent).toBe(
      "plain text",
    );
    grid.destroy();
  });
});
