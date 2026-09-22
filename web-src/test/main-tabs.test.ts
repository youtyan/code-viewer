import { describe, expect, test } from "vitest";
import {
  activateIndex,
  assertLayout,
  close,
  closeOthers,
  closeToRight,
  keepOpen,
  type Layout,
  move,
  moveToOtherSide,
  nextTab,
  open,
  parseLayout,
  prevTab,
  serializeLayout,
  setSplit,
  splitRight,
  type TabTarget,
  tabMenu,
} from "../core/main-tabs";

// 配置を短く書くための準備。"a" はファイル a、"*b" は仮のタブ b、"[c]" は選択中。
// 検証したい中身はテストの表に見えるまま残す。
const file = (path: string): TabTarget => ({ kind: "file", path });

function pane(spec: string) {
  const tabs = spec
    .split(" ")
    .filter(Boolean)
    .map((raw) => {
      const active = raw.startsWith("[");
      const bare = raw.replace(/[[\]]/g, "");
      const preview = bare.startsWith("*");
      const name = bare.replace("*", "");
      return { id: name, target: file(name), preview, active };
    });
  const activeId = tabs.find((tab) => tab.active)?.id ?? null;
  return {
    tabs: tabs.map(({ id, target, preview }) => ({ id, target, preview })),
    activeId,
    recent: activeId ? [activeId] : [],
  };
}

function layoutOf(left: string, right?: string): Layout {
  return right === undefined
    ? { panes: { left: pane(left) }, focused: "left" }
    : { panes: { left: pane(left), right: pane(right) }, focused: "left" };
}

/** 配置を表と同じ書き方に戻す。 */
function show(layout: Layout): string {
  const one = (p: Layout["panes"]["left"]) =>
    p.tabs
      .map((tab) => {
        const name = `${tab.preview ? "*" : ""}${tab.target.kind === "file" ? tab.target.path : tab.id}`;
        return tab.id === p.activeId ? `[${name}]` : name;
      })
      .join(" ");
  return layout.panes.right
    ? `${one(layout.panes.left)} | ${one(layout.panes.right)} (${layout.focused})`
    : `${one(layout.panes.left)} (${layout.focused})`;
}

const ids = () => {
  let n = 0;
  return () => `n${++n}`;
};

describe("open", () => {
  test.each([
    {
      name: "空の面に仮で開く",
      before: layoutOf(""),
      target: file("x"),
      preview: undefined,
      expected: "[*x] (left)",
    },
    {
      name: "仮のタブがあれば置き換える",
      before: layoutOf("a [*b] c"),
      target: file("x"),
      preview: undefined,
      expected: "a [*x] c (left)",
    },
    {
      name: "固定で開くと選択中の右に足す",
      before: layoutOf("[a] *b"),
      target: file("x"),
      preview: false,
      expected: "a [x] *b (left)",
    },
    {
      name: "既にあるものは前面に出すだけ",
      before: layoutOf("a [b] c"),
      target: file("a"),
      preview: undefined,
      expected: "[a] b c (left)",
    },
    {
      name: "page は常に固定で開く",
      before: layoutOf("[*a]"),
      target: { kind: "page", page: "diff" } as TabTarget,
      preview: true,
      expected: "*a [n1] (left)",
    },
    {
      name: "2 面のとき反対側にある同じものは、その面を前面にしてフォーカスを移す",
      before: layoutOf("[a]", "[b]"),
      target: file("b"),
      preview: undefined,
      expected: "[a] | [b] (right)",
    },
  ])("$name", ({ before, target, preview, expected }) => {
    const after = open(before, target, { preview, newId: ids() });
    assertLayout(after);
    expect(show(after)).toBe(expected);
  });

  test("other-if-split は 1 面なら同じ面、2 面なら反対の面に開く", () => {
    const one = open(layoutOf("[a]"), file("x"), {
      pane: "other-if-split",
      preview: false,
    });
    const two = open(layoutOf("[a]", "[b]"), file("x"), {
      pane: "other-if-split",
      preview: false,
    });
    expect([show(one), show(two)]).toEqual([
      "a [x] (left)",
      "[a] | b [x] (right)",
    ]);
  });

  test("行の指定が変わったら、同じタブの中身を差し替える", () => {
    const after = open(layoutOf("[a]"), {
      kind: "file",
      path: "a",
      line: 12,
    });
    expect(after.panes.left.tabs[0].target).toEqual({
      kind: "file",
      path: "a",
      line: 12,
    });
  });

  test("入力の状態を書き換えない", () => {
    const before = layoutOf("[*a]");
    const copy = JSON.stringify(before);
    open(before, file("x"));
    expect(JSON.stringify(before)).toBe(copy);
  });
});

