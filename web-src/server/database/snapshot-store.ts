import { createHash, randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type {
  DbKind,
  DbValue,
  SnapshotDiffChangeType,
  SnapshotDiffRow,
  SnapshotDiffTableSummary,
  SnapshotMeta,
  SnapshotTableSummary,
} from "../../core/database/types";
import { loadSqliteClass } from "./sqlite-driver";

const CODE_VIEWER_DIR = ".code-viewer";
const SNAPSHOT_DB_NAME = "db-snapshots.sqlite";

type SqliteDb = {
  prepare(sql: string): {
    all(...params: unknown[]): Record<string, unknown>[];
    get(...params: unknown[]): Record<string, unknown> | undefined;
    run(...params: unknown[]): { changes: number };
  };
  exec(sql: string): void;
  close(): void;
};

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS snapshots (
  id TEXT PRIMARY KEY,
  db_id TEXT NOT NULL,
  schema_name TEXT,
  kind TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  error_message TEXT
);

CREATE TABLE IF NOT EXISTS snapshot_tables (
  snapshot_id TEXT NOT NULL,
  table_name TEXT NOT NULL,
  row_count INTEGER NOT NULL DEFAULT 0,
  table_hash TEXT NOT NULL DEFAULT '',
  pk_columns_json TEXT NOT NULL DEFAULT '[]',
  PRIMARY KEY (snapshot_id, table_name),
  FOREIGN KEY (snapshot_id) REFERENCES snapshots(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS snapshot_rows (
  snapshot_id TEXT NOT NULL,
  table_name TEXT NOT NULL,
  row_key_hash TEXT NOT NULL,
  row_key_json TEXT NOT NULL,
  row_hash TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  PRIMARY KEY (snapshot_id, table_name, row_key_hash),
  FOREIGN KEY (snapshot_id) REFERENCES snapshots(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS snapshot_payloads (
  payload_hash TEXT PRIMARY KEY,
  payload_json TEXT NOT NULL
);

`;

let storeDb: SqliteDb | null = null;
let storeDbPath: string | null = null;

async function getStoreDb(cwd: string): Promise<SqliteDb> {
  const dbPath = join(cwd, CODE_VIEWER_DIR, SNAPSHOT_DB_NAME);
  if (storeDb && storeDbPath === dbPath) return storeDb;
  if (storeDb) {
    try {
      storeDb.close();
    } catch {
      // ignore
    }
  }
  mkdirSync(join(cwd, CODE_VIEWER_DIR), { recursive: true });
  const DbClass = await loadSqliteClass<SqliteDb>();
  storeDb = new DbClass(dbPath);
  storeDbPath = dbPath;
  storeDb.exec("PRAGMA journal_mode=WAL");
  storeDb.exec("PRAGMA foreign_keys=ON");
  storeDb.exec(SCHEMA_SQL);
  try {
    storeDb.exec("ALTER TABLE snapshots ADD COLUMN schema_name TEXT");
  } catch {
    // Column already exists in databases created after schema support was added.
  }
  return storeDb;
}

function makeId(prefix: string): string {
  return `${prefix}-${randomBytes(8).toString("hex")}`;
}

function hashPayload(payloadJson: string): string {
  return createHash("sha256").update(payloadJson).digest("hex");
}

export async function createSnapshot(
  cwd: string,
  dbId: string,
  kind: DbKind,
  tables: string[],
  note: string,
  schema?: string,
): Promise<string> {
  const db = await getStoreDb(cwd);
  const id = makeId("snap");
  db.prepare(
    "INSERT INTO snapshots (id, db_id, schema_name, kind, note, created_at, status) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(
    id,
    dbId,
    schema ?? null,
    kind,
    note,
    new Date().toISOString(),
    "running",
  );
  for (const t of tables) {
    db.prepare(
      "INSERT INTO snapshot_tables (snapshot_id, table_name) VALUES (?, ?)",
    ).run(id, t);
  }
  return id;
}

export async function addSnapshotTableData(
  cwd: string,
  snapshotId: string,
  tableName: string,
  pkColumns: string[],
  rows: { rowKeyJson: string; rowHash: string; payloadJson: string }[],
): Promise<void> {
  const db = await getStoreDb(cwd);

  const tableHasher = createHash("sha256");
  const insertRow = db.prepare(
    "INSERT OR IGNORE INTO snapshot_rows (snapshot_id, table_name, row_key_hash, row_key_json, row_hash, payload_hash) VALUES (?, ?, ?, ?, ?, ?)",
  );
  const insertPayload = db.prepare(
    "INSERT OR IGNORE INTO snapshot_payloads (payload_hash, payload_json) VALUES (?, ?)",
  );
  const updateTable = db.prepare(
    "UPDATE snapshot_tables SET row_count = ?, table_hash = ?, pk_columns_json = ? WHERE snapshot_id = ? AND table_name = ?",
  );

  db.exec("BEGIN");
  try {
    for (const row of rows) {
      const rowKeyHash = createHash("sha256")
        .update(row.rowKeyJson)
        .digest("hex");
      const payloadHash = hashPayload(row.payloadJson);
      tableHasher.update(row.rowHash);
      insertRow.run(
        snapshotId,
        tableName,
        rowKeyHash,
        row.rowKeyJson,
        row.rowHash,
        payloadHash,
      );
      insertPayload.run(payloadHash, row.payloadJson);
    }

    const tableHash = tableHasher.digest("hex");
    updateTable.run(
      rows.length,
      tableHash,
      JSON.stringify(pkColumns),
      snapshotId,
      tableName,
    );
    db.exec("COMMIT");
  } catch (err) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // ignore rollback failure; original error is more useful.
    }
    throw err;
  }
}

export async function finalizeSnapshot(
  cwd: string,
  snapshotId: string,
  error?: string,
): Promise<void> {
  const db = await getStoreDb(cwd);
  if (error) {
    db.prepare(
      "UPDATE snapshots SET status = 'error', error_message = ? WHERE id = ?",
    ).run(error, snapshotId);
  } else {
    db.prepare("UPDATE snapshots SET status = 'done' WHERE id = ?").run(
      snapshotId,
    );
  }
}

export async function listSnapshots(
  cwd: string,
  dbId?: string,
  schema?: string,
): Promise<SnapshotMeta[]> {
  const db = await getStoreDb(cwd);
  let rows: Record<string, unknown>[];
  if (dbId && schema !== undefined) {
    rows = db
      .prepare(
        "SELECT id, db_id, schema_name, kind, note, created_at, status, error_message FROM snapshots WHERE db_id = ? AND COALESCE(schema_name, 'public') = ? ORDER BY created_at DESC",
      )
      .all(dbId, schema);
  } else if (dbId) {
    rows = db
      .prepare(
        "SELECT id, db_id, schema_name, kind, note, created_at, status, error_message FROM snapshots WHERE db_id = ? ORDER BY created_at DESC",
      )
      .all(dbId);
  } else {
    rows = db
      .prepare(
        "SELECT id, db_id, schema_name, kind, note, created_at, status, error_message FROM snapshots ORDER BY created_at DESC",
      )
      .all();
  }
  return rows.map((r) => {
    const tableRows = db
      .prepare("SELECT table_name FROM snapshot_tables WHERE snapshot_id = ?")
      .all(r.id as string);
    return {
      id: r.id as string,
      dbId: r.db_id as string,
      ...((r.schema_name as string | null)
        ? { schema: r.schema_name as string }
        : {}),
      kind: r.kind as DbKind,
      note: r.note as string,
      createdAt: r.created_at as string,
      tables: tableRows.map((t) => t.table_name as string),
      status: r.status as "running" | "done" | "error",
      errorMessage: r.error_message as string | undefined,
    };
  });
}

export async function getSnapshotTableSummaries(
  cwd: string,
  snapshotId: string,
): Promise<SnapshotTableSummary[]> {
  const db = await getStoreDb(cwd);
  const rows = db
    .prepare(
      "SELECT table_name, row_count, table_hash, pk_columns_json FROM snapshot_tables WHERE snapshot_id = ?",
    )
    .all(snapshotId);
  return rows.map((r) => ({
    tableName: r.table_name as string,
    rowCount: r.row_count as number,
    tableHash: r.table_hash as string,
    pkColumns: JSON.parse(r.pk_columns_json as string) as string[],
  }));
}

export async function updateSnapshotNote(
  cwd: string,
  snapshotId: string,
  note: string,
): Promise<void> {
  const db = await getStoreDb(cwd);
  db.prepare("UPDATE snapshots SET note = ? WHERE id = ?").run(
    note,
    snapshotId,
  );
}

export async function deleteSnapshot(
  cwd: string,
  snapshotId: string,
): Promise<void> {
  const db = await getStoreDb(cwd);
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM snapshots WHERE id = ?").run(snapshotId);
    db.prepare(
      `DELETE FROM snapshot_payloads
       WHERE NOT EXISTS (
         SELECT 1 FROM snapshot_rows
         WHERE snapshot_rows.payload_hash = snapshot_payloads.payload_hash
       )`,
    ).run();
    db.exec("COMMIT");
  } catch (err) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // ignore rollback failure; original error is more useful.
    }
    throw err;
  }
}

function getSnapshotScope(
  db: SqliteDb,
  snapshotId: string,
): { dbId: string; schema: string } {
  const row = db
    .prepare(
      "SELECT db_id, COALESCE(schema_name, 'public') AS schema_name FROM snapshots WHERE id = ?",
    )
    .get(snapshotId) as { db_id: string; schema_name: string } | undefined;
  if (!row) throw new Error(`snapshot not found: ${snapshotId}`);
  return { dbId: row.db_id, schema: row.schema_name };
}

function assertSameSnapshotScope(
  db: SqliteDb,
  beforeId: string,
  afterId: string,
): void {
  const before = getSnapshotScope(db, beforeId);
  const after = getSnapshotScope(db, afterId);
  if (before.dbId !== after.dbId || before.schema !== after.schema) {
    throw new Error(
      `cannot compare snapshots from different database/schema (${before.dbId}:${before.schema} vs ${after.dbId}:${after.schema})`,
    );
  }
}

export async function computeDiffTables(
  cwd: string,
  beforeId: string,
  afterId: string,
): Promise<SnapshotDiffTableSummary[]> {
  const db = await getStoreDb(cwd);
  assertSameSnapshotScope(db, beforeId, afterId);

  const beforeTables = db
    .prepare(
      "SELECT table_name, table_hash, row_count FROM snapshot_tables WHERE snapshot_id = ?",
    )
    .all(beforeId) as {
    table_name: string;
    table_hash: string;
    row_count: number;
  }[];
  const afterTables = db
    .prepare(
      "SELECT table_name, table_hash, row_count FROM snapshot_tables WHERE snapshot_id = ?",
    )
    .all(afterId) as {
    table_name: string;
    table_hash: string;
    row_count: number;
  }[];

  const beforeMap = new Map(beforeTables.map((t) => [t.table_name, t]));
  const afterMap = new Map(afterTables.map((t) => [t.table_name, t]));
  const allTables = new Set([...beforeMap.keys(), ...afterMap.keys()]);

  const results: SnapshotDiffTableSummary[] = [];

  for (const table of allTables) {
    const b = beforeMap.get(table);
    const a = afterMap.get(table);

    if (b && a && b.table_hash === a.table_hash) {
      results.push({
        tableName: table,
        insertedCount: 0,
        updatedCount: 0,
        deletedCount: 0,
        unchangedCount: b.row_count,
        coverage: "both",
      });
      continue;
    }

    if (!b) {
      // before に「対象選択されていなかった」テーブル。after には全行ある
      // が、これを「全行 insert」と表示するのは事実誤認。比較対象外として
      // coverage: after-only で返し、client 側で「未取得」ラベルに切り替える。
      results.push({
        tableName: table,
        insertedCount: 0,
        updatedCount: 0,
        deletedCount: 0,
        unchangedCount: 0,
        coverage: "after-only",
        unsnapshottedRowCount: a ? a.row_count : 0,
      });
      continue;
    }

    if (!a) {
      results.push({
        tableName: table,
        insertedCount: 0,
        updatedCount: 0,
        deletedCount: 0,
        unchangedCount: 0,
        coverage: "before-only",
        unsnapshottedRowCount: b.row_count,
      });
      continue;
    }

    const insertedCount = (
      db
        .prepare(
          `SELECT COUNT(*) AS cnt
           FROM snapshot_rows a
           LEFT JOIN snapshot_rows b ON b.snapshot_id = ? AND b.table_name = ? AND b.row_key_hash = a.row_key_hash
           WHERE a.snapshot_id = ? AND a.table_name = ? AND b.row_key_hash IS NULL`,
        )
        .get(beforeId, table, afterId, table) as { cnt: number }
    ).cnt;

    const deletedCount = (
      db
        .prepare(
          `SELECT COUNT(*) AS cnt
           FROM snapshot_rows b
           LEFT JOIN snapshot_rows a ON a.snapshot_id = ? AND a.table_name = ? AND a.row_key_hash = b.row_key_hash
           WHERE b.snapshot_id = ? AND b.table_name = ? AND a.row_key_hash IS NULL`,
        )
        .get(afterId, table, beforeId, table) as { cnt: number }
    ).cnt;

    const updatedCount = (
      db
        .prepare(
          `SELECT COUNT(*) AS cnt
           FROM snapshot_rows b
           INNER JOIN snapshot_rows a ON a.snapshot_id = ? AND a.table_name = ? AND a.row_key_hash = b.row_key_hash
           WHERE b.snapshot_id = ? AND b.table_name = ? AND b.row_hash != a.row_hash`,
        )
        .get(afterId, table, beforeId, table) as { cnt: number }
    ).cnt;

    const unchangedCount = b.row_count - deletedCount - updatedCount;

    results.push({
      tableName: table,
      insertedCount,
      updatedCount,
      deletedCount,
      unchangedCount: Math.max(0, unchangedCount),
      coverage: "both",
    });
  }

  results.sort((a, b) => {
    const aChanges = a.insertedCount + a.updatedCount + a.deletedCount;
    const bChanges = b.insertedCount + b.updatedCount + b.deletedCount;
    if (bChanges !== aChanges) return bChanges - aChanges;
    return a.tableName.localeCompare(b.tableName);
  });

  return results;
}

export async function computeDiffRows(
  cwd: string,
  beforeId: string,
  afterId: string,
  table: string,
  offset = 0,
  limit = 200,
): Promise<{ rows: SnapshotDiffRow[]; total: number }> {
  const db = await getStoreDb(cwd);
  assertSameSnapshotScope(db, beforeId, afterId);

  type RawDiffRow = {
    change_type: SnapshotDiffChangeType;
    row_key_json: string;
    before_payload_hash: string | null;
    after_payload_hash: string | null;
  };

  const allDiffRows: RawDiffRow[] = [];

  // inserted: in after but not in before
  const inserted = db
    .prepare(
      `SELECT a.row_key_json, a.payload_hash
       FROM snapshot_rows a
       LEFT JOIN snapshot_rows b ON b.snapshot_id = ? AND b.table_name = ? AND b.row_key_hash = a.row_key_hash
       WHERE a.snapshot_id = ? AND a.table_name = ? AND b.row_key_hash IS NULL
       ORDER BY a.row_key_json`,
    )
    .all(beforeId, table, afterId, table) as {
    row_key_json: string;
    payload_hash: string;
  }[];
  for (const r of inserted) {
    allDiffRows.push({
      change_type: "inserted",
      row_key_json: r.row_key_json,
      before_payload_hash: null,
      after_payload_hash: r.payload_hash,
    });
  }

  // deleted: in before but not in after
  const deleted = db
    .prepare(
      `SELECT b.row_key_json, b.payload_hash
       FROM snapshot_rows b
       LEFT JOIN snapshot_rows a ON a.snapshot_id = ? AND a.table_name = ? AND a.row_key_hash = b.row_key_hash
       WHERE b.snapshot_id = ? AND b.table_name = ? AND a.row_key_hash IS NULL
       ORDER BY b.row_key_json`,
    )
    .all(afterId, table, beforeId, table) as {
    row_key_json: string;
    payload_hash: string;
  }[];
  for (const r of deleted) {
    allDiffRows.push({
      change_type: "deleted",
      row_key_json: r.row_key_json,
      before_payload_hash: r.payload_hash,
      after_payload_hash: null,
    });
  }

  // updated: in both but different hash
  const updated = db
    .prepare(
      `SELECT b.row_key_json, b.payload_hash AS before_ph, a.payload_hash AS after_ph
       FROM snapshot_rows b
       INNER JOIN snapshot_rows a ON a.snapshot_id = ? AND a.table_name = ? AND a.row_key_hash = b.row_key_hash
       WHERE b.snapshot_id = ? AND b.table_name = ? AND b.row_hash != a.row_hash
       ORDER BY b.row_key_json`,
    )
    .all(afterId, table, beforeId, table) as {
    row_key_json: string;
    before_ph: string;
    after_ph: string;
  }[];
  for (const r of updated) {
    allDiffRows.push({
      change_type: "updated",
      row_key_json: r.row_key_json,
      before_payload_hash: r.before_ph,
      after_payload_hash: r.after_ph,
    });
  }

  allDiffRows.sort((a, b) => a.row_key_json.localeCompare(b.row_key_json));

  const total = allDiffRows.length;
  const page = allDiffRows.slice(offset, offset + limit);

  const rows: SnapshotDiffRow[] = page.map((r) => {
    let beforeValues: Record<string, DbValue> | undefined;
    let afterValues: Record<string, DbValue> | undefined;
    if (r.before_payload_hash) {
      const payload = db
        .prepare(
          "SELECT payload_json FROM snapshot_payloads WHERE payload_hash = ?",
        )
        .get(r.before_payload_hash) as { payload_json: string } | undefined;
      if (payload) beforeValues = JSON.parse(payload.payload_json);
    }
    if (r.after_payload_hash) {
      const payload = db
        .prepare(
          "SELECT payload_json FROM snapshot_payloads WHERE payload_hash = ?",
        )
        .get(r.after_payload_hash) as { payload_json: string } | undefined;
      if (payload) afterValues = JSON.parse(payload.payload_json);
    }
    return {
      changeType: r.change_type,
      rowKeyJson: r.row_key_json,
      beforeValues,
      afterValues,
    };
  });

  return { rows, total };
}
