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
| `BACKGROUND_REQUEST_HEADER` | `core/network-activity.ts` | 数秒おきの取り直し (読み取りのみ・失敗しても次の周期で取り直せるもの) に付ける印。`installFetch` の中で、通信中の表示と `cancelAll` の対象から外す。**迂回の口ではない。** 利用者の操作で始まる fetch に付けない |
| `UNINTERRUPTIBLE_REQUEST_HEADER` | `core/network-activity.ts` | 途中で止めてはいけない書き込み (ターミナルの打鍵 `/_shell/keys`・寸法 `/_shell/resize`) に付ける印。`cancelAll` の対象と通信中の表示から外す。画面の切替の取消で打鍵を捨てないため。読み取りや、取り消してよい書き込みには付けない |
| `projectRequest` (`prepareRequest`) | `core/api-url.ts` → `installFetch` | 入口のサーバの下の画面で、全 fetch にプロジェクトの前置き・鍵の見出し (`PROJECT_HEADER`) を足す。**経路の組み立ては `apiUrl` のまま。** これを当てにして経路の文字列をじかに書かない |
| `trackLoad<T>(promise): Promise<T>` | `app.ts` | promise を登録して `cancelInFlightRequests` の対象にする。view には `deps.trackLoad` で渡る。**この名前を使う** |
| `cancelInFlightRequests()` | `app.ts` | 追跡中の fetch を全て abort する。ユーザー操作由来の中断で呼ぶ |
| `handleFileDiff`（`generation` フィールド） | `preview.ts` | サーバハンドラの手本。モジュールレベルの `generation` カウンタを応答に載せる |
| `history-view.ts` | — | クライアント側の世代破棄の手本。ローカル `generation` を進め、応答と比較し、古ければ捨てる |
| `apiUrl(endpoint)` / `pageUrl(path)` | `core/api-url.ts` | フロントの要求 URL の唯一の組み立て口（経路の表もここ）。経路の文字列をほかのファイルに書くと `web-src/test/api-url-guard.test.ts` が落ちる |

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

## 入口のサーバと取り次ぎ

既定の `code-viewer` は入口のサーバ (`server/entry/`)。1 つのポートで全プロジェクトを扱い、
リポジトリ決め打ちの処理は `/p/<鍵>/…` として、そのプロジェクトの裏のプロセス
(今のサーバそのもの = `preview.ts --backend`) へ取り次ぐ。`--standalone` は今までの
1 つで完結するサーバ (テスト・スクリプトはこちら)。

| どこが受けるか | 経路 | 決めるもの |
|---|---|---|
| 入口 | 画面のファイル・`/_agent/*`・`/_tmux/*`・`/_shell/*`・`/_worktree/open|stop`・`/_entry*` (`/_entry/backend` = 選んでいるプロジェクトの裏の状態) | `core/api-url.ts` の zone `entry` |
| 裏 (入口が取り次ぐ) | それ以外の経路全部 (`/_settings`・`/_doctor`・`/_state/*` を含む) | zone `project` |

- **新しい経路は `api-url.ts` の表に zone 付きで足す。** zone を間違えると、入口の下では
  別のプロセスに届く (または 404)。裏は `/_agent/` `/_tmux/` `/_shell/` を 404 で断る
- 選んでいるプロジェクトで結果が変わる入口の処理 (シェルの作業場所・「このリポジトリの
  ペインか」・アカウントのログインの作業場所・貼った画像の置き場所) は、要求の
  `PROJECT_HEADER` から入口が根を決めて、既存のハンドラに `cwd` として渡す。新しく
  足すときも同じ形にし、ハンドラの中で入口かどうかを見分けない
- 取り次ぎ (`entry/proxy.ts`) は本文も応答も溜めずに流す (SSE・ダウンロード・ファイルの
  送信)。書き込みは入口で `sideEffectRequestAllowed` を通ったものだけ `Origin` を裏の
  オリジンに付け替える。**裏に「入口からは信用する」口を作らない** (単体の裏と挙動が分かれる)
- 取り次ぎは裏が応答の見出しを返すまで 120 秒待ち、越えたら経路・プロジェクト・待った秒数・
  元のエラーを持つ 504 (`backend-timeout`) にする。見出しを受け取った後はダウンロードなどを
  通信停止で切らない。SSE は裏が 15 秒ごとに送る heartbeat の 3 倍、データが来なければ切る。
  ブラウザが要求を止めた場合は、これらの時間切れより先に裏への要求を止める
- 裏に繋がらない = 502 (`backend-stopped`)、起きない = 503 (`backend-start-failed`)、
  応答を始めない = 504 (`backend-timeout`)。
  形は `core/types.ts` の `EntryBackendFailure`。画面は fetch の包み (`onResponse`) で
  拾い、`views/backend-state.ts` が中央の面を空表示で覆って、理由の全文をダイアログの
  「詳細」に畳んで出す (再起動が失敗したときも同じ所に全文)。**502/503 を各画面で個別に
  扱わない** (各画面は受け取った本文をそのまま出すことがあるが、覆われて見えない)
- 裏の状態は `entry/backends.ts` の型で 4 つに分ける。**「止めた」と「落ちた」を混ぜない**

  | 状態 (`EntryBackendState`) | 何か | 次の要求 |
  |---|---|---|
  | `starting` | 起こしている最中 | 起き終わるのを待つ (画面は `/_entry/backend` を 1 度聞いて「起動中」を出す) |
  | `running` | 取り次げる | そのまま取り次ぐ |
  | `idle-stopped` | 使われていないので入口が止めた | 黙って起こす (502 にしない) |
  | `unreachable` | 取り次ぎが接続を断られた (落ちた) | 502。画面の「再起動」か SSE の繋ぎ直しの 1 回だけ起こす |

  このほか入口がまだ扱っていない根は `absent` (次の要求で起こす)
