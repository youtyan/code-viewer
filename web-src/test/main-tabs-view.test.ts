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
import type { SerializedLayout, TabTarget } from "../core/main-tabs";
import type { AppRoute } from "../core/routes";
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
function setup(loadSaved: () => Promise<unknown>, leftColumn?: HTMLElement) {
  const mount = document.createElement("nav");
  document.body.append(mount);
  const saves: SerializedLayout[] = [];
  const fronts: string[] = [];
  const terminals: Array<{ open: string[]; closed: string[] }> = [];
  /** ＋ と、ターミナルのタブの右クリックから呼ばれたもの。 */
  const calls: string[] = [];
  let current: AppRoute = fileRoute("src/app.ts");
  const handle: MainTabsHandle = createMainTabsView({
    mount,
    ...(leftColumn ? { leftColumn } : {}),
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
        : { screen: "diff", range },
    homeRoute: () => ({ screen: "repo", ref: "worktree", path: "", range }),
    copyPath: () => undefined,
    onNewTab: (side, anchor) =>
      calls.push(`new:${side}:${anchor.getAttribute("aria-label")}`),
    stopTerminal: (session) => calls.push(`stop:${session}`),
    terminalMenuItems: () => [
      { label: "Larger text (13)", onSelect: () => calls.push("larger") },
    ],
    loadSaved,
    save: async (layout) => {
      saves.push(layout);
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

  test("壊れた保存値なら空から始め、理由を全部 console.error に出す", async () => {
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
    const { handle, names } = setup(async () => broken);
    await handle.restore();
    expect(names()).toEqual([">app.ts (preview)"]);
    const logged = error.mock.calls.map((call) => call.map(String).join(" "));
    expect(logged).toHaveLength(1);
    for (const reason of [
      "the saved layout is broken; starting from an empty layout",
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

  // 面の最小幅 360 は本文 (左の列の右) の幅で数える。1 + 360 * 2 = 721px 要る。
  test.each([
    { window: 960, column: 240, split: false },
    { window: 961, column: 240, split: true },
    { window: 960, column: 0, split: true },
  ])("窓 $window px・左の列 $column px なら分割できるか: $split", async ({
    window,
    column,
    split,
  }) => {
    Object.defineProperty(document.documentElement, "clientWidth", {
      configurable: true,
      value: window,
    });
    const leftColumn = document.createElement("div");
    leftColumn.getBoundingClientRect = () => new DOMRect(0, 0, column, 80);
    const { handle, mount } = setup(async () => null, leftColumn);
    await handle.restore();
    handle.syncRoute({ screen: "diff", range });
    handle.openTerminal("shell-a1");
    splitButton(mount)?.click();
    expect(panes(handle).split).toBe(split);
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
