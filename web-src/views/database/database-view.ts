import { inferRailsForeignKeys } from "../../core/database/infer-fk";
import type {
  DbColumn,
  DbFileInfo,
  DbFilesResponse,
  DbForeignKey,
  DbMutateResponse,
  DbQueryResponse,
  DbSchemaResponse,
  DbSchemasResponse,
  DbTableCountResponse,
  DbTableDataResponse,
  DynamoDbExplorerSelection,
  QueryHistoryState,
  RowMutation,
  TabState,
  TabsResponse,
  TabsState,
} from "../../core/database/types";
import {
  PENCIL_16_PATH,
  PLUS_16_PATH,
  SEARCH_16_PATH,
  SYNC_16_PATH,
  TRASH_16_PATH,
} from "../../core/icons";
import { makeId } from "../../core/id";
import { isImeComposing } from "../../core/keyboard";
import { type AppRoute, type DiffRange, parseRoute } from "../../core/routes";
import type { AnnotationTarget, DbUiPrefs, DbUiState } from "../../core/types";
import { showAlertDialog } from "../ui-dialog";
import { createAbortGuard } from "./abort-guard";
import {
  deleteDatastoreConnectionFromUi,
  showDatastoreConnectionDialog,
} from "./connection-dialog";
import { createDynamoDbExplorer } from "./dynamodb-explorer";
import { createElasticsearchExplorer } from "./elasticsearch-explorer";
import { createErDiagram } from "./er-diagram";
import { createGlobalSearchView } from "./global-search-view";
import { type DbLang, type DbText, dbText } from "./i18n";
import { setPaneEmpty, setPaneStatus } from "./pane-status";
import { localizePrefToggle, makePrefToggle } from "./pref-toggle";
import { createQueryEditor } from "./query-editor";
import { createQueryHistoryView } from "./query-history-view";
import { createRedisExplorer } from "./redis-explorer";
import { createS3Explorer } from "./s3-explorer";
import { createSchemaView } from "./schema-view";
import { createSessionLog, type SessionLogStore } from "./session-log";
import { createSessionLogView } from "./session-log-view";
import { createSnapshotView } from "./snapshot-view";
import { createTableGrid, type GridFilter, type GridSort } from "./table-grid";
import { createTableList } from "./table-list";

export type DatabaseViewDeps = {
  setRoute: (route: AppRoute, replace?: boolean) => void;
  setPageMode: () => void;
  currentRange: () => DiffRange;
  trackLoad: <T>(promise: Promise<T>) => Promise<T>;
  syncHeaderMenu: () => void;
  fetchDbFiles?: () => Promise<DbFilesResponse>;
  /** 現在の言語設定 (アプリ全体の en/ja トグルと同じ値)。 */
  getLanguage?: () => DbLang;
};

type DatabasePaneDeps = DatabaseViewDeps & {
  ensureDbUiState(): Promise<void>;
  getColumnWidths(dbId: string, table: string): Record<string, number>;
  setColumnWidths(
    dbId: string,
    table: string,
    widths: Record<string, number>,
  ): void;
  getExpandedTables(scopeKey: string): string[];
  setExpandedTable(scopeKey: string, table: string, expanded: boolean): void;
  // snapshot 取得ダイアログのチェックボックス選択を scope (dbId+schema) で
  // 永続化する。空配列を渡すと scope を削除する。
  getSnapshotSelectedTables(scopeKey: string): string[];
  setSnapshotSelectedTables(scopeKey: string, tables: string[]): void;
  // db-ui.json の prefs。boolean トグル系の永続化はここに集約する
  // (localStorage を使わない)。
  getDbUiPref<K extends keyof DbUiPrefs>(
    key: K,
    fallback: NonNullable<DbUiPrefs[K]>,
  ): NonNullable<DbUiPrefs[K]>;
  setDbUiPref<K extends keyof DbUiPrefs>(
    key: K,
    value: NonNullable<DbUiPrefs[K]>,
  ): void;
  onDbUiPrefChange(listener: (state: DbUiState) => void): () => void;
  loadSqlHistory(dbId: string | null, schema: string | null): Promise<string[]>;
  refreshDatastores(): Promise<void>;
  // セッション限定ログ。全 tabPane が同じインスタンスを共有し、フッターの
  // 「ログ」タブに集約表示される。SQL 実行 / 編集コミットの成否を push する。
  sessionLog: SessionLogStore;
};

export type DatabaseView = {
  enter: (
    db?: string,
    schema?: string,
    table?: string,
    tab?: TabName,
    options?: DatabaseEnterOptions,
  ) => Promise<void>;
  captureAnnotationTarget: () => DatabaseAnnotationTarget | null;
  suspend: () => void;
  leave: () => void;
  handleSse: (event?: string, data?: string) => void;
  /** 言語切替時に DB ビューア配下の文言を再適用する。 */
  localize: () => void;
  refresh: () => Promise<void>;
  // ビューア設定パネルなど外部から db-ui pref を読み書きするための公開 API。
  // ensureDbUiState はバックグラウンドで保証されている前提 (DatabaseView が
  // mount された後に呼ばれる)。
  getDbUiPref: <K extends keyof DbUiPrefs>(
    key: K,
    fallback: NonNullable<DbUiPrefs[K]>,
  ) => NonNullable<DbUiPrefs[K]>;
  setDbUiPref: <K extends keyof DbUiPrefs>(
    key: K,
    value: NonNullable<DbUiPrefs[K]>,
  ) => void;
  onDbUiPrefChange: (listener: (state: DbUiState) => void) => () => void;
};

type TabName = "data" | "query" | "schema" | "er" | "search" | "snapshot";
type DatabaseAnnotationTarget = Extract<AnnotationTarget, { kind: "database" }>;
type DatabaseEnterOptions = {
  autoSelectFirst?: boolean;
  annotationTarget?: DatabaseAnnotationTarget;
  reuseActiveTab?: boolean;
  suppressRouteSync?: boolean;
  // true のときは redis/es/s3/dynamodb explorer の「同じ dbId かつ initial
  // なしなら load を skip する」ガードを、現在のライブ選択状態 (getSelection())
  // を initial として流し込むことで意図的にバイパスし、テーブル/インデックス/
  // キー一覧を強制的に再取得する。データストア更新ボタン専用。
  forceReload?: boolean;
};
type OpenTabOptions = DatabaseEnterOptions & {
  deferInitialEnter?: boolean;
  activate?: boolean;
};
type DbTabEntry = {
  pane: TabPaneInternal;
  chip: HTMLElement;
  label: HTMLElement;
  closeBtn: HTMLButtonElement;
};

function looksReadOnlySql(sql: string): boolean {
  const normalized = sql.replace(/^\s*(?:--.*\n|\/\*[\s\S]*?\*\/\s*)*/g, "");
  return /^(select|with|pragma|explain)\b/i.test(normalized);
}

