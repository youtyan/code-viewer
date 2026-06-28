import type {
  DbColumn,
  DbForeignKey,
  DbIndexInfo,
  DbKind,
  DbOrder,
  DbTableInfo,
  DbValue,
  RowMutation,
} from "../../../core/database/types";
import type { RawDbValue } from "../serialize";

export type MutationResult = {
  // 適用された変更件数。SQLite は実際の影響行数 (result.changes) の合計。
  // CLI 経由の PostgreSQL/MySQL は 1 文ごとの行数を取得できないため、適用した
  // ステートメント数を返す (= 概算。マッチ 0 行の UPDATE/DELETE も 1 と数える)。
  // クライアントはこの値を表示用途にのみ使い、厳密な行数として扱わないこと。
  affected: number;
};

export type QueryResult = {
  columns: string[];
  columnTypes: string[];
  rows: RawDbValue[][];
  rowCount: number;
};

export type TablePageMeta = {
  columns: DbColumn[];
  rows: RawDbValue[][];
  rowCount: number;
  totalRows: number;
};

export type TriggerInfo = {
  name: string;
  sql: string;
};

export type DatabaseAdapter = {
  readonly kind: DbKind;
  getTablesAsync(signal?: AbortSignal): Promise<DbTableInfo[]>;
  getColumnsAsync(table: string, signal?: AbortSignal): Promise<DbColumn[]>;
  getColumnsMultiAsync(
    tables: string[],
    signal?: AbortSignal,
  ): Promise<Map<string, DbColumn[]>>;
  getIndexesAsync(signal?: AbortSignal): Promise<DbIndexInfo[]>;
  getForeignKeysAsync(signal?: AbortSignal): Promise<DbForeignKey[]>;
  getTableRowCountAsync(table: string, signal?: AbortSignal): Promise<number>;
  getTableRowCountsAsync(
    tables: string[],
    signal?: AbortSignal,
  ): Promise<Map<string, number>>;
  getTablePageAsync(
    table: string,
    options: { offset: number; limit: number; orderBy?: DbOrder[] },
    signal?: AbortSignal,
  ): Promise<QueryResult>;
  getTablePageWithMeta(
    table: string,
    options: { offset: number; limit: number; orderBy?: DbOrder[] },
    signal?: AbortSignal,
  ): Promise<TablePageMeta>;
  getFilteredTablePageWithMeta(
    table: string,
    options: {
      offset: number;
      limit: number;
      orderBy?: DbOrder[];
      grouped: Map<string, string[]>;
      /** カラム完全一致条件（外部キー参照などの WHERE）。 */
      exact?: { column: string; value: string }[];
    },
    signal?: AbortSignal,
  ): Promise<TablePageMeta>;
  executeReadonlyQueryAsync(
    sql: string,
    params?: DbValue[],
    maxRows?: number,
    signal?: AbortSignal,
  ): Promise<QueryResult>;
  invalidateTableMetaCache?(table?: string): void;
  // 行の編集 / 追加 / 削除を 1 トランザクションで適用する。実装しない adapter
  // (= 書き込み未対応のデータストア) では undefined。
  applyMutations?(
    table: string,
    mutations: RowMutation[],
    signal?: AbortSignal,
  ): Promise<MutationResult>;
  getCreateStatementAsync(table: string, signal?: AbortSignal): Promise<string>;
  getTriggersAsync(table: string, signal?: AbortSignal): Promise<TriggerInfo[]>;
  close(): void;
};

export type SnapshotRowData = {
  rowKeyJson: string;
  rowHash: string;
  payloadJson: string;
};

export type SnapshotRowBatch = {
  table: string;
  rows: SnapshotRowData[];
};

export type AdapterSearchHit = {
  table: string;
  column: string;
  rowPreview: import("../../../core/database/types").DbValue[];
  valuePreview: string;
};

export type DatabaseAdapterFactory = {
  open(path: string): Promise<DatabaseAdapter>;
};
