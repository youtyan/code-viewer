import type {
  DbColumn,
  DbForeignKey,
  DbOrderDirection,
  DbTableDataResponse,
  DbValue,
} from "../../core/database/types";
import { isImeComposing } from "../../core/keyboard";
import type { AnnotationDatabaseDataState } from "../../core/types";
import { type DbText, dbText } from "./i18n";

const ROW_HEIGHT = 28;
const OVERSCAN = 20;
const PAGE_SIZE = 200;
const FILTER_DEBOUNCE_MS = 300;
const DEFAULT_COL_WIDTH = 180;
const CELL_PREVIEW_MAX_CHARS = 4000;
const RELATED_PANEL_DEFAULT_HEIGHT = 320;
const RELATED_PANEL_MIN_HEIGHT = 60;
const DETAIL_PANEL_DEFAULT_HEIGHT = 200;
const DETAIL_PANEL_MIN_HEIGHT = 40;
// MAX は画面サイズに追従する (parent.clientHeight - 余白)。固定値だと
// 大画面で 700 が窮屈、小画面で 700 がはみ出る。reserve は「グリッド上部の
// 最低残し量」。resize handle 自体は panel 上端にあるので、reserve が極小でも
// ハンドル自体は掴める。
const PANEL_MAX_RESERVE = 20;

export type GridSort = {
  column: string;
  direction: DbOrderDirection;
};

export type GridFilter = {
  column: string;
  value: string;
};

/** カラム完全一致条件（外部キー参照などのベース WHERE）。 */
export type GridExactFilter = {
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
  /** 現在のテーブルに定義された外部キー一覧を返す（FK 関連表示用）。 */
  getForeignKeys?: () => DbForeignKey[];
  /**
   * 参照先テーブルのページを取得する。eq はベース WHERE（完全一致）として
   * 常に適用され、その上から filters / sort を重ねられる。
   */
  fetchRelatedPage?: (
    table: string,
    offset: number,
    limit: number,
    sort: GridSort | null,
    filters: GridFilter[],
    eq: GridExactFilter[],
    signal?: AbortSignal,
  ) => Promise<DbTableDataResponse>;
  /**
   * このグリッドへ常時適用されるベース WHERE（完全一致）。エクスポート時に
   * フィルタへ合わせて付与する。関連パネルの埋め込みグリッドでのみ使う。
   */
  getBaseEq?: () => GridExactFilter[];
  /**
   * 埋め込みグリッドで FK セルがクリックされたことを親へ通知する。
   * 親はこれを使って関連パネルをさらに 1 段潜らせる（ドリルダウン）。
   */
  onForeignKeyCellClick?: (
    sourceTable: string,
    columnNames: string[],
    rowData: DbValue[],
    clickedColumn: string,
  ) => void;
  /** 関連パネルの保存済み高さ(px)。タブ状態から復元する。 */
  getRelatedPanelHeight?: () => number | null;
  /** 関連パネルをリサイズしたとき高さ(px)を保存する。 */
  setRelatedPanelHeight?: (height: number) => void;
  /** セル詳細フッタの保存済み高さ(px)。 */
  getDetailPanelHeight?: () => number | null;
  /** セル詳細フッタをリサイズしたとき高さ(px)を保存する。 */
  setDetailPanelHeight?: (height: number) => void;
  /** 現在の言語設定に応じたローカライズ文言を返す。 */
  getText?: () => DbText;
};

export type TableGridOptions = {
  /** 埋め込みグリッド（関連データ表示用）では関連パネル機能を無効化する。 */
  embedded?: boolean;
};

export type TableGrid = {
  el: HTMLElement;
  load: (table: string, initialData?: DbTableDataResponse) => void;
  showError: (message: string) => void;
  applyState: (state: AnnotationDatabaseDataState) => Promise<void>;
  getState: () => AnnotationDatabaseDataState;
  clear: () => void;
  destroy: () => void;
  /** 言語切替時に組み込み済み DOM の文言を再適用する。 */
  localize: () => void;
  /** getForeignKeys の返り値が変わったとき (例: 推測 FK トグル) に
   * fkColumns を作り直してヘッダー/セル表示を更新する。データは再取得しない。 */
  refreshForeignKeys: () => void;
};

