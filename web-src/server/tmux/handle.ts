// terminal ドロワーの HTTP 入口。
//
// - GET  /_tmux/panes            セッション → ウィンドウ → ペインの一覧
// - GET  /_tmux/stream?pane=%14  そのペインの画面を SSE で流し続ける
//                                fill=<行数> でその手前の履歴も一緒に流す
//                                (ドロワーがペインより縦に長いときの埋め草)
// - GET  /_tmux/history?pane=%14 スクロールバックを含む画面を 1 回だけ返す
// - POST /_tmux/keys             そのペインへキー入力を送る
//
// ルーティングと副作用リクエストの認可は database/handle-shared の
// dispatchRoutes に任せる (state-route.ts と同じ使い方)。キー送信は
// sideEffect: true なので、同一オリジンかつ x-code-viewer-action 付きの
// リクエストしか通らない。
//
// 世代管理について: 画面フレームには必ず対象の pane id が入っている。
// クライアントは選択中のペインと突き合わせるだけで、切り替え前に発行された
// フレームを捨てられる。ペイン購読では pane id が世代そのものなので、別途
// カウンタを持たせていない。

import {
  isTmuxPaneId,
  TERMINAL_POLL_INTERVAL_MS,
  type TmuxPaneId,
} from "../../core/tmux";
import {
  dispatchRoutes,
  handleError,
  json,
  jsonLoadResponse,
  parsePostJsonBody,
  textError,
} from "../database/handle-shared";
import { captureTmuxPane, MAX_TMUX_HISTORY_LINES } from "./capture";
import { sendTmuxKeys } from "./keys";
import { listTmuxPanes } from "./panes";

/** 何も変化がない間も接続が生きていることを伝える間隔 (既存 /events と同じ)。 */
const KEEPALIVE_INTERVAL_MS = 15000;

/** 1 回の送信で受け付けるキー入力の長さ。貼り付けを想定して広めに取る。 */
const MAX_KEY_INPUT_LENGTH = 100_000;

const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
} as const;

type ActiveStream = { close(): void };

/** 開いているペイン購読。サーバ終了時にまとめて閉じる。 */
const activeStreams = new Set<ActiveStream>();

/** preview.ts の shutdown から呼ぶ。購読が残ったままだと終了できない。 */
export function closeTmuxStreams(): void {
  for (const stream of [...activeStreams]) stream.close();
}

/**
 * 購読 1 回で一緒に流す履歴の上限。
 *
 * 用途は「ドロワーの表示領域がペインより縦に長いぶんを埋める」だけなので、
 * 画面 1 枚に出せる行数を超える意味がない。ここを青天井にすると、1 秒に
 * 8 回 5000 行を送ることになる。
 */
const MAX_TMUX_STREAM_FILL_LINES = 500;

