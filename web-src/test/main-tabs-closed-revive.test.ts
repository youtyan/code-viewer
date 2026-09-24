// 閉じたタブが勝手に戻ってくる経路 (直した。回帰テスト)。
//
// 前面がターミナル (か画像) のとき、本文はその下に前の画面 (Data・Diff など) の
// route のまま残り、URL もその route を指す (`/database?terminal=…`)。この状態で
// その画面のタブを閉じる (この窓で × を押す・別の窓で閉じたのが届く) と、前面は
// ターミナルのままなので本文も URL も動かない (main-tabs-view.ts の
// followRouteSide は、前面が route のタブでなければ何もしない)。
// 次に読み直す (pnpm dev の再起動の reload・リロード・窓を開き直す) と、restore は
// 「URL の route のタブが配置に無い」とみて syncRoute で開き直し、前面に出していた。
// 直した: 本文の route のタブが消えたら、前面を変えずに本文を残った route のタブ
// (無ければフォルダ表示) へ置き換える (main-tabs-view.ts の followClosedBody)。

import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import type { SerializedLayout, TabTarget } from "../core/main-tabs";
import type { AppRoute } from "../core/routes";
import {
  createMainTabsView,
  type MainTabsDeps,
} from "../views/main-tabs/main-tabs-view";

beforeAll(() => {
  GlobalRegistrator.register();
});
afterAll(() => {
  GlobalRegistrator.unregister();
});
afterEach(() => {
  document.body.replaceChildren();
});

const ROOT = "/work/sample-app";
const range = { from: "HEAD", to: "worktree" };
const pageRoute = (page: "diff" | "database"): AppRoute =>
  ({ screen: page, range }) as AppRoute;

/** 1 つの窓 (ページ)。読み戻し・保存・本文の移り先を記録する。 */
// ai-dup-check: allow -- ok:画面の部品を 1 つ立てるテストの型。ほかのタブのテストの setup は持ち物が違う (共通化はこの調査の範囲外)
function openWindow(
  saved: unknown,
  current: AppRoute,
  extra: Partial<MainTabsDeps> = {},
) {
  const mount = document.createElement("nav");
  document.body.append(mount);
  let route = current;
  const saves: SerializedLayout[] = [];
  /** replaceBody で置き換えた本文の画面。 */
  const replaced: string[] = [];
  const handle = createMainTabsView({
    mount,
    getLanguage: () => "en",
    pageLabel: (page) => page,
    // app.ts と同じ: 置き換え (replace) は syncRoute(route, false)。
    navigate: (next, replace) => {
      route = next;
      handle.syncRoute(next, !replace);
    },
    replaceBody: (next) => {
      replaced.push(next.screen);
      route = next;
      handle.syncRoute(next, false);
    },
    currentRoute: () => route,
    defaultRoute: (target: TabTarget): AppRoute =>
      target.kind === "page"
        ? ({ screen: target.page, range } as AppRoute)
        : { screen: "repo", ref: "worktree", path: "", range },
    homeRoute: () => ({ screen: "repo", ref: "worktree", path: "", range }),
    copyPath: () => undefined,
    onNewTab: () => undefined,
    stopTerminal: () => undefined,
    terminalMenuItems: () => [],
    loadSaved: async () => ({ layout: saved, rev: 1, root: ROOT }),
    save: async (layout) => {
      saves.push(layout);
      return undefined;
    },
    backupSaved: async () => {
      throw new Error("no backup in this test");
    },
    newTabId: (() => {
      let n = 0;
      return () => `n${++n}`;
    })(),
    terminalInfo: (session) => ({ label: session, state: null }),
    onPanes: () => undefined,
    onTerminals: () => undefined,
    ...extra,
  });
  return {
    handle,
    saves,
    replaced,
    route: () => route,
    /** 左の面の前面のタブの id (無ければ null)。 */
    front: () => handle.layout().panes.left.activeId,
    /** 左の面のタブの中身 (画面は page 名、シェルは session)。 */
    tabs: () =>
      handle
        .layout()
        .panes.left.tabs.map((tab) =>
          tab.target.kind === "page"
            ? tab.target.page
            : tab.target.kind === "terminal"
              ? tab.target.session
              : tab.target.kind,
        ),
  };
}

