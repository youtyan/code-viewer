import type { DbColumn, DbTableInfo } from "../../core/database/types";

export type TableListCallbacks = {
  onSelectTable: (table: string) => void;
  onSelectSchema: (table: string) => void;
  onViewCreateTable?: (table: string) => void;
  onViewDefinition?: (table: string) => void;
  getColumns?: (table: string) => Promise<DbColumn[]>;
};

export type TableList = {
  el: HTMLElement;
  render: (tables: DbTableInfo[]) => void;
  setActive: (table: string | null) => void;
  dispose: () => void;
};

export function createTableList(callbacks: TableListCallbacks): TableList {
  const wrapper = document.createElement("div");
  wrapper.className = "db-table-list-wrapper";
  wrapper.style.display = "flex";
  wrapper.style.flexDirection = "column";
  wrapper.style.flex = "1";
  wrapper.style.overflow = "hidden";

  const filterWrap = document.createElement("div");
  filterWrap.className = "db-table-filter-wrap";
  const filterInput = document.createElement("input");
  filterInput.className = "db-table-filter";
  filterInput.type = "text";
  filterInput.placeholder = "Filter tables...";
  filterWrap.appendChild(filterInput);

  const el = document.createElement("div");
  el.className = "db-table-list";

  wrapper.append(filterWrap, el);

  let activeTable: string | null = null;
  let allTables: DbTableInfo[] = [];
  const expandedTables = new Set<string>();
  const columnCache = new Map<string, DbColumn[]>();

  /* ---- Context menu ---- */
  let contextMenu: HTMLDivElement | null = null;
  let contextMenuClick: ((ev: MouseEvent) => void) | null = null;
  let contextMenuKeyDown: ((ev: KeyboardEvent) => void) | null = null;
  let contextMenuTimer: ReturnType<typeof setTimeout> | null = null;

  function closeContextMenu() {
    if (contextMenuTimer) {
      clearTimeout(contextMenuTimer);
      contextMenuTimer = null;
    }
    if (contextMenuClick) {
      document.removeEventListener("click", contextMenuClick, true);
      contextMenuClick = null;
    }
    if (contextMenuKeyDown) {
      document.removeEventListener("keydown", contextMenuKeyDown, true);
      contextMenuKeyDown = null;
    }
    if (contextMenu) {
      contextMenu.remove();
      contextMenu = null;
    }
  }

  function showContextMenu(e: MouseEvent, tableName: string) {
    e.preventDefault();
    closeContextMenu();

    const menu = document.createElement("div");
    menu.className = "db-context-menu";
    menu.style.position = "absolute";
    menu.style.left = `${e.pageX}px`;
    menu.style.top = `${e.pageY}px`;

    const items: { label: string; action: () => void }[] = [
      {
        label: "Copy Table Name",
        action: () => {
          navigator.clipboard.writeText(tableName).catch(() => {
            /* ignore */
          });
        },
      },
      {
        label: "Copy SELECT Statement",
        action: () => {
          const sql = `SELECT * FROM "${tableName}" LIMIT 100`;
          navigator.clipboard.writeText(sql).catch(() => {
            /* ignore */
          });
        },
      },
      {
        label: "View CREATE TABLE",
        action: () => {
          callbacks.onViewCreateTable?.(tableName);
        },
      },
      {
        label: "View Table Definition",
        action: () => {
          callbacks.onViewDefinition?.(tableName);
        },
      },
    ];

    for (const item of items) {
      const row = document.createElement("div");
      row.className = "db-context-menu-item";
      row.textContent = item.label;
      row.addEventListener("click", () => {
        item.action();
        closeContextMenu();
      });
      menu.appendChild(row);
    }

    document.body.appendChild(menu);
    contextMenu = menu;

    // Close on outside click
    const onDocClick = (ev: MouseEvent) => {
      if (!menu.contains(ev.target as Node)) {
        closeContextMenu();
      }
    };
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        closeContextMenu();
      }
    };
    contextMenuClick = onDocClick;
    contextMenuKeyDown = onKeyDown;
    // Use setTimeout so the current event cycle doesn't immediately close it
    contextMenuTimer = setTimeout(() => {
      contextMenuTimer = null;
      document.addEventListener("click", onDocClick, true);
      document.addEventListener("keydown", onKeyDown, true);
    }, 0);
  }

  async function renderColumns(container: HTMLElement, tableName: string) {
    let cols = columnCache.get(tableName);
    if (!cols && callbacks.getColumns) {
      cols = await callbacks.getColumns(tableName);
      columnCache.set(tableName, cols);
    }
    if (!cols || cols.length === 0) return;
    container.innerHTML = "";
    for (const col of cols) {
      const colRow = document.createElement("div");
      colRow.className = "db-table-col-item";
      if (col.primaryKey) colRow.classList.add("pk");
      const colName = document.createElement("span");
      colName.className = "db-table-col-name";
      colName.textContent = col.name;
      const colType = document.createElement("span");
      colType.className = "db-table-col-type";
      colType.textContent = col.type;
      colRow.append(colName, colType);
      container.appendChild(colRow);
    }
  }

  function toggleExpand(
    tableName: string,
    _node: HTMLElement,
    arrow: HTMLElement,
    children: HTMLElement,
  ) {
    const expanded = expandedTables.has(tableName);
    if (expanded) {
      expandedTables.delete(tableName);
      children.hidden = true;
      arrow.classList.remove("expanded");
    } else {
      expandedTables.add(tableName);
      children.hidden = false;
      arrow.classList.add("expanded");
      if (children.children.length === 0) {
        renderColumns(children, tableName);
      }
    }
  }

  function renderFiltered(tables: DbTableInfo[], filter: string) {
    el.innerHTML = "";
    const filtered = filter
      ? tables.filter((t) =>
          t.name.toLowerCase().includes(filter.toLowerCase()),
        )
      : tables;
    if (filtered.length === 0) {
      const empty = document.createElement("div");
      empty.className = "db-table-list-empty";
      empty.textContent = filter ? "No matching tables" : "No tables found";
      el.appendChild(empty);
      return;
    }
    const groups: Record<string, DbTableInfo[]> = { table: [], view: [] };
    for (const t of filtered) {
      (groups[t.type] || groups.table).push(t);
    }
    for (const [type, items] of Object.entries(groups)) {
      if (items.length === 0) continue;
      const header = document.createElement("div");
      header.className = "db-table-group-header";
      header.textContent = type === "view" ? "Views" : "Tables";
      el.appendChild(header);
      for (const table of items) {
        const node = document.createElement("div");
        node.className = "db-table-node";
        node.dataset.table = table.name;

        const row = document.createElement("div");
        row.className = "db-table-item";
        if (table.name === activeTable) row.classList.add("active");
        row.dataset.table = table.name;

        const arrow = document.createElement("span");
        arrow.className = "db-table-arrow";
        if (expandedTables.has(table.name)) arrow.classList.add("expanded");

        const icon = document.createElement("span");
        icon.className = "db-table-icon";
        icon.textContent = table.type === "view" ? "V" : "T";
        icon.title = table.type === "view" ? "View" : "Table";

        const name = document.createElement("span");
        name.className = "db-table-name";
        name.textContent = table.name;

        const count = document.createElement("span");
        count.className = "db-table-count";
        count.textContent =
          table.rowCount != null ? formatRowCount(table.rowCount) : "";

        row.append(arrow, icon, name, count);

        const children = document.createElement("div");
        children.className = "db-table-children";
        children.hidden = !expandedTables.has(table.name);

        if (expandedTables.has(table.name)) {
          renderColumns(children, table.name);
        }

        arrow.addEventListener("click", (e) => {
          e.stopPropagation();
          toggleExpand(table.name, node, arrow, children);
        });
        row.addEventListener("click", () =>
          callbacks.onSelectTable(table.name),
        );
        row.addEventListener("dblclick", () =>
          callbacks.onSelectSchema(table.name),
        );
        row.addEventListener("contextmenu", (e) =>
          showContextMenu(e, table.name),
        );

        node.append(row, children);
        el.appendChild(node);
      }
    }
  }

  function render(tables: DbTableInfo[]) {
    allTables = tables;
    expandedTables.clear();
    columnCache.clear();
    activeTable = null;
    closeContextMenu();
    filterInput.value = "";
    renderFiltered(tables, "");
  }

  filterInput.addEventListener("input", () => {
    renderFiltered(allTables, filterInput.value);
  });

  function setActive(table: string | null) {
    activeTable = table;
    el.querySelectorAll<HTMLElement>(".db-table-item").forEach((item) => {
      item.classList.toggle("active", item.dataset.table === table);
    });
  }

  function dispose(): void {
    closeContextMenu();
    allTables = [];
    expandedTables.clear();
    columnCache.clear();
    activeTable = null;
  }

  return { el: wrapper, render, setActive, dispose };
}

function formatRowCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
