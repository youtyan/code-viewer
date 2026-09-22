// メインの面のタブの配置を、全部の操作と保存 → 読み戻しを混ぜた乱数の列で
// 壊しに行く。1 手ごとに assertLayout と、この配置が暗に持つ約束 (比は 2 面の
// ときだけ・recent は面にあるタブだけ・保存して読み戻すと同じ配置) を見る。
// シードは固定 (落ちたらシードと手の列がそのまま再現手順になる)。

import { describe, expect, test } from "vitest";
import { errorWithCause } from "../core/error-detail";
import {
  activate,
  activateIndex,
  assertLayout,
  close,
  closeOthers,
  closeToRight,
  emptyLayout,
  focusPane,
  keepOpen,
  type Layout,
  move,
  moveToOtherSide,
  nextTab,
  open,
  openRight,
  PAGE_KINDS,
  type PaneSide,
  parkRight,
  parseLayout,
  prevTab,
  serializeLayout,
  setSplit,
  showHome,
  splitRight,
  type TabTarget,
  unparkRight,
} from "../core/main-tabs";

/** 小さな線形合同法 (再現のためだけ。質は要らない)。 */
function rng(seed: number) {
  let state = seed >>> 0;
  return (n: number) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state % n;
  };
}

const TARGETS: TabTarget[] = [
  { kind: "file", path: "src/a.ts" },
  { kind: "file", path: "src/a.ts", line: 3 },
  { kind: "file", path: "src/b.ts" },
  { kind: "file", path: "docs/c.md", line: { start: 2, end: 4 } },
  { kind: "image", path: "img/d.png" },
  { kind: "terminal", session: "shell-1" },
  { kind: "terminal", session: "shell-2" },
  ...PAGE_KINDS.slice(0, 4).map((page) => ({ kind: "page" as const, page })),
];

const PANES = [
  undefined,
  "focused",
  "left",
  "right",
  "other-if-split",
] as const;

function allIds(layout: Layout): string[] {
  return [...layout.panes.left.tabs, ...(layout.panes.right?.tabs ?? [])].map(
    (tab) => tab.id,
  );
}

type Step = { name: string; apply: (layout: Layout) => Layout };

function randomStep(pick: (n: number) => number, layout: Layout): Step {
  const ids = allIds(layout);
  const id = ids.length > 0 ? ids[pick(ids.length)] : "missing";
  const side: PaneSide = pick(2) === 0 ? "left" : "right";
  const target = TARGETS[pick(TARGETS.length)];
  const pane = PANES[pick(PANES.length)];
  const preview = pick(2) === 0;
  const index = pick(6);
  const steps: Step[] = [
    {
      name: `open ${JSON.stringify(target)} pane=${pane} preview=${preview}`,
      apply: (l) => open(l, target, { pane, preview }),
    },
    {
      name: `openRight ${JSON.stringify(target)} preview=${preview}`,
      apply: (l) => openRight(l, target, { preview }),
    },
    { name: `close ${id}`, apply: (l) => close(l, id) },
    { name: `closeOthers ${id}`, apply: (l) => closeOthers(l, id) },
    { name: `closeToRight ${id}`, apply: (l) => closeToRight(l, id) },
    {
      name: `move ${id} ${side} ${index}`,
      apply: (l) => move(l, id, side, index).layout,
    },
    { name: `splitRight ${id}`, apply: (l) => splitRight(l, id) },
    { name: `moveToOtherSide ${id}`, apply: (l) => moveToOtherSide(l, id) },
    { name: "showHome", apply: (l) => showHome(l) },
    { name: `activate ${id}`, apply: (l) => activate(l, id) },
    { name: `keepOpen ${id}`, apply: (l) => keepOpen(l, id) },
    { name: "nextTab", apply: (l) => nextTab(l) },
    { name: "prevTab", apply: (l) => prevTab(l) },
    { name: `activateIndex ${index}`, apply: (l) => activateIndex(l, index) },
    { name: `focusPane ${side}`, apply: (l) => focusPane(l, side) },
    {
      name: `setSplit 0.${index + 2}`,
      apply: (l) => setSplit(l, (index + 2) / 10),
    },
    {
      // 窓が狭い間: 右の面を預け、左で開いてから戻す (main-tabs-view.ts)。
      name: `park, open ${JSON.stringify(target)} on the left, unpark`,
      apply: (l) => {
        const { layout: parked, parked: stash } = parkRight(l);
        const opened = open(parked, target, { preview });
        return stash ? unparkRight(opened, stash) : opened;
      },
    },
    {
      name: "save and read back",
      apply: (l) =>
        parseLayout(JSON.parse(JSON.stringify(serializeLayout(l)))).layout,
    },
  ];
  return steps[pick(steps.length)];
}