async function responseErrorMessage(
  res: Response,
  fallback: string,
): Promise<string> {
  const text = await res.text().catch(() => "");
  return text || `${fallback} (${res.status})`;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isAbortError(err: unknown): boolean {
  return (
    (err instanceof DOMException && err.name === "AbortError") ||
    (err instanceof Error && err.name === "AbortError")
  );
}

// ----- 内部: 1 タブ分の view (元 createDatabaseView の中身) -----

type TabPaneCallbacks = {
  tabId: string;
  isActive: () => boolean;
  canSyncRoute: () => boolean;
  // state が変わったら chip label の更新や URL 反映、persist のために呼ばれる。
  // active タブのときだけ URL を更新するため、isActive で抑制する。
  onStateChange: () => void;
};

type TabPaneInternal = {
  el: HTMLElement;
  enter: (
    db?: string | null,
    schema?: string | null,
    table?: string | null,
    view?: TabName,
    options?: DatabaseEnterOptions,
  ) => Promise<void>;
  handleSse: (event?: string, data?: string) => void;
  getState: () => TabState;
  getAnnotationTarget: () => DatabaseAnnotationTarget | null;
  getLabel: () => string;
  dispose: () => void;
  localize: () => void;
};

// TabPane のすべての永続化対象 state を 1 箇所で受け取る。pane の構築時に
// 直接永続化せず、外側 (tabs.json から復元した TabState)
// から渡してもらう形にして、タブごとの独立性を担保する。
type TabPaneInitial = Partial<Omit<TabState, "id">>;

function isSqlKind(kind: DbFileInfo["kind"] | undefined): boolean {
  return kind === "sqlite" || kind === "postgresql" || kind === "mysql";
}

function isPostgresKind(kind: DbFileInfo["kind"] | undefined): boolean {
  return kind === "postgresql";
}

// ai-dup-check: allow -- tab-name validation is intentionally local to DB UI routing.
function isSqlView(view: TabName): boolean {
  return (
    view === "data" ||
    view === "query" ||
    view === "schema" ||
    view === "er" ||
    view === "search" ||
    view === "snapshot"
  );
}

function dbUiTableExpansionScope(dbId: string, schema: string | null): string {
  return schema ? `${dbId}#schema=${schema}` : dbId;
}

const HISTORY_SSE_REFRESH_DELAY_MS = 250;
export const TABLE_SELECT_FETCH_DELAY_MS = 50;

type DbVisibility = {
  toolsHidden: boolean;
  // JetBrains 風 bottom dock: タブストリップ自体は SQL モードのとき常時表示
  // (pane open/close と独立)。historyPaneHidden が pane の本体 (展開部) の
  // 表示/非表示で、tabStrip だけ常駐させる。
  historyTabStripHidden: boolean;
  historyPaneHidden: boolean;
  historyResizerHidden: boolean;
  tableListHidden: boolean;
  tabBarHidden: boolean;
  gridHidden: boolean;
  queryHidden: boolean;
  schemaHidden: boolean;
  erHidden: boolean;
  searchHidden: boolean;
  snapshotHidden: boolean;
  redisHidden: boolean;
  esHidden: boolean;
  s3Hidden: boolean;
  dynamodbHidden: boolean;
};

function computeVisibility(
  kind: DbFileInfo["kind"] | undefined,
  tab: TabName,
  userPrefersHistoryOpen: boolean,
): DbVisibility {
  const sqlMode = isSqlKind(kind);
  const tableScopedTab = tab === "data" || tab === "schema";
  const historyVisible = sqlMode && userPrefersHistoryOpen;
  return {
    toolsHidden: !sqlMode,
    historyTabStripHidden: !sqlMode,
    historyPaneHidden: !historyVisible,
    historyResizerHidden: !historyVisible,
    tableListHidden: !sqlMode,
    tabBarHidden: !sqlMode || !tableScopedTab,
    gridHidden: !sqlMode || tab !== "data",
    queryHidden: !sqlMode || tab !== "query",
    schemaHidden: !sqlMode || tab !== "schema",
    erHidden: !sqlMode || tab !== "er",
    searchHidden: !sqlMode || tab !== "search",
    snapshotHidden: !sqlMode || tab !== "snapshot",
    redisHidden: kind !== "redis",
    esHidden: kind !== "elasticsearch",
    s3Hidden: kind !== "s3",
    dynamodbHidden: kind !== "dynamodb",
  };
}

function normalizeViewForDb(
  view: TabName | undefined,
  db: DbFileInfo | null,
): TabName {
  if (!db || !isSqlKind(db.kind)) return "data";
  return view && isSqlView(view) ? view : "data";
}

function labelFromDbId(dbId: string | null | undefined): string {
  if (!dbId) return "(empty)";
  if (dbId.startsWith("docker:")) {
    const rest = dbId.slice("docker:".length);
    const service = rest.split(/[@:]/, 1)[0];
    return service || "Docker";
  }
  if (dbId.startsWith("supabase:")) {
    const rest = dbId.slice("supabase:".length);
    const projectId = rest.split(/[@]/, 1)[0];
    return projectId || "Supabase";
  }
  const normalized = dbId.replace(/\\/g, "/");
  const lastSlash = normalized.lastIndexOf("/");
  return lastSlash >= 0 ? normalized.slice(lastSlash + 1) : normalized;
}

function createTabPane(
  outerDeps: DatabasePaneDeps,
  cb: TabPaneCallbacks,
  initial: TabPaneInitial = {},
): TabPaneInternal {
  // 内部で deps.setRoute を呼ぶたびに active かどうかで実体呼び出しを抑制、
  // 同時に onStateChange を発火させて外側 (タブバーの label 更新 / persist) を
  // 起こす。
  const deps: DatabaseViewDeps = {
    ...outerDeps,
    setRoute: (route, replace) => {
      if (cb.isActive() && cb.canSyncRoute())
        outerDeps.setRoute(route, replace);
      cb.onStateChange();
    },
  };

  // 現在の言語設定に応じたローカライズ文言。
  const paneText = (): DbText => dbText(outerDeps.getLanguage?.() ?? "en");
  // 言語切替で再適用する chrome の文言更新クロージャ群。reloc() は即時適用＋登録。
  const paneLocalizers: Array<() => void> = [];
  const reloc = (fn: () => void): void => {
    fn();
    paneLocalizers.push(fn);
  };

  let currentDbInfo: DbFileInfo | null = null;
  let schemaCache: DbSchemaResponse | null = null;
  // getForeignKeys memo: (schemaCache identity, inferFkRails pref) を覚えて
  // おき、変わらない限り推測列挙を skip。大規模スキーマで getForeignKeys が
  // ヒット毎に inferRailsForeignKeys を全走査するのを避ける。
  let fkMemo: {
    schema: DbSchemaResponse | null;
    inferOn: boolean;
    value: DbForeignKey[];
  } | null = null;
  function getForeignKeysCached(): DbForeignKey[] {
    const real = schemaCache?.foreignKeys ?? [];
    const inferOn = outerDeps.getDbUiPref("inferFkRails", false);
    if (fkMemo && fkMemo.schema === schemaCache && fkMemo.inferOn === inferOn) {
      return fkMemo.value;
    }
    let value: DbForeignKey[] = real;
    if (inferOn && schemaCache) {
      const inferred = inferRailsForeignKeys({
        tables: schemaCache.tables,
        columnsMap: schemaCache.columnsMap ?? {},
        realForeignKeys: real,
      });
      if (inferred.length > 0) value = [...real, ...inferred];
    }
    fkMemo = { schema: schemaCache, inferOn, value };
    return value;
  }
  let lastFiles: DbFileInfo[] = [];
  let noDatastoresAvailable = false;
  let currentSchema: string | null = initial.schema ?? null;
  let currentTable: string | null = initial.table ?? null;
  let loadGeneration = 0;
  const tableSelectGuard = createAbortGuard();
  let historyRefreshPending: ReturnType<typeof setTimeout> | null = null;
  let isRefreshingDatastores = false;

  const dbSelect = document.createElement("select");
  dbSelect.className = "db-file-select";
  reloc(() => {
    dbSelect.title = paneText().nav.selectDatastore;
  });

  const schemaSelect = document.createElement("select");
  schemaSelect.className = "db-file-select db-schema-select";
  schemaSelect.hidden = true;
  reloc(() => {
    schemaSelect.title = paneText().nav.selectSchema;
  });

  const dbRefreshBtn = makeIconButton({
    label: paneText().nav.refreshDatastores,
    title: paneText().nav.refreshDatastoresTitle,
    pathD: SYNC_16_PATH,
    onClick: () => {
      void refreshDatastoreList();
    },
  });
  dbRefreshBtn.classList.add("db-refresh-btn");
  const dbRefreshLabel = document.createElement("span");
  dbRefreshLabel.className = "db-refresh-label";
  dbRefreshBtn.appendChild(dbRefreshLabel);
  const dbRefreshResult = document.createElement("span");
  dbRefreshResult.className = "db-refresh-result";
  dbRefreshResult.hidden = true;
  dbRefreshResult.setAttribute("aria-live", "polite");
  syncDbRefreshButton();

  const connectionDialogDeps = {
    trackLoad: <T>(promise: Promise<T>) => deps.trackLoad(promise),
    get language(): DbLang {
      return outerDeps.getLanguage?.() ?? "en";
    },
  };
  function runConnectionAction(action: () => Promise<void>): void {
    void action().catch((err) =>
      showAlertDialog({
        body: errorMessage(err),
        danger: true,
      }),
    );
  }
  const addConnectionBtn = makeIconButton({
    label: paneText().nav.addConnection,
    title: paneText().nav.addConnection,
    pathD: PLUS_16_PATH,
    onClick: () => {
      runConnectionAction(async () => {
        const id = await showDatastoreConnectionDialog(connectionDialogDeps);
        if (!id) return;
        await outerDeps.refreshDatastores();
        dbSelect.value = id;
        await handleDbSelectChange();
      });
    },
  });
  const editConnectionBtn = makeIconButton({
    label: paneText().nav.editConnection,
    title: paneText().nav.editConnection,
    pathD: PENCIL_16_PATH,
    onClick: () => {
      runConnectionAction(async () => {
        if (!currentDbInfo?.savedConnection) return;
        const id = await showDatastoreConnectionDialog(
          connectionDialogDeps,
          currentDbInfo.id,
        );
        if (id) await outerDeps.refreshDatastores();
      });
    },
  });
  const deleteConnectionBtn = makeIconButton({
    label: paneText().nav.deleteConnection,
    title: paneText().nav.deleteConnection,
    pathD: TRASH_16_PATH,
    onClick: () => {
      runConnectionAction(async () => {
        if (!currentDbInfo?.savedConnection) return;
        const deleted = await deleteDatastoreConnectionFromUi(
          connectionDialogDeps,
          currentDbInfo.id,
        );
        if (deleted) await outerDeps.refreshDatastores();
      });
    },
  });
  for (const button of [
    addConnectionBtn,
    editConnectionBtn,
    deleteConnectionBtn,
  ]) {
    button.classList.add("db-connection-action");
  }
  reloc(() => {
    localizeIconButton(
      addConnectionBtn,
      paneText().nav.addConnection,
      paneText().nav.addConnection,
    );
    localizeIconButton(
      editConnectionBtn,
      paneText().nav.editConnection,
      paneText().nav.editConnection,
    );
    localizeIconButton(
      deleteConnectionBtn,
      paneText().nav.deleteConnection,
      paneText().nav.deleteConnection,
    );
  });

  function syncConnectionActions(): void {
    const saved = currentDbInfo?.savedConnection === true;
    editConnectionBtn.hidden = !saved;
    deleteConnectionBtn.hidden = !saved;
  }
  syncConnectionActions();

  const dbSelectRow = document.createElement("div");
  dbSelectRow.className = "db-select-row";
  dbSelectRow.append(
    dbSelect,
    dbRefreshBtn,
    addConnectionBtn,
    editConnectionBtn,
    deleteConnectionBtn,
    dbRefreshResult,
  );

  const dbToolbar = document.createElement("div");
  dbToolbar.className = "db-toolbar";
  dbToolbar.append(dbSelectRow, schemaSelect);

  const tabBar = document.createElement("div");
  tabBar.className = "db-tab-bar";
  const tabData = createInnerTab("Data", true);
  const tabSchema = createInnerTab("Schema", false);
  reloc(() => {
    tabData.textContent = paneText().nav.dataTab;
    tabSchema.textContent = paneText().nav.schemaTab;
  });
  tabBar.append(tabData, tabSchema);

  let currentTab: TabName = initial.view ?? "data";

  function currentTableExpansionScope(): string | null {
    if (!currentDbInfo) return null;
    return dbUiTableExpansionScope(currentDbInfo.id, currentSchema);
  }

  const tableList = createTableList({
    onSelectTable: (table) => selectTable(table),
    onViewCreateTable: (table) => showDdl(table),
    onViewDefinition: (table) => showSchema(table),
    getColumns: (table) => fetchColumns(table),
    getExpandedTables: () => {
      const scope = currentTableExpansionScope();
      return scope ? outerDeps.getExpandedTables(scope) : [];
    },
    onExpandedTableChange: (table, expanded) => {
      const scope = currentTableExpansionScope();
      if (scope) outerDeps.setExpandedTable(scope, table, expanded);
    },
  });

  const sidebar = document.createElement("div");
  sidebar.className = "db-sidebar";
  // sidebar 幅はタブごとに独立 (タブ A で狭めてもタブ B には反映しない)。
  // initial 値があれば復元し、なければ CSS の default を使う。
  if (initial.sidebarWidth) sidebar.style.width = initial.sidebarWidth;

  // 関連パネルの高さ(px)。sidebar 幅 / history 高さと同様にタブごとに独立して
  // tabs.json へ永続化する。initial があれば復元する。
  let relatedPanelHeightPx: number | null = (() => {
    const raw = initial.relatedPanelHeight;
    if (!raw) return null;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  })();
  // セル詳細フッタの高さ(px)。同じく per-tab 永続化。
  let detailPanelHeightPx: number | null = (() => {
    const raw = initial.detailPanelHeight;
    if (!raw) return null;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  })();

  // ----- サイドバー上端のアイコンツールバー (案 B 改: TablePlus / Beekeeper 風) -----
  // 縦並びの大きな枠線ボタンは「DB ビューア UI として普通じゃない」と
  // ユーザーから指摘を受けた。アイコンツールバーに置き換えて、サイドバー
  // 最上端に集約する。kind === redis / elasticsearch ではこのツールバーごと
  // 隠す (applyVisibility が toolsSection.hidden を制御)。
  const toolsSection = document.createElement("div");
  toolsSection.className = "db-icon-toolbar";
  toolsSection.setAttribute("role", "toolbar");
  reloc(() => {
    toolsSection.setAttribute("aria-label", paneText().nav.toolbar);
  });

  const queryBtn = makeIconButton({
    label: "Query",
    title: "Query Editor",
    pathD: ICON_PATH_QUERY,
    onClick: () => setActiveTab("query"),
  });

  const erBtn = makeIconButton({
    label: "ER Diagram",
    title: "Entity Relationship Diagram",
    pathD: ICON_PATH_ER,
    onClick: () => {
      setActiveTab("er");
      if (schemaCache) renderErDiagram();
    },
  });

  const searchBtn = makeIconButton({
    label: "Search",
    title: "Search across tables",
    pathD: SEARCH_16_PATH,
    onClick: () => setActiveTab("search"),
  });

  const snapshotBtn = makeIconButton({
    label: "Snapshot",
    title: "Snapshot & Diff",
    pathD: ICON_PATH_SNAPSHOT,
    onClick: () => {
      setActiveTab("snapshot");
      snapshotView.refresh();
      snapshotView.restoreDiffFromRoute();
    },
  });

  // Rails FK 推測トグルはビューア設定パネルに集約済み (app.ts の
  // `#datastore-infer-fk`)。pref 値が外部から変わったら grid の FK 解釈を
  // 再計算する必要があるので、subscriber だけ残す。disposer はタブ dispose
  // で必ず unsubscribe する (listener leak 回避)。
  const disposeInferFkPrefSub = outerDeps.onDbUiPrefChange(() => {
    grid.refreshForeignKeys();
  });
  reloc(() => {
    const t = paneText().nav;
    localizeIconButton(
      dbRefreshBtn,
      t.refreshDatastores,
      t.refreshDatastoresTitle,
    );
    syncDbRefreshButton();
    localizeIconButton(queryBtn, t.query, t.queryTitle);
    localizeIconButton(erBtn, t.er, t.erTitle);
    localizeIconButton(searchBtn, t.search, t.searchTitle);
    localizeIconButton(snapshotBtn, t.snapshot, t.snapshotTitle);
  });

  toolsSection.append(queryBtn, erBtn, searchBtn, snapshotBtn);

  // 設定トグル (Rails FK 推測など) はビューア設定パネルへ移したので、
  // ここの prefs バーは現状空。#16 (Edit モードトグル集約) で再利用予定。
  const prefsBar = document.createElement("div");
  prefsBar.className = "db-prefs-bar";

  // explorer (redis/es/s3) 用のサイドバースロット host。各 explorer が自前で
  // 構築した sidebarSlot をここに mount し、applyVisibility が kind ごとに
  // toggle する。SQL kind では全て hidden になり、空のまま下に流れる
  // (Query History toggle / table list がその下に来る)。
  const explorerSidebarHost = document.createElement("div");
  explorerSidebarHost.className = "db-explorer-sidebar-host";

  // 順序: アイコンツールバー → DB select → prefs バー → explorer sidebar → table list。
  sidebar.append(
    toolsSection,
    dbToolbar,
    prefsBar,
    explorerSidebarHost,
    tableList.el,
  );

  const resizeHandle = document.createElement("div");
  resizeHandle.className = "db-sidebar-resize";
  sidebar.appendChild(resizeHandle);

  let resizing = false;
  resizeHandle.addEventListener("mousedown", (e) => {
    e.preventDefault();
    resizing = true;
    resizeHandle.classList.add("active");
    const onMove = (ev: MouseEvent) => {
      if (!resizing) return;
      const w = Math.max(120, Math.min(600, ev.clientX));
      sidebar.style.width = `${w}px`;
    };
    const onUp = () => {
      resizing = false;
      resizeHandle.classList.remove("active");
      // タブごとに persist (tabs.json 経由)。
      cb.onStateChange();
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  });

  const grid = createTableGrid({
    fetchPage: (table, offset, limit, sort, filters, signal) =>
      fetchTablePage(table, offset, limit, sort, filters, signal),
    getDbId: () => currentDbInfo?.id || null,
    getColumnWidths: (dbId, table) => outerDeps.getColumnWidths(dbId, table),
    setColumnWidths: (dbId, table, widths) =>
      outerDeps.setColumnWidths(dbId, table, widths),
    // inferFkRails が ON のときだけ Rails 命名規約由来の仮想 FK を上乗せ
    // する。実 FK と同じ (fromTable, fromColumn) があれば inference 側で
    // スキップされるので重複しない。
    // 推測は (schemaCache の identity) + (pref 値) を key に memoize する。
    // 数百テーブル規模で getForeignKeys が render 毎に走るのを防ぐ。
    getForeignKeys: () => getForeignKeysCached(),
    fetchRelatedPage: (table, offset, limit, sort, filters, eq, signal) =>
      fetchRelatedPage(table, offset, limit, sort, filters, eq, signal),
    getRelatedPanelHeight: () => relatedPanelHeightPx,
    setRelatedPanelHeight: (h) => {
      relatedPanelHeightPx = h;
      cb.onStateChange();
    },
    getDetailPanelHeight: () => detailPanelHeightPx,
    setDetailPanelHeight: (h) => {
      detailPanelHeightPx = h;
      cb.onStateChange();
    },
    getText: () => paneText(),
    // 書き込み対応データストア (SQL 系: SQLite / PostgreSQL / MySQL) で
    // 編集 UI を出す。これらは adapter.applyMutations + /_db/mutate に対応。
    getEditable: () => isSqlKind(currentDbInfo?.kind),
    applyMutations: (mutations) => applyRowMutations(mutations),
    onRefreshComplete: ({ table, filters }) => {
      if (filters.length === 0) {
        return;
      }
      void refreshTableRowCount(table);
    },
  });

  // 編集モードのトグル (#16): table-grid 内の Edit ボタンを廃止し、サイドバー
  // prefs バーに 1 つに集約。タブ単位で grid 内 state を保持するので、テーブル
  // 切替で再 ON 不要 (リロード時はリセット = 誤編集ガード)。
  const editModeToggle = makePrefToggle({
    title: paneText().edit.editModeTitle,
    label: paneText().edit.editMode,
    pathD: ICON_PATH_EDIT_MODE,
    extraClass: "db-edit-mode-toggle",
  });
  editModeToggle.hidden = true;
  editModeToggle.addEventListener("click", () => {
    void grid.setEditMode(!grid.getEditMode());
  });
  prefsBar.append(editModeToggle);
  grid.onEditableChange((editable) => {
    editModeToggle.hidden = !editable;
  });
  grid.onEditModeChange((on) => {
    editModeToggle.classList.toggle("active", on);
    editModeToggle.setAttribute("aria-pressed", String(on));
  });
  reloc(() => {
    const e = paneText().edit;
    localizePrefToggle(editModeToggle, e.editMode, e.editModeTitle);
  });

  const queryEditor = createQueryEditor({
    executeQuery: (sql) => executeQuery(sql),
    loadHistory: () =>
      outerDeps.loadSqlHistory(currentDbInfo?.id || null, currentSchema),
    onSqlChange: () => cb.onStateChange(),
    getText: () => paneText(),
  });
  // 復元すべき SQL draft があれば初期化時に流し込む (これも onSqlChange を
  // 呼ぶが、外側の scheduleSave は debounce で no-op になる)。
  if (initial.sqlDraft) queryEditor.setSql(initial.sqlDraft, { silent: true });

  const schemaView = createSchemaView({
    getText: () => paneText(),
    onRefresh: () => refreshCurrentSchemaView(),
  });
  const erDiagram = createErDiagram({ getText: () => paneText() });
  const globalSearchView = createGlobalSearchView({
    getDbId: () => currentDbInfo?.id || null,
    getSchema: () => currentSchema,
    getText: () => paneText(),
  });
  const snapshotView = createSnapshotView({
    getDbId: () => currentDbInfo?.id || null,
    getSchema: () => currentSchema,
    getTables: () => schemaCache?.tables || [],
    getText: () => paneText(),
    trackLoad: deps.trackLoad,
    getStoredSelectedTables: () => {
      if (!currentDbInfo) return undefined;
      const scope = dbUiTableExpansionScope(currentDbInfo.id, currentSchema);
      return outerDeps.getSnapshotSelectedTables(scope);
    },
    setStoredSelectedTables: (tables) => {
      if (!currentDbInfo) return;
      const scope = dbUiTableExpansionScope(currentDbInfo.id, currentSchema);
      outerDeps.setSnapshotSelectedTables(scope, tables);
    },
    getRouteDiff: () => {
      // parseRoute (web-src/core/routes.ts) が AppRoute の typed フィールド
      // として `diffBefore` / `diffAfter` を既に解釈するので、それを経由する。
      // window.location を直読みすると URL クエリ名の規約が将来変わったとき
      // routes.ts と此処の 2 箇所を直さないと壊れる。
      const parsed = parseRoute(
        window.location.pathname,
        window.location.search,
        deps.currentRange(),
      );
      if (parsed.screen !== "database") return undefined;
      const before = parsed.diffBefore;
      const after = parsed.diffAfter;
      if (!before && !after) return undefined;
      return { before, after };
    },
    setRouteDiff: (diff) => {
      // URL に ?diffBefore=&diffAfter= を反映。snapshot tab 以外では呼ばない。
      const dbId = currentDbInfo?.id;
      if (!dbId) return;
      deps.setRoute(
        {
          screen: "database",
          db: dbId,
          schema: currentSchema ?? undefined,
          table: currentTable ?? undefined,
          tab: "snapshot",
          ...(diff?.before ? { diffBefore: diff.before } : {}),
          ...(diff?.after ? { diffAfter: diff.after } : {}),
          range: deps.currentRange(),
        },
        true,
      );
    },
  });
  const historyView = createQueryHistoryView({
    getDbId: () => currentDbInfo?.id || null,
    getSchema: () => currentSchema,
    getText: () => paneText(),
    copySqlToQuery: (sql) => {
      queryEditor.setSql(sql);
      setActiveTab("query");
    },
  });
  // ログタブ用 view。store は database-view で 1 つ。各 tab pane が view を
  // 別個に持ち、subscribe で同じデータを表示する (タブ間で複製してるように
  // 見えるが、同じ store なので内容は常に一致)。
  const sessionLogView = createSessionLogView({
    store: outerDeps.sessionLog,
    getText: () => paneText(),
    copySqlToQuery: (sql) => {
      queryEditor.setSql(sql);
      setActiveTab("query");
    },
  });

  const redisExplorer = createRedisExplorer({
    onSelectionChange: () => cb.onStateChange(),
    getText: () => paneText(),
    trackLoad: (p) => deps.trackLoad(p),
  });
  redisExplorer.el.hidden = true;
  redisExplorer.sidebarSlot.hidden = true;

  const esExplorer = createElasticsearchExplorer({
    onSelectionChange: () => cb.onStateChange(),
    getText: () => paneText(),
    trackLoad: (p) => deps.trackLoad(p),
  });
  esExplorer.el.hidden = true;
  esExplorer.sidebarSlot.hidden = true;

  const s3Explorer = createS3Explorer({
    onSelectionChange: () => cb.onStateChange(),
    getText: () => paneText(),
    trackLoad: (p) => deps.trackLoad(p),
    // S3 hover preview の ON/OFF。db-ui.json の prefs に永続化される。
    getTooltipEnabled: () => outerDeps.getDbUiPref("s3TooltipEnabled", true),
  });
  s3Explorer.el.hidden = true;
  s3Explorer.sidebarSlot.hidden = true;

  const dynamodbExplorer = createDynamoDbExplorer({
    onSelectionChange: () => cb.onStateChange(),
    getText: () => paneText(),
    trackLoad: (p) => deps.trackLoad(p),
  });
  dynamodbExplorer.el.hidden = true;
  dynamodbExplorer.sidebarSlot.hidden = true;

  // explorer ごとの sidebarSlot を sidebar host に差し込む。表示制御は
  // applyVisibility が一括で行う (kind による hidden toggle)。
  explorerSidebarHost.append(
    redisExplorer.sidebarSlot,
    esExplorer.sidebarSlot,
    s3Explorer.sidebarSlot,
    dynamodbExplorer.sidebarSlot,
  );

  const noDatastoresPane = document.createElement("div");
  noDatastoresPane.className = "db-no-datastores";
  noDatastoresPane.hidden = true;

  function renderNoDatastoresEmpty(): void {
    const t = paneText().nav;
    setPaneEmpty(noDatastoresPane, t.noDatastores, {
      hint: t.noDatastoresHint,
      iconPath: ICON_PATH_SNAPSHOT,
    });
    const actionRow = document.createElement("div");
    actionRow.className = "db-no-datastores-actions";
    const refresh = document.createElement("button");
    refresh.type = "button";
    refresh.className = "db-btn db-btn-primary db-no-datastores-action";
    refresh.textContent = t.refreshDatastores;
    refresh.addEventListener("click", () => {
      void refreshDatastoreList();
    });
    const addConnection = document.createElement("button");
    addConnection.type = "button";
    addConnection.className = "db-btn db-no-datastores-action";
    addConnection.textContent = t.addConnection;
    addConnection.addEventListener("click", () => addConnectionBtn.click());
    actionRow.append(refresh, addConnection);
    noDatastoresPane
      .querySelector<HTMLElement>(".db-pane-empty")
      ?.appendChild(actionRow);
  }

  const mainContent = document.createElement("div");
  mainContent.className = "db-main-content";
  mainContent.append(
    tabBar,
    grid.el,
    queryEditor.el,
    schemaView.el,
    erDiagram.el,
    globalSearchView.el,
    snapshotView.el,
    redisExplorer.el,
    esExplorer.el,
    s3Explorer.el,
    dynamodbExplorer.el,
    noDatastoresPane,
  );
  queryEditor.el.hidden = true;
  globalSearchView.el.hidden = true;
  snapshotView.el.hidden = true;

  const upperArea = document.createElement("div");
  upperArea.className = "db-upper-area";
  upperArea.append(sidebar, mainContent);

  const historyResizer = document.createElement("div");
  historyResizer.className = "db-history-resizer";

  const historyPane = document.createElement("div");
  historyPane.className = "db-history-pane";
  // history pane の高さもタブごとに独立。initial が無ければ CSS の default。
  if (initial.historyHeight) historyPane.style.height = initial.historyHeight;
  // クエリ履歴とセッションログを「クエリ履歴 / ログ」の 2 タブで切替表示する。
  // 両 view が pane を共有し、DOM 自体は両方積んで hidden で切替。
  const historyTabContent = document.createElement("div");
  historyTabContent.className = "db-history-pane-content";
  historyTabContent.appendChild(historyView.el);
  const logTabContent = document.createElement("div");
  logTabContent.className = "db-history-pane-content";
  logTabContent.hidden = true;
  logTabContent.appendChild(sessionLogView.el);
  historyPane.append(historyTabContent, logTabContent);

  // JetBrains 風 bottom dock: タブストリップは pane の外 (常駐領域) に
  // 置く。クリックでアクティブ切替 + pane を開く / アクティブタブ再クリック
  // で pane を閉じる。右端の close ボタンでも閉じられる。
  const historyDock = document.createElement("div");
  historyDock.className = "db-history-dock";
  historyDock.setAttribute("role", "tablist");
  const historyTabBtn = document.createElement("button");
  historyTabBtn.type = "button";
  historyTabBtn.className = "db-history-dock-tab";
  historyTabBtn.setAttribute("role", "tab");
  historyTabBtn.textContent = paneText().sessionLog.historyTabLabel;
  historyTabBtn.classList.add("active");
  historyTabBtn.setAttribute("aria-selected", "true");
  const logTabBtn = document.createElement("button");
  logTabBtn.type = "button";
  logTabBtn.className = "db-history-dock-tab";
  logTabBtn.setAttribute("role", "tab");
  logTabBtn.textContent = paneText().sessionLog.tabLabel;
  logTabBtn.setAttribute("aria-selected", "false");
  const historyDockSpacer = document.createElement("div");
  historyDockSpacer.className = "db-history-dock-spacer";
  const historyDockClose = document.createElement("button");
  historyDockClose.type = "button";
  historyDockClose.className = "db-history-dock-close";
  historyDockClose.setAttribute("aria-label", paneText().nav.queryHistory);
  historyDockClose.title = paneText().nav.queryHistoryTitle;
  historyDockClose.textContent = "×";
  historyDock.append(
    historyTabBtn,
    logTabBtn,
    historyDockSpacer,
    historyDockClose,
  );

  // 復元時の active タブ。`initial.activeHistoryTab` が "log" なら log を
  // 表示済み状態で起動する (未指定なら default の history)。
  let activeHistoryTab: "history" | "log" =
    initial.activeHistoryTab === "log" ? "log" : "history";
  function setActiveHistoryTab(which: "history" | "log"): void {
    activeHistoryTab = which;
    const isHistory = which === "history";
    historyTabBtn.classList.toggle("active", isHistory);
    logTabBtn.classList.toggle("active", !isHistory);
    historyTabBtn.setAttribute("aria-selected", String(isHistory));
    logTabBtn.setAttribute("aria-selected", String(!isHistory));
    historyTabContent.hidden = !isHistory;
    logTabContent.hidden = isHistory;
  }
  // 復元値 (initial.activeHistoryTab === "log") を DOM に反映する。
  setActiveHistoryTab(activeHistoryTab);
  // タブクリック: pane が閉じてれば開く + そのタブをアクティブに、
  // 既に開いていて active なタブを再クリックしたら pane を閉じる
  // (JetBrains の Tool Window タブと同じ挙動)。
  function handleHistoryTabClick(which: "history" | "log"): void {
    if (userPrefersHistoryOpen && activeHistoryTab === which) {
      userPrefersHistoryOpen = false;
    } else {
      setActiveHistoryTab(which);
      userPrefersHistoryOpen = true;
    }
    applyVisibility();
    cb.onStateChange();
  }
  historyTabBtn.addEventListener("click", () =>
    handleHistoryTabClick("history"),
  );
  logTabBtn.addEventListener("click", () => handleHistoryTabClick("log"));
  historyDockClose.addEventListener("click", () => {
    if (!userPrefersHistoryOpen) return;
    userPrefersHistoryOpen = false;
    applyVisibility();
    cb.onStateChange();
  });
  reloc(() => {
    historyTabBtn.textContent = paneText().sessionLog.historyTabLabel;
    logTabBtn.textContent = paneText().sessionLog.tabLabel;
    historyDockClose.setAttribute("aria-label", paneText().nav.queryHistory);
    historyDockClose.title = paneText().nav.queryHistoryTitle;
  });

  let historyResizing = false;
  historyResizer.addEventListener("mousedown", (e) => {
    e.preventDefault();
    historyResizing = true;
    historyResizer.classList.add("active");
    const startY = e.clientY;
    const startH = historyPane.offsetHeight;
    const onMove = (ev: MouseEvent) => {
      if (!historyResizing) return;
      const maxH = container.offsetHeight - 60;
      const h = Math.max(60, Math.min(maxH, startH - (ev.clientY - startY)));
      historyPane.style.height = `${h}px`;
    };
    const onUp = () => {
      historyResizing = false;
      historyResizer.classList.remove("active");
      // タブごとに persist (tabs.json 経由)。
      cb.onStateChange();
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  });

  // history pane の開閉はタブごとに独立。initial が無ければ default は
  // 「開いている」状態を default にする。
  let userPrefersHistoryOpen = initial.historyOpen ?? true;

  function applyVisibility() {
    const sqlMode = isSqlKind(currentDbInfo?.kind);
    const visibility = computeVisibility(
      currentDbInfo?.kind,
      currentTab,
      userPrefersHistoryOpen,
    );
    noDatastoresPane.hidden = !noDatastoresAvailable;
    toolsSection.hidden = visibility.toolsHidden;
    // prefs バー (Rails FK 推測トグル) は toolsSection と同じ SQL kind 限定。
    prefsBar.hidden = visibility.toolsHidden;
    historyDock.hidden = visibility.historyTabStripHidden;
    historyResizer.hidden = visibility.historyResizerHidden;
    historyPane.hidden = visibility.historyPaneHidden;
    tableList.el.hidden = visibility.tableListHidden;
    tabBar.hidden = visibility.tabBarHidden;
    grid.el.hidden = visibility.gridHidden;
    queryEditor.el.hidden = visibility.queryHidden;
    schemaView.el.hidden = visibility.schemaHidden;
    erDiagram.el.hidden = visibility.erHidden;
    globalSearchView.el.hidden = visibility.searchHidden;
    snapshotView.el.hidden = visibility.snapshotHidden;
    redisExplorer.el.hidden = visibility.redisHidden;
    esExplorer.el.hidden = visibility.esHidden;
    s3Explorer.el.hidden = visibility.s3Hidden;
    dynamodbExplorer.el.hidden = visibility.dynamodbHidden;
    // sidebar 内の第1階層セレクタも explorer 表示と同期する。
    redisExplorer.sidebarSlot.hidden = visibility.redisHidden;
    esExplorer.sidebarSlot.hidden = visibility.esHidden;
    s3Explorer.sidebarSlot.hidden = visibility.s3Hidden;
    dynamodbExplorer.sidebarSlot.hidden = visibility.dynamodbHidden;
    // host は `flex: 1` で残り高さを全部食うため、SQL kind で中身が全部 hidden
    // のときは host ごと畳まないと、tableList が下に押し出されて余白だらけに
    // なる (報告された SQL ビューの「テーブル一覧がすごい離れる」回帰)。
    explorerSidebarHost.hidden =
      visibility.redisHidden &&
      visibility.esHidden &&
      visibility.s3Hidden &&
      visibility.dynamodbHidden;
    if (noDatastoresAvailable) {
      toolsSection.hidden = true;
      prefsBar.hidden = true;
      historyDock.hidden = true;
      historyResizer.hidden = true;
      historyPane.hidden = true;
      tableList.el.hidden = true;
      tabBar.hidden = true;
      grid.el.hidden = true;
      queryEditor.el.hidden = true;
      schemaView.el.hidden = true;
      erDiagram.el.hidden = true;
      globalSearchView.el.hidden = true;
      snapshotView.el.hidden = true;
      redisExplorer.el.hidden = true;
      esExplorer.el.hidden = true;
      s3Explorer.el.hidden = true;
      dynamodbExplorer.el.hidden = true;
      redisExplorer.sidebarSlot.hidden = true;
      esExplorer.sidebarSlot.hidden = true;
      s3Explorer.sidebarSlot.hidden = true;
      dynamodbExplorer.sidebarSlot.hidden = true;
      explorerSidebarHost.hidden = true;
    }
    if (!sqlMode) {
      queryBtn.classList.remove("active");
      erBtn.classList.remove("active");
      searchBtn.classList.remove("active");
      snapshotBtn.classList.remove("active");
    }
    historyDock.classList.toggle("open", userPrefersHistoryOpen);
    if (!visibility.historyPaneHidden && cb.isActive()) historyView.refresh();
  }
  applyVisibility();

  const container = document.createElement("div");
  container.className = "db-container";
  // 下から: dock (タブストリップ常駐) → resizer (pane open 時のみ表示) → pane
  // → 上に upperArea。表示順は flex column で上から upperArea → resizer
  // → pane → dock。
  container.append(upperArea, historyResizer, historyPane, historyDock);

  function createInnerTab(text: string, active: boolean): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.className = `db-tab${active ? " active" : ""}`;
    btn.type = "button";
    btn.textContent = text;
    return btn;
  }

  function clearDockerNotice() {
    const notice = mainContent.querySelector<HTMLElement>(".db-docker-notice");
    if (notice) notice.remove();
    applyVisibility();
  }

  function showDockerNotice(message: string) {
    clearDockerNotice();
    const notice = document.createElement("div");
    notice.className = "db-docker-notice";
    notice.textContent = message;
    mainContent.prepend(notice);
  }

  function setTableListStatus(message: string, options?: { error?: boolean }) {
    const list = tableList.el.querySelector<HTMLElement>(".db-table-list");
    if (list) setPaneStatus(list, message, options);
  }

  function waitForTableSelectFetch(signal: AbortSignal): Promise<void> {
    if (signal.aborted) {
      return Promise.reject(new DOMException("aborted", "AbortError"));
    }
    return new Promise((resolve, reject) => {
      let done = false;
      const cleanup = () => {
        signal.removeEventListener("abort", onAbort);
      };
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        cleanup();
        resolve();
      }, TABLE_SELECT_FETCH_DELAY_MS);
      const onAbort = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        cleanup();
        reject(new DOMException("aborted", "AbortError"));
      };
      signal.addEventListener("abort", onAbort, { once: true });
    });
  }

  function setActiveTab(tab: TabName, updateUrl = true) {
    currentTab = normalizeViewForDb(tab, currentDbInfo);
    // アイコン (Query / ER / Search / Snapshot) は「テーブルに紐づかない」
    // 操作なので、これらを active にしたときは table list の active 表示を
    // 外す (= アイコン中はテーブル選択を持たない)。
    // 逆にテーブルクリックで Data / Schema に戻したときは tableList.setActive
    // が selectTable / showSchema から呼ばれるのでそちらで反映される。
    const tableScopedTab = currentTab === "data" || currentTab === "schema";
    if (!tableScopedTab) {
      currentTable = null;
      tableList.setActive(null);
    }
    tabData.classList.toggle("active", currentTab === "data");
    tabSchema.classList.toggle("active", currentTab === "schema");
    queryBtn.classList.toggle("active", currentTab === "query");
    erBtn.classList.toggle("active", currentTab === "er");
    searchBtn.classList.toggle("active", currentTab === "search");
    snapshotBtn.classList.toggle("active", currentTab === "snapshot");
    // Data / Schema の inner tabBar は「テーブルの中身を表示してるとき」
    // だけ表示する。Query / ER / Search / Snapshot 中は無関係なので隠す。
    applyVisibility();
    if (currentTab === "query") queryEditor.focus();
    if (updateUrl && currentDbInfo) {
      deps.setRoute(
        {
          screen: "database",
          db: currentDbInfo?.id,
          schema: currentSchema ?? undefined,
          table: currentTable ?? undefined,
          tab: currentTab === "data" ? undefined : currentTab,
          range: deps.currentRange(),
        },
        true,
      );
    }
  }

  tabData.addEventListener("click", () => setActiveTab("data"));
  tabSchema.addEventListener("click", () => {
    setActiveTab("schema");
    const active = tableList.el.querySelector<HTMLElement>(
      ".db-table-item.active",
    );
    if (active?.dataset.table) showSchema(active.dataset.table);
  });

  async function fetchDbFiles(): Promise<DbFilesResponse> {
    if (deps.fetchDbFiles) return deps.fetchDbFiles();
    const res = await deps.trackLoad(fetch("/_db/files"));
    if (!res.ok) return { files: [] };
    const data = (await res.json()) as DbFilesResponse;
    return data;
  }

  function withCurrentSchema(params: URLSearchParams): URLSearchParams {
    if (currentSchema) params.set("schema", currentSchema);
    return params;
  }

  async function fetchSchemas(
    dbId: string,
    preferredSchema?: string | null,
  ): Promise<DbSchemasResponse> {
    const params = new URLSearchParams({ db: dbId });
    if (preferredSchema) params.set("schema", preferredSchema);
    return logSqlFetch<DbSchemasResponse>({
      url: `/_db/schemas?${params}`,
      kind: "query",
      label: `_db/schemas db=${dbId}`,
      errorPrefix: "failed to fetch schemas",
    });
  }

  function renderSchemaOptions(schemas: string[], selected?: string | null) {
    schemaSelect.innerHTML = "";
    for (const schema of schemas) {
      const opt = document.createElement("option");
      opt.value = schema;
      opt.textContent = schema;
      schemaSelect.appendChild(opt);
    }
    schemaSelect.hidden = schemas.length === 0;
    schemaSelect.disabled = schemas.length === 0;
    if (selected && schemas.includes(selected)) {
      schemaSelect.value = selected;
    } else if (schemas.length > 0) {
      schemaSelect.value = schemas[0];
    }
  }

  async function fetchSchema(dbId: string): Promise<DbSchemaResponse> {
    const params = withCurrentSchema(
      new URLSearchParams({ db: dbId, includeColumns: "1" }),
    );
    return logSqlFetch<DbSchemaResponse>({
      url: `/_db/schema?${params}`,
      kind: "query",
      label: `_db/schema db=${dbId}`,
      errorPrefix: "failed to fetch schema",
    });
  }

  function syncCachedTableRowCount(
    table: string,
    rowCount: number | null,
  ): void {
    if (!schemaCache) return;
    let changed = false;
    const tables = schemaCache.tables.map((entry) => {
      if (entry.name !== table || entry.rowCount === rowCount) return entry;
      changed = true;
      return { ...entry, rowCount };
    });
    if (!changed) return;
    schemaCache = { ...schemaCache, tables };
    tableList.updateRowCount(table, rowCount);
  }

  async function fetchTableRowCount(
    table: string,
    dbId: string,
    schema: string | null,
  ): Promise<DbTableCountResponse> {
    const params = new URLSearchParams({ db: dbId, table });
    if (schema) params.set("schema", schema);
    return logSqlFetch<DbTableCountResponse>({
      url: `/_db/table-count?${params}`,
      kind: "query",
      label: `_db/table-count ${table}`,
      errorPrefix: "failed to fetch table count",
      rowCountOf: (r) => r.rowCount ?? undefined,
    });
  }

  async function refreshTableRowCount(table: string): Promise<void> {
    const dbId = currentDbInfo?.id;
    if (!dbId) return;
    const schema = currentSchema;
    const generation = loadGeneration;
    try {
      const data = await fetchTableRowCount(table, dbId, schema);
      if (
        generation !== loadGeneration ||
        currentDbInfo?.id !== dbId ||
        currentSchema !== schema ||
        currentTable !== table
      ) {
        return;
      }
      syncCachedTableRowCount(table, data.rowCount);
    } catch (err) {
      if (!isAbortError(err)) {
        console.warn(`failed to refresh table count: ${errorMessage(err)}`);
      }
    }
  }

  /**
   * テーブルページを取得する。eq はベース WHERE（完全一致）として常に適用され、
   * その上にグリッド標準の filters / sort を重ねられる（FK 関連表示で使う）。
   */
  async function fetchTablePage(
    table: string,
    offset: number,
    limit: number,
    sort: GridSort | null,
    filters: GridFilter[],
    signal?: AbortSignal,
    eq: Array<{ column: string; value: string }> = [],
  ): Promise<DbTableDataResponse> {
    if (!currentDbInfo) throw new Error("no database selected");
    const requestDbId = currentDbInfo.id;
    const requestSchema = currentSchema;
    const requestGeneration = loadGeneration;
    const params = new URLSearchParams({
      db: requestDbId,
      table,
      offset: String(offset),
      limit: String(limit),
    });
    withCurrentSchema(params);
    if (sort) {
      params.set("sort", sort.column);
      params.set("dir", sort.direction);
    }
    if (filters.length > 0) {
      params.set("filters", JSON.stringify(filters));
    }
    if (eq.length > 0) {
      params.set("eq", JSON.stringify(eq));
    }
    const data = await logSqlFetch<DbTableDataResponse>({
      url: `/_db/table?${params}`,
      init: signal ? { signal } : undefined,
      kind: "query",
      label: `SELECT FROM ${table}`,
      trackLoad: false,
      errorPrefix: "failed to fetch table",
      rowCountOf: (r) => r.rows.length,
    });
    if (
      filters.length === 0 &&
      eq.length === 0 &&
      currentDbInfo?.id === requestDbId &&
      currentSchema === requestSchema &&
      currentTable === table &&
      requestGeneration === loadGeneration
    ) {
      syncCachedTableRowCount(table, data.totalRows);
    }
    return data;
  }

  function fetchRelatedPage(
    table: string,
    offset: number,
    limit: number,
    sort: GridSort | null,
    filters: GridFilter[],
    eq: Array<{ column: string; value: string }>,
    signal?: AbortSignal,
  ): Promise<DbTableDataResponse> {
    return fetchTablePage(table, offset, limit, sort, filters, signal, eq);
  }

  // 全 SQL 系 fetch (query / mutate / table page / schema / columns / ddl) を
  // 1 本化するヘルパ。session log への ok/error 登録と、サーバが返す
  // executedSql の detail 化を 1 箇所にまとめる。
  // - response が `executedSql: string[]` を含めば detail はそれを ";\n" で
  //   join したものに置き換える (= 「サーバが実際に実行した SQL」)。
  // - executedSql が無い・空のレスポンスでは fallbackDetail に fall back。
  // - 4xx/5xx は errorPrefix で responseErrorMessage を作って throw する
  //   (呼び出し側でメッセージ表示)。
  // - fetch 例外 (network) は session log に error 登録して再 throw。
  //   AbortError は無音 (user cancellation)。
  async function logSqlFetch<T extends { executedSql?: string[] }>(opts: {
    url: string;
    init?: RequestInit;
    kind: "query" | "mutate";
    label: string;
    fallbackDetail?: string;
    trackLoad?: boolean;
    errorPrefix: string;
    rowCountOf?: (resp: T) => number | undefined;
  }): Promise<T> {
    const startedAt = Date.now();
    const trackEnabled = opts.trackLoad !== false;
    try {
      const fetchPromise = fetch(opts.url, opts.init);
      const res = await (trackEnabled
        ? deps.trackLoad(fetchPromise)
        : fetchPromise);
      const elapsedMs = Date.now() - startedAt;
      if (!res.ok) {
        const message = await responseErrorMessage(res, opts.errorPrefix);
        outerDeps.sessionLog.add({
          kind: opts.kind,
          status: "error",
          label: opts.label,
          detail: opts.fallbackDetail,
          message,
          elapsedMs,
        });
        // catch ブロックでの重複登録防止フラグ。errorPrefix で startsWith
        // 判定する旧来方式だと throw する Error.message (= サーバ body) が
        // prefix を含まないと弾けず 2 重登録を起こすため、明示的フラグに
        // 切替えた。
        const err = new Error(message);
        (err as { __sessionLogged?: boolean }).__sessionLogged = true;
        throw err;
      }
      const data = (await res.json()) as T;
      const detail =
        data.executedSql && data.executedSql.length > 0
          ? data.executedSql.join(";\n")
          : opts.fallbackDetail;
      outerDeps.sessionLog.add({
        kind: opts.kind,
        status: "ok",
        label: opts.label,
        detail,
        elapsedMs,
        rowCount: opts.rowCountOf?.(data),
      });
      return data;
    } catch (err) {
      if (!(err instanceof Error)) throw err;
      // すでに上で session log に登録済みなら素通し (2 重登録防止)。
      if ((err as { __sessionLogged?: boolean }).__sessionLogged) throw err;
      // ユーザー操作起因のキャンセルは無音 (画面遷移などで起きる)。
      if (err.name === "AbortError") throw err;
      outerDeps.sessionLog.add({
        kind: opts.kind,
        status: "error",
        label: opts.label,
        detail: opts.fallbackDetail,
        message: err.message,
        elapsedMs: Date.now() - startedAt,
      });
      throw err;
    }
  }

  async function executeQuery(sql: string): Promise<DbQueryResponse> {
    if (!currentDbInfo) throw new Error("no database selected");
    const label = sql.split("\n")[0]?.trim() || sql;
    return logSqlFetch<DbQueryResponse>({
      url: "/_db/query",
      init: {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Code-Viewer-Action": "1",
        },
        body: JSON.stringify({
          db: currentDbInfo.id,
          ...(currentSchema ? { schema: currentSchema } : {}),
          sql,
          saveHistory: true,
          source: "browser",
          executedBy: "user",
        }),
      },
      kind: "query",
      label,
      fallbackDetail: sql,
      trackLoad: false,
      errorPrefix: "failed to execute query",
      rowCountOf: (r) => r.rowCount ?? r.rows.length,
    });
  }

  // グリッドの保留中編集をサーバへ適用する。失敗時は throw し、グリッド側が
  // メッセージを表示する。既存の executeQuery と同じ POST 規約に従う。
  async function applyRowMutations(mutations: RowMutation[]): Promise<void> {
    if (!currentDbInfo) throw new Error("no database selected");
    if (!currentTable) throw new Error("no table selected");
    const label = paneText().sessionLog.commitLabel(mutations.length);
    const fallback = JSON.stringify(
      { table: currentTable, mutations },
      null,
      2,
    );
    await logSqlFetch<DbMutateResponse>({
      url: "/_db/mutate",
      init: {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Code-Viewer-Action": "1",
        },
        body: JSON.stringify({
          db: currentDbInfo.id,
          ...(currentSchema ? { schema: currentSchema } : {}),
          table: currentTable,
          mutations,
        }),
      },
      kind: "mutate",
      label,
      fallbackDetail: fallback,
      errorPrefix: "failed to save changes",
      rowCountOf: () => mutations.length,
    });
  }

  async function selectDb(
    dbId: string,
    explorerInitial?: {
      redis?: { dbIndex?: number; key?: string; keyFilter?: string };
      es?: { index?: string; query?: string };
      s3?: {
        bucket?: string;
        prefix?: string;
        query?: string;
        mode?: "prefix" | "contains";
        sort?: "key-asc" | "updated-desc";
        key?: string;
      };
      dynamodb?: DynamoDbExplorerSelection;
    },
    generation = loadGeneration,
    preferredSchema?: string | null,
    preferredTable?: string | null,
    targetView?: TabName,
  ) {
    if (generation !== loadGeneration || currentDbInfo?.id !== dbId) return;
    tableSelectGuard.dispose();
    currentTable = null;
    if (
      currentDbInfo?.kind === "redis" ||
      currentDbInfo?.kind === "elasticsearch" ||
      currentDbInfo?.kind === "s3" ||
      currentDbInfo?.kind === "dynamodb"
    ) {
      currentSchema = null;
      renderSchemaOptions([], null);
      currentTab = "data";
      tableList.render([]);
      grid.clear();
      schemaView.clear();
      erDiagram.clear();
      schemaCache = null;
      applyVisibility();
      if (currentDbInfo.kind === "redis") {
        esExplorer.clear();
        s3Explorer.clear();
        dynamodbExplorer.clear();
        await redisExplorer.load(dbId, explorerInitial?.redis);
      } else if (currentDbInfo.kind === "elasticsearch") {
        redisExplorer.clear();
        s3Explorer.clear();
        dynamodbExplorer.clear();
        await esExplorer.load(dbId, explorerInitial?.es);
      } else if (currentDbInfo.kind === "s3") {
        redisExplorer.clear();
        esExplorer.clear();
        dynamodbExplorer.clear();
        await s3Explorer.load(dbId, explorerInitial?.s3);
      } else {
        redisExplorer.clear();
        esExplorer.clear();
        s3Explorer.clear();
        await dynamodbExplorer.load(dbId, explorerInitial?.dynamodb);
      }
      if (generation !== loadGeneration || currentDbInfo?.id !== dbId) return;
      cb.onStateChange();
      return;
    }
    redisExplorer.clear();
    esExplorer.clear();
    s3Explorer.clear();
    dynamodbExplorer.clear();
    applyVisibility();
    tableList.render([]);
    setTableListStatus(paneText().nav.loadingSchema);
    grid.clear();
    if (isPostgresKind(currentDbInfo?.kind)) {
      const desiredSchema =
        preferredSchema !== undefined ? preferredSchema : currentSchema;
      const schemas = await fetchSchemas(dbId, desiredSchema).catch((err) => {
        if (generation !== loadGeneration || currentDbInfo?.id !== dbId) return;
        const message = errorMessage(err);
        currentSchema = null;
        renderSchemaOptions([], null);
        schemaCache = null;
        tableList.render([]);
        setTableListStatus(message, { error: true });
        grid.showError(message);
        schemaView.clear();
        erDiagram.clear();
        cb.onStateChange();
        return null;
      });
      if (generation !== loadGeneration || currentDbInfo?.id !== dbId) return;
      if (!schemas) return;
      const schemaNames = schemas.schemas.map((s) => s.name);
      currentSchema =
        schemas.selectedSchema ||
        desiredSchema ||
        (schemaNames.includes("public") ? "public" : schemaNames[0]) ||
        null;
      renderSchemaOptions(schemaNames, currentSchema);
    } else {
      currentSchema = null;
      renderSchemaOptions([], null);
    }
    const schema = await fetchSchema(dbId).catch((err) => {
      if (generation !== loadGeneration || currentDbInfo?.id !== dbId) return;
      const message = errorMessage(err);
      schemaCache = null;
      tableList.render([]);
      setTableListStatus(message, { error: true });
      grid.showError(message);
      schemaView.clear();
      erDiagram.clear();
      setActiveTab("data", false);
      cb.onStateChange();
      return null;
    });
    if (generation !== loadGeneration || currentDbInfo?.id !== dbId) return;
    if (!schema) return;
    currentSchema = schema.schema || currentSchema;
    schemaCache = schema;
    await outerDeps.ensureDbUiState();
    if (generation !== loadGeneration || currentDbInfo?.id !== dbId) return;
    tableList.render(schema.tables);
    grid.clear();
    schemaView.clear();
    erDiagram.clear();
    const normalizedTargetView = normalizeViewForDb(targetView, currentDbInfo);
    setActiveTab(normalizedTargetView === "schema" ? "schema" : "data", false);
    const initialTable = preferredTable || schema.tables[0]?.name;
    if (initialTable && normalizedTargetView === "data") {
      await selectTable(initialTable, generation);
    } else if (initialTable && normalizedTargetView === "schema") {
      await selectTableSchemaOnly(initialTable, generation);
    }
    // currentDbInfo が確定したので Query History pane を自動 refresh する。
    // 構築時の applyVisibility() 呼び出し時は currentDbInfo=null で
    // refresh が skip されていた (sqlMode = false 判定) のを、ここで補う。
    // ユーザー報告: 「Refresh ボタンを押さないと History が出ない」の修正。
    applyVisibility();
    cb.onStateChange();
  }

  async function selectTable(table: string, generation = loadGeneration) {
    if (generation !== loadGeneration) return;
    const slot = tableSelectGuard.start();
    currentTable = table;
    tableList.setActive(table);
    if (!currentDbInfo) return;
    const requestDbId = currentDbInfo.id;
    // テーブル選択は「テーブル中身の表示」なので、Query / ER / Search /
    // Snapshot のような「テーブルに紐づかない」ビュー中だった場合は
    // Data に戻す。これによりアイコンの active も自動で外れる
    // (setActiveTab 内のクラス操作)。
    if (
      currentTab === "query" ||
      currentTab === "er" ||
      currentTab === "search" ||
      currentTab === "snapshot"
    ) {
      setActiveTab("data", false);
    }
    deps.setRoute(
      {
        screen: "database",
        db: currentDbInfo.id,
        schema: currentSchema ?? undefined,
        table,
        tab: currentTab === "data" ? undefined : currentTab,
        range: deps.currentRange(),
      },
      true,
    );
    try {
      await waitForTableSelectFetch(slot.signal);
      if (
        slot.isStale() ||
        generation !== loadGeneration ||
        currentDbInfo?.id !== requestDbId ||
        currentTable !== table
      ) {
        return;
      }
      const data = await deps.trackLoad(
        fetchTablePage(table, 0, 200, null, [], slot.signal),
      );
      if (
        slot.isStale() ||
        generation !== loadGeneration ||
        currentDbInfo?.id !== requestDbId ||
        currentTable !== table
      ) {
        return;
      }
      await outerDeps.ensureDbUiState();
      if (
        slot.isStale() ||
        generation !== loadGeneration ||
        currentDbInfo?.id !== requestDbId ||
        currentTable !== table
      ) {
        return;
      }
      grid.load(table, data);
    } catch (err) {
      if (
        slot.isStale() ||
        isAbortError(err) ||
        generation !== loadGeneration ||
        currentDbInfo?.id !== requestDbId ||
        currentTable !== table
      ) {
        return;
      }
      grid.showError(errorMessage(err));
    } finally {
      slot.finish();
    }
    if (currentTab === "schema") {
      const columns = await fetchColumns(table);
      if (
        generation !== loadGeneration ||
        currentDbInfo?.id !== requestDbId ||
        currentTable !== table
      ) {
        return;
      }
      schemaView.render(table, columns, schemaCache?.indexes || [], {
        tableComment: schemaCache?.tables.find((entry) => entry.name === table)
          ?.comment,
      });
    }
  }

  async function selectTableSchemaOnly(
    table: string,
    generation = loadGeneration,
  ) {
    if (generation !== loadGeneration) return;
    currentTable = table;
    tableList.setActive(table);
    if (!currentDbInfo) return;
    const requestDbId = currentDbInfo.id;
    setActiveTab("schema", false);
    const columns = await fetchColumns(table);
    if (
      generation !== loadGeneration ||
      currentDbInfo?.id !== requestDbId ||
      currentTable !== table
    ) {
      return;
    }
    schemaView.render(table, columns, schemaCache?.indexes || [], {
      tableComment: schemaCache?.tables.find((entry) => entry.name === table)
        ?.comment,
    });
  }

  async function fetchColumns(table: string): Promise<DbColumn[]> {
    if (schemaCache?.columnsMap?.[table]) {
      return schemaCache.columnsMap[table];
    }
    if (!currentDbInfo) return [];
    try {
      const data = await logSqlFetch<{
        columns: DbColumn[];
        executedSql?: string[];
      }>({
        url: `/_db/columns?${withCurrentSchema(new URLSearchParams({ db: currentDbInfo.id, table }))}`,
        kind: "query",
        label: `_db/columns ${table}`,
        trackLoad: false,
        errorPrefix: "failed to fetch columns",
      });
      return data.columns;
    } catch {
      return [];
    }
  }

  async function showSchema(table: string) {
    setActiveTab("schema");
    if (!currentDbInfo) return;
    const columns = await fetchColumns(table);
    schemaView.render(table, columns, schemaCache?.indexes || [], {
      tableComment: schemaCache?.tables.find((entry) => entry.name === table)
        ?.comment,
    });
  }

  async function refreshCurrentSchemaView(): Promise<void> {
    if (!currentDbInfo || !currentTable) return;
    const generation = loadGeneration;
    const dbId = currentDbInfo.id;
    const table = currentTable;
    schemaView.setRefreshBusy(true);
    try {
      const schema = await fetchSchema(dbId);
      if (
        generation !== loadGeneration ||
        currentDbInfo?.id !== dbId ||
        currentTable !== table
      ) {
        return;
      }
      currentSchema = schema.schema || currentSchema;
      schemaCache = schema;
      tableList.render(schema.tables);
      const nextTable = schema.tables.some((entry) => entry.name === table)
        ? table
        : schema.tables[0]?.name;
      if (!nextTable) {
        currentTable = null;
        grid.clear();
        schemaView.clear();
        erDiagram.clear();
        cb.onStateChange();
        return;
      }
      currentTable = nextTable;
      tableList.setActive(nextTable);
      const columns = await fetchColumns(nextTable);
      if (
        generation !== loadGeneration ||
        currentDbInfo?.id !== dbId ||
        currentTable !== nextTable
      ) {
        return;
      }
      schemaView.render(nextTable, columns, schema.indexes || [], {
        tableComment: schema.tables.find((entry) => entry.name === nextTable)
          ?.comment,
      });
      cb.onStateChange();
    } catch (err) {
      if (
        generation !== loadGeneration ||
        currentDbInfo?.id !== dbId ||
        isAbortError(err)
      ) {
        return;
      }
      setTableListStatus(errorMessage(err), { error: true });
    } finally {
      schemaView.setRefreshBusy(false);
    }
  }

  async function showDdl(table: string) {
    if (!currentDbInfo) return;
    setActiveTab("schema");
    try {
      const data = await logSqlFetch<{
        sql: string;
        triggers: { name: string; sql: string }[];
        executedSql?: string[];
      }>({
        url: `/_db/ddl?${withCurrentSchema(new URLSearchParams({ db: currentDbInfo.id, table }))}`,
        kind: "query",
        label: `_db/ddl ${table}`,
        trackLoad: false,
        errorPrefix: "failed to fetch DDL",
      });
      const columns = await fetchColumns(table);
      schemaView.render(table, columns, schemaCache?.indexes || [], {
        foreignKeys: schemaCache?.foreignKeys,
        triggers: data.triggers,
        ddl: data.sql,
        tableComment: schemaCache?.tables.find((entry) => entry.name === table)
          ?.comment,
      });
    } catch {
      /* ignore */
    }
  }

  async function renderErDiagram() {
    if (!schemaCache || !currentDbInfo) return;
    const columnsMap = new Map<string, DbColumn[]>();
    if (schemaCache.columnsMap) {
      for (const [name, cols] of Object.entries(schemaCache.columnsMap)) {
        columnsMap.set(name, cols);
      }
    } else {
      const tables = schemaCache.tables.filter((t) => t.type !== "view");
      const results = await Promise.all(
        tables.map((t) =>
          fetchColumns(t.name).then((cols) => ({ name: t.name, cols })),
        ),
      );
      for (const { name, cols } of results) {
        if (cols.length > 0) columnsMap.set(name, cols);
      }
    }
    erDiagram.render(schemaCache, columnsMap);
  }

  dbSelect.addEventListener("change", () => {
    void handleDbSelectChange();
  });

  schemaSelect.addEventListener("change", () => {
    void handleSchemaSelectChange();
  });

  function syncDbRefreshButton(): void {
    dbRefreshLabel.textContent = "";
    dbRefreshBtn.setAttribute(
      "aria-busy",
      isRefreshingDatastores ? "true" : "false",
    );
    syncDatastoreRefreshResult();
  }

  function syncDatastoreRefreshResult(): void {
    dbRefreshResult.hidden = true;
    dbRefreshResult.textContent = "";
    dbRefreshResult.classList.toggle("changed", false);
  }

  async function refreshDatastoreList(): Promise<void> {
    if (dbRefreshBtn.disabled) return;
    isRefreshingDatastores = true;
    dbRefreshBtn.disabled = true;
    dbRefreshBtn.classList.add("spinning");
    syncDbRefreshButton();
    try {
      await outerDeps.refreshDatastores();
    } finally {
      isRefreshingDatastores = false;
      dbRefreshBtn.classList.remove("spinning");
      dbRefreshBtn.disabled = false;
      syncDbRefreshButton();
    }
  }

  async function handleSchemaSelectChange(): Promise<void> {
    if (!currentDbInfo || !isPostgresKind(currentDbInfo.kind)) return;
    const schema = schemaSelect.value || null;
    if (!schema || schema === currentSchema) return;
    const dbId = currentDbInfo.id;
    currentSchema = schema;
    const generation = ++loadGeneration;
    clearDockerNotice();
    await selectDb(dbId, undefined, generation, schema, null);
    if (
      generation !== loadGeneration ||
      currentDbInfo?.id !== dbId ||
      currentSchema !== schema
    ) {
      return;
    }
    deps.setRoute(
      {
        screen: "database",
        db: dbId,
        schema,
        table: currentTable ?? undefined,
        tab: currentTab === "data" ? undefined : currentTab,
        range: deps.currentRange(),
      },
      true,
    );
    cb.onStateChange();
  }

  async function handleDbSelectChange(): Promise<void> {
    const dbId = dbSelect.value;
    if (!dbId) return;
    syncDatastoreRefreshResult();
    const generation = ++loadGeneration;
    const file = lastFiles.find((f) => f.id === dbId);
    const option = dbSelect.selectedOptions[0];
    currentDbInfo = {
      id: dbId,
      path: file?.path || dbId,
      name: option?.textContent || dbId,
      sizeBytes: file?.sizeBytes || 0,
      kind: file?.kind || "sqlite",
      savedConnection: file?.savedConnection,
    };
    syncConnectionActions();
    currentSchema = null;
    clearDockerNotice();
    await selectDb(dbId, undefined, generation, null);
    if (generation !== loadGeneration || currentDbInfo?.id !== dbId) return;
    deps.setRoute(
      {
        screen: "database",
        db: dbId,
        schema: currentSchema ?? undefined,
        table: currentTable ?? undefined,
        tab: currentTab === "data" ? undefined : currentTab,
        range: deps.currentRange(),
      },
      true,
    );
    cb.onStateChange();
  }

  // 初回 enter のみ initial.redis / initial.es を消費する。手動で DB を
  // 切り替えたあとは undefined にして二度と適用しない (= 古い state を
  // 別 DB に流し込まないため)。
  let pendingRedisInitial = initial.redis;
  let pendingEsInitial = initial.es;
  let pendingS3Initial = initial.s3;
  let pendingDynamodbInitial = initial.dynamodb;

  async function enter(
    db?: string | null,
    schema?: string | null,
    table?: string | null,
    view?: TabName,
    options: DatabaseEnterOptions = {},
  ) {
    const generation = ++loadGeneration;
    const filesResponse = await fetchDbFiles();
    if (generation !== loadGeneration) return;
    const files = filesResponse.files;
    lastFiles = files;
    noDatastoresAvailable = files.length === 0;
    if (filesResponse.truncated) {
      showDockerNotice(paneText().nav.dockerLimitReached);
    } else {
      clearDockerNotice();
    }
    dbSelect.innerHTML = "";
    if (files.length === 0) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = paneText().nav.noDatastores;
      dbSelect.appendChild(opt);
      dbSelect.disabled = true;
      currentDbInfo = null;
      syncConnectionActions();
      currentSchema = null;
      currentTable = null;
      schemaCache = null;
      renderSchemaOptions([], null);
      tableList.render([]);
      grid.clear();
      schemaView.clear();
      erDiagram.clear();
      redisExplorer.clear();
      esExplorer.clear();
      s3Explorer.clear();
      dynamodbExplorer.clear();
      renderNoDatastoresEmpty();
      applyVisibility();
      cb.onStateChange();
      return;
    }
    dbSelect.disabled = false;
    const optionsFragment = document.createDocumentFragment();
    for (const f of files) {
      const opt = document.createElement("option");
      opt.value = f.id;
      const isDocker = f.id.startsWith("docker:");
      const isSupabase = f.id.startsWith("supabase:");
      const label = f.savedConnection
        ? f.name
        : isDocker
          ? `${f.name} (Docker)`
          : isSupabase
            ? `${f.name} (Supabase)`
            : `${f.path} (${formatSize(f.sizeBytes)})`;
      opt.textContent = label;
      optionsFragment.appendChild(opt);
    }
    dbSelect.appendChild(optionsFragment);

    const autoSelectFirst = options.autoSelectFirst ?? true;
    if (db && !files.find((f) => f.id === db)) {
      db = autoSelectFirst ? files[0].id : null;
    }
    if (!db && !autoSelectFirst) {
      dbSelect.value = "";
      currentDbInfo = null;
      syncConnectionActions();
      currentSchema = null;
      currentTable = null;
      schemaCache = null;
      renderSchemaOptions([], null);
      tableList.render([]);
      grid.clear();
      schemaView.clear();
      erDiagram.clear();
      redisExplorer.clear();
      esExplorer.clear();
      s3Explorer.clear();
      dynamodbExplorer.clear();
      setActiveTab("data", false);
      cb.onStateChange();
      return;
    }
    const target = db || files[0].id;
    dbSelect.value = target;
    currentDbInfo = files.find((f) => f.id === target) || null;
    syncConnectionActions();

    // 復元時は initial の redis/es selection を 1 度だけ流し込む。
    // forceReload (データストア更新ボタン) のときは、pending initial の
    // 代わりにライブの現在選択 (getSelection()) を initial として渡す。
    // これにより各 explorer.load() 内の「同じ dbId かつ initial なしなら
    // skip」ガードを迂回して一覧を再取得しつつ、選択中のテーブル/キー等は
    // 維持する (さもないと更新のたびに先頭テーブルへ戻ってしまう)。
    const forceReload = options.forceReload ?? false;
    const explorerInitial = {
      redis:
        pendingRedisInitial ??
        (forceReload && currentDbInfo?.kind === "redis"
          ? redisExplorer.getSelection()
          : undefined),
      es:
        pendingEsInitial ??
        (forceReload && currentDbInfo?.kind === "elasticsearch"
          ? esExplorer.getSelection()
          : undefined),
      s3:
        pendingS3Initial ??
        (forceReload && currentDbInfo?.kind === "s3"
          ? s3Explorer.getSelection()
          : undefined),
      dynamodb:
        pendingDynamodbInitial ??
        (forceReload && currentDbInfo?.kind === "dynamodb"
          ? dynamodbExplorer.getSelection()
          : undefined),
    };
    pendingRedisInitial = undefined;
    pendingEsInitial = undefined;
    pendingS3Initial = undefined;
    pendingDynamodbInitial = undefined;
    await selectDb(
      target,
      explorerInitial,
      generation,
      schema !== undefined ? schema : currentSchema,
      table,
      view,
    );
    if (generation !== loadGeneration || currentDbInfo?.id !== target) return;
    if (
      currentDbInfo?.kind === "redis" ||
      currentDbInfo?.kind === "elasticsearch" ||
      currentDbInfo?.kind === "s3" ||
      currentDbInfo?.kind === "dynamodb"
    ) {
      cb.onStateChange();
      return;
    }
    if (!schemaCache) {
      cb.onStateChange();
      return;
    }
    if (generation !== loadGeneration) return;
    const normalizedView = normalizeViewForDb(view, currentDbInfo);
    if (normalizedView !== "data") {
      setActiveTab(normalizedView);
      if (normalizedView === "schema") {
        const activeTable = tableList.el.querySelector<HTMLElement>(
          ".db-table-item.active",
        );
        if (activeTable?.dataset.table) showSchema(activeTable.dataset.table);
      } else if (normalizedView === "er") {
        if (schemaCache) renderErDiagram();
      } else if (normalizedView === "snapshot") {
        snapshotView.refresh();
        // ?diffBefore=&diffAfter= が URL にあれば inline diff を復元する。
        snapshotView.restoreDiffFromRoute();
      }
    }
    applyAnnotationTarget(options.annotationTarget);
    cb.onStateChange();
  }

  function applyAnnotationTarget(
    target: DatabaseAnnotationTarget | undefined,
  ): void {
    if (!target || target.db !== currentDbInfo?.id) return;
    if (target.schema && target.schema !== currentSchema) return;
    if (target.data) {
      if (target.table && target.table !== currentTable) return;
      setActiveTab("data");
      grid.applyState(target.data);
    }
    if (target.query) {
      setActiveTab("query");
      if (target.query.sql)
        queryEditor.setSql(target.query.sql, { silent: true });
      if (target.query.autoRun && target.query.sql) {
        // Client-side SQL classification is only a UX hint; the server-side
        // readonly execution path is the actual protection boundary.
        if (!looksReadOnlySql(target.query.sql)) return;
        void (target.query.mode === "explain"
          ? queryEditor.explain()
          : queryEditor.run());
      }
    }
    if (target.search) {
      setActiveTab("search");
      globalSearchView.setSearch(target.search.term || "", {
        includeNonText: target.search.includeNonText,
        autoRun: target.search.autoRun,
      });
    }
  }

  function handleSse(event?: string, data?: string) {
    if (userPrefersHistoryOpen && cb.isActive()) {
      if (historyRefreshPending !== null) clearTimeout(historyRefreshPending);
      historyRefreshPending = setTimeout(() => {
        historyRefreshPending = null;
        if (userPrefersHistoryOpen && cb.isActive()) {
          historyView.refresh({ force: true });
        }
      }, HISTORY_SSE_REFRESH_DELAY_MS);
    }
    if (event === "db-snapshot" && data) {
      snapshotView.handleSse(data);
    }
  }

  function getState(): TabState {
    const loaded = !!currentDbInfo;
    const schema = loaded ? currentSchema : (initial.schema ?? currentSchema);
    const state: TabState = {
      id: cb.tabId,
      dbId: currentDbInfo?.id ?? initial.dbId ?? null,
      table: loaded ? currentTable : (initial.table ?? currentTable ?? null),
      view: loaded ? currentTab : (initial.view ?? currentTab),
    };
    if (schema) state.schema = schema;

    // 永続化対象の per-tab UI state を載せる。空値は載せない (= tabs.json の
    // 体積を最小化、旧形式と区別しやすくする)。
    const sqlDraft = queryEditor.getSql();
    if (sqlDraft) state.sqlDraft = sqlDraft;
    // historyOpen は default = true なので、true のときは載せない (= 既定値)。
    // false のときだけ load 時に「閉じる」と判定できればよい。
    if (!userPrefersHistoryOpen) state.historyOpen = false;
    if (historyPane.style.height)
      state.historyHeight = historyPane.style.height;
    // activeHistoryTab は default = "history" なので、"log" のときだけ載せる。
    if (activeHistoryTab === "log") state.activeHistoryTab = "log";
    if (sidebar.style.width) state.sidebarWidth = sidebar.style.width;
    if (relatedPanelHeightPx != null)
      state.relatedPanelHeight = `${relatedPanelHeightPx}px`;
    if (detailPanelHeightPx != null)
      state.detailPanelHeight = `${detailPanelHeightPx}px`;

    if (!loaded) {
      if (initial.redis) state.redis = initial.redis;
      if (initial.es) state.es = initial.es;
      if (initial.s3) state.s3 = initial.s3;
      if (initial.dynamodb) state.dynamodb = initial.dynamodb;
    } else if (currentDbInfo?.kind === "redis") {
      const sel = redisExplorer.getSelection();
      if (
        sel.dbIndex !== undefined ||
        sel.key !== undefined ||
        sel.keyFilter !== undefined
      ) {
        state.redis = sel;
      }
    } else if (currentDbInfo?.kind === "elasticsearch") {
      const sel = esExplorer.getSelection();
      if (sel.index !== undefined || sel.query !== undefined) {
        state.es = sel;
      }
    } else if (currentDbInfo?.kind === "s3") {
      const sel = s3Explorer.getSelection();
      if (
        sel.bucket !== undefined ||
        sel.prefix !== undefined ||
        sel.query !== undefined ||
        sel.key !== undefined ||
        sel.mode !== "prefix" ||
        sel.sort !== "updated-desc" ||
        sel.view === "explorer"
      ) {
        state.s3 = sel;
      }
    } else if (currentDbInfo?.kind === "dynamodb") {
      const sel = dynamodbExplorer.getSelection();
      if (
        sel.table !== undefined ||
        sel.mode !== "scan" ||
        sel.keyConditionExpression !== undefined ||
        sel.filterExpression !== undefined ||
        sel.expressionAttributeValues !== undefined ||
        sel.itemKey !== undefined ||
        sel.detailTab === "item"
      ) {
        state.dynamodb = sel;
      }
    }

    return state;
  }

  function getAnnotationTarget(): DatabaseAnnotationTarget | null {
    if (!currentDbInfo) return null;
    const target: DatabaseAnnotationTarget = {
      kind: "database",
      db: currentDbInfo.id,
      ...(currentSchema ? { schema: currentSchema } : {}),
      ...(currentTable ? { table: currentTable } : {}),
      tab: currentTab,
    };
    if (currentTab === "data") {
      target.data = grid.getState();
    } else if (currentTab === "query") {
      const sql = queryEditor.getSql();
      target.query = { ...(sql ? { sql } : {}), mode: "run" };
    } else if (currentTab === "search") {
      target.search = globalSearchView.getSearch();
    }
    return target;
  }

  function getLabel(): string {
    if (noDatastoresAvailable) return paneText().nav.noDatastoreTab;
    if (!currentDbInfo) return labelFromDbId(initial.dbId);
    const suffix = currentSchema ? ` / ${currentSchema}` : "";
    if (currentDbInfo.savedConnection) {
      return `${currentDbInfo.name}${suffix}`;
    }
    // 既存 sidebar select の表示と揃える: docker/supabase は service 名 (or
    // project_id)、sqlite は path basename。
    if (
      currentDbInfo.id.startsWith("docker:") ||
      currentDbInfo.id.startsWith("supabase:")
    ) {
      // currentDbInfo.name は recursive discovery の長い label なので、先頭の
      // service 名 (or supabase project_id) 部分だけ取り出す。
      // 例: "redis-svc (redis:7-alpine, localhost:6390 — data/test/redis)"
      //  → "redis-svc"
      const m = currentDbInfo.name.match(/^(\S+)/);
      return `${m ? m[1] : currentDbInfo.name}${suffix}`;
    }
    const lastSlash = currentDbInfo.path.lastIndexOf("/");
    const label =
      lastSlash >= 0
        ? currentDbInfo.path.slice(lastSlash + 1)
        : currentDbInfo.path;
    return `${label}${suffix}`;
  }

  function dispose(): void {
    loadGeneration++;
    tableSelectGuard.dispose();
    // pref listener を必ず外す。残ると destroyed grid に refreshForeignKeys
    // が飛んで「detached DOM 書込み」になる。
    disposeInferFkPrefSub();
    if (historyRefreshPending !== null) {
      clearTimeout(historyRefreshPending);
      historyRefreshPending = null;
    }
    grid.destroy();
    schemaView.clear();
    erDiagram.dispose();
    tableList.dispose();
    queryEditor.dispose();
    globalSearchView.dispose();
    snapshotView.dispose();
    historyView.clear();
    redisExplorer.dispose();
    esExplorer.dispose();
    s3Explorer.dispose();
    dynamodbExplorer.dispose();
    currentDbInfo = null;
    currentSchema = null;
    currentTable = null;
    schemaCache = null;
  }

  // 言語切替時、組み込み済み DOM の文言を再適用する（再描画なし）。
  // 各サブコンポーネントは順次 localize() 対応していく。
  function localizePane() {
    for (const fn of paneLocalizers) fn();
    if (noDatastoresAvailable) renderNoDatastoresEmpty();
    grid.localize();
    schemaView.localize();
    erDiagram.localize();
    historyView.localize();
    queryEditor.localize();
    globalSearchView.localize();
    snapshotView.localize();
    redisExplorer.localize();
    esExplorer.localize();
    s3Explorer.localize();
    dynamodbExplorer.localize();
  }

  return {
    el: container,
    enter,
    handleSse,
    getState,
    getAnnotationTarget,
    getLabel,
    dispose,
    localize: localizePane,
  };
}

