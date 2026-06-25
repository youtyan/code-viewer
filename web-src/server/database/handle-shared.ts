import type { DbKind } from "../../core/database/types";
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

export function createQueryStrippedLogger(
  prefix: string,
  req: Request,
  url: URL,
): (res: Response) => Response {
  const path = url.pathname;
  const start = Date.now();
  const method = req.method;
  return (res: Response): Response => {
    const ms = Date.now() - start;
    console.log(
      `[code-viewer] ${prefix} ${method} ${path} ${res.status} ${ms}ms`,
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
  const info = await findDockerServiceByDbIdAsync(
    cwd,
    dbParam,
    kind,
    omitDirNames,
    signal,
  );
  if (!info) return textError(`${kind} service not found`, 404);

  const explorer = await cache.getOrOpenAsync(dbParam, () => openFn(info));
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
  return textError(`failed to ${action}: ${message}`, 500);
}
