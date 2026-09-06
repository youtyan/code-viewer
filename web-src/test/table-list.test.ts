import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, afterEach, describe, expect, test } from "vitest";
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
  test("shows a table comment only while its accordion is expanded", () => {
    const view = createTableList({ onSelectTable: () => undefined });
    document.body.appendChild(view.el);

    view.render([
      {
        name: "sample_table",
        type: "table",
        rowCount: 1,
        comment: "A table-level description.",
      },
    ]);

    const comment = view.el.querySelector(".db-table-col-comment");
    expect(comment?.textContent).toBe("A table-level description.");
    expect(comment?.getAttribute("title")).toBe("A table-level description.");
    expect(
      view.el.querySelector<HTMLElement>(".db-table-children")?.hidden,
    ).toBe(true);

    view.el
      .querySelector<HTMLElement>(".db-table-arrow")
      ?.dispatchEvent(new Event("click", { bubbles: true }));

    expect(
      view.el.querySelector<HTMLElement>(".db-table-children")?.hidden,
    ).toBe(false);
  });

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

  test("clears the table filter from the input button and empty state", () => {
    const selected: string[] = [];
    const view = createTableList({
      onSelectTable: (table) => selected.push(table),
    });
    document.body.appendChild(view.el);

    view.render([
      { name: "sample_users", type: "table", rowCount: 2 },
      { name: "audit_logs", type: "table", rowCount: 5 },
    ]);

    const input = view.el.querySelector<HTMLInputElement>(".db-table-filter");
    const clear = view.el.querySelector<HTMLButtonElement>(
      ".db-table-filter-clear",
    );
    if (!input || !clear) throw new Error("missing table filter controls");

    expect(clear.hidden).toBe(true);

    input.value = "users";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(clear.hidden).toBe(false);
    expect(view.el.querySelectorAll(".db-table-node")).toHaveLength(1);
    expect(view.el.textContent || "").toMatch(/sample_users/);
    expect((view.el.textContent || "").includes("audit_logs")).toBe(false);

    clear.click();
    expect(input.value).toBe("");
    expect(clear.hidden).toBe(true);
    expect(view.el.querySelectorAll(".db-table-node")).toHaveLength(2);
    expect(document.activeElement).toBe(input);

    view.el.querySelector<HTMLElement>(".db-table-item")?.click();
    view.setActive("sample_users");
    view.el
      .querySelector<HTMLElement>(".db-table-arrow")
      ?.dispatchEvent(new Event("click", { bubbles: true }));

    input.value = "missing";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    expect(view.el.querySelector(".db-table-list-empty")?.textContent).toMatch(
      /No matching tables/,
    );
    const emptyClear = view.el.querySelector<HTMLButtonElement>(
      ".db-table-list-empty-actions button",
    );
    expect(emptyClear?.textContent).toBe("Clear filter");
    expect(emptyClear?.getAttribute("aria-label")).toBe("Clear filter");

    emptyClear?.click();

    expect(input.value).toBe("");
    expect(clear.hidden).toBe(true);
    expect(view.el.querySelector(".db-table-list-empty")).toBeNull();
    expect(view.el.querySelectorAll(".db-table-node")).toHaveLength(2);
    expect(
      view.el
        .querySelector<HTMLElement>(".db-table-item")
        ?.classList.contains("active"),
    ).toBe(true);
    expect(
      view.el.querySelector<HTMLElement>(".db-table-children")?.hidden,
    ).toBe(false);
    expect(selected).toEqual(["sample_users"]);
  });

  test("updates one row count without resetting the table filter", () => {
    const view = createTableList({
      onSelectTable: () => undefined,
    });
    document.body.appendChild(view.el);

    view.render([
      { name: "sample_users", type: "table", rowCount: 2 },
      { name: "audit_logs", type: "table", rowCount: 5 },
    ]);

    const input = view.el.querySelector<HTMLInputElement>(".db-table-filter");
    if (!input) throw new Error("missing table filter input");
    input.value = "users";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    view.updateRowCount("sample_users", 12_500);
    expect(input.value).toBe("users");
    expect(view.el.querySelectorAll(".db-table-node")).toHaveLength(1);
    expect(view.el.querySelector(".db-table-count")?.textContent).toBe("12.5K");

    view.updateRowCount("audit_logs", 9);
    expect((view.el.textContent || "").includes("audit_logs")).toBe(false);

    input.value = "";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    const counts = Array.from(view.el.querySelectorAll(".db-table-count")).map(
      (count) => count.textContent,
    );
    expect(counts).toEqual(["12.5K", "9"]);
  });
});

describe("table list keyboard navigation", () => {
  test.each([
    ["ArrowDown", "ArrowDown", "beta"],
    ["ArrowDown", "ArrowUp", "alpha"],
    ["ArrowDown", "End", "gamma"],
    ["ArrowUp", "Home", "alpha"],
  ])("moves using %s then %s and opens %s", (first, second, expected) => {
    const selected: string[] = [];
    const view = createTableList({
      onSelectTable: (name) => selected.push(name),
    });
    document.body.appendChild(view.el);
    view.render(
      ["alpha", "beta", "gamma"].map((name) => ({
        name,
        type: "table",
        rowCount: 1,
      })),
    );
    const filter = view.el.querySelector<HTMLInputElement>("input");
    filter?.focus();
    filter?.dispatchEvent(
      new KeyboardEvent("keydown", { key: first, bubbles: true }),
    );
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key: second, bubbles: true }),
    );
    expect(document.activeElement?.getAttribute("data-table")).toBe(expected);
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    expect(selected).toEqual([expected]);
    expect(view.el.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
    view.dispose();
  });

  test("preserves filtered results on localization and ignores composition Enter", () => {
    const selected: string[] = [];
    let language: "en" | "ja" = "en";
    const view = createTableList({
      getLanguage: () => language,
      onSelectTable: (name) => selected.push(name),
    });
    document.body.appendChild(view.el);
    view.render(
      ["alpha", "beta"].map((name) => ({ name, type: "table", rowCount: 1 })),
    );
    const input = view.el.querySelector<HTMLInputElement>("input");
    if (!input) throw new Error("missing table filter");
    input.value = "ALPHA";
    input.dispatchEvent(new Event("input"));
    language = "ja";
    view.localize();
    expect(input.placeholder).toBe("テーブルを絞り込み…");
    expect(view.el.querySelector(".db-table-list-summary")?.textContent).toBe(
      "1 / 2 テーブル",
    );
    input.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        isComposing: true,
        bubbles: true,
      }),
    );
    expect(selected).toEqual([]);
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    expect(selected).toEqual(["alpha"]);
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(input.value).toBe("");
    expect(view.el.querySelectorAll(".db-table-item")).toHaveLength(2);
    view.dispose();
  });
});
