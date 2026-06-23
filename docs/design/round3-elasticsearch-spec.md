# Round 3 仕様書 — Elasticsearch adapter

`feature/datasource-abstraction` ブランチで作業。base は Round 2 完了直後
の状態。Round 2 で確定した capability mixin 抽象 (`SnapshotIterable` /
`Queryable`) の上に Elasticsearch を **DocSource** として乗せる。

設計の思想は `docs/design/datasource-abstraction.md` 、Round 2 の抽象確定は
`docs/design/round2-abstraction-spec.md` を参照。

---

## 0. 大前提

- Round 1 (Redis) と同じ独立コードパスで作る。`adapters/elasticsearch.ts`
  + `handle-elasticsearch.ts` + `views/database/elasticsearch-explorer.ts`。
- 既存 SQL / Redis の挙動・UI・API は**一切変えない**。
- 接続戦略は **docker-exec の `curl localhost:9200`** をデフォルトに。
  remote / cloud は次ラウンドで `@elastic/elasticsearch` の lazy import で。
- `snapshot-store.ts` のスキーマは触らない。
- ES は **read-only**。query/aggregation は受けるが index 書き換えはしない。

---

## 1. 達成条件

`docker-compose.yml` に以下があるプロジェクトで `npx code-viewer` を起動
すると:

1. サイドバーに `es-svc (elasticsearch:8-x.y, localhost:9200)` のように
   ES service が出る (`discovery.ts:detectDbKind` に `"elasticsearch"`
   分岐追加)
2. クリックすると **indices 一覧 + doc count** が表示される (`_cat/indices?format=json`)
3. index を選ぶと **mapping (field 一覧) + doc 数 + size**
4. doc 一覧は **`_search?size=200` ベースで pagination** (search_after で
   続き読み)
5. doc クリックで `_id` + `_source` の構造化 JSON 表示
6. **search**: lucene query 文字列 (`q=`) を入力欄から渡せる最小 UI
7. **snapshot**: `POST /_db/snapshot/create` に ES service を渡すと
   `_search` で全 doc を iterate して snapshot。container は index 名
   (canonical で `{"index": "..."}` JSON)
8. `bun run verify` 全パス
9. 既存 sqlite / postgresql / mysql / redis に**退行なし**

```yaml
services:
  es-svc:
    image: elasticsearch:8.15.0
    environment:
      - discovery.type=single-node
      - xpack.security.enabled=false
      - ES_JAVA_OPTS=-Xms512m -Xmx512m
    ports: ["9200:9200"]
```

---

## 2. 触るファイル

### 新規

| ファイル | 役割 |
|---|---|
| `web-src/server/database/adapters/elasticsearch.ts` | ES adapter。 `DocSource & SnapshotIterable & Queryable<EsQuery, EsResult>` を実装 |
| `web-src/server/database/handle-elasticsearch.ts` | `/_db/elasticsearch/{indices, docs, doc, search, mapping}` endpoint |
| `web-src/views/database/elasticsearch-explorer.ts` | ES 専用 UI |
| `data/test/elasticsearch/docker-compose.yml` | テスト環境 |
| `data/test/elasticsearch/seed.sh` | サンプル index と doc 投入 |
| `data/test/elasticsearch/README.md` | 検証手順 |

### 既存への最小追加

| ファイル:位置 | 変更内容 |
|---|---|
| `web-src/core/database/types.ts` | `DbKind` に `"elasticsearch"` 追加、ES レスポンス型を追加 |
| `web-src/server/database/discovery.ts:130` `detectDbKind` | `lower.includes("elasticsearch")` 分岐追加 |
| `web-src/server/database/discovery.ts:185` `DockerDbInfo` | port default に 9200 追加 |
| `web-src/server/database/handle.ts:handleDatabaseRoute` | `/_db/elasticsearch/` への 1 分岐追加 (Round 1 と同型) |
| `web-src/server/database/handle.ts:handleFiles` | ES kind 用の DbFileInfo 射影 (env 漏洩なし、`toFileInfo()` 再利用) |
| `web-src/server/database/handle.ts:handleSnapshotCreate` | ES kind 対応 (`openElasticsearchAdapter` 呼び出し + container default `["{\"index\":\"*\"}"]`) |
| `web-src/server/database/handle.ts:resolveDb` | redis と同じパターンで es ID も SQL route から 400 reject |
| `web-src/views/database/database-view.ts` | `kind === "elasticsearch"` 分岐で `<ElasticsearchExplorer>` mount |
| `README.md` | ES サポート 1-2 行追記 |

