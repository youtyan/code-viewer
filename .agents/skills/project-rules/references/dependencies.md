# dependencies — 依存とバンドル

読むタイミング: npm 依存を足す / 消す / 上げる / 差し替えるとき。バンドル構成を変えるとき。

## 何を防ぐか

`@xterm/addon-webgl` を「効きそうだから」で追加した。バンドルは +164KB。**実機確認を
しないまま入れ、結果的に当該バグには効かなかった。** さらに third-party notices の対象
リストに入れ忘れ、**公開パッケージがライセンス表記の無い MIT コードを同梱**していた
（後に修正済み）。

依存追加は「入れて様子を見る」ができない操作。配布物に載り、ライセンス義務が生じ、
外すときにはもう理由を誰も覚えていない。

## 採用前に書くこと

コードを触る前に、次の 3 つを言葉にする。**書けないなら入れない。**

1. **観測済みの不具合は何か** — 推測ではなく、実際に見た症状。「〜のはず」は不可
2. **この依存が効いたと確認する観測は何か** — 入れた後にそれを実行して確認する
   （観測の選び方は `diagnose.md`）
3. **既存の依存・プラットフォーム機能で足りない理由**

> **「確認する観測」を先に決められないなら、入れない。**
> 後から「効いたかどうか分からないが入っている」依存が残る。

## 配線チェックリスト（全部やる。1 つ欠けると配布物が壊れる）

| # | 対象 | 内容 |
|---|---|---|
| 1 | `package.json` | 置き場所を選ぶ（下表） |
| 2 | `scripts/bundles.mjs` | 遅延バンドルなら `WEB_BUNDLES` に入口を追加。サーバ側で束ねないなら `SERVER_BUNDLE.external` に追加 |
| 3 | `scripts/generate-third-party-notices.mjs` | **配布物に載るなら `distributedPackageRoots` に追加。** ここを忘れるとライセンス表記が欠ける |
| 4 | `web-src/core/*-loader.ts` | 遅延バンドルなら「実際に使う分だけ」の手書き型を書く（`createBundleLoader` を共有） |
| 5 | `pnpm run verify` | 通す。`check:bundle` が二重ビルドのバイト一致を見る |
| 6 | `.github/dependabot.yml` | グループ指定が要るなら追加 |

### `package.json` のどこに置くか

| セクション | 対象 | 例 |
|---|---|---|
| `devDependencies` | **esbuild が焼き込むもの**（web バンドル / dist に inline される） | `shiki` `mermaid` `markdown-it` `@xterm/*` `yaml` `highlight.js` |
| `dependencies` | **サーバ実行時に束ねずに解決するもの**（`SERVER_BUNDLE.external` と対で管理） | `pg` `mysql2` `@redis/client` |
| `optionalDependencies` | **ネイティブモジュール。** 無くても起動できること | `better-sqlite3` `@lydell/node-pty` |

直感に反するが、**ブラウザ側ライブラリは `devDependencies` が正しい。**
バンドルに焼き込まれるので、利用者の `node_modules` には要らない。

## バンドルへの影響を測る

追加前後で成果物のバイト数を記録する。

```sh
pnpm run build:web && ls -l web/*.js web/vendor/highlight.js/highlight.min.js
pnpm run build:server && ls -l dist/code-viewer.js
```

報告には**どのバンドルに載ったか**を必ず書く。

- **即時バンドル（`web/app.js`）に載った** → 全画面の初回読み込みが重くなる。慎重に
- **遅延バンドル（`shiki` / `mermaid` / `yaml` / `xterm` / `highlight`）に載った** →
  初回表示には影響しないが、その機能を開く画面は遅くなる。**「遅延だから影響ゼロ」ではない**

## 任意依存・ネイティブ依存

- 無い環境でもサーバが起動すること。`pnpm run verify` の中で
  `scripts/node-smoke.mjs` が実際に CLI を起動して確認する
- 可用性は `server/doctor.ts` に出す（`sqlite.driver` 行が既にその形）
- ネイティブモジュールはバンドルできない。`SERVER_BUNDLE.external` に入れて実行時解決に回す

## 削除するとき

配線チェックリストの 6 項目を**逆にたどる**。加えて:

- ユーザーに見える痕跡があった機能なら、**痕跡が残っていないことのガードテスト**を足す
  （`web-src/test/asset-version-removal.test.ts` が手本。ソースと**焼いたバンドル**の
  両方を見ている）
- **外部状態を変えていたなら `server.md` の「外部状態を変える機能」節も適用する。**
  依存を消しても、その依存が書き込んだ設定はユーザー環境に残る

## 上げるとき

- ロックファイルの差分だけで済むと仮定しない。`pnpm run verify` を通す
- 遅延バンドルのライブラリを上げたら、`core/*-loader.ts` の手書き型が実際の API と
  合っているか確認する（型は手書きなので、上流の破壊的変更を型検査は捕まえない）
- 挙動が変わりうる更新は、**採用前チェックの 2（確認する観測）を再実行する**

## 完了チェックリスト

- [ ] 観測済みの不具合・確認する観測・既存で足りない理由を書いた
- [ ] `package.json` の正しいセクションに入れた
- [ ] `scripts/bundles.mjs` を更新した（必要なら）
- [ ] `distributedPackageRoots` に追加した（配布物に載るなら）
- [ ] 遅延バンドルなら loader の型を書いた
- [ ] バンドルのバイト数の増減と、載ったバンドル名を記録した
- [ ] 「確認する観測」を実行して、実際に効いたことを確かめた
- [ ] `pnpm run verify` と `npm pack --dry-run` が通る
