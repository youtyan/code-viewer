import { lstatSync } from "node:fs";
import { join } from "node:path";

// Short enough that a browser reload self-heals stale git data, while still
// coalescing bursts from one render pass.
export const CACHE_TTL_MS = 1500;
export const MAX_TIMED_CACHE_ENTRIES = 200;

export type TimedCacheEntry<T> = T & { storedAt: number };

export function cacheFresh<T>(
  cached: TimedCacheEntry<T> | undefined,
  now = Date.now(),
  ttlMs = CACHE_TTL_MS,
): cached is TimedCacheEntry<T> {
  return !!cached && now - cached.storedAt <= ttlMs;
}

export function setTimedCacheEntry<T>(
  cache: Map<string, TimedCacheEntry<T>>,
  key: string,
  value: T,
  now = Date.now(),
  maxEntries = MAX_TIMED_CACHE_ENTRIES,
): void {
  cache.set(key, { ...value, storedAt: now });
  while (cache.size > maxEntries) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

export function worktreeFileSignature(path: string, cwd: string): string {
  try {
    const stats = lstatSync(join(cwd, path));
    const inode = "ino" in stats ? stats.ino : 0;
    return `state:file|size:${stats.size}|mtime:${stats.mtimeMs}|ctime:${stats.ctimeMs}|ino:${inode}`;
  } catch {
    return "state:missing";
  }
}

export function fileDiffCacheKey(options: {
  path: string;
  oldPath?: string | null;
  isUntracked: boolean;
  range: { from?: string; to?: string };
  extras: string[];
  args: string[];
  cwd: string;
}): string {
  const worktreeTarget =
    options.range.from === "worktree" ||
    !options.range.to ||
    options.range.to === "worktree";
  if (options.isUntracked && !worktreeTarget) {
    throw new Error("untracked file diffs require a worktree range");
  }
  const signature = worktreeTarget
    ? `\0${worktreeFileSignature(options.path, options.cwd)}`
    : "";
  if (options.isUntracked) {
    return `u\0${options.path}${signature}\0${options.extras.join("\0")}`;
  }
  return `t\0${options.path}\0${options.oldPath || ""}${signature}\0${[...options.extras, ...options.args].join("\0")}`;
}
