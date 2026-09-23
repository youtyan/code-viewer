// ターミナルの画面が、tmux のウインドウの外側 (tmux が点で埋める所) を覆う
// こと、シェルの終わりを呼び出し側へ渡すこと (views/terminal/terminal-screen.ts)。
//
// 落とすと痛いもの:
//
// - 同じセッションを小さい端末でも開くと、アプリの端末の下と右に点の帯が出る
// - 大きさを変えた直後の古い値で、ずれた所 (エージェントの画面) を覆う
// - 覆いがクリック・選択・ホイールを奪う
// - 映していたシェルが終わってもタブが残る (前面のタブは流れの「終わった」で閉じる)
//
// 覆う範囲そのものの表は terminal-tmux-cover.test.ts。ここは、届いた大きさを
// いつ描き、いつ隠すか。xterm は差し替える (マス目の寸法を決めて渡す)。

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
import type { ShellSession } from "../core/shell";
import type { TmuxClientWindow } from "../core/tmux";
import { terminalText } from "../views/terminal/i18n";
import {
  createTerminalScreen,
  type TerminalScreenHandle,
} from "../views/terminal/terminal-screen";

beforeAll(() => {
  GlobalRegistrator.register();
  const style = document.createElement("style");
  style.textContent = readFileSync("web/style.css", "utf8");
  document.head.append(style);
});

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

vi.mock("../core/xterm-loader", () => {
  const noop = () => undefined;
  const disposable = () => ({ dispose: noop });
  class FakeTerminal {
    cols = 80;
    rows = 24;
    element: HTMLElement | undefined;
    options: Record<string, unknown> = {};
    buffer = {
      active: { viewportY: 0, baseY: 0, cursorY: 0, getLine: () => undefined },
    };
    modes = { applicationCursorKeysMode: false };
    resizeListeners: Array<() => void> = [];
    registerLinkProvider = () => ({ dispose: noop });
    open = (parent: HTMLElement) => {
      const root = document.createElement("div");
      root.className = "xterm";
      const screen = document.createElement("div");
      screen.className = "xterm-screen";
      // マス目は 8×16 px。xterm は画面の要素の幅・高さを桁数・行数ぶんに決める。
      Object.defineProperty(screen, "clientWidth", {
        get: () => this.cols * 8,
      });
      Object.defineProperty(screen, "clientHeight", {
        get: () => this.rows * 16,
      });
      root.append(screen);
      parent.append(root);
      this.element = root;
    };
    write = noop;
    resize = (cols: number, rows: number) => {
      this.cols = cols;
      this.rows = rows;
      for (const listener of this.resizeListeners) listener();
    };
    reset = noop;
    focus = noop;
    blur = noop;
    dispose = noop;
    loadAddon = (addon: { activate(term: FakeTerminal): void }) => {
      addon.activate(this);
    };
    onData = disposable;
    onResize = (listener: () => void) => {
      this.resizeListeners.push(listener);
      return { dispose: noop };
    };
    attachCustomKeyEventHandler = noop;
  }
  class FakeFitAddon {
    private term: FakeTerminal | null = null;
    activate(term: FakeTerminal) {
      this.term = term;
    }
    dispose = noop;
    /** 箱に 132x48 が入るとする (砂場の S1 と同じアプリの端末)。 */
    fit() {
      this.term?.resize(132, 48);
    }
    proposeDimensions = () => ({ cols: 132, rows: 48 });
  }
  return {
    loadXterm: () =>
      Promise.resolve({ Terminal: FakeTerminal, FitAddon: FakeFitAddon }),
  };
});

const SESSION: ShellSession = {
  id: "shell-cover",
  command: "/bin/sh",
  cwd: "/repo",
  createdAt: "2026-09-01T00:00:00.000Z",
  cols: 132,
  rows: 48,
  exited: false,
  exitCode: null,
  tty: "/dev/ttys001",
};

/** 132x48 の端末に、別の端末 (200x30) に合わせた 132x29 のウインドウ。 */
const SHARED: TmuxClientWindow = {
  clientCols: 132,
  clientRows: 48,
  windowCols: 132,
  windowRows: 29,
  statusLines: 1,
  statusAt: "bottom",
  sessionClients: 2,
};

