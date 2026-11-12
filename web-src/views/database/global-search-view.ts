import { createRef, type Ref, ref } from "lit/directives/ref.js";
import { html, nothing } from "lit/html.js";
import { apiUrl } from "../../core/api-url";
import type { GlobalSearchHit } from "../../core/database/types";
import { isImeComposing } from "../../core/keyboard";
import { detachedElement } from "../ui/renderer";
import { type DbText, dbText } from "./i18n";
import { reportDatastoreFailure, requireOkResponse } from "./report-failure";

export type GlobalSearchViewDeps = {
  getDbId: () => string | null;
  getSchema: () => string | null;
  getText?: () => DbText;
};

export type GlobalSearchView = {
  el: HTMLElement;
  setSearch: (
    term: string,
    options?: { includeNonText?: boolean; autoRun?: boolean },
  ) => void;
  getSearch: () => { term?: string; includeNonText?: boolean };
  dispose: () => void;
  localize: () => void;
};

/** 1 つの表で並べる当たりの数。残りは「ほか N 件」と書く。 */
const HITS_PER_TABLE = 100;

export type GlobalSearchProps = {
  labels: {
    placeholder: string;
    searchButton: string;
    cancelButton: string;
    includeNonText: string;
  };
  /** 探している間は欄と［検索］を止め、［中止］を出す。 */
  running: boolean;
  /** 進み具合の文 (探し始めるまでは出さない)。 */
  progress: string | null;
  /** 表ごとの当たり。 */
  tables: {
    label: string;
    hits: { column: string; value: string }[];
    more: string | null;
  }[];
  /** 語の欄と「文字でない列も」の欄。中身は欄が持つ。 */
  inputRef: Ref<HTMLInputElement>;
  nonTextRef: Ref<HTMLInputElement>;
  onSearch: () => void;
  onCancel: () => void;
  onKeydown: (event: KeyboardEvent) => void;
};

export type GlobalSearchViewView = (props: GlobalSearchProps) => unknown;

export const DEFAULT_VIEW: GlobalSearchViewView = (p) =>
  html`<div class="db-global-search"><div class="db-global-search-header"><input
        type="text"
        class="db-global-search-input"
        placeholder=${p.labels.placeholder}
        ?disabled=${p.running}
        ${ref(p.inputRef)}
        @keydown=${p.onKeydown}
      /><button
        type="button"
        class="db-global-search-btn"
        ?disabled=${p.running}
        @click=${p.onSearch}
      >${p.labels.searchButton}</button><button
        type="button"
        class="db-global-search-cancel"
        ?hidden=${!p.running}
        @click=${p.onCancel}
      >${p.labels.cancelButton}</button></div
    ><div class="db-global-search-options"><label><input
          type="checkbox"
          ${ref(p.nonTextRef)}
        />${p.labels.includeNonText}</label></div
    ><div class="db-global-search-progress" ?hidden=${p.progress === null}>${
      p.progress ?? nothing
    }</div
    ><div class="db-global-search-results">${p.tables.map(
      (table) =>
        html`<div class="db-search-table-section"><div
            class="db-search-table-header"
          >${table.label}</div><div class="db-search-hits-list">${table.hits.map(
            (hit) =>
              html`<div class="db-search-hit-row"><span class="db-search-hit-col"
                  >${hit.column}</span
                ><span class="db-search-hit-val">${hit.value}</span></div>`,
          )}${
            table.more === null
              ? nothing
              : html`<div class="db-search-more">${table.more}</div>`
          }</div></div>`,
    )}</div></div
  >`;

