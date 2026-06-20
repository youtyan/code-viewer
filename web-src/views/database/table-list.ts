import type { DbTableInfo } from "../../core/database/types";

export type TableListCallbacks = {
  onSelectTable: (table: string) => void;
  onSelectSchema: (table: string) => void;
  onViewCreateTable?: (table: string) => void;
  onViewDefinition?: (table: string) => void;
};

export type TableList = {
  el: HTMLElement;
  render: (tables: DbTableInfo[]) => void;
  setActive: (table: string | null) => void;
};

export function createTableList(callbacks: TableListCallbacks): TableList {
  const el = document.createElement("div");
  el.className = "db-table-list";

  let activeTable: string | null = null;

  /* ---- Context menu ---- */
  let contextMenu: HTMLDivElement | null = null;

  function closeContextMenu() {
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
        document.removeEventListener("click", onDocClick, true);
        document.removeEventListener("keydown", onKeyDown, true);
      }
    };
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        closeContextMenu();
        document.removeEventListener("click", onDocClick, true);
        document.removeEventListener("keydown", onKeyDown, true);
      }
    };
    // Use setTimeout so the current event cycle doesn't immediately close it
    setTimeout(() => {
      document.addEventListener("click", onDocClick, true);
      document.addEventListener("keydown", onKeyDown, true);
    }, 0);
  }

  function render(tables: DbTableInfo[]) {
    el.innerHTML = "";
    if (tables.length === 0) {
      const empty = document.createElement("div");
      empty.className = "db-table-list-empty";
      empty.textContent = "No tables found";
      el.appendChild(empty);
      return;
    }
    const groups: Record<string, DbTableInfo[]> = { table: [], view: [] };
    for (const t of tables) {
      (groups[t.type] || groups.table).push(t);
    }
    for (const [type, items] of Object.entries(groups)) {
      if (items.length === 0) continue;
      const header = document.createElement("div");
      header.className = "db-table-group-header";
      header.textContent = type === "view" ? "Views" : "Tables";
      el.appendChild(header);
      for (const table of items) {
        const row = document.createElement("div");
        row.className = "db-table-item";
        if (table.name === activeTable) row.classList.add("active");
        row.dataset.table = table.name;

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

        row.append(icon, name, count);
        row.addEventListener("click", () =>
          callbacks.onSelectTable(table.name),
        );
        row.addEventListener("dblclick", () =>
          callbacks.onSelectSchema(table.name),
        );
        row.addEventListener("contextmenu", (e) =>
          showContextMenu(e, table.name),
        );
        el.appendChild(row);
      }
    }
  }

  function setActive(table: string | null) {
    activeTable = table;
    el.querySelectorAll<HTMLElement>(".db-table-item").forEach((item) => {
      item.classList.toggle("active", item.dataset.table === table);
    });
  }

  return { el, render, setActive };
}

function formatRowCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
