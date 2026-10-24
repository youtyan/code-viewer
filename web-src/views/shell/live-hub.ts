// 生きた知らせ (プロジェクトの通知・シェルの出力・SP のペインの出力) を、サーバへの
// 1 本の SSE (/_live) にまとめる。型と枠は core/live.ts、サーバは server/live/handle.ts。
//
// ブラウザは同じサーバへの接続を 6 本までしか張らない (HTTP/1.1)。知らせごとに
// EventSource を開いていた間は、端末 4 つとページの通知で 5 本を張りっぱなしにし、
// 残りの 1 本で全部の取得を回していた。
//
// openLiveSource は EventSource と同じ形 (readyState・addEventListener・onerror・
// close) を返し、呼び出し側は流しが相乗りしていることを知らない。
// - チャンネルが 1 つも無い間は /_live も閉じる (隠れたページが接続を持ち続けない)
// - /_live が切れて繋ぎ直したら (新しい hello)、開いているチャンネルを全部購読し直す
// - サーバがチャンネルを閉じたら (_closed)、少し待って購読し直す (EventSource の
//   繋ぎ直しと同じ)。開けなかったら (_failed) 閉じたままにする (EventSource の CLOSED)

import { apiUrl } from "../../core/api-url";
import { responseErrorMessage } from "../../core/error-detail";
import {
  LIVE_FRAME_EVENT,
  type LiveOpen,
  type LiveSpec,
  parseLiveFrame,
  SSE_RETRY_MS,
} from "../../core/live";
import { UNINTERRUPTIBLE_REQUEST_HEADER } from "../../core/network-activity";

export type LiveSource = {
  readonly readyState: number;
  onerror: ((event: Event) => void) | null;
  addEventListener(
    type: string,
    listener: (event: MessageEvent<string>) => void,
  ): void;
  close(): void;
};

const CONNECTING = 0;
const OPEN = 1;
const CLOSED = 2;

type Channel = {
  ch: string;
  spec: LiveSpec;
  state: number;
  listeners: Map<string, Array<(event: MessageEvent<string>) => void>>;
  source: LiveSource;
  reopenTimer: ReturnType<typeof setTimeout> | null;
};

let stream: EventSource | null = null;
let client: string | null = null;
let sequence = 0;
const channels = new Map<string, Channel>();

export function openLiveSource(spec: LiveSpec): LiveSource {
  sequence += 1;
  const ch = `c${sequence.toString(36)}`;
  const listeners = new Map<
    string,
    Array<(event: MessageEvent<string>) => void>
  >();
  const channel: Channel = {
    ch,
    spec,
    state: CONNECTING,
    listeners,
    reopenTimer: null,
    source: {
      get readyState() {
        return channel.state;
      },
      onerror: null,
      addEventListener(type, listener) {
        listeners.set(type, [...(listeners.get(type) ?? []), listener]);
      },
      close: () => closeChannel(channel),
    },
  };
  channels.set(ch, channel);
  if (client) subscribe([channel]);
  else connect();
  return channel.source;
}

function emit(channel: Channel, type: string, data: string): void {
  const event = new MessageEvent<string>(type, { data });
  for (const listener of channel.listeners.get(type) ?? []) listener(event);
  if (type === "error") channel.source.onerror?.(event);
}

/**
 * 断られたと決めるまでの間。文書を離れる (読み直し・外側のページが面を閉じた・
 * 面を移した) ときも、Chrome は pagehide より先に流れを切って、断られたときと
 * 同じ error を出す。離れる文書ではこの間のタイマーは動かない。
 */
const LEAVE_GRACE_MS = 200;
let leaveWatched = false;

function connect(): void {
  if (stream) return;
  if (!leaveWatched) {
    leaveWatched = true;
    window.addEventListener("pagehide", () => {
      stream?.close();
      stream = null;
      client = null;
    });
  }
  const opened = new EventSource(apiUrl("live"));
  stream = opened;
  opened.addEventListener("hello", (event) => {
    client = (
      JSON.parse((event as MessageEvent<string>).data) as {
        client: string;
      }
    ).client;
    subscribe([...channels.values()]);
  });
  opened.addEventListener(LIVE_FRAME_EVENT, (event) => {
    const text = (event as MessageEvent<string>).data;
    const frame = parseLiveFrame(text);
    if (!frame) {
      console.error("[code-viewer] a live frame has no channel", text);
      return;
    }
    const channel = channels.get(frame.ch);
    if (channel) receive(channel, frame.event, frame.data);
  });
  opened.onerror = () => {
    if (stream !== opened) return;
    client = null;
    if (opened.readyState === EventSource.CLOSED) {
      // /_live が断られた (EventSource は繋ぎ直さない)。開いていたチャンネルも閉じる。
      setTimeout(() => {
        if (stream !== opened) return;
        console.error(
          "[code-viewer] the live stream (/_live) was refused; closing its channels",
        );
        stream = null;
        for (const channel of [...channels.values()]) failChannel(channel);
      }, LEAVE_GRACE_MS);
      return;
    }
    // 繋ぎ直している間。次の hello で全部を購読し直す。
    for (const channel of channels.values()) {
      if (channel.state === CLOSED) continue;
      channel.state = CONNECTING;
      emit(channel, "error", "");
    }
  };
}

