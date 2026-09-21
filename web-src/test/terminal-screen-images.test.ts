// ターミナルの画面に出た画像パスが、右の棚の 1 枚になるまで。
//
// ここで見るのは繋ぎ込みの側。パスの拾い方そのものは
// terminal-images-core.test.ts、並びの決まりは terminal-image-shelf-list.test.ts、
// 配れるかの判定は agent-route.test.ts が見る。
//
// 落とすと痛いもの:
//
// - 画像を端末の文字の上に重ねる (パスの下の行・入力欄が隠れる。棚に移した理由)
// - 同じパスが何度流れても、問い合わせを作り直す (全画面アプリの下では同じ
//   画面が繰り返し届く)
// - 応答を待つ間に別のシェルへ切り替わったのに、その棚に足す (古い応答が勝つ)
// - パスにカーソルを載せても棚が応えない / 棚が端末のスクロールを奪う
//
// xterm 本体と EventSource は外の境界なので差し替える。差し替えないと
// web/xterm.js の動的 import に失敗して、attach がそこで止まる。xterm が
// 画面に見えていないと描画しないので、リンクの出入りは本物では実画面で
// 確かめる (作業報告の記録)。ここでは xterm に渡したリンクの中身を見る。

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
import type { ShellSession } from "../core/shell";
import type {
  TerminalImageRef,
  TerminalImageRejection,
} from "../core/terminal-images";
import type { XtermLink, XtermLinkProvider } from "../core/xterm-loader";
import { terminalText } from "../views/terminal/i18n";
import {
  createTerminalScreen,
  type TerminalScreenHandle,
} from "../views/terminal/terminal-screen";

// 端末のバッファ。テストから覗くために外へ出しておく (vi.mock の factory は
// 巻き上げられるので、外の変数を掴めない)。
type FakeTerminalState = {
  /** バッファの行 (0 始まり)。リンクの位置はここから決まる。 */
  lines: string[];
  cursorY: number;
  inputHandler(data: string): void;
  linkProvider: XtermLinkProvider | null;
  /** proposeDimensions が返す寸法。見えていない箱は NaN を返す。 */
  proposed: { cols: number; rows: number } | undefined;
};
const FAKE_STATE_KEY = "__terminalScreenFakeState";

function fakeState(): FakeTerminalState {
  return (globalThis as Record<string, unknown>)[
    FAKE_STATE_KEY
  ] as FakeTerminalState;
}

vi.mock("../core/xterm-loader", () => {
  const noop = () => undefined;
  const disposable = () => ({ dispose: noop });
  const state: FakeTerminalState = {
    lines: [],
    cursorY: 0,
    inputHandler: () => undefined,
    linkProvider: null,
    proposed: { cols: 80, rows: 24 },
  };
  (globalThis as Record<string, unknown>).__terminalScreenFakeState = state;
  /** 1 マス 1 字 (全角は 2 マス) の行を作る。本物の IBufferLine と同じ形。 */
  const bufferLine = (text: string, cols: number) => {
    const cells: Array<{ chars: string; width: number }> = [];
    for (const char of text) {
      const wide = /[\u3000-\u9fff\uff00-\uffef]/.test(char);
      cells.push({ chars: char, width: wide ? 2 : 1 });
      if (wide) cells.push({ chars: "", width: 0 });
    }
    while (cells.length < cols) cells.push({ chars: "", width: 1 });
    return {
      isWrapped: false,
      length: cols,
      getCell: (x: number) => {
        const cell = cells[x];
        return cell
          ? { getChars: () => cell.chars, getWidth: () => cell.width }
          : undefined;
      },
      translateToString: () => text,
    };
  };
  class FakeTerminal {
    cols = 80;
    rows = 24;
    element: HTMLElement | undefined;
    textarea: HTMLTextAreaElement | undefined;
    options: Record<string, unknown>;
    buffer = {
      active: {
        viewportY: 0,
        baseY: 0,
        get cursorY() {
          return state.cursorY;
        },
        getLine: (y: number) =>
          y >= 0 && y < state.lines.length
            ? bufferLine(state.lines[y] ?? "", 80)
            : undefined,
      },
    };
    constructor(options: Record<string, unknown>) {
      this.options = { ...options };
    }
    registerLinkProvider = (provider: XtermLinkProvider) => {
      state.linkProvider = provider;
      return { dispose: noop };
    };
    onRender = disposable;
    onScroll = disposable;
    scrollLines = noop;
    open = (parent: HTMLElement) => {
      const root = document.createElement("div");
      root.className = "xterm";
      const screen = document.createElement("div");
      screen.className = "xterm-screen";
      root.appendChild(screen);
      parent.appendChild(root);
      this.element = root;
    };
    write = noop;
    resize = (cols: number, rows: number) => {
      this.cols = cols;
      this.rows = rows;
    };
    focus = noop;
    blur = noop;
    clear = noop;
    reset = noop;
    dispose = noop;
    loadAddon = noop;
    onData = (handler: (data: string) => void) => {
      state.inputHandler = handler;
      return disposable();
    };
    onResize = disposable;
    attachCustomKeyEventHandler = noop;
    attachCustomWheelEventHandler = noop;
  }
  class FakeFitAddon {
    activate = noop;
    dispose = noop;
    fit = noop;
    proposeDimensions = () => state.proposed;
  }
  return {
    loadXterm: () =>
      Promise.resolve({
        Terminal: FakeTerminal,
        FitAddon: FakeFitAddon,
      }),
  };
});

