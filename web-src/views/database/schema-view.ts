import type {
  DbColumn,
  DbForeignKey,
  DbIndexInfo,
} from "../../core/database/types";

export type TriggerDisplayInfo = {
  name: string;
  sql: string;
};

export type SchemaViewData = {
  table: string;
  columns: DbColumn[];
  indexes: DbIndexInfo[];
  foreignKeys?: DbForeignKey[];
  triggers?: TriggerDisplayInfo[];
  ddl?: string;
};

export type SchemaView = {
  el: HTMLElement;
  render: (
    table: string,
    columns: DbColumn[],
    indexes: DbIndexInfo[],
    extra?: {
      foreignKeys?: DbForeignKey[];
      triggers?: TriggerDisplayInfo[];
      ddl?: string;
    },
  ) => void;
  clear: () => void;
};

export function createSchemaView(): SchemaView {
  const el = document.createElement("div");
  el.className = "db-schema-view";
  el.hidden = true;

  function render(
    table: string,
    columns: DbColumn[],
    indexes: DbIndexInfo[],
    extra?: {
      foreignKeys?: DbForeignKey[];
      triggers?: TriggerDisplayInfo[];
      ddl?: string;
    },
  ) {
    el.hidden = false;
    el.innerHTML = "";

    const header = document.createElement("div");
    header.className = "db-schema-header";
    header.textContent = `Schema: ${table}`;
    el.appendChild(header);

    /* ---- Columns ---- */
    const colSectionHeader = document.createElement("div");
    colSectionHeader.className = "db-schema-section-header";
    colSectionHeader.textContent = "Columns";
    el.appendChild(colSectionHeader);

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

    /* ---- Foreign Keys ---- */
    const fks = extra?.foreignKeys?.filter((fk) => fk.fromTable === table);
    if (fks && fks.length > 0) {
      const fkHeader = document.createElement("div");
      fkHeader.className = "db-schema-section-header";
      fkHeader.textContent = "Foreign Keys";
      el.appendChild(fkHeader);

      const fkTable = document.createElement("table");
      fkTable.className = "db-schema-table";
      const fkThead = document.createElement("thead");
      const fkHeadRow = document.createElement("tr");
      for (const label of ["Column", "References Table", "References Column"]) {
        const th = document.createElement("th");
        th.textContent = label;
        fkHeadRow.appendChild(th);
      }
      fkThead.appendChild(fkHeadRow);

      const fkTbody = document.createElement("tbody");
      for (const fk of fks) {
        const tr = document.createElement("tr");
        const tdFrom = document.createElement("td");
        tdFrom.textContent = fk.fromColumn;
        const tdToTable = document.createElement("td");
        tdToTable.textContent = fk.toTable;
        const tdToCol = document.createElement("td");
        tdToCol.textContent = fk.toColumn;
        tr.append(tdFrom, tdToTable, tdToCol);
        fkTbody.appendChild(tr);
      }
      fkTable.append(fkThead, fkTbody);
      el.appendChild(fkTable);
    }

    /* ---- Indexes ---- */
    const tableIndexes = indexes.filter((idx) => idx.table === table);
    if (tableIndexes.length > 0) {
      const idxHeader = document.createElement("div");
      idxHeader.className = "db-schema-section-header";
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

    /* ---- Triggers ---- */
    const triggers = extra?.triggers;
    if (triggers && triggers.length > 0) {
      const trigHeader = document.createElement("div");
      trigHeader.className = "db-schema-section-header";
      trigHeader.textContent = "Triggers";
      el.appendChild(trigHeader);

      for (const trig of triggers) {
        const trigBlock = document.createElement("div");
        trigBlock.className = "db-schema-trigger-block";

        const trigName = document.createElement("div");
        trigName.className = "db-schema-trigger-name";
        trigName.textContent = trig.name;

        const trigPre = document.createElement("pre");
        trigPre.className = "db-schema-ddl-pre";
        trigPre.textContent = trig.sql;

        trigBlock.append(trigName, trigPre);
        el.appendChild(trigBlock);
      }
    }

    /* ---- DDL (CREATE TABLE) ---- */
    const ddl = extra?.ddl;
    if (ddl) {
      const ddlHeader = document.createElement("div");
      ddlHeader.className = "db-schema-section-header";
      ddlHeader.textContent = "DDL";
      el.appendChild(ddlHeader);

      const ddlWrap = document.createElement("div");
      ddlWrap.className = "db-schema-ddl-wrap";

      const copyBtn = document.createElement("button");
      copyBtn.type = "button";
      copyBtn.className = "db-btn db-btn-sm db-schema-copy-btn";
      copyBtn.textContent = "Copy DDL";
      copyBtn.addEventListener("click", () => {
        navigator.clipboard.writeText(ddl).then(
          () => {
            copyBtn.textContent = "Copied!";
            setTimeout(() => {
              copyBtn.textContent = "Copy DDL";
            }, 1500);
          },
          () => {
            /* clipboard write failed — ignore */
          },
        );
      });

      const ddlPre = document.createElement("pre");
      ddlPre.className = "db-schema-ddl-pre";
      ddlPre.textContent = ddl;

      ddlWrap.append(copyBtn, ddlPre);
      el.appendChild(ddlWrap);
    }
  }

  function clear() {
    el.hidden = true;
    el.innerHTML = "";
  }

  return { el, render, clear };
}
