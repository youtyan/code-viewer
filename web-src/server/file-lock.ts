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
import {
  linkSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
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

/** 無いファイルも、存在する最も近い親まで実パスにして同じ鍵へ揃える。 */
export function resolvedFilePath(file: string): string {
  let existing = file;
  const missing: string[] = [];
  for (;;) {
    try {
      return join(realpathSync(existing), ...missing);
    } catch (error) {
      if (errno(error) !== "ENOENT") {
        throw errorWithCause(`failed to resolve ${file}`, error);
      }
      const parent = dirname(existing);
      if (parent === existing) {
        throw errorWithCause(`failed to resolve ${file}`, error);
      }
      missing.unshift(basename(existing));
      existing = parent;
    }
  }
}

/** 同じ実体を指す別のリンクも同じロックを使う。 */
export function resolvedFileLockPath(file: string): string {
  return `${resolvedFilePath(file)}.lock`;
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
 * ロックの中身を書き終えてから、その場所に置く。置けたら true、既に誰かの
 * ロックがあれば false。
 *
 * `wx` で直接書くと「空のファイルを作る → 中身を書く」の 2 段になり、その間
 * に読んだ別のプロセスが空のファイルを JSON として解析して失敗する (実際に
 * 起きた)。中身まで書いた一時ファイルを link で置くと、他から見えるのは
 * 中身のあるロックだけになる (link は置き先が既にあれば EEXIST で失敗する)。
 */
function placeLockEntry(
  file: string,
  token: string,
  entry: FileLockEntry,
): boolean {
  const temp = `${file}.${token}.tmp`;
  writeFileSync(temp, `${JSON.stringify(entry)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  try {
    linkSync(temp, file);
    return true;
  } catch (error) {
    if (errno(error) !== "EEXIST") throw error;
    return false;
  } finally {
    unlinkSync(temp);
  }
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
    if (placeLockEntry(file, token, entry)) {
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
  // 3 回とも「置けなかったが、読んだときには消えていた」= 他の持ち主が
  // 取っては放している。取り合いが激しいだけで失敗ではないので、呼び出し側
  // (withFileLock) に次の周回で取り直させる。
  return null;
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
