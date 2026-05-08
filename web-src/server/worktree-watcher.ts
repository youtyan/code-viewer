import {
  lstatSync,
  readdirSync as nodeReaddirSync,
  watch as nodeWatch,
} from "node:fs";
import { join, relative } from "node:path";
import { isSkippableSearchPath } from "./search";

export type WatchFn = (
  path: string,
  options: { persistent?: boolean },
  listener: (eventType: string, filename: string | Buffer | null) => void,
) => WatchHandle | unknown;

type WatchHandle = {
  close?: () => void;
  on?: (event: "error" | "close", listener: () => void) => unknown;
};

type DirectoryEntry = {
  name: string;
  isDirectory(): boolean;
};

type WorktreeUpdateWatchOptions = {
  root: string;
  omitDirNames: string[];
  excludeNames: string[];
  watch?: WatchFn;
  initialScanMode?: "sync" | "async";
  readdirSync?: (path: string) => DirectoryEntry[];
  isDirectory?: (path: string) => boolean;
  directorySignature?: (path: string) => string | null;
  onUpdate: () => void;
  onError?: (error: unknown) => void;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
  debounceMs?: number;
};

export type WorktreeUpdateWatch = {
  started: boolean;
  close: () => void;
};

function normalizeRelativePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+/, "");
}

function isInsideRoot(root: string, path: string): boolean {
  const rel = relative(root, path).replace(/\\/g, "/");
  return rel === "" || (!rel.startsWith("..") && !rel.startsWith("/"));
}

export function startWorktreeUpdateWatch(
  options: WorktreeUpdateWatchOptions,
): WorktreeUpdateWatch {
  const watch = options.watch || nodeWatch;
  const readDirs =
    options.readdirSync ||
    ((path: string) =>
      nodeReaddirSync(path, { withFileTypes: true }) as DirectoryEntry[]);
  const isDirectory =
    options.isDirectory ||
    ((path: string) => {
      try {
        return lstatSync(path).isDirectory();
      } catch {
        return false;
      }
    });
  const directorySignature =
    options.directorySignature ||
    ((path: string) => {
      try {
        const stats = lstatSync(path);
        if (!stats.isDirectory()) return null;
        return `${stats.dev}:${stats.ino}`;
      } catch {
        return null;
      }
    });
  const setTimer = options.setTimeoutFn || setTimeout;
  const clearTimer = options.clearTimeoutFn || clearTimeout;
  const debounceMs = options.debounceMs ?? 250;
  const watchers = new Map<string, WatchHandle>();
  const signatures = new Map<string, string>();
  const initialScanAsync =
    options.initialScanMode === "async" ||
    (((!options.watch || options.watch === nodeWatch) &&
      !options.readdirSync) as boolean);
  const initialScanQueue: string[] = [];
  let initialScanTimer: ReturnType<typeof setTimeout> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const ignored = (path: string) =>
    isSkippableSearchPath(
      normalizeRelativePath(path),
      options.omitDirNames,
      options.excludeNames,
    );

  const scheduleUpdate = () => {
    if (timer) clearTimer(timer);
    timer = setTimer(() => {
      timer = null;
      options.onUpdate();
    }, debounceMs);
  };

  const closeSubtree = (dir: string) => {
    for (const [watchedDir, watcher] of [...watchers]) {
      if (watchedDir !== dir && !watchedDir.startsWith(`${dir}/`)) continue;
      try {
        watcher.close?.();
      } catch {
        /* best-effort cleanup */
      }
      watchers.delete(watchedDir);
      signatures.delete(watchedDir);
    }
  };

  const closeAll = () => {
    if (initialScanTimer) {
      clearTimer(initialScanTimer);
      initialScanTimer = null;
    }
    initialScanQueue.length = 0;
    for (const watcher of [...watchers.values()]) {
      try {
        watcher.close?.();
      } catch {
        /* best-effort cleanup */
      }
    }
    watchers.clear();
    signatures.clear();
  };

  const readChildDirectories = (dir: string): string[] => {
    let entries: DirectoryEntry[];
    try {
      entries = readDirs(dir);
    } catch (error) {
      options.onError?.(error);
      return [];
    }
    const children: string[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      children.push(join(dir, entry.name));
    }
    return children;
  };

  const processInitialScanQueue = () => {
    initialScanTimer = null;
    const next = initialScanQueue.shift();
    if (next) watchDirectory(next, true);
    if (initialScanQueue.length)
      initialScanTimer = setTimer(processInitialScanQueue, 50);
  };

  const queueInitialChildren = (dir: string) => {
    initialScanQueue.push(...readChildDirectories(dir));
    if (!initialScanTimer)
      initialScanTimer = setTimer(processInitialScanQueue, 5000);
  };

  const watchDirectory = (dir: string, initialScan = false): void => {
    if (watchers.has(dir)) return;
    const rel = normalizeRelativePath(relative(options.root, dir));
    if (rel && ignored(rel)) return;

    try {
      const watcher =
        (watch(dir, { persistent: false }, (_event, filename) => {
          if (!filename) {
            scheduleUpdate();
            return;
          }
          const changed = normalizeRelativePath(join(rel, filename.toString()));
          if (ignored(changed)) return;
          const fullChangedPath = join(options.root, changed);
          if (!isInsideRoot(options.root, fullChangedPath)) return;
          const known = watchers.has(fullChangedPath);
          if (isDirectory(fullChangedPath)) {
            if (known) {
              const signature = directorySignature(fullChangedPath);
              if (signature && signature !== signatures.get(fullChangedPath)) {
                closeSubtree(fullChangedPath);
                watchDirectory(fullChangedPath);
              }
              scheduleUpdate();
              return;
            }
            watchDirectory(fullChangedPath);
          } else if (known) {
            closeSubtree(fullChangedPath);
          }
          scheduleUpdate();
        }) as WatchHandle | undefined) || {};
      watchers.set(dir, watcher);
      const signature = directorySignature(dir);
      if (signature) signatures.set(dir, signature);
      watcher.on?.("error", () => {
        if (watchers.get(dir) === watcher) {
          watchers.delete(dir);
          signatures.delete(dir);
        }
      });
      watcher.on?.("close", () => {
        if (watchers.get(dir) === watcher) {
          watchers.delete(dir);
          signatures.delete(dir);
        }
      });
    } catch (error) {
      options.onError?.(error);
      return;
    }

    if (initialScanAsync && initialScan) {
      queueInitialChildren(dir);
      return;
    }
    for (const child of readChildDirectories(dir)) watchDirectory(child);
  };

  watchDirectory(options.root, true);
  return { started: watchers.size > 0, close: closeAll };
}
