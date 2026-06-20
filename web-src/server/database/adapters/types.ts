import type {
  DbColumn,
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

export type DatabaseAdapter = {
  readonly kind: DbKind;
  getTables(): DbTableInfo[];
  getColumns(table: string): DbColumn[];
  getIndexes(): DbIndexInfo[];
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
  close(): void;
};

export type DatabaseAdapterFactory = {
  open(path: string): Promise<DatabaseAdapter>;
};
