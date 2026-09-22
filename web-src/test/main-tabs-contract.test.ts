import { describe, expect, test } from "vitest";
import {
  activate,
  activateIndex,
  assertLayout,
  canMoveToOtherSide,
  canSplit,
  close,
  closeOthers,
  closeToRight,
  focusPane,
  keepOpen,
  type Layout,
  move,
  moveToOtherSide,
  nextTab,
  open,
  type Pane,
  type PaneSide,
  parseLayout,
  prevTab,
  sameTarget,
  serializeLayout,
  showHome,
  splitRight,
  type Tab,
  type TabTarget,
  tabMenu,
} from "../core/main-tabs";

const FILE_A: TabTarget = { kind: "file", path: "sample/alpha.ts" };
const FILE_B: TabTarget = { kind: "file", path: "sample/beta.ts" };
const FILE_C: TabTarget = { kind: "file", path: "sample/gamma.ts" };
const IMAGE_A: TabTarget = { kind: "image", path: "sample/alpha.png" };
// 右の面に置けないのは page だけ (canPlace)。2 面の例の右の面は主に画像で組む。
const IMAGE_B: TabTarget = { kind: "image", path: "sample/beta.png" };
const IMAGE_C: TabTarget = { kind: "image", path: "sample/gamma.png" };
const TERMINAL_A: TabTarget = { kind: "terminal", session: "session-a" };
const PAGE_DIFF: TabTarget = { kind: "page", page: "diff" };
const PAGE_HISTORY: TabTarget = { kind: "page", page: "history" };

function tab(id: string, target: TabTarget, preview = false): Tab {
  return { id, target, preview };
}

function pane(
  tabs: Tab[],
  activeId: string | null = tabs[0]?.id ?? null,
  recent?: string[],
): Pane {
  return {
    tabs,
    activeId,
    recent: recent ?? (activeId === null ? [] : [activeId]),
  };
}

function one(
  tabs: Tab[],
  activeId: string | null = tabs[0]?.id ?? null,
  recent?: string[],
): Layout {
  return { panes: { left: pane(tabs, activeId, recent) }, focused: "left" };
}

function two(left: Pane, right: Pane, focused: PaneSide = "left"): Layout {
  return { panes: { left, right }, focused };
}

function paneAt(state: Layout, side: PaneSide): Pane | undefined {
  return side === "left" ? state.panes.left : state.panes.right;
}

function paneState(state: Layout, side: PaneSide) {
  const item = paneAt(state, side);
  return item
    ? {
        ids: item.tabs.map((itemTab) => itemTab.id),
        activeId: item.activeId,
        recent: item.recent,
        previews: item.tabs.map((itemTab) => itemTab.preview),
      }
    : null;
}

function expectValid(state: Layout): void {
  expect(() => assertLayout(state)).not.toThrow();
}

function thrownMessage(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    if (error instanceof Error) return error.message;
    throw error;
  }
  throw new Error("expected the operation to throw");
}

describe("main tabs contract: sameTarget", () => {
  test.each([
    {
      name: "the same file without a line",
      left: FILE_A,
      right: { kind: "file", path: "sample/alpha.ts" } as TabTarget,
      expected: true,
    },
    {
      name: "the same file line",
      left: { kind: "file", path: "sample/alpha.ts", line: 4 } as TabTarget,
      right: { kind: "file", path: "sample/alpha.ts", line: 4 } as TabTarget,
      expected: true,
    },
    {
      name: "the same file line range",
      left: {
        kind: "file",
        path: "sample/alpha.ts",
        line: { start: 4, end: 7 },
      } as TabTarget,
      right: {
        kind: "file",
        path: "sample/alpha.ts",
        line: { start: 4, end: 7 },
      } as TabTarget,
      expected: true,
    },
    {
      name: "different lines of one file are one target",
      left: { kind: "file", path: "sample/alpha.ts", line: 4 } as TabTarget,
      right: { kind: "file", path: "sample/alpha.ts", line: 5 } as TabTarget,
      expected: true,
    },
    {
      name: "a line and no line are one target",
      left: FILE_A,
      right: { kind: "file", path: "sample/alpha.ts", line: 4 } as TabTarget,
      expected: true,
    },
    {
      name: "different file paths",
      left: FILE_A,
      right: FILE_B,
      expected: false,
    },
    {
      name: "the same terminal",
      left: TERMINAL_A,
      right: { kind: "terminal", session: "session-a" } as TabTarget,
      expected: true,
    },
    {
      name: "the same image",
      left: IMAGE_A,
      right: { kind: "image", path: "sample/alpha.png" } as TabTarget,
      expected: true,
    },
    {
      name: "the same page",
      left: PAGE_DIFF,
      right: { kind: "page", page: "diff" } as TabTarget,
      expected: true,
    },
    {
      name: "different pages",
      left: PAGE_DIFF,
      right: PAGE_HISTORY,
      expected: false,
    },
    {
      name: "different target kinds",
      left: FILE_A,
      right: IMAGE_A,
      expected: false,
    },
  ])("compares $name", ({ left, right, expected }) => {
    expect(sameTarget(left, right)).toBe(expected);
  });
});

