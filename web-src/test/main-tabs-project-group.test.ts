// 開いているプロジェクトの画面を見ているなら、そのプロジェクトのグループ (札) が
// タブ列にある。tmux やエージェントの有無に依らない (2026-09-24 に利用者と決めた)。
//
// エージェントの居ないプロジェクトを左の一覧から開くと、そのプロジェクトのタブが
// 1 枚も無く、フォルダ表示 (route の repo) で開く。フォルダ表示はタブにしないので、
// 札も出なかった。エージェントの居るプロジェクトは、そのシェルのタブがグループを
// 作るので出ていた。
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
import type { TabTarget } from "../core/main-tabs";
import type { AppRoute } from "../core/routes";
import { closeContextMenu } from "../views/context-menu";
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
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

const range = { from: "HEAD", to: "worktree" };
const APP = "/work/sample-app";
const LIB = "/work/sample-lib";
/** 左の一覧に無いプロジェクト (登録していない・作業ツリー)。 */
const LOOSE = "/work/sample-loose";
const WORKTREE = "/work/sample-app-feature";
const LOOKS: Record<string, { name: string; initials: string }> = {
  [APP]: { name: "sample-app", initials: "SA" },
  [LIB]: { name: "sample-lib", initials: "SL" },
};

const home: AppRoute = { screen: "repo", ref: "worktree", path: "", range };
const diff = { screen: "diff", range } as AppRoute;
const fileRoute = (path: string): AppRoute => ({
  screen: "file",
  path,
  ref: "worktree",
  range,
  view: "blob",
});

const owned = (id: string, target: object, project: string) => ({
  id,
  preview: false,
  target: { ...target, project },
});

/** 別のプロジェクト (エージェントの居る LIB) のタブだけがある保存。 */
const libOnly = {
  version: 5,
  focused: "left",
  panes: [
    {
      side: "left",
      activeId: "l1",
      tabs: [
        owned("l1", { kind: "file", path: "lib.ts" }, LIB),
        {
          id: "sh",
          preview: false,
          target: { kind: "terminal", session: "shell-lib" },
        },
      ],
    },
  ],
};

/** このプロジェクト (APP) のタブが 1 枚だけある保存。 */
const withAppReadme = {
  ...libOnly,
  panes: [
    {
      ...libOnly.panes[0],
      activeId: "a1",
      tabs: [
        ...libOnly.panes[0].tabs,
        owned("a1", { kind: "file", path: "README.md" }, APP),
      ],
    },
  ],
};

/**
 * app.ts と同じ順 (URL の route → 読み戻し) で起こす。root はこのページの
 * プロジェクトの根 (読み戻しの応答の root = 裏のサーバの cwd)。
 */
async function open(saved: unknown, root: string, route: AppRoute) {
  const mount = document.createElement("nav");
  document.body.append(mount);
  let current = route;
  const deps: MainTabsDeps = {
    mount,
    getLanguage: () => "en",
    pageLabel: (page) => page,
    navigate: (next) => {
      current = next;
      handle.syncRoute(next);
    },
    currentRoute: () => current,
    defaultRoute: (target: TabTarget): AppRoute =>
      target.kind === "file"
        ? fileRoute(target.path)
        : target.kind === "page"
          ? ({ screen: target.page, range } as AppRoute)
          : diff,
    homeRoute: () => home,
    copyPath: () => undefined,
    onNewTab: () => undefined,
    stopTerminal: () => undefined,
    terminalMenuItems: () => [],
    loadSaved: async () => ({ layout: saved, rev: 1, root }),
    save: async () => undefined,
    backupSaved: async () => "/state/main-tabs.json.broken-sample",
    terminalInfo: (session) => ({ label: `Shell ${session}`, state: null }),
    onPanes: () => undefined,
    onTerminals: () => undefined,
    projectOrder: () => [LIB, APP],
    projectLook: (key) =>
      LOOKS[key] ? { root: key, ...LOOKS[key], color: "green" } : null,
    terminalProject: (session) => (session === "shell-lib" ? LIB : null),
    switchProject: () => undefined,
    foreignInPlace: () => true,
    newShellIn: () => undefined,
    launchAgentIn: () => undefined,
  };
  const handle = createMainTabsView(deps);
  handle.syncRoute(current);
  await handle.restore();
  return { mount, handle };
}

