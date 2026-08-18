// 関連パネル (FK ドリルダウン) のキーボード操作と、左リストの読めなさ対策を
// happy-dom 上の実描画で検証する。
//   - Enter で FK を辿る / Escape で閉じる / Tab でメイン⇄埋め込みグリッド
//   - 矢印キーの移動だけでは参照先を取得しない (1 打ごとにクエリを飛ばさない)
//   - リスト項目はテーブル名と条件を 1 行ずつに保ち、全文は tooltip で出す
//   - リスト幅はドラッグで変えられ、クランプして localStorage に残る

import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, afterEach, describe, expect, test } from "vitest";
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

const tick = () => new Promise((r) => setTimeout(r, 20));
const LIST_WIDTH_KEY = "code-viewer:db-related-list-width";

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

// 長いテーブル名 / 長い条件文が「語の途中で折り返る」のが直したい症状なので、
// フィクスチャ側も実際に長い名前にしておく。
const FK: DbForeignKey[] = [
  {
    fromTable: "sample_table",
    fromColumn: "owner_id",
    toTable: "sample_long_named_owner_table",
    toColumn: "id",
  },
];

function initialData(): DbTableDataResponse {
  return tableData({
    dbId: "sample.db",
    table: "sample_table",
    columns: COLUMNS,
    rows: [
      [1, 10, "alpha"],
      [2, 11, "bravo"],
    ],
  });
}

function relatedData(): DbTableDataResponse {
  return tableData({
    dbId: "sample.db",
    table: "sample_long_named_owner_table",
    columns: [COLUMNS[0], COLUMNS[2]],
    rows: [[10, "owner row"]],
  });
}

function setup() {
  const relatedTables: string[] = [];
  const grid = createTableGrid({
    fetchPage: async () => initialData(),
    getDbId: () => "sample.db",
    getColumnWidths: () => ({}),
    setColumnWidths: () => undefined,
    getText: () => dbText("en"),
    getForeignKeys: () => FK,
    fetchRelatedPage: async (table) => {
      relatedTables.push(table);
      return relatedData();
    },
  });
  document.body.appendChild(grid.el);
  grid.load("sample_table", initialData());
  const viewport = q<HTMLElement>(grid.el, ".db-grid-viewport");
  return { grid, viewport, relatedTables };
}

function press(el: HTMLElement, key: string, init: KeyboardEventInit = {}) {
  el.dispatchEvent(
    new KeyboardEvent("keydown", { key, bubbles: true, ...init }),
  );
}

/** 先頭行の指定データ列をクリックして現在地を作る。 */
function clickCell(root: HTMLElement, col: number) {
  const rows = q<HTMLElement>(
    root,
    ".db-grid-body",
  ).querySelectorAll<HTMLElement>(".db-grid-row");
  (rows[0].children[col + 1] as HTMLElement).dispatchEvent(
    new MouseEvent("click", { bubbles: true }),
  );
}

describe("table-grid related panel", () => {
  afterEach(() => {
    window.localStorage.removeItem(LIST_WIDTH_KEY);
  });

  afterAll(() => {
    GlobalRegistrator.unregister();
  });

  test("Enter follows a foreign key, arrow keys alone do not", async () => {
    const { grid, viewport, relatedTables } = setup();
    await tick();
    // 先頭列から矢印で FK 列 (owner_id) へ移動しても取得は起きない。
    press(viewport, "ArrowDown");
    press(viewport, "ArrowRight");
    await tick();
    expect(relatedTables).toEqual([]);
    expect(q<HTMLElement>(grid.el, ".db-grid-detail-title").textContent).toBe(
      "owner_id (INTEGER)",
    );
    // Enter で初めて参照先を開く。
    press(viewport, "Enter");
    await tick();
    expect(relatedTables).toEqual(["sample_long_named_owner_table"]);
    expect(q<HTMLElement>(grid.el, ".db-related-panel").hidden).toBe(false);
    grid.destroy();
  });

  for (const [label, open] of [
    ["detail footer", ".db-grid-detail-panel"],
    ["related panel", ".db-related-panel"],
  ] as const) {
    test(`Escape closes the ${label} and clears the cell cursor`, async () => {
      const { grid, viewport } = setup();
      await tick();
      // 非 FK 列 = 詳細フッタ、FK 列 = 関連パネル。
      clickCell(grid.el, open === ".db-related-panel" ? 1 : 2);
      await tick();
      expect(q<HTMLElement>(grid.el, open).hidden).toBe(false);
      press(viewport, "Escape");
      await tick();
      expect(q<HTMLElement>(grid.el, open).hidden).toBe(true);
      expect(grid.el.querySelector(".db-grid-cell-active")).toBeNull();
      grid.destroy();
    });
  }

  test("Tab moves into the related grid and Shift+Tab comes back", async () => {
    const { grid, viewport } = setup();
    await tick();
    clickCell(grid.el, 1); // FK 列 → 関連パネルが開く
    await tick();
    const embeddedViewport = q<HTMLElement>(
      grid.el,
      ".db-related-grid-host .db-grid-viewport",
    );
    press(viewport, "Tab");
    expect(document.activeElement).toBe(embeddedViewport);
    press(embeddedViewport, "Tab", { shiftKey: true });
    expect(document.activeElement).toBe(viewport);
    grid.destroy();
  });

  test("related list entries keep one line each and carry the full text as a tooltip", async () => {
    const { grid } = setup();
    await tick();
    clickCell(grid.el, 1);
    await tick();
    const item = q<HTMLElement>(grid.el, ".db-related-list-item");
    const table = q<HTMLElement>(item, ".db-related-list-table");
    const via = q<HTMLElement>(item, ".db-related-list-via");
    expect(table.textContent).toBe("sample_long_named_owner_table");
    // 省略表示になっても読めるよう、全文は tooltip に入れる。
    expect(table.title).toBe("sample_long_named_owner_table");
    expect(via.textContent).toBe("owner_id = 10");
    expect(via.title).toBe("owner_id = 10");
    grid.destroy();
  });

  test("the related list width is clamped and persisted", async () => {
    const { grid } = setup();
    await tick();
    clickCell(grid.el, 1);
    await tick();
    const handle = q<HTMLElement>(grid.el, ".db-related-list-resize");
    const width = () => grid.el.style.getPropertyValue("--db-related-list-w");
    expect(width()).toBe("200px");
    press(handle, "ArrowRight");
    expect(width()).toBe("216px");
    expect(window.localStorage.getItem(LIST_WIDTH_KEY)).toBe("216");
    // 下限 / 上限の外へは出さない。
    for (let i = 0; i < 40; i++) press(handle, "ArrowLeft");
    expect(width()).toBe("120px");
    for (let i = 0; i < 60; i++) press(handle, "ArrowRight");
    expect(width()).toBe("480px");
    expect(window.localStorage.getItem(LIST_WIDTH_KEY)).toBe("480");
    grid.destroy();
  });

  test("a stored width is restored on the next grid", async () => {
    window.localStorage.setItem(LIST_WIDTH_KEY, "333");
    const { grid } = setup();
    await tick();
    clickCell(grid.el, 1);
    await tick();
    expect(grid.el.style.getPropertyValue("--db-related-list-w")).toBe("333px");
    grid.destroy();
  });
});
