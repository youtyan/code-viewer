# Elasticsearch adapter テスト環境

code-viewer の Elasticsearch adapter を開発中に動作確認するための
テストデータと docker-compose セット。

## 含まれるもの

- `docker-compose.yml` — Elasticsearch 1 つ
  - `es-svc` (`elasticsearch:8.15.0`, localhost:9290 → container 9200,
    認証なし single-node, JVM 512m)
- `seed.sh` — テストデータ投入スクリプト
  - `products`: 5 docs。mapping 検証 + 多言語 + nested フィールド
  - `events`: 500 docs。`search_after` pagination の検証用
  - `binary-test`: 3 docs。`binary` 型 + emoji を含む `_source`

ホスト側 port を 9290 にしてある（一般的な 9200 とは別、複数 ES と
共存しやすくするため）。

## 使い方

リポジトリのルートで:

```sh
cd data/test/elasticsearch
docker compose up -d
./seed.sh
cd ../../..
pnpm run preview --cwd data/test/elasticsearch
```

ブラウザでサイドバーに `es-svc` が出てくる。クリックすると `products` /
`events` / `binary-test` の indices と各 doc が確認できる。

`data/test/redis/` も同時に立てておけば、リポジトリ root を cwd にして
`pnpm run preview --cwd .` で起動するだけで ES と Redis が一画面に並ぶ
(recursive compose discovery、サブディレクトリの compose も拾われる)。
subdirectory 由来の service は id が `docker:<svc>@<relDir>` 形式になる
(例: `docker:es-svc@data%2Ftest%2Felasticsearch`)。

## 検証ポイント

### R3-C1 / C2: discovery + indices 一覧

- `/_db/files` のレスポンスに `es-svc` が含まれ、`kind` が
  `"elasticsearch"` であること
- 同レスポンスに `env` / `serviceName` などの内部状態が**含まれていない**
  こと (Redis C1 と同じ思想)

### R3-C3: mapping

- `products` をクリック → 右ペインに `name (text)` / `category (keyword)` /
  `price (double)` などのフィールド一覧が出る
- `nested_meta` は `object` 表示

### R3-C4: searchDocs + pagination

- `events` をクリック → 200 docs が表示される
- 「Load more」ボタンで残り 300 docs を search_after で取得
- 合計 500 docs まで取れる (R2-Cr1 と同じ轍を踏まないこと)
- 検索欄に `kind:login` と入れて Search → login event だけが filter される
  (lucene `query_string`)

### R3-C5: 単一 doc

- `products` の `p1` をクリック → 右ペインの "Doc" タブに `_source`
  全体が JSON で整形表示される
- 存在しない id を `?id=` で叩く → `found: false` で 200

### R3-C6: UI explorer

- サイドバーで `es-svc` を選んでいるあいだ `?tab=query` などの
  URL を指定しても SQL pane が被さらないこと
- `/_db/schema?db=docker:es-svc` を直叩きすると 400 が返ること

### R3-C7: snapshot

`POST /_db/snapshot/create` に ES service を渡すと search_after で全 doc を
iterate して snapshot を取れる。container は index 名 (raw でも
`{"index":"...","query":"..."}` JSON でも、サーバ側で canonicalize される)。

```sh
PORT=<起動した port>

# 1 回目の snapshot を取る (events index 全件)
curl -sS -X POST http://localhost:$PORT/_db/snapshot/create \
  -H 'Content-Type: application/json' \
  -H 'X-Code-Viewer-Action: 1' \
  -d '{
    "db": "docker:es-svc",
    "tables": ["events"],
    "note": "before"
  }'

# データを書き換える
docker exec -i code-viewer-test-es curl -sS \
  -X POST -H 'Content-Type: application/json' \
  --data-binary '{"index":{"_id":"e1"}}
{"ts":"2026-01-01T00:00:00Z","kind":"updated","user":"user-0","page":"/page/x","n":1}
' \
  http://localhost:9200/events/_bulk
docker exec -i code-viewer-test-es curl -sS \
  -X POST http://localhost:9200/_refresh

# 2 回目の snapshot
curl -sS -X POST http://localhost:$PORT/_db/snapshot/create \
  -H 'Content-Type: application/json' \
  -H 'X-Code-Viewer-Action: 1' \
  -d '{
    "db": "docker:es-svc",
    "tables": ["events"],
    "note": "after"
  }'

# 一覧 / diff
curl -sS "http://localhost:$PORT/_db/snapshot/list?db=docker:es-svc" | jq
```

`events` の 500 docs が全件 snapshot されること、2 回目との diff で
`e1` のみ `updated` になっていることを確認する。

### R3-C8: query allowlist

`/_db/elasticsearch/search` は GET (`?q=`) と POST (DSL) を受ける。
read-only allowlist (`_search` / `_count` / `_msearch` 等) で書き込み
path は弾く。

```sh
# OK: lucene query
curl -sS "http://localhost:$PORT/_db/elasticsearch/search?db=docker:es-svc&index=products&q=keyboard" | jq

# OK: count
curl -sS -X POST http://localhost:$PORT/_db/elasticsearch/search \
  -H 'Content-Type: application/json' \
  -H 'X-Code-Viewer-Action: 1' \
  -d '{"method":"GET","path":"/events/_count"}' | jq

# NG: 書き込み path は allowlist で reject (error フィールドあり)
curl -sS -X POST http://localhost:$PORT/_db/elasticsearch/search \
  -H 'Content-Type: application/json' \
  -H 'X-Code-Viewer-Action: 1' \
  -d '{"method":"POST","path":"/products/_doc/p1"}' | jq
```

## クリーンアップ

```sh
docker compose down -v
```

## 注意事項

- このディレクトリは git tracked。テストデータ生成スクリプトと
  docker-compose は仕様情報なのでコミット対象。
- ES container は localhost:9290 にバインドする。既存のローカル ES と
  port が被らないようになっている。
- `seed.sh` は冪等。何度実行しても結果は同じ (既存 index を一度 DELETE
  してから作り直す)。
- `xpack.security.enabled=false` の認証なし設定。認証ありは future work。