/** 左の面のタブ列を並びのまま短く書く (札は [グループの根]、＋ は +)。 */
const strip = (mount: HTMLElement) =>
  [
    ...(mount.querySelector<HTMLElement>(
      '.main-tabs-pane[data-side="left"] .main-tabs-strip',
    )?.children ?? []),
  ].map((child) => {
    if (child.classList.contains("main-tab-group"))
      return `[${child.getAttribute("data-group")}]`;
    if (child.classList.contains("main-tabs-new")) return "+";
    const tabs = [...child.querySelectorAll(".main-tab")].map(
      (tab) =>
        `${tab.classList.contains("main-tab-active") ? ">" : ""}${tab.querySelector(".main-tab-name")?.textContent}`,
    );
    return `${child.getAttribute("data-group") ?? "-"}(${tabs.join(" ")})`;
  });

const heads = (mount: HTMLElement) =>
  strip(mount).filter((item) => item.startsWith("["));

describe("開いているプロジェクトのグループ", () => {
  test.each([
    {
      name: "エージェントの居ない登録済みのプロジェクトを、フォルダ表示で開いた (利用者の報告)",
      saved: libOnly,
      root: APP,
    },
    {
      name: "保存がまだ無い (初めて開いた) プロジェクトを、フォルダ表示で開いた",
      saved: null,
      root: APP,
    },
    {
      name: "登録していないプロジェクトを、フォルダ表示で開いた",
      saved: libOnly,
      root: LOOSE,
    },
    {
      name: "作業ツリーを、フォルダ表示で開いた",
      saved: libOnly,
      root: WORKTREE,
    },
  ])("$name: そのプロジェクトの札がある", async ({ saved, root }) => {
    const { mount } = await open(saved, root, home);
    expect(heads(mount)).toContain(`[${root}]`);
  });

  // 対照: route がタブになる画面なら、今も札とタブが出る。
  test("Diff で開いた: そのプロジェクトの札と Diff のタブがある", async () => {
    const { mount } = await open(libOnly, APP, diff);
    expect(strip(mount)).toEqual([
      `[${LIB}]`,
      `${LIB}(lib.ts Shell shell-lib)`,
      `[${APP}]`,
      `${APP}(>diff)`,
      "+",
      // どのプロジェクトのものでもないタブの並び (空)。
      "-()",
    ]);
  });

  test("このプロジェクトの最後のタブを閉じてフォルダ表示に戻っても、札は残る", async () => {
    const { mount } = await open(withAppReadme, APP, fileRoute("README.md"));
    const before = heads(mount);
    mount
      .querySelector<HTMLElement>('.main-tab[data-tab-id="a1"] .main-tab-close')
      ?.click();
    expect([before, heads(mount)]).toEqual([
      [`[${LIB}]`, `[${APP}]`],
      [`[${LIB}]`, `[${APP}]`],
    ]);
  });

  test("フォルダ表示のまま別のプロジェクトのファイルを前面にしても、このプロジェクトの札は残る", async () => {
    const { mount } = await open(libOnly, APP, home);
    mount.querySelector<HTMLElement>('.main-tab[data-tab-id="l1"]')?.click();
    expect(heads(mount)).toEqual([`[${LIB}]`, `[${APP}]`]);
  });

  test("タブの無いグループは並びの位置 (左の一覧の順、一覧に無ければその後ろ) に入る", async () => {
    const withLoose = {
      ...libOnly,
      panes: [
        {
          ...libOnly.panes[0],
          tabs: [
            ...libOnly.panes[0].tabs,
            {
              id: "ag",
              preview: false,
              target: { kind: "page", page: "agents" },
            },
          ],
        },
      ],
    };
    const { mount } = await open(withLoose, LOOSE, home);
    expect(strip(mount)).toEqual([
      `[${LIB}]`,
      `${LIB}(>lib.ts Shell shell-lib)`,
      `[${LOOSE}]`,
      `${LOOSE}()`,
      "+",
      "-(agents)",
    ]);
  });
});

