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
    refreshDatastores: string;
    refreshDatastoresShort: string;
    refreshDatastoresBusy: string;
    refreshDatastoresTitle: string;
    addConnection: string;
    editConnection: string;
    deleteConnection: string;
    refreshDatastoresUnchanged: string;
    refreshDatastoresChanged: (added: number, removed: number) => string;
    toolbar: string;
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
    noDatastoresHint: string;
    noDatastoreTab: string;
    // 新しいタブ (データストアを選んでいない) の本文の案内。
    chooseDatastore: string;
    chooseDatastoreHint: string;
    dockerLimitReached: string;
    // Rails 命名規約 (<name>_id → <names>.id) からの仮想 FK 推測トグル。
    inferFkLabel: string;
    inferFkTitle: string;
    // 推測 FK の右ペインリストに付ける小バッジ。
    inferredBadge: string;
    inferredBadgeTitle: string;
    datastoresError: (detail: string) => string;
    rowCountError: (detail: string) => string;
    tabsLoadError: (detail: string) => string;
    stateSaveError: (detail: string) => string;
    closeDatastoreError: (detail: string) => string;
    viewLoadError: (detail: string) => string;
    eventError: (detail: string) => string;
  };
  tableList: {
    filter: string;
    clear: string;
    empty: string;
    noMatches: string;
    tables: string;
    views: string;
    keyboardHint: string;
    result: (visible: number, total: number) => string;
    copyTableName: string;
    copySelect: string;
    viewCreate: string;
    viewDefinition: string;
    copyColumnName: (column: string) => string;
    copyFailed: (detail: string) => string;
    columnsError: (detail: string) => string;
  };
  detail: {
    cell: string;
    row: string;
    rowTitle: (row: number) => string;
    column: string;
    value: string;
    emptyString: string;
    copy: string;
    copied: string;
    copyFailed: string;
    close: string;
  };
  // データグリッド本体。
  grid: {
    searchPlaceholder: string;
    columnFilterPlaceholder: (column: string) => string;
    clearFiltersLabel: string;
    clearFiltersAction: (count: number) => string;
    refreshLabel: string;
    refreshFilteredLabel: string;
    refreshingLabel: string;
    refreshAction: string;
    refreshActionWithFilters: (count: number) => string;
    refreshResultChanged: (delta: number, total: string) => string;
    refreshResultUnchanged: (total: string) => string;
    exportAction: string;
    foreignKeyHint: string;
    relatedEmpty: string;
    relatedListResize: string;
    filteredEmptyTitle: (count: number) => string;
    filteredEmptyHint: string;
    filteredEmptyAction: string;
    statusRows: (n: string) => string;
    /** 足元のページ送り: いま見えている行の範囲。 */
    pagerRange: (first: string, last: string, total: string) => string;
    pagerPrev: string;
    pagerNext: string;
    statusSort: (column: string, dir: string) => string;
    statusFilters: (n: number) => string;
    statusRefreshing: (filters: number) => string;
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
    /** 構造の欄の見出し。テーブルの説明があれば後ろに添える。 */
    header: (table: string, comment?: string) => string;
    columns: string;
    foreignKeys: string;
    indexes: string;
    triggers: string;
    ddl: string;
    refreshLabel: string;
    refreshAction: string;
    refreshingLabel: string;
    copyDdl: string;
    copied: string;
    copyFailed: (detail: string) => string;
    loadError: (detail: string) => string;
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
    collapseInput: string;
    expandInput: string;
    resizeInput: string;
    run: string;
    runTitle: string;
    explain: string;
    explainTitle: string;
    explainUnsupported: string;
    localHistory: string;
    localHistoryTitle: string;
    running: string;
    explaining: string;
    failed: string;
    noColumns: string;
    noRows: string;
    historyLoading: string;
    historyEmpty: string;
    historyError: (detail: string) => string;
    statusError: (ms: number) => string;
    statusSuccess: (rows: number, suffix: string, ms: number) => string;
    statusExplain: (ms: number) => string;
  };
  // クエリ履歴ペイン。
  history: {
    refresh: string;
    refreshTitle: string;
    refreshResultAdded: (count: number) => string;
    refreshResultUnchanged: string;
    refreshError: (detail: string) => string;
    deleteError: (detail: string) => string;
    clearError: (detail: string) => string;
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
    executorAi: string;
    executorUser: string;
    rowsLabel: (rows: number, truncated: boolean) => string;
    elapsedLabel: (ms: number) => string;
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
    copyFailed: (detail: string) => string;
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
    loading: string;
    loadError: string;
    saveNote: string;
    noteInputPlaceholder: string;
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
  // 取得・実行の失敗の詳細の頭に付ける操作名。responseErrorMessage が
  // 「<操作名> (HTTP 500): <本文>」の形にして、画面とセッションログに出す。
  failure: {
    fetchSchemas: string;
    fetchSchema: string;
    fetchTableCount: string;
    fetchTable: string;
    fetchColumns: string;
    fetchDdl: string;
    executeQuery: string;
    saveChanges: string;
    loadDatastores: string;
    loadDatabaseTabs: string;
    saveDatabaseTabs: string;
    saveDatabaseTabsOnUnload: string;
    loadUiSettings: string;
    saveUiSettings: string;
    saveColumnWidths: string;
    saveExpandedTables: string;
    saveSnapshotTables: string;
    closeDatastore: (dbId: string) => string;
    loadLocalHistory: string;
    refreshHistory: string;
    deleteHistoryEntry: string;
    clearHistory: string;
    s3Buckets: string;
    s3Objects: string;
    s3ObjectHead: string;
    s3ObjectText: string;
    s3Folder: string;
    s3Write: string;
    dynamodbTables: string;
    dynamodbTable: string;
    dynamodbItems: string;
    dynamodbItem: string;
    esIndices: string;
    esMapping: string;
    esDocs: string;
    esDoc: string;
    esWrite: string;
    redisDatabases: string;
    redisKeys: string;
    redisValue: string;
    redisWrite: string;
    searchStart: string;
    searchStatus: string;
    searchCancel: string;
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
      shownCount: (count: string) => string;
      scannedCount: (count: string) => string;
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
      loadingDatabases: string;
      loadingKeys: string;
      loadingValue: string;
      fieldHeader: string;
      valueHeader: string;
      binaryNotice: (fullSize: string) => string;
      binaryTruncatedNotice: (fullSize: string, shownSize: string) => string;
      truncatedString: (shownSize: string, fullSize: string) => string;
      truncatedFields: (shown: string, total: string) => string;
      truncatedItems: (shown: string, total: string) => string;
      truncatedEntries: (shown: string, total: string) => string;
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
      loadingMapping: string;
      loadingDocs: string;
      loadingDoc: string;
      unknownType: string;
      indexMeta: (docCount: string, size: string) => string;
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
      listView: string;
      explorerView: string;
      /** オブジェクトの種類の短い札 (詳しい種類は title に出す)。 */
      kind: Record<
        "image" | "video" | "audio" | "pdf" | "text" | "unsupported",
        string
      >;
      loadMoreFailed: (detail: string) => string;
      loadingBuckets: string;
      loadingObjects: string;
      loadingPreview: string;
      loadingFolder: string;
      emptyFolder: string;
      noMatchesInScan: (scanned: string) => string;
      newestFirstInScan: string;
      sortedByKey: string;
      scanCapReached: string;
    };
    dynamodb: {
      table: string;
      scanMode: string;
      queryMode: string;
      keyConditionPlaceholder: string;
      filterPlaceholder: string;
      attributeValuesPlaceholder: string;
      sortAsc: string;
      sortDesc: string;
      selectItem: string;
      noItems: string;
      noTables: string;
      loadingTable: string;
      loadingTables: string;
      copyKey: string;
      copied: string;
      copyFailed: string;
      invalidAttributeValues: string;
      attributeValuesNotObject: string;
      runQuery: string;
      structureTab: string;
      itemTab: string;
      selectTable: string;
      attributeHeader: string;
      typeHeader: string;
      keyRoleHeader: string;
      noAttributes: string;
      globalSecondaryIndexes: string;
      localSecondaryIndexes: string;
      projectionAll: string;
      projectionKeysOnly: string;
      projectionInclude: (attrs: string) => string;
      keySchemaOnlyHint: string;
      inferredAttributesNote: (count: number) => string;
      loadingItems: string;
    };
  };
};