/**
 * サーバが返す 1 枚。取りにいく URL もサーバが決める。candidate は画面に出て
 * いる綴りで、実体のパス (path) とは違う。
 */
const IMAGE: TerminalImageRef = {
  path: "/repo/docs/out.png",
  candidate: "docs/out.png",
  name: "out.png",
  url: "/_agent/image?path=%2Frepo%2Fdocs%2Fout.png&v=1000-3",
  bytes: 3,
  mtimeMs: 1000,
};

const OTHER_IMAGE: TerminalImageRef = {
  path: "/repo/docs/chart.png",
  candidate: "docs/chart.png",
  name: "chart.png",
  url: "/_agent/image?path=%2Frepo%2Fdocs%2Fchart.png&v=1000-3",
  bytes: 3,
  mtimeMs: 1000,
};

/** 開いた購読。テストから出力を流し込むために持っておく。 */
type OpenedSource = {
  url: string;
  emitOutput(data: string): void;
};

type ImagesBody = {
  images: TerminalImageRef[];
  rejected: TerminalImageRejection[];
};

let sources: OpenedSource[] = [];
let requestedUrls: string[] = [];
let requestedBodies: Array<string | null> = [];
let statusMessages: Array<string | null> = [];
let failingUrl: string | null = null;
/** /_agent/images が返すもの。 */
let respond: (url: string) => ImagesBody;
/** /_agent/images/history が返すもの。 */
let respondHistory: () => ImagesBody;
/** /_agent/images/history が返す候補の順 (新しい順)。 */
let historyCandidates: string[] = [];
/** 保留にした応答を返す関数。世代照合を見るテストで使う。 */
let pendingResponses: Array<() => void> = [];
let holdResponses = false;
let shelfCollapsed = false;
let collapsedChanges: boolean[] = [];

function installFakes(): void {
  class FakeEventSource {
    static readonly CLOSED = 2;
    readyState = 1;
    onerror: (() => void) | null = null;
    private handlers = new Map<string, (event: MessageEvent<string>) => void>();
    constructor(url: string) {
      sources.push({
        url,
        emitOutput: (data) => {
          this.handlers.get("output")?.({
            data: JSON.stringify({ data }),
          } as MessageEvent<string>);
        },
      });
    }
    addEventListener(
      type: string,
      handler: (event: MessageEvent<string>) => void,
    ): void {
      this.handlers.set(type, handler);
    }
    close(): void {
      this.readyState = 2;
    }
  }
  const noop = () => undefined;
  Object.defineProperty(globalThis, "EventSource", {
    configurable: true,
    value: FakeEventSource,
  });
  Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    value: class {
      observe = noop;
      unobserve = noop;
      disconnect = noop;
    },
  });
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: (input: string, init?: RequestInit) => {
      const url = String(input);
      requestedUrls.push(url);
      requestedBodies.push(typeof init?.body === "string" ? init.body : null);
      if (url === failingUrl) {
        return Promise.resolve(
          new Response('{"errors":[{"code":"E1"},{"code":"E2"}]}', {
            status: 503,
            statusText: "Service Unavailable",
          }),
        );
      }
      const base = { source: "pane", cwd: "/repo" };
      const body = url.startsWith("/_agent/images/history")
        ? {
            ...respondHistory(),
            base,
            pane: "%7",
            candidates: historyCandidates,
            lines: 30,
          }
        : { ...respond(url), base };
      const res = { ok: true, status: 200, json: () => Promise.resolve(body) };
      if (!holdResponses || url.startsWith("/_agent/images/history")) {
        return Promise.resolve(res);
      }
      return new Promise((resolve) => {
        pendingResponses.push(() => resolve(res));
      });
    },
  });
}

