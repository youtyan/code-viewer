// セッション限定ログの UI。query-history-view と同じ列構成 (listCol +
// detailCol) を踏襲する。1 entry = 1 行、クリックで右側に詳細 (SQL 全文・
// エラー全文) を出す。subscribe で add のたびに自動再描画。
//
// query-history-view と DOM 構造を寄せているが、ストア (in-memory vs サーバ
// 永続) と用途が違うので統合はしない。両方とも query-history-panel 内に出すが
// タブで切替える。

import { createRef, type Ref, ref } from "lit/directives/ref.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { html, nothing } from "lit/html.js";
import { showCopyFailure } from "../../core/copy-failure";
import {
  loadShikiHighlighter,
  type ShikiHighlighter,
} from "../../core/shiki-loader";
import { detachedElement } from "../ui/renderer";
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

export type SessionLogEntryProps = {
  id: string;
  status: SessionLogEntry["status"];
  kind: SessionLogEntry["kind"];
  badge: string;
  kindLabel: string;
  time: string;
  stats: string;
  title: string;
  selected: boolean;
  onSelect: () => void;
};

export type SessionLogDetailProps = {
  /** 「エディタで使う」と「コピー」。SQL が無い・使い先が無いときは null。 */
  actions: {
    useLabel: string;
    copyLabel: string;
    onUse: () => void;
    /** 押したボタン (失敗の印と理由をそこに出す)。 */
    onCopy: (button: HTMLElement) => void;
  } | null;
  /** SQL の全文。色付けできたら html、できなければ text。 */
  sql: { html: string } | { text: string } | null;
  message: { text: string; status: SessionLogEntry["status"] } | null;
};

export type SessionLogProps = {
  labels: {
    autoFollow: string;
    autoFollowTitle: string;
    clear: string;
    clearTitle: string;
    placeholder: string;
  };
  autoFollow: boolean;
  /** 新しい順。 */
  entries: SessionLogEntryProps[];
  /** 1 件も無いときの文。 */
  empty: string | null;
  /** 選んだ記録の詳細。選んでいなければ null (案内を出す)。 */
  detail: SessionLogDetailProps | null;
  listRef: Ref<HTMLElement>;
  onToggleFollow: () => void;
  onClear: () => void;
  onListScroll: () => void;
};

export type SessionLogViewView = (props: SessionLogProps) => unknown;

function detailTemplate(d: SessionLogDetailProps): unknown {
  return html`${
    d.actions
      ? html`<div class="db-session-log-detail-actions"><button
            class="db-btn db-btn-primary"
            type="button"
            @click=${d.actions.onUse}
          >${d.actions.useLabel}</button><button
            class="db-btn"
            type="button"
            @click=${(event: Event) => d.actions?.onCopy(event.currentTarget as HTMLElement)}
          >${d.actions.copyLabel}</button></div>`
      : nothing
  }${
    d.sql
      ? html`<pre class="db-session-log-sql">${
          "html" in d.sql ? unsafeHTML(d.sql.html) : d.sql.text
        }</pre>`
      : nothing
  }${
    d.message
      ? html`<pre
          class=${`db-session-log-message db-session-log-message-${d.message.status}`}
        >${d.message.text}</pre>`
      : nothing
  }`;
}

