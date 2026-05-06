import { describe, expect, test } from "bun:test";
import {
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
} from "../expand-logic";

const STEP = 20;

// ---- initial state -------------------------------------------------------

describe("initExpandState", () => {
  test("mid-file hunk: prev ends at new line 32, this hunk starts at 119", () => {
    const s = initExpandState(33, 119);
    expect(s.topExpandedStart).toBe(119);
    expect(s.bottomExpandedEnd).toBe(32); // off-by-one fix: prevHunkEndNew - 1
  });

  test("first hunk: no prev, this hunk at line 25", () => {
    const s = initExpandState(0, 25);
    expect(s.topExpandedStart).toBe(25);
    expect(s.bottomExpandedEnd).toBe(-1);
  });

  test("whole-file hunk: starts at line 1", () => {
    const s = initExpandState(0, 1);
    // remaining gap should be empty
    expect(remainingGap(s, 0)).toBeNull();
  });
});

// ---- gap math ------------------------------------------------------------

describe("remainingGap", () => {
  test("mid-file: full gap available", () => {
    const s = initExpandState(33, 119);
    expect(remainingGap(s, 33)).toEqual({ start: 33, end: 118 });
  });

  test("first hunk: gap clamped to >=1", () => {
    const s = initExpandState(0, 25);
    expect(remainingGap(s, 0)).toEqual({ start: 1, end: 24 });
  });

  test("hunk-at-line-1: empty gap", () => {
    const s = initExpandState(0, 1);
    expect(remainingGap(s, 0)).toBeNull();
  });

  test("after ↑ + ↓ meet in middle: returns null", () => {
    let s = initExpandState(33, 119);
    s = applyUp(s, { start: 33, end: 75 });
    s = applyDown(s, { start: 76, end: 118 });
    expect(remainingGap(s, 33)).toBeNull();
    expect(isFullyExpanded(s, 33)).toBe(true);
  });
});

// ---- click ranges --------------------------------------------------------

describe("upClickRange (↑, low end)", () => {
  test("initial click pulls 20 lines starting at gap start", () => {
    const s = initExpandState(33, 119);
    expect(upClickRange(s, 33, STEP)).toEqual({ start: 33, end: 52 });
  });

  test("after one ↑, second ↑ extends contiguously", () => {
    let s = initExpandState(33, 119);
    s = applyUp(s, upClickRange(s, 33, STEP));
    expect(upClickRange(s, 33, STEP)).toEqual({ start: 53, end: 72 });
  });

  test("shrunk gap < STEP: pulls only what remains", () => {
    let s = initExpandState(33, 50);
    expect(upClickRange(s, 33, STEP)).toEqual({ start: 33, end: 49 });
  });

  test("first hunk gap [1..24]: ↑ pulls 1..20", () => {
    const s = initExpandState(0, 25);
    expect(upClickRange(s, 0, STEP)).toEqual({ start: 1, end: 20 });
  });
});

describe("downClickRange (↓, high end)", () => {
  test("initial click pulls last 20 lines of gap", () => {
    const s = initExpandState(33, 119);
    expect(downClickRange(s, 33, STEP)).toEqual({ start: 99, end: 118 });
  });

  test("after one ↓, second ↓ extends contiguously below", () => {
    let s = initExpandState(33, 119);
    s = applyDown(s, downClickRange(s, 33, STEP));
    expect(downClickRange(s, 33, STEP)).toEqual({ start: 79, end: 98 });
  });

  test("shrunk gap < STEP: pulls only what remains", () => {
    let s = initExpandState(33, 50);
    expect(downClickRange(s, 33, STEP)).toEqual({ start: 33, end: 49 });
  });
});

// ---- meeting / fully expanded -------------------------------------------

