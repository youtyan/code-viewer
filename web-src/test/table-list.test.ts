import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { DbColumn } from "../core/database/types";

GlobalRegistrator.register();

const { createTableList } = await import("../views/database/table-list");

afterAll(() => {
  GlobalRegistrator.unregister();
});

afterEach(() => {
  document.body.innerHTML = "";
});

function column(name: string, type: string, comment?: string): DbColumn {
  return {
    name,
    type,
    nullable: false,
    primaryKey: name === "id",
    defaultValue: null,
    comment,
  };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < 1000) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("waitFor timed out");
}

describe("database table list", () => {
  test("renders compact types and Japanese column comments in expanded rows", async () => {
    const changes: Array<{ table: string; expanded: boolean }> = [];
    const view = createTableList({
      onSelectTable: () => undefined,
      getExpandedTables: () => ["sample_table"],
      onExpandedTableChange: (table, expanded) =>
        changes.push({ table, expanded }),
      getColumns: async () => [
        column("id", "uuid", "主キー"),
        column(
          "external_status",
          "character varying",
          "外部システムから同期した現在の状態。",
        ),
        column("updated_at", "timestamp with time zone"),
      ],
    });
    document.body.appendChild(view.el);

    view.render([{ name: "sample_table", type: "table", rowCount: 49 }]);
    await waitFor(() => !!view.el.querySelector(".db-table-col-comment"));

    const comments = Array.from(
      view.el.querySelectorAll(".db-table-col-comment"),
    ).map((el) => el.textContent);
    const types = Array.from(
      view.el.querySelectorAll(".db-table-col-type"),
    ).map((el) => el.textContent);

    expect(comments).toEqual([
      "主キー",
      "外部システムから同期した現在の状態。",
    ]);
    expect(types).toEqual(["uuid", "varchar", "timestamptz"]);
    expect(view.el.querySelector(".db-table-col-key")?.textContent).toBe("PK");

    view.el
      .querySelector<HTMLElement>(".db-table-arrow")
      ?.dispatchEvent(new Event("click", { bubbles: true }));

    expect(changes).toEqual([{ table: "sample_table", expanded: false }]);
    expect(
      view.el.querySelector<HTMLElement>(".db-table-children")?.hidden,
    ).toBe(true);
  });

  test("copies a column name from the icon button", async () => {
    const copied: string[] = [];
    const selected: string[] = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          copied.push(value);
        },
      },
    });
    const view = createTableList({
      onSelectTable: (table) => selected.push(table),
      getExpandedTables: () => ["sample_table"],
      getColumns: async () => [
        column("external_status", "character varying", "外部状態。"),
      ],
    });
    document.body.appendChild(view.el);

    view.render([{ name: "sample_table", type: "table", rowCount: 1 }]);
    await waitFor(() => !!view.el.querySelector(".db-table-col-copy"));

    const copy = view.el.querySelector<HTMLButtonElement>(".db-table-col-copy");
    copy?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    await waitFor(() => copied.length === 1);
    expect(copied).toEqual(["external_status"]);
    expect(selected).toEqual([]);
    expect(copy?.classList.contains("copied")).toBe(true);
  });
});
