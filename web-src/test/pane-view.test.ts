// SP の 1 ペイン表示のふるまい。流しから届いた画面と出力を「読む」画面に出し、
// 選択肢・操作札・返事を /_tmux/pane-input へ送る。端末は本物の xterm を画面に
// 出さずに使い、流し (EventSource) と送信 (fetch) は偽物にする。

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
import type { TmuxPaneSnapshot } from "../core/tmux";

vi.mock("../core/xterm-loader", () => ({
  loadXterm: async () => ({
    Terminal: (await import("@xterm/xterm")).Terminal,
  }),
}));

import { terminalText } from "../views/terminal/i18n";
import {
  createPaneView,
  type PaneViewHandle,
} from "../views/terminal/pane-view";

type Source = {
  url: string;
  closed: boolean;
  emit(event: string, data: unknown): void;
};

const sources: Source[] = [];
const posted: unknown[] = [];
let reply: () => Response = () => new Response('{"ok":true}');

beforeAll(() => {
  GlobalRegistrator.register();
  class FakeEventSource {
    static readonly CLOSED = 2;
    readyState = 1;
    onerror: (() => void) | null = null;
    private handlers = new Map<string, (event: MessageEvent<string>) => void>();
    constructor(url: string) {
      const source: Source = {
        url,
        closed: false,
        emit: (event, data) =>
          this.handlers.get(event)?.({
            data: JSON.stringify(data),
          } as MessageEvent<string>),
      };
      sources.push(source);
      this.close = () => {
        source.closed = true;
        this.readyState = 2;
      };
    }
    close: () => void;
    addEventListener(
      type: string,
      handler: (event: MessageEvent<string>) => void,
    ): void {
      this.handlers.set(type, handler);
    }
  }
  Object.defineProperty(globalThis, "EventSource", {
    configurable: true,
    value: FakeEventSource,
  });
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: async (_input: string, init?: RequestInit) => {
      posted.push(JSON.parse(String(init?.body)));
      return reply();
    },
  });
});

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

function snapshot(content: string, extra: Partial<TmuxPaneSnapshot> = {}) {
  return {
    pane: "%3",
    content,
    width: 40,
    height: content.split("\n").length,
    cursorX: 0,
    cursorY: 0,
    historyLines: 0,
    cursorVisible: true,
    alternate: false,
    appCursorKeys: false,
    appKeypad: false,
    insert: false,
    wrap: true,
    origin: false,
    scrollTop: 0,
    scrollBottom: content.split("\n").length - 1,
    ...extra,
  };
}

let view: PaneViewHandle;
const onClose = vi.fn();

function shownText(): string[] {
  return [...view.el.querySelectorAll(".pane-line")].map(
    (line) => line.textContent ?? "",
  );
}

async function openWith(content: string, extra?: Partial<TmuxPaneSnapshot>) {
  view.open("%3");
  await vi.waitFor(() => expect(sources).toHaveLength(1));
  sources[0].emit("snapshot", snapshot(content, extra));
  await vi.waitFor(() => expect(shownText().length).toBeGreaterThan(0));
}

beforeEach(() => {
  sources.length = 0;
  posted.length = 0;
  reply = () => new Response('{"ok":true}');
  onClose.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  view = createPaneView({
    getText: () => terminalText("en"),
    describePane: () => ({
      title: "claude",
      detail: "Needs input",
      state: "waiting",
    }),
    actionHeaders: () => ({ "X-Code-Viewer-Action": "1" }),
    trackLoad: (promise) => promise,
    onClose,
  });
  document.body.append(view.el);
});

afterEach(() => {
  view.handlePopState();
  view.dispose();
  vi.restoreAllMocks();
});

