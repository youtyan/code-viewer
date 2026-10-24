// 外側のページ (host) と面 (pane) のやりとり (core/workspace-bridge.ts の形と
// views/workspace/host.ts)。host は index.html の部品をそのまま使い、面の iframe は
// 窓と文書を差し替えた偽物にする (口の上の知らせは本物の MessageChannel)。保存は
// 偽物 (読み込みは決めた面の並び、書いた値を覚える)。

import { readFileSync } from "node:fs";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { AppRoute } from "../core/routes";
import { singlePane, splitPane, type Workspace } from "../core/workspace";
import {
  HOST_HELLO,
  type HostCommand,
  isHostHello,
  MIRRORED_IDS,
  type MirroredItem,
  type PaneMessage,
  parseHostCommand,
  parsePaneMessage,
} from "../core/workspace-bridge";
import {
  installTitleTooltips,
  TITLE_TOOLTIP_DELAY_MS,
} from "../views/title-tooltip";
import { startWorkspaceHost } from "../views/workspace/host";
import type { WorkspaceStore } from "../views/workspace/store";

const BODY = (() => {
  const html = readFileSync("web/index.html", "utf8");
  const match = /<body>([\s\S]*)<\/body>/.exec(html);
  if (!match) throw new Error("index.html has no body");
  return match[1].replace(/<script[\s\S]*?<\/script>/g, "");
})();

describe("知らせと頼みの形", () => {
  test.each([
    { name: "面の知らせ", parse: parsePaneMessage, data: { type: "mirror" } },
    {
      name: "host の頼み",
      parse: parseHostCommand,
      data: { type: "nav-collapsed" },
    },
  ])("$name: 知っている種類は通す", ({ parse, data }) => {
    expect(parse(data)).toEqual(data);
  });

  test.each([
    {
      name: "面の知らせ: 知らない種類",
      parse: parsePaneMessage,
      data: { type: "route" },
      error: 'unknown pane message "route"',
    },
    {
      name: "host の頼み: 知らない種類",
      parse: parseHostCommand,
      data: { type: "mirror" },
      error: 'unknown host command "mirror"',
    },
    {
      name: "種類が無い",
      parse: parsePaneMessage,
      data: { href: "/" },
      error: 'pane message without a type: {"href":"/"}',
    },
    {
      name: "オブジェクトでない",
      parse: parseHostCommand,
      data: "click",
      error: 'host command without a type: "click"',
    },
  ])("$name は投げる", ({ parse, data, error }) => {
    expect(() => parse(data)).toThrow(error);
  });

  test.each([
    {
      name: "host の hello",
      data: { type: HOST_HELLO, pane: "p1", layout: null },
      expected: true,
    },
    {
      name: "面の id の無い hello",
      data: { type: HOST_HELLO, layout: null },
      expected: false,
    },
    { name: "別の用途の message", data: { type: "other" }, expected: false },
    { name: "null", data: null, expected: false },
  ])("isHostHello: $name", ({ data, expected }) => {
    expect(isHostHello(data)).toBe(expected);
  });
});

// host は文書ごとに受け口 (押下の捕捉・message) を置くので、テストごとに窓を作り直す。
beforeEach(() => {
  GlobalRegistrator.register({
    url: "http://127.0.0.1/p/aaaaaaaaaaaaaaaa/",
    // 面の iframe は偽物の窓と文書にする (本当には読み込まない)。
    settings: { disableIframePageLoading: true },
  });
  document.body.innerHTML = BODY;
});
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await GlobalRegistrator.unregister();
});

const A = "/p/aaaaaaaaaaaaaaaa";
const B = "/p/bbbbbbbbbbbbbbbb";

/** p1 (A のフォルダ表示) | p2 (B の History)。フォーカスは p1。 */
function twoPanes(): Workspace {
  const ws = splitPane(singlePane("p1", `${A}/`), "p1", "row", "p2", {
    url: `${B}/history`,
    layout: { saved: "p2" },
  });
  return { ...ws, focused: "p1" };
}

