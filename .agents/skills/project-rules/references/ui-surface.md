# ui-surface — コントロール・文言・装飾

読むタイミング: ボタン・アイコン・ラベル・トグル・ダイアログ・ステータス表示・装飾を
足す / 変えるとき。**寸法や配置そのものを変えるなら `ui-layout.md`。**

## 既存パターンを使う（新しい CSS を書かない）

新しいボタンや UI 要素を足すとき、CSS をゼロから書かない。まず既存パターンを探す。

| 置き場所 | 使うもの |
|---|---|
| 中央上の行 (`#global-header`) のアイコンボタン | `global-icon-action` クラス (外部リンクは `global-icon-link`) |
| 中央上の行のテキストボタン | 同上 + `width: auto; padding: 0 var(--space-2);` 程度の上書きに留める |
| 左のサイドバー (`#app-nav`) の下端の項目 | `nav-foot-item` (アイコン + 文字)。見出しの横の小さな操作は `nav-icon-action` |
| 左のサイドバーの行の操作 (hover で出る) | `nav-row-action`。場所を確保せず行の上に重ねる (`.nav-project-actions`) |
| 最下段のバー (`#statusbar`) | 押せる塊は `usage-status-item` / `statusbar-icon-action`。流動的な文言は幅を固定した塊の中だけ |
| 下パネルの見出しの行 (`.app-panel-tabs`) | 1 行だけ。ビュー固有の小さな操作は `#app-panel-view-actions` に置き (`app-panel-icon`)、それ以外の操作は「⋯」(`#app-panel-menu`) に入れる。ビューは `menuItems()` で項目を渡す (例: `TerminalViewHandle.menuItems`)。行を 2 段にしない |
| ターミナルの画面に付く補助 (出力に出た画像など) | 文字の上に重ねない。画面の箱の中に別の列を取る (`views/terminal/image-shelf.ts` の画像の棚。仕様は `agents.md` の 12) |
| 補助の情報 (大きさ・日時など) | 行にしない。情報のボタン (`.gdp-file-detail-meta` の形: 押せる領域は固定、hover / フォーカスで小さな面) に入れる |
| topbar のトグルボタン | `.controls > button` パターン（`#ignore-ws` `#hide-tests` が実例） |
| セグメント（排他選択） | `.seg` パターン |
| 確認 / 入力ダイアログ | `views/ui-dialog.ts` の `showConfirmDialog` / `showAlertDialog` / `showPromptDialog` / `showFormDialog`。型は 1 つ (面は `--color-overlay`、内側 7 単位、右上の閉じる = 取り消し、ボタンは `gdp-dialog-cancel` / `gdp-dialog-confirm` / 危険は `danger`)。見出しの下の 1 文は `description`。本文の見出しつきの値・コードの枠・箇条書きは `agent-hooks-dialog-*` の部品 (`accounts-dialogs.ts` の `labeled`)。ボタンのクラスを呼び出し側で付け直さない |
| 使用量 (5h / week の割合・バー・リセットまで・いつの値か) | `views/agents/usage-meter.ts` の `usageMeterRow` / `usageObservedText`。全体ボードのカードと最下段のポップオーバーが同じものを使う (場所で見え方を変えない) |
| 全体ボードの操作 | 主の操作は `agents-primary`、枠つきの小さな操作は `agents-secondary`、文字だけは `agents-text-action`、アイコンは `agents-icon-action` (28px 角)。プロジェクトの見出しの開く・起動・⋯ は hover / フォーカスで出し、場所は最初から取る |
| アイコン SVG | `core/icons.ts` の path 定数 + `iconSvg(className, paths)` |

`alert` / `confirm` / `prompt` は `biome.jsonc` が **error で落とす**ので、そもそも書けない。
`views/ui-dialog.ts` を使う。

**新しい UI パターンを足すのは、既存クラスの組み合わせで要件を満たせないことを確認してから。**

## 色・余白・角丸・文字は名前だけを使う

見た目の決まりは `web/style.css` の先頭にまとめてある (名前の層)。部品はこの名前だけを読む。
**16 進の色・生の px を部品の規則に新しく書かない。**

| 何 | 名前 |
|---|---|
| 面の段階 | `--color-ground` (窓の地・上の行・最下段) / `--color-nav` (サイドバー) / `--color-tree` (ファイルのツリー) / `--color-doc` (本文) / `--color-inset` (本文の中の沈んだ面) / `--color-raised` (hover) / `--color-select` (選んでいる行) / `--color-term` |
| 文字の段階 | `--color-text` / `--color-text-2` / `--color-text-3` / `--color-on-accent` |
| 線 | `--color-line` / `--color-line-soft` / `--color-line-strong`。**線は最後の手段。** 面の明るさの差で分けられるなら線を引かない |
| アクセントと状態 | `--color-accent` / `--color-accent-strong`、`--color-waiting` `--color-working` `--color-done` `--color-failed` `--color-idle` |
| 選んでいる行の光 | `--glow-select` (内側の box-shadow。箱の寸法を変えない) |
| 余白 / 角丸 | `--space-1`〜`--space-6` (4〜32px) / `--radius-sm` `--radius-md` `--radius-lg` |
| 文字の大きさ・行の高さ | 密度の段階 (T0): `--ui-font-*`・`--ui-control-*`・`--ui-row-h` (`ui-layout.md`) |
| 文字の家族 | `--font-ui` / `--font-mono` |

- テーマは同じ名前の値を差し替えるだけ: `html[data-theme="light"|"dark"]` × `html[data-palette]`
  (`graphite` / `warm`、無し = 既定の紫)。**テーマごとに部品の規則を書き分けない。**
  古い `[data-theme="dark"] .x { color: #... }` を見つけたら、名前へ寄せる (触ったら直す)
