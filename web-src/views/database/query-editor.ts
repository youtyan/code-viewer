import { createRef, type Ref, ref } from "lit/directives/ref.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { html, nothing } from "lit/html.js";
import type { DbKind, DbQueryResponse } from "../../core/database/types";
import { attachDragResizer } from "../../core/drag-resizer";
import { formatErrorDetail } from "../../core/error-detail";
import { CHEVRON_DOWN_16_PATH } from "../../core/icons";
import { isImeComposing } from "../../core/keyboard";
import {
  loadShikiHighlighter,
  type ShikiHighlighter,
} from "../../core/shiki-loader";
import { phoneMediaQuery } from "../shell/workspace";
import { iconTemplate } from "../ui/icon";
import { renderOwned, templateElement } from "../ui/renderer";
import { type DbText, dbText } from "./i18n";
import { formatQueryValue, nullOrEmptyMark } from "./query-value";
import { serverErrorSummary } from "./report-failure";
import { highlightSqlToInnerHtml } from "./shiki-sql";

const MAX_HISTORY = 50;
const MIN_INPUT_HEIGHT = 120;
const MAX_INPUT_HEIGHT = 480;

// 実行計画を問う文の頭。書き方はデータストアの種類ごとに違う (PostgreSQL と
// MySQL に EXPLAIN QUERY PLAN を送ると構文の誤りになる)。null はクエリエディタを
// 持たない種類 (ここでは送らない)。種類を足したら、ここで決めないと型で落ちる。
const EXPLAIN_PREFIX: Record<DbKind, string | null> = {
  sqlite: "EXPLAIN QUERY PLAN",
  d1: "EXPLAIN QUERY PLAN",
  postgresql: "EXPLAIN",
  mysql: "EXPLAIN",
  redis: null,
  elasticsearch: null,
  s3: null,
  dynamodb: null,
};

/** 実行計画を問う文。種類が分からない・対応しないときは null。 */
export function explainStatement(
  kind: DbKind | undefined,
  sql: string,
): string | null {
  const prefix = kind ? EXPLAIN_PREFIX[kind] : null;
  return prefix === null ? null : `${prefix} ${sql}`;
}

