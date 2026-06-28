// 編集モードの「実描画」挙動を happy-dom 上で検証する。インラインセル編集 /
// 新規行 / 削除マーク → コミットで、正しい RowMutation[] が applyMutations に
// 渡されることを確認する (文字列存在ではなく挙動の検証)。
import { afterAll, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register();

const { createTableGrid } = await import("../views/database/table-grid");
const { dbText } = await import("../views/database/i18n");

import type {
  DbColumn,
  DbTableDataResponse,
  RowMutation,
} from "../core/database/types";

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
    name: "name",
    type: "TEXT",
    nullable: true,
    primaryKey: false,
    defaultValue: null,
  },
];

function initialData(): DbTableDataResponse {
  return {
    dbId: "app.db",
    table: "users",
    columns: COLUMNS,
    rows: [
      [1, "Alice"],
      [2, "Bob"],
    ],
    totalRows: 2,
    offset: 0,
    limit: 200,
    hasMore: false,
  };
}

function setup() {
  let captured: RowMutation[] | null = null;
  const grid = createTableGrid({
    fetchPage: async () => initialData(),
    getDbId: () => "app.db",
    getColumnWidths: () => ({}),
    setColumnWidths: () => {},
    getText: () => dbText("en"),
    getEditable: () => true,
    applyMutations: async (mutations) => {
      captured = mutations;
    },
  });
  document.body.appendChild(grid.el);
  grid.load("users", initialData());
  return { grid, getCaptured: () => captured };
}

function q<T extends Element>(root: ParentNode, sel: string): T {
  const el = root.querySelector<T>(sel);
  if (!el) throw new Error(`missing element: ${sel}`);
  return el;
}

function setInput(input: HTMLInputElement, value: string) {
  input.value = value;
  input.dispatchEvent(new Event("input"));
}

describe("table-grid edit mode", () => {
  afterAll(() => {
    GlobalRegistrator.unregister();
  });

  test("edit toggle is shown only when editable", () => {
    const { grid } = setup();
    const wrap = q<HTMLElement>(grid.el, ".db-grid-edit-controls");
    expect(wrap.hidden).toBe(false);
    grid.destroy();
  });

  test("inline edit + new row + delete commit the right mutations", async () => {
    const { grid, getCaptured } = setup();
    await tick();

    // 編集モードに入る
    q<HTMLButtonElement>(grid.el, ".db-grid-edit-toggle").click();
    await tick();

    const body = q<HTMLElement>(grid.el, ".db-grid-body");
    const rows = body.querySelectorAll<HTMLElement>(".db-grid-row");
    // 2 データ行が描画されている
    expect(rows.length >= 2).toBeTruthy();

    // 行0 (id=1) の name セルを編集する。inputs[0]=id(readonly), inputs[1]=name
    const row0Inputs = rows[0].querySelectorAll<HTMLInputElement>(
      ".db-grid-cell-input",
    );
    expect(row0Inputs[0].readOnly).toBe(true); // PK は readonly
    setInput(row0Inputs[1], "Alicia");

    // 行1 (id=2) を削除マーク
    q<HTMLElement>(rows[1], ".db-grid-rownum-deletable").click();

    // 新規行を追加して name を入力
    q<HTMLButtonElement>(grid.el, ".db-grid-edit-newrow").click();
    await tick();
    const draftRow = q<HTMLElement>(grid.el, ".db-grid-row-draft");
    const draftInputs = draftRow.querySelectorAll<HTMLInputElement>(
      ".db-grid-cell-input",
    );
    setInput(draftInputs[1], "Carol");

    // コミット
    q<HTMLButtonElement>(grid.el, ".db-grid-edit-commit").click();
    await tick();

    const captured = getCaptured();
    expect(captured !== null).toBeTruthy();
    const muts = captured as RowMutation[];
    expect(muts.length).toBe(3);

    const del = muts.filter((m) => m.kind === "delete");
    expect(del.length).toBe(1);
    if (del[0].kind === "delete") {
      expect(del[0].pk).toEqual([{ column: "id", value: "2" }]);
    }

    const upd = muts.filter((m) => m.kind === "update");
    expect(upd.length).toBe(1);
    if (upd[0].kind === "update") {
      expect(upd[0].pk).toEqual([{ column: "id", value: "1" }]);
      expect(upd[0].values).toEqual([{ column: "name", value: "Alicia" }]);
    }

    const ins = muts.filter((m) => m.kind === "insert");
    expect(ins.length).toBe(1);
    if (ins[0].kind === "insert") {
      expect(ins[0].values).toEqual([{ column: "name", value: "Carol" }]);
    }
    grid.destroy();
  });

  test("the NULL button sets a nullable cell to SQL NULL (value: null)", async () => {
    const { grid, getCaptured } = setup();
    await tick();
    q<HTMLButtonElement>(grid.el, ".db-grid-edit-toggle").click();
    await tick();
    const rows = q<HTMLElement>(
      grid.el,
      ".db-grid-body",
    ).querySelectorAll<HTMLElement>(".db-grid-row");
    // 行0 の name セル (nullable) には NULL ボタンが出る。
    const nullBtn = rows[0].querySelector<HTMLButtonElement>(
      ".db-grid-cell-null-btn",
    );
    expect(nullBtn !== null).toBeTruthy();
    nullBtn?.click();
    await tick();
    q<HTMLButtonElement>(grid.el, ".db-grid-edit-commit").click();
    await tick();
    const muts = getCaptured() as RowMutation[];
    expect(muts.length).toBe(1);
    if (muts[0].kind === "update") {
      expect(muts[0].pk).toEqual([{ column: "id", value: "1" }]);
      expect(muts[0].values).toEqual([{ column: "name", value: null }]);
    }
    grid.destroy();
  });

  test("a PK (non-nullable) cell has no NULL button", async () => {
    const { grid } = setup();
    await tick();
    q<HTMLButtonElement>(grid.el, ".db-grid-edit-toggle").click();
    await tick();
    const rows = q<HTMLElement>(
      grid.el,
      ".db-grid-body",
    ).querySelectorAll<HTMLElement>(".db-grid-row");
    // id 列セルは readonly(PK)なので NULL ボタンは無い。name 列(nullable)には有る。
    const cells = rows[0].querySelectorAll<HTMLElement>(".db-grid-cell-edit");
    expect(cells[0].querySelector(".db-grid-cell-null-btn") === null).toBe(
      true,
    );
    expect(cells[1].querySelector(".db-grid-cell-null-btn") !== null).toBe(
      true,
    );
    grid.destroy();
  });

  test("editing a cell back to its original value clears the pending change", async () => {
    const { grid, getCaptured } = setup();
    await tick();
    q<HTMLButtonElement>(grid.el, ".db-grid-edit-toggle").click();
    await tick();
    const body = q<HTMLElement>(grid.el, ".db-grid-body");
    const rows = body.querySelectorAll<HTMLElement>(".db-grid-row");
    const nameInput = rows[0].querySelectorAll<HTMLInputElement>(
      ".db-grid-cell-input",
    )[1];
    setInput(nameInput, "Changed");
    setInput(nameInput, "Alice"); // 元に戻す

    const commit = q<HTMLButtonElement>(grid.el, ".db-grid-edit-commit");
    expect(commit.disabled).toBe(true); // 変更ゼロなのでコミット不可
    commit.click();
    await tick();
    expect(getCaptured()).toBeNull();
    grid.destroy();
  });
});
