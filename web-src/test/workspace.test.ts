// 窓の面の木 (core/workspace.ts): 分ける・閉じる・比・場所・隣の面・保存の形・
// 前の版の配置からの移し替え。

import { describe, expect, test } from "vitest";
import { LAYOUT_VERSION, type SerializedLayout } from "../core/main-tabs";
import {
  closePane,
  dropZoneAt,
  freshPaneId,
  MIN_PANE_HEIGHT,
  MIN_PANE_WIDTH,
  migrateLayout,
  neighborPane,
  PANE_DIVIDER,
  type PaneNode,
  paneIds,
  paneRects,
  panesFit,
  parseWorkspace,
  routeUrl,
  setRatio,
  singlePane,
  splitPane,
  stepPane,
  type Workspace,
} from "../core/workspace";

const entry = (url: string) => ({ url, layout: null });

/** p1 | (p2 / p3): 左右に分け、右をさらに上下に分けた窓。 */
function threePanes(): Workspace {
  let ws = singlePane("p1", "/a");
  ws = splitPane(ws, "p1", "row", "p2", entry("/b"));
  ws = splitPane(ws, "p2", "column", "p3", entry("/c"));
  return ws;
}

describe("splitPane / closePane", () => {
  test("分けると新しい面が右 (下) に入り、フォーカスが移る", () => {
    const ws = threePanes();
    expect({
      tree: ws.tree,
      focused: ws.focused,
      ids: paneIds(ws.tree),
    }).toEqual({
      tree: {
        dir: "row",
        ratio: 0.5,
        a: { pane: "p1" },
        b: {
          dir: "column",
          ratio: 0.5,
          a: { pane: "p2" },
          b: { pane: "p3" },
        },
      },
      focused: "p3",
      ids: ["p1", "p2", "p3"],
    });
  });

  test.each([
    {
      name: "下の面を閉じると上の面が右の場所に入る",
      close: "p3",
      tree: { dir: "row", ratio: 0.5, a: { pane: "p1" }, b: { pane: "p2" } },
      focused: "p2",
    },
    {
      name: "左の面を閉じると右の上下が窓の全部になる",
      close: "p1",
      tree: { dir: "column", ratio: 0.5, a: { pane: "p2" }, b: { pane: "p3" } },
      focused: "p3",
    },
  ])("$name", ({ close, tree, focused }) => {
    const ws = closePane(threePanes(), close);
    expect({
      tree: ws.tree,
      focused: ws.focused,
      panes: Object.keys(ws.panes),
    }).toEqual({
      tree,
      focused,
      panes: ["p1", "p2", "p3"].filter((id) => id !== close),
    });
  });

  test("before なら新しい面を前 (左・上) に置く", () => {
    const ws = splitPane(
      singlePane("p1", "/a"),
      "p1",
      "column",
      "p2",
      entry("/b"),
      true,
    );
    expect(ws.tree).toEqual({
      dir: "column",
      ratio: 0.5,
      a: { pane: "p2" },
      b: { pane: "p1" },
    });
  });

  test("フォーカスのある面を閉じると、残った側の最初の面へ移る", () => {
    const ws = closePane({ ...threePanes(), focused: "p1" }, "p1");
    expect(ws.focused).toBe("p2");
  });

  test("最後の 1 つは閉じない", () => {
    const ws = singlePane("p1", "/a");
    expect(closePane(ws, "p1")).toBe(ws);
  });

  test.each([
    {
      name: "無い面は分けない",
      target: "p9",
      id: "p2",
      error: 'split: no pane "p9"',
    },
    {
      name: "同じ id の面は作らない",
      target: "p1",
      id: "p1",
      error: 'split: pane "p1" already exists',
    },
  ])("$name", ({ target, id, error }) => {
    expect(() =>
      splitPane(singlePane("p1", "/a"), target, "row", id, entry("/b")),
    ).toThrow(error);
  });

  test("freshPaneId は空いている一番小さい番号", () => {
    const ws = closePane(threePanes(), "p2");
    expect(freshPaneId(ws)).toBe("p2");
  });
});

describe("setRatio", () => {
  test.each([
    { name: "中の値はそのまま", ratio: 0.3, expected: 0.3 },
    { name: "境界: 0.1 は下限", ratio: 0.1, expected: 0.1 },
    { name: "下限より小さいと 0.1", ratio: 0.05, expected: 0.1 },
    { name: "上限より大きいと 0.9", ratio: 0.95, expected: 0.9 },
  ])("$name", ({ ratio, expected }) => {
    const ws = setRatio(threePanes(), ["b"], ratio);
    expect(ws.tree).toEqual({
      dir: "row",
      ratio: 0.5,
      a: { pane: "p1" },
      b: {
        dir: "column",
        ratio: expected,
        a: { pane: "p2" },
        b: { pane: "p3" },
      },
    });
  });

  test("面を指す道は投げる", () => {
    expect(() => setRatio(threePanes(), ["a"], 0.3)).toThrow(
      "setRatio: a is not a split",
    );
  });
});

