# PoC Round 2 仕様書 — capability mixin 抽象を確定して snapshot を generic 化する

`feature/datasource-abstraction` ブランチで作業。base は `feature/other-datasource`
（Redis PoC 完了状態）。次の PoC 3 周目で ES、4 周目で S3 を載せるための
土台になるよう、まず抽象を引き上げる。

設計の思想は `docs/design/datasource-abstraction.md` を参照。本仕様書は
それを **実装可能な粒度に確定**したもの。

---

## 0. 大前提

- 既存 SQL 3 種類 (sqlite/postgresql/mysql) と Redis の挙動を**一切変えない**。
- 抽象を「インターフェース 1 枚」にまとめない。データモデル別 + capability mixin
  の二軸。
- snapshot を adapter から切り離し、`iterateForSnapshot(container)` 1 本だけ
  実装すれば回るようにする。

---

## 1. 確定する interface

### 1-1. データモデル別 source (新規)

`web-src/server/database/sources/types.ts` に新設。

```ts
// すべての data source の共通 base.
export type DataSourceBase = {
  readonly kind: DbKind  // "sqlite" | "postgresql" | "mysql" | "redis" | …
  close(): void | Promise<void>
}

// SQL 系 (table/row/column を持つ)
export type SqlSource = DataSourceBase & {
  readonly model: "sql"
  getTables(): DbTableInfo[]
  getColumns(table: string): DbColumn[]
  getColumnsMulti?(tables: string[]): Map<string, DbColumn[]>
  getIndexes(): DbIndexInfo[]
  getForeignKeys(): DbForeignKey[]
  getTableRowCount(table: string): number
  getTableRowCounts?(tables: string[]): Map<string, number>
  getTablePage(table: string, opts: { offset: number; limit: number; orderBy?: DbOrder[] }): QueryResult
  executeReadonlyQuery(sql: string, params?: DbValue[], maxRows?: number): QueryResult
  getCreateStatement(table: string): string
  getTriggers(table: string): TriggerInfo[]
}

// KV 系 (Redis)
export type KvSource = DataSourceBase & {
  readonly model: "kv"
  listKeyspaces(): Array<{ index: number; keyCount: number }>
  listKeys(opts: { keyspace: number | string; pattern: string; cursor: string; count?: number }): Promise<{ keys: Array<{ name: string; type: string }>; nextCursor: string }>
  getValue(opts: { keyspace: number | string; key: string }): Promise<unknown>
}

// 将来用 (今回は実装しない、型だけ)
export type ObjectSource = DataSourceBase & {
  readonly model: "object"
  // S3 用、Round 3 で確定
}
export type DocSource = DataSourceBase & {
  readonly model: "document"
  // ES 用、Round 3 で確定
}
```

### 1-2. capability mixin (新規)

```ts
// snapshot 対象を iterate する。SQL では (table, row) ごと、Redis では
// (key, payload) ごとに 1 つの SnapshotItem を返す。
export type SnapshotItem = {
  keyJson: string       // record を一意に識別する JSON 文字列
  payloadJson: string   // データソース任せの payload (snapshot に保存する body)
  rowHash: string       // 差分判定用ハッシュ
}

export type SnapshotIterable = {
  readonly capabilities: { snapshot: true }
  iterateForSnapshot(container: string, signal?: AbortSignal): AsyncIterable<SnapshotItem>
  // snapshot 対象として選べる container 一覧。SQL では tables、Redis では
  // key pattern。container は `iterateForSnapshot(container)` に渡される
  // 不透明な ID。
  listSnapshotContainers(): Promise<Array<{ id: string; label: string }>>
}

// 既存 search (text-based) のため
export type SearchableSource = {
  readonly capabilities: { search: true }
  // 既存 search はそのまま、ただし capability flag だけ立てる
}

// 任意コマンド実行可能 (SQL editor 等)
export type Queryable<Q, R> = {
  readonly capabilities: { query: true }
  query(input: Q, maxRows?: number): Promise<R>
}
```

### 1-3. 既存 `DatabaseAdapter` との関係

- 旧 `DatabaseAdapter` は **当面残す**。新 `SqlSource` と完全互換のシグネチャ
  にして、`SqlSource = DatabaseAdapter & { model: "sql" }` で扱う。
- adapter 実装は新 source 型を export する。古い import は型エイリアスで
  互換維持。

---

## 2. snapshot の generic 化

### 2-1. `snapshot-runner.ts` の改修

現状: SQL 専用 (`getColumns` / `getTablePage` 直叩き、`snapshot-runner.ts:74-107`)。

改修方針:
- adapter から `SnapshotIterable` capability を取り出し、`iterateForSnapshot`
  経由で SnapshotItem を取得する形に変える。
- SQL adapter は `iterateForSnapshot` を新規実装 (table を SELECT \* で iterate、
  primary key を keyJson に詰める)。
- Redis adapter も `iterateForSnapshot` を新規実装 (SCAN MATCH pattern + TYPE +
  値取得、key を keyJson に、{type, value} を payloadJson に)。

```ts
// snapshot-runner.ts の新シグネチャ案
export async function runSnapshot(
  cwd: string,
  source: SnapshotIterable & DataSourceBase,
  dbId: string,
  containers: string[],
  note: string,
  onProgress: (container: string, done: boolean) => void,
): Promise<string>
```