const SHELL: ShellSession = {
  id: "shell-abc123",
  command: "/bin/zsh",
  cwd: "/repo",
  createdAt: "2026-08-01T09:41:58.000Z",
  cols: 80,
  rows: 24,
  exited: false,
  exitCode: null,
  tty: "/dev/ttys001",
};

const OTHER_SHELL: ShellSession = {
  ...SHELL,
  id: "shell-def456",
  tty: "/dev/ttys002",
};

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function shelfNames(handle: TerminalScreenHandle): string[] {
  return [...handle.el.querySelectorAll(".terminal-image-shelf-name")].map(
    (el) => el.textContent ?? "",
  );
}

function shelfEl(handle: TerminalScreenHandle): HTMLElement {
  const el = handle.el.querySelector<HTMLElement>(".terminal-image-shelf");
  if (!el) throw new Error("shelf was not mounted");
  return el;
}

/** 出力の走査からの問い合わせ (繋いだときの履歴の問い合わせは除く)。 */
function imageRequests(): string[] {
  return requestedUrls.filter((url) => url.startsWith("/_agent/images?"));
}

function historyRequests(): string[] {
  return requestedUrls.filter((url) =>
    url.startsWith("/_agent/images/history"),
  );
}

/** xterm に渡したリンクを、その行 (1 始まり) について聞く。 */
function linksAt(line: number): XtermLink[] {
  const provider = fakeState().linkProvider;
  if (!provider) throw new Error("no link provider registered");
  let links: XtermLink[] | undefined;
  provider.provideLinks(line, (value) => {
    links = value;
  });
  return links ?? [];
}

beforeAll(() => {
  GlobalRegistrator.register({ url: "http://localhost/" });
});

afterAll(() => {
  GlobalRegistrator.unregister();
});

let handle: TerminalScreenHandle;

beforeEach(() => {
  sources = [];
  requestedUrls = [];
  requestedBodies = [];
  statusMessages = [];
  failingUrl = null;
  pendingResponses = [];
  holdResponses = false;
  shelfCollapsed = false;
  collapsedChanges = [];
  respond = () => ({ images: [IMAGE], rejected: [] });
  respondHistory = () => ({ images: [], rejected: [] });
  historyCandidates = [];
  const state = fakeState();
  state.lines = ["$ make chart", "wrote docs/out.png", ""];
  state.cursorY = 2;
  state.linkProvider = null;
  state.proposed = { cols: 80, rows: 24 };
  installFakes();
  handle = createTerminalScreen({
    trackLoad: (promise) => promise,
    actionHeaders: () => ({}),
    getText: () => terminalText("en"),
    onStatus: (message) => statusMessages.push(message),
    onTargetGone: () => undefined,
    getFontSize: () => 14,
    isImageShelfCollapsed: () => shelfCollapsed,
    setImageShelfCollapsed: (collapsed) => {
      shelfCollapsed = collapsed;
      collapsedChanges.push(collapsed);
    },
  });
  document.body.append(handle.el);
});

afterEach(() => {
  vi.restoreAllMocks();
  handle.dispose();
  document.body.innerHTML = "";
});

async function attachShell(session: ShellSession): Promise<OpenedSource> {
  await handle.attach(session);
  const source = sources[sources.length - 1];
  if (!source) throw new Error("no subscription opened");
  return source;
}