describe("close", () => {
  test.each([
    {
      name: "直前に選んだタブへ戻る",
      history: ["c", "a"],
      before: "a b c",
      closing: "a",
      expected: "b [c] (left)",
    },
    {
      name: "履歴に無ければ右隣",
      history: ["b"],
      before: "a b c",
      closing: "b",
      expected: "a [c] (left)",
    },
    {
      name: "右端なら左隣",
      history: ["c"],
      before: "a b c",
      closing: "c",
      expected: "a [b] (left)",
    },
    {
      name: "選択していないタブを閉じても選択は変わらない",
      history: ["b"],
      before: "a b c",
      closing: "c",
      expected: "a [b] (left)",
    },
    {
      name: "最後の 1 つを閉じると空の面が残る",
      history: ["a"],
      before: "a",
      closing: "a",
      expected: " (left)",
    },
  ])("$name", ({ history, before, closing, expected }) => {
    const base = layoutOf(before);
    const active = history[history.length - 1];
    const layout: Layout = {
      ...base,
      panes: {
        left: { ...base.panes.left, activeId: active, recent: history },
      },
    };
    const after = close(layout, closing);
    assertLayout(after);
    expect(show(after)).toBe(expected);
  });

  test("2 面で片方が空になれば 1 面に戻る", () => {
    const after = close(layoutOf("[a]", "[b]"), "b");
    assertLayout(after);
    expect(show(after)).toBe("[a] (left)");
  });

  test.each([
    { name: "知らない id は何もしない", id: "zz", expected: "[a] b (left)" },
  ])("$name", ({ id, expected }) => {
    expect(show(close(layoutOf("[a] b"), id))).toBe(expected);
  });
});

describe("まとめて閉じる", () => {
  test.each([
    {
      name: "closeOthers は指定のタブだけ残して選ぶ",
      run: (l: Layout) => closeOthers(l, "b"),
      before: "[a] b c",
      expected: "[b] (left)",
    },
    {
      name: "closeToRight は右側だけ閉じる",
      run: (l: Layout) => closeToRight(l, "b"),
      before: "[a] b c",
      expected: "[a] b (left)",
    },
    {
      name: "closeToRight で選択中が消えたら残りから選ぶ",
      run: (l: Layout) => closeToRight(l, "a"),
      before: "a b [c]",
      expected: "[a] (left)",
    },
  ])("$name", ({ run, before, expected }) => {
    const after = run(layoutOf(before));
    assertLayout(after);
    expect(show(after)).toBe(expected);
  });
});

describe("選択の移動", () => {
  test.each([
    {
      name: "次へ",
      run: nextTab,
      before: "a [b] c",
      expected: "a b [c] (left)",
    },
    {
      name: "次へ: 右端で左端に回る",
      run: nextTab,
      before: "a b [c]",
      expected: "[a] b c (left)",
    },
    {
      name: "前へ",
      run: prevTab,
      before: "a [b] c",
      expected: "[a] b c (left)",
    },
    {
      name: "前へ: 左端で右端に回る",
      run: prevTab,
      before: "[a] b c",
      expected: "a b [c] (left)",
    },
    {
      name: "空の面では何もしない",
      run: nextTab,
      before: "",
      expected: " (left)",
    },
    {
      name: "n 番目 (範囲内)",
      run: (l: Layout) => activateIndex(l, 3),
      before: "[a] b c",
      expected: "a b [c] (left)",
    },
    {
      name: "n 番目 (範囲外は何もしない)",
      run: (l: Layout) => activateIndex(l, 4),
      before: "[a] b c",
      expected: "[a] b c (left)",
    },
  ])("$name", ({ run, before, expected }) => {
    const after = run(layoutOf(before));
    assertLayout(after);
    expect(show(after)).toBe(expected);
  });
});

describe("keepOpen", () => {
  test.each([
    { name: "仮を固定にする", before: "[*a]", expected: "[a] (left)" },
    { name: "固定はそのまま", before: "[a]", expected: "[a] (left)" },
  ])("$name", ({ before, expected }) => {
    expect(show(keepOpen(layoutOf(before), "a"))).toBe(expected);
  });
});

