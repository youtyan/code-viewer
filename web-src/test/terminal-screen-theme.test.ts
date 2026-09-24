// 端末 (xterm) に渡す配色と、文字のコントラストの下限。
//
// xterm は CSS 変数を読めないので、terminal-screen.ts の terminalTheme が
// style.css の名前の層から読んで渡す。ターミナルの明暗が「常にダーク」
// (html[data-terminal-tone="dark"]) なら、画面がライトでもそのテーマのダークの
// 端末の色を渡し、「画面に合わせる」に変えたらその場で当て直す。
//
// 実物の style.css を happy-dom に当て、xterm は差し替えて受け取った値を見る。
// 本物の画面での確認 (DOM と WebGL の描画・ライトの画面) は作業報告の記録。
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
import { terminalText } from "../views/terminal/i18n";
import {
  createTerminalScreen,
  TERMINAL_MINIMUM_CONTRAST_RATIO,
  type TerminalScreenHandle,
} from "../views/terminal/terminal-screen";

beforeAll(() => {
  GlobalRegistrator.register();
});

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

type Options = {
  minimumContrastRatio?: number;
  theme?: { background?: string; foreground?: string; red?: string };
};

vi.mock("../core/xterm-loader", () => {
  const noop = () => undefined;
  const disposable = () => ({ dispose: noop });
  class FakeTerminal {
    cols = 80;
    rows = 24;
    element: HTMLElement | undefined;
    textarea: HTMLTextAreaElement | undefined;
    options: Record<string, unknown>;
    modes = { applicationCursorKeysMode: false };
    buffer = {
      active: { viewportY: 0, baseY: 0, cursorY: 0, getLine: () => undefined },
    };
    constructor(options: Record<string, unknown>) {
      this.options = { ...options };
      (globalThis as Record<string, unknown>).__themeTestTerminal = this;
    }
    registerLinkProvider = () => ({ dispose: noop });
    open = (parent: HTMLElement) => {
      const root = document.createElement("div");
      parent.appendChild(root);
      this.element = root;
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
  class FakeWebglAddon {
    activate = noop;
    dispose = noop;
    onContextLoss = disposable;
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

function terminalOptions(): Options {
  return (
    (globalThis as Record<string, unknown>).__themeTestTerminal as {
      options: Options;
    }
  ).options;
}

/** 属性の変化 (MutationObserver) が届くまで待つ。 */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

const SESSION: ShellSession = {
  id: "shell-theme",
  command: "/bin/sh",
  cwd: "/repo",
  createdAt: "2026-09-01T00:00:00.000Z",
  cols: 80,
  rows: 24,
  exited: false,
  exitCode: null,
  tty: "/dev/ttys001",
};

const STYLE_SOURCE = readFileSync("web/style.css", "utf8");

type Look = {
  theme: "light" | "dark";
  colorTheme?: string;
  terminalTone?: "dark";
};

function applyLook(look: Look): void {
  const root = document.documentElement;
  root.dataset.theme = look.theme;
  if (look.colorTheme) root.dataset.colorTheme = look.colorTheme;
  else delete root.dataset.colorTheme;
  if (look.terminalTone) root.dataset.terminalTone = look.terminalTone;
  else delete root.dataset.terminalTone;
}

describe("the terminal colors", () => {
  let screen: TerminalScreenHandle;
  let style: HTMLStyleElement;

  async function open(look: Look): Promise<void> {
    applyLook(look);
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
    // 裏のタブの端末と同じく、画面の箱を文書に入れないまま繋ぐ。
    await screen.attach(SESSION);
  }

  beforeEach(() => {
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
    style = document.createElement("style");
    style.textContent = STYLE_SOURCE;
    document.head.append(style);
    // happy-dom は custom property を親から子へ継がない (html では読めるのに、
    // その子では空になる)。ブラウザと同じく、箱で宣言が無ければ親の値を読む。
    const real = window.getComputedStyle.bind(window);
    vi.spyOn(window, "getComputedStyle").mockImplementation((element) => {
      const own = real(element);
      return new Proxy(own, {
        get(target, key) {
          if (key !== "getPropertyValue")
            return Reflect.get(target, key, target);
          return (name: string) => {
            let at: Element | null = element;
            while (at) {
              const value = real(at).getPropertyValue(name);
              if (value !== "" || !name.startsWith("--")) return value;
              at = at.parentElement;
            }
            return "";
          };
        },
      });
    });
  });

  afterEach(() => {
    screen.dispose();
    style.remove();
    applyLook({ theme: "dark" });
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  // 期待する値は style.css のそのテーマの端末の色 (--color-term・--color-term-text・
  // --color-failed)。
  test.each<{ name: string; look: Look; expected: Options["theme"] }>([
    {
      name: "always dark on a light page: the dark terminal",
      look: { theme: "light", terminalTone: "dark" },
      expected: {
        background: "#100f15",
        foreground: "#e8e4ef",
        red: "#d2818c",
      },
    },
    {
      name: "always dark on a light page with another theme: that theme's dark terminal",
      look: { theme: "light", colorTheme: "github", terminalTone: "dark" },
      expected: {
        background: "#010409",
        foreground: "#f0f6fc",
        red: "#f85149",
      },
    },
    {
      name: "match on a light page: the light terminal",
      look: { theme: "light" },
      expected: {
        background: "#ede9f2",
        foreground: "#282331",
        red: "#ac455d",
      },
    },
    {
      name: "always dark on a dark page: the dark terminal",
      look: { theme: "dark", terminalTone: "dark" },
      expected: {
        background: "#100f15",
        foreground: "#e8e4ef",
        red: "#d2818c",
      },
    },
  ])("$name", async ({ look, expected }) => {
    await open(look);
    const { background, foreground, red } = terminalOptions().theme ?? {};
    expect({ background, foreground, red }).toEqual(expected);
  });

  test("switching to match applies the light terminal at once", async () => {
    await open({ theme: "light", terminalTone: "dark" });

    delete document.documentElement.dataset.terminalTone;
    await settle();

    expect(terminalOptions().theme?.background).toBe("#ede9f2");
  });

  test("the terminal lifts low-contrast text to 4.5:1", async () => {
    await open({ theme: "light", terminalTone: "dark" });
    expect({
      option: terminalOptions().minimumContrastRatio,
      constant: TERMINAL_MINIMUM_CONTRAST_RATIO,
    }).toEqual({ option: 4.5, constant: 4.5 });
  });
});