describe("流しから届いた画面", () => {
  test("そのペインの流しを繋ぎ、届いた画面を出す", async () => {
    await openWith("hello world\nsecond line");
    expect([sources[0].url, shownText()]).toEqual([
      "/_tmux/pane-stream?pane=%253",
      ["hello world", "second line"],
    ]);
  });

  test("続きの出力を後ろに足す", async () => {
    await openWith("first", { cursorX: 5 });
    sources[0].emit("output", { data: "\r\nnext" });
    await vi.waitFor(() => expect(shownText()).toEqual(["first", "next"]));
  });

  // 最初は後ろの 600 行だけを描く。上端で止まったら、押さなくても前を足す
  // (「前の出力」を押さないと履歴が読めなかった)。動いている間は足さない
  // (足すと iOS の慣性のスクロールが止まって跳ぶ)。
  test("上端で止まると、前の出力を足す", async () => {
    const lines = Array.from(
      { length: 700 },
      (_, index) => `line ${index + 1}`,
    );
    await openWith(lines.join("\n"));
    const before = [shownText().length, shownText()[0]];
    const body = view.el.querySelector<HTMLElement>(".pane-view-body");
    if (!body) throw new Error("missing .pane-view-body");
    body.scrollTop = 0;
    body.dispatchEvent(new Event("scroll"));
    const whileMoving = shownText().length;
    await vi.waitFor(() => expect(shownText()).toHaveLength(700));
    expect({
      before,
      whileMoving,
      after: [shownText().length, shownText()[0]],
      olderHidden:
        view.el.querySelector<HTMLElement>(".pane-view-older")?.hidden,
    }).toEqual({
      before: [600, "line 101"],
      whileMoving: 600,
      after: [700, "line 1"],
      olderHidden: true,
    });
  });

  // Claude Code が作業中は印が 1 秒に何度も書き換わる。そのたびに全部の行を
  // 描き直すと、スマホが固まった。書き換わるのは端末の画面の行だけ。
  test("続きの出力では、確定した行 (端末の過去の行) を描き直さない", async () => {
    const lines = Array.from({ length: 30 }, (_, index) => `line ${index + 1}`);
    await openWith(lines.join("\n"), { height: 5, cursorX: 7, cursorY: 4 });
    const first = view.el.querySelector(".pane-line");
    sources[0].emit("output", { data: "\r\nnext" });
    await vi.waitFor(() =>
      expect(shownText()[shownText().length - 1]).toBe("next"),
    );
    expect({
      same: view.el.querySelector(".pane-line") === first,
      count: shownText().length,
      first: shownText()[0],
    }).toEqual({ same: true, count: 31, first: "line 1" });
  });

  // 続きが届くたびに一番下へ寄せていたので、指でゆっくり上へ送ろうとすると
  // 0.1 秒ほどで引き戻された。触れている間は寄せず、離したら続きを描く。
  test("指で触れている間は、続きが来ても一番下へ引き戻さない", async () => {
    await openWith("first", { cursorX: 5 });
    const body = view.el.querySelector<HTMLElement>(".pane-view-body");
    if (!body) throw new Error("missing .pane-view-body");
    body.dispatchEvent(new Event("touchstart"));
    sources[0].emit("output", { data: "\r\nnext" });
    await new Promise((resolve) => setTimeout(resolve, 250));
    const whileTouching = shownText();
    body.dispatchEvent(new Event("touchend"));
    expect({ whileTouching, released: shownText() }).toEqual({
      whileTouching: ["first"],
      released: ["first", "next"],
    });
  });

  // 下端から 32px までを一番下とみなしていたので、少しだけ上へ送って離すと
  // 引き戻された。
  test("一番下から少しでも上へ送ったら、続きが来ても引き戻さない", async () => {
    await openWith("first", { cursorX: 5 });
    const body = view.el.querySelector<HTMLElement>(".pane-view-body");
    if (!body) throw new Error("missing .pane-view-body");
    for (const [name, value] of [
      ["scrollHeight", 1000],
      ["clientHeight", 500],
      ["scrollTop", 480],
    ] as const)
      Object.defineProperty(body, name, {
        configurable: true,
        writable: true,
        value,
      });
    body.dispatchEvent(new Event("scroll"));
    sources[0].emit("output", { data: "\r\nnext" });
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect({
      shown: shownText(),
      latest: view.el.querySelector<HTMLElement>(".pane-view-latest")?.hidden,
      scrollTop: body.scrollTop,
    }).toEqual({ shown: ["first"], latest: false, scrollTop: 480 });
  });

  // 描く範囲 (後ろの 600 行) の先頭が段落の続きの行に当たっても、段落の頭から
  // 描く (続きだけが 1 行目に出て、前の出力を足すとそこで文が切れた)。
  test("描く範囲の先頭が段落の続きなら、段落の頭から描く", async () => {
    const lines = [
      ...Array.from({ length: 98 }, (_, index) => `l${index}`),
      "",
      "  hello world this",
      "  wraps here",
      ...Array.from({ length: 599 }, (_, index) => `m${index}`),
    ];
    await openWith(lines.join("\n"), { width: 20 });
    expect(shownText()[0]).toBe("  hello world this wraps here");
  });

  // PC のペインが低いと、作業中の印の行や入力欄の罫線が過去の行に溜まり、読む
  // 画面がそれで埋まった。過去の行からは外し、今の画面の行は全部出す。
  test("過去の行の作業中の表示は出さず、今の画面の行は全部出す", async () => {
    await openWith(
      [
        "✻ Twisting… (1s)",
        "─".repeat(20),
        "  real content",
        "x",
        "✻ Working… (2s)",
        "y",
      ].join("\n"),
      { height: 3, cursorX: 1, cursorY: 2 },
    );
    expect(shownText()).toEqual([
      "  real content",
      "x",
      "✻ Working… (2s)",
      "y",
    ]);
  });

  // 全画面で描くエージェント (Claude Code の全画面表示) は会話と入力欄の間を空行で
  // 埋めるので、読む画面が 50 行以上の空白になった。「PC と同じ」は画面のまま。
  test.each([
    { mode: "read", shown: ["reply", "", "✻ Working…", "❯"] },
    { mode: "screen", shown: ["reply", "", "", "", "✻ Working…", "❯"] },
  ] as const)("今の画面の続く空行: $mode", async ({ mode, shown }) => {
    await openWith("reply\n\n\n\n✻ Working…\n❯", {
      height: 6,
      cursorX: 1,
      cursorY: 5,
    });
    if (mode === "screen") {
      view.el
        .querySelector<HTMLButtonElement>(".pane-view-mode button:last-child")
        ?.click();
    }
    await vi.waitFor(() => expect(shownText()).toEqual(shown));
  });

  // ログインのペインの承認の URL をスマホのブラウザで開く (文字のままでは押せず、
  // 長くて選べなかった)。色の区切りをまたぐ URL も 1 つのリンク先にする。
  test("出力の中の URL を別のタブで開くリンクにする", async () => {
    await openWith(
      "visit: https://example.com/\x1b[33mauth?code=true\x1b[0m done",
    );
    const links = [
      ...view.el.querySelectorAll<HTMLAnchorElement>(".pane-link"),
    ];
    expect(
      links.map((link) => [
        link.getAttribute("href"),
        link.textContent,
        link.target,
        link.rel,
      ]),
    ).toEqual([
      [
        "https://example.com/auth?code=true",
        "https://example.com/",
        "_blank",
        "noopener noreferrer",
      ],
      [
        "https://example.com/auth?code=true",
        "auth?code=true",
        "_blank",
        "noopener noreferrer",
      ],
    ]);
  });

  test("画面と過去の行を消したら、消えた行を出さない", async () => {
    const lines = Array.from({ length: 30 }, (_, index) => `line ${index + 1}`);
    await openWith(lines.join("\n"), { height: 5, cursorX: 7, cursorY: 4 });
    sources[0].emit("output", { data: "\x1b[2J\x1b[3J\x1b[Hfresh" });
    await vi.waitFor(() => expect(shownText()).toEqual(["fresh"]));
  });

  // 読む画面の長い中身が隠れて箱が短くなっても、iPhone の Safari はスクロールの
  // 位置を戻さず、何も無い所を映して真っ黒になった。
  test("端末 (別画面) に切り替えたら、本文の箱を一番上から出す", async () => {
    await openWith("ready", { alternate: true });
    const body = view.el.querySelector<HTMLElement>(".pane-view-body");
    if (!body) throw new Error("missing .pane-view-body");
    Object.defineProperty(body, "scrollTop", {
      configurable: true,
      writable: true,
      value: 5000,
    });
    view.el
      .querySelector<HTMLButtonElement>('.pane-view-mode [data-mode="screen"]')
      ?.click();
    expect(body.scrollTop).toBe(0);
  });

  // 端末だけでは、高さの低いペイン (PC で 7 行) は入力欄と状態の数行しか見えず、
  // 過去の行も読めなかった。通常の画面は読む画面と同じ行を PC の桁で折り返して
  // 出し、別画面 (vim など全画面のアプリ) だけ端末を出す。
  test.each([
    {
      name: "通常の画面は、PC の桁で折り返した文 (過去の行も読める)",
      extra: { height: 5, cursorX: 7, cursorY: 4 },
      expected: { read: true, grid: true, terminal: false, lines: 30 },
    },
    {
      name: "別画面 (vim など) は端末",
      extra: { alternate: true },
      expected: { read: false, grid: false, terminal: true, lines: 30 },
    },
  ])("画面: $name", async ({ extra, expected }) => {
    const lines = Array.from({ length: 30 }, (_, index) => `line ${index + 1}`);
    await openWith(lines.join("\n"), extra);
    view.el
      .querySelector<HTMLButtonElement>('.pane-view-mode [data-mode="screen"]')
      ?.click();
    await new Promise((resolve) => setTimeout(resolve, 150));
    const read = view.el.querySelector<HTMLElement>(".pane-view-read");
    const screen = view.el.querySelector<HTMLElement>(".pane-view-screen");
    expect({
      read: read?.hidden === false,
      grid: read?.classList.contains("is-grid"),
      terminal: screen?.hidden === false,
      lines: shownText().length,
    }).toEqual(expected);
  });

  test("閉じた後に届いた知らせは描かない", async () => {
    await openWith("first");
    view.handlePopState();
    sources[0].emit("snapshot", snapshot("late"));
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect([view.el.hidden, shownText(), sources[0].closed]).toEqual([
      true,
      [],
      true,
    ]);
  });
});

