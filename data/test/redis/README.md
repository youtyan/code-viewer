# Redis adapter テスト環境

code-viewer の Redis adapter を開発中に動作確認するためのテストデータと
docker-compose セット。

## 含まれるもの

- `docker-compose.yml` — Redis 2 つ
  - `redis-svc` (localhost:6379, 認証なし)
  - `redis-auth` (localhost:6380, password: `secret`、`REDISCLI_AUTH` 経由認証パス検証用)
- `seed.sh` — テストデータ投入スクリプト
  - DB 0: 一般パターン（string / hash / list / set / zset / stream の基本）
  - DB 3: truncation 閾値超え（`REDIS_STRING_BYTE_LIMIT=65536` / `REDIS_COLLECTION_LIMIT=200` の確認用）
  - DB 15: binary / 特殊バイト + 1000 key（M3 binary 取扱 + SCAN cursor 確認用）

## 使い方

リポジトリのルートで:

```sh
cd data/test/redis
docker compose up -d
./seed.sh
cd ../../..
pnpm run preview --cwd data/test/redis
```

ブラウザでサイドバーに `redis-svc` と `redis-auth` が出てくる。
それぞれをクリックすると DB 0–15 の一覧が見え、key の中身を確認できる。

`data/test/elasticsearch/` も同時に立てておけば、リポジトリ root を cwd
にして `pnpm run preview --cwd .` で起動するだけで Redis 2 つと ES が
一画面に並ぶ (recursive compose discovery、サブディレクトリの compose
も拾われる)。subdirectory 由来の service は id が `docker:<svc>@<relDir>`
形式になる。

## 検証ポイント

### Critical 修正の確認

- **C1: env 漏洩**: ブラウザの DevTools → Network で `/_db/files` の
  レスポンスを開き、`env` / `serviceName` / `database` が **含まれていない**
  ことを確認。`redis-auth` でも password が出ていなければ OK。
- **C2: argv 露出**: ホストで以下を実行し、redis-cli の argv に password が
  出ないことを確認:
  ```sh
  ps -ef | grep redis-cli
  ```
  `-a secret` ではなく `-3 -n N <command>` だけが見えれば OK。

### Major 修正の確認

- **M1: truncation**:
  - DB 3 の `string:large-100kb` を開く → 「(showing 64 KB of 100 KB, truncated)」相当の banner が出る
  - DB 3 の `list:large-500` → 200 items + 「(showing 200 of 500 entries, truncated)」
  - 他の collection も同様
- **M2: SQL UI fallthrough**:
  - Redis 選択中に URL を手で `?tab=query` に変更してリロード → Redis pane が表示され続け、SQL クエリエディタが被さらない
  - 直接 `/_db/schema?db=docker:redis-svc` を叩く → 400 エラー
- **M3: binary 取扱**:
  - DB 15 の `binary:invalid-utf8` を開く → `{ "type": "binary", "binaryBase64": "..." }` 形式の表示
  - DB 15 の `binary:png-header` も同様
  - DB 15 の `string:trailing-newline` → 末尾の `\n` が保持されている
  - DB 15 の `hash:with-binary-value` の `blob` フィールド → binary 表示

### SCAN cursor の確認

- DB 15 を選択 → key list に最初の 200 件
- 「Load more」ボタンで残りを読み込み
- 1000 件全部読めるまで cursor が `0` に戻らない

## Round 2 (capability mixin / generic snapshot) の検証

Round 2 で snapshot エンジンが SnapshotIterable 経由になり、Redis にも
適用できるようになった。以下の手順で SQL/Redis 両方の snapshot 動作を確認する。

### Redis snapshot

`POST /_db/snapshot/create` に redis service を渡せば key pattern ベースで
snapshot が取れる。`tables` 省略時は default `["*"]` で全 key を対象とする。

```sh
# 1 回目の snapshot を取る (DB 0 の `user:*` を対象)
curl -sS -X POST http://localhost:<PORT>/_db/snapshot/create \
  -H 'Content-Type: application/json' \
  -d '{
    "db": "docker:redis-svc",
    "tables": ["{\"db\":0,\"pattern\":\"user:*\"}"],
    "note": "before"
  }'

# データを書き換える
docker exec -i code-viewer-test-redis redis-cli -3 -n 0 SET user:42 "modified"

# 2 回目の snapshot
curl -sS -X POST http://localhost:<PORT>/_db/snapshot/create \
  -H 'Content-Type: application/json' \
  -d '{
    "db": "docker:redis-svc",
    "tables": ["{\"db\":0,\"pattern\":\"user:*\"}"],
    "note": "after"
  }'

# snapshot 一覧を確認
curl -sS "http://localhost:<PORT>/_db/snapshot/list?db=docker:redis-svc" | jq

# 2 snapshot 間の diff (id は上で取得したもの)
curl -sS "http://localhost:<PORT>/_db/snapshot/diff/tables?before=<BEFORE_ID>&after=<AFTER_ID>" | jq
```

### SQL 退行確認

既存 SQL の snapshot が壊れていないことを確認する。data/test/redis に
SQL 系のテストデータは置いていないので、別途 PG/MySQL の compose を持つ
プロジェクト or sqlite ファイルを使う:

```sh
cd <sqlite project>
pnpm run preview --cwd .
# ブラウザで Snapshot タブ → Take Snapshot → 一覧表示 → 2 つの diff
```

## クリーンアップ

```sh
docker compose down -v
```

## 注意事項

- このディレクトリは git tracked。テストデータ生成スクリプトと
  docker-compose は仕様情報なのでコミット対象。
- Redis container は localhost:6379 / 6380 にバインドする。既存のローカル
  Redis を使っている場合は port を変更するか既存を止めること。
- `seed.sh` は冪等。何度実行しても結果は同じ（FLUSHDB してから seed）。

## 個別 container だけ seed

```sh
TARGET=redis-svc ./seed.sh   # 認証なしだけ
TARGET=redis-auth ./seed.sh  # 認証ありだけ
```
