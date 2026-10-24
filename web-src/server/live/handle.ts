// 生きた知らせ (プロジェクトの通知・シェルの出力・SP のペインの出力) を、1 つの
// 窓につき 1 本の SSE にまとめる入口。型と枠は core/live.ts。
//
// - GET  /_live           流しを開く。最初に hello で client id を送る
// - POST /_live/channels  { client, open?: LiveOpen[], close?: string[] } で
//                         チャンネルを足す・外す
//
// ブラウザは同じサーバへの接続を 6 本までしか張らない (HTTP/1.1)。知らせごとに
// EventSource を開いていた間は、端末 4 つとページの通知で 5 本を張りっぱなしにし、
// 残りの 1 本で全部の取得を回していた。入口のサーバ (entry/server.ts) と単体の
// サーバ (preview.ts) が同じものを付ける。

import { randomBytes } from "node:crypto";
import { formatErrorDetail } from "../../core/error-detail";
import {
  isLiveOpen,
  LIVE_FRAME_EVENT,
  type LiveOpen,
  liveFrame,
  SSE_RETRY_MS,
} from "../../core/live";
import {
  dispatchRoutes,
  handleError,
  json,
  parsePostJsonBody,
  textError,
} from "../database/handle-shared";
import { startShellStream } from "../shell/handle";
import { createSseStreamGroup, type SseStream } from "../sse-stream";
import { startPaneStream } from "../tmux/pane-stream";
import { createSseParser } from "./sse-parse";

export type LiveDeps = {
  /**
   * プロジェクトの通知 (/events の SSE) を開く。project は /p/<鍵> の鍵
   * (単体のサーバでは null)。本文を読み終える・取り消すと購読が終わる。
   */
  openEvents(project: string | null): Promise<Response>;
  /** SP のペインを映すときの作業フォルダ (要求のプロジェクト)。 */
  paneCwd(req: Request): Promise<string>;
};

/** 1 本の流しに載せるチャンネルの上限。端末の枠とページの通知で足りる数。 */
const MAX_CHANNELS = 64;

/**
 * 1 本の流しに溜めてよい量。超えたら、そのとき送ったチャンネルを閉じる
 * (ブラウザは開き直し、シェルは流し直しで画面が戻る)。出力の多いシェル 1 つが、
 * 同じ流しに載ったほかの知らせを待たせ続けないため。
 */
const MAX_BACKLOG_BYTES = 4 * 1024 * 1024;

type LiveChannel = SseStream & {
  /** ブラウザが外したときの閉じ方 (_closed を送らない)。 */
  release(): void;
};

type LiveClient = {
  stream: SseStream;
  channels: Map<string, LiveChannel>;
};

const LIVE_STREAMS = createSseStreamGroup({ retryMs: SSE_RETRY_MS });
const CLIENTS = new Map<string, LiveClient>();

/** サーバの終了時。流しと、その上の全部のチャンネルを閉じる。 */
export function closeLiveStreams(): void {
  LIVE_STREAMS.closeAll();
}

function openClient(): Response {
  return LIVE_STREAMS.open((stream) => {
    const id = randomBytes(8).toString("hex");
    const client: LiveClient = { stream, channels: new Map() };
    CLIENTS.set(id, client);
    stream.onClose(() => {
      CLIENTS.delete(id);
      for (const channel of [...client.channels.values()]) channel.release();
    });
    stream.send("hello", JSON.stringify({ client: id }));
  });
}

function openChannel(client: LiveClient, ch: string): LiveChannel {
  const parent = client.stream;
  const cleanups: Array<() => void> = [];
  let closed = false;
  const finish = (notify: boolean) => {
    if (closed) return;
    closed = true;
    client.channels.delete(ch);
    for (const cleanup of cleanups.splice(0)) cleanup();
    if (notify) parent.send(LIVE_FRAME_EVENT, liveFrame(ch, "_closed", ""));
  };
  const channel: LiveChannel = {
    get closed() {
      return closed || parent.closed;
    },
    send(event, data) {
      if (channel.closed) return;
      parent.send(LIVE_FRAME_EVENT, liveFrame(ch, event, data));
      if (parent.backlog() > MAX_BACKLOG_BYTES) {
        console.error(
          `[code-viewer] live channel ${ch} closed: ${parent.backlog()} bytes are waiting to be sent`,
        );
        finish(true);
      }
    },
    close: () => finish(true),
    release: () => finish(false),
    onClose(cleanup) {
      if (closed) cleanup();
      else cleanups.push(cleanup);
    },
    backlog: () => parent.backlog(),
  };
  client.channels.set(ch, channel);
  return channel;
}

