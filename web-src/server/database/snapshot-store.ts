import { createHash, randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type {
  DbKind,
  DbValue,
  SnapshotDiffChangeType,
  SnapshotDiffMeta,
  SnapshotDiffRow,
  SnapshotDiffTableSummary,
  SnapshotMeta,
  SnapshotTableSummary,
} from "../../core/database/types";

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

type SqliteConstructor = new (
  path: string,
  options?: { readonly?: boolean; create?: boolean },
) => SqliteDb;

let cachedDbClass: SqliteConstructor | null = null;

async function getSqliteClass(): Promise<SqliteConstructor> {
  if (cachedDbClass) return cachedDbClass;
  try {
    const mod = await import("bun:sqlite");
    cachedDbClass = mod.Database as unknown as SqliteConstructor;
    return cachedDbClass;
  } catch {
    // not running in Bun
  }
  try {
    const mod = await (Function(
      'return import("better-sqlite3")',
    )() as Promise<{ default?: unknown }>);
    cachedDbClass = (mod.default || mod) as unknown as SqliteConstructor;
    return cachedDbClass;
  } catch {
    // not installed
  }
  throw new Error(
    "No SQLite driver available. Install better-sqlite3 or run with Bun.",
  );
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS snapshots (
  id TEXT PRIMARY KEY,
  db_id TEXT NOT NULL,
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

CREATE TABLE IF NOT EXISTS snapshot_diffs (
  id TEXT PRIMARY KEY,
  before_id TEXT NOT NULL,
  after_id TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  error_message TEXT,
  FOREIGN KEY (before_id) REFERENCES snapshots(id) ON DELETE CASCADE,
  FOREIGN KEY (after_id) REFERENCES snapshots(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS snapshot_diff_tables (
  diff_id TEXT NOT NULL,
  table_name TEXT NOT NULL,
  inserted_count INTEGER NOT NULL DEFAULT 0,
  updated_count INTEGER NOT NULL DEFAULT 0,
  deleted_count INTEGER NOT NULL DEFAULT 0,
  unchanged_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (diff_id, table_name),
  FOREIGN KEY (diff_id) REFERENCES snapshot_diffs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS snapshot_diff_rows (
  diff_id TEXT NOT NULL,
  table_name TEXT NOT NULL,
  change_type TEXT NOT NULL,
  row_key_hash TEXT NOT NULL,
  row_key_json TEXT NOT NULL,
  before_payload_hash TEXT,
  after_payload_hash TEXT,
  FOREIGN KEY (diff_id) REFERENCES snapshot_diffs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_snapshot_diff_rows_lookup
  ON snapshot_diff_rows(diff_id, table_name, change_type);
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
  const DbClass = await getSqliteClass();
  storeDb = new DbClass(dbPath);
  storeDbPath = dbPath;
  storeDb.exec("PRAGMA journal_mode=WAL");
  storeDb.exec("PRAGMA foreign_keys=ON");
  storeDb.exec(SCHEMA_SQL);
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
): Promise<string> {
  const db = await getStoreDb(cwd);
  const id = makeId("snap");
  db.prepare(
    "INSERT INTO snapshots (id, db_id, kind, note, created_at, status) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(id, dbId, kind, note, new Date().toISOString(), "running");
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
  db.prepare(
    "UPDATE snapshot_tables SET row_count = ?, table_hash = ?, pk_columns_json = ? WHERE snapshot_id = ? AND table_name = ?",
  ).run(
    rows.length,
    tableHash,
    JSON.stringify(pkColumns),
    snapshotId,
    tableName,
  );
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
): Promise<SnapshotMeta[]> {
  const db = await getStoreDb(cwd);
  let rows: Record<string, unknown>[];
  if (dbId) {
    rows = db
      .prepare(
        "SELECT id, db_id, kind, note, created_at, status, error_message FROM snapshots WHERE db_id = ? ORDER BY created_at DESC",
      )
      .all(dbId);
  } else {
    rows = db
      .prepare(
        "SELECT id, db_id, kind, note, created_at, status, error_message FROM snapshots ORDER BY created_at DESC",
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
  const payloadHashes = db
    .prepare(
      "SELECT DISTINCT payload_hash FROM snapshot_rows WHERE snapshot_id = ?",
    )
    .all(snapshotId)
    .map((r) => r.payload_hash as string);
  db.prepare("DELETE FROM snapshots WHERE id = ?").run(snapshotId);
  for (const ph of payloadHashes) {
    const used = db
      .prepare("SELECT 1 FROM snapshot_rows WHERE payload_hash = ? LIMIT 1")
      .get(ph);
    if (!used) {
      db.prepare("DELETE FROM snapshot_payloads WHERE payload_hash = ?").run(
        ph,
      );
    }
  }
}

export async function createDiff(
  cwd: string,
  beforeId: string,
  afterId: string,
  note: string,
): Promise<string> {
  const db = await getStoreDb(cwd);
  const id = makeId("diff");
  db.prepare(
    "INSERT INTO snapshot_diffs (id, before_id, after_id, note, created_at, status) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(id, beforeId, afterId, note, new Date().toISOString(), "running");
  return id;
}

export async function computeDiff(cwd: string, diffId: string): Promise<void> {
  const db = await getStoreDb(cwd);
  const diff = db
    .prepare("SELECT before_id, after_id FROM snapshot_diffs WHERE id = ?")
    .get(diffId) as { before_id: string; after_id: string } | undefined;
  if (!diff) throw new Error("diff not found");

  const beforeTables = db
    .prepare(
      "SELECT table_name, table_hash FROM snapshot_tables WHERE snapshot_id = ?",
    )
    .all(diff.before_id) as { table_name: string; table_hash: string }[];
  const afterTables = db
    .prepare(
      "SELECT table_name, table_hash FROM snapshot_tables WHERE snapshot_id = ?",
    )
    .all(diff.after_id) as { table_name: string; table_hash: string }[];

  const beforeMap = new Map(
    beforeTables.map((t) => [t.table_name, t.table_hash]),
  );
  const afterMap = new Map(
    afterTables.map((t) => [t.table_name, t.table_hash]),
  );
  const allTables = new Set([...beforeMap.keys(), ...afterMap.keys()]);

  const insertDiffTable = db.prepare(
    "INSERT INTO snapshot_diff_tables (diff_id, table_name, inserted_count, updated_count, deleted_count, unchanged_count) VALUES (?, ?, ?, ?, ?, ?)",
  );
  const insertDiffRow = db.prepare(
    "INSERT INTO snapshot_diff_rows (diff_id, table_name, change_type, row_key_hash, row_key_json, before_payload_hash, after_payload_hash) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );

  for (const table of allTables) {
    const bHash = beforeMap.get(table);
    const aHash = afterMap.get(table);

    if (bHash && aHash && bHash === aHash) {
      const rowCount = (
        db
          .prepare(
            "SELECT row_count FROM snapshot_tables WHERE snapshot_id = ? AND table_name = ?",
          )
          .get(diff.before_id, table) as { row_count: number }
      ).row_count;
      insertDiffTable.run(diffId, table, 0, 0, 0, rowCount);
      continue;
    }

    if (!bHash) {
      const afterRows = db
        .prepare(
          "SELECT row_key_hash, row_key_json, payload_hash FROM snapshot_rows WHERE snapshot_id = ? AND table_name = ?",
        )
        .all(diff.after_id, table) as {
        row_key_hash: string;
        row_key_json: string;
        payload_hash: string;
      }[];
      for (const r of afterRows) {
        insertDiffRow.run(
          diffId,
          table,
          "inserted",
          r.row_key_hash,
          r.row_key_json,
          null,
          r.payload_hash,
        );
      }
      insertDiffTable.run(diffId, table, afterRows.length, 0, 0, 0);
      continue;
    }

    if (!aHash) {
      const beforeRows = db
        .prepare(
          "SELECT row_key_hash, row_key_json, payload_hash FROM snapshot_rows WHERE snapshot_id = ? AND table_name = ?",
        )
        .all(diff.before_id, table) as {
        row_key_hash: string;
        row_key_json: string;
        payload_hash: string;
      }[];
      for (const r of beforeRows) {
        insertDiffRow.run(
          diffId,
          table,
          "deleted",
          r.row_key_hash,
          r.row_key_json,
          r.payload_hash,
          null,
        );
      }
      insertDiffTable.run(diffId, table, 0, 0, beforeRows.length, 0);
      continue;
    }

    const inserted = db
      .prepare(
        `SELECT a.row_key_hash, a.row_key_json, a.payload_hash
         FROM snapshot_rows a
         LEFT JOIN snapshot_rows b ON b.snapshot_id = ? AND b.table_name = ? AND b.row_key_hash = a.row_key_hash
         WHERE a.snapshot_id = ? AND a.table_name = ? AND b.row_key_hash IS NULL`,
      )
      .all(diff.before_id, table, diff.after_id, table) as {
      row_key_hash: string;
      row_key_json: string;
      payload_hash: string;
    }[];

    const deleted = db
      .prepare(
        `SELECT b.row_key_hash, b.row_key_json, b.payload_hash
         FROM snapshot_rows b
         LEFT JOIN snapshot_rows a ON a.snapshot_id = ? AND a.table_name = ? AND a.row_key_hash = b.row_key_hash
         WHERE b.snapshot_id = ? AND b.table_name = ? AND a.row_key_hash IS NULL`,
      )
      .all(diff.after_id, table, diff.before_id, table) as {
      row_key_hash: string;
      row_key_json: string;
      payload_hash: string;
    }[];

    const updated = db
      .prepare(
        `SELECT b.row_key_hash, b.row_key_json, b.payload_hash AS before_ph, a.payload_hash AS after_ph
         FROM snapshot_rows b
         INNER JOIN snapshot_rows a ON a.snapshot_id = ? AND a.table_name = ? AND a.row_key_hash = b.row_key_hash
         WHERE b.snapshot_id = ? AND b.table_name = ? AND b.row_hash != a.row_hash`,
      )
      .all(diff.after_id, table, diff.before_id, table) as {
      row_key_hash: string;
      row_key_json: string;
      before_ph: string;
      after_ph: string;
    }[];

    const unchangedCount =
      (
        db
          .prepare(
            "SELECT row_count FROM snapshot_tables WHERE snapshot_id = ? AND table_name = ?",
          )
          .get(diff.before_id, table) as { row_count: number }
      ).row_count -
      deleted.length -
      updated.length;

    for (const r of inserted) {
      insertDiffRow.run(
        diffId,
        table,
        "inserted",
        r.row_key_hash,
        r.row_key_json,
        null,
        r.payload_hash,
      );
    }
    for (const r of deleted) {
      insertDiffRow.run(
        diffId,
        table,
        "deleted",
        r.row_key_hash,
        r.row_key_json,
        r.payload_hash,
        null,
      );
    }
    for (const r of updated) {
      insertDiffRow.run(
        diffId,
        table,
        "updated",
        r.row_key_hash,
        r.row_key_json,
        r.before_ph,
        r.after_ph,
      );
    }
    insertDiffTable.run(
      diffId,
      table,
      inserted.length,
      updated.length,
      deleted.length,
      Math.max(0, unchangedCount),
    );
  }

  db.prepare("UPDATE snapshot_diffs SET status = 'done' WHERE id = ?").run(
    diffId,
  );
}

export async function finalizeDiffError(
  cwd: string,
  diffId: string,
  error: string,
): Promise<void> {
  const db = await getStoreDb(cwd);
  db.prepare(
    "UPDATE snapshot_diffs SET status = 'error', error_message = ? WHERE id = ?",
  ).run(error, diffId);
}

export async function listDiffs(
  cwd: string,
  dbId?: string,
): Promise<SnapshotDiffMeta[]> {
  const db = await getStoreDb(cwd);
  let rows: Record<string, unknown>[];
  if (dbId) {
    rows = db
      .prepare(
        `SELECT d.id, d.before_id, d.after_id, d.note, d.created_at, d.status, d.error_message
         FROM snapshot_diffs d
         INNER JOIN snapshots s ON s.id = d.before_id
         WHERE s.db_id = ?
         ORDER BY d.created_at DESC`,
      )
      .all(dbId);
  } else {
    rows = db
      .prepare(
        "SELECT id, before_id, after_id, note, created_at, status, error_message FROM snapshot_diffs ORDER BY created_at DESC",
      )
      .all();
  }
  return rows.map((r) => ({
    id: r.id as string,
    beforeId: r.before_id as string,
    afterId: r.after_id as string,
    note: r.note as string,
    createdAt: r.created_at as string,
    status: r.status as "running" | "done" | "error",
    errorMessage: r.error_message as string | undefined,
  }));
}

export async function getDiffTableSummaries(
  cwd: string,
  diffId: string,
): Promise<SnapshotDiffTableSummary[]> {
  const db = await getStoreDb(cwd);
  const rows = db
    .prepare(
      "SELECT table_name, inserted_count, updated_count, deleted_count, unchanged_count FROM snapshot_diff_tables WHERE diff_id = ? ORDER BY (inserted_count + updated_count + deleted_count) DESC, table_name",
    )
    .all(diffId);
  return rows.map((r) => ({
    tableName: r.table_name as string,
    insertedCount: r.inserted_count as number,
    updatedCount: r.updated_count as number,
    deletedCount: r.deleted_count as number,
    unchangedCount: r.unchanged_count as number,
  }));
}

export async function getDiffRows(
  cwd: string,
  diffId: string,
  table: string,
  changeType?: SnapshotDiffChangeType,
  offset = 0,
  limit = 200,
): Promise<{ rows: SnapshotDiffRow[]; total: number }> {
  const db = await getStoreDb(cwd);
  const typeFilter = changeType ? " AND change_type = ?" : "";
  const params: unknown[] = changeType
    ? [diffId, table, changeType]
    : [diffId, table];

  const countRow = db
    .prepare(
      `SELECT COUNT(*) AS cnt FROM snapshot_diff_rows WHERE diff_id = ? AND table_name = ?${typeFilter}`,
    )
    .get(...params) as { cnt: number };
  const total = countRow.cnt;

  const dataRows = db
    .prepare(
      `SELECT change_type, row_key_hash, row_key_json, before_payload_hash, after_payload_hash
       FROM snapshot_diff_rows
       WHERE diff_id = ? AND table_name = ?${typeFilter}
       ORDER BY row_key_json
       LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset) as {
    change_type: string;
    row_key_hash: string;
    row_key_json: string;
    before_payload_hash: string | null;
    after_payload_hash: string | null;
  }[];

  const rows: SnapshotDiffRow[] = dataRows.map((r) => {
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
      changeType: r.change_type as SnapshotDiffChangeType,
      rowKeyJson: r.row_key_json,
      beforeValues,
      afterValues,
    };
  });

  return { rows, total };
}

export async function updateDiffNote(
  cwd: string,
  diffId: string,
  note: string,
): Promise<void> {
  const db = await getStoreDb(cwd);
  db.prepare("UPDATE snapshot_diffs SET note = ? WHERE id = ?").run(
    note,
    diffId,
  );
}

export async function deleteDiff(cwd: string, diffId: string): Promise<void> {
  const db = await getStoreDb(cwd);
  db.prepare("DELETE FROM snapshot_diffs WHERE id = ?").run(diffId);
}
