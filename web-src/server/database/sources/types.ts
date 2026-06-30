// PoC Round 2 で確定する data source 抽象。
//
// ふたつの軸を直交に組み合わせる:
//
//   1. データモデル別 source: SqlSource / KvSource / ObjectSource / DocSource
//      → record / container の概念対応が違うので一枚にまとめない。
//   2. 横断 capability mixin: SnapshotIterable / SearchableSource / Queryable
//      → snapshot や全文検索など、データモデルに依存しない振る舞いを差し込む。
//
// adapter は具体的なデータソースに合わせて両方を intersect した型を返す。
// 例: `SqlSource & SnapshotIterable` / `KvSource & SnapshotIterable`
//
// 旧 `DatabaseAdapter` (adapters/types.ts) は当面残し、SqlSource はそれを
// `& { model: "sql" }` で branded したものとして定義する。
// 既存 import は壊さない (`DatabaseAdapter` を直接使うコードは Round 2 では
// 変更なし)。

import type {
  DbColumn,
  DbForeignKey,
  DbIndexInfo,
  DbKind,
  DbOrder,
  DbTableInfo,
  DbValue,
  EsIndexInfo,
  EsMapping,
  EsSearchResult,
  S3BucketInfo,
  S3ObjectHeadResponse,
  S3ObjectInfo,
} from "../../../core/database/types";
import type {
  DatabaseAdapter,
  QueryResult,
  TriggerInfo,
} from "../adapters/types";

// ---------- データソース基底 ----------

export type DataSourceBase = {
  readonly kind: DbKind;
  close(): void | Promise<void>;
};

// ---------- データモデル別 source ----------

// SQL 系: table / row / column を持つ。
// 既存 `DatabaseAdapter` に `model: "sql"` を付けただけのもので、
// 中身のメソッドは完全互換。
export type SqlSource = DatabaseAdapter & {
  readonly model: "sql";
};

// KV 系 (Redis 等): keyspace × key × type-specific value。
export type KvKeyEntry<TKeyType extends string = string> = {
  name: string;
  type: TKeyType;
};

export type KvSource<
  TValue = unknown,
  TKeyType extends string = string,
> = DataSourceBase & {
  readonly model: "kv";
  listDatabasesAsync(
    signal?: AbortSignal,
  ): Promise<Array<{ index: number; keyCount: number }>>;
  listKeysAsync(opts: {
    db: number;
    pattern?: string;
    cursor?: string;
    count?: number;
    signal?: AbortSignal;
  }): Promise<{ keys: Array<KvKeyEntry<TKeyType>>; nextCursor: string }>;
  getValueAsync(opts: {
    db: number;
    key: string;
    signal?: AbortSignal;
  }): Promise<TValue>;
};

// Object store 系 (S3 / MinIO)。
export type ObjectSource = DataSourceBase & {
  readonly model: "object";
  listBuckets(signal?: AbortSignal): Promise<S3BucketInfo[]>;
  listObjects(opts: {
    bucket: string;
    prefix?: string;
    continuationToken?: string;
    maxKeys?: number;
    // 区切り文字。"/" を渡すと 1 階層ずつの列挙になり、サブフォルダが
    // commonPrefixes として返る (S3 コンソール風のフォルダ表示用)。
    delimiter?: string;
    signal?: AbortSignal;
  }): Promise<{
    objects: S3ObjectInfo[];
    commonPrefixes?: string[];
    nextToken?: string;
    truncated: boolean;
  }>;
  headObject(opts: {
    bucket: string;
    key: string;
    signal?: AbortSignal;
  }): Promise<S3ObjectHeadResponse>;
  getObjectText(opts: {
    bucket: string;
    key: string;
    maxBytes?: number;
    signal?: AbortSignal;
  }): Promise<{ text: string; truncated: boolean; head: S3ObjectHeadResponse }>;
  getObjectResponse(opts: {
    bucket: string;
    key: string;
    method: "GET" | "HEAD";
    range?: string | null;
    signal?: AbortSignal;
  }): Promise<Response>;
};

