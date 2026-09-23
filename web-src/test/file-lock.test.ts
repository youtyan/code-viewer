import { spawn } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { tryAcquireFileLock, withFileLock } from "../server/file-lock";

const CHILD = fileURLToPath(new URL("./_file-lock-child.ts", import.meta.url));

describe("file lock", () => {
  let dir = "";
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "file-lock-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("the lock is a complete entry from the moment it exists, and leaves no temp file", () => {
    const file = join(dir, "sample.json.lock");
    const lock = tryAcquireFileLock(file, { staleMs: 60_000 });
    expect(lock).not.toBeNull();
    const entry = JSON.parse(readFileSync(file, "utf8"));
    expect(entry.pid).toBe(process.pid);
    expect(typeof entry.token).toBe("string");
    expect(readdirSync(dir)).toEqual(["sample.json.lock"]);
    lock?.release();
    expect(existsSync(file)).toBe(false);
    expect(readdirSync(dir)).toEqual([]);
  });

  test("a live holder keeps the lock; a dead holder's lock is taken over", () => {
    const file = join(dir, "sample.json.lock");
    const held = tryAcquireFileLock(file, { staleMs: 60_000 });
    expect(held).not.toBeNull();
    expect(tryAcquireFileLock(file, { staleMs: 60_000 })).toBeNull();
    held?.release();

    // pid が居ない (このプロセスの子として存在しない大きな番号) ロックは奪う。
    writeFileSync(
      file,
      JSON.stringify({ token: "x", pid: 2 ** 22 - 1, createdAt: Date.now() }),
    );
    const taken = tryAcquireFileLock(file, { staleMs: 60_000 });
    expect(taken).not.toBeNull();
    taken?.release();
  });

  // link で置く前の版が書きかけのまま落ちると、空のロックが残る。放っておくと
  // そのロックを使う経路がずっと失敗し続ける (実際に起きた)。
  test.each([
    ["empty", ""],
    ["broken JSON", "{"],
    ["missing fields", '{"token":"x"}'],
  ])("an unreadable lock (%s) older than staleMs is taken over with the reason logged, a fresh one still fails", (_label, body) => {
    const file = join(dir, "sample.json.lock");
    writeFileSync(file, body);
    const now = Date.now();
    // 新しい (staleMs 以内) うちは書きかけかもしれないので投げる。
    expect(() => tryAcquireFileLock(file, { staleMs: 60_000, now })).toThrow(
      /lock/,
    );
    // 古くなったら奪う。理由は console.error に出す。
    const errors: unknown[][] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args);
    };
    try {
      const lock = tryAcquireFileLock(file, {
        staleMs: 60_000,
        now: now + 61_000,
      });
      expect(lock).not.toBeNull();
      lock?.release();
    } finally {
      console.error = original;
    }
    expect(errors).toHaveLength(1);
    expect(String(errors[0][0])).toContain("removing unreadable lock");
    expect(errors[0][1]).toBeInstanceOf(Error);
    expect(existsSync(file)).toBe(false);
  });

  // 権限で読めないロックは、中身が壊れているとは限らない。古くても奪わない。
  test("a lock that cannot be read (not broken) is never taken over", () => {
    const file = join(dir, "sample.json.lock");
    writeFileSync(
      file,
      JSON.stringify({ token: "x", pid: process.pid, createdAt: 0 }),
    );
    chmodSync(file, 0o000);
    try {
      expect(() =>
        tryAcquireFileLock(file, { staleMs: 60_000, now: Date.now() + 61_000 }),
      ).toThrow(/failed to read lock/);
      expect(existsSync(file)).toBe(true);
    } finally {
      chmodSync(file, 0o600);
    }
  });

  test("when the work and the release both fail, both failures are thrown", async () => {
    const locks = join(dir, "locks");
    mkdirSync(locks);
    const file = join(locks, "sample.json.lock");
    const failure = new Error("sample work failure");
    let thrown: unknown;
    try {
      await withFileLock(file, () => {
        // 外すときの unlink が EACCES になる。
        chmodSync(locks, 0o500);
        throw failure;
      });
    } catch (error) {
      thrown = error;
    } finally {
      chmodSync(locks, 0o700);
    }
    expect(thrown).toMatchObject({
      message: `the work under the lock ${file} failed, and cleaning up also failed`,
      errors: [failure, expect.objectContaining({ code: "EACCES" })],
    });
  });

  // ロックを「作ってから書く」と、その間に読んだ別のプロセスが空のファイルを
  // JSON として解析して失敗する (agent-screen-rules-route のテストで実際に
  // 起きた)。別プロセスで同じロックを取り合っても、誰も読み損ねないこと。
  test("processes contending for one lock never see a half-written entry", async () => {
    const lockFile = join(dir, "counter.json.lock");
    const counterFile = join(dir, "counter.json");
    writeFileSync(counterFile, "0");
    const processes = 6;
    const rounds = 40;
    const results = await Promise.all(
      Array.from({ length: processes }, () =>
        runChild(lockFile, counterFile, rounds),
      ),
    );
    for (const result of results) {
      expect(result.stderr).toBe("");
      expect(result.code).toBe(0);
    }
    expect(Number(readFileSync(counterFile, "utf8"))).toBe(processes * rounds);
    expect(existsSync(lockFile)).toBe(false);
  }, 60_000);
});

function runChild(
  lockFile: string,
  counterFile: string,
  rounds: number,
): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", CHILD, lockFile, counterFile, String(rounds)],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stderr }));
  });
}
