import { live } from "lit/directives/live.js";
import { createRef, ref } from "lit/directives/ref.js";
import { html, nothing } from "lit/html.js";
import type { DbColumn, DbTableInfo } from "../../core/database/types";
import { formatErrorDetail } from "../../core/error-detail";
import { COPY_16_PATHS, X_16_PATH } from "../../core/icons";
import { isImeComposing } from "../../core/keyboard";
import { closeContextMenu, showContextMenu } from "../context-menu";
import { iconTemplate } from "../ui/icon";
import { detachedElement } from "../ui/renderer";
import { type DbLang, dbText } from "./i18n";

export type TableListCallbacks = {
  getLanguage?: () => DbLang;
  onSelectTable: (table: string) => void;
  onViewCreateTable?: (table: string) => void;
  onViewDefinition?: (table: string) => void;
  getColumns?: (table: string) => Promise<DbColumn[]>;
  getExpandedTables?: () => string[];
  onExpandedTableChange?: (table: string, expanded: boolean) => void;
};

export type TableList = {
  el: HTMLElement;
  render: (tables: DbTableInfo[]) => void;
  setActive: (table: string | null) => void;
  updateRowCount: (table: string, rowCount: number | null) => void;
  /** 一覧の代わりに読み込み中・失敗の文を出す (次に一覧を作り直すまで)。 */
  setStatus: (message: string, options?: { error?: boolean }) => void;
  dispose: () => void;
  localize: () => void;
};

type ListText = ReturnType<typeof dbText>["tableList"];

export type TableColumnProps = {
  name: string;
  primaryKey: boolean;
  type: string;
  /** 短くした型 (character varying → varchar など)。 */
  shortType: string;
  comment: string;
  copyLabel: string;
  /** コピーのボタンの印 (押した直後だけ) と、失敗したときの title。 */
  copyState: "copied" | "failed" | null;
  copyTitle: string;
  onCopy: () => void;
};

export type TableNodeProps = {
  name: string;
  type: DbTableInfo["type"];
  active: boolean;
  /** キーで移る行 (tabindex 0)。一覧の中で 1 行だけ。 */
  tabStop: boolean;
  expanded: boolean;
  count: string;
  comment: string;
  /** 開いた行の列。読み込み中は空、失敗は理由。 */
  columns: { error: string } | TableColumnProps[];
  rowRef: (element: Element | undefined) => void;
  onSelect: () => void;
  onToggle: () => void;
  onContextMenu: (event: MouseEvent) => void;
  onKeydown: (event: KeyboardEvent) => void;
};

export type TableListProps = {
  text: ListText;
  query: string;
  summary: { text: string; title: string; error: boolean };
  /** 一覧の代わりに出す読み込み中・失敗の文。 */
  status: { message: string; error: boolean } | null;
  /** 1 つも出ないとき。絞り込み中なら「解除」も出す。 */
  empty: { text: string; filtered: boolean } | null;
  groups: { label: string; tables: TableNodeProps[] }[];
  filterRef: ReturnType<typeof createRef<HTMLInputElement>>;
  onQuery: (query: string) => void;
  onFilterKeydown: (event: KeyboardEvent) => void;
  onClear: () => void;
};

export type TableListView = (props: TableListProps) => unknown;

function columnTemplate(c: TableColumnProps): unknown {
  return html`<div
    class=${c.primaryKey ? "db-table-col-item pk" : "db-table-col-item"}
    title=${c.comment ? `${c.name}: ${c.comment}` : nothing}
  ><div class="db-table-col-main"><div class="db-table-col-name-wrap">${
    c.primaryKey ? html`<span class="db-table-col-key">PK</span>` : nothing
  }<span class="db-table-col-name">${c.name}</span><button
          type="button"
          class=${["db-icon-btn db-table-col-copy", c.copyState ?? ""].join(" ").trim()}
          title=${c.copyTitle}
          aria-label=${c.copyLabel}
          @click=${(event: Event) => {
            event.stopPropagation();
            c.onCopy();
          }}
        >${iconTemplate(COPY_16_PATHS, "octicon-copy")}</button></div
      ><span class="db-table-col-type" title=${c.type}>${c.shortType}</span></div
    >${
      c.comment
        ? html`<div class="db-table-col-comment" title=${c.comment}>${c.comment}</div>`
        : nothing
    }</div>`;
}