describe("move", () => {
  test.each([
    {
      name: "同じ面で右へ",
      before: layoutOf("[a] b c"),
      id: "a",
      side: "left" as const,
      index: 2,
      expected: "b c [a] (left)",
    },
    {
      name: "同じ面で左端へ",
      before: layoutOf("a b [c]"),
      id: "c",
      side: "left" as const,
      index: 0,
      expected: "[c] a b (left)",
    },
    {
      name: "反対の面へ移すとその面を選ぶ",
      before: layoutOf("[a] b", "[c]"),
      id: "a",
      side: "right" as const,
      index: 1,
      expected: "[b] | c [a] (right)",
    },
  ])("$name", ({ before, id, side, index, expected }) => {
    const result = move(before, id, side, index);
    assertLayout(result.layout);
    expect([result.moved, show(result.layout)]).toEqual([true, expected]);
  });

  test.each([
    {
      name: "知らないタブ",
      before: layoutOf("[a]"),
      id: "zz",
      side: "left" as const,
      index: 0,
      reason: "unknown-tab",
    },
    {
      name: "無い面",
      before: layoutOf("[a]"),
      id: "a",
      side: "right" as const,
      index: 0,
      reason: "no-such-pane",
    },
  ])("動かさない: $name", ({ before, id, side, index, reason }) => {
    const result = move(before, id, side, index);
    expect(result).toEqual({ layout: before, moved: false, reason });
  });

  test("移動先に同じ中身があれば動かさない", () => {
    const base = layoutOf("[a]", "[b]");
    const layout: Layout = {
      ...base,
      panes: {
        left: base.panes.left,
        right: {
          tabs: [{ id: "b", target: file("a"), preview: false }],
          activeId: "b",
          recent: ["b"],
        },
      },
    };
    expect(move(layout, "a", "right", 0)).toEqual({
      layout,
      moved: false,
      reason: "duplicate-target",
    });
  });
});

describe("分割", () => {
  test.each([
    {
      name: "1 面で splitRight すると右の面へ移す",
      run: (l: Layout) => splitRight(l, "b"),
      before: layoutOf("a [b]"),
      expected: "[a] | [b] (right)",
    },
    {
      name: "2 面の splitRight は何もしない",
      run: (l: Layout) => splitRight(l, "a"),
      before: layoutOf("[a] b", "[c]"),
      expected: "[a] b | [c] (left)",
    },
    {
      name: "moveToOtherSide で元の面が空になれば 1 面に戻る",
      run: (l: Layout) => moveToOtherSide(l, "c"),
      before: layoutOf("[a]", "[c]"),
      expected: "a [c] (left)",
    },
    {
      name: "1 面の moveToOtherSide は何もしない",
      run: (l: Layout) => moveToOtherSide(l, "a"),
      before: layoutOf("[a] b"),
      expected: "[a] b (left)",
    },
  ])("$name", ({ run, before, expected }) => {
    const after = run(before);
    assertLayout(after);
    expect(show(after)).toBe(expected);
  });
});

describe("tabMenu", () => {
  test.each([
    {
      name: "1 面の仮のファイルのタブ (中央)",
      layout: layoutOf("a [*b] c"),
      id: "b",
      expected: {
        close: true,
        closeOthers: true,
        closeToRight: true,
        keepOpen: true,
        splitRight: true,
        moveToOtherSide: false,
        copyPath: true,
      },
    },
    {
      name: "1 つだけの固定のタブ",
      layout: layoutOf("[a]"),
      id: "a",
      expected: {
        close: true,
        closeOthers: false,
        closeToRight: false,
        keepOpen: false,
        splitRight: false,
        moveToOtherSide: false,
        copyPath: true,
      },
    },
    {
      name: "2 面のタブ",
      layout: layoutOf("[a] b", "[c]"),
      id: "b",
      expected: {
        close: true,
        closeOthers: true,
        closeToRight: false,
        keepOpen: false,
        splitRight: false,
        moveToOtherSide: true,
        copyPath: true,
      },
    },
  ])("$name", ({ layout, id, expected }) => {
    expect(tabMenu(layout, id)).toEqual(expected);
  });

  test("page のタブは Copy path が無効", () => {
    const layout = open(layoutOf(""), { kind: "page", page: "history" });
    const id = layout.panes.left.tabs[0].id;
    expect(tabMenu(layout, id).copyPath).toBe(false);
  });
});