describe("main tabs contract: open", () => {
  test("inserts a preview to the right of the active tab", () => {
    const start = one([tab("a", FILE_A), tab("b", FILE_B)], "a");
    const before = structuredClone(start);
    const result = open(start, FILE_C, { newId: () => "new" });
    expect(paneState(result, "left")).toEqual({
      ids: ["a", "new", "b"],
      activeId: "new",
      recent: ["a", "new"],
      previews: [false, true, false],
    });
    expect(result.focused).toBe("left");
    expect(start).toEqual(before);
    expectValid(result);
  });

  test("replaces the pane preview and removes its id from recent selection", () => {
    const start = one(
      [tab("a", FILE_A), tab("preview", FILE_B, true), tab("c", FILE_C)],
      "preview",
      ["a", "preview"],
    );
    const result = open(start, IMAGE_A, { newId: () => "image" });
    expect(paneState(result, "left")).toEqual({
      ids: ["a", "image", "c"],
      activeId: "image",
      recent: ["a", "image"],
      previews: [false, true, false],
    });
    expectValid(result);
  });

  test.each([
    { name: "page", target: PAGE_DIFF },
    { name: "terminal", target: TERMINAL_A },
  ])("always keeps a new $name tab open", ({ target }) => {
    const result = open(one([tab("a", FILE_A)]), target, {
      newId: () => "new",
      preview: true,
    });
    expect(paneState(result, "left")).toEqual({
      ids: ["a", "new"],
      activeId: "new",
      recent: ["a", "new"],
      previews: [false, false],
    });
    expectValid(result);
  });

  test.each([
    {
      name: "an explicit left pane",
      destination: "left" as const,
      expectedSide: "left" as const,
    },
    {
      name: "the other pane",
      destination: "other-if-split" as const,
      expectedSide: "left" as const,
    },
    {
      name: "the focused pane",
      destination: "focused" as const,
      expectedSide: "right" as const,
    },
  ])("opens in $name", ({ destination, expectedSide }) => {
    const start = two(
      pane([tab("a", FILE_A)]),
      pane([tab("b", IMAGE_B)]),
      "right",
    );
    const result = open(start, IMAGE_A, {
      newId: () => "image",
      pane: destination,
    });
    expect(result.focused).toBe(expectedSide);
    expect(paneAt(result, expectedSide)?.activeId).toBe("image");
    expectValid(result);
  });

  test("other-if-split uses the same pane when there is only one", () => {
    const result = open(one([tab("a", FILE_A)]), FILE_B, {
      newId: () => "b",
      pane: "other-if-split",
    });
    expect(paneState(result, "left")).toEqual({
      ids: ["a", "b"],
      activeId: "b",
      recent: ["a", "b"],
      previews: [false, true],
    });
    expectValid(result);
  });

  // 面を指定しないとき (フォーカスのある面) は、反対の面の同じものを前面に出す。
  // 面を指定したときはその面の中だけを探す (左右で同じファイルを開けるため)。
  test("activates an existing target across panes without allocating an id when no pane is given", () => {
    let calls = 0;
    const start = two(
      pane([tab("a", FILE_A)]),
      pane([tab("b", IMAGE_B), tab("image", IMAGE_A)], "b"),
    );
    const result = open(
      start,
      { kind: "image", path: "sample/alpha.png" },
      {
        newId: () => {
          calls += 1;
          return "unused";
        },
      },
    );
    expect(calls).toBe(0);
    expect(result.focused).toBe("right");
    expect(paneState(result, "right")).toEqual({
      ids: ["b", "image"],
      activeId: "image",
      recent: ["b", "image"],
      previews: [false, false],
    });
    expectValid(result);
  });

  test("refreshes an already active target without changing its value", () => {
    const start = one([tab("a", FILE_A)]);
    const result = open(start, FILE_A, { newId: () => "unused" });
    expect(result).toEqual(start);
    expect(result).not.toBe(start);
    expectValid(result);
  });

  test.each([
    { name: "empty id", id: "", message: "new tab id must be non-empty" },
    {
      name: "duplicate id",
      id: "a",
      message: 'new tab id already exists: "a"',
    },
  ])("rejects an injected $name", ({ id, message }) => {
    expect(() =>
      open(one([tab("a", FILE_A)]), FILE_B, { newId: () => id }),
    ).toThrow(message);
  });

  test("falls back to left when an explicit right pane does not exist", () => {
    const result = open(one([tab("a", FILE_A)]), FILE_B, {
      newId: () => "b",
      pane: "right",
    });
    expect(paneState(result, "left")).toEqual({
      ids: ["a", "b"],
      activeId: "b",
      recent: ["a", "b"],
      previews: [false, true],
    });
    expectValid(result);
  });
});