/** assertLayout が見ていない約束。 */
function extraProblems(layout: Layout): string[] {
  const problems: string[] = [];
  if (!!layout.panes.right !== (layout.split !== undefined))
    problems.push(
      `split is ${layout.split} while the layout has ${layout.panes.right ? 2 : 1} pane(s)`,
    );
  for (const [side, pane] of [
    ["left", layout.panes.left],
    ["right", layout.panes.right],
  ] as const) {
    if (!pane) continue;
    for (const id of pane.recent)
      if (!pane.tabs.some((tab) => tab.id === id))
        problems.push(`${side}.recent has ${id}, which is not in the pane`);
  }
  const reread = parseLayout(
    JSON.parse(JSON.stringify(serializeLayout(layout))),
  ).layout;
  const shape = (l: Layout) =>
    JSON.stringify({
      focused: l.focused,
      split: l.split,
      left: [l.panes.left.activeId, l.panes.left.tabs],
      right: l.panes.right && [l.panes.right.activeId, l.panes.right.tabs],
    });
  if (shape(reread) !== shape(layout))
    problems.push(
      `save and read back changed the layout:\n  ${shape(layout)}\n→ ${shape(reread)}`,
    );
  return problems;
}

describe("main tab layout under random operation sequences", () => {
  test.each(
    Array.from({ length: 100 }, (_, seed) => seed + 1),
  )("seed %i keeps every invariant for 60 steps", (seed) => {
    const pick = rng(seed);
    let layout = emptyLayout();
    const history: string[] = [];
    for (let step = 0; step < 60; step++) {
      const next = randomStep(pick, layout);
      history.push(next.name);
      try {
        layout = next.apply(layout);
        assertLayout(layout);
        const extra = extraProblems(layout);
        if (extra.length > 0) throw new Error(extra.join("\n"));
      } catch (error) {
        throw errorWithCause(
          `seed ${seed}, step ${step + 1}:\n${history.map((s, i) => `  ${i + 1}. ${s}`).join("\n")}`,
          error,
        );
      }
    }
    expect(history).toHaveLength(60);
  });

  // どの配置の途中でも、数値でない位置の move は配置に触らず理由を返す
  // (黙って先頭へ入れない)。
  test.each(
    Array.from({ length: 20 }, (_, seed) => seed + 1),
  )("seed %i: a move with a non-numeric index never changes the layout", (seed) => {
    const pick = rng(seed);
    const badIndexes = [
      Number.NaN,
      undefined as unknown as number,
      1.5,
      Number.POSITIVE_INFINITY,
    ];
    let layout = emptyLayout();
    for (let step = 0; step < 60; step++) {
      layout = randomStep(pick, layout).apply(layout);
      const ids = allIds(layout);
      if (ids.length === 0) continue;
      const id = ids[pick(ids.length)];
      const side: PaneSide = pick(2) === 0 ? "left" : "right";
      const index = badIndexes[pick(badIndexes.length)];
      const result = move(layout, id, side, index);
      expect(result, `seed ${seed}, step ${step + 1}, index ${index}`).toEqual({
        moved: false,
        reason: "invalid-index",
        layout,
      });
      expect(result.layout).toBe(layout);
    }
  });
});
