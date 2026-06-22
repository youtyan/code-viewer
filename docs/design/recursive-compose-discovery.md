# 仕様書 — recursive compose discovery

`feature/other-datasource` ブランチで作業。Round 3 (Elasticsearch adapter)
完了直後の状態を base にする。

Round 1〜3 で増えた docker-compose 系 (PostgreSQL / MySQL / Redis /
Elasticsearch) の discovery が **cwd 直下の `docker-compose.yml` 1 ファイル
だけ** を読む実装になっており、SQLite の再帰 walk と挙動が揃わない。

結果として「`--cwd <project root>` で起動したときに `data/test/redis/` と
`data/test/elasticsearch/` の compose が両方拾えない」「SQLite と
compose 系を同じ画面で並べられない」問題が起きる。これを再帰探索に
揃えて解消する。

`docs/design/datasource-abstraction.md` の上位設計はそのまま。
capability mixin (`SnapshotIterable` / `Queryable`) も触らない。

---

## 0. 大前提

- 既存 SQL / Redis / Elasticsearch の挙動・UI・API は**極力**変えない。
  挙動を変える 1 点は「`/_db/files` の return に複数 compose が並ぶ」
  ことと「サブディレクトリの compose 由来 service の id が
  `docker:<svc>@<relComposeDir>` に変わる」こと。
- `cwd` 直下の compose 由来 service の id は **`docker:<svc>` の従来形式
  を維持** する (既存 snapshot メタ / URL ブックマーク互換)。
- 「触らない」ファイル (Round 2 / 3 共通) は引き続き触らない:
  `snapshot-store.ts` / `snapshot-runner.ts` / `query-history.ts` /
  `connection-pool.ts` / `global-search.ts`。
- 認証・credential を `/_db/files` のレスポンスに混入させないという
  Round 1 C1 の禁則は維持。`composeDir` も漏らさない (内部状態専用)。

---

## 1. 達成条件

リポジトリ直下に SQLite を、`data/test/redis/docker-compose.yml` に Redis を、
`data/test/elasticsearch/docker-compose.yml` に Elasticsearch を、`db/compose.yml`
に PostgreSQL を置いたプロジェクトで `code-viewer --cwd <root>` を起動
したとき:

1. `/database` のサイドバー select に **SQLite ファイル + 4 種類すべての
   docker service** が同時に並ぶ
2. それぞれ選ぶと既存と同じ pane (SQL grid / RedisExplorer /
   ElasticsearchExplorer) が表示される
3. snapshot / query / docs 一覧 など既存 endpoint が引き続き動く
4. `bun run verify` 全パス
5. 既存の「`cwd` 直下に compose があるプロジェクト」では、サイドバーに
   出る service の id・label・並びが**従来と同じ** (退行なし)

---

## 2. 触るファイル

### 既存への変更

| ファイル | 変更内容 |
|---|---|
| `web-src/server/database/discovery.ts` | `discoverDockerDatabases` を recursive walk に書き換える。`DockerDbInfo` に `composeDir: string` を追加。id 形式は cwd 直下 vs サブディレクトリで分岐。 |
| `web-src/server/database/adapters/docker.ts` | `resolveContainerName` / `listDockerDatabases` / `openDockerAdapter` の cwd を service の `composeDir` 経由で呼び出せるよう経路を通す (もしくは現状の cwd 引数を service ごとの compose dir に差し替える)。 |
| `web-src/server/database/adapters/redis.ts` | `openRedisExplorer(serviceName, env, cwd)` の cwd を `composeDir` に差し替えて呼ぶよう、呼び出し側 (handle-redis.ts / handle.ts snapshot) を調整。adapter 内部の `resolveContainerName` は cwd を受ければよいので変更最小。 |
| `web-src/server/database/adapters/elasticsearch.ts` | 同上。 |
| `web-src/server/database/handle.ts` | `resolveDb` / `handleSnapshotCreate` / `handleFiles` で `docker:<svc>@<relDir>` 形式を parse できるようにする。`toFileInfo` は `composeDir` を**含めない**ことを維持。 |
| `web-src/server/database/handle-redis.ts` / `handle-elasticsearch.ts` | `resolveRedis` / `resolveEs` 等の `dbParam` 解析を id 新形式に対応。`getRedisServices` / `getEsServices` のキャッシュは `composeDir` も識別キーに含める。 |

### 触らないファイル

`snapshot-store.ts` / `snapshot-runner.ts` / `query-history.ts` /
`connection-pool.ts` / `global-search.ts` / `views/database/*` (UI 側は
id を不透明な文字列として扱うので変更不要)。

### 新規

なし。実装変更のみ。

---

## 3. 探索戦略

