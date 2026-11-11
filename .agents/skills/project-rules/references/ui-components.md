# ui-components — 画面のコードの作り (presenter・view・部品)

読むタイミング: 画面 (`web-src/views/` と `web-src/app.ts` の画面を組み立てる所) を
書く / 書き直すとき。部品 (`cv-*`) を足す / 変えるとき。画面のテストを書くとき。
**見た目 (色・寸法・種類) は `ui-surface.md` と `ui-layout.md`。ここは「どう描くか」だけ。**

## 何を防ぐか

画面は長い間、`document.createElement` を数千か所並べて組み立て、状態が変わるたびに
その場で DOM を書き換えていた。同じ部品 (ボタン・切替・空の案内) が画面ごとに
少しずつ違う手書きになり、処理 (保存・読み込み) と表示が 1 つの関数に混ざって、
表示を差し替えて処理だけを確かめるテストが書けなかった。

## 3 つの層

| 層 | 何を持つか | 置き場所 |
|---|---|---|
| presenter | 状態・サーバとのやり取り (`fetch`・`trackLoad`・世代)・タイマー・保存。DOM を組み立てない | `views/<画面>/<画面>-presenter.ts` の `create<画面>Presenter(deps, view = DEFAULT_VIEW)` |
| view | presenter が渡す値 (`<画面>ViewProps`) だけから lit のテンプレートを返す関数。状態を持たない | `views/<画面>/<画面>-view.ts` の `DEFAULT_VIEW` と、型 `<画面>View` / `<画面>ViewProps` |
| 部品 (`cv-*`) | 2 か所以上で使う、状態と操作を持つ UI のかたまり (ボタン・切替・つまみ・空の案内・図の枠…) | 共通は `views/ui/`。1 つの画面の中で何度も使うものはその画面のディレクトリ |

- **view は presenter に注入する。** `create<画面>Presenter(deps, view)` の 2 つ目の引数。
  既定は `DEFAULT_VIEW`。テストでは値を記録するだけの view に差し替える (下の「テスト」)
- **props には値と、操作を受ける関数 (`onSelectTool` など) だけを入れる。** view は
  props の関数を呼ぶだけで、fetch も状態の書き換えもしない
- **子の部品は presenter の中で作らない。** `document.createElement("cv-…")` や
  `new …()` で作って差し込まない。テンプレートの中で `<cv-… .prop=${…}>` と宣言する
- 1 か所でしか使わないかたまりは部品にしない (view の中のテンプレート関数にする)

## 描き方

- テンプレートは `lit/html.js` の `html` (絵は `svg`)。ディレクティブは `lit/directives/*.js`。
  `lit` の本体 (`LitElement`) は使わない (下の「部品の作り方」)
- presenter は自分の箱を `views/ui/renderer.ts` の `createRenderer(host, () => view(props()))`
  で描く。状態を変えたら `renderer.request()`。**描き直しはまとめて行う**: 頼まれた分は
  `views/ui/render-queue.ts` が次の `requestAnimationFrame` で 1 回だけ描く (隠れている
  タブでは次のタスクで描く)。その回の中で子の部品が頼んだ描き直しも同じ回で描き切る
- 描いた直後の DOM を読む必要がある所 (フォーカス・寸法を測る・外の部品に要素を渡す)
  だけ `renderer.flush()` / `flushRenders()` で、いまここで描く
- **箱 (host) の中身は renderer だけが持つ。** `host.replaceChildren()` や `innerHTML` で
  中を消さない (lit が置いた印が消え、次の描画で投げる)。消したいときは何も描かない
  状態にして描き直す (`mounted ? view(props()) : null`)
- 外から渡された値を持つ入力の欄 (`.value=${live(…)}`) は、利用者が打った値を部品の値に
  描き直しを起こさずに合わせる (`this.propValues.value = value`)。合わせないと、別の理由の
  描き直しで欄が前の値に戻る (Tools の「消す」で実際に戻った)

### 外の部品と、外の部品に渡す DOM

markdown-it・shiki・mermaid・xterm・diff2html などが作る DOM はそのまま使う。結果の要素は
テンプレートの値として置く (`${element}`)、HTML の文字列は `unsafeHTML(…)` で置く。

- **外の部品が中身を読む要素には、中身を property で入れる** (`.textContent=${value}`)。
  子として描くと lit の印 (コメント) が中に入る。mermaid は `innerHTML` から記法を読む
  ので、子として描くと記法の誤りになった (`mermaid-tool.test.ts` がこれを見る)
- 外の部品が中身を置き換える要素 (mermaid が図に替える箱など) は、描くたびに
  `keyed(…)` で作り直す。置き換えられた中を lit が描き直そうとすると投げる

## 部品の作り方

- 名前は `cv-` で始める。定数 `export const CV_<名前> = "cv-…"` と、定義する関数
  `defineCv<名前>()` を置く。共通の部品は `views/ui/components.ts` の
  `defineUiComponents()` に 1 行足す (`createRenderer` が最初に描く前に呼ぶ)。画面の中だけの
  部品は、その画面の presenter が描く前に自分の定義の関数を呼ぶ
- 土台は `views/ui/element.ts` の `defineElement(name, (Base) => class extends Base {…})`。
  クラスは定義する時に作る (DOM の無い node のテストもこのモジュールを読むので、読んだ
  時点で `HTMLElement` を参照しない)。`static props` に挙げた property は値が変わると描き
  直しを頼む。描き直しを起こさない設定 (関数) は普通の field にする
