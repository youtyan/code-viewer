# server — ルート・ハンドラ・CLI・外部プロセス

読むタイミング: HTTP ルート / ハンドラ / CLI サブコマンド / 外部プロセス連携（git・tmux・
docker・shell）を足す・変えるとき。**`fetch` を 1 本でも書くなら「Request Lifecycle
Discipline」節を読む。**

> このファイルは `AGENTS.md` の "Request Lifecycle Discipline (Anti-Stuck)" 本体を含む。
> コード内コメントの「AGENTS.md Request Lifecycle Discipline」という参照はここを指す。

## ルート登録

分岐は `web-src/server/preview.ts` の**単一のディスパッチチェーン**（`url.pathname` を
上から順に見る箇所）。プレフィックス群（`/_db/` `/_tmux/` `/_shell/` `/_agent/` `/_state/`）は
`server/<領域>/handle.ts` に委譲し、必要なものを引数で受け取る。

- **並行するルータを作らない。** 新しいディスパッチ機構を導入しない
- 単発のエンドポイントはチェーンに 1 行足す。領域が増えるならプレフィックス委譲にする

## 副作用ガード（状態を変える全エンドポイント）

```ts
if (!sideEffectRequestAllowed(req)) return text("forbidden", 403);
```

`server/request-origin.ts` の `sideEffectRequestAllowed` は、**同一オリジン**かつ
**`X-Code-Viewer-Action: 1` ヘッダ付き**かつ `sec-fetch-site` が同一オリジンであることを要求する。

**呼ぶ側の現状（重要）:**

- CLI 側は `server/cli-helpers.ts` の `requestJson` がヘッダを付ける
- **ブラウザ側は共通ヘルパが無い。** 各呼び出し箇所に `"X-Code-Viewer-Action": "1"` を
  直接書いている（`app.ts` と `views/` の複数ファイルに散在）
- したがって**新しい書き込み系 `fetch` はヘッダを書き忘れやすく、忘れると型エラーではなく
  実行時 403 になる。** 書き込み系で 403 が返ったら、まずこのヘッダを疑う

## ハンドラの雛形

書き込み系ハンドラの検証順序は `handleOpenPath`（`preview.ts`）が手本。**同じ順序で書く。**

```ts
if (req.method !== "POST") return text("method not allowed", 405);
if (!sideEffectRequestAllowed(req)) return text("forbidden", 403);
// content-type が application/json か  → 415
// content-length と実バイト長の上限     → 413
// JSON.parse 失敗                        → 400
// フィールドの型・列挙値                 → 400
if (!safeRepoPath(path)) return text("invalid path", 400);
if (path && git.isGitInternalPath(path)) return text("forbidden", 403);
// 実パス解決に失敗                       → 404
```

- クライアント由来のパスは `safeRepoPath` を通し、`.git` 内部は `git.isGitInternalPath` で弾く
- 実ファイルへ落とすときは `safeOpenWorktreePath` のような**解決してから存在確認する**形にする
- 識別子に制御文字が混じらないことは `core/control-chars.ts` の `hasControlCharacter` で見る
- **上限を書かない入力を受け付けない。** サイズ上限の無い `req.text()` を書かない

## Request Lifecycle Discipline（Anti-Stuck）

「UI が固まる / 古い応答が新しい画面を上書きする」回帰を二度と持ち込まないための規約。
新しい API ハンドラ・`fetch` 呼び出し・ビュー切替フックを書く前に読む。

**既にあるプリミティブを名前で再利用する。並行するラッパー・deps 名・世代アクセサを
発明しない。** 探すときは**名前で探す**（散文の行番号は必ず腐る。以前ここに書かれていた
行番号は全て数百行ずれていた）。

| 名前 | 場所 | 役割 |
|---|---|---|
| `SERVER_GENERATION` | `app.ts` | サーバ世代カウンタの唯一の権威。`app.ts` の 1 箇所からのみ更新 |
| `NETWORK_ACTIVITY.installFetch(window)` | `app.ts` | 全 `fetch` を `AbortController` で包む。既にグローバル。迂回しない |
| `trackLoad<T>(promise): Promise<T>` | `app.ts` | promise を登録して `cancelInFlightRequests` の対象にする。view には `deps.trackLoad` で渡る。**この名前を使う** |
| `cancelInFlightRequests()` | `app.ts` | 追跡中の fetch を全て abort する。ユーザー操作由来の中断で呼ぶ |
| `handleFileDiff`（`generation` フィールド） | `preview.ts` | サーバハンドラの手本。モジュールレベルの `generation` カウンタを応答に載せる |
| `history-view.ts` | — | クライアント側の世代破棄の手本。ローカル `generation` を進め、応答と比較し、古ければ捨てる |

### 規則

- 全ての `fetch` は `installFetch` に包まれている。**素の `XMLHttpRequest`・worker 側 fetch・
  自前 `AbortController` で迂回しない**
- 新しい fetch は `deps.trackLoad(fetch(url)...)` を通す。**新しい deps 名
  （`fetchWithCancel` `loadGuarded` 等）を発明しない。名前は `trackLoad`**
- 自分自身と競合しうる / 再入されうるサーバハンドラは、JSON 応答に `generation` を含める。
  **別のフィールド名にしない。サブオブジェクトに包まない**
