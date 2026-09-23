# ui-layout — サイズと位置

読むタイミング: 高さ・幅・位置・固定物・スクロール領域を変えるとき。見切れ・はみ出しを
直すとき。パネルやページを足す / 消すとき。**見た目だけ（色・文字・アイコン）なら
`ui-surface.md`。**

## 何を防ぐか

画面の下に固定のパネルを 1 つ足したら、画面いっぱいに広がる要素が軒並み見切れた。
原因は各所が個別に `calc(100vh - var(--global-header-h) - 96px)` のように引き算していたこと。
**固定物が増えるたびに全箇所を直す必要があり、直し漏れたところだけが画面外へはみ出す。**

このファイルの目的は「気をつける」ことではなく、**固定物が増減しても消費側を 1 行も
触らずに済む構造**を保つこと。

## 長さの 4 層モデル

このアプリの全ての長さは、次の 4 層のどれか 1 つに属する。参照は
**T0 → T1 → T2 → T3 → 消費側** の一方通行。

| 層 | 何か | 例 | 生の px |
|---|---|---|---|
| **T0** スケールトークン | 文字とコントロールの寸法。密度モードごとに定義。余白・角丸の段階 (`--space-*` `--radius-*`) もここ。一覧の行の高さ `--ui-row-h` だけは出所が TS (`views/shell/row-height.ts`。仮想表示が位置の計算に使うため) で、CSS は初回描画用の既定。表の行の高さ `--ui-table-row-h` は仮想表示に使わないので CSS だけ (`ui-surface.md` の決まり 7) | `--ui-font-*` `--ui-control-*` `--ui-dense-row-h` `--ui-row-h` `--ui-table-row-h` `--code-line-height` | **可**（ここだけ） |
| **T1** chrome 実寸 | 「この固定物が何 px 占有しているか」 | `--main-tabs-h` (最上段のタブ列) `--global-header-h` (上に居座る固定物の合計。今はタブ列だけなので `= --main-tabs-h`。body で決める) `--tabs-lead-w` (タブ列の左端のプロジェクト名 `#tabs-lead` の固定の幅。body で決める) `--topbar-h` `--nav-w` (左のサイドバー) `--statusbar-h` (最下段) `--sidebar-w` `--history-w` (一覧の列の利用者の幅) `--list-w` (一覧の列のいまの幅。TS が書く) `--listcol-shown` (一覧の列が占める幅。出していなければ 0) `--annotation-panel-w` | **可**（その固定物の実寸なので） |
| **T2** 導出エンベロープ | T1 の純粋な `calc()`。本文が使える領域 | `--chrome-h` `--content-h` `--chrome-left` `--chrome-bottom` `--main-bottom` (メインの面の箱の下端。最下段の上) `--main-pane-h` (面の箱の高さ) `--panel-body-top` (右の列の本体の上端) `--page-left` `--page-right` (本文の左右の端。下の「左右 2 面」) | **不可。T2 の式に px リテラルを書かない** |
| **T3** ローカルインセット | 「このエンベロープの内側に居座る家具の高さ」 | `--file-detail-head-h` | **可。ただし必ず命名し、ページスコープに宣言し、何の高さかコメントする** |

### 消費側の規則

- **chrome と場所を分け合う要素**（本文・サイドバー・パネル・sticky なもの）は、
  画面高さを **T2 経由でしか参照しない**
- **viewport 単位（`100vh` / `100dvh`）と chrome 変数（`--chrome-h` / `--global-header-h` /
  `--topbar-h`）を同じ `calc()` に書いてよいのは、T2 の定義行だけ。**
  消費側の宣言（`height:` `min-height:` `max-height:` `top:` `padding:` …）に
  この 2 つが並んでいたら、それは T2 を経由していない引き算
- **T2 は `--content-h` だけではない。** 本文と場所を分け合わないもの（画面下に固定した
  パネルなど）は `--content-h` を使うと自分を自分から引く循環になるので、**別の T2 を
  定義する**（例: そのパネルの最大の高さ `--<surface>-max-h`）。T2 を増やすこと自体は違反ではない。
  違反は「消費側が直接引き算すること」
- **T2 の定義は 1 行に書く。** 下の検出コマンドが行単位なので、`calc(` の後で改行すると
  式の行が定義行に見えず、正しいコードが違反として並ぶ
- 内側の家具を引くときは `calc(var(--content-h) - var(--<名前>))`。**無名の px を引かない**
- `min()` / `max()` の**独立した上限・下限**としての px は自由
  （`min(620px, calc(var(--content-h) - var(--x)))` の `620px` は可。`--x` を `140px` と
  直書きするのは不可）

**例外: chrome の上に浮く overlay。** `position: fixed` で画面中央に置くダイアログ・
ライトボックス・ポップオーバーは、chrome と場所を分け合わないので `calc(100vw - 32px)` の
ような viewport 基準でよい。これらを T2 に置き換えないこと（固定物が増えた分だけ
モーダルが縮む、という誤った挙動になる）。

現状の違反は次で列挙できる。**数を覚えず、その都度数える。**
overlay を誤検出しないよう chrome 変数との同居だけを見て、最後の `grep -vE` で
T2 の定義行（`--x: calc(...)`）を除外している。

