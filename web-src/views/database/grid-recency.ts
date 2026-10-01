// Data の表の時刻まわりの見せ方。3 つある:
// - 「変更」の列: 時刻の列 (created_at / updated_at など) から、行が足された・
//   変わったのが何分前かを行番号の右に出す (判定は core/database/recency.ts)
// - 日時の列を、選んだタイムゾーンの "YYYY-MM-DD HH:MM:SS" で出し直す
//   (表示だけ。コピー・書き出し・セルの詳細は元の値)
// - 再読み込みの印: 再読み込みの前に持っていた行と比べ、新しく出た行・中身が
//   変わった行に印を付ける (時刻の列が無い表でも効く)

import { relativeTimeText } from "../../core/blame";
import {
  changeAge,
  isFutureTime,
  parseTimestamp,
  type RecencyColumns,
  recencyColumns,
  recencySort,
  rowChange,
  timeColumnIndexes,
  type ZoneMode,
  zoneModeFor,
} from "../../core/database/recency";
import { formatInZone } from "../../core/database/time-zone";
import type {
  DbColumn,
  DbOrderDirection,
  DbValue,
} from "../../core/database/types";
import { iconSvg, PENCIL_16_PATH, PLUS_16_PATH } from "../../core/icons";
import { pageLanguage } from "../page-language";
import type { DbText } from "./i18n";

/** 「変更」の列の幅。列幅は表 (table-grid.ts) と同じく TS が持つ。 */
export const RECENCY_COLUMN_WIDTH = 96;

const AGES = ["fresh", "recent", "old"] as const;

export type GridRecency = {
  /** 表が変わったとき。時刻の列を選び直し、時差の読み方を戻す。 */
  reset: (columns: DbColumn[]) => void;
  /** 「変更」の列を出すか (足された・変わった時刻の列があるか)。 */
  shown: () => boolean;
  /** 「新しい順」の並べ方。並べられる列が無ければ null。 */
  newestSort: () => { column: string; direction: DbOrderDirection } | null;
  /** ページが届いたら、時差の無い値の読み方を決め直す。 */
  notePage: (rows: DbValue[][]) => void;
  /** 日時の列の値を timeZone で出し直した文字。日時と読めなければ null。 */
  displayTime: (
    row: DbValue[],
    index: number,
    timeZone: string,
  ) => string | null;
  /** 表示し直す列か (見出しにタイムゾーンの札を付けるか)。 */
  isTimeColumn: (index: number) => boolean;
  /** 日時の列の値の時刻 (UNIX ミリ秒)。日時の列でない・読めないなら null。 */
  timeOf: (row: DbValue[], index: number) => number | null;
  headerCell: (left: number) => HTMLElement;
  spacerCell: (left: number, className: string) => HTMLElement;
  cell: (row: DbValue[], left: number) => HTMLElement;
  /** 描いてある「〜分前」と濃さを今の時刻に合わせる (1 分ごとに呼ぶ)。 */
  refreshLabels: (root: ParentNode) => void;
};

