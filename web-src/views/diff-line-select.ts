// After-side line selection on the diff screen. Dragging over the new-file
// line numbers (unified: .line-num2, side-by-side: right pane) highlights the
// rows and surfaces the line-ref copy pill with "@path#start-end".

import { isImeComposing } from "../core/keyboard";
import type { LineRefPill } from "./line-ref-pill";

export type DiffLineSelectDeps = {
  pill: LineRefPill;
};

type DragState = { path: string; start: number };
type Selection = { path: string; start: number; end: number };

const SELECTED_CLASS = "gdp-diff-line-selected";

function cardPath(el: Element): string {
  return (
    el.closest<HTMLElement>(".gdp-file-shell[data-path]")?.dataset.path || ""
  );
}

// The after-side line number for a clicked cell, or null when the cell is on
// the old side (left pane / .line-num1) or has no line (deleted rows).
function afterLineFromCell(cell: HTMLElement): number | null {
  const sideCell = cell.closest<HTMLElement>("td.d2h-code-side-linenumber");
  if (sideCell) {
    const side = sideCell.closest<HTMLElement>(".d2h-file-side-diff");
    const wrapper = sideCell.closest<HTMLElement>(".d2h-file-wrapper");
    if (!side || !wrapper) return null;
    const sides = wrapper.querySelectorAll<HTMLElement>(".d2h-file-side-diff");
    if (sides.length < 2 || side !== sides[1]) return null;
    const line = Number((sideCell.textContent || "").trim());
    return Number.isInteger(line) && line > 0 ? line : null;
  }
  const numCell = cell.closest<HTMLElement>("td.d2h-code-linenumber");
  if (!numCell) return null;
  const raw = (
    numCell.querySelector<HTMLElement>(".line-num2")?.textContent || ""
  ).trim();
  const line = Number(raw);
  return Number.isInteger(line) && line > 0 ? line : null;
}

// Rows carrying an after-side line within the card. Unified tables and the
// right pane of side-by-side tables both resolve through afterLineFromCell.
function rowsWithAfterLines(
  card: HTMLElement,
): Array<{ row: HTMLTableRowElement; line: number }> {
  const out: Array<{ row: HTMLTableRowElement; line: number }> = [];
  card
    .querySelectorAll<HTMLTableRowElement>("table.d2h-diff-table tr")
    .forEach((row) => {
      const cell = row.querySelector<HTMLElement>(
        "td.d2h-code-linenumber, td.d2h-code-side-linenumber",
      );
      if (!cell) return;
      const line = afterLineFromCell(cell);
      if (line !== null) out.push({ row, line });
    });
  return out;
}

export function createDiffLineSelect(deps: DiffLineSelectDeps) {
  let drag: DragState | null = null;
  let selection: Selection | null = null;

  function clearHighlights() {
    document
      .querySelectorAll<HTMLElement>(`.${SELECTED_CLASS}`)
      .forEach((row) => {
        row.classList.remove(SELECTED_CLASS);
      });
  }

  function applySelection(next: Selection | null) {
    selection = next;
    clearHighlights();
    if (!next) {
      deps.pill.hide();
      return;
    }
    const start = Math.min(next.start, next.end);
    const end = Math.max(next.start, next.end);
    const card = document.querySelector<HTMLElement>(
      `.gdp-file-shell[data-path="${CSS.escape(next.path)}"]`,
    );
    if (card) {
      for (const item of rowsWithAfterLines(card)) {
        if (item.line >= start && item.line <= end)
          item.row.classList.add(SELECTED_CLASS);
      }
    }
    deps.pill.show(next.path, start, end);
  }

  function clear() {
    drag = null;
    applySelection(null);
  }

  const diff = document.querySelector<HTMLElement>("#diff");
  if (!diff) return { clear };

  diff.addEventListener("mousedown", (e) => {
    const target = e.target as HTMLElement;
    const cell = target.closest<HTMLElement>(
      "td.d2h-code-linenumber, td.d2h-code-side-linenumber",
    );
    if (!cell) return;
    const line = afterLineFromCell(cell);
    const path = cardPath(cell);
    if (line === null || !path) {
      // Old-side numbers do not start a selection, but a stray click clears
      // the current one.
      if (selection) clear();
      return;
    }
    e.preventDefault();
    drag = { path, start: line };
    applySelection({ path, start: line, end: line });
  });

  diff.addEventListener("mouseover", (e) => {
    if (!drag) return;
    const target = e.target as HTMLElement;
    const cell = target.closest<HTMLElement>(
      "td.d2h-code-linenumber, td.d2h-code-side-linenumber",
    );
    if (!cell || cardPath(cell) !== drag.path) return;
    const line = afterLineFromCell(cell);
    if (line === null) return;
    applySelection({ path: drag.path, start: drag.start, end: line });
  });

  document.addEventListener("mouseup", () => {
    drag = null;
  });

  document.addEventListener("keydown", (e) => {
    if (isImeComposing(e)) return;
    if (e.key === "Escape" && selection && !drag) clear();
  });

  return { clear };
}
