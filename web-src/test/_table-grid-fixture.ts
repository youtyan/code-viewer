// table-grid の UI テストが使う共有フィクスチャ。各テストが同じ形の
// DbTableDataResponse を組み立てていたので 1 か所にまとめる。
// `_` 始まりなので vitest のグロブには入らない (テスト本体ではない)。

import type {
  DbColumn,
  DbTableDataResponse,
  DbValue,
} from "../core/database/types";

export function tableData(opts: {
  dbId: string;
  table: string;
  columns: DbColumn[];
  rows: DbValue[][];
}): DbTableDataResponse {
  return {
    dbId: opts.dbId,
    table: opts.table,
    columns: opts.columns,
    rows: opts.rows.map((row) => [...row]),
    totalRows: opts.rows.length,
    offset: 0,
    limit: 200,
    hasMore: false,
  };
}
