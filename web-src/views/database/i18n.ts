// データベースビューアの文言ローカライズ。アプリ全体の言語設定
// (app.ts の STATE.language / 設定の en/ja トグル) と同じ値で切り替える。
// アプリ shell 側は app.ts の UI_TEXT を使うが、DB ビューアは独立した
// DOM 構築なので、ここに DB 用の文字列テーブルを置く。
//
// 言語切替時のライブ反映は database-view 側の localize() が各コンポーネントの
// DOM を再適用することで行う（localizeViewerChrome から呼ばれる）。

export type DbLang = "en" | "ja";

export type DbText = {
  // データストア上部のタブ / ツールバー / セレクト等の chrome。
  nav: {
    dataTab: string;
    schemaTab: string;
    selectDatastore: string;
    selectSchema: string;
    toolbar: string;
    query: string;
    queryTitle: string;
    er: string;
    erTitle: string;
    search: string;
    searchTitle: string;
    snapshot: string;
    snapshotTitle: string;
    queryHistory: string;
    queryHistoryTitle: string;
    newTab: string;
    closeTab: (label: string) => string;
    loadingSchema: string;
    noDatastores: string;
    dockerLimitReached: string;
    // Rails 命名規約 (<name>_id → <names>.id) からの仮想 FK 推測トグル。
    inferFkLabel: string;
    inferFkTitle: string;
    // 推測 FK の右ペインリストに付ける小バッジ。
    inferredBadge: string;
    inferredBadgeTitle: string;
  };
  // データグリッド本体。
  grid: {
    searchPlaceholder: string;
    columnFilterPlaceholder: (column: string) => string;
    exportAction: string;
    foreignKeyHint: string;
    relatedEmpty: string;
    statusRows: (n: string) => string;
    statusSort: (column: string, dir: string) => string;
    statusFilters: (n: number) => string;
  };
  // 行編集 / 新規追加 / 削除。
  edit: {
    editMode: string;
    editModeTitle: string;
    newRow: string;
    commit: string;
    discard: string;
    deleteRow: string;
    undoDelete: string;
    setNull: string;
    dblclickToEdit: string;
    pending: (n: number) => string;
    committing: string;
    commitError: (message: string) => string;
    confirmDiscard: string;
    noPrimaryKey: string;
  };
  // スキーマビュー。
  schema: {
    columns: string;
    foreignKeys: string;
    indexes: string;
    triggers: string;
    ddl: string;
    copyDdl: string;
    copied: string;
    colName: string;
    colType: string;
    colNullable: string;
    colPk: string;
    colDefault: string;
    colComment: string;
    refTable: string;
    refColumn: string;
    idxName: string;
    idxColumns: string;
    idxUnique: string;
    yes: string;
    no: string;
  };
  // クエリエディタ。
  editor: {
    sqlPlaceholder: string;
    run: string;
    runTitle: string;
    explain: string;
    explainTitle: string;
    localHistory: string;
    localHistoryTitle: string;
    running: string;
    explaining: string;
    failed: string;
    noColumns: string;
    noRows: string;
    historyLoading: string;
    historyEmpty: string;
    historyError: string;
    statusError: (ms: number) => string;
    statusSuccess: (rows: number, suffix: string, ms: number) => string;
    statusExplain: (ms: number) => string;
  };
  // クエリ履歴ペイン。
  history: {
    refresh: string;
    refreshTitle: string;
    clearAll: string;
    clearTitle: string;
    selectPlaceholder: string;
    empty: string;
    useInEditor: string;
    copySql: string;
    copied: string;
    delete: string;
    confirmDelete: string;
    confirmClear: string;
    truncatedRows: (saved: number, total: number) => string;
  };
  // セッションログペイン (session 限定。SQL 実行 / 編集コミットの成否を記録)。
  sessionLog: {
    tabLabel: string;
    historyTabLabel: string;
    clear: string;
    clearTitle: string;
    empty: string;
    selectPlaceholder: string;
    statusOk: string;
    statusError: string;
    kindQuery: string;
    kindMutate: string;
    useInEditor: string;
    copy: string;
    copied: string;
    autoFollow: string;
    autoFollowTitle: string;
    commitLabel: (changes: number) => string;
  };
  // ER 図。
  er: {
    zoomIn: string;
    zoomOut: string;
    zoomReset: string;
    copyMermaid: string;
    copyMermaidTitle: string;
    copied: string;
    noTables: string;
    loadError: string;
    renderError: string;
  };
  // 全テーブル横断検索。
  search: {
    placeholder: string;
    searchButton: string;
    cancelButton: string;
    includeNonText: string;
    starting: string;
    cancelled: string;
    checkingTable: string;
    error: (message: string) => string;
    done: (tables: number, hits: number) => string;
    progress: (
      currentTable: string,
      pct: number,
      scanned: number,
      total: number,
      hits: number,
    ) => string;
    tableSection: (label: string, count: number) => string;
    moreHits: (n: number) => string;
  };
  // スナップショット & 差分。
  snapshot: {
    guideTitle: string;
    guideBody: string;
    create: string;
    refresh: string;
    cancel: string;
    cancelling: string;
    creating: string;
    selectTablesHeader: string;
    selectAll: string;
    deselectAll: string;
    notePlaceholder: string;
    noteLabel: string;
    confirm: string;
    empty: string;
    editNote: string;
    delete: string;
    deleteConfirm: string;
    diffManual: string;
    comparing: string;
    calculatingDiff: string;
    diffError: string;
    noChanges: string;
    before: string;
    loading: string;
    loadError: string;
    saveNote: string;
    noteInputPlaceholder: string;
    inserted: string;
    updated: string;
    deleted: string;
    tableCount: (n: number) => string;
    rowCount: (n: number) => string;
    listTitle: (n: number) => string;
    diffSummary: (changed: number, unchanged: number) => string;
    showingRows: (shown: number, total: number) => string;
    label: (date: string, tables: number, note: string) => string;
    statusRunning: string;
    statusError: string;
    statusDone: string;
    progressLabel: (table: string, index: number, total: number) => string;
    progressFinalizing: string;
    aborted: string;
    failed: string;
    errorPrefix: string;
    compareBeforeBadge: string;
    compareAfterBadge: string;
    diffShowing: (before: string, after: string) => string;
    filterPlaceholder: string;
    tableCounter: (selected: number, total: number) => string;
    coverageBeforeOnly: string;
    coverageAfterOnly: string;
    coverageNoteBeforeOnly: (rows: number) => string;
    coverageNoteAfterOnly: (rows: number) => string;
  };
  // データストアエクスプローラ (redis / elasticsearch / s3)。共通文言は
  // common に集約し、各データストア固有の文言を redis/es/s3 に分ける。
  explorer: {
    common: {
      loadMore: string;
      search: string;
      edit: string;
      save: string;
      cancel: string;
      delete: string;
      saving: string;
      saveError: (message: string) => string;
    };
    redis: {
      databases: string;
      keys: string;
      binaryBadge: string;
      keyFilterPlaceholder: string;
      selectKey: string;
      selectDatabase: string;
      noValue: string;
      emptyHash: string;
      emptyList: string;
      noKeys: string;
      keyCount: (n: string) => string;
      newKey: string;
      newKeyNamePlaceholder: string;
      newKeyValuePlaceholder: string;
      confirmDeleteKey: (key: string) => string;
      create: string;
    };
    es: {
      indices: string;
      docs: string;
      mapping: string;
      doc: string;
      queryPlaceholder: string;
      fieldHeader: string;
      typeHeader: string;
      selectIndex: string;
      selectDoc: string;
      noIndices: string;
      noMappedFields: string;
      noDocs: string;
      docNotFound: string;
      loadingIndices: string;
      newDoc: string;
      newDocIdPlaceholder: string;
      sourceJsonPlaceholder: string;
      confirmDeleteDoc: (id: string) => string;
      invalidJson: string;
      create: string;
    };
    s3: {
      bucket: string;
      searchPlaceholder: string;
      prefixMode: string;
      containsMode: string;
      sortUpdated: string;
      sortKey: string;
      prefixPlaceholder: string;
      containsPlaceholder: string;
      selectObject: string;
      noObjects: string;
      noBuckets: string;
      openRaw: string;
      download: string;
      copyUri: string;
      copied: string;
      copyFailed: string;
      unsupported: string;
      truncatedNotice: (size: string) => string;
      newObject: string;
      newObjectKeyPlaceholder: string;
      contentPlaceholder: string;
      confirmDeleteObject: (key: string) => string;
      editTextHint: string;
      create: string;
    };
  };
};

