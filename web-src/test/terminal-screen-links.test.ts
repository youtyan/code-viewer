// ターミナルの画面の中の URL・ファイルのパス・画像のパス: カーソルを載せると
// 強く強調し、すぐ上に［開く］［コピー］の帯を出す。押すと開く
// (views/terminal/terminal-links-layer.ts と terminal-screen.ts)。
//
// 落とすと痛いもの:
//
// - tmux のマウスが有効だと押しても開かない (⌘/Ctrl の押下は tmux に渡さない)
// - 存在しないファイルのパスをリンクにする
// - コピーが相対パスのまま (どこで貼っても開ける絶対パスにする)
// - 帯が文字列を隠す / カーソルを帯へ移す間に消える
//
// xterm・EventSource・fetch は外の境界なので差し替える。マス目は 8×16 px、
// 偽の端末は 1 字 1 マス。

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
import type { TerminalImageRef } from "../core/terminal-images";
import { terminalText } from "../views/terminal/i18n";
import {
  LINK_BAR_HIDE_MS,
  linkAt,
  placeLinkBar,
  type ScreenLink,
} from "../views/terminal/terminal-links-layer";
import {
  createTerminalScreen,
  type TerminalScreenHandle,
} from "../views/terminal/terminal-screen";
import { q } from "./_test-helpers";

const term = vi.hoisted(() => ({
  lines: [] as string[],
  cols: 80,
  rows: 24,
  selection: false,
  renderHandlers: [] as Array<() => void>,
}));

