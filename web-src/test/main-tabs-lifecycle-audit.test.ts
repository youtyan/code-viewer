// メインの面のタブの一生の総点検 (場面 × 観測)。
//
// 画面の部品 (views/main-tabs) を、プロジェクトのグループ (並び・シェルのグループ・
// このページのプロジェクト) つきで立て、本物の保存 (server/main-tabs-store.ts) の
// 一時ファイルにつなぐ。窓は何枚でも開ける (読み直し = 同じ URL の新しい窓)。
// 場面ごとに、タブの集合・順・前面・グループ・面・保存した配置・URL を見る。
//
// 「不具合の再現」の describe は、見つけた不具合を具体的な操作列で固定したもの
// (直すまで赤)。ほかは「確かめた、起きない」の記録 (緑)。一覧と判定は
// 調査の報告 (tab-lifecycle-audit.md) にある。

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setImmediate as realImmediate } from "node:timers";
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
import type { AgentOverviewResponse } from "../core/agent-overview";
import {
  allTabs,
  allTabs as allTabsOf,
  closedTabs,
  closeToRight,
  emptyLayout,
  type Layout,
  open as openTab,
  type PaneSide,
  pushClosed,
  reopenClosed,
  setCollapsed,
  type Tab,
  type TabTarget,
  tabGroups,
} from "../core/main-tabs";
import { mergeLayouts } from "../core/main-tabs-merge";
import { PHONE_MEDIA_QUERY } from "../core/mobile-layout";
import { lastTabNumber } from "../core/pwa";
import type { AppRoute } from "../core/routes";
import { loadMainTabs, saveMainTabs } from "../server/main-tabs-store";
import {
  createMainTabsView,
  type MainTabsDeps,
  type MainTabsHandle,
} from "../views/main-tabs/main-tabs-view";
import { createProjectLooks } from "../views/projects/project-looks";

beforeAll(() => {
  GlobalRegistrator.register();
  // happy-dom の classList.toggle は、変わらないときも class を書き直して
  // MutationObserver に届ける (ブラウザは届けない)。画面の部品は body の class の
  // 変化を見て合わせ直す (followGeometry) ので、本物の時計で 1 周回すたびに
  // 合わせ直し → toggle → 変化 … と止まらなくなる。仕様どおり、変わらなければ
  // 何もしないようにする。
  const proto = Object.getPrototypeOf(document.body.classList) as DOMTokenList;
  const toggle = proto.toggle;
  proto.toggle = function (this: DOMTokenList, token: string, force?: boolean) {
    const has = this.contains(token);
    if (force === undefined ? false : force === has) return has;
    return toggle.call(this, token, force);
  };
  // 窓 (画面の部品) を 2 つ同じ document に立てるので、body の main-split を
  // 片方が付け、もう片方が外す、を互いの MutationObserver が拾って止まらない
  // (本物の窓は document が別)。main-split だけが変わった記録は届けない。
  const Real = globalThis.MutationObserver;
  const RealResize = globalThis.ResizeObserver;
  globalThis.ResizeObserver = class extends RealResize {
    constructor(callback: ResizeObserverCallback) {
      const born = testRun;
      super((entries, observer) => {
        if (born === testRun) callback(entries, observer);
      });
    }
  } as typeof ResizeObserver;
  const classes = (value: string | null) =>
    new Set((value ?? "").split(/\s+/).filter(Boolean));
  globalThis.MutationObserver = class extends Real {
    constructor(callback: MutationCallback) {
      // 前のテストで立てた窓は片付けられないので、そのテストが終わったら黙らせる
      // (同じ body を見ていて、次のテストの窓の変化に反応してしまう)。
      const born = testRun;
      super((records, observer) => {
        if (born !== testRun) return;
        const kept = records.filter((record) => {
          if (record.attributeName !== "class") return true;
          const before = classes(record.oldValue);
          const after = classes(
            (record.target as Element).getAttribute("class"),
          );
          const changed = [...before, ...after].filter(
            (name) => before.has(name) !== after.has(name),
          );
          return !changed.every((name) => name === "main-split");
        });
        if (kept.length > 0) callback(kept, observer);
      });
    }
    observe(target: Node, options?: MutationObserverInit): void {
      super.observe(
        target,
        options?.attributes ? { ...options, attributeOldValue: true } : options,
      );
    }
  } as typeof MutationObserver;
});

afterAll(() => {
  GlobalRegistrator.unregister();
});

let dir = "";
let store = "";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cv-tab-audit-"));
  store = join(dir, "main-tabs.json");
  // 保存の待ち (300ms) は偽の時計にして、決まった時点 (settle の flush) でだけ送る
  // (本物の時計だと、保存が途中の任意の時点で走り、同じ種で同じ手順にならない)。
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  // デスクトップの広い窓 (2 面を置ける幅)。
  Object.defineProperty(document.documentElement, "clientWidth", {
    configurable: true,
    value: 2400,
  });
});

afterEach(() => {
  openWindows.length = 0;
  testRun += 1;
  vi.useRealTimers();
  Reflect.deleteProperty(document.documentElement, "clientWidth");
  document.body.replaceChildren();
  rmSync(dir, { recursive: true, force: true });
});

const A = "/work/alpha";
const B = "/work/beta";
const C = "/work/gamma";

const range = { from: "HEAD", to: "worktree" };
const fileRoute = (path: string): AppRoute => ({
  screen: "file",
  path,
  ref: "worktree",
  range,
  view: "blob",
});
const pageRoute = (screen: "diff" | "database" | "history"): AppRoute =>
  ({ screen, range }) as AppRoute;
const HOME: AppRoute = { screen: "repo", ref: "worktree", path: "", range };

/** 窓どうしで共有する、プロジェクトの一覧と、シェルがどのプロジェクトか。 */
type World = {
  order: string[];
  shells: Record<string, string | null | undefined>;
};

type Window = ReturnType<typeof openWindow>;

let windowCount = 0;
/** いま走っているテストの番号 (前のテストの窓の監視を黙らせる)。 */
let testRun = 0;

/** 書いている最中の保存 (全部の窓)。ロックの待ちも偽の時計で進むので、まとめて進める。 */
const inflight = new Set<Promise<unknown>>();
/** 書けなかった保存 (握りつぶさずに、settle で落とす)。 */
const saveFailures: unknown[] = [];
/** 保存を 1 本ずつ通す列。 */
let saveQueue: Promise<unknown> = Promise.resolve();

/** 開いている窓 (settle が保存を送らせる)。 */
const openWindows: Array<{ handle: MainTabsHandle }> = [];

/**
 * 全部の窓の保存が書き終わるまで待つ。待っている保存はすぐ送らせ (flush)、
 * 書き終わった後の続き (重ねた値を当てる・次の保存) が無くなるまで回す。
 * 保存は 1 本ずつ通すので、ファイルのロックの待ち (偽の時計では進まない) には入らない。
 */