function projectLabel(project: string | null): string {
  return project ?? "(this server)";
}

/**
 * プロジェクトの通知を読み、チャンネルへ載せ替える。読み終わったら閉じる
 * (ブラウザが開き直す)。開けなかったときは投げる (呼び出し側が _failed にする)。
 */
async function startEventsChannel(
  channel: LiveChannel,
  project: string | null,
  deps: LiveDeps,
): Promise<void> {
  const response = await deps.openEvents(project);
  if (channel.closed) {
    await response.body?.cancel();
    return;
  }
  if (!response.ok || !response.body) {
    channel.send(
      "_failed",
      JSON.stringify({ status: response.status, body: await response.text() }),
    );
    channel.close();
    return;
  }
  const reader = response.body.getReader();
  channel.onClose(() => {
    reader.cancel().catch((error: unknown) => {
      console.error(
        `[code-viewer] closing the events of project ${projectLabel(project)} failed`,
        error,
      );
    });
  });
  channel.send("_open", "");
  const parser = createSseParser((event, data) => channel.send(event, data));
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      parser.push(decoder.decode(chunk.value, { stream: true }));
    }
  } catch (error) {
    if (!channel.closed)
      console.error(
        `[code-viewer] the events of project ${projectLabel(project)} broke off`,
        error,
      );
  }
  channel.close();
}

function failEventsChannel(
  channel: LiveChannel,
  project: string | null,
  error: unknown,
): void {
  console.error(
    `[code-viewer] opening the events of project ${projectLabel(project)} failed`,
    error,
  );
  channel.send(
    "_failed",
    JSON.stringify({ status: 0, body: formatErrorDetail(error) }),
  );
  channel.close();
}

async function handleChannels(req: Request, deps: LiveDeps): Promise<Response> {
  const body = await parsePostJsonBody<{
    client?: unknown;
    open?: unknown;
    close?: unknown;
  }>(req);
  if (body instanceof Response) return body;
  const client =
    typeof body.client === "string" ? CLIENTS.get(body.client) : undefined;
  if (!client) {
    return json(
      {
        code: "unknown-client",
        error: "the live stream is gone; reopen /_live and subscribe again",
      },
      404,
    );
  }
  const open = body.open ?? [];
  const close = body.close ?? [];
  if (!Array.isArray(open) || !open.every(isLiveOpen))
    return textError("invalid channels to open", 400);
  if (!Array.isArray(close) || !close.every((ch) => typeof ch === "string"))
    return textError("invalid channels to close", 400);
  const opening = open as LiveOpen[];
  const ids = new Set(opening.map((item) => item.ch));
  if (
    ids.size !== opening.length ||
    opening.some((item) => client.channels.has(item.ch))
  )
    return textError("a channel is already open", 400);
  if (client.channels.size + opening.length > MAX_CHANNELS)
    return textError(`at most ${MAX_CHANNELS} channels per stream`, 400);
  for (const ch of close) client.channels.get(ch)?.release();
  const cwd = opening.some((item) => item.kind === "pane")
    ? await deps.paneCwd(req)
    : "";
  for (const item of opening) {
    const channel = openChannel(client, item.ch);
    if (item.kind === "events") {
      startEventsChannel(channel, item.project, deps).catch((error: unknown) =>
        failEventsChannel(channel, item.project, error),
      );
      continue;
    }
    channel.send("_open", "");
    if (item.kind === "shell") startShellStream(item.id, channel);
    else startPaneStream(item.pane, cwd, channel);
  }
  return json({ ok: true });
}

export function handleLiveRoute(
  req: Request,
  url: URL,
  deps: LiveDeps,
  sideEffectAllowed: (req: Request) => boolean,
): Promise<Response | null> {
  return dispatchRoutes(
    req,
    url,
    {
      "/_live": {
        methods: ["GET"],
        sideEffect: false,
        handler: async () => openClient(),
      },
      "/_live/channels": {
        methods: ["POST"],
        sideEffect: true,
        handler: () => handleChannels(req, deps),
      },
    },
    sideEffectAllowed,
    (res) => res,
    (err) => handleError("live", "handle live request", err),
  );
}
