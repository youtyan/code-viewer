# PostgreSQL multi-schema テスト環境

code-viewer の PostgreSQL schema 切り替え UI を確認するための
docker-compose セット。

## 含まれるもの

- `docker-compose.yml` — PostgreSQL 17
  - `pg-svc` (`postgres:17-alpine`, localhost:54390 -> container 5432)
  - database: `app`
  - user: `code_viewer`
  - password: `code_viewer_password`
- `init/001-multi-schema.sql` — 初回起動時に投入される fixture
  - `public.users`
  - `tenant_a.users`, `tenant_a.orders`, `tenant_a.active_users`
  - `tenant_b.users`, `tenant_b.orders`, `tenant_b.active_users`
  - `analytics.events`

`tenant_a` と `tenant_b` には同名の `users` / `orders` を置いている。
schema プルダウンを切り替えたときに、同じテーブル名でも別データが見えることを
確認しやすくするため。

## 使い方

リポジトリのルートで:

```sh
pnpm run test:postgres:up
pnpm run preview --cwd data/test/postgresql
```

ブラウザでサイドバーの `pg-svc` を開く。PostgreSQL の Database 画面で
schema プルダウンに `public` / `tenant_a` / `tenant_b` / `analytics` が
表示される。

リポジトリ root を cwd にして起動しても、recursive compose discovery で拾える:

```sh
pnpm run preview --cwd .
```

この場合、service id は subdirectory 由来の
`docker:pg-svc@data%2Ftest%2Fpostgresql` 形式になる。

## 検証ポイント

- `public` -> `users`: `Public Admin` / `Public Viewer` が見える
- `tenant_a` -> `users`: `Tenant A Alice` / `Tenant A Bob` / `Tenant A Carol` が見える
- `tenant_b` -> `users`: `Tenant B Alice` / `Tenant B Daniel` が見える
- `analytics` -> `events`: `tenant_a` / `tenant_b` 両方の event が見える
- Query タブで `SELECT * FROM users ORDER BY id` を実行し、選択中 schema の
  `users` が参照される
- Snapshot タブで schema ごとに snapshot 一覧が分かれる

## クリーンアップ

```sh
pnpm run test:postgres:down
```

`down -v` なので PostgreSQL volume も削除され、次回 `up` 時に fixture が
再投入される。
