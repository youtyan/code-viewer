import { readFileSync } from "node:fs";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import { listColumnLayout } from "../core/list-column";
import type { SerializedLayout, TabTarget } from "../core/main-tabs";
import { PHONE_MEDIA_QUERY } from "../core/mobile-layout";
import { HISTORY_WIDTH } from "../core/panel-sizes";
import { lastTabNumber } from "../core/pwa";
import { type AppRoute, urlKeepsSavedFront } from "../core/routes";
import { TAB_FLOOR_UNITS } from "../core/tab-widths";
import { closeContextMenu } from "../views/context-menu";
import type { SavedBase } from "../views/main-tabs/main-tabs-view";
import {
  COMFORTABLE_PANE_WIDTH,
  createMainTabsView,
  type MainTabsDeps,
  type MainTabsHandle,
  routeTarget,
  SPLIT_DIVIDER_WIDTH,
} from "../views/main-tabs/main-tabs-view";

beforeAll(() => {
  GlobalRegistrator.register();
});

afterAll(() => {
  GlobalRegistrator.unregister();
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

const range = { from: "HEAD", to: "worktree" };
const fileRoute = (path: string, line?: number): AppRoute => ({
  screen: "file",
  path,
  ref: "worktree",
  range,
  view: "blob",
  ...(line === undefined ? {} : { line }),
});

/** 画面の route の移り変わりを、app.ts と同じ順 (移る → syncRoute) でまねる。 */
function setup(
  loadSaved: () => Promise<unknown>,
  listColumnWidth?: () => number,
  backupSaved: () => Promise<string> = async () =>
    "/state/main-tabs.json.broken-sample",
  initial: AppRoute = fileRoute("src/app.ts"),
  /** このページのプロジェクトの根 (読み戻しの応答の root)。 */
  root: string | null = null,
  extra: Partial<MainTabsDeps> = {},
) {
  const mount = document.createElement("nav");
  document.body.append(mount);
  const saves: SerializedLayout[] = [];
  /** 書くときに添えた base (前に読んだ・書いた保存)。 */
  const bases: SavedBase[] = [];
  const backups: string[] = [];
  const fronts: string[] = [];
  const terminals: Array<{ open: string[]; closed: string[] }> = [];
  /** ＋ と、ターミナルのタブの右クリックから呼ばれたもの。 */
  const calls: string[] = [];
  /** 本文を移した先と、履歴を積まない (replace) か。 */
  const navigations: Array<{ to: string; replace: boolean }> = [];
  let current: AppRoute = initial;
  const handle: MainTabsHandle = createMainTabsView({
    mount,
    ...(listColumnWidth ? { listColumnWidth } : {}),
    getLanguage: () => "en",
    pageLabel: (page) => page,
    navigate: (route, replace) => {
      navigations.push({
        to: route.screen === "file" ? route.path : route.screen,
        replace: replace === true,
      });
      current = route;
      handle.syncRoute(route);
    },
    currentRoute: () => current,
    defaultRoute: (target: TabTarget): AppRoute =>
      target.kind === "file"
        ? fileRoute(target.path)
        : target.kind === "page"
          ? ({ screen: target.page, range } as AppRoute)
          : { screen: "diff", range },
    homeRoute: () => ({ screen: "repo", ref: "worktree", path: "", range }),
    copyPath: () => undefined,
    onNewTab: (side, anchor) =>
      calls.push(`new:${side}:${anchor.getAttribute("aria-label")}`),
    stopTerminal: (session) => calls.push(`stop:${session}`),
    // session: そのタブのシェル (映しているエージェントの項目を足すため)。
    terminalMenuItems: (session) => {
      calls.push(`menu:${session}`);
      return [
        { label: "Larger text (13)", onSelect: () => calls.push("larger") },
      ];
    },
    loadSaved: async () => ({
      layout: await loadSaved(),
      rev: 1,
      root,
    }),
    save: async (layout, _keepalive, base) => {
      saves.push(layout);
      bases.push(base);
      return undefined;
    },
    backupSaved: async () => {
      backups.push("backup");
      return backupSaved();
    },
    terminalInfo: (session) =>
      session === "shell-a1"
        ? { label: "claude · Working", state: "working" }
        : { label: `Shell ${session}`, state: null },
    onPanes: (view, how) => {
      const tab = view.fronts[view.focused];
      fronts.push(`${tab?.target.kind ?? "none"}:${how}`);
    },
    onTerminals: (open, closed) => {
      terminals.push({ open: [...open], closed });
    },
    ...extra,
  });
  handle.syncRoute(current);
  return {
    mount,
    handle,
    saves,
    bases,
    backups,
    fronts,
    terminals,
    calls,
    navigations,
    current: () => current,
    names: () =>
      [...mount.querySelectorAll(".main-tab")].map(
        (tab) =>
          `${tab.classList.contains("main-tab-active") ? ">" : ""}${tab.querySelector(".main-tab-name")?.textContent}${tab.classList.contains("main-tab-preview") ? " (preview)" : ""}`,
      ),
  };
}

const savedLayout = {
  version: 1,
  focused: "left",
  panes: [
    {
      side: "left",
      activeId: "t1",
      tabs: [
        {
          id: "t1",
          preview: false,
          target: { kind: "file", path: "README.md" },
        },
        { id: "t2", preview: false, target: { kind: "page", page: "diff" } },
        { id: "t3", preview: false, target: { kind: "chart", name: "q" } },
        {
          id: "t4",
          preview: false,
          target: { kind: "image", path: "docs/shot.png" },
        },
        {
          id: "t5",
          preview: false,
          target: { kind: "terminal", session: "shell-ab12" },
        },
      ],
    },
  ],
};

describe("main tabs view: page のタブの検索語と道具", () => {
  // 直す前は保存に route が無く、別のタブを前面にしてリロードすると Search の
  // タブが空で戻っていた。
  const searchRoute: AppRoute = { screen: "search", q: "needle", range };
  const toolsRoute: AppRoute = { screen: "tools", tool: "json", range };

  async function savedWithPages(): Promise<SerializedLayout> {
    const ctx = setup(async () => null, undefined, undefined, searchRoute);
    await ctx.handle.restore();
    ctx.handle.syncRoute(searchRoute);
    ctx.handle.syncRoute(toolsRoute);
    ctx.handle.syncRoute(fileRoute("src/app.ts"));
    ctx.handle.flush(false);
    const saved = ctx.saves[ctx.saves.length - 1];
    if (!saved) throw new Error("expected a saved layout");
    return saved;
  }

  test("背面の Search / Tools のタブの検索語と道具を保存する", async () => {
    const saved = await savedWithPages();
    const routes = saved.panes
      .flatMap((pane) => pane.tabs)
      .map((tab) => [
        tab.target.kind === "page" ? tab.target.page : tab.target.kind,
        tab.route,
      ]);
    expect(routes).toEqual([
      ["search", { q: "needle" }],
      ["tools", { tool: "json" }],
      ["file", undefined],
    ]);
  });

  test("読み戻すと、前面でないタブに戻っても検索語と道具が残る", async () => {
    const saved = await savedWithPages();
    const ctx = setup(
      async () => saved,
      undefined,
      undefined,
      fileRoute("src/app.ts"),
    );
    await ctx.handle.restore();

    ctx.handle.activateNth(1);
    expect(ctx.current()).toEqual(searchRoute);
    ctx.handle.activateNth(2);
    expect(ctx.current()).toEqual(toolsRoute);
  });
  // ファイルのタブは Preview を見ていたかを覚える (前面でないタブがリロードで
  // Code に戻っていた。?preview=1 の見出しへの # が行き先を失う件の片割れ)。
  test("背面のファイルのタブの Preview を保存し、読み戻して戻ると Preview", async () => {
    const previewRoute: AppRoute = {
      screen: "file",
      path: "docs/notes.md",
      ref: "worktree",
      range,
      view: "blob",
      preview: true,
    };
    const first = setup(async () => null, undefined, undefined, previewRoute);
    await first.handle.restore();
    first.handle.openingNewTab(() => first.handle.syncRoute(previewRoute));
    first.handle.openingNewTab(() =>
      first.handle.syncRoute(fileRoute("src/app.ts")),
    );
    first.handle.flush(false);
    const saved = first.saves[first.saves.length - 1];
    if (!saved) throw new Error("expected a saved layout");
    const again = setup(
      async () => saved,
      undefined,
      undefined,
      fileRoute("src/app.ts"),
    );
    await again.handle.restore();
    again.handle.activateNth(1);
    expect([
      saved.panes[0]?.tabs.map((tab) => tab.route),
      again.current(),
    ]).toEqual([[{ preview: true }, undefined], previewRoute]);
  });
});

describe("main tabs view: 読み戻し", () => {
  test("保存した配置に戻り、今の画面のタブを前面に出す", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { handle, names } = setup(async () => savedLayout);
    await handle.restore();
    expect(names()).toEqual([
      "README.md",
      ">app.ts (preview)",
      "diff",
      "shot.png",
      "Shell shell-ab12",
    ]);
  });

  test("知らない種類のタブは件数と中身を console.error に出す (画像とターミナルは残す)", async () => {
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const { handle } = setup(async () => savedLayout);
    await handle.restore();
    const messages = error.mock.calls.map((call) => call.join(" "));
    expect(messages).toEqual([
      expect.stringContaining(
        'dropped 1 saved tab(s) of an unknown kind: [{"at":"panes[0].tabs[2]"',
      ),
    ]);
  });

  test.each([
    {
      name: "退避できたら空から始め、以後は保存する",
      backupSaved: async () => "/state/main-tabs.json.broken-sample",
      saved: 1,
      message: [
        "the saved layout is broken; it was backed up to /state/main-tabs.json.broken-sample and this page starts from an empty layout",
      ],
    },
    {
      name: "退避できなければ上書きせず、このページでは保存しない",
      backupSaved: async () => {
        throw new Error("failed to back up main tabs: sample disk failure");
      },
      saved: 0,
      message: [
        "the saved layout is broken and could not be backed up, so it is kept as it is and tabs are not saved on this page",
        "failed to back up main tabs: sample disk failure",
      ],
    },
  ])("壊れた保存値: $name (理由は全部 console.error に)", async ({
    backupSaved,
    saved,
    message,
  }) => {
    vi.useFakeTimers();
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const broken = {
      version: 0,
      focused: "left",
      panes: [
        {
          side: "left",
          activeId: "zz",
          tabs: [
            { id: "a", preview: true, target: { kind: "file", path: "a" } },
            { id: "b", preview: true, target: { kind: "file", path: "b" } },
          ],
        },
      ],
    };
    const { handle, names, saves, backups } = setup(
      async () => broken,
      undefined,
      backupSaved,
    );
    await handle.restore();
    handle.syncRoute(fileRoute("src/other.ts"));
    vi.advanceTimersByTime(1000);
    vi.useRealTimers();
    expect([backups.length, names(), Math.min(saves.length, 1)]).toEqual([
      1,
      [">other.ts (preview)"],
      saved,
    ]);
    const logged = error.mock.calls.map((call) => call.map(String).join(" "));
    expect(logged).toHaveLength(1);
    for (const reason of [
      ...message,
      JSON.stringify(broken),
      "version is 0, expected one of 1, 2, 3",
      "panes[0] has 2 preview tabs (a, b); at most 1",
      'panes[0].activeId "zz" is not a tab of the pane',
    ])
      expect(logged[0]).toContain(reason);
  });

  // 古い版のアプリへ戻したとき: 新しい版で保存した配置は読めないが、上書き
  // すると新しい版へ戻ったときに消える。使わず、このページでは保存しない。
  test("新しい版の保存値は使わず、上書きもしない", async () => {
    vi.useFakeTimers();
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const newer = { version: 6, focused: "left", panes: [] };
    const { handle, saves, names } = setup(async () => newer);
    await handle.restore();
    handle.syncRoute(fileRoute("src/other.ts"));
    vi.advanceTimersByTime(1000);
    vi.useRealTimers();
    expect([
      saves.length,
      names(),
      error.mock.calls.map((call) => call.map(String).join(" ")),
    ]).toEqual([
      0,
      [">other.ts (preview)"],
      [
        "[code-viewer] main tabs: the saved layout was written by a newer version (layout version 6, this page reads up to layout version 5); it is kept as it is and tabs are not saved on this page",
      ],
    ]);
  });

  test("読めなければ、この画面では保存しない (保存した配置を上書きしない)", async () => {
    vi.useFakeTimers();
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const { handle, saves } = setup(async () => {
      throw new Error("main tabs request failed: 500");
    });
    await handle.restore();
    handle.syncRoute(fileRoute("src/other.ts"));
    vi.advanceTimersByTime(1000);
    vi.useRealTimers();
    expect([saves.length, String(error.mock.calls[0])]).toEqual([
      0,
      expect.stringContaining("tabs are not saved on this page"),
    ]);
  });
});

// プロジェクトに属さないタブ (共通のタブ): プロジェクトを切り替える (= 別の
// プロジェクトのページで読み戻す) と、そのプロジェクトの配置に共通のタブを
// 突き合わせる。savedLayout は、このプロジェクトで保存した配置 (シェル
// shell-ab12 を含む)。
// タブは全プロジェクト共通で、プロジェクトごとのグループに並ぶ (設計: タブと
// プロジェクト)。前の版の「共通のタブ」の節 (別のプロジェクトで開閉した共通の
// タブの突き合わせ) は、タブが全部共通になったので、この節に置き換えた。
describe("main tabs view: プロジェクトのグループ", () => {
  const APP = "/work/sample-app";
  const LIB = "/work/sample-lib";
  const looks: Record<string, { name: string; initials: string }> = {
    [APP]: { name: "sample-app", initials: "SA" },
    [LIB]: { name: "sample-lib", initials: "SL" },
  };
  const groupDeps = (
    calls: string[] = [],
    extra: Partial<MainTabsDeps> = {},
  ): Partial<MainTabsDeps> => ({
    projectOrder: () => [LIB, APP],
    projectLook: (root) =>
      looks[root]
        ? { root, ...looks[root], color: root === APP ? "violet" : "green" }
        : null,
    terminalProject: (session) => (session === "shell-lib" ? LIB : null),
    switchProject: (root, route, tab) =>
      calls.push(
        `switch:${root}:${route ? (route.screen === "file" ? route.path : route.screen) : "-"}:${tab?.id ?? "-"}`,
      ),
    foreignInPlace: () => true,
    newTabId: (() => {
      let n = 0;
      return () => `n${++n}`;
    })(),
    ...extra,
  });
  const owned = (id: string, target: object, project: string) => ({
    id,
    preview: false,
    target: { ...target, project },
  });
  const saved = {
    version: 5,
    focused: "left",
    panes: [
      {
        side: "left",
        activeId: "a1",
        tabs: [
          {
            id: "ag",
            preview: false,
            target: { kind: "page", page: "agents" },
          },
          owned("l1", { kind: "file", path: "lib.ts" }, LIB),
          owned("a1", { kind: "file", path: "src/app.ts" }, APP),
          owned("ld", { kind: "page", page: "diff" }, LIB),
          {
            id: "sh",
            preview: false,
            target: { kind: "terminal", session: "shell-lib" },
          },
          owned("a2", { kind: "file", path: "README.md" }, APP),
        ],
      },
    ],
  };
  /** 左の面のタブ列を、並びのまま短く書く (札は [頭文字 枚数?]、＋ は +)。 */
  const strip = (mount: HTMLElement) =>
    [
      ...(mount.querySelector<HTMLElement>(
        '.main-tabs-pane[data-side="left"] .main-tabs-strip',
      )?.children ?? []),
    ].map((child) => {
      if (child.classList.contains("main-tab-group")) {
        const collapsed = child.classList.contains("main-tab-group-collapsed");
        return `[${child.querySelector(".project-mark")?.textContent}${collapsed ? ` ${child.querySelector(".main-tab-group-count")?.textContent}` : ""}]`;
      }
      if (child.classList.contains("main-tabs-new")) return "+";
      const tabs = [...child.querySelectorAll(".main-tab")].map(
        (tab) =>
          `${tab.classList.contains("main-tab-active") ? ">" : ""}${tab.querySelector(".main-tab-name")?.textContent}`,
      );
      return `${child.getAttribute("data-group") ?? "-"}(${tabs.join(" ")})`;
    });

  test("グループは左の一覧の並び、＋は最後のグループのタブの右、どのプロジェクトのものでもないタブは右端", async () => {
    const { handle, mount } = setup(
      async () => saved,
      undefined,
      undefined,
      fileRoute("src/app.ts"),
      APP,
      groupDeps(),
    );
    await handle.restore();
    expect(strip(mount)).toEqual([
      "[SL]",
      `${LIB}(lib.ts diff Shell shell-lib)`,
      "[SA]",
      `${APP}(>app.ts README.md)`,
      "+",
      "-(agents)",
    ]);
  });

  test("シェルのグループが分かるまでは保存した控えで並べる (読み込み直後にタブが動かない)", async () => {
    let known = false;
    const { handle, mount } = setup(
      async () => ({ ...saved, terminalGroups: { "shell-lib": LIB } }),
      undefined,
      undefined,
      fileRoute("src/app.ts"),
      APP,
      groupDeps([], {
        terminalProject: (session) =>
          known ? (session === "shell-lib" ? LIB : null) : undefined,
      }),
    );
    await handle.restore();
    const before = strip(mount);
    known = true;
    handle.localize();
    expect(before).toEqual(strip(mount));
    expect(before[1]).toBe(`${LIB}(lib.ts diff Shell shell-lib)`);
  });

  test("取り直しの答えがこの窓の保存より古い版なら重ねない (閉じたタブを古い値で戻さない)", async () => {
    vi.useFakeTimers();
    const layouts: unknown[] = [];
    let loads = 0;
    const { handle, mount } = setup(
      async () => saved,
      undefined,
      undefined,
      fileRoute("src/app.ts"),
      APP,
      groupDeps([], {
        // 1 回目は読み戻し (rev 1)。2 回目 (取り直し) は、保存 (rev 2) より前の
        // rev 1 が遅れて届く。
        loadSaved: async () => {
          loads += 1;
          return { layout: saved, rev: 1, root: APP };
        },
        save: async (layout) => {
          layouts.push(layout);
          return { rev: 2, layout, merged: false };
        },
      }),
    );
    await handle.restore();
    mount
      .querySelector<HTMLElement>('.main-tab[data-tab-id="l1"] .main-tab-close')
      ?.click();
    vi.advanceTimersByTime(1000);
    await vi.waitFor(() => expect(layouts.length).toBe(1));
    await Promise.resolve();
    await handle.refreshFromServer();
    vi.useRealTimers();
    expect([loads, strip(mount)[1]]).toEqual([
      2,
      `${LIB}(diff Shell shell-lib)`,
    ]);
  });

  // タブの幅 (fitTabs)。happy-dom は配置をしないので、タブの中身の幅を名前の長さから
  // 作り、列の幅を決めて見る。縮めた幅は各タブの --main-tab-w (style.css の .main-tab)。
  describe("タブの幅", () => {
    const NAME_PX = 8;
    const geometry = (stripWidth: number) => {
      vi.spyOn(
        HTMLElement.prototype,
        "getBoundingClientRect",
      ).mockImplementation(function (this: HTMLElement) {
        let width = 0;
        if (this.classList.contains("main-tab")) {
          const set = this.style.getPropertyValue("--main-tab-w");
          width = set
            ? Number.parseFloat(set)
            : 60 +
              (this.querySelector(".main-tab-name")?.textContent?.length ?? 0) *
                NAME_PX;
        } else if (this.classList.contains("main-tab-group")) width = 60;
        else if (this.classList.contains("main-tab-group-count")) width = 10;
        else if (this.classList.contains("main-tabs-new")) width = 28;
        return {
          left: 0,
          top: 0,
          width,
          height: 34,
          right: width,
          bottom: 34,
        } as DOMRect;
      });
      for (const strip of document.querySelectorAll<HTMLElement>(
        ".main-tabs-strip",
      )) {
        Object.defineProperty(strip, "clientWidth", {
          configurable: true,
          get: () => stripWidth,
        });
        strip.style.setProperty("--space-unit", "4px");
      }
    };
    const widths = (mount: HTMLElement) =>
      Object.fromEntries(
        [...mount.querySelectorAll<HTMLElement>(".main-tab")].map((tab) => [
          tab.querySelector(".main-tab-name")?.textContent,
          tab.style.getPropertyValue("--main-tab-w") || "auto",
        ]),
      );

    test("入りきるなら中身の幅のまま、あふれたら同じ割合で縮め、名前を削りすぎない", async () => {
      const { handle, mount } = setup(
        async () => saved,
        undefined,
        undefined,
        fileRoute("src/app.ts"),
        APP,
        groupDeps(),
      );
      await handle.restore();
      geometry(2000);
      handle.localize();
      const wide = widths(mount);
      geometry(700);
      handle.localize();
      const narrow = widths(mount);
      const floor = 4 * TAB_FLOOR_UNITS;
      // 中身の幅 (この表の作り: 60 + 名前の字数 × 8)。
      const natural = (name: string) => 60 + name.length * NAME_PX;
      expect([
        Object.values(wide).every((w) => w === "auto"),
        // 縮めても下限 (名前が 8 文字ほど読める幅) より細くしない。もともと下限より
        // 細いタブはそのまま (名前は全部出る)。
        Object.entries(narrow).map(([name, w]) => [
          name,
          Number.parseFloat(w) >= Math.min(natural(name ?? ""), floor),
        ]),
        narrow["Shell shell-lib"],
      ]).toEqual([
        true,
        Object.keys(narrow).map((name) => [name, true]),
        `${floor}px`,
      ]);
    });

    test("グループを畳む・開くで、畳んだグループより左のタブの幅は変わらない", async () => {
      const { handle, mount } = setup(
        async () => saved,
        undefined,
        undefined,
        fileRoute("src/app.ts"),
        APP,
        groupDeps(),
      );
      await handle.restore();
      geometry(700);
      handle.localize();
      const before = widths(mount);
      mount
        .querySelector<HTMLElement>(
          `.main-tab-group[data-group="${APP}"] .main-tab-group-toggle`,
        )
        ?.click();
      geometry(700);
      handle.localize();
      const folded = widths(mount);
      // sample-lib (左) のタブと、畳んだ sample-app の前面のタブの幅。
      expect([
        folded["lib.ts"],
        folded.diff,
        folded["Shell shell-lib"],
        folded["app.ts"],
      ]).toEqual([
        before["lib.ts"],
        before.diff,
        before["Shell shell-lib"],
        before["app.ts"],
      ]);
      // 縮めていた (列があふれていた) ことも確かめる。
      expect(before["Shell shell-lib"]).not.toBe("auto");
    });
  });

  test("札を押すと畳み (前面のタブと枚数は残す)、もう一度押すと開く。畳んだことは保存する", async () => {
    vi.useFakeTimers();
    const { handle, mount, saves } = setup(
      async () => saved,
      undefined,
      undefined,
      fileRoute("src/app.ts"),
      APP,
      groupDeps(),
    );
    await handle.restore();
    const toggle = (root: string) =>
      mount
        .querySelector<HTMLElement>(
          `.main-tab-group[data-group="${root}"] .main-tab-group-toggle`,
        )
        ?.click();
    toggle(APP);
    toggle(LIB);
    const folded = strip(mount);
    handle.flush(false);
    const savedCollapsed = saves[saves.length - 1]?.collapsed;
    toggle(APP);
    vi.useRealTimers();
    expect([folded, savedCollapsed, strip(mount)]).toEqual([
      ["[SL 3]", `${LIB}()`, "[SA 2]", `${APP}(>app.ts)`, "+", "-(agents)"],
      [APP, LIB],
      [
        "[SL 3]",
        `${LIB}()`,
        "[SA]",
        `${APP}(>app.ts README.md)`,
        "+",
        "-(agents)",
      ],
    ]);
  });

  test("別のプロジェクトの画面のタブを前面に出すと、そのプロジェクトへ移る (このページでは開かない)", async () => {
    const calls: string[] = [];
    const { handle, mount, navigations } = setup(
      async () => saved,
      undefined,
      undefined,
      fileRoute("src/app.ts"),
      APP,
      groupDeps(calls),
    );
    await handle.restore();
    const before = navigations.length;
    mount.querySelector<HTMLElement>('.main-tab[data-tab-id="ld"]')?.click();
    expect([
      calls,
      navigations.slice(before),
      handle.panes().fronts.left?.id,
      handle.panes().routeSide,
    ]).toEqual([[`switch:${LIB}:diff:ld`], [], "ld", null]);
  });

  test.each([
    { name: "入口の下 (その場で出せる)", inPlace: true, calls: [] },
    {
      name: "1 つで完結するサーバ (移って出す)",
      inPlace: false,
      calls: [`switch:${LIB}:lib.ts:l1`],
    },
  ])("別のプロジェクトのファイル: $name", async ({
    inPlace,
    calls: expected,
  }) => {
    const calls: string[] = [];
    const { handle, mount, navigations } = setup(
      async () => saved,
      undefined,
      undefined,
      fileRoute("src/app.ts"),
      APP,
      groupDeps(calls, { foreignInPlace: () => inPlace }),
    );
    await handle.restore();
    const before = navigations.length;
    mount.querySelector<HTMLElement>('.main-tab[data-tab-id="l1"]')?.click();
    // 本文 (このページの route) は移らない: ファイルは面の箱に出す (app.ts)。
    expect([
      calls,
      navigations.slice(before),
      handle.panes().fronts.left?.id,
      handle.isRouteTab(handle.panes().fronts.left),
      handle.paneRoute("right"),
    ]).toEqual([expected, [], "l1", false, null]);
  });

  test.each([
    {
      name: "前に見ていたこのプロジェクトのタブへ",
      tabs: ["ld", "a1", "a2"],
      seen: ["a1", "a2"],
      expected: "a1",
    },
    {
      name: "このプロジェクトのタブが無ければ本文の既定 (フォルダ表示)",
      tabs: ["ld", "a2"],
      seen: ["a2"],
      expected: null,
    },
  ])("閉じたあとの前面が別のプロジェクトの画面になるなら、移らない: $name", async ({
    tabs,
    seen,
    expected,
  }) => {
    const calls: string[] = [];
    const all = saved.panes[0].tabs;
    const layout = {
      ...saved,
      panes: [
        {
          side: "left",
          activeId: seen[0],
          tabs: tabs.map((id) => all.find((tab) => tab.id === id)),
        },
      ],
    };
    const { handle, mount } = setup(
      async () => layout,
      undefined,
      undefined,
      fileRoute("README.md"),
      APP,
      groupDeps(calls),
    );
    await handle.restore();
    for (const id of seen)
      mount
        .querySelector<HTMLElement>(`.main-tab[data-tab-id="${id}"]`)
        ?.click();
    // 最後に見た a2 を閉じる: 並びの隣は別のプロジェクトの Diff。
    mount
      .querySelector<HTMLElement>('.main-tab[data-tab-id="a2"] .main-tab-close')
      ?.click();
    expect([calls, handle.panes().fronts.left?.id ?? null]).toEqual([
      [],
      expected,
    ]);
  });

  test("このページのプロジェクトで開いたファイルは、このプロジェクトのグループに入る", async () => {
    const { handle, mount } = setup(
      async () => saved,
      undefined,
      undefined,
      fileRoute("src/app.ts"),
      APP,
      groupDeps(),
    );
    await handle.restore();
    // 前面を別のプロジェクトのファイルにしてから、木で開いたファイル (URL の route)。
    mount.querySelector<HTMLElement>('.main-tab[data-tab-id="l1"]')?.click();
    handle.syncRoute(fileRoute("docs/new.md"));
    expect(strip(mount)).toEqual([
      "[SL]",
      `${LIB}(lib.ts diff Shell shell-lib)`,
      "[SA]",
      `${APP}(app.ts README.md >new.md)`,
      "+",
      "-(agents)",
    ]);
  });

  test("▾ のメニュー: このプロジェクトに切り替える (そのグループで最後に前面だったタブ)・このグループを閉じる", async () => {
    const calls: string[] = [];
    const { handle, mount } = setup(
      async () => ({ ...saved, groupFronts: { [LIB]: "sh" } }),
      undefined,
      undefined,
      fileRoute("src/app.ts"),
      APP,
      groupDeps(calls),
    );
    await handle.restore();
    const menuItems = (root: string) => {
      mount
        .querySelector<HTMLElement>(
          `.main-tab-group[data-group="${root}"] .main-tab-group-menu`,
        )
        ?.click();
      const items = [
        ...document.querySelectorAll<HTMLElement>(
          ".gdp-context-menu [role=menuitem]",
        ),
      ];
      return items;
    };
    const here = menuItems(APP).map(
      (item) =>
        `${item.textContent}${(item as HTMLButtonElement).disabled ? " (disabled)" : ""}`,
    );
    closeContextMenu();
    menuItems(LIB)
      .find((item) => item.textContent === "Switch to this project")
      ?.click();
    menuItems(LIB)
      .find((item) => item.textContent === "Close this group")
      ?.click();
    expect([here, calls, strip(mount)]).toEqual([
      [
        // 札には頭文字しか無いので、メニューの頭にプロジェクトの名前。
        "sample-app (disabled)",
        // 新しいシェル・エージェントの口 (newShellIn・launchAgentIn) が無い。
        "New shell (disabled)",
        "New agent… (disabled)",
        "Switch to this project (disabled)",
        "Collapse",
        "Close this group",
      ],
      [`switch:${LIB}:-:sh`],
      ["[SA]", `${APP}(>app.ts README.md)`, "+", "-(agents)"],
    ]);
  });

  describe("▾ のメニューの新しいシェル・エージェント", () => {
    /** 開いたメニューの並び (区切りは ---、押せない項目は (disabled)、title は [ ])。 */
    const openGroupMenu = (mount: HTMLElement, root: string) => {
      mount
        .querySelector<HTMLElement>(
          `.main-tab-group[data-group="${root}"] .main-tab-group-menu`,
        )
        ?.click();
      return [
        ...(document.querySelector(".gdp-context-menu")?.children ?? []),
      ] as HTMLElement[];
    };
    const describeMenu = (items: HTMLElement[]) =>
      items.map((item) =>
        item.tagName === "HR"
          ? "---"
          : `${item.textContent}${(item as HTMLButtonElement).disabled ? " (disabled)" : ""}`,
      );
    const pick = (mount: HTMLElement, root: string, label: string) => {
      const item = openGroupMenu(mount, root).find(
        (el) => el.textContent === label,
      );
      if (!item) throw new Error(`no menu item ${label} for ${root}`);
      item.click();
    };
    /**
     * app.ts の口をまねる: newShellIn はそのプロジェクトのシェル (shell-new-<n>)
     * を作って openTerminal でその面に置き、terminalProject はそのシェルの
     * プロジェクトを返す。
     */
    const setupWithActions = async (
      facts: ReturnType<NonNullable<MainTabsDeps["groupFacts"]>> = {
        shellUnavailable: null,
        git: true,
      },
      foreignInPlace = true,
    ) => {
      const calls: string[] = [];
      const shells = new Map<string, string>([["shell-lib", LIB]]);
      const ref: { handle?: MainTabsHandle } = {};
      const ctx = setup(
        async () => saved,
        undefined,
        undefined,
        fileRoute("src/app.ts"),
        APP,
        groupDeps(calls, {
          terminalProject: (session) => shells.get(session) ?? null,
          foreignInPlace: () => foreignInPlace,
          groupFacts: () => facts,
          newShellIn: (root, side) => {
            const session = `shell-new-${shells.size}`;
            shells.set(session, root);
            calls.push(`shell:${root}:${side}`);
            ref.handle?.openTerminal(session, side);
          },
          launchAgentIn: (root) => calls.push(`agent:${root}`),
        }),
      );
      ref.handle = ctx.handle;
      await ctx.handle.restore();
      return { ...ctx, calls };
    };

    test("既存の項目の上に、区切り線で分けて並ぶ", async () => {
      const { mount } = await setupWithActions();
      expect(describeMenu(openGroupMenu(mount, LIB))).toEqual([
        "sample-lib (disabled)",
        "---",
        "New shell",
        "New agent…",
        "---",
        "Switch to this project",
        "Collapse",
        "---",
        "Close this group",
      ]);
    });

    test.each([
      {
        name: "いま見ているプロジェクトのグループ",
        root: APP,
        expected: [
          "[SL]",
          `${LIB}(lib.ts diff Shell shell-lib)`,
          "[SA]",
          // 前面が同じグループなら、その右 (＋ と同じ)。
          `${APP}(app.ts >Shell shell-new-1 README.md)`,
          "+",
          "-(agents)",
        ],
      },
      {
        name: "別のプロジェクトのグループ (前面は別のグループ)",
        root: LIB,
        expected: [
          "[SL]",
          `${LIB}(lib.ts diff Shell shell-lib >Shell shell-new-1)`,
          "[SA]",
          `${APP}(app.ts README.md)`,
          "+",
          "-(agents)",
        ],
      },
    ])("新しいシェル: $name のプロジェクトで作り、できたタブはそのグループに入って前面になる", async ({
      root,
      expected,
    }) => {
      const { mount, calls } = await setupWithActions();
      pick(mount, root, "New shell");
      expect([calls, strip(mount)]).toEqual([[`shell:${root}:left`], expected]);
    });

    test.each([
      { name: "いま見ているプロジェクト", root: APP },
      { name: "別のプロジェクト", root: LIB },
    ])("新しいエージェント…: $name を選んだ起動の画面を開く (移らない)", async ({
      root,
    }) => {
      const { mount, calls } = await setupWithActions();
      pick(mount, root, "New agent…");
      expect(calls).toEqual([`agent:${root}`]);
    });

    test.each([
      {
        name: "シェルが使えない",
        facts: { shellUnavailable: "node-pty is missing", git: true },
        foreignInPlace: true,
        root: LIB,
        expected: [
          "New shell (disabled) [node-pty is missing]",
          "New agent… [Start an agent in sample-lib]",
        ],
      },
      {
        name: "1 つで完結するサーバの、別のプロジェクト",
        facts: { shellUnavailable: null, git: true },
        foreignInPlace: false,
        root: LIB,
        expected: [
          "New shell (disabled) [Switch to this project to open a shell in it]",
          "New agent… [Start an agent in sample-lib]",
        ],
      },
      {
        name: "1 つで完結するサーバの、いま見ているプロジェクト",
        facts: { shellUnavailable: null, git: true },
        foreignInPlace: false,
        root: APP,
        expected: [
          "New shell [Open a new shell in sample-app]",
          "New agent… [Start an agent in sample-app]",
        ],
      },
      {
        name: "git でない別のプロジェクト",
        facts: { shellUnavailable: null, git: false },
        foreignInPlace: true,
        root: LIB,
        expected: [
          "New shell [Open a new shell in sample-lib]",
          "New agent… (disabled) [Agents can only be started in a git repository]",
        ],
      },
      {
        name: "git でない、いま見ているプロジェクト (起動の画面はこのサーバの根を選べる)",
        facts: { shellUnavailable: null, git: false },
        foreignInPlace: true,
        root: APP,
        expected: [
          "New shell [Open a new shell in sample-app]",
          "New agent… [Start an agent in sample-app]",
        ],
      },
    ])("押せないときは理由を title に出す: $name", async ({
      facts,
      foreignInPlace,
      root,
      expected,
    }) => {
      const { mount, calls } = await setupWithActions(facts, foreignInPlace);
      const items = openGroupMenu(mount, root)
        .filter((item) => /^New /.test(item.textContent ?? ""))
        .map(
          (item) =>
            `${describeMenu([item])[0]} [${(item as HTMLButtonElement).title}]`,
        );
      // 押せない項目を押しても何も作らない。
      for (const label of ["New shell", "New agent…"]) pick(mount, root, label);
      closeContextMenu();
      expect([items, calls.length]).toEqual([
        expected,
        expected.filter((item) => !item.includes("(disabled)")).length,
      ]);
    });
  });

  test("別のグループの間には落とせない (印も出さない)。同じグループの中は落とせる", async () => {
    const { handle, mount } = setup(
      async () => saved,
      undefined,
      undefined,
      fileRoute("src/app.ts"),
      APP,
      groupDeps(),
    );
    await handle.restore();
    const el = (id: string) =>
      mount.querySelector<HTMLElement>(
        `.main-tab[data-tab-id="${id}"]`,
      ) as HTMLElement;
    const stripEl = mount.querySelector<HTMLElement>(
      '.main-tabs-pane[data-side="left"] .main-tabs-strip',
    ) as HTMLElement;
    // happy-dom は配置をしないので、タブの矩形を並びの順に 100px ずつ置く。
    const order = ["l1", "ld", "sh", "a1", "a2", "ag"];
    for (const [index, id] of order.entries())
      el(id).getBoundingClientRect = () =>
        ({
          left: index * 100,
          width: 100,
          right: index * 100 + 100,
        }) as DOMRect;
    const drag = (id: string, x: number) => {
      el(id).dispatchEvent(new Event("dragstart", { bubbles: true }));
      const over = new Event("dragover", { bubbles: true, cancelable: true });
      Object.assign(over, { clientX: x });
      stripEl.dispatchEvent(over);
      const marked = [...mount.querySelectorAll(".main-tab-drop-before")].map(
        (tab) => (tab as HTMLElement).dataset.tabId,
      );
      el(id).dispatchEvent(new Event("dragend", { bubbles: true }));
      return [over.defaultPrevented, marked];
    };
    // a2 を l1 の前 (別のグループ) へ / a1 の前 (同じグループ) へ。
    expect([drag("a2", 10), drag("a2", 310)]).toEqual([
      [false, []],
      [true, ["a1"]],
    ]);
  });
});

describe("main tabs view: 操作", () => {
  test("タブを押すとそのタブが最後に見ていた route へ移る", async () => {
    const { handle, mount, names } = setup(async () => null);
    await handle.restore();
    const lined = fileRoute("src/app.ts", 12);
    handle.openingNewTab(() => handle.syncRoute(lined));
    handle.syncRoute({ screen: "diff", range });
    mount.querySelector<HTMLElement>(".main-tab")?.click();
    expect([names(), handle.layout().panes.left.tabs[0].target]).toEqual([
      [">app.ts", "diff"],
      { kind: "file", path: "src/app.ts", line: 12 },
    ]);
  });

  // ui-surface.md の「タブの決まり」: 固定の押し方は、仮のタブを置き換えず固定で
  // 足し、同じ中身の仮のタブがあれば前面に出して固定にする。
  test.each([
    {
      name: "別のファイルは固定で足す (仮のタブは残る)",
      path: "src/other.ts",
      opened: ["app.ts (preview)", ">other.ts"],
      // 印は run の間だけ: 次の 1 回押すは仮のタブ (残っていた仮を置き換える)。
      next: [">third.ts (preview)", "other.ts"],
    },
    {
      name: "同じファイルの仮のタブは固定にする",
      path: "src/app.ts",
      opened: [">app.ts"],
      next: ["app.ts", ">third.ts (preview)"],
    },
  ])("openingNewTab: $name", async ({ path, opened, next }) => {
    const { handle, names } = setup(async () => null);
    await handle.restore();
    handle.openingNewTab(() => handle.syncRoute(fileRoute(path)));
    const afterOpen = names();
    handle.syncRoute(fileRoute("src/third.ts"));
    expect([afterOpen, names()]).toEqual([opened, next]);
  });

  // 数秒おきの描き直し (エージェントの状態で名前を当て直す) で、面の箱ごと外して
  // 付け直していたので ＋・分割のボタンのフォーカスが毎回消えていた。
  test("描き直しても ＋ のフォーカスと面の箱は残る", async () => {
    const { handle, mount } = setup(async () => null);
    await handle.restore();
    const pane = mount.querySelector(".main-tabs-pane");
    const plus = mount.querySelector<HTMLButtonElement>(".main-tabs-action");
    plus?.focus();
    handle.localize();
    expect([
      mount.querySelector(".main-tabs-pane") === pane,
      document.activeElement === plus,
      plus?.getAttribute("aria-haspopup"),
    ]).toEqual([true, true, "menu"]);
  });

  test("タブの名前に閉じるボタンの名前が混ざらず、ContextMenu キーで右クリックのメニューが開く", async () => {
    const { handle, mount } = setup(async () => null);
    await handle.restore();
    const tab = mount.querySelector<HTMLElement>(".main-tab-active");
    tab?.focus();
    tab?.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "F10",
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect([
      tab?.querySelector(".main-tab-close")?.getAttribute("aria-hidden"),
      document.querySelectorAll(".gdp-context-menu [role=menuitem]").length > 0,
    ]).toEqual(["true", true]);
    // 開いたメニューは文書のキーを受け続けるので、次の検査の前に閉じる。
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(document.querySelector(".gdp-context-menu")).toBeNull();
  });

  // 利用者が閉じたタブだけを開き直す (シェルが消えて閉じたタブは積まない)。
  test("reopenClosed: × で閉じたタブを固定で開き直し、closeTerminal で閉じたものは積まない", async () => {
    const { handle, mount, names } = setup(async () => null);
    await handle.restore();
    handle.openingNewTab(() => handle.syncRoute(fileRoute("src/b.ts")));
    mount
      .querySelector<HTMLElement>(".main-tab-active .main-tab-close")
      ?.click();
    handle.openTerminal("shell-a1");
    handle.closeTerminal("shell-a1");
    const afterClose = names();
    const first = handle.reopenClosed();
    const afterReopen = names();
    const second = handle.reopenClosed();
    expect([afterClose, first, afterReopen, second]).toEqual([
      [">app.ts (preview)"],
      true,
      ["app.ts (preview)", ">b.ts"],
      false,
    ]);
  });

  // Ctrl+Shift+PageUp / PageDown を OS やブラウザが先に取る環境の代わり。
  test.each([
    { name: "Ctrl+Shift+←", init: { key: "ArrowLeft", ctrlKey: true } },
    { name: "⌘+Shift+←", init: { key: "ArrowLeft", metaKey: true } },
    { name: "Ctrl+Shift+PageUp", init: { key: "PageUp", ctrlKey: true } },
  ])("タブ列の $name で前面のタブを 1 つ左へ", async ({ init }) => {
    const { handle, mount, names } = setup(async () => null);
    await handle.restore();
    handle.openingNewTab(() => handle.syncRoute(fileRoute("src/b.ts")));
    const front = mount.querySelector<HTMLElement>(".main-tab-active");
    front?.focus();
    front?.dispatchEvent(
      new KeyboardEvent("keydown", {
        shiftKey: true,
        bubbles: true,
        cancelable: true,
        ...init,
      }),
    );
    expect([
      names(),
      (document.activeElement as HTMLElement).dataset.tabId ===
        front?.dataset.tabId,
    ]).toEqual([[">b.ts", "app.ts (preview)"], true]);
  });

  test("右クリックの「左へ移す」「右へ移す」で同じ面の中を動かす", async () => {
    const { handle, mount, names } = setup(async () => null);
    await handle.restore();
    handle.openingNewTab(() => handle.syncRoute(fileRoute("src/b.ts")));
    const pick = (label: string) => {
      mount
        .querySelector(".main-tab-active")
        ?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
      [
        ...document.querySelectorAll<HTMLButtonElement>(
          ".gdp-context-menu [role=menuitem]",
        ),
      ]
        .find((item) => item.textContent === label)
        ?.click();
      return names();
    };
    expect([pick("Move left"), pick("Move right")]).toEqual([
      [">b.ts", "app.ts (preview)"],
      ["app.ts (preview)", ">b.ts"],
    ]);
  });

  // メニューを開いている間もタブ列は描き直され、開いたときのタブの要素は外れる。
  test("Shift+F10 のメニューを Escape で閉じると、描き直しの後でも同じタブへ戻る", async () => {
    const { handle, mount } = setup(async () => null);
    await handle.restore();
    const tab = mount.querySelector<HTMLElement>(".main-tab-active");
    const id = tab?.dataset.tabId;
    tab?.focus();
    tab?.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "F10",
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    handle.localize();
    (document.activeElement as HTMLElement).dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
    await Promise.resolve();
    const active = document.activeElement as HTMLElement;
    expect([
      active === tab,
      active.classList.contains("main-tab"),
      active.dataset.tabId === id,
    ]).toEqual([false, true, true]);
  });

  // 版が違えば別のタブ。名前は作業ツリー以外の版だけ短い印を添える。
  test.each([
    {
      name: "コミット (sha は 7 文字)",
      ref: "1a2b3c4d5e6f7a8b",
      label: "app.ts @ 1a2b3c4",
    },
    { name: "HEAD はそのまま", ref: "HEAD", label: "app.ts @ HEAD" },
  ])("作業ツリーの版の横に $name の版を別のタブで開く", async ({
    ref,
    label,
  }) => {
    const { handle, mount, names } = setup(async () => null);
    await handle.restore();
    handle.openingNewTab(() =>
      handle.syncRoute({
        screen: "file",
        path: "src/app.ts",
        ref,
        range,
        view: "blob",
      }),
    );
    const front = mount.querySelector<HTMLElement>(".main-tab-active");
    expect([names(), front?.title]).toEqual([
      // 作業ツリーの版の仮のタブは差し替わらずに残る。
      ["app.ts (preview)", `>${label}`],
      `src/app.ts @ ${ref}`,
    ]);
  });

  // ＋ は最後のタブのすぐ右 (列の右端でなく、タブと一緒に動き一緒に送られる)。
  // tablist にはタブだけ。分割のボタンは列の外の右端。タブが 0 枚なら ＋ は列の左端。
  test.each([
    { name: "タブ 0 枚", count: 0 },
    { name: "タブ 1 枚", count: 1 },
    { name: "タブ 3 枚", count: 3 },
  ])("＋ の置き場所: $name", async ({ count }) => {
    const { handle, mount } = setup(async () => null);
    await handle.restore();
    handle.closeActive();
    for (let n = 0; n < count; n += 1)
      handle.openingNewTab(() => handle.syncRoute(fileRoute(`src/t${n}.ts`)));
    const strip = mount.querySelector<HTMLElement>(".main-tabs-strip");
    const list = strip?.querySelector<HTMLElement>("[role=tablist]");
    const plus = mount.querySelector<HTMLElement>(".main-tabs-new");
    expect([
      [...(strip?.children ?? [])].map((child) => child.className),
      [...(list?.children ?? [])].every((child) =>
        child.classList.contains("main-tab"),
      ),
      list?.children.length,
      plus?.previousElementSibling === list,
      mount.querySelector(".main-tabs-split")?.closest(".main-tabs-strip"),
    ]).toEqual([
      ["main-tabs-list", "main-tabs-action main-tabs-new"],
      true,
      count,
      true,
      null,
    ]);
  });

  // タブ列のキー (roving tabindex)。←→ Home End は移るだけで前面は変えない。
  test("タブ列のキー: ←→ Home End で移り、Enter で前面、Ctrl+Shift+PageDown で並べ替え、Delete で閉じる", async () => {
    const { handle, mount, names } = setup(async () => null);
    await handle.restore();
    handle.openingNewTab(() => handle.syncRoute(fileRoute("src/app.ts")));
    handle.openingNewTab(() => handle.syncRoute(fileRoute("src/b.ts")));
    handle.openingNewTab(() => handle.syncRoute(fileRoute("src/c.ts")));
    const press = (key: string, init: KeyboardEventInit = {}) =>
      (document.activeElement as HTMLElement).dispatchEvent(
        new KeyboardEvent("keydown", {
          key,
          bubbles: true,
          cancelable: true,
          ...init,
        }),
      );
    const focused = () =>
      (document.activeElement as HTMLElement).querySelector(".main-tab-name")
        ?.textContent;
    mount.querySelector<HTMLElement>(".main-tab-active")?.focus();
    const seen: unknown[] = [focused()];
    press("Home");
    seen.push(focused());
    press("ArrowLeft");
    seen.push(focused());
    press("ArrowRight");
    seen.push(focused(), names());
    press("Enter");
    seen.push(names());
    press("PageDown", { ctrlKey: true, shiftKey: true });
    seen.push(names(), focused());
    press("Delete");
    seen.push(names(), focused());
    expect(seen).toEqual([
      "c.ts",
      "app.ts",
      "c.ts", // 端で折り返す
      "app.ts",
      ["app.ts", "b.ts", ">c.ts"], // 移るだけでは前面を変えない
      [">app.ts", "b.ts", "c.ts"],
      ["b.ts", ">app.ts", "c.ts"],
      "app.ts",
      ["b.ts", ">c.ts"], // 最近使った順で次を前面に
      "c.ts",
    ]);
  });

  test("名前の当て直し (数秒おきの描き直し) でも、キーボードでいたタブのフォーカスを失わない", async () => {
    const { handle, mount } = setup(async () => savedLayout);
    await handle.restore();
    const second = mount.querySelectorAll<HTMLElement>(".main-tab")[1];
    const id = second.dataset.tabId;
    second.focus();
    handle.localize();
    const focused = document.activeElement as HTMLElement | null;
    expect([
      second.isConnected,
      focused?.classList.contains("main-tab"),
      focused?.dataset.tabId,
    ]).toEqual([false, true, id]);
  });

  test("描き直しは、タブの外にあるフォーカスを動かさない", async () => {
    const { handle } = setup(async () => savedLayout);
    await handle.restore();
    const input = document.createElement("input");
    document.body.append(input);
    input.focus();
    handle.localize();
    expect(document.activeElement).toBe(input);
  });

  test("選択中のタブを閉じたら直前のタブへ、最後の 1 つなら本文の既定 (フォルダ表示) へ", async () => {
    const { handle, names, current } = setup(async () => null);
    await handle.restore();
    handle.syncRoute({ screen: "diff", range });
    handle.closeActive();
    const afterFirst = names();
    handle.closeActive();
    expect([afterFirst, names(), current().screen]).toEqual([
      [">app.ts (preview)"],
      [],
      "repo",
    ]);
  });

  test("フォルダ表示の route はタブにせず、左の面の選択を外す (タブは残す)", async () => {
    const { handle, names, fronts } = setup(async () => null);
    await handle.restore();
    handle.syncRoute({ screen: "repo", ref: "worktree", path: "src", range });
    expect([names(), handle.front(), fronts[fronts.length - 1]]).toEqual([
      ["app.ts (preview)"],
      null,
      "none:sync",
    ]);
  });

  test("Files の入口 (showHome) は最後に見ていたフォルダへ戻り、タブを選べば戻る", async () => {
    const { handle, mount, current } = setup(async () => null);
    await handle.restore();
    const folder: AppRoute = {
      screen: "repo",
      ref: "worktree",
      path: "src/lib",
      range,
    };
    handle.syncRoute(folder);
    handle.syncRoute({ screen: "diff", range });
    handle.showHome();
    const home = current();
    mount.querySelector<HTMLElement>(".main-tab")?.click();
    expect([home, current()]).toEqual([folder, fileRoute("src/app.ts")]);
  });

  test("右クリックのメニューは分割の 2 項目を無効にする", async () => {
    const { handle, mount } = setup(async () => null);
    await handle.restore();
    mount
      .querySelector(".main-tab")
      ?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
    const items = [
      ...document.querySelectorAll<HTMLButtonElement>(
        ".gdp-context-menu [role=menuitem]",
      ),
    ].map((item) => `${item.textContent}${item.disabled ? " (disabled)" : ""}`);
    expect(items).toEqual([
      "Close",
      "Close others (disabled)",
      "Close to the right (disabled)",
      "Keep open",
      "Split right (disabled)",
      "Move to other side (disabled)",
      "Move left (disabled)",
      "Move right (disabled)",
      "Copy path",
    ]);
  });

  // キーの入口 (g m)。前面のタブの右クリックと同じメニューを、そのタブの下に開く。
  test("openFrontMenu は前面のタブの右クリックと同じメニューを開く", async () => {
    const { handle, mount } = setup(async () => null);
    await handle.restore();
    mount
      .querySelector(".main-tab")
      ?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
    const byRightClick = menuLabels();
    closeContextMenu();
    const opened = handle.openFrontMenu();
    expect([opened, menuLabels()]).toEqual([true, byRightClick]);
  });

  test("openFrontMenu は前面のタブが無ければ開かない", async () => {
    const { handle } = setup(async () => null);
    await handle.restore();
    handle.showHome();
    expect([handle.openFrontMenu(), menuLabels()]).toEqual([false, []]);
  });
});

/** 開いている右クリックのメニューの項目 (押せないものに印)。 */
function menuLabels(): string[] {
  return [
    ...document.querySelectorAll<HTMLButtonElement>(
      ".gdp-context-menu [role=menuitem]",
    ),
  ].map((item) => `${item.textContent}${item.disabled ? " (disabled)" : ""}`);
}

describe("main tabs view: ターミナルのタブ", () => {
  test("右クリックに端末の操作と「セッションを止める」が並び、どちらもそのシェルで呼ぶ", async () => {
    const { handle, mount, calls } = setup(async () => null);
    await handle.restore();
    handle.openTerminal("shell-a1");
    mount
      .querySelector(".main-tab-active")
      ?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
    const labels = menuLabels();
    const stop = [
      ...document.querySelectorAll<HTMLButtonElement>(
        ".gdp-context-menu [role=menuitem]",
      ),
    ].find((item) => item.textContent === "Stop session");
    stop?.click();
    expect([labels, stop?.classList.contains("danger"), calls]).toEqual([
      [
        "Close",
        "Close others",
        "Close to the right (disabled)",
        "Keep open (disabled)",
        "Split right (disabled)",
        "Move to other side (disabled)",
        "Move left",
        "Move right (disabled)",
        "Larger text (13)",
        "Stop session",
        "Copy path (disabled)",
      ],
      true,
      ["menu:shell-a1", "stop:shell-a1"],
    ]);
  });

  test("ファイルのタブの右クリックには「セッションを止める」を出さない", async () => {
    const { handle, mount } = setup(async () => null);
    await handle.restore();
    mount
      .querySelector(".main-tab")
      ?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
    expect(menuLabels().filter((label) => label === "Stop session")).toEqual(
      [],
    );
  });

  test("＋ はその面のボタンを渡してメニューを頼み、キー操作はフォーカスのある面の ＋", async () => {
    const { handle, mount, calls } = setup(async () => null);
    await handle.restore();
    mount.querySelector<HTMLButtonElement>(".main-tabs-action")?.click();
    handle.openNewTabMenu();
    expect(calls).toEqual([
      "new:left:New tab: a file, a new shell, or a session",
      "new:left:New tab: a file, a new shell, or a session",
    ]);
  });

  test("開くと前面になり、名前はエージェントの種類と状態、印は状態の形", async () => {
    const { handle, mount, names, fronts } = setup(async () => null);
    await handle.restore();
    handle.openTerminal("shell-a1");
    const icon = mount.querySelector(".main-tab-active .main-tab-icon i");
    expect([names(), icon?.className, fronts[fronts.length - 1]]).toEqual([
      ["app.ts (preview)", ">claude · Working"],
      "terminal-mark terminal-mark-working",
      "terminal:stay",
    ]);
  });

  test("ターミナルから前の画面のタブへ戻るとき、同じ route なら移り直さない", async () => {
    const { handle, mount, fronts, current } = setup(async () => null);
    await handle.restore();
    const before = current();
    handle.openTerminal("shell-a1");
    mount.querySelector<HTMLElement>(".main-tab")?.click();
    expect([current(), fronts[fronts.length - 1]]).toEqual([
      before,
      "file:stay",
    ]);
  });

  test("URL の置き換え (activate = false) では前面のターミナルを奪わない", async () => {
    const { handle, names } = setup(async () => null);
    await handle.restore();
    handle.openTerminal("shell-a1");
    handle.syncRoute(fileRoute("src/app.ts", 3), false);
    handle.syncRoute({ screen: "diff", range }, true);
    expect(names()).toEqual(["app.ts (preview)", "claude · Working", ">diff"]);
  });

  test("閉じるとシェルの購読をやめるよう知らせる (シェルは止めない)", async () => {
    const { handle, terminals, names } = setup(async () => null);
    await handle.restore();
    handle.openTerminal("shell-a1");
    handle.openTerminal("shell-b2");
    const before = handle.terminalSessions();
    handle.closeTerminal("shell-a1");
    expect([
      before,
      handle.terminalSessions(),
      terminals[terminals.length - 1],
      names(),
    ]).toEqual([
      ["shell-a1", "shell-b2"],
      ["shell-b2"],
      { open: ["shell-b2"], closed: ["shell-a1"] },
      ["app.ts (preview)", ">Shell shell-b2"],
    ]);
  });

  test("URL のシェル (?terminal=) のタブがあれば、それを前面に出せる", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { handle, names, fronts } = setup(async () => savedLayout);
    await handle.restore();
    const known = [
      handle.hasTerminal("shell-ab12"),
      handle.hasTerminal("shell-zz"),
    ];
    handle.openTerminal("shell-ab12");
    expect([known, names(), fronts[fronts.length - 1]]).toEqual([
      [true, false],
      [
        "README.md",
        "app.ts (preview)",
        "diff",
        "shot.png",
        ">Shell shell-ab12",
      ],
      "terminal:stay",
    ]);
  });

  // 保存した前面がターミナル。URL が画面・ファイルを指すなら URL を優先し、
  // シェル (?terminal=) かペイン (?open-pane=) を指すときだけ保存した前面を残す。
  const terminalFront = {
    version: 1,
    focused: "left",
    panes: [
      {
        side: "left",
        activeId: "t3",
        tabs: [
          {
            id: "t1",
            preview: false,
            target: { kind: "page", page: "database" },
          },
          {
            id: "t2",
            preview: false,
            target: { kind: "file", path: "README.md" },
          },
          {
            id: "t3",
            preview: false,
            target: { kind: "terminal", session: "shell-ab12cd" },
          },
        ],
      },
    ],
  };
  const imageFront = {
    ...terminalFront,
    panes: [
      {
        ...terminalFront.panes[0],
        activeId: "t4",
        tabs: [
          ...terminalFront.panes[0].tabs,
          {
            id: "t4",
            preview: false,
            target: { kind: "image", path: "/work/images/sample.png" },
          },
        ],
      },
    ],
  };
  test.each([
    {
      url: "/database",
      route: { screen: "database", range } as AppRoute,
      search: "",
      front: ">database",
    },
    {
      url: "/database (読み直し)",
      route: { screen: "database", range } as AppRoute,
      search: "",
      reloaded: true,
      front: ">Shell shell-ab12cd",
    },
    {
      url: "/database (保存の前面が画像)",
      route: { screen: "database", range } as AppRoute,
      search: "",
      saved: imageFront,
      front: ">database",
    },
    {
      url: "/database (保存の前面が画像・読み直し)",
      route: { screen: "database", range } as AppRoute,
      search: "",
      saved: imageFront,
      reloaded: true,
      front: ">sample.png",
    },
    {
      url: "/file?path=README.md",
      route: fileRoute("README.md"),
      search: "?path=README.md",
      front: ">README.md",
    },
    {
      url: "/database?terminal=shell-ab12cd",
      route: { screen: "database", range } as AppRoute,
      search: "?terminal=shell-ab12cd",
      front: ">Shell shell-ab12cd",
    },
    {
      url: "/database?open-pane=%253",
      route: { screen: "database", range } as AppRoute,
      search: "?open-pane=%253",
      front: ">Shell shell-ab12cd",
    },
  ])("保存の前面がターミナルで $url を開く → $front", async ({
    route,
    search,
    front,
    ...row
  }) => {
    const saved: unknown =
      "saved" in row && row.saved ? row.saved : terminalFront;
    const { handle, names } = setup(
      async () => saved,
      undefined,
      undefined,
      route,
    );
    await handle.restore({
      keepSavedFront: urlKeepsSavedFront(
        search,
        "reloaded" in row && row.reloaded === true,
      ),
    });
    expect(names().filter((name) => name.startsWith(">"))).toEqual([front]);
  });

  test("読み戻したターミナルのタブは残し、開いているシェルを知らせる", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { handle, names, terminals } = setup(async () => savedLayout);
    await handle.restore();
    expect([names(), terminals[terminals.length - 1]]).toEqual([
      [
        "README.md",
        ">app.ts (preview)",
        "diff",
        "shot.png",
        "Shell shell-ab12",
      ],
      { open: ["shell-ab12"], closed: [] },
    ]);
  });
});

