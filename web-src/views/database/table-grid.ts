import { createRef, type Ref, ref } from "lit/directives/ref.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { html, nothing } from "lit/html.js";
import { apiUrl } from "../../core/api-url";
import { relativeTimeText } from "../../core/blame";
import { showCopyFailure } from "../../core/copy-failure";
import { inCellRange } from "../../core/database/cell-range";
import { isFutureTime } from "../../core/database/recency";
import { formatInZone } from "../../core/database/time-zone";
import type {
  DbCellInput,
  DbColumn,
  DbForeignKey,
  DbOrderDirection,
  DbTableDataResponse,
  DbValue,
  RowMutation,
} from "../../core/database/types";
import { attachDragResizer } from "../../core/drag-resizer";
import { formatErrorDetail } from "../../core/error-detail";
import { isEditableKeyTarget } from "../../core/focus-scope";
import {
  DOWNLOAD_16_PATHS,
  HISTORY_16_PATH,
  LINK_16_PATH,
  SEARCH_16_PATH,
  SYNC_16_PATH,
} from "../../core/icons";
import { isImeComposing } from "../../core/keyboard";
import {
  highlightToInnerHtml,
  loadShikiHighlighter,
  type ShikiHighlighter,
} from "../../core/shiki-loader";
import {
  readStoredSize,
  reportStoredSizeFailure,
  writeStoredSize,
} from "../../core/stored-size";
import type { AnnotationDatabaseDataState } from "../../core/types";
import { pageLanguage } from "../page-language";
import { currentRowHeight } from "../shell/row-height";
import { phoneMediaQuery } from "../shell/workspace";
import { iconTemplate } from "../ui/icon";
import {
  templateElement,
  templateElements,
  templateFragment,
} from "../ui/renderer";
import { showConfirmDialog } from "../ui-dialog";
import { createDetailTabs } from "./detail-tabs";
import { createGridRangeSelect } from "./grid-range-select";
import {
  createGridRecency,
  createRefreshMarks,
  RECENCY_COLUMN_WIDTH,
} from "./grid-recency";
import { type DbText, dbText } from "./i18n";
import { nullOrEmptyMark } from "./query-value";
import {
  type RelatedCount,
  type RelatedEntry,
  renderRelatedHead,
  renderRelatedList as renderRelatedListView,
} from "./related-list";
import { reportDatastoreFailure } from "./report-failure";
import { renderRowDetail } from "./row-detail";
import { createTimeZonePicker } from "./time-zone-picker";

// 行の高さは一覧の行と同じ表示密度の値 (views/shell/row-height.ts)。CSS の
// .db-grid-row は同じ値を --ui-row-h で読む。
// 行番号列の幅。CSS の .db-grid-rownum (flex: 0 0 50px) と対で維持する。
// 矢印キー移動で「移動先の列が見えているか」を測るのに使う。
const ROWNUM_WIDTH = 50;
const OVERSCAN = 20;
const PAGE_SIZE = 200;
const MAX_PAGE_CACHE_PAGES = 32;
const FILTER_DEBOUNCE_MS = 300;
const DEFAULT_COL_WIDTH = 180;
const CELL_PREVIEW_MAX_CHARS = 4000;
// 詳細フッタの JSON をハイライトする上限。矢印キーでセルを移動すると 1 打ごとに
// フッタを組み直すので、極端に大きい値では色付けを諦めて素のテキストで出す
// (表示内容は変わらない)。
const DETAIL_JSON_HIGHLIGHT_MAX_CHARS = 100000;
const RELATED_PANEL_DEFAULT_HEIGHT = 320;
const RELATED_PANEL_MIN_HEIGHT = 60;
const DETAIL_PANEL_DEFAULT_HEIGHT = 200;
const DETAIL_PANEL_MIN_HEIGHT = 40;
// MAX は画面サイズに追従する (parent.clientHeight - 余白)。固定値だと
// 大画面で 700 が窮屈、小画面で 700 がはみ出る。reserve は「グリッド上部の
// 最低残し量」。resize handle 自体は panel 上端にあるので、reserve が極小でも
// ハンドル自体は掴める。
const PANEL_MAX_RESERVE = 20;
// 関連パネル左リストの幅。既定 / 下限 / 上限はここが出所で、CSS 側は
// var(--db-related-list-w, ...) の fallback だけを持つ (JS 実行前の初回描画用)。
const RELATED_LIST_DEFAULT_WIDTH = 280;
// 関連の一覧の件数を同時に数える本数 (表の多い DB で一度に投げすぎない)。
const RELATED_COUNT_CONCURRENCY = 4;
const RELATED_LIST_MIN_WIDTH = 120;
const RELATED_LIST_MAX_WIDTH = 480;
const RELATED_LIST_WIDTH_KEY = "code-viewer:db-related-list-width";

// 矢印キー 1 打あたりの移動量。データセル間だけを動き、行番号列と
// 新規行ドラフトには入らない。
// コピーの結果を表の下の行に出しておく時間 (失敗は次の操作まで残す)。
const COPY_NOTICE_MS = 6000;

const ARROW_STEP: Record<string, { row: number; col: number }> = {
  ArrowUp: { row: -1, col: 0 },
  ArrowDown: { row: 1, col: 0 },
  ArrowLeft: { row: 0, col: -1 },
  ArrowRight: { row: 0, col: 1 },
};

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
  /**
   * 埋め込みグリッドで Shift+Tab が押されたとき、親グリッドへフォーカスを戻す。
   * 関連パネルに入ったキーボード操作が出られなくなるのを防ぐ。
   */
  onFocusParentGrid?: () => void;
  /** 表を開いたときに新しい行を先頭に並べるか (利用者の設定。既定は親が決める)。 */
  getNewestFirst?: () => boolean;
  /** 「新しい順」を切り替えたとき、次に開く表のために覚える。失敗は throw。 */
  setNewestFirst?: (on: boolean) => Promise<void>;
  /** 日時の列を出し直すタイムゾーンの設定 ("" = 元の値、"local"、IANA の名前)。 */
  getTimeZone?: () => string;
  /** タイムゾーンを選んだとき、覚える (null = 元の値に戻す)。失敗は throw。 */
  setTimeZone?: (pref: string | null) => Promise<void>;
  /** ユーザー操作のリロードが成功したとき、親ビューへ件数同期の機会を通知する。 */
  onRefreshComplete?: (event: {
    table: string;
    totalRows: number;
    filters: GridFilter[];
  }) => void;
};

export type TableGridOptions = {
  /** 埋め込みグリッド（関連データ表示用）では関連パネル機能を無効化する。 */
  embedded?: boolean;
};