async function settle(): Promise<void> {
  let quiet = 0;
  for (let round = 0; round < 200 && quiet < 3; round += 1) {
    for (const win of openWindows) win.handle.flush(false);
    if (inflight.size > 0) {
      quiet = 0;
      await Promise.allSettled([...inflight]);
    } else quiet += 1;
    // happy-dom の setTimeout は途中から進まなくなることがあるので、node の本物で 1 周。
    await new Promise((resolve) => realImmediate(resolve));
  }
  if (inflight.size > 0)
    throw new Error(`saves did not settle: ${inflight.size} in flight`);
  if (saveFailures.length > 0)
    throw Object.assign(new Error("a save failed"), {
      cause: saveFailures.splice(0),
    });
}

/** 1 つの窓 (ページ)。root はこのページのプロジェクト、url は読み込んだときの URL。 */
function openWindow(
  world: World,
  root: string,
  url: AppRoute = HOME,
  extra: Partial<MainTabsDeps> = {},
) {
  const name = `w${++windowCount}`;
  // その窓が読み書きする保存 (前の場面の窓が、後から次の場面の保存に書かないように)。
  const file = store;
  // その窓だけの保存 (ブラウザの sessionStorage は窓ごと。読み直しでは同じものを渡す)。
  const windowStorage = extra.windowStorage ?? windowStorageOf(new Map());
  const mount = document.createElement("nav");
  document.body.append(mount);
  let current: AppRoute = url;
  let n = 0;
  const urls: string[] = [];
  const switches: string[] = [];
  const handle: MainTabsHandle = createMainTabsView({
    mount,
    getLanguage: () => "en",
    pageLabel: (page) => page,
    navigate: (route) => {
      current = route;
      urls.push(routeName(route));
      handle.syncRoute(route);
    },
    currentRoute: () => current,
    defaultRoute: (target: TabTarget): AppRoute =>
      target.kind === "file"
        ? fileRoute(target.path)
        : target.kind === "page"
          ? ({ screen: target.page, range } as AppRoute)
          : pageRoute("diff"),
    homeRoute: () => HOME,
    copyPath: () => undefined,
    onNewTab: () => undefined,
    stopTerminal: () => undefined,
    terminalMenuItems: () => [],
    loadSaved: async () => {
      const loaded = await loadMainTabs(file);
      if (loaded.kind === "newer") throw new Error("newer");
      return loaded.kind === "ok"
        ? { layout: loaded.layout, rev: loaded.rev, root }
        : { layout: null, rev: null, root };
    },
    save: (layout, _keepalive, base) => {
      // 保存は 1 本ずつ (サーバではファイルのロックが順に通す。ここでロックの
      // 待ちに入ると、その再試行の時計が happy-dom の下で進まない)。
      const written = saveQueue
        .then(() =>
          saveMainTabs(file, {
            baseRev: base.rev,
            base: base.layout,
            layout,
          }),
        )
        .then((saved) => {
          if (saved.kind !== "ok") throw new Error(`not saved: ${saved.kind}`);
          return saved;
        });
      saveQueue = written.then(
        () => undefined,
        () => undefined,
      );
      inflight.add(written);
      written.then(
        () => inflight.delete(written),
        (error: unknown) => {
          inflight.delete(written);
          saveFailures.push(error);
        },
      );
      return written;
    },
    backupSaved: async () => {
      throw new Error("no backup in this test");
    },
    newTabId: () => `${name}-${++n}`,
    projectOrder: () => world.order,
    terminalProject: (session) =>
      session in world.shells ? world.shells[session] : undefined,
    foreignInPlace: () => true,
    switchProject: (to) => switches.push(to),
    terminalInfo: (session) => ({ label: session, state: null }),
    onPanes: () => undefined,
    onTerminals: () => undefined,
    ...extra,
    windowStorage,
  });
  handle.syncRoute(current);
  openWindows.push({ handle });
  const win = {
    name,
    windowStorage,
    mount,
    handle,
    urls,
    switches,
    url: () => routeName(current),
    route: () => current,
    /** URL を移る (リンク・入口・パレット・戻る)。 */
    go(route: AppRoute) {
      current = route;
      urls.push(routeName(route));
      handle.syncRoute(route);
    },
    /** 固定のタブで開く (⌘クリック・「新しいタブで開く」)。 */
    keep(route: AppRoute) {
      handle.openingNewTab(() => win.go(route));
    },
    /** 保存を今すぐ送り、書き終わるまで待つ。 */
    async save() {
      await settle();
    },
    /** 名前で探したタブの id。 */
    id(label: string): string {
      const tab = allTabs(handle.layout()).find((t) => labelOf(t) === label);
      if (!tab) throw new Error(`${name}: no tab ${label}: ${strip(handle)}`);
      return tab.id;
    },
    strip: () => strip(handle),
  };
  return win;
}

/** Map を中身にした、窓だけの保存 (sessionStorage の代わり)。 */
function windowStorageOf(
  items: Map<string, string>,
): Pick<Storage, "getItem" | "setItem"> {
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      items.set(key, value);
    },
  };
}

/** 窓を閉じる (もう保存を送らない)。 */
function close(win: Window): void {
  const at = openWindows.findIndex((item) => item.handle === win.handle);
  if (at >= 0) openWindows.splice(at, 1);
}

/** 読み直し: 同じ URL・同じプロジェクトの新しい窓 (前の窓は閉じた)。 */
async function reload(world: World, win: Window, root: string) {
  await win.save();
  win.handle.flush(true);
  await win.save();
  close(win);
  const next = openWindow(world, root, win.route(), {
    windowStorage: win.windowStorage,
  });
  // 読み直しは保存した前面を残す (app.ts の urlKeepsSavedFront: reloaded)。
  await next.handle.restore({ keepSavedFront: true });
  return next;
}

function routeName(route: AppRoute): string {
  return route.screen === "file" ? route.path : route.screen;
}

function labelOf(tab: Tab): string {
  switch (tab.target.kind) {
    case "file":
    case "image":
      return tab.target.path;
    case "page":
      return tab.target.page;
    case "terminal":
      return tab.target.session;
  }
}

const SHORT: Record<string, string> = { [A]: "A", [B]: "B", [C]: "C" };

/**
 * 観測: 面ごとの [グループ]タブ… (前面は >、仮は ~)、フォーカスのある面は *。
 * 例: "*L [A] a.ts >b.ts [B] c.ts [-] shell-x"
 */
