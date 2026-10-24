// 生きた知らせ (/_live) の入口。1 本の流しにチャンネルを足し外しし、プロジェクトの
// 通知・シェルの出力をそのチャンネルの枠に載せ替えることを、偽の通知の元で見る。
// 実際のシェルは起こさない (無いシェルを購読して gone になるところまで)。

import { afterEach, describe, expect, test, vi } from "vitest";
import {
  closeLiveStreams,
  handleLiveRoute,
  type LiveDeps,
} from "../server/live/handle";
import { createSseParser } from "../server/live/sse-parse";

const ALLOW = () => true;

afterEach(() => {
  closeLiveStreams();
  vi.restoreAllMocks();
});

function route(
  path: string,
  init: RequestInit,
  deps: LiveDeps,
  sideEffectAllowed: (req: Request) => boolean = ALLOW,
): Promise<Response | null> {
  const url = new URL(`http://127.0.0.1:0${path}`);
  return handleLiveRoute(new Request(url, init), url, deps, sideEffectAllowed);
}

function postChannels(body: unknown, deps: LiveDeps) {
  return route(
    "/_live/channels",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    deps,
  );
}

/** 流しの知らせを 1 つずつ読む。 */
function reader(response: Response) {
  if (!response.body) throw new Error("the live stream has no body");
  const source = response.body.getReader();
  const queue: Array<{ event: string; data: string }> = [];
  const parser = createSseParser((event, data) => queue.push({ event, data }));
  const decoder = new TextDecoder();
  return {
    async next(): Promise<{ event: string; data: string }> {
      for (;;) {
        const item = queue.shift();
        if (item) return item;
        const chunk = await source.read();
        if (chunk.done) throw new Error("the live stream ended");
        parser.push(decoder.decode(chunk.value, { stream: true }));
      }
    },
    cancel: () => source.cancel(),
  };
}

/** 偽のプロジェクトの通知。送る・終える・取り消されたかを外から触る。 */
function fakeEvents() {
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  const state = { cancelled: false };
  const response = new Response(
    new ReadableStream<Uint8Array>({
      start(c) {
        controller = c;
      },
      cancel() {
        state.cancelled = true;
      },
    }),
    { headers: { "Content-Type": "text/event-stream" } },
  );
  const control = () => {
    if (!controller) throw new Error("the fake events stream has not started");
    return controller;
  };
  return {
    response,
    state,
    send: (text: string) => control().enqueue(new TextEncoder().encode(text)),
    end: () => control().close(),
  };
}

function deps(openEvents: LiveDeps["openEvents"]): LiveDeps {
  return { openEvents, paneCwd: async () => process.cwd() };
}

async function openClient(liveDeps: LiveDeps) {
  const response = await route("/_live", {}, liveDeps);
  if (!response) throw new Error("/_live was not handled");
  const frames = reader(response);
  const hello = await frames.next();
  const { client } = JSON.parse(hello.data) as { client: string };
  return { frames, client, hello };
}

describe("SSE を知らせに分ける", () => {
  test.each([
    {
      name: "1 つの知らせ",
      chunks: ["event: update\ndata: {}\n\n"],
      expected: [["update", "{}"]],
    },
    {
      name: "断片の境目で行が切れる",
      chunks: ["event: up", "date\nda", "ta: 1\n", "\n"],
      expected: [["update", "1"]],
    },
    {
      name: "\\r\\n の行の終わりが断片の境目で切れる",
      chunks: ["data: a\r", "\n\r\n"],
      expected: [["message", "a"]],
    },
    {
      name: "注釈 (ping・ok) は知らせにしない",
      chunks: [": ok\n\n: ping\n\nevent: tabs\ndata: tick\n\n"],
      expected: [["tabs", "tick"]],
    },
    {
      name: "data の行が複数なら改行で継ぐ",
      chunks: ["data: a\ndata: b\n\n"],
      expected: [["message", "a\nb"]],
    },
    {
      name: "retry と id は読み捨てる",
      chunks: ["retry: 1000\nid: 7\nevent: reload\ndata: 1\n\n"],
      expected: [["reload", "1"]],
    },
  ])("$name", ({ chunks, expected }) => {
    const seen: string[][] = [];
    const parser = createSseParser((event, data) => seen.push([event, data]));
    for (const chunk of chunks) parser.push(chunk);
    expect(seen).toEqual(expected);
  });
});

