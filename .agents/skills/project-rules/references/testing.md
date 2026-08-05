# testing — このリポジトリでのテスト

読むタイミング: テストを書くとき / 落ちたテストを直すとき。特に **CSS やソース文字列を
検査するテスト**に触るとき。

**網羅設計（table-driven・パラメタライズ）そのものは global の `my-writing-tests`。**
ここに置くのはこのリポジトリ固有の判断だけ。

## 何を防ぐか

CSS の生文字列を検査するテストが **2 回壊れた**。CSS を複数行に整形した瞬間に落ち、
値を戻したらまた落ちた。

さらに悪いことが起きている。`markdown-preview.test.ts` の TOC を検査するテストには

```ts
expect(style.includes("max-height: calc(100vh - var(--global-header-h) - 40px);")).toBe(true);
```

というアサーションがあるが、**この文字列が `style.css` に存在するのは `.app-panel` の規則
だけ**で、検査したかった `.gdp-markdown-toc` の値はもう別物になっている。

> **文字列テストは壊れるだけでなく、黙って別の規則を守り始める。**
> しかも緑のままなので、誰も気付かない。

背景として、`biome.jsonc` は `web/` を除外しているので **`style.css` は formatter に管理
されていない**。整形は人手であり、空白位置は本質的に不安定。

## 生ソース文字列で主張してよい 2 つ（列挙。判断に委ねない）

1. **不在の証明** — 機能を削除した後、痕跡が残っていないこと
   （`web-src/test/asset-version-removal.test.ts` が手本。ソースと**焼いたバンドル**の両方を見る）
2. **ドキュメント整合** — CLI / README / Help の記述と実装の対応
   （`web-src/test/_documented-cli-fixture.ts` が手本）

**それ以外、特に CSS の見た目・レイアウト・セレクタの存在を生文字列で主張するのは禁止。**
「あるはず」を確かめても、「効いている」ことは何も確かめていない。

## 代わりに使うもの

### A. セレクタが効いているかを見る — happy-dom + 実 `style.css`

`web-src/test/ref-picker.test.ts` が実例。実物の `web/style.css` を `<style>` に流し込み、
`body.className` を変えて `getComputedStyle` の変化を見ている。

```ts
const style = document.createElement("style");
style.textContent = readFileSync("web/style.css", "utf8");
document.head.appendChild(style);

document.body.className = "";                 expect(getComputedStyle(el).display).toBe("none");
document.body.className = "gdp-repo-page";    expect(getComputedStyle(el).display).toBe("flex");
```

**適用範囲（実測で確認済み）:**

| 見たいもの | happy-dom で見えるか |
|---|---|
| セレクタのマッチ・カスケード・`display` / `visibility` / `position` 等の単純な値 | **見える** |
| `var()` / `calc()` を含む寸法（`height: var(--content-h)` 等） | **見えない。空文字が返る** |

**`var()` を含む寸法を happy-dom で検査しようとしないこと。**
空文字が返るため、`not.toBe("100vh")` のような書き方が**無条件で通ってしまう**。

### B. `var()` / `calc()` の解決まで見る — `_css-fixture.ts`

`web-src/test/_css-fixture.ts` が、コメント除去 / 詳細度 / 宣言のカスケード /
**`var()` 解決** / **at-rule 追跡**を持っている。**新しく書かない。これを import する。**

```ts
import { baseRules, cascadedDeclarations, loadStyleSheet, resolveVar }
  from "./_css-fixture";

const rules = baseRules(loadStyleSheet());          // @media の上書きを除く
const vars = cascadedDeclarations(rules, (s) => s === ":root");
const box = cascadedDeclarations(rules, (s) => s === ".my-box");
resolveVar(box.get("max-height") ?? "", vars);
```

- **`baseRules()` を通す。** 通さないと `@media` 内の上書きが常に勝ち、
  「デスクトップでは sticky なのに static だと報告される」形で嘘の結果が出る
  （`.gdp-markdown-toc` で実際に踏んだ）
