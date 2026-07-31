import { mkdirSync, mkdtempSync, rmSync, watch, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  DEFAULT_WORKTREE_OMIT_DIR_NAMES,
  withAlwaysWorktreeOmitDirNames,
} from "../server/git";
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
      onUpdate: () => undefined,
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
      onUpdate: () => undefined,
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

  test("async initial scan keeps only one directory-scan timer pending", () => {
    const watched: string[] = [];
    const scheduled = new Map<number, () => void>();
    let nextTimerId = 0;

    startWorktreeUpdateWatch({
      root: "/repo",
      omitDirNames: [],
      excludeNames: [],
      initialScanMode: "async",
      watch: ((path) => {
        watched.push(path);
      }) as WatchFn,
      readdirSync: (path) => {
        if (path === "/repo") return [{ name: "src", isDirectory: () => true }];
        if (path === "/repo/src")
          return [{ name: "nested", isDirectory: () => true }];
        return [];
      },
      onUpdate: () => undefined,
      setTimeoutFn: ((callback: () => void) => {
        const id = ++nextTimerId;
        scheduled.set(id, callback);
        return id;
      }) as typeof setTimeout,
      clearTimeoutFn: ((id: number) => {
        scheduled.delete(id);
      }) as typeof clearTimeout,
    });

    expect(scheduled.size).toBe(1);
    while (scheduled.size) {
      const [id, callback] = scheduled.entries().next().value as [
        number,
        () => void,
      ];
      scheduled.delete(id);
      callback();
      expect(scheduled.size > 1).toBe(false);
    }
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
      onUpdate: () => undefined,
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
      onUpdate: () => undefined,
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
      onUpdate: () => undefined,
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

  test("invokes onWatchLimit once with the cap when the limit is reached", () => {
    let rootListener: Parameters<WatchFn>[2] | null = null;
    const limits: number[] = [];

    startWorktreeUpdateWatch({
      root: "/repo",
      omitDirNames: [],
      excludeNames: [],
      maxWatchedDirectories: 1,
      watch: ((path, _options, next) => {
        if (path === "/repo") rootListener = next;
      }) as WatchFn,
      readdirSync: () => [],
      isDirectory: (path) => path === "/repo/a" || path === "/repo/b",
      onUpdate: () => undefined,
      onWatchLimit: (limit) => {
        limits.push(limit);
      },
    });

    rootListener?.("rename", "a");
    rootListener?.("rename", "b");

    expect(limits).toEqual([1]);
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
      onUpdate: () => undefined,
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
      onUpdate: () => undefined,
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
      onUpdate: () => undefined,
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
      onUpdate: () => undefined,
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
      onUpdate: () => undefined,
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
      onUpdate: () => undefined,
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

describe("withAlwaysWorktreeOmitDirNames", () => {
  test.each([
    {
      name: "旧設定スナップショット (両方欠落) は末尾に .devbox / .direnv を追加",
      input: ["node_modules", "vendor"],
      expected: ["node_modules", "vendor", ".devbox", ".direnv"],
    },
    {
      name: "両方含む場合は変更なし",
      input: ["node_modules", ".devbox", ".direnv"],
      expected: ["node_modules", ".devbox", ".direnv"],
    },
    {
      name: ".devbox のみ欠落なら .devbox だけ追加",
      input: [".direnv", "dist"],
      expected: [".direnv", "dist", ".devbox"],
    },
    {
      name: ".direnv のみ欠落なら .direnv だけ追加",
      input: [".devbox", "dist"],
      expected: [".devbox", "dist", ".direnv"],
    },
    {
      name: "空リストには両方追加",
      input: [],
      expected: [".devbox", ".direnv"],
    },
  ])("$name", ({ input, expected }) => {
    expect(withAlwaysWorktreeOmitDirNames(input)).toEqual(expected);
  });

  test("union 済み入力は同一参照を返す (watcher 再構築判定の契約)", () => {
    const merged = ["node_modules", ".devbox", ".direnv"];
    expect(withAlwaysWorktreeOmitDirNames(merged)).toBe(merged);
  });

  test("既定リストは union 済みなので同一参照を返す", () => {
    expect(
      withAlwaysWorktreeOmitDirNames(DEFAULT_WORKTREE_OMIT_DIR_NAMES),
    ).toBe(DEFAULT_WORKTREE_OMIT_DIR_NAMES);
  });

  test("欠落時は新しい配列を返し入力リストを破壊しない", () => {
    const input = ["node_modules"];
    const result = withAlwaysWorktreeOmitDirNames(input);
    expect(result).not.toBe(input);
    expect(input).toEqual(["node_modules"]);
  });
});

type WatchOptions = Parameters<WatchFn>[1];

function startForFakeWatch(
  overrides: Partial<Parameters<typeof startWorktreeUpdateWatch>[0]> = {},
) {
  let listener: Parameters<WatchFn>[2] | null = null;
  let scheduled: (() => void) | null = null;
  let readdirCalls = 0;
  const watchedPaths: string[] = [];
  const watchedOptions: WatchOptions[] = [];
  const received: Array<string[] | undefined> = [];

  const handle = startWorktreeUpdateWatch({
    root: "/repo",
    omitDirNames: ["node_modules"],
    excludeNames: [],
    watch: ((path, options, next) => {
      watchedPaths.push(path);
      watchedOptions.push(options);
      // Keep the root's listener: a child watcher resolves filenames relative
      // to its own directory, which would shift every path in these cases.
      if (listener === null) listener = next;
    }) as WatchFn,
    readdirSync: (path: string) => {
      readdirCalls++;
      // Only the root has a child, so the non-recursive walk terminates.
      return path === "/repo" ? [{ name: "src", isDirectory: () => true }] : [];
    },
    isDirectory: () => false,
    onUpdate: (paths) => {
      received.push(paths);
    },
    setTimeoutFn: ((callback: () => void) => {
      scheduled = callback;
      return 1;
    }) as typeof setTimeout,
    clearTimeoutFn: (() => 0) as typeof clearTimeout,
    ...overrides,
  });

  return {
    handle,
    notify: (event: string, filename: string | null) =>
      listener?.(event, filename),
    flush: () => scheduled?.(),
    watchedPaths,
    watchedOptions,
    received,
    readdirCalls: () => readdirCalls,
  };
}

describe("worktree update watcher: 場所不明の通知", () => {
  // libuv は FSEvents の取りこぼしフラグを JS へ渡さないため、filename が無い
  // 通知は「どこが変わったか分からない」を意味する。その後に届いた具体パスは
  // 完全な変更一覧ではないので、部分更新へ格下げしてはいけない。
  test("場所不明の通知の後に具体パスが来ても全体更新のまま渡す", () => {
    const { notify, flush, received } = startForFakeWatch();

    notify("rename", null);
    notify("change", "src/app.ts");
    flush();

    expect(received).toEqual([undefined]);
  });

  test("具体パスだけの通知は部分更新として渡す", () => {
    const { notify, flush, received } = startForFakeWatch();

    notify("change", "src/app.ts");
    flush();

    expect(received).toEqual([["src/app.ts"]]);
  });

  test("順序が逆でも全体更新が優先される", () => {
    const { notify, flush, received } = startForFakeWatch();

    notify("change", "src/app.ts");
    notify("rename", null);
    flush();

    expect(received).toEqual([undefined]);
  });

  test("flush 後は次の通知から部分更新に戻る", () => {
    const { notify, flush, received } = startForFakeWatch();

    notify("rename", null);
    flush();
    notify("change", "src/app.ts");
    flush();

    expect(received).toEqual([undefined, ["src/app.ts"]]);
  });
});

describe("worktree update watcher: 再帰モード", () => {
  test.each([
    {
      name: "recursive 指定時は watch に recursive を渡す",
      recursive: true,
      expected: true,
    },
    {
      name: "recursive 未指定時は watch に recursive を渡さない",
      recursive: undefined,
      expected: false,
    },
  ])("$name", ({ recursive, expected }) => {
    const { watchedOptions } = startForFakeWatch({ recursive });
    expect(watchedOptions[0].recursive).toBe(expected);
  });

  // 1024個の watcher を張ると libuv が close ごとに全パスを再登録するため
  // O(n^2) になる。root 1個に畳むことがデッドロック対策の本体。
  test("recursive では root だけを watch する", () => {
    const { handle, watchedPaths } = startForFakeWatch({ recursive: true });

    expect(watchedPaths).toEqual(["/repo"]);
    expect(handle.started).toBe(true);
  });

  test("recursive では子ディレクトリを走査しない", () => {
    const { readdirCalls } = startForFakeWatch({ recursive: true });

    expect(readdirCalls()).toBe(0);
  });

  test("非 recursive では子ディレクトリも watch する", () => {
    const { watchedPaths } = startForFakeWatch();

    expect(watchedPaths).toEqual(["/repo", "/repo/src"]);
  });

  test("recursive では新しいディレクトリの通知でも watcher を増やさない", () => {
    const { notify, watchedPaths } = startForFakeWatch({
      recursive: true,
      isDirectory: () => true,
    });

    notify("rename", "src/new-dir");

    expect(watchedPaths).toEqual(["/repo"]);
  });

  test("recursive では深い階層の通知もそのまま更新対象として渡す", () => {
    const { notify, flush, received } = startForFakeWatch({ recursive: true });

    notify("change", "src/views/deep/nested.ts");
    flush();

    expect(received).toEqual([["src/views/deep/nested.ts"]]);
  });

  test("recursive でも除外対象のパスは無視する", () => {
    const { notify, flush, received } = startForFakeWatch({
      recursive: true,
      omitDirNames: ["node_modules"],
    });

    notify("change", "node_modules/pkg/index.js");
    flush();

    expect(received).toEqual([]);
  });
});
