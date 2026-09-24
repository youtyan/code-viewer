// 失敗したときに理由 (code・syscall・cause・exit code・stderr) を捨てず、
// 呼び出し側・ログに残すことを見る。core/ と server の小さな道具の分。
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { readCodexUsage } from "../server/accounts/usage";
import { buildFileShowReportAsync } from "../server/file-cli";
import { pathSignature, readWorktreeSnapshot } from "../server/watch-child";
import {
  startWorktreeUpdateWatch,
  type WatchFn,
} from "../server/worktree-watcher";

let dir = "";
const locked: string[] = [];
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "code-viewer-kept-reasons-"));
});
afterEach(() => {
  for (const path of locked.splice(0)) chmodSync(path, 0o755);
  rmSync(dir, { recursive: true, force: true });
});

/** 中を読めないフォルダを作る (root で走らせると chmod が効かない)。 */
function lockedDir(name: string): string {
  const path = join(dir, name);
  mkdirSync(path);
  writeFileSync(join(path, "inside.txt"), "sample");
  chmodSync(path, 0o000);
  locked.push(path);
  return path;
}

test("a shiki bundle that cannot load falls back to plain text and logs why", async () => {
  const failure = new Error("sample bundle failure");
  vi.resetModules();
  vi.doMock("../core/lazy-bundle", () => ({
    createBundleLoader: () => () => Promise.reject(failure),
  }));
  const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
  try {
    const { loadShikiHighlighter } = await import("../core/shiki-loader");
    expect(
      await loadShikiHighlighter({
        langs: ["sql", "bash"],
      }),
    ).toBeNull();
    expect(errors.mock.calls).toEqual([
      [
        "shiki: could not load the highlighter (sql, bash); showing plain text",
        failure,
      ],
    ]);
  } finally {
    errors.mockRestore();
    vi.doUnmock("../core/lazy-bundle");
    vi.resetModules();
  }
});

describe("file show on the worktree", () => {
  test.each([
    {
      name: "a file inside a folder that cannot be read",
      setup: () => `${lockedDir("sealed").slice(dir.length + 1)}/inside.txt`,
      error:
        /^file not readable: Error: failed to resolve .*\/sealed\/inside\.txt\nCaused by: Error: EACCES.*"code":"EACCES"/s,
    },
    {
      name: "a file that cannot be read",
      setup: () => {
        writeFileSync(join(dir, "sealed.txt"), "sample");
        chmodSync(join(dir, "sealed.txt"), 0o000);
        return "sealed.txt";
      },
      error: /^file not readable: Error: EACCES.*"syscall":"open"/s,
    },
    {
      name: "a missing file",
      setup: () => "missing.txt",
      error: /^file not found or forbidden$/,
    },
  ])("$name keeps the reason", async ({ setup, error }) => {
    const path = setup();
    const report = await buildFileShowReportAsync(dir, {
      kind: "show",
      path,
      ref: "worktree",
      json: true,
    });
    expect(report.error).toMatch(error);
  });
});

test("codex usage does not call a vanished session file 'no sessions'", () => {
  const day = join(dir, "sessions", "2026", "09", "24");
  mkdirSync(day, { recursive: true });
  // 一覧には出るが、stat すると無い (消えたファイルと同じ)。
  symlinkSync(join(dir, "gone.jsonl"), join(day, "rollout-sample.jsonl"));
  const usage = readCodexUsage(dir);
  expect(usage).toMatchObject({ status: "unavailable", reason: "unreadable" });
  expect(usage.status === "unavailable" && usage.detail).toMatch(
    /^failed to list .*\/sessions: Error: ENOENT.*rollout-sample\.jsonl/s,
  );
});

describe("worktree polling", () => {
  test("a failing git status is thrown with its exit code and stderr", async () => {
    await expect(
      readWorktreeSnapshot({ root: dir, omitDirNames: [], excludeNames: [] }),
    ).rejects.toThrow(
      /^git status exited with code 128: fatal: not a git repository/,
    );
  });

  test.each([
    { name: "a deleted path", path: "gone.txt", expected: "?:absent" },
  ])("$name is absent", async ({ path, expected }) => {
    expect(await pathSignature(dir, { path, status: "?" })).toBe(expected);
  });

  test("a path that cannot be inspected is not called absent", async () => {
    lockedDir("sealed");
    await expect(
      pathSignature(dir, { path: "sealed/inside.txt", status: "?" }),
    ).rejects.toMatchObject({ code: "EACCES" });
  });

  test("a changed path that cannot be inspected reaches onError", () => {
    lockedDir("sealed");
    let listener: Parameters<WatchFn>[2] | null = null;
    const errors: unknown[] = [];
    startWorktreeUpdateWatch({
      root: dir,
      omitDirNames: [],
      excludeNames: [],
      watch: ((path, _options, next) => {
        if (path === dir) listener = next;
      }) as WatchFn,
      readdirSync: () => [],
      setTimeoutFn: ((fn: () => void) => {
        fn();
        return 0;
      }) as unknown as typeof setTimeout,
      clearTimeoutFn: (() => undefined) as unknown as typeof clearTimeout,
      onUpdate: () => undefined,
      onError: (error) => errors.push(error),
    });
    listener?.("change", "sealed/inside.txt");
    expect(errors).toEqual([expect.objectContaining({ code: "EACCES" })]);
  });
});