describe("main tabs contract: selection, focus, and previews", () => {
  test.each([
    {
      name: "keepOpen fixes a preview",
      run: (state: Layout) => keepOpen(state, "b"),
      activeId: "a",
      recent: ["a"],
      preview: false,
      same: false,
    },
    {
      name: "keepOpen ignores a fixed tab",
      run: (state: Layout) => keepOpen(state, "a"),
      activeId: "a",
      recent: ["a"],
      preview: true,
      same: true,
    },
    {
      name: "keepOpen ignores a missing tab",
      run: (state: Layout) => keepOpen(state, "missing"),
      activeId: "a",
      recent: ["a"],
      preview: true,
      same: true,
    },
    {
      name: "activate appends the selected tab to recent",
      run: (state: Layout) => activate(state, "b"),
      activeId: "b",
      recent: ["a", "b"],
      preview: true,
      same: false,
    },
    {
      name: "activate ignores a missing tab",
      run: (state: Layout) => activate(state, "missing"),
      activeId: "a",
      recent: ["a"],
      preview: true,
      same: true,
    },
  ])("$name", ({ run, activeId, recent, preview, same }) => {
    const start = one([tab("a", FILE_A), tab("b", FILE_B, true)]);
    const result = run(start);
    expect(paneAt(result, "left")?.activeId).toBe(activeId);
    expect(paneAt(result, "left")?.recent).toEqual(recent);
    expect(paneAt(result, "left")?.tabs[1]?.preview).toBe(preview);
    expect(result === start).toBe(same);
    expectValid(result);
  });

  test.each([
    {
      name: "focuses an existing pane",
      onePane: false,
      expected: "right" as const,
      same: false,
    },
    {
      name: "ignores a missing pane",
      onePane: true,
      expected: "left" as const,
      same: true,
    },
  ])("focusPane $name", ({ onePane, expected, same }) => {
    const start = onePane
      ? one([tab("a", FILE_A)])
      : two(pane([tab("a", FILE_A)]), pane([tab("b", IMAGE_B)]));
    const result = focusPane(start, "right");
    expect(result.focused).toBe(expected);
    expect(result === start).toBe(same);
    expectValid(result);
  });
});

describe("main tabs contract: close", () => {
  test.each([
    {
      name: "selects the previously active tab",
      start: one([tab("a", FILE_A), tab("b", FILE_B), tab("c", FILE_C)], "c", [
        "a",
        "b",
        "c",
      ]),
      id: "c",
      expected: {
        ids: ["a", "b"],
        activeId: "b",
        recent: ["a", "b"],
        previews: [false, false],
      },
      same: false,
    },
    {
      name: "falls back to the right neighbor",
      start: one([tab("a", FILE_A), tab("b", FILE_B), tab("c", FILE_C)], "a"),
      id: "a",
      expected: {
        ids: ["b", "c"],
        activeId: "b",
        recent: ["b"],
        previews: [false, false],
      },
      same: false,
    },
    {
      name: "falls back to the left neighbor",
      start: one([tab("a", FILE_A), tab("b", FILE_B), tab("c", FILE_C)], "c"),
      id: "c",
      expected: {
        ids: ["a", "b"],
        activeId: "b",
        recent: ["b"],
        previews: [false, false],
      },
      same: false,
    },
    {
      name: "keeps the active tab when closing a background tab",
      start: one([tab("a", FILE_A), tab("b", FILE_B), tab("c", FILE_C)], "a", [
        "b",
        "a",
      ]),
      id: "b",
      expected: {
        ids: ["a", "c"],
        activeId: "a",
        recent: ["a"],
        previews: [false, false],
      },
      same: false,
    },
    {
      name: "leaves an empty pane when closing the final tab",
      start: one([tab("a", FILE_A)]),
      id: "a",
      expected: { ids: [], activeId: null, recent: [], previews: [] },
      same: false,
    },
    {
      name: "ignores a missing tab",
      start: one([tab("a", FILE_A)]),
      id: "missing",
      expected: {
        ids: ["a"],
        activeId: "a",
        recent: ["a"],
        previews: [false],
      },
      same: true,
    },
  ])("$name", ({ start, id, expected, same }) => {
    const before = structuredClone(start);
    const result = close(start, id);
    expect(paneState(result, "left")).toEqual(expected);
    expect(result === start).toBe(same);
    expect(start).toEqual(before);
    expectValid(result);
  });

  test.each([
    {
      name: "removes an empty right pane",
      start: two(pane([tab("a", FILE_A)]), pane([tab("b", IMAGE_B)]), "right"),
      id: "b",
      expectedId: "a",
    },
  ])("$name", ({ start, id, expectedId }) => {
    const result = close(start, id);
    expect(result).toEqual({
      panes: {
        left: {
          tabs: [tab(expectedId, FILE_A)],
          activeId: expectedId,
          recent: [expectedId],
        },
      },
      focused: "left",
    });
    expectValid(result);
  });

  // 左の面は空でもよい (本文の既定を出す) ので、右の面を左へ寄せない。
  test("keeps the right pane when the left pane becomes empty", () => {
    const start = two(pane([tab("a", FILE_A)]), pane([tab("b", IMAGE_B)]));
    const result = close(start, "a");
    expect(result).toEqual({
      panes: {
        left: { tabs: [], activeId: null, recent: [] },
        right: { tabs: [tab("b", IMAGE_B)], activeId: "b", recent: ["b"] },
      },
      focused: "left",
    });
    expectValid(result);
  });
});

