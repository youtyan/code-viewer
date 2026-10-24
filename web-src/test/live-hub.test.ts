// ブラウザ側の生きた知らせ (views/shell/live-hub.ts)。チャンネルを 1 本の /_live に
// 相乗りさせ、EventSource と同じ形で知らせを配り、切れたら購読し直すことを、
// 偽の EventSource と fetch で見る。

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { LiveSource } from "../views/shell/live-hub";

class FakeEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  static opened: FakeEventSource[] = [];
  readyState = 0;
  onerror: (() => void) | null = null;
  closed = false;
  private listeners = new Map<string, Array<(event: MessageEvent) => void>>();
  constructor(readonly url: string) {
    FakeEventSource.opened.push(this);
  }
  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  emit(type: string, data: string) {
    for (const listener of this.listeners.get(type) ?? [])
      listener(new MessageEvent(type, { data }));
  }
  close() {
    this.closed = true;
    this.readyState = 2;
  }
}

let posted: unknown[] = [];
let reply: () => Response = () => Response.json({ ok: true });

beforeEach(() => {
  FakeEventSource.opened = [];
  posted = [];
  reply = () => Response.json({ ok: true });
  vi.stubGlobal("EventSource", FakeEventSource);
  // 文書を離れる知らせ (pagehide) を受ける窓。
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      posted.push(JSON.parse(String(init.body)));
      return reply();
    }),
  );
  vi.resetModules();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function hub() {
  return import("../views/shell/live-hub");
}

/** 知らせを書き留める。 */
function record(source: LiveSource, types: string[]): string[] {
  const seen: string[] = [];
  for (const type of types)
    source.addEventListener(type, (event) =>
      seen.push(`${type}:${event.data}`),
    );
  source.onerror = () => seen.push(`onerror:${source.readyState}`);
  return seen;
}

function stream(): FakeEventSource {
  const last = FakeEventSource.opened[FakeEventSource.opened.length - 1];
  if (!last) throw new Error("no /_live stream was opened");
  return last;
}

async function settle() {
  await vi.waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled());
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("1 本の流し", () => {
  test("2 つのチャンネルは /_live 1 本に乗り、hello で 2 つとも購読する", async () => {
    const { openLiveSource } = await hub();
    openLiveSource({ kind: "events", project: "0123456789abcdef" });
    openLiveSource({ kind: "shell", id: "shell-abc123" });

    stream().emit("hello", '{"client":"k1"}');
    await settle();

    expect([FakeEventSource.opened.map((s) => s.url), posted]).toEqual([
      ["/_live"],
      [
        {
          client: "k1",
          open: [
            { kind: "events", project: "0123456789abcdef", ch: "c1" },
            { kind: "shell", id: "shell-abc123", ch: "c2" },
          ],
        },
      ],
    ]);
  });

  test("枠はそのチャンネルにだけ届き、_open で OPEN になる", async () => {
    const { openLiveSource } = await hub();
    const events = openLiveSource({ kind: "events", project: null });
    const shell = openLiveSource({ kind: "shell", id: "shell-abc123" });
    const seenEvents = record(events, ["open", "update"]);
    const seenShell = record(shell, ["open", "output"]);
    stream().emit("hello", '{"client":"k1"}');

    stream().emit("m", "c1 _open ");
    stream().emit("m", 'c2 output {"data":"a b"}');

    expect([
      events.readyState,
      seenEvents,
      shell.readyState,
      seenShell,
    ]).toEqual([1, ["open:"], 0, ['output:{"data":"a b"}']]);
  });

  test("最後のチャンネルを閉じると /_live も閉じる (外す要求は送らない)", async () => {
    const { openLiveSource } = await hub();
    const first = openLiveSource({ kind: "events", project: null });
    const second = openLiveSource({ kind: "shell", id: "shell-abc123" });
    stream().emit("hello", '{"client":"k1"}');
    await settle();
    posted = [];

    first.close();
    await settle();
    const afterFirst = { posted, closed: stream().closed };
    posted = [];
    second.close();

    expect([afterFirst, { posted, closed: stream().closed }]).toEqual([
      { posted: [{ client: "k1", close: ["c1"] }], closed: false },
      { posted: [], closed: true },
    ]);
  });
});

