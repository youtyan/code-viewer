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

  test("戻るボタンは履歴を 1 つ戻し、戻るの知らせで閉じる", async () => {
    const back = vi.spyOn(history, "back").mockImplementation(() => undefined);
    await openWith("ready");
    view.el.querySelector<HTMLButtonElement>(".pane-view-back")?.click();
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
});