function strip(handle: MainTabsHandle): string {
  const layout = handle.layout();
  const side = (s: PaneSide) => {
    const pane = s === "left" ? layout.panes.left : layout.panes.right;
    if (!pane) return null;
    const parts = tabGroups(pane.tabs, handle.groupOf).map(
      (group) =>
        `[${group.key === null ? "-" : (SHORT[group.key] ?? group.key)}] ${group.tabs
          .map(
            (tab) =>
              `${tab.id === pane.activeId ? ">" : ""}${labelOf(tab)}${tab.preview ? "~" : ""}`,
          )
          .join(" ")}`,
    );
    return `${layout.focused === s ? "*" : ""}${s === "left" ? "L" : "R"} ${parts.join(" ")}`.trim();
  };
  return [side("left"), side("right")].filter(Boolean).join(" | ");
}

/** 不変条件のうち、どの時点でも成り立つもの。破れていれば理由の一覧。 */
function broken(handle: MainTabsHandle): string[] {
  const layout: Layout = handle.layout();
  const out: string[] = [];
  for (const s of ["left", "right"] as const) {
    const pane = s === "left" ? layout.panes.left : layout.panes.right;
    if (!pane) continue;
    if (
      pane.activeId !== null &&
      !pane.tabs.some((t) => t.id === pane.activeId)
    )
      out.push(`${s}: the front ${pane.activeId} is not in the pane`);
    if (s === "right" && pane.activeId === null)
      out.push("right: no front tab");
    const keys = tabGroups(pane.tabs, handle.groupOf).map((g) => g.key);
    if (new Set(keys).size !== keys.length)
      out.push(`${s}: a group is split in two: ${JSON.stringify(keys)}`);
  }
  if (layout.focused === "right" && !layout.panes.right)
    out.push("focus is on a right pane that does not exist");
  return out;
}

/** 窓 1 つで、タブを並べた出発点を作る: A のファイル 2 つ・A の Data・B のファイル・シェル。 */
async function seed(world: World) {
  // 場面ごとに空の保存から (同じテストの中で何度も作り直せるように)。
  store = join(dir, `main-tabs-${++windowCount}.json`);
  // B のページで B のファイルを開いて保存 (別のプロジェクトのタブを作る)。
  const beta = openWindow(world, B, HOME);
  await beta.handle.restore();
  beta.keep(fileRoute("beta.ts"));
  beta.keep(fileRoute("beta2.ts"));
  await beta.save();
  close(beta);
  const alpha = openWindow(world, A, HOME);
  await alpha.handle.restore();
  alpha.keep(fileRoute("a1.ts"));
  alpha.keep(fileRoute("a2.ts"));
  alpha.go(pageRoute("database"));
  alpha.handle.openTerminal("shell-a");
  alpha.handle.openTerminal("shell-b");
  alpha.handle.openTerminal("shell-free");
  alpha.go(fileRoute("a1.ts"));
  await alpha.save();
  return alpha;
}

function world(): World {
  return {
    order: [A, B, C],
    shells: { "shell-a": A, "shell-b": B, "shell-free": null },
  };
}

// ---- 操作の道具 (画面の部品を、利用者と同じ入口から動かす) ----

/** タブの右クリックのメニューの項目を押す。 */
function tabMenu(win: Window, label: string, item: string): void {
  const el = win.mount.querySelector<HTMLElement>(
    `.main-tab[data-tab-id="${win.id(label)}"]`,
  );
  if (!el)
    throw new Error(`${win.name}: ${label} is not drawn: ${win.strip()}`);
  el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
  pickMenu(item);
}

/** グループの札の ▾ の項目を押す。 */
function groupMenu(win: Window, root: string, item: string): void {
  const button = win.mount.querySelector<HTMLElement>(
    `.main-tab-group[data-group="${root}"] .main-tab-group-menu`,
  );
  if (!button) throw new Error(`${win.name}: no group ${root}: ${win.strip()}`);
  button.click();
  pickMenu(item);
}

function pickMenu(label: string): void {
  const items = [...document.querySelectorAll<HTMLElement>("[role=menuitem]")];
  const found = items.find((item) => item.textContent === label);
  if (!found)
    throw new Error(
      `no menu item ${label}: ${items.map((item) => item.textContent).join(" / ")}`,
    );
  found.click();
}

/** グループの札を押す (畳む / 開く)。 */
function toggleGroup(win: Window, root: string): void {
  const toggle = win.mount.querySelector<HTMLElement>(
    `.main-tab-group[data-group="${root}"] .main-tab-group-toggle`,
  );
  if (!toggle) throw new Error(`${win.name}: no group ${root}: ${win.strip()}`);
  toggle.click();
}

/** タブ列のキー (そのタブにフォーカスがある)。 */
function tabKey(win: Window, label: string, init: KeyboardEventInit): void {
  const el = win.mount.querySelector<HTMLElement>(
    `.main-tab[data-tab-id="${win.id(label)}"]`,
  );
  if (!el)
    throw new Error(`${win.name}: ${label} is not drawn: ${win.strip()}`);
  el.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, ...init }));
}

/** 窓どうしで共有する中身 (面ごとのタブと持ち物・畳んだグループ)。前面は窓ごと。 */
function shared(win: Window): string {
  const layout = win.handle.layout();
  const tabs = (pane?: { tabs: Tab[] }) =>
    (pane?.tabs ?? [])
      .map(
        (tab) =>
          `${labelOf(tab)}${tab.target.kind !== "terminal" && tab.target.project ? `@${SHORT[tab.target.project] ?? tab.target.project}` : ""}`,
      )
      .join(",");
  return `L ${tabs(layout.panes.left)} | R ${tabs(layout.panes.right)} | collapsed ${JSON.stringify(layout.collapsed ?? [])}`;
}

/** 画面が 1 つの窓の中で変わっても、利用者が触っていないタブの前後は変わらない。 */
function untouchedOrder(before: string, after: string, touched: string[]) {
  const names = (text: string) =>
    text
      .replace(/\[[^\]]*\]|[>*~]|\bL\b|\bR\b|\|/g, " ")
      .split(/\s+/)
      .filter((name) => name && !touched.includes(name));
  const kept = new Set(names(after));
  return {
    before: names(before).filter((name) => kept.has(name)),
    after: names(after),
  };
}

describe("出発点", () => {
  test("seed はグループごとに並ぶ", async () => {
    const win = await seed(world());
    expect(win.strip()).toBe(
      "*L [A] >a1.ts a2.ts database shell-a [B] beta.ts beta2.ts shell-b [-] shell-free",
    );
    expect(broken(win.handle)).toEqual([]);
  });
});

// ---- 確かめた、起きない (場面ごと) ----

