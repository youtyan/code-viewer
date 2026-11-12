import { html } from "lit/html.js";
import type { DbValue } from "../../core/database/types";
import { templateElement } from "../ui/renderer";

export function formatQueryValue(value: DbValue): string {
  if (value === null) return "NULL";
  if (value instanceof Uint8Array) return `<blob ${value.byteLength} bytes>`;
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/**
 * NULL と空文字は値の代わりに札で出す。NULL は塗りの札、空文字は点線の枠の
 * 札 (emptyLabel)。文字と形の両方で見分ける (表・SQL の結果・履歴のプレビューが
 * 共有する。見た目は style.css の .db-grid-null / .db-grid-empty)。
 * 札にしない値なら null。cellClass は札を入れる欄に足すクラス。
 */
export function nullOrEmptyMark(
  value: DbValue,
  emptyLabel: string,
): { mark: unknown; cellClass: "is-null" | "is-empty" } | null {
  if (value === null)
    return {
      mark: html`<span class="db-grid-null">NULL</span>`,
      cellClass: "is-null",
    };
  if (value === "")
    return {
      mark: html`<span class="db-grid-empty">${emptyLabel}</span>`,
      cellClass: "is-empty",
    };
  return null;
}

/** nullOrEmptyMark の札を cell に入れる。札にしたら true。 */
export function fillNullOrEmpty(
  cell: HTMLElement,
  value: DbValue,
  emptyLabel: string,
): boolean {
  const shown = nullOrEmptyMark(value, emptyLabel);
  if (!shown) return false;
  cell.replaceChildren(templateElement(shown.mark));
  cell.classList.add(shown.cellClass);
  return true;
}
