// 端末を WebGL で描くこと、使えないときは DOM の描画に戻して理由を出すこと
// (views/terminal/terminal-renderer.ts と、terminal-screen.ts での使い方)。
//
// 落とすと痛いもの:
//
// - DOM の描画のまま: tmux のペインの境目の線 (─│┼) がフォントの字のまま並び、
//   行ごとに途切れて波打つ (利用者がほかの端末と比べて気付いた)
// - WebGL が使えない環境で端末が開けない / 黙って DOM に戻る
// - context を失った後も WebGL の addon を持ち続け、画面が描かれない
//
// 本物の WebGL は happy-dom に無いので、addon は差し替える。線がつながることは
// 実画面で撮り比べる (作業報告)。

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
import type { XtermTerminal } from "../core/xterm-loader";
import { terminalText } from "../views/terminal/i18n";

/** 差し替えた WebGL の addon の振る舞いと、起きたこと。 */
type FakeWebglState = {
  /** throw: 読み込むと失敗する (WebGL2 が無い環境)。 */
  mode: "ok" | "throw";
  loaded: number;
  disposed: number;
  /** 最後に読み込んだ addon の context を失わせる。 */
  loseContext: (() => void) | null;
  /** 最後に作った端末に渡したオプション。 */
  options: Record<string, unknown> | null;
};
// vi.mock の factory は巻き上げられ、読み込み直すたびに呼ばれ直すので、状態は
// vi.hoisted で 1 つだけ作る。
const state = vi.hoisted(
  (): FakeWebglState => ({
    mode: "ok",
    loaded: 0,
    disposed: 0,
    loseContext: null,
    options: null,
  }),
);

const noop = () => undefined;

