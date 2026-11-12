// 端末の中のプログラムが送るコピー (OSC 52)。解き方 (core/terminal-clipboard.ts) と、
// 端末に届いたときの扱い (views/terminal/terminal-screen.ts): 書くだけで読み出しは
// 断る・大きすぎるものは書かない・設定で止められる。
//
// tmux が外へ送るかの観測 (コピーモードは既定で送る、中のプログラムの OSC 52 は
// set-clipboard on のときだけ) は作業の記録にある。ここでは xterm を差し替え、
// 登録された受け口を直接呼ぶ。
import "./_dom";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../views/shell/live-hub", () => import("./_fake-live"));

import type { ShellSession } from "../core/shell";
import {
  MAX_TERMINAL_CLIPBOARD_BYTES,
  type Osc52Request,
  parseOsc52,
} from "../core/terminal-clipboard";
import { terminalText } from "../views/terminal/i18n";
import { createTerminalScreen } from "../views/terminal/terminal-screen";

type OscHandler = (data: string) => boolean | Promise<boolean>;

vi.mock("../core/xterm-loader", async () => {
  const { FakeWebglAddon } = await import("./_fake-dom");
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
    }
    registerLinkProvider = disposable;
    parser = {
      registerOscHandler: (ident: number, handler: OscHandler) => {
        (globalThis as Record<string, unknown>).__oscHandlers = {
          ...((globalThis as Record<string, unknown>).__oscHandlers as object),
          [ident]: handler,
        };
        return { dispose: noop };
      },
    };
    open = (parent: HTMLElement) => {
      this.element = document.createElement("div");
      parent.appendChild(this.element);
    };
    write = (_data: string, callback?: () => void) => callback?.();
    resize = noop;
    reset = noop;
    focus = noop;
    blur = noop;
    clear = noop;
    dispose = noop;
    loadAddon = (addon: { activate(term: FakeTerminal): void }) =>
      addon.activate(this);
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
      Promise.resolve({
        Terminal: FakeTerminal,
        FitAddon: FakeFitAddon,
        WebglAddon: FakeWebglAddon,
      }),
  };
});

const b64 = (text: string) => Buffer.from(text, "utf8").toString("base64");

describe("parseOsc52", () => {
  test.each([
    [`c;${b64("hello")}`, { kind: "write", text: "hello" }],
    // tmux は選択を空で送る
    [`;${b64("日本語")}`, { kind: "write", text: "日本語" }],
    [`p;${b64("x")}`, { kind: "write", text: "x" }],
    [`s0;${b64("x")}`, { kind: "write", text: "x" }],
    ["c;?", { kind: "read" }],
    [";?", { kind: "read" }],
  ] satisfies [string, Osc52Request][])("%j", (data, expected) => {
    expect(parseOsc52(data)).toEqual(expected);
  });

  test.each([
    ["no separator", "aGVsbG8="],
    ["unknown selection", `z;${b64("x")}`],
    ["empty payload", "c;"],
    ["not base64", "c;not*base64"],
    ["bad padding", "c;aGVsbG8"],
    ["not UTF-8", `c;${Buffer.from([0xff, 0xfe]).toString("base64")}`],
    [
      "too large",
      `c;${Buffer.alloc(MAX_TERMINAL_CLIPBOARD_BYTES + 3, 97).toString("base64")}`,
    ],
  ])("refuses %s", (_name, data) => {
    expect(parseOsc52(data).kind).toBe("invalid");
  });

  test("exactly the limit is written", () => {
    const text = "a".repeat(MAX_TERMINAL_CLIPBOARD_BYTES);
    expect(parseOsc52(`c;${b64(text)}`)).toEqual({ kind: "write", text });
  });
});

const SESSION: ShellSession = {
  id: "shell-clipboard",
  command: "/bin/sh",
  cwd: "/repo",
  createdAt: "2026-09-01T00:00:00.000Z",
  cols: 80,
  rows: 24,
  exited: false,
  exitCode: null,
  tty: "/dev/ttys001",
};

describe("a copy sent from inside the terminal", () => {
  const writes: string[] = [];
  const statuses: (string | null)[] = [];
  let allow = true;
  let writeText = vi.fn(async (text: string) => {
    writes.push(text);
  });

  beforeEach(() => {
    writes.length = 0;
    statuses.length = 0;
    allow = true;
    (globalThis as Record<string, unknown>).__oscHandlers = {};
    writeText = vi.fn(async (text: string) => {
      writes.push(text);
    });
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ images: [], rejected: [], candidates: [] }),
          ),
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
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function osc52(): Promise<OscHandler> {
    const screen = createTerminalScreen({
      getText: () => terminalText("en"),
      getFontSize: () => 13,
      allowClipboardWrite: () => allow,
      actionHeaders: () => ({}),
      trackLoad: (promise) => promise,
      onStatus: (message) => statuses.push(message),
      onTargetGone: () => undefined,
      onShellExited: () => undefined,
      tmuxWindow: () => null,
      onTmuxWindowStale: () => undefined,
      isImageShelfCollapsed: () => false,
      setImageShelfCollapsed: () => undefined,
    });
    await screen.attach(SESSION);
    const handler = (
      (globalThis as Record<string, unknown>).__oscHandlers as Record<
        number,
        OscHandler
      >
    )[52];
    if (!handler) throw new Error("the terminal did not take OSC 52");
    return handler;
  }

  test("is written to the clipboard and says so; xterm does nothing else with it", async () => {
    const handler = await osc52();
    expect(handler(`;${b64("copied in tmux")}`)).toBe(true);
    await vi.waitFor(() => expect(writes).toEqual(["copied in tmux"]));
    await vi.waitFor(() =>
      expect(statuses).toContain(terminalText("en").clipboardCopied(14)),
    );
  });

  test("a read request is refused and nothing is written", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const handler = await osc52();
    expect(handler("c;?")).toBe(true);
    expect(writeText).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("asked to read the clipboard"),
    );
  });

  test("turned off in the settings: nothing is written", async () => {
    allow = false;
    const handler = await osc52();
    handler(`c;${b64("secret")}`);
    expect(writeText).not.toHaveBeenCalled();
  });

  test("a failed write is reported with its reason", async () => {
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    writeText.mockRejectedValueOnce(new Error("Document is not focused."));
    const handler = await osc52();
    handler(`c;${b64("x")}`);
    await vi.waitFor(() =>
      expect(
        statuses.some((item) => item?.includes("Document is not focused.")),
      ).toBe(true),
    );
    expect(error).toHaveBeenCalled();
  });
});
