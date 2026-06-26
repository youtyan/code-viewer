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
    queryHistory: "Query History",
    queryHistoryTitle: "Toggle query history panel",
    newTab: "New tab",
    closeTab: (label) => `Close ${label}`,
    loadingSchema: "Loading schema…",
    noDatastores: "No datastores found",
    dockerLimitReached:
      "Docker discovery reached the service limit; some compose services may be hidden.",
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
    queryHistory: "クエリ履歴",
    queryHistoryTitle: "クエリ履歴パネルの表示切替",
    newTab: "新しいタブ",
    closeTab: (label) => `${label} を閉じる`,
    loadingSchema: "スキーマを読み込み中…",
    noDatastores: "データストアが見つかりません",
    dockerLimitReached:
      "Docker のサービス数が上限に達しました。一部の compose サービスは表示されていない可能性があります。",
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
};

const DB_TEXT: Record<DbLang, DbText> = { en: EN, ja: JA };

export function dbText(lang: DbLang): DbText {
  return DB_TEXT[lang] ?? EN;
}