// 電話から写真・スクショを渡す。PC のターミナルに貼ったときと同じ場所に保存して
// もらい、パスを返事の欄に足す (文を書き足してから送れるよう、送らない)。
describe("画像の添付", () => {
  function pick(files: File[]): void {
    const picker = view.el.querySelector<HTMLInputElement>(".pane-view-picker");
    if (!picker) throw new Error("missing .pane-view-picker");
    Object.defineProperty(picker, "files", {
      configurable: true,
      value: files,
    });
    picker.dispatchEvent(new Event("change"));
  }
  const field = () => {
    const input =
      view.el.querySelector<HTMLTextAreaElement>(".pane-view-input");
    if (!input) throw new Error("missing .pane-view-input");
    return input;
  };
  const statusText = () =>
    view.el.querySelector(".pane-view-status")?.textContent ?? "";

  test("選んだ画像を保存してもらい、そのパスを返事の欄の後ろに足す", async () => {
    await openWith("ready");
    field().value = "これを見て";
    reply = () =>
      new Response(
        JSON.stringify({
          path: "/repo/.code-viewer/pasted/pasted-image-1.png",
          relativePath: ".code-viewer/pasted/pasted-image-1.png",
          name: "pasted-image-1.png",
          bytes: 3,
        }),
      );
    pick([
      new File([new Uint8Array([1, 2, 3])], "photo.png", { type: "image/png" }),
    ]);
    await vi.waitFor(() =>
      expect(field().value).toBe(
        "これを見て '/repo/.code-viewer/pasted/pasted-image-1.png' ",
      ),
    );
    expect(posted).toEqual([{ mime: "image/png", data: "AQID" }]);
  });

  test.each([
    {
      name: "受け付けない種類は送らずに理由を出す",
      file: () => new File(["x"], "notes.pdf", { type: "application/pdf" }),
      answer: () => new Response("{}"),
      expected: { status: "notes.pdf", posted: 0 },
    },
    {
      name: "保存できなかったら理由を出す",
      file: () =>
        new File([new Uint8Array([1])], "big.png", { type: "image/png" }),
      answer: () => new Response("image too large", { status: 400 }),
      expected: { status: "image too large", posted: 1 },
    },
  ])("$name", async ({ file, answer, expected }) => {
    await openWith("ready");
    reply = answer;
    pick([file()]);
    await vi.waitFor(() => expect(statusText()).toContain(expected.status));
    expect({ field: field().value, posted: posted.length }).toEqual({
      field: "",
      posted: expected.posted,
    });
  });
});

