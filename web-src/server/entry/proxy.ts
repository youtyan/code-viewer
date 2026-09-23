// 入口が受けた `/p/<鍵>/…` の要求を、そのプロジェクトの裏のプロセスへ流す。
//
// - 本文 (ファイルの送信) も応答 (ダウンロード・SSE) も溜めずに流す。SSE は
//   流しっぱなしで中継し、ブラウザが切ったら裏への要求も切る (req.signal)
// - 裏は今のサーバそのもので、書き込みの要求は同じオリジンからしか通さない
//   (request-origin.ts)。入口で同じ検査を通った要求だけ、Origin を裏の
//   オリジンに付け替えて送る (CLI の requestJson と同じ)。X-Code-Viewer-Action
//   と sec-fetch-site はそのまま写る。通らなかった要求は付け替えないので、
//   裏がこれまでどおり断る
// - 裏に繋がらなかった (接続拒否など) ときは呼び出し側が 502 にする

import { createLinkedAbortController } from "../abort";
import { sideEffectRequestAllowed } from "../request-origin";
import { SSE_HEARTBEAT_INTERVAL_MS } from "../runtime";

/** Maximum wait for the project process to return response headers. */
export const PROXY_RESPONSE_START_MS = 120_000;

/** 送り直さない見出し (接続ごとのもの・宛先が決めるもの)。 */
const HOP_BY_HOP_REQUEST = new Set([
  "connection",
  "keep-alive",
  "proxy-connection",
  "transfer-encoding",
  "upgrade",
  "te",
  "trailer",
  "host",
  "content-length",
]);

const HOP_BY_HOP_RESPONSE = new Set([
  "connection",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
  "trailer",
]);

export type ProxyResult =
  | { status: "ok"; response: Response }
  | { status: "timeout"; error: unknown; timeoutMs: number }
  /** 裏に繋がらなかった。応答は呼び出し側が作る (502)。 */
  | { status: "unreachable"; error: unknown };

type ProxyOptions = {
  fetch?: typeof fetch;
  /** Tests use a short value; production always uses PROXY_RESPONSE_START_MS. */
  responseStartMs?: number;
  /** 応答の本文が終わった・切れたときに 1 回だけ呼ぶ (SSE の購読の数)。 */
  onBodyEnd?: () => void;
};

/**
 * 裏へ流す。backendUrl は裏の根 (`http://127.0.0.1:<port>/`)、path は前置きを
 * 外した経路 (`/_tree` など)、search はクエリ (`?…` か空)。
 */
export async function proxyToBackend(
  req: Request,
  backendUrl: string,
  path: string,
  search: string,
  options: ProxyOptions = {},
): Promise<ProxyResult> {
  const target = new URL(`.${path}${search}`, backendUrl);
  const headers = new Headers();
  req.headers.forEach((value, key) => {
    if (!HOP_BY_HOP_REQUEST.has(key.toLowerCase())) headers.set(key, value);
  });
  if (req.headers.has("origin") && sideEffectRequestAllowed(req)) {
    headers.set("origin", target.origin);
  }
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  const responseStartMs = options.responseStartMs ?? PROXY_RESPONSE_START_MS;
  const proxyAbort = createLinkedAbortController(req.signal, responseStartMs);
  let ended = false;
  const end = () => {
    if (ended) return;
    ended = true;
    proxyAbort.cleanup();
    options.onBodyEnd?.();
  };
  let upstream: Response;
  try {
    upstream = await (options.fetch ?? fetch)(target.href, {
      method: req.method,
      headers,
      body: hasBody ? req.body : undefined,
      redirect: "manual",
      signal: proxyAbort.signal,
      ...(hasBody ? { duplex: "half" } : {}),
    } as RequestInit);
  } catch (error) {
    const timedOut = proxyAbort.didTimeout() && !req.signal.aborted;
    end();
    if (timedOut)
      return { status: "timeout", error, timeoutMs: responseStartMs };
    return { status: "unreachable", error };
  }
  proxyAbort.clearTimeout();
  const responseHeaders = new Headers();
  upstream.headers.forEach((value, key) => {
    if (!HOP_BY_HOP_RESPONSE.has(key.toLowerCase())) {
      responseHeaders.set(key, value);
    }
  });
  // fetch は圧縮を解いて渡すので、圧縮の印と長さは付け直さない。
  if (upstream.headers.has("content-encoding")) {
    responseHeaders.delete("content-encoding");
    responseHeaders.delete("content-length");
  }
  const isSse = upstream.headers
    .get("content-type")
    ?.toLowerCase()
    .startsWith("text/event-stream");
  const body = upstream.body
    ? proxyBody(
        upstream.body,
        proxyAbort,
        end,
        isSse ? SSE_HEARTBEAT_INTERVAL_MS * 3 : null,
      )
    : null;
  if (!upstream.body) end();
  return {
    status: "ok",
    response: new Response(body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    }),
  };
}

/** 本文をそのまま流し、終わった・切れた・失敗したときに end を 1 回呼ぶ。 */
function proxyBody(
  source: ReadableStream<Uint8Array>,
  proxyAbort: ReturnType<typeof createLinkedAbortController>,
  end: () => void,
  inactivityMs: number | null,
): ReadableStream<Uint8Array> {
  const reader = source.getReader();
  let inactivityTimer: ReturnType<typeof setTimeout> | null = null;
  const clearInactivity = () => {
    if (!inactivityTimer) return;
    clearTimeout(inactivityTimer);
    inactivityTimer = null;
  };
  const resetInactivity = () => {
    if (inactivityMs === null) return;
    clearInactivity();
    inactivityTimer = setTimeout(() => {
      proxyAbort.abort(
        new Error(`SSE upstream sent no data for ${inactivityMs}ms`),
      );
    }, inactivityMs);
    inactivityTimer.unref?.();
  };
  const finish = () => {
    clearInactivity();
    end();
  };
  resetInactivity();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch (error) {
        finish();
        controller.error(error);
        return;
      }
      if (chunk.done) {
        finish();
        controller.close();
        return;
      }
      resetInactivity();
      controller.enqueue(chunk.value);
    },
    async cancel(reason) {
      try {
        await reader.cancel(reason);
      } finally {
        proxyAbort.abort(reason);
        finish();
      }
    },
  });
}

/** 繋がらなかった (裏が居ない) か。fetch は原因を cause に包む。 */
export function isConnectionFailure(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (
      code === "ECONNREFUSED" ||
      code === "ECONNRESET" ||
      code === "UND_ERR_SOCKET" ||
      code === "EPIPE"
    ) {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
