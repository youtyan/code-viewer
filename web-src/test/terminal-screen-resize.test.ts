// 端末の箱の寸法を変えても、tmux の画面の行がずれない。
//
// 落とすと痛いもの:
//
// - 繋いだ直後から、最後の行が何行も重複して並ぶ。再読み込みするまで直らない
//
// 原因は xterm の側にある。一度も使っていない代替画面 (tmux や vim が使う画面)
// を縮めても、xterm はその画面の行数の上限を縮めない。端末は作った直後が 24 行
// なので、箱の行数 (下のパネルなら 8〜10 行) へ縮めた後に tmux が代替画面へ
// 入ると、画面に無いはずの行が溜まり、tmux が送る「この範囲をずらす」が別の
// 行に当たる。attach は寸法を合わせてから reset する (reset は今の寸法で両方の
// 画面を作り直す)。
//
// 前半は本物の xterm で「順番で結果が変わる」ことを確かめる。上流が直ればこの
// 前半の 1 本目が落ちるので、そのときは回避の説明を見直す。後半は attach が
// その順番を守っていることを、xterm を差し替えて確かめる。本物の画面での確認
// (棚の開閉・ウィンドウ幅・下のパネルの高さ) は作業報告の記録。

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

type RealTerminal = import("@xterm/xterm").Terminal;

/** 書いたものが解釈し終わるまで待つ。xterm の write は非同期。 */
function writeAll(term: RealTerminal, data: string): Promise<void> {
  return new Promise((resolve) => term.write(data, resolve));
}

function screenRows(term: RealTerminal): string[] {
  const buffer = term.buffer.active;
  const rows: string[] = [];
  for (let y = 0; y < term.rows; y++) {
    rows.push(
      buffer.getLine(buffer.viewportY + y)?.translateToString(true) ?? "",
    );
  }
  return rows;
}

const ESC = "\u001b";

/**
 * tmux が状態行つきの画面を描くときと同じ手順を、繋いだ直後の流れで並べる。
 *
 * 1. 代替画面へ入り、tmux が思っている行数 (32 行) の分だけ改行して描く。
 *    箱は 8 行なので、下端での改行は画面をずらす。最後にカーソルを上の方
 *    (6 行目) へ戻す (tmux は入力欄の位置へ戻す)
 * 2. 箱が 10 行に伸びる (下のパネルが開き切る)
 * 3. tmux が 10 行で描き直し、状態行を除いた 9 行を「ずらす範囲」にして 1 行足す
 */
async function drawLikeTmux(term: RealTerminal): Promise<void> {
  let first = `${ESC}[?1049h${ESC}[H${ESC}[2J`;
  for (let i = 0; i < 31; i++) first += `${ESC}[K\r\n`;
  first += `${ESC}[6;10H`;
  await writeAll(term, first);
  term.resize(110, 10);
  let redraw = "";
  for (let row = 1; row <= 9; row++) {
    redraw += `${ESC}[${row};1H${ESC}[Kline ${row}`;
  }
  redraw += `${ESC}[10;1H[status]`;
  redraw += `${ESC}[1;9r${ESC}[9;1H\nline 10`;
  await writeAll(term, redraw);
}

/** 1 行目が上に押し出され、2〜10 行目と状態行が並ぶ。 */
const EXPECTED = [
  ...Array.from({ length: 9 }, (_, i) => `line ${i + 2}`),
  "[status]",
];

describe("xterm の代替画面と寸法の順番 (本物の xterm)", () => {
  test("作った後に縮めてから代替画面へ入ると、行がずれる (上流の挙動)", async () => {
    const { Terminal } = await import("@xterm/xterm");
    const term = new Terminal({ cols: 80, rows: 24 });
    term.resize(110, 8);
    await drawLikeTmux(term);
    expect(term.buffer.active.type).toBe("alternate");
    // 代替画面に履歴は無いはずなのに、画面の起点がずれている。
    expect(term.buffer.active.baseY).toBeGreaterThan(0);
    expect(screenRows(term)).not.toEqual(EXPECTED);
    term.dispose();
  });

  test("縮めてから reset すると、代替画面の行は tmux の描いたとおりに並ぶ", async () => {
    const { Terminal } = await import("@xterm/xterm");
    const term = new Terminal({ cols: 80, rows: 24 });
    term.resize(110, 8);
    term.reset();
    await drawLikeTmux(term);
    expect(term.buffer.active.type).toBe("alternate");
    expect(term.buffer.active.baseY).toBe(0);
    expect(screenRows(term)).toEqual(EXPECTED);
    term.dispose();
  });
});