- **アイドル停止**: SSE の購読が 0 本・取り次ぎ中の要求 (ダウンロード・ファイルの送信
  などの流れ) が 0 本・最後の要求から `--idle-stop` 秒 (既定 600。0 は止めない。
  `entry/args.ts` の `DEFAULT_IDLE_STOP_SECONDS` の 1 か所) 経った裏を止める。止めて
  よいのは入口の裏 (登録簿の `backend`) だけで、利用者が起こした `--standalone` は
  止めない。取り次ぐ要求は `backends.acquire` で数え、流し終わりで `release` する
  (**新しい取り次ぎの経路を足すときも `acquire` を通す**。通さないと、流している最中の
  裏を止める)。止めた・起こし直したは入口のログに 1 行ずつ (`[code-viewer] entry: …`)
- ターミナル (tmux・シェル)・未読・通知・フックの申告は入口に居るので、裏を止めても
  消えない。**裏に「止めると消える」ものを持たせない** (持たせるなら、アイドル停止の
  条件に加える)
- 裏の起動・本人確認・停止は `worktree/open.ts` の仕組みをそのまま使う
  (`backendOf` と起動ごとの token を渡すと `--backend --entry-pid --entry-token`)。裏は
  pid の生存だけで持ち主を決めず、`entry.json` と入口の `/_entry` が pid と token の両方を
  返すことを確かめる。入口を起動し直したときは、古い pid が居なくなった後に新しい入口が
  `/_entry/adopt` で新しい token を渡す。採用されなければ 10 秒後に裏は終わる。採用口が無い
  古い版の裏は再利用しない
- `entry.json` は `entry/entry-file.ts` の `readEntryRecord` で読む。**ファイルが無い**は
  `{ ok: true, registry: null }`、読めない・JSON が壊れている・必須欄が欠けるは
  `{ ok: false, error }` であり、同じ扱いにしない。読めない記録は上書きも削除もせず理由を
  表に出す。終了時の `removeEntryRecord` も `absent` / `other-owner` / `unreadable` を分け、
  別の入口が書いた記録を消さない
- 入口と裏の終了処理は `server/shutdown.ts` の `createProcessShutdown` に集約する。登録簿・
  `entry.json`、SSE、シェル、巡回、watch、HTTP サーバの片付けは、途中の 1 件が失敗しても
  残りを続け、失敗をスタックごと出して exit 1 にする。`uncaughtException` と
  `unhandledRejection` も同じ終了処理を exit 1 で通す。片付けの失敗を log だけ出して
  正常終了にしない

## クライアントとサーバで共有する型

ワイヤ形式の型は `web-src/core/types.ts` に 1 つ置く。**view 側でレスポンス形状を
再宣言しない**（片方だけ直って気付かない状態になる）。

## サーバが返した URL をブラウザで使う前に検査する

レスポンスの URL は、同じサーバが返したものでも移動・`fetch`・`img.src` へ直接渡さない。
用途ごとの既存の検査を通し、違反は例外として表に出す。

| 用途 | 検査 | 許すもの |
|---|---|---|
| プロジェクト・作業ツリーへ移る | `core/projects.ts` の `projectDestination` | 認証情報の無い loopback HTTP の根、または `/p/<16 桁の鍵>/`。移る前のアプリ内パスだけを足す |
| ターミナル画像を fetch / 表示する | `core/terminal-images.ts` の `validateTerminalImageResponseUrls` | 現在の画面と同一オリジンの HTTP(S) URL。`images` の全件を検査する |
| 差分の遅延読み込み・hunk 展開 | `views/diff-view.ts` の `validatedFileDiffUrl` | `apiUrl("fileDiff")` が示す内部の差分経路だけ。プロジェクト前置きの有無は両方扱う |
| リポジトリの Web ページへのリンク | `core/repository-web-url.ts` の `buildRepositoryWebTarget` | `http:` / `https:` だけ（それ以外は null）。parse できない値は cause 付きで投げる（サーバは https か null しか返さないので、来たら契約違反） |

`new URL()` が成功しただけでは安全の根拠にならない。プロトコル・オリジン・認証情報・
許可した pathname を検査し、URL の配列は先頭だけでなく全要素を見る。

## ブラウザ側で失敗から回復するとき

原文の表示・layout 値・既定値に戻して続けてよい場面でも、黙って戻さない。元の例外を
error オブジェクトごと `console.error` に出し、画面に「失敗して代わりを出している」印と理由を
残す（既存の状態表示・`title`・failed の見た目）。読み込みの失敗は空や null に置き換えず、
画面の既存のエラー表示に全文（`responseErrorMessage` の操作・HTTP status・本文と、
`formatErrorDetail` の cause の連鎖）を出す。道具は `orientation.md` の「既にあるもの」
（`core/error-detail.ts`・`core/copy-failure.ts`・`core/stored-size.ts` の `reportStoredSizeFailure`）。
実例: `views/blame-view.ts` のエラー表示、`views/history-view.ts` の `fetchSingleCommit`、
`core/markdown-preview.ts` の強調・Mermaid・リンクの decode、強調失敗の印 `gdp-highlight-failed`。

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
- サーバが居るかの確認は `probeServer`。「繋がらない」(`unreachable`) と「繋がったが
  失敗」(`failed`) を分けて返し、どちらも理由を `error` (と `cause`) に持つ。真偽値に
  潰さない。呼び出し側は既存の 1 行目の文言と exit code を保ったまま、次の行に理由を出す

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
