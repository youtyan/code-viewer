import { describe, expect, test } from 'bun:test';
import { CACHE_TTL_MS, cacheFresh, type TimedCacheEntry } from '../server/cache';

describe('timed server cache', () => {
  test('uses entries until the TTL expires', () => {
    const cached: TimedCacheEntry<{ body: string }> = { body: 'cached', storedAt: 1000 };

    expect(cacheFresh(cached, 1000 + CACHE_TTL_MS)).toBe(true);
    expect(cacheFresh(cached, 1001 + CACHE_TTL_MS)).toBe(false);
  });

  test('treats missing entries as stale', () => {
    expect(cacheFresh(undefined, 1000)).toBe(false);
  });

  test('does not confuse empty cached values with stale cache misses', () => {
    const cached: TimedCacheEntry<{ diffText: string }> = { diffText: '', storedAt: 1000 };

    expect(cacheFresh(cached, 1001)).toBe(true);
    expect(cached.diffText).toBe('');
  });
});