```sh
grep -n "100vh\|100dvh" web/style.css \
  | grep -- "--chrome-h\|--global-header-h\|--topbar-h" \
  | grep -vE ':[[:space:]]*--[a-z-]+:'
```

**ゼロが正しい状態。** 除外を `--content-h:` の決め打ちにしないこと。T2 が増えたときに
正しいコードが違反として並び、逆に本物の違反が埋もれる。

## 骨格 — 左・右・下の固定物

画面は次の固定物で囲まれている: 左のサイドバー (`#app-nav`、幅 `--nav-w`)、最上段のタブ列
(`#main-tabs`、`--main-tabs-h`。**上の行は無い**: `web/index.html` のコメントと da82d59。右端は右の
列の左。**左端はプロジェクト名とブランチ (= プロジェクトの切替 `#project-switcher`) の固定の枠
`#tabs-lead`、幅 `--tabs-lead-w`**。画面・タブ・2 面・右の列の開閉・一覧の列の出入りのどれでも
出したり消したり動かしたりしない (動くと押す場所がずれる。利用者の指示)。左のサイドバーを畳んだときだけ
出る「サイドバーを出す」(`#nav-expand`) は名前の枠 (`.tabs-lead-name`) の外の左に置き、枠の幅と枠の中の名前の
位置を変えない (`web-src/test/tabs-lead-order.test.ts`)。タブはその右から。2 面でも
左の面のタブ列の左端)、画面の右端の右の列 (上端から。頭 `#panel-head` は 1 段 = タブ列の行に画面の
入口の絵柄と、右端に畳むボタン。位置は fixed だが DOM では本文 `#content` の後に置き、Tab の順を
「左のサイドバー → タブ列 → 一覧 → 木 → 本文 → 右の列の頭 → 最下段」にする。頭の幅 `--panelcol-head-w`、本体の幅 `--panelcol-shown`。本体は `--panel-body-top` (= 頭の下) から。**探して開くための木** = Files の木 `#sidebar` はここ)、**本文を選ぶための一覧**
を置く一覧の列 (左のサイドバーの右、タブ列の下。幅 `--listcol-shown`。下の「一覧の列と右の列」)、
画面ごとのツールバー (`#topbar`、`--topbar-h`)、最下段のバー (`#statusbar`、`--statusbar-h`)。画面下の
パネルは無い (Tools と Search はタブ。`orientation.md`)。**右の列を畳む (`body.gdp-sidebar-hidden`) =
本体 (木) だけを畳む**: `--panelcol-shown` が 0 になり、本文は頭の行の下から窓の右端まで使う。頭の行
(`#panel-head`: 画面の入口の絵柄 `.view-strip` と畳むボタン `#sidebar-toggle`) は同じ幅
`--panelcol-head-w` で残り、タブ列の右端・分割のボタン・絵柄は動かない (縦の帯は無い。畳むボタンは
頭の行の右端に 1 つ。`views/sidebar.ts` の `placeSidebarToggle`、`web-src/test/panel-head-kept.test.ts`)。
自動で畳むのは、一覧の画面の間と 2 面の間 (下の「一覧の列と右の列」)。

### 一覧の列と右の列

- **本文を選ぶための一覧は本文の左の一覧の列、探して開くための木は右の列。** 一覧の画面 =
  Diff (変更ファイル。`#sidebar` を一覧の列へ移す)・History (`#history-panel`)・選んでいる
  作業ツリー (`#worktree-panel`)。`app.ts` の `syncListColumn` が `body[data-list-column]` に
  出す一覧 (`sidebar` / `history` / `worktree`) を書き、CSS はこの属性だけで置き場所を決める
  (ページクラスを並べない)。作業ツリーの一覧だけの画面 (`data-worktree-overview`) は一覧が
  本文なので一覧の列を出さず、右の列は Files の木のまま
- **一覧の画面の間、右の列の本体は自動で畳む** (`core/panel-column-policy.ts`。開いても出す木が
  無い。頭の行は残る)。一覧の画面を出たら、一覧のために畳んでいたものは開き、2 面なら開いた幅で
  2 面の決まりをもう一度当てる。一覧の画面では畳むボタン (`#sidebar-toggle`) は一覧の列を隠す / 出す
  (`toggleListColumn`。このセッションだけ。`body[data-list-column-hidden]`)
- **本文の幅は右の列の本体の幅で数える** (`core/panel-column-policy.ts` の `panelColumnBodyWidth`。
  畳めば 0。頭の行の幅は数えない)。2 面の面の幅 (`main-tabs-view.ts` の `mainWidth`。依存の
  `panelColumnWidth`) と一覧の列の決まり (`syncListColumn` の `room`) の両方がこれを使う。タブ列の
  右端は右の列の頭の左で畳んでも動かないので、タブ列の幅から本文の幅を出さない
- **一覧の列 = 一覧 + (History・選んでいる作業ツリーなら) 変更ファイルの木。どちらも面の外**
  (`--listcol-shown = --list-shown + --list-tree-w`。`--page-left` はその右。2 面でも本文全体の左)。
  木 (`#sidebar`) の幅は `--sidebar-w` (掴み `#sidebar-resizer` は木の右端)