// ----- アイコンツールバー (案 B 改: TablePlus / Beekeeper 風) -----
// octicon / bootstrap-icons ベースの 16x16 path。currentColor で描画して
// hover / active 時の色変更を CSS から制御できるようにする。

const ICON_PATH_QUERY =
  "M5.72 4.22a.75.75 0 0 1 0 1.06L2.81 8l2.91 2.72a.75.75 0 1 1-1.06 1.06L1.22 8.53a.75.75 0 0 1 0-1.06l3.44-3.25a.75.75 0 0 1 1.06 0Zm4.56 0a.75.75 0 0 1 1.06 0l3.44 3.25a.75.75 0 0 1 0 1.06l-3.44 3.25a.75.75 0 1 1-1.06-1.06L13.19 8l-2.91-2.72a.75.75 0 0 1 0-1.06Z";

const ICON_PATH_ER =
  "M1.5 1.75A.75.75 0 0 1 2.25 1h4.5a.75.75 0 0 1 .75.75v3.5h2v-1.5A.75.75 0 0 1 10.25 3h3.5a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-.75.75h-3.5a.75.75 0 0 1-.75-.75V6.5h-2v3h2v-.75A.75.75 0 0 1 10.25 8h3.5a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-.75.75h-3.5a.75.75 0 0 1-.75-.75v-1.5h-2v3.5a.75.75 0 0 1-.75.75h-4.5a.75.75 0 0 1-.75-.75v-3.5A.75.75 0 0 1 2.25 9h4.5a.75.75 0 0 1 .75.75v.75h-.5v-1H3v3h3V11h.5v-.75a.75.75 0 0 0-.75-.75H3V6.5h2.5V2.5H3Z";