describe("paneRects", () => {
  test("比と境界の太さで分ける", () => {
    const layout = paneRects(threePanes().tree, {
      x: 0,
      y: 0,
      width: 1004,
      height: 604,
    });
    expect(layout).toEqual({
      panes: [
        { id: "p1", rect: { x: 0, y: 0, width: 500, height: 604 } },
        { id: "p2", rect: { x: 504, y: 0, width: 500, height: 300 } },
        { id: "p3", rect: { x: 504, y: 304, width: 500, height: 300 } },
      ],
      dividers: [
        {
          path: [],
          dir: "row",
          rect: { x: 500, y: 0, width: PANE_DIVIDER, height: 604 },
          span: { x: 0, y: 0, width: 1004, height: 604 },
        },
        {
          path: ["b"],
          dir: "column",
          rect: { x: 504, y: 300, width: 500, height: PANE_DIVIDER },
          span: { x: 504, y: 0, width: 500, height: 604 },
        },
      ],
    });
  });

  test.each([
    {
      name: "境界: 2 面がちょうど最小の幅なら並ぶ",
      width: MIN_PANE_WIDTH * 2 + PANE_DIVIDER,
      height: MIN_PANE_HEIGHT,
      fits: true,
    },
    {
      name: "境界: 1px 狭いと並ばない",
      width: MIN_PANE_WIDTH * 2 + PANE_DIVIDER - 1,
      height: MIN_PANE_HEIGHT,
      fits: false,
    },
    {
      name: "境界: 高さが最小より 1px 低いと並ばない",
      width: 2000,
      height: MIN_PANE_HEIGHT - 1,
      fits: false,
    },
  ])("panesFit: $name", ({ width, height, fits }) => {
    const tree: PaneNode = {
      dir: "row",
      ratio: 0.5,
      a: { pane: "p1" },
      b: { pane: "p2" },
    };
    expect(panesFit(tree, { x: 0, y: 0, width, height })).toBe(fits);
  });
});

describe("neighborPane / stepPane", () => {
  test.each([
    { from: "p1", direction: "right", expected: "p2" },
    { from: "p3", direction: "left", expected: "p1" },
    { from: "p2", direction: "down", expected: "p3" },
    { from: "p3", direction: "up", expected: "p2" },
    { from: "p1", direction: "left", expected: null },
    { from: "p2", direction: "up", expected: null },
  ] as const)(
    "$from の $direction は $expected",
    ({ from, direction, expected }) => {
      expect(neighborPane(threePanes().tree, from, direction)).toBe(expected);
    },
  );

  test.each([
    { from: "p1", delta: 1, expected: "p2" },
    { from: "p3", delta: 1, expected: "p1" },
    { from: "p1", delta: -1, expected: "p3" },
  ] as const)(
    "stepPane $from $delta → $expected",
    ({ from, delta, expected }) => {
      expect(stepPane(threePanes().tree, from, delta)).toBe(expected);
    },
  );
});

describe("parseWorkspace", () => {
  test("保存した値を読み戻すと同じ", () => {
    const ws = threePanes();
    expect(parseWorkspace(JSON.parse(JSON.stringify(ws)))).toEqual(ws);
  });

  test.each([
    {
      name: "版が違う",
      raw: { ...threePanes(), version: 5 },
      problem: "version is 5, expected 6",
    },
    {
      name: "比が 0..1 の外",
      raw: {
        ...threePanes(),
        tree: { dir: "row", ratio: 1, a: { pane: "p1" }, b: { pane: "p2" } },
        panes: { p1: entry("/a"), p2: entry("/b") },
        focused: "p1",
      },
      problem: "tree.ratio is 1",
    },
    {
      name: "同じ面が 2 度",
      raw: {
        ...threePanes(),
        tree: { dir: "row", ratio: 0.5, a: { pane: "p1" }, b: { pane: "p1" } },
        panes: { p1: entry("/a") },
        focused: "p1",
      },
      problem: 'tree.b: pane "p1" appears twice',
    },
    {
      name: "木に無い面の保存",
      raw: {
        ...singlePane("p1", "/a"),
        panes: { p1: entry("/a"), p2: entry("/b") },
      },
      problem: "panes.p2 is not in the tree",
    },
    {
      name: "保存の無い面",
      raw: { ...threePanes(), panes: { p1: entry("/a"), p2: entry("/b") } },
      problem: 'the tree has pane "p3" without an entry',
    },
    {
      name: "フォーカスが木に無い",
      raw: { ...threePanes(), focused: "p9" },
      problem: 'focused is "p9"',
    },
  ])("$name は理由を付けて投げる", ({ raw, problem }) => {
    expect(() => parseWorkspace(raw)).toThrow(problem);
  });
});

