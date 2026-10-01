// Data の表の下の「関連」パネルの左の一覧と、右の上の見出しを描く。
// - 一覧は「この行が参照している」(外部キーの先) と「この行を参照している」
//   (この行を指す行のある表) の 2 つに分け、表ごとに件数を出す。件数は
//   table-grid.ts があとから読み、0 件の関係はまとめて隠せる
// - 見出しは右の表が何の行かを 1 文で言う (「tenant_id でこの行を指している
//   orders の行・3 件」)
// 開閉・ドリル・取得は table-grid.ts。ここは渡された状態から DOM を作るだけ。

import { iconSvg, LINK_16_PATH } from "../../core/icons";
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

function countBadge(entry: RelatedEntry, t: DbText["grid"]): HTMLElement {
  const badge = document.createElement("span");
  badge.className = "db-related-item-count";
  const count = entry.count;
  if (count.state === "loading") {
    badge.textContent = "…";
    badge.title = t.relatedCountLoading;
    badge.classList.add("is-loading");
  } else if (count.state === "failed") {
    badge.textContent = "!";
    badge.title = t.relatedCountFailed(count.detail);
    badge.classList.add("is-failed");
  } else {
    badge.textContent = count.rows.toLocaleString();
    badge.title = t.relatedRows(count.rows);
    badge.classList.toggle("is-zero", count.rows === 0);
  }
  return badge;
}

function inferredBadge(text: DbText): HTMLElement {
  const badge = document.createElement("span");
  badge.className = "db-related-inferred";
  badge.textContent = text.nav.inferredBadge;
  badge.title = text.nav.inferredBadgeTitle;
  return badge;
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
  host.textContent = "";
  let hiddenCount = 0;
  let emptyCount = 0;
  for (const direction of ["outgoing", "incoming"] as const) {
    const indexes = opts.entries
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => entry.direction === direction);
    if (indexes.length === 0) continue;
    const group = document.createElement("div");
    group.className = "db-related-group";
    group.textContent =
      direction === "outgoing"
        ? t.relatedOutgoingGroup
        : t.relatedIncomingGroup;
    const groupCount = document.createElement("span");
    groupCount.className = "db-related-group-count";
    groupCount.textContent = String(indexes.length);
    group.appendChild(groupCount);
    host.appendChild(group);
    for (const { entry, index } of indexes) {
      const empty = isEmptyRelation(entry);
      if (empty) emptyCount++;
      // 選んでいる関係は 0 件でも隠さない (右に出ているものが一覧から消えない)。
      if (empty && opts.hideEmpty && index !== opts.selected) {
        hiddenCount++;
        continue;
      }
      const item = document.createElement("button");
      item.type = "button";
      item.className = "db-related-item";
      item.classList.toggle("is-active", index === opts.selected);
      item.classList.toggle("is-empty", empty);
      item.title = relatedCondition(entry);
      const top = document.createElement("span");
      top.className = "db-related-item-top";
      const table = document.createElement("span");
      table.className = "db-related-item-table";
      table.textContent = entry.table;
      top.append(table, countBadge(entry, t));
      const via = document.createElement("span");
      via.className = "db-related-item-via";
      const column = document.createElement("span");
      column.className = "db-related-item-column";
      column.textContent =
        direction === "outgoing" ? entry.ownColumn : entry.column;
      via.appendChild(column);
      if (entry.inferred) via.appendChild(inferredBadge(opts.text));
      item.append(top, via);
      item.addEventListener("click", () => opts.onSelect(index));
      host.appendChild(item);
    }
  }
  if (emptyCount === 0) return;
  // 0 件の関係を隠す・出す切り替え。隠している数を書いておく。
  const footer = document.createElement("button");
  footer.type = "button";
  footer.className = "db-related-empty-toggle";
  footer.textContent = opts.hideEmpty
    ? t.relatedShowEmpty(hiddenCount)
    : t.relatedHideEmpty(emptyCount);
  footer.addEventListener("click", opts.onToggleHideEmpty);
  host.appendChild(footer);
}

/** 右の表の上の見出し。何の行か・条件・件数・推測かを出す。 */
export function renderRelatedHead(
  host: HTMLElement,
  entry: RelatedEntry,
  text: DbText,
): void {
  const t = text.grid;
  host.textContent = "";
  const icon = document.createElement("span");
  icon.className = "db-related-head-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.innerHTML = iconSvg("octicon-link", LINK_16_PATH);
  const sentence = document.createElement("span");
  sentence.className = "db-related-head-sentence";
  sentence.textContent =
    entry.direction === "outgoing"
      ? t.relatedOutgoingHead(entry.ownColumn, entry.table)
      : t.relatedIncomingHead(entry.table, entry.column);
  const condition = document.createElement("code");
  condition.className = "db-related-head-condition";
  condition.textContent = `${entry.column} = ${entry.value}`;
  condition.title = relatedCondition(entry);
  host.append(icon, sentence, condition);
  if (entry.count.state === "done") {
    const rows = document.createElement("span");
    rows.className = "db-related-head-rows";
    rows.textContent = t.relatedRows(entry.count.rows);
    host.appendChild(rows);
  }
  if (entry.inferred) {
    const note = inferredBadge(text);
    note.title = t.relatedInferredNote;
    host.appendChild(note);
  }
}