describe("main tabs contract: bulk close", () => {
  test.each([
    {
      name: "closeOthers keeps only the requested tab",
      start: one([tab("a", FILE_A), tab("b", FILE_B), tab("c", FILE_C)], "a", [
        "b",
        "a",
      ]),
      run: (state: Layout) => closeOthers(state, "b"),
      expected: {
        ids: ["b"],
        activeId: "b",
        recent: ["b"],
        previews: [false],
      },
      same: false,
    },
    {
      name: "closeOthers reselects a tab that is already alone",
      start: one([tab("a", FILE_A)]),
      run: (state: Layout) => closeOthers(state, "a"),
      expected: {
        ids: ["a"],
        activeId: "a",
        recent: ["a"],
        previews: [false],
      },
      same: false,
    },
    {
      name: "closeOthers ignores a missing tab",
      start: one([tab("a", FILE_A), tab("b", FILE_B), tab("c", FILE_C)]),
      run: (state: Layout) => closeOthers(state, "missing"),
      expected: {
        ids: ["a", "b", "c"],
        activeId: "a",
        recent: ["a"],
        previews: [false, false, false],
      },
      same: true,
    },
    {
      name: "closeToRight removes only following tabs",
      start: one([tab("a", FILE_A), tab("b", FILE_B), tab("c", FILE_C)], "a", [
        "b",
        "a",
      ]),
      run: (state: Layout) => closeToRight(state, "b"),
      expected: {
        ids: ["a", "b"],
        activeId: "a",
        recent: ["b", "a"],
        previews: [false, false],
      },
      same: false,
    },
    {
      name: "closeToRight is unchanged at the end",
      start: one([tab("a", FILE_A), tab("b", FILE_B), tab("c", FILE_C)]),
      run: (state: Layout) => closeToRight(state, "c"),
      expected: {
        ids: ["a", "b", "c"],
        activeId: "a",
        recent: ["a"],
        previews: [false, false, false],
      },
      same: true,
    },
    {
      name: "closeToRight ignores a missing tab",
      start: one([tab("a", FILE_A), tab("b", FILE_B), tab("c", FILE_C)]),
      run: (state: Layout) => closeToRight(state, "missing"),
      expected: {
        ids: ["a", "b", "c"],
        activeId: "a",
        recent: ["a"],
        previews: [false, false, false],
      },
      same: true,
    },
    {
      name: "closeToRight uses recent selection before a neighboring tab",
      start: one([tab("a", FILE_A), tab("b", FILE_B), tab("c", FILE_C)], "c", [
        "a",
        "c",
      ]),
      run: (state: Layout) => closeToRight(state, "b"),
      expected: {
        ids: ["a", "b"],
        activeId: "a",
        recent: ["a"],
        previews: [false, false],
      },
      same: false,
    },
  ])("$name", ({ start, run, expected, same }) => {
    const result = run(start);
    expect(paneState(result, "left")).toEqual(expected);
    expect(result === start).toBe(same);
    expectValid(result);
  });
});

describe("main tabs contract: move", () => {
  test("reorders a tab inside a pane", () => {
    const start = one([tab("a", FILE_A), tab("b", FILE_B), tab("c", FILE_C)]);
    const before = structuredClone(start);
    const result = move(start, "a", "left", 2);
    expect(result.moved).toBe(true);
    expect(paneState(result.layout, "left")).toEqual({
      ids: ["b", "c", "a"],
      activeId: "a",
      recent: ["a"],
      previews: [false, false, false],
    });
    expect(start).toEqual(before);
    expectValid(result.layout);
  });

  test("moves a tab across panes and activates the destination", () => {
    const start = two(
      pane([tab("a", FILE_A), tab("b", IMAGE_B)]),
      pane([tab("c", IMAGE_C)]),
    );
    const result = move(start, "b", "right", 0);
    expect(result.moved).toBe(true);
    expect(paneState(result.layout, "left")).toEqual({
      ids: ["a"],
      activeId: "a",
      recent: ["a"],
      previews: [false],
    });
    expect(paneState(result.layout, "right")).toEqual({
      ids: ["b", "c"],
      activeId: "b",
      recent: ["c", "b"],
      previews: [false, false],
    });
    expect(result.layout.focused).toBe("right");
    expectValid(result.layout);
  });

  test("keeps the destination preview fixed when moving another preview", () => {
    const start = two(
      pane([tab("a", FILE_A), tab("moving", IMAGE_B, true)]),
      pane(
        [tab("c", IMAGE_C), tab("old-preview", IMAGE_A, true)],
        "old-preview",
        ["c", "old-preview"],
      ),
    );
    const result = move(start, "moving", "right", 1);
    expect(result.moved).toBe(true);
    expect(paneState(result.layout, "right")).toEqual({
      ids: ["c", "moving", "old-preview"],
      activeId: "moving",
      recent: ["c", "old-preview", "moving"],
      previews: [false, true, false],
    });
    expectValid(result.layout);
  });

  test("collapses an emptied right pane", () => {
    const start = two(pane([tab("a", FILE_A)]), pane([tab("b", IMAGE_B)]));
    const result = move(start, "b", "left", 1);
    expect(result.moved).toBe(true);
    expect(result.layout.panes.right).toBeUndefined();
    expect(paneState(result.layout, "left")).toEqual({
      ids: ["a", "b"],
      activeId: "b",
      recent: ["a", "b"],
      previews: [false, false],
    });
    expectValid(result.layout);
  });

  test("keeps two panes when the left pane is emptied (the left shows its default body)", () => {
    const start = two(pane([tab("a", IMAGE_A)]), pane([tab("b", IMAGE_B)]));
    const result = move(start, "a", "right", 1);
    expect(result.moved).toBe(true);
    expect([
      paneState(result.layout, "left"),
      paneState(result.layout, "right"),
      result.layout.focused,
    ]).toEqual([
      { ids: [], activeId: null, recent: [], previews: [] },
      {
        ids: ["b", "a"],
        activeId: "a",
        recent: ["b", "a"],
        previews: [false, false],
      },
      "right",
    ]);
    expectValid(result.layout);
  });

  test("does not move a page into the right pane", () => {
    const start = two(
      pane([tab("a", FILE_A), tab("moving", PAGE_DIFF)]),
      pane([tab("c", IMAGE_C)]),
    );
    expect(move(start, "moving", "right", 0)).toEqual({
      moved: false,
      reason: "not-placeable",
      layout: start,
    });
  });

  test("moves a file into the right pane", () => {
    const start = two(
      pane([tab("a", FILE_A), tab("moving", FILE_B)]),
      pane([tab("c", IMAGE_C)]),
    );
    const result = move(start, "moving", "right", 0);
    expect([result.moved, paneState(result.layout, "right")?.ids]).toEqual([
      true,
      ["moving", "c"],
    ]);
    expectValid(result.layout);
  });

  test("does not move into a pane containing the same target", () => {
    const start = two(
      pane([tab("a", IMAGE_A)]),
      pane([tab("duplicate", { ...IMAGE_A })]),
    );
    expect(move(start, "a", "right", 0)).toEqual({
      moved: false,
      reason: "duplicate-target",
      layout: start,
    });
  });

  test.each([
    {
      name: "missing tab",
      id: "missing",
      side: "left" as const,
      reason: "unknown-tab",
    },
    {
      name: "missing pane",
      id: "a",
      side: "right" as const,
      reason: "no-such-pane",
    },
  ])("returns a reason for $name", ({ id, side, reason }) => {
    const start = one([tab("a", FILE_A), tab("b", FILE_B)]);
    expect(move(start, id, side, 0)).toEqual({
      moved: false,
      reason,
      layout: start,
    });
    expectValid(start);
  });

  // 数値でない位置を通すと Math.min / slice が黙って先頭へ入れ、呼び出し側は
  // 「意図した場所へ動いた」と区別できなかった。理由つきで断る。
  test.each([
    { name: "NaN", index: Number.NaN },
    { name: "undefined", index: undefined as unknown as number },
    { name: "a fraction", index: 0.5 },
    { name: "Infinity", index: Number.POSITIVE_INFINITY },
    { name: "-Infinity", index: Number.NEGATIVE_INFINITY },
    { name: "a numeric string", index: "1" as unknown as number },
  ])("rejects $name as the index without moving", ({ index }) => {
    const start = two(
      pane([tab("a", FILE_A), tab("b", FILE_B)]),
      pane([tab("c", TERMINAL_A)]),
    );
    for (const [id, side] of [
      ["a", "left"],
      ["c", "left"],
    ] as const) {
      const result = move(start, id, side, index);
      expect(result).toEqual({
        moved: false,
        reason: "invalid-index",
        layout: start,
      });
      expect(result.layout).toBe(start);
    }
  });

  test.each([
    { name: "the same position", index: 0 },
    { name: "a negative index", index: -3 },
  ])("accepts $name as a clamped reorder", ({ index }) => {
    const start = one([tab("a", FILE_A), tab("b", FILE_B)]);
    const result = move(start, "a", "left", index);
    expect(result.moved).toBe(true);
    expect(paneState(result.layout, "left")).toEqual({
      ids: ["a", "b"],
      activeId: "a",
      recent: ["a"],
      previews: [false, false],
    });
    expectValid(result.layout);
  });
});

