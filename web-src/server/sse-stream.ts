// ブラウザへ知らせを流し続ける SSE の応答 1 本ずつの作り。ターミナルの出力
// (/_shell/stream) と SP の 1 ペイン表示 (/_tmux/pane-stream) が同じものを使う。
//
// - 何も流れない間も 15 秒ごとに ping を送り、途中の経路に切られないようにする
// - ブラウザが切ったら (cancel)・こちらが閉じたら、onClose で渡した片付けを呼ぶ
// - 開いている流しはグループが覚え、サーバの終了時にまとめて閉じる (残ったままだと
//   終了できない)

/** 何も出力がない間も接続が生きていることを伝える間隔。 */
const KEEPALIVE_INTERVAL_MS = 15000;

const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
} as const;

export type SseStream = {
  /** 知らせを 1 つ送る。data は 1 行 (JSON など) にする。閉じた後は何もしない。 */
  send(event: string, data: string): void;
  close(): void;
  /** 閉じたとき (こちらからでも、ブラウザが切ってでも) に 1 回だけ呼ぶ片付け。 */
  onClose(cleanup: () => void): void;
  readonly closed: boolean;
};

export type SseStreamGroup = {
  /** 流しを開く。start は流しが開いた直後に呼ぶ (中で待ってから送ってもよい)。 */
  open(start: (stream: SseStream) => void): Response;
  closeAll(): void;
};

export function createSseStreamGroup(): SseStreamGroup {
  const active = new Set<SseStream>();
  const enc = new TextEncoder();

  function open(start: (stream: SseStream) => void): Response {
    let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
    let keepalive: ReturnType<typeof setInterval> | null = null;
    const cleanups: Array<() => void> = [];
    let closed = false;

    function enqueue(text: string): void {
      if (closed || !controller) return;
      try {
        controller.enqueue(enc.encode(text));
      } catch {
        // クライアントが既に切れている。流しを畳む。
        stream.close();
      }
    }

    const stream: SseStream = {
      get closed() {
        return closed;
      },
      send(event, data) {
        enqueue(`event: ${event}\ndata: ${data}\n\n`);
      },
      close() {
        if (closed) return;
        closed = true;
        if (keepalive) clearInterval(keepalive);
        keepalive = null;
        active.delete(stream);
        for (const cleanup of cleanups.splice(0)) cleanup();
        try {
          controller?.close();
        } catch {
          // 既に閉じられている (cancel 経由)。
        }
      },
      onClose(cleanup) {
        if (closed) cleanup();
        else cleanups.push(cleanup);
      },
    };

    const body = new ReadableStream<Uint8Array>({
      start(ctrl) {
        controller = ctrl;
        active.add(stream);
        start(stream);
        if (closed) return;
        keepalive = setInterval(
          () => enqueue(": ping\n\n"),
          KEEPALIVE_INTERVAL_MS,
        );
        keepalive.unref?.();
      },
      cancel() {
        stream.close();
      },
    });
    return new Response(body, { headers: SSE_HEADERS });
  }

  return {
    open,
    closeAll() {
      for (const stream of [...active]) stream.close();
    },
  };
}
