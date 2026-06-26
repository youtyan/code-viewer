import type {
  DbColumn,
  DbFileInfo,
  DbFilesResponse,
  DbQueryResponse,
  DbRelatedResponse,
  DbSchemaResponse,
  DbSchemasResponse,
  DbTableDataResponse,
  QueryHistoryState,
  TabState,
  TabsResponse,
  TabsState,
} from "../../core/database/types";
import { makeId } from "../../core/id";
import { isImeComposing } from "../../core/keyboard";
import type { AppRoute, DiffRange } from "../../core/routes";
import type { AnnotationTarget, DbUiState } from "../../core/types";
import { createAbortGuard } from "./abort-guard";
import { createElasticsearchExplorer } from "./elasticsearch-explorer";
import { createErDiagram } from "./er-diagram";
import { createGlobalSearchView } from "./global-search-view";
import { setPaneStatus } from "./pane-status";
import { createQueryEditor } from "./query-editor";
import { createQueryHistoryView } from "./query-history-view";
import { createRedisExplorer } from "./redis-explorer";
import { createS3Explorer } from "./s3-explorer";
import { createSchemaView } from "./schema-view";
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
};

type DatabasePaneDeps = DatabaseViewDeps & {
  ensureDbUiState(): Promise<void>;
  getColumnWidths(dbId: string, table: string): Record<string, number>;
  setColumnWidths(
    dbId: string,
    table: string,
    widths: Record<string, number>,
  ): void;
  loadSqlHistory(dbId: string | null, schema: string | null): Promise<string[]>;
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
};

