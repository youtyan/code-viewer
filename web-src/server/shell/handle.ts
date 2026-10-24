import { isShellViewport } from "../../core/shell";
// シェルセッションの HTTP 入口。
//
// - GET  /_shell/list             開いているシェルの一覧
// - POST /_shell/create           新しいシェルを開く
// - POST /_shell/keys             そのシェルへ入力を送る
// - POST /_shell/resize           そのシェルの桁数・行数を変える
// - POST /_shell/close            そのシェルを終了する
//
// 出力は生きた知らせのチャンネル (live/handle.ts) で流す (startShellStream)。
// ルーティングと副作用リクエストの認可は tmux 側と同じく dispatchRoutes に
// 任せる。tmux との違いは購読の形で、あちらは画面を取り直して丸ごと置き換え
// るのに対し、こちらは PTY が吐いた分だけを順に流す。だから poll を持たず、
// onData をそのまま流しへ橋渡しする。

import { formatErrorDetail } from "../../core/error-detail";
import {
  isShellSessionId,
  MAX_KEY_INPUT_LENGTH,
  type ShellSessionId,
} from "../../core/shell";
import {
  dispatchRoutes,
  handleError,
  json,
  parsePostJsonBody,
  textError,
} from "../database/handle-shared";
import type { SseStream } from "../sse-stream";
import {
  closeShellSession,
  createShellSession,
  describeShellAvailability,
  listShellSessionsForMatching,
  operateShellView,
  resizeShell,
  subscribeShell,
  writeToShell,
} from "./session";

/** シェルの出力を流しへ送り続ける。シェルが無ければ gone、終われば exited を送って閉じる。 */
export function startShellStream(id: ShellSessionId, stream: SseStream): void {
  const sub = subscribeShell(
    id,
    (chunk) => stream.send("output", JSON.stringify({ data: chunk })),
    (exitCode) => {
      stream.send("exited", JSON.stringify({ exitCode }));
      stream.close();
    },
  );
  if (!sub) {
    stream.send("gone", "1");
    stream.close();
    return;
  }
  stream.onClose(() => sub.unsubscribe());
  stream.send("open", "ok");
  // 購読していない間に出ていた分を先に流す。開き直したときに画面が
  // 真っ白にならない。前の購読者に渡った分には流し直しの印を付ける:
  // 中にある端末への問い合わせ (tmux が attach したときの DA など) には
  // そのときの端末が答えており、答え直すと、誰も待っていない PTY に
  // `1;2c` のような文字として入る。まだ誰にも渡っていない分は印を付けず、
  // 端末に答えさせる (tmux はその答えを待っている)。
  if (sub.replay) {
    stream.send("output", JSON.stringify({ data: sub.replay, replay: true }));
  }
  if (sub.unseen) stream.send("output", JSON.stringify({ data: sub.unseen }));
}

async function handleList(): Promise<Response> {
  const availability = await describeShellAvailability();
  if (availability.available) {
    return json({
      available: true,
      sessions: await listShellSessionsForMatching(),
    });
  }
  return json({
    available: false,
    reason: availability.reason,
    sessions: [],
  });
}

async function handleCreate(req: Request, cwd: string): Promise<Response> {
  const body = await parsePostJsonBody<{
    id?: unknown;
    cols?: unknown;
    rows?: unknown;
  }>(req);
  if (body instanceof Response) return body;
  // id はサーバが起き直して終わったシェルのタブを、同じ ID のまま開き直すとき。
  let id: ShellSessionId | undefined;
  if (body.id !== undefined) {
    if (!isShellSessionId(body.id)) return textError("invalid shell id", 400);
    id = body.id;
  }
  const result = await createShellSession(
    cwd,
    {
      cols: typeof body.cols === "number" ? body.cols : undefined,
      rows: typeof body.rows === "number" ? body.rows : undefined,
    },
    id,
  );
  if (result.status === "unavailable") {
    return textError(result.reason, 501);
  }
  if (result.status === "error") {
    console.error("[code-viewer] shell spawn failed", result.error);
    return textError(formatErrorDetail(result.error), 500);
  }
  return json({ session: result.session });
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
  const parsed = await readShellBody<{
    id?: unknown;
    data?: unknown;
    viewport?: unknown;
  }>(req);
  if (parsed instanceof Response) return parsed;
  const { data } = parsed.body;
  if (typeof data !== "string") return textError("invalid data", 400);
  if (data.length > MAX_KEY_INPUT_LENGTH) {
    return textError("key input too large", 413);
  }
  const { viewport } = parsed.body;
  if (viewport !== undefined && !isShellViewport(viewport))
    return textError("invalid viewport", 400);
  const result = isShellViewport(viewport)
    ? await operateShellView(parsed.id, viewport, data)
    : writeToShell(parsed.id, data);
  if (result.status === "gone") return textError("shell is gone", 410);
  if (result.status === "error") {
    console.error("[code-viewer] shell write failed", result.error);
    return textError(formatErrorDetail(result.error), 500);
  }
  return json({
    ok: true,
    ...(isShellViewport(viewport) ? { generation: viewport.sequence } : {}),
  });
}

async function handleResize(req: Request): Promise<Response> {
  const parsed = await readShellBody<{
    id?: unknown;
    cols?: unknown;
    rows?: unknown;
    viewport?: unknown;
  }>(req);
  if (parsed instanceof Response) return parsed;
  const { cols, rows } = parsed.body;
  if (typeof cols !== "number" || typeof rows !== "number") {
    return textError("invalid size", 400);
  }
  const { viewport } = parsed.body;
  if (viewport !== undefined && !isShellViewport(viewport))
    return textError("invalid viewport", 400);
  const result = isShellViewport(viewport)
    ? await operateShellView(parsed.id, viewport)
    : resizeShell(parsed.id, cols, rows);
  if (result.status === "gone") return textError("shell is gone", 410);
  // 失敗を成功として返すと、呼び出し側が「このサイズで通った」と記録して
  // 二度と送り直さなくなる。表示は続けられるが、桁数はずれたままになる。
  if (result.status === "error") {
    console.error("[code-viewer] shell resize failed", result.error);
    return textError(formatErrorDetail(result.error), 500);
  }
  return json({
    ok: true,
    ...(isShellViewport(viewport) ? { generation: viewport.sequence } : {}),
  });
}

async function handleClose(req: Request): Promise<Response> {
  const parsed = await readShellBody<{ id?: unknown }>(req);
  if (parsed instanceof Response) return parsed;
  const result = await closeShellSession(parsed.id);
  if (result.status === "error") {
    console.error("[code-viewer] shell close failed", result.error);
    return textError(formatErrorDetail(result.error), 500);
  }
  return json({ closed: result.status === "ok" });
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