describe("画面に出た画像パスと棚", () => {
  test("パスが出たら棚に入り、文字の上には何も重ねない", async () => {
    const source = await attachShell(SHELL);
    expect(shelfEl(handle).hidden).toBe(true);
    source.emitOutput("wrote docs/out.png\n");
    await flush();

    // 相対パスをペインの作業場所から解いてもらうため、シェルを添えて聞く。
    expect(imageRequests()).toEqual([
      "/_agent/images?shell=shell-abc123&path=docs%2Fout.png",
    ]);
    expect(shelfEl(handle).hidden).toBe(false);
    expect(shelfNames(handle)).toEqual(["out.png"]);
    const picture = shelfEl(handle).querySelector("img");
    // 取りにいく先はサーバが決める。こちらで URL を組み立てない。
    expect(picture?.getAttribute("src")).toBe(IMAGE.url);
    expect(picture?.getAttribute("loading")).toBe("lazy");
    // 端末の画面の中には画像を置かない。
    expect(handle.el.querySelectorAll(".terminal-screen img")).toHaveLength(0);
    // 棚は端末の画面の隣 (同じ行) に並ぶ。
    const row = handle.el.querySelector(".terminal-screen-row");
    expect([...(row?.children ?? [])].map((el) => el.className)).toEqual([
      "terminal-screen",
      "terminal-image-shelf",
    ]);
  });

  test("同じ画面が何度届いても問い合わせを作り直さない", async () => {
    // 全画面アプリの下では同じ画面が続けて届く。
    const source = await attachShell(SHELL);
    for (let i = 0; i < 5; i += 1) {
      source.emitOutput("wrote docs/out.png\n");
      await flush();
    }
    expect(imageRequests()).toHaveLength(1);
    expect(shelfNames(handle)).toEqual(["out.png"]);
  });

  test("しばらくして同じパスがまた出たら聞き直し、上書きされていれば先頭へ", async () => {
    let now = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    respond = (url) =>
      url.includes("chart")
        ? { images: [OTHER_IMAGE], rejected: [] }
        : { images: [IMAGE], rejected: [] };
    const source = await attachShell(SHELL);
    source.emitOutput("wrote docs/out.png\n");
    await flush();
    source.emitOutput("wrote docs/chart.png\n");
    await flush();
    expect(shelfNames(handle)).toEqual(["chart.png", "out.png"]);

    // エージェントが同じ名前で書き直した。
    now += 5_000;
    respond = () => ({
      images: [{ ...IMAGE, mtimeMs: 2000, url: `${IMAGE.path}?v=2` }],
      rejected: [],
    });
    source.emitOutput("wrote docs/out.png\n");
    await flush();

    expect(imageRequests()).toHaveLength(3);
    expect(shelfNames(handle)).toEqual(["out.png", "chart.png"]);
    expect(shelfEl(handle).querySelector("img")?.getAttribute("src")).toBe(
      `${IMAGE.path}?v=2`,
    );
  });

  test("1 回で届いた画面では、最後に出てきた位置の新しい順に並べる", async () => {
    // 繋いだ直後やアプリの描き直しでは画面全体が 1 回で届く。書き直して
    // 出し直したパス (out.png) は、最初に出てきた位置ではなく最後の位置で並ぶ。
    respond = (url) => ({
      images: [
        ...(url.includes("out.png") ? [IMAGE] : []),
        ...(url.includes("chart.png") ? [OTHER_IMAGE] : []),
      ],
      rejected: [],
    });
    const source = await attachShell(SHELL);
    source.emitOutput(
      "wrote docs/out.png\nwrote docs/chart.png\nrewrote docs/out.png\n",
    );
    await flush();

    // 問い合わせは古い順 (最後の位置で) に並べて送る。
    expect(imageRequests()).toEqual([
      "/_agent/images?shell=shell-abc123&path=docs%2Fchart.png&path=docs%2Fout.png",
    ]);
    expect(shelfNames(handle)).toEqual(["out.png", "chart.png"]);
  });

  test("読めなかった画像も出てきた順で並ぶ (いつも上に来ない)", async () => {
    respond = () => ({
      images: [IMAGE],
      rejected: [
        {
          candidate: "docs/huge.png",
          path: "/repo/docs/huge.png",
          name: "huge.png",
          reason: "too-large",
          bytes: 9 * 1024 * 1024,
        },
      ],
    });
    const source = await attachShell(SHELL);
    source.emitOutput("wrote docs/huge.png\nwrote docs/out.png\n");
    await flush();
    expect(shelfNames(handle)).toEqual(["out.png", "huge.png"]);
  });

  test("履歴の応答は、サーバが返した候補の順 (新しい順) で並べる", async () => {
    respondHistory = () => ({
      images: [IMAGE, OTHER_IMAGE],
      rejected: [
        {
          candidate: "/repo/docs/huge.png",
          path: "/repo/docs/huge.png",
          name: "huge.png",
          reason: "too-large",
          bytes: 9 * 1024 * 1024,
        },
      ],
    });
    historyCandidates = [
      "docs/chart.png",
      "/repo/docs/huge.png",
      "docs/out.png",
    ];
    await attachShell(SHELL);
    await flush();
    expect(shelfNames(handle)).toEqual(["chart.png", "huge.png", "out.png"]);
  });

  test("画像パスが無い出力では問い合わせない", async () => {
    const source = await attachShell(SHELL);
    source.emitOutput("$ ls -la\ntotal 0\n");
    await flush();

    expect(imageRequests()).toEqual([]);
    expect(shelfEl(handle).hidden).toBe(true);
  });

  test("別のシェルへ切り替えたら棚は空になり、また拾い直せる", async () => {
    const first = await attachShell(SHELL);
    first.emitOutput("wrote docs/out.png\n");
    await flush();
    expect(shelfNames(handle)).toEqual(["out.png"]);

    const second = await attachShell(OTHER_SHELL);
    expect(shelfNames(handle)).toEqual([]);
    second.emitOutput("wrote docs/out.png\n");
    await flush();

    expect(imageRequests()).toHaveLength(2);
    expect(shelfNames(handle)).toEqual(["out.png"]);
  });

  test("同じシェルへ戻ったら、前の棚を戻す", async () => {
    // パネルは Terminal と Tools がタブなので、切り替えるたびに detach される。
    const source = await attachShell(SHELL);
    source.emitOutput("wrote docs/out.png\n");
    await flush();

    handle.detach();
    expect(shelfNames(handle)).toEqual([]);

    await attachShell(SHELL);
    expect(shelfNames(handle)).toEqual(["out.png"]);
  });

  test("繋いだときにペインの履歴を 1 回だけ問い合わせ、出力で見つけたものより下に並べる", async () => {
    holdResponses = false;
    respondHistory = () => ({ images: [OTHER_IMAGE], rejected: [] });
    const source = await attachShell(SHELL);
    source.emitOutput("wrote docs/out.png\n");
    await flush();

    expect(historyRequests()).toEqual([
      "/_agent/images/history?shell=shell-abc123",
    ]);
    expect(shelfNames(handle)).toEqual(["out.png", "chart.png"]);
  });

  test("サムネイルが読めなくなったら聞き直し、理由つきで棚に残す", async () => {
    const source = await attachShell(SHELL);
    source.emitOutput("wrote docs/out.png\n");
    await flush();

    respond = () => ({
      images: [],
      rejected: [
        {
          candidate: IMAGE.path,
          path: IMAGE.path,
          name: "out.png",
          reason: "missing",
        },
      ],
    });
    shelfEl(handle).querySelector("img")?.dispatchEvent(new Event("error"));
    await flush();

    expect(imageRequests()[1]).toBe(
      "/_agent/images?shell=shell-abc123&path=%2Frepo%2Fdocs%2Fout.png",
    );
    expect(shelfNames(handle)).toEqual(["out.png"]);
    const item = shelfEl(handle).querySelector(".terminal-image-shelf-item");
    expect(item?.getAttribute("data-failed")).toBe("true");
    expect(item?.querySelector(".terminal-image-shelf-meta")?.textContent).toBe(
      "Not found (deleted?)",
    );
  });

  test("大きすぎる画像はサムネイルを出さず、名前と理由だけ出す", async () => {
    respond = () => ({
      images: [],
      rejected: [
        {
          candidate: "docs/huge.png",
          path: "/repo/docs/huge.png",
          name: "huge.png",
          reason: "too-large",
          bytes: 9 * 1024 * 1024,
        },
      ],
    });
    const source = await attachShell(SHELL);
    source.emitOutput("wrote docs/huge.png\n");
    await flush();

    expect(shelfNames(handle)).toEqual(["huge.png"]);
    expect(shelfEl(handle).querySelector("img")).toBeNull();
    // サムネイルの代わりに読めなかった印を出す。
    expect(
      shelfEl(handle).querySelector(".terminal-image-shelf-failed-icon"),
    ).not.toBeNull();
    expect(
      shelfEl(handle).querySelector(".terminal-image-shelf-meta")?.textContent,
    ).toBe("Too large (9 MB)");
  });

  test("応答を待つ間に切り替わったら、新しい棚には入れない", async () => {
    holdResponses = true;
    const source = await attachShell(SHELL);
    source.emitOutput("wrote docs/out.png\n");
    await flush();
    expect(imageRequests()).toHaveLength(1);

    await attachShell(OTHER_SHELL);
    for (const resolve of pendingResponses) resolve();
    await flush();

    expect(shelfNames(handle)).toEqual([]);
  });
});

