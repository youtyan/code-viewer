// Data の表で、セルの範囲を選んでコピーする操作。
// - ドラッグ (表の端では自動で送る)・Shift+クリック・Shift+矢印で範囲を選ぶ
// - 行番号 (と「変更」の列) を押す・ドラッグすると行ごと選ぶ
// - ⌘/Ctrl+A で全部、⌘/Ctrl+C でコピー、Shift も押すと列名つき
// コピーはタブ区切り (Excel・スプレッドシートにそのまま貼れる)。範囲に読み
// 込んでいない行があれば読んでからコピーする。範囲の計算と文字にするのは
// core/database/cell-range.ts。

import {
  type CellPoint,
  type CellRange,
  cellRange,
  cellRangeSize,
  cellsToClipboardText,
  inCellRange,
} from "../../core/database/cell-range";
import type { DbValue } from "../../core/database/types";
import type { DbText } from "./i18n";
import { reportDatastoreFailure } from "./report-failure";

/** 1 回でコピーする行の上限 (読み込みと貼り付け先の重さのため)。 */
export const MAX_COPY_ROWS = 10_000;
// ドラッグ中に表の上下の端からこの距離に入ったら、その向きへ送る。
const AUTO_SCROLL_EDGE_PX = 24;

export type GridRangeDeps = {
  body: HTMLElement;
  viewport: HTMLElement;
  /** 範囲を選べるか (編集モードの間は入力が優先)。 */
  enabled: () => boolean;
  renderStartRow: () => number;
  totalRows: () => number;
  columnNames: () => string[];
  /** 行の先頭の固定の列の数 (行番号と「変更」)。 */
  leadingCellCount: () => number;
  rowHeight: () => number;
  /** 今のセル。範囲のもう一方の端。 */
  active: () => CellPoint | null;
  /** 今のセルを動かす (詳細は開かない)。scroll: 見える位置まで寄せる。 */
  setActive: (point: CellPoint, scroll: boolean) => void;
  /** 表の中身が変わると進む番号。コピーの途中で変わったら取りやめる。 */
  generation: () => number;
  /** first〜last の行 (読み込んでいなければ読む)。読めなければ throw。 */
  rowsBetween: (first: number, last: number) => Promise<DbValue[][]>;
  /** 1 つのセルの貼り付け用の文字 (NULL は空、表示と同じ日時)。 */
  cellText: (row: DbValue[], col: number) => string;
  text: () => DbText;
  /** コピーの結果を表の下の行に出す。failed なら次の操作まで消さない。 */
  notice: (message: string, failed: boolean) => void;
  /** 表の名前 (失敗の console に出す)。 */
  table: () => string;
};

export type GridRangeSelect = {
  /** 2 つ以上のセルを囲んでいる範囲。1 つだけなら null。 */
  multiRange: () => CellRange | null;
  /** 今のセルだけにする (矢印キーで動いた・クリックしたとき)。 */
  collapse: () => void;
  /** 表の中身が変わったとき。範囲を捨てる。 */
  reset: () => void;
  /** 描いてある行に範囲の色を付け直す。 */
  paint: () => void;
  /** キー操作を引き受けたら true (呼び出し側は既定の動きを止める)。 */
  handleKey: (e: KeyboardEvent) => boolean;
  destroy: () => void;
};

