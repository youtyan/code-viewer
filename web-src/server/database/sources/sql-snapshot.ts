// SQL 系 adapter (sqlite / postgresql / mysql) が共通で使う snapshot 用
// helper。snapshot-runner.ts に inline で持っていたロジックをここに集約し、
// 各 adapter の iterateForSnapshot から呼べるようにする。
//
// Redis (KV) は payload shape が違うので別のロジックを使う (adapters/redis.ts
// 内で完結)。

import { createHash } from "node:crypto";
import type { DbValue } from "../../../core/database/types";
import type { RawDbValue } from "../serialize";
import { serializeDbValue } from "../serialize";

export function normalizeRawValue(v: RawDbValue): string {
  if (v === null) return "\\N";
  if (typeof v === "bigint") return v.toString();
  if (v instanceof Uint8Array) {
    return `\\x${Buffer.from(v).toString("hex")}`;
  }
  return String(v);
}

export function rowToPayloadJson(columns: string[], row: RawDbValue[]): string {
  const obj: Record<string, DbValue> = {};
  for (let i = 0; i < columns.length; i++) {
    obj[columns[i]] = serializeDbValue(row[i]);
  }
  return JSON.stringify(obj);
}

export function computeRowHash(columns: string[], row: RawDbValue[]): string {
  const parts = columns.map((_, i) => normalizeRawValue(row[i]));
  return createHash("sha256").update(parts.join("\t")).digest("hex");
}

export function buildRowKeyJson(
  pkColumns: string[],
  allColumns: string[],
  row: RawDbValue[],
  rowIndex: number,
): string {
  if (pkColumns.length === 0) {
    return JSON.stringify({ __rowIndex: rowIndex });
  }
  const keyObj: Record<string, DbValue> = {};
  for (const pk of pkColumns) {
    const idx = allColumns.indexOf(pk);
    if (idx >= 0) keyObj[pk] = serializeDbValue(row[idx]);
  }
  return JSON.stringify(keyObj);
}

export const SQL_SNAPSHOT_BATCH_SIZE = 500;
