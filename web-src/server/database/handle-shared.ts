export type CloseableDatabaseHandle = {
  close(): void;
};

type AdapterCacheEntry<T extends CloseableDatabaseHandle> = {
  adapter: T;
  lastUsed: number;
};

export type DockerAdapterCache<T extends CloseableDatabaseHandle> = {
  getOrOpen(key: string, open: () => T): T;
  close(key: string): void;
};

const DEFAULT_MAX_DOCKER_ADAPTER_CACHE = 8;
const DEFAULT_DOCKER_ADAPTER_IDLE_MS = 5 * 60 * 1000;

export function createDockerAdapterCache<T extends CloseableDatabaseHandle>(
  maxEntries = DEFAULT_MAX_DOCKER_ADAPTER_CACHE,
  idleMs = DEFAULT_DOCKER_ADAPTER_IDLE_MS,
): DockerAdapterCache<T> {
  const cache = new Map<string, AdapterCacheEntry<T>>();

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
    getOrOpen(key: string, open: () => T): T {
      prune();
      const cached = cache.get(key);
      if (cached) {
        cached.lastUsed = Date.now();
        return cached.adapter;
      }
      const adapter = open();
      cache.set(key, { adapter, lastUsed: Date.now() });
      prune();
      return adapter;
    },

    close(key: string): void {
      const cached = cache.get(key);
      if (cached) closeEntry(key, cached);
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
  return wrap(await route.handler());
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
  return textError(`failed to ${action}: ${message}`, 500);
}
