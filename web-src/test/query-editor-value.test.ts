import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { DbValue } from "../core/database/types";

GlobalRegistrator.register();

const { createQueryEditor } = await import("../views/database/query-editor");

describe("query editor value display", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  afterAll(() => {
    GlobalRegistrator.unregister();
  });

  test.each([
    { name: "null uses the SQL null marker", value: null, expected: "NULL" },
    {
      name: "binary values show their byte length",
      value: new Uint8Array([1, 2, 3]),
      expected: "<blob 3 bytes>",
    },
    { name: "true stays lowercase", value: true, expected: "true" },
    { name: "false stays lowercase", value: false, expected: "false" },
    { name: "strings remain unchanged", value: "sample", expected: "sample" },
    { name: "numbers use decimal text", value: 42, expected: "42" },
  ])("$name", async ({ value, expected }) => {
    const editor = createQueryEditor({
      executeQuery: async () => ({
        dbId: "sample.db",
        columns: ["sample_column"],
        columnTypes: ["TEXT"],
        rows: [[value as DbValue]],
        rowCount: 1,
        truncated: false,
        elapsedMs: 1,
      }),
    });
    document.body.appendChild(editor.el);
    editor.setSql("SELECT sample_column FROM sample_table");

    await editor.run();

    const cells = editor.el.querySelectorAll("tbody td");
    expect(cells[1]?.textContent).toBe(expected);
    editor.dispose();
  });
});
