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
import type {
  SerializedCommonTabs,
  SerializedLayout,
  TabTarget,
} from "../core/main-tabs";
import { type AppRoute, urlKeepsSavedFront } from "../core/routes";
import { closeContextMenu } from "../views/context-menu";
import {
  createMainTabsView,
  type MainTabsHandle,
  routeTarget,
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
  panelColumn?: HTMLElement,
  backupSaved: () => Promise<string> = async () =>
    "/state/main-tabs.json.broken-sample",
  initial: AppRoute = fileRoute("src/app.ts"),
  loadCommon: () => Promise<unknown> = async () => null,
) {
  const mount = document.createElement("nav");
  document.body.append(mount);
  const saves: SerializedLayout[] = [];
  const commonSaves: Array<SerializedCommonTabs | undefined> = [];
  const backups: string[] = [];
  const fronts: string[] = [];
  const terminals: Array<{ open: string[]; closed: string[] }> = [];
  /** ＋ と、ターミナルのタブの右クリックから呼ばれたもの。 */
  const calls: string[] = [];
  let current: AppRoute = initial;
  const handle: MainTabsHandle = createMainTabsView({
    mount,
    ...(panelColumn ? { panelColumn } : {}),
    getLanguage: () => "en",
    pageLabel: (page) => page,
    navigate: (route) => {
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
    terminalMenuItems: () => [
      { label: "Larger text (13)", onSelect: () => calls.push("larger") },
    ],
    loadSaved: async () => ({
      layout: await loadSaved(),
      common: await loadCommon(),
    }),
    save: async (layout, _keepalive, common) => {
      saves.push(layout);
      commonSaves.push(common);
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
  });
  handle.syncRoute(current);
  return {
    mount,
    handle,
    saves,
    commonSaves,
    backups,
    fronts,
    terminals,
    calls,
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
    const newer = { version: 4, focused: "left", panes: [] };
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
        "[code-viewer] main tabs: the saved layout was written by a newer version (layout version 4, this page reads up to 3); it is kept as it is and tabs are not saved on this page",
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
describe("main tabs view: 共通のタブ", () => {
  const common = (...targets: TabTarget[]) => ({ version: 1, targets });
  const shell = (session: string): TabTarget => ({ kind: "terminal", session });
  test.each([
    {
      name: "別のプロジェクトでシェルを閉じ、ボードを開いた",
      layout: savedLayout as unknown,
      common: common({ kind: "page", page: "agents" }),
      names: ["README.md", ">app.ts (preview)", "diff", "shot.png", "agents"],
      saved: [{ kind: "page", page: "agents" }],
    },
    {
      name: "初めて開くプロジェクト (配置が無い) にも共通のタブが出る",
      layout: null,
      common: common(shell("shell-ab12"), { kind: "page", page: "help" }),
      names: [">app.ts (preview)", "Shell shell-ab12", "help"],
      saved: [shell("shell-ab12"), { kind: "page", page: "help" }],
    },
    {
      name: "共通がまだ無い (前の版の保存) なら配置のまま、次の保存で共通ができる",
      layout: savedLayout as unknown,
      common: null,
      names: [
        "README.md",
        ">app.ts (preview)",
        "diff",
        "shot.png",
        "Shell shell-ab12",
      ],
      saved: [shell("shell-ab12")],
    },
  ])("$name", async ({
    layout,
    common: saved,
    names: expected,
    saved: out,
  }) => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { handle, names, commonSaves } = setup(
      async () => layout,
      undefined,
      undefined,
      undefined,
      async () => saved,
    );
    await handle.restore();
    handle.flush(false);
    vi.useRealTimers();
    expect([names(), commonSaves[commonSaves.length - 1]?.targets]).toEqual([
      expected,
      out,
    ]);
  });

  test.each([
    {
      name: "新しい版の共通のタブは使わず、書かない",
      common: { version: 99, targets: [] },
      backup: async () => "/state/main-tabs.json.broken-sample",
      written: false,
      message: "written by a newer version (common tabs version 99",
    },
    {
      name: "壊れた共通のタブは退避してから、この画面の共通のタブで書き直す",
      common: { version: 1, targets: [{ kind: "file", path: "a" }] },
      backup: async () => "/state/main-tabs.json.broken-sample",
      written: true,
      message: "backed up to /state/main-tabs.json.broken-sample",
    },
    {
      name: "退避できなければ書かない",
      common: { version: 1, targets: [{ kind: "file", path: "a" }] },
      backup: async () => {
        throw new Error("sample disk failure");
      },
      written: false,
      message: "could not be backed up",
    },
  ])("$name (理由は console.error に)", async ({
    common: saved,
    backup,
    written,
    message,
  }) => {
    vi.useFakeTimers();
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const { handle, names, commonSaves } = setup(
      async () => savedLayout,
      undefined,
      backup,
      undefined,
      async () => saved,
    );
    await handle.restore();
    handle.flush(false);
    vi.useRealTimers();
    const logged = error.mock.calls.map((call) => call.map(String).join(" "));
    expect([
      names(),
      commonSaves[commonSaves.length - 1] !== undefined,
      logged.some((line) => line.includes(message)),
    ]).toEqual([
      [
        "README.md",
        ">app.ts (preview)",
        "diff",
        "shot.png",
        "Shell shell-ab12",
      ],
      written,
      true,
    ]);
  });
});

describe("main tabs view: 操作", () => {
  test("タブを押すとそのタブが最後に見ていた route へ移る", async () => {
    const { handle, mount, names } = setup(async () => null);
    await handle.restore();
    handle.keepFileOpen("src/app.ts");
    const lined = fileRoute("src/app.ts", 12);
    handle.syncRoute(lined);
    handle.syncRoute({ screen: "diff", range });
    mount.querySelector<HTMLElement>(".main-tab")?.click();
    expect([names(), handle.layout().panes.left.tabs[0].target]).toEqual([
      [">app.ts", "diff"],
      { kind: "file", path: "src/app.ts", line: 12 },
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
  test("右クリックに端末の操作と「セッションを止める」が並び、止めるはそのシェルで呼ぶ", async () => {
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
        "Larger text (13)",
        "Stop session",
        "Copy path (disabled)",
      ],
      true,
      ["stop:shell-a1"],
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
    handle.closeTerminal("shell-a1");
    expect([terminals[terminals.length - 1], names()]).toEqual([
      { open: ["shell-b2"], closed: ["shell-a1"] },
      ["app.ts (preview)", ">Shell shell-b2"],
    ]);
  });

  test("指定したシェルのタブだけを閉じる (入口を起こし直した後の消えたシェル)", async () => {
    const { handle, names } = setup(async () => null);
    await handle.restore();
    handle.openTerminal("shell-a1");
    handle.openTerminal("shell-b2");
    expect(handle.terminalSessions()).toEqual(["shell-a1", "shell-b2"]);
    handle.closeTerminals(["shell-a1"]);
    expect(names()).toEqual(["app.ts (preview)", ">Shell shell-b2"]);
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
      '.main-tabs-pane[data-side="left"] .main-tabs-action:nth-child(2)',
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
      '.main-tabs-pane[data-side="right"] .main-tabs-action:nth-child(2)',
    );
    expect([button?.disabled, button?.getAttribute("aria-label")]).toEqual([
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

  test("前面がファイルや画面のタブなら分割ボタンは押せない", async () => {
    const { handle, mount } = setup(async () => null);
    await handle.restore();
    handle.syncRoute({ screen: "diff", range });
    const button = splitButton(mount);
    button?.click();
    expect([button?.disabled, panes(handle).split]).toEqual([true, false]);
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

  // 2 面を置ける下限は、詰めたときの面の幅 (320) 2 つ分 + 仕切り 1 = 641px。
  // 本文 (右の列の左まで) の幅で数える。ゆとりのある幅 (480 * 2 + 1 = 961) に
  // 足りないときは、2 面の間だけ右の列を畳む (app.ts。畳めば本文はその分広がる)。
  test.each([
    { window: 880, column: 240, split: false },
    { window: 881, column: 240, split: true },
    { window: 640, column: 0, split: false },
    { window: 641, column: 0, split: true },
    { window: 1201, column: 240, split: true },
  ])("窓 $window px・右の列 $column px なら分割できるか: $split", async ({
    window,
    column,
    split,
  }) => {
    Object.defineProperty(document.documentElement, "clientWidth", {
      configurable: true,
      value: window,
    });
    const panelColumn = document.createElement("div");
    panelColumn.getBoundingClientRect = () => new DOMRect(0, 0, column, 80);
    const { handle, mount } = setup(async () => null, panelColumn);
    await handle.restore();
    handle.syncRoute({ screen: "diff", range });
    handle.openTerminal("shell-a1");
    splitButton(mount)?.click();
    expect(panes(handle).split).toBe(split);
  });

  // ゆとりのある幅で並ぶかは、右の列を畳むかの判断に使う (app.ts が読む)。
  test.each([
    { window: 960, column: 240, fits: false },
    { window: 1200, column: 240, fits: false },
    { window: 1201, column: 240, fits: true },
    { window: 961, column: 0, fits: true },
  ])("窓 $window px・右の列 $column px で 2 面がゆとりを持って並ぶか: $fits", async ({
    window,
    column,
    fits,
  }) => {
    Object.defineProperty(document.documentElement, "clientWidth", {
      configurable: true,
      value: window,
    });
    const panelColumn = document.createElement("div");
    panelColumn.getBoundingClientRect = () => new DOMRect(0, 0, column, 80);
    const { handle } = setup(async () => null, panelColumn);
    await handle.restore();
    expect(handle.splitFitsWithPanelColumn()).toBe(fits);
  });

  // 詰めたときは、右の面を先に畳まず両面を同じ比で縮める (下限 320)。
  test("ゆとりの無い幅では面を同じ比で縮める", async () => {
    Object.defineProperty(document.documentElement, "clientWidth", {
      configurable: true,
      value: 941,
    });
    const panelColumn = document.createElement("div");
    panelColumn.getBoundingClientRect = () => new DOMRect(0, 0, 240, 80);
    const { handle, mount } = setup(async () => null, panelColumn);
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
    dragged.dispatchEvent(new Event("dragstart", { bubbles: true }));
    // 描き直し (別のシェルのタブが増える)
    handle.openTerminal("shell-b2");
    const redrawn = mount.querySelector<HTMLElement>(
      `.main-tab[data-tab-id="${id}"]`,
    );
    expect([
      redrawn === dragged,
      redrawn?.classList.contains("main-tab-dragging"),
      document.body.classList.contains("main-tab-dragging"),
    ]).toEqual([false, true, true]);
    // 外れた要素には dragend が来ない。ボタンを離した移動で終わりと分かる
    const moved = new Event("pointermove", { bubbles: true });
    Object.defineProperty(moved, "buttons", { value: 0 });
    document.dispatchEvent(moved);
    expect([
      document.body.classList.contains("main-tab-dragging"),
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

  test("route が画像のファイルなら画像のタブ", () => {
    expect(routeTarget(fileRoute("docs/images/dunes.png"))).toEqual({
      kind: "image",
      path: "docs/images/dunes.png",
    });
  });
});
