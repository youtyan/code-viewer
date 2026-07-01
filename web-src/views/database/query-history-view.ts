import type {
  DbValue,
  QueryHistoryEntry,
  QueryHistoryState,
} from "../../core/database/types";
import { iconSvg, SYNC_16_PATH } from "../../core/icons";
import { type DbText, dbText } from "./i18n";

export type QueryHistoryViewCallbacks = {
  getDbId: () => string | null;
  getSchema: () => string | null;
  copySqlToQuery: (sql: string) => void;
  getText?: () => DbText;
};

export type QueryHistoryView = {
  el: HTMLElement;
  refresh: (options?: {
    force?: boolean;
    announceResult?: boolean;
  }) => Promise<void>;
  clear: () => void;
  localize: () => void;
};

type RefreshResult =
  | { type: "none" }
  | { type: "added"; count: number }
  | { type: "unchanged" };

export function createQueryHistoryView(
  callbacks: QueryHistoryViewCallbacks,
): QueryHistoryView {
  const text = (): DbText => callbacks.getText?.() ?? dbText("en");
  const el = document.createElement("div");
  el.className = "db-query-history";

  const toolbar = document.createElement("div");
  toolbar.className = "db-query-history-toolbar";

  const refreshBtn = document.createElement("button");
  refreshBtn.className = "db-query-history-action db-query-history-refresh";
  refreshBtn.type = "button";
  refreshBtn.innerHTML = iconSvg("octicon-sync", SYNC_16_PATH);
  const refreshLabel = document.createElement("span");
  refreshLabel.className = "db-query-history-action-label";
  refreshBtn.appendChild(refreshLabel);

  const refreshResult = document.createElement("span");
  refreshResult.className = "db-refresh-result db-query-history-refresh-result";
  refreshResult.setAttribute("aria-live", "polite");
  refreshResult.hidden = true;

  const clearBtn = document.createElement("button");
  clearBtn.className = "db-query-history-action db-query-history-danger";
  clearBtn.type = "button";
  clearBtn.textContent = text().history.clearAll;
  clearBtn.title = text().history.clearTitle;

  toolbar.append(refreshBtn, refreshResult, clearBtn);

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
  detailPlaceholder.textContent = text().history.selectPlaceholder;
  detailCol.appendChild(detailPlaceholder);

  body.append(listCol, detailCol);
  el.append(toolbar, body);

  let entries: QueryHistoryEntry[] = [];
  const expandedIds = new Set<string>();
  let clearConfirmTimer: ReturnType<typeof setTimeout> | null = null;
  let lastRefreshKey: string | null = null;
  let lastRefreshAt = 0;
  let inFlightRefresh: { key: string; promise: Promise<void> } | null = null;
  const entryRowsById = new Map<string, HTMLElement>();
  let selectedEntryRow: HTMLElement | null = null;
  let refreshResultState: RefreshResult = { type: "none" };

  function syncRefreshButtonLabel(): void {
    refreshLabel.textContent = text().history.refresh;
    refreshBtn.title = text().history.refreshTitle;
    refreshBtn.setAttribute("aria-label", text().history.refreshTitle);
  }

  function setRefreshBusy(isBusy: boolean): void {
    refreshBtn.disabled = isBusy;
    refreshBtn.classList.toggle("spinning", isBusy);
    refreshBtn.setAttribute("aria-busy", isBusy ? "true" : "false");
  }

  function refreshResultText(): string {
    switch (refreshResultState.type) {
      case "none":
        return "";
      case "added":
        return text().history.refreshResultAdded(refreshResultState.count);
      case "unchanged":
        return text().history.refreshResultUnchanged;
      default: {
        const exhaustive: never = refreshResultState;
        return exhaustive;
      }
    }
  }

  function syncRefreshResult(): void {
    const message = refreshResultText();
    refreshResult.textContent = message;
    refreshResult.hidden = message.length === 0;
    refreshResult.classList.toggle(
      "changed",
      refreshResultState.type === "added",
    );
  }

  function clearRefreshResult(): void {
    refreshResultState = { type: "none" };
    syncRefreshResult();
  }

  function setRefreshResult(
    previousEntries: QueryHistoryEntry[],
    nextEntries: QueryHistoryEntry[],
  ): void {
    const previousIds = new Set(previousEntries.map((entry) => entry.id));
    const added = nextEntries.filter(
      (entry) => !previousIds.has(entry.id),
    ).length;
    refreshResultState =
      added > 0 ? { type: "added", count: added } : { type: "unchanged" };
    syncRefreshResult();
  }

  syncRefreshButtonLabel();
  setRefreshBusy(false);
  syncRefreshResult();

  function currentRefreshParams(): { key: string; params: string } {
    const dbId = callbacks.getDbId();
    const schema = callbacks.getSchema();
    const searchParams = new URLSearchParams();
    if (dbId) searchParams.set("db", dbId);
    if (schema) searchParams.set("schema", schema);
    const params = searchParams.toString() ? `?${searchParams.toString()}` : "";
    return { key: params, params };
  }

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

  async function refresh(
    options: { force?: boolean; announceResult?: boolean } = {},
  ) {
    const { key: refreshKey, params } = currentRefreshParams();
    const now = Date.now();
    if (inFlightRefresh?.key === refreshKey) {
      return inFlightRefresh.promise;
    }
    if (
      !options.force &&
      refreshKey === lastRefreshKey &&
      now - lastRefreshAt < 1_000
    ) {
      return;
    }
    const previousEntries = options.announceResult ? [...entries] : null;
    if (options.announceResult) clearRefreshResult();
    setRefreshBusy(true);
    const promise = (async () => {
      const res = await fetch(`/_db/history${params}`);
      if (!res.ok) return;
      const state = (await res.json()) as QueryHistoryState;
      if (currentRefreshParams().key !== refreshKey) return;
      entries = state.entries;
      if (previousEntries) setRefreshResult(previousEntries, entries);
      lastRefreshKey = refreshKey;
      lastRefreshAt = Date.now();
      if (
        selectedEntryId &&
        !entries.some((entry) => entry.id === selectedEntryId)
      ) {
        clearDetail();
      }
      render();
    })().catch(() => {
      /* ignore */
    });
    inFlightRefresh = { key: refreshKey, promise };
    try {
      await promise;
    } finally {
      if (inFlightRefresh?.promise === promise) {
        inFlightRefresh = null;
        setRefreshBusy(false);
      }
    }
  }

  function render() {
    listEl.innerHTML = "";
    entryRowsById.clear();
    selectedEntryRow = null;
    if (entries.length === 0) {
      const empty = document.createElement("div");
      empty.className = "db-query-history-empty";
      empty.textContent = text().history.empty;
      listEl.appendChild(empty);
      return;
    }
    const fragment = document.createDocumentFragment();
    for (const entry of entries) {
      fragment.appendChild(renderEntry(entry));
    }
    listEl.appendChild(fragment);
  }

  let selectedEntryId: string | null = null;

  function clearDetail() {
    selectedEntryId = null;
    selectedEntryRow?.classList.remove("selected");
    selectedEntryRow = null;
    detailCol.innerHTML = "";
    detailCol.appendChild(detailPlaceholder);
  }

  function selectEntry(entry: QueryHistoryEntry) {
    selectedEntryId = entry.id;
    selectedEntryRow?.classList.remove("selected");
    selectedEntryRow = entryRowsById.get(entry.id) ?? null;
    selectedEntryRow?.classList.add("selected");
    renderDetail(entry);
  }

  function renderDetail(entry: QueryHistoryEntry) {
    detailCol.innerHTML = "";

    const meta = renderEntryMeta(entry, "detail");

    const actions = document.createElement("div");
    actions.className = "db-query-history-detail-actions";

    const useBtn = document.createElement("button");
    useBtn.className = "db-btn db-btn-primary";
    useBtn.type = "button";
    useBtn.textContent = text().history.useInEditor;
    useBtn.addEventListener("click", () => callbacks.copySqlToQuery(entry.sql));

    const copyBtn = document.createElement("button");
    copyBtn.className = "db-btn";
    copyBtn.type = "button";
    copyBtn.textContent = text().history.copySql;
    copyBtn.addEventListener("click", () => {
      navigator.clipboard.writeText(entry.sql).then(
        () => {
          copyBtn.textContent = text().history.copied;
          setTimeout(() => {
            copyBtn.textContent = text().history.copySql;
          }, 1500);
        },
        () => undefined,
      );
    });

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "db-btn db-query-history-danger";
    deleteBtn.type = "button";
    deleteBtn.textContent = text().history.delete;
    deleteBtn.addEventListener("click", () => {
      if (
        !armButtonConfirm(
          deleteBtn,
          text().history.confirmDelete,
          text().history.delete,
        )
      )
        return;
      deleteEntry(entry.id);
    });

    actions.append(useBtn, copyBtn, deleteBtn);

    const sqlBlock = document.createElement("pre");
    sqlBlock.className = "db-query-history-sql";
    sqlBlock.textContent = entry.sql;

    detailCol.append(meta, actions, sqlBlock);

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
      note.textContent = text().history.truncatedRows(
        entry.savedRows,
        entry.rowCount,
      );
      detailCol.appendChild(note);
    }
  }

  function renderEntry(entry: QueryHistoryEntry): HTMLElement {
    const item = document.createElement("div");
    item.className = "db-query-history-entry";
    if (entry.id === selectedEntryId) {
      item.classList.add("selected");
      selectedEntryRow = item;
    }
    item.dataset.id = entry.id;
    entryRowsById.set(entry.id, item);

    const meta = renderEntryMeta(entry, "entry");
    const title = document.createElement("div");
    title.className = "db-query-history-entry-title";
    title.textContent =
      entry.title ||
      (entry.sql.length > 80 ? `${entry.sql.slice(0, 80)}...` : entry.sql);

    item.append(meta, title);

    item.addEventListener("click", () => selectEntry(entry));

    return item;
  }

  function renderEntryMeta(
    entry: QueryHistoryEntry,
    mode: "entry" | "detail",
  ): HTMLElement {
    const meta = document.createElement("div");
    meta.className =
      mode === "detail"
        ? "db-query-history-detail-meta"
        : "db-query-history-entry-meta";

    const byIcon = document.createElement("span");
    byIcon.className = "db-query-history-by";
    const executor =
      entry.executedBy === "ai"
        ? text().history.executorAi
        : text().history.executorUser;
    byIcon.textContent = mode === "detail" ? executor : `[${executor}]`;

    const time = document.createElement("span");
    time.className = "db-query-history-time";
    time.textContent = formatTime(entry.executedAt);
    time.title = entry.executedAt;

    const stats = document.createElement("span");
    stats.className = "db-query-history-stats";
    stats.textContent = `${text().history.rowsLabel(
      entry.rowCount,
      entry.truncated,
    )}, ${text().history.elapsedLabel(entry.elapsedMs)}`;

    meta.append(byIcon, time, stats);
    return meta;
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
      note.textContent = text().history.truncatedRows(
        entry.savedRows,
        entry.rowCount,
      );
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
      const itemEl = entryRowsById.get(id);
      if (itemEl) {
        entryRowsById.delete(id);
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
      clearBtn.textContent = text().history.confirmClear;
      if (clearConfirmTimer) clearTimeout(clearConfirmTimer);
      clearConfirmTimer = setTimeout(() => {
        clearBtn.dataset.confirm = "";
        clearBtn.textContent = text().history.clearAll;
        clearConfirmTimer = null;
      }, 3000);
      return;
    }
    clearBtn.dataset.confirm = "";
    clearBtn.textContent = text().history.clearAll;
    if (clearConfirmTimer) {
      clearTimeout(clearConfirmTimer);
      clearConfirmTimer = null;
    }
    try {
      const schema = callbacks.getSchema();
      await fetch("/_db/history/clear", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Code-Viewer-Action": "1",
        },
        body: JSON.stringify(
          dbId ? { db: dbId, ...(schema ? { schema } : {}) } : {},
        ),
      });
      entries = [];
      clearRefreshResult();
      render();
    } catch {
      /* ignore */
    }
  });

  refreshBtn.addEventListener("click", () => {
    refresh({ force: true, announceResult: true });
  });

  function clear(): void {
    entries = [];
    expandedIds.clear();
    lastRefreshKey = null;
    lastRefreshAt = 0;
    clearRefreshResult();
    if (clearConfirmTimer) {
      clearTimeout(clearConfirmTimer);
      clearConfirmTimer = null;
    }
    clearBtn.dataset.confirm = "";
    clearBtn.textContent = text().history.clearAll;
    clearDetail();
    render();
  }

  function localize(): void {
    syncRefreshButtonLabel();
    syncRefreshResult();
    if (clearBtn.dataset.confirm !== "1") {
      clearBtn.textContent = text().history.clearAll;
    }
    clearBtn.title = text().history.clearTitle;
    detailPlaceholder.textContent = text().history.selectPlaceholder;
    // render() は listEl を作り直すためスクロール位置が飛ぶ。退避して復元する。
    const prevScrollTop = listEl.scrollTop;
    render();
    listEl.scrollTop = prevScrollTop;
    const selected = selectedEntryId
      ? entries.find((e) => e.id === selectedEntryId)
      : null;
    if (selected) {
      // 詳細の削除ボタンが confirm 待ち(arm 済み)だった状態を再構築後も保つ。
      const prevDeleteArmed =
        detailCol.querySelector<HTMLButtonElement>(".db-query-history-danger")
          ?.dataset.confirm === "1";
      renderDetail(selected);
      if (prevDeleteArmed) {
        const deleteBtn = detailCol.querySelector<HTMLButtonElement>(
          ".db-query-history-danger",
        );
        if (deleteBtn) {
          deleteBtn.dataset.confirm = "1";
          deleteBtn.textContent = text().history.confirmDelete;
        }
      }
    }
  }

  return { el, refresh, clear, localize };
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