const EN: DbText = {
  nav: {
    dataTab: "Data",
    schemaTab: "Schema",
    selectDatastore: "Select datastore",
    selectSchema: "Select PostgreSQL schema",
    refreshDatastores: "Refresh datastores",
    refreshDatastoresShort: "Refresh",
    refreshDatastoresBusy: "Refreshing...",
    refreshDatastoresTitle: "Refresh the datastore list",
    addConnection: "Add datastore connection",
    editConnection: "Edit saved connection",
    deleteConnection: "Delete saved connection",
    refreshDatastoresUnchanged: "No datastore changes",
    refreshDatastoresChanged: (added, removed) =>
      [
        added > 0 ? `+${added} datastore${added === 1 ? "" : "s"}` : "",
        removed > 0 ? `-${removed} datastore${removed === 1 ? "" : "s"}` : "",
      ]
        .filter(Boolean)
        .join(" / "),
    toolbar: "Datastore tools",
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
    noDatastoresHint:
      "Start a database service or add a SQLite file, then refresh this list.",
    noDatastoreTab: "No datastore",
    chooseDatastore: "Choose a datastore",
    chooseDatastoreHint:
      "Pick one in the box at the top left, or add a connection with +.",
    dockerLimitReached:
      "Docker discovery reached the service limit; some compose services may be hidden.",
    inferFkLabel: "Rails FK inference",
    inferFkTitle: "Infer FK from Rails-style <name>_id → <names>.id",
    inferredBadge: "inferred",
    inferredBadgeTitle: "Inferred from Rails-style naming, not declared in DB",
    datastoresError: (detail) => `Failed to load datastores: ${detail}`,
    rowCountError: (detail) => `Failed to refresh row count: ${detail}`,
    tabsLoadError: (detail) => `Failed to restore tabs: ${detail}`,
    stateSaveError: (detail) =>
      `Your changes are active, but were not saved: ${detail}`,
    closeDatastoreError: (detail) =>
      `Failed to close the datastore connection: ${detail}`,
    viewLoadError: (detail) => `Failed to load the database view: ${detail}`,
    eventError: (detail) =>
      `A database update could not be read; refreshing all data: ${detail}`,
  },
  tableList: {
    filter: "Filter tables…",
    clear: "Clear filter",
    empty: "No tables found",
    noMatches: "No matching tables",
    tables: "Tables",
    views: "Views",
    keyboardHint: "↑ ↓ Select · Enter Open · → Expand · Esc Clear",
    result: (visible, total) => `${visible} / ${total} tables`,
    copyTableName: "Copy table name",
    copySelect: "Copy SELECT statement",
    viewCreate: "View CREATE TABLE",
    viewDefinition: "View table definition",
    copyColumnName: (column) => `Copy column name: ${column}`,
    copyFailed: (detail) => `Copy failed: ${detail}`,
    columnsError: (detail) => `Failed to load columns: ${detail}`,
  },
  detail: {
    cell: "Cell",
    row: "Row",
    rowTitle: (row) => `Row ${row}`,
    column: "Column",
    value: "Value",
    emptyString: "(empty string)",
    copy: "Copy",
    copied: "Copied",
    copyFailed: "Copy failed",
    close: "Close details",
  },
  grid: {
    searchPlaceholder: "Search all columns…",
    columnFilterPlaceholder: (column) => `${column}…`,
    clearFiltersLabel: "Clear filters",
    clearFiltersAction: (count) =>
      `Clear ${count} active filter${count === 1 ? "" : "s"}`,
    refreshLabel: "Reload table",
    refreshFilteredLabel: "Reload filtered rows",
    refreshingLabel: "Reloading...",
    refreshAction: "Reload this table, keeping search and column filters",
    refreshActionWithFilters: (count) =>
      `Reload this table, keeping ${count} active filter${
        count === 1 ? "" : "s"
      }`,
    refreshResultChanged: (delta, total) => {
      const abs = Math.abs(delta).toLocaleString();
      const sign = delta > 0 ? "+" : "-";
      return `Rows ${sign}${abs} (${total} now)`;
    },
    refreshResultUnchanged: (total) => `Rows unchanged (${total})`,
    exportAction: "Export",
    foreignKeyHint: "Foreign key — click to view related rows",
    relatedEmpty: "No matching row in the referenced table",
    relatedListResize: "Resize the related-reference list",
    filteredEmptyTitle: (count) =>
      `No rows match ${count} active filter${count === 1 ? "" : "s"}`,
    filteredEmptyHint:
      "The table was loaded, but the current search or column filters hide every row.",
    filteredEmptyAction: "Clear filters",
    statusRows: (n) => `${n} rows`,
    pagerRange: (first, last, total) => `${first}–${last} of ${total} rows`,
    pagerPrev: "Previous page",
    pagerNext: "Next page",
    statusSort: (column, dir) => `Sort: ${column} ${dir}`,
    statusFilters: (n) => `${n} filter(s)`,
    statusRefreshing: (filters) =>
      filters > 0
        ? `Reloading with ${filters} active filter${filters === 1 ? "" : "s"}…`
        : "Reloading current table…",
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
    header: (table, comment) =>
      comment ? `Schema: ${table} — ${comment}` : `Schema: ${table}`,
    columns: "Columns",
    foreignKeys: "Foreign Keys",
    indexes: "Indexes",
    triggers: "Triggers",
    ddl: "DDL",
    refreshLabel: "Refresh schema",
    refreshAction: "Refresh this table schema",
    refreshingLabel: "Refreshing...",
    copyDdl: "Copy DDL",
    copied: "Copied!",
    copyFailed: (detail) => `Copy DDL failed: ${detail}`,
    loadError: (detail) => `Failed to load table definition: ${detail}`,
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
    collapseInput: "Collapse query input",
    expandInput: "Expand query input",
    resizeInput: "Resize query input",
    run: "Run",
    runTitle: "Execute query (Ctrl+Enter)",
    explain: "Explain",
    explainTitle: "Show query execution plan",
    explainUnsupported:
      "Explain works on SQLite, D1, PostgreSQL and MySQL only",
    localHistory: "Local History",
    localHistoryTitle: "Local editor history",
    running: "Running…",
    explaining: "Explaining…",
    failed: "Failed",
    noColumns: "Query returned no columns.",
    noRows: "No rows",
    historyLoading: "Loading…",
    historyEmpty: "No history",
    historyError: (detail) => `Failed to load history: ${detail}`,
    statusError: (ms) => `Error (${ms}ms)`,
    statusSuccess: (rows, suffix, ms) => `${rows}${suffix} rows (${ms}ms)`,
    statusExplain: (ms) => `Explain (${ms}ms)`,
  },
  history: {
    refresh: "Refresh history",
    refreshTitle: "Refresh query history",
    refreshResultAdded: (count) => `+${count} queries`,
    refreshResultUnchanged: "No new queries",
    refreshError: (detail) => `Failed to refresh query history: ${detail}`,
    deleteError: (detail) => `Failed to delete query history: ${detail}`,
    clearError: (detail) => `Failed to clear query history: ${detail}`,
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
    executorAi: "AI",
    executorUser: "User",
    rowsLabel: (rows, truncated) => `${rows}${truncated ? "+" : ""} rows`,
    elapsedLabel: (ms) => `${ms}ms`,
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
    copyFailed: (detail) => `Copy Mermaid failed: ${detail}`,
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
    loading: "Loading…",
    loadError: "Failed to load",
    saveNote: "Save",
    noteInputPlaceholder: "Enter a note",
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
  failure: {
    fetchSchemas: "failed to fetch schemas",
    fetchSchema: "failed to fetch schema",
    fetchTableCount: "failed to fetch table count",
    fetchTable: "failed to fetch table",
    fetchColumns: "failed to fetch columns",
    fetchDdl: "failed to fetch DDL",
    executeQuery: "failed to execute query",
    saveChanges: "failed to save changes",
    loadDatastores: "load datastores",
    loadDatabaseTabs: "load database tabs",
    saveDatabaseTabs: "save database tabs",
    saveDatabaseTabsOnUnload: "save database tabs on unload",
    loadUiSettings: "load database UI settings",
    saveUiSettings: "save database UI settings",
    saveColumnWidths: "save database column widths",
    saveExpandedTables: "save database expandedTables",
    saveSnapshotTables: "save database snapshotSelectedTables",
    closeDatastore: (dbId) => `close datastore ${dbId}`,
    loadLocalHistory: "load query Local History",
    refreshHistory: "refresh query history",
    deleteHistoryEntry: "delete query history entry",
    clearHistory: "clear query history",
    s3Buckets: "load S3 buckets",
    s3Objects: "load S3 objects",
    s3ObjectHead: "load S3 object metadata",
    s3ObjectText: "load S3 object text",
    s3Folder: "load S3 folder",
    s3Write: "write S3 object",
    dynamodbTables: "load DynamoDB tables",
    dynamodbTable: "describe DynamoDB table",
    dynamodbItems: "load DynamoDB items",
    dynamodbItem: "get DynamoDB item",
    esIndices: "load Elasticsearch indices",
    esMapping: "load Elasticsearch mapping",
    esDocs: "load Elasticsearch documents",
    esDoc: "load Elasticsearch document",
    esWrite: "write Elasticsearch document",
    redisDatabases: "load Redis databases",
    redisKeys: "load Redis keys",
    redisValue: "load Redis value",
    redisWrite: "write Redis key",
    searchStart: "start search",
    searchStatus: "read search progress",
    searchCancel: "cancel search",
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
      shownCount: (count) => `${count} shown`,
      scannedCount: (count) => `${count} scanned`,
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
      loadingDatabases: "Loading databases...",
      loadingKeys: "Loading keys...",
      loadingValue: "Loading value...",
      fieldHeader: "Field",
      valueHeader: "Value",
      binaryNotice: (fullSize) => `(binary, base64; full size ${fullSize})`,
      binaryTruncatedNotice: (fullSize, shownSize) =>
        `(binary, base64; full size ${fullSize}, showing first ${shownSize})`,
      truncatedString: (shownSize, fullSize) =>
        `(showing first ${shownSize} of ${fullSize})`,
      truncatedFields: (shown, total) =>
        `(showing ${shown} of ${total} fields, truncated)`,
      truncatedItems: (shown, total) =>
        `(showing ${shown} of ${total} items, truncated)`,
      truncatedEntries: (shown, total) =>
        `(showing ${shown} of ${total} entries, truncated)`,
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
      loadingMapping: "Loading mapping...",
      loadingDocs: "Loading docs...",
      loadingDoc: "Loading doc...",
      unknownType: "(unknown)",
      indexMeta: (docCount, size) => `${docCount} docs / ${size}`,
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
      listView: "List",
      explorerView: "Explorer",
      kind: {
        image: "Image",
        video: "Video",
        audio: "Audio",
        pdf: "PDF",
        text: "Text",
        unsupported: "Binary",
      },
      loadMoreFailed: (detail) => `Load more failed: ${detail}`,
      loadingBuckets: "Loading buckets...",
      loadingObjects: "Loading objects...",
      loadingPreview: "Loading preview...",
      loadingFolder: "Loading…",
      emptyFolder: "(empty)",
      noMatchesInScan: (scanned) =>
        `(no matches in the first ${scanned} scanned objects; narrow the prefix and search again)`,
      newestFirstInScan: "newest first in scanned objects",
      sortedByKey: "sorted by key",
      scanCapReached:
        "scan cap reached; narrow the prefix to search more precisely",
    },
    dynamodb: {
      table: "Table",
      scanMode: "Scan",
      queryMode: "Query",
      keyConditionPlaceholder: "Key condition expression, e.g. pk = :pk",
      filterPlaceholder: "Filter expression (optional)",
      attributeValuesPlaceholder: '{":pk": {"S": "value"}}',
      sortAsc: "Ascending",
      sortDesc: "Descending",
      selectItem: "Select an item to preview.",
      noItems: "(no items)",
      noTables: "(no tables)",
      loadingTable: "Loading table...",
      loadingTables: "Loading tables...",
      copyKey: "Copy key",
      copied: "Copied",
      copyFailed: "Copy failed",
      invalidAttributeValues: "Invalid attribute values JSON",
      attributeValuesNotObject: "write the attribute values as a JSON object",
      runQuery: "Run",
      structureTab: "Structure",
      itemTab: "Item",
      selectTable: "Select a table to view its structure.",
      attributeHeader: "Attribute",
      typeHeader: "Type",
      keyRoleHeader: "Key",
      noAttributes: "(no attributes)",
      globalSecondaryIndexes: "Global secondary indexes",
      localSecondaryIndexes: "Local secondary indexes",
      projectionAll: "ALL",
      projectionKeysOnly: "KEYS_ONLY",
      projectionInclude: (attrs) => `INCLUDE (${attrs})`,
      keySchemaOnlyHint:
        "DynamoDB only enforces types for key attributes. Additional attributes will appear here once items are loaded.",
      inferredAttributesNote: (count) =>
        `Attributes beyond the key schema are inferred from ${count.toLocaleString()} loaded item${
          count === 1 ? "" : "s"
        } and may not reflect every item.`,
      loadingItems: "Loading items...",
    },
  },
};

