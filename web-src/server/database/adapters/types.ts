import type {
  DbColumn,
  DbForeignKey,
  DbIndexInfo,
  DbKind,
  DbOrder,
  DbTableInfo,
  DbValue,
} from "../../../core/database/types";
import type { RawDbValue } from "../serialize";

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
