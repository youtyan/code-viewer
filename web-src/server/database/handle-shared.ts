import type { DbKind } from "../../core/database/types";
import { formatErrorDetail } from "../../core/error-detail";
import { abortError, isAbortLikeError } from "./adapters/abort";
import { isD1HttpError } from "./adapters/d1";
import { isDockerComposeServiceUnavailableError } from "./adapters/docker-utils";
import {
  type DatastoreConnection,
  findDatastoreConnection,
} from "./connections-store";
import {
  type DockerDbInfo,
  findDockerServiceByDbIdAsync,
  parseDockerDbId,
} from "./discovery";

export type CloseableDatabaseHandle = {
  close(): void;
};

type AdapterCacheEntry<T extends CloseableDatabaseHandle> = {
  adapter: T;
  lastUsed: number;
};

type PendingAdapterOpen<T extends CloseableDatabaseHandle> = {
  promise: Promise<T>;
  closed: boolean;
};

export type DockerAdapterCache<T extends CloseableDatabaseHandle> = {
  getOrOpenAsync(key: string, open: () => T | Promise<T>): Promise<T>;
  close(key: string): void;
  closePrefix(prefix: string): void;
};

const DEFAULT_MAX_DOCKER_ADAPTER_CACHE = 8;
const DEFAULT_DOCKER_ADAPTER_IDLE_MS = 5 * 60 * 1000;

export function createDockerAdapterCache<T extends CloseableDatabaseHandle>(
  maxEntries = DEFAULT_MAX_DOCKER_ADAPTER_CACHE,
  idleMs = DEFAULT_DOCKER_ADAPTER_IDLE_MS,
): DockerAdapterCache<T> {
  const cache = new Map<string, AdapterCacheEntry<T>>();
  const pending = new Map<string, PendingAdapterOpen<T>>();

  function closeEntry(key: string, entry: AdapterCacheEntry<T>): void {
    try {
      entry.adapter.close();
    } finally {
      cache.delete(key);
    }
  }

  function prune(now = Date.now()): void {
    for (const [key, entry] of cache) {
      if (now - entry.lastUsed > idleMs) {
        closeEntry(key, entry);
      }
    }
    while (cache.size > maxEntries) {
      let oldestKey: string | null = null;
      let oldestEntry: AdapterCacheEntry<T> | null = null;
      for (const [key, entry] of cache) {
        if (!oldestEntry || entry.lastUsed < oldestEntry.lastUsed) {
          oldestKey = key;
          oldestEntry = entry;
        }
      }
      if (!oldestKey || !oldestEntry) break;
      closeEntry(oldestKey, oldestEntry);
    }
  }

  return {
    async getOrOpenAsync(key: string, open: () => T | Promise<T>): Promise<T> {
      prune();
      const cached = cache.get(key);
      if (cached) {
        cached.lastUsed = Date.now();
        return cached.adapter;
      }
      const pendingOpen = pending.get(key);
      if (pendingOpen) return pendingOpen.promise;
      const pendingEntry: PendingAdapterOpen<T> = {
        closed: false,
        promise: undefined as unknown as Promise<T>,
      };
      pendingEntry.promise = Promise.resolve()
        .then(open)
        .then((adapter) => {
          if (pendingEntry.closed) {
            adapter.close();
          } else {
            cache.set(key, { adapter, lastUsed: Date.now() });
            prune();
          }
          return adapter;
        })
        .finally(() => {
          if (pending.get(key) === pendingEntry) {
            pending.delete(key);
          }
        });
      pending.set(key, pendingEntry);
      return pendingEntry.promise;
    },

    close(key: string): void {
      const cached = cache.get(key);
      if (cached) closeEntry(key, cached);
      const pendingOpen = pending.get(key);
      if (pendingOpen) pendingOpen.closed = true;
    },

    closePrefix(prefix: string): void {
      for (const [key, entry] of Array.from(cache)) {
        if (key.startsWith(prefix)) closeEntry(key, entry);
      }
      for (const [key, entry] of Array.from(pending)) {
        if (key.startsWith(prefix)) entry.closed = true;
      }
    },
  };
}

export const MAX_LOGGED_ERROR_BODY = 500;