describe("保存と読み戻し", () => {
  test("serializeLayout → parseLayout で同じ配置に戻る", () => {
    const layout = open(layoutOf("a [*b]", "[c]"), {
      kind: "page",
      page: "journal",
    });
    const parsed = parseLayout(
      JSON.parse(JSON.stringify(serializeLayout(layout))),
    );
    expect([show(parsed.layout), parsed.dropped]).toEqual([show(layout), []]);
  });

  test("知らない種類のタブは落として、場所と中身を返す", () => {
    const parsed = parseLayout({
      version: 1,
      focused: "left",
      panes: [
        {
          side: "left",
          activeId: "a",
          tabs: [
            { id: "a", preview: false, target: { kind: "file", path: "a" } },
            { id: "q", preview: false, target: { kind: "chart", name: "q" } },
          ],
        },
      ],
    });
    expect([show(parsed.layout), parsed.dropped]).toEqual([
      "[a] (left)",
      [
        {
          at: "panes[0].tabs[1]",
          raw: {
            id: "q",
            preview: false,
            target: { kind: "chart", name: "q" },
          },
        },
      ],
    ]);
  });

  const tab = (id: string, preview = false) => ({
    id,
    preview,
    target: { kind: "file", path: id },
  });
  const page = (id: string) => ({
    id,
    preview: false,
    target: { kind: "page", page: "diff" },
  });

  test.each([
    {
      name: "版が違う",
      raw: {
        version: 2,
        focused: "left",
        panes: [{ side: "left", activeId: null, tabs: [] }],
      },
      messages: ["version is 2, expected 1"],
    },
    {
      name: "面が 3 つ",
      raw: {
        version: 1,
        focused: "left",
        panes: [
          { side: "left", activeId: null, tabs: [] },
          { side: "right", activeId: null, tabs: [] },
          { side: "right", activeId: null, tabs: [] },
        ],
      },
      messages: ["panes has 3 entries (1 or 2 allowed)"],
    },
    {
      name: "activeId が面に無い",
      raw: {
        version: 1,
        focused: "left",
        panes: [{ side: "left", activeId: "zz", tabs: [tab("a")] }],
      },
      messages: ['panes[0].activeId "zz" is not a tab of the pane'],
    },
    {
      name: "仮のタブが 2 つ",
      raw: {
        version: 1,
        focused: "left",
        panes: [
          {
            side: "left",
            activeId: "a",
            tabs: [tab("a", true), tab("b", true)],
          },
        ],
      },
      messages: ["panes[0] has 2 preview tabs (a, b); at most 1"],
    },
    {
      name: "同じ page が 2 つ",
      raw: {
        version: 1,
        focused: "left",
        panes: [
          { side: "left", activeId: "p1", tabs: [page("p1")] },
          { side: "right", activeId: "p2", tabs: [page("p2")] },
        ],
      },
      messages: [
        'panes[1].tabs[0]: page {"kind":"page","page":"diff"} is also open at panes[0].tabs[0]',
      ],
    },
    {
      name: "壊れた箇所が複数あれば全部並べる",
      raw: {
        version: 3,
        focused: "middle",
        panes: [
          {
            side: "left",
            activeId: "a",
            tabs: [
              tab("a"),
              tab("a"),
              { id: "c", preview: false, target: { kind: "file" } },
            ],
          },
        ],
      },
      messages: [
        "version is 3, expected 1",
        'focused is "middle"',
        'panes[0].tabs[1]: id "a" is also used at panes[0].tabs[0]',
        "panes[0].tabs[2]: file target has no path",
      ],
    },
  ])("壊れた入力: $name", ({ raw, messages }) => {
    let caught: unknown = null;
    try {
      parseLayout(raw);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    for (const message of messages)
      expect((caught as Error).message).toContain(message);
  });
});

describe("左右の幅の比", () => {
  test.each([
    {
      name: "分割した直後は半分",
      run: (l: Layout) => splitRight(l, "b"),
      before: layoutOf("a [b]"),
      expected: 0.5,
    },
    {
      name: "比を変える",
      run: (l: Layout) => setSplit(l, 0.3),
      before: layoutOf("[a]", "[b]"),
      expected: 0.3,
    },
    {
      name: "0 は面が消えるので変えない",
      run: (l: Layout) => setSplit(l, 0),
      before: layoutOf("[a]", "[b]"),
      expected: undefined,
    },
    {
      name: "1 面では持たない",
      run: (l: Layout) => setSplit(l, 0.3),
      before: layoutOf("[a]"),
      expected: undefined,
    },
    {
      name: "1 面に戻ると消える",
      run: (l: Layout) => close(setSplit(l, 0.3), "b"),
      before: layoutOf("[a]", "[b]"),
      expected: undefined,
    },
  ])("$name", ({ run, before, expected }) => {
    expect(run(before).split).toBe(expected);
  });

  test("保存して読み戻すと 2 面と比が戻る", () => {
    const layout = setSplit(layoutOf("a [b]", "[c]"), 0.35);
    const parsed = parseLayout(
      JSON.parse(JSON.stringify(serializeLayout(layout))),
    );
    expect([show(parsed.layout), parsed.layout.split]).toEqual([
      "a [b] | [c] (left)",
      0.35,
    ]);
  });

  test.each([
    { name: "0 以下", split: 0 },
    { name: "1 以上", split: 1.2 },
    { name: "数でない", split: "half" },
  ])("壊れた比 ($name) は理由を出す", ({ split }) => {
    expect(() =>
      parseLayout({
        version: 1,
        focused: "left",
        split,
        panes: [
          { side: "left", activeId: null, tabs: [] },
          { side: "right", activeId: null, tabs: [] },
        ],
      }),
    ).toThrow(`split is ${JSON.stringify(split)} (0 < split < 1)`);
  });
});
