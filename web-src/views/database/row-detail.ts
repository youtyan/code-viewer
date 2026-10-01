// Data の表のセルの詳細の「行全体」。1 行の全部の列を、左に列 (名前・型・
// 主キー)、右に値で並べる。
// - 値は読みやすい形にする: JSON は整形して色を付け、日時は表に出している
//   タイムゾーンで出して「何分前」を添え、NULL と空文字は表と同じ札にする
// - いま選んでいる列を目立たせ、外部キーの列には関連を開くボタンを置く
// - 列が多いときは上の欄で列の名前を絞り込める
// 値ごとのコピーは右端のボタン。開閉やコピーの配線は table-grid.ts。

import type { DbColumn, DbValue } from "../../core/database/types";
import { COPY_16_PATHS, iconSvg, LINK_16_PATH } from "../../core/icons";
import type { DbText } from "./i18n";
import { fillNullOrEmpty } from "./query-value";

/** この数より列が多いときだけ、列の名前の絞り込み欄を出す。 */
const FILTER_MIN_COLUMNS = 12;

export type RowDetailOptions = {
  columns: DbColumn[];
  row: DbValue[];
  /** いま選んでいるセルの列 (目立たせる)。 */
  activeColumn: number;
  text: DbText;
  /** 日時の列を表のタイムゾーンで出した文字と、何分前か。日時でなければ null。 */
  time: (col: number) => { shown: string; relative: string } | null;
  /** 外部キーで関連を開ける列か。 */
  isForeignKey: (col: number) => boolean;
  openRelated: (col: number) => void;
  /** JSON を pre に入れる (色付けは呼び出し側が遅れて行う)。 */
  showJson: (pre: HTMLElement, json: string) => void;
  /** 1 つの値をコピーする (失敗は呼び出し側が出す)。 */
  copy: (value: string, button: HTMLButtonElement) => void;
  /** コピーする文字 (NULL は空、表示と同じ日時)。 */
  copyText: (col: number) => string;
};

/** 括弧で始まり JSON として読める文字なら、整形した JSON。 */
function prettyJson(value: DbValue): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  const first = value.trimStart()[0];
  if (first !== "{" && first !== "[") return null;
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    // 括弧で始まるだけの文字。整形せず、ふつうの文字として出す。
    return null;
  }
}

function valueCell(opts: RowDetailOptions, col: number): HTMLElement {
  const value = opts.row[col];
  const cell = document.createElement("div");
  cell.className = "db-row-detail-value";
  if (fillNullOrEmpty(cell, value, opts.text.grid.emptyValue)) return cell;
  if (value instanceof Uint8Array) {
    cell.textContent = `BLOB (${value.byteLength} bytes)`;
    cell.classList.add("is-blob");
    return cell;
  }
  const json = prettyJson(value);
  if (json !== null) {
    const pre = document.createElement("pre");
    pre.className = "db-grid-detail-json db-row-detail-json";
    opts.showJson(pre, json);
    cell.appendChild(pre);
    return cell;
  }
  const time = opts.time(col);
  if (time) {
    const shown = document.createElement("span");
    shown.className = "db-row-detail-time";
    shown.textContent = time.shown;
    const relative = document.createElement("span");
    relative.className = "db-row-detail-relative";
    relative.textContent = time.relative;
    cell.append(shown, relative);
    cell.title = opts.text.grid.timeZoneCellTitle(String(value));
    return cell;
  }
  cell.textContent =
    typeof value === "object" ? JSON.stringify(value) : String(value);
  return cell;
}

export function renderRowDetail(
  host: HTMLElement,
  opts: RowDetailOptions,
): void {
  const t = opts.text.detail;
  host.textContent = "";
  host.classList.add("db-row-detail");
  let filter: HTMLInputElement | null = null;
  if (opts.columns.length > FILTER_MIN_COLUMNS) {
    filter = document.createElement("input");
    filter.type = "search";
    filter.className = "db-row-detail-filter";
    filter.placeholder = t.filterColumns(opts.columns.length);
    filter.autocomplete = "off";
    host.appendChild(filter);
  }
  const list = document.createElement("div");
  list.className = "db-row-detail-list";
  host.appendChild(list);
  const items: { name: string; el: HTMLElement }[] = [];
  opts.columns.forEach((column, col) => {
    const item = document.createElement("div");
    item.className = "db-row-detail-item";
    item.classList.toggle("is-active", col === opts.activeColumn);
    const key = document.createElement("div");
    key.className = "db-row-detail-key";
    const name = document.createElement("span");
    name.className = "db-row-detail-name";
    name.textContent = column.name;
    name.title = column.comment
      ? `${column.name} — ${column.comment}`
      : column.name;
    const type = document.createElement("span");
    type.className = "db-row-detail-type";
    type.textContent = column.type;
    key.append(name, type);
    if (column.primaryKey) {
      const pk = document.createElement("span");
      pk.className = "db-row-detail-pk";
      pk.textContent = "PK";
      key.appendChild(pk);
    }
    const actions = document.createElement("div");
    actions.className = "db-row-detail-actions";
    if (opts.isForeignKey(col) && opts.row[col] !== null) {
      const related = document.createElement("button");
      related.type = "button";
      related.className = "db-row-detail-action";
      related.innerHTML = iconSvg("octicon-link", LINK_16_PATH);
      related.title = t.openRelated;
      related.setAttribute("aria-label", t.openRelated);
      related.addEventListener("click", () => opts.openRelated(col));
      actions.appendChild(related);
    }
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "db-row-detail-action";
    copy.innerHTML = iconSvg("octicon-copy", COPY_16_PATHS);
    copy.title = t.copyValue(column.name);
    copy.setAttribute("aria-label", copy.title);
    copy.addEventListener("click", () => opts.copy(opts.copyText(col), copy));
    actions.appendChild(copy);
    item.append(key, valueCell(opts, col), actions);
    list.appendChild(item);
    items.push({ name: column.name.toLowerCase(), el: item });
  });
  filter?.addEventListener("input", () => {
    const query = filter?.value.trim().toLowerCase() ?? "";
    for (const item of items)
      item.el.hidden = query !== "" && !item.name.includes(query);
  });
}