export function createGridRecency(opts: {
  text: () => DbText;
  now?: () => number;
}): GridRecency {
  const now = opts.now ?? Date.now;
  let picked: RecencyColumns = { created: null, updated: null, serial: null };
  let createdIndex = -1;
  let updatedIndex = -1;
  // 時刻を読む列ごとの、時差の無い値の読み方。一度でも「ローカルで書かれて
  // いる」と分かった列は、その表の間はそのまま。
  let zones = new Map<number, ZoneMode>();
  const zoneOf = (index: number): ZoneMode => zones.get(index) ?? "utc";
  const readTime = (row: DbValue[], index: number): number | null =>
    index >= 0 ? parseTimestamp(row[index], zoneOf(index)) : null;

  function sized(el: HTMLElement, left: number): HTMLElement {
    el.style.width = `${RECENCY_COLUMN_WIDTH}px`;
    el.style.left = `${left}px`;
    return el;
  }

  function paint(el: HTMLElement): void {
    const at = Number(el.dataset.at);
    const kind = el.dataset.kind === "updated" ? "updated" : "added";
    const t = opts.text().grid;
    const current = now();
    const when = isFutureTime(at, current)
      ? (el.dataset.raw ?? "")
      : relativeTimeText(at / 1000, pageLanguage(), current);
    const age = changeAge(at, current);
    for (const name of AGES) el.classList.toggle(`is-${name}`, name === age);
    el.classList.toggle("is-added", kind === "added");
    el.classList.toggle("is-updated", kind === "updated");
    el.innerHTML = iconSvg(
      "db-grid-recency-icon",
      kind === "added" ? PLUS_16_PATH : PENCIL_16_PATH,
    );
    const label = document.createElement("span");
    label.className = "db-grid-recency-text";
    label.textContent = when;
    el.appendChild(label);
    const describe = kind === "added" ? t.recencyAdded : t.recencyUpdated;
    el.title = describe(when, el.dataset.column ?? "", el.dataset.raw ?? "");
  }

  return {
    reset(columns) {
      picked = recencyColumns(columns);
      createdIndex = columns.findIndex((c) => c.name === picked.created);
      updatedIndex = columns.findIndex((c) => c.name === picked.updated);
      zones = new Map();
      for (const index of timeColumnIndexes(columns)) zones.set(index, "utc");
      if (createdIndex >= 0) zones.set(createdIndex, "utc");
      if (updatedIndex >= 0) zones.set(updatedIndex, "utc");
    },
    shown: () => createdIndex >= 0 || updatedIndex >= 0,
    newestSort: () => recencySort(picked),
    notePage(rows) {
      const current = now();
      for (const [index, zone] of zones) {
        if (zone === "local") continue;
        zones.set(
          index,
          zoneModeFor(
            rows.map((row) => row[index]),
            current,
          ),
        );
      }
    },
    displayTime(row, index, timeZone) {
      if (!zones.has(index)) return null;
      const at = readTime(row, index);
      return at === null ? null : formatInZone(at, timeZone);
    },
    isTimeColumn: (index) => zones.has(index),
    timeOf: (row, index) => (zones.has(index) ? readTime(row, index) : null),
    headerCell(left) {
      const t = opts.text().grid;
      const cell = document.createElement("div");
      cell.className = "db-grid-cell db-grid-recency-header";
      cell.textContent = t.recencyHeader;
      cell.title = t.recencyHeaderHint(
        [picked.created, picked.updated].filter(Boolean).join(" / "),
      );
      return sized(cell, left);
    },
    spacerCell(left, className) {
      const cell = document.createElement("div");
      cell.className = `db-grid-cell db-grid-recency ${className}`;
      return sized(cell, left);
    },
    cell(row, left) {
      const cell = document.createElement("div");
      cell.className = "db-grid-cell db-grid-recency";
      sized(cell, left);
      const change = rowChange(
        readTime(row, createdIndex),
        readTime(row, updatedIndex),
      );
      if (!change) return cell;
      const index = change.kind === "added" ? createdIndex : updatedIndex;
      cell.dataset.kind = change.kind;
      cell.dataset.at = String(change.at);
      cell.dataset.column =
        (change.kind === "added" ? picked.created : picked.updated) ?? "";
      cell.dataset.raw = String(row[index]);
      paint(cell);
      return cell;
    },
    refreshLabels(root) {
      for (const cell of root.querySelectorAll<HTMLElement>(
        ".db-grid-recency[data-at]",
      ))
        paint(cell);
    },
  };
}

export type RefreshMark = "added" | "changed";

export type RefreshMarks = {
  /**
   * 再読み込みの直前に、いま持っているページを控える。`identity` は主キーで
   * 行を見分ける (主キーの無い表・値の無い行は null を返し、行の中身で見分ける)。
   */
  begin: (
    pages: Iterable<[number, DbValue[][]]>,
    identity: (row: DbValue[]) => string | null,
  ) => void;
  /** 再読み込みの後に届いたページを控えと比べる。控えに無いページは比べない。 */
  notePage: (pageStart: number, rows: DbValue[][]) => void;
  markOf: (row: DbValue[]) => RefreshMark | null;
  counts: () => { added: number; changed: number };
  clear: () => void;
};

// 行の中身の写し。バイト列は長さと先頭だけで見分ける (全部を文字にしない)。
function rowSignature(row: DbValue[]): string {
  return JSON.stringify(
    row.map((value) =>
      value instanceof Uint8Array
        ? `blob:${value.byteLength}:${Array.from(value.subarray(0, 32)).join(".")}`
        : value,
    ),
  );
}

export function createRefreshMarks(): RefreshMarks {
  let identity: (row: DbValue[]) => string | null = () => null;
  let before: Map<string, string> | null = null;
  let coveredPages = new Set<number>();
  const marks = new Map<string, RefreshMark>();
  const idOf = (row: DbValue[], signature: string) =>
    identity(row) ?? signature;

  return {
    begin(pages, rowIdentity) {
      identity = rowIdentity;
      before = new Map();
      coveredPages = new Set();
      marks.clear();
      for (const [pageStart, rows] of pages) {
        coveredPages.add(pageStart);
        for (const row of rows) {
          const signature = rowSignature(row);
          before.set(idOf(row, signature), signature);
        }
      }
    },
    notePage(pageStart, rows) {
      if (!before || !coveredPages.has(pageStart)) return;
      for (const row of rows) {
        const signature = rowSignature(row);
        const id = idOf(row, signature);
        const previous = before.get(id);
        if (previous === undefined) marks.set(id, "added");
        else if (previous !== signature) marks.set(id, "changed");
      }
    },
    markOf(row) {
      if (marks.size === 0) return null;
      return marks.get(idOf(row, rowSignature(row))) ?? null;
    },
    counts() {
      let added = 0;
      let changed = 0;
      for (const mark of marks.values()) {
        if (mark === "added") added++;
        else changed++;
      }
      return { added, changed };
    },
    clear() {
      before = null;
      coveredPages = new Set();
      marks.clear();
    },
  };
}