type FakePane = {
  frame: HTMLIFrameElement;
  /** host が渡した hello (口は受け取った順)。 */
  hellos: Array<{ data: unknown; port: MessagePort }>;
  leaveOrigin(): void;
};

/** #workspace の面の iframe (読み込みの最初に index.html が作るもの)。 */
function paneFrame(id: string, url: string): FakePane {
  const frame = document.createElement("iframe");
  frame.setAttribute("data-cv-pane", id);
  const hellos: FakePane["hellos"] = [];
  let shown: { readyState: string; URL: string } | null = {
    readyState: "complete",
    URL: `${location.origin}${url}`,
  };
  Object.defineProperty(frame, "contentWindow", {
    value: {
      postMessage(data: unknown, origin: string, ports: MessagePort[]) {
        expect(origin).toBe(location.origin);
        hellos.push({ data, port: ports[0] });
      },
    },
  });
  Object.defineProperty(frame, "contentDocument", { get: () => shown });
  document.getElementById("workspace")?.append(frame);
  return {
    frame,
    hellos,
    leaveOrigin: () => {
      shown = null;
      frame.dispatchEvent(new Event("load"));
    },
  };
}

function fakeStore(loaded: Workspace) {
  const saved: Workspace[] = [];
  const store: WorkspaceStore = {
    windowId: () => "w-test",
    load: async () => ({ root: "/work/a", workspace: loaded, newer: null }),
    save: (workspace) => saved.push(workspace),
    flush: () => undefined,
    backup: async () => "unused",
  };
  return { store, saved };
}

/** 面の並びで host を始め、読み込みが済むまで待つ。 */
async function startHost(loaded: Workspace = twoPanes()) {
  const panes = Object.fromEntries(
    Object.entries(loaded.panes).map(([id, entry]) => [
      id,
      paneFrame(id, entry.url),
    ]),
  );
  const { store, saved } = fakeStore(loaded);
  const deps = {
    store,
    homeUrl: () => `${A}/`,
    onLocation: vi.fn(),
    onViewing: vi.fn(),
    onLookChanged: vi.fn(),
    onNavCollapsed: vi.fn(),
    onHidden: vi.fn(),
    onAgentsRefresh: vi.fn(),
  };
  const host = startWorkspaceHost(deps);
  await vi.waitFor(() =>
    expect(Object.values(panes).every((pane) => pane.hellos.length === 1)).toBe(
      true,
    ),
  );
  return { host, deps, panes, saved };
}

/** 面の側の口: host へ送り、host の頼みを集める。 */
function paneEnd(pane: FakePane) {
  const received: HostCommand[] = [];
  const { port } = pane.hellos[pane.hellos.length - 1];
  port.onmessage = (event) => received.push(event.data);
  return {
    received,
    send: (message: PaneMessage) => port.postMessage(message),
  };
}

function el(id: string): HTMLElement {
  const found = document.getElementById(id);
  if (!found) throw new Error(`missing #${id}`);
  return found;
}

const autoUpdate = (state: "on" | "off"): MirroredItem => ({
  id: "auto-update",
  attributes: [
    ["id", "auto-update"],
    [
      "class",
      state === "on" ? "global-icon-action active" : "global-icon-action",
    ],
    ["title", `auto update is ${state}`],
  ],
  html: `<span class="goi-icon" aria-hidden="true">${state}</span>`,
});

describe("host: 面の口と保存", () => {
  test("面ごとに、その面の id と保存してあったタブの配置を渡す", async () => {
    const { panes } = await startHost();
    expect([panes.p1, panes.p2].map((pane) => pane.hellos[0].data)).toEqual([
      { type: HOST_HELLO, pane: "p1", layout: null },
      { type: HOST_HELLO, pane: "p2", layout: { saved: "p2" } },
    ]);
  });

  test("面が送ったタブの配置と URL を、その面の保存に書く", async () => {
    const { panes, saved } = await startHost();
    const p2 = paneEnd(panes.p2);
    p2.send({ type: "tabs", layout: { version: 5 } as never });
    p2.send({
      type: "location",
      href: `${location.origin}${B}/file?path=a.ts`,
      project: { root: "/work/b", name: "b" },
    });
    await vi.waitFor(() =>
      expect(saved[saved.length - 1]?.panes.p2).toEqual({
        url: `${B}/file?path=a.ts`,
        layout: { version: 5 },
      }),
    );
  });
});