- どのセレクタを対象にするかは呼び出し側が決める。この道具は要素ツリーを持たない
- **値そのものを固定しない。**「変数を変えたら結果も変わる」形にすると、px を
  調整しただけでは落ちず、構造が壊れたときだけ落ちる
  （`markdown-preview.test.ts` の TOC の検査が実例）

### C. 実ブラウザ

レイアウトが実際にどう出るかは、最終的にブラウザで見る（→ `diagnose.md`）。
テストはブラウザ確認の代わりにならない。

## 既存の違反をどう扱うか

**触ったら直す。**

- 自分の変更でその種のテストが落ちたら、**同じ PR で振る舞いテストに書き換える**
- **新しい文字列に貼り直すのは禁止。** それが 2 回目・3 回目の破損を生む
- 実装がまだ議論中のときに、実装に合わせてテストを書き換えない。**実装を先に決める**

**まとめて直すのは別作業。** 依頼された変更のついでに、`style.css` を読む全テストを
横断改修しない。見つけた違反は報告する。対象は次で数えられる:

```sh
grep -rln 'web/style\.css' web-src/test/
```

`web/` の前置きと `\.` のエスケープは必須。`"style.css"` だけで引くと、`style.cssText` を
使っているだけのテストと、watch 対象名として文字列を持つだけのテストが混ざる。

**書き換えの実例**（そのまま手本にしてよい）: `web-src/test/markdown-preview.test.ts` の
TOC の検査は、`.gdp-markdown-toc` のブロックを改行込みで丸ごと固定し、さらに無関係な
`.app-panel` の規則を守っていた。`.app-panel` を直した瞬間に、TOC を一切触っていないのに
落ちた。いまは「下パネルの占有高さを変えると TOC の上限も変わる」を見る形に置き換えてある。
同じファイルには**まだセレクタ存在の文字列検査が残っている**（既存違反。触ったときに直す）。

> 「違反件数が増えたら落ちる」ラチェットテストは**未実装**。入れるかはユーザー判断待ち。

## このリポジトリの vitest 事情

| 事実 | 意味 |
|---|---|
| `fileParallelism: false` | 実プロセス（preview サーバ / git / docker CLI）を起動するテストが多く、並列だと互いに遅れてランダムに落ちるため。**タイミング依存の失敗を「並列だから」と説明しない** |
| `environment: "node"` | DOM が要るファイルは**各自** `@happy-dom/global-registrator` を登録する。全体に被せると node 側のテストが本来無いグローバルを掴む |
| `globalSetup` が `dist/code-viewer.js` を焼く | CLI を起動するテストが依存している |
| `testTimeout` / `hookTimeout` = 30s | 既定の 5s では足りないテストがあるため |
| `web-src/test/_*.ts` はグロブに入らない | 共有ヘルパの置き場。`_test-helpers.ts` / `_fake-dom.ts` / `_git-fixture.ts` / `_io-fixture.ts` / `_dialog-helpers.ts` / `_documented-cli-fixture.ts` |

## テストデータ

**公開リポジトリなので、実データをフィクスチャにしない。**
ローカル DB・画面キャプチャ・API 応答・ログで見た固有名詞（プロジェクト名・顧客名・
組織名・テーブルの値・ドメイン・URL）を、テスト・スナップショット・コメントに写さない。
`sample_table` `sample_column` `example status` のような中立な placeholder に置き換える。

## やってはいけないこと

| 違反 | 結果 |
|---|---|
| 実装が文字列を含むことだけを証明するテストを書く | 契約を何も守らない。壊れるか、別物を守り始めるかのどちらか |
| 落ちた文字列テストを新しい文字列に貼り直す | 同じ破損が次も起きる。3 回目が予約される |
| 振る舞いが決まる前にテストを書く | 誤った仕様が固定される |
| `var()` を含む寸法を happy-dom で検査する | 空文字が返り、アサーションが無条件で通る |
| 実データをフィクスチャに使う | 公開リポジトリに固有名詞が残る。git 履歴からは消せない |