### 触らないファイル

- `adapters/sqlite.ts` / `adapters/docker.ts` / `adapters/redis.ts` (Round 2 の状態維持)
- `snapshot-store.ts` / `snapshot-runner.ts` (Round 2 の generic engine をそのまま流用)
- `query-history.ts` / `connection-pool.ts` / `global-search.ts`
- 既存 UI の sql / redis 関連 (`database-view.ts` は 1 分岐のみ追加)

実装追記: Round 3 後の majority fix で `adapters/redis.ts` /
`adapters/elasticsearch.ts` の docker compose container 解決を
`adapters/docker-utils.ts` に共通化し、`ElasticsearchExplorer` を
`DocSource & Queryable & SnapshotIterable` 型へ接続した。`adapters/docker.ts`
は本タスクの保護対象なので新規 diff は入れず、同 helper への移行は後続課題。

---

## 3. 接続戦略

`docker exec <container> curl -s -X <METHOD> http://localhost:9200/<path>`
で全部済ます。MySQL/PG の `docker.ts` と Redis の `redis.ts` のパターンに
揃える。

```ts
// シグネチャ案
function execEsRequest(
  config: EsConfig,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): { code: number; stdout: string; stderr: string }
```

認証あり (`xpack.security.enabled=true` 等) の場合:
- `ELASTIC_PASSWORD` env を spawnSync 経由で `--user elastic:$ELASTIC_PASSWORD`
  に **しない** (argv 露出問題、Round 1 C2 と同じ)
- `--netrc-file <(echo "...")` または `curl -K -` で stdin から config を流す
- PoC では認証なしのみ動作確認、認証ありは future work でも OK

---

## 4. capability 実装

### 4-1. DocSource

```ts
export type DocSource = DataSourceBase & {
  readonly model: "document"
  listIndices(): Promise<Array<{ name: string; docCount: number; sizeBytes: number }>>
  getMapping(index: string): Promise<EsMapping>
  searchDocs(opts: { index: string; query?: string; from?: number; size?: number; searchAfter?: unknown[] }): Promise<EsSearchResult>
  getDoc(opts: { index: string; id: string }): Promise<EsDoc>
}
```

### 4-2. SnapshotIterable

```ts
async *iterateForSnapshot(container: string, signal?: AbortSignal): AsyncIterable<SnapshotItem> {
  const { index, query } = parseSnapshotContainer(container)
  // search_after で全件 iterate (PIT 使うのが本式、PoC では search_after だけ)
  let searchAfter: unknown[] | undefined
  for (;;) {
    if (signal?.aborted) return
    const result = await searchDocs({ index, query, size: 1000, searchAfter })
    if (result.hits.length === 0) return
    for (const hit of result.hits) {
      yield {
        keyJson: JSON.stringify({ _id: hit._id }),
        payloadJson: JSON.stringify({ _source: hit._source }),
        // _seq_no + _primary_term で diff 用 hash (idempotent な doc version 識別)
        rowHash: `${hit._seq_no}-${hit._primary_term}`,
      }
    }
    searchAfter = result.hits[result.hits.length - 1].sort
  }
}

listSnapshotContainers() {
  return listIndices().then(ix => ix.map(i => ({
    id: JSON.stringify({ index: i.name }),
    label: i.name,
  })))
}
```

