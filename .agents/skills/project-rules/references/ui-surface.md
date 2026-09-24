# ui-surface — コントロール・文言・装飾

読むタイミング: ボタン・アイコン・ラベル・トグル・ダイアログ・ステータス表示・装飾を
足す / 変えるとき。**寸法や配置そのものを変えるなら `ui-layout.md`。**

## 既存パターンを使う（新しい CSS を書かない）

新しいボタンや UI 要素を足すとき、CSS をゼロから書かない。まず既存パターンを探す。

| 置き場所 | 使うもの |
|---|---|
| 最下段の右の操作の塊 (`.statusbar-actions`。上の行が無くなって移った注釈・AI 向けのコピー・自動更新・通信の中止・テーマ・Web ページ) と、一覧の列の頭の 1 段目 (`#project-head`) のアイコンボタン (`#nav-expand`) | `global-icon-action` クラス (外部リンクは `global-icon-link`)。上の行 (`#global-header`) は無い (`web/index.html` のコメント) |
| メインの面のタブ列 (`#main-tabs`、上の行の直下) | `views/main-tabs/main-tabs-view.ts`。タブは `main-tab` (絵 `main-tab-icon`・名前 `main-tab-name`・閉じる `main-tab-close` は選択中と hover だけ見せ、場所は常に取る)。プロジェクトごとのグループは札 `main-tab-group` (`main-tab-group-toggle` = 色の四角・名前・畳んだときの枚数、`main-tab-group-menu` = ▾) と並び `main-tabs-group-list` (下の「タブのグループ」)。＋ (`main-tabs-action main-tabs-new`) は最後のタブのすぐ右、分割 (`main-tabs-action main-tabs-split`) は列の外の右端 (下の「タブの決まり」)。種類ごとの絵は `views/main-tabs/tab-icons.ts`、page の名前は上の行の入口と同じ文言 (`uiText().nav`)。右クリックの項目の有効・無効は `core/main-tabs.ts` の `tabMenu` だけが決める。選択中の面は `--color-tab-active` |
| 同じ場所のテキストボタン | 同上 + `width: auto; padding: 0 var(--space-2);` 程度の上書きに留める |
| 左のサイドバー (`#app-nav`) の下端の項目 | `nav-foot-item` (アイコン + 文字)。見出しの横の小さな操作は `nav-icon-action` |
| 左のサイドバーの行の操作 (hover で出る) | `nav-row-action`。場所を確保せず行の上に重ねる (`.nav-project-actions`) |
| エージェントの行 (左のサイドバー・全体ボード) | `views/agents/agent-card.ts` の `fillAgentCard` (`.agent-card`)。2 行組のカード: 1 行目 = 状態の印・名前・札 (未読の入力待ち・完了)、2 行目 = 補足。プロジェクトはカードにしない (太く大きい見出しの行 + 件数)。場所ごとの補足は `extra` で足す (全体ボードのアカウント・tmux の場所) |
| プロジェクトの色と頭文字 (左のサイドバーの見出し・全体ボード・切替の小窓・タブのグループ・ファイル一覧の頭) | `views/projects/project-looks.ts` の `projectMark` (`.project-mark`、色の四角に頭文字) と `PROJECT_LOOKS`。塗るのは `paintProjectColor` で `data-project-color` を付けて `var(--project-color)` を読む。決まりは `agents.md` の 7「色と頭文字」 |
| 最下段のバー (`#statusbar`) | 押せる塊は `usage-status-item` / `statusbar-icon-action`。流動的な文言は幅を固定した塊の中だけ |
| メインの面の左右の箱 (ターミナル・画像・置き札) | `app.ts` の `PANE_HOSTS` (`.main-pane-host[data-side]`)。前面のタブがターミナル・画像・本文を出していない route のタブ (置き札 `.main-pane-placeholder`) のときだけ `is-shown`。画像は `views/image-tab.ts` を面ごとに 1 つ使い回す。面の境界は `.main-split-divider` (掴みしろ 6px・線 1px・ホバー/ドラッグ中 2px)、右に分割のドロップ先は `.main-split-drop` |
| メインの面のターミナルのタブ | 置き場所は `views/terminal/terminal-view.ts` の `tabPaneFor(side)` (面ごとの枠)。タブの名前はエージェントを映していれば「種類 · 状態」(`agentsText().kind` / `.state`)、絵は状態の印 (`.terminal-mark-*`) |
| ターミナルの画面に付く補助 (出力に出た画像など) | 文字の上に重ねない。画面の箱の中に別の列を取る (`views/terminal/image-shelf.ts` の画像の棚。仕様は `agents.md` の 12) |
| 補助の情報 (大きさ・日時など) | 行にしない。情報のボタン (`.gdp-file-detail-meta` の形: 押せる領域は固定、hover / フォーカスで小さな面) に入れる |
| topbar のトグルボタン | `.controls > button` パターン（`#ignore-ws` `#hide-tests` が実例） |
| セグメント（排他選択） | `.seg` パターン |
| 確認 / 入力ダイアログ | `views/ui-dialog.ts` の `showConfirmDialog` / `showAlertDialog` / `showPromptDialog` / `showFormDialog`。型は 1 つ (面は `--color-overlay`、内側 7 単位、右上の閉じる = 取り消し、ボタンは `gdp-dialog-cancel` / `gdp-dialog-confirm` / 危険は `danger`)。見出しの下の 1 文は `description`。本文の見出しつきの値・コードの枠・箇条書きは `agent-hooks-dialog-*` の部品 (`accounts-dialogs.ts` の `labeled`)。ボタンのクラスを呼び出し側で付け直さない |
| 使用量 (5h / week の割合・バー・リセットまで・いつの値か) | `views/agents/usage-meter.ts` の `usageMeterRow` / `usageObservedText`。全体ボードのカードと最下段のポップオーバーが同じものを使う (場所で見え方を変えない) |
| 全体ボードの操作 | 主の操作は `agents-primary`、枠つきの小さな操作は `agents-secondary`、文字だけは `agents-text-action`、アイコンは `agents-icon-action` (28px 角)。プロジェクトの見出しの開く・起動・⋯ は hover / フォーカスで出し、場所は最初から取る |
| 設定の節 (設定のページ `/settings`) | `views/viewer-settings.ts`、文言は `views/viewer-settings-i18n.ts`。節を足したら `build()` の `categorized` に分類 (`SETTINGS_CATEGORIES`: appearance / agents / accounts / shortcuts / files / advanced。よく使うものが先、最初のものが開いたときの分類) を 1 つ付ける (付けないと全部の分類に出る。並びは分類の並びに合わせる。検索の結果もこの順)。読む人は使う人: 節は見出し → 何のための設定かを 1 文 → 操作。内部の仕組み・ファイルの場所・判定の細部は畳んだ `details` かヘルプへのリンクに回す (判定ルールの JSON は畳み、誤りと「適用中」は畳んだ外に置く)。説明文の 1 段落は日本語 120 文字・英語 240 文字まで (`settings-text-length.test.ts` が設定・フック・アカウント・ショートカットの文言の表をすべて測る。長くなるなら段落を配列で分ける。例外は理由つきでそのテストの `EXCEPTIONS` に)。めったに触らないものは advanced へ。見出しの id は変えずに分類を移す (送り先は見出しを含む分類になる。`viewer-settings.test.ts` の見出しの移し先の表)。左の列・検索欄・見出しは `views/settings-page.ts` が描く (枠は `views/page-shell.ts`、ヘルプのページと共通)。ほかの画面から節へ送るのは `openSettingsAt(見出しの id)` (設定のページを開き、分類も切り替わる。畳んだ `details` の中の id なら開く。実体は `settings-page.ts`)。設定とヘルプが 1 つのページだった頃の `/help?section=settings` は `core/routes.ts` の `parseRoute` が、`/help#<設定の見出し>` は起動時に `headingInHash` が設定のページへ移す。分類の説明の下にヘルプの節への 1 行を置くなら `settings-page.ts` の `CATEGORY_HELP_LINKS` (文字はヘルプの節の名前 `helpSectionName`)。保存はページの下の「変更を保存」1 つ: 節が下書きを持つなら `SettingsDraft` を `drafts` に渡し、節の中に「保存」を置かない (アカウントの節で保存が 2 つになり、利用者が迷った)。保存できない間 (JSON の誤りなど) は `problem()` で理由を返し、ページはどの節も保存しない。節の中の「既定に戻す」も下書きを変えるだけで、保存はページの「変更を保存」(判定ルールの「組み込みルールに戻す」も)。未保存は保存の横の文言 (`data-state="unsaved"`) で示す。分類に節が 1 つだけのときは、その節の見出しを出さない (ページの見出しと同じ役。`scope-settings-section-sole`。検索中は出す) |
| キーの割り当て (設定の「ショートカット」・ヘルプのキーの一覧・キーボードショートカットの小窓 (`?`、`views/quick-help.ts`)・パレットのキー) | 操作の名前と分類は `views/help-keybindings.ts` の `KEYMAP_ACTION_INFO` だけに書く (Record なので操作を足すと書き忘れが型で落ちる)。既定のキーは `core/keymap.ts` (`DEFAULT_KEY_BINDINGS` と、PWA の窓の `pwaKeyBindings`)、利用者の差分を重ねるのは `resolveKeyBindings`、画面に出すのは app の `activeKeyBindings` (ヘルプ) / `shownKeyBindings` (この窓で効くものだけ: title・パレット)。キーの効く所 (入力欄・端末・PWA の窓) は押し方ごと (`KeyChord` の inputs / terminal / pwa)。編集の画面は `views/help-keybinding-editor.ts` |
| ⌘K のパレットの行き先 (ファイル以外) | `views/search-palette-ui.ts` の `PaletteCommand` (群 = projects / agents / sessions / actions。エージェントでないペインとシェルは sessions)。中身は `app.ts` の `paletteCommands()`、操作は `PALETTE_ACTIONS` (キー割り当てのある操作は `keymap` を書けばキーが右に出て、実行も同じ `dispatchKeymapAction`)。ファイルの絞り込み・grep の側には足さない |
| 作業ツリーの一覧の行 | `views/worktree-view.ts`。何も選んでいないときは一覧だけの画面 (`body[data-worktree-overview]`、列は `--worktree-columns`)。行の「開く」はこのときだけ置き、選んだ後の狭い一覧は「…」だけ (選んだ瞬間にボタンを増やさない) |
| Data の表の足元 | `views/database/table-grid.ts` の `db-grid-status` (件数) と `db-grid-pager` (見えている行の範囲と 1 画面ずつのページ送り)。表の行の高さは表示密度の値 (`views/shell/row-height.ts` の `currentRowHeight`、CSS は `--ui-row-h`)、列幅は TS が持つので、CSS は色と線だけ |
| 空の状態の案内 (何も無い場所で次にやること) | `views/empty-state.ts` の `renderEmptyState` (絵・一行・補足・操作 2 つまで・キー 3 つまでをキーキャップで)。形は既存の `.empty` (`.empty-icon`・`h2`・`p`・`.empty-actions` の `.empty-action` / `-primary`) に `.empty-keys` を足したもの。画面の一部に置くときは `compact`。文言は置き場の i18n。実例: 全体ボードのエージェント 0・Search の初期・Tools の入力が空 |
| アイコン SVG | `core/icons.ts` の path 定数 + `iconSvg(className, paths)` |
| ホバーで出る説明 (ツールチップ) | 要素に `title` を書くだけ。`views/title-tooltip.ts` の `installTitleTooltips` (`app.ts` が 1 回だけ取り付ける) が、マウスとペンで約 300ms 後に title の値をそのまま `.title-tooltip` に出す (指では出さない。出している間は title を外して既定の吹き出しと重ねない)。部品ごとに吹き出しを作らない。title に置いた文言がそのまま吹き出しの文言 |

