import type {
  DbValue,
  QueryHistoryEntry,
  QueryHistoryState,
} from "../../core/database/types";

export type QueryHistoryViewCallbacks = {
  getDbId: () => string | null;
  copySqlToQuery: (sql: string) => void;
};

export type QueryHistoryView = {
  el: HTMLElement;
  refresh: () => Promise<void>;
  clear: () => void;
};

export function createQueryHistoryView(
  callbacks: QueryHistoryViewCallbacks,
): QueryHistoryView {
  const el = document.createElement("div");
  el.className = "db-query-history";

  const toolbar = document.createElement("div");
  toolbar.className = "db-query-history-toolbar";

  const refreshBtn = document.createElement("button");
  refreshBtn.className = "db-query-history-action";
  refreshBtn.type = "button";
  refreshBtn.textContent = "Refresh";
  refreshBtn.title = "Refresh history";

  const clearBtn = document.createElement("button");
  clearBtn.className = "db-query-history-action db-query-history-danger";
  clearBtn.type = "button";
  clearBtn.textContent = "Clear All";
  clearBtn.title = "Delete all query history";

  toolbar.append(refreshBtn, clearBtn);

  const body = document.createElement("div");
  body.className = "db-query-history-body-split";

  const listCol = document.createElement("div");
  listCol.className = "db-query-history-list-col";

  const listEl = document.createElement("div");
  listEl.className = "db-query-history-list";
  listCol.appendChild(listEl);

  const detailCol = document.createElement("div");
  detailCol.className = "db-query-history-detail-col";
  const detailPlaceholder = document.createElement("div");
  detailPlaceholder.className = "db-query-history-detail-placeholder";
  detailPlaceholder.textContent = "Select a query to view details";
  detailCol.appendChild(detailPlaceholder);

  body.append(listCol, detailCol);
  el.append(toolbar, body);

  let entries: QueryHistoryEntry[] = [];
  const expandedIds = new Set<string>();
  let clearConfirmTimer: ReturnType<typeof setTimeout> | null = null;

  function armButtonConfirm(
    button: HTMLButtonElement,
    confirmText: string,
    defaultText: string,
  ): boolean {
    if (button.dataset.confirm === "1") {
      button.dataset.confirm = "";
      button.textContent = defaultText;
      return true;
    }
    button.dataset.confirm = "1";
    button.textContent = confirmText;
    window.setTimeout(() => {
      if (button.dataset.confirm === "1") {
        button.dataset.confirm = "";
        button.textContent = defaultText;
      }
    }, 3000);
    return false;
  }

  async function refresh() {
    const dbId = callbacks.getDbId();
    const params = dbId ? `?db=${encodeURIComponent(dbId)}` : "";
    try {
      const res = await fetch(`/_db/history${params}`);
      if (!res.ok) return;
      const state = (await res.json()) as QueryHistoryState;
      entries = state.entries;
      if (
        selectedEntryId &&
        !entries.some((entry) => entry.id === selectedEntryId)
      ) {
        clearDetail();
      }
      render();
    } catch {
      /* ignore */
    }
  }

  function render() {
    listEl.innerHTML = "";
    if (entries.length === 0) {
      const empty = document.createElement("div");
      empty.className = "db-query-history-empty";
      empty.textContent = "No query history";
      listEl.appendChild(empty);
      return;
    }
    for (const entry of entries) {
      listEl.appendChild(renderEntry(entry));
    }
  }

  let selectedEntryId: string | null = null;

  function clearDetail() {
    selectedEntryId = null;
    detailCol.innerHTML = "";
    detailCol.appendChild(detailPlaceholder);
  }

  function selectEntry(entry: QueryHistoryEntry) {
    selectedEntryId = entry.id;
    listEl
      .querySelectorAll<HTMLElement>(".db-query-history-entry")
      .forEach((el) => {
        el.classList.toggle("selected", el.dataset.id === entry.id);
      });
    renderDetail(entry);
  }

  function renderDetail(entry: QueryHistoryEntry) {
    detailCol.innerHTML = "";

    const actions = document.createElement("div");
    actions.className = "db-query-history-detail-actions";

    const useBtn = document.createElement("button");
    useBtn.className = "db-btn db-btn-primary";
    useBtn.type = "button";
    useBtn.textContent = "Use in Editor";
    useBtn.addEventListener("click", () => callbacks.copySqlToQuery(entry.sql));

    const copyBtn = document.createElement("button");
    copyBtn.className = "db-btn";
    copyBtn.type = "button";
    copyBtn.textContent = "Copy SQL";
    copyBtn.addEventListener("click", () => {
      navigator.clipboard.writeText(entry.sql).then(
        () => {
          copyBtn.textContent = "Copied!";
          setTimeout(() => {
            copyBtn.textContent = "Copy SQL";
          }, 1500);
        },
        () => {},
      );
    });

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "db-btn db-query-history-danger";
    deleteBtn.type = "button";
    deleteBtn.textContent = "Delete";
    deleteBtn.addEventListener("click", () => {
      if (!armButtonConfirm(deleteBtn, "Confirm delete", "Delete")) return;
      deleteEntry(entry.id);
    });

    actions.append(useBtn, copyBtn, deleteBtn);

    const sqlBlock = document.createElement("pre");
    sqlBlock.className = "db-query-history-sql";
    sqlBlock.textContent = entry.sql;

    detailCol.append(actions, sqlBlock);

    if (entry.body) {
      const bodyBlock = document.createElement("div");
      bodyBlock.className = "db-query-history-body";
      bodyBlock.textContent = entry.body;
      detailCol.appendChild(bodyBlock);
    }

    if (entry.columns.length > 0 && entry.rowsPreview.length > 0) {
      detailCol.appendChild(renderPreviewTable(entry));
    }

    if (entry.savedRows < entry.rowCount) {
      const note = document.createElement("div");
      note.className = "db-query-history-truncated";
      note.textContent = `Showing ${entry.savedRows} of ${entry.rowCount} rows`;
      detailCol.appendChild(note);
    }
  }

  function renderEntry(entry: QueryHistoryEntry): HTMLElement {
    const item = document.createElement("div");
    item.className = "db-query-history-entry";
    if (entry.id === selectedEntryId) item.classList.add("selected");
    item.dataset.id = entry.id;

    const meta = document.createElement("div");
    meta.className = "db-query-history-entry-meta";

    const byIcon = document.createElement("span");
    byIcon.className = "db-query-history-by";
    byIcon.textContent = entry.executedBy === "ai" ? "[AI]" : "[User]";

    const time = document.createElement("span");
    time.className = "db-query-history-time";
    time.textContent = formatTime(entry.executedAt);
    time.title = entry.executedAt;

    const stats = document.createElement("span");
    stats.className = "db-query-history-stats";
    const truncMark = entry.truncated ? "+" : "";
    stats.textContent = `${entry.rowCount}${truncMark} rows, ${entry.elapsedMs}ms`;

    meta.append(byIcon, time, stats);

    const title = document.createElement("div");
    title.className = "db-query-history-entry-title";
    title.textContent =
      entry.title ||
      (entry.sql.length > 80 ? `${entry.sql.slice(0, 80)}...` : entry.sql);

    item.append(meta, title);

    item.addEventListener("click", () => selectEntry(entry));

    return item;
  }

  function renderPreviewTable(entry: QueryHistoryEntry): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = "db-query-table-wrap";

    const table = document.createElement("table");
    table.className = "db-query-table";

    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    const thNum = document.createElement("th");
    thNum.textContent = "#";
    thNum.className = "db-grid-rownum";
    headRow.appendChild(thNum);
    for (const col of entry.columns) {
      const th = document.createElement("th");
      th.textContent = col;
      headRow.appendChild(th);
    }
    thead.appendChild(headRow);

    const tbody = document.createElement("tbody");
    for (let i = 0; i < entry.rowsPreview.length; i++) {
      const row = entry.rowsPreview[i];
      const tr = document.createElement("tr");
      if (i % 2 === 1) tr.classList.add("alt");
      const tdNum = document.createElement("td");
      tdNum.className = "db-grid-rownum";
      tdNum.textContent = String(i + 1);
      tr.appendChild(tdNum);
      for (const value of row) {
        const td = document.createElement("td");
        td.textContent = formatValue(value);
        if (value === null) td.classList.add("null");
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.append(thead, tbody);
    wrapper.appendChild(table);

    if (entry.savedRows < entry.rowCount) {
      const note = document.createElement("div");
      note.className = "db-query-history-truncated";
      note.textContent = `Showing ${entry.savedRows} of ${entry.rowCount} rows`;
      wrapper.appendChild(note);
    }

    return wrapper;
  }

  function resetDetailCol() {
    detailCol.innerHTML = "";
    detailCol.appendChild(detailPlaceholder);
    selectedEntryId = null;
  }

  async function deleteEntry(id: string) {
    try {
      await fetch("/_db/history/delete", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Code-Viewer-Action": "1",
        },
        body: JSON.stringify({ id }),
      });
      entries = entries.filter((e) => e.id !== id);
      expandedIds.delete(id);
      if (selectedEntryId === id) resetDetailCol();
      const itemEl = listEl.querySelector<HTMLElement>(
        `.db-query-history-entry[data-id="${CSS.escape(id)}"]`,
      );
      if (itemEl) {
        itemEl.remove();
        if (entries.length === 0) render();
      } else {
        render();
      }
    } catch {
      /* ignore */
    }
  }

  clearBtn.addEventListener("click", async () => {
    const dbId = callbacks.getDbId();
    if (clearBtn.dataset.confirm !== "1") {
      clearBtn.dataset.confirm = "1";
      clearBtn.textContent = "Confirm clear";
      if (clearConfirmTimer) clearTimeout(clearConfirmTimer);
      clearConfirmTimer = setTimeout(() => {
        clearBtn.dataset.confirm = "";
        clearBtn.textContent = "Clear All";
        clearConfirmTimer = null;
      }, 3000);
      return;
    }
    clearBtn.dataset.confirm = "";
    clearBtn.textContent = "Clear All";
    if (clearConfirmTimer) {
      clearTimeout(clearConfirmTimer);
      clearConfirmTimer = null;
    }
    try {
      await fetch("/_db/history/clear", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Code-Viewer-Action": "1",
        },
        body: JSON.stringify(dbId ? { db: dbId } : {}),
      });
      entries = [];
      render();
    } catch {
      /* ignore */
    }
  });

  refreshBtn.addEventListener("click", () => {
    refresh();
  });

  function clear(): void {
    entries = [];
    expandedIds.clear();
    if (clearConfirmTimer) {
      clearTimeout(clearConfirmTimer);
      clearConfirmTimer = null;
    }
    clearBtn.dataset.confirm = "";
    clearBtn.textContent = "Clear All";
    clearDetail();
    render();
  }

  return { el, refresh, clear };
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  } catch {
    return iso;
  }
}

function formatValue(value: DbValue): string {
  if (value === null) return "NULL";
  if (value instanceof Uint8Array) return `<blob ${value.byteLength} bytes>`;
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