describe("棚の操作", () => {
  async function shelfWithTwo(): Promise<void> {
    respond = (url) =>
      url.includes("chart")
        ? { images: [OTHER_IMAGE], rejected: [] }
        : { images: [IMAGE], rejected: [] };
    const source = await attachShell(SHELL);
    source.emitOutput("wrote docs/out.png\n");
    await flush();
    source.emitOutput("wrote docs/chart.png\n");
    await flush();
  }

  test("サムネイルを押すと拡大表示が開き、棚の並びを ←→ で回れる", async () => {
    await shelfWithTwo();
    const opens = shelfEl(handle).querySelectorAll<HTMLButtonElement>(
      ".terminal-image-shelf-open",
    );
    // 2 番目 (out.png) を開く。
    opens.item(1).click();
    const box = document.querySelector(".terminal-lightbox");
    const src = () => box?.querySelector("img")?.getAttribute("src");
    expect(src()).toBe(IMAGE.url);

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft" }));
    expect(src()).toBe(OTHER_IMAGE.url);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
    expect(src()).toBe(IMAGE.url);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(document.querySelector(".terminal-lightbox")).toBeNull();
  });

  test("畳むと件数のボタンだけになり、設定に覚えてもらう", async () => {
    await shelfWithTwo();
    shelfEl(handle)
      .querySelector<HTMLButtonElement>(".terminal-image-shelf-toggle")
      ?.click();

    expect(collapsedChanges).toEqual([true]);
    expect(shelfEl(handle).dataset.collapsed).toBe("true");
    const expand = shelfEl(handle).querySelector<HTMLButtonElement>(
      ".terminal-image-shelf-expand",
    );
    expect(expand?.hidden).toBe(false);
    expect(expand?.textContent).toBe("2");
    expect(
      shelfEl(handle).querySelector<HTMLElement>(".terminal-image-shelf-list")
        ?.hidden,
    ).toBe(true);

    expand?.click();
    expect(collapsedChanges).toEqual([true, false]);
    expect(shelfEl(handle).dataset.collapsed).toBe("false");
  });

  test("畳んだ設定のまま開き直すと畳んだまま", async () => {
    shelfCollapsed = true;
    await shelfWithTwo();
    expect(shelfEl(handle).dataset.collapsed).toBe("true");
    expect(shelfEl(handle).hidden).toBe(false);
  });
});

