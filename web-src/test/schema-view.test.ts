import "./_dom";
import { afterEach, describe, expect, test, vi } from "vitest";

const { createSchemaView, DEFAULT_VIEW } = await import(
  "../views/database/schema-view"
);
type SchemaViewProps = Parameters<typeof DEFAULT_VIEW>[0];

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("database schema view", () => {
  test("renders a table comment in the schema header", () => {
    const view = createSchemaView();

    view.render("sample_table", [], [], {
      tableComment: "A table-level description.",
    });

    expect(view.el.querySelector(".db-schema-header-title")?.textContent).toBe(
      "Schema: sample_table — A table-level description.",
    );
  });

  test("renders column comments as a table column", () => {
    const view = createSchemaView();

    view.render(
      "sample_table",
      [
        {
          name: "name",
          type: "text",
          nullable: false,
          primaryKey: false,
          defaultValue: null,
          comment: "Sample display label",
        },
      ],
      [],
    );

    const table = view.el.querySelector(".db-schema-table");
    const headers = Array.from(table?.querySelectorAll("thead th") || []).map(
      (header) => header.textContent,
    );
    const cells = Array.from(table?.querySelectorAll("tbody tr td") || []);

    expect(headers).toEqual([
      "Column",
      "Type",
      "Nullable",
      "PK",
      "Default",
      "Comment",
    ]);
    expect(cells).toHaveLength(6);
    expect(cells[5]?.classList.contains("db-schema-comment")).toBe(true);
    expect(cells[5]?.textContent).toBe("Sample display label");
  });

  test("shows the DDL clipboard failure reason", async () => {
    const failure = new DOMException(
      "clipboard permission denied",
      "NotAllowedError",
    );
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: () => Promise.reject(failure) },
    });
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const view = createSchemaView();
    document.body.appendChild(view.el);
    view.render("sample_table", [], [], {
      ddl: "CREATE TABLE sample_table (sample_column TEXT)",
    });

    const copy = view.el.querySelector<HTMLButtonElement>(
      ".db-schema-copy-btn",
    );
    copy?.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(copy?.classList.contains("failed")).toBe(true);
    expect(copy?.title).toContain(
      "NotAllowedError: clipboard permission denied",
    );
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("DDL"),
      failure,
    );
  });
});

describe("the schema view presenter", () => {
  test("keeps only this table's keys and indexes, and blocks refresh while busy", () => {
    const shown: SchemaViewProps[] = [];
    let refreshes = 0;
    const view = createSchemaView(
      {
        onRefresh: () => {
          refreshes++;
        },
      },
      (props) => {
        shown.push(props);
        return DEFAULT_VIEW(props);
      },
    );
    const last = () => shown[shown.length - 1] as SchemaViewProps;
    view.render(
      "sample_table",
      [],
      [
        {
          name: "sample_idx",
          table: "sample_table",
          columns: ["id"],
          unique: true,
        },
        {
          name: "sample_other_idx",
          table: "sample_other",
          columns: ["id"],
          unique: false,
        },
      ],
      {
        foreignKeys: [
          {
            fromTable: "sample_table",
            fromColumn: "sample_other_id",
            toTable: "sample_other",
            toColumn: "id",
          },
          {
            fromTable: "sample_other",
            fromColumn: "sample_table_id",
            toTable: "sample_table",
            toColumn: "id",
          },
        ],
      },
    );
    const body = last().body;
    if (body.kind !== "table") throw new Error(`unexpected body ${body.kind}`);
    expect([
      body.indexes.map((idx) => idx.name),
      body.foreignKeys.map((fk) => fk.fromColumn),
    ]).toEqual([["sample_idx"], ["sample_other_id"]]);

    view.setRefreshBusy(true);
    const busy = last().body;
    if (busy.kind !== "table") throw new Error(`unexpected body ${busy.kind}`);
    busy.refresh?.onClick();
    expect([busy.refresh?.busy, refreshes]).toEqual([true, 0]);

    view.showError("sample failure");
    expect(last().body).toEqual({ kind: "error", message: "sample failure" });
  });
});
