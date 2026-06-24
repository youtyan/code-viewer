import { describe, expect, test } from "bun:test";
import type { DbColumn } from "../core/database/types";
import type { DatabaseAdapter } from "../server/database/adapters/types";
import { searchTable } from "../server/database/global-search";

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
    getTables: () => [],
    getColumns: () => cityColumns,
    getIndexes: () => [],
    getForeignKeys: () => [],
    getTableRowCount: () => 0,
    getTablePage: () => ({
      columns: [],
      columnTypes: [],
      rows: [],
      rowCount: 0,
    }),
    executeReadonlyQuery: (sql, _params, maxRows) => {
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
    getCreateStatement: () => "",
    getTriggers: () => [],
    close: () => {},
  };
  return { adapter, calls };
}

describe("global database search", () => {
  test("lets the adapter own row limiting so Docker SQL does not get duplicate LIMITs", () => {
    const { adapter, calls } = createSearchAdapter();

    const hits = searchTable(
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

  test("uses portable LIKE escape syntax for mysql searches", () => {
    const { adapter, calls } = createSearchAdapter();

    searchTable(adapter, "cities", cityColumns, "100%_一致", 50, false, ["id"]);

    expect(calls[0].sql).toMatch(/LIKE '%100=%=_一致%' ESCAPE '='/);
    expect(calls[0].sql.includes("ESCAPE '\\'")).toBe(false);
  });
});
