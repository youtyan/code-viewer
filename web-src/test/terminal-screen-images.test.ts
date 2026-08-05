// ターミナルの画面に出た画像パスが、帯の 1 枚になるまで。
//
// ここで見るのは繋ぎ込みの側。パスの拾い方そのものは
// terminal-images-core.test.ts、配れるかの判定は agent-route.test.ts が見る。
//
// 落とすと痛いのは 3 つ。
//
// - 同じパスが何度流れても、問い合わせや帯を作り直してはいけない (シェルの
//   中で全画面アプリが動くと、同じ画面が繰り返し届く)
// - 「問い合わせた候補」と「もう帯に出した画像」を 1 つの集合で兼ねると、
//   相対パスの候補は返ってくる相対パスと同じ文字列になるため、自分が入れた
//   候補を「もう出した」と誤読して 1 枚も出せなくなる
// - 応答を待つ間に別のシェルへ切り替わったら、その帯に足してはいけない
//   (古い応答が勝つ再発)
//
// xterm 本体と EventSource は外の境界なので差し替える。差し替えないと
// web/xterm.js の動的 import に失敗して、attach がそこで止まる。

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
import { terminalText } from "../views/terminal/i18n";
import {
  createTerminalScreen,
  type TerminalScreenHandle,
} from "../views/terminal/terminal-screen";

// 端末のバッファ。テストから覗くために外へ出しておく (vi.mock の factory は
// 巻き上げられるので、外の変数を掴めない)。
type FakeTerminalState = {
  /** 画面に見えている行。production はここを読んでパスの位置を決める。 */
  lines: string[];
  cursorY: number;
  inputHandler(data: string): void;
};
const FAKE_STATE_KEY = "__terminalScreenFakeState";

/** マス目 1 つぶんの大きさ。実寸は happy-dom が測れないので決め打ちで返す。 */
const CELL_WIDTH = 10;
const CELL_HEIGHT = 20;

function fakeState(): FakeTerminalState {
  return (globalThis as Record<string, unknown>)[
    FAKE_STATE_KEY
  ] as FakeTerminalState;
}

/** いま画面に重なっている画像。 */
function overlays(handle: TerminalScreenHandle): HTMLAnchorElement[] {
  return [
    ...handle.el.querySelectorAll<HTMLAnchorElement>(".terminal-inline-image"),
  ];
}

vi.mock("../core/xterm-loader", () => {
  const noop = () => undefined;
  const disposable = () => ({ dispose: noop });
  const state: FakeTerminalState = {
    lines: [],
    cursorY: 0,
    inputHandler: () => undefined,
  };
  (globalThis as Record<string, unknown>).__terminalScreenFakeState = state;
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
        getLine: (y: number) => ({
          translateToString: () => state.lines[y] ?? "",
        }),
      },
    };
    constructor(options: Record<string, unknown>) {
      this.options = { ...options };
    }
    /** 描画のたびに呼ぶ手続き。本物と同じく write の後に走らせる。 */
    renderHandlers: Array<(range: { start: number; end: number }) => void> = [];
    onRender = (handler: (range: { start: number; end: number }) => void) => {
      this.renderHandlers.push(handler);
      return { dispose: noop };
    };
    onScroll = disposable;
    scrollLines = noop;
    /**
     * 本物と同じ入れ子を作る。重ねる層はこの .xterm-screen に入るので、
     * ここが実寸を持たないと production 側は何も置けない。happy-dom は
     * レイアウトを持たないので、マス目 80x24 ぶんの実寸を返す。
     */
    open = (parent: HTMLElement) => {
      const root = document.createElement("div");
      root.className = "xterm";
      const screen = document.createElement("div");
      screen.className = "xterm-screen";
      screen.getBoundingClientRect = () =>
        ({ width: 80 * 10, height: 24 * 20 }) as DOMRect;
      root.appendChild(screen);
      parent.appendChild(root);
      this.element = root;
    };
    write = () => {
      for (const handler of this.renderHandlers) {
        handler({ start: 0, end: this.rows - 1 });
      }
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
    proposeDimensions = () => ({ cols: 80, rows: 24 });
  }
  return {
    loadXterm: () =>
      Promise.resolve({
        Terminal: FakeTerminal,
        FitAddon: FakeFitAddon,
      }),
  };
});

type ImageRef = {
  path: string;
  candidate: string;
  name: string;
  url: string;
};

/**
 * サーバが返す 1 枚。取りにいく URL もサーバが決める。candidate は画面に出て
 * いる綴りで、実体のパス (path) とは違う。
 */