describe("開く", () => {
  test.each([
    {
      name: "＋・木・パレットのファイル (前面が別のプロジェクトのファイル)",
      act: (win: Window) => {
        win.handle.bringToFront(win.id("beta.ts"));
        win.go(fileRoute("new.ts"));
      },
      strip:
        "*L [A] a1.ts a2.ts database shell-a >new.ts~ [B] beta.ts beta2.ts shell-b [-] shell-free",
    },
    {
      name: "画面の入口 (Data) を 2 回押しても 1 つ",
      act: (win: Window) => {
        win.go(pageRoute("history"));
        win.go(pageRoute("database"));
        win.go(pageRoute("database"));
      },
      strip:
        "*L [A] a1.ts history a2.ts >database shell-a [B] beta.ts beta2.ts shell-b [-] shell-free",
    },
    {
      name: "サイドバーのエージェント・通知 (別のプロジェクトのシェル)",
      act: (win: Window, w: World) => {
        w.shells["shell-b2"] = B;
        win.handle.openTerminal("shell-b2");
      },
      strip:
        "*L [A] a1.ts a2.ts database shell-a [B] beta.ts beta2.ts shell-b >shell-b2 [-] shell-free",
    },
    {
      name: "パレットのセッション (もう開いているシェル) は前面に出すだけ",
      act: (win: Window) => win.handle.openTerminal("shell-b"),
      strip:
        "*L [A] a1.ts a2.ts database shell-a [B] beta.ts beta2.ts >shell-b [-] shell-free",
    },
  ])("$name", async ({ act, strip: expected }) => {
    const w = world();
    const win = await seed(w);
    const before = win.strip();
    act(win, w);
    expect(win.strip()).toBe(expected);
    expect(broken(win.handle)).toEqual([]);
    const order = untouchedOrder(before, win.strip(), [
      "new.ts",
      "history",
      "shell-b2",
    ]);
    expect(order.after).toEqual(order.before);
  });

  test.each([
    {
      name: "URL が保存に無いファイル → このプロジェクトのグループ (保存した前面の右) に仮のタブ",
      url: fileRoute("from-link.ts"),
      strip:
        "*L [A] a1.ts >from-link.ts~ a2.ts database shell-a [B] beta.ts beta2.ts shell-b [-] shell-free",
    },
    {
      name: "URL が保存にある画面 → そのタブを前面に",
      url: pageRoute("database"),
      strip:
        "*L [A] a1.ts a2.ts >database shell-a [B] beta.ts beta2.ts shell-b [-] shell-free",
    },
  ])("$name", async ({ url, strip: expected }) => {
    const w = world();
    const first = await seed(w);
    await first.save();
    close(first);
    const win = openWindow(w, A, url);
    await win.handle.restore();
    expect(win.strip()).toBe(expected);
  });
});

describe("閉じる", () => {
  test.each([
    {
      name: "× (前面でないタブ)",
      act: (win: Window) => win.handle.closeTab(win.id("a2.ts")),
      strip:
        "*L [A] >a1.ts database shell-a [B] beta.ts beta2.ts shell-b [-] shell-free",
    },
    {
      name: "⌘W (前面): 次の前面は最近使った順",
      act: (win: Window) => {
        win.handle.bringToFront(win.id("database"));
        win.handle.bringToFront(win.id("a2.ts"));
        win.handle.closeActive();
      },
      strip:
        "*L [A] a1.ts >database shell-a [B] beta.ts beta2.ts shell-b [-] shell-free",
    },
    {
      name: "Delete (タブ列のキー)",
      act: (win: Window) => tabKey(win, "a2.ts", { key: "Delete" }),
      strip:
        "*L [A] >a1.ts database shell-a [B] beta.ts beta2.ts shell-b [-] shell-free",
    },
    {
      name: "グループの ▾ の「このグループを閉じる」はそのグループだけ",
      act: (win: Window) => groupMenu(win, B, "Close this group"),
      strip: "*L [A] >a1.ts a2.ts database shell-a [-] shell-free",
    },
    {
      name: "シェルの終わり (closeTerminal) はそのタブだけ",
      act: (win: Window) => win.handle.closeTerminal("shell-b"),
      strip:
        "*L [A] >a1.ts a2.ts database shell-a [B] beta.ts beta2.ts [-] shell-free",
    },
  ])("$name", async ({ act, strip: expected }) => {
    const win = await seed(world());
    act(win);
    expect(win.strip()).toBe(expected);
    expect(broken(win.handle)).toEqual([]);
  });

  test("シェルの終わりで閉じたタブは ⌘⇧T の履歴に積まない", async () => {
    const win = await seed(world());
    win.handle.closeTerminal("shell-b");
    expect(win.handle.reopenClosed()).toBe(false);
  });

  test("1 つ閉じて ⌘⇧T で開き直すと、元の位置に戻る", async () => {
    const win = await seed(world());
    const before = win.strip();
    win.handle.closeTab(win.id("a2.ts"));
    expect(win.handle.reopenClosed()).toBe(true);
    expect(win.strip()).toBe(before.replace(">a1.ts a2.ts", "a1.ts >a2.ts"));
  });
});

describe("固定・仮のタブ", () => {
  test("仮のタブは同じプロジェクトの仮のタブだけを置き換える", async () => {
    const w = world();
    const beta = openWindow(w, B, HOME);
    store = join(dir, "preview.json");
    close(beta);
    const betaPage = openWindow(w, B, HOME);
    await betaPage.handle.restore();
    betaPage.go(fileRoute("beta-peek.ts"));
    await betaPage.save();
    close(betaPage);
    const win = openWindow(w, A, HOME);
    await win.handle.restore();
    win.go(fileRoute("p1.ts"));
    win.go(fileRoute("p2.ts"));
    expect(win.strip()).toBe("*L [A] >p2.ts~ [B] beta-peek.ts~");
    win.handle.bringToFront(win.id("p2.ts"));
    tabMenu(win, "p2.ts", "Keep open");
    win.go(fileRoute("p3.ts"));
    expect(win.strip()).toBe("*L [A] p2.ts >p3.ts~ [B] beta-peek.ts~");
  });
});

describe("並べ替え", () => {
  test("Ctrl+Shift+PageDown はグループの端で止まる (別のグループへ入らない)", async () => {
    const win = await seed(world());
    for (let i = 0; i < 4; i += 1)
      tabKey(win, "a2.ts", { key: "PageDown", ctrlKey: true, shiftKey: true });
    expect(win.strip()).toBe(
      "*L [A] >a1.ts database shell-a a2.ts [B] beta.ts beta2.ts shell-b [-] shell-free",
    );
  });

  test("右クリックの「右へ移す」はグループの端で押せない", async () => {
    const win = await seed(world());
    const el = win.mount.querySelector<HTMLElement>(
      `.main-tab[data-tab-id="${win.id("shell-a")}"]`,
    );
    el?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
    const item = [
      ...document.querySelectorAll<HTMLButtonElement>("[role=menuitem]"),
    ].find((node) => node.textContent === "Move right");
    expect(item?.disabled).toBe(true);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  });
});