describe("main tabs view: 左右 2 面", () => {
  // 2 面を置ける窓の幅 (各面 360px 以上) にする。happy-dom の既定は 0。
  beforeEach(() => {
    Object.defineProperty(document.documentElement, "clientWidth", {
      configurable: true,
      value: 1600,
    });
  });
  afterEach(() => {
    Reflect.deleteProperty(document.documentElement, "clientWidth");
  });

  const panes = (handle: MainTabsHandle) => {
    const view = handle.panes();
    return {
      split: view.split,
      focused: view.focused,
      routeSide: view.routeSide,
      left: view.fronts.left?.target,
      right: view.fronts.right?.target,
    };
  };

  test("ターミナルを指定した面で開き、既存タブもその面へ移す", async () => {
    const { handle } = setup(async () => null);
    await handle.restore();
    handle.openTerminal("shell-a1", "right");
    expect(panes(handle)).toEqual({
      split: true,
      focused: "right",
      routeSide: "left",
      left: { kind: "file", path: "src/app.ts" },
      right: { kind: "terminal", session: "shell-a1" },
    });
    handle.openTerminal("shell-b2", "left");
    expect(panes(handle)).toEqual({
      split: true,
      focused: "left",
      routeSide: null,
      left: { kind: "terminal", session: "shell-b2" },
      right: { kind: "terminal", session: "shell-a1" },
    });
    handle.openImage("/work/images/landscape.png", "right");
    handle.openTerminal("shell-a1", "left");
    expect(panes(handle)).toEqual({
      split: true,
      focused: "left",
      routeSide: null,
      left: { kind: "terminal", session: "shell-a1" },
      right: { kind: "image", path: "/work/images/landscape.png" },
    });
  });

  const splitButton = (mount: HTMLElement) =>
    mount.querySelector<HTMLButtonElement>(
      '.main-tabs-pane[data-side="left"] .main-tabs-split',
    );

  test("分割ボタンは前面のターミナルを右の面へ出し、本文は左の面に残る", async () => {
    const { handle, mount } = setup(async () => null);
    await handle.restore();
    handle.syncRoute({ screen: "diff", range });
    handle.openTerminal("shell-a1");
    splitButton(mount)?.click();
    expect(panes(handle)).toEqual({
      split: true,
      focused: "right",
      routeSide: "left",
      left: { kind: "page", page: "diff" },
      right: { kind: "terminal", session: "shell-a1" },
    });
  });

  test("2 面の右の面のボタンは 1 面に戻し、右のタブを左の末尾へ移して左の前面を残す", async () => {
    const { handle, mount, current } = setup(async () => null);
    await handle.restore();
    handle.syncRoute({ screen: "diff", range });
    handle.openTerminal("shell-a1");
    splitButton(mount)?.click();
    const button = mount.querySelector<HTMLButtonElement>(
      '.main-tabs-pane[data-side="right"] .main-tabs-split',
    );
    expect([
      button?.getAttribute("aria-disabled") === "true",
      button?.getAttribute("aria-label"),
    ]).toEqual([
      false,
      "Back to one side (moves the right tabs to the left; a file already open on the left closes on the right)",
    ]);
    button?.click();
    const kinds = [
      ...mount.querySelectorAll<HTMLElement>(
        '.main-tabs-pane[data-side="left"] .main-tab',
      ),
    ].map((tab) => tab.dataset.kind);
    expect([panes(handle), kinds, current()]).toEqual([
      {
        split: false,
        focused: "left",
        routeSide: "left",
        left: { kind: "page", page: "diff" },
        right: undefined,
      },
      ["file", "page", "terminal"],
      { screen: "diff", range },
    ]);
  });

  test("openingNewTab: 右の面に開くときも固定", async () => {
    const { handle } = setup(async () => null);
    await handle.restore();
    let opened = false;
    handle.openingNewTab(() => {
      opened = handle.openRouteRight({
        screen: "file",
        path: "src/b.ts",
        ref: "worktree",
        range,
        view: "blob",
      });
    });
    expect([
      opened,
      handle.layout().panes.right?.tabs.map((tab) => tab.preview),
    ]).toEqual([true, [false]]);
  });

  test("2 面のとき、タブ列の名前で左右が分かり、境界は左の面の幅を % で持つ", async () => {
    const { handle, mount } = setup(async () => null);
    await handle.restore();
    handle.openTerminal("shell-a1");
    splitButton(mount)?.click();
    const divider = document.querySelector(".main-split-divider");
    expect([
      [...mount.querySelectorAll("[role=tablist]")].map((list) =>
        list.getAttribute("aria-label"),
      ),
      divider?.getAttribute("aria-valuenow"),
      Number(divider?.getAttribute("aria-valuemin")) <
        Number(divider?.getAttribute("aria-valuemax")),
    ]).toEqual([["Open tabs, left side", "Open tabs, right side"], "50", true]);
  });

  // 分割のボタンで前面のファイルを右へ出すと、左の前面が別のタブに替わり、本文は
  // 裏でそちらへ移る。フォーカスは右なので、本文を移しても履歴は積まない
  // (URL は app の navigate が右の面へ合わせ直す)。
  test("分割で左の前面が替わっても、フォーカスが右なら本文は履歴を積まずに移る", async () => {
    const { handle, mount, navigations } = setup(async () => null);
    await handle.restore();
    handle.openingNewTab(() => handle.syncRoute(fileRoute("src/b.ts")));
    navigations.length = 0;
    splitButton(mount)?.click();
    expect([panes(handle).focused, navigations]).toEqual([
      "right",
      [{ to: "src/app.ts", replace: true }],
    ]);
  });

  test("左の面にフォーカスがあれば、本文を移すと履歴を積む (今までどおり)", async () => {
    const { handle, mount, navigations } = setup(async () => null);
    await handle.restore();
    handle.openingNewTab(() => handle.syncRoute(fileRoute("src/b.ts")));
    navigations.length = 0;
    mount
      .querySelector<HTMLElement>(".main-tab-active .main-tab-close")
      ?.click();
    expect(navigations).toEqual([{ to: "src/app.ts", replace: false }]);
  });

  // PWA の窓のタブのキー (core/pwa.ts → app.ts) が呼ぶ操作。番号・次 / 前・閉じる
  // はフォーカスのある面の中で、閉じたものは ⌘/Ctrl+Shift+T で同じ面へ戻る。
  test("PWA のキーの行き先: 面の中の番号・最後・次・閉じる・開き直す", async () => {
    const { handle, mount } = setup(async () => null);
    await handle.restore();
    handle.openingNewTab(() => handle.syncRoute(fileRoute("src/b.ts")));
    splitButton(mount)?.click();
    handle.openingNewTab(() =>
      handle.openRouteRight({
        screen: "file",
        path: "src/c.ts",
        ref: "worktree",
        range,
        view: "blob",
      }),
    );
    const front = () => {
      const view = handle.panes();
      const tab = view.fronts[view.focused];
      return `${view.focused}:${tab?.target.kind === "file" ? tab.target.path : tab?.target.kind}`;
    };
    const seen: string[] = [front()];
    handle.activateNth(1); // ⌘1
    seen.push(front());
    handle.activateNth(lastTabNumber(handle.layout())); // ⌘9
    seen.push(front());
    handle.next(); // Ctrl+Tab (面の中で折り返す)
    seen.push(front());
    handle.closeActive(); // ⌘W
    seen.push(front());
    handle.reopenClosed(); // ⌘⇧T
    seen.push(front());
    expect(seen).toEqual([
      "right:src/c.ts",
      "right:src/b.ts",
      "right:src/c.ts",
      "right:src/b.ts",
      "right:src/c.ts",
      "right:src/b.ts",
    ]);
  });

  // 戻る・進むはタブの配置を変えない: 既にあるタブの面を返し、app はそれを
  // 前面に出すだけにする (右の面にだけあるファイルを左に仮で開き直さない)。
  test("sideHolding: その route のタブがある面 (左を先に見る)", async () => {
    const { handle, mount } = setup(async () => null);
    await handle.restore();
    handle.openingNewTab(() => handle.syncRoute(fileRoute("src/b.ts")));
    splitButton(mount)?.click();
    expect([
      handle.sideHolding(fileRoute("src/b.ts")),
      handle.sideHolding(fileRoute("src/app.ts")),
      handle.sideHolding(fileRoute("src/missing.ts")),
      handle.sideHolding({ screen: "repo", ref: "worktree", path: "", range }),
    ]).toEqual(["right", "left", null, null]);
  });

  test("前面が画面のタブなら分割ボタンは押せない", async () => {
    const { handle, mount } = setup(async () => null);
    await handle.restore();
    handle.syncRoute({ screen: "diff", range });
    const button = splitButton(mount);
    button?.click();
    expect([
      button?.getAttribute("aria-disabled") === "true",
      panes(handle).split,
    ]).toEqual([true, false]);
  });

  // 押せない理由は 1 つだけ出す (条件を全部並べると、どれに当たったか読めない)。
  test.each([
    {
      name: "前面が画面",
      arrange: (handle: MainTabsHandle) =>
        handle.syncRoute({ screen: "diff", range }),
      title:
        "Split right: this screen stays on the left. Bring a file, terminal or image tab to the front",
    },
    {
      name: "左の面で何も選んでいない",
      arrange: (handle: MainTabsHandle) => handle.showHome(),
      title: "Split right: open a file, terminal or image tab first",
    },
    {
      name: "前面がファイル",
      arrange: () => undefined,
      title: "Split right",
    },
  ])("分割ボタンの説明: $name", async ({ arrange, title }) => {
    const { handle, mount } = setup(async () => null);
    await handle.restore();
    arrange(handle);
    const button = splitButton(mount);
    expect([
      button?.getAttribute("aria-disabled") === "true",
      button?.title,
    ]).toEqual([title !== "Split right", title]);
  });

  test("狭い窓では右の面を隠して左だけにし、印を出し、広がれば戻す (保存は右の面ごと)", async () => {
    // 窓の幅の変化を通知させる (happy-dom の ResizeObserver は通知しない)。
    const observers: Array<() => void> = [];
    const OriginalResizeObserver = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class {
      constructor(private readonly callback: ResizeObserverCallback) {
        observers.push(() => this.callback([], this as never));
      }
      observe() {
        /* 通知は observers から手で起こす */
      }
      unobserve() {
        /* 同上 */
      }
      disconnect() {
        /* 同上 */
      }
    } as unknown as typeof ResizeObserver;
    try {
      const saved = {
        version: 3,
        focused: "right",
        split: 0.4,
        panes: [
          {
            side: "left",
            activeId: "a",
            tabs: [
              {
                id: "a",
                preview: false,
                target: { kind: "file", path: "src/app.ts" },
              },
            ],
          },
          {
            side: "right",
            activeId: "t",
            tabs: [
              {
                id: "t",
                preview: false,
                target: { kind: "terminal", session: "shell-a1" },
              },
            ],
          },
        ],
      };
      Object.defineProperty(document.documentElement, "clientWidth", {
        configurable: true,
        value: 600,
      });
      vi.useFakeTimers();
      const { handle, mount, saves } = setup(async () => saved);
      await handle.restore();
      const indicator = () => ({
        parked: splitButton(mount)?.classList.contains(
          "main-tabs-action-parked",
        ),
        title: splitButton(mount)?.title,
      });
      const narrow = {
        ...panes(handle),
        ...indicator(),
        rightSection: !!mount.querySelector(
          '.main-tabs-pane[data-side="right"]',
        ),
      };
      handle.syncRoute(fileRoute("src/other.ts"));
      vi.advanceTimersByTime(1000);
      const savedWhileNarrow = saves[saves.length - 1];
      Object.defineProperty(document.documentElement, "clientWidth", {
        configurable: true,
        value: 1600,
      });
      for (const notify of observers) notify();
      vi.useRealTimers();
      expect([
        narrow,
        savedWhileNarrow?.panes.map((pane) => [pane.side, pane.activeId]),
        savedWhileNarrow?.split,
        { ...panes(handle), ...indicator() },
      ]).toEqual([
        {
          split: false,
          focused: "left",
          routeSide: "left",
          left: { kind: "file", path: "src/app.ts" },
          right: undefined,
          parked: true,
          title:
            "The right side (1 tab) is hidden because the window is too narrow for two sides. It comes back when the window is wide enough.",
          rightSection: false,
        },
        [
          ["left", expect.any(String)],
          ["right", "t"],
        ],
        0.4,
        {
          split: true,
          focused: "left",
          routeSide: "left",
          left: { kind: "file", path: "src/other.ts" },
          right: { kind: "terminal", session: "shell-a1" },
          parked: false,
          title: expect.any(String),
        },
      ]);
    } finally {
      globalThis.ResizeObserver = OriginalResizeObserver;
    }
  });

  // 電話の段 (横向きの電話は幅が足りても) では 2 面を組まない。保存された 2 面は
  // 右の面を預けて 1 面にし、電話の段を出れば戻す。保存は右の面ごと (デスクトップ
  // に戻ったとき 2 面のまま)。
  test("the phone tier holds one side even when wide enough, and gives the right side back when it leaves", async () => {
    const OriginalResizeObserver = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class {
      observe() {
        /* 幅は変えない (電話の段だけで決まることを見る) */
      }
      unobserve() {
        /* 同上 */
      }
      disconnect() {
        /* 同上 */
      }
    } as unknown as typeof ResizeObserver;
    let phone = true;
    const changes: Array<() => void> = [];
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      get matches() {
        return query === PHONE_MEDIA_QUERY ? phone : false;
      },
      media: query,
      addEventListener: (_type: string, listener: () => void) => {
        if (query === PHONE_MEDIA_QUERY) changes.push(listener);
      },
      removeEventListener: () => undefined,
    })) as unknown as typeof window.matchMedia;
    try {
      Object.defineProperty(document.documentElement, "clientWidth", {
        configurable: true,
        value: 1600,
      });
      vi.useFakeTimers();
      const saved = {
        version: 3,
        focused: "right",
        split: 0.4,
        panes: [
          {
            side: "left",
            activeId: "a",
            tabs: [
              {
                id: "a",
                preview: false,
                target: { kind: "file", path: "src/app.ts" },
              },
            ],
          },
          {
            side: "right",
            activeId: "t",
            tabs: [
              {
                id: "t",
                preview: false,
                target: { kind: "terminal", session: "shell-a1" },
              },
            ],
          },
        ],
      };
      const { handle, mount, saves } = setup(async () => saved);
      await handle.restore();
      const onPhone = {
        split: panes(handle).split,
        rightSection: !!mount.querySelector(
          '.main-tabs-pane[data-side="right"]',
        ),
      };
      handle.syncRoute(fileRoute("src/other.ts"));
      vi.advanceTimersByTime(1000);
      const savedOnPhone = saves[saves.length - 1]?.panes.map(
        (pane) => pane.side,
      );
      phone = false;
      for (const notify of changes) notify();
      vi.useRealTimers();
      expect({
        onPhone,
        savedOnPhone,
        backOnDesktop: {
          split: panes(handle).split,
          right: panes(handle).right,
        },
      }).toEqual({
        onPhone: { split: false, rightSection: false },
        savedOnPhone: ["left", "right"],
        backOnDesktop: {
          split: true,
          right: { kind: "terminal", session: "shell-a1" },
        },
      });
    } finally {
      globalThis.ResizeObserver = OriginalResizeObserver;
      window.matchMedia = originalMatchMedia;
      Reflect.deleteProperty(document.documentElement, "clientWidth");
    }
  });

  // 電話の段のタブの一覧: タブ列の右端の入口 (枚数) と、左の面・預けた右の面の
  // タブを前面に出す・閉じる。預けたタブを前面に出すと左の面へ移す (電話では
  // 右の面を出さない)。
  test("the phone tier lists every tab, brings a parked one to the left, and closes from the list", async () => {
    const OriginalResizeObserver = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class {
      observe() {
        /* 幅は変えない (電話の段だけで決まることを見る) */
      }
      unobserve() {
        /* 同上 */
      }
      disconnect() {
        /* 同上 */
      }
    } as unknown as typeof ResizeObserver;
    let phone = true;
    const changes: Array<() => void> = [];
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      get matches() {
        return query === PHONE_MEDIA_QUERY ? phone : false;
      },
      media: query,
      addEventListener: (_type: string, listener: () => void) => {
        if (query === PHONE_MEDIA_QUERY) changes.push(listener);
      },
      removeEventListener: () => undefined,
    })) as unknown as typeof window.matchMedia;
    try {
      Object.defineProperty(document.documentElement, "clientWidth", {
        configurable: true,
        value: 390,
      });
      const saved = {
        version: 3,
        focused: "left",
        split: 0.5,
        panes: [
          {
            side: "left",
            activeId: "a",
            tabs: [
              {
                id: "a",
                preview: false,
                target: { kind: "file", path: "src/app.ts" },
              },
              {
                id: "b",
                preview: true,
                target: { kind: "file", path: "src/b.ts" },
              },
            ],
          },
          {
            side: "right",
            activeId: "t",
            tabs: [
              {
                id: "t",
                preview: false,
                target: { kind: "terminal", session: "shell-a1" },
              },
              {
                id: "img",
                preview: false,
                target: { kind: "image", path: "docs/shot.png" },
              },
            ],
          },
        ],
      };
      const calls: string[] = [];
      const { handle, mount, terminals } = setup(
        async () => saved,
        undefined,
        undefined,
        undefined,
        undefined,
        { onTabList: () => calls.push("tab-list") },
      );
      await handle.restore();
      let renders = 0;
      handle.onRender(() => {
        renders++;
      });
      const button = mount.querySelector<HTMLButtonElement>(
        ".main-tabs-list-open",
      );
      if (!button) throw new Error("expected the open tabs button");
      const list = () =>
        handle
          .tabList()
          .map(
            (entry) =>
              `${entry.front ? ">" : ""}${entry.name}${entry.preview ? " (preview)" : ""}${entry.parked ? " [right]" : ""}`,
          );
      const onPhone = {
        shown: !button.hidden,
        count: button.textContent,
        label: button.getAttribute("aria-label"),
        list: list(),
      };
      button.click();
      handle.bringToFront("img");
      const afterBring = {
        list: list(),
        front: panes(handle).left,
        renders: renders > 0,
      };
      handle.closeTab("t");
      const afterCloseParked = {
        list: list(),
        count: button.textContent,
        closedShell: terminals[terminals.length - 1]?.closed,
      };
      handle.closeTab("a");
      const afterCloseLeft = list();
      expect(() => handle.closeTab("gone")).toThrow(/"gone" is not open/);
      phone = false;
      for (const notify of changes) notify();
      expect({
        onPhone,
        calls,
        afterBring,
        afterCloseParked,
        afterCloseLeft,
        hiddenOnDesktop: button.hidden,
      }).toEqual({
        onPhone: {
          shown: true,
          count: "4",
          label: "Open tabs (4)",
          list: [
            ">app.ts",
            "b.ts (preview)",
            "claude · Working [right]",
            "shot.png [right]",
          ],
        },
        calls: ["tab-list"],
        afterBring: {
          list: [
            "app.ts",
            "b.ts (preview)",
            ">shot.png",
            "claude · Working [right]",
          ],
          front: { kind: "image", path: "docs/shot.png" },
          renders: true,
        },
        afterCloseParked: {
          list: ["app.ts", "b.ts (preview)", ">shot.png"],
          count: "3",
          closedShell: ["shell-a1"],
        },
        afterCloseLeft: ["b.ts (preview)", ">shot.png"],
        hiddenOnDesktop: true,
      });
    } finally {
      globalThis.ResizeObserver = OriginalResizeObserver;
      window.matchMedia = originalMatchMedia;
      Reflect.deleteProperty(document.documentElement, "clientWidth");
    }
  });

  // 2 面のときの一覧の列 (ui-layout.md の「一覧の列」)。左のサイドバーの右に
  // ファイル一覧 (240)・一覧 (Diff の変更ファイルの一覧・History のコミット 320)・
  // 変更ファイルの一覧 (History だけ 240) が並ぶ (どれも面の外)。本文が 2 面の
  // ゆとり (961) に足りなければ、一覧を詰めた幅 (240) にし、次に変更ファイルの一覧を
  // 帯 (28) に畳み、次にファイル一覧を畳む (畳んでも画面の入口の縦の帯 40 は残る。
  // core/list-column.ts。app.ts が決めて
  // listColumnWidth で渡す)。それでも 2 面の下限 (641) に足りなければ右の面を
  // 預ける。本文の幅 = 窓 − 左のサイドバー 280 − 一覧の列。
  test.each([
    {
      screen: "History",
      window: 1228,
      column: 308,
      parked: true,
      filesFolded: true,
    },
    {
      screen: "History",
      window: 1229,
      column: 308,
      parked: false,
      filesFolded: true,
    },
    {
      screen: "History",
      window: 1280,
      column: 308,
      parked: false,
      filesFolded: true,
    },
    {
      screen: "History",
      window: 1600,
      column: 308,
      parked: false,
      filesFolded: true,
    },
    {
      screen: "History",
      window: 1748,
      column: 308,
      parked: false,
      filesFolded: true,
    },
    {
      screen: "History",
      window: 1749,
      column: 508,
      parked: false,
      filesFolded: false,
    },
    {
      screen: "History",
      window: 1961,
      column: 720,
      parked: false,
      filesFolded: false,
    },
    {
      screen: "History",
      window: 2041,
      column: 800,
      parked: false,
      filesFolded: false,
    },
    {
      screen: "Diff",
      window: 1200,
      column: 280,
      parked: true,
      filesFolded: true,
    },
    {
      screen: "Diff",
      window: 1201,
      column: 280,
      parked: false,
      filesFolded: true,
    },
    {
      screen: "Diff",
      window: 1720,
      column: 280,
      parked: false,
      filesFolded: true,
    },
    {
      screen: "Diff",
      window: 1721,
      column: 480,
      parked: false,
      filesFolded: false,
    },
    {
      screen: "Diff",
      window: 1801,
      column: 560,
      parked: false,
      filesFolded: false,
    },
    {
      screen: "Files",
      window: 1280,
      column: 40,
      parked: false,
      filesFolded: true,
    },
    {
      screen: "Files",
      window: 1480,
      column: 40,
      parked: false,
      filesFolded: true,
    },
    {
      screen: "Files",
      window: 1481,
      column: 240,
      parked: false,
      filesFolded: false,
    },
    {
      screen: "Files",
      window: 1600,
      column: 240,
      parked: false,
      filesFolded: false,
    },
  ] as const)("$screen・窓 $window px: 一覧の列 $column px・右の面を預けるか $parked・ファイル一覧を畳む $filesFolded", async ({
    screen,
    window,
    column,
    parked,
    filesFolded,
  }) => {
    const holdsList = screen !== "Files";
    Object.defineProperty(document.documentElement, "clientWidth", {
      configurable: true,
      value: window - 280,
    });
    const files = 240;
    const layout = listColumnLayout({
      room: window - 280,
      files,
      filesRail: 40,
      filesKeptOpen: false,
      preferred: holdsList ? HISTORY_WIDTH.default : 0,
      compact: HISTORY_WIDTH.min,
      tree: screen === "History" ? 240 : 0,
      treeRail: 28,
      treeKeptOpen: false,
      need: COMFORTABLE_PANE_WIDTH * 2 + SPLIT_DIVIDER_WIDTH,
    });
    const listWidth =
      (layout.filesFolded ? 40 : files) + layout.width + layout.tree;
    const saved = {
      version: 3,
      focused: "left",
      split: 0.5,
      panes: [
        {
          side: "left",
          activeId: "a",
          tabs: [
            {
              id: "a",
              preview: false,
              target: { kind: "file", path: "src/app.ts" },
            },
          ],
        },
        {
          side: "right",
          activeId: "t",
          tabs: [
            {
              id: "t",
              preview: false,
              target: { kind: "terminal", session: "shell-a1" },
            },
          ],
        },
      ],
    };
    const { handle, mount } = setup(
      async () => saved,
      () => listWidth,
      undefined,
      undefined,
      undefined,
      { listColumnHoldsList: () => holdsList },
    );
    await handle.restore();
    const split = panes(handle).split;
    expect({
      column: listWidth,
      parked: !split,
      filesFolded: layout.filesFolded,
      // 預けた理由は、一覧のために預けたとき専用の説明
      reason: !split
        ? splitButton(mount)?.title.startsWith(
            "The right side (1 tab) is set aside to make room for this screen's list",
          )
        : null,
    }).toEqual({
      column,
      parked,
      filesFolded,
      reason: parked ? true : null,
    });
  });

  // 2 面を置ける下限は、詰めたときの面の幅 (320) 2 つ分 + 仕切り 1 = 641px。
  // 本文 (一覧の列の右) の幅で数える。ゆとりのある幅 (480 * 2 + 1 = 961) に
  // 足りないときに一覧の列を詰める・畳むのは app.ts (core/list-column.ts)。
  test.each([
    { window: 880, column: 240, split: false },
    { window: 881, column: 240, split: true },
    { window: 640, column: 0, split: false },
    { window: 641, column: 0, split: true },
    { window: 1201, column: 240, split: true },
  ])("窓 $window px・一覧の列 $column px なら分割できるか: $split", async ({
    window,
    column,
    split,
  }) => {
    Object.defineProperty(document.documentElement, "clientWidth", {
      configurable: true,
      value: window,
    });
    const { handle, mount } = setup(
      async () => null,
      () => column,
    );
    await handle.restore();
    handle.syncRoute({ screen: "diff", range });
    handle.openTerminal("shell-a1");
    splitButton(mount)?.click();
    expect(panes(handle).split).toBe(split);
  });

  // 本文の左端 = 一覧の列の頭 (タブ列の行の左端 = 左のサイドバーの右) の左端 +
  // 一覧の列。タブ列 (mount) はその頭の右から始まるので、タブ列の左端からは
  // 数えない。
  test.each([
    { window: 1160, split: false },
    { window: 1161, split: true },
  ])("左のサイドバー 280・一覧の列 240・窓 $window px なら分割できるか: $split", async ({
    window,
    split,
  }) => {
    Object.defineProperty(document.documentElement, "clientWidth", {
      configurable: true,
      value: window,
    });
    const columnHead = document.createElement("div");
    columnHead.getBoundingClientRect = () => new DOMRect(280, 0, 240, 34);
    const { handle, mount } = setup(
      async () => null,
      () => 240,
      undefined,
      undefined,
      undefined,
      { columnHead },
    );
    mount.getBoundingClientRect = () => new DOMRect(520, 0, window - 520, 34);
    await handle.restore();
    handle.syncRoute({ screen: "diff", range });
    handle.openTerminal("shell-a1");
    splitButton(mount)?.click();
    expect(panes(handle).split).toBe(split);
  });

  // 2 面を置けるかは、2 面にしたときの一覧の列の幅 (幅が足りなければ詰めて畳んだ
  // 幅) で数える。1 面の今の幅 (ファイル一覧 240 + 一覧 240) で数えると、1280 の窓
  // (本文の場所 1000) で本文 520 < 641 になり、Diff やファイルの詳細から分割でき
  // なかった (畳めば一覧だけの 240 で本文 760)。
  test.each([
    { name: "2 面の幅を渡す", splitColumn: 240, split: true },
    {
      name: "2 面の幅を渡さない (今の幅で数える)",
      splitColumn: undefined,
      split: false,
    },
  ])("本文の場所 1000・1 面の一覧の列 480: $name → 分割できるか $split", async ({
    splitColumn,
    split,
  }) => {
    Object.defineProperty(document.documentElement, "clientWidth", {
      configurable: true,
      value: 1000,
    });
    const { handle, mount } = setup(
      async () => null,
      () => 480,
      undefined,
      undefined,
      undefined,
      splitColumn === undefined
        ? {}
        : { splitListColumnWidth: () => splitColumn },
    );
    await handle.restore();
    handle.syncRoute({ screen: "diff", range });
    handle.openTerminal("shell-a1");
    splitButton(mount)?.click();
    expect(panes(handle).split).toBe(split);
  });

  // 詰めたときは、右の面を先に畳まず両面を同じ比で縮める (下限 320)。
  test("ゆとりの無い幅では面を同じ比で縮める", async () => {
    Object.defineProperty(document.documentElement, "clientWidth", {
      configurable: true,
      value: 941,
    });
    const { handle, mount } = setup(
      async () => null,
      () => 240,
    );
    await handle.restore();
    handle.syncRoute({ screen: "diff", range });
    handle.openTerminal("shell-a1");
    splitButton(mount)?.click();
    expect(panes(handle).split).toBe(true);
    const style = document.documentElement.style;
    // 本文 701px = 面 351 + 仕切り 1 + 面 349 (比 0.5 を丸めた形。どちらも下限
    // 320 以上で、右の面を先に畳んでいない)。
    expect(style.getPropertyValue("--split-left-w")).toBe("351px");
    expect(style.getPropertyValue("--split-right-w")).toBe("349px");
  });

  // 背面のタブでは ResizeObserver が届かない。2 面のために一覧の列を畳んだあとも
  // --split-left-w が畳む前の幅のまま残っていた (body の印の変化で合わせ直す)。
  test("一覧の列を畳んで body の印が変わると、ResizeObserver を待たずに面の幅を書き直す", async () => {
    Object.defineProperty(document.documentElement, "clientWidth", {
      configurable: true,
      value: 1280,
    });
    let column = 240;
    const { handle, mount } = setup(
      async () => null,
      () => column,
    );
    await handle.restore();
    handle.syncRoute({ screen: "diff", range });
    handle.openTerminal("shell-a1");
    splitButton(mount)?.click();
    const style = document.documentElement.style;
    // 本文 1040px (一覧の列 240 を除く) = 520 + 1 + 519。
    expect(style.getPropertyValue("--split-left-w")).toBe("520px");
    column = 0;
    document.body.classList.add("sample-column-hidden");
    await Promise.resolve();
    // 本文 1280px = 640 + 1 + 639。
    expect([
      style.getPropertyValue("--split-left-w"),
      style.getPropertyValue("--split-right-w"),
    ]).toEqual(["640px", "639px"]);
    document.body.classList.remove("sample-column-hidden");
  });

  test("右の面にフォーカスがあるとき左のタブを押すと、本文をそのタブの route に合わせる", async () => {
    const { handle, mount, current } = setup(async () => null);
    await handle.restore();
    handle.syncRoute({ screen: "diff", range });
    handle.openTerminal("shell-a1");
    splitButton(mount)?.click();
    mount
      .querySelector<HTMLElement>('.main-tabs-pane[data-side="left"] .main-tab')
      ?.click();
    expect([panes(handle).routeSide, panes(handle).focused, current()]).toEqual(
      ["left", "left", fileRoute("src/app.ts")],
    );
  });

  test("画像は 2 面なら反対の面で開き、その面にフォーカスが移る", async () => {
    const { handle, mount } = setup(async () => null);
    await handle.restore();
    handle.syncRoute({ screen: "diff", range });
    handle.openTerminal("shell-a1");
    splitButton(mount)?.click();
    handle.openImage("/work/images/landscape.png", "other-if-split");
    expect(panes(handle)).toEqual({
      split: true,
      focused: "left",
      routeSide: null,
      left: { kind: "image", path: "/work/images/landscape.png" },
      right: { kind: "terminal", session: "shell-a1" },
    });
  });

  test.each([
    { name: "page のタブ", kind: "page", dropZone: false },
    { name: "ファイルのタブ", kind: "file", dropZone: true },
    { name: "ターミナルのタブ", kind: "terminal", dropZone: true },
  ])("ドラッグ中の右に分割の落とす先は、右に置ける種類だけ ($name)", async ({
    kind,
    dropZone,
  }) => {
    const { handle, mount } = setup(async () => null);
    await handle.restore();
    handle.syncRoute({ screen: "diff", range });
    handle.openTerminal("shell-a1");
    const dragged = mount.querySelector<HTMLElement>(
      `.main-tab[data-kind="${kind}"]`,
    );
    if (!dragged) throw new Error(`no ${kind} tab to drag`);
    dragged.dispatchEvent(new Event("dragstart", { bubbles: true }));
    const zone = document.querySelector<HTMLElement>(".main-split-drop");
    expect(zone?.hidden).toBe(!dropZone);
  });

  // 掴んでいる最中にタブ列を描き直しても、掴んだタブの印は付いたまま。
  // 要素が外れて dragend が届かなくても、ボタンを離した移動で印を片付ける。
  test("ドラッグ中の描き直しで印が消えず、終わったら残らない", async () => {
    const { handle, mount } = setup(async () => null);
    await handle.restore();
    handle.syncRoute({ screen: "diff", range });
    handle.openTerminal("shell-a1");
    const dragged = mount.querySelector<HTMLElement>(
      '.main-tab[data-kind="terminal"]',
    );
    if (!dragged) throw new Error("no terminal tab to drag");
    const id = dragged.dataset.tabId;
    // 掴んだタブだけを薄くする (body とタブが同じ印だった間は、タブを薄くする
    // 規則が body に当たって画面全体が半透明になっていた)。空は規則が当たっていない。
    const style = document.createElement("style");
    style.textContent = readFileSync("web/style.css", "utf8");
    document.head.appendChild(style);
    dragged.dispatchEvent(new Event("dragstart", { bubbles: true }));
    expect([
      getComputedStyle(document.body).opacity,
      getComputedStyle(dragged).opacity,
    ]).toEqual(["", "0.5"]);
    style.remove();
    // 描き直し (別のシェルのタブが増える)
    handle.openTerminal("shell-b2");
    const redrawn = mount.querySelector<HTMLElement>(
      `.main-tab[data-tab-id="${id}"]`,
    );
    expect([
      redrawn === dragged,
      redrawn?.classList.contains("main-tab-dragging"),
      document.body.classList.contains("main-tab-drag-active"),
    ]).toEqual([false, true, true]);
    // 外れた要素には dragend が来ない。ボタンを離した移動で終わりと分かる
    const moved = new Event("pointermove", { bubbles: true });
    Object.defineProperty(moved, "buttons", { value: 0 });
    document.dispatchEvent(moved);
    expect([
      document.body.classList.contains("main-tab-drag-active"),
      document.querySelector<HTMLElement>(".main-split-drop")?.hidden,
    ]).toEqual([false, true]);
  });

  test.each([
    { kind: "page", accepts: false },
    { kind: "file", accepts: true },
  ])("右の面のタブ列が $kind のタブを受けるか (dragover): $accepts", async ({
    kind,
    accepts,
  }) => {
    const { handle, mount } = setup(async () => null);
    await handle.restore();
    handle.syncRoute({ screen: "diff", range });
    handle.openTerminal("shell-a1");
    splitButton(mount)?.click();
    const dragged = mount.querySelector<HTMLElement>(
      `.main-tab[data-kind="${kind}"]`,
    );
    if (!dragged) throw new Error(`no ${kind} tab to drag`);
    dragged.dispatchEvent(new Event("dragstart", { bubbles: true }));
    const over = new Event("dragover", { bubbles: true, cancelable: true });
    mount
      .querySelector<HTMLElement>(
        '.main-tabs-pane[data-side="right"] .main-tabs-strip',
      )
      ?.dispatchEvent(over);
    expect(over.defaultPrevented).toBe(accepts);
  });

  test("保存した 2 面・比・画像の前面が戻る (URL が下に残った route を指していても)", async () => {
    const saved = {
      version: 1,
      focused: "right",
      split: 0.35,
      panes: [
        {
          side: "left",
          activeId: "t1",
          tabs: [
            {
              id: "t1",
              preview: false,
              target: { kind: "file", path: "src/app.ts" },
            },
          ],
        },
        {
          side: "right",
          activeId: "t2",
          tabs: [
            {
              id: "t2",
              preview: false,
              target: { kind: "image", path: "/work/images/landscape.png" },
            },
          ],
        },
      ],
    };
    const { handle, names } = setup(async () => saved);
    await handle.restore();
    expect([panes(handle), handle.layout().split, names()]).toEqual([
      {
        split: true,
        focused: "right",
        routeSide: "left",
        left: { kind: "file", path: "src/app.ts" },
        right: { kind: "image", path: "/work/images/landscape.png" },
      },
      0.35,
      [">app.ts", ">landscape.png"],
    ]);
  });

  // 別のプロジェクトのペインを映すタブは「プロジェクト名 · 題」(二つに分けて
  // 描き、狭いときはプロジェクト名から省略する)。title と閉じるの説明は全体。
  test.each([
    {
      name: "今のプロジェクト",
      project: { name: "repo-a", current: true },
      parts: null,
      full: "claude · sample agent task",
    },
    {
      name: "別のプロジェクト",
      project: { name: "repo-b", current: false },
      parts: ["repo-b · ", "claude · sample agent task"],
      full: "repo-b · claude · sample agent task",
    },
    {
      name: "プロジェクトが分からない",
      project: null,
      parts: null,
      full: "claude · sample agent task",
    },
  ])("ターミナルのタブの名前: $name", async ({ project, parts, full }) => {
    const { handle, mount } = setup(
      async () => null,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        terminalInfo: () => ({
          label: "claude · sample agent task",
          state: "working",
          project,
        }),
      },
    );
    await handle.restore();
    handle.openTerminal("shell-a1");
    const tab = mount.querySelector<HTMLElement>(
      '.main-tab[data-kind="terminal"]',
    );
    const name = tab?.querySelector(".main-tab-name");
    expect({
      parts:
        name?.querySelector(".main-tab-project") === null
          ? null
          : [...(name?.children ?? [])].map((child) => child.textContent),
      text: name?.textContent,
      title: tab?.title,
      // 閉じるボタンは支援技術から隠す (aria-hidden) ので、名前は title で持つ。
      close: tab?.querySelector(".main-tab-close")?.getAttribute("title"),
    }).toEqual({
      parts,
      text: full,
      title: full,
      close: `Close ${full}`,
    });
  });

  test("route が画像のファイルなら画像のタブ", () => {
    expect(routeTarget(fileRoute("docs/images/dunes.png"))).toEqual({
      kind: "image",
      path: "docs/images/dunes.png",
    });
  });
});