describe("タブの無いグループの札", () => {
  /** 開いたメニューの並び (区切りは ---、押せない項目は (disabled))。 */
  const menuOf = (mount: HTMLElement, root: string) => {
    mount
      .querySelector<HTMLElement>(
        `.main-tab-group[data-group="${root}"] .main-tab-group-menu`,
      )
      ?.click();
    const items = [
      ...(document.querySelector(".gdp-context-menu")?.children ?? []),
    ].map((item) =>
      item.tagName === "HR"
        ? "---"
        : `${item.textContent}${(item as HTMLButtonElement).disabled ? ` (disabled: ${(item as HTMLButtonElement).title})` : ""}`,
    );
    closeContextMenu();
    return items;
  };

  test("▾ の畳む・閉じるは押せない (新しいシェル・エージェント・画面の行は押せる)。タブのあるグループは押せる", async () => {
    const { mount } = await open(libOnly, APP, home);
    expect([menuOf(mount, APP), menuOf(mount, LIB)]).toEqual([
      [
        "sample-app (disabled: /work/sample-app)",
        "---",
        "New shell",
        "New agent…",
        "---",
        "repo",
        "diff",
        "history",
        "worktree",
        "database",
        "journal",
        "---",
        "Switch to this project (disabled: This project is already open)",
        "Collapse (disabled: No tabs are open in this project)",
        "---",
        "Close this group (disabled: No tabs are open in this project)",
      ],
      [
        "sample-lib (disabled: /work/sample-lib)",
        "---",
        "New shell",
        "New agent…",
        "---",
        "repo",
        "diff",
        "history",
        "worktree",
        "database",
        "journal",
        "---",
        "Switch to this project",
        "Collapse",
        "---",
        "Close this group",
      ],
    ]);
  });

  test("札を押しても畳まない (札の説明はタブが無いこと)", async () => {
    const { mount } = await open(libOnly, APP, home);
    const toggle = () =>
      mount.querySelector<HTMLElement>(
        `.main-tab-group[data-group="${APP}"] .main-tab-group-toggle`,
      );
    toggle()?.click();
    expect([
      mount
        .querySelector(`.main-tab-group[data-group="${APP}"]`)
        ?.classList.contains("main-tab-group-collapsed"),
      toggle()?.getAttribute("aria-label"),
    ]).toEqual([false, "sample-app: No tabs are open in this project"]);
  });

  // happy-dom は配置をしないので、札 60px・＋ 28px・タブ (60 + 名前の字数 × 8) を
  // 決めて見る。lib.ts 108 + Shell shell-lib 180 = 288。札 1 つなら 400 - 88 = 312 に
  // 入るが、タブの無い札も数えると 400 - 148 = 252 に入らず縮める。
  test("タブの無い札の幅も、タブを縮める計算 (fitTabs) に入る", async () => {
    const { mount, handle } = await open(libOnly, APP, home);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        let width = 0;
        if (this.classList.contains("main-tab")) {
          const set = this.style.getPropertyValue("--main-tab-w");
          width = set
            ? Number.parseFloat(set)
            : 60 +
              (this.querySelector(".main-tab-name")?.textContent?.length ?? 0) *
                8;
        } else if (this.classList.contains("main-tab-group")) width = 60;
        else if (this.classList.contains("main-tabs-new")) width = 28;
        return {
          left: 0,
          top: 0,
          width,
          height: 34,
          right: width,
          bottom: 34,
        } as DOMRect;
      },
    );
    const strip = mount.querySelector<HTMLElement>(
      '.main-tabs-pane[data-side="left"] .main-tabs-strip',
    ) as HTMLElement;
    strip.style.setProperty("--space-unit", "4px");
    const at = (width: number) => {
      Object.defineProperty(strip, "clientWidth", {
        configurable: true,
        get: () => width,
      });
      handle.localize();
      return [...mount.querySelectorAll<HTMLElement>(".main-tab")].map(
        (tab) => tab.style.getPropertyValue("--main-tab-w") || "auto",
      );
    };
    const wide = at(500);
    const narrow = at(400);
    expect([
      wide,
      narrow.every((width) => width !== "auto"),
      strip.querySelectorAll(":scope > .main-tab-group").length,
    ]).toEqual([["auto", "auto"], true, 2]);
  });
});
