// 外側のページ (host) と面 (pane) のやりとり (core/workspace-bridge.ts の形と
// views/workspace/bridge.ts)。host は index.html の部品をそのまま使い、面の iframe は
// 窓と文書を差し替えた偽物にする (口の上の知らせは本物の MessageChannel)。

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
import { startWorkspaceHost } from "../views/workspace/bridge";

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
    { name: "host の hello", data: { type: HOST_HELLO }, expected: true },
    { name: "別の用途の message", data: { type: "other" }, expected: false },
    { name: "null", data: null, expected: false },
  ])("isHostHello: $name", ({ data, expected }) => {
    expect(isHostHello(data)).toBe(expected);
  });
});

beforeAll(() => {
  GlobalRegistrator.register({ url: "http://127.0.0.1/p/0123456789abcdef/" });
});
afterAll(() => {
  GlobalRegistrator.unregister();
});

beforeEach(() => {
  document.body.innerHTML = BODY;
});
afterEach(() => {
  vi.useRealTimers();
});

/**
 * host の面の iframe。空のページを読み終えてから窓と文書を偽物にして、host が
 * 渡した口を受け取る (読み終わりの load は、host を始める前に済ませる)。
 */
async function paneFrame(loaded: boolean) {
  const frame = document.createElement("iframe");
  frame.setAttribute("data-cv-pane", "p1");
  frame.src = "about:blank";
  const workspace = document.getElementById("workspace");
  if (!workspace) throw new Error("index.html has no #workspace");
  const blank = new Promise((resolve) =>
    frame.addEventListener("load", resolve, { once: true }),
  );
  workspace.append(frame);
  await blank;
  const hellos: MessagePort[] = [];
  const paneWindow = {
    postMessage(data: unknown, origin: string, ports: MessagePort[]) {
      expect({ data, origin }).toEqual({
        data: { type: HOST_HELLO },
        origin: location.origin,
      });
      hellos.push(...ports);
    },
  };
  const paneDocument = {
    readyState: loaded ? "complete" : "loading",
    URL: loaded ? location.href : "about:blank",
  };
  // null は、面がこの origin を離れた (外部接続のサインインへ移された) とき。
  let shown: typeof paneDocument | null = paneDocument;
  Object.defineProperty(frame, "contentWindow", { value: paneWindow });
  Object.defineProperty(frame, "contentDocument", { get: () => shown });
  const leaveOrigin = () => {
    shown = null;
    frame.dispatchEvent(new Event("load"));
  };
  return { frame, hellos, paneDocument, leaveOrigin };
}

async function startHost(loaded = true) {
  const pane = await paneFrame(loaded);
  const deps = {
    onLocation: vi.fn(),
    onViewing: vi.fn(),
    onLookChanged: vi.fn(),
    onNavCollapsed: vi.fn(),
  };
  const host = startWorkspaceHost(deps);
  return { host, deps, ...pane };
}

