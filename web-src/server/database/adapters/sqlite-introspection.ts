// SQLite 方言のイントロスペクション SQL と行→ドメイン型の変換。
// ローカルファイルを同期ドライバで読む adapters/sqlite.ts と、Cloudflare D1 を
// HTTP 越しに読む adapters/d1.ts の両方が同じ sqlite_master / PRAGMA を発行する
// ため、文面と変換をここに集約する (方言差は無い。実行経路だけが違う)。

import type { DbColumn, DbTableInfo } from "../../../core/database/types";
import { escapeSqlString, sanitizeIdentifier } from "../sql-utils";

export const SQLITE_INTROSPECTION_SQL = {
  listTables:
    "SELECT name, type FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY name",
  listIndexes:
    "SELECT name, tbl_name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  // FK 列挙の対象テーブル。仮想テーブル (FTS 等) は PRAGMA foreign_key_list が
  // 失敗しうるので最初から除く。
  listForeignKeyTables:
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND sql NOT LIKE '%VIRTUAL%' ORDER BY name",
  createStatement: "SELECT sql FROM sqlite_master WHERE name = ?",
  triggers:
    "SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name = ?",
} as const;

export function sqliteTableInfoSql(table: string): string {
  return `PRAGMA table_info(${sanitizeIdentifier(table)})`;
}

export function sqliteIndexListSql(table: string): string {
  return `PRAGMA index_list(${sanitizeIdentifier(table)})`;
}

export function sqliteIndexInfoSql(index: string): string {
  return `PRAGMA index_info(${sanitizeIdentifier(index)})`;
}

export function sqliteForeignKeyListSql(table: string): string {
  return `PRAGMA foreign_key_list(${sanitizeIdentifier(table)})`;
}

export type SqlitePragmaColumnRow = {
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
};

export function sqliteColumnFromPragmaRow(
  row: SqlitePragmaColumnRow,
): DbColumn {
  return {
    name: row.name,
    type: row.type || "TEXT",
    nullable: row.notnull === 0,
    primaryKey: row.pk > 0,
    defaultValue: row.dflt_value,
  };
}

export function sqliteTableInfoFromRow(row: {
  name: string;
  type: string;
}): DbTableInfo {
  return {
    name: row.name,
    type: row.type as "table" | "view",
    rowCount: null,
  };
}

// 複数テーブルの件数を 1 文で取るための UNION ALL。テーブル名は識別子として
// クォートし、突き合わせ用のラベルは文字列リテラルとしてエスケープする。
export function sqliteRowCountUnionSql(tables: string[]): string {
  return tables
    .map(
      (table) =>
        `SELECT ${escapeSqlString(table)} AS tbl, COUNT(*) AS cnt FROM ${sanitizeIdentifier(table)}`,
    )
    .join(" UNION ALL ");
}

export function sqliteRowCountSql(table: string): string {
  return `SELECT COUNT(*) AS cnt FROM ${sanitizeIdentifier(table)}`;
}

const SQLITE_READONLY_FIRST_WORDS = new Set([
  "SELECT",
  "PRAGMA",
  "EXPLAIN",
  "WITH",
]);

const SQLITE_BLOCKED_KEYWORDS_RE =
  /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|ATTACH|DETACH|REPLACE|VACUUM|REINDEX|LOAD_EXTENSION)\b/;

// クエリエディタから届いた任意 SQL の読み取り専用ガード。先頭キーワードの
// allowlist と書き込み系キーワードの denylist の二段構え。
export function assertReadonlySqliteStatement(sql: string): void {
  const upper = sql.trim().toUpperCase();
  if (!SQLITE_READONLY_FIRST_WORDS.has(upper.split(/\s/)[0])) {
    throw new Error(
      "Only SELECT, PRAGMA, EXPLAIN, and WITH queries are allowed",
    );
  }
  if (SQLITE_BLOCKED_KEYWORDS_RE.test(upper)) {
    throw new Error("Query contains a disallowed statement keyword");
  }
}

export function stripTrailingSemicolon(sql: string): string {
  return sql.trim().replace(/;\s*$/, "");
}