- **足りないときの順番** (`core/list-column.ts` の `listColumnLayout`): 本文 (1 面は
  `COMFORTABLE_PANE_WIDTH`、2 面はその 2 つ分 + 仕切り) に足りなければ、(1) 一覧を詰めた幅
  (`HISTORY_WIDTH.min` = 240。History は件名と札だけ) にし、(2) 木を帯 (`--panelcol-rail-w`) に
  畳み (`body[data-list-tree-folded]`。帯は開くボタン `.list-tree-open`。押したらこのセッションは
  畳まない)、(3) それでも 2 面の下限 (`TIGHT_PANE_WIDTH` × 2 + 仕切り) に足りなければ右の面を
  預ける (`main-tabs-view.ts` の `fitToWidth`。本文の幅 `mainWidth` は一覧の列を引く)。左の
  サイドバーは畳まない (プロジェクトとエージェントは常に見える)。一覧の利用者の幅は
  `HISTORY_WIDTH` (既定 320、掴み `#history-resizer`、設定の `historyWidth`。読み戻しは
  `restoredListWidth`: 範囲の外は既定に戻す)。既定の密度・左のサイドバー 280 での境目 (一覧の
  画面では右の列の本体は 0): 1 面の History は窓 1320 未満で詰め 1240 未満で木を畳む、2 面の
  History は 1801 未満で詰め 1721 未満で木を畳み 1189 未満で預ける。Diff (木なし) は 1 面 1080・
  2 面 1561 未満で詰め、2 面 1161 未満で預ける
- 一覧の列の幅が変わる (窓・左のサイドバー・右の列・変更ファイルの木・掴み) と `syncListColumn` が
  幅を決め直し、変われば `MAIN_TABS.refit()` で面の幅を合わせ直す (CSS 変数の変化は
  ResizeObserver に届かない)。木の幅は TS が書かず CSS が `--sidebar-w` から作る (木の掴みで
  変えた幅を `#sidebar` の ResizeObserver で拾うため)。TS が付けるのは畳む印だけ

- **本文 (`#content`) は自分の箱の中でスクロールする。窓 (`html` / `body`) は
  スクロールしない** (`html, body` の `overflow: hidden`)。`#content` は
  `position: fixed` で `top: --chrome-h` / `left: --page-left` /
  `right: --page-right` / `bottom: --chrome-bottom`、`overflow: auto`。
  こうしないと縦のスクロールバーが右の列のさらに右 (窓の右端) に出て、本文と
  右の列が左へ寄る。付いて回る決まり:
  - 箱の中の sticky な見出し (`.d2h-file-header`・`.gdp-shell-header`・
    `.gdp-file-detail-sticky` など) の `top` は**箱の上端が基準**。chrome の変数を
    読まない。箱の上の余白 (`--content-top-gap`) の分だけ上へ出す
    (`top: calc(0px - var(--content-top-gap, 0px))`)。出さないと、見出しの上の
    隙間に次の行がのぞく
  - スクロール位置を読む / 書く TS は `window.scrollY` / `window.scrollTo` では
    なく、`core/focus-scope.ts` の `mainScrollBox()` (と、中に自分の scroller が
    あるときは `findMainScrollTarget()`) を使う
  - `#content` は `position: fixed` なので **`offsetParent` は常に null**。
    「画面に出ているか」は `getClientRects().length > 0` で見る (これで j / k と
    PageDown が動かなくなった)
  - 戻る / 進むのスクロール位置はブラウザが戻さない (窓が動かないため)。履歴の
    項ごとの鍵で覚えて戻す (`core/scroll-memory.ts` と `app.ts` の
    `restoreMainScroll`)
- **2 面にした本文が、面 2 つ分のゆとり (`COMFORTABLE_PANE_WIDTH` × 2 + 仕切り)
  に足りないときは、2 面の間だけ右の列の本体を自動で畳む** (頭の行は残る。`app.ts` の
  `syncPanelColumn`)。2 面を解いたら戻す。利用者が 2 面の間に自分で
  開いたら、そのセッションでは自動で畳まない (保存しない)。面の幅の下限は、
  自分で開いている間だけ `TIGHT_PANE_WIDTH` まで下げ、両面を同じ比で縮める。一覧の画面 (Diff・
  History・選んでいる作業ツリー) では右の列の本体はもう畳んであり、先に一覧の列を詰め、それでも本文が 2 面の
  下限に足りなければ右の面を預ける (理由は分割のボタンの説明。上の「一覧の列と右の列」)。
  決まりは `core/panel-column-policy.ts`
- **面の中で入力と操作を横 1 行に並べる画面は、窓の幅ではなく面の実幅で縦に積む**
  (`@container`。2 面の左の面は窓の半分以下になるので `@media` では決まらない)。
  実例: Data の `.db-root` の `container: db-pane` と `@container db-pane (max-width: 560px)`、
  Tools の `.tools-body` の `container: tools-pane` と `@container tools-pane (max-width: 560px)`