export const DEFAULT_VIEW: SessionLogViewView = (p) =>
  html`<div class="db-session-log"><div class="db-session-log-toolbar"><button
        class=${p.autoFollow ? "db-session-log-action active" : "db-session-log-action"}
        type="button"
        title=${p.labels.autoFollowTitle}
        aria-pressed=${String(p.autoFollow)}
        @click=${p.onToggleFollow}
      >${p.labels.autoFollow}</button><button
        class="db-session-log-action db-session-log-danger"
        type="button"
        title=${p.labels.clearTitle}
        @click=${p.onClear}
      >${p.labels.clear}</button></div
    ><div class="db-session-log-body-split"><div class="db-session-log-list-col"
        ><div
          class="db-session-log-list"
          ${ref(p.listRef)}
          @scroll=${p.onListScroll}
        >${
          p.empty !== null
            ? html`<div class="db-session-log-empty">${p.empty}</div>`
            : p.entries.map(
                (e) =>
                  html`<div
                    class=${e.selected ? "db-session-log-entry selected" : "db-session-log-entry"}
                    data-id=${e.id}
                    data-status=${e.status}
                    data-kind=${e.kind}
                    @click=${e.onSelect}
                  ><div class="db-session-log-entry-meta"><span
                        class=${`db-session-log-badge db-session-log-badge-${e.status}`}
                        >${e.badge}</span
                      ><span class="db-session-log-kind">${e.kindLabel}</span
                      ><span class="db-session-log-time">${e.time}</span
                      ><span class="db-session-log-stats">${e.stats}</span></div
                    ><div class="db-session-log-entry-title">${e.title}</div></div>`,
              )
        }</div></div
      ><div class="db-session-log-detail-col">${
        p.detail
          ? detailTemplate(p.detail)
          : html`<div class="db-session-log-detail-placeholder"
              >${p.labels.placeholder}</div
            >`
      }</div></div
    ></div
  >`;

/** 「コピーしました」を出しておく時間。 */
const COPIED_MS = 1200;
const AUTO_FOLLOW_THRESHOLD_PX = 4;

