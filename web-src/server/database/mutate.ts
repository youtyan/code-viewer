import type {
  DbCellInput,
  DbColumn,
  RowMutation,
} from "../../core/database/types";
import {
  buildDeleteSql,
  buildInsertSql,
  buildUpdateSql,
  type SqlKind,
  type WriteSql,
} from "./sql-utils";

// 1 リクエストで受け付ける mutation 数の上限 (暴走/巨大ペイロード防止)。
export const MAX_MUTATIONS = 1000;

function assertCells(cells: unknown, label: string): DbCellInput[] {
  if (!Array.isArray(cells)) {
    throw new Error(`${label} must be an array`);
  }
  for (const cell of cells) {
    if (
      !cell ||
      typeof cell !== "object" ||
      typeof (cell as DbCellInput).column !== "string" ||
      ((cell as DbCellInput).value !== null &&
        typeof (cell as DbCellInput).value !== "string")
    ) {
      throw new Error(`${label} contains an invalid cell`);
    }
  }
  return cells as DbCellInput[];
}

// RowMutation[] を検証し、各 kind に対応する WriteSql に変換する。
// 不正な入力 (未知のカラム、主キー欠落など) は Error を投げる。生 SQL を
// クライアントから受け取らないため、ここがクライアント入力に対する唯一の
// 検証点になる。
export function buildMutationStatements(
  table: string,
  mutations: RowMutation[],
  columns: DbColumn[],
  kind: SqlKind,
): WriteSql[] {
  if (!Array.isArray(mutations) || mutations.length === 0) {
    throw new Error("no mutations provided");
  }
  if (mutations.length > MAX_MUTATIONS) {
    throw new Error(`too many mutations (max ${MAX_MUTATIONS})`);
  }
  const columnTypes = new Map(columns.map((c) => [c.name, c.type]));
  const columnNames = new Set(columns.map((c) => c.name));
  const pkColumns = columns.filter((c) => c.primaryKey).map((c) => c.name);
  const pkNames = new Set(pkColumns);

  const requireKnownColumns = (cells: DbCellInput[], label: string): void => {
    for (const cell of cells) {
      if (!columnNames.has(cell.column)) {
        throw new Error(`unknown column: ${cell.column}`);
      }
    }
  };

  // update / delete の WHERE は宣言された主キーで一意特定する。主キーの全列が
  // 揃っていることを要求し、主キー以外を WHERE に混ぜさせない。主キーが無い
  // テーブルは現状 update/delete 非対応 (明示エラー)。
  const requirePrimaryKey = (pk: DbCellInput[]): void => {
    if (pkColumns.length === 0) {
      throw new Error(
        "table has no primary key; row update/delete is not supported",
      );
    }
    const provided = new Set(pk.map((c) => c.column));
    for (const name of pkColumns) {
      if (!provided.has(name)) {
        throw new Error(`missing primary key column: ${name}`);
      }
    }
    for (const cell of pk) {
      if (!pkNames.has(cell.column)) {
        throw new Error(`not a primary key column: ${cell.column}`);
      }
      if (cell.value === null) {
        throw new Error(`primary key column cannot be null: ${cell.column}`);
      }
    }
  };

  const statements: WriteSql[] = [];
  for (const mutation of mutations) {
    if (!mutation || typeof mutation !== "object") {
      throw new Error("invalid mutation");
    }
    if (mutation.kind === "insert") {
      const values = assertCells(mutation.values, "insert values");
      requireKnownColumns(values, "insert values");
      statements.push(buildInsertSql(table, values, columnTypes, kind));
    } else if (mutation.kind === "update") {
      const pk = assertCells(mutation.pk, "update pk");
      const values = assertCells(mutation.values, "update values");
      requirePrimaryKey(pk);
      requireKnownColumns(values, "update values");
      statements.push(buildUpdateSql(table, values, pk, columnTypes, kind));
    } else if (mutation.kind === "delete") {
      const pk = assertCells(mutation.pk, "delete pk");
      requirePrimaryKey(pk);
      statements.push(buildDeleteSql(table, pk, columnTypes, kind));
    } else {
      throw new Error(
        `unknown mutation kind: ${(mutation as { kind?: string }).kind}`,
      );
    }
  }
  return statements;
}
