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
import type { XtermLinkProvider } from "../core/xterm-loader";
import { terminalText } from "../views/terminal/i18n";
import { LINK_BAR_HIDE_MS } from "../views/terminal/terminal-links-layer";
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
  /** xterm の選択 (select の引数)。無ければ null。 */
  selection: { column: number; row: number; length: number } | null;
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
    selection: null,
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
        get length() {
          return state.lines.length;
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
    /** 本物と同じく、書き込むたびに描画を知らせる。 */
    private renderHandlers: Array<() => void> = [];
    onRender = (handler: () => void) => {
      this.renderHandlers.push(handler);
      return { dispose: noop };
    };
    onScroll = disposable;
    scrollLines = noop;
    select = (column: number, row: number, length: number) => {
      state.selection = { column, row, length };
    };
    hasSelection = () => state.selection !== null;
    clearSelection = () => {
      state.selection = null;
    };
    open = (parent: HTMLElement) => {
      const root = document.createElement("div");
      root.className = "xterm";
      const screen = document.createElement("div");
      screen.className = "xterm-screen";
      // マス目は 8×16 px (画面の位置から桁と行を決めるのに使う)。
      Object.defineProperty(screen, "clientWidth", { get: () => 80 * 8 });
      Object.defineProperty(screen, "clientHeight", { get: () => 24 * 16 });
      root.appendChild(screen);
      parent.appendChild(root);
      this.element = root;
    };
    write = () => {
      for (const handler of this.renderHandlers) handler();
    };
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

/** 貼り付けた画像。サーバはリポジトリの .code-viewer/pasted/ に保存する。 */
const PASTED: TerminalImageRef = {
  path: "/repo/.code-viewer/pasted/pasted-image-20260925-143201.png",
  candidate: "/repo/.code-viewer/pasted/pasted-image-20260925-143201.png",
  name: "pasted-image-20260925-143201.png",
  url: "/_agent/image?path=%2Frepo%2F.code-viewer%2Fpasted%2Fpasted-image-20260925-143201.png&v=2000-4",
  bytes: 4,
  mtimeMs: 2000,
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
      if (url === "/_agent/paste") {
        const saved = {
          path: PASTED.path,
          relativePath: ".code-viewer/pasted/pasted-image-20260925-143201.png",
          name: PASTED.name,
          bytes: 4,
        };
        return Promise.resolve(
          new Response(JSON.stringify(saved), { status: 200 }),
        );
      }
      if (url.startsWith("/_agent/paths")) {
        return Promise.resolve(
          new Response(JSON.stringify({ files: [] }), { status: 200 }),
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

/** 画面の描き直し (リンクの印は次の描画の前に読み直す)。 */
const nextFrame = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/** 画面の行と桁 (0 始まり) のマスの真ん中に、マウスの出来事を送る (マス目は 8×16)。 */
function mouseAt(
  type: string,
  row: number,
  col: number,
  init: MouseEventInit = {},
): void {
  const screen = handle.el.querySelector(".xterm-screen");
  if (!screen) throw new Error("no xterm screen");
  screen.dispatchEvent(
    new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX: col * 8 + 4,
      clientY: row * 16 + 8,
      ...init,
    }),
  );
}

/** 層に描いた印 (画面の行・桁・桁数)。 */
function marks(selector: string): Array<{
  row: number;
  col: number;
  cols: number;
}> {
  return [...handle.el.querySelectorAll<HTMLElement>(selector)].map((el) => ({
    row: Number(el.style.getPropertyValue("--link-row")),
    col: Number(el.style.getPropertyValue("--link-col")),
    cols: Number(el.style.getPropertyValue("--link-cols")),
  }));
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
  state.selection = null;
  installFakes();
  handle = makeScreen();
});

/** 画面を作って文書に置く。extra で依存を足す (画像のタブを開く先など)。 */
function makeScreen(
  extra: Partial<Parameters<typeof createTerminalScreen>[0]> = {},
): ReturnType<typeof createTerminalScreen> {
  const screen = createTerminalScreen({
    trackLoad: (promise) => promise,
    actionHeaders: () => ({}),
    getText: () => terminalText("en"),
    onStatus: (message) => statusMessages.push(message),
    onTargetGone: () => undefined,
    onShellExited: () => undefined,
    tmuxWindow: () => null,
    onTmuxWindowStale: () => undefined,
    getFontSize: () => 14,
    isImageShelfCollapsed: () => shelfCollapsed,
    setImageShelfCollapsed: (collapsed) => {
      shelfCollapsed = collapsed;
      collapsedChanges.push(collapsed);
    },
    ...extra,
  });
  document.body.append(screen.el);
  return screen;
}

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

  test.each([
    "https://example.invalid/image.png",
    "//example.invalid/image.png",
    "data:image/png;base64,AA==",
  ])("サーバ応答の外部画像 URL を読み込まない: %s", async (url) => {
    respond = () => ({ images: [{ ...IMAGE, url }], rejected: [] });
    const source = await attachShell(SHELL);
    source.emitOutput("wrote docs/out.png\n");
    await flush();

    expect(shelfEl(handle).querySelector("img")).toBeNull();
    expect(
      statusMessages.some((message) => message?.includes("same-origin URL")),
    ).toBe(true);
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

// ui-surface.md の「タブの決まり」: 画像は 1 回押すと画像のタブ (仮)、中ボタン・
// ⌘/Ctrl は固定のタブ、Alt / Shift は覆い。端末の中のリンクは Shift を選択に任せる。
describe("画像の開き方 (棚と端末のリンク)", () => {
  test.each([
    {
      name: "棚を押す",
      where: "shelf",
      type: "click",
      init: {},
      expected: "tab",
    },
    {
      name: "棚を ⌘＋クリック",
      where: "shelf",
      type: "click",
      init: { metaKey: true },
      expected: "kept",
    },
    {
      name: "棚を中ボタン",
      where: "shelf",
      type: "auxclick",
      init: { button: 1 },
      expected: "kept",
    },
    {
      name: "棚を Alt＋クリック",
      where: "shelf",
      type: "click",
      init: { altKey: true },
      expected: "overlay",
    },
    {
      name: "棚を Shift＋クリック",
      where: "shelf",
      type: "click",
      init: { shiftKey: true },
      expected: "overlay",
    },
    {
      name: "リンクを押す",
      where: "link",
      type: "click",
      init: {},
      expected: "tab",
    },
    {
      name: "リンクを Ctrl＋クリック",
      where: "link",
      type: "click",
      init: { ctrlKey: true },
      expected: "kept",
    },
    {
      name: "リンクを Alt＋クリック",
      where: "link",
      type: "click",
      init: { altKey: true },
      expected: "overlay",
    },
    {
      name: "リンクを Shift＋クリック",
      where: "link",
      type: "click",
      init: { shiftKey: true },
      expected: "none",
    },
  ])("$name → $expected", async ({ where, type, init, expected }) => {
    handle.dispose();
    const opened: string[] = [];
    handle = makeScreen({
      onOpenImage: (_image, _gallery, kept) =>
        opened.push(kept ? "kept" : "tab"),
    });
    const source = await attachShell(SHELL);
    source.emitOutput("wrote docs/out.png\n");
    await flush();
    const event = new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      ...init,
    });
    if (where === "shelf") {
      shelfEl(handle)
        .querySelector<HTMLButtonElement>(".terminal-image-shelf-open")
        ?.dispatchEvent(event);
    } else {
      // "wrote docs/out.png" は画面の 1 行目 (0 始まり) の 6 桁目から。
      await nextFrame();
      mouseAt(type, 1, 8, init);
    }
    const overlay = document.querySelector(".terminal-lightbox") !== null;
    expect(overlay ? "overlay" : (opened[0] ?? "none")).toBe(expected);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
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
      .querySelector<HTMLButtonElement>(".terminal-image-shelf-collapse")
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
  test("棚にある画像のパスだけに、常に薄い下線を引く", async () => {
    const source = await attachShell(SHELL);
    source.emitOutput("wrote docs/out.png\n");
    await flush();
    await nextFrame();

    // 画面の 1 行目 (0 始まり) の 6 桁目から 12 桁。
    expect(marks(".terminal-link-mark")).toEqual([
      { row: 1, col: 6, cols: 12 },
    ]);
    // 棚に無い画像のパスには引かない。
    fakeState().lines = ["wrote docs/unknown.png"];
    source.emitOutput("\n");
    await flush();
    await nextFrame();
    expect(marks(".terminal-link-mark")).toEqual([]);
  });

  test("全角の字が前にあってもマス目の位置に引く", async () => {
    fakeState().lines = ["保存 docs/out.png"];
    const source = await attachShell(SHELL);
    source.emitOutput("保存 docs/out.png\n");
    await flush();
    await nextFrame();

    // "保存" は 2 字で 4 マス。パスは 5 桁目 (0 始まり) から。
    expect(marks(".terminal-link-mark")).toEqual([
      { row: 0, col: 5, cols: 12 },
    ]);
  });

  test("カーソルが載ると強く強調して棚の同じ画像も強調し、離れると外す", async () => {
    const source = await attachShell(SHELL);
    source.emitOutput("wrote docs/out.png\n");
    await flush();
    await nextFrame();
    const item = () =>
      shelfEl(handle).querySelector<HTMLElement>(".terminal-image-shelf-item");

    mouseAt("mousemove", 1, 8);
    expect(item()?.dataset.linked).toBe("true");
    expect(marks(".terminal-link-hover")).toEqual([
      { row: 1, col: 6, cols: 12 },
    ]);

    mouseAt("mousemove", 5, 0);
    await new Promise((resolve) => setTimeout(resolve, LINK_BAR_HIDE_MS + 20));
    expect(item()?.dataset.linked).toBeUndefined();
    expect(marks(".terminal-link-hover")).toEqual([]);
  });

  test("畳んでいる間はボタンだけで応える", async () => {
    shelfCollapsed = true;
    const source = await attachShell(SHELL);
    source.emitOutput("wrote docs/out.png\n");
    await flush();
    await nextFrame();
    mouseAt("mousemove", 1, 8);

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
    await nextFrame();
    mouseAt("click", 1, 8);

    const box = document.querySelector(".terminal-lightbox");
    expect(box?.querySelector("img")?.getAttribute("src")).toBe(IMAGE.url);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  });
});

describe("貼り付けた画像", () => {
  /** クリップボードに PNG が 1 枚ある貼り付けを、端末の枠に起こす。 */
  function pastePng(): void {
    const event = new Event("paste", { bubbles: true, cancelable: true });
    const file = new File([new Uint8Array([137, 80, 78, 71])], "image.png", {
      type: "image/png",
    });
    Object.defineProperty(event, "clipboardData", {
      value: {
        items: [{ kind: "file", type: "image/png", getAsFile: () => file }],
      },
    });
    handle.el.dispatchEvent(event);
  }

  beforeEach(() => {
    // 問い合わせた綴りを candidate に返す (画面に出た綴りごとに聞かれる)。
    respond = (url) => {
      const candidate =
        new URL(url, "http://localhost/").searchParams.get("path") ?? "";
      return { images: [{ ...PASTED, candidate }], rejected: [] };
    };
  });

  test("貼ったらすぐ棚に出て、パスを端末へ打ち込む", async () => {
    await attachShell(SHELL);
    pastePng();
    await vi.waitFor(() =>
      expect(shelfNames(handle)).toEqual(["pasted-image-20260925-143201.png"]),
    );

    expect(requestedBodies[requestedUrls.indexOf("/_shell/keys")]).toBe(
      JSON.stringify({ id: SHELL.id, data: `'${PASTED.path}' ` }),
    );
  });

  test("保存した場所 (プロジェクトからの相対パス) を状態の行で知らせる", async () => {
    const source = await attachShell(SHELL);
    pastePng();
    await vi.waitFor(() =>
      expect(statusMessages[statusMessages.length - 1]).toContain(
        ".code-viewer/pasted/pasted-image-20260925-143201.png",
      ),
    );
    expect(statusMessages[statusMessages.length - 1]).toContain("git");
    // 打ち込んだパスの反響 (出力) が来ても知らせは消えない。
    source.emitOutput(
      "'/repo/.code-viewer/pasted/pasted-image-20260925-143201.png' ",
    );
    await flush();
    expect(statusMessages[statusMessages.length - 1]).toContain(
      ".code-viewer/pasted/",
    );
  });

  test("棚にだけ出て、ターミナルの上に帯を作らない (エージェントが別の綴りで出しても 1 枚)", async () => {
    const source = await attachShell(SHELL);
    pastePng();
    await vi.waitFor(() => expect(requestedUrls).toContain("/_shell/keys"));
    // エージェントは読んだファイルを作業場所からの相対パスで出す。
    source.emitOutput(
      "Read(.code-viewer/pasted/pasted-image-20260925-143201.png)\n",
    );
    await flush();

    expect(shelfNames(handle)).toEqual(["pasted-image-20260925-143201.png"]);
    expect(handle.el.querySelectorAll(".terminal-attachment")).toHaveLength(0);
    expect(handle.el.querySelectorAll("img")).toHaveLength(1);
  });
});

describe("棚のサムネイルと端末の文字", () => {
  function shelfOpen(): HTMLButtonElement {
    const open = shelfEl(handle).querySelector<HTMLButtonElement>(
      ".terminal-image-shelf-open",
    );
    if (!open) throw new Error("no shelf item");
    return open;
  }

  async function shelfWithOut(): Promise<void> {
    const source = await attachShell(SHELL);
    source.emitOutput("wrote docs/out.png\n");
    await flush();
  }

  test.each([
    { name: "カーソル", enter: "pointerenter", leave: "pointerleave" },
    { name: "フォーカス", enter: "focus", leave: "blur" },
  ])("$name が載ると端末の中のパスを強く強調し、離れると外す", async ({
    enter,
    leave,
  }) => {
    await shelfWithOut();
    shelfOpen().dispatchEvent(new Event(enter));
    // "wrote docs/out.png" はバッファの 1 行目 (0 始まり) の 6 桁目から 12 桁。
    expect(marks(".terminal-link-hover")).toEqual([
      { row: 1, col: 6, cols: 12 },
    ]);

    shelfOpen().dispatchEvent(new Event(leave));
    expect(marks(".terminal-link-hover")).toEqual([]);
  });

  test.each([
    {
      name: "何度も出ていれば一番下 (新しい方)",
      lines: ["wrote docs/out.png", "again docs/out.png", ""],
      expected: [{ row: 1, col: 6, cols: 12 }],
    },
    {
      name: "端末の幅で折り返したパスは 2 行にまたがって示す",
      lines: [`${"p".repeat(74)} docs/`, "out.png", ""],
      expected: [
        { row: 0, col: 75, cols: 5 },
        { row: 1, col: 0, cols: 7 },
      ],
    },
    {
      name: "全角の字の後ろはマス目の桁で示す",
      lines: ["保存 docs/out.png", ""],
      expected: [{ row: 0, col: 5, cols: 12 }],
    },
    {
      name: "画面に出ていなければ何もしない",
      lines: ["$ clear", ""],
      expected: [],
    },
  ])("$name", async ({ lines, expected }) => {
    await shelfWithOut();
    fakeState().lines = lines;
    shelfOpen().dispatchEvent(new Event("pointerenter"));
    expect(marks(".terminal-link-hover")).toEqual(expected);
  });

  test("利用者の選択には触らない (示すのは選択でなく強調)", async () => {
    await shelfWithOut();
    const mine = { column: 0, row: 0, length: 5 };
    fakeState().selection = mine;

    shelfOpen().dispatchEvent(new Event("pointerenter"));
    expect(fakeState().selection).toEqual(mine);
    expect(marks(".terminal-link-hover")).toHaveLength(1);
    shelfOpen().dispatchEvent(new Event("pointerleave"));
    expect(fakeState().selection).toEqual(mine);
  });

  test("カーソルが載っている間、棚の見出しの行に実体のパスを出す (浮く札は作らない)", async () => {
    await shelfWithOut();
    // 既定の吹き出し (title) も付けない。
    expect(shelfOpen().hasAttribute("title")).toBe(false);
    const head = shelfEl(handle).querySelector<HTMLElement>(
      ".terminal-image-shelf-head",
    );
    shelfOpen().dispatchEvent(
      new PointerEvent("pointerenter", { pointerType: "mouse" }),
    );
    expect(
      head?.querySelector(".terminal-image-shelf-detail")?.textContent,
    ).toBe("/repo/docs/out.png");
    expect(head?.title).toBe("/repo/docs/out.png");
    expect(document.querySelector("[role=tooltip]")).toBeNull();
    shelfOpen().dispatchEvent(new PointerEvent("pointerleave"));
    expect(
      head?.querySelector<HTMLElement>(".terminal-image-shelf-detail")?.hidden,
    ).toBe(true);
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

    // 画面のパスの問い合わせ (/_agent/paths) も並ぶので、打鍵の送信を探す。
    const sent = requestedUrls.lastIndexOf("/_shell/keys");
    expect(sent).toBeGreaterThanOrEqual(0);
    expect(JSON.parse(requestedBodies[sent] ?? "null")).toEqual({
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
