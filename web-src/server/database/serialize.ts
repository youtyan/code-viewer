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

// serializeDbValue の逆方向。クライアントから来たユーザー入力文字列を、列の型
// (SQL の affinity / 型名) に応じて DbValue に変換する。書き込み (INSERT/UPDATE)
// 時に使う。null はそのまま NULL。曖昧なときは元の文字列のまま返し、DB 側の型
// 変換 (SQLite の affinity 等) に委ねる。
export function coerceDbValue(
  value: string | null,
  columnType: string,
): DbValue {
  if (value === null) return null;
  const t = (columnType || "").toLowerCase();
  // boolean 系。0/1 (number) に正規化しておくと、param バインドでもリテラル
  // レンダリングでも素直に扱える。
  if (/bool/.test(t)) {
    const v = value.trim().toLowerCase();
    if (v === "true" || v === "t" || v === "1") return 1;
    if (v === "false" || v === "f" || v === "0") return 0;
    // 認識できない値は DB 側の判断に委ねる。
    return value;
  }
  // 数値系。元の文字列と数値の round-trip が一致する場合のみ数値化する
  // ("0123" や "1e3" のような表現を勝手に書き換えないため)。
  if (/int|serial|real|floa|doub|numeric|decimal|number/.test(t)) {
    const trimmed = value.trim();
    if (trimmed === "") return value;
    const n = Number(trimmed);
    if (Number.isFinite(n) && String(n) === trimmed) return n;
    return value;
  }
  return value;
}
