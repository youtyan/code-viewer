import type {
  DbColumn,
  DbForeignKey,
  DbIndexInfo,
  DbKind,
  DbOrder,
  DbTableInfo,
  DbValue,
} from "../../../core/database/types";

export type QueryResult = {
  columns: string[];
  columnTypes: string[];
  rows: DbValue[][];
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
  getIndexes(): DbIndexInfo[];
  getForeignKeys(): DbForeignKey[];
  getTableRowCount(table: string): number;
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

export type DatabaseAdapterFactory = {
  open(path: string): Promise<DatabaseAdapter>;
};
