import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
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
  test.each([
    {
      name: "rounds an in-range integer setting",
      input: { sidebarWidth: 400.6 },
      expected: { version: 1, sidebarWidth: 401 },
    },
    {
      name: "clamps an integer setting below its minimum",
      input: { sidebarWidth: 0 },
      expected: { version: 1, sidebarWidth: 180 },
    },
    {
      name: "clamps an integer setting above its maximum",
      input: { sidebarWidth: 9_999 },
      expected: { version: 1, sidebarWidth: 900 },
    },
    {
      name: "preserves an in-range floating-point setting",
      input: { annotationRate: 1.25 },
      expected: { version: 1, annotationRate: 1.25 },
    },
    {
      name: "clamps a floating-point setting below its minimum",
      input: { annotationRate: 0 },
      expected: { version: 1, annotationRate: 0.5 },
    },
    {
      name: "clamps a floating-point setting above its maximum",
      input: { annotationRate: 4 },
      expected: { version: 1, annotationRate: 2 },
    },
  ])("settings numeric sanitizer $name", async ({ input, expected }) => {
    await withTempProject(async (dir) => {
      expect(await patchAppSettingsState(dir, input)).toEqual(expected);
    });
  });

  test("settings patch sanitizes values and supports null deletes", async () => {
    await withTempProject(async (dir) => {
      expect(await loadAppSettingsState(dir)).toEqual({ version: 1 });

      expect(
        await patchAppSettingsState(dir, {
          layout: "line-by-line",
          theme: "dark",
          language: "ja",
          sidebarWidth: 9999,
          annotationPanelWidth: 9999,
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
        annotationPanelWidth: 720,
        annotationRate: 1.5,
        scopeOmitDirs: ["dist", "node_modules"],
        range: { from: "HEAD~1", to: "worktree" },
      });

      expect(
        await patchAppSettingsState(dir, {
          theme: null,
          annotationPanelWidth: null,
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

  test("upload toggle round-trips through settings patch and notifies subscribers", async () => {
    await withTempProject(async (dir) => {
      const notified: Array<boolean | undefined> = [];
      const dispatch = async (body: unknown) => {
        const url = new URL("http://localhost/_state/settings");
        const req = new Request(url, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const res = await handleStateRoute(req, url, dir, () => true, {
          onSettingsChange: (state) => notified.push(state.uploadEnabled),
        });
        if (!res) throw new Error("no response");
        if (res.status !== 200)
          throw new Error(
            `unexpected status ${res.status}: ${await res.text()}`,
          );
        return res.json();
      };

      const disabled = await dispatch({ uploadEnabled: false });
      expect(disabled.uploadEnabled).toBe(false);
      expect((await loadAppSettingsState(dir)).uploadEnabled).toBe(false);

      const reenabled = await dispatch({ uploadEnabled: true });
      expect(reenabled.uploadEnabled).toBe(true);

      const cleared = await dispatch({ uploadEnabled: null });
      expect(cleared.uploadEnabled).toBeUndefined();
      expect((await loadAppSettingsState(dir)).uploadEnabled).toBeUndefined();

      expect(notified).toEqual([false, true, undefined]);
    });
  });

  test("view state keeps bounded normalized path lists", async () => {
    await withTempProject(async (dir) => {
      expect(await loadViewState(dir)).toEqual({
        version: 1,
        collapsedDirs: [],
        lazyExpandedDirs: [],
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
        lazyExpandedDirs: [],
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
        lazyExpandedDirs: [],
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
        lazyExpandedDirs: [],
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
        lazyExpandedDirs: [],
        viewedFiles: ["a.ts", "d.ts"],
      });
      // lazyExpandedDirs: add/remove と collapsedDirs との優先順位
      // 入力に重複 "docs" を入れて keepLast で uniq されることも確認。
      expect(
        await patchViewState(dir, {
          addedLazyExpandedDirs: ["docs", "apps", "docs"],
        }),
      ).toEqual({
        version: 1,
        collapsedDirs: ["web-src", "packages"],
        lazyExpandedDirs: ["apps", "docs"],
        viewedFiles: ["a.ts", "d.ts"],
      });
      // 同 path を collapsed と lazyExpanded 両方で渡すと collapsed が勝つ
      expect(
        await patchViewState(dir, {
          addedCollapsedDirs: ["docs"],
          addedLazyExpandedDirs: ["docs", "tools"],
        }),
      ).toEqual({
        version: 1,
        collapsedDirs: ["web-src", "packages", "docs"],
        lazyExpandedDirs: ["apps", "tools"],
        viewedFiles: ["a.ts", "d.ts"],
      });
      // 既存 lazyExpanded を removed で消せる
      expect(
        await patchViewState(dir, {
          removedLazyExpandedDirs: ["apps"],
        }),
      ).toEqual({
        version: 1,
        collapsedDirs: ["web-src", "packages", "docs"],
        lazyExpandedDirs: ["tools"],
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

  test("db ui expanded table accordions merge by scope", async () => {
    await withTempProject(async (dir) => {
      expect(
        await patchDbUiState(dir, {
          expandedTables: {
            "docker:postgres:app#schema=public": ["projects", "users"],
          },
        }),
      ).toEqual({
        version: 1,
        columnWidths: {},
        expandedTables: {
          "docker:postgres:app#schema=public": ["projects", "users"],
        },
      });

      expect(
        await patchDbUiState(dir, {
          expandedTables: {
            "docker:postgres:app#schema=public": ["projects"],
            "docker:postgres:app#schema=tenant": ["projects"],
          },
        }),
      ).toEqual({
        version: 1,
        columnWidths: {},
        expandedTables: {
          "docker:postgres:app#schema=public": ["projects"],
          "docker:postgres:app#schema=tenant": ["projects"],
        },
      });

      expect(
        await patchDbUiState(dir, {
          expandedTables: {
            "docker:postgres:app#schema=public": null,
          },
        } as unknown as Parameters<typeof patchDbUiState>[1]),
      ).toEqual({
        version: 1,
        columnWidths: {},
        expandedTables: {
          "docker:postgres:app#schema=tenant": ["projects"],
        },
      });
    });
  });

  test("db ui snapshot selected tables merge by scope", async () => {
    await withTempProject(async (dir) => {
      // 単一 scope に書き込み
      expect(
        await patchDbUiState(dir, {
          snapshotSelectedTables: {
            "docker:postgres:app#schema=public": ["users", "projects"],
          },
        }),
      ).toEqual({
        version: 1,
        columnWidths: {},
        snapshotSelectedTables: {
          "docker:postgres:app#schema=public": ["projects", "users"],
        },
      });

      // 別 scope を追加、既存 scope は維持
      expect(
        await patchDbUiState(dir, {
          snapshotSelectedTables: {
            "docker:postgres:app#schema=tenant": ["accounts"],
          },
        }),
      ).toEqual({
        version: 1,
        columnWidths: {},
        snapshotSelectedTables: {
          "docker:postgres:app#schema=public": ["projects", "users"],
          "docker:postgres:app#schema=tenant": ["accounts"],
        },
      });

      // null で scope 削除
      expect(
        await patchDbUiState(dir, {
          snapshotSelectedTables: {
            "docker:postgres:app#schema=public": null,
          },
        } as unknown as Parameters<typeof patchDbUiState>[1]),
      ).toEqual({
        version: 1,
        columnWidths: {},
        snapshotSelectedTables: {
          "docker:postgres:app#schema=tenant": ["accounts"],
        },
      });

      // 配列以外は merge 段階で受理されるが sanitize で drop され、結果として
      // 当該 scope が消える (expandedTables と同じ挙動)。
      expect(
        await patchDbUiState(dir, {
          snapshotSelectedTables: {
            "docker:postgres:app#schema=tenant": "not-an-array",
          },
        } as unknown as Parameters<typeof patchDbUiState>[1]),
      ).toEqual({
        version: 1,
        columnWidths: {},
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
      console.error = () => undefined;
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

  // prefs (s3TooltipEnabled, inferFkRails) を db-ui.json に集約した
  // ことで、boolean 永続化のテスト経路を増やした。
  describe("db ui prefs", () => {
    test("sanitize keeps known boolean prefs and drops anything else", async () => {
      await withTempProject(async (dir) => {
        // 未知キー / 非 boolean / 数値は無視。空 prefs は state に乗らない。
        const written = await patchDbUiState(dir, {
          prefs: {
            s3TooltipEnabled: true,
            inferFkRails: false,
            unknownPref: true,
            invalidType: 1,
          } as unknown as { [k: string]: unknown },
        });
        expect(written.prefs).toEqual({
          s3TooltipEnabled: true,
          inferFkRails: false,
        });
        const reloaded = await loadDbUiState(dir);
        expect(reloaded.prefs).toEqual({
          s3TooltipEnabled: true,
          inferFkRails: false,
        });
      });
    });

    test("merge updates / deletes individual prefs without touching others", async () => {
      await withTempProject(async (dir) => {
        await patchDbUiState(dir, {
          prefs: { s3TooltipEnabled: true, inferFkRails: true },
        });
        // 単独 key だけ更新しても他 key は維持される。
        const after1 = await patchDbUiState(dir, {
          prefs: { inferFkRails: false },
        });
        expect(after1.prefs).toEqual({
          s3TooltipEnabled: true,
          inferFkRails: false,
        });
        // null で個別 key を削除できる。
        const after2 = await patchDbUiState(dir, {
          prefs: { s3TooltipEnabled: null },
        } as unknown as Parameters<typeof patchDbUiState>[1]);
        expect(after2.prefs).toEqual({ inferFkRails: false });
        // 全部消えたら prefs ごと undefined に縮退する (空オブジェクトを残さない)。
        const after3 = await patchDbUiState(dir, {
          prefs: { inferFkRails: null },
        } as unknown as Parameters<typeof patchDbUiState>[1]);
        expect(after3.prefs).toBeUndefined();
      });
    });

    test("columnWidths and prefs are independent on patch", async () => {
      await withTempProject(async (dir) => {
        await patchDbUiState(dir, {
          columnWidths: { "a.db": { users: { id: 80 } } },
        });
        const afterPref = await patchDbUiState(dir, {
          prefs: { inferFkRails: true },
        });
        expect(afterPref.columnWidths).toEqual({
          "a.db": { users: { id: 80 } },
        });
        expect(afterPref.prefs).toEqual({ inferFkRails: true });
      });
    });
  });
});
