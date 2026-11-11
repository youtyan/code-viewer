// Data の表のセルの詳細の「行全体」。1 行の全部の列を、左に列 (名前・型・
// 主キー)、右に値で並べる。
// - 値は読みやすい形にする: JSON は整形して色を付け、日時は表に出している
//   タイムゾーンで出して「何分前」を添え、NULL と空文字は表と同じ札にする
// - いま選んでいる列を目立たせ、外部キーの列には関連を開くボタンを置く
// - 列が多いときは上の欄で列の名前を絞り込める
// 値ごとのコピーは右端のボタン。開閉やコピーの配線は table-grid.ts。

import { html, nothing } from "lit/html.js";
import type { DbColumn, DbValue } from "../../core/database/types";
import { COPY_16_PATHS, LINK_16_PATH } from "../../core/icons";
import { iconTemplate } from "../ui/icon";
import { renderOwned, templateElement } from "../ui/renderer";
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

/** 値の欄。JSON の色付けは呼び出し側が遅れて行うので、要素を作ってから渡す。 */
function valueCell(opts: RowDetailOptions, col: number): HTMLElement {
  const value = opts.row[col];
  const empty = templateElement(html`<div class="db-row-detail-value"></div>`);
  if (fillNullOrEmpty(empty, value, opts.text.grid.emptyValue)) return empty;
  if (value instanceof Uint8Array)
    return templateElement(
      html`<div class="db-row-detail-value is-blob"
        >BLOB (${value.byteLength} bytes)</div
      >`,
    );
  const json = prettyJson(value);
  if (json !== null) {
    const cell = templateElement(
      html`<div class="db-row-detail-value"><pre
          class="db-grid-detail-json db-row-detail-json"
        ></pre></div>`,
    );
    const pre = cell.querySelector<HTMLElement>("pre");
    if (!pre) throw new Error("row detail: the JSON box was not drawn");
    opts.showJson(pre, json);
    return cell;
  }
  const time = opts.time(col);
  if (time)
    return templateElement(
      html`<div
        class="db-row-detail-value"
        title=${opts.text.grid.timeZoneCellTitle(String(value))}
      ><span class="db-row-detail-time">${time.shown}</span><span
          class="db-row-detail-relative"
          >${time.relative}</span
        ></div>`,
    );
  return templateElement(
    html`<div class="db-row-detail-value">${
      typeof value === "object" ? JSON.stringify(value) : String(value)
    }</div>`,
  );
}

export function renderRowDetail(
  host: HTMLElement,
  opts: RowDetailOptions,
): void {
  const t = opts.text.detail;
  host.classList.add("db-row-detail");
  // 列の名前の絞り込み (この欄の中だけの状態)。値の欄は 1 度だけ作って使い回す。
  let query = "";
  const values = opts.columns.map((_, col) => valueCell(opts, col));
  const draw = () =>
    renderOwned(
      host,

      html`${
        opts.columns.length > FILTER_MIN_COLUMNS
          ? html`<input
              type="search"
              class="db-row-detail-filter"
              placeholder=${t.filterColumns(opts.columns.length)}
              autocomplete="off"
              @input=${(event: Event) => {
                query = (event.currentTarget as HTMLInputElement).value
                  .trim()
                  .toLowerCase();
                draw();
              }}
            />`
          : nothing
      }<div class="db-row-detail-list">${opts.columns.map((column, col) => {
        const copyLabel = t.copyValue(column.name);
        return html`<div
          class=${col === opts.activeColumn ? "db-row-detail-item is-active" : "db-row-detail-item"}
          ?hidden=${query !== "" && !column.name.toLowerCase().includes(query)}
        ><div class="db-row-detail-key"><span
              class="db-row-detail-name"
              title=${column.comment ? `${column.name} — ${column.comment}` : column.name}
            >${column.name}</span><span class="db-row-detail-type"
              >${column.type}</span
            >${column.primaryKey ? html`<span class="db-row-detail-pk">PK</span>` : nothing}</div
          >${values[col]}<div class="db-row-detail-actions">${
            opts.isForeignKey(col) && opts.row[col] !== null
              ? html`<button
                  type="button"
                  class="db-row-detail-action"
                  title=${t.openRelated}
                  aria-label=${t.openRelated}
                  @click=${() => opts.openRelated(col)}
                >${iconTemplate(LINK_16_PATH, "octicon-link")}</button>`
              : nothing
          }<button
              type="button"
              class="db-row-detail-action"
              title=${copyLabel}
              aria-label=${copyLabel}
              @click=${(event: Event) =>
                opts.copy(
                  opts.copyText(col),
                  event.currentTarget as HTMLButtonElement,
                )}
            >${iconTemplate(COPY_16_PATHS, "octicon-copy")}</button></div
          ></div>`;
      })}</div>`,
    );
  draw();
}