`alert` / `confirm` / `prompt` は `biome.jsonc` が **error で落とす**ので、そもそも書けない。
`views/ui-dialog.ts` を使う。

**新しい UI パターンを足すのは、既存クラスの組み合わせで要件を満たせないことを確認してから。**

## タブの決まり (開く・固定・分割・閉じる)

メインの面のタブ (モデルは `core/main-tabs.ts`、描画は `views/main-tabs/main-tabs-view.ts`) は、
**どの入口から開いても同じ押し方で同じ開き方になる。** 入口ごとに開き方を書き分けない。
押し方は `core/link-click.ts` の `linkOpenIntent` (クリック) と `keyOpenIntent` (Enter) で読み、
開く側は「新しいタブで」なら `MAIN_TABS.openingNewTab(() => setRoute(...))` の中で route を
置くだけ (同期で置くこと。中で `await` すると印が外れて仮のタブになる)。

| 押し方 | 開き方 |
|---|---|
| 1 回押す・Enter | **仮のタブ** (名前が斜体)。その面に仮のタブがあれば置き換える。同じ中身のタブがあればそれを前面に出す (仮なら仮のまま) |
| ダブルクリック・中ボタン・⌘/Ctrl＋クリック・Shift+Enter・右クリックの「新しいタブで開く」 | **固定のタブ** (名前が立体) で足す。同じ中身のタブがあれば前面に出して固定する |
| Alt＋クリック・右クリックの「右に分割して開く」 | 反対の面 (1 面なら右に分けて) |
| Shift＋クリック | ブラウザに任せる (新しいウィンドウ。行はリンク) |

