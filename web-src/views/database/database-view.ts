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
  const tabQuery = createTab("Query", false);
  const tabSchema = createTab("Schema", false);
  const tabEr = createTab("ER Diagram", false);
  tabBar.append(tabData, tabQuery, tabSchema, tabEr);

  const tableList = createTableList({
    onSelectTable: (table) => selectTable(table),
    onSelectSchema: (table) => showSchema(table),
  });

  const sidebar = document.createElement("div");
  sidebar.className = "db-sidebar";
  sidebar.append(dbToolbar, tableList.el);

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

  const container = document.createElement("div");
  container.className = "db-container";
  container.append(sidebar, mainContent);

  function createTab(text: string, active: boolean): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.className = `db-tab${active ? " active" : ""}`;
    btn.type = "button";
    btn.textContent = text;
    return btn;
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
    tabData.classList.toggle("active", tab === "data");
    tabQuery.classList.toggle("active", tab === "query");
    tabSchema.classList.toggle("active", tab === "schema");
    tabEr.classList.toggle("active", tab === "er");
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
  tabQuery.addEventListener("click", () => setActiveTab("query"));
  tabSchema.addEventListener("click", () => {
    setActiveTab("schema");
    const active = tableList.el.querySelector<HTMLElement>(
      ".db-table-item.active",
    );
    if (active?.dataset.table) showSchema(active.dataset.table);
  });
  tabEr.addEventListener("click", () => {
    setActiveTab("er");
    if (schemaCache) renderErDiagram();
  });

  async function fetchDbFiles(): Promise<DbFileInfo[]> {
    const res = await deps.trackLoad(fetch("/_db/files"));
    if (!res.ok) return [];
    const data = (await res.json()) as DbFilesResponse;
    return data.files;
  }

  async function fetchSchema(dbId: string): Promise<DbSchemaResponse | null> {
    const res = await deps.trackLoad(
      fetch(`/_db/schema?db=${encodeURIComponent(dbId)}`),
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
      body: JSON.stringify({ db: currentDb.id, sql }),
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
    setActiveTab("data");
    if (!currentDb) return;
    deps.setRoute(
      {
        screen: "database",
        db: currentDb.id,
        table,
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
  }

  async function showSchema(table: string) {
    setActiveTab("schema");
    if (!currentDb) return;
    const data = await fetchTablePage(table, 0, 0, null, []);
    schemaView.render(table, data.columns, schemaCache?.indexes || []);
  }

  async function renderErDiagram() {
    if (!schemaCache || !currentDb) return;
    const columnsMap = new Map<string, DbColumn[]>();
    for (const t of schemaCache.tables) {
      if (t.type === "view") continue;
      try {
        const data = await fetchTablePage(t.name, 0, 0, null, []);
        columnsMap.set(t.name, data.columns);
      } catch {
        // skip
      }
    }
    erDiagram.render(schemaCache, columnsMap);
  }

  dbSelect.addEventListener("change", () => {
    const dbId = dbSelect.value;
    if (!dbId) return;
    const file = lastFiles.find((f) => f.id === dbId);
    if (file?.id.startsWith("docker:")) {
      alert("PostgreSQL/MySQL adapter is not yet implemented");
      if (currentDb) dbSelect.value = currentDb.id;
      return;
    }
    const option = dbSelect.selectedOptions[0];
    currentDb = {
      id: dbId,
      path: dbId,
      name: option?.textContent || dbId,
      sizeBytes: 0,
      kind: "sqlite",
    };
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

    if (currentDb?.id.startsWith("docker:")) {
      alert("PostgreSQL/MySQL adapter is not yet implemented");
      return;
    }

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

  return { enter, leave };
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}
