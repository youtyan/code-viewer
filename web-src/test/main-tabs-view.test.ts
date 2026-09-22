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
import type {
  SerializedCommonTabs,
  SerializedLayout,
  TabTarget,
} from "../core/main-tabs";
import { panelColumnAction } from "../core/panel-column-policy";
import { HISTORY_WIDTH } from "../core/panel-sizes";
import { type AppRoute, urlKeepsSavedFront } from "../core/routes";
import { closeContextMenu } from "../views/context-menu";
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
  panelColumn?: HTMLElement,
  backupSaved: () => Promise<string> = async () =>
    "/state/main-tabs.json.broken-sample",
  initial: AppRoute = fileRoute("src/app.ts"),
  loadCommon: () => Promise<unknown> = async () => null,
  extra: Partial<MainTabsDeps> = {},
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
    ...extra,
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
        "Move left",
        "Move right (disabled)",
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
      [...mount.querySelectorAll(".main-tabs-strip")].map((strip) =>
        strip.getAttribute("aria-label"),
      ),
      divider?.getAttribute("aria-valuenow"),
      Number(divider?.getAttribute("aria-valuemin")) <
        Number(divider?.getAttribute("aria-valuemax")),
    ]).toEqual([["Open tabs, left side", "Open tabs, right side"], "50", true]);
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

  // 2 面のときの一覧の列と右の列 (ui-layout.md の「一覧の列と右の列」)。一覧の
  // 画面 (Diff・History・選んでいる作業ツリー) は一覧を本文の左の列に出し、右の列は
  // 帯 (28) に畳んだまま。History は一覧の右に変更ファイルの木 (240) の列も並ぶ
  // (どちらも面の外)。本文が 2 面のゆとり (961) に足りなければ、一覧を詰めた幅
  // (240) にし、次に木を帯 (28) に畳み (core/list-column.ts。app.ts が決めて
  // listColumnWidth で渡す)、それでも 2 面の下限 (641) に足りなければ右の面を
  // 預ける。一覧の無い画面 (Files。右の列 240) は、ゆとりが無ければ右の列を畳む。
  // 本文の幅 = 窓 − 左のサイドバー 280 − 右の列 − 一覧の列。
  test.each([
    {
      screen: "History",
      window: 1216,
      column: 268,
      parked: true,
      action: "keep",
    },
    {
      screen: "History",
      window: 1217,
      column: 268,
      parked: false,
      action: "keep",
    },
    {
      screen: "History",
      window: 1280,
      column: 268,
      parked: false,
      action: "keep",
    },
    {
      screen: "History",
      window: 1600,
      column: 268,
      parked: false,
      action: "keep",
    },
    {
      screen: "History",
      window: 1748,
      column: 268,
      parked: false,
      action: "keep",
    },
    {
      screen: "History",
      window: 1749,
      column: 480,
      parked: false,
      action: "keep",
    },
    {
      screen: "History",
      window: 1829,
      column: 560,
      parked: false,
      action: "keep",
    },
    { screen: "Diff", window: 1188, column: 240, parked: true, action: "keep" },
    {
      screen: "Diff",
      window: 1189,
      column: 240,
      parked: false,
      action: "keep",
    },
    {
      screen: "Diff",
      window: 1588,
      column: 240,
      parked: false,
      action: "keep",
    },
    {
      screen: "Diff",
      window: 1589,
      column: 320,
      parked: false,
      action: "keep",
    },
    {
      screen: "Files",
      window: 1280,
      column: 0,
      parked: false,
      action: "collapse",
    },
    {
      screen: "Files",
      window: 1440,
      column: 0,
      parked: false,
      action: "collapse",
    },
    { screen: "Files", window: 1600, column: 0, parked: false, action: "keep" },
  ] as const)("$screen・窓 $window px: 一覧の列 $column px・右の面を預けるか $parked・右の列 $action", async ({
    screen,
    window,
    column,
    parked,
    action,
  }) => {
    const holdsList = screen !== "Files";
    const rail = 28;
    Object.defineProperty(document.documentElement, "clientWidth", {
      configurable: true,
      value: window - 280,
    });
    const panelColumn = document.createElement("div");
    panelColumn.getBoundingClientRect = () =>
      new DOMRect(0, 0, holdsList ? rail : 240, 80);
    const layout = listColumnLayout({
      room: window - 280 - rail,
      preferred: HISTORY_WIDTH.default,
      compact: HISTORY_WIDTH.min,
      tree: screen === "History" ? 240 : 0,
      treeRail: rail,
      treeKeptOpen: false,
      need: COMFORTABLE_PANE_WIDTH * 2 + SPLIT_DIVIDER_WIDTH,
    });
    const listWidth = holdsList ? layout.width + layout.tree : 0;
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
      panelColumn,
      undefined,
      undefined,
      undefined,
      {
        panelColumnHoldsList: () => holdsList,
        listColumnWidth: () => listWidth,
      },
    );
    await handle.restore();
    const split = panes(handle).split;
    expect({
      column: listWidth,
      parked: !split,
      action: panelColumnAction({
        split,
        holdsList,
        leftList: false,
        // 一覧の画面では右の列はもう一覧のために畳んである。
        autoHidden: holdsList,
        userHidden: false,
        userOptedOut: false,
        fitsWithColumn: handle.splitFitsWithPanelColumn(),
      }),
      // 預けた理由は、一覧のために預けたとき専用の説明
      reason: !split
        ? splitButton(mount)?.title.startsWith(
            "The right side (1 tab) is set aside to make room for this screen's list",
          )
        : null,
    }).toEqual({ column, parked, action, reason: parked ? true : null });
  });

  // 利用者の選んだ状態は上書きしない。一覧の画面 (一覧を本文の左の列に出す) に
  // 入ると右の列を帯に畳み、一覧の画面を出る / 1 面に戻ると、自動で畳んだものだけ
  // 開く。
  test.each([
    {
      name: "2 面・ゆとり無し",
      split: true,
      holdsList: false,
      autoHidden: false,
      userHidden: false,
      userOptedOut: false,
      fits: false,
      action: "collapse",
    },
    {
      name: "2 面・ゆとり有り",
      split: true,
      holdsList: false,
      autoHidden: false,
      userHidden: false,
      userOptedOut: false,
      fits: true,
      action: "keep",
    },
    {
      name: "2 面・もう自動で畳んだ",
      split: true,
      holdsList: false,
      autoHidden: true,
      userHidden: false,
      userOptedOut: false,
      fits: false,
      action: "keep",
    },
    {
      name: "2 面・利用者が畳んでいる",
      split: true,
      holdsList: false,
      autoHidden: false,
      userHidden: true,
      userOptedOut: false,
      fits: false,
      action: "keep",
    },
    {
      name: "2 面・利用者が 2 面の間に開いた",
      split: true,
      holdsList: false,
      autoHidden: false,
      userHidden: false,
      userOptedOut: true,
      fits: false,
      action: "keep",
    },
    {
      name: "一覧の画面に入った (1 面)",
      split: false,
      holdsList: true,
      autoHidden: false,
      userHidden: false,
      userOptedOut: false,
      fits: true,
      action: "collapse",
    },
    {
      name: "一覧の画面に入った (2 面・ゆとり有り・開くと決めていた)",
      split: true,
      holdsList: true,
      autoHidden: false,
      userHidden: false,
      userOptedOut: true,
      fits: true,
      action: "collapse",
    },
    {
      name: "一覧の画面・2 面のためにもう自動で畳んでいた",
      split: true,
      holdsList: true,
      autoHidden: true,
      userHidden: false,
      userOptedOut: false,
      fits: false,
      action: "keep",
    },
    {
      name: "一覧の画面から出た (1 面)・一覧のために畳んでいた",
      split: false,
      holdsList: false,
      leftList: true,
      autoHidden: true,
      userHidden: false,
      userOptedOut: false,
      fits: false,
      action: "restore",
    },
    {
      name: "一覧の画面から出た (2 面)・一覧のために畳んでいた",
      split: true,
      holdsList: false,
      leftList: true,
      autoHidden: true,
      userHidden: false,
      userOptedOut: false,
      fits: true,
      action: "restore",
    },
    {
      name: "一覧の画面から出た・利用者が畳んでいる",
      split: true,
      holdsList: false,
      leftList: true,
      autoHidden: false,
      userHidden: true,
      userOptedOut: false,
      fits: true,
      action: "keep",
    },
    {
      name: "一覧の画面・利用者が畳んでいる",
      split: true,
      holdsList: true,
      autoHidden: false,
      userHidden: true,
      userOptedOut: false,
      fits: false,
      action: "keep",
    },
    {
      name: "1 面・自動で畳んでいた",
      split: false,
      holdsList: false,
      autoHidden: true,
      userHidden: false,
      userOptedOut: false,
      fits: false,
      action: "restore",
    },
    {
      name: "1 面・利用者が畳んでいる",
      split: false,
      holdsList: false,
      autoHidden: false,
      userHidden: true,
      userOptedOut: false,
      fits: false,
      action: "keep",
    },
  ] as const)("右の列の決まり: $name → $action", ({
    name: _name,
    fits,
    action,
    ...state
  }) => {
    expect(
      panelColumnAction({ leftList: false, ...state, fitsWithColumn: fits }),
    ).toBe(action);
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

  // 背面のタブでは ResizeObserver が届かない。2 面のために右の列を畳んだあとも
  // --split-left-w が畳む前の幅のまま残っていた (body の印の変化で合わせ直す)。
  test("右の列を畳んで body の印が変わると、ResizeObserver を待たずに面の幅を書き直す", async () => {
    Object.defineProperty(document.documentElement, "clientWidth", {
      configurable: true,
      value: 1280,
    });
    let column = 240;
    const panelColumn = document.createElement("div");
    panelColumn.getBoundingClientRect = () => new DOMRect(0, 0, column, 80);
    const { handle, mount } = setup(async () => null, panelColumn);
    await handle.restore();
    handle.syncRoute({ screen: "diff", range });
    handle.openTerminal("shell-a1");
    splitButton(mount)?.click();
    const style = document.documentElement.style;
    // 本文 1040px (右の列 240 を除く) = 520 + 1 + 519。
    expect(style.getPropertyValue("--split-left-w")).toBe("520px");
    column = 28;
    document.body.classList.add("sample-column-hidden");
    await Promise.resolve();
    // 本文 1252px = 626 + 1 + 625。
    expect([
      style.getPropertyValue("--split-left-w"),
      style.getPropertyValue("--split-right-w"),
    ]).toEqual(["626px", "625px"]);
    document.body.classList.remove("sample-column-hidden");
  });

  // タブの最小幅は列の幅をタブの数で割って決める (style.css の .main-tab)。
  test("タブの列にタブの数を書く", async () => {
    const { handle, mount } = setup(async () => null);
    await handle.restore();
    handle.syncRoute({ screen: "diff", range });
    handle.openTerminal("shell-a1");
    const strip = mount.querySelector<HTMLElement>(
      '.main-tabs-pane[data-side="left"] .main-tabs-strip',
    );
    expect([
      strip?.style.getPropertyValue("--main-tab-count"),
      strip?.querySelectorAll(".main-tab").length,
    ]).toEqual(["3", 3]);
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
