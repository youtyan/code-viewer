# Redis PoC タスク仕様書（Codex 向け）

`@youtyan/code-viewer` の Database Viewer に **Redis 閲覧機能** を追加する
PoC を実装する。

このドキュメントは Codex に渡す **実装指示書**。読み手は Codex 想定。
設計の背景・思想は `docs/design/datasource-abstraction.md` を参照。

---

## 0. 大前提

- 抽象化はまだしない。**Redis 専用の独立コードパス**で動かす。
- 既存の SQL アダプタ群（sqlite/postgresql/mysql）には**一切触らない**。
- snapshot / global search / query history / export は **スコープ外**。
- スコープ: 「`docker-compose.yml` に redis 1 行追加 → npx 起動 →
  サイドバーに出る → key の中身が見える」まで。

---

## 1. 達成条件（PoC 完了の判定基準）

すべて手動 smoke test で確認:

**作業ブランチ**: `feature/other-datasource`（既存・ユーザー作成済み）。新規ブランチは切らない。

1. `docker-compose.yml` に以下があるプロジェクトで `npx code-viewer` を
   起動すると、サイドバーの DataSource selector に `redis-svc (redis:7-alpine, localhost:6379)`
   のような表示が出る:
   ```yaml
   services:
     redis-svc:
       image: redis:7-alpine
       ports: ["6379:6379"]
   ```
2. クリックすると DB 0〜15 の一覧が表示される（各 DB のキー数を
   `INFO keyspace` で取得して併記）。
3. DB を選ぶと `SCAN 0 MATCH * COUNT 200` で key 一覧が表示される
   （カーソル続き読みボタン or 自動 pagination）。
4. key をクリックすると `TYPE` 判定 → 型別ビュー表示:
   - `string`: 1 行のテキストペイン
   - `hash`: `{field: value}` テーブル
   - `list`: 配列ペイン
   - `set` / `zset` / `stream`: **JSON raw 表示**（PoC では polish しない）
5. `bun run verify` が全部通る。
6. 既存の sqlite / postgresql / mysql の動作に**一切退行がない**こと。

---

## 2. 触るファイル（**これだけ**。他は触らない）

### 既存ファイルへの追加（最小侵襲）

| ファイル:位置 | 変更内容 |
|---|---|
| `web-src/server/database/discovery.ts:130` `detectDbKind` | `lower.includes("redis")` 分岐を追加して `"redis"` を返す |
| `web-src/server/database/discovery.ts:185` `DockerDbInfo` | （必要なら）`defaultPort?: number` を追加。kind 別 default port を露出 |
| `web-src/core/database/types.ts:1` `DbKind` | `"redis"` を union に追加 |
| `web-src/server/database/handle.ts:1029` `handleDatabaseRoute` | `if (path.startsWith("/_db/redis/")) return handleRedisRoute(...)` の 1 分岐を**最上位に**追加 |

### 新規ファイル

| ファイル | 役割 |
|---|---|
| `web-src/server/database/adapters/redis.ts` | Redis adapter。`DatabaseAdapter` interface は**実装しない**。`RedisExplorer` 型を独自に export |
| `web-src/server/database/handle-redis.ts` | `/_db/redis/databases`, `/_db/redis/keys`, `/_db/redis/value` の endpoint |
| `web-src/views/database/redis-explorer.ts` | Redis 専用 UI。サイドバーに DB 一覧、中央に key list + 値ペイン |

UI ファイルパスは既存 `web-src/views/database/database-view.ts` の隣に
合わせる。

### **触らない**ファイル（絶対）

- `web-src/server/database/adapters/sqlite.ts`
- `web-src/server/database/adapters/docker.ts`
- `web-src/server/database/adapters/types.ts`
- `web-src/server/database/snapshot-store.ts`
- `web-src/server/database/snapshot-runner.ts`
- `web-src/server/database/global-search.ts`
- `web-src/server/database/query-history.ts`
- `web-src/server/database/connection-pool.ts`
- `web-src/views/database/database-view.ts` の Redis 以外の部分

`database-view.ts` には、Redis を選んだときに `<RedisExplorer>` を mount
するための **最小限の分岐 1 箇所**だけ許可。既存タブ・コンポーネントの
構造には触らない。

---

## 3. 実装方針

### 3-1. Redis adapter (`adapters/redis.ts`)

`DatabaseAdapter` interface を実装しない。以下のメソッドを持つ純粋な
`RedisExplorer` 型を export する:

```ts
// シグネチャ案。命名は適宜調整可。
export type RedisExplorer = {
  readonly kind: "redis"
  listDatabases(): Promise<Array<{ index: number; keyCount: number }>>
  listKeys(opts: {
    db: number
    pattern: string  // default "*"
    cursor: string   // default "0"
    count?: number   // SCAN COUNT
  }): Promise<{ keys: Array<{ name: string; type: RedisType }>; nextCursor: string }>
  getValue(opts: { db: number; key: string }): Promise<RedisValue>
  close(): Promise<void>
}

type RedisType = "string" | "list" | "set" | "zset" | "hash" | "stream" | "none"
type RedisValue =
  | { type: "string"; value: string }
  | { type: "list"; items: string[] }
  | { type: "hash"; fields: Record<string, string> }
  | { type: "set"; members: string[] }
  | { type: "zset"; members: Array<{ member: string; score: number }> }
  | { type: "stream"; entries: Array<{ id: string; fields: Record<string, string> }> }
  | { type: "none" }
```