// ---- attach の順番 (xterm を差し替える) ----

/** 差し替えた端末に起きたことを順に記録する。vi.mock の factory は巻き上げ
 * られるので、外の変数ではなく globalThis 経由で渡す。 */
const CALLS_KEY = "__terminalScreenResizeCalls";

function calls(): string[] {
  return (globalThis as Record<string, unknown>)[CALLS_KEY] as string[];
}

vi.mock("../core/xterm-loader", () => {
  const noop = () => undefined;
  const disposable = () => ({ dispose: noop });
  const log: string[] = [];
  (globalThis as Record<string, unknown>).__terminalScreenResizeCalls = log;
  class FakeTerminal {
    cols = 80;
    rows = 24;
    element: HTMLElement | undefined;
    textarea: HTMLTextAreaElement | undefined;
    options: Record<string, unknown> = {};
    buffer = {
      active: {
        viewportY: 0,
        baseY: 0,
        cursorY: 0,
        getLine: () => undefined,
      },
    };
    registerLinkProvider = () => ({ dispose: noop });
    open = (parent: HTMLElement) => {
      const root = document.createElement("div");
      parent.appendChild(root);
      this.element = root;
    };
    write = () => {
      log.push("write");
    };
    resize = (cols: number, rows: number) => {
      this.cols = cols;
      this.rows = rows;
      log.push(`resize ${cols}x${rows}`);
    };
    reset = () => {
      log.push("reset");
    };
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
    private term: FakeTerminal | null = null;
    activate(term: FakeTerminal) {
      this.term = term;
    }
    dispose = noop;
    /** 箱に 110x8 が入るとして、本物と同じく端末の寸法を変える。 */
    fit() {
      log.push("fit");
      this.term?.resize(110, 8);
    }
    proposeDimensions = () => ({ cols: 110, rows: 8 });
  }
  return {
    loadXterm: () =>
      Promise.resolve({ Terminal: FakeTerminal, FitAddon: FakeFitAddon }),
  };
});

const SESSION: ShellSession = {
  id: "shell-resize",
  command: "/bin/sh",
  cwd: "/repo",
  createdAt: "2026-09-01T00:00:00.000Z",
  cols: 120,
  rows: 32,
  exited: false,
  exitCode: null,
  tty: "/dev/ttys001",
};

describe("attach は寸法を合わせてから端末を作り直す", () => {
  let screen: TerminalScreenHandle;
  let host: HTMLElement;
  /** 購読の output の受け口。テストから溜まっていた出力を流す。 */
  let outputHandlers: Array<(event: MessageEvent<string>) => void> = [];

  beforeEach(() => {
    calls().length = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response(JSON.stringify({ images: [], rejected: [] })),
      ),
    );
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
      isImageShelfCollapsed: () => false,
      setImageShelfCollapsed: () => undefined,
    });
    host.appendChild(screen.el);
    // 箱に寸法が無いと fit しない (幅 0 で測ると利用者の tmux まで縮む)。
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, 858, 170),
    );
  });

  afterEach(() => {
    screen.dispose();
    host.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  test("fit で縮めた後に reset し、その後に出力を流す", async () => {
    await screen.attach(SESSION);
    for (const handler of outputHandlers) {
      handler({
        data: JSON.stringify({ data: "replay" }),
      } as MessageEvent<string>);
    }
    const fit = calls().indexOf("fit");
    const reset = calls().indexOf("reset");
    expect(fit).toBeGreaterThanOrEqual(0);
    expect(reset).toBeGreaterThan(fit);
    expect(calls().slice(fit, reset + 1)).toEqual([
      "fit",
      "resize 110x8",
      "reset",
    ]);
    expect(calls().indexOf("write")).toBeGreaterThan(reset);
  });
});