describe("送る", () => {
  test("選択肢を押すとその番号を送る", async () => {
    await openWith("Proceed?\n❯ 1. Yes\n  2. No");
    const buttons = [
      ...view.el.querySelectorAll<HTMLButtonElement>(".pane-view-choice"),
    ];
    buttons[1]?.click();
    await vi.waitFor(() => expect(posted).toHaveLength(1));
    expect([buttons.map((button) => button.textContent), posted[0]]).toEqual([
      ["1Yes", "2No"],
      { pane: "%3", keys: "2", generation: 1 },
    ]);
  });

  test.each([
    { name: "Esc", key: "escape", appCursorKeys: false, expected: "\u001b" },
    { name: "Enter", key: "enter", appCursorKeys: false, expected: "\r" },
    { name: "↑ (通常)", key: "up", appCursorKeys: false, expected: "\u001b[A" },
    {
      name: "↑ (アプリ向けの矢印)",
      key: "up",
      appCursorKeys: true,
      expected: "\u001bOA",
    },
  ])("操作札 $name", async ({ key, appCursorKeys, expected }) => {
    await openWith("ready", { appCursorKeys });
    view.el
      .querySelector<HTMLButtonElement>(`.mobile-key[data-key="${key}"]`)
      ?.click();
    await vi.waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toEqual({ pane: "%3", keys: expected, generation: 1 });
  });

  test.each([
    {
      name: "書いた文は貼って Enter",
      typed: "run the tests",
      expected: {
        pane: "%3",
        text: "run the tests",
        enter: true,
        generation: 1,
      },
    },
    {
      name: "空なら Enter だけ",
      typed: "   ",
      expected: { pane: "%3", enter: true, generation: 1 },
    },
  ])("返事: $name", async ({ typed, expected }) => {
    await openWith("ready");
    const input =
      view.el.querySelector<HTMLTextAreaElement>(".pane-view-input");
    if (!input) throw new Error("no reply field");
    input.value = typed;
    view.el.querySelector("form")?.requestSubmit();
    await vi.waitFor(() => expect(input.value).toBe(""));
    expect(posted).toEqual([expected]);
  });

  test("送れなかったら返事を残して理由を出す", async () => {
    reply = () => new Response("tmux exited with 1", { status: 500 });
    await openWith("ready");
    const input =
      view.el.querySelector<HTMLTextAreaElement>(".pane-view-input");
    if (!input) throw new Error("no reply field");
    input.value = "keep me";
    view.el.querySelector("form")?.requestSubmit();
    const status = view.el.querySelector(".pane-view-status");
    await vi.waitFor(() =>
      expect(status?.textContent).toContain("tmux exited with 1"),
    );
    expect(input.value).toBe("keep me");
  });
});