既存 SQL の snapshot UI/API は破壊しない。`containers` は table 名のリストと
してそのまま受け取れる。

### 2-2. Redis snapshot 対象選択

- container = "key pattern"。デフォルト `*`。複数指定可。
- `listSnapshotContainers()` は実装複雑になるので Round 2 では Redis は空配列
  を返してもよい。UI 側で「key pattern 入力欄」を出して任意 pattern を渡す。

---

## 3. capability check と route 分岐

### 3-1. handle.ts / handle-redis.ts の共通化

現状: Redis 用 route は独立。snapshot を generic 化したら、`/_db/snapshot/create`
は SQL/Redis 両対応にできる。

ただし PoC 2 周目では UI まで揃えるとスコープが膨らむ。今回は **サーバ側 API
だけ generic 化**し、Redis 用の snapshot endpoint を `/_db/redis/snapshot/...`
として既存 `/_db/snapshot/...` と並べる (UI は次 PR で統合)。

snapshot エンジンは共通化 (snapshot-store.ts / snapshot-runner.ts は触らない、
adapter 側だけ拡張)。

実装追記: 最終実装では `snapshot-runner.ts` を `SnapshotIterable` 経由に
変更し、`adapters/sqlite.ts` / `adapters/docker.ts` も snapshot iteration
を実装した。上の「触らない」は Round 2 着手前の方針であり、generic
snapshot engine 確定後は実装済み差分として扱う。

---

## 4. 触るファイル

### 新規

| ファイル | 役割 |
|---|---|
| `web-src/server/database/sources/types.ts` | source 型 / capability mixin の定義 |
| `web-src/server/database/sources/sql.ts` | DatabaseAdapter から SqlSource & SnapshotIterable を export する thin wrapper |
| `web-src/server/database/sources/redis.ts` | RedisExplorer から KvSource & SnapshotIterable を export する thin wrapper |

### 既存への追加（最小侵襲）

| ファイル | 変更内容 |
|---|---|
| `adapters/sqlite.ts` | `iterateForSnapshot(table)` を新規メソッドとして追加。SELECT \* で行を iterate、primary key を keyJson に。 |
| `adapters/docker.ts` | 同上 (PG/MySQL 対応)。 |
| `adapters/redis.ts` | `iterateForSnapshot(pattern)` を追加。SCAN MATCH pattern → TYPE → getValue。 |
| `snapshot-runner.ts` | adapter 直叩きを SnapshotIterable.iterateForSnapshot 経由に変更。既存呼び出し元の引数を保つ。 |
| `handle-redis.ts` | snapshot endpoint (`/_db/redis/snapshot/*`) 追加。または `/_db/snapshot/*` を redis kind で受けられるよう拡張。後者の方がきれい。 |

### 触らないファイル

- 既存 SQL の table browse / query / search / history (退行リスク回避)
- UI 側 (`web-src/views/database/*`) は今回触らない。Round 2 では server 抽象
  だけ整えて、UI は Round 3 以降に統合。
- `snapshot-store.ts` / `query-history.ts` / `connection-pool.ts` /
  `global-search.ts` は引き続きスキーマ・履歴・検索の安定境界として扱う。

---

## 5. コミット分割

1. `web-src/server/database/sources/types.ts` を新設し、SqlSource / KvSource /
   SnapshotIterable / SearchableSource / Queryable<Q,R> の interface を定義する
2. `adapters/sqlite.ts` に `iterateForSnapshot(table)` を実装する
3. `adapters/docker.ts` に `iterateForSnapshot(table)` を実装する (PG/MySQL)
4. `adapters/redis.ts` に `iterateForSnapshot(pattern)` を実装する
5. `snapshot-runner.ts` を SnapshotIterable 経由に書き換える (既存 API 互換)
6. `handle.ts` の `/_db/snapshot/create` が Redis kind も受けられるようにする
7. data/test/redis に snapshot 動作確認テストを追加 (任意。時間あれば)

各コミットで `bun run verify` 通すこと。

---

## 6. 受け入れチェックリスト

- [ ] `bun run verify` 全通過
- [ ] 既存 SQL snapshot (snapshot create / list / diff tables / diff rows) が
      退行なく動く (manual test or unit test)
- [ ] Redis に対して `POST /_db/snapshot/create` を投げると key pattern ベースの
      snapshot が取れる
- [ ] 同じパターンで 2 回 snapshot を取って diff すると insert/update/delete が
      正しく出る
- [ ] 「触らないファイル」リストに diff がない
- [ ] commit message は conventional + 日本語ひらがな必須

---

## 7. やってはいけないこと

- 既存 SQL の UI / API の挙動を変えること
- 旧 `DatabaseAdapter` interface を **削除** すること (型エイリアスで残す)
- Redis snapshot 用の UI を作ること (Round 3 以降)
- `snapshot-store.ts` のスキーマを変えること (内部表現は不変)
- ES / S3 の実装に手を出すこと (別 Round)
- package.json への依存追加 (docker-exec で完結させる)
- 履歴改変・stash・hooks スキップ
- PR 作成・マージ

---

## 8. 完了報告

- 全 commit の git log --oneline
- `git diff --stat feature/other-datasource..HEAD`
- 既存 SQL snapshot の退行確認結果 (実機 or test)
- Redis snapshot の動作確認結果 (data/test/redis で実機)
- 「触らない」ファイルに diff がないことの確認
