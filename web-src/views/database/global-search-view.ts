import type { GlobalSearchHit } from "../../core/database/types";
import { isImeComposing } from "../../core/keyboard";
import { type DbText, dbText } from "./i18n";

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

export function createGlobalSearchView(
  deps: GlobalSearchViewDeps,
): GlobalSearchView {
  const text = (): DbText => deps.getText?.() ?? dbText("en");
  const el = document.createElement("div");
  el.className = "db-global-search";

  const header = document.createElement("div");
  header.className = "db-global-search-header";

  const input = document.createElement("input");
  input.type = "text";
  input.className = "db-global-search-input";
  input.placeholder = text().search.placeholder;

  const searchBtn = document.createElement("button");
  searchBtn.type = "button";
  searchBtn.className = "db-global-search-btn";
  searchBtn.textContent = text().search.searchButton;

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "db-global-search-cancel";
  cancelBtn.textContent = text().search.cancelButton;
  cancelBtn.hidden = true;

  const optionsRow = document.createElement("div");
  optionsRow.className = "db-global-search-options";
  const nonTextLabel = document.createElement("label");
  const nonTextCheck = document.createElement("input");
  nonTextCheck.type = "checkbox";
  const nonTextText = document.createTextNode(text().search.includeNonText);
  nonTextLabel.append(nonTextCheck, nonTextText);
  optionsRow.appendChild(nonTextLabel);

  header.append(input, searchBtn, cancelBtn);

  const progress = document.createElement("div");
  progress.className = "db-global-search-progress";
  progress.hidden = true;

  const results = document.createElement("div");
  results.className = "db-global-search-results";

  el.append(header, optionsRow, progress, results);

  let currentJobId: string | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let disposed = false;

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    cancelBtn.hidden = true;
    searchBtn.disabled = false;
    input.disabled = false;
  }

  async function startSearch() {
    if (disposed) return;
    const dbId = deps.getDbId();
    const schema = deps.getSchema();
    if (!dbId) return;
    const term = input.value.trim();
    if (!term) return;

    results.innerHTML = "";
    progress.hidden = false;
    progress.textContent = text().search.starting;
    searchBtn.disabled = true;
    input.disabled = true;
    cancelBtn.hidden = false;

    try {
      const res = await fetch("/_db/search/start", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Code-Viewer-Action": "1",
        },
        body: JSON.stringify({
          db: dbId,
          ...(schema ? { schema } : {}),
          term,
          includeNonText: nonTextCheck.checked,
        }),
      });
      if (!res.ok) {
        progress.textContent = text().search.error(await res.text());
        stopPolling();
        return;
      }
      const data = (await res.json()) as { jobId: string };
      if (disposed) {
        void cancelJob(data.jobId);
        return;
      }
      currentJobId = data.jobId;
      pollTimer = setInterval(() => pollStatus(), 500);
    } catch (err) {
      progress.textContent = text().search.error(
        err instanceof Error ? err.message : String(err),
      );
      stopPolling();
    }
  }

  async function pollStatus() {
    if (disposed) return;
    if (!currentJobId) return;
    try {
      const res = await fetch(
        `/_db/search/status?id=${encodeURIComponent(currentJobId)}`,
      );
      if (!res.ok) {
        stopPolling();
        return;
      }
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
        progress.textContent = text().search.error(data.error);
        stopPolling();
        return;
      }

      const pct =
        data.totalTables > 0
          ? Math.round((data.scannedTables / data.totalTables) * 100)
          : 0;
      progress.textContent = data.done
        ? text().search.done(data.scannedTables, data.hits.length)
        : text().search.progress(
            data.currentTable || text().search.checkingTable,
            pct,
            data.scannedTables,
            data.totalTables,
            data.hits.length,
          );

      renderHits(data.hits);

      if (data.done) {
        stopPolling();
        progress.hidden = false;
      }
    } catch {
      // retry on next poll
    }
  }

  async function cancelSearch() {
    if (!currentJobId) return;
    const jobId = currentJobId;
    currentJobId = null;
    await cancelJob(jobId);
    stopPolling();
    if (disposed) return;
    progress.textContent = text().search.cancelled;
  }

  async function cancelJob(jobId: string) {
    try {
      await fetch("/_db/search/cancel", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Code-Viewer-Action": "1",
        },
        body: JSON.stringify({ id: jobId }),
      });
    } catch {
      // ignore
    }
  }

  function renderHits(hits: GlobalSearchHit[]) {
    results.innerHTML = "";
    if (hits.length === 0) return;

    const grouped = new Map<string, GlobalSearchHit[]>();
    for (const h of hits) {
      const key = h.schema ? `${h.schema}.${h.table}` : h.table;
      const existing = grouped.get(key) || [];
      existing.push(h);
      grouped.set(key, existing);
    }

    for (const [tableLabel, tableHits] of grouped) {
      const section = document.createElement("div");
      section.className = "db-search-table-section";

      const tableHeader = document.createElement("div");
      tableHeader.className = "db-search-table-header";
      tableHeader.textContent = text().search.tableSection(
        tableLabel,
        tableHits.length,
      );
      section.appendChild(tableHeader);

      const hitsList = document.createElement("div");
      hitsList.className = "db-search-hits-list";

      for (const hit of tableHits.slice(0, 100)) {
        const row = document.createElement("div");
        row.className = "db-search-hit-row";

        const colSpan = document.createElement("span");
        colSpan.className = "db-search-hit-col";
        colSpan.textContent = hit.column;

        const valSpan = document.createElement("span");
        valSpan.className = "db-search-hit-val";
        valSpan.textContent = hit.valuePreview;

        row.append(colSpan, valSpan);
        hitsList.appendChild(row);
      }

      if (tableHits.length > 100) {
        const more = document.createElement("div");
        more.className = "db-search-more";
        more.textContent = text().search.moreHits(tableHits.length - 100);
        hitsList.appendChild(more);
      }

      section.appendChild(hitsList);
      results.appendChild(section);
    }
  }

  searchBtn.addEventListener("click", startSearch);
  input.addEventListener("keydown", (e) => {
    if (isImeComposing(e)) return;
    if (e.key === "Enter") startSearch();
  });
  cancelBtn.addEventListener("click", cancelSearch);

  function setSearch(
    term: string,
    options: { includeNonText?: boolean; autoRun?: boolean } = {},
  ): void {
    input.value = term;
    nonTextCheck.checked = !!options.includeNonText;
    if (options.autoRun && term.trim()) void startSearch();
  }

  function getSearch(): { term?: string; includeNonText?: boolean } {
    const term = input.value.trim();
    return {
      ...(term ? { term } : {}),
      ...(nonTextCheck.checked ? { includeNonText: true } : {}),
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
      void cancelJob(jobId);
    }
  }

  function localize(): void {
    const t = text().search;
    input.placeholder = t.placeholder;
    searchBtn.textContent = t.searchButton;
    cancelBtn.textContent = t.cancelButton;
    nonTextText.textContent = t.includeNonText;
  }

  return { el, setSearch, getSearch, dispose, localize };
}
