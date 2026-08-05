# ui-surface — コントロール・文言・装飾

読むタイミング: ボタン・アイコン・ラベル・トグル・ダイアログ・ステータス表示・装飾を
足す / 変えるとき。**寸法や配置そのものを変えるなら `ui-layout.md`。**

## 既存パターンを使う（新しい CSS を書かない）

新しいボタンや UI 要素を足すとき、CSS をゼロから書かない。まず既存パターンを探す。

| 置き場所 | 使うもの |
|---|---|
| グローバルヘッダのアイコンボタン | `global-icon-action` クラス |
| グローバルヘッダのテキストボタン | 同上 + `width: auto; padding: 0 8px;` 程度の上書きに留める |
| topbar のトグルボタン | `.controls > button` パターン（`#ignore-ws` `#hide-tests` が実例） |
| セグメント（排他選択） | `.seg` パターン |
| 確認 / 入力ダイアログ | `views/ui-dialog.ts` の `showConfirmDialog` / `showAlertDialog` / `showPromptDialog` / `showFormDialog` |
| アイコン SVG | `core/icons.ts` の path 定数 + `iconSvg(className, paths)` |

`alert` / `confirm` / `prompt` は `biome.jsonc` が **error で落とす**ので、そもそも書けない。
`views/ui-dialog.ts` を使う。

**新しい UI パターンを足すのは、既存クラスの組み合わせで要件を満たせないことを確認してから。**

## 箱の寸法を状態で変えない

インタラクティブなコントロールは、**idle / hover / focus / loading / success / warning /
disabled / updated のすべてで箱の寸法を保つ。**

- ラベル・padding・border・結果テキストを、**押した後にクリック対象がずれる形で変えない**
- 必要な幅は最初から確保しておくか、アイコンのみの状態表示にする
- 状態変化は **background / box-shadow / color だけ**に留める

理由: 押した直後にボタンが動くと、次のクリックが別の場所に当たる。マウスでもキーボード
フォーカスでも壊れる。

## 流動的な文言を狭い場所に置かない

グローバルヘッダ・サイドバー・topbar・コンパクトなツールバー・テーブルのフィルタ行・
小さなアイコンボタンの隣に、**長さの変わる文言を置かない。**

- 狭い場所では: アイコンのみのボタン / ドット / `aria-label`・`title` / disabled・busy 状態 /
  **幅を固定した status スロット**（コントロールを動かさないもの）
- "no changes" "updated" 行数の増減といった文言は、**本当に有用なときだけ**広い本文領域へ
- 広い場所でも、**流動的な文言をクリック可能なコントロールのラベル内に入れない。**
  非インタラクティブな別スロットに置き、ボタンの当たり判定が動かないようにする

## 文言（i18n）

ユーザーに見える文字列は、view にベタ書きせず**型付きテーブル**に置く。

| 画面 | ファイル |
|---|---|
| datastore | `views/database/i18n.ts` |
| terminal | `views/terminal/i18n.ts` |
| tools | `views/tools/i18n.ts` |
| 検索パレット | `views/search-palette-i18n.ts` |

- 言語はアプリ全体の設定（`app.ts` の `STATE.language`、`en` / `ja`）
- 言語切替時のライブ反映は各 view の `localize()` が担当する。**テーブルに足したら
  `localize()` で反映されるか確認する**（足しただけでは切替時に古い文言が残ることがある）
- 新しい画面を足すなら、同じ形で `i18n.ts` を作る

## Help ページと README への反映

CLI のサブコマンド・フラグ・画面の操作が変わったら、**同じ変更で**次を更新する。

- `web-src/views/help-page.ts` の `HELP_CONTENT` — **`en` と `ja` の両方**
- リポジトリルートの `README.md`
- 配布スキル `skills/code-viewer-*/SKILL.md`（CLI のサブコマンド / フラグを宣伝している場合）

リリース時の詳細な照合手順は `.agents/skills/project-npm-publish-procedure/SKILL.md` にある。

## datastore ページの glass テーマ

`.db-root` にスコープされた装飾レイヤが `web/style.css` の末尾にある
（`Datastore page — premium glass theme` と `Datastore page — aurora & glow boost` で検索）。

- **色は必ずテーマトークンから `color-mix` で導出する。** ここに hex を直書きしない
  （light / dark の追従が壊れる）
- 共有レシピは `.db-root` のカスタムプロパティにある:
  `--db-glass-bg` `--db-glass-bg-strong` `--db-glass-border` `--db-glass-blur`
  `--db-glass-shadow` `--db-focus-ring`。新しい値を発明せず再利用する
- **`.db-root` の外に付く要素**（`document.body` 直下の `.s3-key-tooltip` など）は
  これらの変数を継承しない。各 `var()` に fallback を書く
- 状態変化（hover / active / focus）は background / box-shadow / color だけ。
  padding や border を変えない（上の「箱の寸法を変えない」と同じ理由）
- aurora レイヤは `.db-root::before`。`isolation: isolate` + `z-index: -1` で内容の背後に
  留め、`prefers-reduced-motion` で無効化する。**セレクタをレイアウトに影響する形にしない**

## 参照 UI があるなら、それを読んでから書く

ユーザーが「この画面と同じにして」と既存 UI を指したら、**まずその実装を読む。**
DOM 構造と CSS を合わせる。並行する別レイアウトを発明しない。

## 完了チェックリスト

- [ ] 既存クラスで足りないことを確認してから新しい CSS を書いた
- [ ] 全状態で箱の寸法が変わらない
- [ ] 流動的な文言がコントロールの当たり判定を動かさない
- [ ] ユーザーに見える文字列を `i18n.ts` に置き、`en` / `ja` 両方を書いた
- [ ] CLI / 操作が変わったなら Help ページ（en + ja）と README を同じ変更で直した
- [ ] 実画面を見た（→ `diagnose.md`）。light / dark 両方
- [ ] `pnpm run verify` が通る
