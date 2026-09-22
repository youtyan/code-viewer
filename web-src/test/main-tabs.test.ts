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
  openRight,
  openSide,
  parseLayout,
  prevTab,
  serializeLayout,
  setSplit,
  showHome,
  splitRight,
  type TabTarget,
  tabMenu,
} from "../core/main-tabs";

// 配置を短く書くための準備。"a" はファイル a、"~a" は画像 a、"@diff" は page の
// diff (id も diff)、"*b" は仮のタブ b、"[c]" は選択中。右の面に置けないのは
// page だけ。検証したい中身はテストの表に見えるまま残す。
const file = (path: string): TabTarget => ({ kind: "file", path });
const image = (path: string): TabTarget => ({ kind: "image", path });
const page = (name: "diff" | "history"): TabTarget => ({
  kind: "page",
  page: name,
});

function pane(spec: string) {
  const tabs = spec
    .split(" ")
    .filter(Boolean)
    .map((raw) => {
      const active = raw.startsWith("[");
      const bare = raw.replace(/[[\]]/g, "");
      const preview = bare.startsWith("*");
      const named = bare.replace("*", "");
      const name = named.replace(/^[~@]/, "");
      const target = named.startsWith("~")
        ? image(name)
        : named.startsWith("@")
          ? page(name as "diff" | "history")
          : file(name);
      return { id: name, target, preview, active };
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
        const body =
          tab.target.kind === "file"
            ? tab.target.path
            : tab.target.kind === "image"
              ? `~${tab.target.path}`
              : tab.id;
        const name = `${tab.preview ? "*" : ""}${body}`;
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
      before: layoutOf("[a]", "[~b]"),
      target: image("b"),
      preview: undefined,
      expected: "[a] | [~b] (right)",
    },
  ])("$name", ({ before, target, preview, expected }) => {
    const after = open(before, target, { preview, newId: ids() });
    assertLayout(after);
    expect(show(after)).toBe(expected);
  });

  test("other-if-split は 1 面なら同じ面、2 面なら反対の面に開く", () => {
    const one = open(layoutOf("[a]"), image("x"), {
      pane: "other-if-split",
      preview: false,
    });
    const two = open(layoutOf("[a]", "[~b]"), image("x"), {
      pane: "other-if-split",
      preview: false,
    });
    expect([show(one), show(two)]).toEqual([
      "a [~x] (left)",
      "[a] | ~b [~x] (right)",
    ]);
  });

  test.each([
    {
      name: "反対の面 (右) を頼むと、ファイルは右の面に開く",
      pane: "other-if-split" as const,
      target: file("x"),
      expected: "[a] | ~b [x] (right)",
    },
    {
      name: "右の面を頼んでも、page は左の面に開く",
      pane: "right" as const,
      target: page("diff"),
      expected: "a [n1] | [~b] (left)",
    },
  ])("$name", ({ pane: where, target, expected }) => {
    const after = open(layoutOf("[a]", "[~b]"), target, {
      pane: where,
      preview: false,
      newId: ids(),
    });
    assertLayout(after);
    expect(show(after)).toBe(expected);
  });

  // 左右で同じファイルを開ける。面を指定しないときは、フォーカスのある面 →
  // 反対の面の順に同じものを探して前面に出す。右の面のタブの id には -r を
  // 付けて、左右の同じファイルの id がぶつからないようにする。
  const withRightIds = (layout: Layout): Layout => {
    const right = layout.panes.right;
    if (!right) return layout;
    const rename = (id: string) => `${id}-r`;
    return {
      ...layout,
      panes: {
        ...layout.panes,
        right: {
          tabs: right.tabs.map((tab) => ({ ...tab, id: rename(tab.id) })),
          activeId: right.activeId ? rename(right.activeId) : null,
          recent: right.recent.map(rename),
        },
      },
    };
  };
  test.each([
    {
      name: "面を指定すれば、反対の面にあっても指定した面に開く (左右に同じファイル)",
      before: layoutOf("[a]", "[b]"),
      pane: "right" as const,
      expected: "[a] | b [a] (right)",
    },
    {
      name: "指定した面に同じものがあれば、それを前面に出す",
      before: withRightIds(layoutOf("[a]", "a [b]")),
      pane: "right" as const,
      expected: "[a] | [a] b (right)",
    },
    {
      name: "面を指定しなければ、反対の面にあるものを前面に出してフォーカスを移す",
      before: { ...layoutOf("[a]", "[b]"), focused: "right" as const },
      pane: undefined,
      expected: "[a] | [b] (left)",
    },
    {
      name: "面を指定しなければ、フォーカスのある面のものを先に使う",
      before: {
        ...withRightIds(layoutOf("[a] b", "[c] a")),
        focused: "right" as const,
      },
      pane: undefined,
      expected: "[a] b | c [a] (right)",
    },
  ])("$name", ({ before, pane: where, expected }) => {
    const after = open(before, file("a"), {
      pane: where,
      preview: false,
      newId: ids(),
    });
    assertLayout(after);
    expect(show(after)).toBe(expected);
  });

  test.each([
    {
      name: "1 面なら新しい右の面を作る (左の同じファイルは残す)",
      before: layoutOf("b [a]"),
      target: file("a"),
      expected: "b [a] | [a] (right)",
    },
    {
      name: "2 面なら右の面の中で開く",
      before: layoutOf("[a]", "[~c]"),
      target: file("a"),
      expected: "[a] | ~c [a] (right)",
    },
    {
      name: "page は左の面で開く",
      before: layoutOf("[a]"),
      target: page("diff"),
      expected: "a [n1] (left)",
    },
  ])("openRight: $name", ({ before, target, expected }) => {
    const after = openRight(before, target, { preview: false, newId: ids() });
    assertLayout(after);
    expect(show(after)).toBe(expected);
  });

  test.each([
    {
      name: "フォーカスの面に無く、反対の面にあれば反対の面",
      before: { ...layoutOf("[a]", "[b]"), focused: "right" as const },
      pane: undefined,
      expected: "left",
    },
    {
      name: "どこにも無ければフォーカスの面",
      before: { ...layoutOf("[a]", "[b]"), focused: "right" as const },
      pane: undefined,
      target: file("x"),
      expected: "right",
    },
    {
      name: "面を指定すればその面",
      before: layoutOf("[a]", "[b]"),
      pane: "right" as const,
      expected: "right",
    },
  ])("openSide: $name", ({ before, pane: where, target, expected }) => {
    expect(openSide(before, target ?? file("a"), { pane: where })).toBe(
      expected,
    );
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
    {
      name: "何も選んでいない面でタブを閉じても、選ばないまま",
      history: [],
      before: "a b",
      closing: "a",
      expected: "b (left)",
    },
  ])("$name", ({ history, before, closing, expected }) => {
    const base = layoutOf(before);
    const active = history[history.length - 1] ?? null;
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

  test("2 面で右の面が空になれば 1 面に戻る", () => {
    const after = close(layoutOf("[a]", "[~b]"), "b");
    assertLayout(after);
    expect(show(after)).toBe("[a] (left)");
  });

  test("左の面が空になっても 2 面のまま (左は本文の既定を出す)", () => {
    const after = close(layoutOf("[a]", "[~b]"), "a");
    assertLayout(after);
    expect(show(after)).toBe(" | [~b] (left)");
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
      before: layoutOf("[~a] b", "[~c]"),
      id: "a",
      side: "right" as const,
      index: 1,
      expected: "[b] | ~c [~a] (right)",
    },
    {
      name: "右の画像を左へ移せる",
      before: layoutOf("[a]", "~b [~c]"),
      id: "c",
      side: "left" as const,
      index: 1,
      expected: "a [~c] | [~b] (left)",
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
    {
      name: "page は右の面に置けない",
      before: layoutOf("[a] @diff", "[~c]"),
      id: "diff",
      side: "right" as const,
      index: 0,
      reason: "not-placeable",
    },
  ])("動かさない: $name", ({ before, id, side, index, reason }) => {
    const result = move(before, id, side, index);
    expect(result).toEqual({ layout: before, moved: false, reason });
  });

  test("ファイルは右の面へ移せる", () => {
    const result = move(layoutOf("[a] b", "[~c]"), "a", "right", 0);
    assertLayout(result.layout);
    expect([result.moved, show(result.layout)]).toEqual([
      true,
      "[b] | [a] ~c (right)",
    ]);
  });

  test("移動先に同じ中身があれば動かさない", () => {
    const base = layoutOf("[~a]", "[~b]");
    const layout: Layout = {
      ...base,
      panes: {
        left: base.panes.left,
        right: {
          tabs: [{ id: "b", target: image("a"), preview: false }],
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
      before: layoutOf("a [~b]"),
      expected: "[a] | [~b] (right)",
    },
    {
      name: "タブが 1 つでも分けられる (左は本文の既定)",
      run: (l: Layout) => splitRight(l, "b"),
      before: layoutOf("[~b]"),
      expected: " | [~b] (right)",
    },
    {
      name: "ファイルも splitRight で右の面へ移す",
      run: (l: Layout) => splitRight(l, "b"),
      before: layoutOf("a [b]"),
      expected: "[a] | [b] (right)",
    },
    {
      name: "page の splitRight は何もしない",
      run: (l: Layout) => splitRight(l, "diff"),
      before: layoutOf("a [@diff]"),
      expected: "a [diff] (left)",
    },
    {
      name: "2 面の splitRight は何もしない",
      run: (l: Layout) => splitRight(l, "a"),
      before: layoutOf("[~a] b", "[~c]"),
      expected: "[~a] b | [~c] (left)",
    },
    {
      name: "moveToOtherSide で右の面が空になれば 1 面に戻る",
      run: (l: Layout) => moveToOtherSide(l, "c"),
      before: layoutOf("[a]", "[~c]"),
      expected: "a [~c] (left)",
    },
    {
      name: "ファイルは moveToOtherSide で右の面へ移る",
      run: (l: Layout) => moveToOtherSide(l, "a"),
      before: layoutOf("[a]", "[~c]"),
      expected: " | ~c [a] (right)",
    },
    {
      name: "page の moveToOtherSide は何もしない",
      run: (l: Layout) => moveToOtherSide(l, "diff"),
      before: layoutOf("[@diff]", "[~c]"),
      expected: "[diff] | [~c] (left)",
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
      name: "1 面の仮の画像のタブ (中央)",
      layout: layoutOf("a [*~b] c"),
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
        splitRight: true,
        moveToOtherSide: false,
        copyPath: true,
      },
    },
    {
      name: "2 面の左の画像のタブ",
      layout: layoutOf("[a] ~b", "[~c]"),
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
    {
      name: "2 面の左のファイルのタブは反対側へ移せる",
      layout: layoutOf("a [b]", "[~c]"),
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
    {
      name: "1 面の page のタブは右へ分けられない",
      layout: layoutOf("a [@diff]"),
      id: "diff",
      expected: {
        close: true,
        closeOthers: true,
        closeToRight: false,
        keepOpen: false,
        splitRight: false,
        moveToOtherSide: false,
        copyPath: false,
      },
    },
    {
      name: "2 面の左の page のタブは反対側へ移せない",
      layout: layoutOf("a [@diff]", "[~c]"),
      id: "diff",
      expected: {
        close: true,
        closeOthers: true,
        closeToRight: false,
        keepOpen: false,
        splitRight: false,
        moveToOtherSide: false,
        copyPath: false,
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
    const layout = open(layoutOf("a [*b]", "[~c]"), {
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
        version: 0,
        focused: "left",
        panes: [{ side: "left", activeId: null, tabs: [] }],
      },
      messages: ["version is 0, expected one of 1, 2, 3"],
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
        version: 0,
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
        "version is 0, expected one of 1, 2, 3",
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

describe("本文の既定 (Files のタブの代わり)", () => {
  test.each([
    {
      name: "選択を外すだけでタブは閉じない",
      before: layoutOf("a [b]"),
      expected: "a b (left)",
    },
    {
      name: "右の面にフォーカスがあっても左へ移す",
      before: { ...layoutOf("[a]", "[~b]"), focused: "right" as const },
      expected: "a | [~b] (left)",
    },
  ])("showHome: $name", ({ before, expected }) => {
    const after = showHome(before);
    assertLayout(after);
    expect(show(after)).toBe(expected);
  });

  test("何も選んでいない左の面は保存して読み戻しても選ばないまま", () => {
    const layout = showHome(layoutOf("a [b]"));
    const parsed = parseLayout(
      JSON.parse(JSON.stringify(serializeLayout(layout))),
    );
    expect(show(parsed.layout)).toBe("a b (left)");
  });

  // 版 2 のまま左右に同じファイルを置いた値 (右の面にファイルを置けるように
  // した直後の版が書いた) も、そのまま読む。
  test("版 2 の左右に同じファイルがある値を読む", () => {
    const parsed = parseLayout({
      version: 2,
      focused: "right",
      split: 0.5,
      panes: [
        {
          side: "left",
          activeId: "a",
          tabs: [
            { id: "a", preview: false, target: { kind: "file", path: "a" } },
          ],
        },
        {
          side: "right",
          activeId: "a-right",
          tabs: [
            {
              id: "a-right",
              preview: false,
              target: { kind: "file", path: "a" },
            },
          ],
        },
      ],
    });
    assertLayout(parsed.layout);
    expect([show(parsed.layout), parsed.relocated]).toEqual([
      "[a] | [a] (right)",
      [],
    ]);
  });

  test("右の面が何も選んでいない値は壊れている", () => {
    expect(() =>
      parseLayout({
        version: 2,
        focused: "left",
        panes: [
          { side: "left", activeId: null, tabs: [] },
          {
            side: "right",
            activeId: null,
            tabs: [
              { id: "c", preview: false, target: { kind: "image", path: "c" } },
            ],
          },
        ],
      }),
    ).toThrow("panes[1].activeId is null but the pane has tabs");
  });

  test("版 1 の Files のタブは落とし、選んでいたなら本文の既定にする", () => {
    const parsed = parseLayout({
      version: 1,
      focused: "left",
      panes: [
        {
          side: "left",
          activeId: "r",
          tabs: [
            { id: "a", preview: false, target: { kind: "file", path: "a" } },
            { id: "r", preview: false, target: { kind: "page", page: "repo" } },
          ],
        },
      ],
    });
    expect([show(parsed.layout), parsed.retired, parsed.dropped]).toEqual([
      "a (left)",
      [
        {
          at: "panes[0].tabs[1]",
          raw: {
            id: "r",
            preview: false,
            target: { kind: "page", page: "repo" },
          },
        },
      ],
      [],
    ]);
  });

  test("版 1 の右の面の画面のタブは左の面の末尾へ移し、選んでいたなら左で選ぶ (ファイル・画像は右に残す)", () => {
    const parsed = parseLayout({
      version: 1,
      focused: "right",
      split: 0.4,
      panes: [
        {
          side: "left",
          activeId: "a",
          tabs: [
            { id: "a", preview: false, target: { kind: "file", path: "a" } },
          ],
        },
        {
          side: "right",
          activeId: "d",
          tabs: [
            { id: "b", preview: false, target: { kind: "file", path: "b" } },
            { id: "c", preview: false, target: { kind: "image", path: "c" } },
            { id: "d", preview: false, target: { kind: "page", page: "diff" } },
          ],
        },
      ],
    });
    assertLayout(parsed.layout);
    expect([
      show(parsed.layout),
      parsed.relocated.map((item) => item.id),
    ]).toEqual(["a [d] | b [~c] (left)", ["d"]]);
  });

  test("版 1 の右の面が全部画面なら 1 面に戻す", () => {
    const parsed = parseLayout({
      version: 1,
      focused: "left",
      split: 0.4,
      panes: [
        {
          side: "left",
          activeId: "a",
          tabs: [
            { id: "a", preview: false, target: { kind: "file", path: "a" } },
          ],
        },
        {
          side: "right",
          activeId: "b",
          tabs: [
            { id: "b", preview: false, target: { kind: "page", page: "diff" } },
          ],
        },
      ],
    });
    assertLayout(parsed.layout);
    expect([show(parsed.layout), parsed.layout.split]).toEqual([
      "[a] b (left)",
      undefined,
    ]);
  });

  test("assertLayout は右の面の page のタブを見つける", () => {
    const layout: Layout = {
      panes: {
        left: pane("[a]"),
        right: pane("[@diff]"),
      },
      focused: "left",
      split: 0.5,
    };
    expect(() => assertLayout(layout)).toThrow("right holds page tab diff");
  });

  test("assertLayout は同じ面の同じ中身を見つけ、左右の同じファイルは通す", () => {
    const same: Layout = {
      panes: {
        left: {
          tabs: [
            { id: "a1", target: file("a"), preview: false },
            { id: "a2", target: file("a"), preview: false },
          ],
          activeId: "a1",
          recent: ["a1"],
        },
      },
      focused: "left",
    };
    expect(() => assertLayout(same)).toThrow(
      'duplicate target {"kind":"file","path":"a"} in left',
    );
    expect(() => assertLayout(layoutOf("[a]", "[a]"))).toThrow(
      "duplicate id a",
    );
    const both: Layout = {
      panes: {
        left: pane("[a]"),
        right: {
          tabs: [{ id: "a-right", target: file("a"), preview: false }],
          activeId: "a-right",
          recent: ["a-right"],
        },
      },
      focused: "left",
      split: 0.5,
    };
    expect(() => assertLayout(both)).not.toThrow();
  });
});

describe("左右の幅の比", () => {
  test.each([
    {
      name: "分割した直後は半分",
      run: (l: Layout) => splitRight(l, "b"),
      before: layoutOf("a [~b]"),
      expected: 0.5,
    },
    {
      name: "比を変える",
      run: (l: Layout) => setSplit(l, 0.3),
      before: layoutOf("[a]", "[~b]"),
      expected: 0.3,
    },
    {
      name: "0 は面が消えるので変えない",
      run: (l: Layout) => setSplit(l, 0),
      before: layoutOf("[a]", "[~b]"),
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
      before: layoutOf("[a]", "[~b]"),
      expected: undefined,
    },
  ])("$name", ({ run, before, expected }) => {
    expect(run(before).split).toBe(expected);
  });

  test("保存して読み戻すと 2 面と比が戻る", () => {
    const layout = setSplit(layoutOf("a [b]", "[~c]"), 0.35);
    const parsed = parseLayout(
      JSON.parse(JSON.stringify(serializeLayout(layout))),
    );
    expect([show(parsed.layout), parsed.layout.split]).toEqual([
      "a [b] | [~c] (left)",
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