export type TableGrid = {
  el: HTMLElement;
  /** グリッド本体へフォーカスを移す (矢印キーの受け手を切り替える)。 */
  focusGrid: () => void;
  /**
   * 表を描く。`fetchedSort` は initialData を取ったときの並べ方 (null = 並べて
   * いない)。省略すると表が自分で決め、取った並びと違えば取り直す。
   */
  load: (
    table: string,
    initialData?: DbTableDataResponse,
    fetchedSort?: GridSort | null,
  ) => void;
  /** この列の表を開くときの並べ方 (「新しい順」の設定で決まる)。 */
  initialSortFor: (columns: DbColumn[]) => GridSort | null;
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

const SHELL_PARTS = [
  "filterInput",
  "filterClear",
  "refreshBtn",
  "refreshLabel",
  "refreshResult",
  "exportWrap",
  "exportBtn",
  "exportMenu",
  "exportCsv",
  "exportJson",
  "editWrap",
  "newRowBtn",
  "commitBtn",
  "discardBtn",
  "editStatus",
  "newestBtn",
  "newestLabel",
  "headerRow",
  "filterRow",
  "viewport",
  "spacer",
  "body",
  "filteredEmpty",
  "filteredEmptyTitle",
  "filteredEmptyHint",
  "filteredEmptyActions",
  "filteredEmptyReloadAction",
  "filteredEmptyAction",
  "detailPanel",
  "detailResize",
  "head",
] as const;

/** 外枠の中で、表が後から書き込む要素。 */
export type TableGridShellRefs = Record<
  (typeof SHELL_PARTS)[number],
  Ref<HTMLElement>
>;

function createShellRefs(): TableGridShellRefs {
  return Object.fromEntries(
    SHELL_PARTS.map((name) => [name, createRef<HTMLElement>()]),
  ) as TableGridShellRefs;
}

function shellPart<T extends HTMLElement = HTMLElement>(
  part: Ref<HTMLElement>,
): T {
  const element = part.value;
  if (!element)
    throw new Error("table grid: a part of the shell was not drawn");
  return element as T;
}

/**
 * 表の描き方。表は仮想スクロールで行を組み直し、選択・編集・列幅の変更の
 * たびに要素へ直接書き込むので、view は要素の形 (テンプレート) だけを持つ。
 * presenter (createTableGrid) は作った要素を受け取り、中身を書き換える。
 */
export type TableGridView = {
  /** 検索の行・見出し・本文・詳細の欄の外枠。 */
  shell: (props: {
    text: DbText;
    timeZone: HTMLElement;
    refs: TableGridShellRefs;
  }) => unknown;
  /** 関連の行を出す下のパネルの箱 (中身は relatedParts)。 */
  relatedPanel: (height: number) => unknown;
  /** 関連パネルの中身: 上端のつまみ・見出し・一覧と表。 */
  relatedParts: (props: {
    text: DbText;
    /** 関連の行を出す埋め込みの表。 */
    grid: HTMLElement;
    refs: {
      crumbs: Ref<HTMLElement>;
      copy: Ref<HTMLButtonElement>;
      list: Ref<HTMLElement>;
      listResize: Ref<HTMLElement>;
      gridHost: Ref<HTMLElement>;
      head: Ref<HTMLElement>;
      empty: Ref<HTMLElement>;
    };
    onResizeStart: (event: MouseEvent) => void;
    onCopy: (button: HTMLButtonElement) => void;
    onClose: () => void;
  }) => unknown;
  /** ドリルの経路。最後の段は今の表、ほかは押すとその段へ戻る。 */
  relatedCrumbs: (props: {
    origin: string;
    levels: { table: string; onClick: () => void }[];
  }) => unknown;
  relatedEmptyNote: (note: string) => unknown;
  /** 列幅を中身に合わせるときに文字の幅を測る、見えない箱。 */
  measure: () => unknown;
  /** セルの詳細の見出し (タブ・題・コピー・閉じる) と、コピーの結果の行。 */
  detailHeader: (props: {
    text: DbText["detail"];
    tabs: HTMLElement;
    title: string;
    copyStatusRef: Ref<HTMLElement>;
    onCopy: () => void;
    onClose: () => void;
  }) => unknown;
  /** セルの詳細の JSON の欄 (色付けは後から入れる)。 */
  detailJson: () => unknown;
  /** 列の見出しの行の中身。 */
  header: (props: {
    text: DbText;
    /** 「変更」の列の見出し (出さないときは null)。 */
    recency: HTMLElement | null;
    columns: {
      name: string;
      width: number;
      sort: DbOrderDirection | null;
      /** 日時の列を出し直しているタイムゾーンの短い名前。 */
      zone: string | null;
      foreignKey: boolean;
      onSort: () => void;
      onResizeStart: (event: MouseEvent) => void;
      onAutoFit: (event: MouseEvent) => void;
    }[];
  }) => unknown;
  /** 列ごとの絞り込みの行の中身。 */
  filterRow: (props: {
    recency: HTMLElement | null;
    columns: {
      width: number;
      placeholder: string;
      value: string;
      onInput: (input: HTMLInputElement) => void;
      onKeydown: (input: HTMLInputElement, event: KeyboardEvent) => void;
    }[];
  }) => unknown;
  /** 編集モードの表示のセル (ダブルクリックで入力の欄にする)。 */
  displayCell: (props: {
    width: number;
    value: string | null;
    emptyLabel: string;
    readonly: boolean;
    /** 編集できるセルの案内 (読み取り専用なら null で、ダブルクリックも無し)。 */
    editHint: string | null;
    onActivate: (event: MouseEvent) => void;
    onEnterEdit: (event: MouseEvent) => void;
  }) => unknown;
  /** 編集モードの入力のセル。nullTitle があれば NULL を入れるボタンも出す。 */
  inputCell: (props: {
    width: number;
    value: string | null;
    readonly: boolean;
    rowIndex: number;
    colIndex: number;
    inputRef: Ref<HTMLInputElement>;
    nullTitle: string | null;
    onInput: () => void;
    onBlur: (event: FocusEvent) => void;
    onKeydown: (event: KeyboardEvent) => void;
    onSetNull: (event: MouseEvent) => void;
  }) => unknown;
  /** 行 (行番号と「変更」の列まで。セルは後から足す)。 */
  row: (props: {
    className: string;
    rowNum: {
      className: string;
      label: string;
      title: string | null;
      ref: Ref<HTMLElement>;
    };
    recency: HTMLElement | null;
  }) => unknown;
  /** まだ読み込んでいない行のセル。 */
  loadingCells: (widths: number[]) => unknown;
  /** 読み取りの行のセル。 */
  dataCells: (props: {
    emptyLabel: string;
    cells: {
      width: number;
      value: DbValue;
      text: string;
      timeTitle: string | null;
      blob: boolean;
      inRange: boolean;
      foreignKey: boolean;
      active: boolean;
      onClick: (event: MouseEvent) => void;
    }[];
  }) => unknown;
  /** 書き出しを落とすためのリンク (押した後に外す)。 */
  exportLink: (props: { href: string; download: string }) => unknown;
  /** 足元のページ送り。 */
  pager: (props: {
    refs: {
      range: Ref<HTMLElement>;
      prev: Ref<HTMLButtonElement>;
      next: Ref<HTMLButtonElement>;
    };
    onPage: (direction: 1 | -1) => void;
  }) => unknown;
  /** 足元の状態の行 (message があれば失敗の文)。 */
  status: (message: string | null) => unknown;
};

const cellStyle = (width: number) => `width: ${width}px; cursor: pointer;`;

const editButtonStyle = "visibility: hidden";

export const DEFAULT_VIEW: TableGridView = {
  relatedPanel: (height) =>
    html`<div class="db-related-panel" hidden style=${`height: ${height}px;`}></div>`,
  relatedParts: (p) =>
    html`<div class="db-related-resize" @mousedown=${p.onResizeStart}></div
      ><div class="db-related-header"><span class="db-related-title" aria-hidden="true"
          >${iconTemplate(LINK_16_PATH, "octicon-link")}</span
        ><span class="db-related-crumbs" ${ref(p.refs.crumbs)}></span><button
          type="button"
          class="db-btn db-grid-detail-copy db-related-copy"
          ${ref(p.refs.copy)}
          @click=${(event: Event) =>
            p.onCopy(event.currentTarget as HTMLButtonElement)}
        >${p.text.detail.copy}</button><button
          type="button"
          class="db-btn db-btn-icon db-related-close"
          @click=${p.onClose}
        >×</button></div
      ><div class="db-related-body"><div class="db-related-list" ${ref(p.refs.list)}></div
        ><div
          class="db-related-list-resize"
          tabindex="0"
          role="separator"
          aria-orientation="vertical"
          aria-label=${p.text.grid.relatedListResize}
          ${ref(p.refs.listResize)}
        ></div
        ><div class="db-related-grid-host" ${ref(p.refs.gridHost)}><div
            class="db-related-head"
            ${ref(p.refs.head)}
          ></div>${p.grid}<div class="db-related-empty" hidden ${ref(p.refs.empty)}
            >${p.text.grid.relatedEmpty}</div
          ></div
        ></div
      >`,
  relatedCrumbs: ({ origin, levels }) =>
    html`<span class="db-related-crumb-origin">${origin}</span>${levels.map(
      (level, i) =>
        html`<span class="db-related-crumb-sep">▸</span>${
          i === levels.length - 1
            ? html`<span class="db-related-crumb active">${level.table}</span>`
            : html`<button
                type="button"
                class="db-related-crumb"
                @click=${level.onClick}
              >${level.table}</button>`
        }`,
    )}`,
  relatedEmptyNote: (note) =>
    html`<span class="db-related-empty-note">${note}</span>`,
  measure: () =>
    html`<span
      style="position:absolute;visibility:hidden;white-space:nowrap;font:inherit;padding:0 8px;"
    ></span>`,
  detailHeader: (p) =>
    html`<div class="db-grid-detail-header">${p.tabs}<span
          class="db-grid-detail-title"
          title=${p.title}
          >${p.title}</span
        ><button type="button" class="db-btn db-grid-detail-copy" @click=${p.onCopy}
          >${p.text.copy}</button
        ><button
          type="button"
          class="db-btn db-btn-icon db-grid-detail-close"
          title=${p.text.close}
          aria-label=${p.text.close}
          @click=${p.onClose}
        >×</button></div
      ><span
        class="db-grid-detail-copy-status"
        role="status"
        ${ref(p.copyStatusRef)}
      ></span>`,
  detailJson: () => html`<pre class="db-grid-detail-json"></pre>`,
  displayCell: (p) => {
    const shown = nullOrEmptyMark(p.value, p.emptyLabel);
    return html`<div
      class=${[
        "db-grid-cell db-grid-cell-edit db-grid-cell-display",
        shown?.cellClass ?? "",
        p.readonly ? "readonly" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      style=${cellStyle(p.width)}
      title=${p.editHint ?? nothing}
      @click=${p.onActivate}
      @dblclick=${p.editHint === null ? nothing : p.onEnterEdit}
    >${shown ? shown.mark : (p.value ?? "")}</div>`;
  },
  inputCell: (p) =>
    html`<div
      class="db-grid-cell db-grid-cell-edit"
      style=${`width: ${p.width}px;`}
    ><input
        type="text"
        class=${[
          "db-grid-cell-input",
          p.value === null ? "is-null" : "",
          p.readonly ? "readonly" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        data-edit-row=${p.rowIndex}
        data-edit-col=${p.colIndex}
        placeholder=${p.value === null ? "NULL" : ""}
        ?readonly=${p.readonly}
        .value=${p.value ?? ""}
        ${ref(p.inputRef)}
        @input=${p.onInput}
        @click=${(event: Event) => event.stopPropagation()}
        @blur=${p.onBlur}
        @keydown=${p.onKeydown}
      />${
        p.nullTitle === null
          ? nothing
          : // NULL ボタンを mousedown で抑止すると button へのフォーカス移譲が
            // 起きず input の blur が走らないので、editing が解除されない。
            html`<button
              type="button"
              class="db-grid-cell-null-btn"
              title=${p.nullTitle}
              @mousedown=${(event: Event) => event.preventDefault()}
              @click=${p.onSetNull}
            >∅</button>`
      }</div>`,
  row: ({ className, rowNum, recency }) =>
    html`<div class=${className}><div
        class=${rowNum.className}
        title=${rowNum.title ?? nothing}
        ${ref(rowNum.ref)}
      >${rowNum.label}</div>${recency ?? nothing}</div>`,
  loadingCells: (widths) =>
    widths.map(
      (width) =>
        html`<div class="db-grid-cell loading" style=${`width: ${width}px;`}
          >…</div
        >`,
    ),
  dataCells: ({ emptyLabel, cells }) =>
    cells.map((cell) => {
      const shown = nullOrEmptyMark(cell.value, emptyLabel);
      return html`<div
        class=${[
          "db-grid-cell",
          shown?.cellClass ?? "",
          cell.timeTitle === null ? "" : "db-grid-cell-time",
          cell.blob ? "blob" : "",
          cell.inRange ? "in-range" : "",
          cell.foreignKey ? "db-grid-cell-fk" : "",
          cell.active ? "db-grid-cell-active" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        style=${cellStyle(cell.width)}
        title=${cell.timeTitle ?? nothing}
        @click=${cell.onClick}
      >${shown ? shown.mark : cell.text}</div>`;
    }),
  exportLink: ({ href, download }) =>
    html`<a href=${href} download=${download}></a>`,
  pager: ({ refs, onPage }) =>
    html`<span class="db-grid-pager"><span
        class="db-grid-pager-range"
        ${ref(refs.range)}
      ></span><button
        type="button"
        class="db-grid-pager-btn db-grid-pager-prev"
        ${ref(refs.prev)}
        @click=${() => onPage(-1)}
      >‹</button><button
        type="button"
        class="db-grid-pager-btn db-grid-pager-next"
        ${ref(refs.next)}
        @click=${() => onPage(1)}
      >›</button></span>`,
  status: (message) =>
    message === null
      ? html`<div class="db-grid-status"></div>`
      : html`<div class="db-grid-status db-pane-error">${message}</div>`,
  header: ({ text, recency, columns }) =>
    html`<div class="db-grid-cell db-grid-rownum-header">#</div>${
      recency ?? nothing
    }${columns.map((col) => {
      const onResizeHandle = (event: Event) =>
        (event.target as HTMLElement).classList.contains(
          "db-grid-resize-handle",
        );
      return html`<div
        class=${[
          "db-grid-cell db-grid-header-cell",
          col.sort ? "sorted" : "",
          col.foreignKey ? "db-grid-header-fk" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        data-dir=${col.sort ?? nothing}
        style=${`width: ${col.width}px;`}
        @click=${(event: Event) => {
          // 幅を変えるつまみを押したときは並べ替えない。
          if (!onResizeHandle(event)) col.onSort();
        }}
        @dblclick=${(event: MouseEvent) => {
          if (onResizeHandle(event)) col.onAutoFit(event);
        }}
      ><span class="db-grid-header-label">${col.name}${
        col.zone === null
          ? nothing
          : html`<span class="db-grid-header-tz">${col.zone}</span>`
      }${
        col.foreignKey
          ? html`<span
              class="db-grid-header-fk-icon"
              title=${text.grid.foreignKeyHint}
              >${iconTemplate(LINK_16_PATH, "octicon-link")}</span
            >`
          : nothing
      }</span><span class="db-grid-sort-icon">${
        col.sort === null ? "" : col.sort === "asc" ? "▲" : "▼"
      }</span><div
          class="db-grid-resize-handle"
          @mousedown=${col.onResizeStart}
        ></div></div>`;
    })}`,
  filterRow: ({ recency, columns }) =>
    html`<div
        class="db-grid-cell db-grid-rownum-header db-grid-filter-spacer"
      ></div>${recency ?? nothing}${columns.map(
        (col) =>
          html`<div
          class="db-grid-cell db-grid-filter-cell"
          style=${`width: ${col.width}px;`}
        ><input
            type="search"
            class="db-grid-col-filter"
            placeholder=${col.placeholder}
            autocomplete="off"
            .value=${col.value}
            @input=${(event: Event) =>
              col.onInput(event.currentTarget as HTMLInputElement)}
            @keydown=${(event: KeyboardEvent) =>
              col.onKeydown(event.currentTarget as HTMLInputElement, event)}
          /></div>`,
      )}`,
  shell: ({ text, timeZone, refs }) => {
    const g = text.grid;
    return html`<div class="db-grid"><div class="db-grid-filter-bar"><span
          class="db-grid-filter-icon"
          aria-hidden="true"
          >${iconTemplate(SEARCH_16_PATH, "octicon-search")}</span
        ><input
          type="search"
          class="db-grid-filter-input"
          placeholder=${g.searchPlaceholder}
          autocomplete="off"
          ${ref(refs.filterInput)}
        /><button
          type="button"
          class="db-btn db-btn-sm db-grid-filter-clear"
          hidden
          ${ref(refs.filterClear)}
        >${g.clearFiltersLabel}</button><div
          class="db-grid-edit-controls"
          hidden
          ${ref(refs.editWrap)}
        ><button
            type="button"
            class="db-btn db-grid-edit-newrow"
            style=${editButtonStyle}
            ${ref(refs.newRowBtn)}
          >${text.edit.newRow}</button><button
            type="button"
            class="db-btn db-btn-primary db-grid-edit-commit"
            style=${editButtonStyle}
            ${ref(refs.commitBtn)}
          >${text.edit.commit}</button><button
            type="button"
            class="db-btn db-grid-edit-discard"
            style=${editButtonStyle}
            ${ref(refs.discardBtn)}
          >${text.edit.discard}</button><span
            class="db-grid-edit-status"
            ${ref(refs.editStatus)}
          ></span></div
        ><div class="db-grid-filter-actions">${timeZone}<button
            type="button"
            class="db-btn db-btn-sm db-grid-newest"
            hidden
            aria-pressed="false"
            ${ref(refs.newestBtn)}
          >${iconTemplate(HISTORY_16_PATH, "octicon-history")}<span
              class="db-grid-newest-label"
              ${ref(refs.newestLabel)}
            ></span></button
          ><button
            type="button"
            class="db-btn db-btn-icon db-grid-refresh"
            title=${g.refreshAction}
            aria-label=${g.refreshAction}
            aria-busy="false"
            ${ref(refs.refreshBtn)}
          >${iconTemplate(SYNC_16_PATH, "octicon-sync")}<span
              class="db-grid-refresh-label"
              ${ref(refs.refreshLabel)}
            ></span></button
          ><span
            class="db-refresh-result db-grid-refresh-result"
            aria-live="polite"
            hidden
            ${ref(refs.refreshResult)}
          ></span
          ><div class="db-grid-export" ${ref(refs.exportWrap)}><button
              type="button"
              class="db-btn db-btn-icon db-grid-export-toggle"
              title=${g.exportAction}
              aria-label=${g.exportAction}
              ${ref(refs.exportBtn)}
            >${iconTemplate(DOWNLOAD_16_PATHS, "octicon-download")}</button
            ><div class="db-grid-export-menu" hidden ${ref(refs.exportMenu)}
              ><button
                type="button"
                class="db-grid-export-item"
                ${ref(refs.exportCsv)}
              >CSV</button><button
                type="button"
                class="db-grid-export-item"
                ${ref(refs.exportJson)}
              >JSON</button></div
            ></div
          ></div
        ></div
      ><div class="db-grid-viewport" tabindex="0" ${ref(refs.viewport)}><div
          class="db-grid-head"
          ${ref(refs.head)}
        ><div class="db-grid-header-wrap"><div
              class="db-grid-header"
              ${ref(refs.headerRow)}
            ></div></div
          ><div class="db-grid-filter-row-wrap"><div
              class="db-grid-filter-row"
              ${ref(refs.filterRow)}
            ></div></div
        ></div
        ><div class="db-grid-rows"><div class="db-grid-spacer" ${ref(refs.spacer)}></div
          ><div class="db-grid-body" ${ref(refs.body)}></div></div
        ><div class="db-pane-empty" hidden ${ref(refs.filteredEmpty)}><div
            class="db-pane-empty-title"
            ${ref(refs.filteredEmptyTitle)}
          ></div><div class="db-pane-empty-hint" ${ref(refs.filteredEmptyHint)}></div
          ><div
            class="db-pane-empty-actions"
            hidden
            ${ref(refs.filteredEmptyActions)}
          ><button
              type="button"
              class="db-btn db-btn-icon db-grid-refresh"
              hidden
              disabled
              ${ref(refs.filteredEmptyReloadAction)}
            >${iconTemplate(SYNC_16_PATH, "octicon-sync")}</button><button
              type="button"
              class="db-btn db-btn-sm"
              hidden
              disabled
              ${ref(refs.filteredEmptyAction)}
            ></button></div></div
      ></div
      ><div class="db-grid-detail-panel" hidden ${ref(refs.detailPanel)}><div
          class="db-grid-detail-resize"
          ${ref(refs.detailResize)}
        ></div></div
    ></div>`;
  },
};

export function createTableGrid(
  callbacks: TableGridCallbacks,
  options: TableGridOptions = {},
  view: TableGridView = DEFAULT_VIEW,
): TableGrid {
  const embedded = options.embedded === true;
  // ローカライズ文言。未指定時は英語にフォールバックする。
  const text = (): DbText => callbacks.getText?.() ?? dbText("en");
  // 最近の変化: 行番号の右の「変更」の列と、再読み込みで変わった行の印。
  const recency = createGridRecency({ text });
  const refreshMarks = createRefreshMarks();
  // 日時の列を出し直すタイムゾーン。関連パネルの表は設定を読むだけで、
  // 選択欄は出さない。
  const timeZone = createTimeZonePicker({
    text,
    get: () => callbacks.getTimeZone?.() ?? "",
    set: (pref) => callbacks.setTimeZone?.(pref) ?? Promise.resolve(),
    onChange: () => {
      timeZone.sync();
      renderHeader();
      renderViewport();
    },
  });

  // 外枠 (検索の行・見出し・本文・詳細の欄) は 1 度だけ作り、以後は要素へ
  // 直接書き込む (仮想スクロールで行を組み直すので、全体を描き直さない)。
  const shell = createShellRefs();
  const el = templateElement(
    view.shell({ text: text(), timeZone: timeZone.el, refs: shell }),
  );
  const filterInput = shellPart<HTMLInputElement>(shell.filterInput);
  const filterClear = shellPart<HTMLButtonElement>(shell.filterClear);
  const refreshBtn = shellPart<HTMLButtonElement>(shell.refreshBtn);
  const refreshLabel = shellPart(shell.refreshLabel);
  const refreshResult = shellPart(shell.refreshResult);
  const exportWrap = shellPart(shell.exportWrap);
  const exportBtn = shellPart<HTMLButtonElement>(shell.exportBtn);
  const exportMenu = shellPart(shell.exportMenu);
  const editWrap = shellPart(shell.editWrap);
  const newRowBtn = shellPart<HTMLButtonElement>(shell.newRowBtn);
  const commitBtn = shellPart<HTMLButtonElement>(shell.commitBtn);
  const discardBtn = shellPart<HTMLButtonElement>(shell.discardBtn);
  const editStatus = shellPart(shell.editStatus);
  const newestBtn = shellPart<HTMLButtonElement>(shell.newestBtn);
  const newestLabel = shellPart(shell.newestLabel);
  const headerRow = shellPart(shell.headerRow);
  const filterRow = shellPart(shell.filterRow);
  const viewport = shellPart(shell.viewport);
  const spacer = shellPart(shell.spacer);
  const body = shellPart(shell.body);
  const filteredEmpty = shellPart(shell.filteredEmpty);
  const filteredEmptyTitle = shellPart(shell.filteredEmptyTitle);
  const filteredEmptyHint = shellPart(shell.filteredEmptyHint);
  const filteredEmptyActions = shellPart(shell.filteredEmptyActions);
  const filteredEmptyReloadAction = shellPart<HTMLButtonElement>(
    shell.filteredEmptyReloadAction,
  );
  const filteredEmptyAction = shellPart<HTMLButtonElement>(
    shell.filteredEmptyAction,
  );
  const detailPanel = shellPart(shell.detailPanel);
  const detailResize = shellPart(shell.detailResize);
  const head = shellPart(shell.head);

  // エクスポートは検索バー右端のアイコン+メニューに集約する。これにより
  // 「どのグリッドのエクスポートか」が見た目で分かる（メイン/関連で別々）。
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
  shellPart(shell.exportCsv).addEventListener("click", () => {
    closeExportMenu();
    triggerExport("csv");
  });
  shellPart(shell.exportJson).addEventListener("click", () => {
    closeExportMenu();
    triggerExport("json");
  });

  // 足元のページ送りの「見えている行の範囲」は、表の高さが変わったとき
  // (セルの詳細を開く・下のパネルを動かす) にも合わせる。ResizeObserver の
  // 無い DOM (テストの一部の環境) では、スクロールしたときにだけ合わせる。
  if (typeof ResizeObserver === "function")
    new ResizeObserver(() => syncPager()).observe(viewport);

  // 幅不足で省略 (…) されたセルだけ、ホバー時に全文をネイティブ tooltip で
  // 見せる。セルごとに title を仕込むとノイズ＆再描画コストになるので、
  // body 上のイベント委譲 + その場測定にする。編集ヒント等の既存 title は
  // 触らない (自分が付けた分は data 属性で区別して毎回張り直す)。
  body.addEventListener("mouseover", (e) => {
    const cell = (e.target as HTMLElement | null)?.closest<HTMLElement>(
      ".db-grid-cell",
    );
    if (!cell || !body.contains(cell)) return;
    if (cell.dataset.gridTooltip) {
      delete cell.dataset.gridTooltip;
      cell.removeAttribute("title");
    }
    if (cell.title) return;
    if (cell.querySelector("input, textarea, select")) return;
    if (cell.scrollWidth > cell.clientWidth + 1) {
      cell.title = cell.textContent ?? "";
      cell.dataset.gridTooltip = "1";
    }
  });

  // 詳細の欄の上端のドラッグハンドル。関連パネル (.db-related-resize) と同じ
  // 構造で、ドラッグ確定時にコールバック経由でタブ状態へ保存する。
  detailResize.addEventListener("mousedown", startDetailResize);

  /** 行が見える高さ (本文の箱から、上に貼り付けた頭の高さを引く)。 */
  function rowsViewHeight(): number {
    return Math.max(0, viewport.clientHeight - head.offsetHeight);
  }

  // セルの範囲を選んでコピーする (ドラッグ・Shift・⌘/Ctrl+A・⌘/Ctrl+C)。
  const rangeSelect = createGridRangeSelect({
    body,
    viewport,
    enabled: () => !editMode && currentTable !== "",
    renderStartRow: () => renderStartRow,
    totalRows: () => totalRows,
    columnNames: () => columnNames,
    leadingCellCount,
    rowHeight: currentRowHeight,
    active: () =>
      activeCellRowIndex >= 0 && activeCellColIndex >= 0
        ? { row: activeCellRowIndex, col: activeCellColIndex }
        : null,
    setActive: (point, scroll) => {
      setActiveCell(point.row, point.col);
      setSelectedRow(
        point.row,
        (body.children[point.row - renderStartRow] as HTMLElement) ?? null,
      );
      if (scroll) scrollCellIntoView(point.row, point.col);
    },
    generation: () => loadGeneration,
    rowsBetween,
    cellText: cellCopyText,
    text,
    notice: showCopyNotice,
    table: () => currentTable,
  });
  let copyNotice = "";
  let copyNoticeTimer: ReturnType<typeof setTimeout> | null = null;

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
  // 行の先頭に固定する列: 行番号と、時刻の列がある表では「変更」の列。
  function leadingCellCount(): number {
    return recency.shown() ? 2 : 1;
  }
  /**
   * 左に固定した列の幅。電話の段では「変更」の列を固定しない (行番号と合わせて
   * 145px を取り、データの列に幅が残らなかった。style.css の SP の節)。
   */
  function pinnedWidth(): number {
    const recencyPinned = recency.shown() && !phoneMediaQuery().matches;
    return ROWNUM_WIDTH + (recencyPinned ? RECENCY_COLUMN_WIDTH : 0);
  }

  function setActiveCell(rowIndex: number, colIndex: number) {
    activeCellRowIndex = rowIndex;
    activeCellColIndex = colIndex;
    if (activeCellElement?.isConnected) {
      activeCellElement.classList.remove("db-grid-cell-active");
    } else {
      for (const c of body.querySelectorAll(".db-grid-cell-active")) {
        c.classList.remove("db-grid-cell-active");
      }
    }
    activeCellElement = null;
    if (rowIndex < 0 || colIndex < 0) return;
    // 先頭の固定の列 (行番号と「変更」) の分だけずれる。
    const targetRow = body.children[rowIndex - renderStartRow] as
      | HTMLElement
      | undefined;
    const targetCell = targetRow?.children[colIndex + leadingCellCount()];
    if (!targetCell) return;
    targetCell.classList.add("db-grid-cell-active");
    activeCellElement = targetCell;
  }

  function setSelectedRow(rowIndex: number, row: HTMLElement | null) {
    selectedRowIndex = rowIndex;
    if (selectedRowElement?.isConnected) {
      selectedRowElement.classList.remove("selected");
    } else {
      body.querySelectorAll(".db-grid-row.selected").forEach((r) => {
        r.classList.remove("selected");
      });
    }
    selectedRowElement = row;
    row?.classList.add("selected");
  }

  function clearActiveCell() {
    setActiveCell(-1, -1);
  }

  // クリックでも矢印キーでも「いまどのセルに居るか」をここで確定する。
  // viewport へフォーカスを移すのは、直後の矢印キーをこのグリッドで
  // 受けるため (viewport は tabIndex=0)。
  function focusCell(
    rowIndex: number,
    row: HTMLElement | null,
    colIndex: number,
  ) {
    setSelectedRow(rowIndex, row);
    setActiveCell(rowIndex, colIndex);
    viewport.focus({ preventScroll: true });
  }

  // 指定セルを現在地にし、見える位置まで寄せて、詳細フッタを合わせる。
  // 仮想スクロール中は移動先の行が未描画のことがあるが、setActiveCell /
  // setSelectedRow は state を持つので、次の renderViewport で色が付く。
  function moveActiveCell(rowIndex: number, colIndex: number) {
    const rendered = body.children[rowIndex - renderStartRow] as
      | HTMLElement
      | undefined;
    focusCell(rowIndex, rendered ?? null, colIndex);
    // 矢印キーで動いたら、選んでいた範囲は今のセルだけに戻す。
    rangeSelect.collapse();
    scrollCellIntoView(rowIndex, colIndex);
    showDetailForActiveCell();
  }

  // 移動先が隠れているときだけ、見える位置まで寄せる (中央寄せはしない。
  // 1 セルずつ動かすたびに画面が飛ぶため)。clientHeight / clientWidth が 0
  // のとき (非表示・レイアウト前) は測れないので何もしない。
  function scrollCellIntoView(rowIndex: number, colIndex: number) {
    const viewHeight = rowsViewHeight();
    if (viewHeight > 0) {
      const top = rowIndex * currentRowHeight();
      const bottom = top + currentRowHeight();
      if (top < viewport.scrollTop) viewport.scrollTop = top;
      else if (bottom > viewport.scrollTop + viewHeight) {
        viewport.scrollTop = bottom - viewHeight;
      }
    }
    const viewWidth = viewport.clientWidth;
    if (viewWidth <= 0) return;
    const pinned = pinnedWidth();
    let left = pinned;
    for (let c = 0; c < colIndex; c++) left += getColWidth(columnNames[c]);
    const right = left + getColWidth(columnNames[colIndex]);
    if (left < viewport.scrollLeft + pinned) {
      // 固定した行番号 (と「変更」の列) の右側まで戻し、選択セルがその裏に
      // 隠れないようにする。
      viewport.scrollLeft = left - pinned;
    } else if (right > viewport.scrollLeft + viewWidth) {
      viewport.scrollLeft = right - viewWidth;
    }
  }

  // キャッシュ済みページから 1 行を取り出す。未読込なら undefined。
  function cachedRow(rowIndex: number): DbValue[] | undefined {
    const pageStart = Math.floor(rowIndex / PAGE_SIZE) * PAGE_SIZE;
    return getCachedPage(pageStart)?.[rowIndex - pageStart];
  }

  // キャッシュ済みページからセル値を取り出す。未読込は undefined を返す
  // (SQL の NULL は null で返るので、未読込と区別が付く)。
  function cachedCellValue(
    rowIndex: number,
    colIndex: number,
  ): DbValue | undefined {
    const row = cachedRow(rowIndex);
    return row ? row[colIndex] : undefined;
  }

  // active セルの強調は「詳細フッタ / 関連パネルに出している値の元セル」を
  // 意味するので、現在地が動いたらフッタも同じセルへ合わせる。移動先の
  // ページが未読込なら、取得を待ってから出す (待つ間に別のセルへ移って
  // いたら、そのときの結果を優先して捨てる)。
  function showDetailForActiveCell() {
    const rowIndex = activeCellRowIndex;
    const colIndex = activeCellColIndex;
    if (rowIndex < 0 || colIndex < 0) return;
    const value = cachedCellValue(rowIndex, colIndex);
    if (value !== undefined) {
      showCellDetail(colIndex, value);
      return;
    }
    const pageStart = Math.floor(rowIndex / PAGE_SIZE) * PAGE_SIZE;
    void ensurePage(pageStart).then(() => {
      if (activeCellRowIndex !== rowIndex || activeCellColIndex !== colIndex) {
        return;
      }
      const loaded = cachedCellValue(rowIndex, colIndex);
      if (loaded !== undefined) showCellDetail(colIndex, loaded);
    });
  }

  // Tab / Shift+Tab で、メイングリッドと関連パネルの埋め込みグリッドの間を
  // 行き来する。引き受けたら true。関連パネルが閉じているときや、戻り先が
  // 無いときは false を返してブラウザ既定のフォーカス移動に任せる。
  function moveGridFocus(back: boolean): boolean {
    if (back) {
      if (!embedded || !callbacks.onFocusParentGrid) return false;
      callbacks.onFocusParentGrid();
      return true;
    }
    if (embedded || !relatedPanel || relatedPanel.hidden || !embeddedGrid) {
      return false;
    }
    embeddedGrid.focusGrid();
    return true;
  }

  // Escape は「いま開いている方」を閉じる。どちらも閉じているなら何もせず
  // false を返す (アプリ側の Escape を潰さない)。
  function closeOpenPanel(): boolean {
    if (relatedPanel && !relatedPanel.hidden) {
      hideRelatedPanel();
      clearActiveCell();
      return true;
    }
    if (!detailPanel.hidden) {
      detailPanel.hidden = true;
      clearDetailContent();
      clearActiveCell();
      return true;
    }
    return false;
  }

  // Enter は「いまのセルをクリックしたのと同じ」。矢印キーの移動では FK を
  // 辿らない (1 打ごとに参照先へクエリが飛ぶため) ので、辿る操作はここに置く。
  function activateActiveCell(): boolean {
    const rowIndex = activeCellRowIndex;
    const colIndex = activeCellColIndex;
    if (rowIndex < 0 || colIndex < 0) return false;
    const rowValues = cachedRow(rowIndex);
    if (!rowValues) return false;
    const colName = columnNames[colIndex];
    const fkClickable =
      fkColumns.has(colName) &&
      (!embedded || !!callbacks.onForeignKeyCellClick);
    if (!fkClickable) {
      showDetailForActiveCell();
      return true;
    }
    if (embedded) {
      callbacks.onForeignKeyCellClick?.(
        currentTable,
        columnNames,
        rowValues,
        colName,
      );
    } else {
      openRelatedForRow(currentTable, columnNames, rowValues, colName);
    }
    return true;
  }

  // viewport にフォーカスがある間、矢印キーでデータセル間を移動する。
  // FK セルへ移動しても関連パネル (= 参照先テーブルの取得) は開かない。
  // キーを 1 打するたびにクエリが飛ぶのを避けるため、FK を辿る操作は
  // クリック側に残してある。
  function onViewportKeydown(e: KeyboardEvent) {
    if (isImeComposing(e)) return;
    // セル入力・フィルタ入力の中ではブラウザ既定の操作が優先。
    if (isEditableKeyTarget(e.target as Element | null)) return;
    // Tab はメイングリッドと関連パネルの行き来にだけ使う。引き受けられない
    // ときは既定のフォーカス移動に任せる (グリッドから出られなくしない)。
    if (e.key === "Tab" && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (moveGridFocus(e.shiftKey)) e.preventDefault();
      return;
    }
    // 範囲の選択とコピー (Shift+矢印・⌘/Ctrl+A・⌘/Ctrl+C・範囲を戻す Escape)。
    if (rangeSelect.handleKey(e)) {
      e.preventDefault();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    if (e.key === "Escape") {
      if (closeOpenPanel()) e.preventDefault();
      return;
    }
    if (e.key === "Enter") {
      if (activateActiveCell()) e.preventDefault();
      return;
    }
    const step = ARROW_STEP[e.key];
    if (!step) return;
    const lastRow = totalRows - 1;
    const lastCol = columnNames.length - 1;
    if (lastRow < 0 || lastCol < 0) return;
    // ここから先はグリッドが矢印キーを引き受ける。端で止まるときも
    // viewport の既定スクロールは起こさない。
    e.preventDefault();
    if (activeCellRowIndex < 0 || activeCellColIndex < 0) {
      // 現在地が無い状態の 1 打目は「グリッドに入る」だけにする。
      moveActiveCell(Math.min(Math.max(selectedRowIndex, 0), lastRow), 0);
      return;
    }
    const nextRow = Math.min(
      Math.max(activeCellRowIndex + step.row, 0),
      lastRow,
    );
    const nextCol = Math.min(
      Math.max(activeCellColIndex + step.col, 0),
      lastCol,
    );
    if (nextRow === activeCellRowIndex && nextCol === activeCellColIndex)
      return;
    moveActiveCell(nextRow, nextCol);
  }

  // 詳細の欄の子を全部消すと resize handle まで消えてしまうので、resize
  // 以外の子だけ削除するヘルパを通す。
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
  /**
   * 足元のページ送り。表は仮想表示で全部の行をスクロールで読むので、ここは
   * 「いま見えている行の範囲」を出し、前後のボタンで 1 画面ぶんスクロール
   * するだけ (データの取り方は変えない)。statusEl と一緒に作り直す。
   */
  let pagerEl: {
    root: HTMLElement;
    range: HTMLElement;
    prev: HTMLButtonElement;
    next: HTMLButtonElement;
    /** 最後に描いた中身。変わらないときは DOM に触らない (スクロールの毎フレーム呼ばれる)。 */
    shown: string;
  } | null = null;
  let isRefreshing = false;
  let filterTimer: ReturnType<typeof setTimeout> | null = null;
  let selectedRowIndex = -1;
  let selectedRowElement: HTMLElement | null = null;
  // 詳細フッタ or 関連パネルに「いまどのセルの値を出してるか」を覚えておく。
  // renderViewport / 再描画でも色が維持されるよう、行/列 index を state に持つ。
  let detailMode: "cell" | "row" = "cell";
  let activeCellRowIndex = -1;
  let activeCellColIndex = -1;
  let activeCellElement: Element | null = null;
  // 仮想スクロール時に body に積まれている先頭行の global index。
  // renderViewport が描画する直前に確定する。setActiveCell が body 内の
  // 相対位置を計算するために参照する (CSS transform を regex で読むのは
  // translate3d 等のフォーマット変更で簡単に壊れるので state を持つ)。
  let renderStartRow = 0;
  // 描いてある行の終わり (含まない) と、次の描画で作り直すか (renderViewport)。
  let renderedEndRow = 0;
  let rebuildPending = true;
  // 現在のテーブルで外部キーを持つカラム名（ヘッダーのリンクアイコン表示用）。
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
    /** 行の数 (一覧に出す)。開いたあとに数える。 */
    count: RelatedCount;
  };
  // ドリルの 1 段。sourceTable の行が持つ FK 参照群と選択中の参照。
  type RelatedLevel = {
    sourceTable: string;
    targets: RelatedTarget[];
    selectedIndex: number;
  };
  let relatedPanel: HTMLElement | null = null;
  let relatedListEl: HTMLElement | null = null;
  let relatedCopyBtn: HTMLButtonElement | null = null;
  let relatedListResizeEl: HTMLElement | null = null;
  let relatedGridHost: HTMLElement | null = null;
  // 参照先が 0 件のときに出す空表示。
  let relatedEmptyEl: HTMLElement | null = null;
  // 右の表の上の見出し (何の行か・条件・件数)。
  let relatedHeadEl: HTMLElement | null = null;
  // 0 件の関係を一覧から隠すか (一覧の下の切り替え)。
  let relatedHideEmpty = true;
  // 一覧の件数を数えている取得。階層が変わったら止める。
  let relatedCountController: AbortController | null = null;
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
  // 関連パネル左リストの幅。ドラッグで変えた値は localStorage に覚える
  // (「その画面でどれくらい引き伸ばしたか」はブラウザ側の都合なので)。
  const storedRelatedListWidth = readStoredSize(
    RELATED_LIST_WIDTH_KEY,
    RELATED_LIST_DEFAULT_WIDTH,
  );
  reportStoredSizeFailure(
    storedRelatedListWidth,
    "reading the related-record list width failed",
  );
  let relatedListWidth = clampRelatedListWidth(storedRelatedListWidth.value);
  let relatedListResizeDetach: (() => void) | null = null;

  function clampRelatedListWidth(width: number): number {
    return Math.max(
      RELATED_LIST_MIN_WIDTH,
      Math.min(RELATED_LIST_MAX_WIDTH, Math.round(width)),
    );
  }

  // 幅は要素の style.width ではなく CSS 変数へ書く (ui-layout)。
  function applyRelatedListWidth(width: number): void {
    relatedListWidth = clampRelatedListWidth(width);
    el.style.setProperty("--db-related-list-w", `${relatedListWidth}px`);
  }

  if (!embedded) {
    relatedPanel = templateElement(view.relatedPanel(relatedHeight));
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

  // 保存済み幅がない列の初期幅。タイムスタンプや JSON が 180px 固定で
  // 常に省略表示になるのを避けるため、カラム型から推定する。ヘッダ名が
  // 長い列はヘッダが読める幅を下限にする (ソートアイコン + padding 分込み)。
  function defaultColWidth(colName: string): number {
    const type = (
      columns.find((c) => c.name === colName)?.type ?? ""
    ).toLowerCase();
    let w = DEFAULT_COL_WIDTH;
    if (/timestamp|datetime/.test(type)) w = 210;
    else if (/^(date|time|year)/.test(type)) w = 120;
    else if (/bool|tinyint\(1\)/.test(type)) w = 80;
    else if (/int|decimal|numeric|float|double|real/.test(type)) w = 110;
    else if (/text|json|xml|blob/.test(type)) w = 260;
    return Math.max(w, Math.min(240, colName.length * 7.5 + 34));
  }

  function getColWidth(colName: string): number {
    return colWidths.get(colName) ?? defaultColWidth(colName);
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
    const measure = templateElement(view.measure());
    document.body.appendChild(measure);
    const headerLabel = columns[colIndex]?.name || colName;
    measure.textContent = `${headerLabel}  ▲`;
    let maxW = measure.offsetWidth + 16;
    const rows = body.querySelectorAll<HTMLElement>(".db-grid-row");
    for (const row of rows) {
      const cells = row.querySelectorAll<HTMLElement>(
        ".db-grid-cell:not(.db-grid-rownum):not(.db-grid-recency)",
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

  function collectColumnFilters(): GridFilter[] {
    const filters: GridFilter[] = [];
    for (const [col, val] of columnFilters) {
      if (val) filters.push({ column: col, value: val });
    }
    return filters;
  }

  function collectFilters(): GridFilter[] {
    const filters = collectColumnFilters();
    if (globalSearchValue) {
      for (const col of columnNames) {
        if (
          !filters.some(
            (filter) =>
              filter.column === col && filter.value === globalSearchValue,
          )
        ) {
          filters.push({ column: col, value: globalSearchValue });
        }
      }
    }
    return filters;
  }

  function activeFilterCount(): number {
    return columnFilters.size + (globalSearchValue ? 1 : 0);
  }

  function syncRefreshButton(): void {
    const count = activeFilterCount();
    const t = text().grid;
    refreshLabel.textContent = "";
    const action =
      count > 0 ? t.refreshActionWithFilters(count) : t.refreshAction;
    refreshBtn.classList.toggle("has-filters", count > 0);
    refreshBtn.title = action;
    refreshBtn.setAttribute("aria-label", action);
    refreshBtn.setAttribute("aria-busy", isRefreshing ? "true" : "false");
  }

  function syncRefreshResult(): void {
    refreshResult.hidden = true;
    refreshResult.textContent = "";
    refreshResult.classList.toggle("changed", false);
  }

  function clearRefreshResult(): void {
    syncRefreshResult();
  }

  function syncFilterClearButton(): void {
    const count = activeFilterCount();
    const t = text().grid;
    filterClear.hidden = count === 0;
    filterClear.textContent = t.clearFiltersLabel;
    const action = t.clearFiltersAction(count);
    filterClear.title = action;
    filterClear.setAttribute("aria-label", action);
  }

  function syncFilteredEmptyState(): void {
    const count = activeFilterCount();
    const show = totalRows === 0 && count > 0;
    filteredEmpty.hidden = !show;
    filteredEmptyActions.hidden = !show;
    filteredEmptyReloadAction.hidden = !show;
    filteredEmptyReloadAction.disabled = !show || isRefreshing;
    filteredEmptyAction.hidden = !show;
    filteredEmptyAction.disabled = !show;
    if (!show) return;
    const t = text().grid;
    const reloadAction = t.refreshActionWithFilters(count);
    filteredEmptyTitle.textContent = t.filteredEmptyTitle(count);
    filteredEmptyHint.textContent = t.filteredEmptyHint;
    filteredEmptyReloadAction.classList.toggle("spinning", isRefreshing);
    filteredEmptyReloadAction.replaceChildren(
      templateElement(iconTemplate(SYNC_16_PATH, "octicon-sync")),
    );
    filteredEmptyReloadAction.title = reloadAction;
    filteredEmptyReloadAction.setAttribute("aria-label", reloadAction);
    filteredEmptyReloadAction.setAttribute(
      "aria-busy",
      isRefreshing ? "true" : "false",
    );
    filteredEmptyAction.textContent = t.filteredEmptyAction;
    filteredEmptyAction.title = t.clearFiltersAction(count);
    filteredEmptyAction.setAttribute("aria-label", t.clearFiltersAction(count));
  }

  function clearAllFilters(): void {
    globalSearchValue = "";
    filterInput.value = "";
    columnFilters.clear();
    clearRefreshResult();
    filterRow
      .querySelectorAll<HTMLInputElement>(".db-grid-col-filter")
      .forEach((input) => {
        input.value = "";
      });
    syncFilterClearButton();
    syncRefreshButton();
    syncFilteredEmptyState();
  }

  function clearFiltersAndReload(): void {
    clearAllFilters();
    invalidateData();
  }

  function resetSelectionAndDetail() {
    selectedRowIndex = -1;
    selectedRowElement = null;
    rangeSelect.reset();
    // active セルも落とす。並べ替え / 再読込で同じ行 index が別の行を
    // 指すので、残すと「フッタは閉じているのにセルだけ光っている」状態
    // になり、矢印キーの現在地も前のデータの位置から始まってしまう。
    clearActiveCell();
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
    refreshMarks.clear();
    clearRefreshResult();
    startNewLoadGeneration();
    viewport.scrollTop = 0;
    resetSelectionAndDetail();
    return ensurePage(0);
  }

  async function refreshCurrentTable(): Promise<void> {
    if (!currentTable || refreshBtn.disabled) return;
    const refreshTable = currentTable;
    const refreshFilterKey = JSON.stringify(collectFilters());
    const scrollTop = viewport.scrollTop;
    const pageStart =
      Math.floor(scrollTop / currentRowHeight() / PAGE_SIZE) * PAGE_SIZE;
    refreshBtn.disabled = true;
    refreshBtn.classList.add("spinning");
    isRefreshing = true;
    clearRefreshResult();
    syncRefreshButton();
    syncFilteredEmptyState();
    updateStatus();
    if (filterTimer) {
      clearTimeout(filterTimer);
      filterTimer = null;
    }
    // 読み直す前の行を控え、届いた行と比べて新しく出た行・変わった行に印を付ける。
    refreshMarks.begin(pageCache.entries(), rowKeyFor);
    pageCache = new Map();
    pendingPages = new Map();
    startNewLoadGeneration();
    const refreshGeneration = loadGeneration;
    resetSelectionAndDetail();
    viewport.scrollTop = scrollTop;
    renderViewport();
    try {
      await ensurePage(pageStart);
    } finally {
      const endedInError = statusEl?.classList.contains("db-pane-error");
      if (endedInError) refreshMarks.clear();
      isRefreshing = false;
      refreshBtn.classList.remove("spinning");
      refreshBtn.disabled = false;
      syncRefreshButton();
      syncFilteredEmptyState();
      if (!endedInError) {
        if (
          loadGeneration === refreshGeneration &&
          JSON.stringify(collectFilters()) === refreshFilterKey
        ) {
          syncRefreshResult();
          callbacks.onRefreshComplete?.({
            table: refreshTable,
            totalRows,
            filters: collectFilters(),
          });
        }
        updateStatus();
      }
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
    recency.reset([]);
    refreshMarks.clear();
    rangeSelect.reset();
    timeZone.setShown(false);
    isRefreshing = false;
    columnFilters.clear();
    globalSearchValue = "";
    clearRefreshResult();
    filterInput.value = "";
    syncFilterClearButton();
    syncRefreshButton();
    filterRow.replaceChildren();
    pageCache = new Map();
    pendingPages = new Map();
    startNewLoadGeneration();
    cancelAnimationFrame(rafId);
    if (filterTimer) clearTimeout(filterTimer);
    headerRow.replaceChildren();
    body.replaceChildren();
    spacer.style.height = "0px";
    statusEl?.remove();
    statusEl = null;
    pagerEl = null;
    // 新しいテーブルをロードする前に選択をリセットする。これを怠ると、
    // 関連グリッドの使い回し時に前テーブルの行 index が別の行へ誤適用され、
    // getState() にも誤った行番号が混入する。
    selectedRowIndex = -1;
    selectedRowElement = null;
    activeCellElement = null;
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
            targets.push({
              direction: "outgoing",
              fk,
              value,
              count: { state: "loading" },
            });
          }
        }
      }
      if (fk.toTable === sourceTable) {
        const idx = colNames.indexOf(fk.toColumn);
        if (idx >= 0) {
          const value = relatedLookupValue(rowData[idx]);
          if (value !== null) {
            targets.push({
              direction: "incoming",
              fk,
              value,
              count: { state: "loading" },
            });
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

    const embedded = createTableGrid(
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
        // 埋め込み側で Shift+Tab を押したらメイングリッドへ戻す。
        onFocusParentGrid: () => viewport.focus({ preventScroll: true }),
      },
      { embedded: true },
      view,
    );
    embeddedGrid = embedded;
    const refs = {
      crumbs: createRef<HTMLElement>(),
      copy: createRef<HTMLButtonElement>(),
      list: createRef<HTMLElement>(),
      listResize: createRef<HTMLElement>(),
      gridHost: createRef<HTMLElement>(),
      head: createRef<HTMLElement>(),
      empty: createRef<HTMLElement>(),
    };
    relatedPanel.append(
      ...templateElements(
        view.relatedParts({
          text: text(),
          grid: embedded.el,
          refs,
          onResizeStart: startRelatedResize,
          onCopy: (button) => {
            const target = currentRelatedTarget();
            if (!target) return;
            navigator.clipboard.writeText(target.value).then(
              () => {
                button.textContent = text().detail.copied;
                setTimeout(() => {
                  button.textContent = text().detail.copy;
                }, 800);
              },
              // 詳細の欄のコピーと同じく、失敗の理由を出す。
              (error: unknown) => {
                console.error(error);
                button.textContent = `${text().detail.copyFailed}: ${formatErrorDetail(error)}`;
              },
            );
          },
          onClose: () => {
            hideRelatedPanel();
            clearActiveCell();
          },
        }),
      ),
    );
    // ドリル経路を示すパンくず。各セグメントのクリックでその階層へ戻る。
    relatedCrumbEl = shellPart(refs.crumbs);
    relatedCopyBtn = shellPart<HTMLButtonElement>(refs.copy);
    relatedListEl = shellPart(refs.list);
    relatedGridHost = shellPart(refs.gridHost);
    relatedHeadEl = shellPart(refs.head);
    relatedEmptyEl = shellPart(refs.empty);
    // リストは幅が固定だとテーブル名 + 条件が読めないので、右端を掴んで
    // 広げられるようにする (ドラッグの配線は core/drag-resizer と共有)。
    const listResize = shellPart(refs.listResize);
    relatedListResizeEl = listResize;
    applyRelatedListWidth(relatedListWidth);
    const panel = relatedPanel;
    relatedListResizeDetach = attachDragResizer({
      handle: listResize,
      getSize: () => relatedListWidth,
      applySize: applyRelatedListWidth,
      direction: 1,
      axis: "x",
      onEnd: () =>
        reportStoredSizeFailure(
          writeStoredSize(RELATED_LIST_WIDTH_KEY, relatedListWidth),
          "saving the related-record list width failed",
        ),
      activeClassTarget: panel,
      activeClassName: "db-related-list-resizing",
    });
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
    relatedCountController?.abort();
    relatedCountController = null;
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
    renderRelatedHeadNow();
    void loadRelatedTarget();
    void loadRelatedCounts();
  }

  function relatedEntry(target: RelatedTarget): RelatedEntry {
    return {
      direction: target.direction,
      table: relatedDrillTable(target),
      column: relatedDrillEqColumn(target),
      ownColumn:
        target.direction === "outgoing"
          ? target.fk.fromColumn
          : target.fk.toColumn,
      value: target.value,
      inferred: !!target.fk.inferred,
      count: target.count,
    };
  }

  function renderRelatedHeadNow() {
    const target = currentRelatedTarget();
    if (!relatedHeadEl || !target) return;
    renderRelatedHead(relatedHeadEl, relatedEntry(target), text());
  }

  // 一覧の関係ごとに行の数を数える (同時に RELATED_COUNT_CONCURRENCY 本まで)。
  // 開いている階層が変わったら止める。失敗は件数の所に「!」と理由を出す。
  async function loadRelatedCounts() {
    const level = currentRelatedLevel();
    const fetchRelated = callbacks.fetchRelatedPage;
    if (!level || !fetchRelated) return;
    relatedCountController?.abort();
    const controller = new AbortController();
    relatedCountController = controller;
    // 選んでいる関係は右の表を読むときに数が分かるので、ここでは数えない。
    const selected = level.targets[level.selectedIndex];
    const queue = level.targets.filter(
      (t) => t.count.state === "loading" && t !== selected,
    );
    const worker = async () => {
      for (let target = queue.shift(); target; target = queue.shift()) {
        if (controller.signal.aborted) return;
        const table = relatedDrillTable(target);
        const eq = [
          { column: relatedDrillEqColumn(target), value: target.value },
        ];
        try {
          const data = await fetchRelated(
            table,
            0,
            1,
            null,
            [],
            eq,
            controller.signal,
          );
          target.count = { state: "done", rows: data.totalRows };
        } catch (error) {
          if (controller.signal.aborted || isAbortError(error)) return;
          target.count = {
            state: "failed",
            detail: reportDatastoreFailure(
              "SQL",
              "count related rows",
              error,
              table,
              eq,
            ),
          };
        }
        if (currentRelatedLevel() !== level) return;
        renderRelatedList();
        if (target === currentRelatedTarget()) renderRelatedHeadNow();
      }
    };
    await Promise.all(
      Array.from({ length: RELATED_COUNT_CONCURRENCY }, () => worker()),
    );
  }

  function renderRelatedCrumbs() {
    if (!relatedCrumbEl) return;
    relatedCrumbEl.replaceChildren(
      templateFragment(
        relatedStack.length === 0
          ? nothing
          : view.relatedCrumbs({
              origin: relatedStack[0].sourceTable,
              levels: relatedStack.map((level, i) => ({
                table: relatedDrillTable(level.targets[level.selectedIndex]),
                onClick: () => goToRelatedLevel(i),
              })),
            }),
      ),
    );
  }

  function renderRelatedList() {
    const level = currentRelatedLevel();
    if (!relatedListEl || !level) return;
    renderRelatedListView(relatedListEl, {
      entries: level.targets.map(relatedEntry),
      selected: level.selectedIndex,
      hideEmpty: relatedHideEmpty,
      text: text(),
      onSelect: selectRelatedTarget,
      onToggleHideEmpty: () => {
        relatedHideEmpty = !relatedHideEmpty;
        renderRelatedList();
      },
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
    relatedGridHost?.classList.remove("is-empty");
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
      target.count = { state: "done", rows: data.totalRows };
      renderRelatedList();
      renderRelatedHeadNow();
      // 0 件なら表の代わりに空表示を出す (孤立した外部キー・推測の外れなど)。
      const empty = data.totalRows === 0;
      relatedGridHost?.classList.toggle("is-empty", empty);
      if (relatedEmptyEl) {
        relatedEmptyEl.hidden = !empty;
        const t = text().grid;
        relatedEmptyEl.textContent =
          target.direction === "outgoing"
            ? t.relatedEmpty
            : t.relatedEmptyIncoming;
        if (target.fk.inferred)
          relatedEmptyEl.appendChild(
            templateElement(view.relatedEmptyNote(t.relatedInferredNote)),
          );
      }
    } catch (err) {
      if (gen !== relatedGen || isAbortError(err)) return;
      const detail = reportDatastoreFailure(
        "SQL",
        "related rows",
        err,
        drillTable,
        relatedEq,
      );
      target.count = { state: "failed", detail };
      renderRelatedList();
      renderRelatedHeadNow();
      grid.showError(detail);
    }
  }

  // 詳細フッタの JSON ハイライト用 shiki。JSON セルを最初に開いたときだけ
  // lazy bundle を読む (グリッドを開いただけでは読み込まない)。
  let jsonHighlighter: ShikiHighlighter | null = null;
  let jsonHighlighterRequested = false;
  // いまフッタに出している JSON。非同期ロードが終わった時点でも「まだ同じ値を
  // 出しているか」を見てから塗り直す (矢印キーで既に別セルへ移っていることがある)。
  // 行全体の詳細では JSON の値がいくつも並ぶので、塗る先を全部覚えておく。
  let detailJsonTargets: { pre: HTMLElement; json: string }[] = [];

  function paintJsonHighlight(pre: HTMLElement, json: string): boolean {
    if (json.length > DETAIL_JSON_HIGHLIGHT_MAX_CHARS) return false;
    const inner = highlightToInnerHtml(json, "json", jsonHighlighter);
    if (!inner) return false;
    pre.replaceChildren(templateFragment(unsafeHTML(inner)));
    return true;
  }

  function showJsonDetail(pre: HTMLElement, json: string) {
    detailJsonTargets.push({ pre, json });
    if (paintJsonHighlight(pre, json)) return;
    // ロード前・ロード失敗・巨大すぎるときは素のテキストで出す。色が付かない
    // だけで中身は欠けない。
    pre.textContent = json;
    if (json.length > DETAIL_JSON_HIGHLIGHT_MAX_CHARS) return;
    ensureJsonHighlighter();
  }

  function ensureJsonHighlighter() {
    if (jsonHighlighterRequested) return;
    jsonHighlighterRequested = true;
    void loadShikiHighlighter({
      langs: ["json"],
    }).then((highlighter) => {
      jsonHighlighter = highlighter;
      if (!highlighter) return;
      for (const target of detailJsonTargets)
        if (target.pre.isConnected) paintJsonHighlight(target.pre, target.json);
    });
  }

  // 行全体の詳細の日時: 表に出しているタイムゾーンの文字と、何分前か。
  function rowDetailTime(
    row: DbValue[],
    col: number,
  ): { shown: string; relative: string } | null {
    const at = recency.timeOf(row, col);
    if (at === null) return null;
    const zone = timeZone.zone();
    const now = Date.now();
    return {
      shown: zone ? formatInZone(at, zone) : String(row[col]),
      relative: isFutureTime(at, now)
        ? ""
        : relativeTimeText(at / 1000, pageLanguage(), now),
    };
  }

  function showCellDetail(colIndex: number, value: DbValue) {
    const colName = columnNames[colIndex];
    const colType = columns[colIndex]?.type || "";
    const row = cachedRow(activeCellRowIndex);
    const t = text().detail;

    // 前のセルの JSON への参照を切る (遅れて届くハイライトが古い pre を
    // 塗るのを防ぐ)。JSON の値ならこの後 showJsonDetail が入れ直す。
    detailJsonTargets = [];
    // 単一値詳細とは排他。関連パネルを閉じるだけでなく、進行中の関連ロードも
    // 中断する（hideRelatedPanel が abort + stack クリア + 埋め込み grid.clear）。
    hideRelatedPanel();
    detailPanel.hidden = false;
    clearDetailContent();

    const titleText =
      detailMode === "row"
        ? t.rowTitle(activeCellRowIndex + 1)
        : `${colName} (${colType})`;
    const tabs = createDetailTabs(
      [
        { id: "cell", label: t.cell },
        { id: "row", label: t.row },
      ],
      detailMode,
      (mode) => {
        detailMode = mode;
        showDetailForActiveCell();
        viewport.focus({ preventScroll: true });
      },
    );
    const copyText =
      detailMode === "row"
        ? // 列名が重複するクエリ結果でも、列と値の対応を欠かさずコピーする。
          JSON.stringify({ columns: columnNames, values: row }, null, 2)
        : formatValueForCopy(value);
    const copyStatusRef = createRef<HTMLElement>();
    const [header, copyStatus] = templateElements(
      view.detailHeader({
        text: t,
        tabs: tabs.tabsEl,
        title: titleText,
        copyStatusRef,
        onCopy: () => {
          navigator.clipboard.writeText(copyText).then(
            () => {
              shellPart(copyStatusRef).textContent = t.copied;
            },
            (error: unknown) => {
              console.error(error);
              shellPart(copyStatusRef).textContent =
                `${t.copyFailed}: ${formatErrorDetail(error)}`;
            },
          );
        },
        onClose: () => {
          detailPanel.hidden = true;
          // 関連パネルも閉じていればフッタ表示中のセル色も落とす。
          if (!relatedPanel || relatedPanel.hidden) clearActiveCell();
        },
      }),
    );
    if (!header || !copyStatus)
      throw new Error("table grid: the detail header was not drawn");

    const content = tabs.bodies[detailMode];
    content.classList.add("db-grid-detail-content");

    if (detailMode === "row" && row) {
      const rowValues = row;
      renderRowDetail(content, {
        columns,
        row: rowValues,
        activeColumn: colIndex,
        text: text(),
        time: (col) => rowDetailTime(rowValues, col),
        isForeignKey: (col) => fkColumns.has(columnNames[col]),
        openRelated: (col) => {
          if (embedded)
            callbacks.onForeignKeyCellClick?.(
              currentTable,
              columnNames,
              rowValues,
              columnNames[col],
            );
          else
            openRelatedForRow(
              currentTable,
              columnNames,
              rowValues,
              columnNames[col],
            );
        },
        showJson: showJsonDetail,
        copy: (value, button) => {
          navigator.clipboard.writeText(value).then(
            () => {
              button.classList.add("copied");
              setTimeout(() => button.classList.remove("copied"), 1200);
            },
            (error: unknown) =>
              showCopyFailure(
                button,
                "copy a value of the row",
                error,
                button.title,
                4000,
              ),
          );
        },
        copyText: (col) => cellCopyText(rowValues, col),
      });
    } else if (value === null) {
      content.textContent = "NULL";
      content.classList.add("null");
    } else if (value instanceof Uint8Array) {
      content.textContent = `BLOB (${value.byteLength} bytes)`;
      content.classList.add("blob");
    } else {
      const str =
        typeof value === "object" ? JSON.stringify(value) : String(value);
      let parsed: unknown;
      let isJson = false;
      if (str.length > 0 && (str[0] === "{" || str[0] === "[")) {
        try {
          parsed = JSON.parse(str);
          isJson = true;
        } catch {
          // 括弧で始まるだけの文字列の値。JSON として整形せず、そのまま出す。
        }
      }
      if (isJson) {
        const pre = templateElement(view.detailJson());
        showJsonDetail(pre, JSON.stringify(parsed, null, 2));
        content.appendChild(pre);
      } else {
        content.textContent = str || t.emptyString;
      }
    }

    detailPanel.append(header, copyStatus, tabs.bodies.cell, tabs.bodies.row);
  }

  function renderHeader() {
    headerRow.replaceChildren(
      ...templateElements(
        view.header({
          text: text(),
          recency: recency.shown() ? recency.headerCell(ROWNUM_WIDTH) : null,
          columns: columns.map((col, i) => ({
            name: col.name,
            width: getColWidth(col.name),
            sort: sort?.column === col.name ? sort.direction : null,
            zone:
              timeZone.zone() && recency.isTimeColumn(i)
                ? timeZone.shortName()
                : null,
            foreignKey: fkColumns.has(col.name),
            onSort: () => handleSort(col.name),
            onResizeStart: (e) => {
              e.preventDefault();
              e.stopPropagation();
              startResize(i, e);
            },
            onAutoFit: (e) => {
              e.preventDefault();
              e.stopPropagation();
              autoFitColumn(col.name, i);
            },
          })),
        }),
      ),
    );
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
    filterRow.replaceChildren(
      ...templateElements(
        view.filterRow({
          recency: recency.shown()
            ? recency.spacerCell(ROWNUM_WIDTH, "db-grid-filter-spacer")
            : null,
          columns: columns.map((col) => ({
            width: getColWidth(col.name),
            placeholder: text().grid.columnFilterPlaceholder(col.name),
            value: columnFilters.get(col.name) || "",
            onInput: (input) => {
              const val = input.value.trim();
              if (val) {
                columnFilters.set(col.name, val);
              } else {
                columnFilters.delete(col.name);
              }
              clearRefreshResult();
              syncFilterClearButton();
              syncRefreshButton();
              scheduleFilter();
            },
            onKeydown: (input, e) => {
              if (isImeComposing(e)) return;
              if (e.key === "Escape") {
                input.value = "";
                columnFilters.delete(col.name);
                clearRefreshResult();
                syncFilterClearButton();
                syncRefreshButton();
                scheduleFilter();
              }
            },
          })),
        }),
      ),
    );
  }

  function scheduleFilter() {
    if (filterTimer) clearTimeout(filterTimer);
    filterTimer = setTimeout(() => {
      filterTimer = null;
      invalidateData();
    }, FILTER_DEBOUNCE_MS);
  }

  // 列の合計幅 = ヘッダセルの実寸の合計。
  // headerRow.scrollWidth を使ってはいけない。.db-grid-header は
  // min-width:100% なので、列より枠が広いときはコンテナ幅まで膨らんだ値を
  // 返す。それを本文 / フィルタ行 / spacer の min-width へ焼くと、あとで枠が
  // 狭くなっても本文だけ広いまま残り (min-width は縮まない)、本文の方が
  // 余分に横スクロールできてヘッダが取り残される。ヘッダ側には min-width を
  // 焼かない (焼くと次の測定が縮まなくなる) ので、ずれはヘッダ対本文の
  // 食い違いとして出る。
  function measureContentWidth(): number {
    let total = 0;
    for (const cell of headerRow.children) {
      total += cell.getBoundingClientRect().width;
    }
    return total;
  }

  function syncContentWidth() {
    requestAnimationFrame(() => {
      const w = measureContentWidth();
      if (w > 0) {
        spacer.style.minWidth = `${w}px`;
        body.style.minWidth = `${w}px`;
        filterRow.style.minWidth = `${w}px`;
      }
    });
  }

  function handleSort(column: string) {
    applySort(
      sort?.column === column
        ? sort.direction === "asc"
          ? { column, direction: "desc" }
          : null
        : { column, direction: "asc" },
    );
  }

  function applySort(next: GridSort | null) {
    sort = next;
    pageCache = new Map();
    pendingPages = new Map();
    refreshMarks.clear();
    startNewLoadGeneration();
    resetSelectionAndDetail();
    renderHeader();
    syncNewestButton();
    renderViewport();
  }

  function sameSort(a: GridSort | null, b: GridSort | null): boolean {
    return a?.column === b?.column && a?.direction === b?.direction;
  }

  // 「新しい順」で並べているか。押した状態はこの並びから決め、別に持たない。
  function sortedNewest(): boolean {
    const newest = recency.newestSort();
    return newest !== null && sameSort(sort, newest);
  }

  function initialSortFor(cols: DbColumn[]): GridSort | null {
    if (embedded || callbacks.getNewestFirst?.() !== true) return null;
    const probe = createGridRecency({ text });
    probe.reset(cols);
    return probe.newestSort();
  }

  function syncNewestButton(): void {
    const newest = recency.newestSort();
    newestBtn.hidden = embedded || !currentTable || newest === null;
    if (newestBtn.hidden || !newest) return;
    const t = text().grid;
    const on = sortedNewest();
    newestBtn.setAttribute("aria-pressed", on ? "true" : "false");
    newestLabel.textContent = t.newestLabel;
    if (newestBtn.dataset.saveFailed) return;
    newestBtn.title = on ? t.newestOffAction : t.newestOnAction(newest.column);
  }

  newestBtn.addEventListener("click", () => {
    const newest = recency.newestSort();
    if (!newest) return;
    const on = !sortedNewest();
    delete newestBtn.dataset.saveFailed;
    viewport.scrollTop = 0;
    applySort(on ? newest : null);
    callbacks.setNewestFirst?.(on).catch((error: unknown) => {
      const detail = reportDatastoreFailure(
        "SQL",
        "remember newest-first order",
        error,
        on,
      );
      newestBtn.dataset.saveFailed = "1";
      newestBtn.title = text().grid.newestSaveFailed(detail);
    });
  });

  function ensurePage(pageStart: number): Promise<void> {
    if (getCachedPage(pageStart) !== undefined) return Promise.resolve();
    const pending = pendingPages.get(pageStart);
    if (pending) return pending;
    const gen = loadGeneration;
    const signal = loadController.signal;
    const filters = collectFilters();
    const promise = callbacks
      .fetchPage(currentTable, pageStart, PAGE_SIZE, sort, filters, signal)
      .then((data) => {
        if (gen !== loadGeneration) return;
        recency.notePage(data.rows);
        refreshMarks.notePage(pageStart, data.rows);
        rememberPage(pageStart, data.rows);
        totalRows = data.totalRows;
        syncSpacer();
        updateStatus();
        renderViewport();
      })
      .catch((err) => {
        if (gen !== loadGeneration || isAbortError(err)) return;
        if (gen === loadGeneration) {
          showError(
            reportDatastoreFailure(
              "SQL",
              "table page",
              err,
              currentTable,
              pageStart,
            ),
          );
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

  function rememberPage(pageStart: number, rows: DbValue[][]): void {
    pageCache.delete(pageStart);
    pageCache.set(pageStart, rows);
    while (pageCache.size > MAX_PAGE_CACHE_PAGES) {
      const oldest = pageCache.keys().next().value;
      if (oldest === undefined) break;
      pageCache.delete(oldest);
    }
  }

  function getCachedPage(pageStart: number): DbValue[][] | undefined {
    const rows = pageCache.get(pageStart);
    if (rows === undefined) return undefined;
    pageCache.delete(pageStart);
    pageCache.set(pageStart, rows);
    return rows;
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
    const width = getColWidth(columnNames[colIndex]);

    // ---- 表示モード: read-only 風のテキスト表示。ダブルクリックで input 化。
    if (!opts.editing)
      return templateElement(
        view.displayCell({
          width,
          value,
          emptyLabel: text().grid.emptyValue,
          readonly: opts.readonly,
          // 読み取り専用 (PK/blob) はダブルクリックしても編集できないので、
          // 編集 hint を出さず dblclick もバインドしない。
          editHint: opts.readonly ? null : text().edit.dblclickToEdit,
          onActivate: (e) => {
            e.stopPropagation();
            opts.onActivate?.();
          },
          onEnterEdit: (e) => {
            e.stopPropagation();
            opts.onEnterEdit?.();
          },
        }),
      );

    // ---- 入力モード: input (NULL は placeholder "NULL" + is-null クラス)。
    // value===null は SQL NULL。空入力の "" (空文字列) と視覚的に区別するため、
    // placeholder "NULL" + is-null クラスで表現する。
    const inputRef = createRef<HTMLInputElement>();
    const input = () => shellPart<HTMLInputElement>(inputRef);
    const applyNullVisual = (isNull: boolean) => {
      input().classList.toggle("is-null", isNull);
      input().placeholder = isNull ? "NULL" : "";
    };
    const cell = templateElement(
      view.inputCell({
        width,
        value,
        readonly: opts.readonly,
        rowIndex: opts.rowIndex,
        colIndex,
        inputRef,
        // nullable 列には NULL ボタンを出し、明示的に SQL NULL を入れられるように
        // する (NULL→"" の暗黙変換や NULL 設定不可の問題への対処)。
        nullTitle: opts.nullable && !opts.readonly ? text().edit.setNull : null,
        onInput: () => {
          // テキスト入力したら NULL 状態は解除 (空文字列 "" は NULL ではない)。
          applyNullVisual(false);
          opts.onChange(input().value);
        },
        // 入力確定で表示モードへ戻す。NULL ボタンに focus が移るケースを除く。
        onBlur: (e) => {
          const next = e.relatedTarget as Node | null;
          if (next && cell.contains(next)) return;
          opts.onExitEdit?.();
        },
        // Enter / Escape で編集を抜けて表示モードへ戻す (値は input イベントで
        // すでに反映済み。Escape でも保留中変更を消したりはしない)。
        onKeydown: (e) => {
          if (e.key === "Enter" || e.key === "Escape") {
            e.preventDefault();
            opts.onExitEdit?.();
          }
        },
        onSetNull: (e) => {
          e.stopPropagation();
          input().value = "";
          applyNullVisual(true);
          opts.onChange(null);
          // クリック後も入力モードを維持するため、明示的に input へ戻す。
          input().focus();
        },
      }),
    );
    return cell;
  }

  // 既存データ行 (read-only もしくは編集モード) を 1 行ぶん組み立てる。
  // first〜last の行。読み込んでいないページは読む (コピーの範囲が画面の外まで
  // 伸びているとき)。読めなかったページは理由をつけて投げる。
  async function rowsBetween(
    first: number,
    last: number,
  ): Promise<DbValue[][]> {
    const out: DbValue[][] = [];
    const generation = loadGeneration;
    for (
      let pageStart = Math.floor(first / PAGE_SIZE) * PAGE_SIZE;
      pageStart <= last;
      pageStart += PAGE_SIZE
    ) {
      if (!pageCache.has(pageStart)) await ensurePage(pageStart);
      const page = pageCache.get(pageStart);
      if (!page || generation !== loadGeneration)
        throw new Error(
          `rows ${pageStart + 1}-${pageStart + PAGE_SIZE} of ${currentTable} could not be loaded`,
        );
      const end = Math.min(last, pageStart + page.length - 1);
      for (let i = Math.max(first, pageStart); i <= end; i++)
        out.push(page[i - pageStart]);
    }
    return out;
  }

  // 貼り付け用の 1 つのセルの文字。NULL は空、日時はいま表示しているタイムゾーン。
  function cellCopyText(row: DbValue[], col: number): string {
    const zone = timeZone.zone();
    const shown = zone ? recency.displayTime(row, col, zone) : null;
    return shown ?? formatValueForCopy(row[col]);
  }

  function showCopyNotice(message: string, failed: boolean): void {
    copyNotice = message;
    if (copyNoticeTimer) clearTimeout(copyNoticeTimer);
    copyNoticeTimer = null;
    if (!failed)
      copyNoticeTimer = setTimeout(() => {
        copyNotice = "";
        copyNoticeTimer = null;
        updateStatus();
      }, COPY_NOTICE_MS);
    updateStatus();
  }

  function buildDataRow(i: number): HTMLElement {
    const pageStart = Math.floor(i / PAGE_SIZE) * PAGE_SIZE;
    const pageRows = getCachedPage(pageStart);
    const rowData = pageRows ? pageRows[i - pageStart] : null;

    const rowIndex = i;
    const refreshMark = rowData ? refreshMarks.markOf(rowData) : null;
    const rowNumRef = createRef<HTMLElement>();
    const row = templateElement(
      view.row({
        className: [
          "db-grid-row",
          i % 2 === 1 ? "alt" : "",
          i === selectedRowIndex ? "selected" : "",
          refreshMark ? `db-grid-row-refreshed is-${refreshMark}` : "",
        ]
          .filter(Boolean)
          .join(" "),
        rowNum: {
          className: "db-grid-cell db-grid-rownum",
          label: String(i + 1),
          title:
            refreshMark === null
              ? null
              : refreshMark === "added"
                ? text().grid.refreshMarkAdded
                : text().grid.refreshMarkChanged,
          ref: rowNumRef,
        },
        recency: recency.shown()
          ? rowData
            ? recency.cell(rowData, ROWNUM_WIDTH)
            : recency.spacerCell(ROWNUM_WIDTH, "loading")
          : null,
      }),
    );
    if (i === selectedRowIndex) selectedRowElement = row;
    const rowNum = shellPart(rowNumRef);

    if (!rowData) {
      row.append(
        ...templateElements(
          view.loadingCells(columnNames.map((name) => getColWidth(name))),
        ),
      );
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
        rowNum.addEventListener("click", (e: MouseEvent) => {
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
          focusCell(rowIndex, row, cellColIndex);
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
            // 編集欄は type="text" だけなので setSelectionRange は投げない。
            inp.setSelectionRange?.(inp.value.length, inp.value.length);
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
          activeCellElement = cellEl;
        }
        row.appendChild(cellEl);
      }
      return row;
    }

    // --- read-only (既存挙動) ---
    row.addEventListener("click", () => {
      setSelectedRow(rowIndex, row);
    });
    const range = rangeSelect.multiRange();
    const zone = timeZone.zone();
    const cells = templateElements(
      view.dataCells({
        emptyLabel: text().grid.emptyValue,
        cells: columnNames.map((cellColName, c) => {
          const val = rowData[c];
          const shownTime = zone ? recency.displayTime(rowData, c, zone) : null;
          // FK セルはメイン/埋め込みの両方で「辿れる」セルにする。埋め込み側は
          // 親から渡された onForeignKeyCellClick が無ければ通常セル扱い。
          const fkClickable =
            fkColumns.has(cellColName) &&
            (!embedded || !!callbacks.onForeignKeyCellClick);
          return {
            width: getColWidth(cellColName),
            value: val,
            // NULL と空文字は札にする (以前はどちらも本文と同じ色で、空文字は
            // 共通の .empty (空の画面の案内) の規則まで当たって真ん中に寄っていた)。
            text: shownTime ?? formatValue(val),
            timeTitle:
              shownTime === null
                ? null
                : text().grid.timeZoneCellTitle(String(val)),
            blob: val instanceof Uint8Array,
            inRange: !!range && inCellRange(range, i, c),
            foreignKey: fkClickable,
            // virtualized 再描画でも色が残るよう、render 時に state と
            // 突合せてクラスを付ける。
            active: i === activeCellRowIndex && c === activeCellColIndex,
            onClick: (e: MouseEvent) => {
              e.stopPropagation();
              // Shift+クリックは範囲を伸ばすだけ (mousedown で済んでいる)。詳細も
              // 関連パネルも開かない。
              if (e.shiftKey) return;
              // 詳細フッタ / 関連パネルに表示する対象セルを覚えておく。
              focusCell(rowIndex, row, c);
              // FK セルは関連テーブルをパネルに開く（埋め込みは親へ通知して
              // 1 段潜る）。それ以外は従来どおり単一値の詳細を表示する。
              if (fkClickable) {
                if (embedded) {
                  callbacks.onForeignKeyCellClick?.(
                    currentTable,
                    columnNames,
                    rowData,
                    cellColName,
                  );
                } else {
                  openRelatedForRow(
                    currentTable,
                    columnNames,
                    rowData,
                    cellColName,
                  );
                }
              } else {
                showCellDetail(c, val);
              }
            },
          };
        }),
      }),
    );
    if (i === activeCellRowIndex && cells[activeCellColIndex])
      activeCellElement = cells[activeCellColIndex] as HTMLElement;
    row.append(...cells);
    return row;
  }

  // 新規行ドラフト (編集モード時のみ、データ行の下に表示) を組み立てる。
  function buildDraftRow(draftIndex: number): HTMLElement {
    const draft = draftRows[draftIndex];
    const rowNumRef = createRef<HTMLElement>();
    const row = templateElement(
      view.row({
        className: "db-grid-row db-grid-row-draft",
        rowNum: {
          className: "db-grid-cell db-grid-rownum db-grid-rownum-draft",
          label: "＋",
          title: text().edit.newRow,
          ref: rowNumRef,
        },
        recency: recency.shown()
          ? recency.spacerCell(ROWNUM_WIDTH, "db-grid-recency-draft")
          : null,
      }),
    );
    const rowNum = shellPart(rowNumRef);
    rowNum.style.cursor = "pointer";
    rowNum.addEventListener("click", (e) => {
      e.stopPropagation();
      draftRows.splice(draftIndex, 1);
      syncSpacer();
      refreshEditButtons();
      showPendingStatus();
      renderViewport();
    });
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

  /**
   * 行を描く。スクロールで呼ぶときは "scroll": 描いてある行 (見える範囲の上下に
   * OVERSCAN 行ずつ) が見える範囲を覆っている間は作り直さない。指で送る間、毎
   * フレーム 50 行ほどを組み直し、スマホ (CPU 6 倍遅く) で 1 フレーム 45ms・
   * 22fps になってカクついた。ほかの呼び出し (読み込み・並べ替え・編集など) は
   * 中身が変わるので必ず作り直す。同じフレームに両方が来ても作り直しを落とさない
   * よう、作り直しの要求は rebuildPending に残す。
   */
  function renderViewport(reason: "scroll" | "rebuild" = "rebuild") {
    if (reason === "rebuild") rebuildPending = true;
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => {
      // IME 変換中は body を作り直すと入力中の composition が中断されるので、
      // この描画はスキップする (compositionend 後に再描画でキャッチアップする)。
      if (isComposing) return;
      const scrollTop = viewport.scrollTop;
      const viewHeight = rowsViewHeight();
      const rowHeight = currentRowHeight();
      const startRow = Math.max(
        0,
        Math.floor(scrollTop / rowHeight) - OVERSCAN,
      );
      // 編集モードでは末尾に新規行ドラフトを足すので表示行数が増える。
      const endRow = Math.min(
        displayRowCount(),
        Math.ceil((scrollTop + viewHeight) / rowHeight) + OVERSCAN,
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

      const covered =
        !rebuildPending &&
        Math.floor(scrollTop / rowHeight) >= renderStartRow &&
        Math.min(
          displayRowCount(),
          Math.ceil((scrollTop + viewHeight) / rowHeight),
        ) <= renderedEndRow;
      if (covered) {
        syncPager(scrollTop, viewHeight);
        return;
      }
      rebuildPending = false;
      // setActiveCell が body 内インデックスを計算するために参照する。
      renderStartRow = startRow;
      renderedEndRow = endRow;

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

      body.replaceChildren();
      selectedRowElement = null;
      activeCellElement = null;
      body.style.transform = `translateY(${startRow * rowHeight}px)`;

      for (let i = startRow; i < endRow; i++) {
        body.appendChild(
          i < totalRows ? buildDataRow(i) : buildDraftRow(i - totalRows),
        );
      }
      syncFilteredEmptyState();
      syncPager(scrollTop, viewHeight);

      if (focusRestore) {
        const next = body.querySelector<HTMLInputElement>(
          `.db-grid-cell-input[data-edit-row="${focusRestore.row}"][data-edit-col="${focusRestore.col}"]`,
        );
        if (next) {
          next.focus?.();
          // 編集欄は type="text" だけなので setSelectionRange は投げない。
          next.setSelectionRange?.(
            focusRestore.start ?? next.value.length,
            focusRestore.end ?? next.value.length,
          );
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
    const a = templateElement(
      view.exportLink({
        href: `${apiUrl("dbExport")}?${params}`,
        download: `${currentTable}.${format}`,
      }),
    );
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function createPager(): NonNullable<typeof pagerEl> {
    const refs = {
      range: createRef<HTMLElement>(),
      prev: createRef<HTMLButtonElement>(),
      next: createRef<HTMLButtonElement>(),
    };
    const root = templateElement(
      view.pager({
        refs,
        onPage: (direction) => {
          // 1 画面ぶん (見えている最後の行が次の画面の先頭に残るよう 1 行引く)。
          viewport.scrollTop +=
            direction *
            Math.max(currentRowHeight(), rowsViewHeight() - currentRowHeight());
        },
      }),
    );
    return {
      root,
      range: shellPart(refs.range),
      prev: shellPart<HTMLButtonElement>(refs.prev),
      next: shellPart<HTMLButtonElement>(refs.next),
      shown: "",
    };
  }

  /**
   * いま見えている行の範囲とボタンの押せる・押せないを合わせる。
   * renderViewport からは DOM を組み直す前に読んだ scrollTop と高さを渡す
   * (組み直した後に読むと、毎フレーム レイアウトを強制することになる)。
   */
  function syncPager(
    scrollTop = viewport.scrollTop,
    viewHeight = rowsViewHeight(),
  ): void {
    if (!pagerEl) return;
    const t = text().grid;
    const total = totalRows;
    const first = Math.min(
      total,
      Math.floor(scrollTop / currentRowHeight()) + 1,
    );
    const last = Math.min(
      total,
      Math.max(
        first,
        Math.floor((scrollTop + viewHeight) / currentRowHeight()),
      ),
    );
    const key = `${t.pagerNext}:${first}:${last}:${total}`;
    if (key === pagerEl.shown) return;
    pagerEl.shown = key;
    pagerEl.root.hidden = total === 0;
    pagerEl.range.textContent = t.pagerRange(
      first.toLocaleString(),
      last.toLocaleString(),
      total.toLocaleString(),
    );
    pagerEl.prev.title = t.pagerPrev;
    pagerEl.prev.setAttribute("aria-label", t.pagerPrev);
    pagerEl.next.title = t.pagerNext;
    pagerEl.next.setAttribute("aria-label", t.pagerNext);
    pagerEl.prev.disabled = first <= 1;
    pagerEl.next.disabled = last >= total;
  }

  function updateStatus() {
    if (!statusEl) {
      statusEl = templateElement(view.status(null));
      el.appendChild(statusEl);
    }
    if (!pagerEl) {
      pagerEl = createPager();
      statusEl.appendChild(pagerEl.root);
    }
    syncPager();
    const t = text().grid;
    const parts: string[] = [t.statusRows(totalRows.toLocaleString())];
    if (sort && sortedNewest()) parts.push(t.statusNewest(sort.column));
    else if (sort)
      parts.push(t.statusSort(sort.column, sort.direction.toUpperCase()));
    const filterCount = activeFilterCount();
    if (filterCount > 0) parts.push(t.statusFilters(filterCount));
    if (isRefreshing) parts.push(t.statusRefreshing(filterCount));
    const marked = refreshMarks.counts();
    if (!isRefreshing && marked.added + marked.changed > 0)
      parts.push(t.statusRefreshMarks(marked.added, marked.changed));
    if (copyNotice) parts.push(copyNotice);
    const textNode = statusEl.firstChild;
    if (textNode && textNode.nodeType === Node.TEXT_NODE) {
      textNode.textContent = `${parts.join(" | ")} `;
    } else {
      statusEl.insertBefore(
        document.createTextNode(`${parts.join(" | ")} `),
        statusEl.firstChild,
      );
    }
    syncRefreshResult();
  }

  function showError(message: string) {
    clear();
    statusEl = templateElement(view.status(message));
    el.appendChild(statusEl);
  }

  function load(
    table: string,
    initialData?: DbTableDataResponse,
    fetchedSort?: GridSort | null,
  ) {
    clear();
    currentTable = table;
    if (initialData) {
      columns = initialData.columns;
      columnNames = columns.map((c) => c.name);
      totalRows = initialData.totalRows;
    } else {
      columns = [];
      columnNames = [];
      totalRows = 0;
    }
    recency.reset(columns);
    // 呼び出し側が並べ方を決めずに取った表は、ここで決める。取った並びと
    // 違えば、その行は使わずに決めた並びで取り直す。
    sort =
      fetchedSort !== undefined
        ? fetchedSort
        : initialData
          ? initialSortFor(columns)
          : null;
    const usable = initialData && sameSort(sort, fetchedSort ?? null);
    if (initialData && usable) {
      recency.notePage(initialData.rows);
      rememberPage(0, initialData.rows);
    }
    timeZone.sync();
    timeZone.setShown(
      !embedded && columns.some((_, index) => recency.isTimeColumn(index)),
    );
    rebuildFkColumnsForCurrentTable();
    loadColWidths();
    syncSpacer();
    renderHeader();
    updateStatus();
    syncNewestButton();
    // テーブルが変わったので編集 UI の出し分け (書き込み対応 + PK 有無) を更新。
    refreshEditButtons();
    showPendingStatus();
    if (!usable) {
      ensurePage(0);
    } else {
      renderViewport();
    }
  }

  async function applyState(state: AnnotationDatabaseDataState) {
    if (state.search !== undefined) {
      globalSearchValue = state.search;
      filterInput.value = state.search;
    }
    columnFilters.clear();
    for (const filter of state.filters || []) {
      if (filter.column && filter.value)
        columnFilters.set(filter.column, filter.value);
    }
    syncFilterClearButton();
    syncRefreshButton();
    sort = state.sort || null;
    const targetRowIndex = state.row && state.row > 0 ? state.row - 1 : -1;
    renderHeader();
    syncNewestButton();
    const firstPage = invalidateData();
    if (targetRowIndex >= 0) {
      await firstPage;
      selectedRowIndex = targetRowIndex;
      viewport.scrollTop = Math.max(0, targetRowIndex * currentRowHeight());
      renderViewport();
    }
  }

  function getState(): AnnotationDatabaseDataState {
    const filters = collectColumnFilters();
    return {
      ...(globalSearchValue ? { search: globalSearchValue } : {}),
      ...(filters.length ? { filters } : {}),
      ...(sort ? { sort } : {}),
      ...(selectedRowIndex >= 0 ? { row: selectedRowIndex + 1 } : {}),
    };
  }

  filterInput.addEventListener("input", () => {
    globalSearchValue = filterInput.value.trim();
    clearRefreshResult();
    syncFilterClearButton();
    syncRefreshButton();
    scheduleFilter();
  });
  filterInput.addEventListener("keydown", (e) => {
    if (isImeComposing(e)) return;
    if (e.key === "Escape") {
      filterInput.value = "";
      globalSearchValue = "";
      clearRefreshResult();
      syncFilterClearButton();
      syncRefreshButton();
      scheduleFilter();
    }
  });
  filterClear.addEventListener("click", () => {
    clearFiltersAndReload();
  });
  filteredEmptyAction.addEventListener("click", () => {
    clearFiltersAndReload();
    filterInput.focus?.();
  });
  filteredEmptyReloadAction.addEventListener("click", () => {
    void refreshCurrentTable();
  });
  refreshBtn.addEventListener("click", () => {
    void refreshCurrentTable();
  });

  const onViewportScroll = () => {
    renderViewport("scroll");
  };
  viewport.addEventListener("scroll", onViewportScroll, { passive: true });
  viewport.addEventListener("keydown", onViewportKeydown);

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

  // 表示密度を変えると行の高さが変わるので、仮想表示の高さと位置を取り直す。
  const densityObserver = new MutationObserver(() => {
    syncSpacer();
    renderViewport();
  });
  densityObserver.observe(document.body, {
    attributes: true,
    attributeFilter: ["data-sidebar-font-size"],
  });

  // 「〜分前」は時間が経つと古くなるので、1 分ごとに描いてある分だけ合わせる。
  const recencyTimer = setInterval(() => {
    if (recency.shown() && el.isConnected) recency.refreshLabels(body);
  }, 60_000);

  function destroy() {
    clearInterval(recencyTimer);
    rangeSelect.destroy();
    if (copyNoticeTimer) clearTimeout(copyNoticeTimer);
    densityObserver.disconnect();
    clear();
    embeddedGrid?.destroy();
    embeddedGrid = null;
    relatedListResizeDetach?.();
    relatedListResizeDetach = null;
    viewport.removeEventListener("scroll", onViewportScroll);
    viewport.removeEventListener("keydown", onViewportKeydown);
    body.removeEventListener("compositionstart", onCompositionStart);
    body.removeEventListener("compositionend", onCompositionEnd);
    // ドラッグ中の window リスナーが残らないよう、teardown 時に外す。
    detailResizeCleanup?.();
  }

  /** 言語切替時、組み込み済み DOM の文言を再適用する（再描画なし）。 */
  function localize() {
    const t = text();
    filterInput.placeholder = t.grid.searchPlaceholder;
    syncFilterClearButton();
    syncRefreshButton();
    syncRefreshResult();
    syncFilteredEmptyState();
    exportBtn.title = t.grid.exportAction;
    exportBtn.setAttribute("aria-label", t.grid.exportAction);
    newRowBtn.textContent = t.edit.newRow;
    commitBtn.textContent = t.edit.commit;
    discardBtn.textContent = t.edit.discard;
    syncNewestButton();
    timeZone.sync();
    recency.refreshLabels(body);
    showPendingStatus();
    if (relatedEmptyEl) relatedEmptyEl.textContent = t.grid.relatedEmpty;
    if (relatedCopyBtn) relatedCopyBtn.textContent = t.detail.copy;
    if (currentTable) {
      renderHeader(); // FK アイコンの title や列フィルタを再構築
      updateStatus();
    }
    renderRelatedCrumbs();
    renderRelatedList();
    if (relatedListResizeEl) {
      relatedListResizeEl.setAttribute("aria-label", t.grid.relatedListResize);
    }
    if (!detailPanel.hidden) showDetailForActiveCell();
    embeddedGrid?.localize();
  }

  // FK 列 (outgoing) と、他から参照されている列 (incoming = 通常 PK) の
  // 両方にヘッダのリンクアイコンを付け、セルクリックで関連パネルを開けるようにする。
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
    spacer.style.height = `${displayRowCount() * currentRowHeight()}px`;
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
          reportDatastoreFailure("SQL", "save changes", err, currentTable, {
            changes: mutations.length,
          }),
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
  // 仮想 FK のトグル切替時、データを再フェッチせずヘッダのリンクアイコンと
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
    focusGrid: () => viewport.focus({ preventScroll: true }),
    load,
    initialSortFor,
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
