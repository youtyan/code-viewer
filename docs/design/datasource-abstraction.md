# DataSource Abstraction 設計メモ

code-viewer の Database Viewer を SQLite / PostgreSQL / MySQL に加えて
**Redis / S3 (含 MinIO) / Elasticsearch** にも広げるための設計メモ。

このドキュメントは「PoC の前に決めるべきこと一覧」と「PoC の中で決める
こと一覧」を分けて記載する。**具体的な interface 名・メソッド名・引数順
は決めない**。Redis PoC（`docs/design/redis-poc-task.md`）が回ったあとに
決定する。

---

## 設計の前提（合意済み）

- **一枚 `DataSourceAdapter` は採らない**。SQL/KV/Object/Document はデータ
  モデルが異なりすぎて、SQL に縛られた `executeReadonlyQuery` を Redis/S3
  に実装するのは嘘になる。
- 二軸で抽象化する:
  1. **データモデル別 interface**: `SqlSource` / `KvSource` / `ObjectSource`
     / `DocSource`
  2. **横断 capability mixin**: `SnapshotSource` / `SearchableSource`
     / `Queryable<Q, R>`
- TS の structural typing で「実装側は満たす型を返すだけ、ハンドラ側は
  `'queryRunner' in adapter` の capability check で分岐」する。
- UI 表現は **NoSQL に行/列を押し付けない**。Redis/S3/ES はそれぞれ専用の
  ペイン（`<JsonRecordPane>` / `<BinaryObjectPane>` / `<DocumentPane>`）。
  既存 SQL グリッドはノータッチ。
- 進め方は **ボトムアップ**。Redis を独立コードパスで動かして実物を見て
  から、抽象を引っ張り上げる（Rule of Three）。先に抽象を組まない。

---

## データモデル分類表

| 種別 | 例 | container 相当 | record 相当 | field 相当 |
|---|---|---|---|---|
| SQL | sqlite / postgresql / mysql | table | row | column |
| KV | redis | keyspace pattern (例: `user:*`) | key | 型固有値（string/list/hash/set/zset/stream） |
| Object | s3 / minio | bucket × prefix | object | metadata + body |
| Document | elasticsearch | index | document (`_id`) | mapping field |

「container / record / field」は **概念対応**であって、ユーザー向けの UI
ラベルではない。UI は専用ビューを使う。

---

## capability matrix

| capability | sqlite | postgresql | mysql | redis | s3 | elasticsearch |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| browse (container 一覧 + record 閲覧) | ○ | ○ | ○ | ○ | ○ | ○ |
| query (任意コマンド実行) | ○ (SQL) | ○ (SQL) | ○ (SQL) | △ (redis-cli) | △ (S3 Select) | ○ (DSL / `_sql`) |
| snapshot (時点ハッシュ + diff) | ○ | ○ | ○ | △ (key pattern) | △ (etag based) | △ (\_id + \_seq\_no) |
| search (全文検索) | ○ | ○ | ○ | △ (key match) | △ (prefix) | ○ (native) |
| history (実行記録の保存) | ○ | ○ | ○ | ○ | ○ | ○ |
| export (CSV / JSON) | ○ | ○ | ○ | △ (型ごと) | △ (manifest) | ○ |

`△` は「実装可能だが意味が SQL とは異なる」。例: Redis search は SQL の
`LIKE` ではなく key pattern match。

---

## snapshot 抽象 contract

既存 `web-src/server/database/snapshot-store.ts:78-87` のスキーマ
（`row_key_hash` / `row_key_json` / `row_hash` / `payload_json`）と、
`computeDiffTables` / `computeDiffRows` (300-542) は **すでにデータ shape
非依存**。diff 計算は `row_key_hash` と `row_hash` だけで動く。

adapter 側で実装すべきは **iterator 1 本だけ**:

```ts
// シグネチャは PoC 後に確定。これは方針。
interface SnapshotIterable {
  iterateForSnapshot(container: string): AsyncIterable<{
    keyJson: string      // record を一意に識別する JSON
    payloadJson: string  // データソース任せの payload
    rowHash: string      // 差分判定用ハッシュ
  }>
}
```

データソース別 payload 設計の方針:

| データソース | keyJson 例 | payloadJson 例 | rowHash 候補 |
|---|---|---|---|
| Redis | `{"key":"user:42"}` | `{"type":"hash","value":{"name":"alice"}}` | payload を sha256 |
| S3 | `{"bucket":"b","key":"path/to/obj"}` | `{"etag":"...","size":..., "lastModified":"...","contentType":"...","metadata":{...}}` | ETag 流用 |
| ES | `{"_id":"abc"}` | `{"_source":{...},"_seq_no":42,"_primary_term":1}` | `_seq_no` + `_primary_term` |

データソース固有実装にすべきは **snapshot 対象の選び方** だけ:
- SQL: table 一覧
- Redis: key pattern（複数指定可、デフォルト `*`）
- S3: bucket × prefix
- ES: index 一覧（alias 解決を含む）

UI 上の diff 表示は SQL では「セル単位」(`beforeValues`/`afterValues` が
`Record<column, value>`、`snapshot-store.ts:514-539`)。JSON payload では
「property-path 単位 diff」になるので、別途 JSON diff viewer が必要。

---

## discovery 出力 schema

表層 API は `discoverDataSources(cwd)` 一本化。内部は detector の合成。

```ts
// 方針シグネチャ。確定は PoC 後。
type DataSourceInfo = {
  id: string                  // "sqlite:./data.db" / "docker:redis-svc" / "aws:s3:my-bucket"
  kind: DbKind                // 拡張: 既存 + "redis" / "elasticsearch" / "s3"
  label: string               // UI 表示名
  origin: "file" | "docker-compose" | "aws-config" | "env-vars"
  // credential は presence のみ。値は載せない（漏洩対策）
  credentialPresence?: { hasPassword: boolean; hasToken: boolean }
}

type DataSourceDetector = {
  origin: "sqlite-file" | "docker-compose" | "aws-config" | "env-vars"
  discover(cwd: string): DataSourceInfo[]
}
```

**重要**: credential の値はこのオブジェクトに載せない。「あるかないか」
だけ。 adapter 内部で必要時に env / file から再取得する。

---

## 接続戦略マトリクス

| データソース | 戦略 | 補足 |
|---|---|---|
| sqlite | 直接 file | 既存 |
| postgresql | docker-exec (`psql`) | 既存。non-docker は将来 native ドライバ追加 |
| mysql | docker-exec (`mysql`) | 同上 |
| redis | **docker-exec (`redis-cli -3`)** | PoC 1 周目はこれだけ。remote Redis は将来 |
| elasticsearch | **docker-exec (`curl localhost:9200`)** または **lazy import `@elastic/elasticsearch`** | docker-compose 検出のみは前者、remote/cloud は後者 |
| s3 | **lazy import `@aws-sdk/client-s3`** | MinIO も同 SDK で endpoint 切替 |

### lazy import パターン

既存 `web-src/server/database/snapshot-store.ts:34-55`（`bun:sqlite` /
`better-sqlite3` の lazy 切替）と同型で書く:

```ts
// 方針。確定は PoC 2 周目以降。
async function getEsClient() {
  try { return (await import("@elastic/elasticsearch")).Client }
  catch {
    throw new MissingOptionalDepError(
      "@elastic/elasticsearch",
      "Elasticsearch を使うには: npm i @elastic/elasticsearch"
    )
  }
}
```

`package.json` の `optionalDependencies` に並べる。core の `npm install`
は重くならない。エラーは UI 側で「`npm i ...` を実行してください」と
表示する専用エラータイプにする。

---

## UI スロット契約

メインビューは以下のスロット構造で固定する:

```
┌─────────────────────────────────────────────┐
│ ヘッダ: DataSource selector                  │
├──────────┬──────────────────────────────────┤
│ サイドバ │ メインペイン                       │
│ (container│  - browse / query / snapshot /    │
│  list)   │    search / history タブ          │
│          │  - データソース別ペインを差し込み  │
└──────────┴──────────────────────────────────┘
```

各データソースが宣言する `capabilities` オブジェクト:

```ts
// 方針。確定は PoC 後。
type DataSourceCapabilities = {
  browse: BrowseRenderer            // 必須
  query?: QueryEditorRenderer       // 持たないデータソースは Query タブ非表示
  snapshot?: SnapshotConfigRenderer // 同上
  search?: SearchConfigRenderer
  history: HistoryAdapter           // 必須（履歴格納の record shape を宣言）
}
```

UI はこの `capabilities` を見てタブを出し分ける。

---

## 「決めること一覧（PoC 後に確定）」

PoC（Redis）が回るまでは決めない:

- [ ] 各 `Source` interface (`SqlSource` / `KvSource` / `ObjectSource`
      / `DocSource`) の正確なメソッド名と引数順
- [ ] capability mixin (`SnapshotSource` 等) の正確なシグネチャ
- [ ] `iterateForSnapshot` の戻り値型と AsyncIterable の終了条件
- [ ] `DataSourceInfo` の最終 shape
- [ ] credential 受け渡し方法（env 直読み vs 構造化 secrets store）
- [ ] `handleDatabaseRoute` の routing 構造（if/elif 列か、route table か）
- [ ] query editor の補完 API（plain text + 履歴補完で十分か、Monaco language
      server を入れるか）
- [ ] JSON diff viewer ライブラリ選定（jsondiffpatch / 自作 / その他）
- [ ] 各データソース UI ペイン (`<JsonRecordPane>` 等) の prop 設計

## 「決めること一覧（実装前に確定）」

PoC 開始前に決まっている:

- [x] 抽象の切り方（データモデル別 + capability mixin の二軸）
- [x] UI は NoSQL に行/列を押し付けない（専用ペイン）
- [x] snapshot 内部スキーマは現行を流用（schema 不変）
- [x] discovery は表層 API 一本化、内部 detector 合成
- [x] 接続戦略は「docker-exec → lazy import → file」の三本立て
- [x] credential 値は `DataSourceInfo` に載せない
- [x] 進め方は Redis 独立コードパスで PoC、抽象は後

---

## PoC 1 周目で **触らない** ファイル

退行リスクを最小化するため、以下は明示的に保護する:

- `web-src/server/database/adapters/sqlite.ts`
- `web-src/server/database/adapters/docker.ts`
- `web-src/server/database/snapshot-store.ts`
- `web-src/server/database/snapshot-runner.ts`
- `web-src/server/database/global-search.ts`
- `web-src/server/database/query-history.ts`
- `web-src/server/database/connection-pool.ts`

PoC 1 周目で **触る** のは `discovery.ts:130` (`detectDbKind` に redis 分岐
を追加) と `handle.ts:1031` (`handleDatabaseRoute` に redis ルートへの 1
分岐) のみ。残りは新規ファイル (`adapters/redis.ts`、`handle-redis.ts`、
UI 側 `<RedisExplorer>`)。

実装追記: Round 2 以降は snapshot capability を実際に generic 化するため、
`adapters/sqlite.ts` / `adapters/docker.ts` / `snapshot-runner.ts` に
`SnapshotIterable` 経路を追加した。これは PoC 1 周目の退行防止リストとは
別フェーズの確定変更で、現行の保護対象は「本タスクで新規 diff を入れない」
対象として扱う。

---

## テストマトリクス（懸念事項）

optional dep が増えると CI マトリクスが膨張する。最初から備える:

- core 機能テスト（依存なし）
- sqlite 単体
- postgresql + mysql（docker）
- redis（docker-exec）
- elasticsearch（docker-exec / `@elastic/elasticsearch` あり）
- s3（`@aws-sdk/client-s3` あり、MinIO container 起動）

`SKIP_OPTIONAL` フラグで段階的に切れるようにしておく。ローカル開発は
sqlite だけ動けば十分に倒す。

---

## ロードマップ

```
[PoC 1 周目] Redis 独立実装（このドキュメントで合意済み）
   ↓ 実物の気づきを反映
[抽象設計確定] capability interface / SnapshotIterable 等のシグネチャ確定
   ↓
[PoC 2 周目] Redis snapshot を generic 実装で動かす、SQL 3 種も移植
   ↓
[Elasticsearch 実装] capability mixin の上に乗せる
   ↓
[S3 実装] 同上、optional dep の loading パス検証
```

各フェーズで PR を分ける。`docs/design/datasource-abstraction.md` も
段階的に更新する。