describe("分割と戻し・面の間の移動", () => {
  test("右に分割 → 反対の面へ → 1 面に戻す: グループは続いたまま、戻したタブは各グループの末尾 (仕様)", async () => {
    const win = await seed(world());
    tabMenu(win, "shell-b", "Split right");
    tabMenu(win, "beta.ts", "Move to other side");
    expect(win.strip()).toBe(
      "L [A] >a1.ts a2.ts database shell-a [B] beta2.ts [-] shell-free | *R [B] shell-b >beta.ts",
    );
    expect(broken(win.handle)).toEqual([]);
    win.mount
      .querySelector<HTMLElement>(
        '.main-tabs-pane[data-side="right"] .main-tabs-split',
      )
      ?.click();
    expect(win.strip()).toBe(
      "*L [A] >a1.ts a2.ts database shell-a [B] beta2.ts shell-b beta.ts [-] shell-free",
    );
    expect(broken(win.handle)).toEqual([]);
  });
});

describe("読み直し (保存して読み戻すと同じ配置)", () => {
  test.each([
    { name: "そのまま", act: () => undefined },
    {
      name: "並べ替えた",
      act: (win: Window) =>
        tabKey(win, "a2.ts", {
          key: "PageDown",
          ctrlKey: true,
          shiftKey: true,
        }),
    },
    {
      name: "2 面",
      act: (win: Window) => tabMenu(win, "shell-b", "Split right"),
    },
    { name: "畳んだ", act: (win: Window) => toggleGroup(win, B) },
    {
      name: "別のプロジェクトのファイルが前面",
      act: (win: Window) => win.handle.bringToFront(win.id("beta.ts")),
    },
    {
      name: "シェルが別のプロジェクトへ cd して戻った",
      act: (win: Window, w: World) => {
        w.shells["shell-a"] = B;
        win.handle.localize();
        w.shells["shell-a"] = A;
        win.handle.localize();
      },
    },
  ])("$name", async ({ act }) => {
    const w = world();
    const win = await seed(w);
    act(win, w);
    await win.save();
    const before = win.strip();
    const again = await reload(w, win, A);
    expect(again.strip()).toBe(before);
    // 読み戻しただけで書き直さない・書いても同じ。
    await again.save();
    const third = await reload(w, again, A);
    expect(third.strip()).toBe(before);
  });
});

describe("窓 2 つ", () => {
  test("この窓で閉じたタブを、古い配置を持つ裏の窓 (SSE を切っている) の保存が戻さない", async () => {
    const w = world();
    const front = await seed(w);
    const back = openWindow(w, A, fileRoute("a1.ts"));
    await back.handle.restore({ keepSavedFront: true });
    front.handle.closeTab(front.id("a2.ts"));
    tabKey(front, "database", { key: "PageUp", ctrlKey: true, shiftKey: true });
    await front.save();
    // 裏の窓は取り直さずに、自分の変更 (新しいファイル) を書く。
    back.keep(fileRoute("back.ts"));
    await back.save();
    await front.handle.refreshFromServer();
    await settle();
    expect([shared(front), shared(back)]).toEqual([
      "L database@A,a1.ts@A,back.ts@A,shell-a,beta.ts@B,beta2.ts@B,shell-b,shell-free | R  | collapsed []",
      "L database@A,a1.ts@A,back.ts@A,shell-a,beta.ts@B,beta2.ts@B,shell-b,shell-free | R  | collapsed []",
    ]);
  });

  test("別のプロジェクトのページの窓と、グループの並びが同じに落ち着く", async () => {
    const w = world();
    const alpha = await seed(w);
    const beta = openWindow(w, B, fileRoute("beta.ts"));
    await beta.handle.restore();
    w.order = [B, A, C];
    alpha.handle.localize();
    beta.handle.localize();
    alpha.keep(fileRoute("a3.ts"));
    await settle();
    await beta.handle.refreshFromServer();
    await settle();
    expect(shared(beta)).toBe(shared(alpha));
  });
});

/** 小さな線形合同法 (再現のためだけ)。 */
function rng(seed: number) {
  let state = seed >>> 0;
  return (n: number) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state % n;
  };
}

type Op = { name: string; run: (win: Window, w: World) => void };

const FILES = ["a1.ts", "a2.ts", "a3.ts", "a4.ts"];
const SHELLS = ["shell-a", "shell-b", "shell-free", "shell-c"];

/** 乱数の 1 手。どれも利用者の入口 (右クリック・札・キー・URL) から。 */
function randomOp(pick: (n: number) => number, win: Window): Op {
  const tabs = allTabs(win.handle.layout());
  const tab = tabs.length > 0 ? tabs[pick(tabs.length)] : null;
  const label = tab ? labelOf(tab) : "";
  const file = FILES[pick(FILES.length)];
  const shell = SHELLS[pick(SHELLS.length)];
  const root = [A, B, C][pick(3)];
  const has = (x: Window) =>
    allTabs(x.handle.layout()).some((item) => labelOf(item) === label);
  const drawn = (x: Window) =>
    has(x) &&
    x.mount.querySelector(`.main-tab[data-tab-id="${x.id(label)}"]`) !== null;
  const menu = (item: string) => (x: Window) => {
    if (!drawn(x)) return;
    const el = x.mount.querySelector<HTMLElement>(
      `.main-tab[data-tab-id="${x.id(label)}"]`,
    );
    el?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
    const found = [
      ...document.querySelectorAll<HTMLElement>("[role=menuitem]"),
    ].find((node) => node.textContent === item);
    if (found instanceof HTMLButtonElement && !found.disabled) found.click();
    else
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  };
  const group = (item: string | null) => (x: Window) => {
    const head = x.mount.querySelector<HTMLElement>(
      `.main-tab-group[data-group="${root}"]`,
    );
    if (!head) return;
    if (item === null) {
      head.querySelector<HTMLElement>(".main-tab-group-toggle")?.click();
      return;
    }
    head.querySelector<HTMLElement>(".main-tab-group-menu")?.click();
    pickMenu(item);
  };
  const ops: Op[] = [
    { name: `go ${file}`, run: (x) => x.go(fileRoute(file)) },
    { name: `keep ${file}`, run: (x) => x.keep(fileRoute(file)) },
    { name: "go database", run: (x) => x.go(pageRoute("database")) },
    { name: "go history", run: (x) => x.go(pageRoute("history")) },
    { name: `open ${shell}`, run: (x) => x.handle.openTerminal(shell) },
    { name: "close front", run: (x) => x.handle.closeActive() },
    { name: "reopen", run: (x) => void x.handle.reopenClosed() },
    { name: "next", run: (x) => x.handle.next() },
    { name: "Files", run: (x) => x.handle.showHome() },
    {
      name: "unsplit",
      run: (x) =>
        x.mount
          .querySelector<HTMLElement>(
            '.main-tabs-pane[data-side="right"] .main-tabs-split',
          )
          ?.click(),
    },
    { name: `toggle ${SHORT[root]}`, run: group(null) },
    { name: `close group ${SHORT[root]}`, run: group("Close this group") },
    {
      name: `${shell} cd ${SHORT[root]}`,
      run: (_x, w) => {
        w.shells[shell] = root;
        for (const other of openWindows) other.handle.localize();
      },
    },
    {
      name: `order ${SHORT[root]} first`,
      run: (_x, w) => {
        w.order = [root, ...w.order.filter((item) => item !== root)];
        for (const other of openWindows) other.handle.localize();
      },
    },
  ];
  if (tab)
    ops.push(
      {
        name: `close ${label}`,
        run: (x) => {
          if (has(x)) x.handle.closeTab(x.id(label));
        },
      },
      {
        name: `front ${label}`,
        run: (x) => {
          if (has(x)) x.handle.bringToFront(x.id(label));
        },
      },
      { name: `others ${label}`, run: menu("Close others") },
      { name: `right-of ${label}`, run: menu("Close to the right") },
      { name: `split ${label}`, run: menu("Split right") },
      { name: `other side ${label}`, run: menu("Move to other side") },
      { name: `left ${label}`, run: menu("Move left") },
      { name: `right ${label}`, run: menu("Move right") },
    );
  return ops[pick(ops.length)];
}

