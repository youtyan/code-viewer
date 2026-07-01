import type {
  DbCellInput,
  DbColumn,
  DbForeignKey,
  DbOrderDirection,
  DbTableDataResponse,
  DbValue,
  RowMutation,
} from "../../core/database/types";
import { iconSvg, SYNC_16_PATH } from "../../core/icons";
import { isImeComposing } from "../../core/keyboard";
import type { AnnotationDatabaseDataState } from "../../core/types";
import { showConfirmDialog } from "../ui-dialog";
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
  /** このグリッドで行編集 UI を出してよいか (書き込み対応データストアのみ)。 */
  getEditable?: () => boolean;
  /** 保留中の変更をサーバへ適用する。失敗時は throw (メッセージを表示する)。 */
  applyMutations?: (mutations: RowMutation[]) => Promise<void>;
};

export type TableGridOptions = {
  /** 埋め込みグリッド（関連データ表示用）では関連パネル機能を無効化する。 */
  embedded?: boolean;
};

export type TableGrid = {
  el: HTMLElement;
  load: (table: string, initialData?: DbTableDataResponse) => void;
  refresh: () => Promise<void>;
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
  /** 編集モード ON/OFF を外部 (prefs バーのトグル等) から制御する。
   * pending changes がある状態で OFF にするとカスタムダイアログで確認する。
   * 結果として実際に切り替わったかを返す。 */
  setEditMode: (on: boolean) => Promise<boolean>;
  getEditMode: () => boolean;
  /** このグリッドが書き込み対応 (= 編集モードに入れる) か。
   * テーブル切替で変わるので、subscribe ハンドラで都度通知する。 */
  isEditable: () => boolean;
  onEditableChange: (listener: (editable: boolean) => void) => () => void;
  onEditModeChange: (listener: (on: boolean) => void) => () => void;
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

  const refreshBtn = document.createElement("button");
  refreshBtn.type = "button";
  refreshBtn.className = "db-btn db-btn-icon db-grid-refresh";
  refreshBtn.title = text().grid.refreshAction;
  refreshBtn.setAttribute("aria-label", text().grid.refreshAction);
  refreshBtn.innerHTML = iconSvg("octicon-sync", SYNC_16_PATH);

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

  // --- 行編集ツールバー (コミット/破棄/新規行) ---
  // embedded (関連パネルの埋め込みグリッド) では編集 UI を出さない。
  // 編集モード ON/OFF のトグルはサイドバー prefs バーに集約 (#16)。
  // ここのコントロールは「編集モード ON 中だけ」表示する。
  // editWrap 自体は editable 判定で hidden 切替 (refreshEditButtons)。
  // 子要素は editMode で visibility 切替する (場所は確保 = レイアウトシフト
  // 回避)。初期は editMode OFF 相当に visibility:hidden 固定で組み立てる。
  const editWrap = document.createElement("div");
  editWrap.className = "db-grid-edit-controls";
  editWrap.hidden = true;
  const newRowBtn = document.createElement("button");
  newRowBtn.type = "button";
  newRowBtn.className = "db-btn db-grid-edit-newrow";
  newRowBtn.textContent = text().edit.newRow;
  newRowBtn.style.visibility = "hidden";
  const commitBtn = document.createElement("button");
  commitBtn.type = "button";
  commitBtn.className = "db-btn db-btn-primary db-grid-edit-commit";
  commitBtn.textContent = text().edit.commit;
  commitBtn.style.visibility = "hidden";
  const discardBtn = document.createElement("button");
  discardBtn.type = "button";
  discardBtn.className = "db-btn db-grid-edit-discard";
  discardBtn.textContent = text().edit.discard;
  discardBtn.style.visibility = "hidden";
  const editStatus = document.createElement("span");
  editStatus.className = "db-grid-edit-status";
  editWrap.append(newRowBtn, commitBtn, discardBtn, editStatus);

  filterBar.append(
    filterIcon,
    filterInput,
    filterClear,
    editWrap,
    refreshBtn,
    exportWrap,
  );

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

  /* ---- Row editing (edit / insert / delete) ---- */
  let editMode = false;
  // IME 変換中フラグ。変換中は renderViewport の body 再構築をスキップして
  // composition の中断を防ぐ (compositionend で再描画してキャッチアップ)。
  let isComposing = false;
  // 既存行の保留編集。rowKey -> { pk セル, 変更された colIndex -> 新値 }。
  // 値は string (テキスト) または null (SQL NULL)。
  const pendingEdits = new Map<
    string,
    { pk: DbCellInput[]; edits: Map<number, string | null> }
  >();
  // 削除対象の既存行。rowKey -> pk セル。
  const pendingDeletes = new Map<string, DbCellInput[]>();
  // 新規行ドラフト。各行は colIndex -> 値 (string=テキスト / null=NULL)。
  // 未入力の列はエントリ無し (= 省略され DB デフォルトが入る)。
  let draftRows: Array<Map<number, string | null>> = [];
  // 編集モードで「いま input になっている既存データセル」を覚える。
  // 既定はデータ行も表示モードで描画し、シングルクリックは詳細パネルや FK
  // ナビゲーションを担う。セルをダブルクリックすると editingCell* がそのセル
  // を指し、再描画で該当セルだけ input になる。input から focus が外れたら
  // 解除して再描画する。ドラフト行と PK/blob などの readonly セルは対象外。
  let editingCellRow = -1;
  let editingCellCol = -1;

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

  async function refreshCurrentTable(): Promise<void> {
    if (!currentTable || refreshBtn.disabled) return;
    const scrollTop = viewport.scrollTop;
    const pageStart =
      Math.floor(scrollTop / ROW_HEIGHT / PAGE_SIZE) * PAGE_SIZE;
    refreshBtn.disabled = true;
    refreshBtn.classList.add("spinning");
    if (filterTimer) {
      clearTimeout(filterTimer);
      filterTimer = null;
    }
    pageCache = new Map();
    pendingPages = new Map();
    startNewLoadGeneration();
    resetSelectionAndDetail();
    viewport.scrollTop = scrollTop;
    renderViewport();
    try {
      await ensurePage(pageStart);
    } finally {
      refreshBtn.classList.remove("spinning");
      refreshBtn.disabled = false;
    }
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
    // テーブル切替で保留中の変更はリセットする (テーブル固有のため)。
    // 編集モード自体は同じタブ内では保持する (#16: prefs バーのトグルが現在の
    // タブの editMode を表すため、テーブル切替で勝手に OFF にしない)。
    clearPending();
    setEditStatus("");
    refreshEditButtons();
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
        badge.textContent = text().nav.inferredBadge;
        badge.title = text().nav.inferredBadgeTitle;
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
      filterTimer = null;
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
        syncSpacer();
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

  // 編集モードのセルを作る。editing=false なら表示モード (read-only セル相当
  // のテキスト + シングルクリックで詳細パネル/FK ナビ + ダブルクリックで input
  // 化)、editing=true なら入力モード (input + NULL ボタン)。readonly な PK/blob
  // 列は editing=true を渡しても入力できない (input.readOnly)。
  function buildEditableCell(
    colIndex: number,
    value: string | null,
    opts: {
      readonly: boolean;
      nullable: boolean;
      editing: boolean;
      // body 全体の再構築 (スクロール等) 後にフォーカスを復元するための行識別子。
      rowIndex: number;
      onChange: (v: string | null) => void;
      // editing=false (表示モード) でセルをクリックした時 / ダブルクリックで
      // 入力モードに切り替える時 / 入力モードから抜ける時のフック。
      onActivate?: () => void;
      onEnterEdit?: () => void;
      onExitEdit?: () => void;
    },
  ): HTMLElement {
    const cell = document.createElement("div");
    cell.className = "db-grid-cell db-grid-cell-edit";
    cell.style.width = `${getColWidth(columnNames[colIndex])}px`;

    // ---- 表示モード: read-only 風のテキスト表示。ダブルクリックで input 化。
    if (!opts.editing) {
      cell.classList.add("db-grid-cell-display");
      cell.textContent = value === null ? "NULL" : value === "" ? "" : value;
      if (value === null) cell.classList.add("null");
      else if (value === "") cell.classList.add("empty");
      if (opts.readonly) {
        cell.classList.add("readonly");
      }
      cell.style.cursor = "pointer";
      cell.addEventListener("click", (e) => {
        e.stopPropagation();
        opts.onActivate?.();
      });
      // 読み取り専用 (PK/blob) はダブルクリックしても編集できないので、
      // 編集 hint を出さず dblclick もバインドしない。
      if (!opts.readonly) {
        cell.title = text().edit.dblclickToEdit;
        cell.addEventListener("dblclick", (e) => {
          e.stopPropagation();
          opts.onEnterEdit?.();
        });
      }
      return cell;
    }

    // ---- 入力モード: input (NULL は placeholder "NULL" + is-null クラス)。
    const input = document.createElement("input");
    input.type = "text";
    input.className = "db-grid-cell-input";
    input.dataset.editRow = String(opts.rowIndex);
    input.dataset.editCol = String(colIndex);
    // value===null は SQL NULL。空入力の "" (空文字列) と視覚的に区別するため、
    // placeholder "NULL" + is-null クラスで表現する。
    const applyNullVisual = (isNull: boolean) => {
      input.classList.toggle("is-null", isNull);
      input.placeholder = isNull ? "NULL" : "";
    };
    input.value = value === null ? "" : value;
    applyNullVisual(value === null);
    if (opts.readonly) {
      input.readOnly = true;
      input.classList.add("readonly");
    }
    input.addEventListener("input", () => {
      // テキスト入力したら NULL 状態は解除 (空文字列 "" は NULL ではない)。
      applyNullVisual(false);
      opts.onChange(input.value);
    });
    // 行選択/セル詳細クリックと衝突させない。
    input.addEventListener("click", (e) => e.stopPropagation());
    // 入力確定で表示モードへ戻す。NULL ボタンに focus が移るケースを除く。
    input.addEventListener("blur", (e) => {
      const next = (e as FocusEvent).relatedTarget as Node | null;
      if (next && cell.contains(next)) return;
      opts.onExitEdit?.();
    });
    // Enter / Escape で編集を抜けて表示モードへ戻す (値は input イベントで
    // すでに反映済み。Escape でも保留中変更を消したりはしない)。
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === "Escape") {
        e.preventDefault();
        opts.onExitEdit?.();
      }
    });
    cell.appendChild(input);
    // nullable 列には NULL ボタンを出し、明示的に SQL NULL を入れられるように
    // する (NULL→"" の暗黙変換や NULL 設定不可の問題への対処)。
    if (opts.nullable && !opts.readonly) {
      const nullBtn = document.createElement("button");
      nullBtn.type = "button";
      nullBtn.className = "db-grid-cell-null-btn";
      nullBtn.textContent = "∅";
      nullBtn.title = text().edit.setNull;
      // NULL ボタンを mousedown で抑止すると button へのフォーカス移譲が起き
      // ず input の blur が走らないので、editing が解除されない。
      nullBtn.addEventListener("mousedown", (e) => e.preventDefault());
      nullBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        input.value = "";
        applyNullVisual(true);
        opts.onChange(null);
        // クリック後も入力モードを維持するため、明示的に input へ戻す。
        input.focus();
      });
      cell.appendChild(nullBtn);
    }
    return cell;
  }

  // 既存データ行 (read-only もしくは編集モード) を 1 行ぶん組み立てる。
  function buildDataRow(i: number): HTMLElement {
    const pageStart = Math.floor(i / PAGE_SIZE) * PAGE_SIZE;
    const pageRows = pageCache.get(pageStart);
    const rowData = pageRows ? pageRows[i - pageStart] : null;

    const row = document.createElement("div");
    row.className = "db-grid-row";
    if (i % 2 === 1) row.classList.add("alt");
    if (i === selectedRowIndex) row.classList.add("selected");
    const rowIndex = i;

    const rowNum = document.createElement("div");
    rowNum.className = "db-grid-cell db-grid-rownum";
    rowNum.textContent = String(i + 1);
    row.appendChild(rowNum);

    if (!rowData) {
      for (let c = 0; c < columnNames.length; c++) {
        const cell = document.createElement("div");
        cell.className = "db-grid-cell loading";
        cell.style.width = `${getColWidth(columnNames[c])}px`;
        cell.textContent = "…";
        row.appendChild(cell);
      }
      return row;
    }

    if (editMode) {
      const key = rowKeyFor(rowData);
      // PK があり値が編集可能 (null/blob でない) 行だけ更新・削除できる。
      const editableRow = key !== null;
      if (key !== null && pendingDeletes.has(key)) {
        row.classList.add("db-grid-row-deleted");
      }
      if (editableRow) {
        rowNum.classList.add("db-grid-rownum-deletable");
        rowNum.title = text().edit.deleteRow;
        rowNum.style.cursor = "pointer";
        rowNum.addEventListener("click", (e) => {
          e.stopPropagation();
          const deleted = toggleDelete(rowData);
          row.classList.toggle("db-grid-row-deleted", deleted);
        });
      }
      const pendingForRow = key !== null ? pendingEdits.get(key) : undefined;
      // 行内に 1 つでもセル編集がある場合は行頭にマークを付ける (rownum
      // colorize + 行全体に薄い背景)。delete マークが優先する場合は上書きされる。
      if ((pendingForRow?.edits.size ?? 0) > 0) {
        row.classList.add("db-grid-row-edited");
      }
      for (let c = 0; c < columnNames.length; c++) {
        const original = rowData[c];
        // 元の表示値 (string|null)。NULL は null のまま渡して NULL 表示にする。
        const originalShown: string | null =
          original === null
            ? null
            : original instanceof Uint8Array
              ? formatValue(original)
              : String(original);
        const hasOverride = pendingForRow?.edits.has(c) ?? false;
        const shown: string | null = hasOverride
          ? (pendingForRow?.edits.get(c) ?? null)
          : originalShown;
        // PK・blob・PK 無し行は readonly。
        const ro =
          !editableRow ||
          columns[c]?.primaryKey === true ||
          original instanceof Uint8Array;
        const cellColIndex = c;
        const cellColName = columnNames[c];
        const cellValue = original;
        const rowValues = rowData;
        const fkClickable =
          fkColumns.has(cellColName) &&
          (!embedded || !!callbacks.onForeignKeyCellClick);
        const isEditingThisCell =
          !ro && i === editingCellRow && c === editingCellCol;
        // シングルクリック時のハンドラ。read-only モードと同じく、行/アクティブ
        // セルを更新し、FK セルなら関連パネル、その他なら詳細フッタを開く。
        const activate = () => {
          selectedRowIndex = rowIndex;
          body.querySelectorAll(".db-grid-row.selected").forEach((r) => {
            r.classList.remove("selected");
          });
          row.classList.add("selected");
          setActiveCell(rowIndex, cellColIndex);
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
        };
        // ダブルクリックで input 化。renderViewport 後に input が現れるので、
        // rAF 後に focus + キャレットを末尾へ。
        const enterEdit = () => {
          editingCellRow = i;
          editingCellCol = cellColIndex;
          renderViewport();
          requestAnimationFrame(() => {
            const inp = body.querySelector<HTMLInputElement>(
              `.db-grid-cell-input[data-edit-row="${i}"][data-edit-col="${cellColIndex}"]`,
            );
            if (!inp) return;
            inp.focus?.();
            try {
              inp.setSelectionRange?.(inp.value.length, inp.value.length);
            } catch {
              // 一部 input type では setSelectionRange 不可。focus のみで十分。
            }
          });
        };
        // input の blur / Enter / Escape で表示モードへ戻す。
        const exitEdit = () => {
          if (editingCellRow === i && editingCellCol === cellColIndex) {
            editingCellRow = -1;
            editingCellCol = -1;
            renderViewport();
          }
        };
        const cellEl = buildEditableCell(c, shown, {
          readonly: ro,
          nullable: columns[c]?.nullable === true,
          editing: isEditingThisCell,
          rowIndex: i,
          onChange: (v) => recordEdit(rowData, c, v),
          onActivate: activate,
          onEnterEdit: enterEdit,
          onExitEdit: exitEdit,
        });
        if (fkClickable) {
          cellEl.classList.add("db-grid-cell-fk");
        }
        // 編集された (pending override がある) セルに色を付ける。
        if (hasOverride) {
          cellEl.classList.add("db-grid-cell-edited");
        }
        // virtualized 再描画でも色が残るよう、render 時に state と
        // 突合せてクラスを付ける (input モード時は focus 表示があるので不要)。
        if (
          !isEditingThisCell &&
          i === activeCellRowIndex &&
          c === activeCellColIndex
        ) {
          cellEl.classList.add("db-grid-cell-active");
        }
        row.appendChild(cellEl);
      }
      return row;
    }

    // --- read-only (既存挙動) ---
    row.addEventListener("click", () => {
      selectedRowIndex = rowIndex;
      body.querySelectorAll(".db-grid-row.selected").forEach((r) => {
        r.classList.remove("selected");
      });
      row.classList.add("selected");
    });
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
    return row;
  }

  // 新規行ドラフト (編集モード時のみ、データ行の下に表示) を組み立てる。
  function buildDraftRow(draftIndex: number): HTMLElement {
    const draft = draftRows[draftIndex];
    const row = document.createElement("div");
    row.className = "db-grid-row db-grid-row-draft";
    const rowNum = document.createElement("div");
    rowNum.className = "db-grid-cell db-grid-rownum db-grid-rownum-draft";
    rowNum.textContent = "＋";
    rowNum.title = text().edit.newRow;
    rowNum.style.cursor = "pointer";
    rowNum.addEventListener("click", (e) => {
      e.stopPropagation();
      draftRows.splice(draftIndex, 1);
      syncSpacer();
      refreshEditButtons();
      showPendingStatus();
      renderViewport();
    });
    row.appendChild(rowNum);
    for (let c = 0; c < columnNames.length; c++) {
      const dv: string | null = draft.has(c)
        ? (draft.get(c) as string | null)
        : "";
      row.appendChild(
        buildEditableCell(c, dv, {
          readonly: false,
          nullable: columns[c]?.nullable === true,
          // ドラフト行は最初から入力モード (新規入力するための行)。
          editing: true,
          rowIndex: totalRows + draftIndex,
          onChange: (v) => {
            // "" = 未入力 (省略), null = 明示 NULL, それ以外 = 値。
            if (v === "") draft.delete(c);
            else draft.set(c, v);
            refreshEditButtons();
            showPendingStatus();
          },
        }),
      );
    }
    return row;
  }

  function renderViewport() {
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => {
      // IME 変換中は body を作り直すと入力中の composition が中断されるので、
      // この描画はスキップする (compositionend 後に再描画でキャッチアップする)。
      if (isComposing) return;
      const scrollTop = viewport.scrollTop;
      const viewHeight = viewport.clientHeight;
      const startRow = Math.max(
        0,
        Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN,
      );
      // setActiveCell が body 内インデックスを計算するために参照する。
      renderStartRow = startRow;
      // 編集モードでは末尾に新規行ドラフトを足すので表示行数が増える。
      const endRow = Math.min(
        displayRowCount(),
        Math.ceil((scrollTop + viewHeight) / ROW_HEIGHT) + OVERSCAN,
      );

      // ページ取得はデータ行 (< totalRows) の範囲だけ行う。
      const dataEnd = Math.min(endRow, totalRows);
      if (startRow < totalRows && dataEnd > startRow) {
        const neededPageStart = Math.floor(startRow / PAGE_SIZE) * PAGE_SIZE;
        const neededPageEnd = Math.floor((dataEnd - 1) / PAGE_SIZE) * PAGE_SIZE;
        for (let p = neededPageStart; p <= neededPageEnd; p += PAGE_SIZE) {
          ensurePage(p);
        }
      }

      // 編集モードでは body 全体を作り直すとフォーカス中のセル入力が破棄され、
      // スクロールのたびにキャレットが飛ぶ。再描画前に「どのセルを編集中か」と
      // 選択範囲を控えておき、再構築後に同じセルへ復元する。
      // 注意: `instanceof HTMLInputElement` は一部のテスト用 DOM シムでグローバル
      // 未定義になり throw するため使わない。className + duck typing で判定する。
      const active = document.activeElement as
        | (HTMLElement & {
            selectionStart?: number | null;
            selectionEnd?: number | null;
          })
        | null;
      let focusRestore: {
        row: string;
        col: string;
        start: number | null;
        end: number | null;
      } | null = null;
      if (
        active?.classList?.contains("db-grid-cell-input") &&
        body.contains(active)
      ) {
        focusRestore = {
          row: active.dataset?.editRow ?? "",
          col: active.dataset?.editCol ?? "",
          start: active.selectionStart ?? null,
          end: active.selectionEnd ?? null,
        };
      }

      body.innerHTML = "";
      body.style.transform = `translateY(${startRow * ROW_HEIGHT}px)`;

      for (let i = startRow; i < endRow; i++) {
        body.appendChild(
          i < totalRows ? buildDataRow(i) : buildDraftRow(i - totalRows),
        );
      }

      if (focusRestore) {
        const next = body.querySelector<HTMLInputElement>(
          `.db-grid-cell-input[data-edit-row="${focusRestore.row}"][data-edit-col="${focusRestore.col}"]`,
        );
        if (next) {
          next.focus?.();
          try {
            next.setSelectionRange?.(
              focusRestore.start ?? next.value.length,
              focusRestore.end ?? next.value.length,
            );
          } catch {
            // 一部 input type では setSelectionRange 不可。フォーカスだけで十分。
          }
        }
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
    syncSpacer();
    renderHeader();
    updateStatus();
    // テーブルが変わったので編集 UI の出し分け (書き込み対応 + PK 有無) を更新。
    refreshEditButtons();
    showPendingStatus();
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
  refreshBtn.addEventListener("click", () => {
    void refreshCurrentTable();
  });

  const onViewportScroll = () => {
    headerWrap.scrollLeft = viewport.scrollLeft;
    filterRowWrap.scrollLeft = viewport.scrollLeft;
    renderViewport();
  };
  viewport.addEventListener("scroll", onViewportScroll, { passive: true });

  // 編集セル入力の IME 変換境界を捕捉する (composition イベントは body から
  // バブリングする)。変換中は renderViewport をスキップし、確定後に再描画する。
  const onCompositionStart = () => {
    isComposing = true;
  };
  const onCompositionEnd = () => {
    isComposing = false;
    renderViewport();
  };
  body.addEventListener("compositionstart", onCompositionStart);
  body.addEventListener("compositionend", onCompositionEnd);

  function destroy() {
    clear();
    embeddedGrid?.destroy();
    embeddedGrid = null;
    viewport.removeEventListener("scroll", onViewportScroll);
    body.removeEventListener("compositionstart", onCompositionStart);
    body.removeEventListener("compositionend", onCompositionEnd);
    // ドラッグ中の window リスナーが残らないよう、teardown 時に外す。
    detailResizeCleanup?.();
  }

  /** 言語切替時、組み込み済み DOM の文言を再適用する（再描画なし）。 */
  function localize() {
    const t = text();
    filterInput.placeholder = t.grid.searchPlaceholder;
    refreshBtn.title = t.grid.refreshAction;
    refreshBtn.setAttribute("aria-label", t.grid.refreshAction);
    exportBtn.title = t.grid.exportAction;
    exportBtn.setAttribute("aria-label", t.grid.exportAction);
    newRowBtn.textContent = t.edit.newRow;
    commitBtn.textContent = t.edit.commit;
    discardBtn.textContent = t.edit.discard;
    showPendingStatus();
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

  /* ---- Row editing helpers ---- */
  function isEditable(): boolean {
    return (
      !embedded &&
      callbacks.getEditable?.() === true &&
      typeof callbacks.applyMutations === "function"
    );
  }

  function pkColumnIndices(): number[] {
    const idx: number[] = [];
    for (let i = 0; i < columns.length; i++) {
      if (columns[i].primaryKey) idx.push(i);
    }
    return idx;
  }

  function hasPrimaryKey(): boolean {
    return columns.some((c) => c.primaryKey);
  }

  // 行を一意に識別するキー (PK 値の連結)。PK が無い、または PK 値に
  // null/blob を含む行は編集不可 (null を返す)。
  function rowKeyFor(rowData: DbValue[]): string | null {
    const idx = pkColumnIndices();
    if (idx.length === 0) return null;
    const parts: string[] = [];
    for (const i of idx) {
      const v = rowData[i];
      if (v === null || v instanceof Uint8Array) return null;
      parts.push(String(v));
    }
    return JSON.stringify(parts);
  }

  function pkCellsFor(rowData: DbValue[]): DbCellInput[] {
    return pkColumnIndices().map((i) => ({
      column: columnNames[i],
      value: String(rowData[i]),
    }));
  }

  function nonEmptyDraftCount(): number {
    // null (明示 NULL) または非空文字を 1 つでも持つドラフトを「入力あり」とする。
    return draftRows.filter((d) =>
      Array.from(d.values()).some((v) => v === null || v !== ""),
    ).length;
  }

  function pendingCount(): number {
    let updates = 0;
    for (const [key, entry] of pendingEdits) {
      if (pendingDeletes.has(key)) continue;
      if (entry.edits.size > 0) updates++;
    }
    return updates + pendingDeletes.size + nonEmptyDraftCount();
  }

  function hasPending(): boolean {
    return pendingCount() > 0;
  }

  function clearPending(): void {
    pendingEdits.clear();
    pendingDeletes.clear();
    draftRows = [];
  }

  function displayRowCount(): number {
    return totalRows + (editMode ? draftRows.length : 0);
  }

  function syncSpacer(): void {
    spacer.style.height = `${displayRowCount() * ROW_HEIGHT}px`;
  }

  function setEditStatus(message: string): void {
    editStatus.textContent = message;
  }

  function refreshEditButtons(): void {
    const editable = isEditable();
    // 書き込み非対応データストア (Redis 等) では editWrap 自体を hidden にして
    // 場所も奪う。書き込み対応のときは editMode の ON/OFF に関わらず editWrap
    // の幅を確保し、子要素は visibility 切替だけにする (レイアウトシフト回避)。
    editWrap.hidden = !editable;
    if (!editable) {
      notifyEditableIfChanged();
      return;
    }
    const inert = !editMode;
    setControlVisibility(newRowBtn, !inert);
    setControlVisibility(commitBtn, !inert);
    setControlVisibility(discardBtn, !inert);
    setControlVisibility(editStatus, !inert);
    const count = pendingCount();
    commitBtn.disabled = count === 0;
    discardBtn.disabled = count === 0;
    notifyEditableIfChanged();
  }

  // editMode OFF のとき、ボタン/ステータスを「見せない・触れない」が「場所は
  // 確保する」状態にするためのヘルパ。display:none / hidden だと幅が縮んで
  // 隣の export ボタン等が右に寄る (レイアウトシフト) ため visibility 制御。
  function setControlVisibility(el: HTMLElement, visible: boolean): void {
    el.style.visibility = visible ? "" : "hidden";
    // テスト用 DOM シムでは HTMLButtonElement グローバルが無いことがあるため
    // instanceof は使わず、tabIndex プロパティの有無で判定する。
    if ("tabIndex" in el) {
      (el as HTMLElement & { tabIndex: number }).tabIndex = visible ? 0 : -1;
    }
    el.setAttribute("aria-hidden", visible ? "false" : "true");
  }

  // 外部 (database-view の prefs バー) が editable / editMode の変化を購読する
  // ための仕組み。editToggle UI を削除した代わり、状態通知はこの listener 経由。
  const editableListeners = new Set<(editable: boolean) => void>();
  const editModeListeners = new Set<(on: boolean) => void>();
  let lastEditableNotified: boolean | null = null;
  function notifyEditableIfChanged(): void {
    const v = isEditable();
    if (v === lastEditableNotified) return;
    lastEditableNotified = v;
    for (const fn of editableListeners) fn(v);
  }
  function notifyEditMode(): void {
    for (const fn of editModeListeners) fn(editMode);
  }
  function onEditableChange(listener: (editable: boolean) => void): () => void {
    editableListeners.add(listener);
    listener(isEditable());
    return () => editableListeners.delete(listener);
  }
  function onEditModeChange(listener: (on: boolean) => void): () => void {
    editModeListeners.add(listener);
    listener(editMode);
    return () => editModeListeners.delete(listener);
  }

  function showPendingStatus(): void {
    const count = pendingCount();
    setEditStatus(
      editMode && count > 0
        ? text().edit.pending(count)
        : editMode && !hasPrimaryKey()
          ? text().edit.noPrimaryKey
          : "",
    );
  }

  function recordEdit(
    rowData: DbValue[],
    colIndex: number,
    value: string | null,
  ): void {
    const key = rowKeyFor(rowData);
    if (key === null) return;
    let entry = pendingEdits.get(key);
    if (!entry) {
      entry = { pk: pkCellsFor(rowData), edits: new Map() };
      pendingEdits.set(key, entry);
    }
    const original = rowData[colIndex];
    // 元が NULL/blob のときは originalStr=null。null vs null も「変更なし」と
    // 判定し、元 NULL を黙って "" に書き換えてしまわないようにする。
    const originalStr =
      original === null || original instanceof Uint8Array
        ? null
        : String(original);
    if (value === originalStr) {
      entry.edits.delete(colIndex);
      if (entry.edits.size === 0) pendingEdits.delete(key);
    } else {
      entry.edits.set(colIndex, value);
    }
    refreshEditButtons();
    showPendingStatus();
  }

  function toggleDelete(rowData: DbValue[]): boolean {
    const key = rowKeyFor(rowData);
    if (key === null) return false;
    if (pendingDeletes.has(key)) pendingDeletes.delete(key);
    else pendingDeletes.set(key, pkCellsFor(rowData));
    refreshEditButtons();
    showPendingStatus();
    return pendingDeletes.has(key);
  }

  function buildMutations(): RowMutation[] {
    const muts: RowMutation[] = [];
    for (const pk of pendingDeletes.values()) {
      muts.push({ kind: "delete", pk });
    }
    for (const [key, entry] of pendingEdits) {
      if (pendingDeletes.has(key)) continue;
      if (entry.edits.size === 0) continue;
      const values: DbCellInput[] = Array.from(entry.edits).map(([c, v]) => ({
        column: columnNames[c],
        value: v,
      }));
      muts.push({ kind: "update", pk: entry.pk, values });
    }
    for (const draft of draftRows) {
      // null=明示 NULL, 非空文字=値。空文字 "" は「未入力」として省略し
      // DB デフォルトに委ねる。
      const values: DbCellInput[] = Array.from(draft)
        .filter(([, v]) => v === null || v !== "")
        .map(([c, v]) => ({ column: columnNames[c], value: v }));
      if (values.length > 0) muts.push({ kind: "insert", values });
    }
    return muts;
  }

  async function setEditMode(on: boolean): Promise<boolean> {
    if (on === editMode) return true;
    if (!on && hasPending()) {
      const ok = await showConfirmDialog({
        body: text().edit.confirmDiscard,
        confirmLabel: text().edit.discard,
        danger: true,
      });
      if (!ok) return false;
    }
    editMode = on;
    if (!on) clearPending();
    notifyEditMode();
    // 編集モード切替時は input 中のセルがあっても解除する。
    editingCellRow = -1;
    editingCellCol = -1;
    syncSpacer();
    refreshEditButtons();
    showPendingStatus();
    renderViewport();
  }

  async function commitPending(): Promise<void> {
    if (!callbacks.applyMutations) return;
    const mutations = buildMutations();
    if (mutations.length === 0) return;
    setEditStatus(text().edit.committing);
    commitBtn.disabled = true;
    discardBtn.disabled = true;
    try {
      await callbacks.applyMutations(mutations);
      clearPending();
      await invalidateData();
      syncSpacer();
      setEditStatus("");
    } catch (err) {
      setEditStatus(
        text().edit.commitError(
          err instanceof Error ? err.message : String(err),
        ),
      );
    } finally {
      refreshEditButtons();
    }
  }

  newRowBtn.addEventListener("click", () => {
    draftRows.push(new Map());
    syncSpacer();
    refreshEditButtons();
    showPendingStatus();
    renderViewport();
    // 追加した行が見えるよう末尾へスクロールしてから再描画する。
    viewport.scrollTop = viewport.scrollHeight;
    renderViewport();
  });
  discardBtn.addEventListener("click", async () => {
    if (!hasPending()) return;
    const ok = await showConfirmDialog({
      body: text().edit.confirmDiscard,
      confirmLabel: text().edit.discard,
      danger: true,
    });
    if (!ok) return;
    clearPending();
    syncSpacer();
    refreshEditButtons();
    setEditStatus("");
    renderViewport();
  });
  commitBtn.addEventListener("click", () => {
    void commitPending();
  });

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
    refresh: refreshCurrentTable,
    showError,
    applyState,
    getState,
    clear,
    destroy,
    localize,
    refreshForeignKeys,
    setEditMode,
    getEditMode: () => editMode,
    isEditable,
    onEditableChange,
    onEditModeChange,
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
