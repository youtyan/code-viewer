export type DbKind =
  | "sqlite"
  | "postgresql"
  | "mysql"
  | "redis"
  | "elasticsearch"
  | "s3"
  | "dynamodb";

export type DbValue = string | number | boolean | null | Uint8Array;

export type DbColumn = {
  name: string;
  type: string;
  nullable: boolean;
  primaryKey: boolean;
  defaultValue: string | null;
  comment?: string | null;
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
  fromSchema?: string;
  fromTable: string;
  fromColumn: string;
  toSchema?: string;
  toTable: string;
  toColumn: string;
  // DB に宣言された FK か、命名規約 (例: Rails の <table>_id → <table>.id)
  // から推測したもの (= virtual FK) か。クライアント側で関連パネル等に
  // 視覚マーカー (リスト項目色や行末の "ʳ" ラベル等) を出すために使う。
  // サーバ adapter は常に省略 (= 実 FK)。
  inferred?: "rails";
};

export type DbSchemaResponse = {
  dbId: string;
  schema?: string;
  tables: DbTableInfo[];
  indexes: DbIndexInfo[];
  foreignKeys: DbForeignKey[];
  columnsMap?: Record<string, DbColumn[]>;
  /** サーバがスキーマ列挙のために発行した SQL (sqlite_master / information_schema
   * など)。session log 表示用。 */
  executedSql?: string[];
};

export type DbSchemaInfo = {
  name: string;
};

export type DbSchemasResponse = {
  dbId: string;
  schemas: DbSchemaInfo[];
  selectedSchema?: string;
  /** サーバが応答中に発行した SQL (DDL 取得・行数集計・スキーマ列挙など)。
   * クライアントの session log 表示用。Redis/ES/S3 など SQL を発行しない
   * データストアでは空配列もしくは undefined。 */
  executedSql?: string[];
};

export type DbTableDataResponse = {
  dbId: string;
  schema?: string;
  table: string;
  columns: DbColumn[];
  rows: DbValue[][];
  totalRows: number;
  offset: number;
  limit: number;
  hasMore: boolean;
  /** サーバがこのページを取得するために発行した SQL (COUNT + SELECT)。 */
  executedSql?: string[];
};

export type DbTableCountResponse = {
  dbId: string;
  schema?: string;
  table: string;
  rowCount: number | null;
  /** サーバがこの件数取得のために発行した SQL。 */
  executedSql?: string[];
};

// --- Row writes (edit / insert / delete) ---

// クライアントが書き込みのために送る 1 セルの値。value はユーザー入力の
// 生文字列で、サーバ側が列の型に応じて型変換する (coerceDbValue)。
// null は SQL の NULL を表す (空文字列 "" とは区別する)。
export type DbCellInput = { column: string; value: string | null };

// 1 行に対する変更。生 SQL はクライアントから送らず、テーブル名・主キー条件・
// 列値の正規化された形だけを送る (インジェクション面を構造的に断つ)。
export type RowMutation =
  | { kind: "insert"; values: DbCellInput[] }
  | { kind: "update"; pk: DbCellInput[]; values: DbCellInput[] }
  | { kind: "delete"; pk: DbCellInput[] };

export type DbMutateResponse = {
  dbId: string;
  schema?: string;
  table: string;
  // 影響を受けた行数の合計。
  affected: number;
  /** サーバが実際に実行した INSERT/UPDATE/DELETE 文の配列。クライアントの
   * session log 表示用。複数 mutation を 1 トランザクションで適用するので
   * 配列。 */
  executedSql?: string[];
};

export type DbQueryResponse = {
  dbId: string;
  schema?: string;
  columns: string[];
  columnTypes: string[];
  rows: DbValue[][];
  rowCount: number;
  truncated: boolean;
  elapsedMs: number;
  error?: string;
  /** サーバが実行した SQL (通常はクライアントが POST した body.sql と同じ)。
   * session log 表示用。 */
  executedSql?: string[];
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
  truncated?: boolean;
  /** Docker-side discovery/listing error; other source files may still exist. */
  dockerError?: string;
};

export type DbOrderDirection = "asc" | "desc";