vi.mock("../core/xterm-loader", () => {
  const noop = () => undefined;
  const disposable = () => ({ dispose: noop });
  const bufferLine = (text: string) => ({
    isWrapped: false,
    length: term.cols,
    getCell: (x: number) =>
      x < term.cols
        ? { getChars: () => text[x] ?? "", getWidth: () => 1 }
        : undefined,
    translateToString: (trimRight?: boolean) =>
      trimRight ? text.replace(/\s+$/, "") : text.padEnd(term.cols),
  });
  class FakeTerminal {
    element: HTMLElement | undefined;
    options: Record<string, unknown>;
    modes = { applicationCursorKeysMode: false };
    buffer = {
      active: {
        viewportY: 0,
        baseY: 0,
        cursorY: 0,
        get length() {
          return term.lines.length;
        },
        getLine: (y: number) =>
          y >= 0 && y < term.lines.length
            ? bufferLine(term.lines[y] ?? "")
            : undefined,
      },
    };
    get cols() {
      return term.cols;
    }
    get rows() {
      return term.rows;
    }
    constructor(options: Record<string, unknown>) {
      this.options = { ...options };
    }
    open = (parent: HTMLElement) => {
      const root = document.createElement("div");
      root.className = "xterm";
      const screen = document.createElement("div");
      screen.className = "xterm-screen";
      Object.defineProperty(screen, "clientWidth", {
        get: () => term.cols * 8,
      });
      Object.defineProperty(screen, "clientHeight", {
        get: () => term.rows * 16,
      });
      root.append(screen);
      parent.append(root);
      this.element = root;
    };
    onRender = (handler: () => void) => {
      term.renderHandlers.push(handler);
      return { dispose: noop };
    };
    write = () => {
      for (const handler of term.renderHandlers) handler();
    };
    hasSelection = () => term.selection;
    clearSelection = noop;
    select = noop;
    scrollToLine = noop;
    loadAddon = noop;
    onScroll = disposable;
    onResize = disposable;
    onData = disposable;
    attachCustomKeyEventHandler = noop;
    reset = noop;
    focus = noop;
    dispose = noop;
    resize = noop;
  }
  class FakeFitAddon {
    activate = noop;
    dispose = noop;
    fit = noop;
    proposeDimensions = () => ({ cols: term.cols, rows: term.rows });
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

const IMAGE: TerminalImageRef = {
  path: "/repo/out/chart.png",
  candidate: "out/chart.png",
  name: "chart.png",
  url: "/_agent/image?path=%2Frepo%2Fout%2Fchart.png&v=1-1",
  bytes: 1,
  mtimeMs: 1,
};

const SHELL: ShellSession = {
  id: "shell-abc123",
  command: "/bin/zsh",
  cwd: "/repo",
  createdAt: "2026-08-01T09:41:58.000Z",
  cols: 80,
  rows: 24,
  exited: false,
  exitCode: null,
  tty: "",
};

/** 画面の見本: URL・存在するファイル (行つき)・存在しないファイル・画像。 */
const LINES = [
  "see https://example.com/docs/setup",
  "changed src/greeting.ts:3 today",
  "missing src/missing.ts here",
  "wrote out/chart.png",
];

let emitOutput: (data: string) => void;
let requests: string[];
let statuses: Array<string | null>;
let openedFiles: Array<{ path: string; line?: number; kept: boolean }>;
let openedImages: Array<{ kept: boolean }>;
let windowOpens: unknown[][];
let copied: string[];
let handle: TerminalScreenHandle;

function installFakes(): void {
  const noop = () => undefined;
  Object.defineProperty(globalThis, "EventSource", {
    configurable: true,
    value: class {
      static readonly CLOSED = 2;
      readyState = 1;
      onerror = null;
      addEventListener(
        type: string,
        handler: (event: MessageEvent<string>) => void,
      ) {
        if (type !== "output") return;
        emitOutput = (data) =>
          handler({ data: JSON.stringify({ data }) } as MessageEvent<string>);
      }
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
    value: (input: string) => {
      const url = String(input);
      requests.push(url);
      const base = { source: "shell", cwd: "/repo" };
      let body: unknown;
      if (url.startsWith("/_agent/paths")) {
        const asked = new URL(url, "http://localhost").searchParams.getAll(
          "path",
        );
        body = {
          files: asked
            .filter((path) => path === "src/greeting.ts")
            .map((path) => ({
              candidate: path,
              path,
              absolute: `/repo/${path}`,
            })),
        };
      } else if (url.startsWith("/_agent/images/history")) {
        body = {
          images: [],
          rejected: [],
          base,
          pane: null,
          candidates: [],
          lines: 0,
        };
      } else {
        body = { images: [IMAGE], rejected: [], base };
      }
      return Promise.resolve(new Response(JSON.stringify(body)));
    },
  });
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: (value: string) => {
        copied.push(value);
        return Promise.resolve();
      },
    },
  });
  vi.spyOn(window, "open").mockImplementation((...args: unknown[]) => {
    windowOpens.push(args);
    return null;
  });
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const nextFrame = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

beforeAll(() => {
  GlobalRegistrator.register({ url: "http://localhost/" });
});

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

beforeEach(async () => {
  term.lines = [...LINES];
  term.selection = false;
  term.renderHandlers = [];
  requests = [];
  statuses = [];
  openedFiles = [];
  openedImages = [];
  windowOpens = [];
  copied = [];
  document.body.replaceChildren();
  installFakes();
  handle = createTerminalScreen({
    trackLoad: (promise) => promise,
    actionHeaders: () => ({}),
    getText: () => terminalText("en"),
    onStatus: (message) => statuses.push(message),
    onTargetGone: () => undefined,
    onShellExited: () => undefined,
    tmuxWindow: () => null,
    onTmuxWindowStale: () => undefined,
    getFontSize: () => 14,
    isImageShelfCollapsed: () => false,
    setImageShelfCollapsed: () => undefined,
    onOpenImage: (_image, _gallery, kept) => openedImages.push({ kept }),
    onOpenFile: (path, line, kept) =>
      openedFiles.push({ path, ...(line !== undefined ? { line } : {}), kept }),
  });
  document.body.append(handle.el);
  await handle.attach(SHELL);
  // 出力が届いて描き直し、画像を棚に入れ、ファイルのパスを確かめるまで。
  emitOutput("out/chart.png\r\n");
  await flush();
  await flush();
  await nextFrame();
  await flush();
  await nextFrame();
});

afterEach(() => {
  handle.dispose();
  vi.restoreAllMocks();
});

/** 画面の行と桁 (0 始まり) のマスの真ん中に、マウスの出来事を送る。 */
function mouseAt(
  type: string,
  row: number,
  col: number,
  init: MouseEventInit = {},
): boolean {
  const screen = handle.el.querySelector(".xterm-screen");
  if (!screen) throw new Error("no xterm screen");
  return screen.dispatchEvent(
    new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX: col * 8 + 4,
      clientY: row * 16 + 8,
      ...init,
    }),
  );
}

