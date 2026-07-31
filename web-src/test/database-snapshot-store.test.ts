import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { runSnapshot } from "../server/database/snapshot-runner";
import {
  computeDiffRows,
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
  exec(sql: string): void;
  close(): void;
};

function hashString(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

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
          rowHash: hashString(payloadJson),
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

function insertLegacySnapshotRows(
  db: RawSqliteDb,
  snapshotId: string,
  payloadById: Map<string, string>,
) {
  db.prepare(
    "INSERT INTO snapshots (id, db_id, schema_name, kind, note, created_at, status) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(
    snapshotId,
    "db.sqlite",
    null,
    "sqlite",
    "legacy-before",
    "2026-07-01T00:00:00.000Z",
    "done",
  );
  db.prepare(
    "INSERT INTO snapshot_tables (snapshot_id, table_name, row_count, table_hash, pk_columns_json) VALUES (?, ?, ?, ?, ?)",
  ).run(
    snapshotId,
    "users",
    payloadById.size,
    "legacy-table-hash",
    JSON.stringify(["id"]),
  );
  for (const [id, payloadJson] of payloadById) {
    const rowKeyJson = JSON.stringify({ id });
    const payloadHash = hashString(payloadJson);
    db.prepare(
      "INSERT OR IGNORE INTO snapshot_payloads (payload_hash, payload_json) VALUES (?, ?)",
    ).run(payloadHash, payloadJson);
    db.prepare(
      "INSERT INTO snapshot_rows (snapshot_id, table_name, row_key_hash, row_key_json, row_hash, payload_hash) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(
      snapshotId,
      "users",
      hashString(rowKeyJson),
      rowKeyJson,
      hashString(payloadJson),
      payloadHash,
    );
  }
}

function createOldSnapshotSchema(db: RawSqliteDb) {
  db.exec(`
CREATE TABLE snapshots (
  id TEXT PRIMARY KEY,
  db_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  error_message TEXT
);

CREATE TABLE snapshot_tables (
  snapshot_id TEXT NOT NULL,
  table_name TEXT NOT NULL,
  row_count INTEGER NOT NULL DEFAULT 0,
  table_hash TEXT NOT NULL DEFAULT '',
  pk_columns_json TEXT NOT NULL DEFAULT '[]',
  PRIMARY KEY (snapshot_id, table_name),
  FOREIGN KEY (snapshot_id) REFERENCES snapshots(id) ON DELETE CASCADE
);

CREATE TABLE snapshot_rows (
  snapshot_id TEXT NOT NULL,
  table_name TEXT NOT NULL,
  row_key_hash TEXT NOT NULL,
  row_key_json TEXT NOT NULL,
  row_hash TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  PRIMARY KEY (snapshot_id, table_name, row_key_hash),
  FOREIGN KEY (snapshot_id) REFERENCES snapshots(id) ON DELETE CASCADE
);

CREATE TABLE snapshot_payloads (
  payload_hash TEXT PRIMARY KEY,
  payload_json TEXT NOT NULL
);
`);
}

function insertOldSchemaSnapshotRows(
  db: RawSqliteDb,
  snapshotId: string,
  payloadById: Map<string, string>,
) {
  db.prepare(
    "INSERT INTO snapshots (id, db_id, kind, note, created_at, status) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(
    snapshotId,
    "db.sqlite",
    "sqlite",
    "old-before",
    "2026-07-01T00:00:00.000Z",
    "done",
  );
  db.prepare(
    "INSERT INTO snapshot_tables (snapshot_id, table_name, row_count, table_hash, pk_columns_json) VALUES (?, ?, ?, ?, ?)",
  ).run(
    snapshotId,
    "users",
    payloadById.size,
    "old-table-hash",
    JSON.stringify(["id"]),
  );
  for (const [id, payloadJson] of payloadById) {
    const rowKeyJson = JSON.stringify({ id });
    const payloadHash = hashString(payloadJson);
    db.prepare(
      "INSERT INTO snapshot_payloads (payload_hash, payload_json) VALUES (?, ?)",
    ).run(payloadHash, payloadJson);
    db.prepare(
      "INSERT INTO snapshot_rows (snapshot_id, table_name, row_key_hash, row_key_json, row_hash, payload_hash) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(
      snapshotId,
      "users",
      hashString(rowKeyJson),
      rowKeyJson,
      hashString(payloadJson),
      payloadHash,
    );
  }
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

  test("shares identical table revisions and keeps shared rows after deleting one snapshot", async () => {
    await withTempProject(async (dir) => {
      const payloads = new Map([
        ["1", JSON.stringify({ id: 1, name: "sample one" })],
        ["2", JSON.stringify({ id: 2, name: "sample two" })],
      ]);

      await runSnapshot(
        dir,
        makeSqliteSource(payloads),
        "db.sqlite",
        ["users"],
        "first",
      );
      await runSnapshot(
        dir,
        makeSqliteSource(payloads),
        "db.sqlite",
        ["users"],
        "second",
      );

      const snapshots = await listSnapshots(dir, "db.sqlite");
      const first = snapshots.find((s) => s.note === "first");
      const second = snapshots.find((s) => s.note === "second");
      if (!first || !second) throw new Error("snapshot note not found");

      let db = await openStoreDb(dir);
      try {
        const rows = db
          .prepare(
            `SELECT s.note, st.revision_id
             FROM snapshot_tables st
             INNER JOIN snapshots s ON s.id = st.snapshot_id
             WHERE st.table_name = ?
             ORDER BY s.note`,
          )
          .all("users") as { note: string; revision_id: string }[];
        expect(rows).toHaveLength(2);
        expect(rows[0].revision_id).toBe(rows[1].revision_id);

        const revisionRows = db
          .prepare(
            "SELECT COUNT(*) AS n FROM snapshot_table_revision_rows WHERE revision_id = ?",
          )
          .get(rows[0].revision_id) as { n: number };
        expect(revisionRows.n).toBe(2);
      } finally {
        db.close();
      }

      await deleteSnapshot(dir, first.id);

      db = await openStoreDb(dir);
      try {
        const remainingRevisionRows = db
          .prepare("SELECT COUNT(*) AS n FROM snapshot_table_revision_rows")
          .get() as { n: number };
        expect(remainingRevisionRows.n).toBe(2);

        const remainingRevisions = db
          .prepare("SELECT COUNT(*) AS n FROM snapshot_table_revisions")
          .get() as { n: number };
        expect(remainingRevisions.n).toBe(1);
      } finally {
        db.close();
      }

      const unchanged = await computeDiffRows(
        dir,
        second.id,
        second.id,
        "users",
      );
      expect(unchanged.total).toBe(0);

      await deleteSnapshot(dir, second.id);

      db = await openStoreDb(dir);
      try {
        const revisionCount = db
          .prepare("SELECT COUNT(*) AS n FROM snapshot_table_revisions")
          .get() as { n: number };
        expect(revisionCount.n).toBe(0);

        const revisionRowCount = db
          .prepare("SELECT COUNT(*) AS n FROM snapshot_table_revision_rows")
          .get() as { n: number };
        expect(revisionRowCount.n).toBe(0);

        const payloadCount = db
          .prepare("SELECT COUNT(*) AS n FROM snapshot_payloads")
          .get() as { n: number };
        expect(payloadCount.n).toBe(0);
      } finally {
        db.close();
      }
    });
  });

  test("diffs legacy snapshot_rows against revision-backed snapshots", async () => {
    await withTempProject(async (dir) => {
      await runSnapshot(
        dir,
        makeSqliteSource(
          new Map([
            ["1", JSON.stringify({ id: 1, name: "sample one updated" })],
            ["3", JSON.stringify({ id: 3, name: "sample three" })],
          ]),
        ),
        "db.sqlite",
        ["users"],
        "revision-after",
      );

      const db = await openStoreDb(dir);
      try {
        insertLegacySnapshotRows(
          db,
          "snap-legacy-before",
          new Map([
            ["1", JSON.stringify({ id: 1, name: "sample one" })],
            ["2", JSON.stringify({ id: 2, name: "sample two" })],
          ]),
        );
      } finally {
        db.close();
      }

      const after = (await listSnapshots(dir, "db.sqlite")).find(
        (s) => s.note === "revision-after",
      );
      if (!after) throw new Error("revision-backed snapshot not found");

      const tableDiff = await computeDiffTables(
        dir,
        "snap-legacy-before",
        after.id,
      );
      expect(tableDiff).toHaveLength(1);
      expect({
        tableName: tableDiff[0].tableName,
        insertedCount: tableDiff[0].insertedCount,
        updatedCount: tableDiff[0].updatedCount,
        deletedCount: tableDiff[0].deletedCount,
        unchangedCount: tableDiff[0].unchangedCount,
        coverage: tableDiff[0].coverage,
      }).toEqual({
        tableName: "users",
        insertedCount: 1,
        updatedCount: 1,
        deletedCount: 1,
        unchangedCount: 0,
        coverage: "both",
      });

      const rowDiff = await computeDiffRows(
        dir,
        "snap-legacy-before",
        after.id,
        "users",
      );
      expect(rowDiff.total).toBe(3);
      expect(rowDiff.rows.map((r) => [r.changeType, r.rowKeyJson])).toEqual([
        ["updated", JSON.stringify({ id: "1" })],
        ["deleted", JSON.stringify({ id: "2" })],
        ["inserted", JSON.stringify({ id: "3" })],
      ]);
      const updated = rowDiff.rows.find((r) => r.changeType === "updated");
      expect(updated?.beforeValues).toEqual({
        id: 1,
        name: "sample one",
      });
      expect(updated?.afterValues).toEqual({
        id: 1,
        name: "sample one updated",
      });
    });
  });

  test("migrates old snapshot databases and reads them with revision-backed snapshots", async () => {
    await withTempProject(async (dir) => {
      mkdirSync(join(dir, ".code-viewer"), { recursive: true });
      let db = await openStoreDb(dir);
      try {
        createOldSnapshotSchema(db);
        insertOldSchemaSnapshotRows(
          db,
          "snap-old-before",
          new Map([
            ["1", JSON.stringify({ id: 1, name: "sample one" })],
            ["2", JSON.stringify({ id: 2, name: "sample two" })],
          ]),
        );
      } finally {
        db.close();
      }

      expect(
        (await listSnapshots(dir, "db.sqlite")).map((s) => s.note),
      ).toEqual(["old-before"]);

      await runSnapshot(
        dir,
        makeSqliteSource(
          new Map([
            ["1", JSON.stringify({ id: 1, name: "sample one updated" })],
            ["3", JSON.stringify({ id: 3, name: "sample three" })],
          ]),
        ),
        "db.sqlite",
        ["users"],
        "new-after",
      );

      const after = (await listSnapshots(dir, "db.sqlite")).find(
        (s) => s.note === "new-after",
      );
      if (!after) throw new Error("new snapshot not found");

      const diff = await computeDiffTables(dir, "snap-old-before", after.id);
      expect(diff[0].insertedCount).toBe(1);
      expect(diff[0].updatedCount).toBe(1);
      expect(diff[0].deletedCount).toBe(1);

      db = await openStoreDb(dir);
      try {
        const migrated = db
          .prepare(
            "SELECT revision_id FROM snapshot_tables WHERE snapshot_id = ? AND table_name = ?",
          )
          .get(after.id, "users") as { revision_id: string | null };
        expect(typeof migrated.revision_id).toBe("string");
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

  test("orphan cleanup query uses legacy and revision payload indexes", async () => {
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
        const indexes = db
          .prepare(
            `SELECT name FROM sqlite_master
             WHERE type='index'
               AND name IN (
                 'idx_snapshot_rows_payload_hash',
                 'idx_snapshot_table_revision_rows_payload_hash',
                 'idx_snapshot_table_revision_rows_revision_key'
               )`,
          )
          .all()
          .map((row) => row.name as string)
          .sort();
        expect(indexes).toEqual([
          "idx_snapshot_rows_payload_hash",
          "idx_snapshot_table_revision_rows_payload_hash",
          "idx_snapshot_table_revision_rows_revision_key",
        ]);

        const plan = db
          .prepare(
            `EXPLAIN QUERY PLAN
               SELECT 1 FROM snapshot_payloads
               WHERE NOT EXISTS (
                 SELECT 1 FROM snapshot_rows
                 WHERE snapshot_rows.payload_hash = snapshot_payloads.payload_hash
               )
               AND NOT EXISTS (
                 SELECT 1 FROM snapshot_table_revision_rows
                 WHERE snapshot_table_revision_rows.payload_hash = snapshot_payloads.payload_hash
               )`,
          )
          .all() as { detail: string }[];
        const detail = plan.map((row) => row.detail).join("\n");
        expect(detail).toMatch(/idx_snapshot_rows_payload_hash/);
        expect(detail).toMatch(/idx_snapshot_table_revision_rows_payload_hash/);
      } finally {
        db.close();
      }
    });
  });
});