const ICON_PATH_SNAPSHOT =
  "M3.5 1.75A1.75 1.75 0 0 1 5.25 0h5.5A1.75 1.75 0 0 1 12.5 1.75v.5h1.75A1.75 1.75 0 0 1 16 4v9.25A1.75 1.75 0 0 1 14.25 15H1.75A1.75 1.75 0 0 1 0 13.25V4a1.75 1.75 0 0 1 1.75-1.75H3.5v-.5Zm1.5.5v.5h6v-.5a.25.25 0 0 0-.25-.25h-5.5a.25.25 0 0 0-.25.25Zm-3.25 2a.25.25 0 0 0-.25.25v9.25c0 .138.112.25.25.25h12.5a.25.25 0 0 0 .25-.25V4a.25.25 0 0 0-.25-.25H1.75ZM8 6a2.75 2.75 0 1 0 0 5.5 2.75 2.75 0 0 0 0-5.5Z";

// 鉛筆 icon (octicon pencil)。編集モードのトグル UI に使う。
const ICON_PATH_EDIT_MODE =
  "M11.013 1.427a1.75 1.75 0 0 1 2.474 0l1.086 1.086a1.75 1.75 0 0 1 0 2.474l-8.61 8.61c-.21.21-.47.364-.756.445l-3.251.93a.75.75 0 0 1-.927-.928l.929-3.25c.081-.286.235-.547.445-.758l8.61-8.61Zm.176 4.823L9.75 4.81l-6.286 6.287a.247.247 0 0 0-.064.108l-.558 1.953 1.953-.558a.249.249 0 0 0 .108-.064l6.286-6.286Zm1.238-3.763a.25.25 0 0 0-.354 0L10.811 3.75l1.439 1.44 1.263-1.263a.25.25 0 0 0 0-.354L12.427 2.49Z";

