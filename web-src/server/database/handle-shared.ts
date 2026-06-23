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
