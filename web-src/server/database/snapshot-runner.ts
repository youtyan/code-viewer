import { createHash } from "node:crypto";
import type { DbValue } from "../../core/database/types";
import type { DatabaseAdapter } from "./adapters/types";
import {
  addSnapshotTableData,
  createSnapshot,
  finalizeSnapshot,
} from "./snapshot-store";

function normalizeValue(v: DbValue): string {
  if (v === null) return "\\N";
  if (v instanceof Uint8Array) {
    return `\\x${Buffer.from(v).toString("hex")}`;
  }
  return String(v);
}

function rowToPayloadJson(columns: string[], row: DbValue[]): string {
  const obj: Record<string, DbValue> = {};
  for (let i = 0; i < columns.length; i++) {
    obj[columns[i]] =
      row[i] instanceof Uint8Array
        ? `<blob ${(row[i] as Uint8Array).byteLength} bytes>`
        : row[i];
  }
  return JSON.stringify(obj);
}

function computeRowHash(columns: string[], row: DbValue[]): string {
  const parts = columns.map((_, i) => normalizeValue(row[i]));
  return createHash("sha256").update(parts.join("\t")).digest("hex");
}

function buildRowKeyJson(
  pkColumns: string[],
  allColumns: string[],
  row: DbValue[],
  rowIndex: number,
): string {
  if (pkColumns.length === 0) {
    return JSON.stringify({ __rowIndex: rowIndex });
  }
  const keyObj: Record<string, DbValue> = {};
  for (const pk of pkColumns) {
    const idx = allColumns.indexOf(pk);
    if (idx >= 0) keyObj[pk] = row[idx];
  }
  return JSON.stringify(keyObj);
}

const BATCH_SIZE = 500;

export async function runSnapshot(
  cwd: string,
  adapter: DatabaseAdapter,
  dbId: string,
  tables: string[],
  note: string,
  onProgress?: (table: string, done: boolean) => void,
): Promise<string> {
  const snapshotId = await createSnapshot(
    cwd,
    dbId,
    adapter.kind,
    tables,
    note,
  );

  try {
    for (const table of tables) {
      onProgress?.(table, false);

      const columns = adapter.getColumns(table);
      const colNames = columns.map((c) => c.name);
      const pkColumns = columns.filter((c) => c.primaryKey).map((c) => c.name);

      let offset = 0;
      let rowIndex = 0;
      const allRows: {
        rowKeyJson: string;
        rowHash: string;
        payloadJson: string;
      }[] = [];

      for (;;) {
        const result = adapter.getTablePage(table, {
          offset,
          limit: BATCH_SIZE,
        });
        if (result.rows.length === 0) break;

        for (const row of result.rows) {
          const rowKeyJson = buildRowKeyJson(
            pkColumns,
            colNames,
            row,
            rowIndex,
          );
          const rowHash = computeRowHash(colNames, row);
          const payloadJson = rowToPayloadJson(colNames, row);
          allRows.push({ rowKeyJson, rowHash, payloadJson });
          rowIndex++;
        }

        offset += result.rows.length;
        if (result.rows.length < BATCH_SIZE) break;
      }

      await addSnapshotTableData(cwd, snapshotId, table, pkColumns, allRows);
    }

    await finalizeSnapshot(cwd, snapshotId);
    onProgress?.("", true);
    return snapshotId;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await finalizeSnapshot(cwd, snapshotId, msg);
    throw err;
  }
}