describe("host: フォーカスのある面を写す", () => {
  test("最下段とアドレス欄はフォーカスのある面のもの。押した面へフォーカスが移る", async () => {
    const { panes, deps } = await startHost();
    const p1 = paneEnd(panes.p1);
    const p2 = paneEnd(panes.p2);
    p1.send({ type: "mirror", items: [autoUpdate("off")] });
    p2.send({ type: "mirror", items: [autoUpdate("on")] });
    p2.send({
      type: "location",
      href: `${location.origin}${B}/history`,
      project: { root: "/work/b", name: "b" },
    });
    await vi.waitFor(() =>
      expect(el("auto-update").className).toBe("global-icon-action"),
    );
    const before = { path: location.pathname, title: el("auto-update").title };
    p2.send({ type: "focus" });
    await vi.waitFor(() =>
      expect(el("auto-update").title).toBe("auto update is on"),
    );
    expect({
      before,
      after: { path: location.pathname, title: el("auto-update").title },
      project: deps.onLocation.mock.lastCall?.[0],
      p1: p1.received
        .filter((command) => command.type === "focus-state")
        .slice(-1)[0],
    }).toEqual({
      before: { path: `${A}/`, title: "auto update is off" },
      after: { path: `${B}/history`, title: "auto update is on" },
      project: { root: "/work/b", name: "b" },
      p1: { type: "focus-state", focused: false, many: true },
    });
  });

  test("host の app.ts が写した部品に書いても面の値に戻す", async () => {
    const { panes } = await startHost();
    paneEnd(panes.p1).send({ type: "mirror", items: [autoUpdate("off")] });
    await vi.waitFor(() =>
      expect(el("auto-update").className).toBe("global-icon-action"),
    );
    el("auto-update").classList.add("active");
    await Promise.resolve();
    expect(el("auto-update").className).toBe("global-icon-action");
  });

  test("吹き出しを出している間も、写しと吹き出しが title を書き合わない", async () => {
    const { panes } = await startHost();
    const p1 = paneEnd(panes.p1);
    p1.send({ type: "mirror", items: [autoUpdate("off")] });
    await vi.waitFor(() =>
      expect(el("auto-update").title).toBe("auto update is off"),
    );
    const uninstall = installTitleTooltips(document);
    let titleWrites = 0;
    let looped = false;
    // 書き合いが始まったら、吹き出しを外して止める (止めないとテストが返らない)。
    new MutationObserver(() => {
      titleWrites++;
      if (titleWrites > 20 && !looped) {
        looped = true;
        uninstall();
      }
    }).observe(el("auto-update"), { attributeFilter: ["title"] });
    el("auto-update").dispatchEvent(
      new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" }),
    );
    await new Promise((resolve) =>
      setTimeout(resolve, TITLE_TOOLTIP_DELAY_MS + 50),
    );
    p1.send({ type: "mirror", items: [autoUpdate("on")] });
    await vi.waitFor(() =>
      expect(el("auto-update").className).toBe("global-icon-action active"),
    );
    const tip = document.querySelector<HTMLElement>(".title-tooltip");
    expect({ looped, tip: tip?.textContent }).toEqual({
      looped: false,
      tip: "auto update is on",
    });
    uninstall();
  });
});

