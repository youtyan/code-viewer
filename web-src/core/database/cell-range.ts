// Data の表で選んだセルの範囲と、それを Excel・スプレッドシートに貼れる文字に
// する純ロジック。DOM には触らない (選び方の操作は views/database/table-grid.ts)。

import { tsvFormatRows } from "d3-dsv";

/** 表の中のセルの位置 (データの行・列の番号。0 から)。 */
export type CellPoint = { row: number; col: number };

/** 起点と今の位置で囲む長方形 (両端を含む)。 */
// ai-dup-check: allow -- ok:pane-preview の PreviewRect は画面の px の矩形、こちらは表の行・列の番号 (両端を含む)。単位と意味が違う
export type CellRange = {
  top: number;
  bottom: number;
  left: number;
  right: number;
};

export function cellRange(anchor: CellPoint, focus: CellPoint): CellRange {
  return {
    top: Math.min(anchor.row, focus.row),
    bottom: Math.max(anchor.row, focus.row),
    left: Math.min(anchor.col, focus.col),
    right: Math.max(anchor.col, focus.col),
  };
}

export function inCellRange(
  range: CellRange,
  row: number,
  col: number,
): boolean {
  return (
    row >= range.top &&
    row <= range.bottom &&
    col >= range.left &&
    col <= range.right
  );
}

export function cellRangeSize(range: CellRange): {
  rows: number;
  cols: number;
} {
  return {
    rows: range.bottom - range.top + 1,
    cols: range.right - range.left + 1,
  };
}

/**
 * 貼り付け用の文字。1 つのセルだけなら値そのまま (メモ帳などにそのまま貼れる)。
 * 2 つ以上ならタブ区切り・改行区切り (TSV) で、タブ・改行・" を含む値は "…" で
 * 囲む (Excel・Google スプレッドシートが 1 つのセルとして読む書き方)。
 */
export function cellsToClipboardText(rows: string[][]): string {
  if (rows.length === 1 && rows[0].length === 1) return rows[0][0];
  return tsvFormatRows(rows);
}
