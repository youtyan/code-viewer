import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, describe, expect, test } from "vitest";

GlobalRegistrator.register();

const { createSchemaView } = await import("../views/database/schema-view");

afterAll(() => {
  GlobalRegistrator.unregister();
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
});