const EN: DbText = {
  nav: {
    dataTab: "Data",
    schemaTab: "Schema",
    selectDatastore: "Select datastore",
    selectSchema: "Select PostgreSQL schema",
    toolbar: "Datastore tools",
    query: "Query",
    queryTitle: "Query Editor",
    er: "ER",
    erTitle: "Entity Relationship Diagram",
    search: "Search",
    searchTitle: "Search across tables",
    snapshot: "Snapshot",
    snapshotTitle: "Snapshot & Diff",
    // bottom dock の close ボタン (×) 用 (旧 sidebar の開閉トグルから流用)。
    queryHistory: "Close",
    queryHistoryTitle: "Close panel",
    newTab: "New tab",
    closeTab: (label) => `Close ${label}`,
    loadingSchema: "Loading schema…",
    noDatastores: "No datastores found",
    dockerLimitReached:
      "Docker discovery reached the service limit; some compose services may be hidden.",
    inferFkLabel: "Rails FK inference",
    inferFkTitle: "Infer FK from Rails-style <name>_id → <names>.id",
    inferredBadge: "inferred",
    inferredBadgeTitle: "Inferred from Rails-style naming, not declared in DB",
  },
  grid: {
    searchPlaceholder: "Search all columns…",
    columnFilterPlaceholder: (column) => `${column}…`,
    exportAction: "Export",
    foreignKeyHint: "Foreign key — click to view related rows",
    relatedEmpty: "No matching row in the referenced table",
    statusRows: (n) => `${n} rows`,
    statusSort: (column, dir) => `Sort: ${column} ${dir}`,
    statusFilters: (n) => `${n} filter(s)`,
  },
  edit: {
    editMode: "Edit",
    editModeTitle: "Toggle edit mode",
    newRow: "New row",
    commit: "Commit",
    discard: "Discard",
    deleteRow: "Mark row for deletion",
    undoDelete: "Undo deletion",
    setNull: "Set NULL",
    dblclickToEdit: "Double-click to edit",
    pending: (n) => `${n} change(s)`,
    committing: "Saving…",
    commitError: (message) => `Save failed: ${message}`,
    confirmDiscard: "Discard all pending changes?",
    noPrimaryKey:
      "This table has no primary key. Existing rows cannot be edited or deleted (you can still add new rows).",
  },
  schema: {
    columns: "Columns",
    foreignKeys: "Foreign Keys",
    indexes: "Indexes",
    triggers: "Triggers",
    ddl: "DDL",
    copyDdl: "Copy DDL",
    copied: "Copied!",
    colName: "Column",
    colType: "Type",
    colNullable: "Nullable",
    colPk: "PK",
    colDefault: "Default",
    colComment: "Comment",
    refTable: "References Table",
    refColumn: "References Column",
    idxName: "Name",
    idxColumns: "Columns",
    idxUnique: "Unique",
    yes: "YES",
    no: "NO",
  },
  editor: {
    sqlPlaceholder: "SELECT * FROM ...",
    run: "Run",
    runTitle: "Execute query (Ctrl+Enter)",
    explain: "Explain",
    explainTitle: "Show query execution plan",
    localHistory: "Local History",
    localHistoryTitle: "Local editor history",
    running: "Running…",
    explaining: "Explaining…",
    failed: "Failed",
    noColumns: "Query returned no columns.",
    noRows: "No rows",
    historyLoading: "Loading…",
    historyEmpty: "No history",
    historyError: "Failed to load history",
    statusError: (ms) => `Error (${ms}ms)`,
    statusSuccess: (rows, suffix, ms) => `${rows}${suffix} rows (${ms}ms)`,
    statusExplain: (ms) => `Explain (${ms}ms)`,
  },
  history: {
    refresh: "Refresh",
    refreshTitle: "Refresh history",
    clearAll: "Clear All",
    clearTitle: "Delete all query history",
    selectPlaceholder: "Select a query to view details",
    empty: "No query history",
    useInEditor: "Use in Editor",
    copySql: "Copy SQL",
    copied: "Copied!",
    delete: "Delete",
    confirmDelete: "Confirm delete",
    confirmClear: "Confirm clear",
    truncatedRows: (saved, total) => `Showing ${saved} of ${total} rows`,
  },
  sessionLog: {
    tabLabel: "Log",
    historyTabLabel: "Query history",
    clear: "Clear",
    clearTitle: "Clear the session log",
    empty: "No entries yet. SQL executions and commits will appear here.",
    selectPlaceholder: "Select an entry to view details.",
    statusOk: "ok",
    statusError: "error",
    kindQuery: "query",
    kindMutate: "commit",
    useInEditor: "Open in editor",
    copy: "Copy",
    copied: "Copied",
    autoFollow: "Auto-follow",
    autoFollowTitle:
      "Automatically scroll to the newest entry. Scroll up to pause.",
    commitLabel: (changes) =>
      `Commit (${changes} ${changes === 1 ? "change" : "changes"})`,
  },
  er: {
    zoomIn: "Zoom in",
    zoomOut: "Zoom out",
    zoomReset: "Reset zoom",
    copyMermaid: "Copy Mermaid",
    copyMermaidTitle: "Copy mermaid source to clipboard",
    copied: "Copied!",
    noTables: "No tables to display.",
    loadError: "Failed to load mermaid.js",
    renderError: "Failed to render ER diagram.",
  },
  search: {
    placeholder: "Search across all tables…",
    searchButton: "Search",
    cancelButton: "Cancel",
    includeNonText: " Also search numeric and date columns",
    starting: "Starting search…",
    cancelled: "Search cancelled.",
    checkingTable: "checking tables",
    error: (message) => `Error: ${message}`,
    done: (tables, hits) => `Done. Found ${hits} hits in ${tables} tables.`,
    progress: (currentTable, pct, scanned, total, hits) =>
      `Searching… ${currentTable} (${pct}% - ${scanned}/${total} tables, ${hits} hits)`,
    tableSection: (label, count) => `${label} (${count})`,
    moreHits: (n) => `${n} more`,
  },
  snapshot: {
    guideTitle: "Snapshot diff",
    guideBody:
      "① Take a snapshot → ② run your app or tests against the DB → ③ take another snapshot to see the diff automatically.",
    create: "Take snapshot",
    refresh: "Refresh",
    cancel: "Cancel",
    cancelling: "Cancelling…",
    creating: "Taking…",
    selectTablesHeader: "Select target tables",
    selectAll: "Select all",
    deselectAll: "Deselect all",
    notePlaceholder: "e.g. before user-signup test",
    noteLabel: "Note",
    confirm: "Start",
    empty: 'No snapshots yet. Start with "Take snapshot".',
    editNote: "Note",
    delete: "Delete",
    deleteConfirm: "Confirm delete",
    diffManual: "Check diff manually",
    comparing: "Comparing…",
    calculatingDiff: "Computing diff…",
    diffError: "Failed to compute diff",
    noChanges: "No changes detected.",
    before: "Before",
    loading: "Loading…",
    loadError: "Failed to load",
    saveNote: "Save",
    noteInputPlaceholder: "Enter a note",
    inserted: "Added",
    updated: "Updated",
    deleted: "Deleted",
    tableCount: (n) => `${n} tables`,
    rowCount: (n) => ` (${n})`,
    listTitle: (n) => `Snapshots (${n})`,
    diffSummary: (changed, unchanged) =>
      `${changed} tables changed` +
      (unchanged > 0 ? `, ${unchanged} unchanged` : ""),
    showingRows: (shown, total) => `Showing ${shown} of ${total}`,
    label: (date, tables, note) => `${date} (${tables} tables)${note}`,
    statusRunning: "running",
    statusError: "error",
    statusDone: "done",
    progressLabel: (table, index, total) =>
      table
        ? `Snapshotting ${table} (${index + 1} / ${total})`
        : `Finalizing… (${total} / ${total})`,
    progressFinalizing: "Finalizing…",
    aborted: "cancelled",
    failed: "Failed",
    errorPrefix: "Error",
    compareBeforeBadge: "before",
    compareAfterBadge: "after",
    diffShowing: (before, after) => `Showing: ${before} → ${after}`,
    filterPlaceholder: "Filter tables…",
    tableCounter: (selected, total) => `${selected} / ${total} selected`,
    coverageBeforeOnly: "not snapshotted in after",
    coverageAfterOnly: "not snapshotted in before",
    coverageNoteBeforeOnly: (rows) =>
      `Only in the before snapshot (${rows} rows). Not selected for the after snapshot, so no comparison.`,
    coverageNoteAfterOnly: (rows) =>
      `Only in the after snapshot (${rows} rows). Not selected for the before snapshot, so no comparison.`,
  },
  explorer: {
    common: {
      loadMore: "Load more",
      search: "Search",
      edit: "Edit",
      save: "Save",
      cancel: "Cancel",
      delete: "Delete",
      saving: "Saving…",
      saveError: (message) => `Save failed: ${message}`,
    },
    redis: {
      databases: "Databases",
      keys: "Keys",
      binaryBadge: "binary, base64",
      keyFilterPlaceholder: "key pattern, e.g. user:*",
      selectKey: "Select a key to view its value.",
      selectDatabase: "Select a database to view keys.",
      noValue: "(key does not exist or has no value)",
      emptyHash: "(empty hash)",
      emptyList: "(empty list)",
      noKeys: "(no keys)",
      keyCount: (n) => `${n} keys`,
      newKey: "New key",
      newKeyNamePlaceholder: "key name",
      newKeyValuePlaceholder: "value",
      confirmDeleteKey: (key) => `Delete key "${key}"?`,
      create: "Create",
    },
    es: {
      indices: "Indices",
      docs: "Docs",
      mapping: "Mapping",
      doc: "Doc",
      queryPlaceholder: "lucene query (e.g. field:value)",
      fieldHeader: "Field",
      typeHeader: "Type",
      selectIndex: "Select an index to view its mapping.",
      selectDoc: "Select a doc to view its _source.",
      noIndices: "(no indices)",
      noMappedFields: "(no mapped fields)",
      noDocs: "(no docs)",
      docNotFound: "(doc not found)",
      loadingIndices: "Loading indices...",
      newDoc: "New document",
      newDocIdPlaceholder: "document id (optional — auto-generated if blank)",
      sourceJsonPlaceholder: '{\n  "field": "value"\n}',
      confirmDeleteDoc: (id) => `Delete document "${id}"?`,
      invalidJson: "Invalid JSON",
      create: "Create",
    },
    s3: {
      bucket: "Bucket",
      searchPlaceholder: "Search objects",
      prefixMode: "Prefix",
      containsMode: "Contains",
      sortUpdated: "Updated newest",
      sortKey: "Key A-Z",
      prefixPlaceholder: "Prefix, e.g. photos/2026/",
      containsPlaceholder: "Filename contains",
      selectObject: "Select an object to preview.",
      noObjects: "(no objects)",
      noBuckets: "(no buckets)",
      openRaw: "Open raw",
      download: "Download",
      copyUri: "Copy S3 URI",
      copied: "Copied",
      copyFailed: "Copy failed",
      unsupported:
        "This object type cannot be previewed safely in the browser.",
      truncatedNotice: (size) => `Showing first ${size}.`,
      newObject: "New object",
      newObjectKeyPlaceholder: "object key, e.g. folder/file.txt",
      contentPlaceholder: "object content (text)",
      confirmDeleteObject: (key) => `Delete object "${key}"?`,
      editTextHint: "Only text objects can be edited in the browser.",
      create: "Create",
    },
  },
};