- クライアントは結果を反映する前に `response.generation === myGeneration` を確認する。
  **`getServerGeneration` / `setServerGeneration` のようなアクセサを足さない。**
  view モジュールは自前の世代カウンタを持つ。`app.ts` の `SERVER_GENERATION` は
  SSE / diff パイプラインの調整用であり、view ごとの deps に増殖させない
- ビュー切替 / enter 関数（`enterHistory` `renderBlamePage` `applySourceRouteToShell` 等）は
  **冪等**にする
  - 最新世代が既に反映されている状態で同じ引数で呼び直したら no-op
  - **世代だけ進めて対応する再取得をスケジュールしない、をやらない。**パネルが空白のまま残る
- **全ての loading 状態に終端を用意する。** `setStatusText("loading...")` を書いたら、
  成功・失敗・キャンセル・早期 `return` の**全経路**で消す
- SPA ナビゲーション（タブクリック・popstate・`setRoute`）では、`cancelInFlightRequests` で
  中断するか、ローカル世代カウンタで無効化する。**前の画面の応答が次の画面を上書きしない**

これらを飛ばした実装、または並行プリミティブを発明した実装は禁止。レビューでは
新規の fetch / ハンドラ / ビュー切替を全てこの節に照らす。

## クライアントとサーバで共有する型

ワイヤ形式の型は `web-src/core/types.ts` に 1 つ置く。**view 側でレスポンス形状を
再宣言しない**（片方だけ直って気付かない状態になる）。

## 制御文字をソースに直書きしない

```ts
const SEP = String.fromCharCode(31);   // よい
```

生の制御文字を文字列リテラルに直接置くと、**エディタ上で空文字と区別できず、
消えていても気付けない。** 必ず `String.fromCharCode(n)` の形で書く。

実例: tmux のフィールド区切りは `server/tmux/command.ts` の `TMUX_FIELD_SEP` に集約され、
`panes.ts` / `clients.ts` が import している。

**この規約は過去に「別ファイルのコメント」として書かれていたため守られなかった。**
コメントは同じファイルしか拘束しない。現状確認:

```sh
grep -rlnP '[\x00-\x08\x0b\x0c\x0e-\x1f]' web-src/ --include=*.ts
```

**ゼロが正しい状態。** 何か出たら、そのファイルを `String.fromCharCode(n)` に直す。
生の制御文字は Edit の完全一致で指定できないので、置換コマンド
（`perl -pi -e 's/"\x01"/String.fromCharCode(1)/'` のような形）を使う。

## 外部プロセス

- **tmux は `server/tmux/command.ts` 経由のみ。** `runTmux` / `tmuxArgs` / `TMUX_FIELD_SEP`。
  素の `spawn` で tmux を呼ばない
- 戻り値は状態型（`ok` / `missing` / `no-server` / `no-target` / `error`）。
  **握り潰さず、状態ごとに UI の出し分けを決める**
- git は `server/git.ts` の関数経由。docker は `server/database/adapters/docker*.ts` 経由

## 外部状態を変える機能には、戻す経路と検出を付ける

**プロセスの寿命を超えて残る状態**（tmux のオプション、git config、リポジトリ外のファイル、
docker コンテナ、OS の設定）を変える機能は、次の 3 つが揃って初めて完成とする。

1. 変更する状態と、**元に戻す手順**をコード近傍に書く
2. **`server/doctor.ts` に検出行を足す。** `DoctorRow` には `hint` があるので、そこに
   戻し方を出す
3. **機能を消しても、doctor の検出行は最低 1 リリース残す**

3 番目が要る理由: 過去に tmux のウィンドウを作り替える機能があり、tmux はその瞬間
ウィンドウを `window-size manual` にした。**機能は削除したが、既にユーザーの tmux に
設定された manual は残り続け**、数日後まで「画面が見切れる」原因になっていた。

> **機能を消しても、ユーザー環境に書き込んだ状態は消えない。**
> コードから消えたものは、こちらからは見えなくなるだけ。

現在 `doctor.ts` のグループは runtime / package / sqlite / git / docker / datastore / server の
7 つで、**tmux グループは無い**。tmux の状態を触る機能を入れるなら、まずここにグループを作る。

## CLI サブコマンド

- 実体は `server/*-cli.ts`。入口は `server/cli.ts`
- ドキュメントとの整合はテストが見る（`web-src/test/_documented-cli-fixture.ts`）。
  README / Help に書いた呼び出し方と実装がずれると落ちる
- CLI からサーバを叩くときは `server/cli-helpers.ts` の `requestJson`
  （Origin と `X-Code-Viewer-Action` を付ける）

## 既存の違反をどう扱うか

**触ったら直す。** 変更したハンドラが上の雛形から外れていたら、その PR で揃える。
**まとめて直すのは別作業。** 見つけた違反は報告する。

## 完了チェックリスト

- [ ] 書き込み系エンドポイントが `sideEffectRequestAllowed` を通っている
- [ ] クライアント側が `X-Code-Viewer-Action: 1` を送っている
- [ ] 入力にサイズ上限と型検証がある
- [ ] パスが `safeRepoPath` / `isGitInternalPath` を通っている
- [ ] 競合しうる応答に `generation` があり、クライアントが比較している
- [ ] 新しい `fetch` が `deps.trackLoad` を通っている
- [ ] loading 状態が全経路で終端している
- [ ] ワイヤ型を `core/types.ts` に置いた
- [ ] 生の制御文字を書いていない
- [ ] 外部状態を変えるなら、戻す手順と doctor 検出行がある
- [ ] `pnpm run verify` が通る
