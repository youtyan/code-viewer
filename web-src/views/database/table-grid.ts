import type {
  DbColumn,
  DbOrderDirection,
  DbTableDataResponse,
  DbValue,
} from "../../core/database/types";

const ROW_HEIGHT = 28;
const OVERSCAN = 20;
const PAGE_SIZE = 200;

export type GridSort = {
  column: string;
  direction: DbOrderDirection;
};

export type TableGridCallbacks = {
  fetchPage: (
    table: string,
    offset: number,
    limit: number,
    sort: GridSort | null,
  ) => Promise<DbTableDataResponse>;
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

  const headerWrap = document.createElement("div");
  headerWrap.className = "db-grid-header-wrap";

  const headerRow = document.createElement("div");
  headerRow.className = "db-grid-header";
  headerWrap.appendChild(headerRow);

  const viewport = document.createElement("div");
  viewport.className = "db-grid-viewport";

  const spacer = document.createElement("div");
  spacer.className = "db-grid-spacer";

  const body = document.createElement("div");
  body.className = "db-grid-body";

  viewport.append(spacer, body);
  el.append(headerWrap, viewport);

  let currentTable = "";
  let columns: DbColumn[] = [];
  let columnNames: string[] = [];
  let totalRows = 0;
  let sort: GridSort | null = null;
  let pageCache = new Map<number, DbValue[][]>();
  let pendingPages = new Set<number>();
  let loadGeneration = 0;
  let rafId = 0;
  let statusEl: HTMLElement | null = null;

  function clear() {
    currentTable = "";
    columns = [];
    columnNames = [];
    totalRows = 0;
    sort = null;
    pageCache = new Map();
    pendingPages = new Set();
    loadGeneration++;
    cancelAnimationFrame(rafId);
    headerRow.innerHTML = "";
    body.innerHTML = "";
    spacer.style.height = "0px";
    statusEl?.remove();
    statusEl = null;
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
    syncContentWidth();
  }

  function syncContentWidth() {
    requestAnimationFrame(() => {
      const w = headerRow.scrollWidth;
      if (w > 0) {
        spacer.style.minWidth = `${w}px`;
        body.style.minWidth = `${w}px`;
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
    callbacks
      .fetchPage(currentTable, pageStart, PAGE_SIZE, sort)
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

  function updateStatus() {
    if (!statusEl) {
      statusEl = document.createElement("div");
      statusEl.className = "db-grid-status";
      el.appendChild(statusEl);
    }
    const sortLabel = sort
      ? ` | Sort: ${sort.column} ${sort.direction.toUpperCase()}`
      : "";
    statusEl.textContent = `${totalRows.toLocaleString()} rows${sortLabel}`;
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

  viewport.addEventListener(
    "scroll",
    () => {
      headerWrap.scrollLeft = viewport.scrollLeft;
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