export function createGlobalSearchView(
  deps: GlobalSearchViewDeps,
  view: GlobalSearchViewView = DEFAULT_VIEW,
): GlobalSearchView {
  const text = (): DbText => deps.getText?.() ?? dbText("en");
  const inputRef = createRef<HTMLInputElement>();
  const nonTextRef = createRef<HTMLInputElement>();
  const field = (fieldRef: Ref<HTMLInputElement>, name: string) => {
    const element = fieldRef.value;
    if (!element)
      throw new Error(`global search: the ${name} field was not drawn`);
    return element;
  };
  const input = () => field(inputRef, "term");
  const nonTextCheck = () => field(nonTextRef, "non-text");

  const labelsNow = () => {
    const t = text().search;
    return {
      placeholder: t.placeholder,
      searchButton: t.searchButton,
      cancelButton: t.cancelButton,
      includeNonText: t.includeNonText,
    };
  };
  let labels = labelsNow();
  let running = false;
  let progress: string | null = null;
  let hits: GlobalSearchHit[] = [];

  function tables(): GlobalSearchProps["tables"] {
    const grouped = new Map<string, GlobalSearchHit[]>();
    for (const h of hits) {
      const key = h.schema ? `${h.schema}.${h.table}` : h.table;
      const existing = grouped.get(key) || [];
      existing.push(h);
      grouped.set(key, existing);
    }
    return [...grouped].map(([tableLabel, tableHits]) => ({
      label: text().search.tableSection(tableLabel, tableHits.length),
      hits: tableHits
        .slice(0, HITS_PER_TABLE)
        .map((hit) => ({ column: hit.column, value: hit.valuePreview })),
      more:
        tableHits.length > HITS_PER_TABLE
          ? text().search.moreHits(tableHits.length - HITS_PER_TABLE)
          : null,
    }));
  }

  const box = detachedElement(() =>
    view({
      labels,
      running,
      progress,
      tables: tables(),
      inputRef,
      nonTextRef,
      onSearch: () => void startSearch(),
      onCancel: () => void cancelSearch(),
      onKeydown: (e) => {
        if (isImeComposing(e)) return;
        if (e.key === "Enter") void startSearch();
      },
    }),
  );
  const el = box.element;
  const draw = () => box.draw();
  const showProgress = (message: string) => {
    progress = message;
    draw();
  };

  let currentJobId: string | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let disposed = false;

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    running = false;
    draw();
  }

  async function startSearch() {
    if (disposed) return;
    const dbId = deps.getDbId();
    const schema = deps.getSchema();
    if (!dbId) return;
    const term = input().value.trim();
    if (!term) return;

    hits = [];
    progress = text().search.starting;
    running = true;
    draw();

    try {
      const res = await fetch(apiUrl("dbSearchStart"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Code-Viewer-Action": "1",
        },
        body: JSON.stringify({
          db: dbId,
          ...(schema ? { schema } : {}),
          term,
          includeNonText: nonTextCheck().checked,
        }),
      });
      await requireOkResponse(res, text().failure.searchStart);
      const data = (await res.json()) as { jobId: string };
      if (disposed) {
        cancelJobQuietly(data.jobId);
        return;
      }
      currentJobId = data.jobId;
      pollTimer = setInterval(() => pollStatus(), 500);
    } catch (err) {
      showProgress(
        reportDatastoreFailure("SQL", "search start", err, dbId, term),
      );
      stopPolling();
    }
  }

  async function pollStatus() {
    if (disposed) return;
    if (!currentJobId) return;
    const jobId = currentJobId;
    let res: Response;
    try {
      res = await fetch(
        `${apiUrl("dbSearchStatus")}?id=${encodeURIComponent(jobId)}`,
      );
    } catch (err) {
      // 届かなかった失敗は次の周期で取り直す。理由は毎回 console に残す。
      reportDatastoreFailure("SQL", "search status", err, jobId);
      return;
    }
    try {
      // サーバが断った失敗は取り直さない。諦めたことを画面に出す。
      await requireOkResponse(res, text().failure.searchStatus);
    } catch (err) {
      stopPolling();
      if (disposed) return;
      showProgress(reportDatastoreFailure("SQL", "search status", err, jobId));
      return;
    }
    try {
      const data = (await res.json()) as {
        scannedTables: number;
        totalTables: number;
        currentTable?: string;
        hits: GlobalSearchHit[];
        done: boolean;
        error?: string;
      };
      if (disposed) return;

      if (data.error) {
        showProgress(text().search.error(data.error));
        stopPolling();
        return;
      }

      const pct =
        data.totalTables > 0
          ? Math.round((data.scannedTables / data.totalTables) * 100)
          : 0;
      progress = data.done
        ? text().search.done(data.scannedTables, data.hits.length)
        : text().search.progress(
            data.currentTable || text().search.checkingTable,
            pct,
            data.scannedTables,
            data.totalTables,
            data.hits.length,
          );
      hits = data.hits;
      draw();

      if (data.done) stopPolling();
    } catch (err) {
      // 読めなかった応答も次の周期で取り直す。理由は毎回 console に残す。
      reportDatastoreFailure("SQL", "search status", err, jobId);
    }
  }

  async function cancelSearch() {
    if (!currentJobId) return;
    const jobId = currentJobId;
    currentJobId = null;
    try {
      await cancelJob(jobId);
    } catch (err) {
      stopPolling();
      if (disposed) return;
      showProgress(reportDatastoreFailure("SQL", "search cancel", err, jobId));
      return;
    }
    stopPolling();
    if (disposed) return;
    showProgress(text().search.cancelled);
  }

  async function cancelJob(jobId: string): Promise<void> {
    const res = await fetch(apiUrl("dbSearchCancel"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Code-Viewer-Action": "1",
      },
      body: JSON.stringify({ id: jobId }),
    });
    await requireOkResponse(res, text().failure.searchCancel);
  }

  // 画面を閉じたあとの中止。見せる場所が無いので、失敗は console にだけ残す。
  function cancelJobQuietly(jobId: string): void {
    cancelJob(jobId).catch((err: unknown) => {
      reportDatastoreFailure("SQL", "search cancel", err, jobId);
    });
  }

  function setSearch(
    term: string,
    options: { includeNonText?: boolean; autoRun?: boolean } = {},
  ): void {
    input().value = term;
    nonTextCheck().checked = !!options.includeNonText;
    if (options.autoRun && term.trim()) void startSearch();
  }

  function getSearch(): { term?: string; includeNonText?: boolean } {
    const term = input().value.trim();
    return {
      ...(term ? { term } : {}),
      ...(nonTextCheck().checked ? { includeNonText: true } : {}),
    };
  }

  function dispose(): void {
    disposed = true;
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    if (currentJobId) {
      const jobId = currentJobId;
      currentJobId = null;
      cancelJobQuietly(jobId);
    }
  }

  function localize(): void {
    labels = labelsNow();
    draw();
  }

  return { el, setSearch, getSearch, dispose, localize };
}
