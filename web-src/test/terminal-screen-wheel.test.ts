// ターミナルの上でホイールを回したときに何が起きるか。
//
// 落とすと痛いのは 2 つ。
//
// 1. ホイールが端末へのキー入力に化ける
//
// xterm は「scrollback を持たない端末」でホイールを受けると、それを ↑/↓ キーに
// 変換してアプリへ送る。実端末で vim や tmux をスクロールさせるための仕様だが、
// tmux ペインを映しているドロワーではこれが害になる。live の間はドロワー側も
// scrollback を持たない (毎フレーム全画面を置き換えるため) ので必ずこの経路に
// 入り、ホイールを回すたびにペインの AI CLI へ ↑ が届いて履歴 (過去の発言) が
// 入力欄に呼び出される。おまけに xterm が preventDefault するので画面も動かない。
//
// 2. 遡って見られない
//
// 購読が返すのは「今の画面」だけなので、上端で更に上へ回したときに履歴を
// 取りに行く。取ってきた後は live のフレームを当てない (当てると遡っていた
// 位置が飛ぶ)。一番下まで戻したら追従を再開する。
//
// xterm 本体と EventSource は外の境界なので差し替える。差し替えの中で本物の
// xterm と同じ順序 (custom handler → scrollback 判定 → キー送出) と、
// スクロール位置の持ち方 (viewportY / baseY) を再現する。

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
import type { TmuxPane, TmuxScreen } from "../core/tmux";
import { terminalText } from "../views/terminal/i18n";
import {
  createTerminalScreen,
  type TerminalScreenHandle,
} from "../views/terminal/terminal-screen";

const ESC = String.fromCharCode(27);

/**
 * 履歴を流し込んだ後の下端。履歴 60 行を 10 行 (FitAddon が返す行数) の画面に
 * 入れたので、画面先頭は 50 行目まで下がれる。
 */
const HISTORY_BOTTOM_Y = 60 - 10;

/** 作られた端末。ホイールとスクロールをテストから流し込むために持っておく。 */
type FakeTerm = {
  /** 本物の xterm と同じ手順でホイールを処理し、preventDefault の有無を返す。 */
  wheel(deltaY: number): boolean;
  /** alt buffer のアプリを開いた状態にする (scrollback が効かなくなる)。 */
  enterAltBuffer(): void;
  /** 表示位置を動かす。人がスクロールバーを動かしたときに相当する。 */
  scrollTo(viewportY: number): void;
  /** 書き込まれた本文 (制御シーケンス込み)。 */
  written: string[];
  scrollback(): number;
  /** いま画面の一番上に出ているのがバッファの何行目か。 */
  viewportY(): number;
  /** いまの行数。履歴を足したぶん高くなる。 */
  rows(): number;
};

let terminals: FakeTerm[] = [];
/** FitAddon が「表示領域に入る」と答える行数。 */
let boxRows = 10;

