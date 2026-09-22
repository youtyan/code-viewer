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

import { sideEffectRequestAllowed } from "../request-origin";

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
  /** 裏に繋がらなかった。応答は呼び出し側が作る (502)。 */
  | { status: "unreachable"; error: unknown };

/**
 * 裏へ流す。backendUrl は裏の根 (`http://127.0.0.1:<port>/`)、path は前置きを
 * 外した経路 (`/_tree` など)、search はクエリ (`?…` か空)。
 */
export async function proxyToBackend(
  req: Request,
  backendUrl: string,
  path: string,
  search: string,
  options: {
    fetch?: typeof fetch;
    /** 応答の本文が終わった・切れたときに 1 回だけ呼ぶ (SSE の購読の数)。 */
    onBodyEnd?: () => void;
  } = {},
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
  let upstream: Response;
  try {
    upstream = await (options.fetch ?? fetch)(target.href, {
      method: req.method,
      headers,
      body: hasBody ? req.body : undefined,
      redirect: "manual",
      signal: req.signal,
      ...(hasBody ? { duplex: "half" } : {}),
    } as RequestInit);
  } catch (error) {
    options.onBodyEnd?.();
    return { status: "unreachable", error };
  }
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
  const body = upstream.body
    ? countedBody(upstream.body, options.onBodyEnd)
    : null;
  if (!upstream.body) options.onBodyEnd?.();
  return {
    status: "ok",
    response: new Response(body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    }),
  };
}

/** 本文をそのまま流し、終わった・切れた・失敗したときに onEnd を 1 回呼ぶ。 */
function countedBody(
  source: ReadableStream<Uint8Array>,
  onEnd: (() => void) | undefined,
): ReadableStream<Uint8Array> {
  if (!onEnd) return source;
  const reader = source.getReader();
  let ended = false;
  const end = () => {
    if (ended) return;
    ended = true;
    onEnd();
  };
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch (error) {
        end();
        controller.error(error);
        return;
      }
      if (chunk.done) {
        end();
        controller.close();
        return;
      }
      controller.enqueue(chunk.value);
    },
    cancel(reason) {
      end();
      return reader.cancel(reason);
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
