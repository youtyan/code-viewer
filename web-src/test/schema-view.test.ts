import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, afterEach, describe, expect, test, vi } from "vitest";

GlobalRegistrator.register();

const { createSchemaView } = await import("../views/database/schema-view");

afterAll(() => {
  GlobalRegistrator.unregister();
});

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