- **上に居座る固定物の高さは `--global-header-h` だけを読む。** 今はタブ列だけなので
  `--global-header-h: var(--main-tabs-h)` (`style.css` の `html, body`)。ツールバーの `top`・各ページの
  `--chrome-h` の上書き・sticky の `top`・面の箱の `top` はこれを読むので、上に固定物を足す / 消す
  ときはこの式に項を足すだけ。左のサイドバーの頭 (`.nav-head`) はタブ列と高さをそろえるため
  `--main-tabs-h` を読む
- **本文まわりの固定物 (ツールバー・読み込みの帯・ファイルの木・履歴や作業ツリーの面・注釈の面・
  `body` の左右の余白) の左右の端は `--page-left` / `--page-right` だけを読む。**
  `--page-left = --chrome-left + --listcol-shown` (一覧の列の右から。一覧の列は面の外で、2 面でも
  本文全体の左に 1 本)、`--page-right = --panelcol-shown` (右の列の本体の左まで。畳めば窓の右端)。メインの面を左右
  2 面に分けたとき (`body.main-split`)、本文 (route の中身) は左の面にだけ描くので `--page-right` に
  右の面と境界の幅を足す。面の幅 `--split-left-w` / `--split-right-w` / `--split-divider-w` と本文の幅 `--main-w` は TS
  (`views/main-tabs/main-tabs-view.ts` の `applyGeometry`) が出所
- **メインの面の箱 (`.main-pane-host`。`app.ts` の `PANE_HOSTS`) は `top: --global-header-h`・
  `left: --page-left`・`right: --panelcol-shown`・`bottom: --main-bottom`。** 右の列 (木) を覆わない。2 面では左の箱は
  `--split-left-w` の幅、右の箱は残り。右の面のソース表示 (`.main-pane-source`) は本文の
  `--content-h` ではなく `--main-pane-h` で箱を作る。タブ列は面をまたぐので左は `--chrome-left`、
  右は `--panelcol-head-w` (右の列の頭の左。右の列を畳んでも動かない。一覧の列の上もまたぐ。2 面の
  左の面のタブ列は `--split-left-w` + `--listcol-shown`、右の面のタブ列はその残りで、右の列を
  畳んだ間は右の面の本文より頭の行の幅だけ短い)。最下段は右の列の下もまたぐ
- `--main-tabs-h` と `--global-header-h` は `html, body` で決める (密度の `--space-unit` の上書きが
  body に載るため。下の「T2 を宣言する要素を間違えない」と同じ理由)

- **左端に付く固定物は `left: var(--chrome-left)`、下端に付く固定物は
  `bottom: var(--chrome-bottom)` だけを読む。** `--nav-w` や `--statusbar-h` を直接読まない。
  左や下に固定物を足す / 消すときは、`html, body` ブロックの `--chrome-left` /
  `--chrome-bottom` の式に項を足すだけ（下の「型」の横と下の版）
- 本文の箱は自分で `--page-left` / `--page-right` / `--chrome-bottom` を読む
  (`body` の padding では位置を決めない)。`#content` の `margin-left` は今までどおり
  `--sidebar-w` だけを見る (History・作業ツリーの 2 列目)
- `--content-h` は `--chrome-bottom` も引く（最下段は本文と場所を分け合う）
- 左のサイドバーを畳む = `html[data-nav-collapsed]` が `body` で `--nav-w: 0px` にする。
  html の属性なのは、`index.html` の head のスクリプトが body より先に付けて、移った直後に
  骨格が一瞬崩れないようにするため（控えは `views/shell/early-look.ts`）
- 画面座標で線を引く JS (リサイズのプレビュー線) は、固定物の左端を
  `getBoundingClientRect().left` で読む。`0` 起点の座標を書かない
- 骨格の幅・高さ (`--nav-w` など) の既定・下限・上限は `core/panel-sizes.ts`
  だけが持つ（画面とサーバの設定の検査が同じ値を使う）。保存先はサーバの設定: 左のサイドバーの
  幅と畳みは全プロジェクト共通の設定 (`core/user-settings.ts` の `USER_SETTING_KEYS`)、ファイルの木と
  一覧の列の幅 (`historyWidth`) はリポジトリの設定 (`server/state-store.ts` が検査する)。**localStorage に
  置かない**: localStorage はオリジン (ポート) ごとで、ポートは続かない。入口のサーバは `--port` を
  付けなければ起動のたびに OS が選ぶポートで待ち受ける (`server/entry/args.ts` の
  `parseEntryArgs` の既定が 0) ので、code-viewer を起こし直すと空から始まる。`--standalone` の
  サーバもそれぞれ別のポート。入口の下でプロジェクトを移る (`/p/<鍵>/`) だけならオリジンは同じ。
  localStorage に置いてよいのは、消えても設定から当て直せる初回描画の控え
  (`views/shell/early-look.ts`) と、ブラウザの都合の寸法 (`core/stored-size.ts`) だけ

## 固定であるべき部品の一覧

押す場所・読む場所として目が覚えている部品。**下の「動いてよいとき」以外の状態の変化
(画面・タブの切替、仮→固定、読み込み中→後、通知の案内、言語の切替、木の開閉、エージェントや
接続の状態) で、位置も大きさも変えない。**