// Document store 系 (Elasticsearch)。
export type DocSource = DataSourceBase & {
  readonly model: "document";
  listIndicesAsync(signal?: AbortSignal): Promise<EsIndexInfo[]>;
  getMappingAsync(index: string, signal?: AbortSignal): Promise<EsMapping>;
  searchDocsAsync(opts: {
    index: string;
    query?: string;
    size?: number;
    searchAfter?: unknown[];
    signal?: AbortSignal;
  }): Promise<EsSearchResult>;
  getDocAsync(opts: {
    index: string;
    id: string;
    signal?: AbortSignal;
  }): Promise<{
    found: boolean;
    source: unknown;
    seqNo?: number;
    primaryTerm?: number;
  }>;
};

// ---------- capability mixin ----------

// snapshot に保存する 1 record。
//   keyJson:     record を一意に識別する JSON 文字列 (SQL の pk、Redis の key)
//   payloadJson: snapshot に保存する本体 (差分表示に使う)
//   rowHash:     差分判定用ハッシュ
// snapshot-store.ts:78-87 の `snapshot_rows` スキーマと完全互換。
export type SnapshotItem = {
  keyJson: string;
  payloadJson: string;
  rowHash: string;
};

// snapshot 対象を iterate できる能力。
//   - container: snapshot 対象の不透明な ID (SQL=table 名、Redis=key pattern)
//   - 戻り値の AsyncIterable を for-await で回せば 1 record ずつ取れる
//   - listSnapshotContainers は UI が container を選ばせるためのリスト。
//     SQL では table 一覧、Redis では空配列 (UI が pattern 入力欄を出す)
export type SnapshotIterable = {
  readonly capabilities: { snapshot: true };
  iterateForSnapshot(
    container: string,
    signal?: AbortSignal,
  ): AsyncIterable<SnapshotItem>;
  listSnapshotContainers(): Promise<Array<{ id: string; label: string }>>;
};

// 全文検索可能。今回は flag だけ。具体 search ロジックは global-search.ts が
// SqlSource を直接叩く形を維持する (退行回避)。
export type SearchableSource = {
  readonly capabilities: { search: true };
};

// 任意コマンド実行 (SQL editor / Redis CLI / ES DSL)。
// Q: 入力コマンド型, R: 結果型。
export type Queryable<Q, R> = {
  readonly capabilities: { query: true };
  query(input: Q, maxRows?: number, signal?: AbortSignal): Promise<R>;
};

// ---------- 型ガード ----------

// capabilities.snapshot と snapshot 用メソッドを runtime / type の両方でチェックする。
// snapshot-runner.ts はこれを使って generic に source を扱う。
export function hasSnapshotCapability<T extends { capabilities?: unknown }>(
  source: T,
): source is T & SnapshotIterable {
  const candidate = source as {
    capabilities?: { snapshot?: boolean };
    iterateForSnapshot?: unknown;
    listSnapshotContainers?: unknown;
  };
  return (
    !!candidate.capabilities?.snapshot &&
    typeof candidate.iterateForSnapshot === "function" &&
    typeof candidate.listSnapshotContainers === "function"
  );
}

// ---------- 後方互換のための再 export ----------
// 既存コードが `import type { DbColumn } from "..."` をしている場所が
// あるので、よく使う型を一括で再 export しておくと sources/* 系の
// 新規 adapter が import 元を 1 つに絞れる。
export type {
  DatabaseAdapter,
  DbColumn,
  DbForeignKey,
  DbIndexInfo,
  DbKind,
  DbOrder,
  DbTableInfo,
  DbValue,
  QueryResult,
  S3BucketInfo,
  S3ObjectHeadResponse,
  S3ObjectInfo,
  TriggerInfo,
};
