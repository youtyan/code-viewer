import type {
  DbColumn,
  DbFileInfo,
  DbFilesResponse,
  DbQueryResponse,
  DbSchemaResponse,
  DbTableDataResponse,
} from "../../core/database/types";
import type { AppRoute, DiffRange } from "../../core/routes";
import { createErDiagram } from "./er-diagram";
import { createQueryEditor } from "./query-editor";
import { createQueryHistoryView } from "./query-history-view";
import { createSchemaView } from "./schema-view";
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
  handleSse: () => void;
};

type TabName = "data" | "query" | "schema" | "er";

export function createDatabaseView(deps: DatabaseViewDeps): DatabaseView {
  let mounted = false;
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
  const tabData = createTab("Data", true);
  const tabSchema = createTab("Schema", false);
  tabBar.append(tabData, tabSchema);

  let currentTab: TabName = "data";

  const tableList = createTableList({
    onSelectTable: (table) => selectTable(table),
    onSelectSchema: (table) => showSchema(table),
    onViewCreateTable: (table) => showDdl(table),
    onViewDefinition: (table) => showSchema(table),
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

  toolsSection.append(queryBtn, erBtn);

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
  const historyView = createQueryHistoryView({
    getDbId: () => currentDb?.id || null,
    copySqlToQuery: (sql) => {
      queryEditor.setSql(sql);
      setActiveTab("query");
    },
  });

  const mainContent = document.createElement("div");
  mainContent.className = "db-main-content";
  mainContent.append(
    tabBar,
    grid.el,
    queryEditor.el,
    schemaView.el,
    erDiagram.el,
  );
  queryEditor.el.hidden = true;

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

  function createTab(text: string, active: boolean): HTMLButtonElement {
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

  function mount() {
    if (mounted) return;
    const content = document.getElementById("content");
    if (!content) return;
    const diff = document.getElementById("diff");
    if (diff) diff.hidden = true;
    const empty = document.getElementById("empty");
    if (empty) empty.classList.add("hidden");
    content.appendChild(container);
    mounted = true;
    applyHistoryVisibility();
  }

  function unmount() {
    if (!mounted) return;
    container.remove();
    const diff = document.getElementById("diff");
    if (diff) diff.hidden = false;
    mounted = false;
    grid.clear();
    schemaView.clear();
    erDiagram.clear();
    currentDb = null;
    schemaCache = null;
  }

  function setActiveTab(tab: TabName, updateUrl = true) {
    currentTab = tab;
    tabData.classList.toggle("active", tab === "data");
    tabSchema.classList.toggle("active", tab === "schema");
    queryBtn.classList.toggle("active", tab === "query");
    erBtn.classList.toggle("active", tab === "er");
    tabBar.hidden = tab === "query" || tab === "er";
    grid.el.hidden = tab !== "data";
    queryEditor.el.hidden = tab !== "query";
    schemaView.el.hidden = tab !== "schema";
    erDiagram.el.hidden = tab !== "er";
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

  async function enter(db?: string, table?: string, tab?: TabName) {
    mount();
    document.body.classList.add("gdp-database-page");
    deps.setPageMode();
    deps.syncHeaderMenu();

    const files = await fetchDbFiles();
    lastFiles = files;
    dbSelect.innerHTML = "";
    if (files.length === 0) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "No database files found";
      dbSelect.appendChild(opt);
      dbSelect.disabled = true;
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

    const target = db && files.find((f) => f.id === db) ? db : files[0].id;
    dbSelect.value = target;
    currentDb = files.find((f) => f.id === target) || null;

    await selectDb(target);
    if (table) {
      await selectTable(table);
    }
    if (tab && tab !== "data") {
      setActiveTab(tab);
      if (tab === "schema") {
        const activeTable = tableList.el.querySelector<HTMLElement>(
          ".db-table-item.active",
        );
        if (activeTable?.dataset.table) showSchema(activeTable.dataset.table);
      } else if (tab === "er") {
        if (schemaCache) renderErDiagram();
      }
    }
  }

  function leave() {
    document.body.classList.remove("gdp-database-page");
    unmount();
  }

  function handleSse() {
    if (!mounted) return;
    if (historyOpen) historyView.refresh();
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
