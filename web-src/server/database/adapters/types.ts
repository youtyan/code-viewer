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

export type TriggerInfo = {
  name: string;
  sql: string;
};

export type DatabaseAdapter = {
  readonly kind: DbKind;
  getTables(): DbTableInfo[];
  getColumns(table: string): DbColumn[];
  getColumnsMulti?(tables: string[]): Map<string, DbColumn[]>;
  getIndexes(): DbIndexInfo[];
  getForeignKeys(): DbForeignKey[];
  getTableRowCount(table: string): number;
  getTableRowCounts?(tables: string[]): Map<string, number>;
  getTablePage(
    table: string,
    options: { offset: number; limit: number; orderBy?: DbOrder[] },
  ): QueryResult;
  executeReadonlyQuery(
    sql: string,
    params?: DbValue[],
    maxRows?: number,
  ): QueryResult;
  getCreateStatement(table: string): string;
  getTriggers(table: string): TriggerInfo[];
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