describe("/_live の入口が断るもの", () => {
  test.each([
    { name: "GET on the channels", path: "/_live/channels", method: "GET" },
    { name: "POST on the stream", path: "/_live", method: "POST" },
  ])("$name: 405", async ({ path, method }) => {
    const res = await route(path, { method }, deps(vi.fn()));
    expect(res?.status).toBe(405);
  });

  test("a change without the action mark: 403", async () => {
    const res = await route(
      "/_live/channels",
      { method: "POST", body: "{}" },
      deps(vi.fn()),
      () => false,
    );
    expect(res?.status).toBe(403);
  });

  test("an unknown stream: 404 unknown-client", async () => {
    const res = await postChannels(
      { client: "0000000000000000" },
      deps(vi.fn()),
    );
    expect([res?.status, await res?.json()]).toEqual([
      404,
      {
        code: "unknown-client",
        error: "the live stream is gone; reopen /_live and subscribe again",
      },
    ]);
  });

  // 有効なシェル・ペインを渡すと購読が始まってしまうので、弾かれる値だけを見る
  // (前の /_shell/stream と /_tmux/pane-stream の id の検証を引き継ぐ)。
  test.each([
    { name: "no kind", open: { ch: "c1" } },
    {
      name: "a channel id with a capital",
      open: { ch: "C1", kind: "shell", id: "shell-abc123" },
    },
    { name: "an empty shell id", open: { ch: "c1", kind: "shell", id: "" } },
    {
      name: "a tmux pane id as a shell",
      open: { ch: "c1", kind: "shell", id: "%12" },
    },
    {
      name: "a shell id without the prefix",
      open: { ch: "c1", kind: "shell", id: "abc123" },
    },
    {
      name: "a shell metacharacter",
      open: { ch: "c1", kind: "shell", id: "shell-abc;id" },
    },
    {
      name: "a path traversal",
      open: { ch: "c1", kind: "shell", id: "shell-../etc" },
    },
    { name: "an empty pane", open: { ch: "c1", kind: "pane", pane: "" } },
    {
      name: "a pane without the prefix",
      open: { ch: "c1", kind: "pane", pane: "3" },
    },
    {
      name: "a shell id as a pane",
      open: { ch: "c1", kind: "pane", pane: "shell-abc123" },
    },
    {
      name: "a command separator",
      open: { ch: "c1", kind: "pane", pane: "%3;id" },
    },
    {
      name: "a project that is not a key",
      open: { ch: "c1", kind: "events", project: "../x" },
    },
  ])("$name: 400", async ({ open }) => {
    const liveDeps = deps(vi.fn());
    const { client } = await openClient(liveDeps);
    const res = await postChannels({ client, open: [open] }, liveDeps);
    expect(res?.status).toBe(400);
  });
});

describe("チャンネル", () => {
  test("プロジェクトの通知を、繋がった印の後にチャンネルの枠で流す", async () => {
    const upstream = fakeEvents();
    const liveDeps = deps(async () => upstream.response);
    const { frames, client } = await openClient(liveDeps);

    await postChannels(
      { client, open: [{ ch: "c1", kind: "events", project: null }] },
      liveDeps,
    );
    upstream.send(': ok\n\nevent: update\ndata: {"paths":["a"]}\n\n');

    expect([await frames.next(), await frames.next()]).toEqual([
      { event: "m", data: "c1 _open " },
      { event: "m", data: 'c1 update {"paths":["a"]}' },
    ]);
  });

  type Opened = Awaited<ReturnType<typeof openClient>> & { liveDeps: LiveDeps };
  test.each([
    {
      name: "ブラウザが外した",
      act: async ({ client, liveDeps }: Opened) => {
        await postChannels({ client, close: ["c1"] }, liveDeps);
      },
    },
    {
      name: "流しごと切れた",
      act: async ({ frames }: Opened) => {
        await frames.cancel();
      },
    },
  ])("$name: 通知の元の購読も終える", async ({ act }) => {
    const upstream = fakeEvents();
    const liveDeps = deps(async () => upstream.response);
    const opened = await openClient(liveDeps);
    await postChannels(
      {
        client: opened.client,
        open: [{ ch: "c1", kind: "events", project: null }],
      },
      liveDeps,
    );
    await opened.frames.next();

    await act({ ...opened, liveDeps });

    await vi.waitFor(() => expect(upstream.state.cancelled).toBe(true));
  });

  test("通知の元が終わったら _closed (ブラウザが開き直す)", async () => {
    const upstream = fakeEvents();
    const liveDeps = deps(async () => upstream.response);
    const { frames, client } = await openClient(liveDeps);
    await postChannels(
      { client, open: [{ ch: "c1", kind: "events", project: null }] },
      liveDeps,
    );
    await frames.next();

    upstream.end();

    expect(await frames.next()).toEqual({ event: "m", data: "c1 _closed " });
  });

  test("通知を開けなかったら、状態と本文を _failed で返す", async () => {
    const liveDeps = deps(
      async () => new Response('{"code":"backend-failed"}', { status: 503 }),
    );
    const { frames, client } = await openClient(liveDeps);

    await postChannels(
      {
        client,
        open: [{ ch: "c1", kind: "events", project: "0123456789abcdef" }],
      },
      liveDeps,
    );

    expect(await frames.next()).toEqual({
      event: "m",
      data: 'c1 _failed {"status":503,"body":"{\\"code\\":\\"backend-failed\\"}"}',
    });
  });

  test("無いシェルは gone を送って閉じる", async () => {
    const liveDeps = deps(vi.fn());
    const { frames, client } = await openClient(liveDeps);

    await postChannels(
      { client, open: [{ ch: "c2", kind: "shell", id: "shell-0000000000" }] },
      liveDeps,
    );

    expect([
      await frames.next(),
      await frames.next(),
      await frames.next(),
    ]).toEqual([
      { event: "m", data: "c2 _open " },
      { event: "m", data: "c2 gone 1" },
      { event: "m", data: "c2 _closed " },
    ]);
  });

  test("同じチャンネルを 2 度開くのは断る", async () => {
    const upstream = fakeEvents();
    const liveDeps = deps(async () => upstream.response);
    const { client } = await openClient(liveDeps);
    const open = [{ ch: "c1", kind: "events", project: null }];
    await postChannels({ client, open }, liveDeps);

    const res = await postChannels({ client, open }, liveDeps);

    expect(res?.status).toBe(400);
  });
});
