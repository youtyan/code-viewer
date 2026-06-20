import type { DbTableInfo } from "../../core/database/types";

export type TableListCallbacks = {
  onSelectTable: (table: string) => void;
  onSelectSchema: (table: string) => void;
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