describe("main tabs contract: split and other side", () => {
  test("splitRight moves a tab into a new right pane", () => {
    const result = splitRight(one([tab("a", FILE_A), tab("b", IMAGE_B)]), "b");
    expect(paneState(result, "left")).toEqual({
      ids: ["a"],
      activeId: "a",
      recent: ["a"],
      previews: [false],
    });
    expect(paneState(result, "right")).toEqual({
      ids: ["b"],
      activeId: "b",
      recent: ["b"],
      previews: [false],
    });
    expect(result.focused).toBe("right");
    expectValid(result);
  });

  test("splitRight leaves a page in one pane (pages stay on the left)", () => {
    const start = one([tab("a", FILE_A), tab("b", PAGE_DIFF)]);
    const result = splitRight(start, "b");
    expect(result).toBe(start);
    expectValid(result);
  });

  test("splitRight moves a file into a new right pane", () => {
    const result = splitRight(one([tab("a", FILE_A), tab("b", FILE_B)]), "b");
    expect([
      paneState(result, "left")?.ids,
      paneState(result, "right")?.ids,
      result.focused,
    ]).toEqual([["a"], ["b"], "right"]);
    expectValid(result);
  });

  test("splitRight of a sole terminal leaves the left pane empty (its default body)", () => {
    const result = splitRight(one([tab("t", TERMINAL_A)]), "t");
    expect([
      paneState(result, "left"),
      paneState(result, "right")?.ids,
      result.focused,
    ]).toEqual([
      { ids: [], activeId: null, recent: [], previews: [] },
      ["t"],
      "right",
    ]);
    expectValid(result);
  });

  test.each([
    {
      name: "an already split layout",
      start: two(pane([tab("a", FILE_A)]), pane([tab("b", IMAGE_B)])),
      id: "a",
    },
    {
      name: "a missing tab",
      start: one([tab("a", FILE_A)]),
      id: "missing",
    },
  ])("splitRight ignores $name", ({ start, id }) => {
    const result = splitRight(start, id);
    expect(result).toBe(start);
    expectValid(result);
  });

  test("moveToOtherSide moves and activates the tab", () => {
    const result = moveToOtherSide(
      two(
        pane([tab("a", FILE_A), tab("b", IMAGE_B)]),
        pane([tab("c", IMAGE_C)]),
      ),
      "b",
    );
    expect(paneState(result, "left")?.ids).toEqual(["a"]);
    expect(paneState(result, "right")).toEqual({
      ids: ["c", "b"],
      activeId: "b",
      recent: ["c", "b"],
      previews: [false, false],
    });
    expect(result.focused).toBe("right");
    expectValid(result);
  });

  test("moveToOtherSide collapses an emptied right pane", () => {
    const result = moveToOtherSide(
      two(pane([tab("a", FILE_A)]), pane([tab("b", IMAGE_B)])),
      "b",
    );
    expect(result.panes.right).toBeUndefined();
    expect(paneState(result, "left")).toEqual({
      ids: ["a", "b"],
      activeId: "b",
      recent: ["a", "b"],
      previews: [false, false],
    });
    expectValid(result);
  });

  test("moveToOtherSide leaves a page tab on the left", () => {
    const start = two(pane([tab("a", PAGE_DIFF)]), pane([tab("b", IMAGE_B)]));
    const result = moveToOtherSide(start, "a");
    expect(result).toBe(start);
    expectValid(result);
  });

  test("moveToOtherSide moves a file tab to the right", () => {
    const result = moveToOtherSide(
      two(pane([tab("a", FILE_A)]), pane([tab("b", IMAGE_B)])),
      "a",
    );
    expect([
      paneState(result, "left")?.ids,
      paneState(result, "right")?.ids,
    ]).toEqual([[], ["b", "a"]]);
    expectValid(result);
  });

  test.each([
    {
      name: "one pane",
      start: one([tab("a", FILE_A)]),
      id: "a",
    },
    {
      name: "a missing tab",
      start: two(pane([tab("a", FILE_A)]), pane([tab("b", IMAGE_B)])),
      id: "missing",
    },
  ])("moveToOtherSide ignores $name", ({ start, id }) => {
    const result = moveToOtherSide(start, id);
    expect(result).toBe(start);
    expectValid(result);
  });

  test.each([
    {
      name: "one pane",
      state: one([]),
      split: true,
      moveToOther: false,
    },
    {
      name: "two panes",
      state: two(pane([]), pane([])),
      split: false,
      moveToOther: true,
    },
  ])("reports capabilities for $name", ({ state, split, moveToOther }) => {
    expect(canSplit(state)).toBe(split);
    expect(canMoveToOtherSide(state)).toBe(moveToOther);
  });
});