const IMAGE: ImageRef = {
  path: "/repo/docs/out.png",
  candidate: "docs/out.png",
  name: "out.png",
  url: "/_agent/image?path=%2Frepo%2Fdocs%2Fout.png",
};

/** 開いた購読。テストから出力を流し込むために持っておく。 */
type OpenedSource = {
  url: string;
  emitOutput(data: string): void;
};

let sources: OpenedSource[] = [];
let requestedUrls: string[] = [];
let requestedBodies: Array<string | null> = [];
let statusMessages: Array<string | null> = [];
let failingUrl: string | null = null;
/** /_agent/images が返す画像。 */
let respond: () => ImageRef[];
/** 保留にした応答を返す関数。世代照合を見るテストで使う。 */
let pendingResponses: Array<() => void> = [];
let holdResponses = false;

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
      requestedUrls.push(String(input));
      requestedBodies.push(typeof init?.body === "string" ? init.body : null);
      if (String(input) === failingUrl) {
        return Promise.resolve(
          new Response('{"errors":[{"code":"E1"},{"code":"E2"}]}', {
            status: 503,
            statusText: "Service Unavailable",
          }),
        );
      }
      const body = { images: respond() };
      const res = { ok: true, status: 200, json: () => Promise.resolve(body) };
      if (!holdResponses) return Promise.resolve(res);
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

function bandNames(handle: TerminalScreenHandle): string[] {
  return [...handle.el.querySelectorAll(".terminal-attachment-name")].map(
    (el) => el.textContent ?? "",
  );
}

function imageRequests(): string[] {
  return requestedUrls.filter((url) => url.startsWith("/_agent/images"));
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
  respond = () => [IMAGE];
  const state = fakeState();
  // 画面に出ている行。production はここを読んで、どの行の上に重ねるかを決める。
  state.lines = ["$ make chart", "wrote docs/out.png", ""];
  state.cursorY = 2;
  installFakes();
  handle = createTerminalScreen({
    trackLoad: (promise) => promise,
    actionHeaders: () => ({}),
    getText: () => terminalText("en"),
    onStatus: (message) => statusMessages.push(message),
    onTargetGone: () => undefined,
    getFontSize: () => 14,
  });
  document.body.append(handle.el);
});

afterEach(() => {
  handle.dispose();
  document.body.innerHTML = "";
});

async function attachShell(session: ShellSession): Promise<OpenedSource> {
  await handle.attach(session);
  const source = sources[sources.length - 1];
  if (!source) throw new Error("no subscription opened");
  return source;
}

