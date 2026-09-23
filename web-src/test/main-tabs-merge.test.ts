// 窓どうしのタブの変更の突き合わせ (core/main-tabs-merge.ts)。base (前に読んだ
// 保存) からのこの窓 (mine) の変更を、今の保存 (theirs) に当てる。
import { describe, expect, test } from "vitest";
import {
  assertLayout,
  type Layout,
  type Pane,
  regroup,
  type TabTarget,
} from "../core/main-tabs";
import { mergeLayouts, mergeSerializedLayouts } from "../core/main-tabs-merge";

// "a" はプロジェクト /w/p のファイル a (id も a)、"*a" は仮、"[a]" は前面、
// "$s" はシェル s、"@d" は /w/p の Diff (id は d)。右の面は " | " の後ろ。
function paneOf(spec: string): Pane {
  const tabs = spec
    .split(" ")
    .filter(Boolean)
    .map((raw) => {
      const active = raw.startsWith("[");
      const bare = raw.replace(/[[\]]/g, "");
      const preview = bare.startsWith("*");
      const name = bare.replace("*", "");
      const id = name.replace(/^[$@]/, "");
      const target: TabTarget = name.startsWith("$")
        ? { kind: "terminal", session: id }
        : name.startsWith("@")
          ? { kind: "page", page: "diff", project: "/w/p" }
          : { kind: "file", path: id, project: "/w/p" };
      return { tab: { id, target, preview }, active };
    });
  const activeId = tabs.find((item) => item.active)?.tab.id ?? null;
  return {
    tabs: tabs.map((item) => item.tab),
    activeId,
    recent: activeId ? [activeId] : [],
  };
}

function layoutOf(spec: string, focused: "left" | "right" = "left"): Layout {
  const [left, right] = spec.split(" | ");
  return right === undefined
    ? { panes: { left: paneOf(left) }, focused: "left" }
    : {
        panes: { left: paneOf(left), right: paneOf(right) },
        focused,
        split: 0.5,
      };
}

function show(layout: Layout): string {
  const one = (pane: Pane) =>
    pane.tabs
      .map((tab) => {
        const name = `${tab.preview ? "*" : ""}${tab.target.kind === "terminal" ? "$" : ""}${tab.id}`;
        return tab.id === pane.activeId ? `[${name}]` : name;
      })
      .join(" ");
  return layout.panes.right
    ? `${one(layout.panes.left)} | ${one(layout.panes.right)} (${layout.focused})`
    : one(layout.panes.left);
}

