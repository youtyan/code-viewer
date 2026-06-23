import type {
  DbColumn,
  DbFileInfo,
  DbFilesResponse,
  DbKind,
  DbQueryResponse,
  DbSchemaResponse,
  DbTableDataResponse,
  TabState,
  TabsResponse,
  TabsState,
} from "../../core/database/types";
import type { AppRoute, DiffRange } from "../../core/routes";
import type { AnnotationTarget } from "../../core/types";
import { createElasticsearchExplorer } from "./elasticsearch-explorer";
import { createErDiagram } from "./er-diagram";
import { createGlobalSearchView } from "./global-search-view";
import { createQueryEditor } from "./query-editor";
import { createQueryHistoryView } from "./query-history-view";
import { createRedisExplorer } from "./redis-explorer";
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
};

export type DatabaseView = {
  enter: (
    db?: string,
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
};

function looksReadOnlySql(sql: string): boolean {
  const normalized = sql.replace(/^\s*(?:--.*\n|\/\*[\s\S]*?\*\/\s*)*/g, "");
  return /^(select|with|pragma|explain)\b/i.test(normalized);
}

// ----- 内部: 1 タブ分の view (元 createDatabaseView の中身) -----

type TabPaneCallbacks = {
  tabId: string;
  isActive: () => boolean;
  // state が変わったら chip label の更新や URL 反映、persist のために呼ばれる。
  // active タブのときだけ URL を更新するため、isActive で抑制する。
  onStateChange: () => void;
};

type TabPaneInternal = {
  el: HTMLElement;
  enter: (
    db?: string | null,
    table?: string | null,
    view?: TabName,
    options?: DatabaseEnterOptions,
  ) => Promise<void>;
  handleSse: (event?: string, data?: string) => void;
  getState: () => TabState;
  getDbKind: () => DbKind | null;
  getAnnotationTarget: () => DatabaseAnnotationTarget | null;
  getLabel: () => string;
  dispose: () => void;
};

// TabPane のすべての永続化対象 state を 1 箇所で受け取る。pane の構築時に
// localStorage から取るのではなく、外側 (tabs.json から復元した TabState)
// から渡してもらう形にして、タブごとの独立性を担保する。
type TabPaneInitial = {
  dbId?: string | null;
  table?: string | null;
  view?: TabName;
  sqlDraft?: string;
  historyOpen?: boolean;
  historyHeight?: string;
  sidebarWidth?: string;
  redis?: { dbIndex?: number; key?: string; keyFilter?: string };
  es?: { index?: string; query?: string };
};

function isSqlKind(kind: DbFileInfo["kind"] | undefined): boolean {
  return kind === "sqlite" || kind === "postgresql" || kind === "mysql";
}

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

function normalizeViewForDb(
  view: TabName | undefined,
  db: DbFileInfo | null,
): TabName {
  if (!db || !isSqlKind(db.kind)) return "data";
  return view && isSqlView(view) ? view : "data";
}

function createTabPane(
  outerDeps: DatabaseViewDeps,
  cb: TabPaneCallbacks,
  initial: TabPaneInitial = {},
): TabPaneInternal {
  // 内部で deps.setRoute を呼ぶたびに active かどうかで実体呼び出しを抑制、
  // 同時に onStateChange を発火させて外側 (タブバーの label 更新 / persist) を
  // 起こす。
  const deps: DatabaseViewDeps = {
    ...outerDeps,
    setRoute: (route, replace) => {
      if (cb.isActive()) outerDeps.setRoute(route, replace);
      cb.onStateChange();
    },
  };

  let currentDb: DbFileInfo | null = null;
  let schemaCache: DbSchemaResponse | null = null;
  let lastFiles: DbFileInfo[] = [];
  let currentTable: string | null = initial.table ?? null;
  let loadGeneration = 0;

  const dbSelect = document.createElement("select");
  dbSelect.className = "db-file-select";
  dbSelect.title = "Select database file";

  const dbToolbar = document.createElement("div");
  dbToolbar.className = "db-toolbar";
  dbToolbar.appendChild(dbSelect);

  const tabBar = document.createElement("div");
  tabBar.className = "db-tab-bar";
  const tabData = createInnerTab("Data", true);
  const tabSchema = createInnerTab("Schema", false);
  tabBar.append(tabData, tabSchema);

  let currentTab: TabName = "data";

  const tableList = createTableList({
    onSelectTable: (table) => selectTable(table),
    onSelectSchema: (table) => showSchema(table),
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
  // 隠す (applyKindVisibility が toolsSection.hidden を制御)。
  const toolsSection = document.createElement("div");
  toolsSection.className = "db-icon-toolbar";
  toolsSection.setAttribute("role", "toolbar");
  toolsSection.setAttribute("aria-label", "Database tools");

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
      // タブごとに persist (localStorage ではなく tabs.json 経由)。
      cb.onStateChange();
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  });

  const grid = createTableGrid({
    fetchPage: (table, offset, limit, sort, filters) =>
      fetchTablePage(table, offset, limit, sort, filters),
    getDbId: () => currentDb?.id || null,
  });

  const queryEditor = createQueryEditor({
    executeQuery: (sql) => executeQuery(sql),
    onSqlChange: () => cb.onStateChange(),
  });
  // 復元すべき SQL draft があれば初期化時に流し込む (これも onSqlChange を
  // 呼ぶが、外側の scheduleSave は debounce で no-op になる)。
  if (initial.sqlDraft) queryEditor.setSql(initial.sqlDraft, { silent: true });

  const schemaView = createSchemaView();
  const erDiagram = createErDiagram();
  const globalSearchView = createGlobalSearchView({
    getDbId: () => currentDb?.id || null,
  });
  const snapshotView = createSnapshotView({
    getDbId: () => currentDb?.id || null,
    getTables: () => schemaCache?.tables || [],
  });
  const historyView = createQueryHistoryView({
    getDbId: () => currentDb?.id || null,
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
      // タブごとに persist (localStorage ではなく tabs.json 経由)。
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
  // 「開いている」状態 (= 旧 localStorage default と同じ)。
  let historyOpen = initial.historyOpen ?? true;
  function applyHistoryVisibility() {
    const sqlMode = isSqlKind(currentDb?.kind);
    historyResizer.hidden = !sqlMode || !historyOpen;
    historyPane.hidden = !sqlMode || !historyOpen;
    historyToggle.classList.toggle("active", historyOpen);
    if (sqlMode && historyOpen) historyView.refresh();
  }
  applyHistoryVisibility();

  historyToggle.addEventListener("click", () => {
    historyOpen = !historyOpen;
    applyHistoryVisibility();
    // タブごとに persist (localStorage ではなく tabs.json 経由)。
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
    applyInnerTabBarVisibility();
    grid.el.hidden = !isSqlKind(currentDb?.kind) || currentTab !== "data";
  }

  function showDockerNotice(message: string) {
    clearDockerNotice();
    const notice = document.createElement("div");
    notice.className = "db-docker-notice";
    notice.textContent = message;
    mainContent.prepend(notice);
  }

  function isTableViewTab(): boolean {
    return currentTab === "data" || currentTab === "schema";
  }

  function applyInnerTabBarVisibility(): void {
    tabBar.hidden = !isSqlKind(currentDb?.kind) || !isTableViewTab();
  }

  function applyKindVisibility() {
    const sqlMode = isSqlKind(currentDb?.kind);
    toolsSection.hidden = !sqlMode;
    historyToggle.hidden = !sqlMode;
    historyResizer.hidden = !sqlMode || !historyOpen;
    historyPane.hidden = !sqlMode || !historyOpen;
    tableList.el.hidden = !sqlMode;
    applyInnerTabBarVisibility();

    if (!sqlMode) {
      queryBtn.classList.remove("active");
      erBtn.classList.remove("active");
      searchBtn.classList.remove("active");
      snapshotBtn.classList.remove("active");
      grid.el.hidden = true;
      queryEditor.el.hidden = true;
      schemaView.el.hidden = true;
      erDiagram.el.hidden = true;
      globalSearchView.el.hidden = true;
      snapshotView.el.hidden = true;
      redisExplorer.el.hidden = currentDb?.kind !== "redis";
      esExplorer.el.hidden = currentDb?.kind !== "elasticsearch";
    }
  }

  function setActiveTab(tab: TabName, updateUrl = true) {
    currentTab = normalizeViewForDb(tab, currentDb);
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
    const sqlMode = isSqlKind(currentDb?.kind);
    // Data / Schema の inner tabBar は「テーブルの中身を表示してるとき」
    // だけ表示する。Query / ER / Search / Snapshot 中は無関係なので隠す。
    applyInnerTabBarVisibility();
    grid.el.hidden = !sqlMode || currentTab !== "data";
    queryEditor.el.hidden = !sqlMode || currentTab !== "query";
    schemaView.el.hidden = !sqlMode || currentTab !== "schema";
    erDiagram.el.hidden = !sqlMode || currentTab !== "er";
    globalSearchView.el.hidden = !sqlMode || currentTab !== "search";
    snapshotView.el.hidden = !sqlMode || currentTab !== "snapshot";
    redisExplorer.el.hidden = currentDb?.kind !== "redis";
    esExplorer.el.hidden = currentDb?.kind !== "elasticsearch";
    applyKindVisibility();
    if (currentTab === "query") queryEditor.focus();
    if (updateUrl && currentDb) {
      deps.setRoute(
        {
          screen: "database",
          db: currentDb?.id,
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
    const res = await deps.trackLoad(fetch("/_db/files"));
    if (!res.ok) return { files: [] };
    const data = (await res.json()) as DbFilesResponse;
    return data;
  }

  async function fetchSchema(dbId: string): Promise<DbSchemaResponse | null> {
    const res = await deps.trackLoad(
      fetch(`/_db/schema?db=${encodeURIComponent(dbId)}&includeColumns=1`),
    );
    if (!res.ok) return null;
    return (await res.json()) as DbSchemaResponse;
  }

  async function fetchTablePage(
    table: string,
    offset: number,
    limit: number,
    sort: GridSort | null,
    filters: GridFilter[],
  ): Promise<DbTableDataResponse> {
    if (!currentDb) throw new Error("no database selected");
    const params = new URLSearchParams({
      db: currentDb.id,
      table,
      offset: String(offset),
      limit: String(limit),
    });
    if (sort) {
      params.set("sort", sort.column);
      params.set("dir", sort.direction);
    }
    if (filters.length > 0) {
      params.set("filters", JSON.stringify(filters));
    }
    const res = await fetch(`/_db/table?${params}`);
    if (!res.ok) throw new Error(await res.text());
    return (await res.json()) as DbTableDataResponse;
  }

  async function executeQuery(sql: string): Promise<DbQueryResponse> {
    if (!currentDb) throw new Error("no database selected");
    const res = await fetch("/_db/query", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Code-Viewer-Action": "1",
      },
      body: JSON.stringify({
        db: currentDb.id,
        sql,
        saveHistory: true,
        source: "browser",
        executedBy: "user",
      }),
    });
    const result = (await res.json()) as DbQueryResponse;
    if (historyOpen) historyView.refresh();
    return result;
  }

  async function selectDb(
    dbId: string,
    explorerInitial?: {
      redis?: { dbIndex?: number; key?: string; keyFilter?: string };
      es?: { index?: string; query?: string };
    },
    generation = loadGeneration,
  ) {
    if (generation !== loadGeneration || currentDb?.id !== dbId) return;
    currentTable = null;
    if (currentDb?.kind === "redis" || currentDb?.kind === "elasticsearch") {
      currentTab = "data";
      tableList.render([]);
      grid.clear();
      schemaView.clear();
      erDiagram.clear();
      schemaCache = null;
      applyKindVisibility();
      if (currentDb.kind === "redis") {
        esExplorer.el.hidden = true;
        esExplorer.clear();
        redisExplorer.el.hidden = false;
        await redisExplorer.load(dbId, explorerInitial?.redis);
      } else {
        redisExplorer.el.hidden = true;
        redisExplorer.clear();
        esExplorer.el.hidden = false;
        await esExplorer.load(dbId, explorerInitial?.es);
      }
      if (generation !== loadGeneration || currentDb?.id !== dbId) return;
      cb.onStateChange();
      return;
    }
    redisExplorer.el.hidden = true;
    redisExplorer.clear();
    esExplorer.el.hidden = true;
    esExplorer.clear();
    applyKindVisibility();
    const schema = await fetchSchema(dbId);
    if (generation !== loadGeneration || currentDb?.id !== dbId) return;
    if (!schema) return;
    schemaCache = schema;
    tableList.render(schema.tables);
    grid.clear();
    schemaView.clear();
    erDiagram.clear();
    setActiveTab("data", false);
    if (schema.tables.length > 0) {
      await selectTable(schema.tables[0].name, generation);
    }
    // currentDb が確定したので Query History pane を自動 refresh する。
    // 構築時の applyHistoryVisibility() 呼び出し時は currentDb=null で
    // refresh が skip されていた (sqlMode = false 判定) のを、ここで補う。
    // ユーザー報告: 「Refresh ボタンを押さないと History が出ない」の修正。
    applyHistoryVisibility();
    cb.onStateChange();
  }

  async function selectTable(table: string, generation = loadGeneration) {
    if (generation !== loadGeneration) return;
    currentTable = table;
    tableList.setActive(table);
    if (!currentDb) return;
    const requestDbId = currentDb.id;
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
        db: currentDb.id,
        table,
        tab: currentTab === "data" ? undefined : currentTab,
        range: deps.currentRange(),
      },
      true,
    );
    try {
      const data = await deps.trackLoad(
        fetchTablePage(table, 0, 200, null, []),
      );
      if (
        generation !== loadGeneration ||
        currentDb?.id !== requestDbId ||
        currentTable !== table
      ) {
        return;
      }
      grid.load(table, data);
    } catch {
      if (
        generation !== loadGeneration ||
        currentDb?.id !== requestDbId ||
        currentTable !== table
      ) {
        return;
      }
      grid.load(table);
    }
    if (currentTab === "schema") {
      const columns = await fetchColumns(table);
      if (
        generation !== loadGeneration ||
        currentDb?.id !== requestDbId ||
        currentTable !== table
      ) {
        return;
      }
      schemaView.render(table, columns, schemaCache?.indexes || []);
    }
  }

  async function fetchColumns(table: string): Promise<DbColumn[]> {
    if (schemaCache?.columnsMap?.[table]) {
      return schemaCache.columnsMap[table];
    }
    if (!currentDb) return [];
    const res = await fetch(
      `/_db/columns?db=${encodeURIComponent(currentDb.id)}&table=${encodeURIComponent(table)}`,
    );
    if (!res.ok) return [];
    const data = (await res.json()) as { columns: DbColumn[] };
    return data.columns;
  }

  async function showSchema(table: string) {
    setActiveTab("schema");
    if (!currentDb) return;
    const columns = await fetchColumns(table);
    schemaView.render(table, columns, schemaCache?.indexes || []);
  }

  async function showDdl(table: string) {
    if (!currentDb) return;
    setActiveTab("schema");
    try {
      const res = await fetch(
        `/_db/ddl?db=${encodeURIComponent(currentDb.id)}&table=${encodeURIComponent(table)}`,
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
    if (!schemaCache || !currentDb) return;
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

  async function handleDbSelectChange(): Promise<void> {
    const dbId = dbSelect.value;
    if (!dbId) return;
    const generation = ++loadGeneration;
    const file = lastFiles.find((f) => f.id === dbId);
    const option = dbSelect.selectedOptions[0];
    currentDb = {
      id: dbId,
      path: file?.path || dbId,
      name: option?.textContent || dbId,
      sizeBytes: file?.sizeBytes || 0,
      kind: file?.kind || "sqlite",
    };
    clearDockerNotice();
    await selectDb(dbId, undefined, generation);
    if (generation !== loadGeneration || currentDb?.id !== dbId) return;
    deps.setRoute(
      {
        screen: "database",
        db: dbId,
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

  async function enter(
    db?: string | null,
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
      opt.textContent = "No database files found";
      dbSelect.appendChild(opt);
      dbSelect.disabled = true;
      cb.onStateChange();
      return;
    }
    dbSelect.disabled = false;
    for (const f of files) {
      const opt = document.createElement("option");
      opt.value = f.id;
      const isDocker = f.id.startsWith("docker:");
      const label = isDocker
        ? `${f.name} (Docker)`
        : `${f.path} (${formatSize(f.sizeBytes)})`;
      opt.textContent = label;
      dbSelect.appendChild(opt);
    }

    if (db && !files.find((f) => f.id === db)) {
      // 復元したい dbId が現在の files に無い場合は、最初のファイルに fall back。
      db = files[0].id;
    }
    const autoSelectFirst = options.autoSelectFirst ?? true;
    if (!db && !autoSelectFirst) {
      dbSelect.value = "";
      currentDb = null;
      currentTable = null;
      schemaCache = null;
      tableList.render([]);
      grid.clear();
      schemaView.clear();
      erDiagram.clear();
      redisExplorer.clear();
      esExplorer.clear();
      setActiveTab("data", false);
      cb.onStateChange();
      return;
    }
    const target = db || files[0].id;
    dbSelect.value = target;
    currentDb = files.find((f) => f.id === target) || null;

    // 復元時は initial の redis/es selection を 1 度だけ流し込む。
    const explorerInitial = {
      redis: pendingRedisInitial,
      es: pendingEsInitial,
    };
    pendingRedisInitial = undefined;
    pendingEsInitial = undefined;
    await selectDb(target, explorerInitial, generation);
    if (generation !== loadGeneration || currentDb?.id !== target) return;
    if (currentDb?.kind === "redis" || currentDb?.kind === "elasticsearch") {
      cb.onStateChange();
      return;
    }
    if (table) {
      await selectTable(table, generation);
    }
    if (generation !== loadGeneration) return;
    const normalizedView = normalizeViewForDb(view, currentDb);
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
    if (!target || target.db !== currentDb?.id) return;
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
    if (historyOpen) historyView.refresh();
    if (event === "db-snapshot" && data) {
      snapshotView.handleSse(data);
    }
  }

  function getState(): TabState {
    const activeTable = tableList.el.querySelector<HTMLElement>(
      ".db-table-item.active",
    );
    const state: TabState = {
      id: cb.tabId,
      dbId: currentDb?.id ?? null,
      table: currentTable ?? activeTable?.dataset.table ?? null,
      view: currentTab,
    };

    // 永続化対象の per-tab UI state を載せる。空値は載せない (= tabs.json の
    // 体積を最小化、旧形式と区別しやすくする)。
    const sqlDraft = queryEditor.getSql();
    if (sqlDraft) state.sqlDraft = sqlDraft;
    // historyOpen は default = true なので、true のときは載せない (= 既定値)。
    // false のときだけ load 時に「閉じる」と判定できればよい。
    if (!historyOpen) state.historyOpen = false;
    if (historyPane.style.height)
      state.historyHeight = historyPane.style.height;
    if (sidebar.style.width) state.sidebarWidth = sidebar.style.width;

    if (currentDb?.kind === "redis") {
      const sel = redisExplorer.getSelection();
      if (
        sel.dbIndex !== undefined ||
        sel.key !== undefined ||
        sel.keyFilter !== undefined
      ) {
        state.redis = sel;
      }
    } else if (currentDb?.kind === "elasticsearch") {
      const sel = esExplorer.getSelection();
      if (sel.index !== undefined || sel.query !== undefined) {
        state.es = sel;
      }
    }

    return state;
  }

  function getDbKind(): DbKind | null {
    return currentDb?.kind ?? null;
  }

  function getAnnotationTarget(): DatabaseAnnotationTarget | null {
    if (!currentDb) return null;
    const target: DatabaseAnnotationTarget = {
      kind: "database",
      db: currentDb.id,
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
    if (!currentDb) return "(empty)";
    // 既存 sidebar select の表示と揃える: docker は service 名、sqlite は path basename。
    if (currentDb.id.startsWith("docker:")) {
      // currentDb.name は recursive discovery の長い label なので、service 部分だけ取り出す。
      // 例: "redis-svc (redis:7-alpine, localhost:6390 — data/test/redis)"
      //  → "redis-svc"
      const m = currentDb.name.match(/^(\S+)/);
      return m ? m[1] : currentDb.name;
    }
    const lastSlash = currentDb.path.lastIndexOf("/");
    return lastSlash >= 0
      ? currentDb.path.slice(lastSlash + 1)
      : currentDb.path;
  }

  function dispose(): void {
    loadGeneration++;
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
    currentDb = null;
    currentTable = null;
    schemaCache = null;
  }

  return {
    el: container,
    enter,
    handleSse,
    getState,
    getDbKind,
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

function makeTabId(): string {
  // crypto.randomUUID は modern browser で利用可能。fallback も入れる。
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return `t-${crypto.randomUUID().slice(0, 12)}`;
  }
  return `t-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

export function createDatabaseView(deps: DatabaseViewDeps): DatabaseView {
  let mounted = false;
  const tabsById = new Map<
    string,
    {
      pane: TabPaneInternal;
      chip: HTMLElement;
      label: HTMLElement;
      closeBtn: HTMLButtonElement;
    }
  >();
  const tabOrder: string[] = [];
  const paneReadyById = new Map<string, Promise<void>>();
  let activeTabId: string | null = null;
  let draggingTabId: string | null = null;
  let dropTargetId: string | null = null;
  let dropAfterTarget = false;
  // restoring 中は scheduleSave を抑制して、初期復元の連鎖 setState で
  // 過剰な PUT を発生させないようにする。復元完了後に 1 回まとめて保存する。
  let restoring = false;
  let savePending: ReturnType<typeof setTimeout> | null = null;
  let saveChain: Promise<void> = Promise.resolve();
  let lifecycleSeq = 0;
  let enterQueue: Promise<void> = Promise.resolve();
  let unloadListenerInstalled = false;

  function scheduleSave(): void {
    if (!mounted || restoring) return;
    if (savePending !== null) clearTimeout(savePending);
    savePending = setTimeout(saveNow, 500);
  }

  async function saveNow(options: { keepalive?: boolean } = {}): Promise<void> {
    savePending = null;
    if (!mounted || restoring) return;
    const tabs: TabState[] = [];
    for (const id of tabOrder) {
      const entry = tabsById.get(id);
      if (entry) tabs.push(entry.pane.getState());
    }
    if (tabs.length === 0) return;
    const body: TabsState = { version: 1, tabs, activeTabId };
    const raw = JSON.stringify(body);
    if (options.keepalive && navigator.sendBeacon) {
      const blob = new Blob([raw], { type: "application/json" });
      if (navigator.sendBeacon("/_db/tabs", blob)) return;
    }
    saveChain = saveChain
      .catch(() => {})
      .then(async () => {
        try {
          await fetch("/_db/tabs", {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
              "X-Code-Viewer-Action": "1",
            },
            body: raw,
            keepalive: options.keepalive,
          });
        } catch {
          // ベストエフォート。失敗してもユーザー操作は妨げない。
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
    if (!restoring) syncActiveRoute();
    scheduleSave();
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
        table: tab.table,
        view: tab.view,
        redis: tab.redis ?? null,
        es: tab.es ?? null,
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

  function closeDbIfUnused(dbId: string | null, kind: DbKind | null): void {
    if (!dbId || isDbStillOpen(dbId)) return;
    const body = JSON.stringify({ db: dbId });
    const headers = {
      "Content-Type": "application/json",
      "X-Code-Viewer-Action": "1",
    };
    const path =
      kind === "redis"
        ? "/_db/redis/close"
        : kind === "elasticsearch"
          ? "/_db/elasticsearch/close"
          : "/_db/close";
    void fetch(path, { method: "POST", headers, body }).catch(() => {});
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

  function moveTabBeforeOrAfter(
    dragId: string,
    targetId: string,
    after: boolean,
  ): void {
    if (dragId === targetId) return;
    const dragEntry = tabsById.get(dragId);
    const targetEntry = tabsById.get(targetId);
    if (!dragEntry || !targetEntry) return;
    const dragIndex = tabOrder.indexOf(dragId);
    if (dragIndex < 0) return;
    tabOrder.splice(dragIndex, 1);
    const targetIndex = tabOrder.indexOf(targetId);
    if (targetIndex < 0) {
      tabOrder.splice(dragIndex, 0, dragId);
      return;
    }
    const insertIndex = targetIndex + (after ? 1 : 0);
    tabOrder.splice(insertIndex, 0, dragId);
    tabsList.insertBefore(
      dragEntry.chip,
      after ? targetEntry.chip.nextSibling : targetEntry.chip,
    );
    scheduleSave();
  }

  function moveTabToEnd(dragId: string): void {
    const dragEntry = tabsById.get(dragId);
    if (!dragEntry) return;
    const dragIndex = tabOrder.indexOf(dragId);
    if (dragIndex < 0 || dragIndex === tabOrder.length - 1) return;
    tabOrder.splice(dragIndex, 1);
    tabOrder.push(dragId);
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
    options: DatabaseEnterOptions = {},
  ): string {
    const id = initial?.id || makeTabId();

    const chip = document.createElement("div");
    chip.className = "db-tabs-chip";
    chip.dataset.tabId = id;
    chip.setAttribute("role", "tab");
    chip.setAttribute("aria-selected", "false");
    chip.tabIndex = -1;

    const labelEl = document.createElement("span");
    labelEl.className = "db-tabs-chip-label";
    labelEl.textContent = "(empty)";

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "db-tabs-chip-close";
    closeBtn.title = "閉じる";
    closeBtn.tabIndex = -1;
    closeBtn.textContent = "×";
    closeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      closeTab(id);
    });

    chip.append(labelEl, closeBtn);
    attachTabDragHandlers(chip, closeBtn, id);
    chip.addEventListener("click", () => setActive(id));
    chip.addEventListener("keydown", (e) => {
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
      deps,
      {
        tabId: id,
        isActive: () => activeTabId === id,
        onStateChange: () => {
          refreshChipLabel(id);
          if (activeTabId === id && !restoring) syncActiveRoute();
          scheduleSave();
        },
      },
      {
        // タブ独立の永続化対象 state を全部渡す。pane 内で localStorage を
        // 読まず、tabs.json から復元した値をここから取る。
        dbId: initial?.dbId ?? null,
        table: initial?.table ?? null,
        view: (initial?.view as TabName | undefined) ?? undefined,
        sqlDraft: initial?.sqlDraft,
        historyOpen: initial?.historyOpen,
        historyHeight: initial?.historyHeight,
        sidebarWidth: initial?.sidebarWidth,
        redis: initial?.redis,
        es: initial?.es,
      },
    );
    pane.el.hidden = true;

    tabsList.appendChild(chip);
    tabHost.appendChild(pane.el);
    tabsById.set(id, { pane, chip, label: labelEl, closeBtn });
    tabOrder.push(id);

    setActive(id);
    // initial state を反映 (DB を選んで読み込む)。dbId/table/view は enter
    // 引数で渡し、それ以外の per-tab UI state は createTabPane の initial で
    // すでに復元済み。
    const ready = (async () => {
      if (options.annotationTarget) restoring = true;
      try {
        await pane.enter(
          initial?.dbId || undefined,
          initial?.table || undefined,
          initial?.view || undefined,
          options,
        );
        refreshChipLabel(id);
      } finally {
        if (options.annotationTarget) restoring = false;
        paneReadyById.delete(id);
      }
    })();
    paneReadyById.set(id, ready);

    return id;
  }

  function closeTab(id: string): void {
    const entry = tabsById.get(id);
    if (!entry) return;
    const closedDbId = entry.pane.getState().dbId;
    const closedKind = entry.pane.getDbKind();
    entry.pane.dispose();
    entry.pane.el.remove();
    entry.chip.remove();
    tabsById.delete(id);
    const orderIndex = tabOrder.indexOf(id);
    if (orderIndex >= 0) tabOrder.splice(orderIndex, 1);
    paneReadyById.delete(id);
    closeDbIfUnused(closedDbId, closedKind);
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
    const firstId = tabOrder[0];
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
    table?: string,
    view?: TabName,
  ): boolean {
    if (!db && (table || view) && !state.dbId) return false;
    if (db !== undefined && state.dbId !== db) return false;
    if (table !== undefined && state.table !== table) return false;
    if (view !== undefined && state.view !== view) return false;
    return true;
  }

  async function applyRouteToTab(
    db?: string,
    table?: string,
    view?: TabName,
    options: DatabaseEnterOptions = {},
  ): Promise<void> {
    async function enterPane(
      pane: TabPaneInternal,
      targetDb?: string,
      targetTable?: string,
      targetView?: TabName,
      enterOptions?: DatabaseEnterOptions,
    ): Promise<void> {
      if (!enterOptions?.annotationTarget) {
        await pane.enter(targetDb, targetTable, targetView, enterOptions);
        return;
      }
      restoring = true;
      try {
        await pane.enter(targetDb, targetTable, targetView, enterOptions);
      } finally {
        restoring = false;
      }
    }
    if (options.reuseActiveTab && activeTabId) {
      const targetId = activeTabId;
      const active = tabsById.get(activeTabId);
      if (active) {
        await enterPane(active.pane, db, table, view, options);
        if (!mounted) return;
        refreshChipLabel(targetId);
        return;
      }
    }
    for (const [id, entry] of tabsById) {
      if (routeMatchesState(entry.pane.getState(), db, table, view)) {
        setActive(id);
        if (options.annotationTarget) {
          await enterPane(entry.pane, db, table, view, options);
          if (!mounted) return;
        }
        refreshChipLabel(id);
        return;
      }
    }
    const id = openTab(
      {
        dbId: db ?? null,
        table: table ?? null,
        view: view ?? "data",
      },
      { autoSelectFirst: db !== undefined, ...options },
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

  async function doEnter(
    seq: number,
    db?: string,
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
      content.appendChild(root);
      document.body.classList.add("gdp-database-page");
      mounted = true;
      if (!unloadListenerInstalled) {
        window.addEventListener("beforeunload", handleBeforeUnload);
        unloadListenerInstalled = true;
      }
      deps.setPageMode();
      deps.syncHeaderMenu();

      // 永続化されたタブ構成があれば復元する。復元中は scheduleSave を
      // 抑制して、復元完了後に 1 回だけ保存する。
      const restored = await fetchTabs();
      if (!mounted || seq !== lifecycleSeq) return;
      if (restored && restored.tabs.length > 0) {
        restoring = true;
        const restoredIds: string[] = [];
        try {
          const restoredTabs = dedupeTabs(restored.tabs);
          for (const t of restoredTabs) {
            if (!mounted || seq !== lifecycleSeq) return;
            restoredIds.push(openTab(t, { autoSelectFirst: false }));
          }
          const targetId =
            restored.activeTabId && tabsById.has(restored.activeTabId)
              ? restored.activeTabId
              : tabOrder[0];
          if (targetId) setActive(targetId);
          await Promise.all(
            restoredIds.map((id) => paneReadyById.get(id)).filter(Boolean),
          );
          if (!mounted || seq !== lifecycleSeq) return;
        } finally {
          restoring = false;
        }
        // URL の引数があれば、まず同じ状態の既存タブを active 化する。
        // なければ active タブに上書き反映する。
        if (db || table || view) {
          await applyRouteToTab(db, table, view, options);
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
          table: table || null,
          view: view || "data",
        },
        { autoSelectFirst: !db, ...options },
      );
      const ready = paneReadyById.get(id);
      if (ready) await ready;
      if (!mounted || seq !== lifecycleSeq) return;
      return;
    }
    if (!activeTabId) return;
    const active = tabsById.get(activeTabId);
    if (!active) return;
    if (db || table || view) {
      await applyRouteToTab(db, table, view, options);
    }
  }

  async function enter(
    db?: string,
    table?: string,
    view?: TabName,
    options: DatabaseEnterOptions = {},
  ): Promise<void> {
    const seq = lifecycleSeq;
    enterQueue = enterQueue
      .catch(() => {})
      .then(() => doEnter(seq, db, table, view, options));
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
    tabOrder.length = 0;
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
    if (!mounted) return;
    flushPendingSave();
    root.hidden = true;
    document.body.classList.remove("gdp-database-page");
    const diff = document.getElementById("diff");
    if (diff) diff.hidden = false;
  }

  function handleSse(event?: string, data?: string): void {
    if (!mounted) return;
    const dbId = parseSseDbId(data);
    for (const [, entry] of tabsById) {
      if (dbId && entry.pane.getState().dbId !== dbId) continue;
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