describe("main tabs contract: keyboard selection", () => {
  test.each([
    {
      name: "next selects the following tab",
      run: nextTab,
      active: "a",
      expected: "b",
    },
    { name: "next wraps at the end", run: nextTab, active: "c", expected: "a" },
    {
      name: "previous selects the preceding tab",
      run: prevTab,
      active: "b",
      expected: "a",
    },
    {
      name: "previous wraps at the start",
      run: prevTab,
      active: "a",
      expected: "c",
    },
  ])("$name", ({ run, active, expected }) => {
    const result = run(
      one([tab("a", FILE_A), tab("b", FILE_B), tab("c", FILE_C)], active),
    );
    expect(paneAt(result, "left")?.activeId).toBe(expected);
    expectValid(result);
  });

  test.each([
    { name: "an empty pane with next", run: nextTab },
    { name: "an empty pane with previous", run: prevTab },
  ])("leaves $name unchanged", ({ run }) => {
    const start = one([]);
    const result = run(start);
    expect(result).toBe(start);
    expectValid(result);
  });

  test.each([
    { name: "the first tab", index: 1, expected: "a", same: false },
    { name: "the final tab", index: 3, expected: "c", same: false },
    { name: "zero", index: 0, expected: "a", same: true },
    { name: "an index past the end", index: 4, expected: "a", same: true },
  ])("activateIndex handles $name", ({ index, expected, same }) => {
    const start = one([tab("a", FILE_A), tab("b", FILE_B), tab("c", FILE_C)]);
    const result = activateIndex(start, index);
    expect(paneAt(result, "left")?.activeId).toBe(expected);
    expect(result === start).toBe(same);
    expectValid(result);
  });

  test("keyboard operations use only the focused pane", () => {
    const result = nextTab(
      two(
        pane([tab("a", FILE_A), tab("b", FILE_B)]),
        pane([tab("c", IMAGE_C), tab("image", IMAGE_A)]),
        "right",
      ),
    );
    expect(paneAt(result, "left")?.activeId).toBe("a");
    expect(paneState(result, "right")).toEqual({
      ids: ["c", "image"],
      activeId: "image",
      recent: ["c", "image"],
      previews: [false, false],
    });
    expectValid(result);
  });
});