describe("mergeLayouts", () => {
  test.each([
    {
      name: "両方の窓で開いたタブが残る (前は後から書いた窓が相手の a を消していた)",
      base: "[x]",
      mine: "x [b]",
      theirs: "[x] a",
      expected: "x [b] a",
    },
    {
      name: "この窓で閉じたタブは消える",
      base: "[x] a",
      mine: "[x]",
      theirs: "[x] a",
      expected: "[x]",
    },
    {
      name: "相手が閉じたタブは、この窓が触っていなければ消えたまま",
      base: "[x] a",
      mine: "[x] a",
      theirs: "[x]",
      expected: "[x]",
    },
    {
      name: "相手が閉じたタブを、この窓で動かしていても戻さない",
      base: "[x] a b",
      mine: "[x] b a",
      theirs: "[x] b",
      expected: "[x] b",
    },
    {
      name: "この窓で並べ替えたタブは、この窓の並びに",
      base: "[x] a b",
      mine: "[x] b a",
      theirs: "[x] a b c",
      expected: "[x] b a c",
    },
    {
      name: "この窓で開いたタブは、この窓で左隣だったタブの右に",
      base: "[x] y",
      mine: "x [n] y",
      theirs: "[x] a y",
      expected: "x [n] a y",
    },
    {
      name: "前面はこの窓のもの (相手の窓の前面を持ち込まない)",
      base: "[x] y",
      mine: "[x] y",
      theirs: "x [y] z",
      expected: "[x] y z",
    },
    {
      name: "この窓の前面を相手が閉じたら、この窓で最近前面だったタブへ",
      base: "[x] y",
      mine: "x [y]",
      theirs: "[x]",
      expected: "[x]",
    },
    {
      name: "まだ保存を読めていない (base が無い) なら、この窓のタブを全部足す",
      base: null,
      mine: "[m] $s",
      theirs: "[x] $s",
      expected: "x [m] $s",
    },
    {
      name: "仮のタブはプロジェクトごとに 1 つ: この窓の仮を残し、相手の仮は固定に",
      base: "[x]",
      mine: "x [*b]",
      theirs: "[x] *a",
      expected: "x [*b] a",
    },
    {
      name: "相手が右に分けたら、この窓にも右の面が出る",
      base: "[x] a",
      mine: "[x] a",
      theirs: "[x] | [a]",
      expected: "[x] | [a] (left)",
    },
    {
      name: "相手が 1 面に戻したら (右の面が空になった)、この窓も 1 面",
      base: "[x] | [a]",
      mine: "x | [a]",
      theirs: "[x] a",
      expected: "x a",
    },
  ])("$name", ({ base, mine, theirs, expected }) => {
    const merged = mergeLayouts(
      base === null ? null : layoutOf(base),
      layoutOf(mine),
      layoutOf(theirs),
    );
    assertLayout(merged.layout);
    expect(show(merged.layout)).toBe(expected);
  });

  test("両方の窓で同じ中身を開いたら 1 枚にまとめ、この窓の id を相手の id へ移し替える", () => {
    const mine: Layout = layoutOf("x");
    mine.panes.left.tabs.push({
      id: "mine-a",
      target: { kind: "file", path: "a", project: "/w/p" },
      preview: false,
    });
    mine.panes.left.activeId = "mine-a";
    const theirs = layoutOf("[x] a");
    const merged = mergeLayouts(layoutOf("[x]"), mine, theirs);
    expect([show(merged.layout), [...merged.renamed]]).toEqual([
      "x [a]",
      [["mine-a", "a"]],
    ]);
  });

  test("畳んだグループとグループの前面: この窓で変えたものはこの窓の値、ほかは相手の値", () => {
    const base: Layout = { ...layoutOf("[x] a"), collapsed: [] };
    const mine: Layout = {
      ...layoutOf("[x] a"),
      collapsed: ["/w/p"],
      groupFronts: { "/w/p": "x" },
    };
    const theirs: Layout = {
      ...layoutOf("[x] a"),
      groupFronts: { "/w/p": "a", "/w/q": "a" },
    };
    const merged = mergeLayouts(base, mine, theirs).layout;
    expect([merged.collapsed, merged.groupFronts]).toEqual([
      ["/w/p"],
      { "/w/p": "x", "/w/q": "a" },
    ]);
  });

  test("保存の形のまま重ねると、タブごとの route (検索語) はこの窓のものが勝つ", () => {
    const page = (id: string, q: string) => ({
      id,
      preview: false,
      target: { kind: "page", page: "search", project: "/w/p" },
      route: { q },
    });
    const layout = (tabs: unknown[]) => ({
      version: 5,
      focused: "left",
      panes: [{ side: "left", activeId: null, tabs }],
    });
    const merged = mergeSerializedLayouts(
      layout([page("s", "old")]),
      layout([page("s", "mine")]),
      layout([page("s", "theirs")]),
    );
    expect(merged.panes[0].tabs[0].route).toEqual({ q: "mine" });
  });

  // 窓はタブをグループの順に並べ直して持つ (views/main-tabs の normalize)。前に読んだ
  // 保存がこの窓の順になっていない (別の窓の知っているグループの順が違った) とき、
  // 並べ直す前の値と比べると、並べ直しただけのタブを「この窓で動かした」と数え、
  // 別の窓が右へ移したタブを左へ戻していた (実画面で分割が数秒で戻った)。
  // 画面は元をこの窓の順に並べ直してから渡す (baseLayout)。
  test.each([
    {
      name: "並べ直した元と比べる (画面がすること)",
      regrouped: true,
      expected: "x [y] | [l] (left)",
    },
    {
      name: "並べ直す前の元と比べると、右へ移したタブを戻す",
      regrouped: false,
      expected: "x [y] l",
    },
  ])("元はこの窓のグループの順に並べ直して比べる: $name", ({
    regrouped,
    expected,
  }) => {
    const lib = (layout: Layout): Layout => {
      for (const pane of [layout.panes.left, layout.panes.right])
        for (const tab of pane?.tabs ?? [])
          if (tab.id === "l" && tab.target.kind === "file")
            tab.target = { ...tab.target, project: "/w/q" };
      return layout;
    };
    // この窓のグループの順: /w/p (x, y) → /w/q (l)。保存は別の窓の順 (l が先頭)。
    const rank = (tab: { target: TabTarget }) =>
      tab.target.kind !== "terminal" && tab.target.project === "/w/q" ? 1 : 0;
    const base = lib(layoutOf("l x [y]"));
    const mine = regroup(lib(layoutOf("l x [y]")), rank);
    const theirs = lib(layoutOf("x [y] | [l]"));
    const merged = mergeLayouts(
      regrouped ? regroup(base, rank) : base,
      mine,
      theirs,
    );
    expect(show(merged.layout)).toBe(expected);
  });
});
