import type {
  DbColumn,
  DbOrderDirection,
  DbTableDataResponse,
  DbValue,
} from "../../core/database/types";
import { isImeComposing } from "../../core/keyboard";
import type { AnnotationDatabaseDataState } from "../../core/types";

const ROW_HEIGHT = 28;
const OVERSCAN = 20;
const PAGE_SIZE = 200;
const FILTER_DEBOUNCE_MS = 300;
const DEFAULT_COL_WIDTH = 180;
const CELL_PREVIEW_MAX_CHARS = 4000;

export type GridSort = {
  column: string;
  direction: DbOrderDirection;
};

export type GridFilter = {
  column: string;
  value: string;
};

export type TableGridCallbacks = {
  fetchPage: (
    table: string,
    offset: number,
    limit: number,
    sort: GridSort | null,
    filters: GridFilter[],
    signal?: AbortSignal,
  ) => Promise<DbTableDataResponse>;
  getDbId: () => string | null;
  getColumnWidths: (dbId: string, table: string) => Record<string, number>;
  setColumnWidths: (
    dbId: string,
    table: string,
    widths: Record<string, number>,
  ) => void;
};

export type TableGrid = {
  el: HTMLElement;
  load: (table: string, initialData?: DbTableDataResponse) => void;
  showError: (message: string) => void;
  applyState: (state: AnnotationDatabaseDataState) => Promise<void>;
  getState: () => AnnotationDatabaseDataState;
  clear: () => void;
  destroy: () => void;
};

