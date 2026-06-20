import type {
  DbFileInfo,
  DbFilesResponse,
  DbIndexInfo,
  DbQueryResponse,
  DbSchemaResponse,
  DbTableDataResponse,
} from "../../core/database/types";
import type { AppRoute, DiffRange } from "../../core/routes";
import { createQueryEditor } from "./query-editor";
import { createSchemaView } from "./schema-view";
import { createTableGrid, type GridSort } from "./table-grid";
import { createTableList } from "./table-list";

export type DatabaseViewDeps = {
  setRoute: (route: AppRoute, replace?: boolean) => void;
  setPageMode: () => void;
  currentRange: () => DiffRange;
  trackLoad: <T>(promise: Promise<T>) => Promise<T>;
  syncHeaderMenu: () => void;
};

export type DatabaseView = {
  enter: (db?: string, table?: string) => void;
  leave: () => void;
};

export function createDatabaseView(deps: DatabaseViewDeps): DatabaseView {
  let mounted = false;
  let currentDb: DbFileInfo | null = null;
  let schemaCache: DbSchemaResponse | null = null;
  let indexesCache: DbIndexInfo[] = [];

  const dbSelect = document.createElement("select");
  dbSelect.className = "db-file-select";
  dbSelect.title = "Select database file";

  const dbToolbar = document.createElement("div");
  dbToolbar.className = "db-toolbar";
  dbToolbar.appendChild(dbSelect);

  const tabBar = document.createElement("div");
  tabBar.className = "db-tab-bar";
  const tabData = document.createElement("button");
  tabData.className = "db-tab active";
  tabData.type = "button";
  tabData.textContent = "Data";
  const tabQuery = document.createElement("button");
  tabQuery.className = "db-tab";
  tabQuery.type = "button";
  tabQuery.textContent = "Query";
  const tabSchema = document.createElement("button");
  tabSchema.className = "db-tab";
  tabSchema.type = "button";
  tabSchema.textContent = "Schema";
  tabBar.append(tabData, tabQuery, tabSchema);

  const tableList = createTableList({
    onSelectTable: (table) => selectTable(table),
    onSelectSchema: (table) => showSchema(table),
  });

  const sidebar = document.createElement("div");
  sidebar.className = "db-sidebar";
  sidebar.append(dbToolbar, tableList.el);

  const grid = createTableGrid({
    fetchPage: (table, offset, limit, sort) =>
      fetchTablePage(table, offset, limit, sort),
  });

  const queryEditor = createQueryEditor({
    executeQuery: (sql) => executeQuery(sql),
  });

  const schemaView = createSchemaView();

  const mainContent = document.createElement("div");
  mainContent.className = "db-main-content";
  mainContent.append(tabBar, grid.el, queryEditor.el, schemaView.el);
  queryEditor.el.hidden = true;

  const container = document.createElement("div");
  container.className = "db-container";
  container.append(sidebar, mainContent);

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
    currentDb = null;
    schemaCache = null;
    indexesCache = [];
  }

  function setActiveTab(tab: "data" | "query" | "schema") {
    tabData.classList.toggle("active", tab === "data");
    tabQuery.classList.toggle("active", tab === "query");
    tabSchema.classList.toggle("active", tab === "schema");
    grid.el.hidden = tab !== "data";
    queryEditor.el.hidden = tab !== "query";
    schemaView.el.hidden = tab !== "schema";
    if (tab === "query") queryEditor.focus();
  }

  tabData.addEventListener("click", () => setActiveTab("data"));
  tabQuery.addEventListener("click", () => {
    setActiveTab("query");
  });
  tabSchema.addEventListener("click", () => {
    setActiveTab("schema");
    if (currentDb && tableList.el.querySelector(".db-table-item.active")) {
      const active = tableList.el.querySelector<HTMLElement>(
        ".db-table-item.active",
      );
      if (active?.dataset.table) showSchema(active.dataset.table);
    }
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
    indexesCache = schema.indexes;
    tableList.render(schema.tables);
    grid.clear();
    schemaView.clear();
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
      const data = await deps.trackLoad(fetchTablePage(table, 0, 200, null));
      grid.load(table, data);
    } catch {
      grid.load(table);
    }
  }

  async function showSchema(table: string) {
    setActiveTab("schema");
    if (!currentDb) return;
    const columns = schemaCache?.tables ? await fetchSchemaColumns(table) : [];
    schemaView.render(table, columns, indexesCache);
  }

  async function fetchSchemaColumns(table: string) {
    if (!currentDb) return [];
    const data = await fetchTablePage(table, 0, 0, null);
    return data.columns;
  }

  dbSelect.addEventListener("change", () => {
    const dbId = dbSelect.value;
    if (!dbId) return;
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

  async function enter(db?: string, table?: string) {
    mount();
    document.body.classList.add("gdp-database-page");
    deps.setPageMode();
    deps.syncHeaderMenu();

    const files = await fetchDbFiles();
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
      opt.textContent = `${f.path} (${formatSize(f.sizeBytes)})`;
      dbSelect.appendChild(opt);
    }

    const target = db && files.find((f) => f.id === db) ? db : files[0].id;
    dbSelect.value = target;
    currentDb = files.find((f) => f.id === target) || null;

    await selectDb(target);
    if (table) {
      selectTable(table);
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