function tableNodeTemplate(t: TableNodeProps): unknown {
  return html`<div class="db-table-node" data-table=${t.name}><div
      class=${t.active ? "db-table-item active" : "db-table-item"}
      data-table=${t.name}
      tabindex=${t.tabStop ? 0 : -1}
      role="button"
      aria-label=${t.name}
      title=${t.name}
      ${ref(t.rowRef)}
      @click=${t.onSelect}
      @contextmenu=${t.onContextMenu}
      @keydown=${t.onKeydown}
    ><span
        class=${t.expanded ? "db-table-arrow expanded" : "db-table-arrow"}
        aria-expanded=${String(t.expanded)}
        @click=${(event: Event) => {
          event.stopPropagation();
          t.onToggle();
        }}
      ></span><span
        class="db-table-icon"
        title=${t.type === "view" ? "View" : "Table"}
        >${t.type === "view" ? "V" : "T"}</span
      ><span class="db-table-name">${t.name}</span><span class="db-table-count"
        >${t.count}</span
      ></div
    ><div class="db-table-children" ?hidden=${!t.expanded}>${
      t.comment
        ? html`<div class="db-table-col-comment" title=${t.comment}>${t.comment}</div>`
        : nothing
    }<div>${
      Array.isArray(t.columns)
        ? t.columns.map(columnTemplate)
        : html`<div class="db-pane-error">${t.columns.error}</div>`
    }</div></div></div>`;
}

export const DEFAULT_VIEW: TableListView = (p) =>
  html`<div
    class="db-table-list-wrapper"
    style="display: flex; flex-direction: column; flex: 1; overflow: hidden"
  ><div class="db-table-filter-wrap"><input
        class="db-table-filter"
        type="search"
        placeholder=${p.text.filter}
        aria-label=${p.text.filter}
        title=${p.text.keyboardHint}
        .value=${live(p.query)}
        ${ref(p.filterRef)}
        @input=${(event: Event) =>
          p.onQuery((event.currentTarget as HTMLInputElement).value)}
        @keydown=${p.onFilterKeydown}
      /><button
        class="db-table-filter-clear"
        type="button"
        title=${p.text.clear}
        aria-label=${p.text.clear}
        ?hidden=${p.query.length === 0}
        @click=${p.onClear}
      >${iconTemplate(X_16_PATH, "octicon-x")}</button></div
    ><div
      class=${p.summary.error ? "db-table-list-summary db-pane-error" : "db-table-list-summary"}
      aria-live="polite"
      title=${p.summary.title}
    >${p.summary.text}</div
    ><div class="db-table-list">${
      p.status
        ? html`<div class=${p.status.error ? "db-pane-error" : "db-pane-note"}
            >${p.status.message}</div
          >`
        : p.empty
          ? html`<div class="db-table-list-empty">${p.empty.text}${
              p.empty.filtered
                ? html`<div class="db-pane-empty-actions db-table-list-empty-actions"
                  ><button
                    type="button"
                    class="db-btn db-btn-sm"
                    title=${p.text.clear}
                    aria-label=${p.text.clear}
                    @click=${p.onClear}
                  >${p.text.clear}</button></div
                >`
                : nothing
            }</div>`
          : p.groups.map(
              (group) =>
                html`<div class="db-table-group-header">${group.label}</div>${group.tables.map(
                  tableNodeTemplate,
                )}`,
            )
    }</div></div
  >`;

/** コピーの印を出しておく時間。 */
const COPY_MARK_MS = 1000;