/** 面の側の口: host へ送り、host の頼みを集める。 */
function paneEnd(port: MessagePort) {
  const received: HostCommand[] = [];
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

const AUTO_UPDATE: MirroredItem = {
  id: "auto-update",
  attributes: [
    ["id", "auto-update"],
    ["class", "global-icon-action"],
    ["title", "auto update is off"],
  ],
  html: '<span class="goi-icon" aria-hidden="true">off</span>',
};

describe("host: 最下段の面ごとの項目は面の写し", () => {
  test("写した値を出し、host の app.ts が書いても面の値に戻す", async () => {
    const { hellos } = await startHost();
    const pane = paneEnd(hellos[0]);
    pane.send({ type: "mirror", items: [AUTO_UPDATE] });
    await vi.waitFor(() =>
      expect(el("auto-update").className).toBe("global-icon-action"),
    );
    el("auto-update").classList.add("active");
    await Promise.resolve();
    expect({
      className: el("auto-update").className,
      title: el("auto-update").title,
      html: el("auto-update").innerHTML,
    }).toEqual({
      className: "global-icon-action",
      title: "auto update is off",
      html: AUTO_UPDATE.html,
    });
  });

  test("吹き出しを出している間も、写しと吹き出しが title を書き合わない", async () => {
    const { hellos } = await startHost();
    const pane = paneEnd(hellos[0]);
    pane.send({ type: "mirror", items: [AUTO_UPDATE] });
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
    pane.send({
      type: "mirror",
      items: [
        {
          ...AUTO_UPDATE,
          attributes: [
            ["id", "auto-update"],
            ["class", "global-icon-action active"],
            ["title", "auto update is on"],
          ],
        },
      ],
    });
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
  test("修飾キーごと面へ送り、host の同じ id の処理は動かさない", async () => {
    const { hellos } = await startHost();
    const pane = paneEnd(hellos[0]);
    const hostHandler = vi.fn();
    el("copy-ai-context").addEventListener("click", hostHandler);
    el("copy-ai-context").dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        shiftKey: true,
      }),
    );
    await vi.waitFor(() => expect(pane.received.length).toBe(1));
    expect({
      received: pane.received,
      host: hostHandler.mock.calls.length,
    }).toEqual({
      received: [
        {
          type: "click",
          id: "copy-ai-context",
          modifiers: {
            shiftKey: true,
            altKey: false,
            ctrlKey: false,
            metaKey: false,
          },
        },
      ],
      host: 0,
    });
  });

  test.each([
    { name: "⌘＋クリック", init: { metaKey: true } },
    { name: "中ボタン", init: { button: 1 } },
  ])("リンクの $name は新しいタブで開く (面へ送らない)", async ({ init }) => {
    const { hellos } = await startHost();
    const pane = paneEnd(hellos[0]);
    const event = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      ...init,
    });
    el("nav-help").dispatchEvent(event);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect({ sent: pane.received, prevented: event.defaultPrevented }).toEqual({
      sent: [],
      prevented: false,
    });
  });
});

describe("host: アドレス欄と頼みの順番", () => {
  test("面の URL とプロジェクトをアドレス欄と deps に写す", async () => {
    const { hellos, deps } = await startHost();
    const pane = paneEnd(hellos[0]);
    const project = { root: "/work/sample-app", name: "sample-app" };
    pane.send({
      type: "location",
      href: `${location.origin}/p/0123456789abcdef/history`,
      project,
    });
    await vi.waitFor(() => expect(deps.onLocation).toHaveBeenCalled());
    expect({
      path: location.pathname,
      project: deps.onLocation.mock.calls[0][0],
    }).toEqual({ path: "/p/0123456789abcdef/history", project });
  });

  test("面が読み終わる前の頼みは、読み終わったときに渡した口へ送る", async () => {
    const { host, hellos, frame, paneDocument } = await startHost(false);
    host.command({ type: "settings-at", heading: "accounts" });
    expect(hellos.length).toBe(0);
    paneDocument.readyState = "complete";
    paneDocument.URL = location.href;
    frame.dispatchEvent(new Event("load"));
    const pane = paneEnd(hellos[0]);
    await vi.waitFor(() =>
      expect(pane.received).toEqual([
        { type: "settings-at", heading: "accounts" },
      ]),
    );
  });
});

describe("host: 面がこの origin を離れたら (サインイン)", () => {
  test("窓ごと読み直し、読み直した直後にまた離れたら繰り返さない", async () => {
    sessionStorage.clear();
    const reload = vi
      .spyOn(location, "reload")
      .mockImplementation(() => undefined);
    const errors = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const { leaveOrigin } = await startHost();
    leaveOrigin();
    leaveOrigin();
    expect({
      reloads: reload.mock.calls.length,
      errors: errors.mock.calls.map(([error]) => String(error)),
    }).toEqual({
      reloads: 1,
      errors: [
        "Error: the pane left this origin again right after reloading for sign-in; not reloading again",
      ],
    });
    reload.mockRestore();
    errors.mockRestore();
  });
});

describe("index.html", () => {
  test("写す部品は全部 index.html にある", () => {
    expect(MIRRORED_IDS.filter((id) => !document.getElementById(id))).toEqual(
      [],
    );
  });
});
