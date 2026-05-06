import { describe, expect, test } from "bun:test";
import {
  CACHE_TTL_MS,
  fileDiffCacheKey,
  setTimedCacheEntry,
  type TimedCacheEntry,
  cacheFresh,
} from "../server/cache";

describe("timed server cache", () => {
  test("uses entries until the TTL expires", () => {
    const cached: TimedCacheEntry<{ body: string }> = {
      body: "cached",
      storedAt: 1000,
    };

    expect(cacheFresh(cached, 1000 + CACHE_TTL_MS)).toBe(true);
    expect(cacheFresh(cached, 1001 + CACHE_TTL_MS)).toBe(false);
  });

  test("treats missing entries as stale", () => {
    expect(cacheFresh(undefined, 1000)).toBe(false);
  });

  test("does not confuse empty cached values with stale cache misses", () => {
    const cached: TimedCacheEntry<{ diffText: string }> = {
      diffText: "",
      storedAt: 1000,
    };

    expect(cacheFresh(cached, 1001)).toBe(true);
    expect(cached.diffText).toBe("");
  });

  test("caps timed cache entries by deleting the oldest key first", () => {
    const cache = new Map<string, TimedCacheEntry<{ body: string }>>();

    setTimedCacheEntry(cache, "a", { body: "one" }, 1000, 2);
    setTimedCacheEntry(cache, "b", { body: "two" }, 1001, 2);
    setTimedCacheEntry(cache, "c", { body: "three" }, 1002, 2);

    expect(cache.has("a")).toBe(false);
    expect(cache.has("b")).toBe(true);
    expect(cache.has("c")).toBe(true);
  });

  test("rejects untracked file diff cache keys for ref-to-ref ranges", () => {
    let message = "";
    try {
      fileDiffCacheKey({
        path: "main.tf",
        isUntracked: true,
        range: { from: "HEAD~1", to: "HEAD" },
        extras: [],
        args: ["HEAD~1", "HEAD"],
        cwd: process.cwd(),
      });
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toBe("untracked file diffs require a worktree range");
  });
});
