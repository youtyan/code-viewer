import type { DbColumn, DbTableInfo } from "../../core/database/types";
import { COPY_16_PATHS, iconSvg, X_16_PATH } from "../../core/icons";
import { isImeComposing } from "../../core/keyboard";

export type TableListCallbacks = {
  onSelectTable: (table: string) => void;
  onViewCreateTable?: (table: string) => void;
  onViewDefinition?: (table: string) => void;
  getColumns?: (table: string) => Promise<DbColumn[]>;
  getExpandedTables?: () => string[];
  onExpandedTableChange?: (table: string, expanded: boolean) => void;
};

export type TableList = {
  el: HTMLElement;
  render: (tables: DbTableInfo[]) => void;
  setActive: (table: string | null) => void;
  updateRowCount: (table: string, rowCount: number | null) => void;
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
  const filterClear = document.createElement("button");
  filterClear.className = "db-table-filter-clear";
  filterClear.type = "button";
  filterClear.title = "Clear table filter";
  filterClear.setAttribute("aria-label", "Clear table filter");
  filterClear.innerHTML = iconSvg("octicon-x", X_16_PATH);
  filterClear.hidden = true;
  filterWrap.append(filterInput, filterClear);

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
      if (isImeComposing(ev)) return;
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

      const colMain = document.createElement("div");
      colMain.className = "db-table-col-main";

      const colNameWrap = document.createElement("div");
      colNameWrap.className = "db-table-col-name-wrap";
      if (col.primaryKey) {
        const pk = document.createElement("span");
        pk.className = "db-table-col-key";
        pk.textContent = "PK";
        colNameWrap.appendChild(pk);
      }
      const colName = document.createElement("span");
      colName.className = "db-table-col-name";
      colName.textContent = col.name;
      colNameWrap.append(colName, createColumnCopyButton(col.name));

      const colType = document.createElement("span");
      colType.className = "db-table-col-type";
      colType.textContent = compactColumnType(col.type);
      colType.title = col.type;
      colMain.append(colNameWrap, colType);
      colRow.appendChild(colMain);

      const comment = columnCommentText(col.comment);
      if (comment) {
        const colComment = document.createElement("div");
        colComment.className = "db-table-col-comment";
        colComment.textContent = comment;
        colComment.title = comment;
        colRow.title = `${col.name}: ${comment}`;
        colRow.appendChild(colComment);
      }
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
      callbacks.onExpandedTableChange?.(tableName, false);
    } else {
      expandedTables.add(tableName);
      children.hidden = false;
      arrow.classList.add("expanded");
      callbacks.onExpandedTableChange?.(tableName, true);
      if (children.children.length === 0) {
        renderColumns(children, tableName);
      }
    }
  }

  function syncFilterClearButton(): void {
    filterClear.hidden = filterInput.value.length === 0;
  }

  function clearFilter(): void {
    if (!filterInput.value) return;
    filterInput.value = "";
    renderFiltered(allTables, "");
    filterInput.focus();
  }

  function renderFiltered(tables: DbTableInfo[], filter: string) {
    el.innerHTML = "";
    syncFilterClearButton();
    const filtered = filter
      ? tables.filter((t) =>
          t.name.toLowerCase().includes(filter.toLowerCase()),
        )
      : tables;
    if (filtered.length === 0) {
      const empty = document.createElement("div");
      empty.className = "db-table-list-empty";
      empty.textContent = filter ? "No matching tables" : "No tables found";
      if (filter) {
        const actions = document.createElement("div");
        actions.className = "db-pane-empty-actions db-table-list-empty-actions";
        const clear = document.createElement("button");
        clear.type = "button";
        clear.className = "db-btn db-btn-sm";
        clear.textContent = "Clear filter";
        clear.title = "Clear table filter";
        clear.setAttribute("aria-label", "Clear table filter");
        clear.addEventListener("click", clearFilter);
        actions.appendChild(clear);
        empty.appendChild(actions);
      }
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
    const tableNames = new Set(tables.map((table) => table.name));
    for (const table of callbacks.getExpandedTables?.() || []) {
      if (tableNames.has(table)) expandedTables.add(table);
    }
    columnCache.clear();
    activeTable = null;
    closeContextMenu();
    filterInput.value = "";
    renderFiltered(tables, "");
  }

  function handleFilterInput(): void {
    renderFiltered(allTables, filterInput.value);
  }

  filterInput.addEventListener("input", handleFilterInput);
  filterClear.addEventListener("click", clearFilter);

  function setActive(table: string | null) {
    activeTable = table;
    el.querySelectorAll<HTMLElement>(".db-table-item").forEach((item) => {
      item.classList.toggle("active", item.dataset.table === table);
    });
  }

  function updateRowCount(table: string, rowCount: number | null): void {
    allTables = allTables.map((entry) =>
      entry.name === table ? { ...entry, rowCount } : entry,
    );
    for (const node of el.querySelectorAll<HTMLElement>(".db-table-node")) {
      if (node.dataset.table !== table) continue;
      const count = node.querySelector<HTMLElement>(".db-table-count");
      if (count)
        count.textContent = rowCount != null ? formatRowCount(rowCount) : "";
    }
  }

  function dispose(): void {
    closeContextMenu();
    allTables = [];
    expandedTables.clear();
    columnCache.clear();
    activeTable = null;
    filterInput.removeEventListener("input", handleFilterInput);
    filterClear.removeEventListener("click", clearFilter);
  }

  return { el: wrapper, render, setActive, updateRowCount, dispose };
}

function formatRowCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function columnCommentText(comment: string | null | undefined): string {
  return (comment || "").trim();
}

function createColumnCopyButton(columnName: string): HTMLButtonElement {
  const copy = document.createElement("button");
  copy.type = "button";
  copy.className = "db-icon-btn db-table-col-copy";
  copy.title = "Copy column name";
  copy.setAttribute("aria-label", `Copy column name: ${columnName}`);
  copy.innerHTML = iconSvg("octicon-copy", COPY_16_PATHS);
  copy.addEventListener("click", async (event) => {
    event.stopPropagation();
    copy.classList.remove("copied", "failed");
    try {
      await navigator.clipboard.writeText(columnName);
      copy.classList.add("copied");
      setTimeout(() => copy.classList.remove("copied"), 1000);
    } catch {
      copy.classList.add("failed");
      setTimeout(() => copy.classList.remove("failed"), 1000);
    }
  });
  return copy;
}

function compactColumnType(type: string): string {
  const normalized = type.toLowerCase();
  if (normalized === "character varying") return "varchar";
  if (normalized === "timestamp with time zone") return "timestamptz";
  if (normalized === "timestamp without time zone") return "timestamp";
  if (normalized === "double precision") return "double";
  if (normalized === "USER-DEFINED".toLowerCase()) return "enum";
  return type;
}
