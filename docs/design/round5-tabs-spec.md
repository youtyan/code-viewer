# Round 5 仕様書 — Database タブ機能

`feature/other-datasource` ブランチで作業。Round 4 (recursive compose
discovery) 完了直後の状態を base にする。

Database 画面が現状「`<select>` 1 個で 1 つの DB しか開けない」状態で、
複数 DB を並べて使えない。Chrome のタブのように **画面全体 (サイドバー
+ メイン pane + 履歴 pane) を 1 タブの単位として複数開ける** ように
する。同じ DB を別タブで 2 つ開いてもよい。

タブ構成は `.code-viewer/tabs.json` にサーバー側永続化し、リロード /
再起動でも復元される (query-history と同じ思想)。

`docs/design/datasource-abstraction.md` の上位設計と Round 1〜4 で確定
した抽象には触れない。

---

## 0. 大前提

- 既存の sqlite / postgresql / mysql / redis / elasticsearch 表示
  ロジックは**ほぼ触らない**。既存単一画面のロジック (`createDatabaseView`)
  を **`createTabPane(deps)` factory に切り出して再利用**する形にして、
  外側に「タブを束ねる container」を追加する。
- 「触らない」ファイル (Round 2 / 3 / 4 共通):
  `snapshot-store.ts` / `snapshot-runner.ts` / `query-history.ts` /
  `connection-pool.ts` / `global-search.ts` /
  `adapters/{sqlite,docker,redis,elasticsearch}.ts`。
- 実装追記: Round 5 後の UI 修正で `redis-explorer.ts` /
  `elasticsearch-explorer.ts` は dispose/AbortController と共通 CSS class のため
  変更済み。`adapters/redis.ts` / `adapters/elasticsearch.ts` も型接続と
  docker utility 共通化で変更済み。`snapshot-store.ts` /
  `snapshot-runner.ts` / `query-history.ts` / `connection-pool.ts` /
  `global-search.ts` / `adapters/sqlite.ts` / `adapters/docker.ts` は
  本タスクでは新規 diff を入れない保護対象として扱う。
- サイドバーの `<select>` は **各タブ内に従来通り残す**。タブを切替えれば
  そのタブが開いている DB に戻る。同じ DB を別タブで 2 つ開ける。
- 既存の `dockerAdapterCache` / `connection-pool` は dbId base なので、
  同じ DB を複数タブで開いても **adapter instance は 1 つを共有** する
  (メモリ節約)。
- URL クエリパラメータ (`?screen=database&db=...&table=...&tab=...`) は
  **active タブの state を表現**するだけ。タブ全体の保存は tabs.json
  に任せる。
- ブラウザ間で同じプロジェクトを開いたとき、両方が同じタブ構成を
  見るのが正しい (= localStorage ではなくサーバー側ファイル永続化)。

---

## 1. 達成条件

`bun run preview --cwd <project>` を起動して `/database` を開いたとき:

1. 上部に **タブバー** が出る。各タブは閉じる × ボタン付き、右端に
   `+` ボタンで新規タブ追加。
2. 各タブはそれぞれ独立した `<select>` / サイドバー / grid / pane を
   持ち、別 DB を同時に複数開ける。同じ DB を別タブで開いてもよい。
3. タブをクリックで切替。アクティブタブは下線 + 明色でハイライト。
4. × で閉じる。最後の 1 タブを閉じようとした場合は、空 (DB 未選択)
   状態にリセットして残す (タブが 0 個になることはない)。
5. 構成は `.code-viewer/tabs.json` に永続化。リロード / 再起動で
   復元される。
6. URL を直接 `?db=docker:foo` 等で叩いたとき、active タブの DB として
   開く (既存挙動維持) + tabs.json にも反映。
7. `bun run verify` 全パス。
8. 既存 sqlite / postgresql / mysql / redis / elasticsearch のいずれにも
   退行なし。

---

## 2. 触るファイル

### 新規

| ファイル | 役割 |
|---|---|
| `web-src/server/database/tabs-store.ts` | `.code-viewer/tabs.json` の load/save。query-history.ts と同パターン。 |
| `docs/design/round5-tabs-spec.md` | この仕様書。 |

### 既存への変更