describe("終わり", () => {
  test.each([
    {
      name: "流しがペインの終わりを知らせた",
      end: () => sources[0].emit("gone", 1),
    },
    {
      name: "送ったらペインがもう無かった",
      end: () => {
        reply = () => new Response("pane %3 is gone", { status: 410 });
        view.el
          .querySelector<HTMLButtonElement>('.mobile-key[data-key="enter"]')
          ?.click();
      },
    },
  ])("$name: 理由を出して入力を止める", async ({ end }) => {
    await openWith("ready");
    end();
    const input =
      view.el.querySelector<HTMLTextAreaElement>(".pane-view-input");
    await vi.waitFor(() =>
      expect(view.el.querySelector(".pane-view-status")?.textContent).toBe(
        "This pane has closed.",
      ),
    );
    expect(input?.disabled).toBe(true);
  });

  test("閉じると履歴を 1 つ戻し、戻るの知らせで閉じる", async () => {
    const back = vi.spyOn(history, "back").mockImplementation(() => undefined);
    await openWith("ready");
    view.close();
    const beforePop = view.el.hidden;
    const handled = view.handlePopState();
    expect([
      back.mock.calls.length,
      beforePop,
      handled,
      view.el.hidden,
      onClose.mock.calls,
    ]).toEqual([1, false, true, true, [["%3"]]]);
  });

  // タブ列・帯から移るときは、戻るで履歴を降ろしてから移る (先に移ると、降ろす
  // 戻るがその移動を取り消した)。開いていなければすぐ移る。
  test("closeThen は戻るの知らせで閉じてから呼ぶ", async () => {
    vi.spyOn(history, "back").mockImplementation(() => undefined);
    const calls: string[] = [];
    await openWith("ready");
    view.closeThen(() =>
      calls.push(view.el.hidden ? "next-after-close" : "next-while-open"),
    );
    calls.push("before-pop");
    view.handlePopState();
    view.closeThen(() => calls.push("next-when-closed"));
    expect(calls).toEqual([
      "before-pop",
      "next-after-close",
      "next-when-closed",
    ]);
  });

  // 引き出し・＋のメニューから開いたペインは、戻るでその場所へ戻す (戻った先が
  // 開く前と違う画面だった)。
  test.each([
    { name: "ブラウザの戻る", act: () => view.handlePopState(), expected: 1 },
    { name: "別のペインへ開き直した", act: () => view.open("%4"), expected: 0 },
  ])("開いた場所へ戻す: $name", ({ act, expected }) => {
    vi.spyOn(history, "back").mockImplementation(() => undefined);
    const reopen = vi.fn();
    view.open("%3", reopen);
    act();
    expect(reopen).toHaveBeenCalledTimes(expected);
  });
});