vi.mock("../core/xterm-loader", () => {
  const noop = () => undefined;
  const disposable = () => ({ dispose: noop });
  class FakeWebglAddon {
    private lost: Array<() => void> = [];
    activate() {
      if (state.mode === "throw") throw new Error("WebGL2 not supported");
      state.loaded += 1;
      state.loseContext = () => {
        for (const handler of this.lost) handler();
      };
    }
    dispose() {
      state.disposed += 1;
    }
    onContextLoss(handler: () => void) {
      this.lost.push(handler);
      return {
        dispose: () => {
          this.lost = this.lost.filter((item) => item !== handler);
        },
      };
    }
  }
  class FakeTerminal {
    cols = 80;
    rows = 24;
    element: HTMLElement | undefined;
    options: Record<string, unknown>;
    buffer = {
      active: {
        viewportY: 0,
        baseY: 0,
        cursorY: 0,
        length: 0,
        getLine: () => undefined,
      },
    };
    modes = { applicationCursorKeysMode: false };
    constructor(options: Record<string, unknown>) {
      this.options = { ...options };
      state.options = this.options;
    }
    loadAddon = (addon: { activate(term: FakeTerminal): void }) => {
      addon.activate(this);
    };
    open = (parent: HTMLElement) => {
      const root = document.createElement("div");
      root.className = "xterm";
      const screen = document.createElement("div");
      screen.className = "xterm-screen";
      root.append(screen);
      parent.append(root);
      this.element = root;
    };
    registerLinkProvider = disposable;
    onResize = disposable;
    onRender = disposable;
    onScroll = disposable;
    onData = disposable;
    attachCustomKeyEventHandler = noop;
    write = noop;
    reset = noop;
    focus = noop;
    dispose = noop;
    resize = noop;
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

beforeAll(() => {
  GlobalRegistrator.register({ url: "http://localhost/" });
});

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

let warnings: unknown[][];

beforeEach(() => {
  state.mode = "ok";
  state.loaded = 0;
  state.disposed = 0;
  state.loseContext = null;
  state.options = null;
  warnings = [];
  vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
    warnings.push(args);
  });
  // 同じ理由はページで 1 回だけ出す。テストごとに読み込み直して数え直す。
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** 描画の切り替えだけを見るための端末。loadAddon で addon を起こす。 */
function bareTerminal(): XtermTerminal {
  return {
    loadAddon: (addon: { activate(term: unknown): void }) =>
      addon.activate(null),
  } as unknown as XtermTerminal;
}

async function loadRenderer() {
  const { useWebglRenderer } = await import(
    "../views/terminal/terminal-renderer"
  );
  const { loadXterm } = await import("../core/xterm-loader");
  const api = await loadXterm();
  if (!api) throw new Error("fake xterm was not loaded");
  return { useWebglRenderer, api };
}

describe("useWebglRenderer", () => {
  test("WebGL が使えれば WebGL で描き、何も出さない", async () => {
    const { useWebglRenderer, api } = await loadRenderer();
    expect(useWebglRenderer(bareTerminal(), api)).toBe("webgl");
    expect(state.loaded).toBe(1);
    expect(warnings).toEqual([]);
  });

  test("使えなければ DOM のまま、理由 (元のエラーごと) を 1 回だけ出す", async () => {
    state.mode = "throw";
    const { useWebglRenderer, api } = await loadRenderer();
    const fallbacks: string[] = [];
    expect(
      useWebglRenderer(bareTerminal(), api, () => fallbacks.push("dom")),
    ).toBe("dom");
    // 2 つ目の端末 (右の面) も同じ理由なら、もう出さない。
    expect(useWebglRenderer(bareTerminal(), api)).toBe("dom");
    expect(fallbacks).toEqual(["dom"]);
    expect(warnings).toHaveLength(1);
    expect(String(warnings[0]?.[0])).toContain("WebGL renderer is unavailable");
    expect((warnings[0]?.[1] as Error).message).toBe("WebGL2 not supported");
  });

  test("context を失ったら addon を外して DOM に戻し、理由を出す", async () => {
    const { useWebglRenderer, api } = await loadRenderer();
    const fallbacks: string[] = [];
    useWebglRenderer(bareTerminal(), api, () => fallbacks.push("dom"));
    state.loseContext?.();
    expect(state.disposed).toBe(1);
    expect(fallbacks).toEqual(["dom"]);
    expect(warnings).toHaveLength(1);
    expect(String(warnings[0]?.[0])).toContain("WebGL context was lost");
    // 同じ addon の知らせがまた来ても、もう一度外さない。
    state.loseContext?.();
    expect(state.disposed).toBe(1);
  });
});

const SESSION: ShellSession = {
  id: "shell-renderer",
  command: "/bin/sh",
  cwd: "/repo",
  createdAt: "2026-09-01T00:00:00.000Z",
  cols: 80,
  rows: 24,
  exited: false,
  exitCode: null,
  tty: "",
};

describe("ターミナルの画面の描画", () => {
  async function attachScreen() {
    Object.defineProperty(globalThis, "EventSource", {
      configurable: true,
      value: class {
        static readonly CLOSED = 2;
        addEventListener = noop;
        close = noop;
      },
    });
    Object.defineProperty(globalThis, "ResizeObserver", {
      configurable: true,
      value: class {
        observe = noop;
        disconnect = noop;
      },
    });
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: () =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              images: [],
              rejected: [],
              base: { source: "shell", cwd: "/repo" },
              pane: null,
              candidates: [],
              lines: 0,
            }),
          ),
        ),
    });
    const { createTerminalScreen } = await import(
      "../views/terminal/terminal-screen"
    );
    const screen = createTerminalScreen({
      trackLoad: (promise) => promise,
      actionHeaders: () => ({}),
      getText: () => terminalText("en"),
      onStatus: () => undefined,
      onTargetGone: () => undefined,
      onShellExited: () => undefined,
      tmuxWindow: () => null,
      onTmuxWindowStale: () => undefined,
      getFontSize: () => 14,
      isImageShelfCollapsed: () => false,
      setImageShelfCollapsed: () => undefined,
    });
    document.body.append(screen.el);
    await screen.attach(SESSION);
    const box = screen.el.querySelector<HTMLElement>(".terminal-screen");
    if (!box) throw new Error("terminal screen was not mounted");
    return { screen, box };
  }

  test("WebGL で描き、枠の線を xterm に描かせる", async () => {
    const { screen, box } = await attachScreen();
    expect(box.dataset.renderer).toBe("webgl");
    expect(state.options?.customGlyphs).toBe(true);
    screen.dispose();
  });

  test("WebGL が使えなくても端末は開き、DOM で描く", async () => {
    state.mode = "throw";
    const { screen, box } = await attachScreen();
    expect(box.dataset.renderer).toBe("dom");
    expect(box.querySelector(".xterm-screen")).not.toBeNull();
    expect(warnings).toHaveLength(1);
    screen.dispose();
  });

  test("context を失ったら DOM の描画に戻ったことが画面に残る", async () => {
    const { screen, box } = await attachScreen();
    state.loseContext?.();
    expect(box.dataset.renderer).toBe("dom");
    screen.dispose();
  });
});
