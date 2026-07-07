// 編集モードの「実描画」挙動を happy-dom 上で検証する。インラインセル編集 /
// 新規行 / 削除マーク → コミットで、正しい RowMutation[] が applyMutations に
// 渡されることを確認する (文字列存在ではなく挙動の検証)。
import { afterAll, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { type Deferred, deferred, q, waitFor } from "./_test-helpers";

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
    setColumnWidths: () => undefined,
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

function setInput(input: HTMLInputElement, value: string) {
  input.value = value;
  input.dispatchEvent(new Event("input"));
}

// 表示モードのセルをダブルクリックして入力モードに切り替える。
function enterEdit(cell: HTMLElement) {
  cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
}

describe("table-grid edit mode", () => {
  afterAll(() => {
    GlobalRegistrator.unregister();
  });

  test("isEditable reports true for write-capable datastores", () => {
    const { grid } = setup();
    expect(grid.isEditable()).toBe(true);
    // editable=true なら editWrap は editMode 関係なく出す (場所確保で
    // レイアウトシフト回避)。子ボタンの可視性は visibility で切替。
    const wrap = q<HTMLElement>(grid.el, ".db-grid-edit-controls");
    expect(wrap.hidden).toBe(false);
    const newRowBtn = q<HTMLButtonElement>(wrap, ".db-grid-edit-newrow");
    expect(newRowBtn.style.visibility).toBe("hidden");
    grid.destroy();
  });

  test("edit controls become visible after edit mode is turned on", async () => {
    const { grid } = setup();
    await tick();
    const wrap = q<HTMLElement>(grid.el, ".db-grid-edit-controls");
    const newRowBtn = q<HTMLButtonElement>(wrap, ".db-grid-edit-newrow");
    const commitBtn = q<HTMLButtonElement>(wrap, ".db-grid-edit-commit");
    const discardBtn = q<HTMLButtonElement>(wrap, ".db-grid-edit-discard");
    expect(newRowBtn.style.visibility).toBe("hidden");
    expect(commitBtn.style.visibility).toBe("hidden");
    expect(discardBtn.style.visibility).toBe("hidden");
    await grid.setEditMode(true);
    expect(newRowBtn.style.visibility).toBe("");
    expect(commitBtn.style.visibility).toBe("");
    expect(discardBtn.style.visibility).toBe("");
    // wrap 自体は editable のとき常に表示 (場所確保)。
    expect(wrap.hidden).toBe(false);
    grid.destroy();
  });

  test("inline edit + new row + delete commit the right mutations", async () => {
    const { grid, getCaptured } = setup();
    await tick();

    // 編集モードに入る
    await grid.setEditMode(true);
    await tick();

    const body = q<HTMLElement>(grid.el, ".db-grid-body");
    let rows = body.querySelectorAll<HTMLElement>(".db-grid-row");
    // 2 データ行が描画されている
    expect(rows.length >= 2).toBeTruthy();

    // 編集モードに入った直後の既存行は表示モード (input は無い)。
    const row0CellsInitial =
      rows[0].querySelectorAll<HTMLElement>(".db-grid-cell-edit");
    expect(row0CellsInitial[1].querySelector("input")).toBeNull();
    // 行0 (id=1) の name セルをダブルクリックして入力モードへ。
    enterEdit(row0CellsInitial[1]);
    await tick();
    rows = body.querySelectorAll<HTMLElement>(".db-grid-row");
    const nameInput = q<HTMLInputElement>(rows[0], ".db-grid-cell-input");
    setInput(nameInput, "Alicia");

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
    await grid.setEditMode(true);
    await tick();
    const body = q<HTMLElement>(grid.el, ".db-grid-body");
    let rows = body.querySelectorAll<HTMLElement>(".db-grid-row");
    // 行0 の name セル (nullable) をダブルクリックで入力モードへ。
    const nameCell =
      rows[0].querySelectorAll<HTMLElement>(".db-grid-cell-edit")[1];
    enterEdit(nameCell);
    await tick();
    rows = body.querySelectorAll<HTMLElement>(".db-grid-row");
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

  test("∅ on a draft cell inserts an explicit SQL NULL (value: null)", async () => {
    const { grid, getCaptured } = setup();
    await tick();
    await grid.setEditMode(true);
    await tick();
    q<HTMLButtonElement>(grid.el, ".db-grid-edit-newrow").click();
    await tick();
    const draftRow = q<HTMLElement>(grid.el, ".db-grid-row-draft");
    // id を入力し、name (nullable) は ∅ で明示 NULL にする。
    const draftInputs = draftRow.querySelectorAll<HTMLInputElement>(
      ".db-grid-cell-input",
    );
    setInput(draftInputs[0], "7");
    q<HTMLButtonElement>(draftRow, ".db-grid-cell-null-btn").click();
    await tick();
    q<HTMLButtonElement>(grid.el, ".db-grid-edit-commit").click();
    await tick();
    const muts = getCaptured() as RowMutation[];
    expect(muts.length).toBe(1);
    if (muts[0].kind === "insert") {
      // id=7 と name=NULL(明示) が含まれ、name は省略されていないこと。
      expect(muts[0].values).toEqual([
        { column: "id", value: "7" },
        { column: "name", value: null },
      ]);
    }
    grid.destroy();
  });

  test("a PK (non-nullable) cell has no NULL button", async () => {
    const { grid } = setup();
    await tick();
    await grid.setEditMode(true);
    await tick();
    const body = q<HTMLElement>(grid.el, ".db-grid-body");
    let rows = body.querySelectorAll<HTMLElement>(".db-grid-row");
    // id 列セルは readonly(PK)。ダブルクリックしても入力モードにならず
    // NULL ボタンも出ない (表示モードのまま)。
    let cells = rows[0].querySelectorAll<HTMLElement>(".db-grid-cell-edit");
    enterEdit(cells[0]);
    await tick();
    rows = body.querySelectorAll<HTMLElement>(".db-grid-row");
    cells = rows[0].querySelectorAll<HTMLElement>(".db-grid-cell-edit");
    expect(cells[0].querySelector("input")).toBeNull();
    expect(cells[0].querySelector(".db-grid-cell-null-btn")).toBeNull();
    // name 列(nullable)はダブルクリックで input + NULL ボタンが出る。
    enterEdit(cells[1]);
    await tick();
    rows = body.querySelectorAll<HTMLElement>(".db-grid-row");
    cells = rows[0].querySelectorAll<HTMLElement>(".db-grid-cell-edit");
    expect(cells[1].querySelector(".db-grid-cell-null-btn") !== null).toBe(
      true,
    );
    grid.destroy();
  });

  test("focus stays on the edited cell after a re-render (scroll)", async () => {
    const { grid } = setup();
    await tick();
    await grid.setEditMode(true);
    await tick();
    const body = q<HTMLElement>(grid.el, ".db-grid-body");
    // ダブルクリックで name セルを入力モードへ。
    const nameCell = body
      .querySelectorAll<HTMLElement>(".db-grid-row")[0]
      .querySelectorAll<HTMLElement>(".db-grid-cell-edit")[1];
    enterEdit(nameCell);
    await tick();
    const nameInput = q<HTMLInputElement>(body, ".db-grid-cell-input");
    nameInput.focus();
    setInput(nameInput, "Edited");
    expect(nameInput.dataset.editRow).toBe("0");
    // 仮想スクロールの再描画 (body 作り直し) を発生させる。
    q<HTMLElement>(grid.el, ".db-grid-viewport").dispatchEvent(
      new Event("scroll"),
    );
    await tick();
    // 再構築後も同じセル (row0/col1) にフォーカスが復元され、値も保持される。
    const active = document.activeElement as HTMLInputElement | null;
    expect(active?.classList.contains("db-grid-cell-input")).toBe(true);
    expect(active?.dataset.editRow).toBe("0");
    expect(active?.dataset.editCol).toBe("1");
    expect(active?.value).toBe("Edited");
    grid.destroy();
  });

  test("editing a cell back to its original value clears the pending change", async () => {
    const { grid, getCaptured } = setup();
    await tick();
    await grid.setEditMode(true);
    await tick();
    const body = q<HTMLElement>(grid.el, ".db-grid-body");
    let rows = body.querySelectorAll<HTMLElement>(".db-grid-row");
    const nameCell =
      rows[0].querySelectorAll<HTMLElement>(".db-grid-cell-edit")[1];
    enterEdit(nameCell);
    await tick();
    rows = body.querySelectorAll<HTMLElement>(".db-grid-row");
    const nameInput = q<HTMLInputElement>(rows[0], ".db-grid-cell-input");
    setInput(nameInput, "Changed");
    setInput(nameInput, "Alice"); // 元に戻す

    const commit = q<HTMLButtonElement>(grid.el, ".db-grid-edit-commit");
    expect(commit.disabled).toBe(true); // 変更ゼロなのでコミット不可
    commit.click();
    await tick();
    expect(getCaptured()).toBeNull();
    grid.destroy();
  });

  test("single click on an edit-mode cell does not enter input mode", async () => {
    const { grid } = setup();
    await tick();
    await grid.setEditMode(true);
    await tick();
    const body = q<HTMLElement>(grid.el, ".db-grid-body");
    const nameCell = body
      .querySelectorAll<HTMLElement>(".db-grid-row")[0]
      .querySelectorAll<HTMLElement>(".db-grid-cell-edit")[1];
    // 表示モードであることを確認 (input は無い)。
    expect(nameCell.querySelector("input")).toBeNull();
    expect(nameCell.classList.contains("db-grid-cell-display")).toBe(true);
    // シングルクリックでは input にならない (詳細パネル/active セル更新のみ)。
    nameCell.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await tick();
    const rowsAfter = body.querySelectorAll<HTMLElement>(".db-grid-row");
    const nameCellAfter =
      rowsAfter[0].querySelectorAll<HTMLElement>(".db-grid-cell-edit")[1];
    expect(nameCellAfter.querySelector("input")).toBeNull();
    // active セルとして強調されている。
    expect(nameCellAfter.classList.contains("db-grid-cell-active")).toBe(true);
    grid.destroy();
  });

  test("Escape exits input mode and returns to display", async () => {
    const { grid } = setup();
    await tick();
    await grid.setEditMode(true);
    await tick();
    const body = q<HTMLElement>(grid.el, ".db-grid-body");
    const nameCell = body
      .querySelectorAll<HTMLElement>(".db-grid-row")[0]
      .querySelectorAll<HTMLElement>(".db-grid-cell-edit")[1];
    enterEdit(nameCell);
    await tick();
    // 入力モードに切り替わった。
    const nameInput = q<HTMLInputElement>(body, ".db-grid-cell-input");
    expect(nameInput.dataset.editCol).toBe("1");
    // Escape で表示モードへ戻る。
    nameInput.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    await tick();
    expect(body.querySelector(".db-grid-cell-input")).toBeNull();
    grid.destroy();
  });

  test("edit mode survives a same-tab table switch (load)", async () => {
    const { grid } = setup();
    await tick();
    await grid.setEditMode(true);
    expect(grid.getEditMode()).toBe(true);
    // 同じタブで別テーブルへ切り替え (database-view がやる load 相当)。
    // 編集モードはタブ単位で保持する仕様 (#16) なので OFF にならない。
    grid.load("posts", {
      dbId: "app.db",
      table: "posts",
      columns: COLUMNS,
      rows: [[10, "Hello"]],
      totalRows: 1,
      offset: 0,
      limit: 200,
      hasMore: false,
    });
    await tick();
    expect(grid.getEditMode()).toBe(true);
    // edit controls (新規行 / コミット / 破棄) も継続表示。
    const wrap = q<HTMLElement>(grid.el, ".db-grid-edit-controls");
    expect(wrap.hidden).toBe(false);
    grid.destroy();
  });

  test("refresh button refetches the current table with active column filters", async () => {
    const fetchCalls: Array<{ table: string; filters: unknown[] }> = [];
    const grid = createTableGrid({
      fetchPage: async (table, _offset, _limit, _sort, filters) => {
        fetchCalls.push({ table, filters });
        return initialData();
      },
      getDbId: () => "app.db",
      getColumnWidths: () => ({}),
      setColumnWidths: () => undefined,
      getText: () => dbText("en"),
      getEditable: () => true,
      applyMutations: async () => undefined,
    });
    document.body.appendChild(grid.el);
    grid.load("users", initialData());
    const searchIcon = q<HTMLElement>(grid.el, ".db-grid-filter-icon");
    expect(searchIcon.getAttribute("aria-hidden")).toBe("true");
    expect(searchIcon.querySelector("svg.octicon-search")).toBeTruthy();
    const exportButton = q<HTMLButtonElement>(
      grid.el,
      ".db-grid-export-toggle",
    );
    expect(exportButton.querySelector("svg.octicon-download")).toBeTruthy();
    expect(exportButton.textContent).toBe("");
    const refreshButton = q<HTMLButtonElement>(grid.el, ".db-grid-refresh");
    expect(refreshButton.textContent).toBe("");
    expect(refreshButton.title).toBe(
      "Reload this table, keeping search and column filters",
    );
    expect(refreshButton.getAttribute("aria-label")).toBe(
      "Reload this table, keeping search and column filters",
    );
    expect(refreshButton.getAttribute("aria-busy")).toBe("false");
    const filterActions = q<HTMLElement>(grid.el, ".db-grid-filter-actions");
    expect(filterActions.parentElement).toBe(
      q<HTMLElement>(grid.el, ".db-grid-filter-bar"),
    );
    expect(filterActions.children).toHaveLength(3);
    expect(filterActions.children[0]).toBe(refreshButton);
    expect(filterActions.children[1]).toBe(
      q<HTMLElement>(grid.el, ".db-grid-refresh-result"),
    );
    expect(filterActions.children[2]).toBe(
      q<HTMLElement>(grid.el, ".db-grid-export"),
    );

    const nameFilter = grid.el.querySelectorAll<HTMLInputElement>(
      ".db-grid-col-filter",
    )[1];
    expect(nameFilter).toBeTruthy();
    setInput(nameFilter, "Ali");
    expect(refreshButton.textContent).toBe("");
    expect(refreshButton.title).toBe(
      "Reload this table, keeping 1 active filter",
    );
    expect(refreshButton.getAttribute("aria-label")).toBe(
      "Reload this table, keeping 1 active filter",
    );
    await waitFor(() => fetchCalls.length === 1);

    fetchCalls.length = 0;
    refreshButton.click();
    await waitFor(() => fetchCalls.length === 1);

    expect(fetchCalls[0]).toEqual({
      table: "users",
      filters: [{ column: "name", value: "Ali" }],
    });
    expect(nameFilter.value).toBe("Ali");

    setInput(nameFilter, "Alice");
    fetchCalls.length = 0;
    refreshButton.click();
    await waitFor(() => fetchCalls.length === 1);
    expect(fetchCalls[0]).toEqual({
      table: "users",
      filters: [{ column: "name", value: "Alice" }],
    });
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(fetchCalls).toHaveLength(1);
    grid.destroy();
  });

  test("refresh keeps global search together with column filters", async () => {
    const fetchCalls: Array<{ table: string; filters: unknown[] }> = [];
    const grid = createTableGrid({
      fetchPage: async (table, _offset, _limit, _sort, filters) => {
        fetchCalls.push({ table, filters });
        return initialData();
      },
      getDbId: () => "app.db",
      getColumnWidths: () => ({}),
      setColumnWidths: () => undefined,
      getText: () => dbText("en"),
      getEditable: () => true,
      applyMutations: async () => undefined,
    });
    document.body.appendChild(grid.el);
    grid.load("users", initialData());

    const search = q<HTMLInputElement>(grid.el, ".db-grid-filter-input");
    const nameFilter = grid.el.querySelectorAll<HTMLInputElement>(
      ".db-grid-col-filter",
    )[1];
    setInput(search, "active");
    setInput(nameFilter, "Ali");

    const refreshButton = q<HTMLButtonElement>(grid.el, ".db-grid-refresh");
    expect(refreshButton.textContent).toBe("");
    expect(refreshButton.title).toBe(
      "Reload this table, keeping 2 active filters",
    );

    refreshButton.click();
    await waitFor(() => fetchCalls.length === 1);

    expect(fetchCalls[0]).toEqual({
      table: "users",
      filters: [
        { column: "name", value: "Ali" },
        { column: "id", value: "active" },
        { column: "name", value: "active" },
      ],
    });
    expect(search.value).toBe("active");
    expect(nameFilter.value).toBe("Ali");
    expect(grid.getState()).toEqual({
      search: "active",
      filters: [{ column: "name", value: "Ali" }],
    });
    grid.destroy();
  });

  test("clear filters button is labeled and clears column filters", async () => {
    const fetchCalls: unknown[][] = [];
    const grid = createTableGrid({
      fetchPage: async (_table, _offset, _limit, _sort, filters) => {
        fetchCalls.push(filters);
        return initialData();
      },
      getDbId: () => "app.db",
      getColumnWidths: () => ({}),
      setColumnWidths: () => undefined,
      getText: () => dbText("en"),
      getEditable: () => true,
      applyMutations: async () => undefined,
    });
    document.body.appendChild(grid.el);
    grid.load("users", initialData());

    const nameFilter = grid.el.querySelectorAll<HTMLInputElement>(
      ".db-grid-col-filter",
    )[1];
    const clearFilters = q<HTMLButtonElement>(grid.el, ".db-grid-filter-clear");
    expect(clearFilters.hidden).toBe(true);

    setInput(nameFilter, "Ali");
    expect(clearFilters.hidden).toBe(false);
    expect(clearFilters.textContent).toBe("Clear filters");
    expect(clearFilters.title).toBe("Clear 1 active filter");
    expect(clearFilters.getAttribute("aria-label")).toBe(
      "Clear 1 active filter",
    );

    await new Promise((resolve) => setTimeout(resolve, 350));
    fetchCalls.length = 0;
    clearFilters.click();

    await waitFor(() => fetchCalls.length === 1);
    expect(nameFilter.value).toBe("");
    expect(clearFilters.hidden).toBe(true);
    expect(fetchCalls[0]).toEqual([]);
    grid.destroy();
  });

  test("filtered empty state explains zero rows and clears filters", async () => {
    const fetchCalls: unknown[][] = [];
    const grid = createTableGrid({
      fetchPage: async (_table, _offset, _limit, _sort, filters) => {
        fetchCalls.push(filters);
        return filters.length
          ? { ...initialData(), rows: [], totalRows: 0 }
          : initialData();
      },
      getDbId: () => "app.db",
      getColumnWidths: () => ({}),
      setColumnWidths: () => undefined,
      getText: () => dbText("en"),
      getEditable: () => true,
      applyMutations: async () => undefined,
    });
    document.body.appendChild(grid.el);
    grid.load("users", initialData());

    const nameFilter = grid.el.querySelectorAll<HTMLInputElement>(
      ".db-grid-col-filter",
    )[1];
    setInput(nameFilter, "Nobody");

    await waitFor(() => fetchCalls.length === 1);
    const empty = q<HTMLElement>(grid.el, ".db-grid-viewport .db-pane-empty");
    await waitFor(() => empty.hidden === false);
    expect(empty.querySelector(".db-pane-empty-icon")).toBeNull();
    expect(empty.querySelector(".db-pane-empty-title")?.textContent).toBe(
      "No rows match 1 active filter",
    );
    expect(
      empty.querySelector(".db-pane-empty-hint")?.textContent || "",
    ).toMatch(/current search or column filters/);
    const actions = empty.querySelectorAll<HTMLButtonElement>("button");
    expect(actions).toHaveLength(2);
    const reloadAction = actions[0];
    const clearAction = actions[1];
    expect(reloadAction.textContent).toBe("");
    expect(reloadAction.classList.contains("db-grid-refresh")).toBe(true);
    expect(reloadAction.title).toBe(
      "Reload this table, keeping 1 active filter",
    );
    expect(reloadAction.getAttribute("aria-busy")).toBe("false");
    expect(reloadAction.disabled).toBe(false);
    expect(clearAction.textContent).toBe("Clear filters");
    expect(clearAction.disabled).toBe(false);

    fetchCalls.length = 0;
    reloadAction.click();
    await waitFor(() => fetchCalls.length === 1);
    expect(fetchCalls[0]).toEqual([{ column: "name", value: "Nobody" }]);
    expect(nameFilter.value).toBe("Nobody");
    expect(empty.hidden).toBe(false);

    fetchCalls.length = 0;
    clearAction.click();
    await waitFor(() => fetchCalls.length === 1);
    expect(fetchCalls[0]).toEqual([]);
    expect(nameFilter.value).toBe("");
    await waitFor(() => empty.hidden === true);
    expect(reloadAction.hidden).toBe(true);
    expect(reloadAction.disabled).toBe(true);
    expect(clearAction.hidden).toBe(true);
    expect(clearAction.disabled).toBe(true);
    grid.destroy();
  });

  test("filtered empty reload action stays icon-only while refreshing", async () => {
    let filteredFetches = 0;
    let pendingReload: Deferred<DbTableDataResponse> | null = null;
    const grid = createTableGrid({
      fetchPage: async (_table, _offset, _limit, _sort, filters) => {
        if (!filters.length) return initialData();
        filteredFetches++;
        if (filteredFetches === 1)
          return { ...initialData(), rows: [], totalRows: 0 };
        pendingReload = deferred<DbTableDataResponse>();
        return pendingReload.promise;
      },
      getDbId: () => "app.db",
      getColumnWidths: () => ({}),
      setColumnWidths: () => undefined,
      getText: () => dbText("en"),
      getEditable: () => true,
      applyMutations: async () => undefined,
    });
    document.body.appendChild(grid.el);
    grid.load("users", initialData());

    const nameFilter = grid.el.querySelectorAll<HTMLInputElement>(
      ".db-grid-col-filter",
    )[1];
    setInput(nameFilter, "Nobody");

    await waitFor(() => filteredFetches === 1);
    const empty = q<HTMLElement>(grid.el, ".db-grid-viewport .db-pane-empty");
    await waitFor(() => empty.hidden === false);
    const reloadAction = empty.querySelectorAll<HTMLButtonElement>("button")[0];

    expect(reloadAction.textContent).toBe("");
    expect(reloadAction.getAttribute("aria-busy")).toBe("false");
    reloadAction.click();

    await waitFor(() => filteredFetches === 2);
    expect(reloadAction.textContent).toBe("");
    expect(reloadAction.getAttribute("aria-busy")).toBe("true");
    expect(reloadAction.disabled).toBe(true);

    pendingReload?.resolve({ ...initialData(), rows: [], totalRows: 0 });
    await waitFor(() => reloadAction.getAttribute("aria-busy") === "false");
    expect(reloadAction.textContent).toBe("");
    expect(reloadAction.disabled).toBe(false);
    grid.destroy();
  });

  test("filtered empty state also covers global search", async () => {
    const fetchCalls: unknown[][] = [];
    const grid = createTableGrid({
      fetchPage: async (_table, _offset, _limit, _sort, filters) => {
        fetchCalls.push(filters);
        return filters.length
          ? { ...initialData(), rows: [], totalRows: 0 }
          : initialData();
      },
      getDbId: () => "app.db",
      getColumnWidths: () => ({}),
      setColumnWidths: () => undefined,
      getText: () => dbText("en"),
      getEditable: () => true,
      applyMutations: async () => undefined,
    });
    document.body.appendChild(grid.el);
    grid.load("users", initialData());

    const search = q<HTMLInputElement>(grid.el, ".db-grid-filter-input");
    setInput(search, "Nobody");

    await waitFor(() => fetchCalls.length === 1);
    const empty = q<HTMLElement>(grid.el, ".db-grid-viewport .db-pane-empty");
    await waitFor(() => empty.hidden === false);
    expect(empty.querySelector(".db-pane-empty-title")?.textContent).toBe(
      "No rows match 1 active filter",
    );

    const clearAction = empty.querySelectorAll<HTMLButtonElement>("button")[1];
    fetchCalls.length = 0;
    clearAction.click();
    await waitFor(() => fetchCalls.length === 1);
    expect(fetchCalls[0]).toEqual([]);
    expect(search.value).toBe("");
    await waitFor(() => empty.hidden === true);
    grid.destroy();
  });

  test("refresh status shows active filters are kept while reloading", async () => {
    let resolveFetch: ((data: DbTableDataResponse) => void) | null = null;
    const fetchCalls: unknown[][] = [];
    const refreshEvents: Array<{
      table: string;
      totalRows: number;
      filters: unknown[];
    }> = [];
    const grid = createTableGrid({
      fetchPage: async (_table, _offset, _limit, _sort, filters) => {
        fetchCalls.push(filters);
        return await new Promise<DbTableDataResponse>((resolve) => {
          resolveFetch = resolve;
        });
      },
      getDbId: () => "app.db",
      getColumnWidths: () => ({}),
      setColumnWidths: () => undefined,
      getText: () => dbText("en"),
      getEditable: () => true,
      applyMutations: async () => undefined,
      onRefreshComplete: (event) => refreshEvents.push(event),
    });
    document.body.appendChild(grid.el);
    grid.load("users", initialData());

    const nameFilter = grid.el.querySelectorAll<HTMLInputElement>(
      ".db-grid-col-filter",
    )[1];
    setInput(nameFilter, "Ali");
    q<HTMLButtonElement>(grid.el, ".db-grid-refresh").click();

    await waitFor(() => fetchCalls.length === 1);
    const status = q<HTMLElement>(grid.el, ".db-grid-status");
    expect(status.textContent || "").toMatch(/Reloading with 1 active filter/);
    const refreshButton = q<HTMLButtonElement>(grid.el, ".db-grid-refresh");
    const refreshResult = q<HTMLElement>(grid.el, ".db-grid-refresh-result");
    expect(refreshResult.hidden).toBe(true);
    expect(refreshResult.getAttribute("aria-live")).toBe("polite");
    expect(refreshButton.textContent).toBe("");
    expect(refreshButton.getAttribute("aria-busy")).toBe("true");
    expect(fetchCalls[0]).toEqual([{ column: "name", value: "Ali" }]);

    resolveFetch?.(initialData());
    await waitFor(() => !(status.textContent || "").includes("Reloading"));
    expect(status.textContent || "").toMatch(/1 filter\(s\)/);
    expect(refreshButton.textContent).toBe("");
    expect(refreshButton.getAttribute("aria-busy")).toBe("false");
    expect(refreshResult.hidden).toBe(true);
    expect(refreshResult.textContent).toBe("");
    expect(refreshResult.classList.contains("changed")).toBe(false);
    expect(refreshEvents).toEqual([
      {
        table: "users",
        totalRows: 2,
        filters: [{ column: "name", value: "Ali" }],
      },
    ]);
    grid.destroy();
  });

  test("refresh keeps the compact result slot empty while row counts change", async () => {
    const data = initialData();
    let nextData = data;
    const grid = createTableGrid({
      fetchPage: async () => nextData,
      getDbId: () => "app.db",
      getColumnWidths: () => ({}),
      setColumnWidths: () => undefined,
      getText: () => dbText("en"),
      getEditable: () => true,
      applyMutations: async () => undefined,
    });
    document.body.appendChild(grid.el);
    grid.load("users", data);

    const refreshResult = q<HTMLElement>(grid.el, ".db-grid-refresh-result");
    expect(refreshResult.hidden).toBe(true);

    nextData = {
      ...data,
      rows: [...data.rows, [3, "Carol"]],
      totalRows: 3,
    };
    q<HTMLButtonElement>(grid.el, ".db-grid-refresh").click();

    await waitFor(() =>
      /3 rows/.test(
        q<HTMLElement>(grid.el, ".db-grid-status").textContent || "",
      ),
    );
    expect(refreshResult.hidden).toBe(true);
    expect(refreshResult.textContent).toBe("");
    expect(refreshResult.classList.contains("changed")).toBe(false);

    nextData = {
      ...data,
      rows: [[1, "Alice"]],
      totalRows: 1,
    };
    q<HTMLButtonElement>(grid.el, ".db-grid-refresh").click();

    await waitFor(() =>
      /1 rows/.test(
        q<HTMLElement>(grid.el, ".db-grid-status").textContent || "",
      ),
    );
    expect(refreshResult.hidden).toBe(true);
    expect(refreshResult.textContent).toBe("");
    expect(refreshResult.classList.contains("changed")).toBe(false);

    const search = q<HTMLInputElement>(grid.el, ".db-grid-filter-input");
    setInput(search, "Carol");
    expect(refreshResult.hidden).toBe(true);
    expect(refreshResult.textContent).toBe("");
    grid.destroy();
  });

  test("refresh button keeps icon-only text while localizing aria labels", async () => {
    let language: "en" | "ja" = "en";
    const data = initialData();
    const grid = createTableGrid({
      fetchPage: async () => ({
        ...data,
        rows: [...data.rows, [3, "Carol"]],
        totalRows: 3,
      }),
      getDbId: () => "app.db",
      getColumnWidths: () => ({}),
      setColumnWidths: () => undefined,
      getText: () => dbText(language),
      getEditable: () => true,
      applyMutations: async () => undefined,
    });
    document.body.appendChild(grid.el);
    grid.load("users", data);

    const refreshResult = q<HTMLElement>(grid.el, ".db-grid-refresh-result");
    const refreshButton = q<HTMLButtonElement>(grid.el, ".db-grid-refresh");
    refreshButton.click();

    await waitFor(() =>
      /3 rows/.test(
        q<HTMLElement>(grid.el, ".db-grid-status").textContent || "",
      ),
    );
    language = "ja";
    grid.localize();
    expect(refreshButton.textContent).toBe("");
    expect(refreshButton.getAttribute("aria-label")).toBe(
      "検索/列フィルタを保持して、この表だけ再読み込み",
    );
    expect(refreshResult.hidden).toBe(true);
    expect(refreshResult.textContent).toBe("");
    grid.destroy();
  });

  test("refresh result clears when an edit commit reloads the table", async () => {
    const data = initialData();
    let nextData = data;
    let commits = 0;
    const grid = createTableGrid({
      fetchPage: async () => nextData,
      getDbId: () => "app.db",
      getColumnWidths: () => ({}),
      setColumnWidths: () => undefined,
      getText: () => dbText("en"),
      getEditable: () => true,
      applyMutations: async () => {
        commits++;
        nextData = {
          ...data,
          rows: [...data.rows, [3, "Carol"]],
          totalRows: 3,
        };
      },
    });
    document.body.appendChild(grid.el);
    grid.load("users", data);

    const refreshResult = q<HTMLElement>(grid.el, ".db-grid-refresh-result");
    q<HTMLButtonElement>(grid.el, ".db-grid-refresh").click();
    await waitFor(
      () =>
        q<HTMLButtonElement>(grid.el, ".db-grid-refresh").getAttribute(
          "aria-busy",
        ) === "false",
    );

    await grid.setEditMode(true);
    q<HTMLButtonElement>(grid.el, ".db-grid-edit-newrow").click();
    await tick();
    const draftRow = q<HTMLElement>(grid.el, ".db-grid-row-draft");
    const draftInputs = draftRow.querySelectorAll<HTMLInputElement>(
      ".db-grid-cell-input",
    );
    setInput(draftInputs[1], "Carol");
    q<HTMLButtonElement>(grid.el, ".db-grid-edit-commit").click();

    await waitFor(() => commits === 1);
    await waitFor(() =>
      /3 rows/.test(
        q<HTMLElement>(grid.el, ".db-grid-status").textContent || "",
      ),
    );
    expect(refreshResult.hidden).toBe(true);
    expect(refreshResult.textContent).toBe("");
    grid.destroy();
  });

  test("refresh result is skipped when filters change during reload", async () => {
    let resolveFetch: ((data: DbTableDataResponse) => void) | null = null;
    let fetches = 0;
    const refreshEvents: unknown[] = [];
    const fetchPromise = new Promise<DbTableDataResponse>((resolve) => {
      resolveFetch = resolve;
    });
    const grid = createTableGrid({
      fetchPage: async () => {
        fetches++;
        return await fetchPromise;
      },
      getDbId: () => "app.db",
      getColumnWidths: () => ({}),
      setColumnWidths: () => undefined,
      getText: () => dbText("en"),
      getEditable: () => true,
      applyMutations: async () => undefined,
      onRefreshComplete: (event) => refreshEvents.push(event),
    });
    document.body.appendChild(grid.el);
    grid.load("users", initialData());

    q<HTMLButtonElement>(grid.el, ".db-grid-refresh").click();
    await waitFor(() => fetches === 1);

    const refreshResult = q<HTMLElement>(grid.el, ".db-grid-refresh-result");
    const search = q<HTMLInputElement>(grid.el, ".db-grid-filter-input");
    setInput(search, "Carol");
    resolveFetch?.({
      ...initialData(),
      rows: [...initialData().rows, [3, "Carol"]],
      totalRows: 3,
    });

    await waitFor(
      () =>
        q<HTMLButtonElement>(grid.el, ".db-grid-refresh").getAttribute(
          "aria-busy",
        ) === "false",
    );
    expect(refreshResult.hidden).toBe(true);
    expect(refreshResult.textContent).toBe("");
    expect(refreshEvents).toEqual([]);
    grid.destroy();
  });

  test("refresh result is skipped after filter debounce starts a newer load", async () => {
    const requests: Array<{
      filters: unknown[];
      request: Deferred<DbTableDataResponse>;
    }> = [];
    const refreshEvents: unknown[] = [];
    const grid = createTableGrid({
      fetchPage: async (_table, _offset, _limit, _sort, filters) => {
        const request = deferred<DbTableDataResponse>();
        requests.push({ filters, request });
        return await request.promise;
      },
      getDbId: () => "app.db",
      getColumnWidths: () => ({}),
      setColumnWidths: () => undefined,
      getText: () => dbText("en"),
      getEditable: () => true,
      applyMutations: async () => undefined,
      onRefreshComplete: (event) => refreshEvents.push(event),
    });
    document.body.appendChild(grid.el);
    grid.load("users", initialData());

    q<HTMLButtonElement>(grid.el, ".db-grid-refresh").click();
    await waitFor(() => requests.length === 1);

    const refreshResult = q<HTMLElement>(grid.el, ".db-grid-refresh-result");
    const search = q<HTMLInputElement>(grid.el, ".db-grid-filter-input");
    setInput(search, "Carol");
    await waitFor(() => requests.length === 2, 1000);

    requests[0].request.resolve({
      ...initialData(),
      rows: [...initialData().rows, [3, "Carol"]],
      totalRows: 3,
    });
    await waitFor(
      () =>
        q<HTMLButtonElement>(grid.el, ".db-grid-refresh").getAttribute(
          "aria-busy",
        ) === "false",
    );
    expect(refreshResult.hidden).toBe(true);
    expect(refreshResult.textContent).toBe("");
    expect(refreshEvents).toEqual([]);

    requests[1].request.resolve({
      ...initialData(),
      rows: [[3, "Carol"]],
      totalRows: 1,
    });
    await waitFor(() =>
      /1 rows/.test(
        q<HTMLElement>(grid.el, ".db-grid-status").textContent || "",
      ),
    );
    expect(refreshResult.hidden).toBe(true);
    expect(refreshResult.textContent).toBe("");
    grid.destroy();
  });

  test("refresh failure keeps the error status visible", async () => {
    const grid = createTableGrid({
      fetchPage: async () => {
        throw new Error("sample reload failed");
      },
      getDbId: () => "app.db",
      getColumnWidths: () => ({}),
      setColumnWidths: () => undefined,
      getText: () => dbText("en"),
      getEditable: () => true,
      applyMutations: async () => undefined,
    });
    document.body.appendChild(grid.el);
    grid.load("users", initialData());

    q<HTMLButtonElement>(grid.el, ".db-grid-refresh").click();

    await waitFor(() =>
      q<HTMLElement>(grid.el, ".db-grid-status").classList.contains(
        "db-pane-error",
      ),
    );
    const status = q<HTMLElement>(grid.el, ".db-grid-status");
    expect(status.textContent || "").toMatch(/sample reload failed/);
    expect((status.textContent || "").includes("Reloading")).toBe(false);
    grid.destroy();
  });
});