- **同じ中身**はファイルならパスと版 (`TabTarget` の `ref`。作業ツリーの版は `ref` を持たない)。
  **版が違えば別のタブ** (History から開いたコミットの版が、作業ツリーの版のタブを差し替えない)。
  同じ版で行の指定だけ違うのは同じタブ。作業ツリー以外の版のタブは名前に版の短い印を添える
  (`a.ts @ 1a2b3c4`。コミットの sha は 7 文字、ブランチ・HEAD はそのまま。title は版の全体)。
  保存の形は `LAYOUT_VERSION` 4 (3 までの保存は作業ツリーの版として読む)
- **仮のタブを固定する**: タブのダブルクリック・タブの右クリックの「開いたままにする」・固定の押し方で開き直す。
  ファイルのタブの中身は読むだけなので、「中身を編集したら固定」に当たる操作は今は無い
- **横に並べる (2 面)** の入口は 4 つ。タブの右クリックの「右に分割」・Alt＋クリック・タブを右端の帯
  (`.main-split-drop`。ドラッグ中だけ本文の右半分に出し、一覧の列は覆わない) へドラッグ・タブ列の分割のボタン。
  分割のボタンは前面がファイル・ターミナル・画像のときだけ押せ、押せないときは**押せない理由だけ**を
  title に出す (`splitBlocker` の理由ごとの文言。条件を全部並べない)