export function createSessionLogView(
  callbacks: SessionLogViewCallbacks,
  view: SessionLogViewView = DEFAULT_VIEW,
): SessionLogView {
  const text = (): DbText => callbacks.getText?.() ?? dbText("en");
  const listRef = createRef<HTMLElement>();

  let selectedId: string | null = null;
  // 「コピーしました」を出している記録。
  let copiedId: string | null = null;
  // 自動追従: ON 中は新しいエントリが追加されるたびに先頭 (最新位置) へ
  // 強制スクロールし、右の詳細も最新へ切り替える (tail -f 風)。ユーザーが
  // 手で下にスクロールすると自動で OFF になる (ボタンを押し直すと再 ON)。
  // IDE のコンソールやブラウザの開発者ツールと同じ流儀。
  let autoFollow = true;
  // 自分で scrollTop=0 をセットしたときに発火する scroll イベントを
  // ユーザー操作と区別するためのフラグ。
  let suppressScrollEvent = false;

  // SQL syntax highlight: shiki を lazy load し、現在開いている entry が
  // あればロード完了時に描き直す。失敗時は null のまま plain text 表示。
  let shiki: ShikiHighlighter | null = null;
  loadShikiHighlighter({
    langs: ["sql"],
  }).then((h) => {
    shiki = h;
    if (selectedId) draw();
  });

  function entryProps(
    entry: SessionLogEntry,
    entries: readonly SessionLogEntry[],
  ): SessionLogEntryProps {
    const t = text().sessionLog;
    const parts: string[] = [];
    if (entry.rowCount !== undefined) parts.push(`${entry.rowCount} rows`);
    if (entry.elapsedMs !== undefined) parts.push(`${entry.elapsedMs}ms`);
    return {
      id: entry.id,
      status: entry.status,
      kind: entry.kind,
      badge: entry.status === "error" ? t.statusError : t.statusOk,
      kindLabel: entry.kind === "query" ? t.kindQuery : t.kindMutate,
      time: formatTime(entry.timestamp),
      stats: parts.join(", "),
      title:
        entry.label.length > 100
          ? `${entry.label.slice(0, 100)}...`
          : entry.label,
      selected: entry.id === selectedId,
      onSelect: () => selectEntry(entry, entries),
    };
  }

  function detailProps(entry: SessionLogEntry): SessionLogDetailProps {
    const t = text().sessionLog;
    const inner = entry.detail
      ? highlightSqlToInnerHtml(entry.detail, shiki)
      : null;
    return {
      actions:
        callbacks.copySqlToQuery && entry.detail
          ? {
              useLabel: t.useInEditor,
              copyLabel: copiedId === entry.id ? t.copied : t.copy,
              onUse: () => callbacks.copySqlToQuery?.(entry.detail ?? ""),
              onCopy: (button) => copyEntry(entry, button),
            }
          : null,
      sql: entry.detail
        ? inner
          ? { html: inner }
          : { text: entry.detail }
        : null,
      message: entry.message
        ? { text: entry.message, status: entry.status }
        : null,
    };
  }

  function props(): SessionLogProps {
    const t = text().sessionLog;
    const entries = callbacks.store.list();
    const selected = entries.find((e) => e.id === selectedId);
    return {
      labels: {
        autoFollow: t.autoFollow,
        autoFollowTitle: t.autoFollowTitle,
        clear: t.clear,
        clearTitle: t.clearTitle,
        placeholder: t.selectPlaceholder,
      },
      autoFollow,
      // 新しい順で見やすい。ストアは push 順なので末尾から並べる。
      entries: [...entries].reverse().map((e) => entryProps(e, entries)),
      empty: entries.length === 0 ? t.empty : null,
      detail: selected ? detailProps(selected) : null,
      listRef,
      onToggleFollow: () => {
        autoFollow = !autoFollow;
        draw();
        if (autoFollow) scrollToLatest();
      },
      onClear: () => callbacks.store.clear(),
      onListScroll: () => {
        if (suppressScrollEvent) {
          suppressScrollEvent = false;
          return;
        }
        // 手で下にスクロールしたら追従解除。先頭付近への戻りで再 ON は
        // しない (ボタンを押すことで明示的に復帰させる)。
        const list = listRef.value;
        if (autoFollow && list && list.scrollTop > AUTO_FOLLOW_THRESHOLD_PX) {
          autoFollow = false;
          draw();
        }
      },
    };
  }

  const box = detachedElement(() => view(props()));
  const draw = () => box.draw();

  // 新しいエントリは先頭にあるので scrollTop=0 へ。自分でセットして発火する
  // scroll イベントは suppressScrollEvent で無視する (ループ防止)。
  function scrollToLatest(): void {
    const list = listRef.value;
    if (!list) return;
    suppressScrollEvent = true;
    list.scrollTop = 0;
  }

  function copyEntry(entry: SessionLogEntry, button: HTMLElement): void {
    const txt =
      entry.message && entry.detail
        ? `${entry.detail}\n\n${entry.message}`
        : (entry.detail ?? entry.message ?? "");
    navigator.clipboard.writeText(txt).then(
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
          "copy a session log entry",
          error,
          button.title,
          4000,
        ),
    );
  }

  function selectEntry(
    entry: SessionLogEntry,
    entries: readonly SessionLogEntry[],
  ): void {
    selectedId = entry.id;
    // 最新以外を手動で選んだら追従を解除 (古いエントリを腰を据えて見たい
    // ケース)。最新を選んだ場合は ON のままで OK。
    const isLatest = entries[entries.length - 1]?.id === entry.id;
    if (autoFollow && !isLatest) autoFollow = false;
    draw();
  }

  // ストアが変わったら描き直す。追従中は最新を選び、先頭へ戻す。
  function onStoreChange(): void {
    const entries = callbacks.store.list();
    if (entries.length === 0) selectedId = null;
    else if (autoFollow) selectedId = entries[entries.length - 1].id;
    else if (!entries.some((e) => e.id === selectedId)) selectedId = null;
    draw();
    if (entries.length > 0 && autoFollow) scrollToLatest();
  }

  // subscribe: 自動再描画。listener を hold する disposer は外部で必要ない
  // (このビューが mount される間 = ストアと同寿命)。
  callbacks.store.subscribe(onStoreChange);
  onStoreChange();

  return {
    el: box.element,
    clear: () => callbacks.store.clear(),
    localize: onStoreChange,
  };
}

function formatTime(timestamp: number): string {
  const d = new Date(timestamp);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
