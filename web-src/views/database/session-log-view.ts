// セッション限定ログの UI。query-history-view と同じ列構成 (listCol +
// detailCol) を踏襲する。1 entry = 1 行、クリックで右側に詳細 (SQL 全文・
// エラー全文) を出す。subscribe で add のたびに自動再描画。
//
// query-history-view と DOM 構造を寄せているが、ストア (in-memory vs サーバ
// 永続) と用途が違うので統合はしない。両方とも query-history-panel 内に出すが
// タブで切替える。

import {
  loadShikiHighlighter,
  type ShikiHighlighter,
} from "../../core/shiki-loader";
import { type DbText, dbText } from "./i18n";
import type { SessionLogEntry, SessionLogStore } from "./session-log";
import { highlightSqlToInnerHtml } from "./shiki-sql";

export type SessionLogViewCallbacks = {
  store: SessionLogStore;
  copySqlToQuery?: (sql: string) => void;
  getText?: () => DbText;
};

export type SessionLogView = {
  el: HTMLElement;
  clear: () => void;
  localize: () => void;
};

export function createSessionLogView(
  callbacks: SessionLogViewCallbacks,
): SessionLogView {
  const text = (): DbText => callbacks.getText?.() ?? dbText("en");
  const el = document.createElement("div");
  el.className = "db-session-log";

  const toolbar = document.createElement("div");
  toolbar.className = "db-session-log-toolbar";
  // 自動追従トグル: ON 中は新しいエントリが追加されるたびに先頭 (最新位置)
  // へ強制スクロールする。ユーザーが手で下にスクロールすると自動で OFF に
  // なる (ボタンを押し直すと再 ON)。
  const followBtn = document.createElement("button");
  followBtn.className = "db-session-log-action active";
  followBtn.type = "button";
  followBtn.textContent = text().sessionLog.autoFollow;
  followBtn.title = text().sessionLog.autoFollowTitle;
  followBtn.setAttribute("aria-pressed", "true");
  const clearBtn = document.createElement("button");
  clearBtn.className = "db-session-log-action db-session-log-danger";
  clearBtn.type = "button";
  clearBtn.textContent = text().sessionLog.clear;
  clearBtn.title = text().sessionLog.clearTitle;
  toolbar.append(followBtn, clearBtn);

  const body = document.createElement("div");
  body.className = "db-session-log-body-split";

  const listCol = document.createElement("div");
  listCol.className = "db-session-log-list-col";
  const listEl = document.createElement("div");
  listEl.className = "db-session-log-list";
  listCol.appendChild(listEl);

  const detailCol = document.createElement("div");
  detailCol.className = "db-session-log-detail-col";
  const placeholder = document.createElement("div");
  placeholder.className = "db-session-log-detail-placeholder";
  placeholder.textContent = text().sessionLog.selectPlaceholder;
  detailCol.appendChild(placeholder);

  body.append(listCol, detailCol);
  el.append(toolbar, body);

  let selectedId: string | null = null;
  const rowById = new Map<string, HTMLElement>();

  // 自動追従: 新しいエントリは listEl の先頭 (scrollTop=0) に積まれるので、
  // ON のときは render 後に scrollTop=0 へ戻す。ユーザーが手で下に
  // スクロール (scrollTop > しきい値) したら自動 OFF にする (JetBrains の
  // Console / Chrome DevTools と同じ流儀)。
  let autoFollow = true;
  // 自分で scrollTop=0 をセットしたときに発火する scroll イベントを
  // ユーザー操作と区別するためのフラグ。
  let suppressScrollEvent = false;
  const AUTO_FOLLOW_THRESHOLD_PX = 4;
  function refreshFollowBtn(): void {
    followBtn.classList.toggle("active", autoFollow);
    followBtn.setAttribute("aria-pressed", String(autoFollow));
  }
  followBtn.addEventListener("click", () => {
    autoFollow = !autoFollow;
    refreshFollowBtn();
    if (autoFollow) {
      suppressScrollEvent = true;
      listEl.scrollTop = 0;
    }
  });
  listEl.addEventListener("scroll", () => {
    if (suppressScrollEvent) {
      suppressScrollEvent = false;
      return;
    }
    // 手で下にスクロールしたら追従解除。先頭付近への戻りで再 ON は
    // しない (ボタンを押すことで明示的に復帰させる)。
    if (autoFollow && listEl.scrollTop > AUTO_FOLLOW_THRESHOLD_PX) {
      autoFollow = false;
      refreshFollowBtn();
    }
  });

  // SQL syntax highlight: shiki を lazy load し、現在開いている entry が
  // あればロード完了時に再描画する。失敗時は null のまま plain text 表示。
  let shiki: ShikiHighlighter | null = null;
  loadShikiHighlighter({
    themes: ["github-light", "github-dark"],
    langs: ["sql"],
  }).then((h) => {
    shiki = h;
    if (selectedId) {
      const cur = callbacks.store.list().find((e) => e.id === selectedId);
      if (cur) renderDetail(cur);
    }
  });

  function render(): void {
    listEl.innerHTML = "";
    rowById.clear();
    const entries = callbacks.store.list();
    if (entries.length === 0) {
      const empty = document.createElement("div");
      empty.className = "db-session-log-empty";
      empty.textContent = text().sessionLog.empty;
      listEl.appendChild(empty);
      // 詳細も placeholder に戻す。
      detailCol.innerHTML = "";
      detailCol.appendChild(placeholder);
      selectedId = null;
      return;
    }
    // 新しい順で見やすい。ストアは push 順なので末尾から並べる。
    const fragment = document.createDocumentFragment();
    for (let i = entries.length - 1; i >= 0; i--) {
      fragment.appendChild(renderEntry(entries[i]));
    }
    listEl.appendChild(fragment);
    // autoFollow が ON のとき、新エントリの追加で常に最新を見せる。新しい
    // エントリは先頭にあるので scrollTop=0 へ。自分でセットして発火する
    // scroll イベントは suppressScrollEvent で無視する (ループ防止)。
    // ついでに右側 detail も最新エントリへ自動切替する (tail -f 風)。
    if (autoFollow) {
      suppressScrollEvent = true;
      listEl.scrollTop = 0;
      const latest = entries[entries.length - 1];
      selectedId = latest.id;
      renderDetail(latest);
      rowById.get(latest.id)?.classList.add("selected");
    } else if (selectedId) {
      const cur = entries.find((e) => e.id === selectedId);
      if (cur) {
        renderDetail(cur);
        rowById.get(cur.id)?.classList.add("selected");
      } else {
        detailCol.innerHTML = "";
        detailCol.appendChild(placeholder);
        selectedId = null;
      }
    }
  }

  function renderEntry(entry: SessionLogEntry): HTMLElement {
    const row = document.createElement("div");
    row.className = "db-session-log-entry";
    row.dataset.id = entry.id;
    row.dataset.status = entry.status;
    row.dataset.kind = entry.kind;
    rowById.set(entry.id, row);

    const meta = document.createElement("div");
    meta.className = "db-session-log-entry-meta";

    const badge = document.createElement("span");
    badge.className = `db-session-log-badge db-session-log-badge-${entry.status}`;
    badge.textContent =
      entry.status === "error"
        ? text().sessionLog.statusError
        : text().sessionLog.statusOk;

    const kind = document.createElement("span");
    kind.className = "db-session-log-kind";
    kind.textContent =
      entry.kind === "query"
        ? text().sessionLog.kindQuery
        : text().sessionLog.kindMutate;

    const time = document.createElement("span");
    time.className = "db-session-log-time";
    time.textContent = formatTime(entry.timestamp);

    const stats = document.createElement("span");
    stats.className = "db-session-log-stats";
    const parts: string[] = [];
    if (entry.rowCount !== undefined) parts.push(`${entry.rowCount} rows`);
    if (entry.elapsedMs !== undefined) parts.push(`${entry.elapsedMs}ms`);
    stats.textContent = parts.join(", ");

    meta.append(badge, kind, time, stats);

    const title = document.createElement("div");
    title.className = "db-session-log-entry-title";
    title.textContent =
      entry.label.length > 100
        ? `${entry.label.slice(0, 100)}...`
        : entry.label;

    row.append(meta, title);
    row.addEventListener("click", () => selectEntry(entry));
    return row;
  }

  function selectEntry(entry: SessionLogEntry): void {
    selectedId = entry.id;
    for (const r of rowById.values()) r.classList.remove("selected");
    rowById.get(entry.id)?.classList.add("selected");
    renderDetail(entry);
    // 最新以外を手動で選んだら追従を解除 (古いエントリを腰を据えて見たい
    // ケース)。最新を選んだ場合は ON のままで OK。
    const entries = callbacks.store.list();
    const isLatest = entries[entries.length - 1]?.id === entry.id;
    if (autoFollow && !isLatest) {
      autoFollow = false;
      refreshFollowBtn();
    }
  }

  function renderDetail(entry: SessionLogEntry): void {
    detailCol.innerHTML = "";

    if (callbacks.copySqlToQuery && entry.detail) {
      const actions = document.createElement("div");
      actions.className = "db-session-log-detail-actions";
      const useBtn = document.createElement("button");
      useBtn.className = "db-btn db-btn-primary";
      useBtn.type = "button";
      useBtn.textContent = text().sessionLog.useInEditor;
      useBtn.addEventListener("click", () => {
        callbacks.copySqlToQuery?.(entry.detail ?? "");
      });
      const copyBtn = document.createElement("button");
      copyBtn.className = "db-btn";
      copyBtn.type = "button";
      copyBtn.textContent = text().sessionLog.copy;
      copyBtn.addEventListener("click", () => {
        const txt =
          entry.message && entry.detail
            ? `${entry.detail}\n\n${entry.message}`
            : (entry.detail ?? entry.message ?? "");
        navigator.clipboard.writeText(txt).then(
          () => {
            copyBtn.textContent = text().sessionLog.copied;
            setTimeout(() => {
              copyBtn.textContent = text().sessionLog.copy;
            }, 1200);
          },
          () => undefined,
        );
      });
      actions.append(useBtn, copyBtn);
      detailCol.appendChild(actions);
    }

    if (entry.detail) {
      const sql = document.createElement("pre");
      sql.className = "db-session-log-sql";
      const inner = highlightSqlToInnerHtml(entry.detail, shiki);
      if (inner) {
        sql.innerHTML = inner;
      } else {
        sql.textContent = entry.detail;
      }
      detailCol.appendChild(sql);
    }

    if (entry.message) {
      const msg = document.createElement("pre");
      msg.className = `db-session-log-message db-session-log-message-${entry.status}`;
      msg.textContent = entry.message;
      detailCol.appendChild(msg);
    }
  }

  clearBtn.addEventListener("click", () => {
    callbacks.store.clear();
  });

  // subscribe: 自動再描画。listener を hold する disposer は外部で必要ない
  // (このビューが mount される間 = ストアと同寿命)。
  callbacks.store.subscribe(render);
  render();

  function clear(): void {
    callbacks.store.clear();
  }

  function localize(): void {
    clearBtn.textContent = text().sessionLog.clear;
    clearBtn.title = text().sessionLog.clearTitle;
    followBtn.textContent = text().sessionLog.autoFollow;
    followBtn.title = text().sessionLog.autoFollowTitle;
    placeholder.textContent = text().sessionLog.selectPlaceholder;
    render();
  }

  return { el, clear, localize };
}

function formatTime(timestamp: number): string {
  const d = new Date(timestamp);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