```ts
// MAX_SCAN_DEPTH と omitDirNames は SQLite 側と同じ規約に揃える。
function scan(dir, depth) {
  if (depth > MAX_SCAN_DEPTH) return
  // 1. このディレクトリ直下の compose ファイルを parse
  for (const name of COMPOSE_FILENAMES) {
    const p = join(dir, name)
    if (existsSync(p)) {
      parseCompose(p, dir, results)
      break  // 1 ディレクトリ 1 compose
    }
  }
  // 2. サブディレクトリへ recurse (symlink 除外, omitDirNames 除外)
  for (const entry of readdirSync(dir)) {
    if (omitSet.has(entry.toLowerCase())) continue
    const full = join(dir, entry)
    if (lstatSync(full).isSymbolicLink()) continue
    if (lstatSync(full).isDirectory()) scan(full, depth + 1)
  }
}
```

- `MAX_SCAN_DEPTH` は SQLite と同じ定数を共有 (今 `3`)
- `omitDirNames` は SQLite と同じ default (`.git` 等) + `node_modules` を
  追加
- compose の最大数は無制限。ただし service 全体で `MAX_DOCKER_SERVICES`
  (新規定数、たとえば 30) を超えた時点で truncate して warn を console に
  出す (port 衝突等の事故防止)

---

## 4. id / label / containerName

### id 形式

| 場所 | id |
|---|---|
| `cwd` 直下 (= compose の dir が cwd と一致) | `docker:<service>` (従来形式) |
| サブディレクトリの compose | `docker:<service>@<encodedRelDir>` |

`encodedRelDir` は `encodeURIComponent(relPath)`。`/` は `%2F` に化ける
ので、URL の表現として安全。例: `docker:es-svc@data%2Ftest%2Felasticsearch`。

PG / MySQL の DB 名分岐 (`docker:<svc>:<db>`) も同様に拡張:
`docker:<svc>@<relDir>:<db>` (拡張順は `@` が先、`:` が後)。

### label

- 従来 cwd 直下: `<service> (<image>, ...)` 既存表記維持
- サブディレクトリ: `<service> (<image>, ... — <relDir>)` で出処を明示
  (UI の select で同名 service を区別するため)

### containerName

`adapters/*/resolveContainerName` は `docker compose ps` を `compose の
あるディレクトリ` で実行しないと service を解決できない。`DockerDbInfo`
に追加した `composeDir` を、各 adapter の open 関数の cwd 引数として
渡す。adapter 内部は cwd 引数を受け取れば良いので変更最小。

---

## 5. UI スロット

UI 側 (`views/database/*`) は **変更しない**。
- `dbSelect` は label をそのまま表示
- 内部の id は不透明な文字列として扱う

---

## 6. コミット分割

3 commit を予定:

1. **RC-C1**: `discovery.ts` を recursive walk に書き換え、`DockerDbInfo`
   に `composeDir` を追加 (id 形式は従来維持で、cwd 直下複数 compose
   は今まで通り 1 つだけ拾う既存挙動と同じ)。
2. **RC-C2**: adapter / handle 側で `composeDir` を経由して container
   解決し、サブディレクトリ compose 用の `docker:<svc>@<relDir>` id を
   parse / 構成できるようにする。これで recursive 化が機能的に有効化される。
3. **RC-C3**: `README.md` に recursive discovery の挙動と複数 compose の
   使い方を追記。`data/test/{redis,elasticsearch}/README.md` にも
   「project root から `--cwd .` で起動した場合に並ぶ」旨を追記。

各 commit で `bun run verify` 通すこと。コミットメッセージは ひらがな
必須 + Conventional Commits。

---

## 7. 受け入れチェックリスト

- [ ] `bun run verify` 全通過
- [ ] code-viewer リポジトリ root で `bun run preview --cwd .` 起動 →
      `data/test/redis/` の Redis 2 つと `data/test/elasticsearch/` の
      ES が**同時に**サイドバーに並ぶ
- [ ] 既存の「cwd 直下に compose があるプロジェクト」では id・label・
      順序が以前と完全に一致 (退行なし)
- [ ] `/_db/files` レスポンスに `composeDir` / `env` / `serviceName` /
      `database` が**含まれない** (Round 1 C1 の禁則維持)
- [ ] 既存 sqlite / postgresql / mysql / redis / elasticsearch のいずれにも
      退行なし
- [ ] 「触らない」ファイル (Round 2/3 list + UI) に diff なし

---

## 8. やってはいけないこと

- snapshot メタの dbId スキーマを書き換える (互換性破壊)
- UI 側で id 形式 (`docker:<svc>` / `docker:<svc>@<relDir>`) を解釈する
  ロジックを追加する (id は不透明文字列のまま扱う)
- compose 以外の経路 (process 列挙 / DOCKER_HOST 接続) で discovery を
  追加する (scope 外)
- 認証情報を `/_db/files` 経由で漏らす

---

## 9. 完了報告

- 全 commit の `git log --oneline`
- `git diff --stat` (Round 3 完了直後との差)
- 既存 cwd 直下 compose プロジェクトでの退行確認
- code-viewer リポジトリ root から `--cwd .` 起動で複数 compose 同時表示
  確認結果
- 「触らない」ファイルに diff がないことの確認
