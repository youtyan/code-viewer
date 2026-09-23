// Data の表の失敗 (ページの取得・関連する行の取得・変更の保存) が、理由を
// cause ごと画面に出し、error そのものを console に渡すことを happy-dom の
// 実描画で確かめる。直す前は err.message だけを出し、console にも cause にも
// 何も残らなかった。

import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, afterEach, describe, expect, test, vi } from "vitest";
import { tableData } from "./_table-grid-fixture";
import { q, waitFor } from "./_test-helpers";

GlobalRegistrator.register();

const { createTableGrid } = await import("../views/database/table-grid");
const { dbText } = await import("../views/database/i18n");

import type {
  DbColumn,
  DbForeignKey,
  DbTableDataResponse,
} from "../core/database/types";

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
];

const FK: DbForeignKey[] = [
  {
    fromTable: "sample_table",
    fromColumn: "owner_id",
    toTable: "sample_owner_table",
    toColumn: "id",
  },
];

function initialData(): DbTableDataResponse {
  return tableData({
    dbId: "sample.db",
    table: "sample_table",
    columns: COLUMNS,
    rows: [
      [1, 10],
      [2, 11],
    ],
  });
}

type Grid = ReturnType<typeof createTableGrid>;

function failureWithCause(message: string): Error {
  return Object.assign(new Error(message), {
    cause: new Error("network is unreachable"),
  });
}

function clickCell(root: HTMLElement, col: number) {
  const rows = q<HTMLElement>(
    root,
    ".db-grid-body",
  ).querySelectorAll<HTMLElement>(".db-grid-row");
  (rows[0].children[col + 1] as HTMLElement).dispatchEvent(
    new MouseEvent("click", { bubbles: true }),
  );
}

describe("table-grid failures", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  afterAll(() => {
    GlobalRegistrator.unregister();
  });

  test.each([
    {
      operation: "table page",
      failing: "fetchPage" as const,
      open: async (grid: Grid) => {
        grid.load("sample_table");
      },
      where: ".db-grid-status.db-pane-error",
    },
    {
      operation: "related rows",
      failing: "fetchRelatedPage" as const,
      open: async (grid: Grid) => {
        grid.load("sample_table", initialData());
        await waitFor(() => !!grid.el.querySelector(".db-grid-row"));
        clickCell(grid.el, 1);
      },
      where: ".db-related-panel .db-pane-error",
    },
    {
      operation: "save changes",
      failing: "applyMutations" as const,
      open: async (grid: Grid) => {
        grid.load("sample_table", initialData());
        await grid.setEditMode(true);
        await waitFor(
          () => !!grid.el.querySelector(".db-grid-rownum-deletable"),
        );
        q<HTMLElement>(grid.el, ".db-grid-rownum-deletable").click();
        q<HTMLButtonElement>(grid.el, ".db-grid-edit-commit").click();
      },
      where: ".db-grid-edit-status",
    },
  ])("$operation の失敗は理由を cause ごと画面と console に出す", async ({
    operation,
    failing,
    open,
    where,
  }) => {
    const failure = failureWithCause(`${operation} request failed`);
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const fail = () => Promise.reject(failure);
    const grid = createTableGrid({
      fetchPage: failing === "fetchPage" ? fail : async () => initialData(),
      fetchRelatedPage:
        failing === "fetchRelatedPage" ? fail : async () => initialData(),
      applyMutations:
        failing === "applyMutations" ? fail : async () => undefined,
      getDbId: () => "sample.db",
      getColumnWidths: () => ({}),
      setColumnWidths: () => undefined,
      getText: () => dbText("en"),
      getForeignKeys: () => FK,
      getEditable: () => true,
    });
    document.body.appendChild(grid.el);
    await open(grid);

    const shown = () => grid.el.querySelector(where)?.textContent ?? "";
    await waitFor(() => shown().includes("Caused by"));
    expect(shown()).toContain(`${operation} request failed`);
    expect(shown()).toContain("network is unreachable");
    const logs = consoleError.mock.calls.filter(
      (args) => args[0] === `[code-viewer] SQL ${operation} failed`,
    );
    expect(logs.length).toBe(1);
    expect(logs[0]?.[logs[0].length - 1]).toBe(failure);
    grid.destroy();
  });
});