- 2 面のとき、開く面は**フォーカスのある面** (画面のタブは左の面だけ)。フォーカスは面の中を押す・
  タブを押すで移る。**フォーカスのある面の印は 2 つ**: 前面のタブの上端の線 (`.main-tab-focused`、タブの幅)
  と、その面のタブ列の下端の線 (`body.main-split .main-tabs-pane-focused::after`、面の幅いっぱい)。
  どちらも `--color-accent` の 2px。1 面では下端の線を出さない。**選択中のタブの印**は寸法を変えない
  (幅は中身で決まるので `font-weight` も使わない): 面 (`--color-tab-active`)・本来の文字色・上端の
  2px の線 (もう一方の面の選択中は `--color-text-3` の `box-shadow: inset`、フォーカスのある面の選択中は
  上の強調色の線・強調色の絵・`-webkit-text-stroke` で太い名前)。下端の線はグループの色なので使わない
  (検査は `main-tabs-active-css.test.ts`)。地・タブとの色の差はダーク / ライト、
  3 つの色違い、密度 4 段で 4.95:1 以上 (実測)
- **URL はフォーカスのある面の前面のタブ**に合わせる (右の面のファイルなら `pane=right`)。左の前面が
  替わって本文を裏で移すとき、フォーカスが右の面に残るなら履歴を積まず (`followRouteSide` の
  replace)、移した後に `syncFocusedPaneUrl` で右の面の URL へ戻す (app の `navigate`。分割のボタンで
  右に出した直後に、URL が左の面のファイルのまま残っていた)
- **閉じる**: タブの ×・中ボタン・`g x`・タブ列の Delete。閉じたら同じ面の最近使った順で次を前面に。
  画像のタブは上の段の右端の「閉じる」(X・文字・`Esc`) と、フォーカスがある間の Esc でも閉じる (本文いっぱいに
  開くとタブ列の小さな × しか閉じ方が無かった)。端末から開いた画像を閉じたら開いたシェルへ戻す
  (2 面では画像は反対の面に開くので、上の規則だけではフォーカスが画像の面に残る。`views/image-tab-return.ts`)
  ブラウザのタブの中では ⌘W / Ctrl+W はブラウザのタブを閉じる (取らない。`core/keymap.ts` のコメント)
