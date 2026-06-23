import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSnapshot } from "../server/database/snapshot-runner";
import { listSnapshots } from "../server/database/snapshot-store";
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
});
