import { describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadTabs, saveTabs } from "../server/database/tabs-store";

function withTempProject(run: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "code-viewer-tabs-"));
  try {
    run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("database tabs store", () => {
  test("persists sanitized tabs in the caller-provided order", () => {
    withTempProject((dir) => {
      saveTabs(dir, {
        version: 1,
        activeTabId: "tab-2",
        tabs: [
          {
            id: "tab-1",
            dbId: "one.db",
            table: "users",
            view: "data",
            sidebarWidth: "260px",
          },
          {
            id: "tab-2",
            dbId: "docker:redis",
            table: null,
            view: "query",
            sqlDraft: "select 1",
            historyOpen: true,
            historyHeight: "35%",
            redis: { dbIndex: 2, key: "session:1", keyFilter: "session:*" },
          },
        ],
      });

      expect(loadTabs(dir)).toEqual({
        version: 1,
        activeTabId: "tab-2",
        tabs: [
          {
            id: "tab-1",
            dbId: "one.db",
            table: "users",
            view: "data",
            sidebarWidth: "260px",
          },
          {
            id: "tab-2",
            dbId: "docker:redis",
            table: null,
            view: "query",
            sqlDraft: "select 1",
            historyOpen: true,
            historyHeight: "35%",
            redis: { dbIndex: 2, key: "session:1", keyFilter: "session:*" },
          },
        ],
      });
    });
  });

  test("drops duplicate ids and resets active tab to the first surviving tab", () => {
    withTempProject((dir) => {
      const storeDir = join(dir, ".code-viewer");
      mkdirSync(storeDir, { recursive: true });
      writeFileSync(
        join(storeDir, "tabs.json"),
        JSON.stringify({
          version: 1,
          activeTabId: "missing",
          tabs: [
            {
              id: "a",
              dbId: "db.sqlite",
              table: "users",
              view: "data",
              sidebarWidth: "10px",
            },
            {
              id: "a",
              dbId: "other.sqlite",
              table: "ignored",
              view: "schema",
            },
            {
              id: "b",
              dbId: "docker:es",
              table: null,
              view: "invalid",
              es: { index: "logs-*", query: "level:error" },
            },
          ],
        }),
        "utf8",
      );

      expect(loadTabs(dir)).toEqual({
        version: 1,
        activeTabId: "a",
        tabs: [
          { id: "a", dbId: "db.sqlite", table: "users", view: "data" },
          {
            id: "b",
            dbId: "docker:es",
            table: null,
            view: "data",
            es: { index: "logs-*", query: "level:error" },
          },
        ],
      });
    });
  });

  test("backs up invalid JSON and returns an empty state", () => {
    withTempProject((dir) => {
      const storeDir = join(dir, ".code-viewer");
      mkdirSync(storeDir, { recursive: true });
      writeFileSync(join(storeDir, "tabs.json"), "{broken", "utf8");

      expect(loadTabs(dir)).toEqual({
        version: 1,
        activeTabId: null,
        tabs: [],
      });
      const files = readdirSync(storeDir);
      expect(files.includes("tabs.json")).toBe(false);
      expect(files.some((file) => file.startsWith("tabs.json.bak-"))).toBe(
        true,
      );
    });
  });
});
