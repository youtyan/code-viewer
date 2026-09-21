// プロセスをまたいだ排他。`wx` で作れた者だけが持ち主になる小さなファイル。
//
// 同じユーザー単位のファイル (サーバの起動、プロジェクトの登録簿、ユーザー
// 単位の設定) を、別々のリポジトリで動く複数のサーバが同時に読み書きする。
// createJsonFileStore の直列化はプロセスの中だけなので、読んで・変えて・
// 書く間はこれで囲む。
//
// 持ち主のプロセスが居ない・古すぎるロックは奪う (落ちたサーバが残した
// ロックで永久に止まらないため)。

import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { errorWithCause } from "../core/error-detail";

export type FileLock = {
  release(): void;
};

type FileLockEntry = {
  token: string;
  pid: number;
  createdAt: number;
};

function errno(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException).code;
}

/** pid のプロセスが居るか。権限が無くても居ることは分かる (EPERM)。 */
export function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (errno(error) === "ESRCH") return false;
    if (errno(error) === "EPERM") return true;
    throw error;
  }
}

function readFileLock(file: string): FileLockEntry | null {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    if (errno(error) === "ENOENT") return null;
    throw errorWithCause(`failed to read lock ${file}`, error);
  }
  if (!raw || typeof raw !== "object") {
    throw new Error(`invalid lock ${file}: expected an object`);
  }
  const entry = raw as Record<string, unknown>;
  if (
    typeof entry.token !== "string" ||
    !entry.token ||
    !Number.isInteger(entry.pid) ||
    (entry.pid as number) < 1 ||
    typeof entry.createdAt !== "number" ||
    !Number.isFinite(entry.createdAt)
  ) {
    throw new Error(`invalid lock ${file}: missing required fields`);
  }
  return {
    token: entry.token,
    pid: entry.pid as number,
    createdAt: entry.createdAt,
  };
}

/**
 * 1 回だけ試す。持てたらロック、ほかの生きた持ち主が居れば null。
 * 持ち主が居ない・staleMs より古いロックは奪ってから取り直す。
 */
export function tryAcquireFileLock(
  file: string,
  options: { staleMs: number; now?: number },
): FileLock | null {
  const now = options.now ?? Date.now();
  mkdirSync(dirname(file), { recursive: true });
  const token = randomUUID();
  const entry: FileLockEntry = { token, pid: process.pid, createdAt: now };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      writeFileSync(file, `${JSON.stringify(entry)}\n`, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
      return {
        release() {
          const current = readFileLock(file);
          if (!current || current.token !== token) return;
          try {
            unlinkSync(file);
          } catch (error) {
            if (errno(error) === "ENOENT") return;
            throw error;
          }
        },
      };
    } catch (error) {
      if (errno(error) !== "EEXIST") throw error;
    }
    const current = readFileLock(file);
    if (!current) continue;
    const stale =
      now - current.createdAt > options.staleMs || !processAlive(current.pid);
    if (!stale) return null;
    try {
      unlinkSync(file);
    } catch (error) {
      if (errno(error) !== "ENOENT") throw error;
    }
  }
  throw new Error(`lock ${file} kept changing`);
}

/** 読んで・変えて・書く短い処理を囲む。持てるまで待ち、持てなければ投げる。 */
export async function withFileLock<T>(
  file: string,
  run: () => T | Promise<T>,
  options: { staleMs?: number; timeoutMs?: number; pollMs?: number } = {},
): Promise<T> {
  const staleMs = options.staleMs ?? 10_000;
  const deadline = Date.now() + (options.timeoutMs ?? 5_000);
  let lock = tryAcquireFileLock(file, { staleMs });
  while (!lock) {
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for the lock ${file}`);
    }
    await new Promise((resolve) => setTimeout(resolve, options.pollMs ?? 20));
    lock = tryAcquireFileLock(file, { staleMs });
  }
  let result: T;
  try {
    result = await run();
  } catch (error) {
    lock.release();
    throw error;
  }
  lock.release();
  return result;
}