function createPaneStreamResponse(
  paneId: TmuxPaneId,
  cwd: string,
  /** 画面の手前に何行ぶん付けるか。表示領域の余りぶんをクライアントが決める。 */
  fillLines: number,
): Response {
  const enc = new TextEncoder();
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let keepaliveTimer: ReturnType<typeof setInterval> | null = null;
  // 直前に送った画面。同じものを送り直さないので、待機中のペインでは
  // ほとんど通信が発生しない。
  let lastContent: string | null = null;
  let lastError: string | null = null;
  // capture が返る前に次の capture を始めない。tmux が遅いときに
  // プロセスが積み上がるのを防ぐ。
  let inFlight = false;
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
    if (pollTimer) clearInterval(pollTimer);
    if (keepaliveTimer) clearInterval(keepaliveTimer);
    pollTimer = null;
    keepaliveTimer = null;
    activeStreams.delete(entry);
    try {
      controller?.close();
    } catch {
      // 既に閉じられている (cancel 経由)。
    }
  }

  async function poll(): Promise<void> {
    if (closed || inFlight) return;
    inFlight = true;
    try {
      const result = await captureTmuxPane(paneId, cwd, fillLines);
      if (closed) return;
      if (result.status === "gone") {
        send("gone", "1");
        stop();
        return;
      }
      if (result.status === "error") {
        // 同じ失敗を流し続けない。回復したら次の変化で普通に送られる。
        if (result.message !== lastError) {
          lastError = result.message;
          send("failed", JSON.stringify({ message: result.message }));
        }
        return;
      }
      lastError = null;
      if (result.screen.content === lastContent) return;
      lastContent = result.screen.content;
      send("screen", JSON.stringify(result.screen));
    } finally {
      inFlight = false;
    }
  }

  const stream = new ReadableStream<Uint8Array>({
    start(ctrl) {
      controller = ctrl;
      activeStreams.add(entry);
      send("open", "ok");
      void poll();
      pollTimer = setInterval(() => void poll(), TERMINAL_POLL_INTERVAL_MS);
      pollTimer.unref?.();
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

function handlePanesGet(cwd: string): Promise<Response> {
  return jsonLoadResponse(
    () => listTmuxPanes(cwd),
    "tmux",
    "failed to list tmux panes",
  );
}

// ai-dup-check: allow -- fp:shell の同名ハンドラと似るのは「クエリを検証して
// 購読を作る」3 行だけで、検証する識別子も作る購読も別物。共通化すると引数で
// 分岐するだけの関数が増える。
function handleStreamGet(url: URL, cwd: string): Response {
  const pane = url.searchParams.get("pane");
  if (!isTmuxPaneId(pane)) return textError("invalid pane id", 400);
  return createPaneStreamResponse(
    pane,
    cwd,
    clampLines(url.searchParams.get("fill"), MAX_TMUX_STREAM_FILL_LINES),
  );
}

/** クエリの行数を 0..max に丸める。数値でなければ 0。 */
function clampLines(raw: string | null, max: number): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(Math.max(parsed, 0), max);
}

/**
 * スクロールバックを含む画面を 1 回だけ返す。
 *
 * 購読 (/_tmux/stream) が返すのは「今の画面」だけで、ドロワーは過去に流れた
 * 行を持たない。人が遡りたくなったときにここへ取りに来る。毎フレーム履歴まで
 * 送ると 1 回あたりが数 MB になるので、購読とは分けて明示的な 1 回きりの取得に
 * している。
 */
async function handleHistoryGet(url: URL, cwd: string): Promise<Response> {
  const pane = url.searchParams.get("pane");
  if (!isTmuxPaneId(pane)) return textError("invalid pane id", 400);
  const raw = url.searchParams.get("lines");
  const lines =
    raw === null
      ? MAX_TMUX_HISTORY_LINES
      : clampLines(raw, MAX_TMUX_HISTORY_LINES);
  const result = await captureTmuxPane(pane, cwd, lines);
  if (result.status === "gone") return textError("pane is gone", 410);
  if (result.status === "error") {
    console.error(`[code-viewer] tmux capture failed: ${result.message}`);
    return textError("failed to capture pane", 500);
  }
  return json(result.screen);
}

async function handleKeysPost(req: Request, cwd: string): Promise<Response> {
  const body = await parsePostJsonBody<{ pane?: unknown; data?: unknown }>(req);
  if (body instanceof Response) return body;
  if (!isTmuxPaneId(body.pane)) return textError("invalid pane id", 400);
  if (typeof body.data !== "string") return textError("invalid data", 400);
  if (body.data.length > MAX_KEY_INPUT_LENGTH) {
    return textError("key input too large", 413);
  }
  const result = await sendTmuxKeys(body.pane, body.data, cwd);
  if (result.status === "gone") return textError("pane is gone", 410);
  if (result.status === "error") {
    console.error(`[code-viewer] tmux send-keys failed: ${result.message}`);
    return textError("failed to send keys", 500);
  }
  return json({ ok: true });
}

export function handleTmuxRoute(
  req: Request,
  url: URL,
  cwd: string,
  sideEffectAllowed: (req: Request) => boolean,
): Promise<Response | null> {
  return dispatchRoutes(
    req,
    url,
    {
      "/_tmux/panes": {
        methods: ["GET"],
        sideEffect: false,
        handler: () => handlePanesGet(cwd),
      },
      "/_tmux/stream": {
        methods: ["GET"],
        sideEffect: false,
        handler: () => handleStreamGet(url, cwd),
      },
      "/_tmux/history": {
        methods: ["GET"],
        sideEffect: false,
        handler: () => handleHistoryGet(url, cwd),
      },
      "/_tmux/keys": {
        methods: ["POST"],
        sideEffect: true,
        handler: () => handleKeysPost(req, cwd),
      },
    },
    sideEffectAllowed,
    (res) => res,
    (err) => handleError("tmux", "handle tmux request", err),
  );
}
