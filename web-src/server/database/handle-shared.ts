import type { DbKind } from "../../core/database/types";
import { abortError, isAbortLikeError } from "./adapters/abort";
import { isDockerComposeServiceUnavailableError } from "./adapters/docker-utils";
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

const MAX_LOGGED_ERROR_BODY = 500;

// 4xx/5xx の Response から body を覗いてログ用文字列を抽出する。
// 元 Response の body は消費しないよう clone してから読む。
// Content-Type が text/plain か application/json のときだけ読む(画像など大きい body を避ける)。
async function extractErrorReason(res: Response): Promise<string> {
  if (res.status < 400) return "";
  const ctype = res.headers.get("content-type") ?? "";
  if (!ctype.startsWith("text/") && !ctype.includes("json")) return "";
  try {
    const body = await res.clone().text();
    if (!body) return "";
    const trimmed = body.replace(/\s+/g, " ").trim();
    if (!trimmed) return "";
    return trimmed.length > MAX_LOGGED_ERROR_BODY
      ? `${trimmed.slice(0, MAX_LOGGED_ERROR_BODY)}...`
      : trimmed;
  } catch {
    // Intentional: body 読取失敗時はログだけ簡略化する
    return "";
  }
}

export function logResponseWithReason(
  tag: string,
  method: string,
  path: string,
  qs: string,
  res: Response,
  startMs: number,
): void {
  const ms = Date.now() - startMs;
  const head = `${tag} ${method} ${path}${qs} ${res.status} ${ms}ms`;
  if (res.status < 400) {
    console.log(head);
    return;
  }
  void extractErrorReason(res).then((reason) => {
    if (reason) console.warn(`${head} :: ${reason}`);
    else console.warn(head);
  });
}

export function createQueryStrippedLogger(
  prefix: string,
  req: Request,
  url: URL,
): (res: Response) => Response {
  const path = url.pathname;
  const start = Date.now();
  const method = req.method;
  return (res: Response): Response => {
    logResponseWithReason(
      `[code-viewer] ${prefix}`,
      method,
      path,
      "",
      res,
      start,
    );
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
  const contentLength = Number(req.headers.get("content-length") || "0");
  if (contentLength > maxBytes) return textError(tooLargeMessage, 413);
  try {
    const raw = await req.text();
    if (Buffer.byteLength(raw, "utf8") > maxBytes) {
      return textError(tooLargeMessage, 413);
    }
    return JSON.parse(raw);
  } catch {
    return textError("invalid JSON body", 400);
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

function isFilesystemAccessError(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  return (
    code === "EACCES" ||
    code === "EBUSY" ||
    code === "EIO" ||
    code === "EISDIR" ||
    code === "ENOSPC" ||
    code === "ENOTDIR" ||
    code === "EPERM" ||
    code === "EROFS"
  );
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

export async function parsePostJsonBody<T>(
  req: Request,
): Promise<T | Response> {
  if (req.method !== "POST") {
    return textError("method not allowed", 405);
  }
  try {
    return (await req.json()) as T;
  } catch {
    return textError("invalid JSON body", 400);
  }
}

export function handleError(
  prefix: string,
  action: string,
  err: unknown,
): Response {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[code-viewer] ${prefix} error:`, message);
  if (isDockerComposeServiceUnavailableError(err)) {
    return textError(message, err.status);
  }
  if (isFilesystemAccessError(err)) {
    return textError(`failed to ${action}`, 500);
  }
  return textError(`failed to ${action}: ${message}`, 500);
}