| 部品 | 動いてよいとき |
|---|---|
| タブ列の左端のプロジェクト名と枝 (`#tabs-lead`) | 動かない (上の「骨格」) |
| タブ列 (`#main-tabs`) | 動かない (右端は右の列の頭の左で、右の列の開閉でも動かない)。タブは左から詰める |
| 「＋」(`.main-tabs-new`) | タブの数が変わったとき (最後のタブのすぐ右。`ui-surface.md` のタブの決まり) |
| 分割のボタン (`.main-tabs-split`) | 2 面のときだけ (面ごとに右端に付く)。右の列の開閉では動かない |
| 左のサイドバーの頭・検索・足元 (`.nav-head`・`#search-btn`・`.nav-foot`) | 左のサイドバーの幅を変えたときだけ |
| 右の列の頭 (`#panel-head`)・画面の入口の絵柄 (`.view-strip`)・畳むボタン (`#sidebar-toggle`) | 動かない (右の列を畳んでも頭の行は同じ幅で残る。`web-src/test/panel-head-kept.test.ts`) |
| 最下段 (`#statusbar`) と、その右寄せの部品 (`#status`・右の操作 `.statusbar-actions`・`#doctor-btn`) | 窓の幅が変わったときだけ |
| 最下段のエージェントの件数 (`#agent-status`) | 右端は動かない。左端は件数の桁が増えたときだけ (数字は等幅) |
| 一覧の列の頭 (`#sidebar .sb-head`・`#history-panel .history-head`・`#worktree-panel .history-head`)・本文の上の帯 (`#topbar`)・本文の箱 (`#content`) | 画面の並びが変わるとき (一覧の列の出入り・一覧の列の幅・2 面・上の帯を持たない画面との行き来)。同じ画面の中の状態では動かない |

部品を足したらこの表に行を足し、状態で動かないことを `web-src/test/fixed-parts-layout.test.ts`
の表に足す。

## 切替で CLS 0 を保つ

**測り方。** 実画面で `PerformanceObserver` の `layout-shift` を取り、`hadRecentInput` の無いものの
和 (= CLS。入力から 0.5 秒を過ぎてから動いたもの) と全部の和を、固定の部品の
`getBoundingClientRect()` の前後と並べる。背面のタブ (と、他の窓に覆われた窓) は描画が
止まり、ずれが記録されないので、測るたびに `document.hidden` が false であることも記録する。
ブラウザを操作する道具が差し込む要素は数えない。入力の直後の動きも CLS には入らないだけで、
固定の部品が動いていれば直す対象。**次の操作は、前の操作のずれが止まり読み込み中のものが
無くなってから始める。** 時間で区切ると、前の操作の読み込みの続きが次の操作のずれに数えられる
(Diff の読み込みの完了が「一覧の列を隠す」のずれに見えていた)。

**よくある原因と直し方 (上の表の部品で起きたもの)。**

1. **状態で文言が変わる部品は、文言を全部同じ升に重ね、今の 1 つだけ見せる。** 幅は一番長い
   文言で決まる。文言を差し替えるだけだと、隣の部品が文言の長さの差だけ揺れる
   (最下段の `#status`。`views/status-label.ts` の `renderStatusLabel` と style.css の
   `#status .status-label`。Live と Loading の差で右の操作が 21px ずつ揺れていた)
2. **JS が後から差し込む絵の箱は、CSS で最初から絵と同じ大きさを取る。** 箱が空の 0 幅で
   描かれ、絵が入ったときに隣の文字が押される (左のサイドバーの検索の文字が 14px 動いていた)
3. **後から出たり消えたりする印 (件数・点) は、ボタンの流れの外に置く** (`position: absolute` で
   角に重ねる。`#annotations-count`・診断の `.doctor-badge`)。流れの中に置くと、印が出たときに
   ボタンが太り、並びの残りが動く。印の規則で `display` を指定したら、`[hidden]` で `display: none`
   も書く (書かないと `hidden` が効かず、診断の点が問題の無いときも出ていた)
4. **後から中身が入る行は、最初から中身 1 つ分の高さを取る** (`min-height`)。空の行が低いと、
   最初の中身が入ったときに下の本文が押し下げられる (Data のタブの列 `.db-root .db-tabs-list`。
   チップが後から入り、本文が 8px 下がっていた)
5. **読み込む前と後で並びが変わる部品は、読み込む前から後と同じ関数で組む。** 読み込み前だけ
   別の組み立てにすると、後から足した部品の分だけ並びが動く (ファイルの見出しの右の切替は、
   読み込み後に行へ移る欄とコピーが足されて左へ 250px 伸びていた。今は `views/source-view.ts`
   の `renderStandaloneSource` が読み込み前から `createSourceTabs` で組み、コピーは押せない形、
   行数は `totalPending` の仮の文字)
6. **置き場所の違う 2 つの表示を、1 つの要素の出し分けで作らない。** 真ん中の案内と下端の状態行を
   同じ要素にすると、切り替わるときにその要素が動いてずれになる。別の要素にして、どちらか一方だけ
   見せる (端末の `.terminal-empty-hint` と `.terminal-status`。`views/terminal/terminal-view.ts`
   の `createSlot`。画面が付いたときに 0.30 動いていた)