- **閉じたタブを開き直す**: 利用者が閉じたタブ (上の閉じ方) を全体で 1 本の履歴に新しい順で 10 件まで
  積み (`core/main-tabs.ts` の `pushClosed`)、`reopenClosed` が固定のタブで**閉じた面の元の位置**に
  開き直す (位置が無くなっていればその面の末尾、面が無ければ左の面の末尾)。シェルが消えて閉じたタブは
  積まない。保存しない
- **戻る・進む**は本文 (URL) だけを動かし、タブの配置は変えない。その route のタブがどちらかの面に
  あれば前面に出すだけで、新しい仮のタブは作らない (右の面にだけあるファイルは右の面の前面に。
  app の popstate と `MAIN_TABS.sideHolding`)
- **PWA (インストールした窓)** ではブラウザのタブのキー (⌘/Ctrl+W・1〜9・Ctrl+Tab・⌘/Ctrl+← → など) がアプリの
  タブに効く。どのキーを何に振り向けるかの既定は `core/keymap.ts` の `pwaKeyBindings` だけに書き (ここに
  写さない。利用者は設定の「ショートカット」で変えられる)、割り当てが無くても窓を閉じさせないキーの一覧は
  `core/pwa.ts` の `PWA_WINDOW_KEYS`。振り向け先は上と同じタブの操作 (閉じる・次 / 前・n 番目・最後、最後に
  閉じたタブは `MAIN_TABS.reopenClosed()`) で、PWA だけの開き方・閉じ方を作らない。ブラウザのタブの中では
  既定では変えない (⌘← → は戻る / 進むのまま)
- **「＋」は最後のタブのすぐ右** (列の右端ではない。ブラウザのタブと同じ)。タブが増えれば一緒に右へ動き、
  列に入りきらず横に送るときも一緒に送られる。前面が最後のタブなら ＋ まで見せ、＋ を押した直後
  (⌘/Ctrl+T も) は ＋ が見える位置まで送る。タブが 0 枚なら列の左端。分割のボタン・預けの札は列の外の
  右端のまま。作りは `.main-tabs-strip` (横に送る箱・幅の入れ物) の中に、タブだけを持つ
  `.main-tabs-list` (role=tablist、配置では `display: contents`) と `.main-tabs-new`
- **タブの幅は中身** (絵・名前の全文・閉じる)。上限は 200 (ターミナルは 240)。列に入りきらないときだけ
  全部のタブを同じ割合で縮め (`core/tab-widths.ts` の `fitTabWidths`。画面は `main-tabs-view.ts` の
  `fitTabs` が各タブの `--main-tab-w` に書く)、名前が 8 文字ほど (日本語 5〜6 文字) 読める下限
  (`TAB_FLOOR_UNITS`) で止め、その先は列を横に送る。列の幅をタブの数で割った幅にそろえない (1280 で
  名前が 1〜2 文字しか読めなかった)。畳んだグループのタブも中身の幅と隙間で数に入れ、札の枚数は除く
  (畳む・開くで割合が変わると、畳んだグループより左のタブが動く)
- **タブ列のキー**: Tab で列に入る (前面のタブだけ `tabindex=0`)・←→ Home End でタブを移る・
  Enter / Space で前面に・Delete で閉じる・Ctrl+Shift+PageUp / PageDown で並べ替え (OS やブラウザが
  先に取る環境のために Ctrl+Shift+← → と ⌘+Shift+← → も同じ。右クリックの「左へ移す」「右へ移す」でも)・
  Shift+F10 / ContextMenu で右クリックのメニュー (閉じたら同じタブへ戻る。メニューの間にタブ列が
  描き直されても id で探し直す)
- **ドラッグ中の落とせる場所**: タブの間は縦の線 (`.main-tab-drop-before` / `.main-tabs-drop-end`)、
  右に分割は破線の帯。掴んだタブは薄くする (`.main-tab.main-tab-dragging`。body には別の印
  `main-tab-drag-active` を付け、画面全体を薄くしない)
