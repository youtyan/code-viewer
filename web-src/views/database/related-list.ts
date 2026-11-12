// Data の表の下の「関連」パネルの左の一覧と、右の上の見出しを描く。
// - 一覧は「この行が参照している」(外部キーの先) と「この行を参照している」
//   (この行を指す行のある表) の 2 つに分け、表ごとに件数を出す。件数は
//   table-grid.ts があとから読み、0 件の関係はまとめて隠せる
// - 見出しは右の表が何の行かを 1 文で言う (「tenant_id でこの行を指している
//   orders の行・3 件」)
// 開閉・ドリル・取得は table-grid.ts。ここは渡された状態から DOM を作るだけ。

import { html, nothing } from "lit/html.js";
import { LINK_16_PATH } from "../../core/icons";
import { iconTemplate } from "../ui/icon";
import { templateFragment } from "../ui/renderer";
import type { DbText } from "./i18n";

export type RelatedCount =
  | { state: "loading" }
  | { state: "done"; rows: number }
  | { state: "failed"; detail: string };

export type RelatedEntry = {
  direction: "outgoing" | "incoming";
  /** 開く表 (outgoing は参照先、incoming は参照元)。 */
  table: string;
  /** その表で値と比べる列。 */
  column: string;
  /** この行の側の列 (outgoing は外部キーの列、incoming は指される列)。 */
  ownColumn: string;
  value: string;
  inferred: boolean;
  count: RelatedCount;
};

/** 件数が分かっていて 0 件か。 */
export function isEmptyRelation(entry: RelatedEntry): boolean {
  return entry.count.state === "done" && entry.count.rows === 0;
}

function countBadge(entry: RelatedEntry, t: DbText["grid"]): unknown {
  const count = entry.count;
  if (count.state === "loading")
    return html`<span
      class="db-related-item-count is-loading"
      title=${t.relatedCountLoading}
      >…</span
    >`;
  if (count.state === "failed")
    return html`<span
      class="db-related-item-count is-failed"
      title=${t.relatedCountFailed(count.detail)}
      >!</span
    >`;
  return html`<span
    class=${count.rows === 0 ? "db-related-item-count is-zero" : "db-related-item-count"}
    title=${t.relatedRows(count.rows)}
    >${count.rows.toLocaleString()}</span
  >`;
}

function inferredBadge(text: DbText, title = text.nav.inferredBadgeTitle) {
  return html`<span class="db-related-inferred" title=${title}
    >${text.nav.inferredBadge}</span
  >`;
}

/** 比べる条件の全文 (title と見出しに出す)。 */
export function relatedCondition(entry: RelatedEntry): string {
  return `${entry.table}.${entry.column} = ${entry.value}`;
}

export function renderRelatedList(
  host: HTMLElement,
  opts: {
    entries: RelatedEntry[];
    selected: number;
    hideEmpty: boolean;
    text: DbText;
    onSelect: (index: number) => void;
    onToggleHideEmpty: () => void;
  },
): void {
  const t = opts.text.grid;
  let hiddenCount = 0;
  let emptyCount = 0;
  const parts: unknown[] = [];
  for (const direction of ["outgoing", "incoming"] as const) {
    const indexes = opts.entries
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => entry.direction === direction);
    if (indexes.length === 0) continue;
    parts.push(
      html`<div class="db-related-group">${
        direction === "outgoing"
          ? t.relatedOutgoingGroup
          : t.relatedIncomingGroup
      }<span class="db-related-group-count">${indexes.length}</span></div>`,
    );
    for (const { entry, index } of indexes) {
      const empty = isEmptyRelation(entry);
      if (empty) emptyCount++;
      // 選んでいる関係は 0 件でも隠さない (右に出ているものが一覧から消えない)。
      if (empty && opts.hideEmpty && index !== opts.selected) {
        hiddenCount++;
        continue;
      }
      const cls = [
        "db-related-item",
        index === opts.selected ? "is-active" : "",
        empty ? "is-empty" : "",
      ]
        .filter(Boolean)
        .join(" ");
      parts.push(
        html`<button
          type="button"
          class=${cls}
          title=${relatedCondition(entry)}
          @click=${() => opts.onSelect(index)}
        ><span class="db-related-item-top"><span class="db-related-item-table"
              >${entry.table}</span
            >${countBadge(entry, t)}</span
          ><span class="db-related-item-via"><span class="db-related-item-column"
              >${direction === "outgoing" ? entry.ownColumn : entry.column}</span
            >${entry.inferred ? inferredBadge(opts.text) : nothing}</span
          ></button>`,
      );
    }
  }
  // 0 件の関係を隠す・出す切り替え。隠している数を書いておく。
  if (emptyCount > 0)
    parts.push(
      html`<button
        type="button"
        class="db-related-empty-toggle"
        @click=${opts.onToggleHideEmpty}
      >${
        opts.hideEmpty
          ? t.relatedShowEmpty(hiddenCount)
          : t.relatedHideEmpty(emptyCount)
      }</button>`,
    );
  host.replaceChildren(templateFragment(parts));
}

/** 右の表の上の見出し。何の行か・条件・件数・推測かを出す。 */
export function renderRelatedHead(
  host: HTMLElement,
  entry: RelatedEntry,
  text: DbText,
): void {
  const t = text.grid;
  host.replaceChildren(
    templateFragment(
      html`<span class="db-related-head-icon" aria-hidden="true">${iconTemplate(
        LINK_16_PATH,
        "octicon-link",
      )}</span><span class="db-related-head-sentence">${
        entry.direction === "outgoing"
          ? t.relatedOutgoingHead(entry.ownColumn, entry.table)
          : t.relatedIncomingHead(entry.table, entry.column)
      }</span><code class="db-related-head-condition" title=${relatedCondition(
        entry,
      )}>${entry.column} = ${entry.value}</code>${
        entry.count.state === "done"
          ? html`<span class="db-related-head-rows"
              >${t.relatedRows(entry.count.rows)}</span
            >`
          : nothing
      }${entry.inferred ? inferredBadge(text, t.relatedInferredNote) : nothing}`,
    ),
  );
}