const JA: DbText = {
  nav: {
    dataTab: "データ",
    schemaTab: "スキーマ",
    selectDatastore: "データストアを選択",
    selectSchema: "PostgreSQL スキーマを選択",
    refreshDatastores: "データストアを更新",
    refreshDatastoresShort: "更新",
    refreshDatastoresBusy: "更新中...",
    refreshDatastoresTitle: "データストア一覧を更新",
    addConnection: "データストア接続を追加",
    editConnection: "保存済み接続を編集",
    deleteConnection: "保存済み接続を削除",
    refreshDatastoresUnchanged: "データストアに変化なし",
    refreshDatastoresChanged: (added, removed) =>
      [
        added > 0 ? `+${added} データストア` : "",
        removed > 0 ? `-${removed} データストア` : "",
      ]
        .filter(Boolean)
        .join(" / "),
    toolbar: "データストアツール",
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
    noDatastoresHint:
      "DB サービスを起動するか SQLite ファイルを追加してから、一覧を更新してください。",
    noDatastoreTab: "未検出",
    chooseDatastore: "データストアを選んでください",
    chooseDatastoreHint: "左上の欄から選ぶか、＋ から接続を追加してください。",
    dockerLimitReached:
      "Docker のサービス数が上限に達しました。一部の compose サービスは表示されていない可能性があります。",
    inferFkLabel: "Rails FK 推測",
    inferFkTitle: "Rails 命名規約 (<name>_id → <names>.id) から FK を推測",
    inferredBadge: "推測",
    inferredBadgeTitle:
      "Rails 命名規約から推測した FK (DB の宣言ではありません)",
    datastoresError: (detail) =>
      `データストアの読み込みに失敗しました: ${detail}`,
    rowCountError: (detail) => `行数の更新に失敗しました: ${detail}`,
    tabsLoadError: (detail) => `タブの復元に失敗しました: ${detail}`,
    stateSaveError: (detail) =>
      `変更は反映されていますが保存できませんでした: ${detail}`,
    closeDatastoreError: (detail) =>
      `データストア接続を閉じられませんでした: ${detail}`,
    viewLoadError: (detail) =>
      `データベース画面の読み込みに失敗しました: ${detail}`,
    eventError: (detail) =>
      `データベース更新を読み取れなかったため全体を再読み込みします: ${detail}`,
  },
  tableList: {
    filter: "テーブルを絞り込み…",
    clear: "絞り込みを解除",
    empty: "テーブルがありません",
    noMatches: "一致するテーブルがありません",
    tables: "テーブル",
    views: "ビュー",
    keyboardHint: "↑ ↓ 選択 · Enter 開く · → 列を展開 · Esc 解除",
    result: (visible, total) => `${visible} / ${total} テーブル`,
    copyTableName: "テーブル名をコピー",
    copySelect: "SELECT 文をコピー",
    viewCreate: "CREATE TABLE を表示",
    viewDefinition: "テーブル定義を表示",
    copyColumnName: (column) => `カラム名をコピー: ${column}`,
    copyFailed: (detail) => `コピーに失敗しました: ${detail}`,
    columnsError: (detail) => `カラムの読み込みに失敗しました: ${detail}`,
  },
  detail: {
    cell: "セル",
    row: "行全体",
    rowTitle: (row) => `${row} 行目`,
    column: "カラム",
    value: "値",
    emptyString: "（空文字）",
    copy: "コピー",
    copied: "コピーしました",
    copyFailed: "コピーに失敗しました",
    close: "詳細を閉じる",
  },
  grid: {
    searchPlaceholder: "全カラムを検索…",
    columnFilterPlaceholder: (column) => `${column}…`,
    clearFiltersLabel: "フィルタ解除",
    clearFiltersAction: (count) => `有効なフィルタ ${count} 件を解除`,
    refreshLabel: "表を再読込",
    refreshFilteredLabel: "絞り込み再読込",
    refreshingLabel: "更新中...",
    refreshAction: "検索/列フィルタを保持して、この表だけ再読み込み",
    refreshActionWithFilters: (count) =>
      `有効なフィルタ ${count} 件を保持して、この表だけ再読み込み`,
    // ai-dup-check: allow -- ok:EN側と同一ロジックの JA 文言ペア。i18n テーブルの構造上、翻訳違いだけの関数は常にトークン指紋が一致する。
    refreshResultChanged: (delta, total) => {
      const abs = Math.abs(delta).toLocaleString();
      const sign = delta > 0 ? "+" : "-";
      return `行数 ${sign}${abs} (現在 ${total})`;
    },
    refreshResultUnchanged: (total) => `行数変化なし (${total})`,
    exportAction: "エクスポート",
    foreignKeyHint: "外部キー: クリックして関連データを表示",
    relatedEmpty: "参照先に該当する行がありません",
    relatedListResize: "関連参照リストの幅を変える",
    filteredEmptyTitle: (count) =>
      `フィルタ ${count} 件に一致する行がありません`,
    filteredEmptyHint:
      "表は読み込めていますが、現在の検索/列フィルタですべての行が隠れています。",
    filteredEmptyAction: "フィルタ解除",
    statusRows: (n) => `${n} 行`,
    pagerRange: (first, last, total) => `${total} 行中 ${first}–${last} 行`,
    pagerPrev: "前のページ",
    pagerNext: "次のページ",
    statusSort: (column, dir) => `並び替え: ${column} ${dir}`,
    statusFilters: (n) => `フィルタ ${n} 件`,
    statusRefreshing: (filters) =>
      filters > 0
        ? `フィルタ ${filters} 件を保持して再読み込み中…`
        : "この表を再読み込み中…",
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
    header: (table, comment) =>
      comment ? `スキーマ: ${table} — ${comment}` : `スキーマ: ${table}`,
    columns: "カラム",
    foreignKeys: "外部キー",
    indexes: "インデックス",
    triggers: "トリガー",
    ddl: "DDL",
    refreshLabel: "スキーマを更新",
    refreshAction: "この表のスキーマを再読み込み",
    refreshingLabel: "更新中...",
    copyDdl: "DDL をコピー",
    copied: "コピーしました",
    copyFailed: (detail) => `DDL のコピーに失敗しました: ${detail}`,
    loadError: (detail) => `テーブル定義の読み込みに失敗しました: ${detail}`,
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
    collapseInput: "クエリ入力欄を畳む",
    expandInput: "クエリ入力欄を開く",
    resizeInput: "クエリ入力欄の高さを変更",
    run: "実行",
    runTitle: "クエリを実行 (Ctrl+Enter)",
    explain: "実行計画",
    explainTitle: "実行計画を表示",
    explainUnsupported:
      "実行計画は SQLite・D1・PostgreSQL・MySQL だけで見られます",
    localHistory: "ローカル履歴",
    localHistoryTitle: "エディタのローカル履歴",
    running: "実行中…",
    explaining: "解析中…",
    failed: "失敗",
    noColumns: "クエリは列を返しませんでした。",
    noRows: "行がありません",
    historyLoading: "読み込み中…",
    historyEmpty: "履歴がありません",
    historyError: (detail) => `履歴の読み込みに失敗しました: ${detail}`,
    statusError: (ms) => `エラー (${ms}ms)`,
    statusSuccess: (rows, suffix, ms) => `${rows}${suffix} 行 (${ms}ms)`,
    statusExplain: (ms) => `実行計画 (${ms}ms)`,
  },
  history: {
    refresh: "クエリ履歴を更新",
    refreshTitle: "クエリ履歴を再読み込み",
    refreshResultAdded: (count) => `+${count} 件`,
    refreshResultUnchanged: "新しいクエリはありません",
    refreshError: (detail) => `クエリ履歴の更新に失敗しました: ${detail}`,
    deleteError: (detail) => `クエリ履歴の削除に失敗しました: ${detail}`,
    clearError: (detail) => `クエリ履歴の全削除に失敗しました: ${detail}`,
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
    executorAi: "AI",
    executorUser: "ユーザー",
    rowsLabel: (rows, truncated) => `${rows}${truncated ? "+" : ""} 行`,
    elapsedLabel: (ms) => `${ms}ms`,
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
    copyFailed: (detail) => `Mermaid のコピーに失敗しました: ${detail}`,
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
    loading: "読み込み中...",
    loadError: "読み込みに失敗しました",
    saveNote: "保存",
    noteInputPlaceholder: "メモを入力",
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
  failure: {
    fetchSchemas: "スキーマの一覧を取得できませんでした",
    fetchSchema: "スキーマを取得できませんでした",
    fetchTableCount: "テーブルの行数を取得できませんでした",
    fetchTable: "テーブルを取得できませんでした",
    fetchColumns: "列を取得できませんでした",
    fetchDdl: "DDL を取得できませんでした",
    executeQuery: "クエリを実行できませんでした",
    saveChanges: "変更を保存できませんでした",
    loadDatastores: "データストアの一覧を読み込めませんでした",
    loadDatabaseTabs: "データストアのタブを読み込めませんでした",
    saveDatabaseTabs: "データストアのタブを保存できませんでした",
    saveDatabaseTabsOnUnload:
      "閉じる前にデータストアのタブを保存できませんでした",
    loadUiSettings: "Data の表示設定を読み込めませんでした",
    saveUiSettings: "Data の表示設定を保存できませんでした",
    saveColumnWidths: "列幅を保存できませんでした",
    saveExpandedTables: "展開したテーブルを保存できませんでした",
    saveSnapshotTables: "スナップショットの対象テーブルを保存できませんでした",
    closeDatastore: (dbId) => `データストア ${dbId} を閉じられませんでした`,
    loadLocalHistory: "クエリのローカル履歴を読み込めませんでした",
    refreshHistory: "クエリ履歴を更新できませんでした",
    deleteHistoryEntry: "クエリ履歴の項目を削除できませんでした",
    clearHistory: "クエリ履歴を消去できませんでした",
    s3Buckets: "S3 のバケットの一覧を読み込めませんでした",
    s3Objects: "S3 のオブジェクトの一覧を読み込めませんでした",
    s3ObjectHead: "S3 のオブジェクトの情報を読み込めませんでした",
    s3ObjectText: "S3 のオブジェクトの内容を読み込めませんでした",
    s3Folder: "S3 のフォルダを読み込めませんでした",
    s3Write: "S3 のオブジェクトに書き込めませんでした",
    dynamodbTables: "DynamoDB のテーブルの一覧を読み込めませんでした",
    dynamodbTable: "DynamoDB のテーブルの情報を読み込めませんでした",
    dynamodbItems: "DynamoDB のアイテムを読み込めませんでした",
    dynamodbItem: "DynamoDB のアイテムを取得できませんでした",
    esIndices: "Elasticsearch のインデックスの一覧を読み込めませんでした",
    esMapping: "Elasticsearch のマッピングを読み込めませんでした",
    esDocs: "Elasticsearch のドキュメントの一覧を読み込めませんでした",
    esDoc: "Elasticsearch のドキュメントを読み込めませんでした",
    esWrite: "Elasticsearch のドキュメントに書き込めませんでした",
    redisDatabases: "Redis のデータベースの一覧を読み込めませんでした",
    redisKeys: "Redis のキーの一覧を読み込めませんでした",
    redisValue: "Redis の値を読み込めませんでした",
    redisWrite: "Redis のキーに書き込めませんでした",
    searchStart: "検索を始められませんでした",
    searchStatus: "検索の進み具合を読み込めませんでした",
    searchCancel: "検索を止められませんでした",
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
      shownCount: (count) => `${count} 件表示`,
      scannedCount: (count) => `${count} 件スキャン`,
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
      loadingDatabases: "データベースを読み込み中...",
      loadingKeys: "キーを読み込み中...",
      loadingValue: "値を読み込み中...",
      fieldHeader: "フィールド",
      valueHeader: "値",
      binaryNotice: (fullSize) => `(バイナリ, base64。全体 ${fullSize})`,
      binaryTruncatedNotice: (fullSize, shownSize) =>
        `(バイナリ, base64。全体 ${fullSize} のうち先頭 ${shownSize} を表示)`,
      truncatedString: (shownSize, fullSize) =>
        `(${fullSize} のうち先頭 ${shownSize} を表示)`,
      truncatedFields: (shown, total) =>
        `(${total} フィールドのうち ${shown} 件を表示。残りは省略)`,
      truncatedItems: (shown, total) =>
        `(${total} 要素のうち ${shown} 件を表示。残りは省略)`,
      truncatedEntries: (shown, total) =>
        `(${total} 件のうち ${shown} 件を表示。残りは省略)`,
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
      loadingMapping: "マッピングを読み込み中...",
      loadingDocs: "ドキュメントを読み込み中...",
      loadingDoc: "ドキュメントを読み込み中...",
      unknownType: "(不明)",
      indexMeta: (docCount, size) => `${docCount} 件 / ${size}`,
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
      listView: "一覧",
      explorerView: "フォルダ",
      kind: {
        image: "画像",
        video: "動画",
        audio: "音声",
        pdf: "PDF",
        text: "テキスト",
        unsupported: "バイナリ",
      },
      loadMoreFailed: (detail) => `続きを読み込めませんでした: ${detail}`,
      loadingBuckets: "バケットを読み込み中...",
      loadingObjects: "オブジェクトを読み込み中...",
      loadingPreview: "プレビューを読み込み中...",
      loadingFolder: "読み込み中…",
      emptyFolder: "(空)",
      noMatchesInScan: (scanned) =>
        `(スキャンした先頭 ${scanned} 件に一致するものがありません。プレフィックスを絞って検索し直してください)`,
      newestFirstInScan: "スキャンした中で更新が新しい順",
      sortedByKey: "キー名順",
      scanCapReached:
        "スキャンの上限に達しました。プレフィックスを絞るとより正確に検索できます",
    },
    dynamodb: {
      table: "テーブル",
      scanMode: "Scan",
      queryMode: "Query",
      keyConditionPlaceholder: "キー条件式 例: pk = :pk",
      filterPlaceholder: "フィルタ式 (任意)",
      attributeValuesPlaceholder: '{":pk": {"S": "value"}}',
      sortAsc: "昇順",
      sortDesc: "降順",
      selectItem: "アイテムを選択するとプレビューが表示されます。",
      noItems: "(アイテムがありません)",
      noTables: "(テーブルがありません)",
      loadingTable: "テーブルを読み込み中...",
      loadingTables: "テーブルの一覧を読み込み中...",
      copyKey: "キーをコピー",
      copied: "コピーしました",
      copyFailed: "コピーに失敗しました",
      invalidAttributeValues: "属性値の JSON が不正です",
      attributeValuesNotObject: "属性値は JSON のオブジェクトで書いてください",
      runQuery: "実行",
      structureTab: "構造",
      itemTab: "アイテム",
      selectTable: "テーブルを選択すると構造が表示されます。",
      attributeHeader: "属性",
      typeHeader: "型",
      keyRoleHeader: "キー",
      noAttributes: "(属性がありません)",
      globalSecondaryIndexes: "グローバルセカンダリインデックス",
      localSecondaryIndexes: "ローカルセカンダリインデックス",
      projectionAll: "ALL",
      projectionKeysOnly: "KEYS_ONLY",
      projectionInclude: (attrs) => `INCLUDE (${attrs})`,
      keySchemaOnlyHint:
        "DynamoDBがスキーマとして強制するのはキー属性のみです。アイテムを読み込むと追加の属性がここに表示されます。",
      inferredAttributesNote: (count) =>
        `キー以外の属性は、読み込み済みの${count.toLocaleString()}件のアイテムから検出したものです (全アイテムを網羅するとは限りません)。`,
      loadingItems: "アイテムを読み込み中...",
    },
  },
};

const DB_TEXT: Record<DbLang, DbText> = { en: EN, ja: JA };

export function dbText(lang: DbLang): DbText {
  return DB_TEXT[lang] ?? EN;
}