describe("乱数の操作列 (窓 2 つ・保存・取り直し・読み直し。種を固定)", () => {
  // 不変条件: 前面は面にあるタブ・グループは続いている (1 手ごと)、読み直しで
  // 配置が変わらない (URL が閉じたタブを指している場合は除く: 閉じたタブが戻る件は
  // 別の調査)、最後に保存と取り直しを交互に回すと 2 つの窓が同じ配置に落ち着く。
  test.each(
    Array.from({ length: 40 }, (_, i) => i + 1),
  )("seed %i", async (seedNumber) => {
    const pick = rng(seedNumber);
    const w = world();
    w.shells["shell-c"] = C;
    let wins: Window[] = [await seed(w)];
    wins.push(openWindow(w, pick(2) === 0 ? A : B, HOME));
    await wins[1].handle.restore({ keepSavedFront: true });
    const history: string[] = [];
    const problems: string[] = [];
    for (let step = 0; step < 30; step += 1) {
      const at = pick(2);
      const win = wins[at];
      const roll = pick(10);
      if (roll === 0) {
        history.push(`${at}: save`);
        await win.save();
      } else if (roll === 1) {
        history.push(`${at}: refresh`);
        await win.handle.refreshFromServer();
      } else if (roll === 2) {
        const root = win.handle.currentProject() ?? A;
        await settle();
        await win.handle.refreshFromServer();
        await settle();
        const before = shared(win);
        const route = win.route();
        const urlHasTab =
          route.screen === "repo" ||
          allTabs(win.handle.layout()).some(
            (tab) =>
              (tab.target.kind === "file" &&
                route.screen === "file" &&
                tab.target.path === route.path) ||
              (tab.target.kind === "page" && tab.target.page === route.screen),
          );
        history.push(`${at}: reload`);
        const again = await reload(w, win, root);
        wins = wins.map((item, index) => (index === at ? again : item));
        if (urlHasTab && shared(again) !== before)
          problems.push(
            `step ${step} reload changed the layout:\n  ${before}\n  ${shared(again)}`,
          );
      } else {
        const op = randomOp(pick, win);
        history.push(`${at}: ${op.name}`);
        op.run(win, w);
      }
      for (const [index, item] of wins.entries())
        for (const problem of broken(item.handle))
          problems.push(`step ${step} window ${index}: ${problem}`);
      if (problems.length > 0) break;
    }
    for (let round = 0; round < 3; round += 1)
      for (const item of wins) {
        await item.save();
        await item.handle.refreshFromServer();
        await item.save();
      }
    if (shared(wins[0]) !== shared(wins[1]))
      problems.push(
        `the windows did not settle:\n  ${shared(wins[0])}\n  ${shared(wins[1])}`,
      );
    expect({ problems, history: problems.length ? history : [] }).toEqual({
      problems: [],
      history: [],
    });
  });
});

describe("言語・表示密度・スマホの幅", () => {
  test("言語を切り替えても、配置は変わらず書き直しもしない", async () => {
    const w = world();
    const first = await seed(w);
    await first.save();
    close(first);
    let language: "en" | "ja" = "en";
    const win = openWindow(w, A, fileRoute("a1.ts"), {
      getLanguage: () => language,
    });
    await win.handle.restore({ keepSavedFront: true });
    await win.save();
    const before = [win.strip(), await revision()];
    language = "ja";
    win.handle.localize();
    await win.save();
    expect([win.strip(), await revision()]).toEqual(before);
  });

  test("表示密度 (body の class) を変えても、配置は変わらず書き直しもしない", async () => {
    const win = await seed(world());
    await win.save();
    const before = [win.strip(), await revision()];
    document.body.classList.add("density-compact");
    await new Promise((resolve) => realImmediate(resolve));
    document.body.classList.remove("density-compact");
    await new Promise((resolve) => realImmediate(resolve));
    await win.save();
    expect([win.strip(), await revision()]).toEqual(before);
  });
});

describe("サーバの再起動・保存の失敗", () => {
  test("保存が 1 回失敗しても配置はそのまま、次の変更で書ける", async () => {
    const w = world();
    const first = await seed(w);
    await first.save();
    close(first);
    const file = store;
    let fail = true;
    const errors: unknown[] = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args);
    });
    const win = openWindow(w, A, fileRoute("a1.ts"), {
      save: async (layout, _keepalive, base) => {
        if (fail) {
          fail = false;
          throw new Error("sample: the server restarted");
        }
        const saved = await saveMainTabs(file, {
          baseRev: base.rev,
          base: base.layout,
          layout,
        });
        if (saved.kind !== "ok") throw new Error(`not saved: ${saved.kind}`);
        return saved;
      },
    });
    await win.handle.restore({ keepSavedFront: true });
    win.keep(fileRoute("a3.ts"));
    win.handle.flush(false);
    await new Promise((resolve) => realImmediate(resolve));
    expect(errors.length).toBe(1);
    const after = win.strip();
    win.keep(fileRoute("a4.ts"));
    win.handle.flush(false);
    for (let i = 0; i < 5; i += 1)
      await new Promise((resolve) => realImmediate(resolve));
    const reread = openWindow(w, A, fileRoute("a4.ts"));
    await reread.handle.restore({ keepSavedFront: true });
    expect([after.includes("a3.ts"), reread.strip()]).toEqual([
      true,
      win.strip(),
    ]);
  });
});

