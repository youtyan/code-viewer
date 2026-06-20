import type { DbQueryResponse, DbValue } from "../../core/database/types";

export type QueryEditorCallbacks = {
  executeQuery: (sql: string) => Promise<DbQueryResponse>;
};

export type QueryEditor = {
  el: HTMLElement;
  focus: () => void;
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

  const statusSpan = document.createElement("span");
  statusSpan.className = "db-query-status";

  toolbar.append(runBtn, statusSpan);
  inputArea.append(textarea, toolbar);

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

  runBtn.addEventListener("click", run);
  textarea.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      run();
    }
  });

  function focus() {
    textarea.focus();
  }

  return { el, focus };
}

function formatValue(value: DbValue): string {
  if (value === null) return "NULL";
  if (value instanceof Uint8Array) return `<blob ${value.byteLength} bytes>`;
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