- 右クリックの項目名は英日で同じ語を使う: 新しいタブで開く / Open in new tab、右に分割して開く /
  Open to the right、開いたままにする / Keep open、右に分割 / Split right、左へ移す / Move left、
  右へ移す / Move right

### タブのグループ (全プロジェクト共通のタブ)

タブは全プロジェクト共通の 1 つの配置で、どのプロジェクトを見ていても同じタブが並ぶ (2026-09-23 に
利用者と決めた。設計: タブとプロジェクト)。タブは持ち物のプロジェクトを持つ (`core/main-tabs.ts` の
target の `project`、判定は `isProjectKind`): ファイル・リポジトリの画像・Diff / History / 作業ツリー /
Search / Data / Work log はそのプロジェクト、シェルはそのシェルが動いているフォルダのプロジェクト
(`app.ts` の `terminalProjectOf`)、全体ボード・Tools・設定・ヘルプ・ターミナルに出た画像と、どの
プロジェクトにも入らないシェルは「どのプロジェクトのものでもない」。

- **グループ**: タブ列は面ごとに、プロジェクトのグループに分けて並ぶ (`regroup`・`tabGroups`)。
  グループの並びは左の一覧のプロジェクトの並び (`PROJECT_LOOKS.order()`)、中のタブの順は利用者が
  並べたとおり。どのプロジェクトのものでもないタブは右端に色なしで。**タブを別のグループへは移せない**
  (ドラッグは落とす先にせず印も出さない・左へ / 右へ はグループの端で止まる。持ち物が違う)
- **札**: グループの頭に、色の四角と頭文字 (`projectMark`) と ▾ だけ。名前は title・aria-label と
  ▾ のメニューの頭 (一覧の列の頭の 1 段目に同じ名前が出ているので、札に並べると 2 回出て、タブの幅を
  食った)。札を押すと畳む / 開く (畳むと頭文字の横に枚数。札の右が伸びる。前面のタブは畳んでも見せる)。
  ▾ (と札の右クリック) のメニューは、頭にプロジェクトの名前、区切って「新しいシェル」「新しい
  エージェント…」、区切って「このプロジェクトに切り替える」「畳む / 開く」、区切って「このグループを
  閉じる」。並びと押せるかは `main-tabs-view.ts` の `groupMenuFor` だけが決める (app は材料の
  `groupFacts` と作り方だけを渡す)。「新しいシェル」は ＋ と同じ `app.ts` の `openShellIn` に
  そのプロジェクトを渡し、その札の面に開いて前面に出す (カレントは入口が要求の鍵で決める。別の
  プロジェクトの鍵は `projectKeyFor` で、動いていなければ起こして知る)。「新しいエージェント…」は
  そのプロジェクトを選んだ起動の画面。グループごとの ＋ は置かない。グループのタブと札の下端に、
  その色の 2px の線
- **いま見ているプロジェクトの札は必ず出す**: 左の面にそのプロジェクトのタブが 0 枚でも、並びの
  位置に空のグループ (札と空の並び) を描く (`main-tabs-view.ts` の `groupsOf`。描画だけで、配置と
  保存には入れない)。フォルダ表示はタブにしないので、エージェントの居ないプロジェクトを開くと札が
  出ず、tmux が無いと出ないように見えた。空の札は押しても畳まず、▾ の「畳む」「このグループを閉じる」
  は押せない (`groupMenuFor`)。幅は `fitTabs` が札として数える
- **並び**: グループがあるときの列は [グループ…][＋][どのプロジェクトのものでもないタブ (右端に寄せる)]。
  グループが無ければ今までどおり [タブ][＋]
- **＋**・木・パレットで開くファイルは、いま見ているプロジェクトのグループに入る (前面が同じグループ
  ならその右、別のグループならそのグループの末尾)。**仮のタブは面ごと・プロジェクトごとに 1 つ**
  (別のプロジェクトで見ていた仮のタブを置き換えない)
- **いま見ているプロジェクト** (ファイル一覧・Diff・History が見せるもの) はページの `/p/<鍵>`。
  左の一覧のプロジェクトの見出し・⌘⇧↑↓ (Windows / Linux は Ctrl+Shift。`core/keymap.ts` の
  `project-previous` / `project-next`)・▾ の「切り替える」・切替の小窓 (p)・パレットのプロジェクトで
  移る (読み直し。どれも `app.ts` の `switchToProjectGroup`)。前面はそのグループで最後に
  前面だったタブ (`groupFront`。配置の `groupFronts`)、無ければそのプロジェクトのフォルダ表示
