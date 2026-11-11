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
 * 札 (emptyLabel)。文字と形の両方で見分ける。札にしたら true (表・SQL の結果・
 * 履歴のプレビューが共有する。見た目は style.css の .db-grid-null / .db-grid-empty)。
 */
export function fillNullOrEmpty(
  cell: HTMLElement,
  value: DbValue,
  emptyLabel: string,
): boolean {
  if (value !== null && value !== "") return false;
  cell.replaceChildren(
    templateElement(
      value === null
        ? html`<span class="db-grid-null">NULL</span>`
        : html`<span class="db-grid-empty">${emptyLabel}</span>`,
    ),
  );
  cell.classList.add(value === null ? "is-null" : "is-empty");
  return true;
}