describe("host: 写した部品を押すと面の同じ部品を押す", () => {
  test("修飾キーごとフォーカスのある面へ送り、host の同じ id の処理は動かさない", async () => {
    const { panes } = await startHost();
    const p1 = paneEnd(panes.p1);
    const hostHandler = vi.fn();
    el("copy-ai-context").addEventListener("click", hostHandler);
    el("copy-ai-context").dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        shiftKey: true,
      }),
    );
    await vi.waitFor(() =>
      expect(p1.received.some((command) => command.type === "click")).toBe(
        true,
      ),
    );
    expect({
      click: p1.received.find((command) => command.type === "click"),
      host: hostHandler.mock.calls.length,
    }).toEqual({
      click: {
        type: "click",
        id: "copy-ai-context",
        modifiers: {
          shiftKey: true,
          altKey: false,
          ctrlKey: false,
          metaKey: false,
        },
      },
      host: 0,
    });
  });

  test.each([
    { name: "⌘＋クリック", init: { metaKey: true } },
    { name: "中ボタン", init: { button: 1 } },
  ])("リンクの $name は新しいタブで開く (面へ送らない)", async ({ init }) => {
    const { panes } = await startHost();
    const p1 = paneEnd(panes.p1);
    const event = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      ...init,
    });
    el("nav-help").dispatchEvent(event);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect({
      clicks: p1.received.filter((command) => command.type === "click"),
      prevented: event.defaultPrevented,
    }).toEqual({ clicks: [], prevented: false });
  });
});

describe("host: 面の並び", () => {
  test("1 つのシェルは 1 か所: 別の面で開いたら、前に出していた面のタブを閉じる", async () => {
    const { panes } = await startHost();
    const p1 = paneEnd(panes.p1);
    const p2 = paneEnd(panes.p2);
    p1.send({ type: "terminals", open: ["shell-aaaaaa"] });
    p2.send({ type: "terminals", open: ["shell-aaaaaa"] });
    await vi.waitFor(() =>
      expect(
        p1.received.filter((command) => command.type === "close-terminal"),
      ).toEqual([{ type: "close-terminal", session: "shell-aaaaaa" }]),
    );
    expect(
      p2.received.filter((command) => command.type === "close-terminal"),
    ).toEqual([]);
  });

  test("分けると新しい面を作り、フォーカスを移して保存する", async () => {
    const { panes, saved } = await startHost();
    paneEnd(panes.p1).send({
      type: "split",
      dir: "column",
      url: `${A}/todif`,
      layout: { version: 5 } as never,
    });
    await vi.waitFor(() =>
      expect(
        document.querySelector('iframe[data-cv-pane="p3"]'),
      ).not.toBeNull(),
    );
    const last = saved[saved.length - 1];
    expect({
      tree: last?.tree,
      focused: last?.focused,
      p3: last?.panes.p3,
      src: document
        .querySelector<HTMLIFrameElement>('iframe[data-cv-pane="p3"]')
        ?.getAttribute("src"),
    }).toEqual({
      tree: {
        dir: "row",
        ratio: 0.5,
        a: { dir: "column", ratio: 0.5, a: { pane: "p1" }, b: { pane: "p3" } },
        b: { pane: "p2" },
      },
      focused: "p3",
      p3: { url: `${A}/todif`, layout: { version: 5 } },
      src: `${A}/todif`,
    });
  });

  test("最後のタブを閉じた面は閉じる (面が 1 つなら閉じない)", async () => {
    const { panes, saved } = await startHost();
    paneEnd(panes.p2).send({ type: "emptied" });
    await vi.waitFor(() => expect(panes.p2.frame.isConnected).toBe(false));
    const only = saved[saved.length - 1];
    expect(only?.tree).toEqual({ pane: "p1" });
  });

  test("別の面で開く: 同じプロジェクトの面が無ければ右に分ける", async () => {
    const { panes, saved } = await startHost();
    paneEnd(panes.p2).send({
      type: "location",
      href: `${location.origin}${B}/history`,
      project: { root: "/work/b", name: "b" },
    });
    paneEnd(panes.p1).send({
      type: "location",
      href: `${location.origin}${A}/`,
      project: { root: "/work/a", name: "a" },
    });
    paneEnd(panes.p1).send({
      type: "open-elsewhere",
      route: {
        screen: "history",
        range: { from: "HEAD", to: "worktree" },
      } as never,
      terminal: null,
      project: "/work/a",
      url: `${A}/history`,
      layout: { version: 5 } as never,
    });
    await vi.waitFor(() =>
      expect(saved[saved.length - 1]?.panes.p3?.url).toBe(`${A}/history`),
    );
  });
});