function makeIconButton(opts: {
  label: string;
  title: string;
  pathD: string;
  onClick: () => void;
}): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "db-icon-btn";
  btn.title = opts.title;
  btn.setAttribute("aria-label", opts.label);
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(NS, "path");
  path.setAttribute("d", opts.pathD);
  path.setAttribute("fill", "currentColor");
  svg.appendChild(path);
  btn.appendChild(svg);
  btn.addEventListener("click", opts.onClick);
  return btn;
}

/** アイコンボタンの title / aria-label を言語切替時に再適用する。 */
function localizeIconButton(
  btn: HTMLButtonElement,
  label: string,
  title: string,
): void {
  btn.title = title;
  btn.setAttribute("aria-label", label);
}

// ----- 外側: 複数 TabPane を束ねる -----

export function createDatabaseView(deps: DatabaseViewDeps): DatabaseView {
  let mounted = false;
  const outerText = (): DbText => dbText(deps.getLanguage?.() ?? "en");
  const tabsById = new Map<string, DbTabEntry>();
  const paneReadyById = new Map<string, Promise<void>>();
  const lazyInitialById = new Map<string, Partial<TabState> | undefined>();
  let activeTabId: string | null = null;
  let draggingTabId: string | null = null;
  let dropTargetId: string | null = null;
  let dropAfterTarget = false;
  // restoring 中は scheduleSave を抑制して、初期復元の連鎖 setState で
  // 過剰な PUT を発生させないようにする。復元完了後に 1 回まとめて保存する。
  let restoringDepth = 0;
  let savePending: ReturnType<typeof setTimeout> | null = null;
  let saveChain: Promise<void> = Promise.resolve();
  let lastSavedTabsRaw: string | null = null;
  let pendingSavedTabsRaw: string | null = null;
  let saveController: AbortController | null = null;
  let lifecycleSeq = 0;
  let enterQueue: Promise<void> = Promise.resolve();
  let unloadListenerInstalled = false;
  let dbFilesCache:
    | { value: DbFilesResponse; expiresAt: number; promise?: undefined }
    | {
        value?: undefined;
        expiresAt?: undefined;
        promise: Promise<DbFilesResponse>;
      }
    | null = null;
  let dbUiState: DbUiState = { version: 1, columnWidths: {} };
  let dbUiLoadPromise: Promise<void> | null = null;
  // セッション限定のログストア (database-view 全体で共有)。SQL 実行 / 編集
  // コミットの成否を全 tabPane が同じインスタンスに push する。各 tabPane の
  // 履歴 pane 内「ログ」タブで時系列表示する (view は tabPane 側で生成)。
  const sessionLog = createSessionLog();

  function isRestoring(): boolean {
    return restoringDepth > 0;
  }

  function actionHeaders(): HeadersInit {
    return {
      "Content-Type": "application/json",
      "X-Code-Viewer-Action": "1",
    };
  }

  async function ensureDbUiState(): Promise<void> {
    if (dbUiLoadPromise) return dbUiLoadPromise;
    dbUiLoadPromise = fetch("/_db/ui")
      .then(async (res) => {
        if (!res.ok) return;
        // applyDbUiState 経由で listeners を起こす。直接代入だと「ロード完了
        // 後にトグル UI に色が反映されない」回帰 (Rails FK 推測トグルで報告)
        // の原因になる。
        applyDbUiState((await res.json()) as DbUiState);
      })
      .catch(() => undefined);
    return dbUiLoadPromise;
  }

  function getColumnWidths(
    dbId: string,
    table: string,
  ): Record<string, number> {
    return { ...(dbUiState.columnWidths[dbId]?.[table] || {}) };
  }

  function setColumnWidths(
    dbId: string,
    table: string,
    widths: Record<string, number>,
  ): void {
    const nextDb = { ...(dbUiState.columnWidths[dbId] || {}) };
    nextDb[table] = { ...widths };
    dbUiState = {
      ...dbUiState,
      version: 1,
      columnWidths: { ...dbUiState.columnWidths, [dbId]: nextDb },
    };
    // PATCH のレスポンスは local state には流し込まない: 連続書込時に古い
    // レスポンスが後勝ちして新しいローカル値を巻き戻す race を避ける。サーバ
    // 側 merge は idempotent なので、各 PATCH が独立に届けば十分。
    void fetch("/_db/ui", {
      method: "PATCH",
      headers: actionHeaders(),
      body: JSON.stringify({ columnWidths: { [dbId]: { [table]: widths } } }),
    }).catch(() => undefined);
  }

  // dbUiState 内の `Record<scope, string[]>` 形フィールドを 1 か所で更新する
  // ヘルパ。expandedTables / snapshotSelectedTables の両方が同じ shape なので、
  // (1) state を mutate、(2) 結果が空なら scope を消す、(3) applyDbUiState、
  // (4) /_db/ui に PATCH 送信、という流れを抽象化する。
  type ScopedTableMapKey = "expandedTables" | "snapshotSelectedTables";
  function updateScopedTableList(
    stateKey: ScopedTableMapKey,
    scopeKey: string,
    mutate: (tables: Set<string>) => void,
  ): void {
    const current = { ...(dbUiState[stateKey] || {}) };
    const tables = new Set(current[scopeKey] || []);
    mutate(tables);
    const nextTables = [...tables].sort((a, b) => a.localeCompare(b));
    if (nextTables.length > 0) current[scopeKey] = nextTables;
    else delete current[scopeKey];
    const nextMap = Object.keys(current).length > 0 ? current : undefined;
    const nextState: DbUiState = { ...dbUiState, version: 1 };
    if (nextMap) nextState[stateKey] = nextMap;
    else delete nextState[stateKey];
    applyDbUiState(nextState);
    void fetch("/_db/ui", {
      method: "PATCH",
      headers: actionHeaders(),
      body: JSON.stringify({
        [stateKey]: {
          [scopeKey]: nextTables.length > 0 ? nextTables : null,
        },
      }),
    }).catch(() => undefined);
  }

  function getExpandedTables(scopeKey: string): string[] {
    return [...(dbUiState.expandedTables?.[scopeKey] || [])];
  }

  function setExpandedTable(
    scopeKey: string,
    table: string,
    expanded: boolean,
  ): void {
    updateScopedTableList("expandedTables", scopeKey, (tables) => {
      if (expanded) tables.add(table);
      else tables.delete(table);
    });
  }

  // snapshot 取得ダイアログで前回チェックされていたテーブル集合を scope 単位
  // (dbId + schema) で永続化する。
  function getSnapshotSelectedTables(scopeKey: string): string[] {
    return [...(dbUiState.snapshotSelectedTables?.[scopeKey] || [])];
  }

  function setSnapshotSelectedTables(scopeKey: string, tables: string[]): void {
    updateScopedTableList("snapshotSelectedTables", scopeKey, (set) => {
      set.clear();
      for (const t of tables) set.add(t);
    });
  }

  // prefs (boolean トグル) は dbUiState.prefs に集約。listener で UI 側にも
  // 即時通知する (例: 別タブで切り替えたら全タブの S3 explorer のトグル
  // 表示も更新される — 今は同タブ即時反映のみで十分だが、形だけ用意)。
  const dbUiPrefListeners = new Set<(state: DbUiState) => void>();
  function applyDbUiState(next: DbUiState) {
    dbUiState = next;
    for (const fn of dbUiPrefListeners) fn(dbUiState);
  }
  function getDbUiPref<K extends keyof DbUiPrefs>(
    key: K,
    fallback: NonNullable<DbUiPrefs[K]>,
  ): NonNullable<DbUiPrefs[K]> {
    const v = dbUiState.prefs?.[key];
    return v === undefined ? fallback : (v as NonNullable<DbUiPrefs[K]>);
  }
  function setDbUiPref<K extends keyof DbUiPrefs>(
    key: K,
    value: NonNullable<DbUiPrefs[K]>,
  ): void {
    const nextPrefs: DbUiPrefs = { ...(dbUiState.prefs ?? {}), [key]: value };
    applyDbUiState({ ...dbUiState, prefs: nextPrefs });
    // PATCH のレスポンスは local state に再適用しない (setColumnWidths と
    // 同様の race 対策)。
    void fetch("/_db/ui", {
      method: "PATCH",
      headers: actionHeaders(),
      body: JSON.stringify({ prefs: { [key]: value } }),
    }).catch(() => undefined);
  }
  function onDbUiPrefChange(listener: (state: DbUiState) => void): () => void {
    dbUiPrefListeners.add(listener);
    return () => dbUiPrefListeners.delete(listener);
  }

  async function loadSqlHistory(
    dbId: string | null,
    schema: string | null,
  ): Promise<string[]> {
    if (!dbId) return [];
    const params = new URLSearchParams({ db: dbId });
    if (schema) params.set("schema", schema);
    const res = await fetch(`/_db/history?${params}`);
    if (!res.ok) return [];
    const state = (await res.json()) as QueryHistoryState;
    const seen = new Set<string>();
    const history: string[] = [];
    for (const entry of state.entries) {
      const sql = entry.sql.trim();
      if (!sql || seen.has(sql)) continue;
      seen.add(sql);
      history.push(sql);
      if (history.length >= 50) break;
    }
    return history;
  }

  function beginRestoring(): () => void {
    restoringDepth += 1;
    let finished = false;
    return () => {
      if (finished) return;
      finished = true;
      restoringDepth = Math.max(0, restoringDepth - 1);
    };
  }

  function fetchDbFilesCached(): Promise<DbFilesResponse> {
    const now = Date.now();
    if (dbFilesCache?.value && dbFilesCache.expiresAt > now) {
      return Promise.resolve(dbFilesCache.value);
    }
    if (dbFilesCache?.promise) return dbFilesCache.promise;
    const promise = deps
      .trackLoad(fetch("/_db/files"))
      .then(async (res) => {
        if (!res.ok) {
          const value: DbFilesResponse = { files: [] };
          dbFilesCache = { value, expiresAt: Date.now() + 10_000 };
          return value;
        }
        const value = (await res.json()) as DbFilesResponse;
        dbFilesCache = { value, expiresAt: Date.now() + 10_000 };
        return value;
      })
      .catch(() => {
        const value: DbFilesResponse = { files: [] };
        dbFilesCache = { value, expiresAt: Date.now() + 10_000 };
        return value;
      })
      .finally(() => {
        if (dbFilesCache?.promise === promise) dbFilesCache = null;
      });
    dbFilesCache = { promise };
    return promise;
  }

  function scheduleSave(): void {
    if (!mounted || isRestoring()) return;
    if (savePending !== null) clearTimeout(savePending);
    savePending = setTimeout(saveNow, 500);
  }

  function abortActiveSave(): void {
    saveController?.abort();
    saveController = null;
  }

  async function saveNow(options: { keepalive?: boolean } = {}): Promise<void> {
    savePending = null;
    if (!mounted || isRestoring()) return;
    const tabs: TabState[] = [];
    for (const [, entry] of tabsById) {
      tabs.push(entry.pane.getState());
    }
    if (tabs.length === 0) return;
    const body: TabsState = { version: 1, tabs, activeTabId };
    const raw = JSON.stringify(body);
    if (raw === lastSavedTabsRaw) return;
    if (!options.keepalive && raw === pendingSavedTabsRaw) return;
    pendingSavedTabsRaw = raw;
    abortActiveSave();
    if (options.keepalive) {
      try {
        await fetch("/_db/tabs", {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            "X-Code-Viewer-Action": "1",
          },
          body: raw,
          keepalive: true,
        });
        lastSavedTabsRaw = raw;
      } catch {
        // ベストエフォート。失敗してもユーザー操作は妨げない。
      } finally {
        if (pendingSavedTabsRaw === raw) pendingSavedTabsRaw = null;
      }
      return;
    }
    saveChain = saveChain
      .catch(() => undefined)
      .then(async () => {
        const controller = new AbortController();
        saveController = controller;
        try {
          await fetch("/_db/tabs", {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
              "X-Code-Viewer-Action": "1",
            },
            body: raw,
            signal: controller.signal,
          });
          lastSavedTabsRaw = raw;
        } catch (err) {
          if (!isAbortError(err)) {
            // ベストエフォート。失敗してもユーザー操作は妨げない。
          }
        } finally {
          if (saveController === controller) saveController = null;
          if (pendingSavedTabsRaw === raw) pendingSavedTabsRaw = null;
        }
      });
    await saveChain;
  }

  function flushPendingSave(options: { keepalive?: boolean } = {}): void {
    if (savePending !== null) {
      clearTimeout(savePending);
      savePending = null;
    }
    void saveNow(options);
  }

  function handleBeforeUnload(): void {
    flushPendingSave({ keepalive: true });
  }

  async function fetchTabs(): Promise<TabsResponse | null> {
    try {
      const res = await fetch("/_db/tabs");
      if (!res.ok) return null;
      return (await res.json()) as TabsResponse;
    } catch {
      return null;
    }
  }

  const tabsBar = document.createElement("div");
  tabsBar.className = "db-tabs-bar";
  const tabsList = document.createElement("div");
  tabsList.className = "db-tabs-list";
  tabsList.setAttribute("role", "tablist");
  const newTabBtn = document.createElement("button");
  newTabBtn.type = "button";
  newTabBtn.className = "db-tabs-new-btn";
  newTabBtn.title = outerText().nav.newTab;
  newTabBtn.textContent = "+";
  tabsBar.append(tabsList, newTabBtn);

  const tabHost = document.createElement("div");
  tabHost.className = "db-tab-host";

  const root = document.createElement("div");
  root.className = "db-root";
  root.append(tabsBar, tabHost);

  function setActive(id: string): void {
    activeTabId = id;
    for (const [tid, entry] of tabsById) {
      const isActive = tid === id;
      entry.pane.el.hidden = !isActive;
      entry.chip.classList.toggle("active", isActive);
      entry.chip.setAttribute("aria-selected", isActive ? "true" : "false");
      entry.chip.tabIndex = isActive ? 0 : -1;
      entry.closeBtn.tabIndex = isActive ? 0 : -1;
    }
    if (!isRestoring()) syncActiveRoute();
    scheduleSave();
    if (mounted && !isRestoring()) {
      void ensureInitialEnter(id)?.catch(() => undefined);
    }
  }

  function syncActiveRoute(): void {
    if (!activeTabId) return;
    const entry = tabsById.get(activeTabId);
    if (!entry) return;
    const s = entry.pane.getState();
    // snapshot diff の URL state (?diffBefore=&diffAfter=) は pane の getState
    // に乗っていない — setRouteDiff が直接 URL に書く設計なので、ここで再構築
    // すると落としてしまう。snapshot タブのときだけ、現在 URL の diff 値を
    // 引き継いで setRoute する (落とすと setRouteDiff 直後にレース的に消える)。
    const isSnapshot = s.view === "snapshot";
    let diffBefore: string | undefined;
    let diffAfter: string | undefined;
    if (isSnapshot) {
      const url = new URL(window.location.href);
      diffBefore = url.searchParams.get("diffBefore") ?? undefined;
      diffAfter = url.searchParams.get("diffAfter") ?? undefined;
    }
    deps.setRoute(
      {
        screen: "database",
        db: s.dbId ?? undefined,
        schema: s.schema ?? undefined,
        table: s.table ?? undefined,
        tab: s.view === "data" ? undefined : s.view,
        ...(diffBefore ? { diffBefore } : {}),
        ...(diffAfter ? { diffAfter } : {}),
        range: deps.currentRange(),
      },
      true,
    );
  }

  function refreshChipLabel(id: string): void {
    const entry = tabsById.get(id);
    if (!entry) return;
    const label = entry.pane.getLabel();
    entry.label.textContent = label;
    entry.label.title = label;
    entry.closeBtn.setAttribute("aria-label", outerText().nav.closeTab(label));
  }

  function dedupeTabs(tabs: TabState[]): TabState[] {
    const seen = new Set<string>();
    const deduped: TabState[] = [];
    for (const tab of tabs) {
      const key = JSON.stringify({
        dbId: tab.dbId,
        schema: tab.schema ?? null,
        table: tab.table,
        view: tab.view,
        redis: tab.redis ?? null,
        es: tab.es ?? null,
        s3: tab.s3 ?? null,
        dynamodb: tab.dynamodb ?? null,
      });
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(tab);
    }
    return deduped;
  }

  function isDbStillOpen(dbId: string): boolean {
    for (const [, entry] of tabsById) {
      if (entry.pane.getState().dbId === dbId) return true;
    }
    return false;
  }

  function closeDbIfUnused(dbId: string | null): void {
    if (!dbId || isDbStillOpen(dbId)) return;
    const body = JSON.stringify({ db: dbId });
    const headers = {
      "Content-Type": "application/json",
      "X-Code-Viewer-Action": "1",
    };
    void fetch("/_db/close", { method: "POST", headers, body }).catch(
      () => undefined,
    );
  }

  function clearDropTarget(): void {
    if (!dropTargetId) return;
    const entry = tabsById.get(dropTargetId);
    if (entry) {
      entry.chip.classList.remove("drop-target", "drop-after");
    }
    dropTargetId = null;
    dropAfterTarget = false;
  }

  function clearDragState(): void {
    for (const [, entry] of tabsById) {
      entry.chip.classList.remove("dragging", "drop-target", "drop-after");
    }
    draggingTabId = null;
    dropTargetId = null;
    dropAfterTarget = false;
  }

  function isDropAfter(chip: HTMLElement, ev: DragEvent): boolean {
    const rect = chip.getBoundingClientRect();
    return ev.clientX > rect.left + rect.width / 2;
  }

  function markDropTarget(id: string, after: boolean): void {
    if (dropTargetId !== id || dropAfterTarget !== after) clearDropTarget();
    dropTargetId = id;
    dropAfterTarget = after;
    const entry = tabsById.get(id);
    if (!entry) return;
    entry.chip.classList.add("drop-target");
    entry.chip.classList.toggle("drop-after", after);
  }

  function reorderTabs(ids: string[]): void {
    const next = new Map<string, DbTabEntry>();
    for (const id of ids) {
      const entry = tabsById.get(id);
      if (entry) next.set(id, entry);
    }
    tabsById.clear();
    for (const [id, entry] of next) tabsById.set(id, entry);
  }

  function moveTabBeforeOrAfter(
    dragId: string,
    targetId: string,
    after: boolean,
  ): void {
    if (dragId === targetId) return;
    const dragEntry = tabsById.get(dragId);
    const targetEntry = tabsById.get(targetId);
    if (!dragEntry || !targetEntry) return;
    const orderedIds = Array.from(tabsById.keys());
    const dragIndex = orderedIds.indexOf(dragId);
    if (dragIndex < 0) return;
    orderedIds.splice(dragIndex, 1);
    const targetIndex = orderedIds.indexOf(targetId);
    if (targetIndex < 0) {
      orderedIds.splice(dragIndex, 0, dragId);
      reorderTabs(orderedIds);
      return;
    }
    const insertIndex = targetIndex + (after ? 1 : 0);
    orderedIds.splice(insertIndex, 0, dragId);
    reorderTabs(orderedIds);
    tabsList.insertBefore(
      dragEntry.chip,
      after ? targetEntry.chip.nextSibling : targetEntry.chip,
    );
    scheduleSave();
  }

  function moveTabToEnd(dragId: string): void {
    const dragEntry = tabsById.get(dragId);
    if (!dragEntry) return;
    const orderedIds = Array.from(tabsById.keys());
    const dragIndex = orderedIds.indexOf(dragId);
    if (dragIndex < 0 || dragIndex === orderedIds.length - 1) return;
    orderedIds.splice(dragIndex, 1);
    orderedIds.push(dragId);
    reorderTabs(orderedIds);
    tabsList.appendChild(dragEntry.chip);
    scheduleSave();
  }

  function attachTabDragHandlers(
    chip: HTMLElement,
    closeBtn: HTMLButtonElement,
    id: string,
  ): void {
    chip.draggable = true;
    closeBtn.draggable = false;

    chip.addEventListener("dragstart", (e) => {
      if ((e.target as HTMLElement | null)?.closest(".db-tabs-chip-close")) {
        e.preventDefault();
        return;
      }
      draggingTabId = id;
      chip.classList.add("dragging");
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", id);
      }
    });

    chip.addEventListener("dragenter", (e) => {
      if (!draggingTabId || draggingTabId === id) return;
      e.preventDefault();
      markDropTarget(id, isDropAfter(chip, e));
    });

    chip.addEventListener("dragover", (e) => {
      if (!draggingTabId || draggingTabId === id) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
      markDropTarget(id, isDropAfter(chip, e));
    });

    chip.addEventListener("dragleave", (e) => {
      const related = e.relatedTarget as Node | null;
      if (related && chip.contains(related)) return;
      if (dropTargetId === id) clearDropTarget();
    });

    chip.addEventListener("drop", (e) => {
      if (!draggingTabId || draggingTabId === id) return;
      e.preventDefault();
      moveTabBeforeOrAfter(draggingTabId, id, isDropAfter(chip, e));
      clearDragState();
    });

    chip.addEventListener("dragend", () => clearDragState());
  }

  tabsList.addEventListener("dragover", (e) => {
    if (!draggingTabId) return;
    const target = (e.target as HTMLElement | null)?.closest(".db-tabs-chip");
    if (target && tabsList.contains(target)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    clearDropTarget();
  });

  tabsList.addEventListener("drop", (e) => {
    if (!draggingTabId) return;
    const target = (e.target as HTMLElement | null)?.closest(".db-tabs-chip");
    if (target && tabsList.contains(target)) return;
    e.preventDefault();
    moveTabToEnd(draggingTabId);
    clearDragState();
  });

  function openTab(
    initial?: Partial<TabState>,
    options: OpenTabOptions = {},
  ): string {
    const id = initial?.id || makeId("t");

    const chip = document.createElement("div");
    chip.className = "db-tabs-chip";
    chip.dataset.tabId = id;
    chip.setAttribute("role", "tab");
    chip.setAttribute("aria-selected", "false");
    chip.tabIndex = -1;

    const labelEl = document.createElement("span");
    labelEl.className = "db-tabs-chip-label";
    const initialLabel = labelFromDbId(initial?.dbId);
    labelEl.textContent = initialLabel;
    labelEl.title = initialLabel;

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "db-tabs-chip-close";
    closeBtn.tabIndex = -1;
    closeBtn.textContent = "×";
    const closeTabLabel = outerText().nav.closeTab(initialLabel);
    closeBtn.title = closeTabLabel;
    closeBtn.setAttribute("aria-label", closeTabLabel);
    closeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      closeTab(id);
    });

    chip.append(labelEl, closeBtn);
    attachTabDragHandlers(chip, closeBtn, id);
    chip.addEventListener("click", () => setActive(id));
    chip.addEventListener("keydown", (e) => {
      if (isImeComposing(e)) return;
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        setActive(id);
      }
    });
    // middle-click でも閉じる。
    chip.addEventListener("auxclick", (e) => {
      if (e.button === 1) {
        e.preventDefault();
        closeTab(id);
      }
    });

    const pane = createTabPane(
      {
        ...deps,
        fetchDbFiles: fetchDbFilesCached,
        ensureDbUiState,
        getColumnWidths,
        setColumnWidths,
        getExpandedTables,
        setExpandedTable,
        getSnapshotSelectedTables,
        setSnapshotSelectedTables,
        getDbUiPref,
        setDbUiPref,
        onDbUiPrefChange,
        loadSqlHistory,
        refreshDatastores,
        sessionLog,
      },
      {
        tabId: id,
        isActive: () => activeTabId === id,
        canSyncRoute: () => !isRestoring(),
        onStateChange: () => {
          refreshChipLabel(id);
          if (activeTabId === id && !isRestoring()) syncActiveRoute();
          scheduleSave();
        },
      },
      {
        // タブ独立の永続化対象 state を全部渡す。pane 内で直接永続化せず、
        // tabs.json から復元した値をここから取る。
        dbId: initial?.dbId ?? null,
        schema: initial?.schema ?? null,
        table: initial?.table ?? null,
        view: (initial?.view as TabName | undefined) ?? undefined,
        sqlDraft: initial?.sqlDraft,
        historyOpen: initial?.historyOpen,
        historyHeight: initial?.historyHeight,
        activeHistoryTab: initial?.activeHistoryTab,
        sidebarWidth: initial?.sidebarWidth,
        relatedPanelHeight: initial?.relatedPanelHeight,
        detailPanelHeight: initial?.detailPanelHeight,
        redis: initial?.redis,
        es: initial?.es,
        s3: initial?.s3,
        dynamodb: initial?.dynamodb,
      },
    );
    pane.el.hidden = true;

    tabsList.appendChild(chip);
    tabHost.appendChild(pane.el);
    tabsById.set(id, { pane, chip, label: labelEl, closeBtn });

    if (options.activate !== false) setActive(id);
    if (!options.deferInitialEnter) {
      void startInitialEnter(id, initial, options);
    }

    return id;
  }

  function startInitialEnter(
    id: string,
    initial?: Partial<TabState>,
    options: DatabaseEnterOptions = {},
  ): Promise<void> {
    const entry = tabsById.get(id);
    if (!entry) return Promise.resolve();
    const pane = entry.pane;
    const ready = (async () => {
      const suppressRouteSync =
        options.annotationTarget || options.suppressRouteSync;
      const finishRestoring = suppressRouteSync ? beginRestoring() : null;
      try {
        await pane.enter(
          initial?.dbId || undefined,
          initial?.schema || undefined,
          initial?.table || undefined,
          initial?.view || undefined,
          options,
        );
        refreshChipLabel(id);
      } finally {
        finishRestoring?.();
        paneReadyById.delete(id);
      }
    })();
    paneReadyById.set(id, ready);
    return ready;
  }

  function ensureInitialEnter(id: string): Promise<void> | null {
    const ready = paneReadyById.get(id);
    if (ready) return ready;
    if (!lazyInitialById.has(id)) return null;
    const initial = lazyInitialById.get(id);
    lazyInitialById.delete(id);
    return startInitialEnter(id, initial, {
      autoSelectFirst: false,
      suppressRouteSync: true,
    });
  }

  function closeTab(id: string): void {
    const entry = tabsById.get(id);
    if (!entry) return;
    const closedDbId = entry.pane.getState().dbId;
    entry.pane.dispose();
    entry.pane.el.remove();
    entry.chip.remove();
    tabsById.delete(id);
    paneReadyById.delete(id);
    lazyInitialById.delete(id);
    closeDbIfUnused(closedDbId);
    if (activeTabId !== id) {
      scheduleSave();
      return;
    }
    if (tabsById.size === 0) {
      // 最後のタブを閉じようとした → 空タブにリセットして残す。
      openTab(
        { dbId: null, table: null, view: "data" },
        { autoSelectFirst: false },
      );
      return;
    }
    // 残りの先頭を active 化。
    const firstId = tabsById.keys().next().value;
    if (firstId) setActive(firstId);
  }

  newTabBtn.addEventListener("click", () => {
    openTab(
      { dbId: null, table: null, view: "data" },
      { autoSelectFirst: false },
    );
  });

  function routeMatchesState(
    state: TabState,
    db?: string,
    schema?: string | null,
    table?: string,
    view?: TabName,
  ): boolean {
    if (!db && (schema || table || view) && !state.dbId) return false;
    if (db !== undefined && state.dbId !== db) return false;
    if (schema !== undefined) {
      const routeSchema = schema || "public";
      const stateSchema = state.schema || "public";
      if (stateSchema !== routeSchema) return false;
    }
    if (table !== undefined && state.table !== table) return false;
    if (view !== undefined && state.view !== view) return false;
    return true;
  }

  async function applyRouteToTab(
    db?: string,
    schema?: string | null,
    table?: string,
    view?: TabName,
    options: DatabaseEnterOptions = {},
  ): Promise<void> {
    async function enterPane(
      pane: TabPaneInternal,
      targetDb?: string,
      targetSchema?: string | null,
      targetTable?: string,
      targetView?: TabName,
      enterOptions?: DatabaseEnterOptions,
    ): Promise<void> {
      const suppressRouteSync =
        enterOptions?.annotationTarget || enterOptions?.suppressRouteSync;
      if (!suppressRouteSync) {
        await pane.enter(
          targetDb,
          targetSchema,
          targetTable,
          targetView,
          enterOptions,
        );
        return;
      }
      const finishRestoring = beginRestoring();
      try {
        await pane.enter(
          targetDb,
          targetSchema,
          targetTable,
          targetView,
          enterOptions,
        );
      } finally {
        finishRestoring();
      }
    }
    for (const [id, entry] of tabsById) {
      if (routeMatchesState(entry.pane.getState(), db, schema, table, view)) {
        const finishRestoring = beginRestoring();
        try {
          setActive(id);
          const ready = ensureInitialEnter(id);
          if (ready) await ready;
        } finally {
          finishRestoring();
        }
        if (!mounted) return;
        if (options.annotationTarget) {
          await enterPane(entry.pane, db, schema, table, view, options);
          if (!mounted) return;
        }
        refreshChipLabel(id);
        return;
      }
    }
    if (options.reuseActiveTab && activeTabId) {
      const targetId = activeTabId;
      const active = tabsById.get(activeTabId);
      if (active) {
        await enterPane(active.pane, db, schema, table, view, options);
        if (!mounted) return;
        refreshChipLabel(targetId);
        return;
      }
    }
    const id = openTab(
      {
        dbId: db ?? null,
        schema: schema ?? null,
        table: table ?? null,
        view: view ?? "data",
      },
      {
        autoSelectFirst: db === undefined,
        ...options,
      },
    );
    const ready = paneReadyById.get(id);
    if (ready) await ready;
    refreshChipLabel(id);
  }

  function parseSseDbId(data?: string): string | null {
    if (!data) return null;
    try {
      const parsed = JSON.parse(data) as { dbId?: unknown };
      return typeof parsed.dbId === "string" ? parsed.dbId : null;
    } catch {
      return null;
    }
  }

  function parseSseSchema(data?: string): string | null {
    if (!data) return null;
    try {
      const parsed = JSON.parse(data) as { schema?: unknown };
      return typeof parsed.schema === "string" ? parsed.schema : null;
    } catch {
      return null;
    }
  }

  async function doEnter(
    seq: number,
    db?: string,
    schema?: string,
    table?: string,
    view?: TabName,
    options: DatabaseEnterOptions = {},
  ): Promise<void> {
    if (seq !== lifecycleSeq) return;
    const firstMount = !mounted;
    if (firstMount) {
      const content = document.getElementById("content");
      if (!content) return;
      const diff = document.getElementById("diff");
      if (diff) diff.hidden = true;
      const empty = document.getElementById("empty");
      if (empty) empty.classList.add("hidden");
      root.hidden = false;
      content.appendChild(root);
      document.body.classList.add("gdp-database-page");
      mounted = true;
      if (!unloadListenerInstalled) {
        window.addEventListener("beforeunload", handleBeforeUnload);
        unloadListenerInstalled = true;
      }
      deps.setPageMode();
      deps.syncHeaderMenu();

      // suspend 復帰時はメモリ上のタブをそのまま使い、永続化タブを重ねない。
      const restored = tabsById.size === 0 ? await fetchTabs() : null;
      if (!mounted || seq !== lifecycleSeq) return;
      if (restored && restored.tabs.length > 0) {
        const hasRouteTarget = Boolean(db || schema || table || view);
        const finishRestoring = beginRestoring();
        try {
          const restoredTabs = dedupeTabs(restored.tabs);
          for (const t of restoredTabs) {
            if (!mounted || seq !== lifecycleSeq) return;
            const id = openTab(t, {
              autoSelectFirst: false,
              deferInitialEnter: true,
              activate: false,
            });
            lazyInitialById.set(id, t);
          }
          const targetId =
            restored.activeTabId && tabsById.has(restored.activeTabId)
              ? restored.activeTabId
              : tabsById.keys().next().value;
          if (targetId) setActive(targetId);
          if (targetId && !hasRouteTarget) {
            const ready = ensureInitialEnter(targetId);
            if (ready) await ready;
          }
          if (!mounted || seq !== lifecycleSeq) return;
        } finally {
          finishRestoring();
        }
        // URL の引数があれば、まず同じ状態の既存タブを active 化する。
        // なければ active タブに上書き反映する。
        if (db || schema || table || view) {
          await applyRouteToTab(db, schema ?? null, table, view, {
            ...options,
            reuseActiveTab: options.reuseActiveTab ?? true,
          });
        } else {
          syncActiveRoute();
        }
        // 初期復元の連鎖 setState を 1 回の PUT にまとめる。
        scheduleSave();
        return;
      }
    } else {
      const diff = document.getElementById("diff");
      if (diff) diff.hidden = true;
      const empty = document.getElementById("empty");
      if (empty) empty.classList.add("hidden");
      root.hidden = false;
      document.body.classList.add("gdp-database-page");
      deps.setPageMode();
      deps.syncHeaderMenu();
    }

    if (tabsById.size === 0) {
      // 初回 enter (永続化なし): URL の引数を初期 state にして 1 タブ作る。
      const id = openTab(
        {
          dbId: db || null,
          schema: schema || null,
          table: table || null,
          view: view || "data",
        },
        {
          autoSelectFirst: !db,
          ...options,
        },
      );
      const ready = paneReadyById.get(id);
      if (ready) await ready;
      if (!mounted || seq !== lifecycleSeq) return;
      return;
    }
    if (!activeTabId) return;
    const active = tabsById.get(activeTabId);
    if (!active) return;
    if (db || schema || table || view) {
      await applyRouteToTab(db, schema ?? null, table, view, {
        ...options,
        reuseActiveTab: options.reuseActiveTab ?? true,
      });
    } else {
      syncActiveRoute();
    }
  }

  async function enter(
    db?: string,
    schema?: string,
    table?: string,
    view?: TabName,
    options: DatabaseEnterOptions = {},
  ): Promise<void> {
    const seq = lifecycleSeq;
    enterQueue = enterQueue
      .catch(() => undefined)
      .then(() => doEnter(seq, db, schema, table, view, options));
    await enterQueue;
  }

  async function refreshDatastores(): Promise<void> {
    const seq = lifecycleSeq;
    enterQueue = enterQueue
      .catch(() => undefined)
      .then(() => doRefreshDatastores(seq));
    await enterQueue;
  }

  async function doRefreshDatastores(seq: number): Promise<void> {
    if (seq !== lifecycleSeq) return;
    dbFilesCache = null;
    if (!mounted || !activeTabId) return;
    const id = activeTabId;
    const entry = tabsById.get(id);
    if (!entry) return;
    const pendingInitialEnter = ensureInitialEnter(id);
    if (pendingInitialEnter) await pendingInitialEnter;
    if (!mounted || activeTabId !== id) return;
    const state = entry.pane.getState();
    await entry.pane.enter(
      state.dbId ?? undefined,
      state.schema ?? undefined,
      state.table ?? undefined,
      state.view,
      { autoSelectFirst: state.dbId !== null, forceReload: true },
    );
    if (!mounted || activeTabId !== id) return;
    refreshChipLabel(id);
    syncActiveRoute();
    scheduleSave();
  }

  function leave(): void {
    if (!mounted) return;
    lifecycleSeq++;
    flushPendingSave();
    for (const [, entry] of tabsById) {
      entry.pane.dispose();
    }
    tabsById.clear();
    dbFilesCache = null;
    tabsList.innerHTML = "";
    tabHost.innerHTML = "";
    activeTabId = null;
    root.remove();
    document.body.classList.remove("gdp-database-page");
    if (unloadListenerInstalled) {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      unloadListenerInstalled = false;
    }
    const diff = document.getElementById("diff");
    if (diff) diff.hidden = false;
    mounted = false;
  }

  function suspend(): void {
    lifecycleSeq++;
    if (!mounted) {
      root.remove();
      root.hidden = false;
      document.body.classList.remove("gdp-database-page");
      const diff = document.getElementById("diff");
      if (diff) diff.hidden = false;
      return;
    }
    flushPendingSave();
    root.remove();
    root.hidden = false;
    document.body.classList.remove("gdp-database-page");
    const diff = document.getElementById("diff");
    if (diff) diff.hidden = false;
    mounted = false;
  }

  function handleSse(event?: string, data?: string): void {
    if (!mounted) return;
    const dbId = parseSseDbId(data);
    const schema = parseSseSchema(data);
    for (const [, entry] of tabsById) {
      const state = entry.pane.getState();
      if (dbId && state.dbId !== dbId) continue;
      if (schema && state.schema !== schema) continue;
      entry.pane.handleSse(event, data);
    }
  }

  function captureAnnotationTarget(): DatabaseAnnotationTarget | null {
    if (!activeTabId) return null;
    return tabsById.get(activeTabId)?.pane.getAnnotationTarget() ?? null;
  }

  // 言語切替時に全タブの DOM 文言を再適用する（localizeViewerChrome から呼ぶ）。
  function localize(): void {
    newTabBtn.title = outerText().nav.newTab;
    for (const [, entry] of tabsById) {
      entry.closeBtn.setAttribute(
        "aria-label",
        outerText().nav.closeTab(entry.pane.getLabel()),
      );
      entry.pane.localize();
    }
  }

  return {
    enter,
    captureAnnotationTarget,
    suspend,
    leave,
    handleSse,
    localize,
    refresh: refreshDatastores,
    getDbUiPref,
    setDbUiPref,
    onDbUiPrefChange,
  };
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}
