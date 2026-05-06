export type ExpandState = {
  topExpandedStart: number;
  bottomExpandedEnd: number;
};

export type LineRange = {
  start: number;
  end: number;
};

export function initExpandState(prevHunkEndNew: number, hunkNewStart: number): ExpandState {
  return {
    topExpandedStart: hunkNewStart,
    bottomExpandedEnd: prevHunkEndNew - 1,
  };
}

export function remainingGap(state: ExpandState, prevHunkEndNew: number): LineRange | null {
  const remainingStart = Math.max(1, prevHunkEndNew, state.bottomExpandedEnd + 1);
  const remainingEnd = state.topExpandedStart - 1;
  if (remainingStart > remainingEnd) return null;
  return { start: remainingStart, end: remainingEnd };
}

export function isFullyExpanded(state: ExpandState, prevHunkEndNew: number): boolean {
  return remainingGap(state, prevHunkEndNew) == null;
}

export function upClickRange(
  state: ExpandState,
  prevHunkEndNew: number,
  step: number,
): LineRange | null {
  const gap = remainingGap(state, prevHunkEndNew);
  return gap ? { start: gap.start, end: Math.min(gap.end, gap.start + step - 1) } : null;
}

export function downClickRange(
  state: ExpandState,
  prevHunkEndNew: number,
  step: number,
): LineRange | null {
  const gap = remainingGap(state, prevHunkEndNew);
  return gap ? { start: Math.max(gap.start, gap.end - step + 1), end: gap.end } : null;
}

export function applyUp(state: ExpandState, range: LineRange): ExpandState {
  return Object.assign({}, state, { bottomExpandedEnd: range.end });
}

export function applyDown(state: ExpandState, range: LineRange): ExpandState {
  return Object.assign({}, state, { topExpandedStart: range.start });
}

export function mapNewToOld(newLine: number, prevHunkEndNew: number, prevHunkEndOld: number): number {
  return prevHunkEndOld + (newLine - prevHunkEndNew);
}

export function trailingClickRange(hunkEndNew: number, step: number): LineRange {
  return { start: hunkEndNew, end: hunkEndNew + step - 1 };
}

export function applyTrailingResult(
  state: { newStart: number; oldStart: number },
  receivedCount: number,
  step: number,
): { newStart: number; oldStart: number; eof: boolean } {
  return {
    newStart: state.newStart + receivedCount,
    oldStart: state.oldStart + receivedCount,
    eof: receivedCount === 0 || receivedCount < step,
  };
}

export const GdpExpandLogic = {
  initExpandState,
  remainingGap,
  isFullyExpanded,
  upClickRange,
  downClickRange,
  applyUp,
  applyDown,
  mapNewToOld,
  trailingClickRange,
  applyTrailingResult,
};
