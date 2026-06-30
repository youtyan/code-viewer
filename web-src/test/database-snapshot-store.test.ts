import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { runSnapshot } from "../server/database/snapshot-runner";
import {
  computeDiffTables,
  deleteSnapshot,
  listSnapshots,
} from "../server/database/snapshot-store";
import type { SnapshotItem } from "../server/database/sources/types";
import { loadSqliteClass } from "../server/database/sqlite-driver";
import { withTempDir } from "./_test-helpers";

type RawSqliteDb = {
  prepare(sql: string): {
    all(...params: unknown[]): Record<string, unknown>[];
    get(...params: unknown[]): Record<string, unknown> | undefined;
    run(...params: unknown[]): { changes: number };
  };
  close(): void;
};

function withTempProject<T>(run: (dir: string) => Promise<T>): Promise<T> {
  return withTempDir("code-viewer-snapshot-store-", run);
}

function makeSqliteSource(payloadById: Map<string, string>) {
  return {
    kind: "sqlite" as const,
    capabilities: { snapshot: true as const },
    async *iterateForSnapshot(_container: string): AsyncIterable<SnapshotItem> {
      for (const [id, payloadJson] of payloadById) {
        yield {
          keyJson: JSON.stringify({ id }),
          payloadJson,
          rowHash: `hash-${id}-${payloadJson.length}`,
        };
      }
    },
    async listSnapshotContainers() {
      return [{ id: "users", label: "users" }];
    },
  };
}

async function openStoreDb(dir: string): Promise<RawSqliteDb> {
  const DbClass = await loadSqliteClass<RawSqliteDb>();
  return new DbClass(join(dir, ".code-viewer", "db-snapshots.sqlite"));
}