describe("host: エージェントの一覧を面へ配る", () => {
  const feed = (label: string) =>
    ({
      type: "agents",
      overview: { label } as never,
      error: "",
    }) satisfies HostCommand;

  test("口のある面へ配り、同じ値は送り直さず、後から口を渡した面にも最後の値を送る", async () => {
    const { host, panes, deps } = await startHost();
    const p1 = paneEnd(panes.p1);
    host.share(feed("first"));
    host.share(feed("first"));
    host.share(feed("second"));
    await vi.waitFor(() =>
      expect(p1.received.filter((c) => c.type === "agents")).toHaveLength(2),
    );
    // p2 が読み直した: 口を渡し直すと、最後の値が届く。
    panes.p2.frame.dispatchEvent(new Event("load"));
    await vi.waitFor(() => expect(panes.p2.hellos.length).toBe(2));
    const p2 = paneEnd(panes.p2);
    await vi.waitFor(() =>
      expect(p2.received.filter((c) => c.type === "agents")).toEqual([
        feed("second"),
      ]),
    );
    paneEnd(panes.p2).send({ type: "agents-refresh" });
    await vi.waitFor(() => expect(deps.onAgentsRefresh).toHaveBeenCalled());
    expect(p1.received.filter((c) => c.type === "agents")).toEqual([
      feed("first"),
      feed("second"),
    ]);
  });
});

describe("host: 掴んだタブをほかの面へ落とす", () => {
  const route: AppRoute = {
    screen: "history",
    ref: "HEAD",
    range: { from: "HEAD", to: "worktree" },
  };
  const carry = (project: string | null, terminal: string | null = null) => ({
    route: terminal === null ? route : null,
    terminal,
    project,
    url: `${B}/history`,
    layout: { version: 5 } as never,
  });

  /** p2 は B のプロジェクト。p1 で掴んで、p2 の上の点に落とす。 */
  async function dragOntoP2(
    dragged: ReturnType<typeof carry>,
    x: number,
    y: number,
  ) {
    const started = await startHost();
    const p1 = paneEnd(started.panes.p1);
    const p2 = paneEnd(started.panes.p2);
    p2.send({
      type: "location",
      href: `${location.origin}${B}/history`,
      project: { root: "/work/b", name: "b" },
    });
    await vi.waitFor(() =>
      expect(started.deps.onLocation).toHaveBeenCalledTimes(1),
    );
    p1.send({ type: "drag-start", tabId: "t1", ...dragged });
    await vi.waitFor(() =>
      expect(document.querySelectorAll(".workspace-drop-target").length).toBe(
        1,
      ),
    );
    const target = document.querySelector<HTMLElement>(
      ".workspace-drop-target",
    );
    if (!target) throw new Error("no drop target");
    target.getBoundingClientRect = () => new DOMRect(0, 0, 400, 200);
    // happy-dom の DragEvent は座標を持たないので、同じ名前の MouseEvent で落とす。
    const drop = new MouseEvent("drop", {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
    });
    target.dispatchEvent(drop);
    await new Promise((resolve) => setTimeout(resolve, 30));
    return { ...started, p1, p2, accepted: drop.defaultPrevented };
  }

  test("掴んだ面の外の面にだけ落とす先を出し、掴むのをやめたら消す", async () => {
    const { panes } = await startHost();
    const p1 = paneEnd(panes.p1);
    p1.send({ type: "drag-start", tabId: "t1", ...carry("/work/b") });
    await vi.waitFor(() =>
      expect(document.querySelectorAll(".workspace-drop-target").length).toBe(
        1,
      ),
    );
    p1.send({ type: "drag-end" });
    await vi.waitFor(() =>
      expect(document.querySelectorAll(".workspace-drop-target").length).toBe(
        0,
      ),
    );
  });

  test.each([
    {
      name: "同じプロジェクトの面の真ん中: その面で開き、掴んだ面から閉じる",
      dragged: carry("/work/b"),
      p2: [{ type: "route", route }],
      p1: [{ type: "close-tab", id: "t1" }],
    },
    {
      name: "シェルは真ん中に落とせば開く (前の面から閉じるのは terminals の知らせ)",
      dragged: carry(null, "shell-aaaaaa"),
      p2: [{ type: "open-terminal", session: "shell-aaaaaa" }],
      p1: [],
    },
  ])("$name", async ({ dragged, p2, p1 }) => {
    const result = await dragOntoP2(dragged, 200, 100);
    const sent = (commands: HostCommand[]) =>
      commands.filter((command) =>
        ["route", "open-terminal", "close-tab"].includes(command.type),
      );
    expect({
      accepted: result.accepted,
      p2: sent(result.p2.received),
      p1: sent(result.p1.received),
    }).toEqual({ accepted: true, p2, p1 });
  });

  test("別のプロジェクトのタブは真ん中に落とせない (何も送らない)", async () => {
    const result = await dragOntoP2(carry("/work/a"), 200, 100);
    expect({
      accepted: result.accepted,
      p2: result.p2.received.filter((command) => command.type === "route"),
    }).toEqual({ accepted: false, p2: [] });
  });

  test("左の端に落とすと、その面の左に新しい面を作る", async () => {
    const result = await dragOntoP2(carry("/work/a"), 10, 100);
    const last = result.saved[result.saved.length - 1];
    expect({
      accepted: result.accepted,
      tree: last?.tree,
      p3: last?.panes.p3,
      p1: result.p1.received.filter((command) => command.type === "close-tab"),
    }).toEqual({
      accepted: true,
      tree: {
        dir: "row",
        ratio: 0.5,
        a: { pane: "p1" },
        b: { dir: "row", ratio: 0.5, a: { pane: "p3" }, b: { pane: "p2" } },
      },
      p3: { url: `${B}/history`, layout: { version: 5 } },
      p1: [{ type: "close-tab", id: "t1" }],
    });
  });
});

