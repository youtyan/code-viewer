# orientation — このリポジトリの地図

読むタイミング: このリポジトリで何かを探すとき / ビルドと dev サーバの挙動を前提にした
発言をする直前 / 新しいコードをどこに置くか決めるとき。

## 何のアプリか

ローカルで起動するブラウザ版のコード / git diff ビューア。npm パッケージ
`@youtyan/code-viewer` として配布する CLI 兼サーバ。Node + pnpm + esbuild + tsx + Vitest。
フロントエンドはフレームワーク無しの素の TypeScript + CSS。

## ディレクトリ — `web/` の二重性が最大の罠

| パス | 正体 |
|---|---|
| `web-src/` | TypeScript ソース。全部ここ |
| `web/index.html` | **手書きソース。** アプリのシェル DOM |
| `web/style.css` | **手書きソース。** 全画面ぶんの CSS がここ 1 枚（1 万行を超える） |
| `web/favicon.png`, `web/vendor/*/styles/` | **手書き / 取り込み済み資産** |
| `web/app.js` `web/mermaid.js` `web/shiki.js` `web/yaml.js` `web/xterm.js` `web/vendor/highlight.js/highlight.min.js` | **ビルド成果物。** `.gitignore` 済み |
| `dist/code-viewer.js` | **ビルド成果物。** CLI 兼サーバ。`.gitignore` 済み |

`web/` にソースと成果物が同居している。**`web/style.css` を「生成物だから直接編集しない」と
判断するのは誤り**で、これを直接編集する以外に CSS を変える方法は無い。

付随する事実: `biome.jsonc` の `files.includes` が `web/` を除外している。つまり
**`style.css` は formatter にも linter にも管理されていない**。整形は人手であり、
空白位置は本質的に不安定。CSS の生文字列に依存するテストを書いてはいけない理由の 1 つ
（→ `testing.md`）。

## モジュール地図

| ディレクトリ | 役割 | 注意 |
|---|---|---|
| `web-src/app.ts` | アプリのシェル。ルーティング、グローバル状態、パネル開閉、ページクラス切替 | 数千行規模の単一ファイル。分割済みの view を束ねる側 |
| `web-src/core/` | クライアント / サーバ双方から使える純ロジック。DOM にもファイルシステムにも触らない | **dev サーバの watch 対象**（後述） |
| `web-src/views/` | DOM を組み立てる側。画面ごと・パネルごと | |
| `web-src/server/` | HTTP サーバ + CLI。`preview.ts` が本体、`cli.ts` が入口 | |
| `web-src/test/` | Vitest。`_` 始まりは共有ヘルパでテスト本体ではない | |
| `scripts/` | ビルド・検査スクリプト（`.mjs`） | |
| `skills/code-viewer-*/` | **npm で配布する利用者向けスキル。**`package.json` の `files` に入る | |
| `.agents/skills/my-*/` | **開発者向けスキル。配布しない** | このファイルもここ |

`skills/` と `.agents/skills/` を混同しない。`my-` prefix が付いていれば開発者向け・非配布。

## バンドル地図

定義は `scripts/bundles.mjs` の 1 箇所に集約されている（ビルドと二重ビルド検査が同じ定義を
参照するため）。ここを通さずに esbuild を直接呼ばない。

| バンドル | 読み込み | 中身 |
|---|---|---|
| `web/app.js` | 即時 | `web-src/app.ts` から辿れる全て（views / core） |
| `web/shiki.js` `web/mermaid.js` `web/yaml.js` `web/xterm.js` `web/vendor/.../highlight.min.js` | **遅延** | 対応する `web-src/*-entry.ts` |
| `dist/code-viewer.js` | — | `web-src/server/cli.ts`。ネイティブ / 任意依存は `external` で実行時解決 |

遅延バンドルの型は `web-src/core/*-loader.ts` に**手書きで、使う分だけ**書いてある
（`createBundleLoader` を共有）。バンドル境界がそのまま型境界になる設計なので、
遅延バンドル側のライブラリ型を view から直接 import しない。

## コマンド

| コマンド | 何を保証するか |
|---|---|
| `pnpm run dev` | 開発用。watch 範囲は下記。**遅延バンドルは焼き直さない** |
| `pnpm run build` | web バンドル + third-party notices + サーババンドル |
| `pnpm run verify` | 受け入れ条件。typecheck / lint / format / build / **二重ビルド一致** / test / 各バンドルの `node --check` / CLI 起動スモーク |
| `pnpm test` | Vitest のみ |
| `npm pack --dry-run` | 配布物の中身確認 |

