// 溜め置きの出力を流し直している間、端末の答えを PTY へ送らない。
//
// 落とすと痛いもの:
//
// - 再読み込みのたびに、素のシェルのペインに `1;2c0;276;0c` のような文字が
//   打ち込まれる (tmux が attach したときの問い合わせに、xterm が答え直す)
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

vi.mock("../core/xterm-loader", () => {
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
      Promise.resolve({ Terminal: FakeTerminal, FitAddon: FakeFitAddon }),
  };
});

function fakeTerminal(): { typeByUser(data: string): void } {
  return (globalThis as Record<string, unknown>).__replayTestTerminal as {
    typeByUser(data: string): void;
  };
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
      async () => new Response(JSON.stringify({ images: [], rejected: [] })),
    );
    vi.stubGlobal("fetch", fetchMock);
    outputHandlers = [];
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
      onStatus: () => undefined,
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
});