// 4xx/5xx の Response から body を覗いてログ用文字列を抽出する。
// 元 Response の body は消費しないよう clone してから読む。
// Content-Type が text/plain か application/json のときだけ読む(画像など大きい body を避ける)。
// SECURITY: handle.ts の query handler 等は SQL エラー文をそのまま 4xx body に乗せて返すため、
// ログには SQL 抜粋・テーブル/カラム名・レコード値が混ざりうる。本プロジェクトはローカル
// 開発ツール前提なので意図的に許容する。サーバ運用に転用する場合は redaction が必要。
export async function extractErrorReason(res: Response): Promise<string> {
  if (res.status < 400) return "";
  const ctype = res.headers.get("content-type") ?? "";
  if (!ctype.startsWith("text/") && !ctype.includes("json")) return "";
  // clone() は同期で取り出してから本文を読む。これを async 関数の途中で行うと、
  // 呼出元が `void` で投げ捨てた瞬間に元 Response が消費され始めて clone 失敗する。
  let cloned: Response;
  try {
    cloned = res.clone();
  } catch (error) {
    // 理由抽出は諦めるが、諦めた理由は残す (応答そのものは壊さない)。
    console.error(
      `[code-viewer] could not clone a ${res.status} response to read its failure reason`,
      error,
    );
    return "";
  }
  try {
    const body = await cloned.text();
    if (!body) return "";
    const trimmed = body.replace(/\s+/g, " ").trim();
    if (!trimmed) return "";
    return trimmed.length > MAX_LOGGED_ERROR_BODY
      ? `${trimmed.slice(0, MAX_LOGGED_ERROR_BODY)}...`
      : trimmed;
  } catch (error) {
    // ログを簡略化するだけだが、読めなかった理由は残す。
    console.error(
      `[code-viewer] could not read the body of a ${res.status} response for the log`,
      error,
    );
    return "";
  }
}

// アクセスログは複数リクエスト間で時系列順を保ちたい。4xx は body 読込で 1 microtask
// 遅延するので、放置すると後続 2xx より遅れて出力される。直列キューを噛ませて
// 投入順に console へ流す。
let logQueue: Promise<void> = Promise.resolve();
function enqueueLogLine(work: () => Promise<void>): void {
  logQueue = logQueue.then(work, work);
}

export type LogResponseOptions = {
  // url.search を出力に含める時の最大バイト数。0 で省略。
  qsLen?: number;
};

export function logResponseWithReason(
  prefix: string,
  req: Request,
  url: URL,
  res: Response,
  startMs: number,
  opts: LogResponseOptions = {},
): void {
  const ms = Date.now() - startMs;
  const qsLen = opts.qsLen ?? 0;
  const qs = qsLen > 0 && url.search ? url.search.slice(0, qsLen) : "";
  const head = `${prefix} ${req.method} ${url.pathname}${qs} ${res.status} ${ms}ms`;
  if (res.status < 400) {
    enqueueLogLine(async () => {
      console.log(head);
    });
    return;
  }
  // clone は同期で確保しないと、enqueue 後の microtask 時点で body が消費済みのことがある。
  let cloned: Response | null = null;
  try {
    cloned = res.clone();
  } catch (error) {
    // 理由なしでログ行は出すが、理由を読めなかったこと自体は残す。
    console.error(
      `[code-viewer] could not clone the response for the log line: ${head}`,
      error,
    );
  }
  enqueueLogLine(async () => {
    const reason = cloned ? await extractErrorReason(cloned) : "";
    if (reason) console.warn(`${head} :: ${reason}`);
    else console.warn(head);
  });
}