- 古い名前 (`--bg` `--fg` `--accent` `--border` …) は互換の層で、中身は名前の層への参照だけ。
  新しい部品は名前の層を読む。互換の層に 16 進を書き戻さない
- 差分の色 (`--diff-*`) は色違いに引きずられない (追加・削除の意味を保つ)。ライトとダークで 1 組ずつ
- 状態の印は形で区別する: ひし形 = 入力待ち、回る弧 = 作業中、チェック = 完了、白抜きの丸 = 待機
  (`.terminal-mark-*`)。色だけで伝えない。`prefers-reduced-motion` で回転を止めても形で読める
- xterm は CSS 変数を読めないので、端末の色は `views/terminal/terminal-screen.ts` の
  `terminalTheme()` が `--color-term*` と状態の色から読み (ANSI の赤・緑・黄・紫・白も差し替えて、ライトの地でも読めるようにする)、テーマが変わったら当て直す。端末の色を足すなら名前の層に足す

## 余白と基準線は色と同じ重さの仕様

余白が雑だと、色を合わせても同じ部品が安っぽく見える (実際に、文書の面の中でパンくず・
情報の行・目次・選択の面がそれぞれ 14 / 26 / 34 / 41px から始まり、面の端に強調の面が
接していた)。次の決まりで画面を作る。

1. **余白は段階の名前だけを使う。** `--space-1`〜`--space-7` (4 / 8 / 12 / 16 / 24 / 32 / 48)。
   密度 (`body[data-sidebar-font-size]`) では `--space-unit` だけが変わり、全部の段階が
   比例する。段階に無い値が要るなら、段階を直すか、その行に理由を書く。
   **骨格の節 (style.css の「Workspace shell」から後ろ) は `web-src/test/shell-spacing-scale.test.ts`
   が検査する** (余白・位置・大きさのプロパティに 2px を超える生の px があれば落ちる)
2. **面ごとに内側の余白を 1 つ決め、その面の全部の行の文字の左端をそこにそろえる。**
   | 面 | 面の線 (押せる面・選択の面の端) | 文字の線 |
   |---|---|---|
   | 左のサイドバー・ファイルのツリー・中央上の行・最下段・下パネルのタブ | `--pad-face` (8) | `--pad-text` (16) |
   | 文書の面 (パンくず・情報の行・目次・本文の始まり) | 文字の線 − `--pad-face` | `--pad-doc` (24) |
   選択や hover の面は面の線から描き (文字より外へ広げる)、文字は文字の線に乗せる。
   行ごとに別の字下げを持たせない。字下げは `--indent-step` (16) の倍数だけ
   (ツリーは `views/tree-indent.ts` の `TREE_INDENT`、目次・サイドバーも同じ段)
3. **面の端に要素を接させない。** 内側の余白 ≥ その面の角丸。アイコンのボタンは、押せる領域
   (28〜32px 角) の端を面の線に乗せる (絵ではなく押せる領域でそろえる)。
   overflow の箱 (目次など) の中で負の余白で面を外へ出すと切れるので、箱のほうを面の線から始める
4. **入れ子は外 ≥ 内。** 面の外の間隔 ≥ 面の内側の余白 ≥ 行の中の間隔
5. **縦の間隔にも段階を使う。** 関係の近いもの (パンくずと情報の行) は詰め (`--space-1`)、
   役割の変わるところ (見出し → 本文) は 1 段広く。**区切りの線を足す前に間隔で区切る**
6. 補助の情報 (大きさ・日時) は主役の行から外して小さく (`--color-text-3`)。絵に無い行を足して
   絵の密度を壊さない
7. **一覧の行の高さは `--ui-row-h` の 1 つだけ** (サイドバー・ファイルのツリー・目次・変更ファイル・
   セッションの一覧)。出所は `views/shell/row-height.ts` (表示密度ごと)。ファイルのツリーの仮想表示も
   ここを読む。行の高さを別の数値で書かない
8. **選択の強さは 2 段。** 強い選択 (`--color-select` + `--glow-select`) は画面の同じ列に 1 つだけ
   (いまターミナルで開いている行など)。「いまここ」を示すだけのもの (いま見ているプロジェクト) は
   控えめな面だけにする

確かめ方: 面ごとに、各行の文字の左端・押せる領域の端を `getBoundingClientRect` で読み、
面の左端からの距離が上の表の値になっていることを見る (文字の左端は、行の中の最初の
文字列の Range か最初の svg の矩形。数値をスクリーンショットで目測せず、表にして差を見る)。

## 箱の寸法を状態で変えない

インタラクティブなコントロールは、**idle / hover / focus / loading / success / warning /
disabled / updated のすべてで箱の寸法を保つ。**

- ラベル・padding・border・結果テキストを、**押した後にクリック対象がずれる形で変えない**
- 必要な幅は最初から確保しておくか、アイコンのみの状態表示にする
- 状態変化は **background / box-shadow / color だけ**に留める

理由: 押した直後にボタンが動くと、次のクリックが別の場所に当たる。マウスでもキーボード
フォーカスでも壊れる。

## 流動的な文言を狭い場所に置かない

中央上の行・左のサイドバー・最下段のバー・topbar・コンパクトなツールバー・テーブルのフィルタ行・
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
- [ ] 色・余白・角丸を名前の層から読んだ（16 進・生の px を部品に足していない）
- [ ] 実画面を見た（→ `diagnose.md`）。ライトと、ダークの色違い 3 つ
- [ ] `pnpm run verify` が通る