describe("文字の中の画像パス (リンク)", () => {
  test("棚にある画像のパスだけをリンクにする", async () => {
    const source = await attachShell(SHELL);
    source.emitOutput("wrote docs/out.png\n");
    await flush();

    // バッファの 2 行目 (1 始まり) に "wrote docs/out.png"。
    const [link] = linksAt(2);
    expect(link?.text).toBe("docs/out.png");
    expect(link?.range).toEqual({
      start: { x: 7, y: 2 },
      end: { x: 18, y: 2 },
    });
    expect(link?.decorations).toEqual({ pointerCursor: true, underline: true });
    // パスの無い行と、棚に無い画像のパスはリンクにしない。
    expect(linksAt(1)).toEqual([]);
    fakeState().lines = ["wrote docs/unknown.png"];
    expect(linksAt(1)).toEqual([]);
  });

  test("全角の字が前にあってもマス目の位置で範囲を返す", async () => {
    fakeState().lines = ["保存 docs/out.png"];
    const source = await attachShell(SHELL);
    source.emitOutput("保存 docs/out.png\n");
    await flush();

    // "保存" は 2 字で 4 マス。パスは 6 マス目 (1 始まり) から。
    expect(linksAt(1)[0]?.range).toEqual({
      start: { x: 6, y: 1 },
      end: { x: 17, y: 1 },
    });
  });

  test("カーソルが載ると棚の同じ画像を強調し、離れると外す", async () => {
    const source = await attachShell(SHELL);
    source.emitOutput("wrote docs/out.png\n");
    await flush();
    const [link] = linksAt(2);
    const item = () =>
      shelfEl(handle).querySelector<HTMLElement>(".terminal-image-shelf-item");

    link?.hover?.(new MouseEvent("mousemove"), "docs/out.png");
    expect(item()?.dataset.linked).toBe("true");
    // 文字の上にはツールチップも画像も出さない。
    expect(handle.el.querySelectorAll(".terminal-screen img")).toHaveLength(0);

    link?.leave?.(new MouseEvent("mouseleave"), "docs/out.png");
    expect(item()?.dataset.linked).toBeUndefined();
  });

  test("畳んでいる間はボタンだけで応える", async () => {
    shelfCollapsed = true;
    const source = await attachShell(SHELL);
    source.emitOutput("wrote docs/out.png\n");
    await flush();
    linksAt(2)[0]?.hover?.(new MouseEvent("mousemove"), "docs/out.png");

    expect(shelfEl(handle).dataset.collapsed).toBe("true");
    expect(
      shelfEl(handle).querySelector<HTMLElement>(".terminal-image-shelf-expand")
        ?.dataset.linked,
    ).toBe("true");
  });

  test("リンクを押すと拡大表示が開く", async () => {
    const source = await attachShell(SHELL);
    source.emitOutput("wrote docs/out.png\n");
    await flush();
    linksAt(2)[0]?.activate(new MouseEvent("click"), "docs/out.png");

    const box = document.querySelector(".terminal-lightbox");
    expect(box?.querySelector("img")?.getAttribute("src")).toBe(IMAGE.url);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  });
});

