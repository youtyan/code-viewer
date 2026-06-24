import type { DbColumn, DbValue } from "../../core/database/types";
import type { DatabaseAdapter } from "./adapters/types";
import { serializeDbRow, serializeDbValue } from "./serialize";

export type SearchHit = {
  table: string;
  column: string;
  rowKeyJson?: string;
  valuePreview: string;
  rowPreview: DbValue[];
};

export type SearchProgress = {
  scannedTables: number;
  totalTables: number;
  currentTable?: string;
  hits: SearchHit[];
  done: boolean;
  error?: string;
};

function sanitizeIdentifier(
  name: string,
  kind: "sqlite" | "postgresql" | "mysql",
): string {
  if (kind === "mysql") return `\`${name.replace(/`/g, "``")}\``;
  return `"${name.replace(/"/g, '""')}"`;
}

function escapeSqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function isTextLikeType(type: string): boolean {
  const upper = type.toUpperCase();
  return (
    upper.includes("CHAR") ||
    upper.includes("TEXT") ||
    upper.includes("VARCHAR") ||
    upper.includes("CLOB") ||
    upper.includes("STRING") ||
    upper === "JSON" ||
    upper === "JSONB" ||
    upper === "XML" ||
    upper === "UUID"
  );
}

function escapeLikeTerm(term: string): string {
  return term.replace(/=/g, "==").replace(/%/g, "=%").replace(/_/g, "=_");
}

export function searchTable(
  adapter: DatabaseAdapter,
  table: string,
  columns: DbColumn[],
  term: string,
  maxHits: number,
  includeNonText: boolean,
  pkColumns: string[],
): SearchHit[] {
  const kind = adapter.kind as "sqlite" | "postgresql" | "mysql";
  const searchCols = includeNonText
    ? columns.filter(
        (c) =>
          c.type.toUpperCase() !== "BLOB" && c.type.toUpperCase() !== "BYTEA",
      )
    : columns.filter((c) => isTextLikeType(c.type));

  if (searchCols.length === 0) return [];

  const escapedTerm = escapeLikeTerm(term);
  const tbl = sanitizeIdentifier(table, kind);
  const hits: SearchHit[] = [];

  for (const col of searchCols) {
    if (hits.length >= maxHits) break;

    const colId = sanitizeIdentifier(col.name, kind);
    const castCol =
      kind === "mysql" ? `CAST(${colId} AS CHAR)` : `CAST(${colId} AS TEXT)`;

    let sql: string;
    const remaining = maxHits - hits.length;
    if (kind === "sqlite") {
      sql = `SELECT * FROM ${tbl} WHERE ${castCol} LIKE ? ESCAPE '='`;
    } else {
      const likeVal = escapeSqlString(`%${escapedTerm}%`);
      sql = `SELECT * FROM ${tbl} WHERE ${castCol} LIKE ${likeVal} ESCAPE '='`;
    }

    try {
      const result =
        kind === "sqlite"
          ? adapter.executeReadonlyQuery(sql, [`%${escapedTerm}%`], remaining)
          : adapter.executeReadonlyQuery(sql, undefined, remaining);

      for (const row of result.rows) {
        const colIdx = result.columns.indexOf(col.name);
        const valueRaw = colIdx >= 0 ? serializeDbValue(row[colIdx]) : null;
        const valueStr = valueRaw == null ? "" : String(valueRaw);
        const preview =
          valueStr.length > 200 ? `${valueStr.slice(0, 200)}...` : valueStr;

        let rowKeyJson: string | undefined;
        if (pkColumns.length > 0) {
          const keyObj: Record<string, DbValue> = {};
          for (const pk of pkColumns) {
            const pkIdx = result.columns.indexOf(pk);
            if (pkIdx >= 0) keyObj[pk] = serializeDbValue(row[pkIdx]);
          }
          rowKeyJson = JSON.stringify(keyObj);
        }

        hits.push({
          table,
          column: col.name,
          rowKeyJson,
          valuePreview: preview,
          rowPreview: serializeDbRow(row),
        });
      }
    } catch {
      // skip columns that fail (e.g. generated columns)
    }
  }

  return hits;
}

export function getPrimaryKeyColumns(
  adapter: DatabaseAdapter,
  table: string,
): string[] {
  const columns = adapter.getColumns(table);
  return columns.filter((c) => c.primaryKey).map((c) => c.name);
}
