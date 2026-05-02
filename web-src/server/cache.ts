// Short enough that a browser reload self-heals stale git data, while still
// coalescing bursts from one render pass.
export const CACHE_TTL_MS = 1500;

export type TimedCacheEntry<T> = T & { storedAt: number };

export function cacheFresh<T>(
  cached: TimedCacheEntry<T> | undefined,
  now = Date.now(),
  ttlMs = CACHE_TTL_MS,
): cached is TimedCacheEntry<T> {
  return !!cached && now - cached.storedAt <= ttlMs;
}
