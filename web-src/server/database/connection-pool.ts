import type { DatabaseAdapter, DatabaseAdapterFactory } from "./adapters/types";

const MAX_CONNECTIONS = 8;
const IDLE_TIMEOUT_MS = 5 * 60 * 1000;

type PoolEntry = {
  adapter: DatabaseAdapter;
  path: string;
  lastUsed: number;
  timer: ReturnType<typeof setTimeout>;
};

const pool = new Map<string, PoolEntry>();

let factory: DatabaseAdapterFactory | null = null;

export function setAdapterFactory(f: DatabaseAdapterFactory): void {
  factory = f;
}

function evictOldest(): void {
  let oldestKey: string | null = null;
  let oldestTime = Infinity;
  for (const [key, entry] of pool) {
    if (entry.lastUsed < oldestTime) {
      oldestTime = entry.lastUsed;
      oldestKey = key;
    }
  }
  if (oldestKey) {
    const entry = pool.get(oldestKey);
    if (entry) {
      clearTimeout(entry.timer);
      try {
        entry.adapter.close();
      } catch {
        // ignore close errors
      }
      pool.delete(oldestKey);
    }
  }
}

function scheduleEviction(key: string, entry: PoolEntry): void {
  clearTimeout(entry.timer);
  entry.timer = setTimeout(() => {
    const current = pool.get(key);
    if (current === entry) {
      try {
        current.adapter.close();
      } catch {
        // ignore
      }
      pool.delete(key);
    }
  }, IDLE_TIMEOUT_MS);
}

export async function getConnection(
  resolvedPath: string,
): Promise<DatabaseAdapter> {
  if (!factory) {
    throw new Error("No adapter factory configured");
  }
  const existing = pool.get(resolvedPath);
  if (existing) {
    existing.lastUsed = Date.now();
    scheduleEviction(resolvedPath, existing);
    return existing.adapter;
  }
  if (pool.size >= MAX_CONNECTIONS) {
    evictOldest();
  }
  const adapter = await factory.open(resolvedPath);
  const entry: PoolEntry = {
    adapter,
    path: resolvedPath,
    lastUsed: Date.now(),
    timer: setTimeout(() => undefined, 0),
  };
  pool.set(resolvedPath, entry);
  scheduleEviction(resolvedPath, entry);
  return adapter;
}

export function closeConnection(resolvedPath: string): boolean {
  const entry = pool.get(resolvedPath);
  if (!entry) return false;
  clearTimeout(entry.timer);
  try {
    entry.adapter.close();
  } catch {
    // ignore
  }
  pool.delete(resolvedPath);
  return true;
}

export function closeAllConnections(): void {
  for (const [, entry] of pool) {
    clearTimeout(entry.timer);
    try {
      entry.adapter.close();
    } catch {
      // ignore
    }
  }
  pool.clear();
}