7. **入力から 0.5 秒を過ぎてから動いたものは、利用者の操作の結果でも CLS に数えられる。**
   操作の結果の並び替えは同じフレームで終わらせ、後から非同期に描き直さない
8. **中身が届くまで取る高さは、サーバが数えた材料と画面の実際の寸法から出す。** 式に px や
   文脈の行数を決め打ちしない (Diff のカードは `core/diff-card-estimate.ts`。サーバは
   `row_basis` を返し、画面は見本の差分をカードと同じ幅で描いて 1 行・見出しの高さを測って
   当て、本文の幅が変わったら待っているカードを測り直す。前は
   `(追加 + 削除 + 10) × 22px` で、差が −200〜+4846px あった)

9. **最初の描画で並びを決める印は、app.js を待たずに URL から付ける。** `web/index.html` の body の
   頭の早いスクリプト (`#first-screen`) が、app.ts が後から付けるのと同じ印 (画面の印
   `core/page-mode.ts` の `pageModeClasses`・一覧の列 `body[data-list-column]` と `--list-w`・木を
   畳む印・一覧の画面で右の列の本体を畳む `gdp-sidebar-hidden`) を付け、CSS は今の規則のまま最初から
   場所を取る。別の印と規則を足さない (2 つの出所はずれる)。同じであることは
   `web-src/test/first-screen.test.ts` が URL・窓の幅・控えの表で確かめる。寸法 (木と一覧の幅・
   利用者の畳み・言語) は `views/shell/early-look.ts` の控え。最下段の `#status` の文言
   (`#first-status`)、Files の木の見出しの絞り込み (`#first-sidebar-filter`)、右の列を畳むボタン
   (index.html に最初から置く) も同じ考え。**app.ts の起動の途中で、早いスクリプトの印を一度
   外してから付け直さない** (外した状態がタスクをまたぐと描かれる。一覧の画面の右の列の畳みは、
   起動の `applySidebarHidden` が一覧のための自動の畳みとして引き継ぐ)。直接開いたときの読み込みの
   CLS は History 0.21/0.37 → 0.0002/0.0006、選んでいる作業ツリー 0.24/0.38 → 0.04/0.02
   (1280 / 1600。残りは本文の中身)
10. **場所取りの詰め物は、要素 (`::before` / `::after` / 空の箱) でなく余白 (`padding` /
   `min-height`) にする。** 要素は描かれて動くのでずれに数えられ、余白は数えられない (Diff の
   本文の末尾の詰め物は `body.gdp-diff-page #diff` の `padding-bottom`。`::after` だった間は、
   直接開いた Diff で 0.49 / 0.41 あった。1600 / 1280)

**既知の残り (最初の描画)。**
- 2 面かどうかは保存したタブを読むまで分からないので、早いスクリプトは 1 面で数える。2 面の一覧の
  画面を直接開くと、一覧の列の幅が詰めた幅へ動くことがある
- 木と一覧の幅はリポジトリの設定、控えはオリジンで 1 つ。入口の下で別のプロジェクトへ移った直後は
  前のプロジェクトの幅で描き始める。表示の密度 (`body[data-sidebar-font-size]`) も控えていない
- 保存したタブが URL と違う画面を前面にする読み込み (`urlKeepsSavedFront`) では、URL から付けた
  印と違う並びになり、そのときだけ動く

**既知の残り (読み込み中→後)。**
- Diff のカードの最後のハンクの後の「下へ広げる」行は、最後の文脈が 3 行ちょうどなら描いた時点で
  置き、見積もりにも入れる (`row_basis.tail_more`。`views/hunk-expand.ts` の `setupHunkExpand`)。
  ファイルがちょうどそこで終わるときだけ、問い合わせの後でこの行を外し、その分 (36px) 下の
  カードが上がる
- 左右に並べる表示で、狭い本文 (1280 など) に長い行があると、カードに横のスクロールバー
  (約 10px) が出て、その分だけ見積もりより高くなる (行の長さは見積もりの材料に無い)
- ファイルの見出しの行数は読み込むまで分からないので、仮の文字 (「– lines」) と実際の行数の桁の
  差だけ切替が動く (2 桁で 7〜8px)。大きいファイル (分けて読む) はコピーを置かないので、
  コピーの幅の分も動く

## 固定物を足す / 消すときの型

**T1 は「既定 0 + 占有時に上書き」の形にする。** 一般化するとこうなる。

```css
:root { --<surface>-visible-h: 0px; }               /* 何も占有していない状態が既定 */
body.<その固定物が出ている状態> { --<surface>-visible-h: <実際の値>; }

--content-h: calc(100vh - var(--chrome-h) - var(--chrome-bottom)
             - var(--<surface>-visible-h));          /* T2 に 1 項足すだけ */
```

横と下の固定物も同じ形で、足す先の T2 が `--chrome-left` / `--chrome-bottom` になる。

- **足すとき:** `:root` に 1 行、状態セレクタに 1 行、T2 の式に 1 項。消費側は 1 箇所も触らない
- **消すとき:** その 3 つを消す。消費側は 1 箇所も触らない

> **判定基準:** 固定物の追加 / 削除で消費側の CSS を触る必要があるなら、その構造は間違っている。
> 触る前に、なぜ触る必要があるのかを説明できるか確かめる。