describe("host: 読み込みの最初に作った面", () => {
  test("開いている画面を移し直さず、その画面を保存した面として扱う", async () => {
    // 前の並びの控えが無い窓: index.html は面 p1 を作って B の History を開いた。
    const first = paneFrame("p1", `${B}/history`);
    first.frame.setAttribute("src", `${B}/history`);
    const { store } = fakeStore(twoPanes());
    startWorkspaceHost({
      store,
      homeUrl: () => `${A}/`,
      onLocation: vi.fn(),
      onViewing: vi.fn(),
      onLookChanged: vi.fn(),
      onNavCollapsed: vi.fn(),
      onHidden: vi.fn(),
      onAgentsRefresh: vi.fn(),
    });
    await vi.waitFor(() => expect(first.hellos.length).toBe(1));
    const frames = [
      ...document.querySelectorAll<HTMLIFrameElement>("#workspace > iframe"),
    ].map((frame) => [
      frame.getAttribute("data-cv-pane"),
      frame.getAttribute("src"),
    ]);
    expect({ frames, hello: first.hellos[0].data }).toEqual({
      frames: [
        ["p2", `${B}/history`],
        ["p1", `${A}/`],
      ],
      hello: { type: HOST_HELLO, pane: "p2", layout: { saved: "p2" } },
    });
  });
});

describe("host: 面がこの origin を離れたら (サインイン)", () => {
  test("窓ごと読み直し、読み直した直後にまた離れたら繰り返さない", async () => {
    const reload = vi
      .spyOn(location, "reload")
      .mockImplementation(() => undefined);
    const errors = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const { panes } = await startHost();
    panes.p1.leaveOrigin();
    panes.p1.leaveOrigin();
    expect({
      reloads: reload.mock.calls.length,
      errors: errors.mock.calls
        .map(([error]) => String(error))
        .filter((message) => message.includes("left this origin")),
    }).toEqual({
      reloads: 1,
      errors: [
        "Error: the pane left this origin again right after reloading for sign-in; not reloading again",
      ],
    });
  });
});

describe("index.html", () => {
  test("写す部品は全部 index.html にある", () => {
    expect(MIRRORED_IDS.filter((id) => !document.getElementById(id))).toEqual(
      [],
    );
  });
});