### 4-3. Queryable

```ts
type EsQuery = { method: "GET" | "POST"; path: string; body?: unknown }
type EsResult = { status: number; body: unknown; elapsedMs: number }

query(input: EsQuery): Promise<EsResult>
```

read-only ガード: `method !== "GET" && method !== "POST"` は 400。POST も
`_search` / `_count` / `_msearch` 等の検索系 path のみ allowlist。

---

## 5. UI スロット

Round 1 Redis と同型の独立 view を作る:

```
┌─────────────────────────────────────┐
│ サイドバー: indices 一覧 + doc count │
├──────────────┬──────────────────────┤
│ index 内     │ mapping pane         │
│ docs リスト  │ + doc detail pane    │
│ (search +    │ (selected doc の     │
│ pagination)  │ _source 構造化表示)  │
└──────────────┴──────────────────────┘
```

search UI: 1 行入力欄で lucene query 文字列を受ける。

---

## 6. コミット分割

1. `core/database/types.ts` に `"elasticsearch"` kind と ES レスポンス型を
   追加、`discovery.ts` で ES kind を検出する
2. `adapters/elasticsearch.ts` を新設、 `listIndices` + `handle-elasticsearch.ts`
   の `/indices` endpoint
3. `getMapping` + `/mapping` endpoint
4. `searchDocs` + `/docs` endpoint (pagination 含む)
5. `getDoc` + `/doc` endpoint
6. UI `elasticsearch-explorer.ts` 新規 + `database-view.ts` 分岐 1 か所
7. `iterateForSnapshot` + `listSnapshotContainers` 実装、 `handle.ts` の
   `handleSnapshotCreate` に ES kind 対応追加
8. `Queryable<EsQuery, EsResult>` 実装、 `/search` endpoint (lucene q=)
9. `data/test/elasticsearch/{docker-compose,seed,README}` 追加、 README に
   ES サポート追記

各 commit で `bun run verify` 通すこと。コミットメッセージは ひらがな
必須 + Conventional Commits。

---

## 7. 受け入れチェックリスト

- [ ] `bun run verify` 全通過
- [ ] 達成条件 1〜9 が満たされる (手動 smoke test 想定)
- [ ] 「触らない」ファイルへの diff なし (Round 2 で確定した list)
- [ ] 既存 sqlite / postgresql / mysql / redis に**退行なし**
- [ ] 各コミットメッセージが Conventional Commits + 日本語ひらがな
- [ ] `/_db/files` レスポンスに ES env / credential 漏洩がないこと
- [ ] `_search` で curl 経由 argv に password が出ないこと (認証ありの場合)
- [ ] snapshot iter が doc 数 200 を超えても全件読めること (Round 2 R2-Cr1 と
      同じ轍を踏まない)
- [ ] `_id` が binary でも valid な keyJson 生成できること

---

## 8. やってはいけないこと

- index 書き換え系 API (`PUT` / `DELETE` / `_bulk` の write 操作) を
  実装すること
- ES 専用 snapshot エンジン (snapshot-store.ts 改修) を作ること
- `@elastic/elasticsearch` を依存追加すること (docker-exec で完結)
- 既存 SQL / Redis の挙動を変えること
- 履歴改変・stash・hooks スキップ
- PR 作成・マージ

---

## 9. 完了報告

- 全 commit の git log --oneline
- `git diff --stat feature/other-datasource..HEAD` (Round 2 + Round 3 累積)
- 既存 SQL / Redis 退行確認結果
- ES の indices/mapping/search/snapshot 動作確認結果 (data/test/elasticsearch
  で実機)
- 「触らない」ファイルに diff がないことの確認

---

## 10. 次の Round (Round 4: S3 / MinIO)

このドキュメントを完了したら、 `docs/design/round4-s3-spec.md` を別途
起こして S3 / MinIO 対応に進む。 ObjectSource を確定し、 capability mixin
上で bucket × prefix 階層を扱う。