describe("migrateLayout", () => {
  const tab = (id: string, path: string) => ({
    id,
    preview: false,
    target: { kind: "file" as const, path, project: "/work/sample-app" },
  });

  test("1 面の配置は 1 つの面", () => {
    const raw: SerializedLayout = {
      version: LAYOUT_VERSION,
      focused: "left",
      collapsed: ["/work/sample-lib"],
      panes: [{ side: "left", activeId: "t1", tabs: [tab("t1", "a.ts")] }],
    };
    expect(migrateLayout(raw, "/p/0123456789abcdef/", "/x")).toEqual({
      version: 6,
      tree: { pane: "p1" },
      focused: "p1",
      panes: { p1: { url: "/p/0123456789abcdef/", layout: raw } },
    });
  });

  test("左右 2 面は p1 | p2 になり、右のタブは p2 の面の左へ移る", () => {
    const raw: SerializedLayout = {
      version: LAYOUT_VERSION,
      focused: "right",
      split: 0.6,
      groupFronts: { "/work/sample-app": "t2" },
      panes: [
        { side: "left", activeId: "t1", tabs: [tab("t1", "a.ts")] },
        { side: "right", activeId: "t2", tabs: [tab("t2", "b.ts")] },
      ],
    };
    const shared = {
      version: LAYOUT_VERSION,
      focused: "left",
      groupFronts: { "/work/sample-app": "t2" },
    };
    expect(migrateLayout(raw, "/left", "/right")).toEqual({
      version: 6,
      tree: { dir: "row", ratio: 0.6, a: { pane: "p1" }, b: { pane: "p2" } },
      focused: "p2",
      panes: {
        p1: {
          url: "/left",
          layout: {
            ...shared,
            panes: [
              { side: "left", activeId: "t1", tabs: [tab("t1", "a.ts")] },
            ],
          },
        },
        p2: {
          url: "/right",
          layout: {
            ...shared,
            panes: [
              { side: "left", activeId: "t2", tabs: [tab("t2", "b.ts")] },
            ],
          },
        },
      },
    });
  });
});

describe("routeUrl", () => {
  const A = "/p/aaaaaaaaaaaaaaaa";
  const B = "/p/bbbbbbbbbbbbbbbb";
  const C = "/p/cccccccccccccccc";
  function twoProjects(): Workspace {
    let ws = singlePane("p1", `${A}/`);
    ws = splitPane(ws, "p1", "row", "p2", entry(`${B}/history`));
    return { ...ws, focused: "p1" };
  }

  test.each([
    {
      name: "フォーカスのある面と同じプロジェクトならその面",
      url: `${A}/todif?from=HEAD`,
      focused: "p1",
      urls: [`${A}/todif?from=HEAD`, `${B}/history`],
    },
    {
      name: "同じプロジェクトの面があればその面へフォーカスも移す",
      url: `${B}/file?path=a.ts`,
      focused: "p2",
      urls: [`${A}/`, `${B}/file?path=a.ts`],
    },
    {
      name: "どの面にも無いプロジェクトはフォーカスのある面を替える",
      url: `${C}/`,
      focused: "p1",
      urls: [`${C}/`, `${B}/history`],
    },
  ])("$name", ({ url, focused, urls }) => {
    const ws = routeUrl(twoProjects(), url);
    expect({
      focused: ws.focused,
      urls: [ws.panes.p1.url, ws.panes.p2.url],
    }).toEqual({ focused, urls });
  });

  test("同じ URL なら同じ workspace を返す", () => {
    const ws = twoProjects();
    expect(routeUrl(ws, `${A}/`)).toBe(ws);
  });
});

describe("dropZoneAt", () => {
  const rect = { x: 100, y: 0, width: 400, height: 200 };
  test.each([
    { name: "真ん中", x: 300, y: 100, expected: "center" },
    { name: "境界: 左の帯の内側 (24%)", x: 196, y: 100, expected: "left" },
    { name: "境界: 左の帯のすぐ外 (25%)", x: 200, y: 100, expected: "center" },
    { name: "右の端", x: 490, y: 100, expected: "right" },
    { name: "上の端", x: 300, y: 10, expected: "up" },
    { name: "下の端", x: 300, y: 190, expected: "down" },
    { name: "角は近いほうの端 (左が近い)", x: 110, y: 30, expected: "left" },
  ] as const)("$name → $expected", ({ x, y, expected }) => {
    expect(dropZoneAt(rect, x, y)).toBe(expected);
  });
});