export function createGridRangeSelect(deps: GridRangeDeps): GridRangeSelect {
  let anchor: CellPoint | null = null;
  let dragging: "cells" | "rows" | null = null;
  let pointerY = 0;
  let autoScrollFrame = 0;

  function currentRange(): CellRange | null {
    const focus = deps.active();
    if (!anchor || !focus) return null;
    return cellRange(anchor, focus);
  }

  function multiRange(): CellRange | null {
    const range = currentRange();
    if (!range) return null;
    const size = cellRangeSize(range);
    return size.rows * size.cols > 1 ? range : null;
  }

  function paint(): void {
    const range = multiRange();
    const lead = deps.leadingCellCount();
    const start = deps.renderStartRow();
    Array.from(deps.body.children).forEach((rowEl, offset) => {
      const row = start + offset;
      const cells = rowEl.children;
      for (let c = lead; c < cells.length; c++)
        cells[c].classList.toggle(
          "in-range",
          range !== null && inCellRange(range, row, c - lead),
        );
    });
  }

  function select(from: CellPoint, to: CellPoint, scroll: boolean): void {
    anchor = from;
    deps.setActive(to, scroll);
    paint();
  }

  /** 押した所のセル。col が -1 なら行番号・「変更」の列。 */
  function cellAt(target: EventTarget | null): CellPoint | null {
    const cell = (target as Element | null)?.closest?.(".db-grid-cell");
    const rowEl = cell?.parentElement;
    if (!cell || !rowEl || rowEl.parentElement !== deps.body) return null;
    if (rowEl.classList.contains("db-grid-row-draft")) return null;
    const row =
      deps.renderStartRow() +
      Array.prototype.indexOf.call(deps.body.children, rowEl);
    if (row < 0 || row >= deps.totalRows()) return null;
    const col =
      Array.prototype.indexOf.call(rowEl.children, cell) -
      deps.leadingCellCount();
    return { row, col: Math.max(col, -1) };
  }

  function lastCol(): number {
    return deps.columnNames().length - 1;
  }

  function onMouseDown(e: MouseEvent): void {
    if (e.button !== 0 || !deps.enabled()) return;
    const hit = cellAt(e.target);
    if (!hit) return;
    // 文字を選ぶ代わりにセルの範囲を選ぶ。キーを受けるため表に焦点を置く。
    e.preventDefault();
    deps.viewport.focus({ preventScroll: true });
    const keep = e.shiftKey && anchor !== null;
    if (hit.col < 0) {
      dragging = "rows";
      const from = keep && anchor ? anchor.row : hit.row;
      select({ row: from, col: 0 }, { row: hit.row, col: lastCol() }, false);
    } else {
      dragging = "cells";
      select(keep && anchor ? anchor : hit, hit, false);
    }
    window.addEventListener("mousemove", onDragMove);
    window.addEventListener("mouseup", endDrag, { once: true });
  }

  function dragTo(hit: CellPoint): void {
    const to =
      dragging === "rows"
        ? { row: hit.row, col: lastCol() }
        : { row: hit.row, col: Math.max(hit.col, 0) };
    const focus = deps.active();
    if (focus && focus.row === to.row && focus.col === to.col) return;
    deps.setActive(to, false);
    paint();
  }

  function onDragMove(e: MouseEvent): void {
    if (!dragging) return;
    if ((e.buttons & 1) === 0) {
      endDrag();
      return;
    }
    pointerY = e.clientY;
    const hit = cellAt(e.target);
    if (hit) dragTo(hit);
    if (!autoScrollFrame)
      autoScrollFrame = requestAnimationFrame(autoScrollStep);
  }

  // 表の上下の端より外にポインタがある間、1 行ずつ送って範囲を伸ばす。
  function autoScrollStep(): void {
    autoScrollFrame = 0;
    const focus = deps.active();
    if (!dragging || !focus) return;
    const rect = deps.viewport.getBoundingClientRect();
    const step =
      pointerY > rect.bottom - AUTO_SCROLL_EDGE_PX
        ? 1
        : pointerY < rect.top + AUTO_SCROLL_EDGE_PX
          ? -1
          : 0;
    if (step === 0) return;
    const row = Math.min(Math.max(focus.row + step, 0), deps.totalRows() - 1);
    if (row !== focus.row) {
      deps.setActive(
        { row, col: dragging === "rows" ? lastCol() : focus.col },
        true,
      );
      paint();
    }
    autoScrollFrame = requestAnimationFrame(autoScrollStep);
  }

  function endDrag(): void {
    dragging = null;
    window.removeEventListener("mousemove", onDragMove);
    window.removeEventListener("mouseup", endDrag);
    if (autoScrollFrame) cancelAnimationFrame(autoScrollFrame);
    autoScrollFrame = 0;
  }

  async function copy(withHeader: boolean): Promise<void> {
    const range = currentRange();
    if (!range) return;
    const t = deps.text().grid;
    const size = cellRangeSize(range);
    const rowCount = Math.min(size.rows, MAX_COPY_ROWS);
    const generation = deps.generation();
    try {
      const rows = await deps.rowsBetween(range.top, range.top + rowCount - 1);
      if (generation !== deps.generation()) {
        deps.notice(t.copyCancelled, false);
        return;
      }
      const lines = rows.map((row) => {
        const out: string[] = [];
        for (let c = range.left; c <= range.right; c++)
          out.push(deps.cellText(row, c));
        return out;
      });
      if (withHeader)
        lines.unshift(deps.columnNames().slice(range.left, range.right + 1));
      await navigator.clipboard.writeText(cellsToClipboardText(lines));
      deps.notice(
        rowCount < size.rows
          ? t.copyTruncated(rowCount, size.rows, size.cols)
          : t.copyDone(rowCount, size.cols, withHeader),
        false,
      );
    } catch (error) {
      // 読んでいる間に表が変わって行が取れなかったのは失敗ではない。
      if (generation !== deps.generation()) {
        deps.notice(t.copyCancelled, false);
        return;
      }
      deps.notice(
        t.copyFailed(
          reportDatastoreFailure(
            "SQL",
            "copy cells",
            error,
            deps.table(),
            range,
          ),
        ),
        true,
      );
    }
  }

  const ARROWS: Record<string, CellPoint> = {
    ArrowUp: { row: -1, col: 0 },
    ArrowDown: { row: 1, col: 0 },
    ArrowLeft: { row: 0, col: -1 },
    ArrowRight: { row: 0, col: 1 },
  };

  function handleKey(e: KeyboardEvent): boolean {
    if (!deps.enabled()) return false;
    const mod = (e.metaKey || e.ctrlKey) && !e.altKey;
    const key = e.key.toLowerCase();
    if (mod && key === "c") {
      if (!currentRange()) return false;
      void copy(e.shiftKey);
      return true;
    }
    const rows = deps.totalRows();
    const cols = deps.columnNames().length;
    if (mod && key === "a" && !e.shiftKey) {
      if (rows === 0 || cols === 0) return false;
      select({ row: 0, col: 0 }, { row: rows - 1, col: cols - 1 }, false);
      return true;
    }
    const step = ARROWS[e.key];
    if (step && e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const focus = deps.active();
      if (!focus || rows === 0 || cols === 0) return false;
      if (!anchor) anchor = focus;
      deps.setActive(
        {
          row: Math.min(Math.max(focus.row + step.row, 0), rows - 1),
          col: Math.min(Math.max(focus.col + step.col, 0), cols - 1),
        },
        true,
      );
      paint();
      return true;
    }
    if (e.key === "Escape" && !mod && !e.shiftKey && multiRange()) {
      collapse();
      return true;
    }
    return false;
  }

  function collapse(): void {
    anchor = deps.active();
    paint();
  }

  deps.body.addEventListener("mousedown", onMouseDown);

  return {
    multiRange,
    collapse,
    reset() {
      anchor = null;
      endDrag();
    },
    paint,
    handleKey,
    destroy() {
      endDrag();
      deps.body.removeEventListener("mousedown", onMouseDown);
    },
  };
}