describe("切れたとき", () => {
  test("流しが繋ぎ直したら、error を出してから新しい hello で全部を購読し直す", async () => {
    const { openLiveSource } = await hub();
    const source = openLiveSource({ kind: "shell", id: "shell-abc123" });
    const seen = record(source, []);
    stream().emit("hello", '{"client":"k1"}');
    await settle();
    posted = [];

    stream().readyState = 0;
    stream().onerror?.();
    stream().emit("hello", '{"client":"k2"}');
    await settle();

    expect([seen, posted]).toEqual([
      ["onerror:0"],
      [
        {
          client: "k2",
          open: [{ kind: "shell", id: "shell-abc123", ch: "c1" }],
        },
      ],
    ]);
  });

  test("サーバが閉じたチャンネル (_closed) は 500ms 後に購読し直す", async () => {
    const { openLiveSource } = await hub();
    const source = openLiveSource({ kind: "events", project: null });
    const seen = record(source, []);
    stream().emit("hello", '{"client":"k1"}');
    await settle();
    posted = [];
    vi.useFakeTimers();

    stream().emit("m", "c1 _closed ");
    await vi.advanceTimersByTimeAsync(499);
    const before = [...posted];
    await vi.advanceTimersByTimeAsync(1);

    expect([seen, before, posted]).toEqual([
      ["onerror:0"],
      [],
      [{ client: "k1", open: [{ kind: "events", project: null, ch: "c1" }] }],
    ]);
  });

  test("サーバが知らない流しなら (unknown-client)、/_live を開き直す", async () => {
    const { openLiveSource } = await hub();
    openLiveSource({ kind: "events", project: null });
    reply = () =>
      Response.json({ code: "unknown-client", error: "gone" }, { status: 404 });
    const first = stream();

    first.emit("hello", '{"client":"k1"}');
    await settle();

    expect([first.closed, FakeEventSource.opened.length]).toEqual([true, 2]);
  });

  test("/_live が断られた (流しが CLOSED): 少し待ってから全部のチャンネルを閉じ、理由を出す", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const { openLiveSource } = await hub();
    const source = openLiveSource({ kind: "events", project: null });
    const seen = record(source, []);
    const errors = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    stream().readyState = FakeEventSource.CLOSED;
    stream().onerror?.();
    const before = [source.readyState, [...seen], errors.mock.calls.length];
    vi.advanceTimersByTime(200);
    expect({
      before,
      after: [source.readyState, seen, errors.mock.calls.length],
    }).toEqual({
      before: [0, [], 0],
      after: [2, ["onerror:2"], 1],
    });
  });

  test("文書を離れる途中 (pagehide が続く) なら、断られたと扱わない", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const { openLiveSource } = await hub();
    const source = openLiveSource({ kind: "events", project: null });
    const seen = record(source, []);
    const errors = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const leaving = stream();
    leaving.readyState = FakeEventSource.CLOSED;
    leaving.onerror?.();
    window.dispatchEvent(new Event("pagehide"));
    vi.advanceTimersByTime(200);
    expect([seen, errors.mock.calls.length, leaving.closed]).toEqual([
      [],
      0,
      true,
    ]);
  });

  test.each([
    {
      name: "開けなかった (_failed)",
      trigger: async () =>
        stream().emit("m", 'c1 _failed {"status":503,"body":"x"}'),
    },
    {
      name: "購読が断られた (HTTP 400)",
      trigger: async () => {
        reply = () => new Response("invalid channels to open", { status: 400 });
        stream().emit("hello", '{"client":"k2"}');
        await settle();
      },
    },
  ])(
    "$name: CLOSED にして error を出し、理由を console に出す",
    async ({ trigger }) => {
      const { openLiveSource } = await hub();
      const source = openLiveSource({ kind: "events", project: null });
      const seen = record(source, []);
      stream().emit("hello", '{"client":"k1"}');
      await settle();
      const errors = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);

      await trigger();

      expect([source.readyState, seen, errors.mock.calls.length]).toEqual([
        2,
        ["onerror:2"],
        1,
      ]);
    },
  );
});
