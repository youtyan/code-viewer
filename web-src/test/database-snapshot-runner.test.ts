import { describe, expect, test } from "bun:test";
import { runSnapshot } from "../server/database/snapshot-runner";
import {
  computeDiffTables,
  listSnapshots,
} from "../server/database/snapshot-store";
import type { SnapshotItem } from "../server/database/sources/types";
import { withTempDir } from "./_test-helpers";

function withTempProject<T>(run: (dir: string) => Promise<T>): Promise<T> {
  return withTempDir("code-viewer-snapshot-runner-", run);
}

describe("database snapshot runner", () => {
  test("rejects incomplete snapshot capability sources with an explicit error", async () => {
    await withTempProject(async (dir) => {
      const source = {
        kind: "sqlite" as const,
        capabilities: { snapshot: true as const },
      };

      let message = "";
      try {
        await runSnapshot(dir, source, "db.sqlite", ["users"], "");
      } catch (err) {
        message = err instanceof Error ? err.message : String(err);
      }

      expect(message).toBe(
        "data source does not support snapshot (missing SnapshotIterable capability)",
      );
      expect(await listSnapshots(dir)).toHaveLength(0);
    });
  });

  test("passes cancellation through and finalizes the snapshot as error", async () => {
    await withTempProject(async (dir) => {
      const abort = new AbortController();
      let iterated = false;
      const source = {
        kind: "sqlite" as const,
        capabilities: { snapshot: true as const },
        async *iterateForSnapshot(
          _container: string,
          signal?: AbortSignal,
        ): AsyncIterable<SnapshotItem> {
          iterated = true;
          if (signal?.aborted) return;
          yield {
            keyJson: JSON.stringify({ id: 1 }),
            payloadJson: JSON.stringify({ id: 1 }),
            rowHash: "hash",
          };
        },
        async listSnapshotContainers() {
          return [{ id: "users", label: "users" }];
        },
      };

      let message = "";
      try {
        await runSnapshot(dir, source, "db.sqlite", ["users"], "", undefined, {
          signal: abort.signal,
          onSnapshotId: () => abort.abort(),
        });
      } catch (err) {
        message = err instanceof Error ? err.message : String(err);
      }

      expect(message).toBe("snapshot cancelled");
      expect(iterated).toBe(false);
      const snapshots = await listSnapshots(dir);
      expect(snapshots).toHaveLength(1);
      expect(snapshots[0].status).toBe("error");
      expect(snapshots[0].errorMessage).toBe("snapshot cancelled");
    });
  });

  test("finalizes the snapshot as error when onSnapshotId throws", async () => {
    await withTempProject(async (dir) => {
      const source = {
        kind: "sqlite" as const,
        capabilities: { snapshot: true as const },
        async *iterateForSnapshot(): AsyncIterable<SnapshotItem> {
          yield {
            keyJson: JSON.stringify({ id: 1 }),
            payloadJson: JSON.stringify({ id: 1 }),
            rowHash: "hash",
          };
        },
        async listSnapshotContainers() {
          return [{ id: "users", label: "users" }];
        },
      };

      let message = "";
      try {
        await runSnapshot(dir, source, "db.sqlite", ["users"], "", undefined, {
          onSnapshotId: () => {
            throw new Error("snapshot started callback failed");
          },
        });
      } catch (err) {
        message = err instanceof Error ? err.message : String(err);
      }

      expect(message).toBe("snapshot started callback failed");
      const snapshots = await listSnapshots(dir);
      expect(snapshots).toHaveLength(1);
      expect(snapshots[0].status).toBe("error");
      expect(snapshots[0].errorMessage).toBe(
        "snapshot started callback failed",
      );
    });
  });

  test("stores schema metadata and rejects cross-schema diffs", async () => {
    await withTempProject(async (dir) => {
      const source = {
        kind: "postgresql" as const,
        capabilities: { snapshot: true as const },
        async *iterateForSnapshot(): AsyncIterable<SnapshotItem> {
          yield {
            keyJson: JSON.stringify({ id: 1 }),
            payloadJson: JSON.stringify({ id: 1 }),
            rowHash: "hash",
          };
        },
        async listSnapshotContainers() {
          return [{ id: "users", label: "users" }];
        },
      };

      await runSnapshot(
        dir,
        source,
        "docker:pg:app",
        ["users"],
        "",
        undefined,
        {
          schema: "tenant_a",
        },
      );
      await runSnapshot(
        dir,
        source,
        "docker:pg:app",
        ["users"],
        "",
        undefined,
        {
          schema: "tenant_b",
        },
      );

      const tenantA = await listSnapshots(dir, "docker:pg:app", "tenant_a");
      const tenantB = await listSnapshots(dir, "docker:pg:app", "tenant_b");
      expect(tenantA).toHaveLength(1);
      expect(tenantA[0].schema).toBe("tenant_a");
      expect(tenantB).toHaveLength(1);
      expect(tenantB[0].schema).toBe("tenant_b");

      let message = "";
      try {
        await computeDiffTables(dir, tenantA[0].id, tenantB[0].id);
      } catch (err) {
        message = err instanceof Error ? err.message : String(err);
      }
      expect(message).toMatch(/different database\/schema/);
    });
  });

  test("onProgress reports container/index/total + finalization", async () => {
    await withTempProject(async (dir) => {
      const source = {
        kind: "sqlite" as const,
        capabilities: { snapshot: true as const },
        async *iterateForSnapshot(): AsyncIterable<SnapshotItem> {
          yield {
            keyJson: JSON.stringify({ id: 1 }),
            payloadJson: JSON.stringify({ id: 1 }),
            rowHash: "hash",
          };
        },
        async listSnapshotContainers() {
          return [
            { id: "users", label: "users" },
            { id: "posts", label: "posts" },
            { id: "comments", label: "comments" },
          ];
        },
      };

      const events: Array<{
        container: string;
        done: boolean;
        index: number;
        total: number;
      }> = [];
      await runSnapshot(
        dir,
        source,
        "db.sqlite",
        ["users", "posts", "comments"],
        "",
        (progress) => events.push({ ...progress }),
      );

      // テーブル開始イベント × 3 + 最終 done × 1
      expect(events).toHaveLength(4);
      expect(events[0]).toEqual({
        container: "users",
        done: false,
        index: 0,
        total: 3,
      });
      expect(events[1]).toEqual({
        container: "posts",
        done: false,
        index: 1,
        total: 3,
      });
      expect(events[2]).toEqual({
        container: "comments",
        done: false,
        index: 2,
        total: 3,
      });
      // 最終 finalize イベントは container 空 + done=true、index==total
      expect(events[3]).toEqual({
        container: "",
        done: true,
        index: 3,
        total: 3,
      });
    });
  });

  test("computeDiffTables annotates coverage for one-sided snapshots", async () => {
    await withTempProject(async (dir) => {
      // before: users のみ取得 / after: users + posts 取得
      // → users は両方 (coverage=both)、posts は after-only
      const source = {
        kind: "sqlite" as const,
        capabilities: { snapshot: true as const },
        async *iterateForSnapshot(
          container: string,
        ): AsyncIterable<SnapshotItem> {
          yield {
            keyJson: JSON.stringify({ table: container, id: 1 }),
            payloadJson: JSON.stringify({ id: 1 }),
            rowHash: `${container}-hash`,
          };
        },
        async listSnapshotContainers() {
          return [
            { id: "users", label: "users" },
            { id: "posts", label: "posts" },
          ];
        },
      };

      await runSnapshot(dir, source, "db.sqlite", ["users"], "before-snap");
      await runSnapshot(
        dir,
        source,
        "db.sqlite",
        ["users", "posts"],
        "after-snap",
      );

      const snapshots = await listSnapshots(dir, "db.sqlite");
      expect(snapshots).toHaveLength(2);
      // created_at の解像度に依存しないよう note で取得側を識別する。
      const before = snapshots.find((s) => s.note === "before-snap");
      const after = snapshots.find((s) => s.note === "after-snap");
      if (!before || !after) throw new Error("snapshot note not found");

      const diffs = await computeDiffTables(dir, before.id, after.id);
      const users = diffs.find((d) => d.tableName === "users");
      const posts = diffs.find((d) => d.tableName === "posts");

      expect(users?.coverage).toBe("both");
      expect(posts?.coverage).toBe("after-only");
      // after-only は「全行 insert」と表示するのではなく、未取得側の row 数を
      // 参考情報として返し、insertedCount は 0 にする (誤誘導防止)。
      expect(posts?.insertedCount).toBe(0);
      expect(posts?.unsnapshottedRowCount).toBe(1);
    });
  });
});
