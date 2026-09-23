// 窓を 2 つ開いても、片方のタブの変更が消えない (設計: タブとプロジェクト の 7)。
// 画面の部品 (views/main-tabs) 2 つを、本物の保存 (server/main-tabs-store.ts) の
// 一時ファイルにつなぐ。前は保存が「全体の上書き」で、後から書いた窓がもう一方の
// 窓で開いたタブを消していた (突き合わせは読み戻しのときだけ)。
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
import type { TabTarget } from "../core/main-tabs";
import type { AppRoute } from "../core/routes";
import { loadMainTabs, saveMainTabs } from "../server/main-tabs-store";
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

let dir = "";
let path = "";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cv-two-windows-"));
  path = join(dir, "main-tabs.json");
});

afterEach(() => {
  document.body.replaceChildren();
  rmSync(dir, { recursive: true, force: true });
});

const ROOT = "/work/sample-app";
const range = { from: "HEAD", to: "worktree" };
const fileRoute = (file: string): AppRoute => ({
  screen: "file",
  path: file,
  ref: "worktree",
  range,
  view: "blob",
});

/** 1 つの窓 (ページ)。保存は一時ファイルの本物の保存。 */
function openWindow(
  name: string,
  extra: Partial<Parameters<typeof createMainTabsView>[0]> = {},
) {
  const mount = document.createElement("nav");
  document.body.append(mount);
  let current: AppRoute = fileRoute("x.ts");
  let n = 0;
  const pending: Promise<unknown>[] = [];
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
        : ({ screen: "diff", range } as AppRoute),
    homeRoute: () => ({ screen: "repo", ref: "worktree", path: "", range }),
    copyPath: () => undefined,
    onNewTab: () => undefined,
    stopTerminal: () => undefined,
    terminalMenuItems: () => [],
    loadSaved: async () => {
      const loaded = await loadMainTabs(path);
      if (loaded.kind === "newer") throw new Error("newer");
      return loaded.kind === "ok"
        ? { layout: loaded.layout, rev: loaded.rev, root: ROOT }
        : { layout: null, rev: null, root: ROOT };
    },
    save: (layout, _keepalive, base) => {
      const written = saveMainTabs(path, {
        baseRev: base.rev,
        base: base.layout,
        layout,
      }).then((saved) => {
        if (saved.kind !== "ok") throw new Error(`not saved: ${saved.kind}`);
        return saved;
      });
      pending.push(written);
      return written;
    },
    backupSaved: async () => {
      throw new Error("no backup in this test");
    },
    newTabId: () => `${name}${++n}`,
    terminalInfo: (session) => ({ label: session, state: null }),
    onPanes: () => undefined,
    onTerminals: () => undefined,
    ...extra,
  });
  handle.syncRoute(current);
  return {
    handle,
    /** 開く (固定のタブ)。 */
    open(file: string) {
      handle.openingNewTab(() => {
        current = fileRoute(file);
        handle.syncRoute(current);
      });
    },
    /** 保存を今すぐ送り、書き終わるまで待つ。 */
    async save() {
      vi.advanceTimersByTime(1000);
      await Promise.all(pending.splice(0));
      // 書いた応答を当てるまで (send の続き) を待つ。
      await vi.waitFor(() => undefined);
    },
    names: () =>
      handle
        .layout()
        .panes.left.tabs.map((tab) =>
          tab.target.kind === "file" ? tab.target.path : tab.id,
        ),
    front: () => {
      const tab = handle.panes().fronts.left;
      return tab?.target.kind === "file" ? tab.target.path : null;
    },
  };
}

async function fileNames(): Promise<string[]> {
  const loaded = await loadMainTabs(path);
  if (loaded.kind !== "ok") return [];
  return (
    loaded.layout as {
      panes: Array<{ tabs: Array<{ target: { path?: string } }> }>;
    }
  ).panes.flatMap((pane) => pane.tabs.map((tab) => tab.target.path ?? "?"));
}

describe("two windows share the tabs", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test("開く・閉じる・並べ替えるが、もう一方の窓に届き、消えない", async () => {
    const a = openWindow("a");
    const b = openWindow("b");
    await a.handle.restore();
    await a.save();
    await b.handle.restore();
    const table: Array<[string, string[], string[], string[]]> = [];
    const note = (step: string) => table.push([step, a.names(), b.names(), []]);

    // A で a.ts を開いて書く。B はまだ知らないまま b.ts を開いて書く。
    a.open("a.ts");
    await a.save();
    b.open("b.ts");
    await b.save();
    note("A: a.ts を開く / B: 知らずに b.ts を開く");
    table[table.length - 1][3] = await fileNames();

    // SSE (tabs) で A が取り直す。
    await a.handle.refreshFromServer();
    note("A が取り直す");
    table[table.length - 1][3] = await fileNames();

    // A で x.ts を閉じる → B が取り直す。
    a.handle.closeTab(
      a.handle
        .layout()
        .panes.left.tabs.find(
          (tab) => tab.target.kind === "file" && tab.target.path === "x.ts",
        )?.id as string,
    );
    await a.save();
    await b.handle.refreshFromServer();
    note("A: x.ts を閉じる → B が取り直す");
    table[table.length - 1][3] = await fileNames();

    // B で a.ts を左へ動かす → A が取り直す。
    const bTab = b.handle
      .layout()
      .panes.left.tabs.find(
        (tab) => tab.target.kind === "file" && tab.target.path === "a.ts",
      );
    b.handle.bringToFront(bTab?.id as string);
    const strip = document.querySelectorAll("nav")[1];
    const el = strip.querySelector<HTMLElement>(
      `.main-tab[data-tab-id="${bTab?.id}"]`,
    );
    el?.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "PageUp",
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
      }),
    );
    await b.save();
    await a.handle.refreshFromServer();
    note("B: a.ts を左へ → A が取り直す");
    table[table.length - 1][3] = await fileNames();

    expect(table).toEqual([
      [
        "A: a.ts を開く / B: 知らずに b.ts を開く",
        ["x.ts", "a.ts"],
        ["x.ts", "b.ts", "a.ts"],
        ["x.ts", "b.ts", "a.ts"],
      ],
      [
        "A が取り直す",
        ["x.ts", "b.ts", "a.ts"],
        ["x.ts", "b.ts", "a.ts"],
        ["x.ts", "b.ts", "a.ts"],
      ],
      [
        "A: x.ts を閉じる → B が取り直す",
        ["b.ts", "a.ts"],
        ["b.ts", "a.ts"],
        ["b.ts", "a.ts"],
      ],
      [
        "B: a.ts を左へ → A が取り直す",
        ["a.ts", "b.ts"],
        ["a.ts", "b.ts"],
        ["a.ts", "b.ts"],
      ],
    ]);
  });

  test("取り直しても、この窓の前面は変わらない (前面は窓ごと)", async () => {
    const a = openWindow("a");
    const b = openWindow("b");
    await a.handle.restore();
    await a.save();
    await b.handle.restore();
    a.open("a.ts");
    await a.save();
    const before = b.front();
    await b.handle.refreshFromServer();
    expect([a.front(), before, b.front(), b.names()]).toEqual([
      "a.ts",
      "x.ts",
      "x.ts",
      ["x.ts", "a.ts"],
    ]);
  });
});