vi.mock("../core/xterm-loader", () => {
  const noop = () => undefined;
  const disposable = () => ({ dispose: noop });
  class FakeTerminal {
    cols = 80;
    rows = 24;
    element: HTMLElement | undefined;
    textarea: HTMLTextAreaElement | undefined;
    options: Record<string, unknown>;
    written: string[] = [];
    /** 画面の一番上がバッファの何行目か。scrollLines / scrollTo で動く。 */
    viewportY = 0;
    /** スクロールバックを除いた画面先頭。書き込んだ行数から決まる。 */
    baseY = 0;
    private data: ((data: string) => void) | null = null;
    private wheelHandler: ((event: WheelEvent) => boolean) | null = null;
    private scrollHandler: ((viewportY: number) => void) | null = null;
    private hasScrollback: boolean;
    constructor(options: Record<string, unknown>) {
      this.options = { ...options };
      this.hasScrollback = Number(options.scrollback ?? 0) > 0;
      terminals.push({
        wheel: (deltaY) => this.handleWheel(deltaY),
        enterAltBuffer: () => {
          this.hasScrollback = false;
        },
        scrollTo: (viewportY) => this.scrollTo(viewportY),
        written: this.written,
        scrollback: () => Number(this.options.scrollback ?? 0),
        viewportY: () => this.viewportY,
        rows: () => this.rows,
      });
    }
    open = noop;
    write = (data: string, done?: () => void) => {
      this.written.push(data);
      // 本物の xterm は渡された分をすぐには解釈しない。行が積まれるのも
      // 完了コールバックが呼ばれるのも後。同期で積むと、書き込み直後に
      // 位置を動かすコードが「もう積まれている」前提で通ってしまう。
      const apply = () => {
        const lines = data.split("\n").length;
        if (this.hasScrollback && lines > this.rows) {
          this.baseY = lines - this.rows;
          this.viewportY = this.baseY;
        }
        done?.();
      };
      setTimeout(apply, 0);
    };
    resize = (cols: number, rows: number) => {
      this.cols = cols;
      this.rows = rows;
    };
    focus = noop;
    blur = noop;
    clear = noop;
    reset = () => {
      this.written.length = 0;
      this.viewportY = 0;
      this.baseY = 0;
      this.hasScrollback = Number(this.options.scrollback ?? 0) > 0;
    };
    dispose = noop;
    loadAddon = noop;
    onData = (handler: (data: string) => void) => {
      this.data = handler;
      return disposable();
    };
    onResize = disposable;
    onRender = disposable;
    onScroll = (handler: (viewportY: number) => void) => {
      this.scrollHandler = handler;
      return disposable();
    };
    scrollLines = (amount: number) => {
      this.scrollTo(Math.max(0, Math.min(this.baseY, this.viewportY + amount)));
    };
    registerMarker = () => undefined;
    registerDecoration = () => undefined;
    attachCustomKeyEventHandler = noop;
    attachCustomWheelEventHandler = (
      handler: (event: WheelEvent) => boolean,
    ) => {
      this.wheelHandler = handler;
    };
    get buffer() {
      return {
        active: {
          viewportY: this.viewportY,
          baseY: this.baseY,
          cursorY: 0,
          getLine: () => undefined,
        },
      };
    }

    private scrollTo(viewportY: number): void {
      this.viewportY = viewportY;
      this.scrollHandler?.(viewportY);
    }

    /**
     * xterm 6.0 の CoreBrowserTerminal がホイールでやっていることの写し。
     * custom handler が false を返したら何もせず、scrollback を持たない端末
     * では ↑/↓ を送って preventDefault する。
     */
    private handleWheel(deltaY: number): boolean {
      const event = { deltaY } as WheelEvent;
      if (this.wheelHandler && this.wheelHandler(event) === false) return false;
      if (this.hasScrollback) return true;
      this.data?.(`${ESC}[${deltaY < 0 ? "A" : "B"}`);
      return true;
    }
  }
  class FakeFitAddon {
    activate = noop;
    dispose = noop;
    fit = noop;
    // 表示領域に入る行数。テストから boxRows で変える。
    proposeDimensions = () => ({ cols: 80, rows: boxRows });
  }
  return {
    loadXterm: () =>
      Promise.resolve({ Terminal: FakeTerminal, FitAddon: FakeFitAddon }),
  };
});

type SentKey = { url: string; body: string };

let sentKeys: SentKey[] = [];
let historyRequests: string[] = [];
/** 開かれた購読の URL。埋め行数を頼めているかを見る。 */
let streamUrls: string[] = [];
/** /_tmux/history が返す本文。 */
let historyContent = "";
let historyOk = true;