export function createTableGrid(
  callbacks: TableGridCallbacks,
  options: TableGridOptions = {},
): TableGrid {
  const embedded = options.embedded === true;
  // ローカライズ文言。未指定時は英語にフォールバックする。
  const text = (): DbText => callbacks.getText?.() ?? dbText("en");
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
  filterInput.placeholder = text().grid.searchPlaceholder;
  filterInput.autocomplete = "off";
  const filterClear = document.createElement("button");
  filterClear.type = "button";
  filterClear.className = "db-btn db-btn-icon db-grid-filter-clear";
  filterClear.textContent = "×";
  filterClear.hidden = true;

  // エクスポートは検索バー右端のアイコン+メニューに集約する。これにより
  // 「どのグリッドのエクスポートか」が見た目で分かる（メイン/関連で別々）。
  const exportWrap = document.createElement("div");
  exportWrap.className = "db-grid-export";
  const exportBtn = document.createElement("button");
  exportBtn.type = "button";
  exportBtn.className = "db-btn db-btn-icon db-grid-export-toggle";
  exportBtn.title = text().grid.exportAction;
  exportBtn.setAttribute("aria-label", text().grid.exportAction);
  exportBtn.textContent = "⬇";
  const exportMenu = document.createElement("div");
  exportMenu.className = "db-grid-export-menu";
  exportMenu.hidden = true;
  const exportCsv = document.createElement("button");
  exportCsv.type = "button";
  exportCsv.className = "db-grid-export-item";
  exportCsv.textContent = "CSV";
  const exportJson = document.createElement("button");
  exportJson.type = "button";
  exportJson.className = "db-grid-export-item";
  exportJson.textContent = "JSON";
  exportMenu.append(exportCsv, exportJson);
  exportWrap.append(exportBtn, exportMenu);

  const closeExportMenu = () => {
    exportMenu.hidden = true;
    document.removeEventListener("click", onDocClickForExport);
  };
  function onDocClickForExport(e: MouseEvent) {
    if (!exportWrap.contains(e.target as Node)) closeExportMenu();
  }
  exportBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (exportMenu.hidden) {
      exportMenu.hidden = false;
      document.addEventListener("click", onDocClickForExport);
    } else {
      closeExportMenu();
    }
  });
  exportCsv.addEventListener("click", () => {
    closeExportMenu();
    triggerExport("csv");
  });
  exportJson.addEventListener("click", () => {
    closeExportMenu();
    triggerExport("json");
  });

  filterBar.append(filterIcon, filterInput, filterClear, exportWrap);

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
  // 上端ドラッグハンドル。関連パネル (.db-related-resize) と同じ構造で、
  // ドラッグ確定時にコールバック経由でタブ状態へ保存する。
  const detailResize = document.createElement("div");
  detailResize.className = "db-grid-detail-resize";
  detailResize.addEventListener("mousedown", startDetailResize);
  detailPanel.appendChild(detailResize);

  viewport.append(spacer, body);
  el.append(filterBar, headerWrap, filterRowWrap, viewport, detailPanel);

  // セル詳細フッタの高さ (関連パネルと同じ persist 経路)。embedded の埋め込み
  // グリッドでは詳細フッタは出ないので初期化のみで参照されない。
  // pane の MAX は実機の el の高さに合わせて毎回算出する (window resize にも
  // ある程度追従)。fallback で window.innerHeight を使う。
  function panelMaxHeight(): number {
    const containerH = el.clientHeight || window.innerHeight;
    return Math.max(
      DETAIL_PANEL_MIN_HEIGHT + 1,
      containerH - PANEL_MAX_RESERVE,
    );
  }
  const savedDetailHeight = embedded
    ? null
    : (callbacks.getDetailPanelHeight?.() ?? null);
  let detailHeight =
    savedDetailHeight != null
      ? Math.max(
          DETAIL_PANEL_MIN_HEIGHT,
          Math.min(panelMaxHeight(), savedDetailHeight),
        )
      : DETAIL_PANEL_DEFAULT_HEIGHT;
  detailPanel.style.height = `${detailHeight}px`;
  // ドラッグ中の window リスナーを teardown 時に外せるよう保持。
  let detailResizeCleanup: (() => void) | null = null;

  // active cell (詳細フッタ/関連パネルに表示中) を切替える。state を
  // 更新したあと、現在 body 上にいる古い active class を外して新しい
  // セルに付け直す。virtualized 再描画でも renderViewport が state を
  // 見てクラスを再付与するので、スクロール後の表示も維持される。
  function setActiveCell(rowIndex: number, colIndex: number) {
    activeCellRowIndex = rowIndex;
    activeCellColIndex = colIndex;
    for (const c of body.querySelectorAll(".db-grid-cell-active")) {
      c.classList.remove("db-grid-cell-active");
    }
    if (rowIndex < 0 || colIndex < 0) return;
    // colIndex+1: rowNum cell が先頭にあるので 1 ずれる。
    const targetRow = body.children[rowIndex - renderStartRow] as
      | HTMLElement
      | undefined;
    targetRow?.children[colIndex + 1]?.classList.add("db-grid-cell-active");
  }

  function clearActiveCell() {
    setActiveCell(-1, -1);
  }

  // detailPanel.innerHTML = "" を直に呼ぶと resize handle まで消えてしまう
  // ので、resize 以外の子だけ削除するヘルパを通す。
  function clearDetailContent() {
    for (const child of Array.from(detailPanel.children)) {
      if (child !== detailResize) child.remove();
    }
  }

  // 上端ハンドル方式の panel 高さリサイズを 1 か所に集約。detail / related
  // の 2 つの panel で同じ手順 (mousemove で delta = startY - ev.clientY、
  // clamp、mouseup で persist) を踏むので、差分パラメタ (panel/min/getter/
  // setter/persist) だけ渡す形にした。
  function startTopEdgeResize(opts: {
    panel: HTMLElement;
    min: number;
    getHeight: () => number;
    setHeight: (h: number) => void;
    persist: (h: number) => void;
    setCleanup: (fn: (() => void) | null) => void;
    startEvent: MouseEvent;
  }) {
    opts.startEvent.preventDefault();
    const startY = opts.startEvent.clientY;
    const startHeight = opts.getHeight();
    const onMove = (ev: MouseEvent) => {
      const delta = startY - ev.clientY;
      const next = Math.max(
        opts.min,
        Math.min(panelMaxHeight(), startHeight + delta),
      );
      opts.setHeight(next);
      opts.panel.style.height = `${next}px`;
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      opts.setCleanup(null);
      opts.persist(opts.getHeight());
    };
    opts.setCleanup(onUp);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  function startDetailResize(e: MouseEvent) {
    startTopEdgeResize({
      panel: detailPanel,
      min: DETAIL_PANEL_MIN_HEIGHT,
      getHeight: () => detailHeight,
      setHeight: (h) => {
        detailHeight = h;
      },
      persist: (h) => callbacks.setDetailPanelHeight?.(h),
      setCleanup: (fn) => {
        detailResizeCleanup = fn;
      },
      startEvent: e,
    });
  }

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
  // 詳細フッタ or 関連パネルに「いまどのセルの値を出してるか」を覚えておく。
  // renderViewport / 再描画でも色が維持されるよう、行/列 index を state に持つ。
  let activeCellRowIndex = -1;
  let activeCellColIndex = -1;
  // 仮想スクロール時に body に積まれている先頭行の global index。
  // renderViewport が描画する直前に確定する。setActiveCell が body 内の
  // 相対位置を計算するために参照する (CSS transform を regex で読むのは
  // translate3d 等のフォーマット変更で簡単に壊れるので state を持つ)。
  let renderStartRow = 0;
  // 現在のテーブルで外部キーを持つカラム名（ヘッダーの 🔗 表示用）。
  const fkColumns = new Set<string>();

  /* ---- Related-data panel (FK navigation) ---- */
  // 1 行が持つ外部キー参照の集合。左リストの各エントリに対応する。
  // direction:
  //   - "outgoing": この行の FK 列値 → 参照先 (fk.toTable.fk.toColumn = value)
  //   - "incoming": この行の PK 列値 ← 参照元 (fk.fromTable.fk.fromColumn = value)
  //     例: user.id をクリック → account / session / projects などの
  //     user_id = user.id の行を辿れる。
  type RelatedDirection = "outgoing" | "incoming";
  type RelatedTarget = {
    direction: RelatedDirection;
    fk: DbForeignKey;
    value: string;
  };
  // ドリルの 1 段。sourceTable の行が持つ FK 参照群と選択中の参照。
  type RelatedLevel = {
    sourceTable: string;
    targets: RelatedTarget[];
    selectedIndex: number;
  };
  let relatedPanel: HTMLElement | null = null;
  let relatedListEl: HTMLElement | null = null;
  let relatedGridHost: HTMLElement | null = null;
  // 参照先が 0 件のときに出す空表示。
  let relatedEmptyEl: HTMLElement | null = null;
  // ヘッダーのパンくず（ドリル経路）を表示する要素。
  let relatedCrumbEl: HTMLElement | null = null;
  let embeddedGrid: TableGrid | null = null;
  // ドリルのスタック。末尾が現在表示中の階層。
  let relatedStack: RelatedLevel[] = [];
  // リサイズドラッグ中の window リスナーを teardown 時に確実に外すための解除関数。
  let relatedResizeCleanup: (() => void) | null = null;
  // 切り替え中の取得競合を捨てるための世代。
  let relatedGen = 0;
  // 埋め込みグリッドへ常時適用するベース WHERE（完全一致）。
  let relatedEq: GridExactFilter[] = [];
  const savedRelatedHeight = embedded
    ? null
    : (callbacks.getRelatedPanelHeight?.() ?? null);
  let relatedHeight =
    savedRelatedHeight != null
      ? Math.max(
          RELATED_PANEL_MIN_HEIGHT,
          Math.min(panelMaxHeight(), savedRelatedHeight),
        )
      : RELATED_PANEL_DEFAULT_HEIGHT;
  if (!embedded) {
    relatedPanel = document.createElement("div");
    relatedPanel.className = "db-related-panel";
    relatedPanel.hidden = true;
    relatedPanel.style.height = `${relatedHeight}px`;
    el.appendChild(relatedPanel);
  }

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
    clearDetailContent();
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
    clearActiveCell();
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
    // 新しいテーブルをロードする前に選択をリセットする。これを怠ると、
    // 関連グリッドの使い回し時に前テーブルの行 index が別の行へ誤適用され、
    // getState() にも誤った行番号が混入する。
    selectedRowIndex = -1;
    // 開いたままの export メニューが残すと document クリックリスナーが
    // リークするため、確実に閉じて解除する。
    closeExportMenu();
    hideRelatedPanel();
    detailPanel.hidden = true;
    clearDetailContent();
    colWidths.clear();
  }

  let relatedFirstPageController: AbortController | null = null;

  /** 値を参照先カラムとの一致条件に使える文字列へ正規化する。 */
  function relatedLookupValue(value: DbValue): string | null {
    if (value === null) return null;
    if (value instanceof Uint8Array) return null;
    if (typeof value === "boolean") return value ? "1" : "0";
    const str = String(value);
    return str === "" ? null : str;
  }

  /** 指定行が持つ外部キー参照を集める（左リストの元データ）。
   * outgoing: この行の FK 列値 → 参照先 (fk.fromTable === sourceTable)
   * incoming: この行の PK 列値 ← 参照元 (fk.toTable === sourceTable)
   */
  function buildRowForeignKeys(
    sourceTable: string,
    colNames: string[],
    rowData: DbValue[],
  ): RelatedTarget[] {
    const targets: RelatedTarget[] = [];
    for (const fk of callbacks.getForeignKeys?.() ?? []) {
      if (fk.fromTable === sourceTable) {
        const idx = colNames.indexOf(fk.fromColumn);
        if (idx >= 0) {
          const value = relatedLookupValue(rowData[idx]);
          if (value !== null) {
            targets.push({ direction: "outgoing", fk, value });
          }
        }
      }
      if (fk.toTable === sourceTable) {
        const idx = colNames.indexOf(fk.toColumn);
        if (idx >= 0) {
          const value = relatedLookupValue(rowData[idx]);
          if (value !== null) {
            targets.push({ direction: "incoming", fk, value });
          }
        }
      }
    }
    return targets;
  }

  /** クリックされた列に対応する target index。outgoing は fromColumn、
   * incoming は toColumn と突き合わせる。 */
  function findTargetIndexForColumn(
    targets: RelatedTarget[],
    clickedColumn: string,
  ): number {
    return targets.findIndex((t) =>
      t.direction === "outgoing"
        ? t.fk.fromColumn === clickedColumn
        : t.fk.toColumn === clickedColumn,
    );
  }

  /** target の直接ドリル先 (table / 絞り込み列)。
   * outgoing → 参照先 (toTable/toColumn = value)
   * incoming → 参照元 (fromTable/fromColumn = value) */
  function relatedDrillTable(target: RelatedTarget): string {
    return target.direction === "outgoing"
      ? target.fk.toTable
      : target.fk.fromTable;
  }

  function relatedDrillEqColumn(target: RelatedTarget): string {
    return target.direction === "outgoing"
      ? target.fk.toColumn
      : target.fk.fromColumn;
  }

  /** 行から 1 ドリル階層を作る。FK 参照が無ければ null。 */
  function makeRelatedLevel(
    sourceTable: string,
    colNames: string[],
    rowData: DbValue[],
    clickedColumn: string,
  ): RelatedLevel | null {
    const targets = buildRowForeignKeys(sourceTable, colNames, rowData);
    if (targets.length === 0) return null;
    let selectedIndex = findTargetIndexForColumn(targets, clickedColumn);
    if (selectedIndex < 0) selectedIndex = 0;
    return { sourceTable, targets, selectedIndex };
  }

  function currentRelatedLevel(): RelatedLevel | null {
    return relatedStack[relatedStack.length - 1] ?? null;
  }

  function currentRelatedTarget(): RelatedTarget | null {
    const level = currentRelatedLevel();
    return level ? (level.targets[level.selectedIndex] ?? null) : null;
  }

  /** 関連パネルの DOM と埋め込みグリッドを初回だけ構築する。 */
  function ensureRelatedDom() {
    if (!relatedPanel || relatedListEl) return;

    const resizer = document.createElement("div");
    resizer.className = "db-related-resize";
    resizer.addEventListener("mousedown", startRelatedResize);

    const header = document.createElement("div");
    header.className = "db-related-header";
    const title = document.createElement("span");
    title.className = "db-related-title";
    title.textContent = "🔗";
    // ドリル経路を示すパンくず。各セグメントのクリックでその階層へ戻る。
    relatedCrumbEl = document.createElement("span");
    relatedCrumbEl.className = "db-related-crumbs";
    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "db-btn db-grid-detail-copy db-related-copy";
    copyBtn.textContent = "Copy";
    copyBtn.addEventListener("click", () => {
      const target = currentRelatedTarget();
      if (!target) return;
      navigator.clipboard.writeText(target.value).then(
        () => {
          copyBtn.textContent = "Copied";
          setTimeout(() => {
            copyBtn.textContent = "Copy";
          }, 800);
        },
        () => {
          copyBtn.textContent = "Copy failed";
        },
      );
    });
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "db-btn db-btn-icon db-related-close";
    closeBtn.textContent = "×";
    closeBtn.addEventListener("click", () => {
      hideRelatedPanel();
      clearActiveCell();
    });
    header.append(title, relatedCrumbEl, copyBtn, closeBtn);

    const bodyRow = document.createElement("div");
    bodyRow.className = "db-related-body";
    relatedListEl = document.createElement("div");
    relatedListEl.className = "db-related-list";
    relatedGridHost = document.createElement("div");
    relatedGridHost.className = "db-related-grid-host";

    embeddedGrid = createTableGrid(
      {
        fetchPage: (table, offset, limit, s, filters, signal) =>
          callbacks.fetchRelatedPage
            ? callbacks.fetchRelatedPage(
                table,
                offset,
                limit,
                s,
                filters,
                relatedEq,
                signal,
              )
            : Promise.reject(new Error("related fetch is not configured")),
        getDbId: callbacks.getDbId,
        getColumnWidths: callbacks.getColumnWidths,
        setColumnWidths: callbacks.setColumnWidths,
        getForeignKeys: callbacks.getForeignKeys,
        getBaseEq: () => relatedEq,
        getText: callbacks.getText,
        // 埋め込みグリッドの FK クリックで 1 段潜る。
        onForeignKeyCellClick: (sourceTable, colNames, rowData, clicked) =>
          drillIntoRelated(sourceTable, colNames, rowData, clicked),
      },
      { embedded: true },
    );
    relatedGridHost.appendChild(embeddedGrid.el);

    relatedEmptyEl = document.createElement("div");
    relatedEmptyEl.className = "db-related-empty";
    relatedEmptyEl.textContent = text().grid.relatedEmpty;
    relatedEmptyEl.hidden = true;
    relatedGridHost.appendChild(relatedEmptyEl);

    bodyRow.append(relatedListEl, relatedGridHost);
    relatedPanel.append(resizer, header, bodyRow);
  }

  function startRelatedResize(e: MouseEvent) {
    if (!relatedPanel) return;
    startTopEdgeResize({
      panel: relatedPanel,
      min: RELATED_PANEL_MIN_HEIGHT,
      getHeight: () => relatedHeight,
      setHeight: (h) => {
        relatedHeight = h;
      },
      persist: (h) => callbacks.setRelatedPanelHeight?.(h),
      setCleanup: (fn) => {
        relatedResizeCleanup = fn;
      },
      startEvent: e,
    });
  }

  // hideRelatedPanel は showCellDetail からも内部的に呼ばれるため、
  // active セルマーカーをここで落とすと「detail フッタを開いた瞬間に色が消える」
  // 不具合が出る。クリアはユーザー操作 (close ボタン / clear()) 側に寄せる。
  function hideRelatedPanel() {
    if (!relatedPanel) return;
    relatedResizeCleanup?.();
    relatedPanel.hidden = true;
    if (relatedEmptyEl) relatedEmptyEl.hidden = true;
    relatedStack = [];
    relatedGen++;
    relatedFirstPageController?.abort();
    relatedFirstPageController = null;
    embeddedGrid?.clear();
  }

  /** メイングリッドの FK セルクリックで、その行の関連を最上段から開く。 */
  function openRelatedForRow(
    sourceTable: string,
    colNames: string[],
    rowData: DbValue[],
    clickedColumn: string,
  ) {
    if (embedded || !relatedPanel || !callbacks.fetchRelatedPage) return;
    const level = makeRelatedLevel(
      sourceTable,
      colNames,
      rowData,
      clickedColumn,
    );
    if (!level) return;
    ensureRelatedDom();
    detailPanel.hidden = true; // 単一値の詳細とは排他表示
    relatedStack = [level];
    relatedPanel.hidden = false;
    renderRelated();
  }

  /** 埋め込みグリッドの FK クリックで 1 段潜る。 */
  function drillIntoRelated(
    sourceTable: string,
    colNames: string[],
    rowData: DbValue[],
    clickedColumn: string,
  ) {
    if (!relatedPanel) return;
    const level = makeRelatedLevel(
      sourceTable,
      colNames,
      rowData,
      clickedColumn,
    );
    if (!level) return; // 参照先が無い行は何もしない
    relatedStack.push(level);
    renderRelated();
  }

  /** 同一階層内で参照先（兄弟 FK）を切り替える。 */
  function selectRelatedTarget(index: number) {
    const level = currentRelatedLevel();
    if (!level || index < 0 || index >= level.targets.length) return;
    // 既に選択中の参照先を再クリックしても再取得しない。
    if (index === level.selectedIndex) return;
    level.selectedIndex = index;
    renderRelated();
  }

  /** パンくずのクリックでその階層まで戻る。 */
  function goToRelatedLevel(levelIndex: number) {
    if (levelIndex < 0 || levelIndex >= relatedStack.length - 1) return;
    relatedStack = relatedStack.slice(0, levelIndex + 1);
    renderRelated();
  }

  function renderRelated() {
    renderRelatedCrumbs();
    renderRelatedList();
    void loadRelatedTarget();
  }

  function renderRelatedCrumbs() {
    if (!relatedCrumbEl) return;
    relatedCrumbEl.innerHTML = "";
    if (relatedStack.length === 0) return;
    const origin = document.createElement("span");
    origin.className = "db-related-crumb-origin";
    origin.textContent = relatedStack[0].sourceTable;
    relatedCrumbEl.appendChild(origin);
    relatedStack.forEach((level, i) => {
      const sep = document.createElement("span");
      sep.className = "db-related-crumb-sep";
      sep.textContent = "▸";
      relatedCrumbEl?.appendChild(sep);
      const target = level.targets[level.selectedIndex];
      const isLast = i === relatedStack.length - 1;
      const tableLabel = relatedDrillTable(target);
      if (isLast) {
        const seg = document.createElement("span");
        seg.className = "db-related-crumb active";
        seg.textContent = tableLabel;
        relatedCrumbEl?.appendChild(seg);
      } else {
        const seg = document.createElement("button");
        seg.type = "button";
        seg.className = "db-related-crumb";
        seg.textContent = tableLabel;
        seg.addEventListener("click", () => goToRelatedLevel(i));
        relatedCrumbEl?.appendChild(seg);
      }
    });
  }

  function renderRelatedList() {
    const level = currentRelatedLevel();
    if (!relatedListEl || !level) return;
    relatedListEl.innerHTML = "";
    level.targets.forEach((target, i) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "db-related-list-item";
      item.classList.add(`db-related-list-${target.direction}`);
      // Rails 規約からの推測 FK は実 FK と見た目で区別する (ラベル + 色)。
      if (target.fk.inferred) item.classList.add("db-related-list-inferred");
      if (i === level.selectedIndex) item.classList.add("active");
      const name = document.createElement("span");
      name.className = "db-related-list-name";
      // outgoing は参照先テーブル、incoming は参照元テーブル。
      name.textContent = relatedDrillTable(target);
      if (target.fk.inferred) {
        const badge = document.createElement("span");
        badge.className = "db-related-list-inferred-badge";
        badge.textContent = "inferred";
        badge.title = "Inferred from Rails-style naming, not declared in DB";
        name.appendChild(badge);
      }
      const via = document.createElement("span");
      via.className = "db-related-list-via";
      // outgoing: this row's FK 列 = value (= parent の PK)
      // incoming: parent の側で column = value となる行を見せる、ので
      //   "<fromTable>.<fromColumn> = <value>" と完全形で出す。
      via.textContent =
        target.direction === "outgoing"
          ? `${target.fk.fromColumn} = ${target.value}`
          : `${target.fk.fromTable}.${target.fk.fromColumn} = ${target.value}`;
      item.append(name, via);
      item.addEventListener("click", () => selectRelatedTarget(i));
      relatedListEl?.appendChild(item);
    });
  }

  /** 現在選択中の参照先を埋め込みグリッドへ読み込む。 */
  async function loadRelatedTarget() {
    const target = currentRelatedTarget();
    if (!target) return;
    const drillTable = relatedDrillTable(target);
    relatedEq = [{ column: relatedDrillEqColumn(target), value: target.value }];
    const grid = embeddedGrid;
    if (!grid || !callbacks.fetchRelatedPage) return;
    const gen = ++relatedGen;
    relatedFirstPageController?.abort();
    const controller = new AbortController();
    relatedFirstPageController = controller;
    grid.clear();
    if (relatedEmptyEl) relatedEmptyEl.hidden = true;
    try {
      // 1 ページ目を取得して列情報ごとグリッドへ渡す（埋め込みグリッドの
      // 以降のスクロール/フィルタ/ソートは fetchRelatedPage 経由で eq を保つ）。
      const data = await callbacks.fetchRelatedPage(
        drillTable,
        0,
        PAGE_SIZE,
        null,
        [],
        relatedEq,
        controller.signal,
      );
      if (gen !== relatedGen) return;
      grid.load(drillTable, data);
      // 参照先が 0 件なら空表示を出す（孤立 FK 等）。
      if (relatedEmptyEl) relatedEmptyEl.hidden = data.totalRows > 0;
    } catch (err) {
      if (gen !== relatedGen || isAbortError(err)) return;
      grid.showError(err instanceof Error ? err.message : String(err));
    }
  }

  function showCellDetail(colIndex: number, value: DbValue) {
    const colName = columnNames[colIndex];
    const colType = columns[colIndex]?.type || "";

    // 単一値詳細とは排他。関連パネルを閉じるだけでなく、進行中の関連ロードも
    // 中断する（hideRelatedPanel が abort + stack クリア + 埋め込み grid.clear）。
    hideRelatedPanel();
    detailPanel.hidden = false;
    clearDetailContent();

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
      // 関連パネルも閉じていればフッタ表示中のセル色も落とす。
      if (!relatedPanel || relatedPanel.hidden) clearActiveCell();
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

      if (fkColumns.has(col.name)) {
        cell.classList.add("db-grid-header-fk");
        const fkIcon = document.createElement("span");
        fkIcon.className = "db-grid-header-fk-icon";
        fkIcon.textContent = "🔗";
        fkIcon.title = text().grid.foreignKeyHint;
        label.appendChild(fkIcon);
      }

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
      input.placeholder = text().grid.columnFilterPlaceholder(col.name);
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
      // setActiveCell が body 内インデックスを計算するために参照する。
      renderStartRow = startRow;
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
            const cellColName = columnNames[c];
            const rowValues = rowData;
            // FK セルはメイン/埋め込みの両方で「辿れる」セルにする。埋め込み側は
            // 親から渡された onForeignKeyCellClick が無ければ通常セル扱い。
            const fkClickable =
              fkColumns.has(cellColName) &&
              (!embedded || !!callbacks.onForeignKeyCellClick);
            if (fkClickable) {
              cell.classList.add("db-grid-cell-fk");
            }
            cell.addEventListener("click", (e) => {
              e.stopPropagation();
              selectedRowIndex = rowIndex;
              body.querySelectorAll(".db-grid-row.selected").forEach((r) => {
                r.classList.remove("selected");
              });
              row.classList.add("selected");
              // 詳細フッタ / 関連パネルに表示する対象セルを覚えておく。
              setActiveCell(rowIndex, cellColIndex);
              // FK セルは関連テーブルをパネルに開く（埋め込みは親へ通知して
              // 1 段潜る）。それ以外は従来どおり単一値の詳細を表示する。
              if (fkClickable) {
                if (embedded) {
                  callbacks.onForeignKeyCellClick?.(
                    currentTable,
                    columnNames,
                    rowValues,
                    cellColName,
                  );
                } else {
                  openRelatedForRow(
                    currentTable,
                    columnNames,
                    rowValues,
                    cellColName,
                  );
                }
              } else {
                showCellDetail(cellColIndex, cellValue);
              }
            });
            // virtualized 再描画でも色が残るよう、render 時に state と
            // 突合せてクラスを付ける。
            if (i === activeCellRowIndex && c === activeCellColIndex) {
              cell.classList.add("db-grid-cell-active");
            }
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
    const baseEq = callbacks.getBaseEq?.() ?? [];
    if (baseEq.length > 0) {
      params.set("eq", JSON.stringify(baseEq));
    }
    const a = document.createElement("a");
    a.href = `/_db/export?${params}`;
    a.download = `${currentTable}.${format}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function updateStatus() {
    if (!statusEl) {
      statusEl = document.createElement("div");
      statusEl.className = "db-grid-status";
      el.appendChild(statusEl);
    }
    const t = text().grid;
    const parts: string[] = [t.statusRows(totalRows.toLocaleString())];
    if (sort)
      parts.push(t.statusSort(sort.column, sort.direction.toUpperCase()));
    const activeFilterCount = columnFilters.size + (globalSearchValue ? 1 : 0);
    if (activeFilterCount > 0) parts.push(t.statusFilters(activeFilterCount));
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
    rebuildFkColumnsForCurrentTable();
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
    embeddedGrid?.destroy();
    embeddedGrid = null;
    viewport.removeEventListener("scroll", onViewportScroll);
    // ドラッグ中の window リスナーが残らないよう、teardown 時に外す。
    detailResizeCleanup?.();
  }

  /** 言語切替時、組み込み済み DOM の文言を再適用する（再描画なし）。 */
  function localize() {
    const t = text();
    filterInput.placeholder = t.grid.searchPlaceholder;
    exportBtn.title = t.grid.exportAction;
    exportBtn.setAttribute("aria-label", t.grid.exportAction);
    if (relatedEmptyEl) relatedEmptyEl.textContent = t.grid.relatedEmpty;
    if (currentTable) {
      renderHeader(); // FK アイコンの title や列フィルタを再構築
      updateStatus();
    }
    renderRelatedCrumbs();
    embeddedGrid?.localize();
  }

  // FK 列 (outgoing) と、他から参照されている列 (incoming = 通常 PK) の
  // 両方にヘッダ 🔗 を付け、セルクリックで関連パネルを開けるようにする。
  // 設定トグル (Rails FK 推測) を切り替えたときも呼ばれる。
  function rebuildFkColumnsForCurrentTable() {
    fkColumns.clear();
    if (!currentTable) return;
    for (const fk of callbacks.getForeignKeys?.() ?? []) {
      if (fk.fromTable === currentTable) fkColumns.add(fk.fromColumn);
      if (fk.toTable === currentTable) fkColumns.add(fk.toColumn);
    }
  }

  // 外部から FK セットの再計算を要求するエントリ。例: Rails 規約による
  // 仮想 FK のトグル切替時、データを再フェッチせずヘッダの 🔗 と
  // セルクリック判定だけ更新する。
  function refreshForeignKeys() {
    rebuildFkColumnsForCurrentTable();
    if (currentTable) {
      renderHeader();
      renderViewport();
    }
    embeddedGrid?.refreshForeignKeys();
  }

  return {
    el,
    load,
    showError,
    applyState,
    getState,
    clear,
    destroy,
    localize,
    refreshForeignKeys,
  };
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
