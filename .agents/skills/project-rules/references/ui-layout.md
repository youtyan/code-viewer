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
| **T1** chrome 実寸 | 「この固定物が何 px 占有しているか」 | `--main-tabs-h` (最上段のタブ列) `--global-header-h` (上に居座る固定物の合計。今はタブ列だけなので `= --main-tabs-h`。body で決める) `--panel-head-h` (右の列の頭 `#panel-head`) `--topbar-h` `--nav-w` (左のサイドバー) `--statusbar-h` (最下段) `--sidebar-w` `--history-w` `--annotation-panel-w` | **可**（その固定物の実寸なので） |
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
列の左)、画面の右端の右の列 (上端から。頭 `#panel-head` の 1 段目 = タブ列の行に画面の入口の絵柄、
2 段目 `--panel-head-h` に題名 = プロジェクト名とブランチ。幅 `--panelcol-shown`。本体は
`--panel-body-top` から。Files の木・History と選んでいる作業ツリーの一覧はここ)、画面ごとの
ツールバー (`#topbar`、`--topbar-h`)、最下段のバー (`#statusbar`、`--statusbar-h`)。画面下の
パネルは無い (Tools と Search はタブ。`orientation.md`)。右の列を畳むと (`body.gdp-sidebar-hidden`) `--panelcol-shown` が
細い帯の幅になり、プロジェクト名と画面の入口 (`#view-head`) はタブ列の左の `#tabs-lead` へ移る
(`views/sidebar.ts` の `placeSidebarToggle`)。自動では畳まない。

- **上に居座る固定物の高さは `--global-header-h` だけを読む。** 今はタブ列だけなので
  `--global-header-h: var(--main-tabs-h)` (`style.css` の `html, body`)。ツールバーの `top`・各ページの
  `--chrome-h` の上書き・sticky の `top`・面の箱の `top` はこれを読むので、上に固定物を足す / 消す
  ときはこの式に項を足すだけ。左のサイドバーの頭 (`.nav-head`) はタブ列と高さをそろえるため
  `--main-tabs-h` を読む
- **本文まわりの固定物 (ツールバー・読み込みの帯・ファイルの木・履歴や作業ツリーの面・注釈の面・
  `body` の左右の余白) の左右の端は `--page-left` / `--page-right` だけを読む。**
  `--page-left = --chrome-left`、`--page-right = --panelcol-shown` (右の列の左まで)。メインの面を左右
  2 面に分けたとき (`body.main-split`)、本文 (route の中身) は左の面にだけ描くので `--page-right` に
  右の面と境界の幅を足す。面の幅 `--split-left-w` / `--split-right-w` / `--split-divider-w` と本文の幅 `--main-w` は TS
  (`views/main-tabs/main-tabs-view.ts` の `applyGeometry`) が出所
- **メインの面の箱 (`.main-pane-host`。`app.ts` の `PANE_HOSTS`) は `top: --global-header-h`・
  `left: --page-left`・`right: --panelcol-shown`・`bottom: --main-bottom`。** 右の列 (木) を覆わない。2 面では左の箱は
  `--split-left-w` の幅、右の箱は残り。右の面のソース表示 (`.main-pane-source`) は本文の
  `--content-h` ではなく `--main-pane-h` で箱を作る。タブ列は面をまたぐので左は `--chrome-left`、
  右は `--panelcol-shown`。最下段は右の列の下もまたぐ
- `--main-tabs-h` と `--global-header-h` は `html, body` で決める (密度の `--space-unit` の上書きが
  body に載るため。下の「T2 を宣言する要素を間違えない」と同じ理由)

- **左端に付く固定物は `left: var(--chrome-left)`、下端に付く固定物は
  `bottom: var(--chrome-bottom)` だけを読む。** `--nav-w` や `--statusbar-h` を直接読まない。
  左や下に固定物を足す / 消すときは、`html, body` ブロックの `--chrome-left` /
  `--chrome-bottom` の式に項を足すだけ（下の「型」の横と下の版）
- 本文 (窓のスクロール) は `body` の `padding-left: var(--chrome-left)` と
  `padding-bottom: var(--chrome-bottom)` で固定物の内側に入る。`#content` の `margin-left`
  は今までどおり `--sidebar-w` だけを見る
- `--content-h` は `--chrome-bottom` も引く（最下段は本文と場所を分け合う）
- 左のサイドバーを畳む = `html[data-nav-collapsed]` が `body` で `--nav-w: 0px` にする。
  html の属性なのは、`index.html` の head のスクリプトが body より先に付けて、移った直後に
  骨格が一瞬崩れないようにするため（控えは `views/shell/early-look.ts`）
- 画面座標で線を引く JS (リサイズのプレビュー線) は、固定物の左端を
  `getBoundingClientRect().left` で読む。`0` 起点の座標を書かない
- 骨格の幅・高さ (`--nav-w` など) の既定・下限・上限は `core/panel-sizes.ts`
  だけが持つ（画面とサーバの設定の検査が同じ値を使う）。保存先は全プロジェクト共通の設定
  (`core/user-settings.ts` の `USER_SETTING_KEYS`)。**localStorage に置かない**: プロジェクトを
  移る = 別のポートのページなので、移るたびに戻ってしまう

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