function strong(): Array<{ row: number; col: number; cols: number }> {
  return [
    ...handle.el.querySelectorAll<HTMLElement>(".terminal-link-hover"),
  ].map((el) => ({
    row: Number(el.style.getPropertyValue("--link-row")),
    col: Number(el.style.getPropertyValue("--link-col")),
    cols: Number(el.style.getPropertyValue("--link-cols")),
  }));
}

function bar(): HTMLElement {
  return q<HTMLElement>(document, ".terminal-link-bar");
}

function barButton(label: string): HTMLButtonElement {
  const button = [
    ...bar().querySelectorAll<HTMLButtonElement>(".terminal-link-action"),
  ].find((item) => item.textContent === label);
  if (!button) throw new Error(`no ${label} button`);
  return button;
}

describe("何をリンクにするか", () => {
  test("常に薄い下線は画像のパスだけ (URL とファイルは量が多いので出さない)", () => {
    const marks = [
      ...handle.el.querySelectorAll<HTMLElement>(".terminal-link-mark"),
    ].map((el) => el.style.getPropertyValue("--link-row"));
    expect(marks).toEqual(["3"]);
  });

  test.each([
    { name: "URL", row: 0, col: 10, expected: [{ row: 0, col: 4, cols: 30 }] },
    {
      name: "行つきのファイルのパス (行番号も含めて 1 つ)",
      row: 1,
      col: 12,
      expected: [{ row: 1, col: 8, cols: 17 }],
    },
    {
      name: "存在しないファイルのパスはリンクにしない",
      row: 2,
      col: 12,
      expected: [],
    },
    {
      name: "画像のパス",
      row: 3,
      col: 8,
      expected: [{ row: 3, col: 6, cols: 13 }],
    },
  ])("$name", ({ row, col, expected }) => {
    mouseAt("mousemove", row, col);
    expect(strong()).toEqual(expected);
  });

  test("ファイルのパスは見えている分だけ 1 回訊き、覚えておく", async () => {
    const asked = () =>
      requests.filter((url) => url.startsWith("/_agent/paths"));
    expect(asked()).toHaveLength(1);
    emitOutput("\r\n");
    await nextFrame();
    await flush();
    expect(asked()).toHaveLength(1);
  });
});

describe("ホバーの帯", () => {
  test("文字列のすぐ上に［開く］［コピー］を出す", () => {
    mouseAt("mousemove", 1, 12);
    expect(bar().hidden).toBe(false);
    expect(
      [...bar().querySelectorAll(".terminal-link-action")].map(
        (el) => el.textContent,
      ),
    ).toEqual(["Open", "Copy"]);
  });

  test("文字列から離れて少し待つと消え、帯の上にいる間は消えない", async () => {
    mouseAt("mousemove", 1, 12);
    mouseAt("mousemove", 10, 0);
    bar().dispatchEvent(new MouseEvent("mouseenter"));
    await new Promise((resolve) => setTimeout(resolve, LINK_BAR_HIDE_MS + 20));
    expect(bar().hidden).toBe(false);
    bar().dispatchEvent(new MouseEvent("mouseleave"));
    await new Promise((resolve) => setTimeout(resolve, LINK_BAR_HIDE_MS + 20));
    expect(bar().hidden).toBe(true);
    expect(strong()).toEqual([]);
  });

  test("画像のパスでは小さな見本と名前も出す", () => {
    mouseAt("mousemove", 3, 8);
    expect(
      bar().querySelector<HTMLElement>(".terminal-link-preview")?.hidden,
    ).toBe(false);
    expect(bar().querySelector("img")?.getAttribute("src")).toBe(IMAGE.url);
    expect(
      bar().querySelector(".terminal-link-preview-caption")?.textContent,
    ).toBe("chart.png");
  });

  test.each([
    {
      name: "URL",
      row: 0,
      col: 10,
      expected: "https://example.com/docs/setup",
    },
    {
      name: "ファイルは絶対パス",
      row: 1,
      col: 12,
      expected: "/repo/src/greeting.ts",
    },
    {
      name: "画像は実体のパス",
      row: 3,
      col: 8,
      expected: "/repo/out/chart.png",
    },
  ])("コピー: $name", async ({ row, col, expected }) => {
    mouseAt("mousemove", row, col);
    barButton("Copy").click();
    await flush();
    expect(copied).toEqual([expected]);
    // 押したら一瞬「コピーしました」。
    expect(bar().querySelector("[data-copied]")?.textContent).toBe("Copied");
  });

  test("開く: URL は新しいタブ (opener を渡さない)", () => {
    mouseAt("mousemove", 0, 10);
    barButton("Open").click();
    expect(windowOpens).toEqual([
      ["https://example.com/docs/setup", "_blank", "noopener"],
    ]);
  });
});