export type QueryEditorCallbacks = {
  executeQuery: (sql: string) => Promise<DbQueryResponse>;
  /** いま開いているデータストアの種類 (実行計画の書き方を決める)。 */
  getKind: () => DbKind | undefined;
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

/** 結果の欄: 失敗の文・失敗の要約と詳細・列の無い結果・表。 */
type QueryResult =
  | { error: string }
  | { summary: string; detail: string }
  | { noColumns: true }
  | { table: DbQueryResponse };

/** 履歴の小窓: 読み込み中・空・失敗・SQL の並び。 */
type HistoryState =
  | { loading: true }
  | { empty: true }
  | { error: string }
  | { items: string[] };

export type QueryEditorFrameProps = {
  text: DbText["editor"];
  expanded: boolean;
  /** 入力の色付け。色付けできたら html、できなければ文字。空なら null。 */
  highlight: { html: string } | { text: string } | null;
  status: string;
  running: boolean;
  explaining: boolean;
  history: HistoryState | null;
  result: HTMLElement;
  refs: {
    input: Ref<HTMLElement>;
    textarea: Ref<HTMLTextAreaElement>;
    highlight: Ref<HTMLElement>;
    history: Ref<HTMLElement>;
    historyButton: Ref<HTMLButtonElement>;
    resize: Ref<HTMLElement>;
  };
  onInput: () => void;
  onScroll: () => void;
  onKeydown: (event: KeyboardEvent) => void;
  onRun: () => void;
  onExplain: () => void;
  onHistory: () => void;
  onPickHistory: (sql: string) => void;
  onToggleInput: () => void;
};

export type QueryEditorResultProps = {
  text: DbText;
  result: QueryResult | null;
};

export type QueryEditorView = {
  frame: (props: QueryEditorFrameProps) => unknown;
  result: (props: QueryEditorResultProps) => unknown;
};

function historyTemplate(p: QueryEditorFrameProps, state: HistoryState) {
  const t = p.text;
  if ("loading" in state)
    return html`<div class="db-query-history-empty">${t.historyLoading}</div>`;
  if ("empty" in state)
    return html`<div class="db-query-history-empty">${t.historyEmpty}</div>`;
  if ("error" in state)
    return html`<div class="db-query-history-empty db-pane-error">${state.error}</div>`;
  return state.items.map(
    (sql) =>
      html`<div
        class="db-query-history-item"
        title=${sql}
        @click=${() => p.onPickHistory(sql)}
      >${sql.length > 100 ? `${sql.slice(0, 100)}...` : sql}</div>`,
  );
}

export const DEFAULT_VIEW: QueryEditorView = {
  frame: (p) => {
    const t = p.text;
    const collapseLabel = p.expanded ? t.collapseInput : t.expandInput;
    return html`<div class="db-query-input" ${ref(p.refs.input)}><div
          class="db-query-editor-wrap"
          ?hidden=${!p.expanded}
        ><pre class="db-query-highlight" aria-hidden="true" ${ref(p.refs.highlight)}>${
          p.highlight === null
            ? nothing
            : "html" in p.highlight
              ? unsafeHTML(p.highlight.html)
              : p.highlight.text
        }</pre><textarea
            class="db-query-textarea"
            placeholder=${t.sqlPlaceholder}
            spellcheck="false"
            rows="3"
            ${ref(p.refs.textarea)}
            @input=${p.onInput}
            @scroll=${p.onScroll}
            @keydown=${p.onKeydown}
          ></textarea></div
        ><div class="db-query-toolbar"><button
            class="db-btn db-btn-primary db-query-run"
            type="button"
            title=${t.runTitle}
            ?disabled=${p.running || p.explaining}
            @click=${p.onRun}
          >${t.run}</button><button
            class="db-btn db-query-explain"
            type="button"
            title=${t.explainTitle}
            ?disabled=${p.explaining}
            @click=${p.onExplain}
          >${t.explain}</button><button
            class="db-btn db-query-history-btn"
            type="button"
            title=${t.localHistoryTitle}
            ${ref(p.refs.historyButton)}
            @click=${p.onHistory}
          >${t.localHistory}</button><span class="db-query-status"
            >${p.status}</span
          ><button
            class="db-query-collapse"
            type="button"
            aria-expanded=${String(p.expanded)}
            title=${collapseLabel}
            aria-label=${collapseLabel}
            @click=${p.onToggleInput}
          >${iconTemplate(CHEVRON_DOWN_16_PATH, "octicon-chevron-down")}</button></div
        ><div
          class="db-query-history-dropdown"
          ?hidden=${p.history === null}
          ${ref(p.refs.history)}
        >${p.history === null ? nothing : historyTemplate(p, p.history)}</div></div
      ><div
        class="db-query-resize"
        tabindex="0"
        role="separator"
        aria-orientation="vertical"
        aria-label=${t.resizeInput}
        ?hidden=${!p.expanded}
        ${ref(p.refs.resize)}
      ></div>${p.result}`;
  },
  result: ({ text: t, result }) => {
    if (result === null) return nothing;
    if ("error" in result)
      return html`<pre class="db-query-error">${result.error}</pre>`;
    // 失敗の表示。サーバの JSON の error があれば先頭に出し、全文 (操作・HTTP の
    // 状態・本文・cause の連鎖) は「詳細」に畳む。
    if ("summary" in result)
      return html`<div class="db-query-error"><p class="db-query-error-summary"
          >${result.summary}</p
        ><details class="db-query-error-details"><summary
            >${t.editor.errorDetails}</summary
          ><pre>${result.detail}</pre></details
        ></div>`;
    if ("noColumns" in result) return t.editor.noColumns;
    const table = result.table;
    const emptyLabel = t.grid.emptyValue;
    return html`<div class="db-query-table-wrap"><table class="db-query-table"><thead
          ><tr><th class="db-grid-rownum">#</th>${table.columns.map(
            (column, i) =>
              html`<th><div class="db-query-header-name">${column}</div><div
                  class="db-query-header-type"
                >${table.columnTypes[i] || ""}</div></th>`,
          )}</tr></thead
        ><tbody>${
          table.rows.length === 0
            ? html`<tr><td class="db-query-empty" colspan=${table.columns.length + 1}
                  >${t.editor.noRows}</td
                ></tr>`
            : table.rows.map(
                (row, i) =>
                  html`<tr class=${i % 2 === 1 ? "alt" : nothing}><td
                      class="db-grid-rownum"
                    >${i + 1}</td>${row.map((value) => {
                      const shown = nullOrEmptyMark(value, emptyLabel);
                      return shown
                        ? html`<td class=${shown.cellClass}>${shown.mark}</td>`
                        : html`<td>${formatQueryValue(value)}</td>`;
                    })}</tr>`,
              )
        }</tbody></table></div>`;
  },
};

export function createQueryEditor(
  callbacks: QueryEditorCallbacks,
  view: QueryEditorView = DEFAULT_VIEW,
): QueryEditor {
  const text = (): DbText => callbacks.getText?.() ?? dbText("en");
  // 外枠の class (has-result・is-collapsed・引き伸ばし中の is-resizing) は、
  // 引き伸ばしの部品も書くので、描き方に入れず classList で付け外しする。
  const el = templateElement(html`<div class="db-query-editor"></div>`);
  const resultArea = templateElement(
    html`<div class="db-query-result" hidden></div>`,
  );
  const refs: QueryEditorFrameProps["refs"] = {
    input: createRef(),
    textarea: createRef(),
    highlight: createRef(),
    history: createRef(),
    historyButton: createRef(),
    resize: createRef(),
  };
  const drawn = <T extends Element>(target: Ref<T>, name: string): T => {
    const element = target.value;
    if (!element) throw new Error(`query editor: the ${name} was not drawn`);
    return element;
  };
  const textarea = () => drawn(refs.textarea, "SQL input");

  let shiki: ShikiHighlighter | null = null;
  let code = "";
  let expanded = true;
  let status = "";
  let running = false;
  let explaining = false;
  let history: HistoryState | null = null;
  let result: QueryResult | null = null;
  let resizedInputHeight: number | null = null;

  function draw(): void {
    const t = text();
    renderOwned(
      el,
      view.frame({
        text: t.editor,
        expanded,
        highlight: highlightFor(code),
        status,
        running,
        explaining,
        history,
        result: resultArea,
        refs,
        onInput: () => {
          code = textarea().value;
          draw();
          callbacks.onSqlChange?.(code);
        },
        onScroll: () => {
          const highlight = drawn(refs.highlight, "highlight");
          highlight.scrollTop = textarea().scrollTop;
          highlight.scrollLeft = textarea().scrollLeft;
        },
        onKeydown,
        onRun: () => void run(),
        onExplain: () => void runExplain(),
        onHistory: toggleHistory,
        onPickHistory: (sql) => {
          setSql(sql);
          history = null;
          draw();
        },
        onToggleInput: () => setInputExpanded(!expanded),
      }),
    );
    renderOwned(resultArea, view.result({ text: t, result }));
  }

  function highlightFor(value: string): QueryEditorFrameProps["highlight"] {
    if (!value) return null;
    const inner = highlightSqlToInnerHtml(value, shiki);
    return inner ? { html: inner } : { text: value };
  }

  loadShikiHighlighter({
    langs: ["sql"],
  }).then((h) => {
    shiki = h;
    draw();
  });

  function applyInputHeight(height: number): void {
    const availableHeight = el.parentElement?.getBoundingClientRect().height;
    const availableMax = availableHeight
      ? Math.max(MIN_INPUT_HEIGHT, availableHeight - MIN_INPUT_HEIGHT)
      : MAX_INPUT_HEIGHT;
    const maxHeight = Math.min(MAX_INPUT_HEIGHT, availableMax);
    resizedInputHeight = Math.round(
      Math.max(MIN_INPUT_HEIGHT, Math.min(maxHeight, height)),
    );
    drawn(refs.input, "input area").style.height = `${resizedInputHeight}px`;
  }

  draw();

  const detachResizer = attachDragResizer({
    handle: drawn(refs.resize, "resize handle"),
    getSize: () =>
      drawn(refs.input, "input area").getBoundingClientRect().height,
    applySize: applyInputHeight,
    axis: "y",
    direction: 1,
    activeClassTarget: el,
    activeClassName: "is-resizing",
  });

  function setInputExpanded(next: boolean): void {
    expanded = next;
    el.classList.toggle("is-collapsed", !next);
    drawn(refs.input, "input area").style.height =
      next && resizedInputHeight ? `${resizedInputHeight}px` : "";
    draw();
  }

  // 電話の段では畳んで始める (開いたままでは表の行に高さが残らなかった)。
  if (phoneMediaQuery().matches) setInputExpanded(false);

  function showQueryResult(next: QueryResult): void {
    result = next;
    resultArea.hidden = false;
    el.classList.add("has-result");
    draw();
    callbacks.onResultShown?.();
  }

  function showTableResult(): void {
    resultArea.hidden = true;
    el.classList.remove("has-result");
  }

  function failureResult(err: unknown): QueryResult {
    const detail = formatErrorDetail(err);
    const summary = serverErrorSummary(err);
    return summary === null ? { error: detail } : { summary, detail };
  }

  function setStatus(next: string): void {
    status = next;
    draw();
  }

  async function run() {
    const sql = textarea().value.trim();
    if (!sql) return;
    running = true;
    status = text().editor.running;
    draw();
    showTableResult();
    try {
      const response = await callbacks.executeQuery(sql);
      if (response.error) {
        status = text().editor.statusError(response.elapsedMs);
        showQueryResult({ error: response.error });
        return;
      }
      const suffix = response.truncated ? "+" : "";
      status = text().editor.statusSuccess(
        response.rowCount,
        suffix,
        response.elapsedMs,
      );
      showResultTable(response);
    } catch (err) {
      console.error("Failed to execute query", err);
      status = text().editor.failed;
      showQueryResult(failureResult(err));
    } finally {
      running = false;
      draw();
    }
  }

  function showResultTable(response: DbQueryResponse) {
    showQueryResult(
      response.columns.length === 0 ? { noColumns: true } : { table: response },
    );
  }

  async function runExplain() {
    const sql = textarea().value.trim();
    if (!sql) return;
    const statement = explainStatement(callbacks.getKind(), sql);
    if (statement === null) {
      setStatus(text().editor.explainUnsupported);
      return;
    }
    explaining = true;
    status = text().editor.explaining;
    draw();
    showTableResult();
    try {
      const response = await callbacks.executeQuery(statement);
      if (response.error) {
        status = text().editor.statusError(response.elapsedMs);
        showQueryResult({ error: response.error });
        return;
      }
      status = text().editor.statusExplain(response.elapsedMs);
      showResultTable(response);
    } catch (err) {
      console.error("Failed to explain query", err);
      status = text().editor.failed;
      showQueryResult(failureResult(err));
    } finally {
      explaining = false;
      draw();
    }
  }

  function toggleHistory(): void {
    if (history !== null) {
      history = null;
      draw();
      return;
    }
    history = { loading: true };
    draw();
    void Promise.resolve(callbacks.loadHistory?.() ?? [])
      .then((loaded) => {
        const items = loaded.slice(0, MAX_HISTORY);
        history = items.length === 0 ? { empty: true } : { items };
        draw();
      })
      .catch((error) => {
        console.error("Failed to load query Local History", error);
        history = {
          error: text().editor.historyError(formatErrorDetail(error)),
        };
        draw();
      });
  }

  const onDocumentClick = (e: MouseEvent) => {
    if (
      history !== null &&
      !refs.historyButton.value?.contains(e.target as Node) &&
      !refs.history.value?.contains(e.target as Node)
    ) {
      history = null;
      draw();
    }
  };
  document.addEventListener("click", onDocumentClick);

  function onKeydown(e: KeyboardEvent): void {
    if (isImeComposing(e)) return;
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      void run();
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      const input = textarea();
      const start = input.selectionStart;
      const end = input.selectionEnd;
      if (e.shiftKey) {
        const before = input.value.slice(0, start);
        const lineStart = before.lastIndexOf("\n") + 1;
        const linePrefix = input.value.slice(lineStart, start);
        const spaces = linePrefix.match(/^ {1,2}/);
        if (spaces) {
          input.setRangeText(
            "",
            lineStart,
            lineStart + spaces[0].length,
            "end",
          );
        }
      } else {
        input.setRangeText("  ", start, end, "end");
      }
      code = input.value;
      draw();
    }
  }

  function focus() {
    textarea().focus();
  }

  function setSql(sql: string, options: { silent?: boolean } = {}) {
    textarea().value = sql;
    code = sql;
    draw();
    if (!options.silent) callbacks.onSqlChange?.(sql);
  }

  function getSql(): string {
    return textarea().value;
  }

  function dispose(): void {
    detachResizer();
    document.removeEventListener("click", onDocumentClick);
  }

  return {
    el,
    focus,
    setSql,
    getSql,
    run,
    explain: runExplain,
    showTableResult,
    dispose,
    localize: draw,
  };
}
