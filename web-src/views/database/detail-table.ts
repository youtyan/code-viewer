// es-explorer の mapping テーブルと dynamodb-explorer の属性テーブルが、見出し
// 行 + 空状態の1行 + 値行という同一構造を個別実装していた重複を解消する共通の
// 「ラベル付きテーブル」ビルダー。1列目は主キー的な強調表示、2列目以降は補助
// 情報として薄い色で表示する(既存の es-mapping-field/type, dynamodb-attr-name
// /type/role の表示規約を踏襲)。
export function createDetailTable(
  headers: string[],
  rows: string[][],
  emptyText: string,
): HTMLTableElement {
  const table = document.createElement("table");
  table.className = "db-detail-table";
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  for (const label of headers) {
    const th = document.createElement("th");
    th.textContent = label;
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  if (rows.length === 0) {
    const row = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = headers.length;
    td.className = "db-value-empty";
    td.textContent = emptyText;
    row.appendChild(td);
    tbody.appendChild(row);
  }
  for (const cells of rows) {
    const row = document.createElement("tr");
    cells.forEach((cellText, index) => {
      const td = document.createElement("td");
      td.textContent = cellText;
      td.className =
        index === 0 ? "db-detail-table-primary" : "db-detail-table-muted";
      row.appendChild(td);
    });
    tbody.appendChild(row);
  }
  table.appendChild(tbody);
  return table;
}
