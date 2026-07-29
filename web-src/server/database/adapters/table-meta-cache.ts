// 1 リクエストで複数回引かれるテーブルメタ (列定義・行数) の短命キャッシュ。
// リモート越しの adapter (docker exec / HTTP) は 1 回の往復が高いので、
// 同一テーブルへの連続アクセスを TTL 内でまとめる。

import type { DbColumn } from "../../../core/database/types";

const COLUMNS_TTL_MS = 30_000;
const ROWCOUNT_TTL_MS = 15_000;

type CacheEntry<T> = { value: T; expires: number };

export type TableMetaCache = {
  getColumns(
    table: string,
    load: () => DbColumn[] | Promise<DbColumn[]>,
  ): Promise<DbColumn[]>;
  getRowCount(
    table: string,
    load: () => number | Promise<number>,
  ): Promise<number>;
  invalidate(table?: string): void;
};

export function createTableMetaCache(now = () => Date.now()): TableMetaCache {
  const columns = new Map<string, CacheEntry<DbColumn[]>>();
  const rowCounts = new Map<string, CacheEntry<number>>();

  async function readThrough<T>(
    store: Map<string, CacheEntry<T>>,
    table: string,
    ttlMs: number,
    load: () => T | Promise<T>,
  ): Promise<T> {
    const cached = store.get(table);
    if (cached && cached.expires > now()) return cached.value;
    const value = await load();
    store.set(table, { value, expires: now() + ttlMs });
    return value;
  }

  return {
    getColumns(table, load) {
      return readThrough(columns, table, COLUMNS_TTL_MS, load);
    },

    getRowCount(table, load) {
      return readThrough(rowCounts, table, ROWCOUNT_TTL_MS, load);
    },

    invalidate(table?: string): void {
      if (table) {
        columns.delete(table);
        rowCounts.delete(table);
        return;
      }
      columns.clear();
      rowCounts.clear();
    },
  };
}