function installFakes(): void {
  const noop = () => undefined;
  class FakeEventSource {
    static readonly CLOSED = 2;
    readyState = 1;
    onerror: (() => void) | null = null;
    addEventListener = noop;
    constructor(url: string) {
      streamUrls.push(url);
    }
    close(): void {
      this.readyState = 2;
    }
  }
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
      if (url.endsWith("/keys")) {
        sentKeys.push({
          url,
          body: typeof init?.body === "string" ? init.body : "",
        });
      }
      if (url.startsWith("/_tmux/history")) {
        historyRequests.push(url);
        return Promise.resolve({
          ok: historyOk,
          status: historyOk ? 200 : 500,
          json: () =>
            Promise.resolve({ ...frame(historyContent) } as TmuxScreen),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({}),
      });
    },
  });
}

const PANE: TmuxPane = {
  id: "%1",
  label: "0:0.0",
  paneIndex: 0,
  title: "agent",
  command: "zsh",
  path: "/repo",
  width: 80,
  height: 24,
  active: true,
  inRepo: true,
};

const SHELL: ShellSession = {
  id: "shell-abc",
  command: "zsh",
  cwd: "/repo",
  createdAt: "2026-01-01T00:00:00.000Z",
  cols: 80,
  rows: 24,
  exited: false,
  exitCode: null,
};

