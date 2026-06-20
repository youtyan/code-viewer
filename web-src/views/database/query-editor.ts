import type { DbQueryResponse, DbValue } from "../../core/database/types";

const HISTORY_KEY = "db:query-history";
const MAX_HISTORY = 50;

function loadHistory(): string[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((s): s is string => typeof s === "string")
      : [];
  } catch {
    return [];
  }
}

function saveToHistory(sql: string) {
  const history = loadHistory();
  const idx = history.indexOf(sql);
  if (idx >= 0) history.splice(idx, 1);
  history.unshift(sql);
  if (history.length > MAX_HISTORY) history.length = MAX_HISTORY;
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
}

export type QueryEditorCallbacks = {
  executeQuery: (sql: string) => Promise<DbQueryResponse>;
};

export type QueryEditor = {
  el: HTMLElement;
  focus: () => void;
  setSql: (sql: string) => void;
};

export function createQueryEditor(
  callbacks: QueryEditorCallbacks,
): QueryEditor {
  const el = document.createElement("div");
  el.className = "db-query-editor";

  const inputArea = document.createElement("div");
  inputArea.className = "db-query-input";

  const textarea = document.createElement("textarea");
  textarea.className = "db-query-textarea";
  textarea.placeholder = "SELECT * FROM ...";
  textarea.spellcheck = false;
  textarea.rows = 3;

  const toolbar = document.createElement("div");
  toolbar.className = "db-query-toolbar";

  const runBtn = document.createElement("button");
  runBtn.className = "db-query-run";
  runBtn.type = "button";
  runBtn.textContent = "Run";
  runBtn.title = "Execute query (Ctrl+Enter)";

  const explainBtn = document.createElement("button");
  explainBtn.className = "db-query-run db-query-explain";
  explainBtn.type = "button";
  explainBtn.textContent = "Explain";
  explainBtn.title = "Show query execution plan";

  const historyBtn = document.createElement("button");
  historyBtn.className = "db-query-history-btn";
  historyBtn.type = "button";
  historyBtn.textContent = "History";
  historyBtn.title = "Query history";

  const statusSpan = document.createElement("span");
  statusSpan.className = "db-query-status";

  const historyDropdown = document.createElement("div");
  historyDropdown.className = "db-query-history-dropdown";
  historyDropdown.hidden = true;

  toolbar.append(runBtn, explainBtn, historyBtn, statusSpan);
  inputArea.append(textarea, toolbar, historyDropdown);

  const resultArea = document.createElement("div");
  resultArea.className = "db-query-result";
  resultArea.hidden = true;

  el.append(inputArea, resultArea);

  async function run() {
    const sql = textarea.value.trim();
    if (!sql) return;
    runBtn.disabled = true;
    statusSpan.textContent = "Running…";
    resultArea.hidden = true;
    try {
      const result = await callbacks.executeQuery(sql);
      if (result.error) {
        statusSpan.textContent = `Error (${result.elapsedMs}ms)`;
        resultArea.hidden = false;
        resultArea.innerHTML = "";
        const errEl = document.createElement("pre");
        errEl.className = "db-query-error";
        errEl.textContent = result.error;
        resultArea.appendChild(errEl);
        return;
      }
      saveToHistory(sql);
      const suffix = result.truncated ? "+" : "";
      statusSpan.textContent = `${result.rowCount}${suffix} rows (${result.elapsedMs}ms)`;
      renderResultTable(result);
    } catch (err) {
      statusSpan.textContent = "Failed";
      resultArea.hidden = false;
      resultArea.innerHTML = "";
      const errEl = document.createElement("pre");
      errEl.className = "db-query-error";
      errEl.textContent = err instanceof Error ? err.message : String(err);
      resultArea.appendChild(errEl);
    } finally {
      runBtn.disabled = false;
    }
  }

  function renderResultTable(result: DbQueryResponse) {
    resultArea.hidden = false;
    resultArea.innerHTML = "";
    if (result.columns.length === 0) {
      resultArea.textContent = "Query returned no columns.";
      return;
    }
    const table = document.createElement("table");
    table.className = "db-query-table";

    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    const thNum = document.createElement("th");
    thNum.textContent = "#";
    thNum.className = "db-grid-rownum";
    headRow.appendChild(thNum);
    for (const col of result.columns) {
      const th = document.createElement("th");
      th.textContent = col;
      headRow.appendChild(th);
    }
    thead.appendChild(headRow);

    const tbody = document.createElement("tbody");
    for (let i = 0; i < result.rows.length; i++) {
      const row = result.rows[i];
      const tr = document.createElement("tr");
      if (i % 2 === 1) tr.classList.add("alt");
      const tdNum = document.createElement("td");
      tdNum.className = "db-grid-rownum";
      tdNum.textContent = String(i + 1);
      tr.appendChild(tdNum);
      for (const value of row) {
        const td = document.createElement("td");
        td.textContent = formatValue(value);
        if (value === null) td.classList.add("null");
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.append(thead, tbody);

    const wrapper = document.createElement("div");
    wrapper.className = "db-query-table-wrap";
    wrapper.appendChild(table);
    resultArea.appendChild(wrapper);
  }

  async function runExplain() {
    const sql = textarea.value.trim();
    if (!sql) return;
    explainBtn.disabled = true;
    runBtn.disabled = true;
    statusSpan.textContent = "Explaining…";
    resultArea.hidden = true;
    try {
      const result = await callbacks.executeQuery(`EXPLAIN QUERY PLAN ${sql}`);
      if (result.error) {
        statusSpan.textContent = `Error (${result.elapsedMs}ms)`;
        resultArea.hidden = false;
        resultArea.innerHTML = "";
        const errEl = document.createElement("pre");
        errEl.className = "db-query-error";
        errEl.textContent = result.error;
        resultArea.appendChild(errEl);
        return;
      }
      statusSpan.textContent = `Explain (${result.elapsedMs}ms)`;
      renderResultTable(result);
    } catch (err) {
      statusSpan.textContent = "Failed";
      resultArea.hidden = false;
      resultArea.innerHTML = "";
      const errEl = document.createElement("pre");
      errEl.className = "db-query-error";
      errEl.textContent = err instanceof Error ? err.message : String(err);
      resultArea.appendChild(errEl);
    } finally {
      explainBtn.disabled = false;
      runBtn.disabled = false;
    }
  }

  runBtn.addEventListener("click", run);
  explainBtn.addEventListener("click", runExplain);

  historyBtn.addEventListener("click", () => {
    if (!historyDropdown.hidden) {
      historyDropdown.hidden = true;
      return;
    }
    const history = loadHistory();
    historyDropdown.innerHTML = "";
    if (history.length === 0) {
      const empty = document.createElement("div");
      empty.className = "db-query-history-empty";
      empty.textContent = "No history";
      historyDropdown.appendChild(empty);
    } else {
      for (const sql of history) {
        const item = document.createElement("div");
        item.className = "db-query-history-item";
        item.textContent = sql.length > 100 ? `${sql.slice(0, 100)}...` : sql;
        item.title = sql;
        item.addEventListener("click", () => {
          textarea.value = sql;
          historyDropdown.hidden = true;
        });
        historyDropdown.appendChild(item);
      }
    }
    historyDropdown.hidden = false;
  });

  document.addEventListener("click", (e) => {
    if (
      !historyDropdown.hidden &&
      !historyBtn.contains(e.target as Node) &&
      !historyDropdown.contains(e.target as Node)
    ) {
      historyDropdown.hidden = true;
    }
  });

  textarea.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      run();
    }
  });

  function focus() {
    textarea.focus();
  }

  function setSql(sql: string) {
    textarea.value = sql;
  }

  return { el, focus, setSql };
}

function formatValue(value: DbValue): string {
  if (value === null) return "NULL";
  if (value instanceof Uint8Array) return `<blob ${value.byteLength} bytes>`;
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