type TabName = "data" | "query" | "schema" | "er" | "search" | "snapshot";
type DatabaseAnnotationTarget = Extract<AnnotationTarget, { kind: "database" }>;
type DatabaseEnterOptions = {
  autoSelectFirst?: boolean;
  annotationTarget?: DatabaseAnnotationTarget;
  reuseActiveTab?: boolean;
  suppressRouteSync?: boolean;
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

const HISTORY_SSE_REFRESH_DELAY_MS = 250;
export const TABLE_SELECT_FETCH_DELAY_MS = 50;

type DbVisibility = {
  toolsHidden: boolean;
  historyToggleHidden: boolean;
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
    historyToggleHidden: !sqlMode,
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

  let currentDbInfo: DbFileInfo | null = null;
  let schemaCache: DbSchemaResponse | null = null;
  let lastFiles: DbFileInfo[] = [];
  let currentSchema: string | null = initial.schema ?? null;
  let currentTable: string | null = initial.table ?? null;
  let loadGeneration = 0;
  const tableSelectGuard = createAbortGuard();
  let historyRefreshPending: ReturnType<typeof setTimeout> | null = null;

  const dbSelect = document.createElement("select");
  dbSelect.className = "db-file-select";
  dbSelect.title = "Select datastore";

  const schemaSelect = document.createElement("select");
  schemaSelect.className = "db-file-select db-schema-select";
  schemaSelect.title = "Select PostgreSQL schema";
  schemaSelect.hidden = true;

  const dbToolbar = document.createElement("div");
  dbToolbar.className = "db-toolbar";
  dbToolbar.append(dbSelect, schemaSelect);

  const tabBar = document.createElement("div");
  tabBar.className = "db-tab-bar";
  const tabData = createInnerTab("Data", true);
  const tabSchema = createInnerTab("Schema", false);
  tabBar.append(tabData, tabSchema);

  let currentTab: TabName = initial.view ?? "data";

  const tableList = createTableList({
    onSelectTable: (table) => selectTable(table),
    onViewCreateTable: (table) => showDdl(table),
    onViewDefinition: (table) => showSchema(table),
    getColumns: (table) => fetchColumns(table),
  });

  const sidebar = document.createElement("div");
  sidebar.className = "db-sidebar";
  // sidebar 幅はタブごとに独立 (タブ A で狭めてもタブ B には反映しない)。
  // initial 値があれば復元し、なければ CSS の default を使う。
  if (initial.sidebarWidth) sidebar.style.width = initial.sidebarWidth;

  // ----- サイドバー上端のアイコンツールバー (案 B 改: TablePlus / Beekeeper 風) -----
  // 縦並びの大きな枠線ボタンは「DB ビューア UI として普通じゃない」と
  // ユーザーから指摘を受けた。アイコンツールバーに置き換えて、サイドバー
  // 最上端に集約する。kind === redis / elasticsearch ではこのツールバーごと
  // 隠す (applyVisibility が toolsSection.hidden を制御)。
  const toolsSection = document.createElement("div");
  toolsSection.className = "db-icon-toolbar";
  toolsSection.setAttribute("role", "toolbar");
  toolsSection.setAttribute("aria-label", "Datastore tools");

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
    pathD: ICON_PATH_SEARCH,
    onClick: () => setActiveTab("search"),
  });

  const snapshotBtn = makeIconButton({
    label: "Snapshot",
    title: "Snapshot & Diff",
    pathD: ICON_PATH_SNAPSHOT,
    onClick: () => {
      setActiveTab("snapshot");
      snapshotView.refresh();
    },
  });

  toolsSection.append(queryBtn, erBtn, searchBtn, snapshotBtn);

  // 順序: アイコンツールバー → DB select → table list の順。
  sidebar.append(toolsSection, dbToolbar, tableList.el);

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
    getForeignKeys: () => schemaCache?.foreignKeys ?? [],
    fetchRelatedRows: (table, column, value, signal) =>
      fetchRelatedRows(table, column, value, signal),
    onNavigateToReference: (table, column, value) =>
      navigateToReference(table, column, value),
  });

  const queryEditor = createQueryEditor({
    executeQuery: (sql) => executeQuery(sql),
    loadHistory: () =>
      outerDeps.loadSqlHistory(currentDbInfo?.id || null, currentSchema),
    onSqlChange: () => cb.onStateChange(),
  });
  // 復元すべき SQL draft があれば初期化時に流し込む (これも onSqlChange を
  // 呼ぶが、外側の scheduleSave は debounce で no-op になる)。
  if (initial.sqlDraft) queryEditor.setSql(initial.sqlDraft, { silent: true });

  const schemaView = createSchemaView();
  const erDiagram = createErDiagram();
  const globalSearchView = createGlobalSearchView({
    getDbId: () => currentDbInfo?.id || null,
    getSchema: () => currentSchema,
  });
  const snapshotView = createSnapshotView({
    getDbId: () => currentDbInfo?.id || null,
    getSchema: () => currentSchema,
    getTables: () => schemaCache?.tables || [],
  });
  const historyView = createQueryHistoryView({
    getDbId: () => currentDbInfo?.id || null,
    getSchema: () => currentSchema,
    copySqlToQuery: (sql) => {
      queryEditor.setSql(sql);
      setActiveTab("query");
    },
  });

  const redisExplorer = createRedisExplorer({
    onSelectionChange: () => cb.onStateChange(),
  });
  redisExplorer.el.hidden = true;

  const esExplorer = createElasticsearchExplorer({
    onSelectionChange: () => cb.onStateChange(),
  });
  esExplorer.el.hidden = true;

  const s3Explorer = createS3Explorer({
    onSelectionChange: () => cb.onStateChange(),
  });
  s3Explorer.el.hidden = true;

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
  historyPane.appendChild(historyView.el);

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

  const historyToggle = document.createElement("button");
  historyToggle.className = "db-history-toggle";
  historyToggle.type = "button";
  historyToggle.textContent = "Query History";
  historyToggle.title = "Toggle query history panel";
  sidebar.appendChild(historyToggle);

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
    toolsSection.hidden = visibility.toolsHidden;
    historyToggle.hidden = visibility.historyToggleHidden;
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
    if (!sqlMode) {
      queryBtn.classList.remove("active");
      erBtn.classList.remove("active");
      searchBtn.classList.remove("active");
      snapshotBtn.classList.remove("active");
    }
    historyToggle.classList.toggle("active", userPrefersHistoryOpen);
    if (!visibility.historyPaneHidden && cb.isActive()) historyView.refresh();
  }
  applyVisibility();

  historyToggle.addEventListener("click", () => {
    userPrefersHistoryOpen = !userPrefersHistoryOpen;
    applyVisibility();
    // タブごとに persist (tabs.json 経由)。
    cb.onStateChange();
  });

  const container = document.createElement("div");
  container.className = "db-container";
  container.append(upperArea, historyResizer, historyPane);

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
    const res = await deps.trackLoad(fetch(`/_db/schemas?${params}`));
    if (!res.ok) {
      throw new Error(
        await responseErrorMessage(res, "failed to fetch schemas"),
      );
    }
    return (await res.json()) as DbSchemasResponse;
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
    const res = await deps.trackLoad(fetch(`/_db/schema?${params}`));
    if (!res.ok) {
      throw new Error(
        await responseErrorMessage(res, "failed to fetch schema"),
      );
    }
    return (await res.json()) as DbSchemaResponse;
  }

  async function fetchTablePage(
    table: string,
    offset: number,
    limit: number,
    sort: GridSort | null,
    filters: GridFilter[],
    signal?: AbortSignal,
  ): Promise<DbTableDataResponse> {
    if (!currentDbInfo) throw new Error("no database selected");
    const params = new URLSearchParams({
      db: currentDbInfo.id,
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
    const res = await fetch(
      `/_db/table?${params}`,
      signal ? { signal } : undefined,
    );
    if (!res.ok) {
      throw new Error(await responseErrorMessage(res, "failed to fetch table"));
    }
    return (await res.json()) as DbTableDataResponse;
  }

  async function fetchRelatedRows(
    table: string,
    column: string,
    value: string,
    signal?: AbortSignal,
  ): Promise<DbRelatedResponse> {
    if (!currentDbInfo) throw new Error("no database selected");
    const params = new URLSearchParams({
      db: currentDbInfo.id,
      table,
      column,
      value,
    });
    withCurrentSchema(params);
    const res = await fetch(
      `/_db/related?${params}`,
      signal ? { signal } : undefined,
    );
    if (!res.ok) {
      throw new Error(
        await responseErrorMessage(res, "failed to fetch related rows"),
      );
    }
    return (await res.json()) as DbRelatedResponse;
  }

  /** FK 参照先テーブルを開き、該当値で絞り込んで表示する。 */
  function navigateToReference(
    table: string,
    column: string,
    value: string,
  ): void {
    if (!currentDbInfo) return;
    // 参照先テーブルが現在のスキーマに存在しない場合は何もしない。
    if (schemaCache && !schemaCache.tables.some((t) => t.name === table)) {
      return;
    }
    void (async () => {
      await selectTable(table);
      if (currentTable !== table) return;
      await grid.applyState({ filters: [{ column, value }] });
    })();
  }

  async function executeQuery(sql: string): Promise<DbQueryResponse> {
    if (!currentDbInfo) throw new Error("no database selected");
    const res = await fetch("/_db/query", {
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
    });
    if (!res.ok) {
      throw new Error(
        await responseErrorMessage(res, "failed to execute query"),
      );
    }
    const result = (await res.json()) as DbQueryResponse;
    return result;
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
      currentDbInfo?.kind === "s3"
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
        await redisExplorer.load(dbId, explorerInitial?.redis);
      } else if (currentDbInfo.kind === "elasticsearch") {
        redisExplorer.clear();
        s3Explorer.clear();
        await esExplorer.load(dbId, explorerInitial?.es);
      } else {
        redisExplorer.clear();
        esExplorer.clear();
        await s3Explorer.load(dbId, explorerInitial?.s3);
      }
      if (generation !== loadGeneration || currentDbInfo?.id !== dbId) return;
      cb.onStateChange();
      return;
    }
    redisExplorer.clear();
    esExplorer.clear();
    s3Explorer.clear();
    applyVisibility();
    tableList.render([]);
    setTableListStatus("Loading schema...");
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
      schemaView.render(table, columns, schemaCache?.indexes || []);
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
    schemaView.render(table, columns, schemaCache?.indexes || []);
  }

  async function fetchColumns(table: string): Promise<DbColumn[]> {
    if (schemaCache?.columnsMap?.[table]) {
      return schemaCache.columnsMap[table];
    }
    if (!currentDbInfo) return [];
    const res = await fetch(
      `/_db/columns?${withCurrentSchema(new URLSearchParams({ db: currentDbInfo.id, table }))}`,
    );
    if (!res.ok) return [];
    const data = (await res.json()) as { columns: DbColumn[] };
    return data.columns;
  }

  async function showSchema(table: string) {
    setActiveTab("schema");
    if (!currentDbInfo) return;
    const columns = await fetchColumns(table);
    schemaView.render(table, columns, schemaCache?.indexes || []);
  }

  async function showDdl(table: string) {
    if (!currentDbInfo) return;
    setActiveTab("schema");
    try {
      const res = await fetch(
        `/_db/ddl?${withCurrentSchema(new URLSearchParams({ db: currentDbInfo.id, table }))}`,
      );
      if (!res.ok) return;
      const data = (await res.json()) as {
        sql: string;
        triggers: { name: string; sql: string }[];
      };
      const columns = await fetchColumns(table);
      schemaView.render(table, columns, schemaCache?.indexes || [], {
        foreignKeys: schemaCache?.foreignKeys,
        triggers: data.triggers,
        ddl: data.sql,
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
    const generation = ++loadGeneration;
    const file = lastFiles.find((f) => f.id === dbId);
    const option = dbSelect.selectedOptions[0];
    currentDbInfo = {
      id: dbId,
      path: file?.path || dbId,
      name: option?.textContent || dbId,
      sizeBytes: file?.sizeBytes || 0,
      kind: file?.kind || "sqlite",
    };
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
    if (filesResponse.truncated) {
      showDockerNotice(
        "Docker discovery reached the service limit; some compose services may be hidden.",
      );
    } else {
      clearDockerNotice();
    }
    dbSelect.innerHTML = "";
    if (files.length === 0) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "No datastores found";
      dbSelect.appendChild(opt);
      dbSelect.disabled = true;
      cb.onStateChange();
      return;
    }
    dbSelect.disabled = false;
    const optionsFragment = document.createDocumentFragment();
    for (const f of files) {
      const opt = document.createElement("option");
      opt.value = f.id;
      const isDocker = f.id.startsWith("docker:");
      const label = isDocker
        ? `${f.name} (Docker)`
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
      setActiveTab("data", false);
      cb.onStateChange();
      return;
    }
    const target = db || files[0].id;
    dbSelect.value = target;
    currentDbInfo = files.find((f) => f.id === target) || null;

    // 復元時は initial の redis/es selection を 1 度だけ流し込む。
    const explorerInitial = {
      redis: pendingRedisInitial,
      es: pendingEsInitial,
      s3: pendingS3Initial,
    };
    pendingRedisInitial = undefined;
    pendingEsInitial = undefined;
    pendingS3Initial = undefined;
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
      currentDbInfo?.kind === "s3"
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
    if (sidebar.style.width) state.sidebarWidth = sidebar.style.width;

    if (!loaded) {
      if (initial.redis) state.redis = initial.redis;
      if (initial.es) state.es = initial.es;
      if (initial.s3) state.s3 = initial.s3;
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
        sel.sort !== "updated-desc"
      ) {
        state.s3 = sel;
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
    if (!currentDbInfo) return labelFromDbId(initial.dbId);
    const suffix = currentSchema ? ` / ${currentSchema}` : "";
    // 既存 sidebar select の表示と揃える: docker は service 名、sqlite は path basename。
    if (currentDbInfo.id.startsWith("docker:")) {
      // currentDbInfo.name は recursive discovery の長い label なので、service 部分だけ取り出す。
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
    currentDbInfo = null;
    currentSchema = null;
    currentTable = null;
    schemaCache = null;
  }

  return {
    el: container,
    enter,
    handleSse,
    getState,
    getAnnotationTarget,
    getLabel,
    dispose,
  };
}

// ----- アイコンツールバー (案 B 改: TablePlus / Beekeeper 風) -----
// octicon / bootstrap-icons ベースの 16x16 path。currentColor で描画して
// hover / active 時の色変更を CSS から制御できるようにする。

const ICON_PATH_QUERY =
  "M5.72 4.22a.75.75 0 0 1 0 1.06L2.81 8l2.91 2.72a.75.75 0 1 1-1.06 1.06L1.22 8.53a.75.75 0 0 1 0-1.06l3.44-3.25a.75.75 0 0 1 1.06 0Zm4.56 0a.75.75 0 0 1 1.06 0l3.44 3.25a.75.75 0 0 1 0 1.06l-3.44 3.25a.75.75 0 1 1-1.06-1.06L13.19 8l-2.91-2.72a.75.75 0 0 1 0-1.06Z";

const ICON_PATH_ER =
  "M1.5 1.75A.75.75 0 0 1 2.25 1h4.5a.75.75 0 0 1 .75.75v3.5h2v-1.5A.75.75 0 0 1 10.25 3h3.5a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-.75.75h-3.5a.75.75 0 0 1-.75-.75V6.5h-2v3h2v-.75A.75.75 0 0 1 10.25 8h3.5a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-.75.75h-3.5a.75.75 0 0 1-.75-.75v-1.5h-2v3.5a.75.75 0 0 1-.75.75h-4.5a.75.75 0 0 1-.75-.75v-3.5A.75.75 0 0 1 2.25 9h4.5a.75.75 0 0 1 .75.75v.75h-.5v-1H3v3h3V11h.5v-.75a.75.75 0 0 0-.75-.75H3V6.5h2.5V2.5H3Z";

const ICON_PATH_SEARCH =
  "M10.68 11.74a6 6 0 0 1-7.917-8.984 6 6 0 0 1 8.997 7.905l3.05 3.05a.75.75 0 1 1-1.06 1.06l-3.07-3.03ZM11.5 7a4.499 4.499 0 1 1-8.997 0A4.499 4.499 0 0 1 11.5 7Z";

const ICON_PATH_SNAPSHOT =
  "M3.5 1.75A1.75 1.75 0 0 1 5.25 0h5.5A1.75 1.75 0 0 1 12.5 1.75v.5h1.75A1.75 1.75 0 0 1 16 4v9.25A1.75 1.75 0 0 1 14.25 15H1.75A1.75 1.75 0 0 1 0 13.25V4a1.75 1.75 0 0 1 1.75-1.75H3.5v-.5Zm1.5.5v.5h6v-.5a.25.25 0 0 0-.25-.25h-5.5a.25.25 0 0 0-.25.25Zm-3.25 2a.25.25 0 0 0-.25.25v9.25c0 .138.112.25.25.25h12.5a.25.25 0 0 0 .25-.25V4a.25.25 0 0 0-.25-.25H1.75ZM8 6a2.75 2.75 0 1 0 0 5.5 2.75 2.75 0 0 0 0-5.5Z";

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

// ----- 外側: 複数 TabPane を束ねる -----

export function createDatabaseView(deps: DatabaseViewDeps): DatabaseView {
  let mounted = false;
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
        dbUiState = (await res.json()) as DbUiState;
      })
      .catch(() => {});
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
      version: 1,
      columnWidths: { ...dbUiState.columnWidths, [dbId]: nextDb },
    };
    void fetch("/_db/ui", {
      method: "PATCH",
      headers: actionHeaders(),
      body: JSON.stringify({ columnWidths: { [dbId]: { [table]: widths } } }),
    })
      .then(async (res) => {
        if (res.ok) dbUiState = (await res.json()) as DbUiState;
      })
      .catch(() => {});
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
      .catch(() => {})
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
  newTabBtn.title = "新しいタブ";
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
      void ensureInitialEnter(id)?.catch(() => {});
    }
  }

  function syncActiveRoute(): void {
    if (!activeTabId) return;
    const entry = tabsById.get(activeTabId);
    if (!entry) return;
    const s = entry.pane.getState();
    deps.setRoute(
      {
        screen: "database",
        db: s.dbId ?? undefined,
        schema: s.schema ?? undefined,
        table: s.table ?? undefined,
        tab: s.view === "data" ? undefined : s.view,
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
    entry.closeBtn.setAttribute("aria-label", `${label} を閉じる`);
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
    void fetch("/_db/close", { method: "POST", headers, body }).catch(() => {});
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
    closeBtn.title = "閉じる";
    closeBtn.tabIndex = -1;
    closeBtn.textContent = "×";
    closeBtn.setAttribute("aria-label", `${initialLabel} を閉じる`);
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
        loadSqlHistory,
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
        sidebarWidth: initial?.sidebarWidth,
        redis: initial?.redis,
        es: initial?.es,
        s3: initial?.s3,
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
      .catch(() => {})
      .then(() => doEnter(seq, db, schema, table, view, options));
    await enterQueue;
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

  return { enter, captureAnnotationTarget, suspend, leave, handleSse };
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}
