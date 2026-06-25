import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, watch, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_WORKTREE_OMIT_DIR_NAMES } from "../server/git";
import {
  startWorktreeUpdateWatch,
  type WatchFn,
} from "../server/worktree-watcher";

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitUntil(
  predicate: () => boolean,
  timeoutMs = 2000,
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return true;
    await wait(50);
  }
  return predicate();
}

async function canObserveNativeFsWatch(): Promise<boolean> {
  const root = mkdtempSync(join(tmpdir(), "code-viewer-watch-probe-"));
  let observed = false;
  const watcher = watch(root, { persistent: false }, () => {
    observed = true;
  });

  try {
    await wait(100);
    writeFileSync(join(root, "probe.txt"), "probe");
    return await waitUntil(() => observed, 1000);
  } catch {
    return false;
  } finally {
    watcher.close();
    rmSync(root, { recursive: true, force: true });
  }
}

const realWatcherTest = (await canObserveNativeFsWatch()) ? test : test.skip;

describe("worktree update watcher", () => {
  test("debounces accepted worktree changes into one update", () => {
    let listener: Parameters<WatchFn>[2] | null = null;
    let updates = 0;
    let scheduled: (() => void) | null = null;
    let cleared = 0;

    const handle = startWorktreeUpdateWatch({
      root: "/repo",
      omitDirNames: ["node_modules"],
      excludeNames: [".DS_Store"],
      watch: ((_path, _options, next) => {
        listener = next;
      }) as WatchFn,
      readdirSync: () => [],
      onUpdate: () => {
        updates++;
      },
      setTimeoutFn: ((callback: () => void) => {
        scheduled = callback;
        return 1;
      }) as typeof setTimeout,
      clearTimeoutFn: (() => {
        cleared++;
      }) as typeof clearTimeout,
    });

    expect(handle.started).toBe(true);
    listener?.("rename", "README.md");
    listener?.("change", "src/app.ts");
    expect(cleared).toBe(1);
    expect(updates).toBe(0);

    scheduled?.();
    expect(updates).toBe(1);
  });

  test("does not update for ignored paths", () => {
    let listener: Parameters<WatchFn>[2] | null = null;
    let scheduled: (() => void) | null = null;

    startWorktreeUpdateWatch({
      root: "/repo",
      omitDirNames: ["node_modules", "dist"],
      excludeNames: [".DS_Store"],
      watch: ((_path, _options, next) => {
        listener = next;
      }) as WatchFn,
      readdirSync: () => [],
      onUpdate: () => {
        throw new Error("ignored changes must not update");
      },
      setTimeoutFn: ((callback: () => void) => {
        scheduled = callback;
        return 1;
      }) as typeof setTimeout,
    });

    listener?.("rename", ".git/index.lock");
    listener?.("change", "node_modules/pkg/index.js");
    listener?.("change", "dist/app.js");
    listener?.("rename", "src/.DS_Store");

    expect(scheduled).toBeNull();
  });

  test("watches existing child directories but skips omitted directories", () => {
    const watched: string[] = [];

    startWorktreeUpdateWatch({
      root: "/repo",
      omitDirNames: ["node_modules"],
      excludeNames: [],
      watch: ((path) => {
        watched.push(path);
      }) as WatchFn,
      readdirSync: (path) => {
        if (path === "/repo") {
          return [
            { name: "src", isDirectory: () => true },
            { name: "node_modules", isDirectory: () => true },
            { name: "README.md", isDirectory: () => false },
          ];
        }
        if (path === "/repo/src") {
          return [{ name: "nested", isDirectory: () => true }];
        }
        return [];
      },
      onUpdate: () => {},
    });

    expect(watched).toEqual(["/repo", "/repo/src", "/repo/src/nested"]);
  });

  test("async initial scan watches existing child directories after startup", async () => {
    const watched: string[] = [];
    const scheduled: (() => void)[] = [];

    startWorktreeUpdateWatch({
      root: "/repo",
      omitDirNames: ["node_modules"],
      excludeNames: [],
      initialScanMode: "async",
      watch: ((path) => {
        watched.push(path);
      }) as WatchFn,
      readdirSync: (path) => {
        if (path === "/repo") {
          return [
            { name: "src", isDirectory: () => true },
            { name: "node_modules", isDirectory: () => true },
          ];
        }
        if (path === "/repo/src") {
          return [{ name: "nested", isDirectory: () => true }];
        }
        return [];
      },
      onUpdate: () => {},
      setTimeoutFn: ((callback: () => void) => {
        scheduled.push(callback);
        return scheduled.length;
      }) as typeof setTimeout,
    });

    expect(watched).toEqual(["/repo"]);
    while (!watched.includes("/repo/src/nested") && scheduled.length)
      scheduled.shift()?.();
    expect(watched).toEqual(["/repo", "/repo/src", "/repo/src/nested"]);
  });

  test("async initial scan skips default heavy runtime directories", () => {
    const readDirs: string[] = [];
    const scheduled: (() => void)[] = [];
    const watched: string[] = [];

    startWorktreeUpdateWatch({
      root: "/repo",
      omitDirNames: DEFAULT_WORKTREE_OMIT_DIR_NAMES,
      excludeNames: [],
      initialScanMode: "async",
      watch: ((path) => {
        watched.push(path);
      }) as WatchFn,
      readdirSync: (path) => {
        readDirs.push(path);
        if (path === "/repo") {
          return [
            { name: "app", isDirectory: () => true },
            { name: "tmp", isDirectory: () => true },
            { name: "log", isDirectory: () => true },
            { name: "storage", isDirectory: () => true },
          ];
        }
        if (path === "/repo/app") return [];
        throw new Error(`omitted directory must not be read: ${path}`);
      },
      onUpdate: () => {},
      setTimeoutFn: ((callback: () => void) => {
        scheduled.push(callback);
        return scheduled.length;
      }) as typeof setTimeout,
    });

    while (scheduled.length) scheduled.shift()?.();
    expect(watched).toEqual(["/repo", "/repo/app"]);
    expect(readDirs).toEqual(["/repo", "/repo/app"]);
  });

  test("async initial scan stops at the configured watch directory limit", () => {
    const readDirs: string[] = [];
    const scheduled: (() => void)[] = [];
    const watched: string[] = [];
    const errors: string[] = [];

    startWorktreeUpdateWatch({
      root: "/repo",
      omitDirNames: [],
      excludeNames: [],
      initialScanMode: "async",
      maxWatchedDirectories: 2,
      watch: ((path) => {
        watched.push(path);
      }) as WatchFn,
      readdirSync: (path) => {
        readDirs.push(path);
        if (path === "/repo") {
          return [
            { name: "a", isDirectory: () => true },
            { name: "b", isDirectory: () => true },
            { name: "c", isDirectory: () => true },
          ];
        }
        throw new Error(`watch limit must stop descendant reads: ${path}`);
      },
      onUpdate: () => {},
      onError: (error) => {
        errors.push(error instanceof Error ? error.message : String(error));
      },
      setTimeoutFn: ((callback: () => void) => {
        scheduled.push(callback);
        return scheduled.length;
      }) as typeof setTimeout,
    });

    while (scheduled.length) scheduled.shift()?.();
    expect(watched).toEqual(["/repo", "/repo/a"]);
    expect(readDirs).toEqual(["/repo"]);
    expect(errors).toEqual([
      "worktree watcher cap reached (2); subsequent changes may be missed",
    ]);
  });

  test("reports the watcher cap once when more directories arrive later", () => {
    let rootListener: Parameters<WatchFn>[2] | null = null;
    const watched: string[] = [];
    const errors: string[] = [];

    startWorktreeUpdateWatch({
      root: "/repo",
      omitDirNames: [],
      excludeNames: [],
      maxWatchedDirectories: 1,
      watch: ((path, _options, next) => {
        watched.push(path);
        if (path === "/repo") rootListener = next;
      }) as WatchFn,
      readdirSync: () => [],
      isDirectory: (path) => path === "/repo/a" || path === "/repo/b",
      onUpdate: () => {},
      onError: (error) => {
        errors.push(error instanceof Error ? error.message : String(error));
      },
    });

    rootListener?.("rename", "a");
    rootListener?.("rename", "b");

    expect(watched).toEqual(["/repo"]);
    expect(errors).toEqual([
      "worktree watcher cap reached (1); subsequent changes may be missed",
    ]);
  });

  test("starts watching a newly created directory after a rename event", () => {
    let listener: Parameters<WatchFn>[2] | null = null;
    const watched: string[] = [];

    startWorktreeUpdateWatch({
      root: "/repo",
      omitDirNames: [],
      excludeNames: [],
      watch: ((path, _options, next) => {
        watched.push(path);
        if (path === "/repo") listener = next;
      }) as WatchFn,
      readdirSync: (path) => {
        if (path === "/repo/new-dir") {
          return [{ name: "child", isDirectory: () => true }];
        }
        return [];
      },
      isDirectory: (path) =>
        path === "/repo/new-dir" || path === "/repo/new-dir/child",
      onUpdate: () => {},
    });

    listener?.("rename", "new-dir");

    expect(watched).toEqual(["/repo", "/repo/new-dir", "/repo/new-dir/child"]);
  });

  test("async watcher does not synchronously descend into new directory children", () => {
    let rootListener: Parameters<WatchFn>[2] | null = null;
    const scheduled: (() => void)[] = [];
    const watched: string[] = [];

    startWorktreeUpdateWatch({
      root: "/repo",
      omitDirNames: [],
      excludeNames: [],
      initialScanMode: "async",
      watch: ((path, _options, next) => {
        watched.push(path);
        if (path === "/repo") rootListener = next;
      }) as WatchFn,
      readdirSync: (path) => {
        if (path === "/repo/new-dir") {
          return [{ name: "child", isDirectory: () => true }];
        }
        if (path === "/repo/new-dir/child") {
          return [{ name: "grandchild", isDirectory: () => true }];
        }
        return [];
      },
      isDirectory: (path) => path.startsWith("/repo/new-dir"),
      onUpdate: () => {},
      setTimeoutFn: ((callback: () => void) => {
        scheduled.push(callback);
        return scheduled.length;
      }) as typeof setTimeout,
    });

    while (scheduled.length) scheduled.shift()?.();
    watched.length = 0;

    rootListener?.("rename", "new-dir");

    expect(watched).toEqual([]);
    scheduled.shift()?.();
    expect(watched).toEqual(["/repo/new-dir"]);
    while (scheduled.length) scheduled.shift()?.();
    expect(watched).toEqual([
      "/repo/new-dir",
      "/repo/new-dir/child",
      "/repo/new-dir/child/grandchild",
    ]);
  });

  test("async watcher coalesces repeated path inspections outside the event callback", () => {
    let rootListener: Parameters<WatchFn>[2] | null = null;
    const scheduled: (() => void)[] = [];
    let inspected = 0;

    startWorktreeUpdateWatch({
      root: "/repo",
      omitDirNames: [],
      excludeNames: [],
      initialScanMode: "async",
      watch: ((path, _options, next) => {
        if (path === "/repo") rootListener = next;
      }) as WatchFn,
      readdirSync: () => [],
      isDirectory: () => {
        inspected++;
        return false;
      },
      onUpdate: () => {},
      setTimeoutFn: ((callback: () => void) => {
        scheduled.push(callback);
        return scheduled.length;
      }) as typeof setTimeout,
    });

    rootListener?.("change", "app.ts");
    rootListener?.("change", "app.ts");
    rootListener?.("change", "app.ts");

    expect(inspected).toBe(0);
    while (scheduled.length && inspected === 0) scheduled.shift()?.();
    expect(inspected).toBe(1);
  });

  test("rewatches a directory after it is deleted and recreated", () => {
    let rootListener: Parameters<WatchFn>[2] | null = null;
    const closed: string[] = [];
    const watched: string[] = [];
    let exists = true;

    startWorktreeUpdateWatch({
      root: "/repo",
      omitDirNames: [],
      excludeNames: [],
      watch: ((path, _options, next) => {
        watched.push(path);
        if (path === "/repo") rootListener = next;
        return { close: () => closed.push(path) };
      }) as WatchFn,
      readdirSync: (path) => {
        if (path === "/repo") {
          return [{ name: "sub", isDirectory: () => true }];
        }
        return [];
      },
      isDirectory: (path) => path === "/repo/sub" && exists,
      onUpdate: () => {},
    });

    exists = false;
    rootListener?.("rename", "sub");
    exists = true;
    rootListener?.("rename", "sub");

    expect(closed).toEqual(["/repo/sub"]);
    expect(watched).toEqual(["/repo", "/repo/sub", "/repo/sub"]);
  });

  test("keeps an existing directory watcher when another rename event mentions it", () => {
    let rootListener: Parameters<WatchFn>[2] | null = null;
    const closed: string[] = [];
    const watched: string[] = [];

    startWorktreeUpdateWatch({
      root: "/repo",
      omitDirNames: [],
      excludeNames: [],
      watch: ((path, _options, next) => {
        watched.push(path);
        if (path === "/repo") rootListener = next;
        return { close: () => closed.push(path) };
      }) as WatchFn,
      readdirSync: (path) => {
        if (path === "/repo") {
          return [{ name: "sub", isDirectory: () => true }];
        }
        return [];
      },
      isDirectory: (path) => path === "/repo/sub",
      onUpdate: () => {},
    });

    rootListener?.("rename", "sub");

    expect(closed).toEqual([]);
    expect(watched).toEqual(["/repo", "/repo/sub"]);
  });

  test("rewatches an existing directory when its filesystem identity changes", () => {
    let rootListener: Parameters<WatchFn>[2] | null = null;
    const closed: string[] = [];
    const watched: string[] = [];
    let signature = "old";

    startWorktreeUpdateWatch({
      root: "/repo",
      omitDirNames: [],
      excludeNames: [],
      watch: ((path, _options, next) => {
        watched.push(path);
        if (path === "/repo") rootListener = next;
        return { close: () => closed.push(path) };
      }) as WatchFn,
      readdirSync: (path) => {
        if (path === "/repo") {
          return [{ name: "sub", isDirectory: () => true }];
        }
        return [];
      },
      isDirectory: (path) => path === "/repo/sub",
      directorySignature: (path) => (path === "/repo/sub" ? signature : path),
      onUpdate: () => {},
    });

    signature = "new";
    rootListener?.("rename", "sub");

    expect(closed).toEqual(["/repo/sub"]);
    expect(watched).toEqual(["/repo", "/repo/sub", "/repo/sub"]);
  });

  test("ignores watcher filenames that escape the worktree root", () => {
    let rootListener: Parameters<WatchFn>[2] | null = null;
    const watched: string[] = [];

    startWorktreeUpdateWatch({
      root: "/repo",
      omitDirNames: [],
      excludeNames: [],
      watch: ((path, _options, next) => {
        watched.push(path);
        if (path === "/repo") rootListener = next;
      }) as WatchFn,
      readdirSync: () => [],
      isDirectory: (path) => path === "/outside",
      onUpdate: () => {
        throw new Error("escaped paths must not update");
      },
    });

    rootListener?.("rename", "../outside");

    expect(watched).toEqual(["/repo"]);
  });

  realWatcherTest(
    "real watcher updates for normal files but not omitted directories",
    async () => {
      const root = mkdtempSync(join(tmpdir(), "code-viewer-watch-"));
      const updates: number[] = [];
      const handle = startWorktreeUpdateWatch({
        root,
        omitDirNames: ["node_modules"],
        excludeNames: [".DS_Store"],
        onUpdate: () => updates.push(Date.now()),
        debounceMs: 75,
      });

      try {
        expect(handle.started).toBe(true);
        await wait(500);
        writeFileSync(join(root, "README.md"), "hello");
        expect(await waitUntil(() => updates.length >= 1)).toBe(true);

        mkdirSync(join(root, "node_modules"));
        await wait(500);
        updates.length = 0;
        writeFileSync(join(root, "node_modules", "pkg.js"), "ignored");
        await wait(500);
        expect(updates.length).toBe(0);
      } finally {
        handle.close();
        rmSync(root, { recursive: true, force: true });
      }
    },
  );

  realWatcherTest(
    "real watcher keeps updating after a watched directory is recreated",
    async () => {
      const root = mkdtempSync(join(tmpdir(), "code-viewer-watch-recreate-"));
      const sub = join(root, "sub");
      mkdirSync(sub);
      const updates: number[] = [];
      const handle = startWorktreeUpdateWatch({
        root,
        omitDirNames: [],
        excludeNames: [],
        onUpdate: () => updates.push(Date.now()),
        debounceMs: 75,
      });

      try {
        expect(handle.started).toBe(true);
        await wait(500);
        rmSync(sub, { recursive: true, force: true });
        mkdirSync(sub);
        writeFileSync(join(sub, "after.txt"), "after");
        expect(await waitUntil(() => updates.length >= 1)).toBe(true);
      } finally {
        handle.close();
        rmSync(root, { recursive: true, force: true });
      }
    },
  );
});