### T2 を宣言する要素を間違えない（**置き場所が仕様**）

**カスタムプロパティの `var()` は「宣言した要素」で確定し、その後は確定済みの値として
継承される。使う場所で解決し直されはしない。**

したがって T2（`--content-h` `--main-bottom`）を `:root` に置くと、`body` に載る
上書きが**どれも反映されない**:

- ページごとの `--chrome-h`（`body.gdp-*-page`）
- 表示密度ごとの `--space-unit` と、それから作る `--main-tabs-h`・`--global-header-h`（`body[data-sidebar-font-size]`）

**規則: T1 の上書きが `body` に載るなら、その T1 を読む T2 も `body` で宣言する。**
`:root` に置いてよいのは、`var()` を含まないか、上書きされない値だけ。

確認方法（`:root` と `body` で値が違えば、上書きが効いていない）:

```js
getComputedStyle(document.documentElement).getPropertyValue('--content-h')
getComputedStyle(document.body).getPropertyValue('--content-h')
```

## ページごとの chrome は、変数を直す。消費側を直さない

`--chrome-h` は**ページスコープで上書きするためにある**。topbar を隠すページは

```css
body.gdp-<name>-page { --chrome-h: var(--global-header-h); }
```

を書く。消費側（`#load-bar` `#content` `#sidebar` `#annotation-panel` sticky 各種）は
`var(--chrome-h)` / `var(--content-h)` **だけ**を読む。

**禁止:**

```css
/* これを書きたくなったら、そのページの --chrome-h 上書きが漏れている */
body.gdp-<name>-page #load-bar { top: var(--global-header-h); }
```

この形は現在も複数残っており、**そのうち何本かは完全に冗長**（ページが既に `--chrome-h` を
上書きしているので、基底規則がそのまま正しい値を出す）。逆に `--chrome-h` を上書きして
いないページは、消費側を 1 つずつ手当てする羽目になっている。

現状の確認（セレクタと宣言は別行なので、`-A` で後続行まで見る必要がある）:

```sh
# (a) --chrome-h を上書きしているページの一覧（これらは正しい。消さない）
grep -n -- "--chrome-h:" web/style.css

# (b) ページクラス配下で chrome 変数を直接読んでいる手当ての一覧
#     最後の grep -v が無いと (a) の定義行そのものが混ざる。定義行を「冗長な手当て」と
#     見なして消すと --chrome-h が topbar 込みの値に戻り、そのページで個別に手当てされて
#     いない消費側 (#sidebar-resizer など) が topbar 1 本分ずれる。除外は必須。
grep -n -A6 "gdp-[a-z-]*-page" web/style.css \
  | grep -E "var\(--global-header-h\)|var\(--topbar-h\)" \
  | grep -v -- "--chrome-h:"
```

**(a) は直す対象ではない。直す対象は (b) だけ。** 突き合わせ方:

- (b) のうち、**そのページが (a) に載っている**もの → その手当ては冗長。消すだけでよい
  （`--chrome-h` の上書きが既に正しい値を出している）
- (b) のうち、**そのページが (a) に載っていない**もの → 手当てを消し、代わりにそのページへ
  `--chrome-h` の上書きを 1 行足す

`-A6` はセレクタ行と宣言行が別行であるための窓。窓幅を 4〜25 に振っても件数は変わらない
ことを確認済みだが、**出力は「候補」であって確定リストではない。** 1 件ずつ、どの規則に
属する宣言かを見てから触ること。

## 重複した式には名前を付ける

同じ `calc()` 式が 2 箇所以上に現れたら、それは名前の無い T2 か T3。名前を付けて 1 箇所にする。

**意味が違う同じ数値を共通化してはいけない。** 別々に動けることが目的なので、
「本文の下に残す余白」と「sticky な目次の下余白」がたまたま同じ `40px` でも、別の名前にする。

```css
/* 悪い: 同じ式が 3 箇所に逐語コピーされ、どれか 1 つを直すと不整合になる */
max-height: calc(100vh - var(--global-header-h) - 40px);

/* よい: T3 に名前を与え、T2 を 1 つ作って 3 箇所がそれを参照する */
--<surface>-min-content-h: 40px;    /* その固定物の上に必ず残す本文の高さ */
--<surface>-max-h: calc(100vh - var(--global-header-h) - var(--<surface>-min-content-h));
```

## ページクラスの列挙をレイアウト規則に書かない

```css
/* 禁止。ページを 1 枚足すたびに、この種の列挙を複数箇所へ追記することになる。
   追記漏れ = そのページだけ画面外へはみ出す = 冒頭の事故そのもの */
body.<状態>.gdp-diff-page #content,
body.<状態>.gdp-history-page #content,
body.<状態>.gdp-repo-page #content,
... { height: var(--content-h); }
```

**規則:** レイアウト系プロパティ（`top` `bottom` `height` `min-height` `max-height`
`padding-top`）を宣言する規則のセレクタに、`gdp-*-page` を **2 つ以上並べない。**

