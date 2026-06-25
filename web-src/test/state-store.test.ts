import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleStateRoute } from "../server/state-route";
import {
  loadAppSettingsState,
  loadDbUiState,
  loadViewState,
  patchAppSettingsState,
  patchDbUiState,
  patchViewState,
} from "../server/state-store";

// ai-dup-check: allow -- local temp-project helper keeps this store test self-contained.
async function withTempProject(
  run: (dir: string) => void | Promise<void>,
): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "code-viewer-state-"));
  try {
    await run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("state store", () => {
  test("settings patch sanitizes values and supports null deletes", async () => {
    await withTempProject(async (dir) => {
      expect(await loadAppSettingsState(dir)).toEqual({ version: 1 });

      expect(
        await patchAppSettingsState(dir, {
          layout: "line-by-line",
          theme: "dark",
          language: "ja",
          sidebarWidth: 9999,
          annotationRate: 1.5,
          scopeOmitDirs: ["node_modules", "../bad", "dist"],
          range: { from: "HEAD~1", to: "worktree" },
          unknown: "ignored",
        }),
      ).toEqual({
        version: 1,
        layout: "line-by-line",
        theme: "dark",
        language: "ja",
        sidebarWidth: 900,
        annotationRate: 1.5,
        scopeOmitDirs: ["dist", "node_modules"],
        range: { from: "HEAD~1", to: "worktree" },
      });

      expect(
        await patchAppSettingsState(dir, {
          theme: null,
          range: null,
        }),
      ).toEqual({
        version: 1,
        layout: "line-by-line",
        language: "ja",
        sidebarWidth: 900,
        annotationRate: 1.5,
        scopeOmitDirs: ["dist", "node_modules"],
      });
    });
  });

  test("view state keeps bounded normalized path lists", async () => {
    await withTempProject(async (dir) => {
      expect(await loadViewState(dir)).toEqual({
        version: 1,
        collapsedDirs: [],
        viewedFiles: [],
      });
      expect(
        await patchViewState(dir, {
          addedCollapsedDirs: ["web-src", "src", "src", ""],
          addedViewedFiles: ["b.ts", "a.ts", "b.ts"],
        }),
      ).toEqual({
        version: 1,
        collapsedDirs: ["web-src", "src"],
        viewedFiles: ["a.ts", "b.ts"],
      });
      expect(
        await patchViewState(dir, {
          addedViewedFiles: ["c.ts", "a.ts"],
          removedViewedFiles: ["b.ts"],
          addedCollapsedDirs: ["packages"],
          removedCollapsedDirs: ["src"],
        }),
      ).toEqual({
        version: 1,
        collapsedDirs: ["web-src", "packages"],
        viewedFiles: ["a.ts", "c.ts"],
      });
      expect(
        await patchViewState(dir, {
          addedViewedFiles: ["c.ts", "d.ts"],
          removedViewedFiles: ["c.ts"],
          addedCollapsedDirs: ["packages", "tmp"],
          removedCollapsedDirs: ["tmp"],
        }),
      ).toEqual({
        version: 1,
        collapsedDirs: ["web-src", "packages"],
        viewedFiles: ["a.ts", "d.ts"],
      });
      expect(
        await patchViewState(dir, {
          collapsedDirs: ["should-not-replace"],
          viewedFiles: ["should-not-replace"],
        }),
      ).toEqual({
        version: 1,
        collapsedDirs: ["web-src", "packages"],
        viewedFiles: ["a.ts", "d.ts"],
      });
    });
  });

  test("view state keeps recent items when exceeding the cap", async () => {
    await withTempProject(async (dir) => {
      const viewed = Array.from({ length: 20_005 }, (_, i) => `file-${i}.ts`);
      const state = await patchViewState(dir, { addedViewedFiles: viewed });
      expect(state.viewedFiles).toHaveLength(20_000);
      expect(state.viewedFiles[0]).toBe("file-5.ts");
      expect(state.viewedFiles[state.viewedFiles.length - 1]).toBe(
        "file-20004.ts",
      );
    });
  });

  test("db ui column widths merge by db and table", async () => {
    await withTempProject(async (dir) => {
      expect(await loadDbUiState(dir)).toEqual({
        version: 1,
        columnWidths: {},
      });

      await patchDbUiState(dir, {
        columnWidths: {
          "one.db": {
            users: { id: 80, name: 240 },
          },
        },
      });
      expect(
        await patchDbUiState(dir, {
          columnWidths: {
            "one.db": {
              posts: { title: 320 },
            },
            "two.db": {
              events: { created_at: 180 },
            },
          },
        }),
      ).toEqual({
        version: 1,
        columnWidths: {
          "one.db": {
            users: { id: 80, name: 240 },
            posts: { title: 320 },
          },
          "two.db": {
            events: { created_at: 180 },
          },
        },
      });

      expect(
        await patchDbUiState(dir, {
          columnWidths: {
            "one.db": {
              users: { name: 280 },
            },
          },
        }),
      ).toEqual({
        version: 1,
        columnWidths: {
          "one.db": {
            users: { id: 80, name: 280 },
            posts: { title: 320 },
          },
          "two.db": {
            events: { created_at: 180 },
          },
        },
      });

      expect(
        await patchDbUiState(dir, {
          columnWidths: {
            "one.db": {
              users: { id: null },
              posts: null,
            },
            "two.db": null,
          },
        }),
      ).toEqual({
        version: 1,
        columnWidths: {
          "one.db": {
            users: { name: 280 },
          },
        },
      });
    });
  });

  test("state PATCH rejects oversized request bodies before JSON parsing", async () => {
    await withTempProject(async (dir) => {
      const req = new Request("http://localhost/_state/settings", {
        method: "PATCH",
        headers: {
          "content-length": "1000001",
          "content-type": "application/json",
        },
      });
      const res = await handleStateRoute(
        req,
        new URL("http://localhost/_state/settings"),
        dir,
        () => true,
      );
      expect(res?.status).toBe(413);
      expect(await res?.text()).toBe("state body too large");
    });
  });

  test("state GET returns a generic error for filesystem failures", async () => {
    await withTempProject(async (dir) => {
      const originalError = console.error;
      console.error = () => {};
      mkdirSync(join(dir, ".code-viewer", "settings.json"), {
        recursive: true,
      });
      try {
        const res = await handleStateRoute(
          new Request("http://localhost/_state/settings"),
          new URL("http://localhost/_state/settings"),
          dir,
          () => true,
        );
        expect(res?.status).toBe(500);
        expect(await res?.text()).toBe("failed to load settings state");
      } finally {
        console.error = originalError;
      }
    });
  });
});