describe("寸法", () => {
  test.each([
    {
      name: "測れた寸法",
      proposed: { cols: 100, rows: 30 },
      expected: { cols: 100, rows: 30 },
    },
    {
      name: "見えていない箱 (NaN)",
      proposed: { cols: Number.NaN, rows: Number.NaN },
      expected: null,
    },
    { name: "測れない", proposed: undefined, expected: null },
  ])("$name", async ({ proposed, expected }) => {
    // NaN をそのまま丸めると最小の桁数になり、tmux のウィンドウまで縮む。
    await attachShell(SHELL);
    fakeState().proposed = proposed;
    expect(handle.measure()).toEqual(expected);
  });
});

describe("ターミナル入力", () => {
  test("xterm の入力を接続中のシェルへ送る", async () => {
    await attachShell(SHELL);

    fakeState().inputHandler("ls\n");
    await flush();

    expect(requestedUrls[requestedUrls.length - 1]).toBe("/_shell/keys");
    expect(
      JSON.parse(requestedBodies[requestedBodies.length - 1] ?? "null"),
    ).toEqual({
      id: "shell-abc123",
      data: "ls\n",
    });
  });

  test("入力の送信失敗では HTTP 状態とレスポンス本文をすべて表示する", async () => {
    await attachShell(SHELL);
    failingUrl = "/_shell/keys";

    fakeState().inputHandler("x");
    await flush();

    expect(statusMessages[statusMessages.length - 1]).toBe(
      'Failed to send input. (HTTP 503 Service Unavailable): {"errors":[{"code":"E1"},{"code":"E2"}]}',
    );
  });
});
