import { html, nothing } from "lit/html.js";
import { apiUrl } from "../../core/api-url";
import { showCopyFailure } from "../../core/copy-failure";
import type {
  QueryHistoryEntry,
  QueryHistoryState,
} from "../../core/database/types";
import {
  errorWithCause,
  formatErrorDetail,
  responseErrorMessage,
} from "../../core/error-detail";
import { SYNC_16_PATH } from "../../core/icons";
import { iconTemplate } from "../ui/icon";
import { detachedElement } from "../ui/renderer";
import { type DbText, dbText } from "./i18n";
import { formatQueryValue, nullOrEmptyMark } from "./query-value";

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
  | { type: "unchanged" }
  | { type: "error"; message: string };

export type QueryHistoryMetaProps = {
  executor: string;
  time: string;
  /** 時刻の元の文字 (title)。 */
  executedAt: string;
  stats: string;
  /** 失敗した問い合わせの理由 (行数の代わりに「失敗」の印を出す)。 */
  failure: string | null;
};

export type QueryHistoryDetailProps = {
  meta: QueryHistoryMetaProps;
  useLabel: string;
  copyLabel: string;
  deleteLabel: string;
  deleteArmed: boolean;
  sql: string;
  error: string | null;
  body: string | null;
  preview: {
    columns: string[];
    rows: { mark: unknown; cellClass: string | null; text: string }[][];
  } | null;
  /** 保存した行が実際の行より少ないときの文。 */
  truncated: string | null;
  onUse: () => void;
  /** 押したボタン (失敗の印と理由をそこに出す)。 */
  onCopy: (button: HTMLElement) => void;
  onDelete: () => void;
};

export type QueryHistoryProps = {
  labels: {
    refresh: string;
    refreshTitle: string;
    clear: string;
    clearTitle: string;
    placeholder: string;
  };
  busy: boolean;
  result: { text: string; added: boolean; error: boolean };
  clearArmed: boolean;
  entries: {
    id: string;
    selected: boolean;
    meta: QueryHistoryMetaProps;
    title: string;
    onSelect: () => void;
  }[];
  empty: string | null;
  detail: QueryHistoryDetailProps | null;
  onRefresh: () => void;
  onClear: () => void;
};

export type QueryHistoryViewView = (props: QueryHistoryProps) => unknown;

function metaTemplate(m: QueryHistoryMetaProps, className: string): unknown {
  return html`<div class=${className}><span class="db-query-history-by"
      >${m.executor}</span
    ><span class="db-query-history-time" title=${m.executedAt}>${m.time}</span
    ><span
      class=${m.failure === null ? "db-query-history-stats" : "db-query-history-stats db-query-history-failed"}
      title=${m.failure ?? nothing}
      >${m.stats}</span
    ></div>`;
}

function detailTemplate(d: QueryHistoryDetailProps): unknown {
  const truncated = d.truncated
    ? html`<div class="db-query-history-truncated">${d.truncated}</div>`
    : nothing;
  return html`${metaTemplate(d.meta, "db-query-history-detail-meta")}<div
      class="db-query-history-detail-actions"
    ><button class="db-btn db-btn-primary" type="button" @click=${d.onUse}
      >${d.useLabel}</button
    ><button
      class="db-btn"
      type="button"
      @click=${(event: Event) => d.onCopy(event.currentTarget as HTMLElement)}
    >${d.copyLabel}</button
    ><button
      class="db-btn db-query-history-danger"
      type="button"
      data-confirm=${d.deleteArmed ? "1" : nothing}
      @click=${d.onDelete}
    >${d.deleteLabel}</button></div
  ><pre class="db-query-history-sql">${d.sql}</pre>${
    d.error === null
      ? nothing
      : html`<pre class="db-query-error">${d.error}</pre>`
  }${
    d.body === null
      ? nothing
      : html`<div class="db-query-history-body">${d.body}</div>`
  }${
    d.preview
      ? html`<div class="db-query-table-wrap"><table class="db-query-table"><thead
              ><tr><th class="db-grid-rownum">#</th>${d.preview.columns.map(
                (col) => html`<th>${col}</th>`,
              )}</tr></thead
            ><tbody>${d.preview.rows.map(
              (row, i) =>
                html`<tr class=${i % 2 === 1 ? "alt" : nothing}><td
                    class="db-grid-rownum"
                  >${i + 1}</td>${row.map(
                    (cell) =>
                      html`<td class=${cell.cellClass ?? nothing}>${
                        cell.mark ?? cell.text
                      }</td>`,
                  )}</tr>`,
            )}</tbody></table
          >${truncated}</div>`
      : nothing
  }${truncated}`;
}

