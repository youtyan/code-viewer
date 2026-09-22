import { GlobalRegistrator } from "@happy-dom/global-registrator";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import type { SerializedLayout, TabTarget } from "../core/main-tabs";
import type { AppRoute } from "../core/routes";
import {
  createMainTabsView,
  type MainTabsHandle,
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
function setup(loadSaved: () => Promise<unknown>) {
  const mount = document.createElement("nav");
  document.body.append(mount);
  const saves: SerializedLayout[] = [];
  const fronts: string[] = [];
  const terminals: Array<{ open: string[]; closed: string[] }> = [];
  let current: AppRoute = fileRoute("src/app.ts");
  const handle: MainTabsHandle = createMainTabsView({
    mount,
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
        : target.kind === "page" && target.page === "repo"
          ? { screen: "repo", ref: "worktree", path: "", range }
          : { screen: "diff", range },
    copyPath: () => undefined,
    onNewTab: () => undefined,
    loadSaved,
    save: async (layout) => {
      saves.push(layout);
    },
    terminalInfo: (session) =>
      session === "shell-a1"
        ? { label: "claude · Working", state: "working" }
        : { label: `Shell ${session}`, state: null },
    onFront: (tab, how) => {
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
      "Shell shell-ab12",
    ]);
  });

  test("知らない種類と、まだ開けない種類のタブは件数と中身を console.error に出す", async () => {
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
      expect.stringContaining(
        'closed 1 saved tab(s) that cannot be opened yet: [{"id":"t4"',
      ),
    ]);
  });

  test("壊れた保存値なら空から始め、理由を全部 console.error に出す", async () => {
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const broken = {
      version: 7,
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
      "version is 7, expected 1",
      "panes[0] has 2 preview tabs (a, b); at most 1",
      'panes[0].activeId "zz" is not a tab of the pane',
    ])
      expect(logged[0]).toContain(reason);
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

  test("選択中のタブを閉じたら直前のタブへ、最後の 1 つなら Files へ", async () => {
    const { handle, names } = setup(async () => null);
    await handle.restore();
    handle.syncRoute({ screen: "diff", range });
    handle.closeActive();
    const afterFirst = names();
    handle.closeActive();
    expect([afterFirst, names()]).toEqual([[">app.ts (preview)"], [">repo"]]);
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
});

describe("main tabs view: ターミナルのタブ", () => {
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
      ["README.md", "app.ts (preview)", "diff", ">Shell shell-ab12"],
      "terminal:stay",
    ]);
  });

  test("読み戻したターミナルのタブは残し、開いているシェルを知らせる", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { handle, names, terminals } = setup(async () => savedLayout);
    await handle.restore();
    expect([names(), terminals[terminals.length - 1]]).toEqual([
      ["README.md", ">app.ts (preview)", "diff", "Shell shell-ab12"],
      { open: ["shell-ab12"], closed: [] },
    ]);
  });
});