/** Diff・Data・シェルのタブ。前面はシェル (本文は下の Data)。 */
const withData = {
  version: 5,
  focused: "left",
  panes: [
    {
      side: "left",
      activeId: "sh",
      tabs: [
        {
          id: "df",
          preview: false,
          target: { kind: "page", page: "diff", project: ROOT },
        },
        {
          id: "db",
          preview: false,
          target: { kind: "page", page: "database", project: ROOT },
        },
        {
          id: "sh",
          preview: false,
          target: { kind: "terminal", session: "shell-agent" },
        },
      ],
    },
  ],
};
/** Diff・Data・シェルのタブの配置 (前面を指定する。選んだ順は保存しない)。 */
function layoutOf(ids: readonly string[], front: string) {
  const all = withData.panes[0].tabs;
  return {
    ...withData,
    panes: [
      {
        side: "left",
        activeId: front,
        tabs: ids.map((id) => {
          const tab = all.find((item) => item.id === id);
          if (!tab) throw new Error(`no sample tab ${id}`);
          return tab;
        }),
      },
    ],
  };
}

describe("本文の画面のタブを閉じてから読み直しても、閉じたタブは戻らない", () => {
  test.each([
    {
      name: "前面がターミナルの間に Data を閉じた (本文は残った Diff へ)",
      saved: layoutOf(["df", "db", "sh"], "sh"),
      where: "here",
      body: "diff",
      front: "sh",
      after: ["diff", "shell-agent"],
    },
    {
      name: "前面の Data を閉じた (前面も本文も Diff へ)",
      saved: layoutOf(["df", "db"], "db"),
      where: "here",
      body: "diff",
      front: "df",
      after: ["diff"],
    },
    {
      name: "最後の画面のタブを閉じた (本文はフォルダ表示へ)",
      saved: layoutOf(["db", "sh"], "sh"),
      where: "here",
      body: "repo",
      front: "sh",
      after: ["shell-agent"],
    },
    {
      name: "別の窓で閉じたのが届いた (本文は残った Diff へ)",
      saved: layoutOf(["df", "db", "sh"], "sh"),
      where: "other",
      body: "diff",
      front: "sh",
      after: ["diff", "shell-agent"],
    },
  ] as const)("$name", async ({ saved, where, body, front, after }) => {
    let serverLayout: unknown = saved;
    let serverRev = 1;
    const first = openWindow(saved, pageRoute("database"), {
      loadSaved: async () => ({
        layout: serverLayout,
        rev: serverRev,
        root: ROOT,
      }),
    });
    // 本文 (URL) は database。前面がターミナルなら `/database?terminal=…`。
    await first.handle.restore({ keepSavedFront: true });
    expect(first.tabs()).toContain("database");

    let written: unknown;
    if (where === "here") {
      first.handle.closeTab("db");
      first.handle.flush(false);
      await Promise.resolve();
      written = first.saves[first.saves.length - 1];
    } else {
      written = {
        ...saved,
        panes: [
          {
            ...saved.panes[0],
            tabs: saved.panes[0].tabs.filter((tab) => tab.id !== "db"),
          },
        ],
      };
      serverLayout = written;
      serverRev = 2;
      await first.handle.refreshFromServer();
    }
    const closed = {
      tabs: first.tabs(),
      front: first.front(),
      body: first.route().screen,
    };

    // 読み直す: URL (本文の route) は閉じた後のまま。
    document.body.replaceChildren();
    const reloaded = openWindow(written, first.route());
    await reloaded.handle.restore({ keepSavedFront: true });

    expect({ closed, reloaded: reloaded.tabs() }).toEqual({
      closed: { tabs: after, front, body },
      reloaded: after,
    });
  });

  test("ブックマーク (URL が /database) から開けば、保存に無い Data のタブを作って前面に出す", async () => {
    const saved = layoutOf(["df", "sh"], "df");
    const opened = openWindow(saved, pageRoute("database"));
    await opened.handle.restore();
    const front = opened.handle
      .layout()
      .panes.left.tabs.find((tab) => tab.id === opened.front());
    expect({
      tabs: opened.tabs(),
      front: front?.target.kind === "page" ? front.target.page : null,
      replaced: opened.replaced,
    }).toEqual({
      tabs: ["diff", "database", "shell-agent"],
      front: "database",
      replaced: [],
    });
  });
});
