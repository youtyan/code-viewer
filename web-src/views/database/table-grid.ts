import type {
  DbColumn,
  DbOrderDirection,
  DbTableDataResponse,
  DbValue,
} from "../../core/database/types";

const ROW_HEIGHT = 28;
const OVERSCAN = 20;
const PAGE_SIZE = 200;
const FILTER_DEBOUNCE_MS = 300;

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
  ) => Promise<DbTableDataResponse>;
  getDbId: () => string | null;
};

export type TableGrid = {
  el: HTMLElement;
  load: (table: string, initialData?: DbTableDataResponse) => void;
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
  filterClear.className = "db-grid-filter-clear";
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
  let pendingPages = new Set<number>();
  let loadGeneration = 0;
  let rafId = 0;
  let statusEl: HTMLElement | null = null;
  let filterTimer: ReturnType<typeof setTimeout> | null = null;

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

  function invalidateData() {
    pageCache = new Map();
    pendingPages = new Set();
    loadGeneration++;
    viewport.scrollTop = 0;
    ensurePage(0);
  }

  function clear() {
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
    pendingPages = new Set();
    loadGeneration++;
    cancelAnimationFrame(rafId);
    if (filterTimer) clearTimeout(filterTimer);
    headerRow.innerHTML = "";
    body.innerHTML = "";
    spacer.style.height = "0px";
    statusEl?.remove();
    statusEl = null;
    detailPanel.hidden = true;
    detailPanel.innerHTML = "";
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

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "db-grid-detail-close";
    closeBtn.textContent = "×";
    closeBtn.addEventListener("click", () => {
      detailPanel.hidden = true;
    });

    header.append(title, closeBtn);

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
    for (const col of columns) {
      const cell = document.createElement("div");
      cell.className = "db-grid-cell db-grid-header-cell";
      if (sort?.column === col.name) {
        cell.classList.add("sorted");
        cell.dataset.dir = sort.direction;
      }

      const label = document.createElement("span");
      label.className = "db-grid-header-label";
      label.textContent = col.name;

      const typeTag = document.createElement("span");
      typeTag.className = "db-grid-header-type";
      typeTag.textContent = col.type;
      if (col.primaryKey) typeTag.classList.add("pk");

      const sortIcon = document.createElement("span");
      sortIcon.className = "db-grid-sort-icon";
      sortIcon.textContent =
        sort?.column === col.name ? (sort.direction === "asc" ? "▲" : "▼") : "";

      cell.append(label, typeTag, sortIcon);
      cell.addEventListener("click", () => handleSort(col.name));
      headerRow.appendChild(cell);
    }
    renderFilterRow();
    syncContentWidth();
  }

  function renderFilterRow() {
    filterRow.innerHTML = "";
    const rowNumSpacer = document.createElement("div");
    rowNumSpacer.className =
      "db-grid-cell db-grid-rownum-header db-grid-filter-spacer";
    filterRow.appendChild(rowNumSpacer);
    for (const col of columns) {
      const cell = document.createElement("div");
      cell.className = "db-grid-cell db-grid-filter-cell";
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
    pendingPages = new Set();
    renderHeader();
    renderViewport();
  }

  function ensurePage(pageStart: number) {
    if (pageCache.has(pageStart) || pendingPages.has(pageStart)) return;
    pendingPages.add(pageStart);
    const gen = loadGeneration;
    const filters = collectFilters();
    callbacks
      .fetchPage(currentTable, pageStart, PAGE_SIZE, sort, filters)
      .then((data) => {
        if (gen !== loadGeneration) return;
        pendingPages.delete(pageStart);
        pageCache.set(pageStart, data.rows);
        totalRows = data.totalRows;
        spacer.style.height = `${totalRows * ROW_HEIGHT}px`;
        updateStatus();
        renderViewport();
      })
      .catch(() => {
        if (gen === loadGeneration) pendingPages.delete(pageStart);
      });
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

        const rowNum = document.createElement("div");
        rowNum.className = "db-grid-cell db-grid-rownum";
        rowNum.textContent = String(i + 1);
        row.appendChild(rowNum);

        if (rowData) {
          for (let c = 0; c < columnNames.length; c++) {
            const cell = document.createElement("div");
            cell.className = "db-grid-cell";
            cell.textContent = formatValue(rowData[c]);
            if (rowData[c] === null) cell.classList.add("null");
            if (rowData[c] instanceof Uint8Array) cell.classList.add("blob");
            cell.style.cursor = "pointer";
            const cellValue = rowData[c];
            const cellColIndex = c;
            cell.addEventListener("click", () =>
              showCellDetail(cellColIndex, cellValue),
            );
            row.appendChild(cell);
          }
        } else {
          for (let c = 0; c < columnNames.length; c++) {
            const cell = document.createElement("div");
            cell.className = "db-grid-cell loading";
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
      exportCsvBtn.className = "db-grid-export-btn";
      exportCsvBtn.textContent = "Export CSV";
      exportCsvBtn.addEventListener("click", () => triggerExport("csv"));

      exportJsonBtn = document.createElement("button");
      exportJsonBtn.type = "button";
      exportJsonBtn.className = "db-grid-export-btn";
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
    spacer.style.height = `${totalRows * ROW_HEIGHT}px`;
    renderHeader();
    updateStatus();
    if (!initialData) {
      ensurePage(0);
    } else {
      renderViewport();
    }
  }

  filterInput.addEventListener("input", () => {
    globalSearchValue = filterInput.value.trim();
    filterClear.hidden = !globalSearchValue;
    scheduleFilter();
  });
  filterInput.addEventListener("keydown", (e) => {
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

  viewport.addEventListener(
    "scroll",
    () => {
      headerWrap.scrollLeft = viewport.scrollLeft;
      filterRowWrap.scrollLeft = viewport.scrollLeft;
      renderViewport();
    },
    { passive: true },
  );

  function destroy() {
    clear();
    viewport.removeEventListener("scroll", renderViewport);
  }

  return { el, load, clear, destroy };
}

function formatValue(value: DbValue): string {
  if (value === null) return "NULL";
  if (value instanceof Uint8Array) return `<blob ${value.byteLength} bytes>`;
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
