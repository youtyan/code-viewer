import { describe, expect, test } from "vitest";
import type { DbColumn } from "../core/database/types";
import type { DatabaseAdapter } from "../server/database/adapters/types";
import { searchTableAsync } from "../server/database/global-search";

const cityColumns: DbColumn[] = [
  {
    name: "id",
    type: "bigint",
    nullable: false,
    primaryKey: true,
    defaultValue: null,
  },
  {
    name: "name",
    type: "varchar(255)",
    nullable: false,
    primaryKey: false,
    defaultValue: null,
  },
];

function createSearchAdapter(): {
  adapter: DatabaseAdapter;
  calls: Array<{ sql: string; maxRows?: number }>;
} {
  const calls: Array<{ sql: string; maxRows?: number }> = [];
  const adapter: DatabaseAdapter = {
    kind: "mysql",
    getTablesAsync: async () => [],
    getColumnsAsync: async () => cityColumns,
    getColumnsMultiAsync: async (tables) =>
      new Map(tables.map((table) => [table, cityColumns])),
    getIndexesAsync: async () => [],
    getForeignKeysAsync: async () => [],
    getTableRowCountAsync: async () => 0,
    getTableRowCountsAsync: async (tables) =>
      new Map(tables.map((table) => [table, 0])),
    getTablePageAsync: async () => ({
      columns: [],
      columnTypes: [],
      rows: [],
      rowCount: 0,
    }),
    getTablePageWithMeta: async () => ({
      columns: cityColumns,
      rows: [],
      rowCount: 0,
      totalRows: 0,
    }),
    getFilteredTablePageWithMeta: async () => ({
      columns: cityColumns,
      rows: [],
      rowCount: 0,
      totalRows: 0,
    }),
    executeReadonlyQueryAsync: async (sql, _params, maxRows) => {
      calls.push({ sql, maxRows });
      if (/\bLIMIT\b/i.test(sql)) {
        throw new Error("adapter adds LIMIT itself");
      }
      return {
        columns: ["id", "name"],
        columnTypes: ["bigint", "varchar(255)"],
        rows: [["1", "生駒市"]],
        rowCount: 1,
      };
    },
    getCreateStatementAsync: async () => "",
    getTriggersAsync: async () => [],
    close: () => undefined,
  };
  return { adapter, calls };
}

describe("global database search", () => {
  test("lets the adapter own row limiting so Docker SQL does not get duplicate LIMITs", async () => {
    const { adapter, calls } = createSearchAdapter();

    const hits = await searchTableAsync(
      adapter,
      "cities",
      cityColumns,
      "生駒市",
      50,
      false,
      ["id"],
    );

    expect(hits).toHaveLength(1);
    expect(hits[0].table).toBe("cities");
    expect(hits[0].column).toBe("name");
    expect(calls).toHaveLength(1);
    expect(calls[0].maxRows).toBe(50);
  });

  test("uses portable LIKE escape syntax for mysql searches", async () => {
    const { adapter, calls } = createSearchAdapter();

    await searchTableAsync(
      adapter,
      "cities",
      cityColumns,
      "100%_一致",
      50,
      false,
      ["id"],
    );

    expect(calls[0].sql).toMatch(/LIKE '%100=%=_一致%' ESCAPE '='/);
    expect(calls[0].sql.includes("ESCAPE '\\'")).toBe(false);
  });
});