整形・lint の自動修正（`biome check --write` など）は、**自分が変えたファイルだけを指定して**掛ける。
`web-src` のような広い範囲に掛けると、無関係なファイルの import の並びまで書き換わる（実際に 2 回起きた）。

`pnpm run verify` の `check:bundle` は同じ入力から 2 回焼いてバイト一致を見る。
非決定的な出力を持つ依存やプラグインはここで落ちる。

## dev サーバが実際に見ているもの（推測しないための一次情報）

`web-src/server/dev.ts` の実装から確定する事実。

| 編集したもの | 実際に起きること |
|---|---|
| `web-src/server/**` | **サーバ再起動**（500ms 間隔の mtime ポーリング）。`pnpm dev` は `cli.ts` を起こすので入口のサーバになり、再起動のたびに裏（開いているプロジェクトのプロセス）も起き直す |
| `web-src/core/**` | **サーバ再起動**（core も watch 対象に含まれる） |
| `web-src/views/**`, `web-src/app.ts` | `web/app.js` を esbuild watch が焼き直すだけ。**サーバは再起動しない** |
| `web-src/*-entry.ts`（遅延バンドル入口） | **dev では何も起きない。** `pnpm run build:web` が要る |
| `web/style.css`, `web/index.html` | `CODE_VIEWER_DEV=1` のとき SSE の `reload` のみ |

再起動したときはコンソールに `server source changed; restarting preview server` が出る。
**出ていないなら再起動していない。**

## 下パネル（Tools / Search）の 2 モード

画面下のパネルの中身は **Tools と Search だけ**。ターミナルはメインの面のタブにあり、
下パネルには置かない。開閉の保存キー `APP_SETTINGS.terminalPanelOpen` は、以前ターミナルを
置いていた頃の名前を互換のために残したもので、いまは下パネル全体の開閉を表す。

下パネルには**仕組みが根本的に違う 2 モード**がある。どちらの話をしているかを
決めずにレイアウトを触ると必ず壊れる。切り替えは `[data-panel-layout]` のボタン、
保存先は `APP_SETTINGS.appPanelDocked`、body の `app-panel-docked` クラスで表現される。

| | **docked（画面内）** | **overlay（重ねる）** |
|---|---|---|
| body クラス | `app-panel-docked` あり | なし |
| 考え方 | 本文とパネルで**画面を分け合う** | パネルが本文の**上に浮く** |
| `--app-panel-visible-height` | パネルの実高さ（タブ列のみなら `--app-panel-tabbar-height`） | **`0px`（固定）** |
| `--content-h` | パネル分が引かれる | **引かれない**（画面いっぱい） |
| `#content` | `height: var(--content-h)` + `overflow: auto` の**スクロール容器** | 通常フロー。ページ側がスクロールする |
| `#content` の `padding-bottom` | 使わない | **タブ列ぶん（36px）固定。パネル高さに追従させない** |
| 本文の扱い | パネルと**場所を分け合う**ので短くなる | **パネルを閉じているときと完全に同じ。パネルが上に乗るだけ** |

### 判定基準

> **重ねる: パネルを開いても・引き伸ばしても・閉じても、本文の表示が 1px も変わらない。**
> 高さだけでなく余白・位置・スクロール量も含む。

パネルが本文の一部を覆うのは仕様。覆われた部分は、パネルを縮める／閉じるか、その箱の中を
スクロールして見る。覆われていることを理由に本文側を動かさない。

## 既にあるもの（再利用の地図）

「これは既にあるか？」を毎回全文検索しないための一覧。一般的な再利用スキャンの規律は
global の `my-reuse-first` に従う。ここに置くのは**このリポジトリで既に共有化されているもの**だけ。

