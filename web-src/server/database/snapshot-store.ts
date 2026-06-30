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
import { canonicalizeDockerDbId, parseDockerDbId } from "./discovery";
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
  revision_id TEXT,
  PRIMARY KEY (snapshot_id, table_name),
  FOREIGN KEY (snapshot_id) REFERENCES snapshots(id) ON DELETE CASCADE,
  FOREIGN KEY (revision_id) REFERENCES snapshot_table_revisions(id)
);

CREATE TABLE IF NOT EXISTS snapshot_table_revisions (
  id TEXT PRIMARY KEY,
  source_snapshot_id TEXT,
  db_id TEXT NOT NULL,
  schema_name TEXT NOT NULL,
  table_name TEXT NOT NULL,
  row_count INTEGER NOT NULL DEFAULT 0,
  table_hash TEXT NOT NULL DEFAULT '',
  hash_version INTEGER NOT NULL DEFAULT 2,
  pk_columns_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'building',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_snapshot_table_revisions_lookup
  ON snapshot_table_revisions(db_id, schema_name, table_name, hash_version, table_hash, row_count, pk_columns_json, status);

CREATE TABLE IF NOT EXISTS snapshot_table_revision_rows (
  revision_id TEXT NOT NULL,
  row_key_hash TEXT NOT NULL,
  row_key_json TEXT NOT NULL,
  row_hash TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  PRIMARY KEY (revision_id, row_key_hash),
  FOREIGN KEY (revision_id) REFERENCES snapshot_table_revisions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_snapshot_table_revision_rows_revision_key
  ON snapshot_table_revision_rows(revision_id, row_key_hash);

CREATE INDEX IF NOT EXISTS idx_snapshot_table_revision_rows_payload_hash
  ON snapshot_table_revision_rows(payload_hash);

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

-- deleteSnapshot の orphan cleanup (snapshot_payloads を残さない) は
-- legacy rows と revision rows の payload_hash で逆引きする。index が無いと
-- snapshot_payloads 件数 × rows 全件の相関スキャンになる。
CREATE INDEX IF NOT EXISTS idx_snapshot_rows_payload_hash
  ON snapshot_rows(payload_hash);

DROP VIEW IF EXISTS snapshot_rows_resolved;

CREATE VIEW snapshot_rows_resolved AS
  SELECT
    st.snapshot_id AS snapshot_id,
    st.table_name AS table_name,
    rr.row_key_hash AS row_key_hash,
    rr.row_key_json AS row_key_json,
    rr.row_hash AS row_hash,
    rr.payload_hash AS payload_hash
  FROM snapshot_tables st
  INNER JOIN snapshot_table_revision_rows rr
    ON rr.revision_id = st.revision_id
  WHERE st.revision_id IS NOT NULL
  UNION ALL
  SELECT
    snapshot_id,
    table_name,
    row_key_hash,
    row_key_json,
    row_hash,
    payload_hash
  FROM snapshot_rows;

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
  try {
    storeDb.exec("ALTER TABLE snapshot_tables ADD COLUMN revision_id TEXT");
  } catch {
    // Column already exists in databases created after table revisions were added.
  }
  return storeDb;
}

function makeId(prefix: string): string {
  return `${prefix}-${randomBytes(8).toString("hex")}`;
}

function hashPayload(payloadJson: string): string {
  return createHash("sha256").update(payloadJson).digest("hex");
}

type SnapshotRowInput = {
  rowKeyJson: string;
  rowHash: string;
  payloadJson: string;
};

const SNAPSHOT_TABLE_HASH_VERSION = 2;
const SNAPSHOT_TABLE_HASH_PREFIX = `v${SNAPSHOT_TABLE_HASH_VERSION}:`;
const SNAPSHOT_REVISION_HASH_BATCH_SIZE = 1000;

function hashLengthPrefixed(
  hasher: ReturnType<typeof createHash>,
  value: string,
) {
  hasher.update(`${Buffer.byteLength(value, "utf8")}:`);
  hasher.update(value);
  hasher.update("\n");
}

function deleteOrphanPayloads(db: SqliteDb) {
  db.prepare(
    `DELETE FROM snapshot_payloads
     WHERE NOT EXISTS (
       SELECT 1 FROM snapshot_rows
       WHERE snapshot_rows.payload_hash = snapshot_payloads.payload_hash
     )
     AND NOT EXISTS (
       SELECT 1 FROM snapshot_table_revision_rows
       WHERE snapshot_table_revision_rows.payload_hash = snapshot_payloads.payload_hash
     )`,
  ).run();
}

function dockerDbIdFilterValues(dbId: string): string[] {
  const values = [dbId];
  const canonical = canonicalizeDockerDbId(dbId);
  if (canonical) values.push(canonical);
  const parsed = parseDockerDbId(dbId);
  if (parsed?.relDir) {
    const database = parsed.database ? `:${parsed.database}` : "";
    values.push(`docker:${parsed.serviceName}@${parsed.relDir}${database}`);
  }
  return [...new Set(values)];
}

function getSnapshotScopeRow(
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
  const storedDbId = canonicalizeDockerDbId(dbId) ?? dbId;
  db.prepare(
    "INSERT INTO snapshots (id, db_id, schema_name, kind, note, created_at, status) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(
    id,
    storedDbId,
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
  rows: SnapshotRowInput[],
): Promise<void> {
  const revisionId = await beginSnapshotTableRevision(
    cwd,
    snapshotId,
    tableName,
    pkColumns,
  );
  await addSnapshotTableRows(cwd, revisionId, rows);
  await finalizeSnapshotTableRevision(cwd, snapshotId, tableName, revisionId);
}

export async function beginSnapshotTableRevision(
  cwd: string,
  snapshotId: string,
  tableName: string,
  pkColumns: string[],
): Promise<string> {
  const db = await getStoreDb(cwd);
  const id = makeId("rev");
  const scope = getSnapshotScopeRow(db, snapshotId);
  db.exec("BEGIN");
  try {
    db.prepare(
      "INSERT OR IGNORE INTO snapshot_tables (snapshot_id, table_name) VALUES (?, ?)",
    ).run(snapshotId, tableName);
    db.prepare(
      `INSERT INTO snapshot_table_revisions
       (id, source_snapshot_id, db_id, schema_name, table_name, row_count, table_hash, hash_version, pk_columns_json, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      snapshotId,
      scope.dbId,
      scope.schema,
      tableName,
      0,
      "",
      SNAPSHOT_TABLE_HASH_VERSION,
      JSON.stringify(pkColumns),
      "building",
      new Date().toISOString(),
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
  return id;
}

export async function addSnapshotTableRows(
  cwd: string,
  revisionId: string,
  rows: SnapshotRowInput[],
): Promise<void> {
  if (rows.length === 0) return;
  const db = await getStoreDb(cwd);
  const insertRow = db.prepare(
    "INSERT OR IGNORE INTO snapshot_table_revision_rows (revision_id, row_key_hash, row_key_json, row_hash, payload_hash) VALUES (?, ?, ?, ?, ?)",
  );
  const insertPayload = db.prepare(
    "INSERT OR IGNORE INTO snapshot_payloads (payload_hash, payload_json) VALUES (?, ?)",
  );

  db.exec("BEGIN");
  try {
    for (const row of rows) {
      const rowKeyHash = createHash("sha256")
        .update(row.rowKeyJson)
        .digest("hex");
      const payloadHash = hashPayload(row.payloadJson);
      insertRow.run(
        revisionId,
        rowKeyHash,
        row.rowKeyJson,
        row.rowHash,
        payloadHash,
      );
      insertPayload.run(payloadHash, row.payloadJson);
    }
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

function computeRevisionTableHash(
  db: SqliteDb,
  revisionId: string,
): { rowCount: number; tableHash: string } {
  const hasher = createHash("sha256");
  hashLengthPrefixed(hasher, `snapshot-table-v${SNAPSHOT_TABLE_HASH_VERSION}`);
  let rowCount = 0;
  let last:
    | {
        row_key_hash: string;
        row_key_json: string;
      }
    | undefined;
  for (;;) {
    const rows = last
      ? (db
          .prepare(
            `SELECT row_key_hash, row_key_json, row_hash, payload_hash
             FROM snapshot_table_revision_rows
             WHERE revision_id = ?
               AND (row_key_hash > ? OR (row_key_hash = ? AND row_key_json > ?))
             ORDER BY row_key_hash, row_key_json
             LIMIT ?`,
          )
          .all(
            revisionId,
            last.row_key_hash,
            last.row_key_hash,
            last.row_key_json,
            SNAPSHOT_REVISION_HASH_BATCH_SIZE,
          ) as Array<{
          row_key_hash: string;
          row_key_json: string;
          row_hash: string;
          payload_hash: string;
        }>)
      : (db
          .prepare(
            `SELECT row_key_hash, row_key_json, row_hash, payload_hash
             FROM snapshot_table_revision_rows
             WHERE revision_id = ?
             ORDER BY row_key_hash, row_key_json
             LIMIT ?`,
          )
          .all(revisionId, SNAPSHOT_REVISION_HASH_BATCH_SIZE) as Array<{
          row_key_hash: string;
          row_key_json: string;
          row_hash: string;
          payload_hash: string;
        }>);
    if (rows.length === 0) break;
    for (const row of rows) {
      hashLengthPrefixed(hasher, row.row_key_hash);
      hashLengthPrefixed(hasher, row.row_key_json);
      hashLengthPrefixed(hasher, row.row_hash);
      hashLengthPrefixed(hasher, row.payload_hash);
      rowCount++;
      last = {
        row_key_hash: row.row_key_hash,
        row_key_json: row.row_key_json,
      };
    }
    if (rows.length < SNAPSHOT_REVISION_HASH_BATCH_SIZE) break;
  }
  return {
    rowCount,
    tableHash: `${SNAPSHOT_TABLE_HASH_PREFIX}${hasher.digest("hex")}`,
  };
}

export async function finalizeSnapshotTableRevision(
  cwd: string,
  snapshotId: string,
  tableName: string,
  revisionId: string,
): Promise<void> {
  const db = await getStoreDb(cwd);
  const revision = db
    .prepare(
      `SELECT db_id, schema_name, table_name, pk_columns_json
       FROM snapshot_table_revisions
       WHERE id = ?`,
    )
    .get(revisionId) as
    | {
        db_id: string;
        schema_name: string;
        table_name: string;
        pk_columns_json: string;
      }
    | undefined;
  if (!revision)
    throw new Error(`snapshot table revision not found: ${revisionId}`);

  const { rowCount, tableHash } = computeRevisionTableHash(db, revisionId);
  const existing = db
    .prepare(
      `SELECT id
       FROM snapshot_table_revisions
       WHERE id != ?
         AND db_id = ?
         AND schema_name = ?
         AND table_name = ?
         AND hash_version = ?
         AND table_hash = ?
         AND row_count = ?
         AND pk_columns_json = ?
         AND status = 'done'
       ORDER BY created_at ASC
       LIMIT 1`,
    )
    .get(
      revisionId,
      revision.db_id,
      revision.schema_name,
      revision.table_name,
      SNAPSHOT_TABLE_HASH_VERSION,
      tableHash,
      rowCount,
      revision.pk_columns_json,
    ) as { id: string } | undefined;

  const adoptedRevisionId = existing?.id ?? revisionId;
  db.exec("BEGIN");
  try {
    if (existing) {
      db.prepare("DELETE FROM snapshot_table_revisions WHERE id = ?").run(
        revisionId,
      );
    } else {
      db.prepare(
        `UPDATE snapshot_table_revisions
         SET row_count = ?, table_hash = ?, status = 'done', source_snapshot_id = NULL
         WHERE id = ?`,
      ).run(rowCount, tableHash, revisionId);
    }
    db.prepare(
      `UPDATE snapshot_tables
       SET row_count = ?, table_hash = ?, pk_columns_json = ?, revision_id = ?
       WHERE snapshot_id = ? AND table_name = ?`,
    ).run(
      rowCount,
      tableHash,
      revision.pk_columns_json,
      adoptedRevisionId,
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
    db.exec("BEGIN");
    try {
      db.prepare(
        "DELETE FROM snapshot_table_revisions WHERE source_snapshot_id = ? AND status = 'building'",
      ).run(snapshotId);
      deleteOrphanPayloads(db);
      db.prepare(
        "UPDATE snapshots SET status = 'error', error_message = ? WHERE id = ?",
      ).run(error, snapshotId);
      db.exec("COMMIT");
    } catch (err) {
      try {
        db.exec("ROLLBACK");
      } catch {
        // ignore rollback failure; original error is more useful.
      }
      throw err;
    }
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
  // 動的 WHERE: dbId / schema は独立に省略可。
  // - dbId なし + schema なし → no filter
  // - dbId あり + schema なし → db で絞る
  // - dbId なし + schema あり → schema で絞る (COALESCE で NULL を 'public' 扱い)
  // - dbId あり + schema あり → 両方で絞る
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (dbId) {
    const dbIdValues = dockerDbIdFilterValues(dbId);
    conditions.push(
      dbIdValues.length === 1
        ? "db_id = ?"
        : `db_id IN (${dbIdValues.map(() => "?").join(", ")})`,
    );
    params.push(...dbIdValues);
  }
  if (schema !== undefined) {
    conditions.push("COALESCE(schema_name, 'public') = ?");
    params.push(schema);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const sql = `SELECT id, db_id, schema_name, kind, note, created_at, status, error_message FROM snapshots ${where} ORDER BY created_at DESC`;
  const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];
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
      `DELETE FROM snapshot_table_revisions
       WHERE status = 'done'
         AND NOT EXISTS (
           SELECT 1 FROM snapshot_tables
           WHERE snapshot_tables.revision_id = snapshot_table_revisions.id
         )`,
    ).run();
    db.prepare(
      "DELETE FROM snapshot_table_revisions WHERE source_snapshot_id = ? AND status = 'building'",
    ).run(snapshotId);
    deleteOrphanPayloads(db);
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
  return getSnapshotScopeRow(db, snapshotId);
}

// handleDiffTables がレスポンスに dbId/schema (= ブラウザの差分URL構築に
// 必要な scope) を additive に乗せるための公開版。正規化前の生 dbId を返す
// getSnapshotScope と違い、こちらは呼び出し側の利便性のため正規化済みを返す。
export async function getSnapshotScopeById(
  cwd: string,
  snapshotId: string,
): Promise<{ dbId: string; schema: string }> {
  const db = await getStoreDb(cwd);
  const scope = getSnapshotScope(db, snapshotId);
  return {
    dbId: canonicalizeDockerDbId(scope.dbId) ?? scope.dbId,
    schema: scope.schema,
  };
}

function assertSameSnapshotScope(
  db: SqliteDb,
  beforeId: string,
  afterId: string,
): void {
  const before = getSnapshotScope(db, beforeId);
  const after = getSnapshotScope(db, afterId);
  const beforeDbId = canonicalizeDockerDbId(before.dbId) ?? before.dbId;
  const afterDbId = canonicalizeDockerDbId(after.dbId) ?? after.dbId;
  if (beforeDbId !== afterDbId || before.schema !== after.schema) {
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
           FROM snapshot_rows_resolved a
           LEFT JOIN snapshot_rows_resolved b ON b.snapshot_id = ? AND b.table_name = ? AND b.row_key_hash = a.row_key_hash
           WHERE a.snapshot_id = ? AND a.table_name = ? AND b.row_key_hash IS NULL`,
        )
        .get(beforeId, table, afterId, table) as { cnt: number }
    ).cnt;

    const deletedCount = (
      db
        .prepare(
          `SELECT COUNT(*) AS cnt
           FROM snapshot_rows_resolved b
           LEFT JOIN snapshot_rows_resolved a ON a.snapshot_id = ? AND a.table_name = ? AND a.row_key_hash = b.row_key_hash
           WHERE b.snapshot_id = ? AND b.table_name = ? AND a.row_key_hash IS NULL`,
        )
        .get(afterId, table, beforeId, table) as { cnt: number }
    ).cnt;

    const updatedCount = (
      db
        .prepare(
          `SELECT COUNT(*) AS cnt
           FROM snapshot_rows_resolved b
           INNER JOIN snapshot_rows_resolved a ON a.snapshot_id = ? AND a.table_name = ? AND a.row_key_hash = b.row_key_hash
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
       FROM snapshot_rows_resolved a
       LEFT JOIN snapshot_rows_resolved b ON b.snapshot_id = ? AND b.table_name = ? AND b.row_key_hash = a.row_key_hash
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
       FROM snapshot_rows_resolved b
       LEFT JOIN snapshot_rows_resolved a ON a.snapshot_id = ? AND a.table_name = ? AND a.row_key_hash = b.row_key_hash
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
       FROM snapshot_rows_resolved b
       INNER JOIN snapshot_rows_resolved a ON a.snapshot_id = ? AND a.table_name = ? AND a.row_key_hash = b.row_key_hash
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