ページ固有の趣味（背景・余白の好み）をページクラスで書くのは可。**「本文の箱がどう
振る舞うか」は、ページの属性として宣言する。** 属性の設定は `app.ts` のページクラス切替と
同じ 1 箇所で行う（そこに既にページ判定が集約されている）。

> **既存の列挙の解消方法は未決。** 新規のレイアウト規則で列挙を増やすことは禁止だが、
> 既にある列挙をどう畳むかはユーザー判断待ち。既存に合わせて列挙を伸ばさないこと。

## CSS と TypeScript に同じ数値を書かない

リサイズ可能なパネルは、既定値・下限・上限が CSS と TS の両方に散っている。
同じ 3 つ組（既定 / 下限 / 上限）が複数ファイルに逐語コピーされているものがあり、
片方だけ直すと「ドラッグでは 900px まで伸びるのに保存値は 640px で切られる」形で壊れる。

**規則（新規コードに対して firm）:**

- パネルの既定値・クランプ値を、CSS と TS の両方にリテラルで書かない
- 新しくリサイズ可能なものを足すなら、**TS 側を出所にする**。クランプ（min/max）は TS に
  必ず必要で、CSS では素直に表現できないため
  - TS に既定・下限・上限を持ち、`document.documentElement.style.setProperty` で CSS 変数へ書く
  - CSS 側は `var(--x, <既定>)` の **fallback だけ**（JS 実行前の初回描画用）
  - 適用時のクランプと、保存値読み込み時のクランプは**同じ値**を使う

現状の重複を洗うとき。**定数名で探さない**（`MIN_` / `MAX_` の命名規約に従っていない
重複が実際に存在し、名前で探すと 1 件も見つからないまま無関係な定数だけが並ぶ）。
CSS と TS の結合面は **TS が `setProperty` する変数**なので、そこから引く。

```sh
grep -rh -A2 "setProperty(" web-src --include=*.ts | grep -oE '"--[a-z-]+"' | sort -u
```

`-A2` は複数行に折られた `setProperty(` 呼び出しを拾うため。出た変数ごとに、
**CSS 側の定義値・`var(--x, Npx)` の fallback** と、**TS 側の既定値・クランプ**を
突き合わせる。両方にリテラルがあればそれが重複。

> **既存の重複を 1 箇所へ統合する方式は未決**（TS 出所 + CSS fallback / `getComputedStyle`
> で CSS から読む / ビルドで tokens を生成）。既存の重複に**さらに 1 箇所足すことは禁止**。

## JS 側に出るジオメトリ

- 幅・高さの適用は **CSS 変数へ書く**（`documentElement.style.setProperty`）。
  要素の `style.width` / `style.height` を直接触らない
- ドラッグは `core/drag-resizer.ts` の `attachDragResizer` を使う。**新しいドラッグ実装を
  作らない**（既に複数箇所が共有している）
- 永続化は `core/stored-size.ts`。**保存は `onEnd` のみ。** ドラッグ中に書くと 1 回の
  ドラッグで数十回 localStorage を叩く
- 寸法が変わったとき追従が必要なものを忘れない。既知のもの:
  - ターミナル（面の箱の大きさが変わると桁数・行数が変わる → `TERMINAL_VIEW.refit()`）
  - 他に追従が要るものを見つけたら、この行に足す

## 密度モードを壊さない

`body[data-sidebar-font-size]` が `--space-unit`（→ `--main-tabs-h`・`--global-header-h`）/ `--topbar-h` / `--statusbar-h` / `--ui-*` を
**4 段階（既定 / compact / large / xlarge）で書き換える**。

> **chrome の高さは定数ですらない。**「タブ列は 34px」を前提にした引き算は、
> 密度を変えた瞬間に全部ずれる。

- ジオメトリの計算に出る px が「ヘッダの高さ」「コントロールの高さ」「行の高さ」の意味を
  持つなら、それは T0 か T1 の**変数**であってリテラルではない
- レイアウトを変えたら **4 モードすべてで確認する。** 既定モードだけの確認は不十分

## 既存の違反をどう扱うか

**触ったら直す。** 変更した規則が上の規約に違反していたら、その PR の中で直す。
違反に合わせて新しいコードを書くのは禁止（違反が仕様に昇格する）。

**まとめて直すのは別作業。** 見つけた違反は報告するが、依頼された変更のついでに
16000 行の CSS を横断改修しない。

## 完了チェックリスト

- [ ] viewport 単位と chrome 変数を同じ `calc()` に書いていない（`--content-h` の定義を除く）
- [ ] 左端 / 下端に付く固定物は `--chrome-left` / `--chrome-bottom` だけを読んでいる
- [ ] 画面由来の項と px リテラルを同じ `calc()` に混ぜていない（混ぜるなら T3 として命名した）
- [ ] 固定物を足した / 消したなら、消費側の CSS を 1 行も触っていない
- [ ] レイアウト規則のセレクタに `gdp-*-page` を 2 つ以上並べていない
- [ ] ページが chrome を隠すなら、消費側ではなく `--chrome-h` を直した
- [ ] CSS と TS の両方に同じ数値を書いていない
- [ ] 密度モード 4 種で確認した
- [ ] 実画面を見た（→ `diagnose.md` の「UI が正しいか」）
- [ ] `pnpm run verify` が通る