export function createQueryStrippedLogger(
  prefix: string,
  req: Request,
  url: URL,
): (res: Response) => Response {
  const start = Date.now();
  return (res: Response): Response => {
    logResponseWithReason(`[code-viewer] ${prefix}`, req, url, res, start);
    return res;
  };
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

export function textError(message: string, status: number): Response {
  return new Response(message, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

export async function jsonLoadResponse<T>(
  load: () => Promise<T>,
  logPrefix: string,
  errorMessage: string,
): Promise<Response> {
  try {
    return json(await load());
  } catch (err) {
    console.error(`[code-viewer] ${logPrefix} error:`, err);
    return textError(errorMessage, 500);
  }
}

export async function parseBoundedJsonBody(
  req: Request,
  maxBytes: number,
  tooLargeMessage: string,
): Promise<unknown | Response> {
  const contentType = req.headers.get("content-type") || "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    return textError("unsupported media type", 415);
  }
  return readBoundedJsonBody(req, maxBytes, tooLargeMessage);
}

/** 上限つきの読み取り本体。失敗は「読めなかった」と「JSON でない」を分ける。 */
export async function readBoundedJsonBody(
  req: Request,
  maxBytes: number,
  tooLargeMessage: string,
): Promise<unknown | Response> {
  const contentLength = Number(req.headers.get("content-length") || "0");
  if (contentLength > maxBytes) return textError(tooLargeMessage, 413);
  // content-length が無い本文 (入口の取り次ぎを通ったものは全部こう) も、
  // 溜めながら数えて上限を越えた所で読むのをやめる。全部溜めてから比べると、
  // 上限が溜めるメモリを守らない。
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = req.body?.getReader();
  try {
    while (reader) {
      const chunk = await reader.read();
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > maxBytes) {
        await reader.cancel(tooLargeMessage);
        return textError(tooLargeMessage, 413);
      }
      chunks.push(chunk.value);
    }
  } catch (error) {
    return textError(
      `could not read the request body: ${formatErrorDetail(error)}`,
      400,
    );
  }
  // req.text() と同じ解読 (UTF-8・先頭の BOM を除く)。
  const raw = new TextDecoder().decode(Buffer.concat(chunks));
  try {
    return JSON.parse(raw);
  } catch (error) {
    // "invalid JSON body" だけでは、本文のどこが壊れているのか分からな
    // かった。解析器の理由 (位置を含む) をそのまま返す。
    return textError(`invalid JSON body: ${formatErrorDetail(error)}`, 400);
  }
}

function waitForCallerAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined,
  message: string,
): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortError(message));
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    const onAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(abortError(message));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(value);
      },
      (err) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(err);
      },
    );
  });
}

export async function resolveDockerExplorerAsync<
  T extends CloseableDatabaseHandle,
>(
  cwd: string,
  dbParam: string | null,
  kind: DbKind,
  cache: DockerAdapterCache<T>,
  openFn: (info: DockerDbInfo) => T | Promise<T>,
  omitDirNames?: string[],
  signal?: AbortSignal,
): Promise<{ dbId: string; explorer: T } | Response> {
  if (!dbParam) return textError("missing db parameter", 400);
  if (!dbParam.startsWith("docker:")) {
    return textError(`${kind} requires docker: prefix`, 400);
  }
  const parsed = parseDockerDbId(dbParam);
  if (!parsed) return textError("invalid docker db id", 400);
  let info: DockerDbInfo | null;
  try {
    info = await findDockerServiceByDbIdAsync(
      cwd,
      dbParam,
      kind,
      omitDirNames,
      signal,
    );
  } catch (err) {
    if (isAbortLikeError(err, signal)) {
      return textError(`${kind} lookup aborted`, 503);
    }
    throw err;
  }
  if (!info) return textError(`${kind} service not found`, 404);

  let explorer: T;
  try {
    explorer = await waitForCallerAbort(
      cache.getOrOpenAsync(dbParam, () => openFn(info)),
      signal,
      `${kind} open aborted`,
    );
  } catch (err) {
    if (isAbortLikeError(err, signal)) {
      return textError(`${kind} open aborted`, 503);
    }
    throw err;
  }
  return { dbId: dbParam, explorer };
}

export async function resolveDatastoreExplorerAsync<
  T extends CloseableDatabaseHandle,