| ファイル | 変更内容 |
|---|---|
| `web-src/core/database/types.ts` | `TabState` / `TabsState` / `TabsResponse` 型を追加。 |
| `web-src/server/database/handle.ts` | `GET /_db/tabs` と `PUT /_db/tabs` の handler を追加 (handleDatabaseRoute の中に置く)。 |
| `web-src/views/database/database-view.ts` | 既存単一画面ロジックを `createTabPane(deps)` factory に分解し、`createDatabaseView` を **複数 TabPane を束ねる container** に書き換える。タブバー UI と + / × ボタン、タブ切替、永続化 fetch / debounced PUT を実装。 |
| `web/style.css` | タブバー (`.db-tabs-bar` / `.db-tab-chip` / `.db-tab-close` / `.db-tab-new-btn`) のスタイルを追加。 |
| `.gitignore` | `.code-viewer/tabs.json` を確認 (`.code-viewer/` は既存で gitignore 済みのはずなので追加不要のことが多い)。 |
| `README.md` | タブ機能と永続化挙動を 1 段落追記。 |

### 触らないファイル

`snapshot-store.ts` / `snapshot-runner.ts` / `query-history.ts` /
`connection-pool.ts` / `global-search.ts` / `adapters/*` /
`views/database/{redis-explorer,elasticsearch-explorer,table-list,
table-grid,query-editor,query-history-view,schema-view,er-diagram,
snapshot-view,global-search-view}.ts` (UI コンポーネント単位は
TabPane 内で従来通り再利用するだけ、内部実装は変更しない)。

実装追記: tab D&D、kind 別 visibility、font-size 連動、Query History refresh
の修正により、`database-view.ts` と一部 child view (`query-editor.ts` /
`table-grid.ts` / Redis・Elasticsearch explorer) は実装変更済み。
この節は当初設計時の制約であり、現行のレビュー修正では上記保護対象のみを
「新規 diff なし」として確認する。

---

## 3. データモデル

### TabState

```ts
type TabState = {
  // UUID v4 相当のランダム文字列。タブごとに unique。
  id: string;
  // 開いている DB の id (`docker:<svc>` / `docker:<svc>@<dir>` /
  // sqlite ファイルパス)。未選択タブの場合は null。
  dbId: string | null;
  // 現在選択中のテーブル / index 名 (SQL/ES のみ)。未選択時 null。
  table: string | null;
  // 内側のビュータブ (data / query / schema / er / search / snapshot)。
  view: "data" | "query" | "schema" | "er" | "search" | "snapshot";
};

type TabsState = {
  version: 1;
  tabs: TabState[];
  activeTabId: string | null;
};
```

### tabs.json

`.code-viewer/tabs.json`:

```json
{
  "version": 1,
  "tabs": [
    { "id": "t-abc123", "dbId": "docker:redis-svc@data%2Ftest%2Fredis", "table": null, "view": "data" },
    { "id": "t-xyz789", "dbId": "docker:es-svc@data%2Ftest%2Felasticsearch", "table": null, "view": "data" }
  ],
  "activeTabId": "t-abc123"
}
```

### API

| Method / Path | Body / Query | Response |
|---|---|---|
| `GET /_db/tabs` | (なし) | `TabsResponse` (= `TabsState` をそのまま) |
| `PUT /_db/tabs` | `TabsState` JSON | `{ok: true}` |

`PUT` は `sideEffectAllowed` の対象 (=CSRF 対策 `X-Code-Viewer-Action`
header 必須)。

---

## 4. UI

### 配置

```
┌───────────────────────────────────────────────────────────┐
│ [Tab1 ×] [Tab2 ×] [Tab3 ×] [+]    ← 新規追加: 外側 DB タブバー │
├───────────────────────────────────────────────────────────┤
│ ┌──────────┬────────────────────────────────────────────┐ │
│ │ sidebar  │ main pane (grid/redis/es 等)               │ │
│ │ <select> │ ┌ Data | Schema (内側ビュータブ)            │ │
│ │ tableList│ │                                          │ │
│ │ tools    │ │                                          │ │
│ ├──────────┼────────────────────────────────────────────┤ │
│ │ history  │ history pane                               │ │
│ └──────────┴────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────┘
```

