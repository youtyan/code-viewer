// シェルセッションの HTTP 入口。
//
// - GET  /_shell/list             開いているシェルの一覧
// - POST /_shell/create           新しいシェルを開く
// - GET  /_shell/stream?id=shell-…  そのシェルの出力を SSE で流し続ける
// - POST /_shell/keys             そのシェルへ入力を送る
// - POST /_shell/resize           そのシェルの桁数・行数を変える
// - POST /_shell/close            そのシェルを終了する
//
// ルーティングと副作用リクエストの認可は tmux 側と同じく dispatchRoutes に
// 任せる。tmux との違いは購読の形で、あちらは画面を取り直して丸ごと置き換え
// るのに対し、こちらは PTY が吐いた分だけを順に流す。だから poll を持たず、
// onData をそのまま SSE へ橋渡しする。

import {
  isShellSessionId,
  MAX_SHELL_SESSIONS,
  type ShellSessionId,
} from "../../core/shell";
import {
  dispatchRoutes,
  handleError,
  json,
  parsePostJsonBody,
  textError,
} from "../database/handle-shared";
import {
  closeShellSession,
  createShellSession,
  describeShellAvailability,
  listShellSessions,
  resizeShell,
  subscribeShell,
  writeToShell,
} from "./session";

/** 何も出力がない間も接続が生きていることを伝える間隔 (tmux 側と同じ)。 */
const KEEPALIVE_INTERVAL_MS = 15000;

/** 1 回の送信で受け付ける入力の長さ。貼り付けを想定して広めに取る。 */
const MAX_KEY_INPUT_LENGTH = 100_000;

const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
} as const;

type ActiveStream = { close(): void };

/** 開いている購読。サーバ終了時にまとめて閉じる。 */
const activeStreams = new Set<ActiveStream>();

/** preview.ts の shutdown から呼ぶ。購読が残ったままだと終了できない。 */
export function closeShellStreams(): void {
  for (const stream of [...activeStreams]) stream.close();
}

