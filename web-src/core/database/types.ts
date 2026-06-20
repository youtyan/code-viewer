export type DbKind = "sqlite" | "postgresql" | "mysql";

export type DbValue = string | number | boolean | null | Uint8Array;

export type DbColumn = {
  name: string;
  type: string;
  nullable: boolean;
  primaryKey: boolean;
  defaultValue: string | null;
};

export type DbTableInfo = {
  name: string;
  type: "table" | "view";
  rowCount: number | null;
};

export type DbIndexInfo = {
  name: string;
  table: string;
  columns: string[];
  unique: boolean;
};

export type DbForeignKey = {
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
};

export type DbSchemaResponse = {
  dbId: string;
  tables: DbTableInfo[];
  indexes: DbIndexInfo[];
  foreignKeys: DbForeignKey[];
  columnsMap?: Record<string, DbColumn[]>;
};

export type DbTableDataResponse = {
  dbId: string;
  table: string;
  columns: DbColumn[];
  rows: DbValue[][];
  totalRows: number;
  offset: number;
  limit: number;
  hasMore: boolean;
};

export type DbQueryResponse = {
  dbId: string;
  columns: string[];
  columnTypes: string[];
  rows: DbValue[][];
  rowCount: number;
  truncated: boolean;
  elapsedMs: number;
  error?: string;
};

export type DbFileInfo = {
  id: string;
  path: string;
  name: string;
  sizeBytes: number;
  kind: DbKind;
};

export type DbFilesResponse = {
  files: DbFileInfo[];
};

export type DbOrderDirection = "asc" | "desc";

export type DbOrder = {
  column: string;
  direction: DbOrderDirection;
};

export type QueryHistoryEntry = {
  id: string;
  dbId: string;
  sql: string;
  title?: string;
  body?: string;
  columns: string[];
  rowsPreview: DbValue[][];
  rowCount: number;
  savedRows: number;
  truncated: boolean;
  elapsedMs: number;
  executedAt: string;
  executedBy: "user" | "ai";
  source: "cli" | "browser";
};

export type QueryHistoryState = {
  version: 1;
  entries: QueryHistoryEntry[];
};

// --- Global Search ---

export type GlobalSearchHit = {
  table: string;
  column: string;
  rowKeyJson?: string;
  valuePreview: string;
  rowPreview: DbValue[];
};

export type GlobalSearchOptions = {
  dbId: string;
  term: string;
  tables?: string[];
  maxHitsPerTable?: number;
  includeNonText?: boolean;
};

export type GlobalSearchProgress = {
  jobId: string;
  dbId: string;
  scannedTables: number;
  totalTables: number;
  currentTable?: string;
  hits: GlobalSearchHit[];
  done: boolean;
  error?: string;
};

// --- Snapshot Diff ---

export type SnapshotMeta = {
  id: string;
  dbId: string;
  kind: DbKind;
  note: string;
  createdAt: string;
  tables: string[];
  status: "running" | "done" | "error";
  errorMessage?: string;
};

export type SnapshotTableSummary = {
  tableName: string;
  rowCount: number;
  tableHash: string;
  pkColumns: string[];
};

export type SnapshotDiffMeta = {
  id: string;
  beforeId: string;
  afterId: string;
  note: string;
  createdAt: string;
  status: "running" | "done" | "error";
  errorMessage?: string;
};

export type SnapshotDiffTableSummary = {
  tableName: string;
  insertedCount: number;
  updatedCount: number;
  deletedCount: number;
  unchangedCount: number;
};

export type SnapshotDiffChangeType = "inserted" | "updated" | "deleted";

export type SnapshotDiffRow = {
  changeType: SnapshotDiffChangeType;
  rowKeyJson: string;
  beforeValues?: Record<string, DbValue>;
  afterValues?: Record<string, DbValue>;
};
