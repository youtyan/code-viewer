// 溜め置きの出力を流し直している間、端末の答えを PTY へ送らない。
//
// 落とすと痛いもの:
//
// - 再読み込みのたびに、素のシェルのペインに `1;2c0;276;0c` のような文字が
//   打ち込まれる (tmux が attach したときの問い合わせに、xterm が答え直す)
// - 流し直しを解釈している間に人が打った文字まで捨てると、打っても入らない
//   端末になる (流し直しは最大 20 万文字ある)
// - 送信が返らない間を黙っていると、打っても入らない理由が画面から分からない
//
// 前半は本物の xterm で「答えは書いたものを解釈している最中に出る」ことを
// 確かめる。回避はこの順番に頼っているので、上流が変わればここが落ちる。
// 後半は端末の画面が流し直しの印を読んで答えを捨てることを、xterm を差し
// 替えて確かめる。本物の画面での確認 (素のシェルのペインで再読み込みを
// 繰り返す) は作業報告の記録。

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

// 流しはチャンネルごとの偽の EventSource にする (_fake-live.ts)。
vi.mock("../views/shell/live-hub", () => import("./_fake-live"));

import type { ShellSession } from "../core/shell";
import { terminalText } from "../views/terminal/i18n";
import {
  createTerminalScreen,
  type TerminalScreenHandle,
} from "../views/terminal/terminal-screen";

beforeAll(() => {
  GlobalRegistrator.register();
});

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

const DA_QUERY = "\u001b[c";
const DA_ANSWER = "\u001b[?1;2c";

describe("xterm の答えが出る時点 (本物の xterm)", () => {
  test("問い合わせへの答えは、書いたものの解釈が終わる前に onData に出る", async () => {
    const { Terminal } = await import("@xterm/xterm");
    const term = new Terminal({ cols: 80, rows: 24 });
    const events: string[] = [];
    term.onData((data) => events.push(`data ${JSON.stringify(data)}`));

    await new Promise<void>((resolve) =>
      term.write(DA_QUERY, () => {
        events.push("parsed");
        resolve();
      }),
    );

    expect(events).toEqual([`data ${JSON.stringify(DA_ANSWER)}`, "parsed"]);
    term.dispose();
  });
});

// ---- 流し直しの印 (xterm を差し替える) ----

vi.mock("../core/xterm-loader", async () => {
  const { FakeWebglAddon } = await import("./_fake-dom");
  const noop = () => undefined;
  const disposable = () => ({ dispose: noop });
  /**
   * 書いたものに DA の問い合わせがあれば、本物と同じく解釈の最中に答えを
   * onData へ出し、解釈が終わってから callback を呼ぶ。
   */
  class FakeTerminal {
    cols = 80;
    rows = 24;
    element: HTMLElement | undefined;
    textarea: HTMLTextAreaElement | undefined;
    options: Record<string, unknown> = {};
    buffer = {
      active: { viewportY: 0, baseY: 0, cursorY: 0, getLine: () => undefined },
    };
    private dataListeners: Array<(data: string) => void> = [];
    registerLinkProvider = () => ({ dispose: noop });
    open = (parent: HTMLElement) => {
      const root = document.createElement("div");
      parent.appendChild(root);
      this.element = root;
    };
    write = (data: string, callback?: () => void) => {
      setTimeout(() => {
        if (data.includes("\u001b[c")) {
          for (const listener of this.dataListeners) listener("\u001b[?1;2c");
        }
        callback?.();
      }, 0);
    };
    /** 利用者の打鍵 (xterm が onData に出すもう 1 つの出所)。 */
    typeByUser(data: string) {
      for (const listener of this.dataListeners) listener(data);
    }
    resize = (cols: number, rows: number) => {
      this.cols = cols;
      this.rows = rows;
    };
    reset = noop;
    focus = noop;
    blur = noop;
    clear = noop;
    dispose = noop;
    loadAddon = (addon: { activate(term: FakeTerminal): void }) => {
      addon.activate(this);
    };
    onData = (listener: (data: string) => void) => {
      this.dataListeners.push(listener);
      (globalThis as Record<string, unknown>).__replayTestTerminal = this;
      return { dispose: noop };
    };
    onResize = disposable;
    onRender = disposable;
    onScroll = disposable;
    scrollLines = noop;
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
        WebglAddon: FakeWebglAddon,
      }),
  };
});

function fakeTerminal(): {
  element: HTMLElement;
  typeByUser(data: string): void;
} {
  return (globalThis as Record<string, unknown>).__replayTestTerminal as {
    element: HTMLElement;
    typeByUser(data: string): void;
  };
}

/**
 * 人がキーを打つ: 本物の xterm は、ブラウザが配っている keydown の最中に打鍵を
 * onData へ出す。happy-dom は isTrusted を持たないので、ブラウザの印を付ける。
 */
function typeDuringKeydown(data: string): void {
  const term = fakeTerminal();
  const emit = () => term.typeByUser(data);
  term.element.addEventListener("keydown", emit);
  const event = new KeyboardEvent("keydown", { bubbles: true });
  Object.defineProperty(event, "isTrusted", { value: true });
  term.element.dispatchEvent(event);
  term.element.removeEventListener("keydown", emit);
}