describe("押下", () => {
  test.each([
    { name: "そのまま押す", init: {}, kept: false },
    { name: "⌘ を押しながら", init: { metaKey: true }, kept: true },
    { name: "Ctrl を押しながら", init: { ctrlKey: true }, kept: true },
  ])("ファイルのパス: $name → その行を開く", ({ init, kept }) => {
    mouseAt("click", 1, 12, init);
    expect(openedFiles).toEqual([{ path: "src/greeting.ts", line: 3, kept }]);
  });

  test("Shift は選択に任せて開かない", () => {
    mouseAt("click", 1, 12, { shiftKey: true });
    expect(openedFiles).toEqual([]);
  });

  test("画像のパスを押すと画像のタブ", () => {
    mouseAt("click", 3, 8);
    expect(openedImages).toEqual([{ kept: false }]);
  });

  test("文字を選んだ後の押下では開かない", () => {
    term.selection = true;
    mouseAt("click", 1, 12);
    expect(openedFiles).toEqual([]);
  });

  test("⌘/Ctrl の押下はリンクの上なら端末 (tmux のマウス) に渡さない", () => {
    const reached: string[] = [];
    const inner = handle.el.querySelector(".xterm-screen");
    for (const type of ["mousedown", "mouseup"])
      inner?.addEventListener(type, () => reached.push(type));
    mouseAt("mousedown", 1, 12, { metaKey: true });
    mouseAt("mouseup", 1, 12, { metaKey: true });
    expect(reached).toEqual([]);
    // リンクの外、修飾キー無しの押下はそのまま端末へ。
    mouseAt("mousedown", 10, 0, { metaKey: true });
    mouseAt("mousedown", 1, 12);
    expect(reached).toEqual(["mousedown", "mousedown"]);
  });
});

describe("純粋な計算", () => {
  const link = (
    key: string,
    y: number,
    x0: number,
    x1: number,
  ): ScreenLink => ({
    kind: "url",
    key,
    text: key,
    segments: [{ y, x0, x1 }],
  });

  test.each([
    { x: 4, y: 0, expected: "a" },
    { x: 9, y: 0, expected: "a" },
    { x: 10, y: 0, expected: null },
    { x: 5, y: 1, expected: "b" },
  ])("linkAt($x, $y)", ({ x, y, expected }) => {
    expect(
      linkAt([link("a", 0, 4, 9), link("b", 1, 0, 20)], x, y)?.key ?? null,
    ).toBe(expected);
  });

  const bounds = { left: 100, top: 50, width: 800, height: 600 };
  test.each([
    {
      name: "文字列のすぐ上、左端をそろえる",
      text: { left: 300, top: 300, width: 120, height: 16 },
      expected: { left: 300, top: 300 - 4 - 40 },
    },
    {
      name: "上に入らなければ文字列のすぐ下",
      text: { left: 300, top: 60, width: 120, height: 16 },
      expected: { left: 300, top: 60 + 16 + 4 },
    },
    {
      name: "右端では画面の中に収める",
      text: { left: 850, top: 300, width: 40, height: 16 },
      expected: { left: 100 + 800 - 8 - 160, top: 256 },
    },
  ])("placeLinkBar: $name", ({ text, expected }) => {
    const place = placeLinkBar(text, { width: 160, height: 40 }, bounds);
    expect(place).toEqual(expected);
    // 帯は文字列の行に重ならない。
    const overlaps =
      place.top < text.top + text.height && place.top + 40 > text.top;
    expect(overlaps).toBe(false);
  });
});
