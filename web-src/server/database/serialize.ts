import type { DbValue } from "../../core/database/types";

export type RawDbValue = DbValue | bigint;
export type RawDbRow = RawDbValue[];

const MIN_SAFE = BigInt(Number.MIN_SAFE_INTEGER);
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

export function serializeDbValue(value: RawDbValue): DbValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "bigint") {
    return value >= MIN_SAFE && value <= MAX_SAFE
      ? Number(value)
      : value.toString();
  }
  if (value instanceof Uint8Array) {
    return `<blob ${value.byteLength} bytes>`;
  }
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return value;
}

export function serializeDbRow(row: RawDbRow): DbValue[] {
  return row.map(serializeDbValue);
}

export function serializeDbRows(rows: RawDbRow[]): DbValue[][] {
  return rows.map(serializeDbRow);
}

export function serializeDbRecord(
  record: Record<string, RawDbValue>,
): Record<string, DbValue> {
  const out: Record<string, DbValue> = {};
  for (const key of Object.keys(record)) {
    out[key] = serializeDbValue(record[key]);
  }
  return out;
}