>(
  cwd: string,
  dbParam: string | null,
  kind: DbKind,
  cache: DockerAdapterCache<T>,
  openDocker: (info: DockerDbInfo) => T | Promise<T>,
  openSaved: (connection: DatastoreConnection) => T | Promise<T>,
  omitDirNames?: string[],
  signal?: AbortSignal,
): Promise<{ dbId: string; explorer: T } | Response> {
  if (dbParam?.startsWith("connection:")) {
    const connection = await findDatastoreConnection(cwd, dbParam);
    if (!connection || connection.kind !== kind) {
      return textError(`${kind} connection not found`, 404);
    }
    try {
      const explorer = await waitForCallerAbort(
        cache.getOrOpenAsync(dbParam, () => openSaved(connection)),
        signal,
        `${kind} open aborted`,
      );
      return { dbId: dbParam, explorer };
    } catch (err) {
      if (isAbortLikeError(err, signal)) {
        return textError(`${kind} open aborted`, 503);
      }
      throw err;
    }
  }
  return resolveDockerExplorerAsync(
    cwd,
    dbParam,
    kind,
    cache,
    openDocker,
    omitDirNames,
    signal,
  );
}

export type RouteEntry = {
  methods: readonly string[];
  sideEffect?: boolean | ((method: string) => boolean);
  handler: () => Response | Promise<Response>;
};

export async function dispatchRoutes(
  req: Request,
  url: URL,
  routes: Record<string, RouteEntry>,
  sideEffectAllowed?: (req: Request) => boolean,
  wrap: (res: Response) => Response | Promise<Response> = (res) => res,
  handleRouteError?: (err: unknown) => Response,
): Promise<Response | null> {
  // biome-ignore lint/suspicious/noPrototypeBuiltins: Object.hasOwn requires ES2022, but this project targets ES2020.
  if (!Object.prototype.hasOwnProperty.call(routes, url.pathname)) return null;
  const route = routes[url.pathname];
  if (!route.methods.includes(req.method)) {
    return wrap(textError("method not allowed", 405));
  }
  const requiresSideEffect =
    typeof route.sideEffect === "function"
      ? route.sideEffect(req.method)
      : route.sideEffect === true;
  if (requiresSideEffect && sideEffectAllowed && !sideEffectAllowed(req)) {
    return wrap(textError("forbidden", 403));
  }
  try {
    return wrap(await route.handler());
  } catch (err) {
    if (!handleRouteError) throw err;
    return wrap(handleRouteError(err));
  }
}

/**
 * この口を通る本文の上限。いちばん大きいのは端末への貼り付け (`/_shell/keys`)
 * と SQL の下書きで、どちらも 1 MiB には届かない。上限の無い読み取りを置かない
 * ための値で、経路ごとの検証はそれぞれのハンドラが続けて行う。
 */
const MAX_POST_JSON_BODY_BYTES = 1_048_576;

/**
 * 汎用の POST 本文。`parseBoundedJsonBody` と同じ上限つきの読み取りを使う
 * (この口だけ上限が無かった)。content-type は見ない: 既存の呼び出し元には
 * 付けずに送るものがあり、415 を新しく返すと壊れる。
 */
export async function parsePostJsonBody<T>(
  req: Request,
): Promise<T | Response> {
  if (req.method !== "POST") {
    return textError("method not allowed", 405);
  }
  return (await readBoundedJsonBody(
    req,
    MAX_POST_JSON_BODY_BYTES,
    "payload too large",
  )) as T | Response;
}

export function handleError(
  prefix: string,
  action: string,
  err: unknown,
  signal?: AbortSignal,
): Response {
  // クライアント起因の中断はサーバ障害として記録しない。
  if (isAbortLikeError(err, signal)) {
    return textError(`${action} aborted`, 503);
  }
  console.error(`[code-viewer] ${prefix} error:`, err);
  if (isDockerComposeServiceUnavailableError(err)) {
    return textError(guidanceWithCause(err), err.status);
  }
  // D1 は SQL 系の共通ルートを通るので、S3/DynamoDB のような専用ハンドラが
  // 無い。Cloudflare が返した実ステータス (401 認証失敗など) を 500 に
  // 潰さず、そのままクライアントへ伝える。
  if (isD1HttpError(err)) {
    return textError(guidanceWithCause(err), err.status);
  }
  return textError(`failed to ${action}: ${formatErrorDetail(err)}`, 500);
}

// 案内の文を持つ error は 1 行目をそのまま出し、元の失敗 (cause) があれば続ける。
function guidanceWithCause(err: Error & { cause?: unknown }): string {
  return err.cause === undefined
    ? err.message
    : `${err.message}\nCaused by: ${formatErrorDetail(err.cause)}`;
}
