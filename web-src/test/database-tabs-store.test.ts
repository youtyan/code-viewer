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

  test("drops tabs pointing at code-viewer internal databases", () => {
    withTempProject((dir) => {
      saveTabs(dir, {
        version: 1,
        activeTabId: "internal",
        tabs: [
          {
            id: "internal",
            dbId: ".code-viewer/db-snapshots.sqlite",
            table: "cancel_bookings",
            view: "data",
          },
          {
            id: "valid",
            dbId: "docker:db",
            table: "cancel_bookings",
            view: "data",
          },
        ],
      });

      expect(loadTabs(dir)).toEqual({
        version: 1,
        activeTabId: "valid",
        tabs: [
          {
            id: "valid",
            dbId: "docker:db",
            table: "cancel_bookings",
            view: "data",
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

  test("truncates large drafts and rejects unsafe css sizes", () => {
    withTempProject((dir) => {
      saveTabs(dir, {
        version: 1,
        activeTabId: "large",
        tabs: [
          {
            id: "large",
            dbId: "db.sqlite",
            table: "events",
            view: "query",
            sqlDraft: "x".repeat(17_000),
            historyHeight: "javascript:alert(1)",
            sidebarWidth: "drop table users",
          },
        ],
      });

      const state = loadTabs(dir);
      expect(state.tabs).toHaveLength(1);
      expect(state.tabs[0].sqlDraft?.length).toBe(16_000);
      expect(state.tabs[0].historyHeight).toBeUndefined();
      expect(state.tabs[0].sidebarWidth).toBeUndefined();
    });
  });

  test("caps tabs at 64 and ignores prototype-shaped fields", () => {
    withTempProject((dir) => {
      const storeDir = join(dir, ".code-viewer");
      mkdirSync(storeDir, { recursive: true });
      const tabs = Array.from({ length: 70 }, (_, index) => ({
        id: `tab-${index}`,
        dbId: "db.sqlite",
        table: "users",
        view: "data",
        __proto__: { polluted: true },
        constructor: { prototype: { polluted: true } },
      }));
      writeFileSync(
        join(storeDir, "tabs.json"),
        JSON.stringify({ version: 1, activeTabId: "tab-69", tabs }),
        "utf8",
      );

      const state = loadTabs(dir);
      expect(state.tabs).toHaveLength(64);
      expect(state.activeTabId).toBe("tab-0");
      expect(
        (Object.prototype as Record<string, unknown>).polluted,
      ).toBeUndefined();
    });
  });

  test("returns an empty state for non-object JSON values", () => {
    withTempProject((dir) => {
      const storeDir = join(dir, ".code-viewer");
      mkdirSync(storeDir, { recursive: true });
      writeFileSync(join(storeDir, "tabs.json"), "null", "utf8");

      expect(loadTabs(dir)).toEqual({
        version: 1,
        activeTabId: null,
        tabs: [],
      });
    });
  });
});