### タブチップの表示

- アクティブタブ: 下線 + 明色背景
- 非アクティブ: グレー
- ラベル: 開いている DB の表示名 (現状 `<select>` に出している
  ラベルと同じ)。未選択タブは `"(empty)"`。
- × ボタン: hover で表示、クリックで閉じる
- 中クリック (auxclick button=1) でも閉じる (optional、簡単なので入れる)

### + ボタン

- 押すと未選択 (`dbId=null`) の新規タブを末尾に追加 → アクティブ化
- ユーザーが `<select>` で DB を選んだ瞬間に `dbId` がセットされ、
  tabs.json に反映 (debounce 500ms)

---

## 5. URL とタブの関係

- URL は **active タブの state** を表現。タブ切替で URL を replace。
- 既存の `?db=...&table=...&tab=...` パラメータはそのまま動く (active
  タブの dbId / table / view を上書きする方向)。
- ただし、URL に書いていないタブも tabs.json から復元される (= URL に
  指定された state は active タブにマージするだけで、他タブを消さない)。

---

## 6. コミット分割

5 commit を予定:

1. **RT-C1**: 仕様書 (このファイル) 追加。
2. **RT-C2**: `tabs-store.ts` 新設 + `core/database/types.ts` に
   `TabState` / `TabsState` 型追加 + `handle.ts` に GET/PUT `/_db/tabs`
   endpoint 追加。client 側は触らない (server 単独で動作確認可能)。
3. **RT-C3**: `database-view.ts` を multi-tab 構造にリファクタ。既存
   単一画面ロジックを `createTabPane(deps)` factory に切り出し、
   `createDatabaseView` を「複数 TabPane を束ねる container」に
   書き換え。タブバー UI と + / × ボタン、タブ切替を実装。永続化は
   まだ繋がない (in-memory のみ)。
4. **RT-C4**: 起動時 `GET /_db/tabs` で復元、タブ操作で debounce PUT。
   URL とタブの相互反映を完成させる。
5. **RT-C5**: README に 1 段落追記。

各 commit で `bun run verify` 通すこと。コミットメッセージは ひらがな
必須 + Conventional Commits。

---

## 7. 受け入れチェックリスト

- [ ] `bun run verify` 全通過
- [ ] サイドバー `<select>` が各タブ内に従来通り存在
- [ ] 同じ DB を 2 つの別タブで開けること (タブ id ≠ DB id)
- [ ] × で閉じられる。最後の 1 タブは「空タブにリセット」される
- [ ] `+` で空の新規タブを追加できる
- [ ] リロードでタブ構成が復元される (tabs.json 経由)
- [ ] `?db=...` で URL を直接叩いた場合、active タブの dbId に
      反映される (他タブを潰さない)
- [ ] `/_db/tabs` レスポンスから機密情報が漏れない (tabs.json 自体に
      env / credential を含めない設計なので、tabs.json から漏れる経路は
      無いことを構造で保証する)
- [ ] 既存 sqlite / postgresql / mysql / redis / elasticsearch のいずれにも
      退行なし
- [ ] 「触らない」ファイル list に diff なし

---

## 8. やってはいけないこと

- snapshot メタや query-history のスキーマを書き換える (互換性破壊)
- adapter 系コードを触る (タブは UI 層 + 永続化層だけの話)
- 各タブごとに adapter instance / connection を別々に持つ (dbId base
  の既存 cache を共有する)
- localStorage でタブを永続化する (サーバー側ファイル方式に統一)
- 機密情報を tabs.json に書く (dbId はそのまま書くが、env や password
  は含めない)

---

## 9. 完了報告

- 全 commit の `git log --oneline`
- `git diff --stat` (Round 4 完了直後との差)
- 既存単一 DB 操作に退行が無いこと
- 複数タブを開いた状態でリロードしてタブが復元されること
- 「触らない」ファイルに diff がないこと

---

## 10. 次の Round 候補

- Round 6: ドラッグ&ドロップでタブ並び替え + middle-click 閉じる
- Round 7: Cmd+T / Cmd+W / Cmd+1..9 キーボードショートカット
- Round 8: タブグループ (色付け / 名前付け)

これらは Round 5 のスコープ外。