export const DEFAULT_VIEW: QueryHistoryViewView = (p) =>
  html`<div class="db-query-history"><div class="db-query-history-toolbar"><button
        class=${p.busy ? "db-query-history-action db-query-history-refresh spinning" : "db-query-history-action db-query-history-refresh"}
        type="button"
        title=${p.labels.refreshTitle}
        aria-label=${p.labels.refreshTitle}
        aria-busy=${p.busy ? "true" : "false"}
        ?disabled=${p.busy}
        @click=${p.onRefresh}
      >${iconTemplate(SYNC_16_PATH, "octicon-sync")}<span
          class="db-query-history-action-label"
          >${p.labels.refresh}</span
        ></button
      ><span
        class=${[
          "db-refresh-result db-query-history-refresh-result",
          p.result.added ? "changed" : "",
          p.result.error ? "db-pane-error" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        aria-live="polite"
        ?hidden=${p.result.text.length === 0}
        >${p.result.text}</span
      ><button
        class="db-query-history-action db-query-history-danger"
        type="button"
        title=${p.labels.clearTitle}
        data-confirm=${p.clearArmed ? "1" : nothing}
        @click=${p.onClear}
      >${p.labels.clear}</button></div
    ><div class="db-query-history-body-split"><div
        class="db-query-history-list-col"
      ><div class="db-query-history-list">${
        p.empty !== null
          ? html`<div class="db-query-history-empty">${p.empty}</div>`
          : p.entries.map(
              (e) =>
                html`<div
                  class=${e.selected ? "db-query-history-entry selected" : "db-query-history-entry"}
                  data-id=${e.id}
                  @click=${e.onSelect}
                >${metaTemplate(e.meta, "db-query-history-entry-meta")}<div
                    class="db-query-history-entry-title"
                  >${e.title}</div></div>`,
            )
      }</div></div
      ><div class="db-query-history-detail-col">${
        p.detail
          ? detailTemplate(p.detail)
          : html`<div class="db-query-history-detail-placeholder"
              >${p.labels.placeholder}</div
            >`
      }</div></div
    ></div
  >`;

/** 消す・全部消すの確かめを待つ時間と、「コピーしました」を出す時間。 */
const CONFIRM_MS = 3000;
const COPIED_MS = 1500;