describe("snapshot-store", () => {
  test("normalizes Docker snapshot db ids and lists encoded/decoded rel dir forms together", async () => {
    await withTempProject(async (dir) => {
      const decoded = "docker:db-service@sample/data/postgresql:application";
      const encoded =
        "docker:db-service@sample%2Fdata%2Fpostgresql:application";
      const src = () =>
        makeSqliteSource(new Map([["1", JSON.stringify({ v: 1 })]]));

      await runSnapshot(dir, src(), decoded, ["users"], "decoded-create");

      const byEncoded = await listSnapshots(dir, encoded);
      expect(byEncoded.map((s) => s.note)).toEqual(["decoded-create"]);
      expect(byEncoded[0].dbId).toBe(encoded);

      const byDecoded = await listSnapshots(dir, decoded);
      expect(byDecoded.map((s) => s.note)).toEqual(["decoded-create"]);
      expect(byDecoded[0].dbId).toBe(encoded);

      const db = await openStoreDb(dir);
      try {
        db.prepare(
          "INSERT INTO snapshots (id, db_id, schema_name, kind, note, created_at, status) VALUES (?, ?, ?, ?, ?, ?, ?)",
        ).run(
          "snap-legacy-decoded",
          decoded,
          null,
          "postgresql",
          "legacy-decoded",
          "2026-07-01T00:00:00.000Z",
          "done",
        );
      } finally {
        db.close();
      }

      expect(
        (await listSnapshots(dir, encoded)).map((s) => s.note).sort(),
      ).toEqual(["decoded-create", "legacy-decoded"]);

      const diff = await computeDiffTables(
        dir,
        "snap-legacy-decoded",
        byEncoded[0].id,
      );
      expect(diff.map((d) => d.tableName)).toEqual(["users"]);
    });
  });

  test("deleteSnapshot removes orphan payloads but keeps payloads still referenced", async () => {
    await withTempProject(async (dir) => {
      // before: payload A (unique) + payload SHARED
      await runSnapshot(
        dir,
        makeSqliteSource(
          new Map([
            ["1", JSON.stringify({ v: "A" })],
            ["2", JSON.stringify({ v: "SHARED" })],
          ]),
        ),
        "db.sqlite",
        ["users"],
        "before",
      );
      // after: payload B (unique) + payload SHARED
      await runSnapshot(
        dir,
        makeSqliteSource(
          new Map([
            ["3", JSON.stringify({ v: "B" })],
            ["4", JSON.stringify({ v: "SHARED" })],
          ]),
        ),
        "db.sqlite",
        ["users"],
        "after",
      );

      const snapshots = await listSnapshots(dir, "db.sqlite");
      const before = snapshots.find((s) => s.note === "before");
      if (!before) throw new Error("before snapshot not found");

      const db = await openStoreDb(dir);
      try {
        const beforeCount = (
          db.prepare("SELECT COUNT(*) AS n FROM snapshot_payloads").get() as {
            n: number;
          }
        ).n;
        expect(beforeCount).toBe(3); // A, B, SHARED

        await deleteSnapshot(dir, before.id);

        const remaining = db
          .prepare("SELECT payload_json FROM snapshot_payloads")
          .all() as { payload_json: string }[];
        const remainingValues = remaining
          .map((r) => JSON.parse(r.payload_json).v as string)
          .sort();
        // orphan A は消える / SHARED は after snapshot からまだ参照されるので残る
        // B も残る
        expect(remainingValues).toEqual(["B", "SHARED"]);
      } finally {
        db.close();
      }
    });
  });

  test("listSnapshots filters by schema alone (dbId undefined) using COALESCE(schema_name, 'public')", async () => {
    await withTempProject(async (dir) => {
      const src = () =>
        makeSqliteSource(new Map([["1", JSON.stringify({ v: 1 })]]));

      // analytics schema 経由 (db.sqlite / db2.sqlite の両方に作る)
      await runSnapshot(
        dir,
        src(),
        "db.sqlite",
        ["users"],
        "analytics-on-db1",
        undefined,
        { schema: "analytics" },
      );
      await runSnapshot(
        dir,
        src(),
        "db2.sqlite",
        ["users"],
        "analytics-on-db2",
        undefined,
        { schema: "analytics" },
      );
      // 別 schema
      await runSnapshot(
        dir,
        src(),
        "db.sqlite",
        ["users"],
        "reporting-on-db1",
        undefined,
        { schema: "reporting" },
      );
      // schema 未指定 (schema_name = NULL) → COALESCE で 'public' 扱い
      await runSnapshot(dir, src(), "db.sqlite", ["users"], "default-on-db1");

      // schema-only: analytics のみが両 db 分返る
      const analyticsOnly = await listSnapshots(dir, undefined, "analytics");
      expect(analyticsOnly.map((s) => s.note).sort()).toEqual([
        "analytics-on-db1",
        "analytics-on-db2",
      ]);

      // schema-only: 'public' は schema 未指定の snapshot (NULL) にマッチ
      const publicOnly = await listSnapshots(dir, undefined, "public");
      expect(publicOnly.map((s) => s.note)).toEqual(["default-on-db1"]);

      // schema-only: 該当なし
      const empty = await listSnapshots(dir, undefined, "no-such-schema");
      expect(empty).toEqual([]);

      // 既存挙動の後方互換:
      // - 引数なし → 全件
      expect((await listSnapshots(dir)).map((s) => s.note).sort()).toEqual([
        "analytics-on-db1",
        "analytics-on-db2",
        "default-on-db1",
        "reporting-on-db1",
      ]);
      // - dbId のみ → その db の全 schema
      expect(
        (await listSnapshots(dir, "db.sqlite")).map((s) => s.note).sort(),
      ).toEqual(["analytics-on-db1", "default-on-db1", "reporting-on-db1"]);
      // - dbId + schema → 両条件 AND
      expect(
        (await listSnapshots(dir, "db.sqlite", "analytics")).map((s) => s.note),
      ).toEqual(["analytics-on-db1"]);
    });
  });

  test("orphan cleanup query uses idx_snapshot_rows_payload_hash via EXPLAIN QUERY PLAN", async () => {
    await withTempProject(async (dir) => {
      // store schema を起こすため snapshot を 1 回作る
      await runSnapshot(
        dir,
        makeSqliteSource(new Map([["1", JSON.stringify({ v: "A" })]])),
        "db.sqlite",
        ["users"],
        "seed",
      );

      const db = await openStoreDb(dir);
      try {
        // index 自体が登録されていること
        const idx = db
          .prepare(
            "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_snapshot_rows_payload_hash'",
          )
          .get() as { name?: string } | undefined;
        expect(idx?.name).toBe("idx_snapshot_rows_payload_hash");

        // deleteSnapshot 内の orphan cleanup と同じサブクエリの query plan に
        // この index 名が現れること (planner が選んでいる証拠)。
        const plan = db
          .prepare(
            `EXPLAIN QUERY PLAN
               SELECT 1 FROM snapshot_payloads
               WHERE NOT EXISTS (
                 SELECT 1 FROM snapshot_rows
                 WHERE snapshot_rows.payload_hash = snapshot_payloads.payload_hash
               )`,
          )
          .all() as { detail: string }[];
        const detail = plan.map((row) => row.detail).join("\n");
        expect(detail).toMatch(/idx_snapshot_rows_payload_hash/);
      } finally {
        db.close();
      }
    });
  });
});