- **別のプロジェクトのタブを前面に出す**: ファイル・シェル・画像はその場で面の箱に出す (ファイルは
  そのプロジェクトの `/p/<鍵>` から読む。`app.ts` の `showForeignFile`。ファイル一覧はいまの
  プロジェクトのまま。入口のサーバの下だけで、1 つで完結するサーバでは移って出す)。Diff・History・
  作業ツリー・Search などの画面は、そのプロジェクトへ移って (読み直して) 出す。移るのは利用者がその
  タブを前面に出したときだけで、閉じた後の次の前面が別のプロジェクトの画面になるときは移らずに
  このプロジェクトのタブ (無ければフォルダ表示) にする
- **窓が 2 つ**: 保存は前に読んだ版 (`rev` と値) を添えて書き、別の窓が先に書いていればサーバが
  重ねる (`core/main-tabs-merge.ts`: 開いた・閉じた・並べ替えた・前面は窓ごと)。もう一方の窓は SSE の
  `tabs` で取り直して重ねる (`refreshFromServer`)

入口ごとの例外 (表に無い入口は上の表のとおり):

| 入口 | 例外 |
|---|---|
| 画面 (Diff・History・作業ツリー・Data・Search・Tools・設定・ヘルプ・全体ボード) | 画面のタブは種類ごとに 1 つで常に固定 (仮にしない: 中身が route で変わるので置き換えると見ていた状態が消える)、左の面だけ (本文を描く場所が 1 つ)。1 回押す・Alt はそのタブを前面に出す。一覧の列の頭の画面の入口 (`.view-strip-item` はリンク) の中ボタン・⌘/Ctrl はブラウザに任せる (アプリの中では 1 回押すと同じになるので、別の窓で開ける意味を残す) |
| Diff の一覧・History のファイルの一覧 | 1 回押すは画面の中の移動 (その差分へ送る)。固定の押し方と Alt は、そのファイルをファイルのタブ (その差分の新しい側の版、消したファイルは古い側) で開く |
| 木のフォルダの行 | フォルダ表示はタブにしない (左の面の本文の既定)。修飾キーはブラウザに任せる |
| ターミナル (左のサイドバーのエージェントの行・全体ボードの行・パレットのセッション・＋) | 常に固定 (仮にしない: 置き換えるとシェルの画面と打ちかけの文字が消える)。1 つのシェルは 1 か所にしか置けない。1 回押す・中ボタン・⌘/Ctrl はどれも開くか前面に出す (固定の新しいタブを足す意味が無い)。Alt は反対の面 (1 面なら右に分けて)。右ボタンは開かない (右クリックのメニュー) |
| 端末に出た画像のリンク・画像の棚 | 1 回押すは画像のタブ (仮) を反対の面に開く (端末を隠さない)。中ボタン・⌘/Ctrl・棚の右クリックの「新しいタブで開く」は固定のタブ。Alt (棚は Shift も) は大きく開く覆い。端末の中のリンクの Shift は xterm の選択に任せる |
| URL (読み込み・戻る / 進む) | 仮のタブ。保存した配置に同じ中身があればそのタブ |

## 色・余白・角丸・文字は名前だけを使う

見た目の決まりは `web/style.css` の先頭にまとめてある (名前の層)。部品はこの名前だけを読む。
**16 進の色・生の px を部品の規則に新しく書かない。**