const JA: DbText = {
  nav: {
    dataTab: "データ",
    schemaTab: "スキーマ",
    selectDatastore: "データストアを選択",
    selectSchema: "PostgreSQL スキーマを選択",
    toolbar: "データストアツール",
    query: "クエリ",
    queryTitle: "クエリエディタ",
    er: "ER",
    erTitle: "ER 図 (リレーション図)",
    search: "検索",
    searchTitle: "テーブル横断検索",
    snapshot: "スナップショット",
    snapshotTitle: "スナップショットと差分",
    // bottom dock の close ボタン (×) 用 (旧 sidebar の開閉トグルから流用)。
    queryHistory: "閉じる",
    queryHistoryTitle: "パネルを閉じる",
    newTab: "新しいタブ",
    closeTab: (label) => `${label} を閉じる`,
    loadingSchema: "スキーマを読み込み中…",
    noDatastores: "データストアが見つかりません",
    dockerLimitReached:
      "Docker のサービス数が上限に達しました。一部の compose サービスは表示されていない可能性があります。",
    inferFkLabel: "Rails FK 推測",
    inferFkTitle: "Rails 命名規約 (<name>_id → <names>.id) から FK を推測",
    inferredBadge: "推測",
    inferredBadgeTitle:
      "Rails 命名規約から推測した FK (DB の宣言ではありません)",
  },
  grid: {
    searchPlaceholder: "全カラムを検索…",
    columnFilterPlaceholder: (column) => `${column}…`,
    exportAction: "エクスポート",
    foreignKeyHint: "外部キー: クリックして関連データを表示",
    relatedEmpty: "参照先に該当する行がありません",
    statusRows: (n) => `${n} 行`,
    statusSort: (column, dir) => `並び替え: ${column} ${dir}`,
    statusFilters: (n) => `フィルタ ${n} 件`,
  },
  edit: {
    editMode: "編集",
    editModeTitle: "編集モードの切り替え",
    newRow: "新規行",
    commit: "コミット",
    discard: "破棄",
    deleteRow: "行を削除対象にする",
    undoDelete: "削除を取り消す",
    setNull: "NULL にする",
    dblclickToEdit: "ダブルクリックで編集",
    pending: (n) => `変更 ${n} 件`,
    committing: "保存中…",
    commitError: (message) => `保存に失敗しました: ${message}`,
    confirmDiscard: "保留中の変更をすべて破棄しますか?",
    noPrimaryKey:
      "このテーブルには主キーがありません。既存行の編集・削除はできません(新規行の追加は可能です)。",
  },
  schema: {
    columns: "カラム",
    foreignKeys: "外部キー",
    indexes: "インデックス",
    triggers: "トリガー",
    ddl: "DDL",
    copyDdl: "DDL をコピー",
    copied: "コピーしました",
    colName: "カラム",
    colType: "型",
    colNullable: "NULL 許可",
    colPk: "PK",
    colDefault: "デフォルト",
    colComment: "コメント",
    refTable: "参照先テーブル",
    refColumn: "参照先カラム",
    idxName: "名前",
    idxColumns: "カラム",
    idxUnique: "ユニーク",
    yes: "はい",
    no: "いいえ",
  },
  editor: {
    sqlPlaceholder: "SELECT * FROM ...",
    run: "実行",
    runTitle: "クエリを実行 (Ctrl+Enter)",
    explain: "Explain",
    explainTitle: "実行計画を表示",
    localHistory: "ローカル履歴",
    localHistoryTitle: "エディタのローカル履歴",
    running: "実行中…",
    explaining: "解析中…",
    failed: "失敗",
    noColumns: "クエリは列を返しませんでした。",
    noRows: "行がありません",
    historyLoading: "読み込み中…",
    historyEmpty: "履歴がありません",
    historyError: "履歴の読み込みに失敗しました",
    statusError: (ms) => `エラー (${ms}ms)`,
    statusSuccess: (rows, suffix, ms) => `${rows}${suffix} 行 (${ms}ms)`,
    statusExplain: (ms) => `Explain (${ms}ms)`,
  },
  history: {
    refresh: "更新",
    refreshTitle: "履歴を更新",
    clearAll: "すべて削除",
    clearTitle: "クエリ履歴をすべて削除",
    selectPlaceholder: "クエリを選択すると詳細が表示されます",
    empty: "クエリ履歴がありません",
    useInEditor: "エディタで使う",
    copySql: "SQL をコピー",
    copied: "コピーしました",
    delete: "削除",
    confirmDelete: "削除を確認",
    confirmClear: "全削除を確認",
    truncatedRows: (saved, total) => `全 ${total} 行中 ${saved} 行を表示`,
  },
  sessionLog: {
    tabLabel: "ログ",
    historyTabLabel: "クエリ履歴",
    clear: "クリア",
    clearTitle: "セッションログを消去",
    empty: "まだログはありません。SQL の実行や編集コミットがここに出ます。",
    selectPlaceholder: "エントリを選ぶと詳細を表示します。",
    statusOk: "成功",
    statusError: "エラー",
    kindQuery: "クエリ",
    kindMutate: "コミット",
    useInEditor: "エディタに開く",
    copy: "コピー",
    copied: "コピーしました",
    autoFollow: "自動追従",
    autoFollowTitle:
      "新しいエントリを常に表示。下に手動スクロールすると自動解除されます。",
    commitLabel: (changes) => `コミット (${changes} 件)`,
  },
  er: {
    zoomIn: "拡大",
    zoomOut: "縮小",
    zoomReset: "ズームをリセット",
    copyMermaid: "Mermaid をコピー",
    copyMermaidTitle: "Mermaid ソースをクリップボードにコピー",
    copied: "コピーしました",
    noTables: "表示できるテーブルがありません。",
    loadError: "mermaid.js の読み込みに失敗しました",
    renderError: "ER 図の描画に失敗しました。",
  },
  search: {
    placeholder: "全テーブルを横断検索...",
    searchButton: "検索",
    cancelButton: "キャンセル",
    includeNonText: " 数値・日付カラムも検索する",
    starting: "検索を開始しています...",
    cancelled: "検索をキャンセルしました。",
    checkingTable: "対象テーブルを確認中",
    error: (message) => `エラー: ${message}`,
    done: (tables, hits) =>
      `完了。${tables}テーブルから ${hits}件見つかりました。`,
    progress: (currentTable, pct, scanned, total, hits) =>
      `検索中... ${currentTable} (${pct}% - ${scanned}/${total}テーブル、${hits}件)`,
    tableSection: (label, count) => `${label} (${count}件)`,
    moreHits: (n) => `ほか ${n}件`,
  },
  snapshot: {
    guideTitle: "スナップショット差分",
    guideBody:
      "① スナップショット取得 → ② アプリやテストでDB操作 → ③ もう一度取得すると自動で差分表示されます",
    create: "スナップショット取得",
    refresh: "更新",
    cancel: "キャンセル",
    cancelling: "キャンセル中...",
    creating: "取得中...",
    selectTablesHeader: "対象テーブルを選択",
    selectAll: "すべて選択",
    deselectAll: "選択解除",
    notePlaceholder: "例: ユーザー登録テスト前",
    noteLabel: "メモ",
    confirm: "取得開始",
    empty:
      "まだスナップショットがありません。「スナップショット取得」で開始します。",
    editNote: "メモ",
    delete: "削除",
    deleteConfirm: "削除を確認",
    diffManual: "手動で差分チェック",
    comparing: "比較中...",
    calculatingDiff: "差分を計算中...",
    diffError: "差分の計算に失敗しました",
    noChanges: "変更は検出されませんでした。",
    before: "更新前",
    loading: "読み込み中...",
    loadError: "読み込みに失敗しました",
    saveNote: "保存",
    noteInputPlaceholder: "メモを入力",
    inserted: "追加",
    updated: "更新",
    deleted: "削除",
    tableCount: (n) => `${n}テーブル`,
    rowCount: (n) => ` (${n}件)`,
    listTitle: (n) => `スナップショット (${n}件)`,
    diffSummary: (changed, unchanged) =>
      `${changed}テーブルに変更あり` +
      (unchanged > 0 ? `、${unchanged}テーブルは変更なし` : ""),
    showingRows: (shown, total) => `全${total}件中 ${shown}件を表示中`,
    label: (date, tables, note) => `${date} (${tables}テーブル)${note}`,
    statusRunning: "取得中",
    statusError: "エラー",
    statusDone: "完了",
    progressLabel: (table, index, total) =>
      table
        ? `スナップショット取得中: ${table} (${index + 1} / ${total})`
        : `仕上げ中… (${total} / ${total})`,
    progressFinalizing: "仕上げ中…",
    aborted: "キャンセル",
    failed: "失敗",
    errorPrefix: "エラー",
    compareBeforeBadge: "比較元",
    compareAfterBadge: "比較先",
    diffShowing: (before, after) => `比較中: ${before} → ${after}`,
    filterPlaceholder: "テーブル名で絞り込み…",
    tableCounter: (selected, total) => `${selected} / ${total} 件選択中`,
    coverageBeforeOnly: "比較先で未取得",
    coverageAfterOnly: "比較元で未取得",
    coverageNoteBeforeOnly: (rows) =>
      `比較元のみに存在 (${rows}行)。比較先では対象テーブルに選ばれていないため比較できません。`,
    coverageNoteAfterOnly: (rows) =>
      `比較先のみに存在 (${rows}行)。比較元では対象テーブルに選ばれていないため比較できません。`,
  },
  explorer: {
    common: {
      loadMore: "さらに読み込む",
      search: "検索",
      edit: "編集",
      save: "保存",
      cancel: "キャンセル",
      delete: "削除",
      saving: "保存中…",
      saveError: (message) => `保存に失敗しました: ${message}`,
    },
    redis: {
      databases: "データベース",
      keys: "キー",
      binaryBadge: "バイナリ, base64",
      keyFilterPlaceholder: "キーパターン 例: user:*",
      selectKey: "キーを選択すると値が表示されます。",
      selectDatabase: "データベースを選択するとキーが表示されます。",
      noValue: "(キーが存在しないか値がありません)",
      emptyHash: "(空のハッシュ)",
      emptyList: "(空のリスト)",
      noKeys: "(キーがありません)",
      keyCount: (n) => `${n} キー`,
      newKey: "新規キー",
      newKeyNamePlaceholder: "キー名",
      newKeyValuePlaceholder: "値",
      confirmDeleteKey: (key) => `キー "${key}" を削除しますか?`,
      create: "作成",
    },
    es: {
      indices: "インデックス",
      docs: "ドキュメント",
      mapping: "マッピング",
      doc: "ドキュメント",
      queryPlaceholder: "lucene クエリ 例: field:value",
      fieldHeader: "フィールド",
      typeHeader: "型",
      selectIndex: "インデックスを選択するとマッピングが表示されます。",
      selectDoc: "ドキュメントを選択すると _source が表示されます。",
      noIndices: "(インデックスがありません)",
      noMappedFields: "(マッピング済みフィールドがありません)",
      noDocs: "(ドキュメントがありません)",
      docNotFound: "(ドキュメントが見つかりません)",
      loadingIndices: "インデックスを読み込み中...",
      newDoc: "新規ドキュメント",
      newDocIdPlaceholder: "ドキュメント ID (省略時は自動採番)",
      sourceJsonPlaceholder: '{\n  "field": "value"\n}',
      confirmDeleteDoc: (id) => `ドキュメント "${id}" を削除しますか?`,
      invalidJson: "JSON が不正です",
      create: "作成",
    },
    s3: {
      bucket: "バケット",
      searchPlaceholder: "オブジェクトを検索",
      prefixMode: "プレフィックス",
      containsMode: "部分一致",
      sortUpdated: "更新が新しい順",
      sortKey: "キー名 A-Z",
      prefixPlaceholder: "プレフィックス 例: photos/2026/",
      containsPlaceholder: "ファイル名に含む",
      selectObject: "オブジェクトを選択するとプレビューが表示されます。",
      noObjects: "(オブジェクトがありません)",
      noBuckets: "(バケットがありません)",
      openRaw: "元データを開く",
      download: "ダウンロード",
      copyUri: "S3 URI をコピー",
      copied: "コピーしました",
      copyFailed: "コピーに失敗しました",
      unsupported:
        "この種類のオブジェクトはブラウザで安全にプレビューできません。",
      truncatedNotice: (size) => `先頭 ${size} を表示中。`,
      newObject: "新規オブジェクト",
      newObjectKeyPlaceholder: "オブジェクトキー 例: folder/file.txt",
      contentPlaceholder: "オブジェクトの内容 (テキスト)",
      confirmDeleteObject: (key) => `オブジェクト "${key}" を削除しますか?`,
      editTextHint: "ブラウザで編集できるのはテキストオブジェクトのみです。",
      create: "作成",
    },
  },
};

const DB_TEXT: Record<DbLang, DbText> = { en: EN, ja: JA };

export function dbText(lang: DbLang): DbText {
  return DB_TEXT[lang] ?? EN;
}
