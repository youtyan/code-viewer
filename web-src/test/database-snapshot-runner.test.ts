import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSnapshot } from "../server/database/snapshot-runner";
import {
  computeDiffTables,
  listSnapshots,
} from "../server/database/snapshot-store";
import type { SnapshotItem } from "../server/database/sources/types";

function withTempProject<T>(run: (dir: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "code-viewer-snapshot-runner-"));
  return run(dir).finally(() => {
    rmSync(dir, { recursive: true, force: true });
  });
}

describe("database snapshot runner", () => {
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
});
