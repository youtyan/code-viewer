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
import { loadTabsAsync, saveTabsAsync } from "../server/database/tabs-store";

async function withTempProject(
  run: (dir: string) => void | Promise<void>,
): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "code-viewer-tabs-"));
  try {
    await run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("database tabs store", () => {
  test("async load treats a missing tabs file as empty without creating backups", async () => {
    const dir = mkdtempSync(join(tmpdir(), "code-viewer-tabs-"));
    try {
      mkdirSync(join(dir, ".code-viewer"), { recursive: true });

      expect(await loadTabsAsync(dir)).toEqual({
        version: 1,
        activeTabId: null,
        tabs: [],
      });
      expect(readdirSync(join(dir, ".code-viewer"))).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("persists sanitized tabs in the caller-provided order", async () => {
    await withTempProject(async (dir) => {
      await saveTabsAsync(dir, {
        version: 1,
        activeTabId: "tab-2",
        tabs: [
          {
            id: "tab-1",
            dbId: "one.db",
            schema: "main",
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
          {
            id: "tab-3",
            dbId: "s3:local",
            table: null,
            view: "data",
            s3: {
              bucket: "logs",
              prefix: "2026/",
              query: "error",
              mode: "contains",
              sort: "updated-desc",
              key: "2026/app.log",
            },
          },
        ],
      });

      expect(await loadTabsAsync(dir)).toEqual({
        version: 1,
        activeTabId: "tab-2",
        tabs: [
          {
            id: "tab-1",
            dbId: "one.db",
            schema: "main",
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
          {
            id: "tab-3",
            dbId: "s3:local",
            table: null,
            view: "data",
            s3: {
              bucket: "logs",
              prefix: "2026/",
              query: "error",
              mode: "contains",
              sort: "updated-desc",
              key: "2026/app.log",
            },
          },
        ],
      });
    });
  });

  test("drops duplicate ids and resets active tab to the first surviving tab", async () => {
    await withTempProject(async (dir) => {
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

      expect(await loadTabsAsync(dir)).toEqual({
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

  test("drops tabs pointing at code-viewer internal databases", async () => {
    await withTempProject(async (dir) => {
      await saveTabsAsync(dir, {
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

      expect(await loadTabsAsync(dir)).toEqual({
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

  test("backs up invalid JSON and returns an empty state", async () => {
    await withTempProject(async (dir) => {
      const storeDir = join(dir, ".code-viewer");
      mkdirSync(storeDir, { recursive: true });
      writeFileSync(join(storeDir, "tabs.json"), "{broken", "utf8");

      expect(await loadTabsAsync(dir)).toEqual({
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

  test("truncates large drafts and rejects unsafe css sizes", async () => {
    await withTempProject(async (dir) => {
      await saveTabsAsync(dir, {
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

      const state = await loadTabsAsync(dir);
      expect(state.tabs).toHaveLength(1);
      expect(state.tabs[0].sqlDraft?.length).toBe(16_000);
      expect(state.tabs[0].historyHeight).toBeUndefined();
      expect(state.tabs[0].sidebarWidth).toBeUndefined();
    });
  });

  test("caps tabs at 64 and ignores prototype-shaped fields", async () => {
    await withTempProject(async (dir) => {
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

      const state = await loadTabsAsync(dir);
      expect(state.tabs).toHaveLength(64);
      expect(state.activeTabId).toBe("tab-0");
      expect(
        (Object.prototype as Record<string, unknown>).polluted,
      ).toBeUndefined();
    });
  });

  test("returns an empty state for non-object JSON values", async () => {
    await withTempProject(async (dir) => {
      const storeDir = join(dir, ".code-viewer");
      mkdirSync(storeDir, { recursive: true });
      writeFileSync(join(storeDir, "tabs.json"), "null", "utf8");

      expect(await loadTabsAsync(dir)).toEqual({
        version: 1,
        activeTabId: null,
        tabs: [],
      });
    });
  });
});