- **Shadow DOM を使わない。** 部品は自分の中 (light DOM) に `template()` を描く。見た目は
  `web/style.css` だけが決める。外側の要素は `display: contents` で箱を作らない:
  `web/style.css` の「部品の外側の要素 (cv-*)」の並びに名前を足す
  (`ui-components.test.ts` が落とす)。外側の要素に `hidden` を付けない (隠すのは中の要素)
- 部品の中は標準の要素 (`button`・`input`・`select`・`a`・`div`) にし、キー操作と
  アクセシビリティを標準のまま保つ。ARIA は属性を直接書く。説明の吹き出しは `title` 属性
- 外側の要素が 1 段増えるので、親から子を `>` で選ぶ規則は部品の中まで書き直す
  (`.tools-pane-head > cv-button > .tools-pane-action`)。並びを丸ごと描く部品
  (`cv-segmented` は `.seg` と中のボタンを描く) は、中の並びを今までどおりに保つ
- 部品が外へ知らせる出来事は `cv-` で始める (`cv-select`・`cv-draft-input`)。中の標準の
  要素の `click`・`input`・`change` はそのまま外へ届く
- 部品は自分の片付け (時計・購読・`attachDragResizer`) を `disconnectedCallback` で行う

### 共通の部品 (`views/ui/`)

| 部品 | 中身 | 使う所 |
|---|---|---|
| `cv-button` | `<button type="button">`。種類は `cls` のクラスが「ボタンの種類」の節に入っていることで決まる | 押す操作 1 つ |
| `cv-icon` / `iconTemplate` | `<svg class="octicon">`。path は `core/icons.ts` | 絵 |
| `cv-segmented` | `.seg` と中のボタン。押したら `cv-select` | 排他の切替 |
| `cv-resizer` | `<div role="separator">` と `attachDragResizer` | 面の幅・高さを変えるつまみ |
| `cv-empty-state` / `emptyStateTemplate` | `.empty` の案内 | 何も無い場所の案内 |
| `cv-diagram-viewport` | ズームとドラッグパンの枠 (`attachDiagramViewport`) | 図・画像を見て回る |

## Request Lifecycle との関係

`server.md` の Request Lifecycle Discipline はそのまま presenter に当てる。fetch は
`deps.trackLoad` を通し、画面の切替では世代を進め、古い応答で描き直さない。**描き直しを
頼むこと自体は世代の判定の後で行う** (古い応答で `renderer.request()` を呼んでも、描く
値が古いので結果は同じく古い)。loading の文言は props の値にし、成功・失敗・取り消しの
全部の道で値を戻してから描き直しを頼む。

## テスト

- **presenter ごとに、view を差し替えたテストを置く** (`<画面>-presenter.test.ts`)。
  値を記録するだけの view (`(props) => { seen.push(props); return null; }`) を注入し、
  `flushRenders()` の後の最後の props と、fetch の呼ばれ方 (モデルの呼び出し) を見る。
  操作は props の関数を呼んで起こす (`last().onSelectTool("mermaid")`)
- 描いた DOM を読む presenter (入力の欄の値・列の寸法・フォーカスの戻し先) は、値を記録
  してから既定の表示に渡す view で差し替える (`(props) => { seen.push(props); return DEFAULT_VIEW(props); }`)。
  例: `search-palette-presenter.test.ts`・`main-tabs-view.test.ts` の「main tabs presenter」
- `DEFAULT_VIEW` の形は、既存の画面のテスト (DOM を読むもの) と画面の撮影で確かめる。
  DOM を読む前に `flushRenders()` を呼ぶ (描き直しは次の描画の機会まで待つので)
- **lit で描くものを読むテストは、import の先頭で `./_dom` を読む** (`beforeAll` で DOM を
  登録しない)。lit-html は読み込んだ時点の `document` を掴み、後から登録した DOM には
  描けない。登録の後で動的に import するテストはそのままでよい
- 部品を 1 つだけ置いて確かめるときは、テストの中で `document.createElement("cv-…")` を
  作り、property を入れて body に置く (テストの道具の例: `web-src/test/_tools-pane.ts`)

## 機械で見ていること

`web-src/test/ui-components.test.ts`:

- `CV_*` の定数に書いた部品の外側の要素が、実際の `web/style.css` で `display: contents`
- 宣言的に書き直した所 (`DECLARATIVE` の並び) に `createElement`・`innerHTML`・
  `insertAdjacentHTML`・`outerHTML` の代入が無い。外の部品のために残す所は `EXCEPTIONS` に
  数と理由を書く
- まだ書き直していない所も含めた数が上限 (`IMPERATIVE_LIMIT`) を超えない。書き直したら
  上限を下げる

## 完了チェックリスト

- [ ] presenter と view を分け、view を presenter に注入した (既定は `DEFAULT_VIEW`)
- [ ] 子の部品をテンプレートの中で宣言した (presenter の中で作っていない)
- [ ] 新しい部品の名前を `components.ts` と `style.css` の「部品の外側の要素」に足した
- [ ] `>` で部品の中を選ぶ規則を直した
- [ ] presenter に view を差し替えたテストがある
- [ ] 書き直した所を `ui-components.test.ts` の `DECLARATIVE` に足し、`IMPERATIVE_LIMIT` を下げた
- [ ] 書き直す前と後を砂場で撮り、同じに見えることを確かめた (`diagnose.md`)