describe("full sweep with mixed ↑/↓ clicks", () => {
  test("↑ until reaches ↓ region: no overlap, no missed lines", () => {
    let s = initExpandState(33, 119);
    // 5 ↓ clicks (each 20 lines): fill 19..118 → wait gap is 33..118 (86 lines)
    const steps = [];
    while (downClickRange(s, 33, STEP)) {
      const r = downClickRange(s, 33, STEP);
      steps.push(r);
      s = applyDown(s, r);
      if (steps.length > 10) throw new Error("runaway");
    }
    // After all ↓ clicks, gap should be empty
    expect(remainingGap(s, 33)).toBeNull();
    // Inserted ranges should cover [33..118] without gaps or overlaps
    const filled = new Set();
    for (const r of steps) for (let i = r.start; i <= r.end; i++) filled.add(i);
    for (let i = 33; i <= 118; i++) expect(filled.has(i)).toBe(true);
    expect(filled.size).toBe(118 - 33 + 1);
  });

  test("alternating ↑/↓ never duplicates lines", () => {
    let s = initExpandState(33, 119);
    const filled = new Set();
    let i = 0;
    while (!isFullyExpanded(s, 33) && i < 100) {
      const fn = i % 2 === 0 ? upClickRange : downClickRange;
      const apply = i % 2 === 0 ? applyUp : applyDown;
      const r = fn(s, 33, STEP);
      if (!r) break;
      for (let n = r.start; n <= r.end; n++) {
        expect(filled.has(n)).toBe(false); // no duplicate
        filled.add(n);
      }
      s = apply(s, r);
      i++;
    }
    expect(isFullyExpanded(s, 33)).toBe(true);
    for (let n = 33; n <= 118; n++) expect(filled.has(n)).toBe(true);
  });
});

// ---- mapNewToOld --------------------------------------------------------

// ---- first-hunk semantics ----------------------------------------------

describe("first hunk button range (single ↑)", () => {
  // For first hunk the visible button pulls the HIGH end of the gap (lines
  // closest to this hunk's start), but renders with the ↑ icon since the
  // expanded rows physically appear ABOVE @@ in the diff view.
  test("hunk at line 25: first click pulls 5..24 (last 20 of gap)", () => {
    const s = initExpandState(0, 25);
    expect(downClickRange(s, 0, STEP)).toEqual({ start: 5, end: 24 });
  });

  test("repeated clicks walk upward (toward line 1)", () => {
    let s = initExpandState(0, 200);
    // 1st click: gap=[1..199]; last 20 of gap = [180..199]
    s = applyDown(s, downClickRange(s, 0, STEP));
    expect(s.topExpandedStart).toBe(180);
    // 2nd click: gap=[1..179]; last 20 = [160..179]
    s = applyDown(s, downClickRange(s, 0, STEP));
    expect(s.topExpandedStart).toBe(160);
  });
});

describe("mapNewToOld", () => {
  test("preserves offset between old and new", () => {
    // hunk1: @@ -25,6 +25,8 @@ (old 25-30, new 25-32) → prevEndNew=33, prevEndOld=31
    expect(mapNewToOld(33, 33, 31)).toBe(31);
    expect(mapNewToOld(99, 33, 31)).toBe(97);
    expect(mapNewToOld(118, 33, 31)).toBe(116);
  });

  test("first hunk: prevEnds = 0, mapping is identity", () => {
    expect(mapNewToOld(1, 0, 0)).toBe(1);
    expect(mapNewToOld(20, 0, 0)).toBe(20);
  });
});

describe("trailingClickRange", () => {
  test("last hunk down button fetches lines immediately after the hunk", () => {
    expect(trailingClickRange(63, STEP)).toEqual({ start: 63, end: 82 });
  });
});

describe("applyTrailingResult", () => {
  test("advances old and new cursors by the received line count", () => {
    expect(
      applyTrailingResult({ newStart: 63, oldStart: 62 }, 20, STEP),
    ).toEqual({
      newStart: 83,
      oldStart: 82,
      eof: false,
    });
  });

  test("marks eof when the server returns fewer lines than requested", () => {
    expect(
      applyTrailingResult({ newStart: 63, oldStart: 62 }, 7, STEP),
    ).toEqual({
      newStart: 70,
      oldStart: 69,
      eof: true,
    });
  });

  test("marks eof when the server returns no lines", () => {
    expect(
      applyTrailingResult({ newStart: 63, oldStart: 62 }, 0, STEP),
    ).toEqual({
      newStart: 63,
      oldStart: 62,
      eof: true,
    });
  });
});