接続戦略: **`docker exec <container> redis-cli -3`**。既存 `adapters/docker.ts`
の `resolveContainerName` パターンを参考にする（コピーしてよい。共通化は
PoC 2 周目）。

- `redis-cli -3` で RESP3 を使う。`--no-raw` も必要なら付ける。
- 出力パース: list/hash/set/zset は `--csv` または `-3` の structured 出力。
- パスワードは env から拾う（`REDIS_PASSWORD` 等）。compose env をすでに
  `discoverDockerDatabases` が parse しているので、それを流用。

### 3-2. handler (`handle-redis.ts`)

`web-src/server/database/handle.ts` の `json()` / `textError()` ヘルパーを
**そのファイルから export してもらい**、`handle-redis.ts` から import する
（handle.ts に export 行を 1 行足すのは許可）。

エンドポイント:

```
GET  /_db/redis/databases?db=docker:redis-svc
GET  /_db/redis/keys?db=docker:redis-svc&dbIndex=0&pattern=*&cursor=0&count=200
GET  /_db/redis/value?db=docker:redis-svc&dbIndex=0&key=user:42
```

response shape は素直な JSON。型は `web-src/core/database/types.ts` に
`RedisDatabasesResponse` / `RedisKeysResponse` / `RedisValueResponse` を
追加してよい（既存 SQL 系の型は触らない、新規追加のみ）。

### 3-3. UI (`redis-explorer.ts`)

`web-src/views/database/database-view.ts` の構造に倣う（クラスベースの
DOM 生成）。React は使わない（このプロジェクトはバニラ TS）。

レイアウト:
```
┌─────────────────────────────────────┐
│ サイドバー: DB 0..15 一覧 + key 数  │
├──────────────┬──────────────────────┤
│ key リスト    │ value ペイン         │
│ (SCAN)       │ (型バッジ + 型別表示) │
└──────────────┴──────────────────────┘
```

key リストは 200 件区切りで「more」ボタン。

set/zset/stream は値ペインで `JSON.stringify(value, null, 2)` の生表示で OK。

### 3-4. database-view.ts への分岐（1 箇所だけ）

データソース選択時に `kind === "redis"` なら `<RedisExplorer>` を、それ
以外なら既存の `<DatabaseView>` を mount。**それだけ**。

---

## 4. コミット分割（順守）

小さく刻む。各コミットで `bun run verify` が通ること:

1. `discovery.ts` に redis kind 追加（sidebar に出るだけ。open 押すと
   "not implemented" でよい）
2. `adapters/redis.ts` で `listDatabases` だけ実装 + `handle-redis.ts` で
   `/_db/redis/databases` endpoint
3. UI 側 `redis-explorer.ts` で DB 一覧表示
4. `listKeys` + `/_db/redis/keys` + UI key リスト
5. `getValue` + `/_db/redis/value` + UI 値ペイン（string のみ）
6. hash / list の専用ビュー追加
7. set / zset / stream の JSON raw 表示
8. README に Redis サポートを追記（1-2 行で十分）

---

## 5. 受け入れチェックリスト（Codex は自己チェック）

- [ ] `bun run typecheck` が通る
- [ ] `bun run lint` が通る
- [ ] `bun run check:format` が通る
- [ ] `bun run build` が通る
- [ ] `bun run check:bundle` が通る
- [ ] `bun run test` が通る
- [ ] `bun run verify` が全部通る
- [ ] 既存 sqlite / postgresql / mysql の動作に退行がない（手動確認）
- [ ] 達成条件 1〜6 がすべて満たされている
- [ ] **触らないファイルリスト** のファイルに diff がない（`git diff --stat`
      で確認）
- [ ] 各コミットメッセージが Conventional Commits（既存リポジトリ慣習）

---

## 6. やってはいけないこと

- snapshot / search / history / export を実装すること（**スコープ外**）
- 抽象化（`DataSourceAdapter` 等の新インターフェース）を追加すること
  （PoC 後）
- 既存 SQL アダプタを「綺麗にするついで」でリファクタすること
- `package.json` に `redis` パッケージを依存追加すること（docker-exec で
  完結させる）
- 共通 util（`json()` / `textError()` 以外）を切り出すこと
- `git push --force` / `git commit --amend` / `git stash` を使うこと
- PR を勝手にマージすること
- `--no-verify` で hooks をスキップすること

---

## 7. 完了報告

実装が終わったら以下を返す:

- 達成条件 1〜6 の確認結果
- `git log --oneline` の出力
- `git diff --stat origin/main..HEAD` の出力
- 「触らないファイル」一覧と、それらに diff がないことの確認
- 動作確認のスクショ（任意。tmux 上では難しいので未対応で OK）

レビューは別エージェントが行う。PR の作成はしない（人間が後でやる）。
作業ブランチ `feature/other-datasource` にコミットしておく。