describe("main tabs contract: tabMenu", () => {
  test.each([
    {
      name: "a preview file in one pane",
      state: one([tab("a", FILE_A), tab("b", FILE_B, true)]),
      id: "b",
      expected: {
        close: true,
        closeOthers: true,
        closeToRight: false,
        keepOpen: true,
        splitRight: true,
        moveToOtherSide: false,
        copyPath: true,
      },
    },
    {
      name: "a preview image in one pane",
      state: one([tab("a", FILE_A), tab("b", IMAGE_B, true)]),
      id: "b",
      expected: {
        close: true,
        closeOthers: true,
        closeToRight: false,
        keepOpen: true,
        splitRight: true,
        moveToOtherSide: false,
        copyPath: true,
      },
    },
    {
      name: "a fixed page in two panes",
      state: two(
        pane([tab("a", PAGE_DIFF), tab("b", FILE_B)]),
        pane([tab("c", IMAGE_C)]),
      ),
      id: "a",
      expected: {
        close: true,
        closeOthers: true,
        closeToRight: true,
        keepOpen: false,
        splitRight: false,
        moveToOtherSide: false,
        copyPath: false,
      },
    },
    {
      name: "a terminal in two panes",
      state: two(
        pane([tab("a", PAGE_DIFF), tab("t", TERMINAL_A)]),
        pane([tab("c", IMAGE_C)]),
      ),
      id: "t",
      expected: {
        close: true,
        closeOthers: true,
        closeToRight: false,
        keepOpen: false,
        splitRight: false,
        moveToOtherSide: true,
        copyPath: false,
      },
    },
    {
      name: "a sole image path",
      state: one([tab("image", IMAGE_A)]),
      id: "image",
      expected: {
        close: true,
        closeOthers: false,
        closeToRight: false,
        keepOpen: false,
        splitRight: true,
        moveToOtherSide: false,
        copyPath: true,
      },
    },
    {
      name: "a missing tab",
      state: one([tab("a", FILE_A)]),
      id: "missing",
      expected: {
        close: false,
        closeOthers: false,
        closeToRight: false,
        keepOpen: false,
        splitRight: false,
        moveToOtherSide: false,
        copyPath: false,
      },
    },
  ])("enables actions for $name", ({ state, id, expected }) => {
    expect(tabMenu(state, id)).toEqual(expected);
  });
});

describe("main tabs contract: operation purity and invariants", () => {
  test.each([
    {
      name: "open",
      start: one([tab("a", FILE_A)]),
      run: (state: Layout) => open(state, FILE_B, { newId: () => "new" }),
    },
    {
      name: "keepOpen",
      start: one([tab("a", FILE_A, true)]),
      run: (state: Layout) => keepOpen(state, "a"),
    },
    {
      name: "activate",
      start: one([tab("a", FILE_A), tab("b", FILE_B)]),
      run: (state: Layout) => activate(state, "b"),
    },
    {
      name: "focusPane",
      start: two(pane([tab("a", FILE_A)]), pane([tab("b", IMAGE_B)])),
      run: (state: Layout) => focusPane(state, "right"),
    },
    {
      name: "close",
      start: one([tab("a", FILE_A), tab("b", FILE_B)]),
      run: (state: Layout) => close(state, "a"),
    },
    {
      name: "closeOthers",
      start: one([tab("a", FILE_A), tab("b", FILE_B)]),
      run: (state: Layout) => closeOthers(state, "a"),
    },
    {
      name: "closeToRight",
      start: one([tab("a", FILE_A), tab("b", FILE_B)]),
      run: (state: Layout) => closeToRight(state, "a"),
    },
    {
      name: "move",
      start: one([tab("a", FILE_A), tab("b", FILE_B)]),
      run: (state: Layout) => move(state, "a", "left", 1).layout,
    },
    {
      name: "splitRight",
      start: one([tab("a", FILE_A), tab("b", IMAGE_B)]),
      run: (state: Layout) => splitRight(state, "b"),
    },
    {
      name: "moveToOtherSide",
      start: two(
        pane([tab("a", FILE_A), tab("b", IMAGE_B)]),
        pane([tab("c", IMAGE_C)]),
      ),
      run: (state: Layout) => moveToOtherSide(state, "b"),
    },
    {
      name: "showHome",
      start: two(pane([tab("a", FILE_A)]), pane([tab("b", IMAGE_B)]), "right"),
      run: showHome,
    },
    {
      name: "nextTab",
      start: one([tab("a", FILE_A), tab("b", FILE_B)]),
      run: nextTab,
    },
    {
      name: "prevTab",
      start: one([tab("a", FILE_A), tab("b", FILE_B)]),
      run: prevTab,
    },
    {
      name: "activateIndex",
      start: one([tab("a", FILE_A), tab("b", FILE_B)]),
      run: (state: Layout) => activateIndex(state, 2),
    },
  ])("$name leaves its input untouched and preserves invariants", ({
    start,
    run,
  }) => {
    const before = structuredClone(start);
    const result = run(start);
    expect(start).toEqual(before);
    expectValid(result);
  });
});

