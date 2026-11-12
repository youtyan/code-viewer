import { html, nothing } from "lit/html.js";
import { templateElement } from "../ui/renderer";

// es-explorer の mapping テーブルと dynamodb-explorer の属性テーブルが、見出し
// 行 + 空状態の1行 + 値行という同一構造を個別実装していた重複を解消する共通の
// 「ラベル付きテーブル」ビルダー。1列目は主キー的な強調表示、2列目以降は補助
// 情報として薄い色で表示する(既存の es-mapping-field/type, dynamodb-attr-name
// /type/role の表示規約を踏襲)。
export function detailTableTemplate(
  headers: string[],
  rows: string[][],
  emptyText: string,
): unknown {
  return html`<table class="db-detail-table"><thead><tr>${headers.map(
    (label) => html`<th>${label}</th>`,
  )}</tr></thead><tbody>${
    rows.length === 0
      ? html`<tr><td colspan=${headers.length} class="db-value-empty"
            >${emptyText}</td
          ></tr>`
      : nothing
  }${rows.map(
    (cells) =>
      html`<tr>${cells.map(
        (cellText, index) =>
          html`<td
            class=${index === 0 ? "db-detail-table-primary" : "db-detail-table-muted"}
          >${cellText}</td>`,
      )}</tr>`,
  )}</tbody></table>`;
}

export function createDetailTable(
  headers: string[],
  rows: string[][],
  emptyText: string,
): HTMLTableElement {
  return templateElement<HTMLTableElement>(
    detailTableTemplate(headers, rows, emptyText),
  );
}