describe("プロジェクト", () => {
  test("別のプロジェクトへ移って (読み直して) も、配置はそのまま、前面はそのグループの最後の前面", async () => {
    const w = world();
    const win = await seed(w);
    win.handle.bringToFront(win.id("beta2.ts"));
    win.handle.bringToFront(win.id("a1.ts"));
    const before = shared(win);
    const tab = win.handle.prepareProjectSwitch(B);
    expect(tab === null ? null : labelOf(tab)).toBe("beta2.ts");
    await win.save();
    close(win);
    const beta = openWindow(w, B, fileRoute("beta2.ts"));
    await beta.handle.restore({ keepSavedFront: true });
    expect([
      shared(beta),
      beta.handle.front()?.id === beta.id("beta2.ts"),
    ]).toEqual([before, true]);
  });

  test("名前・色を変えても並びは動かない、登録簿の並べ替えはグループごと動く (中の順は保つ)", async () => {
    const w = world();
    let name = "alpha";
    const win = await seed(w);
    const looks = openWindow(w, A, fileRoute("a1.ts"), {
      projectLook: (root) =>
        root === A ? { root, name, initials: "AL", color: "violet" } : null,
    });
    close(win);
    await looks.handle.restore({ keepSavedFront: true });
    const before = looks.strip();
    name = "renamed";
    looks.handle.localize();
    expect(looks.strip()).toBe(before);
    w.order = [C, B, A];
    looks.handle.localize();
    expect(looks.strip()).toBe(
      "*L [B] beta.ts beta2.ts shell-b [A] >a1.ts a2.ts database shell-a [-] shell-free",
    );
  });

  test("worktree の画面で開いたファイルは、そのフォルダの別のグループ (本体のグループには入らない)", async () => {
    const w = world();
    const win = await seed(w);
    await win.save();
    close(win);
    const worktree = "/work/alpha-topic";
    const wt = openWindow(w, worktree, HOME);
    await wt.handle.restore();
    wt.keep(fileRoute("wt.ts"));
    expect(wt.strip()).toBe(
      "*L [A] a1.ts a2.ts database shell-a [B] beta.ts beta2.ts shell-b [/work/alpha-topic] >wt.ts [-] shell-free",
    );
    expect(broken(wt.handle)).toEqual([]);
  });

  test("エージェントが終わってシェルのグループが分からなくなっても、タブは動かない", async () => {
    const w = world();
    const win = await seed(w);
    const before = win.strip();
    w.shells["shell-b"] = undefined;
    win.handle.localize();
    expect(win.strip()).toBe(before);
  });
});

/** 保存の版の番号 (書き直したかを見る)。 */
async function revision(): Promise<number | null> {
  const loaded = await loadMainTabs(store);
  return loaded.kind === "ok" ? loaded.rev : null;
}

// ---- 不具合の再現 (直すまで赤) ----

describe("不具合の再現: まとめて閉じたタブを ⌘⇧T で開き直すと、順が崩れる", () => {
  test("右を閉じる → 3 回開き直す (モデル)", () => {
    let layout = emptyLayout();
    for (const path of ["x.ts", "a.ts", "b.ts", "c.ts"])
      layout = openTab(layout, { kind: "file", path }, { preview: false });
    const after = closeToRight(layout, layout.panes.left.tabs[0].id);
    let history = pushClosed([], closedTabs(layout, after));
    let now = after;
    for (let i = 0; i < 3; i += 1) {
      const result = reopenClosed(now, history);
      now = result.layout;
      history = result.history;
    }
    expect(
      allTabsOf(now).map((tab) =>
        tab.target.kind === "file" ? tab.target.path : tab.id,
      ),
    ).toEqual(["x.ts", "a.ts", "b.ts", "c.ts"]);
  });

  test("グループを閉じる → 3 回開き直す (画面)", async () => {
    const win = await seed(world());
    const before = shared(win);
    groupMenu(win, B, "Close this group");
    for (let i = 0; i < 3; i += 1) win.handle.reopenClosed();
    expect(shared(win)).toBe(before);
  });
});

describe("不具合の再現: 右を閉じる・ほかを閉じるが、グループの外のタブまで閉じる", () => {
  test("畳んだグループの、見えていないタブを閉じない", async () => {
    const win = await seed(world());
    toggleGroup(win, B);
    tabMenu(win, "a2.ts", "Close to the right");
    expect(shared(win)).toBe(
      'L a1.ts@A,a2.ts@A,beta.ts@B,beta2.ts@B,shell-b,shell-free | R  | collapsed ["/work/beta"]',
    );
  });

  test("別のプロジェクトのグループのタブを閉じない (閉じるのはそのタブのグループの中)", async () => {
    const win = await seed(world());
    tabMenu(win, "a2.ts", "Close others");
    expect(win.strip()).toBe(
      "*L [A] >a2.ts [B] beta.ts beta2.ts shell-b [-] shell-free",
    );
  });
});

describe("不具合の再現: 畳んだグループの見えていないタブへ、キーで移る", () => {
  test("⌃Tab (次のタブ) は畳んだグループを飛ばす", async () => {
    const win = await seed(world());
    toggleGroup(win, B);
    const fronts: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      win.handle.next();
      const front = win.handle.front();
      fronts.push(front ? labelOf(front) : "-");
    }
    expect(fronts).toEqual([
      "a2.ts",
      "database",
      "shell-a",
      "shell-free",
      "a1.ts",
    ]);
  });

  test.each([
    { name: "⌘5 は見えている 5 枚目", nth: () => 5 },
    {
      name: "⌘9 は見えている最後のタブ (app の lastTabNumber)",
      nth: (win: Window) =>
        lastTabNumber(win.handle.layout(), win.handle.groupOf),
    },
  ])("$name", async ({ nth }) => {
    const win = await seed(world());
    toggleGroup(win, B);
    win.handle.activateNth(nth(win));
    const front = win.handle.front();
    expect(front ? labelOf(front) : "-").toBe("shell-free");
  });
});

