// 端末の操作札 (電話・指の画面の Esc・Ctrl+C・↑↓・Enter) は、打鍵と同じ経路
// (/_shell/keys) で送り、矢印は端末のカーソルキーのモード (DECCKM) に合わせる。
// 本物の画面での確認 (tmux の中の偽エージェントに届いたバイト列) は作業報告の記録。
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
import type { TerminalSoftKey } from "../core/mobile-layout";
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

vi.mock("../core/xterm-loader", () => {
  const noop = () => undefined;
  const disposable = () => ({ dispose: noop });
  class FakeTerminal {
    cols = 80;
    rows = 24;
    element: HTMLElement | undefined;
    textarea: HTMLTextAreaElement | undefined;
    options: Record<string, unknown> = {};
    /** 端末のモード。テストがカーソルキーのモードを切り替える。 */
    modes = { applicationCursorKeysMode: false };
    buffer = {
      active: { viewportY: 0, baseY: 0, cursorY: 0, getLine: () => undefined },
    };
    registerLinkProvider = () => ({ dispose: noop });
    open = (parent: HTMLElement) => {
      const root = document.createElement("div");
      parent.appendChild(root);
      this.element = root;
      (globalThis as Record<string, unknown>).__softKeyTestTerminal = this;
    };
    write = (_data: string, callback?: () => void) => {
      callback?.();
    };
    resize = noop;
    reset = noop;
    focus = noop;
    blur = noop;
    clear = noop;
    dispose = noop;
    loadAddon = (addon: { activate(term: FakeTerminal): void }) => {
      addon.activate(this);
    };
    onData = disposable;
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

function fakeModes(): { applicationCursorKeysMode: boolean } {
  return (
    (globalThis as Record<string, unknown>).__softKeyTestTerminal as {
      modes: { applicationCursorKeysMode: boolean };
    }
  ).modes;
}

const SESSION: ShellSession = {
  id: "shell-soft-keys",
  command: "/bin/sh",
  cwd: "/repo",
  createdAt: "2026-09-01T00:00:00.000Z",
  cols: 80,
  rows: 24,
  exited: false,
  exitCode: null,
  tty: "/dev/ttys001",
};

/** 送信の往復が済むまで待つ。 */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 20));
}

describe("端末の操作札", () => {
  let screen: TerminalScreenHandle;
  let host: HTMLElement;
  let fetchMock: ReturnType<typeof vi.fn>;

  function sentKeys(): string[] {
    return fetchMock.mock.calls
      .filter(([url]) => String(url) === "/_shell/keys")
      .map(([, init]) => JSON.parse(String(init?.body)).data as string);
  }

  beforeEach(async () => {
    fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ images: [], rejected: [] })),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal(
      "EventSource",
      class {
        static readonly CLOSED = 2;
        readyState = 1;
        onerror: (() => void) | null = null;
        addEventListener = () => undefined;
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

  test.each<{
    name: string;
    keys: TerminalSoftKey[];
    app: boolean;
    expected: string[];
  }>([
    {
      name: "通常のカーソルキー",
      keys: ["escape", "ctrlC", "up", "down", "enter"],
      app: false,
      expected: ["\x1b", "\x03", "\x1b[A", "\x1b[B", "\r"],
    },
    {
      name: "アプリのカーソルキー (tmux・全画面のアプリ)",
      keys: ["up", "down"],
      app: true,
      expected: ["\x1bOA", "\x1bOB"],
    },
  ])("$name: 押した順に打鍵と同じ経路で送る", async ({
    keys,
    app,
    expected,
  }) => {
    fakeModes().applicationCursorKeysMode = app;
    for (const key of keys) {
      screen.sendSoftKey(key);
      await settle();
    }
    expect(sentKeys()).toEqual(expected);
  });

  test("入力を止めている間は送らない", async () => {
    screen.setInputEnabled(false);
    screen.sendSoftKey("enter");
    await settle();
    expect(sentKeys()).toEqual([]);
  });
});