function createShellStreamResponse(id: ShellSessionId): Response {
  const enc = new TextEncoder();
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  let keepaliveTimer: ReturnType<typeof setInterval> | null = null;
  let subscription: { unsubscribe(): void } | null = null;
  let closed = false;

  const entry: ActiveStream = {
    close() {
      stop();
    },
  };

  function send(event: string, data: string): void {
    if (closed || !controller) return;
    try {
      controller.enqueue(enc.encode(`event: ${event}\ndata: ${data}\n\n`));
    } catch {
      // クライアントが既に切れている。購読を畳む。
      stop();
    }
  }

  function stop(): void {
    if (closed) return;
    closed = true;
    if (keepaliveTimer) clearInterval(keepaliveTimer);
    keepaliveTimer = null;
    subscription?.unsubscribe();
    subscription = null;
    activeStreams.delete(entry);
    try {
      controller?.close();
    } catch {
      // 既に閉じられている (cancel 経由)。
    }
  }

  const stream = new ReadableStream<Uint8Array>({
    start(ctrl) {
      controller = ctrl;
      activeStreams.add(entry);
      const sub = subscribeShell(
        id,
        (chunk) => send("output", JSON.stringify({ data: chunk })),
        (exitCode) => {
          send("exited", JSON.stringify({ exitCode }));
          stop();
        },
      );
      if (!sub) {
        send("gone", "1");
        stop();
        return;
      }
      subscription = sub;
      send("open", "ok");
      // 購読していない間に出ていた分を先に流す。開き直したときに画面が
      // 真っ白にならない。
      if (sub.replay) send("output", JSON.stringify({ data: sub.replay }));
      keepaliveTimer = setInterval(() => {
        if (closed || !controller) return;
        try {
          controller.enqueue(enc.encode(": ping\n\n"));
        } catch {
          stop();
        }
      }, KEEPALIVE_INTERVAL_MS);
      keepaliveTimer.unref?.();
    },
    cancel() {
      stop();
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}

async function handleList(): Promise<Response> {
  const availability = await describeShellAvailability();
  if (availability.available) {
    return json({ available: true, sessions: listShellSessions() });
  }
  return json({
    available: false,
    reason: availability.reason,
    sessions: [],
  });
}

async function handleCreate(req: Request, cwd: string): Promise<Response> {
  const body = await parsePostJsonBody<{ cols?: unknown; rows?: unknown }>(req);
  if (body instanceof Response) return body;
  const result = await createShellSession(cwd, {
    cols: typeof body.cols === "number" ? body.cols : undefined,
    rows: typeof body.rows === "number" ? body.rows : undefined,
  });
  if (result.status === "unavailable") {
    return textError(result.reason, 501);
  }
  if (result.status === "too-many") {
    return textError(`too many shells (max ${MAX_SHELL_SESSIONS})`, 429);
  }
  if (result.status === "error") {
    console.error(`[code-viewer] shell spawn failed: ${result.message}`);
    return textError("failed to open a shell", 500);
  }
  return json({ session: result.session });
}

// ai-dup-check: allow -- ok:tmux 側の handleStreamGet と形は似ているが、クエリ
// キー・検証関数・生成先がすべて別物。共通化すると引数 4 つの高階関数になり、
// 3 行の重複より読みにくくなる。
function handleStream(url: URL): Response {
  const id = url.searchParams.get("id");
  if (!isShellSessionId(id)) return textError("invalid shell id", 400);
  return createShellStreamResponse(id);
}

/** POST 本文から共通して取り出すシェル ID。 */
async function readShellBody<T extends { id?: unknown }>(
  req: Request,
): Promise<{ id: ShellSessionId; body: T } | Response> {
  const body = await parsePostJsonBody<T>(req);
  if (body instanceof Response) return body;
  if (!isShellSessionId(body.id)) return textError("invalid shell id", 400);
  return { id: body.id, body };
}

async function handleKeys(req: Request): Promise<Response> {
  const parsed = await readShellBody<{ id?: unknown; data?: unknown }>(req);
  if (parsed instanceof Response) return parsed;
  const { data } = parsed.body;
  if (typeof data !== "string") return textError("invalid data", 400);
  if (data.length > MAX_KEY_INPUT_LENGTH) {
    return textError("key input too large", 413);
  }
  const result = writeToShell(parsed.id, data);
  if (result.status === "gone") return textError("shell is gone", 410);
  if (result.status === "error") {
    console.error(`[code-viewer] shell write failed: ${result.message}`);
    return textError("failed to send input", 500);
  }
  return json({ ok: true });
}

async function handleResize(req: Request): Promise<Response> {
  const parsed = await readShellBody<{
    id?: unknown;
    cols?: unknown;
    rows?: unknown;
  }>(req);
  if (parsed instanceof Response) return parsed;
  const { cols, rows } = parsed.body;
  if (typeof cols !== "number" || typeof rows !== "number") {
    return textError("invalid size", 400);
  }
  const result = resizeShell(parsed.id, cols, rows);
  if (result.status === "gone") return textError("shell is gone", 410);
  // 失敗を成功として返すと、呼び出し側が「このサイズで通った」と記録して
  // 二度と送り直さなくなる。表示は続けられるが、桁数はずれたままになる。
  if (result.status === "error") {
    console.warn(`[code-viewer] shell resize failed: ${result.message}`);
    return textError("failed to resize shell", 500);
  }
  return json({ ok: true });
}

async function handleClose(req: Request): Promise<Response> {
  const parsed = await readShellBody<{ id?: unknown }>(req);
  if (parsed instanceof Response) return parsed;
  return json({ closed: closeShellSession(parsed.id) });
}

export function handleShellRoute(
  req: Request,
  url: URL,
  cwd: string,
  sideEffectAllowed: (req: Request) => boolean,
): Promise<Response | null> {
  return dispatchRoutes(
    req,
    url,
    {
      "/_shell/list": {
        methods: ["GET"],
        sideEffect: false,
        handler: () => handleList(),
      },
      "/_shell/stream": {
        methods: ["GET"],
        sideEffect: false,
        handler: () => handleStream(url),
      },
      "/_shell/create": {
        methods: ["POST"],
        sideEffect: true,
        handler: () => handleCreate(req, cwd),
      },
      "/_shell/keys": {
        methods: ["POST"],
        sideEffect: true,
        handler: () => handleKeys(req),
      },
      "/_shell/resize": {
        methods: ["POST"],
        sideEffect: true,
        handler: () => handleResize(req),
      },
      "/_shell/close": {
        methods: ["POST"],
        sideEffect: true,
        handler: () => handleClose(req),
      },
    },
    sideEffectAllowed,
    (res) => res,
    (err) => handleError("shell", "handle shell request", err),
  );
}
