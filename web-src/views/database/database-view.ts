import type {
  DbColumn,
  DbFileInfo,
  DbFilesResponse,
  DbQueryResponse,
  DbSchemaResponse,
  DbTableDataResponse,
  TabState,
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

function createTabPane(
  outerDeps: DatabaseViewDeps,
  cb: TabPaneCallbacks,
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
  const savedWidth = localStorage.getItem("db:sidebar-width");
  if (savedWidth) sidebar.style.width = savedWidth;
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
      localStorage.setItem("db:sidebar-width", sidebar.style.width);
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
  });

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

  const redisExplorer = createRedisExplorer();
  redisExplorer.el.hidden = true;

  const esExplorer = createElasticsearchExplorer();
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
  const savedHistoryHeight = localStorage.getItem("db:history-height");
  if (savedHistoryHeight) historyPane.style.height = savedHistoryHeight;
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
      localStorage.setItem("db:history-height", historyPane.style.height);
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

  let historyOpen = localStorage.getItem("db:history-open") !== "false";
  function applyHistoryVisibility() {
    historyResizer.hidden = !historyOpen;
    historyPane.hidden = !historyOpen;
    historyToggle.classList.toggle("active", historyOpen);
    if (historyOpen) historyView.refresh();
  }
  applyHistoryVisibility();

  historyToggle.addEventListener("click", () => {
    historyOpen = !historyOpen;
    localStorage.setItem("db:history-open", String(historyOpen));
    applyHistoryVisibility();
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
    if (updateUrl) {
      const activeTable = tableList.el.querySelector<HTMLElement>(
        ".db-table-item.active",
      );
      deps.setRoute(
        {
          screen: "database",
          db: currentDb?.id,
          table: activeTable?.dataset.table,
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

  async function selectDb(dbId: string) {
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
        await redisExplorer.load(dbId);
      } else {
        redisExplorer.el.hidden = true;
        redisExplorer.clear();
        esExplorer.el.hidden = false;
        await esExplorer.load(dbId);
      }
      cb.onStateChange();
      return;
    }
    redisExplorer.el.hidden = true;
    redisExplorer.clear();
    esExplorer.el.hidden = true;
    esExplorer.clear();
    const schema = await fetchSchema(dbId);
    if (!schema) return;
    schemaCache = schema;
    tableList.render(schema.tables);
    grid.clear();
    schemaView.clear();
    erDiagram.clear();
    setActiveTab("data");
    if (schema.tables.length > 0) {
      selectTable(schema.tables[0].name);
    }
    cb.onStateChange();
  }

  async function selectTable(table: string) {
    tableList.setActive(table);
    if (!currentDb) return;
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
      grid.load(table, data);
    } catch {
      grid.load(table);
    }
    if (currentTab === "schema") {
      const columns = await fetchColumns(table);
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
    const dbId = dbSelect.value;
    if (!dbId) return;
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
    deps.setRoute(
      { screen: "database", db: dbId, range: deps.currentRange() },
      true,
    );
    selectDb(dbId);
  });

  async function enter(db?: string, table?: string, view?: TabName) {
    const files = await fetchDbFiles();
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

    await selectDb(target);
    if (currentDb?.kind === "redis" || currentDb?.kind === "elasticsearch") {
      cb.onStateChange();
      return;
    }
    if (table) {
      await selectTable(table);
    }
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
    return {
      id: cb.tabId,
      dbId: currentDb?.id ?? null,
      table: activeTable?.dataset.table ?? null,
      view: currentTab,
    };
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
    grid.clear();
    schemaView.clear();
    erDiagram.clear();
    redisExplorer.clear();
    esExplorer.clear();
    currentDb = null;
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
  let activeTabId: string | null = null;

  const tabsBar = document.createElement("div");
  tabsBar.className = "db-tabs-bar";
  const tabsList = document.createElement("div");
  tabsList.className = "db-tabs-list";
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
    }
    syncActiveRoute();
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
    // middle-click でも閉じる。
    chip.addEventListener("auxclick", (e) => {
      if (e.button === 1) {
        e.preventDefault();
        closeTab(id);
      }
    });

    const pane = createTabPane(deps, {
      tabId: id,
      isActive: () => activeTabId === id,
      onStateChange: () => {
        refreshChipLabel(id);
        if (activeTabId === id) syncActiveRoute();
      },
    });
    pane.el.hidden = true;

    tabsList.appendChild(chip);
    tabHost.appendChild(pane.el);
    tabsById.set(id, { pane, chip, label: labelEl });

    setActive(id);
    // initial state を反映 (DB を選んで読み込む)
    pane
      .enter(
        initial?.dbId || undefined,
        initial?.table || undefined,
        initial?.view || undefined,
      )
      .then(() => refreshChipLabel(id));

    return id;
  }

  function closeTab(id: string): void {
    const entry = tabsById.get(id);
    if (!entry) return;
    entry.pane.dispose();
    entry.pane.el.remove();
    entry.chip.remove();
    tabsById.delete(id);
    if (activeTabId !== id) return;
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

  async function enter(
    db?: string,
    table?: string,
    view?: TabName,
  ): Promise<void> {
    if (!mounted) {
      const content = document.getElementById("content");
      if (!content) return;
      const diff = document.getElementById("diff");
      if (diff) diff.hidden = true;
      const empty = document.getElementById("empty");
      if (empty) empty.classList.add("hidden");
      content.appendChild(root);
      document.body.classList.add("gdp-database-page");
      mounted = true;
      deps.setPageMode();
      deps.syncHeaderMenu();
    }

    if (tabsById.size === 0) {
      // 初回 enter: URL の引数を初期 state にして 1 タブ作る。
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
      await active.pane.enter(db, table, view);
      refreshChipLabel(activeTabId);
    }
  }

  function leave(): void {
    if (!mounted) return;
    for (const [, entry] of tabsById) {
      entry.pane.dispose();
    }
    tabsById.clear();
    tabsList.innerHTML = "";
    tabHost.innerHTML = "";
    activeTabId = null;
    root.remove();
    document.body.classList.remove("gdp-database-page");
    const diff = document.getElementById("diff");
    if (diff) diff.hidden = false;
    mounted = false;
  }

  function handleSse(event?: string, data?: string): void {
    if (!mounted || !activeTabId) return;
    const entry = tabsById.get(activeTabId);
    if (entry) entry.pane.handleSse(event, data);
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