const SESSION: ShellSession = {
  id: "shell-replay",
  command: "/bin/sh",
  cwd: "/repo",
  createdAt: "2026-09-01T00:00:00.000Z",
  cols: 80,
  rows: 24,
  exited: false,
  exitCode: null,
  tty: "/dev/ttys001",
};

/** 画面の解釈 (setTimeout 0) と、送信の往復が済むまで待つ。 */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 20));
}

describe("流し直しの印を読んで、端末の答えを送るか決める", () => {
  let screen: TerminalScreenHandle;
  let host: HTMLElement;
  let statuses: Array<string | null>;
  let outputHandlers: Array<(event: MessageEvent<string>) => void> = [];
  let fetchMock: ReturnType<typeof vi.fn>;

  /** /_shell/keys に送られた入力を順に返す。 */
  function sentKeys(): string[] {
    return fetchMock.mock.calls
      .filter(([url]) => String(url) === "/_shell/keys")
      .map(([, init]) => JSON.parse(String(init?.body)).data as string);
  }

  function emitOutput(payload: Record<string, unknown>): void {
    for (const handler of outputHandlers) {
      handler({ data: JSON.stringify(payload) } as MessageEvent<string>);
    }
  }

  beforeEach(async () => {
    fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ images: [], rejected: [], candidates: [] }),
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    outputHandlers = [];
    statuses = [];
    vi.stubGlobal(
      "EventSource",
      class {
        static readonly CLOSED = 2;
        readyState = 1;
        onerror: (() => void) | null = null;
        addEventListener(
          type: string,
          handler: (event: MessageEvent<string>) => void,
        ): void {
          if (type === "output") outputHandlers.push(handler);
        }
        close(): void {
          this.readyState = 2;
        }
      },
    );
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe = () => undefined;
        unobserve = () => undefined;
        disconnect = () => undefined;
      },
    );
    host = document.createElement("div");
    document.body.appendChild(host);
    screen = createTerminalScreen({
      getText: () => terminalText("en"),
      getFontSize: () => 13,
      actionHeaders: () => ({}),
      trackLoad: (promise) => promise,
      onStatus: (message, overlay) =>
        statuses.push(overlay ? `overlay: ${message}` : message),
      onTargetGone: () => undefined,
      onShellExited: () => undefined,
      tmuxWindow: () => null,
      onTmuxWindowStale: () => undefined,
      isImageShelfCollapsed: () => false,
      setImageShelfCollapsed: () => undefined,
    });
    host.appendChild(screen.el);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, 640, 400),
    );
    await screen.attach(SESSION);
  });

  afterEach(() => {
    screen.dispose();
    host.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  test.each([
    {
      name: "流し直し (前の購読者に渡った分) の問い合わせには答えない",
      payload: { data: `prompt${DA_QUERY}`, replay: true },
      expected: [],
    },
    {
      name: "まだ誰にも渡っていない分の問い合わせには答える",
      payload: { data: `prompt${DA_QUERY}` },
      expected: [DA_ANSWER],
    },
    {
      name: "印が false なら答える",
      payload: { data: `prompt${DA_QUERY}`, replay: false },
      expected: [DA_ANSWER],
    },
  ])("$name", async ({ payload, expected }) => {
    emitOutput(payload);
    await settle();

    expect(sentKeys()).toEqual(expected);
  });

  test("流し直しを解釈し終えた後の問い合わせと打鍵は送る", async () => {
    emitOutput({ data: `prompt${DA_QUERY}`, replay: true });
    await settle();

    emitOutput({ data: DA_QUERY });
    await settle();
    fakeTerminal().typeByUser("ls\r");
    await settle();

    expect(sentKeys()).toEqual([DA_ANSWER, "ls\r"]);
  });

  test("流し直しを解釈している間に人が打った文字は送り、その間の答えは送らない", async () => {
    emitOutput({ data: `prompt${DA_QUERY}`, replay: true });
    typeDuringKeydown("a");
    await settle();

    expect(sentKeys()).toEqual(["a"]);
  });

  test("送信が 1 秒を過ぎても返らなければ送信待ちを出し、返ったら消して、かかった時間を残す", async () => {
    vi.useFakeTimers();
    const warned = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    let answer: () => void = () => undefined;
    fetchMock.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          answer = () => resolve(new Response(JSON.stringify({ ok: true })));
        }),
    );
    statuses.length = 0;
    typeDuringKeydown("a");

    await vi.advanceTimersByTimeAsync(999);
    expect(statuses).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    // 端末の下端に重ねる (行を足すと端末が縮み、tmux が描き直す)。
    expect(statuses).toEqual(["overlay: Waiting to send input…"]);
    // 動き続ける画面の出力で消さない。
    emitOutput({ data: "spinner" });
    await vi.advanceTimersByTimeAsync(1500);
    answer();
    await vi.advanceTimersByTimeAsync(0);

    expect(statuses).toEqual(["overlay: Waiting to send input…", null]);
    expect(warned.mock.calls).toEqual([
      ["[code-viewer] the shell input request for shell-replay took 2500ms"],
    ]);
  });
});