function receive(channel: Channel, event: string, data: string): void {
  if (event === "_open") {
    channel.state = OPEN;
    emit(channel, "open", "");
    return;
  }
  if (event === "_closed") {
    channel.state = CONNECTING;
    emit(channel, "error", "");
    if (channel.reopenTimer) clearTimeout(channel.reopenTimer);
    channel.reopenTimer = setTimeout(() => {
      channel.reopenTimer = null;
      if (channels.get(channel.ch) === channel && client) subscribe([channel]);
    }, SSE_RETRY_MS);
    return;
  }
  if (event === "_failed") {
    console.error(
      "[code-viewer] a live channel could not be opened",
      channel.spec,
      data,
    );
    failChannel(channel);
    return;
  }
  emit(channel, event, data);
}

/** 開けなかった。EventSource の CLOSED と同じく、閉じた状態で error を出す。 */
function failChannel(channel: Channel): void {
  forget(channel);
  emit(channel, "error", "");
}

function closeChannel(channel: Channel): void {
  if (channel.state === CLOSED) return;
  forget(channel);
  if (client) {
    postChannels({ client, close: [channel.ch] }).then(
      (result) => {
        if (result instanceof Error)
          console.error(
            "[code-viewer] closing a live channel was refused",
            channel.spec,
            result,
          );
      },
      (error: unknown) => {
        console.error(
          "[code-viewer] closing a live channel did not reach the server",
          channel.spec,
          error,
        );
      },
    );
  }
}

function forget(channel: Channel): void {
  channel.state = CLOSED;
  if (channel.reopenTimer) clearTimeout(channel.reopenTimer);
  channel.reopenTimer = null;
  channels.delete(channel.ch);
  if (channels.size > 0 || !stream) return;
  stream.close();
  stream = null;
  client = null;
}

function subscribe(list: Channel[]): void {
  const id = client;
  if (!id || list.length === 0) return;
  const open: LiveOpen[] = list.map((channel) => ({
    ...channel.spec,
    ch: channel.ch,
  }));
  const alive = () => list.filter((c) => channels.get(c.ch) === c);
  postChannels({ client: id, open }).then(
    (result) => {
      if (result === "ok" || id !== client) return;
      if (result === "unknown-client") {
        // サーバがこの流しを知らない (起き直した)。開き直し、次の hello で購読し直す。
        stream?.close();
        stream = null;
        client = null;
        connect();
        return;
      }
      // サーバが断った (EventSource が 200 以外を受けたのと同じ)。閉じたままにする。
      console.error(
        "[code-viewer] subscribing to live channels was refused",
        open,
        result,
      );
      for (const channel of alive()) failChannel(channel);
    },
    (error: unknown) => {
      // 届かなかった (サーバが落ちている・通信が切れた)。EventSource と同じく
      // 待って購読し直す。流しも切れていれば、次の hello が購読し直す。
      console.error(
        "[code-viewer] subscribing to live channels did not reach the server",
        open,
        error,
      );
      setTimeout(() => {
        if (id === client) subscribe(alive());
      }, SSE_RETRY_MS);
    },
  );
}

/** 購読を足す・外す。HTTP で断られたら理由の Error を返し、届かなかったら投げる。 */
async function postChannels(body: {
  client: string;
  open?: LiveOpen[];
  close?: string[];
}): Promise<"ok" | "unknown-client" | Error> {
  const response = await fetch(apiUrl("liveChannels"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Code-Viewer-Action": "1",
      [UNINTERRUPTIBLE_REQUEST_HEADER]: "1",
    },
    body: JSON.stringify(body),
  });
  if (response.ok) return "ok";
  if (
    response.status === 404 &&
    response.headers.get("content-type")?.startsWith("application/json")
  ) {
    const detail = (await response.json()) as { code?: unknown };
    if (detail.code === "unknown-client") return "unknown-client";
    return new Error(
      `update live channels (HTTP 404): ${JSON.stringify(detail)}`,
    );
  }
  return new Error(
    await responseErrorMessage(response, "update live channels"),
  );
}