| やりたいこと | 既にあるもの |
|---|---|
| ドラッグでサイズを変えるハンドル | `core/drag-resizer.ts` `attachDragResizer`（5 箇所が共有） |
| 変えたサイズを覚える | `core/stored-size.ts` `readStoredSize` / `writeStoredSize`（保存領域の失敗は結果の型で返る。既定値を使うときは `reportStoredSizeFailure` で操作ごとに 1 回 console.error） |
| アイコン SVG | `core/icons.ts` の path 定数 + `iconSvg()` |
| 確認・入力ダイアログ | `views/ui-dialog.ts` `showConfirmDialog` / `showAlertDialog` / `showPromptDialog` / `showFormDialog` |
| 遅延バンドルの読み込み | `core/lazy-bundle.ts` `createBundleLoader` + `core/*-loader.ts` |
| クライアント / サーバ共通の型 | `core/types.ts` |
| キーボード操作・フォーカス制御 | `core/keymap.ts` / `core/focus-scope.ts` / `core/keyboard.ts`（xterm とダイアログの中では画面のキーを実行しない判定は `isPageKeymapBlockedTarget`） |
| スクロール連鎖の抑止 | `core/scroll-chaining.ts` `blockScrollChaining` |
| あいまい検索 | `core/fuzzy-search.ts` |
| 制御文字の検出 | `core/control-chars.ts` `hasControlCharacter` |
| ファイルのパスを画面に出す・コピーする | `core/file-path-copy.ts` の `filePathDisplayText`（制御文字・書式文字を含むパスだけ可視化した表記。表示とコピーは同じものを使う）と `filePathClipboardText` / `fileReferenceClipboardText` |
| コピーの失敗をボタンに出す | `core/copy-failure.ts` `showCopyFailure`（failed の見た目・title に理由・console.error） |
| エラーを画面の文字にする | `core/error-detail.ts` の `formatErrorDetail`（cause の連鎖ごと）・`errorWithCause`・`responseErrorMessage`（操作・HTTP status・本文） |
| tmux コマンド実行 | `server/tmux/command.ts` `runTmux` / `tmuxArgs` / `TMUX_FIELD_SEP` |
| JSON をファイルに永続化 | `server/json-store.ts` `createJsonFileStore` |
| CLI からサーバを叩く | `server/cli-helpers.ts` `requestJson` |
| リクエスト元の検証 | `server/request-origin.ts` |
| ユーザー単位（全リポジトリ・全サーバ共通）のファイルの置き場所 | `server/user-state-dir.ts` `codeViewerStateDir`（テストでは `CODE_VIEWER_TEST_STATE_DIR` で逃げる） |
| 複数のサーバが同じファイルを読み書きするときの排他 | `server/file-lock.ts` `withFileLock` |
| ユーザー単位の登録簿（JSON 1 ファイル）の読み方 | `server/registry-file.ts` `readRegistryFile` / `cachedRegistryReader` |
| 利用者の設定ファイル（エージェントの settings.json など）を安全に書き換える | `server/terminal/settings-file.ts`（約束は `agents.md` の 4） |
| 動いている全部の code-viewer サーバへ送る | `server/server-registry.ts` `listServerRegistry` + `server/terminal/hook-report.ts` `postToServer` |
| 別のリポジトリのサーバを起こす・見つける・止める | `server/worktree/open.ts` `openWorktreeServer` / `runningServerResult` / `stopWorktreeServer`（`backendOf` で入口の裏として起こす） |
| 入口のサーバの取り次ぎ・裏の管理・鍵の解決・`entry.json` | `server/entry/proxy.ts` / `backends.ts` / `projects.ts` / `entry-file.ts` |
| 画面の URL の前置き (`/p/<鍵>`) を付ける・外す | `core/api-url.ts` の `apiUrl` / `pageUrl` / `routePathname` / `withoutProjectPrefix`。`location.pathname` を経路として読むなら `routePathname()` |
| 画面のファイルを配る | `server/static-files.ts` `staticFile` |
| テストの共有ヘルパ | `web-src/test/_test-helpers.ts` / `_fake-dom.ts` / `_git-fixture.ts` / `_io-fixture.ts` / `_dialog-helpers.ts` |

`alert` / `confirm` / `prompt` は `biome.jsonc` が error で落とすので書けない。
`views/ui-dialog.ts` を使う。

## 新しいコードをどこに置くか

- DOM に触らず、ブラウザ API にもファイルシステムにも依存しない純ロジック → `core/`
  （テストが書きやすく、サーバからも使える。ただし**`core/` を触ると dev サーバが再起動する**）
- DOM を組み立てる → `views/<画面>/`
- HTTP / プロセス / ファイル → `server/<領域>/`
- 1 ファイルで完結し他から使われないなら、無理に切り出さない
