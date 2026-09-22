import type { DbQueryResponse } from "../../core/database/types";
import { attachDragResizer } from "../../core/drag-resizer";
import { formatErrorDetail } from "../../core/error-detail";
import { CHEVRON_DOWN_16_PATH, iconSvg } from "../../core/icons";
import { isImeComposing } from "../../core/keyboard";
import {
  loadShikiHighlighter,
  type ShikiHighlighter,
} from "../../core/shiki-loader";
import { type DbText, dbText } from "./i18n";
import { formatQueryValue } from "./query-value";
import { highlightSqlToInnerHtml } from "./shiki-sql";

const MAX_HISTORY = 50;
const MIN_INPUT_HEIGHT = 120;
const MAX_INPUT_HEIGHT = 480;

export type QueryEditorCallbacks = {
  executeQuery: (sql: string) => Promise<DbQueryResponse>;
  loadHistory?: () => Promise<string[]> | string[];
  // textarea の内容が変わった (input または setSql 経由) ことを外側に
  // 通知する。タブごとに SQL draft を persist するために使う。
  onSqlChange?: (sql: string) => void;
  onResultShown?: () => void;
  getText?: () => DbText;
};

export type QueryEditor = {
  el: HTMLElement;
  focus: () => void;
  setSql: (sql: string, options?: { silent?: boolean }) => void;
  getSql: () => string;
  run: () => Promise<void>;
  explain: () => Promise<void>;
  showTableResult: () => void;
  dispose: () => void;
  localize: () => void;
};

