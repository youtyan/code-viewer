import { describe, expect, test } from "vitest";
import {
  activate,
  activeTab,
  allTabs,
  close,
  emptyLayout,
  frontTab,
  type Layout,
  open,
  splitRight,
  type Tab,
  type TabTarget,
} from "../core/main-tabs";
import { createImageTabReturn } from "../views/image-tab-return";

// タブ列は core/main-tabs の本物の規則 (閉じたら同じ面の直前のタブ・開くと
// その面へフォーカス) で動かす。app.ts が MAIN_TABS に渡すのと同じ 5 つの口だけ。
const shell = (session: string): TabTarget => ({ kind: "terminal", session });
const image = (path: string): TabTarget => ({ kind: "image", path });
const file = (path: string): TabTarget => ({ kind: "file", path });

function label(tab: Tab | null): string {
  if (!tab) return "none";
  const { target } = tab;
  if (target.kind === "terminal") return `shell ${target.session}`;
  if (target.kind === "page") return `page ${target.page}`;
  return `${target.kind} ${target.path}`;
}

function tabsOver(start: Layout) {
  let layout = start;
  return {
    front: () => activeTab(layout),
    panes: () => ({
      split: layout.panes.right !== undefined,
      focused: layout.focused,
      fronts: {
        left: frontTab(layout, "left"),
        right: frontTab(layout, "right"),
      },
      routeSide: null,
    }),
    closeTab: (id: string) => {
      layout = close(layout, id);
    },
    hasTerminal: (session: string) =>
      allTabs(layout).some(
        (tab) =>
          tab.target.kind === "terminal" && tab.target.session === session,
      ),
    openTerminal: (session: string) => {
      layout = open(layout, shell(session), { preview: false });
    },
    /** 棚が app に頼む開き方 (反対の面・1 面なら同じ面)。 */
    openImage: (path: string) => {
      layout = open(layout, image(path), { pane: "other-if-split" });
    },
    /** 利用者がタブ列でそのタブを閉じる ("shell s1" などの名前で)。 */
    closeUserTab: (name: string) => {
      const tab = allTabs(layout).find((item) => label(item) === name);
      if (!tab) throw new Error(`no tab named ${name}`);
      layout = close(layout, tab.id);
    },
    seen: () => ({
      focused: layout.focused,
      left: label(frontTab(layout, "left")),
      right: label(frontTab(layout, "right")),
    }),
  };
}

/** 左の面にシェル s1 とファイル a、フォーカスはシェル。 */
function onePane(): Layout {
  const withShell = open(emptyLayout(), shell("s1"), { preview: false });
  const withFile = open(withShell, file("src/a.ts"), { preview: false });
  const shellTab = allTabs(withFile).find((tab) => label(tab) === "shell s1");
  if (!shellTab) throw new Error("shell tab was not opened");
  return activate(withFile, shellTab.id);
}

/** 左の面にシェル s1 (フォーカス)、右の面にファイル a。 */
function twoPanes(): Layout {
  const layout = onePane();
  const fileTab = allTabs(layout).find((tab) => label(tab) === "file src/a.ts");
  const shellTab = allTabs(layout).find((tab) => label(tab) === "shell s1");
  if (!fileTab || !shellTab) throw new Error("tabs were not opened");
  return activate(splitRight(layout, fileTab.id), shellTab.id);
}

describe("closing an image tab opened from a terminal", () => {
  test("in one pane, the shell that opened the image comes back to the front", () => {
    const tabs = tabsOver(onePane());
    const back = createImageTabReturn(tabs);
    back.open(() => tabs.openImage("/tmp/shot.png"));

    back.close("left");

    expect(tabs.seen()).toEqual({
      focused: "left",
      left: "shell s1",
      right: "none",
    });
  });

  test("in two panes, focus returns to the shell's pane (the image opened in the other pane)", () => {
    const tabs = tabsOver(twoPanes());
    const back = createImageTabReturn(tabs);
    back.open(() => tabs.openImage("/tmp/shot.png"));
    expect(tabs.seen()).toEqual({
      focused: "right",
      left: "shell s1",
      right: "image /tmp/shot.png",
    });

    back.close("right");

    expect(tabs.seen()).toEqual({
      focused: "left",
      left: "shell s1",
      right: "file src/a.ts",
    });
  });

  test("a shell the user closed meanwhile is not reopened", () => {
    const tabs = tabsOver(twoPanes());
    const back = createImageTabReturn(tabs);
    back.open(() => tabs.openImage("/tmp/shot.png"));
    tabs.closeUserTab("shell s1");

    back.close("right");

    expect(tabs.seen()).toEqual({
      focused: "right",
      left: "none",
      right: "file src/a.ts",
    });
  });

  test.each([
    { name: "a shell", pane: "left" as const, message: "a terminal tab" },
    { name: "nothing", pane: "right" as const, message: "empty" },
  ])("closing when the pane front is $name throws instead of closing another tab", ({
    pane,
    message,
  }) => {
    const tabs = tabsOver(onePane());
    const back = createImageTabReturn(tabs);

    expect(() => back.close(pane)).toThrow(
      `image tab close: the ${pane} pane front is ${message}, not an image tab`,
    );
  });
});