describe("不具合の再現: 読み直すと、一覧から消えたプロジェクトのグループが末尾へ動く", () => {
  /** 登録簿だけの応答 (エージェントは居ない)。 */
  function overview(roots: string[]): AgentOverviewResponse {
    return {
      serverInstance: "sample-instance",
      observedAt: 1000,
      tmux: { available: true, running: true, error: "" },
      panes: [],
      projects: roots.map((root, order) => ({
        root,
        name: SHORT[root] ?? root,
        displayRoot: root,
        git: true,
        error: "",
        server: { status: "absent" },
        registered: { root, name: SHORT[root] ?? root, color: "violet", order },
      })),
      errors: [],
      registry: {
        projects: roots.map((root, order) => ({
          root,
          name: SHORT[root] ?? root,
          color: "violet",
          order,
        })),
        error: "",
        path: "/work/projects.json",
      },
    };
  }

  test("登録を外した (タブは残した) プロジェクト", async () => {
    const w = world();
    const win = await seed(w);
    // C にもタブを置く (別の窓で C のファイルを開いた)。
    await win.save();
    close(win);
    const gamma = openWindow(w, C, HOME);
    await gamma.handle.restore();
    gamma.keep(fileRoute("gamma.ts"));
    await gamma.save();
    close(gamma);
    // この窓の PROJECT_LOOKS: 最初は A・B・C、B の登録を外すと A・C (前の位置は覚えている)。
    const looks = createProjectLooks();
    looks.update(overview([A, B, C]));
    const page = openWindow(w, A, fileRoute("a1.ts"), {
      projectOrder: () => looks.order(),
    });
    await page.handle.restore();
    looks.update(overview([A, C]));
    page.handle.localize();
    const before = shared(page);
    expect(before).toBe(
      "L a1.ts@A,a2.ts@A,database@A,shell-a,beta.ts@B,beta2.ts@B,shell-b,gamma.ts@C,shell-free | R  | collapsed []",
    );
    await page.save();
    close(page);
    // 読み直した窓の PROJECT_LOOKS は、最初の応答から A・C しか知らない。
    const fresh = createProjectLooks();
    fresh.update(overview([A, C]));
    const again = openWindow(w, A, fileRoute("a1.ts"), {
      projectOrder: () => fresh.order(),
    });
    await again.handle.restore({ keepSavedFront: true });
    expect(shared(again)).toBe(before);
  });
});

describe("不具合の再現: 2 つの窓で同時に畳む・開くと、片方の操作が消える", () => {
  const P = "/work/alpha";
  const Q = "/work/beta";
  function base() {
    let layout = emptyLayout();
    for (const [path, project] of [
      ["p.ts", P],
      ["q.ts", Q],
    ] as const)
      layout = openTab(
        layout,
        { kind: "file", path, project },
        { preview: false, newId: () => path },
      );
    return layout;
  }

  test.each([
    {
      name: "この窓は P を、相手は Q を畳んだ",
      from: base(),
      mine: (l: ReturnType<typeof base>) => setCollapsed(l, P, true),
      theirs: (l: ReturnType<typeof base>) => setCollapsed(l, Q, true),
      expected: [P, Q],
    },
    {
      name: "両方畳んであったのを、この窓は P を、相手は Q を開いた",
      from: setCollapsed(setCollapsed(base(), P, true), Q, true),
      mine: (l: ReturnType<typeof base>) => setCollapsed(l, P, false),
      theirs: (l: ReturnType<typeof base>) => setCollapsed(l, Q, false),
      expected: [],
    },
  ])("$name", ({ from, mine, theirs, expected }) => {
    const merged = mergeLayouts(from, mine(from), theirs(from)).layout;
    expect([...(merged.collapsed ?? [])].sort()).toEqual(expected);
  });
});

describe("不具合の再現: スマホの幅から戻ると、右の面がグループの順に並ばない", () => {
  test("スマホの幅で右の面を預けている間にグループの並びが変わると、戻した右の面がグループの順に並ばない", async () => {
    const changes: Array<() => void> = [];
    let phone = false;
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
      const w = world();
      const win = await seed(w);
      tabMenu(win, "shell-b", "Split right");
      tabMenu(win, "a2.ts", "Move to other side");
      expect(win.strip()).toBe(
        "L [A] >a1.ts database shell-a [B] beta.ts beta2.ts [-] shell-free | *R [A] >a2.ts [B] shell-b",
      );
      phone = true;
      for (const change of changes) change();
      expect(win.strip()).toBe(
        "*L [A] >a1.ts database shell-a [B] beta.ts beta2.ts [-] shell-free",
      );
      w.order = [B, A, C];
      win.handle.localize();
      phone = false;
      for (const change of changes) change();
      expect(win.strip()).toBe(
        "*L [B] beta.ts beta2.ts [A] >a1.ts database shell-a [-] shell-free | R [B] shell-b [A] >a2.ts",
      );
      expect(broken(win.handle)).toEqual([]);
    } finally {
      window.matchMedia = originalMatchMedia;
    }
  });
});

describe("不具合の再現: 読み直すと、別の窓が最後に保存した前面がこの窓の前面になる", () => {
  test("この窓の前面はファイル (URL もそのファイル)、別の窓はシェルを前面にして後から保存した", async () => {
    const w = world();
    const mine = await seed(w);
    const other = openWindow(w, A, fileRoute("a1.ts"));
    await other.handle.restore({ keepSavedFront: true });
    other.handle.openTerminal("shell-b");
    await other.save();
    await mine.handle.refreshFromServer();
    await settle();
    expect(labelOf(mine.handle.front() as Tab)).toBe("a1.ts");
    const again = await reload(w, mine, A);
    const front = again.handle.front();
    expect([again.url(), front ? labelOf(front) : "-"]).toEqual([
      "a1.ts",
      "a1.ts",
    ]);
  });

  test("窓の保存 (sessionStorage) が使えなくても読み直せる (保存した配置の前面になり、理由を 1 度出す)", async () => {
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const broken: Pick<Storage, "getItem" | "setItem"> = {
      getItem: () => {
        throw new Error("sample storage is unavailable");
      },
      setItem: () => {
        throw new Error("sample storage is unavailable");
      },
    };
    const w = world();
    const mine = openWindow(w, A, fileRoute("a1.ts"), {
      windowStorage: broken,
    });
    await mine.handle.restore();
    mine.keep(fileRoute("a1.ts"));
    await mine.save();
    const other = openWindow(w, A, fileRoute("a1.ts"));
    await other.handle.restore({ keepSavedFront: true });
    other.handle.openTerminal("shell-b");
    await other.save();
    await mine.handle.refreshFromServer();
    await settle();
    const again = await reload(w, mine, A);
    const front = again.handle.front();
    const reports = error.mock.calls.filter((call) =>
      String(call[0]).includes("window storage"),
    );
    error.mockRestore();
    expect({
      front: front ? labelOf(front) : "-",
      reports: reports.map((call) => String((call[1] as Error).message)),
    }).toEqual({
      // 今までの動き: 保存した配置の前面 (最後に書いた窓のシェル)。
      front: "shell-b",
      // 窓ごとに 1 度 (元の窓と、読み直した窓)。
      reports: [
        "sample storage is unavailable",
        "sample storage is unavailable",
      ],
    });
  });
});