export function createQueryHistoryView(
  callbacks: QueryHistoryViewCallbacks,
  view: QueryHistoryViewView = DEFAULT_VIEW,
): QueryHistoryView {
  const text = (): DbText => callbacks.getText?.() ?? dbText("en");

  let entries: QueryHistoryEntry[] = [];
  let lastRefreshKey: string | null = null;
  let lastRefreshAt = 0;
  let inFlightRefresh: { key: string; promise: Promise<void> } | null = null;
  let refreshResultState: RefreshResult = { type: "none" };
  let busy = false;
  let selectedEntryId: string | null = null;
  // 押して確かめを待っている「全部消す」と、詳細の「消す」(その記録の id)。
  let clearArmed = false;
  let clearConfirmTimer: ReturnType<typeof setTimeout> | null = null;
  let deleteArmed: string | null = null;
  let copiedId: string | null = null;

  function refreshResultText(): string {
    switch (refreshResultState.type) {
      case "none":
        return "";
      case "added":
        return text().history.refreshResultAdded(refreshResultState.count);
      case "unchanged":
        return text().history.refreshResultUnchanged;
      case "error":
        return refreshResultState.message;
      default: {
        const exhaustive: never = refreshResultState;
        return exhaustive;
      }
    }
  }

  function metaProps(
    entry: QueryHistoryEntry,
    mode: "entry" | "detail",
  ): QueryHistoryMetaProps {
    const t = text().history;
    const executor = entry.executedBy === "ai" ? t.executorAi : t.executorUser;
    const elapsed = t.elapsedLabel(entry.elapsedMs);
    return {
      executor: mode === "detail" ? executor : `[${executor}]`,
      time: formatTime(entry.executedAt),
      executedAt: entry.executedAt,
      stats:
        entry.error !== undefined
          ? `${t.failedMark}, ${elapsed}`
          : `${t.rowsLabel(entry.rowCount, entry.truncated)}, ${elapsed}`,
      failure: entry.error ?? null,
    };
  }

  function detailProps(entry: QueryHistoryEntry): QueryHistoryDetailProps {
    const t = text().history;
    const emptyLabel = text().grid.emptyValue;
    return {
      meta: metaProps(entry, "detail"),
      useLabel: t.useInEditor,
      copyLabel: copiedId === entry.id ? t.copied : t.copySql,
      deleteLabel: deleteArmed === entry.id ? t.confirmDelete : t.delete,
      deleteArmed: deleteArmed === entry.id,
      sql: entry.sql,
      error: entry.error ?? null,
      body: entry.body ? entry.body : null,
      preview:
        entry.columns.length > 0 && entry.rowsPreview.length > 0
          ? {
              columns: entry.columns,
              rows: entry.rowsPreview.map((row) =>
                row.map((value) => {
                  const shown = nullOrEmptyMark(value, emptyLabel);
                  return {
                    mark: shown?.mark ?? null,
                    cellClass: shown?.cellClass ?? null,
                    text: shown ? "" : formatQueryValue(value),
                  };
                }),
              ),
            }
          : null,
      truncated:
        entry.savedRows < entry.rowCount
          ? t.truncatedRows(entry.savedRows, entry.rowCount)
          : null,
      onUse: () => callbacks.copySqlToQuery(entry.sql),
      onCopy: (button) => {
        navigator.clipboard.writeText(entry.sql).then(
          () => {
            copiedId = entry.id;
            draw();
            setTimeout(() => {
              if (copiedId !== entry.id) return;
              copiedId = null;
              draw();
            }, COPIED_MS);
          },
          (error: unknown) =>
            showCopyFailure(
              button,
              "copy a query from the history",
              error,
              button.title,
              4000,
            ),
        );
      },
      onDelete: () => {
        if (deleteArmed !== entry.id) {
          deleteArmed = entry.id;
          draw();
          window.setTimeout(() => {
            if (deleteArmed !== entry.id) return;
            deleteArmed = null;
            draw();
          }, CONFIRM_MS);
          return;
        }
        deleteArmed = null;
        draw();
        void deleteEntry(entry.id);
      },
    };
  }

  function props(): QueryHistoryProps {
    const t = text().history;
    const selected = selectedEntryId
      ? entries.find((entry) => entry.id === selectedEntryId)
      : undefined;
    const resultText = refreshResultText();
    return {
      labels: {
        refresh: t.refresh,
        refreshTitle: t.refreshTitle,
        clear: clearArmed ? t.confirmClear : t.clearAll,
        clearTitle: t.clearTitle,
        placeholder: t.selectPlaceholder,
      },
      busy,
      result: {
        text: resultText,
        added: refreshResultState.type === "added",
        error: refreshResultState.type === "error",
      },
      clearArmed,
      entries: entries.map((entry) => ({
        id: entry.id,
        selected: entry.id === selectedEntryId,
        meta: metaProps(entry, "entry"),
        title:
          entry.title ||
          (entry.sql.length > 80 ? `${entry.sql.slice(0, 80)}...` : entry.sql),
        onSelect: () => {
          selectedEntryId = entry.id;
          // 選び直した詳細の「消す」「コピー」は、押す前の形から始める。
          deleteArmed = null;
          copiedId = null;
          draw();
        },
      })),
      empty: entries.length === 0 ? t.empty : null,
      detail: selected ? detailProps(selected) : null,
      onRefresh: () => void refresh({ force: true, announceResult: true }),
      onClear: () => void clearAll(),
    };
  }

  const box = detachedElement(() => view(props()));
  const draw = () => box.draw();

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
  }

  function reportHistoryError(
    operation: string,
    message: string,
    error: unknown,
  ): void {
    console.error(operation, error);
    refreshResultState = { type: "error", message };
    draw();
  }

  async function parseHistoryResponse(
    response: Response,
    operation: string,
  ): Promise<QueryHistoryState> {
    if (!response.ok) {
      throw new Error(await responseErrorMessage(response, operation));
    }
    try {
      return (await response.json()) as QueryHistoryState;
    } catch (error) {
      throw errorWithCause(`${operation}: response is not valid JSON`, error);
    }
  }

  function currentRefreshParams(): { key: string; params: string } {
    const dbId = callbacks.getDbId();
    const schema = callbacks.getSchema();
    const searchParams = new URLSearchParams();
    if (dbId) searchParams.set("db", dbId);
    if (schema) searchParams.set("schema", schema);
    const params = searchParams.toString() ? `?${searchParams.toString()}` : "";
    return { key: params, params };
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
    if (options.announceResult) refreshResultState = { type: "none" };
    busy = true;
    draw();
    const promise = (async () => {
      const res = await fetch(`${apiUrl("dbHistory")}${params}`);
      const state = await parseHistoryResponse(
        res,
        text().failure.refreshHistory,
      );
      if (currentRefreshParams().key !== refreshKey) return;
      entries = state.entries;
      if (previousEntries) setRefreshResult(previousEntries, entries);
      lastRefreshKey = refreshKey;
      lastRefreshAt = Date.now();
      if (
        selectedEntryId &&
        !entries.some((entry) => entry.id === selectedEntryId)
      )
        selectedEntryId = null;
      draw();
    })().catch((error) => {
      reportHistoryError(
        "Failed to refresh query history",
        text().history.refreshError(formatErrorDetail(error)),
        error,
      );
    });
    inFlightRefresh = { key: refreshKey, promise };
    try {
      await promise;
    } finally {
      if (inFlightRefresh?.promise === promise) {
        inFlightRefresh = null;
        busy = false;
        draw();
      }
    }
  }

  async function deleteEntry(id: string) {
    try {
      const response = await fetch(apiUrl("dbHistoryDelete"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Code-Viewer-Action": "1",
        },
        body: JSON.stringify({ id }),
      });
      if (!response.ok) {
        throw new Error(
          await responseErrorMessage(
            response,
            text().failure.deleteHistoryEntry,
          ),
        );
      }
      entries = entries.filter((e) => e.id !== id);
      if (selectedEntryId === id) selectedEntryId = null;
      draw();
    } catch (error) {
      reportHistoryError(
        "Failed to delete query history entry",
        text().history.deleteError(formatErrorDetail(error)),
        error,
      );
    }
  }

  function disarmClear(): void {
    clearArmed = false;
    if (clearConfirmTimer) {
      clearTimeout(clearConfirmTimer);
      clearConfirmTimer = null;
    }
  }

  async function clearAll(): Promise<void> {
    const dbId = callbacks.getDbId();
    if (!clearArmed) {
      clearArmed = true;
      if (clearConfirmTimer) clearTimeout(clearConfirmTimer);
      clearConfirmTimer = setTimeout(() => {
        clearArmed = false;
        clearConfirmTimer = null;
        draw();
      }, CONFIRM_MS);
      draw();
      return;
    }
    disarmClear();
    draw();
    try {
      const schema = callbacks.getSchema();
      const response = await fetch(apiUrl("dbHistoryClear"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Code-Viewer-Action": "1",
        },
        body: JSON.stringify(
          dbId ? { db: dbId, ...(schema ? { schema } : {}) } : {},
        ),
      });
      if (!response.ok) {
        throw new Error(
          await responseErrorMessage(response, text().failure.clearHistory),
        );
      }
      entries = [];
      refreshResultState = { type: "none" };
      draw();
    } catch (error) {
      reportHistoryError(
        "Failed to clear query history",
        text().history.clearError(formatErrorDetail(error)),
        error,
      );
    }
  }

  function clear(): void {
    entries = [];
    lastRefreshKey = null;
    lastRefreshAt = 0;
    refreshResultState = { type: "none" };
    disarmClear();
    selectedEntryId = null;
    draw();
  }

  return { el: box.element, refresh, clear, localize: draw };
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) {
      throw new RangeError(`Invalid query history timestamp: ${iso}`);
    }
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  } catch (error) {
    console.error("Failed to format query history timestamp", error);
    return iso;
  }
}