export type DbOrder = {
  column: string;
  direction: DbOrderDirection;
};

export type QueryHistoryEntry = {
  id: string;
  dbId: string;
  schema?: string;
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
  schema?: string;
  table: string;
  column: string;
  rowKeyJson?: string;
  valuePreview: string;
  rowPreview: DbValue[];
};

export type GlobalSearchOptions = {
  dbId: string;
  schema?: string;
  term: string;
  tables?: string[];
  maxHitsPerTable?: number;
  includeNonText?: boolean;
};

export type GlobalSearchProgress = {
  jobId: string;
  dbId: string;
  schema?: string;
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
  schema?: string;
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
  /** どちらの snapshot に取得対象として含まれていたか。
   *  - "both": before/after の両方で取得済み (通常の差分計算が成立)
   *  - "before-only": before のみで取得、after は未取得 (= 比較不能)
   *  - "after-only":  after のみで取得、before は未取得 (= 比較不能)
   * 未取得側を「全行 insert / 全行 delete」と表示するのは誤誘導なので
   * client 側で coverage を見て「未取得」ラベルに切り替える。 */
  coverage?: "both" | "before-only" | "after-only";
  /** 片側未取得の場合に、取得済み側の行数。表示用の参考値。 */
  unsnapshottedRowCount?: number;
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

export type EsQueryResult = {
  status: number;
  body: unknown;
  elapsedMs: number;
};

export type EsQueryResponse = EsQueryResult & {
  dbId: string;
  error?: string;
};

export type RedisExplorerSelection = {
  dbIndex?: number;
  key?: string;
  keyFilter?: string;
};

export type ElasticsearchExplorerSelection = {
  index?: string;
  query?: string;
};

// ---------- DynamoDB ----------

export type DynamoDbAttributeValue =
  | { S: string }
  | { N: string }
  | { B: string }
  | { BOOL: boolean }
  | { NULL: boolean }
  | { M: Record<string, DynamoDbAttributeValue> }
  | { L: DynamoDbAttributeValue[] }
  | { SS: string[] }
  | { NS: string[] }
  | { BS: string[] };

export type DynamoDbKey = Record<string, DynamoDbAttributeValue>;
export type DynamoDbItem = Record<string, DynamoDbAttributeValue>;

export type DynamoDbTableDescription = {
  TableName?: string;
  TableStatus?: string;
  CreationDateTime?: number;
  ItemCount?: number;
  TableSizeBytes?: number;
  KeySchema?: Array<{ AttributeName: string; KeyType: string }>;
  AttributeDefinitions?: Array<{
    AttributeName: string;
    AttributeType: string;
  }>;
  BillingModeSummary?: { BillingMode?: string };
  GlobalSecondaryIndexes?: unknown[];
  LocalSecondaryIndexes?: unknown[];
  [key: string]: unknown;
};

export type DynamoDbTablesResponse = {
  dbId: string;
  tableNames: string[];
  lastEvaluatedTableName?: string;
};

export type DynamoDbTableResponse = {
  dbId: string;
  table: DynamoDbTableDescription;
};

export type DynamoDbItemsResponse = {
  dbId: string;
  tableName: string;
  mode: "scan" | "query";
  items: DynamoDbItem[];
  count: number;
  scannedCount: number;
  lastEvaluatedKey?: DynamoDbKey;
};

export type DynamoDbItemResponse = {
  dbId: string;
  tableName: string;
  key: DynamoDbKey;
  item?: DynamoDbItem;
  consumedCapacity?: unknown;
};

// ---------- S3 / object storage ----------

export type S3SearchMode = "prefix" | "contains";
export type S3SortMode = "key-asc" | "updated-desc";

export type S3BucketInfo = {
  name: string;
  createdAt?: string;
};

export type S3ObjectInfo = {
  key: string;
  sizeBytes: number;
  updatedAt?: string;
  etag?: string;
  contentType?: string;
  storageClass?: string;
};

export type S3BucketsResponse = {
  dbId: string;
  buckets: S3BucketInfo[];
};

export type S3ObjectsResponse = {
  dbId: string;
  bucket: string;
  prefix: string;
  search: string;
  mode: S3SearchMode;
  sort: S3SortMode;
  objects: S3ObjectInfo[];
  nextToken?: string;
  truncated: boolean;
  scannedObjects: number;
  scannedPages: number;
  scanLimitReached?: boolean;
};

export type S3FolderResponse = {
  dbId: string;
  bucket: string;
  prefix: string;
  folders: string[];
  objects: S3ObjectInfo[];
  nextToken?: string;
};

export type S3ObjectHeadResponse = {
  dbId: string;
  bucket: string;
  key: string;
  sizeBytes: number | null;
  contentType?: string;
  updatedAt?: string;
  etag?: string;
};

export type S3ObjectTextResponse = S3ObjectHeadResponse & {
  text: string;
  truncated: boolean;
};

export type S3ViewMode = "list" | "explorer";

export type S3ExplorerSelection = {
  bucket?: string;
  prefix?: string;
  query?: string;
  mode?: S3SearchMode;
  sort?: S3SortMode;
  key?: string;
  view?: S3ViewMode;
  // エクスプローラ表示で現在開いているフォルダ (末尾 "/"、ルートは空)。
  path?: string;
};

// ---------- DynamoDB explorer selection ----------

export type DynamoDbExplorerSelection = {
  table?: string;
  mode?: "scan" | "query";
  keyConditionExpression?: string;
  filterExpression?: string;
  // Query/Filter expression のプレースホルダに対応する値。DynamoDB の
  // AttributeValue 表記 (例: {":pk": {"S": "value"}}) の JSON 文字列のまま
  // 保存する (パース済み object にすると tabs.json 側のサニタイズが複雑になるため)。
  expressionAttributeValues?: string;
  scanIndexForward?: boolean;
  // 選択中アイテムを再選択するためのキー。DynamoDbKey を JSON.stringify した文字列。
  itemKey?: string;
};

// ---------- Tabs ----------

// 1 つの database タブ。画面全体 (サイドバー + メイン pane + 履歴 pane) の
// 独立 instance に対応する。dbId が null のときは「未選択タブ」(まだ DB を
// 選んでいない状態)。
//
// optional フィールドはすべて backward-compatible: 旧形式 tabs.json (id/dbId/
// table/view のみ) はそのまま読める。これらは「タブ独立で永続化したい」UI
// 状態 (Chrome のタブと同じ感覚で、タブごとに別の値を保持して reload で
// 復元する)。
export type TabState = {
  id: string;
  dbId: string | null;
  schema?: string;
  table: string | null;
  view: "data" | "query" | "schema" | "er" | "search" | "snapshot";

  // Query editor (SQL タブ) の textarea 内容。リロードで復元される。
  sqlDraft?: string;

  // history pane の開閉状態。タブごとに独立。default は true (= 開いている)。
  historyOpen?: boolean;

  // history pane の高さ。CSS pixel 表現 (例: "240px")。
  historyHeight?: string;

  // history pane で開いていたタブ。default は "history" (= クエリ履歴)。
  activeHistoryTab?: "history" | "log";

  // sidebar 幅。CSS pixel 表現 (例: "240px")。
  sidebarWidth?: string;

  // FK 関連パネルの高さ。CSS pixel 表現 (例: "320px")。
  relatedPanelHeight?: string;

  // セル詳細フッタ (db-grid-detail-panel) の高さ。CSS pixel 表現 (例: "240px")。
  detailPanelHeight?: string;

  // Redis explorer の選択中 state。SQL の table を persist するのと整合的に、
  // Redis でも「選択中の db index + key」を persist する。
  redis?: RedisExplorerSelection;

  // Elasticsearch explorer の選択中 state。SQL の table と整合的に、
  // 「選択中の index + lucene query 文字列」を persist する。
  es?: ElasticsearchExplorerSelection;

  // S3 explorer の選択中 state。
  s3?: S3ExplorerSelection;

  // DynamoDB explorer の選択中 state。
  dynamodb?: DynamoDbExplorerSelection;
};

export type TabsState = {
  version: 1;
  tabs: TabState[];
  activeTabId: string | null;
};

export type TabsResponse = TabsState;
