import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  addQueryHistoryEntry,
  loadQueryHistoryAsync,
  updateQueryHistoryAsync,
} from "../server/database/query-history";

describe("database query history store", () => {
  test("backs up corrupt async history instead of overwriting it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "code-viewer-query-history-"));
    try {
      const storeDir = join(dir, ".code-viewer");
      mkdirSync(storeDir, { recursive: true });
      writeFileSync(join(storeDir, "query-history.json"), "{broken", "utf8");

      expect(await loadQueryHistoryAsync(dir)).toEqual({
        version: 1,
        entries: [],
      });
      let files = readdirSync(storeDir);
      expect(files.includes("query-history.json")).toBe(false);
      expect(
        files.some((file) => file.startsWith("query-history.json.corrupt-")),
      ).toBe(true);

      await updateQueryHistoryAsync(dir, (state) => ({
        state: addQueryHistoryEntry(state, {
          id: "entry-1",
          dbId: "db.sqlite",
          sql: "select 1",
          columns: ["one"],
          rowsPreview: [[1]],
          rowCount: 1,
          savedRows: 1,
          truncated: false,
          elapsedMs: 1,
          executedAt: "2026-06-25T00:00:00.000Z",
          executedBy: "user",
          source: "browser",
        }),
        result: undefined,
      }));

      files = readdirSync(storeDir);
      expect(files.includes("query-history.json")).toBe(true);
      expect(
        files.some((file) => file.startsWith("query-history.json.corrupt-")),
      ).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