export function createQueryEditor(
  callbacks: QueryEditorCallbacks,
): QueryEditor {
  const text = (): DbText => callbacks.getText?.() ?? dbText("en");
  const el = document.createElement("div");
  el.className = "db-query-editor";

  const inputArea = document.createElement("div");
  inputArea.className = "db-query-input";

  const editorWrap = document.createElement("div");
  editorWrap.className = "db-query-editor-wrap";

  const highlight = document.createElement("pre");
  highlight.className = "db-query-highlight";
  highlight.setAttribute("aria-hidden", "true");

  const textarea = document.createElement("textarea");
  textarea.className = "db-query-textarea";
  textarea.placeholder = text().editor.sqlPlaceholder;
  textarea.spellcheck = false;
  textarea.rows = 3;

  editorWrap.append(highlight, textarea);

  let shiki: ShikiHighlighter | null = null;
  loadShikiHighlighter({
    themes: ["github-light", "github-dark"],
    langs: ["sql"],
  }).then((h) => {
    shiki = h;
    syncHighlight();
  });

  function syncHighlight() {
    const code = textarea.value;
    if (!code) {
      highlight.innerHTML = "";
      return;
    }
    const inner = highlightSqlToInnerHtml(code, shiki);
    if (inner) {
      highlight.innerHTML = inner;
    } else {
      highlight.textContent = code;
    }
  }

  textarea.addEventListener("input", () => {
    syncHighlight();
    callbacks.onSqlChange?.(textarea.value);
  });
  textarea.addEventListener("scroll", () => {
    highlight.scrollTop = textarea.scrollTop;
    highlight.scrollLeft = textarea.scrollLeft;
  });

  const toolbar = document.createElement("div");
  toolbar.className = "db-query-toolbar";

  const runBtn = document.createElement("button");
  runBtn.className = "db-btn db-btn-primary db-query-run";
  runBtn.type = "button";
  runBtn.textContent = text().editor.run;
  runBtn.title = text().editor.runTitle;

  const explainBtn = document.createElement("button");
  explainBtn.className = "db-btn db-query-explain";
  explainBtn.type = "button";
  explainBtn.textContent = text().editor.explain;
  explainBtn.title = text().editor.explainTitle;

  const historyBtn = document.createElement("button");
  historyBtn.className = "db-btn db-query-history-btn";
  historyBtn.type = "button";
  historyBtn.textContent = text().editor.localHistory;
  historyBtn.title = text().editor.localHistoryTitle;

  const statusSpan = document.createElement("span");
  statusSpan.className = "db-query-status";

  const collapseBtn = document.createElement("button");
  collapseBtn.className = "db-query-collapse";
  collapseBtn.type = "button";
  collapseBtn.innerHTML = iconSvg("octicon-chevron-down", CHEVRON_DOWN_16_PATH);
  collapseBtn.setAttribute("aria-expanded", "true");

  const historyDropdown = document.createElement("div");
  historyDropdown.className = "db-query-history-dropdown";
  historyDropdown.hidden = true;

  toolbar.append(runBtn, explainBtn, historyBtn, statusSpan, collapseBtn);
  inputArea.append(editorWrap, toolbar, historyDropdown);

  const resizeHandle = document.createElement("div");
  resizeHandle.className = "db-query-resize";
  resizeHandle.tabIndex = 0;
  resizeHandle.setAttribute("role", "separator");
  resizeHandle.setAttribute("aria-orientation", "vertical");

  const resultArea = document.createElement("div");
  resultArea.className = "db-query-result";
  resultArea.hidden = true;

  el.append(inputArea, resizeHandle, resultArea);

  let resizedInputHeight: number | null = null;

  function applyInputHeight(height: number): void {
    const availableHeight = el.parentElement?.getBoundingClientRect().height;
    const availableMax = availableHeight
      ? Math.max(MIN_INPUT_HEIGHT, availableHeight - MIN_INPUT_HEIGHT)
      : MAX_INPUT_HEIGHT;
    const maxHeight = Math.min(MAX_INPUT_HEIGHT, availableMax);
    resizedInputHeight = Math.round(
      Math.max(MIN_INPUT_HEIGHT, Math.min(maxHeight, height)),
    );
    inputArea.style.height = `${resizedInputHeight}px`;
  }

  const detachResizer = attachDragResizer({
    handle: resizeHandle,
    getSize: () => inputArea.getBoundingClientRect().height,
    applySize: applyInputHeight,
    axis: "y",
    direction: 1,
    activeClassTarget: el,
    activeClassName: "is-resizing",
  });

  function setInputExpanded(expanded: boolean): void {
    editorWrap.hidden = !expanded;
    resizeHandle.hidden = !expanded;
    collapseBtn.setAttribute("aria-expanded", String(expanded));
    el.classList.toggle("is-collapsed", !expanded);
    inputArea.style.height =
      expanded && resizedInputHeight ? `${resizedInputHeight}px` : "";
    collapseBtn.title = expanded
      ? text().editor.collapseInput
      : text().editor.expandInput;
    collapseBtn.setAttribute("aria-label", collapseBtn.title);
  }

  collapseBtn.addEventListener("click", () => {
    setInputExpanded(collapseBtn.getAttribute("aria-expanded") !== "true");
  });

  function showQueryResult(): void {
    resultArea.hidden = false;
    el.classList.add("has-result");
    callbacks.onResultShown?.();
  }

  function showTableResult(): void {
    resultArea.hidden = true;
    el.classList.remove("has-result");
  }

  async function run() {
    const sql = textarea.value.trim();
    if (!sql) return;
    runBtn.disabled = true;
    statusSpan.textContent = text().editor.running;
    showTableResult();
    try {
      const result = await callbacks.executeQuery(sql);
      if (result.error) {
        statusSpan.textContent = text().editor.statusError(result.elapsedMs);
        showQueryResult();
        resultArea.innerHTML = "";
        const errEl = document.createElement("pre");
        errEl.className = "db-query-error";
        errEl.textContent = result.error;
        resultArea.appendChild(errEl);
        return;
      }
      const suffix = result.truncated ? "+" : "";
      statusSpan.textContent = text().editor.statusSuccess(
        result.rowCount,
        suffix,
        result.elapsedMs,
      );
      renderResultTable(result);
    } catch (err) {
      console.error("Failed to execute query", err);
      statusSpan.textContent = text().editor.failed;
      showQueryResult();
      resultArea.innerHTML = "";
      const errEl = document.createElement("pre");
      errEl.className = "db-query-error";
      errEl.textContent = formatErrorDetail(err);
      resultArea.appendChild(errEl);
    } finally {
      runBtn.disabled = false;
    }
  }

  function renderResultTable(result: DbQueryResponse) {
    showQueryResult();
    resultArea.innerHTML = "";
    if (result.columns.length === 0) {
      resultArea.textContent = text().editor.noColumns;
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
    for (let i = 0; i < result.columns.length; i++) {
      const th = document.createElement("th");
      const name = document.createElement("div");
      name.className = "db-query-header-name";
      name.textContent = result.columns[i];
      const type = document.createElement("div");
      type.className = "db-query-header-type";
      type.textContent = result.columnTypes[i] || "";
      th.append(name, type);
      headRow.appendChild(th);
    }
    thead.appendChild(headRow);

    const tbody = document.createElement("tbody");
    if (result.rows.length === 0) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.className = "db-query-empty";
      td.colSpan = result.columns.length + 1;
      td.textContent = text().editor.noRows;
      tr.appendChild(td);
      tbody.appendChild(tr);
    } else {
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
          td.textContent = formatQueryValue(value);
          if (value === null) td.classList.add("null");
          tr.appendChild(td);
        }
        tbody.appendChild(tr);
      }
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
    statusSpan.textContent = text().editor.explaining;
    showTableResult();
    try {
      const result = await callbacks.executeQuery(`EXPLAIN QUERY PLAN ${sql}`);
      if (result.error) {
        statusSpan.textContent = text().editor.statusError(result.elapsedMs);
        showQueryResult();
        resultArea.innerHTML = "";
        const errEl = document.createElement("pre");
        errEl.className = "db-query-error";
        errEl.textContent = result.error;
        resultArea.appendChild(errEl);
        return;
      }
      statusSpan.textContent = text().editor.statusExplain(result.elapsedMs);
      renderResultTable(result);
    } catch (err) {
      console.error("Failed to explain query", err);
      statusSpan.textContent = text().editor.failed;
      showQueryResult();
      resultArea.innerHTML = "";
      const errEl = document.createElement("pre");
      errEl.className = "db-query-error";
      errEl.textContent = formatErrorDetail(err);
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
    historyDropdown.innerHTML = "";
    const loading = document.createElement("div");
    loading.className = "db-query-history-empty";
    loading.textContent = text().editor.historyLoading;
    historyDropdown.appendChild(loading);
    historyDropdown.hidden = false;
    void Promise.resolve(callbacks.loadHistory?.() ?? [])
      .then((history) => {
        historyDropdown.innerHTML = "";
        const items = history.slice(0, MAX_HISTORY);
        if (items.length === 0) {
          const empty = document.createElement("div");
          empty.className = "db-query-history-empty";
          empty.textContent = text().editor.historyEmpty;
          historyDropdown.appendChild(empty);
          return;
        }
        for (const sql of items) {
          const item = document.createElement("div");
          item.className = "db-query-history-item";
          item.textContent = sql.length > 100 ? `${sql.slice(0, 100)}...` : sql;
          item.title = sql;
          item.addEventListener("click", () => {
            setSql(sql);
            historyDropdown.hidden = true;
          });
          historyDropdown.appendChild(item);
        }
      })
      .catch((error) => {
        console.error("Failed to load query Local History", error);
        historyDropdown.innerHTML = "";
        const empty = document.createElement("div");
        empty.className = "db-query-history-empty db-pane-error";
        empty.textContent = text().editor.historyError(
          formatErrorDetail(error),
        );
        historyDropdown.appendChild(empty);
      });
  });

  const onDocumentClick = (e: MouseEvent) => {
    if (
      !historyDropdown.hidden &&
      !historyBtn.contains(e.target as Node) &&
      !historyDropdown.contains(e.target as Node)
    ) {
      historyDropdown.hidden = true;
    }
  };
  document.addEventListener("click", onDocumentClick);

  textarea.addEventListener("keydown", (e) => {
    if (isImeComposing(e)) return;
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      run();
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      if (e.shiftKey) {
        const before = textarea.value.slice(0, start);
        const lineStart = before.lastIndexOf("\n") + 1;
        const linePrefix = textarea.value.slice(lineStart, start);
        const spaces = linePrefix.match(/^ {1,2}/);
        if (spaces) {
          textarea.setRangeText(
            "",
            lineStart,
            lineStart + spaces[0].length,
            "end",
          );
        }
      } else {
        textarea.setRangeText("  ", start, end, "end");
      }
      syncHighlight();
    }
  });

  function focus() {
    textarea.focus();
  }

  function setSql(sql: string, options: { silent?: boolean } = {}) {
    textarea.value = sql;
    syncHighlight();
    if (!options.silent) callbacks.onSqlChange?.(textarea.value);
  }

  function getSql(): string {
    return textarea.value;
  }

  function dispose(): void {
    detachResizer();
    document.removeEventListener("click", onDocumentClick);
  }

  function localize(): void {
    const t = text().editor;
    textarea.placeholder = t.sqlPlaceholder;
    runBtn.textContent = t.run;
    runBtn.title = t.runTitle;
    explainBtn.textContent = t.explain;
    explainBtn.title = t.explainTitle;
    historyBtn.textContent = t.localHistory;
    historyBtn.title = t.localHistoryTitle;
    setInputExpanded(collapseBtn.getAttribute("aria-expanded") === "true");
    resizeHandle.setAttribute("aria-label", t.resizeInput);
  }

  localize();

  return {
    el,
    focus,
    setSql,
    getSql,
    run,
    explain: runExplain,
    showTableResult,
    dispose,
    localize,
  };
}