function frame(content: string, historyLines = 0): TmuxScreen {
  return {
    pane: PANE.id,
    content,
    width: 80,
    height: 24,
    cursorX: 0,
    cursorY: 3,
    historyLines,
  };
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

beforeAll(() => {
  GlobalRegistrator.register({ url: "http://localhost/" });
});

afterAll(() => {
  GlobalRegistrator.unregister();
});

let handle: TerminalScreenHandle;
let status: string | null = null;

beforeEach(() => {
  terminals = [];
  boxRows = 10;
  sentKeys = [];
  historyRequests = [];
  streamUrls = [];
  historyContent = [...Array(60).keys()].map((i) => `old-${i}`).join("\n");
  historyOk = true;
  status = null;
  installFakes();
  handle = createTerminalScreen({
    trackLoad: (promise) => promise,
    actionHeaders: () => ({}),
    getText: () => terminalText("en"),
    onStatus: (message) => {
      status = message;
    },
    onTargetGone: () => undefined,
    getFontSize: () => 14,
  });
  document.body.append(handle.el);
});

afterEach(() => {
  handle.dispose();
  document.body.innerHTML = "";
});

function lastTerminal(): FakeTerm {
  const term = terminals[terminals.length - 1];
  if (!term) throw new Error("no terminal created");
  return term;
}

describe("ターミナル上のホイール", () => {
  test("tmux ペインではキーを送らず、外側のスクロールも止めない", async () => {
    await handle.attach({ kind: "tmux", pane: PANE });
    const prevented = lastTerminal().wheel(-120);
    await flush();

    // ↑ が送られると、ペインの AI CLI が過去の発言を入力欄に呼び戻す。
    expect(sentKeys).toEqual([]);
    // 止められると .terminal-screen (overflow: auto) が動かせない。
    expect(prevented).toBe(false);
  });

  test("tmux ペインでは下方向でもキーを送らない", async () => {
    await handle.attach({ kind: "tmux", pane: PANE });
    lastTerminal().wheel(120);
    await flush();

    expect(sentKeys).toEqual([]);
  });

  test("シェルの alt buffer では xterm の ↑/↓ 変換をそのまま通す", async () => {
    // vim や less をシェルで開いている間は、ホイールでスクロールできる必要が
    // ある。tmux 側の事情でここまで殺してはいけない。
    await handle.attach({ kind: "shell", session: SHELL });
    lastTerminal().enterAltBuffer();
    lastTerminal().wheel(120);
    await flush();

    expect(sentKeys).toHaveLength(1);
    expect(sentKeys[0]?.url).toBe("/_shell/keys");
    expect(JSON.parse(sentKeys[0]?.body ?? "{}")).toEqual({
      id: SHELL.id,
      data: `${ESC}[B`,
    });
  });
});

describe("ペインが表示領域より縦に長いとき", () => {
  /** 枠の寸法を差し替える。happy-dom はレイアウトを持たないので 0 のまま。 */
  function sizeScreen(contentHeight: number, boxHeight: number): HTMLElement {
    const screenEl = handle.el.querySelector<HTMLElement>(".terminal-screen");
    if (!screenEl) throw new Error("no screen element");
    Object.defineProperty(screenEl, "scrollHeight", {
      configurable: true,
      get: () => contentHeight,
    });
    Object.defineProperty(screenEl, "clientHeight", {
      configurable: true,
      get: () => boxHeight,
    });
    return screenEl;
  }

  test("フレームを当てたら下端に寄せる", async () => {
    // 新しい出力は下に出る。上を向いたままだと古い行しか見えない。
    const source = await attachAndCapture();
    const screenEl = sizeScreen(1584, 345);
    source.emitScreen(frame("live-1\n"));
    await flush();

    expect(screenEl.scrollTop).toBe(1584);
  });

  test("人が上へ動かしている間は引き戻さない", async () => {
    const source = await attachAndCapture();
    const screenEl = sizeScreen(1584, 345);
    source.emitScreen(frame("live-1\n"));
    await flush();

    screenEl.scrollTop = 200;
    screenEl.dispatchEvent(new Event("scroll"));
    source.emitScreen(frame("live-2\n"));
    await flush();

    expect(screenEl.scrollTop).toBe(200);
  });

  test("下端へ戻したら、また貼り付く", async () => {
    const source = await attachAndCapture();
    const screenEl = sizeScreen(1584, 345);
    screenEl.scrollTop = 200;
    screenEl.dispatchEvent(new Event("scroll"));
    screenEl.scrollTop = 1584 - 345;
    screenEl.dispatchEvent(new Event("scroll"));

    source.emitScreen(frame("live-1\n"));
    await flush();

    expect(screenEl.scrollTop).toBe(1584);
  });
});

describe("表示領域がペインより縦に長いとき", () => {
  test("余るぶんの履歴を購読に頼む", async () => {
    // 頼まないと上が空いたままになる。埋めるのはそのペインが少し前に出して
    // いた行なので、live のフレームと一緒に送ってもらう。
    boxRows = 40;
    await handle.attach({ kind: "tmux", pane: PANE });

    expect(streamUrls).toEqual(["/_tmux/stream?pane=%251&fill=16"]);
  });

  test("ペインのほうが縦に長ければ頼まない", async () => {
    boxRows = 10;
    await handle.attach({ kind: "tmux", pane: PANE });

    expect(streamUrls).toEqual(["/_tmux/stream?pane=%251&fill=0"]);
  });

  test("履歴付きのフレームは、その行数ぶん高い端末に描く", async () => {
    boxRows = 40;
    const source = await attachAndCapture();
    const term = lastTerminal();
    term.written.length = 0;
    source.emitScreen(frame("old\nnew\n", 16));
    await flush();

    // 24 行のペイン + 16 行の履歴。
    expect(term.rows()).toBe(40);
    // カーソルは画面の中の位置なので、履歴のぶん下へずれる (16 + 3 + 1)。
    expect(term.written.join("")).toContain(`${ESC}[20;1H`);
  });

  test("履歴が付いていないフレームはペインの実寸のまま", async () => {
    boxRows = 40;
    const source = await attachAndCapture();
    const term = lastTerminal();
    term.written.length = 0;
    source.emitScreen(frame("now\n", 0));
    await flush();

    expect(term.rows()).toBe(24);
    expect(term.written.join("")).toContain(`${ESC}[4;1H`);
  });
});

describe("tmux ペインの履歴", () => {
  test("上端で上へ回すと履歴を取ってきて端末に流し込む", async () => {
    await handle.attach({ kind: "tmux", pane: PANE });
    const term = lastTerminal();
    term.written.length = 0;
    term.wheel(-120);
    await flush();

    expect(historyRequests).toHaveLength(1);
    expect(historyRequests[0]).toContain("pane=%251");
    expect(term.written.join("")).toContain("old-0");
    expect(term.scrollback()).toBeGreaterThan(0);
    expect(status).toBe(terminalText("en").historyPaused);
  });

  test("読み込み終わってから、回した合図として上へ動かす", async () => {
    // xterm の書き込みは非同期なので、直後に動かしても 1 行も積まれていない。
    // 履歴を出したのに画面が動かないと、効かなかったように見える。
    await handle.attach({ kind: "tmux", pane: PANE });
    const term = lastTerminal();
    term.wheel(-120);
    await flush();
    await flush();

    expect(term.viewportY()).toBeLessThan(HISTORY_BOTTOM_Y);
  });

  test("回し続けても履歴の取得は 1 回だけ", async () => {
    await handle.attach({ kind: "tmux", pane: PANE });
    const term = lastTerminal();
    for (let i = 0; i < 5; i += 1) {
      term.wheel(-120);
      await flush();
    }

    expect(historyRequests).toHaveLength(1);
  });

  test("履歴を見ている間は live のフレームで画面を書き換えない", async () => {
    // 書き換えると、遡って読んでいた位置が何を指していたのか分からなくなる。
    const source = await attachAndCapture();
    lastTerminal().wheel(-120);
    await flush();
    const term = lastTerminal();
    term.written.length = 0;

    source.emitScreen(frame("live-1\n"));
    await flush();

    expect(term.written.join("")).not.toContain("live-1");
  });

  test("一番下まで戻すと、止めている間の最後の画面から追従を再開する", async () => {
    const source = await attachAndCapture();
    const term = lastTerminal();
    term.wheel(-120);
    await flush();
    source.emitScreen(frame("live-1\n"));
    await flush();
    term.written.length = 0;

    // 上へ動かしてから下端へ戻す。読み込み直後の下端では復帰しない。
    term.scrollTo(0);
    term.scrollTo(HISTORY_BOTTOM_Y);
    await flush();

    expect(term.written.join("")).toContain("live-1");
    expect(term.scrollback()).toBe(0);
    expect(status).toBeNull();
  });

  test("履歴を見ている間に打鍵したら live に戻す", async () => {
    // 送った結果を見たいはずなので、止めたままにしない。
    const source = await attachAndCapture();
    const term = lastTerminal();
    term.wheel(-120);
    await flush();
    source.emitScreen(frame("live-1\n"));
    await flush();
    term.written.length = 0;

    handle.el.querySelector<HTMLButtonElement>('[data-key="tab"]')?.click();
    await flush();

    expect(term.written.join("")).toContain("live-1");
    expect(sentKeys).toHaveLength(1);
  });

  test("履歴を取れなかったら止めずに知らせる", async () => {
    historyOk = false;
    const source = await attachAndCapture();
    lastTerminal().wheel(-120);
    await flush();
    const term = lastTerminal();
    term.written.length = 0;

    expect(status).toBe(terminalText("en").historyFailed);
    // 止まっていないので live はそのまま当たり続ける。
    source.emitScreen(frame("live-1\n"));
    await flush();
    expect(term.written.join("")).toContain("live-1");
  });
});

/** SSE の購読を掴んだ状態で attach する。 */
async function attachAndCapture(): Promise<{
  emitScreen(screen: TmuxScreen): void;
}> {
  let handler: ((event: MessageEvent<string>) => void) | null = null;
  class CapturingEventSource {
    static readonly CLOSED = 2;
    readyState = 1;
    onerror: (() => void) | null = null;
    constructor(url: string) {
      streamUrls.push(url);
    }
    addEventListener(
      type: string,
      listener: (event: MessageEvent<string>) => void,
    ): void {
      if (type === "screen") handler = listener;
    }
    close(): void {
      this.readyState = 2;
    }
  }
  Object.defineProperty(globalThis, "EventSource", {
    configurable: true,
    value: CapturingEventSource,
  });
  await handle.attach({ kind: "tmux", pane: PANE });
  return {
    emitScreen: (screen) => {
      handler?.({ data: JSON.stringify(screen) } as MessageEvent<string>);
    },
  };
}