describe("main tabs contract: persistence", () => {
  test("serializes and parses a versioned independent copy", () => {
    const state = two(
      pane(
        [
          tab("file", {
            kind: "file",
            path: "sample/alpha.ts",
            line: { start: 3, end: 8 },
          }),
          tab("page", PAGE_DIFF),
        ],
        "page",
        ["file", "page"],
      ),
      pane(
        [tab("terminal", TERMINAL_A), tab("image", IMAGE_A, true)],
        "image",
        ["terminal", "image"],
      ),
      "right",
    );
    const serialized = serializeLayout(state);
    const parsed = parseLayout(JSON.parse(JSON.stringify(serialized)));
    expect(serialized).toEqual({
      version: 3,
      focused: "right",
      panes: [
        {
          side: "left",
          activeId: "page",
          tabs: [
            {
              id: "file",
              preview: false,
              target: {
                kind: "file",
                path: "sample/alpha.ts",
                line: { start: 3, end: 8 },
              },
            },
            { id: "page", preview: false, target: PAGE_DIFF },
          ],
        },
        {
          side: "right",
          activeId: "image",
          tabs: [
            { id: "terminal", preview: false, target: TERMINAL_A },
            { id: "image", preview: true, target: IMAGE_A },
          ],
        },
      ],
    });
    expect(parsed.dropped).toEqual([]);
    expect(paneAt(parsed.layout, "left")?.recent).toEqual(["page"]);
    expect(paneAt(parsed.layout, "right")?.recent).toEqual(["image"]);
    expect(parsed.layout).not.toBe(state);
    expect(parsed.layout.panes.left.tabs[0]).not.toBe(state.panes.left.tabs[0]);
    expectValid(parsed.layout);
  });

  test("drops unknown targets and repairs the active reference", () => {
    const unknown = {
      id: "future",
      target: { kind: "future-view", value: 3 },
      preview: false,
    };
    const parsed = parseLayout({
      version: 1,
      focused: "left",
      panes: [
        {
          side: "left",
          tabs: [unknown, { id: "file", target: FILE_A, preview: false }],
          activeId: "future",
        },
      ],
    });
    expect(parsed.dropped).toEqual([{ at: "panes[0].tabs[0]", raw: unknown }]);
    expect(paneState(parsed.layout, "left")).toEqual({
      ids: ["file"],
      activeId: "file",
      recent: ["file"],
      previews: [false],
    });
    expectValid(parsed.layout);
  });

  test.each([
    {
      name: "a different version",
      raw: {
        version: 0,
        focused: "left",
        panes: [{ side: "left", activeId: null, tabs: [] }],
      },
      message:
        "main tab layout is broken (1 problem):\n- version is 0, expected one of 1, 2, 3",
    },
    {
      name: "three panes",
      raw: {
        version: 1,
        focused: "left",
        panes: [
          { side: "left", activeId: null, tabs: [] },
          { side: "right", activeId: null, tabs: [] },
          { side: "right", activeId: null, tabs: [] },
        ],
      },
      message:
        "main tab layout is broken (1 problem):\n- panes has 3 entries (1 or 2 allowed)",
    },
    {
      name: "an active id outside its pane",
      raw: {
        version: 1,
        focused: "left",
        panes: [
          {
            side: "left",
            activeId: "missing",
            tabs: [{ id: "a", target: FILE_A, preview: false }],
          },
        ],
      },
      message:
        'main tab layout is broken (1 problem):\n- panes[0].activeId "missing" is not a tab of the pane',
    },
    {
      name: "two previews in one pane",
      raw: {
        version: 1,
        focused: "left",
        panes: [
          {
            side: "left",
            activeId: "a",
            tabs: [
              { id: "a", target: FILE_A, preview: true },
              { id: "b", target: FILE_B, preview: true },
            ],
          },
        ],
      },
      message:
        "main tab layout is broken (1 problem):\n- panes[0] has 2 preview tabs (a, b); at most 1",
    },
    {
      name: "the same page twice",
      raw: {
        version: 1,
        focused: "left",
        panes: [
          {
            side: "left",
            activeId: "page-a",
            tabs: [{ id: "page-a", target: PAGE_DIFF, preview: false }],
          },
          {
            side: "right",
            activeId: "page-b",
            tabs: [{ id: "page-b", target: PAGE_DIFF, preview: false }],
          },
        ],
      },
      message:
        'main tab layout is broken (1 problem):\n- panes[1].tabs[0]: page {"kind":"page","page":"diff"} is also open at panes[0].tabs[0]',
    },
    {
      name: "duplicate ids across panes",
      raw: {
        version: 1,
        focused: "left",
        panes: [
          {
            side: "left",
            activeId: "same",
            tabs: [{ id: "same", target: FILE_A, preview: false }],
          },
          {
            side: "right",
            activeId: "same",
            tabs: [{ id: "same", target: FILE_B, preview: false }],
          },
        ],
      },
      message:
        'main tab layout is broken (1 problem):\n- panes[1].tabs[0]: id "same" is also used at panes[0].tabs[0]',
    },
    {
      name: "a terminal without a session",
      raw: {
        version: 1,
        focused: "left",
        panes: [
          {
            side: "left",
            activeId: null,
            tabs: [
              {
                id: "terminal",
                target: { kind: "terminal" },
                preview: false,
              },
            ],
          },
        ],
      },
      message:
        "main tab layout is broken (1 problem):\n- panes[0].tabs[0]: terminal target has no session",
    },
  ])("rejects $name with its complete reason", ({ raw, message }) => {
    expect(thrownMessage(() => parseLayout(raw))).toBe(message);
  });

  test("reports every independent corruption in one error", () => {
    const raw = {
      version: 7,
      focused: "middle",
      panes: [
        {
          side: "left",
          tabs: [
            { id: "same", target: FILE_A, preview: true },
            { id: "same", target: FILE_B, preview: true },
            { id: "page-a", target: PAGE_DIFF, preview: false },
            { id: "page-b", target: PAGE_DIFF, preview: false },
            { id: "bad", target: { kind: "file" }, preview: false },
          ],
          activeId: "missing",
        },
      ],
    };
    expect(thrownMessage(() => parseLayout(raw))).toBe(
      'main tab layout is broken (7 problems):\n- version is 7, expected one of 1, 2, 3\n- focused is "middle"\n- panes[0].tabs[1]: id "same" is also used at panes[0].tabs[0]\n- panes[0].tabs[3]: page {"kind":"page","page":"diff"} is also open at panes[0].tabs[2]\n- panes[0].tabs[4]: file target has no path\n- panes[0] has 2 preview tabs (same, same); at most 1\n- panes[0].activeId "missing" is not a tab of the pane',
    );
  });
});
