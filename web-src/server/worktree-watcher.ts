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
  maxWatchedDirectories?: number;
  readdirSync?: (path: string) => DirectoryEntry[];
  isDirectory?: (path: string) => boolean;
  directorySignature?: (path: string) => string | null;
  onUpdate: (changedPaths?: string[]) => void;
  onError?: (error: unknown) => void;
  onWatchLimit?: (limit: number) => void;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
  debounceMs?: number;
};

export type WorktreeUpdateWatch = {
  started: boolean;
  close: () => void;
};

export const DEFAULT_WORKTREE_WATCH_DIRECTORY_LIMIT = 256;

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
  const maxWatchedDirectories = Math.max(
    1,
    Math.floor(
      options.maxWatchedDirectories ?? DEFAULT_WORKTREE_WATCH_DIRECTORY_LIMIT,
    ),
  );
  const watchers = new Map<string, WatchHandle>();
  const signatures = new Map<string, string>();
  const initialScanAsync =
    options.initialScanMode === "async" ||
    (((!options.watch || options.watch === nodeWatch) &&
      !options.readdirSync) as boolean);
  const initialScanQueue: string[] = [];
  let initialScanTimer: ReturnType<typeof setTimeout> | null = null;
  const pendingPathInspections = new Map<string, string>();
  let pathInspectionTimer: ReturnType<typeof setTimeout> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const pendingChangedPaths = new Set<string>();
  let watchLimitReported = false;

  const ignored = (path: string) =>
    isSkippableSearchPath(
      normalizeRelativePath(path),
      options.omitDirNames,
      options.excludeNames,
    );

  const directoryRelativePath = (dir: string) =>
    normalizeRelativePath(relative(options.root, dir));

  const ignoredDirectory = (dir: string) => {
    const rel = directoryRelativePath(dir);
    return Boolean(rel && ignored(rel));
  };

  const scheduleUpdate = (changedPath?: string) => {
    if (changedPath) pendingChangedPaths.add(changedPath);
    if (timer) clearTimer(timer);
    timer = setTimer(() => {
      timer = null;
      const paths = pendingChangedPaths.size
        ? [...pendingChangedPaths]
        : undefined;
      pendingChangedPaths.clear();
      options.onUpdate(paths);
    }, debounceMs);
  };

  const reportWatchLimit = () => {
    if (watchLimitReported) return;
    watchLimitReported = true;
    options.onWatchLimit?.(maxWatchedDirectories);
    options.onError?.(
      new Error(
        `worktree watcher cap reached (${maxWatchedDirectories}); subsequent changes may be missed`,
      ),
    );
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
    if (pathInspectionTimer) {
      clearTimer(pathInspectionTimer);
      pathInspectionTimer = null;
    }
    initialScanQueue.length = 0;
    pendingPathInspections.clear();
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
      const child = join(dir, entry.name);
      if (ignoredDirectory(child)) continue;
      children.push(child);
    }
    return children;
  };

  const processInitialScanQueue = () => {
    initialScanTimer = null;
    if (watchers.size >= maxWatchedDirectories) {
      reportWatchLimit();
      initialScanQueue.length = 0;
      return;
    }
    const next = initialScanQueue.shift();
    if (next) watchDirectory(next, true);
    if (watchers.size >= maxWatchedDirectories) {
      reportWatchLimit();
      initialScanQueue.length = 0;
    }
    if (initialScanQueue.length)
      initialScanTimer = setTimer(processInitialScanQueue, 50);
  };

  const queueInitialChildren = (dir: string) => {
    const remaining = maxWatchedDirectories - watchers.size;
    if (remaining <= 0) {
      reportWatchLimit();
      return;
    }
    const children = readChildDirectories(dir);
    if (children.length > remaining) reportWatchLimit();
    initialScanQueue.push(...children.slice(0, remaining));
    if (!initialScanTimer)
      initialScanTimer = setTimer(processInitialScanQueue, 5000);
  };

  const processChangedPath = (changed: string, fullChangedPath: string) => {
    const known = watchers.has(fullChangedPath);
    if (isDirectory(fullChangedPath)) {
      if (known) {
        const signature = directorySignature(fullChangedPath);
        if (signature && signature !== signatures.get(fullChangedPath)) {
          closeSubtree(fullChangedPath);
          watchDirectory(fullChangedPath, initialScanAsync);
        }
        scheduleUpdate(changed);
        return;
      }
      watchDirectory(fullChangedPath, initialScanAsync);
    } else if (known) {
      closeSubtree(fullChangedPath);
    }
    scheduleUpdate(changed);
  };

  const processPathInspections = () => {
    pathInspectionTimer = null;
    const entries = [...pendingPathInspections];
    pendingPathInspections.clear();
    for (const [changed, fullChangedPath] of entries) {
      processChangedPath(changed, fullChangedPath);
    }
  };

  const queuePathInspection = (changed: string, fullChangedPath: string) => {
    pendingPathInspections.set(changed, fullChangedPath);
    if (!pathInspectionTimer)
      pathInspectionTimer = setTimer(processPathInspections, 25);
  };

  const watchDirectory = (dir: string, initialScan = false): void => {
    if (watchers.has(dir)) return;
    if (watchers.size >= maxWatchedDirectories) {
      reportWatchLimit();
      return;
    }
    const rel = directoryRelativePath(dir);
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
          if (initialScanAsync) {
            queuePathInspection(changed, fullChangedPath);
            return;
          }
          processChangedPath(changed, fullChangedPath);
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
    if (watchers.size >= maxWatchedDirectories) {
      reportWatchLimit();
      return;
    }
    for (const child of readChildDirectories(dir)) watchDirectory(child);
  };

  watchDirectory(options.root, true);
  return { started: watchers.size > 0, close: closeAll };
}
