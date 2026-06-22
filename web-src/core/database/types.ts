export type DbKind =
  | "sqlite"
  | "postgresql"
  | "mysql"
  | "redis"
  | "elasticsearch";

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

// --- Redis ---

export type RedisType =
  | "string"
  | "list"
  | "set"
  | "zset"
  | "hash"
  | "stream"
  | "none";

// Redis 内の任意 byte 列を表現する。utf8 として round-trip 可能なら
// 素のままの string、不可なら base64 化したラッパーを返す。
// list/set/zset/hash/stream の要素・field/value 名に binary が混じる可能性がある。
export type RedisItem = string | { binaryBase64: string };

export type RedisHashField = { field: RedisItem; value: RedisItem };

export type RedisValue =
  | {
      type: "string";
      value: string;
      binaryBase64?: string;
      truncated: boolean;
      fullSize: number;
    }
  | {
      type: "list";
      items: RedisItem[];
      truncated: boolean;
      total: number;
    }
  | {
      type: "hash";
      // field 名も binary 可能なので Record ではなく array of {field, value}。
      fields: RedisHashField[];
      truncated: boolean;
      total: number;
    }
  | {
      type: "set";
      members: RedisItem[];
      truncated: boolean;
      total: number;
    }
  | {
      type: "zset";
      members: Array<{ member: RedisItem; score: number }>;
      truncated: boolean;
      total: number;
    }
  | {
      type: "stream";
      entries: Array<{ id: string; fields: RedisHashField[] }>;
      truncated: boolean;
      total: number;
    }
  | { type: "none" };

export type RedisDatabasesResponse = {
  dbId: string;
  databases: Array<{ index: number; keyCount: number }>;
};

export type RedisKeysResponse = {
  dbId: string;
  dbIndex: number;
  keys: Array<{ name: string; type: RedisType }>;
  nextCursor: string;
};

export type RedisValueResponse = {
  dbId: string;
  dbIndex: number;
  key: string;
  value: RedisValue;
};

// ---------- Elasticsearch ----------

export type EsIndexInfo = {
  name: string;
  docCount: number;
  sizeBytes: number;
  health?: string;
  status?: string;
};

export type EsMappingProperty = {
  type?: string;
  // ES の mapping は再帰的だが、UI 表示用には flat か浅い表示で十分。
  // 内部にネストがあるときは properties を持つ。
  properties?: Record<string, EsMappingProperty>;
  // 他フィールドはそのまま raw に格納。
  [key: string]: unknown;
};

export type EsMapping = {
  index: string;
  properties: Record<string, EsMappingProperty>;
};

export type EsDocHit = {
  _index: string;
  _id: string;
  _score?: number | null;
  _source: unknown;
  // search_after 用の sort 値。検索結果に sort を含めるとき入る。
  sort?: unknown[];
  _seq_no?: number;
  _primary_term?: number;
};

export type EsSearchResult = {
  totalHits: number;
  hits: EsDocHit[];
  // 続きを取りたい呼び出し元のためにそのまま渡す。
  lastSort?: unknown[];
};

export type EsIndicesResponse = {
  dbId: string;
  indices: EsIndexInfo[];
};

export type EsMappingResponse = {
  dbId: string;
  mapping: EsMapping;
};

export type EsDocsResponse = {
  dbId: string;
  index: string;
  hits: EsDocHit[];
  totalHits: number;
  lastSort?: unknown[];
};

export type EsDocResponse = {
  dbId: string;
  index: string;
  id: string;
  found: boolean;
  source: unknown;
  seqNo?: number;
  primaryTerm?: number;
};

export type EsQueryRequest = {
  method: "GET" | "POST";
  path: string;
  body?: unknown;
};

export type EsQueryResponse = {
  dbId: string;
  status: number;
  body: unknown;
  elapsedMs: number;
  error?: string;
};

// ---------- Tabs ----------

// 1 つの database タブ。画面全体 (サイドバー + メイン pane + 履歴 pane) の
// 独立 instance に対応する。dbId が null のときは「未選択タブ」(まだ DB を
// 選んでいない状態)。
export type TabState = {
  id: string;
  dbId: string | null;
  table: string | null;
  view: "data" | "query" | "schema" | "er" | "search" | "snapshot";
};

export type TabsState = {
  version: 1;
  tabs: TabState[];
  activeTabId: string | null;
};

export type TabsResponse = TabsState;