export function createTableGrid(callbacks: TableGridCallbacks): TableGrid {
  const el = document.createElement("div");
  el.className = "db-grid";

  const filterBar = document.createElement("div");
  filterBar.className = "db-grid-filter-bar";
  const filterIcon = document.createElement("span");
  filterIcon.className = "db-grid-filter-icon";
  filterIcon.textContent = "🔍";
  const filterInput = document.createElement("input");
  filterInput.type = "search";
  filterInput.className = "db-grid-filter-input";
  filterInput.placeholder = "Search all columns…";
  filterInput.autocomplete = "off";
  const filterClear = document.createElement("button");
  filterClear.type = "button";
  filterClear.className = "db-btn db-btn-icon db-grid-filter-clear";
  filterClear.textContent = "×";
  filterClear.hidden = true;
  filterBar.append(filterIcon, filterInput, filterClear);

  const headerWrap = document.createElement("div");
  headerWrap.className = "db-grid-header-wrap";

  const headerRow = document.createElement("div");
  headerRow.className = "db-grid-header";
  headerWrap.appendChild(headerRow);

  const filterRowWrap = document.createElement("div");
  filterRowWrap.className = "db-grid-filter-row-wrap";
  const filterRow = document.createElement("div");
  filterRow.className = "db-grid-filter-row";
  filterRowWrap.appendChild(filterRow);

  const viewport = document.createElement("div");
  viewport.className = "db-grid-viewport";

  const spacer = document.createElement("div");
  spacer.className = "db-grid-spacer";

  const body = document.createElement("div");
  body.className = "db-grid-body";

  const detailPanel = document.createElement("div");
  detailPanel.className = "db-grid-detail-panel";
  detailPanel.hidden = true;

  viewport.append(spacer, body);
  el.append(filterBar, headerWrap, filterRowWrap, viewport, detailPanel);

  let currentTable = "";
  let columns: DbColumn[] = [];
  let columnNames: string[] = [];
  let totalRows = 0;
  const columnFilters = new Map<string, string>();
  let globalSearchValue = "";
  let sort: GridSort | null = null;
  let pageCache = new Map<number, DbValue[][]>();
  let pendingPages = new Map<number, Promise<void>>();
  let loadGeneration = 0;
  let loadController = new AbortController();
  let rafId = 0;
  let statusEl: HTMLElement | null = null;
  let filterTimer: ReturnType<typeof setTimeout> | null = null;
  let selectedRowIndex = -1;

  /* ---- Column width management ---- */
  const colWidths = new Map<string, number>();
  let activeResize: {
    onMouseMove: (e: MouseEvent) => void;
    onMouseUp: () => void;
  } | null = null;

  function saveColWidths() {
    const dbId = callbacks.getDbId();
    if (!dbId || !currentTable) return;
    const obj: Record<string, number> = {};
    for (const [name, w] of colWidths) {
      obj[name] = w;
    }
    callbacks.setColumnWidths(dbId, currentTable, obj);
  }

  function loadColWidths() {
    colWidths.clear();
    const dbId = callbacks.getDbId();
    if (!dbId || !currentTable) return;
    const obj = callbacks.getColumnWidths(dbId, currentTable);
    for (const [name, w] of Object.entries(obj)) {
      if (typeof w === "number" && w > 0) {
        colWidths.set(name, w);
      }
    }
  }

  function getColWidth(colName: string): number {
    return colWidths.get(colName) ?? DEFAULT_COL_WIDTH;
  }

  function applyColWidth(colName: string, index: number) {
    const w = getColWidth(colName);
    // Apply to header cell
    const headerCells = headerRow.querySelectorAll<HTMLElement>(
      ".db-grid-header-cell",
    );
    if (headerCells[index]) {
      headerCells[index].style.width = `${w}px`;
    }
    // Apply to filter cell
    const filterCells = filterRow.querySelectorAll<HTMLElement>(
      ".db-grid-filter-cell",
    );
    if (filterCells[index]) {
      filterCells[index].style.width = `${w}px`;
    }
  }

  function autoFitColumn(colName: string, colIndex: number) {
    const measure = document.createElement("span");
    measure.style.cssText =
      "position:absolute;visibility:hidden;white-space:nowrap;font:inherit;padding:0 8px;";
    document.body.appendChild(measure);
    const headerLabel = columns[colIndex]?.name || colName;
    measure.textContent = `${headerLabel}  ▲`;
    let maxW = measure.offsetWidth + 16;
    const rows = body.querySelectorAll<HTMLElement>(".db-grid-row");
    for (const row of rows) {
      const cells = row.querySelectorAll<HTMLElement>(
        ".db-grid-cell:not(.db-grid-rownum)",
      );
      const cell = cells[colIndex];
      if (cell) {
        measure.textContent = cell.textContent || "";
        maxW = Math.max(maxW, measure.offsetWidth);
      }
    }
    document.body.removeChild(measure);
    const fitted = Math.max(60, Math.min(600, maxW));
    colWidths.set(colName, fitted);
    applyColWidth(colName, colIndex);
    saveColWidths();
    syncContentWidth();
    renderViewport();
  }

  function collectFilters(): GridFilter[] {
    const filters: GridFilter[] = [];
    for (const [col, val] of columnFilters) {
      if (val) filters.push({ column: col, value: val });
    }
    if (globalSearchValue && filters.length === 0) {
      for (const col of columnNames) {
        filters.push({ column: col, value: globalSearchValue });
      }
    }
    return filters;
  }

  function resetSelectionAndDetail() {
    selectedRowIndex = -1;
    detailPanel.hidden = true;
    detailPanel.innerHTML = "";
  }

  function startNewLoadGeneration() {
    loadController.abort("db-grid:generation");
    loadController = new AbortController();
    loadGeneration++;
  }

  function isAbortError(err: unknown): boolean {
    return (
      (err instanceof DOMException && err.name === "AbortError") ||
      (err instanceof Error && err.name === "AbortError")
    );
  }

  function invalidateData(): Promise<void> {
    pageCache = new Map();
    pendingPages = new Map();
    startNewLoadGeneration();
    viewport.scrollTop = 0;
    resetSelectionAndDetail();
    return ensurePage(0);
  }

  function clear() {
    cleanupResize();
    currentTable = "";
    columns = [];
    columnNames = [];
    totalRows = 0;
    sort = null;
    columnFilters.clear();
    globalSearchValue = "";
    filterInput.value = "";
    filterClear.hidden = true;
    filterRow.innerHTML = "";
    pageCache = new Map();
    pendingPages = new Map();
    startNewLoadGeneration();
    cancelAnimationFrame(rafId);
    if (filterTimer) clearTimeout(filterTimer);
    headerRow.innerHTML = "";
    body.innerHTML = "";
    spacer.style.height = "0px";
    statusEl?.remove();
    statusEl = null;
    detailPanel.hidden = true;
    detailPanel.innerHTML = "";
    colWidths.clear();
  }

  function showCellDetail(colIndex: number, value: DbValue) {
    const colName = columnNames[colIndex];
    const colType = columns[colIndex]?.type || "";

    detailPanel.hidden = false;
    detailPanel.innerHTML = "";

    const header = document.createElement("div");
    header.className = "db-grid-detail-header";

    const title = document.createElement("span");
    title.className = "db-grid-detail-title";
    title.textContent = `${colName} (${colType})`;

    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "db-btn db-grid-detail-copy";
    copyBtn.textContent = "Copy";
    const copyText = formatValueForCopy(value);
    copyBtn.addEventListener("click", () => {
      navigator.clipboard.writeText(copyText).then(
        () => {
          const original = copyBtn.textContent;
          copyBtn.textContent = "Copied";
          setTimeout(() => {
            copyBtn.textContent = original;
          }, 800);
        },
        () => {
          copyBtn.textContent = "Copy failed";
        },
      );
    });

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "db-btn db-btn-icon db-grid-detail-close";
    closeBtn.textContent = "×";
    closeBtn.addEventListener("click", () => {
      detailPanel.hidden = true;
    });

    header.append(title, copyBtn, closeBtn);

    const content = document.createElement("div");
    content.className = "db-grid-detail-content";

    if (value === null) {
      content.textContent = "NULL";
      content.classList.add("null");
    } else if (value instanceof Uint8Array) {
      content.textContent = `BLOB (${value.byteLength} bytes)`;
      content.classList.add("blob");
    } else {
      const str =
        typeof value === "object" ? JSON.stringify(value) : String(value);
      if (str.length > 0 && (str[0] === "{" || str[0] === "[")) {
        try {
          const parsed = JSON.parse(str);
          const pre = document.createElement("pre");
          pre.className = "db-grid-detail-json";
          pre.textContent = JSON.stringify(parsed, null, 2);
          content.appendChild(pre);
        } catch {
          content.textContent = str;
        }
      } else {
        content.textContent = str;
      }
    }

    detailPanel.append(header, content);
  }

  function renderHeader() {
    headerRow.innerHTML = "";
    const rowNum = document.createElement("div");
    rowNum.className = "db-grid-cell db-grid-rownum-header";
    rowNum.textContent = "#";
    headerRow.appendChild(rowNum);
    for (let i = 0; i < columns.length; i++) {
      const col = columns[i];
      const cell = document.createElement("div");
      cell.className = "db-grid-cell db-grid-header-cell";
      cell.style.width = `${getColWidth(col.name)}px`;
      if (sort?.column === col.name) {
        cell.classList.add("sorted");
        cell.dataset.dir = sort.direction;
      }

      const label = document.createElement("span");
      label.className = "db-grid-header-label";
      label.textContent = col.name;

      const sortIcon = document.createElement("span");
      sortIcon.className = "db-grid-sort-icon";
      sortIcon.textContent =
        sort?.column === col.name ? (sort.direction === "asc" ? "▲" : "▼") : "";

      /* ---- Resize handle ---- */
      const resizeHandle = document.createElement("div");
      resizeHandle.className = "db-grid-resize-handle";
      const colIndex = i;
      resizeHandle.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        startResize(colIndex, e);
      });

      cell.append(label, sortIcon, resizeHandle);
      cell.addEventListener("click", (e) => {
        // Don't sort when clicking on resize handle
        if (
          (e.target as HTMLElement).classList.contains("db-grid-resize-handle")
        )
          return;
        handleSort(col.name);
      });
      cell.addEventListener("dblclick", (e) => {
        if (
          (e.target as HTMLElement).classList.contains("db-grid-resize-handle")
        ) {
          e.preventDefault();
          e.stopPropagation();
          autoFitColumn(col.name, colIndex);
        }
      });
      headerRow.appendChild(cell);
    }
    renderFilterRow();
    syncContentWidth();
  }

  function startResize(colIndex: number, startEvent: MouseEvent) {
    cleanupResize();
    const colName = columnNames[colIndex];
    const startX = startEvent.clientX;
    const startWidth = getColWidth(colName);
    document.body.classList.add("db-resizing");

    const onMouseMove = (e: MouseEvent) => {
      const delta = e.clientX - startX;
      const newWidth = Math.max(60, startWidth + delta);
      colWidths.set(colName, newWidth);
      applyColWidth(colName, colIndex);
      syncContentWidth();
      // Update data cells in viewport
      renderViewport();
    };

    const onMouseUp = () => {
      cleanupResize();
      saveColWidths();
    };

    activeResize = { onMouseMove, onMouseUp };
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }

  function cleanupResize(): void {
    if (!activeResize) return;
    document.body.classList.remove("db-resizing");
    document.removeEventListener("mousemove", activeResize.onMouseMove);
    document.removeEventListener("mouseup", activeResize.onMouseUp);
    activeResize = null;
  }

  function renderFilterRow() {
    filterRow.innerHTML = "";
    const rowNumSpacer = document.createElement("div");
    rowNumSpacer.className =
      "db-grid-cell db-grid-rownum-header db-grid-filter-spacer";
    filterRow.appendChild(rowNumSpacer);
    for (let i = 0; i < columns.length; i++) {
      const col = columns[i];
      const cell = document.createElement("div");
      cell.className = "db-grid-cell db-grid-filter-cell";
      cell.style.width = `${getColWidth(col.name)}px`;
      const input = document.createElement("input");
      input.type = "search";
      input.className = "db-grid-col-filter";
      input.placeholder = `${col.name}…`;
      input.autocomplete = "off";
      input.value = columnFilters.get(col.name) || "";
      input.addEventListener("input", () => {
        const val = input.value.trim();
        if (val) {
          columnFilters.set(col.name, val);
        } else {
          columnFilters.delete(col.name);
        }
        scheduleFilter();
      });
      input.addEventListener("keydown", (e) => {
        if (isImeComposing(e)) return;
        if (e.key === "Escape") {
          input.value = "";
          columnFilters.delete(col.name);
          scheduleFilter();
        }
      });
      cell.appendChild(input);
      filterRow.appendChild(cell);
    }
  }

  function scheduleFilter() {
    if (filterTimer) clearTimeout(filterTimer);
    filterTimer = setTimeout(() => {
      invalidateData();
    }, FILTER_DEBOUNCE_MS);
  }

  function syncContentWidth() {
    requestAnimationFrame(() => {
      const w = headerRow.scrollWidth;
      if (w > 0) {
        spacer.style.minWidth = `${w}px`;
        body.style.minWidth = `${w}px`;
        filterRow.style.minWidth = `${w}px`;
      }
    });
  }

  function handleSort(column: string) {
    if (sort?.column === column) {
      sort = sort.direction === "asc" ? { column, direction: "desc" } : null;
    } else {
      sort = { column, direction: "asc" };
    }
    pageCache = new Map();
    pendingPages = new Map();
    startNewLoadGeneration();
    resetSelectionAndDetail();
    renderHeader();
    renderViewport();
  }

  function ensurePage(pageStart: number): Promise<void> {
    if (pageCache.has(pageStart)) return Promise.resolve();
    const pending = pendingPages.get(pageStart);
    if (pending) return pending;
    const gen = loadGeneration;
    const signal = loadController.signal;
    const filters = collectFilters();
    const promise = callbacks
      .fetchPage(currentTable, pageStart, PAGE_SIZE, sort, filters, signal)
      .then((data) => {
        if (gen !== loadGeneration) return;
        pageCache.set(pageStart, data.rows);
        totalRows = data.totalRows;
        spacer.style.height = `${totalRows * ROW_HEIGHT}px`;
        updateStatus();
        renderViewport();
      })
      .catch((err) => {
        if (gen !== loadGeneration || isAbortError(err)) return;
        if (gen === loadGeneration) {
          showError(err instanceof Error ? err.message : String(err));
        }
      });
    const tracked = promise.finally(() => {
      if (pendingPages.get(pageStart) === tracked) {
        pendingPages.delete(pageStart);
      }
    });
    pendingPages.set(pageStart, tracked);
    return tracked;
  }

  function renderViewport() {
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => {
      const scrollTop = viewport.scrollTop;
      const viewHeight = viewport.clientHeight;
      const startRow = Math.max(
        0,
        Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN,
      );
      const endRow = Math.min(
        totalRows,
        Math.ceil((scrollTop + viewHeight) / ROW_HEIGHT) + OVERSCAN,
      );

      const neededPageStart = Math.floor(startRow / PAGE_SIZE) * PAGE_SIZE;
      const neededPageEnd = Math.floor(endRow / PAGE_SIZE) * PAGE_SIZE;
      for (let p = neededPageStart; p <= neededPageEnd; p += PAGE_SIZE) {
        ensurePage(p);
      }

      body.innerHTML = "";
      body.style.transform = `translateY(${startRow * ROW_HEIGHT}px)`;

      for (let i = startRow; i < endRow; i++) {
        const pageStart = Math.floor(i / PAGE_SIZE) * PAGE_SIZE;
        const pageRows = pageCache.get(pageStart);
        const rowData = pageRows ? pageRows[i - pageStart] : null;

        const row = document.createElement("div");
        row.className = "db-grid-row";
        if (i % 2 === 1) row.classList.add("alt");
        if (i === selectedRowIndex) row.classList.add("selected");
        const rowIndex = i;
        row.addEventListener("click", () => {
          selectedRowIndex = rowIndex;
          body.querySelectorAll(".db-grid-row.selected").forEach((r) => {
            r.classList.remove("selected");
          });
          row.classList.add("selected");
        });

        const rowNum = document.createElement("div");
        rowNum.className = "db-grid-cell db-grid-rownum";
        rowNum.textContent = String(i + 1);
        row.appendChild(rowNum);

        if (rowData) {
          for (let c = 0; c < columnNames.length; c++) {
            const cell = document.createElement("div");
            cell.className = "db-grid-cell";
            cell.style.width = `${getColWidth(columnNames[c])}px`;
            const val = rowData[c];
            cell.textContent = formatValue(val);
            if (val === null) cell.classList.add("null");
            else if (val instanceof Uint8Array) cell.classList.add("blob");
            else if (typeof val === "string" && val === "")
              cell.classList.add("empty");
            cell.style.cursor = "pointer";
            const cellValue = val;
            const cellColIndex = c;
            cell.addEventListener("click", (e) => {
              e.stopPropagation();
              selectedRowIndex = rowIndex;
              body.querySelectorAll(".db-grid-row.selected").forEach((r) => {
                r.classList.remove("selected");
              });
              row.classList.add("selected");
              showCellDetail(cellColIndex, cellValue);
            });
            row.appendChild(cell);
          }
        } else {
          for (let c = 0; c < columnNames.length; c++) {
            const cell = document.createElement("div");
            cell.className = "db-grid-cell loading";
            cell.style.width = `${getColWidth(columnNames[c])}px`;
            cell.textContent = "…";
            row.appendChild(cell);
          }
        }
        body.appendChild(row);
      }
    });
  }

  function triggerExport(format: "csv" | "json") {
    const dbId = callbacks.getDbId();
    if (!dbId || !currentTable) return;
    const params = new URLSearchParams({
      db: dbId,
      table: currentTable,
      format,
    });
    if (sort) {
      params.set("sort", sort.column);
      params.set("dir", sort.direction);
    }
    const filters = collectFilters();
    if (filters.length > 0) {
      params.set("filters", JSON.stringify(filters));
    }
    const a = document.createElement("a");
    a.href = `/_db/export?${params}`;
    a.download = `${currentTable}.${format}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  let exportCsvBtn: HTMLButtonElement | null = null;
  let exportJsonBtn: HTMLButtonElement | null = null;

  function updateStatus() {
    if (!statusEl) {
      statusEl = document.createElement("div");
      statusEl.className = "db-grid-status";

      exportCsvBtn = document.createElement("button");
      exportCsvBtn.type = "button";
      exportCsvBtn.className = "db-btn db-btn-sm db-grid-export-btn";
      exportCsvBtn.textContent = "Export CSV";
      exportCsvBtn.addEventListener("click", () => triggerExport("csv"));

      exportJsonBtn = document.createElement("button");
      exportJsonBtn.type = "button";
      exportJsonBtn.className = "db-btn db-btn-sm db-grid-export-btn";
      exportJsonBtn.textContent = "Export JSON";
      exportJsonBtn.addEventListener("click", () => triggerExport("json"));

      statusEl.append(exportCsvBtn, exportJsonBtn);
      el.appendChild(statusEl);
    }
    const parts: string[] = [`${totalRows.toLocaleString()} rows`];
    if (sort)
      parts.push(`Sort: ${sort.column} ${sort.direction.toUpperCase()}`);
    const activeFilterCount = columnFilters.size + (globalSearchValue ? 1 : 0);
    if (activeFilterCount > 0) parts.push(`${activeFilterCount} filter(s)`);
    const textNode = statusEl.firstChild;
    if (textNode && textNode.nodeType === Node.TEXT_NODE) {
      textNode.textContent = `${parts.join(" | ")} `;
    } else {
      statusEl.insertBefore(
        document.createTextNode(`${parts.join(" | ")} `),
        statusEl.firstChild,
      );
    }
  }

  function showError(message: string) {
    clear();
    statusEl = document.createElement("div");
    statusEl.className = "db-grid-status db-pane-error";
    statusEl.textContent = message;
    el.appendChild(statusEl);
  }

  function load(table: string, initialData?: DbTableDataResponse) {
    clear();
    currentTable = table;
    if (initialData) {
      columns = initialData.columns;
      columnNames = columns.map((c) => c.name);
      totalRows = initialData.totalRows;
      pageCache.set(0, initialData.rows);
    } else {
      columns = [];
      columnNames = [];
      totalRows = 0;
    }
    loadColWidths();
    spacer.style.height = `${totalRows * ROW_HEIGHT}px`;
    renderHeader();
    updateStatus();
    if (!initialData) {
      ensurePage(0);
    } else {
      renderViewport();
    }
  }

  async function applyState(state: AnnotationDatabaseDataState) {
    if (state.search !== undefined) {
      globalSearchValue = state.search;
      filterInput.value = state.search;
      filterClear.hidden = !globalSearchValue;
    }
    columnFilters.clear();
    for (const filter of state.filters || []) {
      if (filter.column && filter.value)
        columnFilters.set(filter.column, filter.value);
    }
    sort = state.sort || null;
    const targetRowIndex = state.row && state.row > 0 ? state.row - 1 : -1;
    renderHeader();
    const firstPage = invalidateData();
    if (targetRowIndex >= 0) {
      await firstPage;
      selectedRowIndex = targetRowIndex;
      viewport.scrollTop = Math.max(0, targetRowIndex * ROW_HEIGHT);
      renderViewport();
    }
  }

  function getState(): AnnotationDatabaseDataState {
    const filters = collectFilters().filter(
      (filter) => filter.value !== globalSearchValue,
    );
    return {
      ...(globalSearchValue ? { search: globalSearchValue } : {}),
      ...(filters.length ? { filters } : {}),
      ...(sort ? { sort } : {}),
      ...(selectedRowIndex >= 0 ? { row: selectedRowIndex + 1 } : {}),
    };
  }

  filterInput.addEventListener("input", () => {
    globalSearchValue = filterInput.value.trim();
    filterClear.hidden = !globalSearchValue;
    scheduleFilter();
  });
  filterInput.addEventListener("keydown", (e) => {
    if (isImeComposing(e)) return;
    if (e.key === "Escape") {
      filterInput.value = "";
      globalSearchValue = "";
      filterClear.hidden = true;
      scheduleFilter();
    }
  });
  filterClear.addEventListener("click", () => {
    filterInput.value = "";
    globalSearchValue = "";
    filterClear.hidden = true;
    invalidateData();
  });

  const onViewportScroll = () => {
    headerWrap.scrollLeft = viewport.scrollLeft;
    filterRowWrap.scrollLeft = viewport.scrollLeft;
    renderViewport();
  };
  viewport.addEventListener("scroll", onViewportScroll, { passive: true });

  function destroy() {
    clear();
    viewport.removeEventListener("scroll", onViewportScroll);
  }

  return { el, load, showError, applyState, getState, clear, destroy };
}

function formatValue(value: DbValue): string {
  if (value === null) return "NULL";
  if (value instanceof Uint8Array) return `<blob ${value.byteLength} bytes>`;
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "object") return JSON.stringify(value);
  const s = String(value);
  if (s === "") return "<empty>";
  if (s.length > CELL_PREVIEW_MAX_CHARS) {
    const truncated = s.slice(0, CELL_PREVIEW_MAX_CHARS);
    return `${truncated} … (+${s.length - CELL_PREVIEW_MAX_CHARS} chars)`;
  }
  return s;
}

// ai-dup-check: allow -- clipboard value formatting intentionally matches DB result formatting.
function formatValueForCopy(value: DbValue): string {
  if (value === null) return "";
  if (value instanceof Uint8Array) return `<blob ${value.byteLength} bytes>`;
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