export function createTableList(
  callbacks: TableListCallbacks,
  view: TableListView = DEFAULT_VIEW,
): TableList {
  const text = () => dbText(callbacks.getLanguage?.() ?? "en").tableList;
  const filterRef = createRef<HTMLInputElement>();

  let disposed = false;
  let query = "";
  let activeTable: string | null = null;
  // キーで移る行。描き直したときは選んだ表 (無ければ先頭) に戻す。
  let tabStop: string | null = null;
  let allTables: DbTableInfo[] = [];
  const expandedTables = new Set<string>();
  const columnCache = new Map<string, DbColumn[]>();
  const columnErrors = new Map<string, string>();
  // 列のコピーのボタンの印と、失敗したときの理由 (title)。表を描き直すまで残す。
  const copyMarks = new Map<
    string,
    { state: "copied" | "failed" | null; title: string | null }
  >();
  // コピーの失敗は件数の行に出す (次に一覧を描き直すまで)。
  let summaryError: string | null = null;
  let status: TableListProps["status"] = null;
  // 行の要素 (キーで移るときに focus する)。lit は行を並び順で使い回すので、
  // 1 つの要素の名前が描くたびに変わる。外すときの呼び出しはどの要素かを
  // 言わないので消さず、引くときに要素の今の名前と合うかを見る。
  const rowElements = new Map<string, HTMLElement>();
  const rowNames = new WeakMap<HTMLElement, string>();
  const rowRefs = new Map<string, (element: Element | undefined) => void>();
  const rowRef = (name: string) => {
    let callback = rowRefs.get(name);
    if (!callback) {
      callback = (element) => {
        if (!(element instanceof HTMLElement)) return;
        rowElements.set(name, element);
        rowNames.set(element, name);
      };
      rowRefs.set(name, callback);
    }
    return callback;
  };
  const rowElement = (name: string): HTMLElement | null => {
    const element = rowElements.get(name);
    return element?.isConnected && rowNames.get(element) === name
      ? element
      : null;
  };

  function reportCopyFailure(error: unknown, operation: string): string {
    console.error(operation, error);
    const message = text().copyFailed(formatErrorDetail(error));
    summaryError = message;
    draw();
    return message;
  }

  /* ---- Context menu (共有のメニュー。2 枚同時に出さない) ---- */
  /** このリストが開いたメニュー。閉じると文書から外れる。 */
  let contextMenu: HTMLElement | null = null;

  function closeOwnContextMenu() {
    if (contextMenu?.isConnected) closeContextMenu();
    contextMenu = null;
  }

  function showTableMenu(e: MouseEvent, tableName: string) {
    e.preventDefault();
    const row = e.currentTarget as HTMLElement;
    const copy = (value: string, operation: string) => {
      navigator.clipboard.writeText(value).catch((error) => {
        reportCopyFailure(error, operation);
      });
    };
    contextMenu = showContextMenu(
      row,
      [
        {
          label: text().copyTableName,
          onSelect: () => copy(tableName, "Failed to copy table name"),
        },
        {
          label: text().copySelect,
          onSelect: () =>
            copy(
              `SELECT * FROM "${tableName}" LIMIT 100`,
              "Failed to copy SELECT statement",
            ),
        },
        {
          label: text().viewCreate,
          onSelect: () => callbacks.onViewCreateTable?.(tableName),
        },
        {
          label: text().viewDefinition,
          onSelect: () => callbacks.onViewDefinition?.(tableName),
        },
      ],
      { at: { x: e.clientX, y: e.clientY } },
    );
  }

  // 開いた表の列を取りに行く。前と同じく、まだ持っていない表を描き直すたびに
  // 取り直す (失敗した表も、開き直すと取り直す)。
  async function loadColumns(tableName: string): Promise<void> {
    if (columnCache.has(tableName) || !callbacks.getColumns) return;
    columnErrors.delete(tableName);
    try {
      const cols = await callbacks.getColumns(tableName);
      columnCache.set(tableName, cols);
      columnErrors.delete(tableName);
    } catch (error) {
      console.error(`Failed to load columns for ${tableName}`, error);
      if (!columnCache.has(tableName))
        columnErrors.set(
          tableName,
          text().columnsError(formatErrorDetail(error)),
        );
    }
    if (!disposed) draw();
  }

  async function copyColumn(tableName: string, columnName: string) {
    const key = `${tableName}\u0000${columnName}`;
    const mark = (state: "copied" | "failed" | null, title?: string) => {
      copyMarks.set(key, {
        state,
        title: title ?? copyMarks.get(key)?.title ?? null,
      });
      draw();
    };
    mark(null);
    try {
      await navigator.clipboard.writeText(columnName);
      mark("copied");
      setTimeout(() => mark(null), COPY_MARK_MS);
    } catch (error) {
      const message = reportCopyFailure(
        error,
        `Failed to copy column ${columnName}`,
      );
      mark("failed", message);
      setTimeout(() => mark(null), COPY_MARK_MS);
    }
  }

  function columnProps(
    tableName: string,
    t: ListText,
  ): TableNodeProps["columns"] {
    const error = columnErrors.get(tableName);
    if (error !== undefined) return { error };
    return (columnCache.get(tableName) ?? []).map((col) => {
      const key = `${tableName}\u0000${col.name}`;
      const copy = copyMarks.get(key);
      const label = t.copyColumnName(col.name);
      return {
        name: col.name,
        primaryKey: col.primaryKey,
        type: col.type,
        shortType: compactColumnType(col.type),
        comment: columnCommentText(col.comment),
        copyLabel: label,
        copyState: copy?.state ?? null,
        copyTitle: copy?.title ?? label,
        onCopy: () => void copyColumn(tableName, col.name),
      };
    });
  }

  function toggleExpand(tableName: string) {
    if (expandedTables.has(tableName)) {
      expandedTables.delete(tableName);
      callbacks.onExpandedTableChange?.(tableName, false);
    } else {
      expandedTables.add(tableName);
      callbacks.onExpandedTableChange?.(tableName, true);
      void loadColumns(tableName);
    }
    draw();
  }

  function filtered(): DbTableInfo[] {
    return query
      ? allTables.filter((t) =>
          t.name.toLowerCase().includes(query.toLowerCase()),
        )
      : allTables;
  }

  /** 画面の並び (表の組、ビューの組の順)。 */
  function grouped(): { type: string; items: DbTableInfo[] }[] {
    const groups: Record<string, DbTableInfo[]> = { table: [], view: [] };
    for (const t of filtered()) (groups[t.type] || groups.table).push(t);
    return Object.entries(groups)
      .filter(([, items]) => items.length > 0)
      .map(([type, items]) => ({ type, items }));
  }

  const visibleRows = () =>
    grouped().flatMap((group) => group.items.map((t) => t.name));

  function props(): TableListProps {
    const t = text();
    const shown = filtered();
    return {
      text: t,
      query,
      summary: summaryError
        ? { text: summaryError, title: summaryError, error: true }
        : {
            text: t.result(shown.length, allTables.length),
            title: t.keyboardHint,
            error: false,
          },
      status,
      empty:
        shown.length === 0
          ? { text: query ? t.noMatches : t.empty, filtered: !!query }
          : null,
      groups: grouped().map(({ type, items }) => ({
        label: `${type === "view" ? t.views : t.tables} · ${items.length}`,
        tables: items.map((table) => ({
          name: table.name,
          type: table.type,
          active: table.name === activeTable,
          tabStop: table.name === tabStop,
          expanded: expandedTables.has(table.name),
          count: table.rowCount != null ? formatRowCount(table.rowCount) : "",
          comment: columnCommentText(table.comment),
          columns: columnProps(table.name, t),
          rowRef: rowRef(table.name),
          onSelect: () => callbacks.onSelectTable(table.name),
          onToggle: () => toggleExpand(table.name),
          onContextMenu: (event) => showTableMenu(event, table.name),
          onKeydown: (event) => {
            if (event.target === event.currentTarget)
              handleListKey(event, table.name);
          },
        })),
      })),
      filterRef,
      onQuery: (value) => {
        if (disposed) return;
        query = value;
        rebuild();
      },
      onFilterKeydown: (event) => handleListKey(event, null),
      onClear: clearFilter,
    };
  }

  const box = detachedElement(() => view(props()));
  const draw = () => box.draw();

  // 一覧を作り直す (前の renderFiltered)。件数の行の失敗・コピーの印を消し、
  // キーで移る行を選んだ表 (見えなければ先頭) に戻し、開いた表の列を取りに行く。
  function rebuild(): void {
    summaryError = null;
    status = null;
    copyMarks.clear();
    const rows = visibleRows();
    tabStop =
      activeTable !== null && rows.includes(activeTable)
        ? activeTable
        : (rows[0] ?? null);
    for (const name of rows)
      if (expandedTables.has(name) && !columnCache.has(name))
        void loadColumns(name);
    draw();
  }

  function clearFilter(): void {
    if (disposed || !query) return;
    query = "";
    rebuild();
    filterRef.value?.focus();
  }

  function render(tables: DbTableInfo[]) {
    allTables = tables;
    expandedTables.clear();
    const tableNames = new Set(tables.map((table) => table.name));
    for (const table of callbacks.getExpandedTables?.() || []) {
      if (tableNames.has(table)) expandedTables.add(table);
    }
    columnCache.clear();
    columnErrors.clear();
    activeTable = null;
    closeOwnContextMenu();
    query = "";
    rebuild();
  }

  function handleListKey(event: KeyboardEvent, row: string | null) {
    if (disposed) return;
    if (isImeComposing(event) || event.altKey || event.ctrlKey || event.metaKey)
      return;
    const rows = visibleRows();
    const index = row ? rows.indexOf(row) : -1;
    let next: string | undefined;
    if (event.key === "Escape") {
      clearFilter();
    } else if (event.key === "ArrowDown")
      next = rows[Math.min(index + 1, rows.length - 1)];
    else if (event.key === "ArrowUp") next = rows[Math.max(0, index - 1)];
    else if (event.key === "Home" && row) next = rows[0];
    else if (event.key === "End" && row) next = rows[rows.length - 1];
    else if (event.key === "Enter" || (event.key === " " && row)) {
      const target = row ?? rows[0];
      if (target !== undefined) callbacks.onSelectTable(target);
    } else if (
      (event.key === "ArrowRight" || event.key === "ArrowLeft") &&
      row
    ) {
      if (expandedTables.has(row) !== (event.key === "ArrowRight"))
        toggleExpand(row);
    } else return;
    event.preventDefault();
    event.stopPropagation();
    if (next !== undefined) {
      tabStop = next;
      draw();
      const element = rowElement(next);
      element?.focus();
      element?.scrollIntoView({ block: "nearest" });
    }
  }

  function setActive(table: string | null) {
    activeTable = table;
    tabStop = table;
    draw();
  }

  function updateRowCount(table: string, rowCount: number | null): void {
    allTables = allTables.map((entry) =>
      entry.name === table ? { ...entry, rowCount } : entry,
    );
    draw();
  }

  function dispose(): void {
    closeOwnContextMenu();
    disposed = true;
    allTables = [];
    expandedTables.clear();
    columnCache.clear();
    columnErrors.clear();
    activeTable = null;
  }

  return {
    el: box.element,
    render,
    setActive,
    updateRowCount,
    setStatus(message, options = {}) {
      status = { message, error: options.error === true };
      draw();
    },
    dispose,
    localize: rebuild,
  };
}

export function formatRowCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function columnCommentText(comment: string | null | undefined): string {
  return (comment || "").trim();
}

function compactColumnType(type: string): string {
  const normalized = type.toLowerCase();
  if (normalized === "character varying") return "varchar";
  if (normalized === "timestamp with time zone") return "timestamptz";
  if (normalized === "timestamp without time zone") return "timestamp";
  if (normalized === "double precision") return "double";
  if (normalized === "USER-DEFINED".toLowerCase()) return "enum";
  return type;
}
