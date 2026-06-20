import type { DbColumn, DbIndexInfo } from "../../core/database/types";

export type SchemaView = {
  el: HTMLElement;
  render: (table: string, columns: DbColumn[], indexes: DbIndexInfo[]) => void;
  clear: () => void;
};

export function createSchemaView(): SchemaView {
  const el = document.createElement("div");
  el.className = "db-schema-view";
  el.hidden = true;

  function render(table: string, columns: DbColumn[], indexes: DbIndexInfo[]) {
    el.hidden = false;
    el.innerHTML = "";

    const header = document.createElement("div");
    header.className = "db-schema-header";
    header.textContent = `Schema: ${table}`;
    el.appendChild(header);

    const colTable = document.createElement("table");
    colTable.className = "db-schema-table";
    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    for (const label of ["Column", "Type", "Nullable", "PK", "Default"]) {
      const th = document.createElement("th");
      th.textContent = label;
      headRow.appendChild(th);
    }
    thead.appendChild(headRow);

    const tbody = document.createElement("tbody");
    for (const col of columns) {
      const tr = document.createElement("tr");
      if (col.primaryKey) tr.classList.add("pk-row");

      const tdName = document.createElement("td");
      tdName.textContent = col.name;
      tdName.className = "db-schema-col-name";

      const tdType = document.createElement("td");
      tdType.textContent = col.type;
      tdType.className = "db-schema-col-type";

      const tdNull = document.createElement("td");
      tdNull.textContent = col.nullable ? "YES" : "NO";

      const tdPk = document.createElement("td");
      tdPk.textContent = col.primaryKey ? "PK" : "";
      if (col.primaryKey) tdPk.className = "db-schema-pk";

      const tdDefault = document.createElement("td");
      tdDefault.textContent = col.defaultValue ?? "";
      tdDefault.className = "db-schema-default";

      tr.append(tdName, tdType, tdNull, tdPk, tdDefault);
      tbody.appendChild(tr);
    }
    colTable.append(thead, tbody);
    el.appendChild(colTable);

    const tableIndexes = indexes.filter((idx) => idx.table === table);
    if (tableIndexes.length > 0) {
      const idxHeader = document.createElement("div");
      idxHeader.className = "db-schema-header";
      idxHeader.textContent = "Indexes";
      el.appendChild(idxHeader);

      const idxTable = document.createElement("table");
      idxTable.className = "db-schema-table";
      const idxThead = document.createElement("thead");
      const idxHeadRow = document.createElement("tr");
      for (const label of ["Name", "Columns", "Unique"]) {
        const th = document.createElement("th");
        th.textContent = label;
        idxHeadRow.appendChild(th);
      }
      idxThead.appendChild(idxHeadRow);

      const idxTbody = document.createElement("tbody");
      for (const idx of tableIndexes) {
        const tr = document.createElement("tr");
        const tdName = document.createElement("td");
        tdName.textContent = idx.name;
        const tdCols = document.createElement("td");
        tdCols.textContent = idx.columns.join(", ");
        const tdUnique = document.createElement("td");
        tdUnique.textContent = idx.unique ? "YES" : "NO";
        tr.append(tdName, tdCols, tdUnique);
        idxTbody.appendChild(tr);
      }
      idxTable.append(idxThead, idxTbody);
      el.appendChild(idxTable);
    }
  }

  function clear() {
    el.hidden = true;
    el.innerHTML = "";
  }

  return { el, render, clear };
}