describe("tmux のウインドウの外側の覆い", () => {
  let screen: TerminalScreenHandle;
  let host: HTMLElement;
  let window: TmuxClientWindow | null;
  let exited: string[];
  let streamHandlers: Map<string, (event: MessageEvent<string>) => void>;

  beforeEach(() => {
    window = null;
    exited = [];
    streamHandlers = new Map();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response(JSON.stringify({ images: [], rejected: [] })),
      ),
    );
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
          streamHandlers.set(type, handler);
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
    document.body.append(host);
    screen = createTerminalScreen({
      getText: () => terminalText("en"),
      getFontSize: () => 13,
      actionHeaders: () => ({}),
      trackLoad: (promise) => promise,
      onStatus: () => undefined,
      onTargetGone: () => undefined,
      onShellExited: (session) => exited.push(session.id),
      tmuxWindow: () => window,
      onTmuxWindowStale: () => undefined,
      isImageShelfCollapsed: () => false,
      setImageShelfCollapsed: () => undefined,
    });
    host.append(screen.el);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, 1056, 768),
    );
  });

  afterEach(() => {
    screen.dispose();
    host.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function cover() {
    const el = host.querySelector<HTMLElement>(".terminal-tmux-cover");
    return {
      shown:
        el !== null && !el.hidden && getComputedStyle(el).display !== "none",
      inScreen: el?.parentElement?.className ?? null,
      cell: [
        el?.style.getPropertyValue("--tmux-cell-w"),
        el?.style.getPropertyValue("--tmux-cell-h"),
      ],
      parts: [
        ...(el?.querySelectorAll<HTMLElement>(".terminal-tmux-cover-part") ??
          []),
      ].map((part) => ({
        at: ["--cover-top", "--cover-left", "--cover-rows", "--cover-cols"].map(
          (name) => part.style.getPropertyValue(name),
        ),
        message: part.textContent,
      })),
    };
  }

  test("別の端末に合わせて小さいウインドウの外側を覆い、理由を 1 行出す", async () => {
    window = SHARED;
    await screen.attach(SESSION);
    expect(cover()).toEqual({
      shown: true,
      inScreen: "xterm-screen",
      cell: ["8px", "16px"],
      parts: [
        {
          at: ["29", "0", "18", "132"],
          message:
            "The tmux window is 132×29 (sized to another terminal attached to the same session).",
        },
      ],
    });
  });

  test("覆いは操作を下の端末へ通し、箱の流れに入らない (style.css)", async () => {
    window = SHARED;
    await screen.attach(SESSION);
    const el = host.querySelector<HTMLElement>(".terminal-tmux-cover");
    const part = host.querySelector<HTMLElement>(".terminal-tmux-cover-part");
    expect([
      el && getComputedStyle(el).pointerEvents,
      el && getComputedStyle(el).position,
      part && getComputedStyle(part).position,
    ]).toEqual(["none", "absolute", "absolute"]);
  });

  test.each([
    {
      name: "アプリだけが繋がっている (覆う所が無い)",
      window: { ...SHARED, windowRows: 47, sessionClients: 1 },
    },
    {
      name: "届いた大きさが今の端末と合わない (大きさを変えた直後)",
      window: { ...SHARED, clientCols: 120, clientRows: 40 },
    },
    { name: "tmux が動いていない", window: null },
  ])("$name: 何も出さない", async ({ window: next }) => {
    window = next;
    await screen.attach(SESSION);
    expect(cover().shown).toBe(false);
  });

  test("届いた大きさが変われば描き直し、別の端末が外れたら消す", async () => {
    await screen.attach(SESSION);
    const shown = [cover().shown];
    window = SHARED;
    screen.updateTmuxCover();
    shown.push(cover().shown);
    window = { ...SHARED, windowRows: 47, sessionClients: 1 };
    screen.updateTmuxCover();
    shown.push(cover().shown);
    expect(shown).toEqual([false, true, false]);
  });

  test("映しているシェルを外したら覆いも消す", async () => {
    window = SHARED;
    await screen.attach(SESSION);
    screen.detach();
    expect(cover().shown).toBe(false);
  });

  test("映しているシェルが終わったら、呼び出し側へ渡す (タブを閉じてもらう)", async () => {
    await screen.attach(SESSION);
    streamHandlers.get("exited")?.({
      data: JSON.stringify({ exitCode: 0 }),
    } as MessageEvent<string>);
    expect(exited).toEqual(["shell-cover"]);
  });
});
