import type {
  DbColumn,
  DbFileInfo,
  DbFilesResponse,
  DbQueryResponse,
  DbSchemaResponse,
  DbTableDataResponse,
  TabState,
  TabsResponse,
  TabsState,
} from "../../core/database/types";
import type { AppRoute, DiffRange } from "../../core/routes";
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
  enter: (db?: string, table?: string, tab?: TabName) => void;
  leave: () => void;
  handleSse: (event?: string, data?: string) => void;
};

type TabName = "data" | "query" | "schema" | "er" | "search" | "snapshot";

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
  enter: (db?: string, table?: string, view?: TabName) => Promise<void>;
  handleSse: (event?: string, data?: string) => void;
  getState: () => TabState;
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
  redis?: { dbIndex?: number; key?: string };
  es?: { index?: string; query?: string };
};

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
  const toolsSection = document.createElement("div");
  toolsSection.className = "db-tools-section";

  const queryBtn = document.createElement("button");
  queryBtn.className = "db-tool-btn";
  queryBtn.type = "button";
  queryBtn.textContent = "Query";
  queryBtn.title = "SQL Query Editor";
  queryBtn.addEventListener("click", () => {
    setActiveTab("query");
  });

  const erBtn = document.createElement("button");
  erBtn.className = "db-tool-btn";
  erBtn.type = "button";
  erBtn.textContent = "ER Diagram";
  erBtn.title = "Entity Relationship Diagram";
  erBtn.addEventListener("click", () => {
    setActiveTab("er");
    if (schemaCache) renderErDiagram();
  });

  const searchBtn = document.createElement("button");
  searchBtn.className = "db-tool-btn";
  searchBtn.type = "button";
  searchBtn.textContent = "Search";
  searchBtn.title = "Search all tables";
  searchBtn.addEventListener("click", () => {
    setActiveTab("search");
  });

  const snapshotBtn = document.createElement("button");
  snapshotBtn.className = "db-tool-btn";
  snapshotBtn.type = "button";
  snapshotBtn.textContent = "Snapshot";
  snapshotBtn.title = "Snapshot & Diff";
  snapshotBtn.addEventListener("click", () => {
    setActiveTab("snapshot");
    snapshotView.refresh();
  });

  toolsSection.append(queryBtn, erBtn, searchBtn, snapshotBtn);

  sidebar.append(dbToolbar, tableList.el, toolsSection);

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
  if (initial.sqlDraft) queryEditor.setSql(initial.sqlDraft);

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
    historyResizer.hidden = !historyOpen;
    historyPane.hidden = !historyOpen;
    historyToggle.classList.toggle("active", historyOpen);
    if (historyOpen) historyView.refresh();
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
    tabBar.hidden = false;
    grid.el.hidden = false;
  }

  function setActiveTab(tab: TabName, updateUrl = true) {
    currentTab = tab;
    tabData.classList.toggle("active", tab === "data");
    tabSchema.classList.toggle("active", tab === "schema");
    queryBtn.classList.toggle("active", tab === "query");
    erBtn.classList.toggle("active", tab === "er");
    searchBtn.classList.toggle("active", tab === "search");
    snapshotBtn.classList.toggle("active", tab === "snapshot");
    tabBar.hidden =
      tab === "query" || tab === "er" || tab === "search" || tab === "snapshot";
    grid.el.hidden = tab !== "data";
    queryEditor.el.hidden = tab !== "query";
    schemaView.el.hidden = tab !== "schema";
    erDiagram.el.hidden = tab !== "er";
    globalSearchView.el.hidden = tab !== "search";
    snapshotView.el.hidden = tab !== "snapshot";
    if (tab === "query") queryEditor.focus();
    if (updateUrl && currentDb) {
      deps.setRoute(
        {
          screen: "database",
          db: currentDb?.id,
          table: currentTable ?? undefined,
          tab: tab === "data" ? undefined : tab,
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

  async function fetchDbFiles(): Promise<DbFileInfo[]> {
    const res = await deps.trackLoad(fetch("/_db/files"));
    if (!res.ok) return [];
    const data = (await res.json()) as DbFilesResponse;
    return data.files;
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
    return (await res.json()) as DbQueryResponse;
  }

  async function selectDb(
    dbId: string,
    explorerInitial?: {
      redis?: { dbIndex?: number; key?: string };
      es?: { index?: string; query?: string };
    },
    generation = loadGeneration,
  ) {
    if (generation !== loadGeneration || currentDb?.id !== dbId) return;
    currentTable = null;
    if (currentDb?.kind === "redis" || currentDb?.kind === "elasticsearch") {
      tableList.render([]);
      grid.clear();
      schemaView.clear();
      erDiagram.clear();
      schemaCache = null;
      tabBar.hidden = true;
      grid.el.hidden = true;
      queryEditor.el.hidden = true;
      schemaView.el.hidden = true;
      erDiagram.el.hidden = true;
      globalSearchView.el.hidden = true;
      snapshotView.el.hidden = true;
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
    const schema = await fetchSchema(dbId);
    if (generation !== loadGeneration || currentDb?.id !== dbId) return;
    if (!schema) return;
    schemaCache = schema;
    tableList.render(schema.tables);
    grid.clear();
    schemaView.clear();
    erDiagram.clear();
    setActiveTab("data");
    if (schema.tables.length > 0) {
      await selectTable(schema.tables[0].name, generation);
    }
    cb.onStateChange();
  }

  async function selectTable(table: string, generation = loadGeneration) {
    if (generation !== loadGeneration) return;
    currentTable = table;
    tableList.setActive(table);
    if (!currentDb) return;
    const requestDbId = currentDb.id;
    if (currentTab === "query" || currentTab === "er") {
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

  async function enter(db?: string, table?: string, view?: TabName) {
    const generation = ++loadGeneration;
    const files = await fetchDbFiles();
    if (generation !== loadGeneration) return;
    lastFiles = files;
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
    if (view && view !== "data") {
      setActiveTab(view);
      if (view === "schema") {
        const activeTable = tableList.el.querySelector<HTMLElement>(
          ".db-table-item.active",
        );
        if (activeTable?.dataset.table) showSchema(activeTable.dataset.table);
      } else if (view === "er") {
        if (schemaCache) renderErDiagram();
      } else if (view === "snapshot") {
        snapshotView.refresh();
      }
    }
    cb.onStateChange();
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
      if (sel.dbIndex !== undefined || sel.key !== undefined) {
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
    redisExplorer.clear();
    esExplorer.clear();
    currentDb = null;
    currentTable = null;
    schemaCache = null;
  }

  return {
    el: container,
    enter,
    handleSse,
    getState,
    getLabel,
    dispose,
  };
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
    { pane: TabPaneInternal; chip: HTMLElement; label: HTMLElement }
  >();
  const paneReadyById = new Map<string, Promise<void>>();
  let activeTabId: string | null = null;
  // restoring 中は scheduleSave を抑制して、初期復元の連鎖 setState で
  // 過剰な PUT を発生させないようにする。復元完了後に 1 回まとめて保存する。
  let restoring = false;
  let savePending: ReturnType<typeof setTimeout> | null = null;
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
    for (const [, entry] of tabsById) tabs.push(entry.pane.getState());
    if (tabs.length === 0) return;
    const body: TabsState = { version: 1, tabs, activeTabId };
    try {
      await fetch("/_db/tabs", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "X-Code-Viewer-Action": "1",
        },
        body: JSON.stringify(body),
        keepalive: options.keepalive,
      });
    } catch {
      // ベストエフォート。失敗してもユーザー操作は妨げない。
    }
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
  }

  function openTab(initial?: Partial<TabState>): string {
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
    closeBtn.textContent = "×";
    closeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      closeTab(id);
    });

    chip.append(labelEl, closeBtn);
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
    tabsById.set(id, { pane, chip, label: labelEl });

    setActive(id);
    // initial state を反映 (DB を選んで読み込む)。dbId/table/view は enter
    // 引数で渡し、それ以外の per-tab UI state は createTabPane の initial で
    // すでに復元済み。
    const ready = pane
      .enter(
        initial?.dbId || undefined,
        initial?.table || undefined,
        initial?.view || undefined,
      )
      .then(() => refreshChipLabel(id))
      .finally(() => {
        paneReadyById.delete(id);
      });
    paneReadyById.set(id, ready);

    return id;
  }

  function closeTab(id: string): void {
    const entry = tabsById.get(id);
    if (!entry) return;
    entry.pane.dispose();
    entry.pane.el.remove();
    entry.chip.remove();
    tabsById.delete(id);
    paneReadyById.delete(id);
    if (activeTabId !== id) {
      scheduleSave();
      return;
    }
    if (tabsById.size === 0) {
      // 最後のタブを閉じようとした → 空タブにリセットして残す。
      openTab({});
      return;
    }
    // 残りの先頭を active 化。
    const firstId = tabsById.keys().next().value as string | undefined;
    if (firstId) setActive(firstId);
  }

  newTabBtn.addEventListener("click", () => {
    openTab({});
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
  ): Promise<void> {
    for (const [id, entry] of tabsById) {
      if (routeMatchesState(entry.pane.getState(), db, table, view)) {
        setActive(id);
        refreshChipLabel(id);
        return;
      }
    }
    const active = tabsById.get(activeTabId ?? "");
    if (!active || !activeTabId) return;
    await active.pane.enter(db, table, view);
    refreshChipLabel(activeTabId);
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

  async function enter(
    db?: string,
    table?: string,
    view?: TabName,
  ): Promise<void> {
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
      if (restored && restored.tabs.length > 0) {
        restoring = true;
        const restoredIds: string[] = [];
        try {
          for (const t of restored.tabs) {
            restoredIds.push(openTab(t));
          }
          const targetId =
            restored.activeTabId && tabsById.has(restored.activeTabId)
              ? restored.activeTabId
              : (tabsById.keys().next().value as string | undefined);
          if (targetId) setActive(targetId);
          await Promise.all(
            restoredIds.map((id) => paneReadyById.get(id)).filter(Boolean),
          );
        } finally {
          restoring = false;
        }
        // URL の引数があれば、まず同じ状態の既存タブを active 化する。
        // なければ active タブに上書き反映する。
        if (db || table || view) {
          await applyRouteToTab(db, table, view);
        } else {
          syncActiveRoute();
        }
        // 初期復元の連鎖 setState を 1 回の PUT にまとめる。
        scheduleSave();
        return;
      }
    }

    if (tabsById.size === 0) {
      // 初回 enter (永続化なし): URL の引数を初期 state にして 1 タブ作る。
      openTab({
        dbId: db || null,
        table: table || null,
        view: view || "data",
      });
      return;
    }
    if (!activeTabId) return;
    const active = tabsById.get(activeTabId);
    if (!active) return;
    if (db || table || view) {
      await applyRouteToTab(db, table, view);
    }
  }

  function leave(): void {
    if (!mounted) return;
    flushPendingSave();
    for (const [, entry] of tabsById) {
      entry.pane.dispose();
    }
    tabsById.clear();
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

  function handleSse(event?: string, data?: string): void {
    if (!mounted) return;
    const dbId = parseSseDbId(data);
    for (const [, entry] of tabsById) {
      if (dbId && entry.pane.getState().dbId !== dbId) continue;
      entry.pane.handleSse(event, data);
    }
  }

  return { enter, leave, handleSse };
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}