| 何 | 名前 |
|---|---|
| 面の段階 | `--color-ground` (窓の地・上の行・最下段) / `--color-nav` (サイドバー) / `--color-tree` (ファイルのツリー) / `--color-doc` (本文) / `--color-code` (コードの面: ソース表示・差分) / `--color-inset` (本文の中の沈んだ面) / `--color-raised` (hover) / `--color-select` (選んでいる行) / `--color-term` |
| 構文の色 | `--syntax-text` / `--syntax-keyword` / `--syntax-string` / `--syntax-type` / `--syntax-function` / `--syntax-comment`。shiki の github テーマの色と highlight.js のクラスは `style.css` の B-1 の節と diff2html の節で名前へ差し替える。コメントもコードの面と差分の面で 4.5:1 以上 |
| 差分の文字 / 履歴のグラフ | `--diff-add-fg` / `--diff-del-fg` (面は `--diff-*-bg`)。`--graph-main` (主線) / `--graph-branch` (分かれた線)。状態の色と混ぜない |
| 文字の段階 | `--color-text` / `--color-text-2` / `--color-text-3` / `--color-on-accent` |
| 線 | `--color-line` / `--color-line-soft` / `--color-line-strong`。**線は最後の手段。** 面の明るさの差で分けられるなら線を引かない |
| アクセントと状態 | `--color-accent` / `--color-accent-strong`、`--color-waiting` `--color-working` `--color-done` `--color-failed` `--color-idle` |
| プロジェクトの色 | `--project-<色>` (`core/project-colors.ts` の `PROJECT_COLORS` と `none`)・頭文字の `--project-ink`。部品は `data-project-color` の下で `--project-color` を読む。色違いのダーク (graphite / warm) もダークの 1 組を使う |
| 選んでいる行の光 | `--glow-select` (内側の box-shadow。箱の寸法を変えない) |
| 余白 / 角丸 | `--space-1`〜`--space-6` (4〜32px) / `--radius-sm` `--radius-md` `--radius-lg` |
| 文字の大きさ・行の高さ | 密度の段階 (T0): `--ui-font-*`・`--ui-control-*`・`--ui-row-h`・`--ui-table-row-h` (`ui-layout.md`、下の決まり 7) |
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
   | 左のサイドバー・ファイル一覧・一覧の列の頭 (`#panel-head`)・最下段 | `--pad-face` (8) | `--pad-text` (16) |
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
7. **行の高さは 2 種類だけ。どちらも名前で読み、別の数値で書かない。**
   - **一覧の行は `--ui-row-h`** (サイドバー・ファイルのツリー・目次・変更ファイル・セッションの一覧・
     全体ボードのプロジェクトの見出し・履歴の日付の見出し)。出所は `views/shell/row-height.ts`
     (表示密度ごと)。ファイルのツリーの仮想表示もここを読む。Data の表 (`table-grid.ts` の仮想表示は
     `currentRowHeight`、密度が変わると描き直す) と、Data の他の面の静的な表の行も同じ高さ
   - **表の行は `--ui-table-row-h`** (列を持つ行: 履歴のコミットの一覧・全体ボードのエージェントの行)。
     一覧の行より一段ゆったりさせ、列の文字が詰まって見えないようにする。仮想表示に使わないので
     出所は `style.css` の `html, body` ブロックだけ (`--space-unit` から作るので密度に比例する)。
     仮想表示で使うことになったら、`--ui-row-h` と同じく TS を出所にする
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

タブ列・一覧の列の頭・左のサイドバー・最下段のバー・topbar・コンパクトなツールバー・テーブルのフィルタ行・
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
| 設定のページ | `views/viewer-settings-i18n.ts` (フック・アカウントの節は `views/agents/i18n.ts`・`accounts-i18n.ts`、ショートカットは `help-keybinding-editor.ts`) |
| Files のフォルダ表示 | `views/repo-view-i18n.ts` |

- 言語はアプリ全体の設定（`app.ts` の `STATE.language`、`en` / `ja`）
- 言語切替時のライブ反映は各 view の `localize()` が担当する。**テーブルに足したら
  `localize()` で反映されるか確認する**（足しただけでは切替時に古い文言が残ることがある）
- 新しい画面を足すなら、同じ形で `i18n.ts` を作る

## Help ページと README への反映

CLI のサブコマンド・フラグ・画面の操作が変わったら、**同じ変更で**次を更新する。

- `web-src/views/help-page.ts` の `HELP_CONTENT` — **`en` と `ja` の両方**
- ヘルプの「やり方」の案内 (アカウントの追加・エージェントの起動・プロジェクトの追加・AI に任せる) は
  `web-src/views/help-guides.ts`。ボタンや画面の名前は各画面の i18n の値を `guideLabels` で集めて
  組み立てる (文字を写さない。`help-page.test.ts` が、案内が使う名前を全部出していることを見る)。
  手順の順番やボタンが変わったら文も直す
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