describe("画面に出た画像パス", () => {
  test("パスが出ている行のすぐ下に画像を重ねる", async () => {
    const source = await attachShell(SHELL);
    source.emitOutput("wrote docs/out.png\n");
    await flush();

    expect(imageRequests()).toEqual(["/_agent/images?path=docs%2Fout.png"]);
    const [overlay] = overlays(handle);
    // 画面の 2 行目 (0 始まりで 1) にパスがある。その 1 つ下 (行 2)、パスが
    // 始まる桁 (6) から重ねる。
    expect(overlay?.style.top).toBe(`${2 * CELL_HEIGHT}px`);
    expect(overlay?.style.left).toBe(`${6 * CELL_WIDTH}px`);
    const picture = overlay?.querySelector("img");
    // 取りにいく先はサーバが決める。こちらで URL を組み立てない。
    expect(picture?.getAttribute("src")).toBe(IMAGE.url);
    expect(picture?.getAttribute("alt")).toBe("out.png");
    // 帯にも 1 枚残す。重ねたぶんはパスが流れると消えるので、後から開き直す
    // 経路が要る。
    expect(bandNames(handle)).toEqual(["out.png"]);
  });

  test("同じ画面が何度届いても問い合わせも重ねも作り直さない", async () => {
    // tmux は 120ms ごとに全画面を送ってくる。毎回作り直すと点滅する。
    const source = await attachShell(SHELL);
    source.emitOutput("wrote docs/out.png\n");
    await flush();
    const first = overlays(handle)[0];
    for (let i = 0; i < 5; i += 1) {
      source.emitOutput("wrote docs/out.png\n");
      await flush();
    }

    expect(imageRequests()).toHaveLength(1);
    // 要素は使い回す。作り直すと画像が読み込み直しになって点滅する。
    expect(overlays(handle)).toHaveLength(1);
    expect(overlays(handle)[0]).toBe(first);
  });

  test("パスが画面から消えたら重ねたものも消える", async () => {
    const source = await attachShell(SHELL);
    source.emitOutput("wrote docs/out.png\n");
    await flush();
    expect(overlays(handle)).toHaveLength(1);

    // 画面が流れてパスが見えなくなった。
    fakeState().lines = ["$ make chart", "done", ""];
    source.emitOutput("done\n");
    await flush();

    expect(overlays(handle)).toEqual([]);
    // 重ねたぶんは消えるが、帯には残る。出力が流れる端末では数秒で見え
    // なくなるので、残らないと開き直せない。
    expect(bandNames(handle)).toEqual(["out.png"]);
  });

  test("画像パスが無い画面では問い合わせない", async () => {
    fakeState().lines = ["$ ls -la", "total 0", ""];
    const source = await attachShell(SHELL);
    source.emitOutput("$ ls -la\ntotal 0\n");
    await flush();

    expect(imageRequests()).toEqual([]);
    expect(overlays(handle)).toEqual([]);
  });

  test("別のシェルへ切り替えたら重ねたものは消え、また拾い直せる", async () => {
    const first = await attachShell(SHELL);
    first.emitOutput("wrote docs/out.png\n");
    await flush();
    expect(overlays(handle)).toHaveLength(1);

    const second = await attachShell(OTHER_SHELL);
    expect(overlays(handle)).toEqual([]);
    second.emitOutput("wrote docs/out.png\n");
    await flush();

    expect(imageRequests()).toHaveLength(2);
    expect(overlays(handle)).toHaveLength(1);
  });

  test("帯のサムネイルを押すと拡大表示が開く", async () => {
    const source = await attachShell(SHELL);
    source.emitOutput("wrote docs/out.png\n");
    await flush();

    handle.el
      .querySelector<HTMLButtonElement>(".terminal-attachment-open")
      ?.click();
    const box = document.querySelector(".terminal-lightbox");
    expect(box?.querySelector("img")?.getAttribute("src")).toBe(IMAGE.url);
    box?.querySelector<HTMLButtonElement>("button:last-of-type")?.click();
    expect(document.querySelector(".terminal-lightbox")).toBeNull();
  });

  test("重ねた画像を押すと拡大表示が開く", async () => {
    const source = await attachShell(SHELL);
    source.emitOutput("wrote docs/out.png\n");
    await flush();

    const overlay = overlays(handle)[0];
    overlay?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const box = document.querySelector(".terminal-lightbox");
    expect(box?.querySelector("img")?.getAttribute("src")).toBe(IMAGE.url);
    box?.querySelector<HTMLButtonElement>("button:last-of-type")?.click();
  });

  test("同じシェルへ戻ったら、覚えていた画像を帯に戻す", async () => {
    // パネルは Terminal と Tools がタブなので、切り替えるたびに detach される。
    // 覚えていないと、パスが流れた後は二度と開けない。
    const source = await attachShell(SHELL);
    source.emitOutput("wrote docs/out.png\n");
    await flush();
    expect(bandNames(handle)).toEqual(["out.png"]);

    handle.detach();
    expect(bandNames(handle)).toEqual([]);

    await attachShell(SHELL);
    expect(bandNames(handle)).toEqual(["out.png"]);
    // 覚えている綴りは聞き直さない。
    expect(imageRequests()).toHaveLength(1);
  });

  test("覚えていた画像が読めなければ、帯から外して忘れる", async () => {
    // 実体が消えた画像を、開くたびに壊れた枠で並べない。
    const source = await attachShell(SHELL);
    source.emitOutput("wrote docs/out.png\n");
    await flush();

    const picture = handle.el.querySelector(".terminal-attachment img");
    picture?.dispatchEvent(new Event("error"));
    expect(bandNames(handle)).toEqual([]);

    // 別のシェルを経由して戻ってきても、外したものは戻らない。
    await attachShell(OTHER_SHELL);
    await attachShell(SHELL);
    expect(bandNames(handle)).toEqual([]);
  });

  test("応答を待つ間に切り替わったら、新しい画面には重ねない", async () => {
    // 古い応答が後から勝って、別のシェルの画面に前のシェルの画像が出るのを
    // 防ぐ。
    holdResponses = true;
    const source = await attachShell(SHELL);
    source.emitOutput("wrote docs/out.png\n");
    await flush();
    expect(imageRequests()).toHaveLength(1);

    await attachShell(OTHER_SHELL);
    for (const resolve of pendingResponses) resolve();
    await flush();

    expect(overlays(handle)).toEqual([]);
    expect(bandNames(handle)).toEqual([]);
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
