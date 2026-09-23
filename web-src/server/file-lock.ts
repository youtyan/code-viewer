// プロセスをまたいだ排他。中身を書いた一時ファイルを link で置けた者だけが
// 持ち主になる小さなファイル (placeLockEntry)。
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
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { errorWithCause, errorWithCauses } from "../core/error-detail";

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

/**
 * 中身が壊れている (空・JSON でない・欄が無い) ロック。古ければ奪ってよい。
 * 読めない (権限・I/O) の失敗とは分ける: そちらは奪わずに投げる。
 */
class BrokenLockError extends Error {}

function readFileLock(file: string): FileLockEntry | null {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    if (errno(error) === "ENOENT") return null;
    throw errorWithCause(`failed to read lock ${file}`, error);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw Object.assign(new BrokenLockError(`invalid lock ${file}: not JSON`), {
      cause: error,
    });
  }
  if (!raw || typeof raw !== "object") {
    throw new BrokenLockError(`invalid lock ${file}: expected an object`);
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
    throw new BrokenLockError(`invalid lock ${file}: missing required fields`);
  }
  return {
    token: entry.token,
    pid: entry.pid as number,
    createdAt: entry.createdAt,
  };
}

/** ロックの token か、読めない (空・壊れた JSON・欄が無い) 理由。 */
function lockTokenOrUnreadable(file: string): string | { unreadable: unknown } {
  try {
    const entry = readFileLock(file);
    if (entry) return entry.token;
    return { unreadable: new Error(`lock ${file} disappeared`) };
  } catch (error) {
    if (!(error instanceof BrokenLockError)) throw error;
    return { unreadable: error };
  }
}

/**
 * 古いと判断したロックを消す (奪う)。読んだもの (token。読めなかったなら
 * null) がまだそこにあるときだけ消す。
 *
 * 「読む → unlink」だと、その間に別のプロセスが同じ古いロックを奪って置き
 * 直した新しいロックを消し、2 者とも持ててしまう。自分だけの名前へ rename
 * で退避すると (rename は原子的。相手が先に退避していれば ENOENT)、退避した
 * ものが読んだものと違う (= 相手の新しいロック) と分かったら元の場所へ戻せる。
 */
function removeStaleLock(
  file: string,
  expected: string | null,
  token: string,
): void {
  const aside = `${file}.${token}.stale`;
  try {
    renameSync(file, aside);
  } catch (error) {
    if (errno(error) === "ENOENT") return;
    throw error;
  }
  try {
    putBackIfReplaced(file, aside, expected);
  } catch (error) {
    cleanUpAfterFailure(
      () => unlinkSync(aside),
      error,
      `taking over the stale lock ${file}`,
    );
    throw error;
  }
  unlinkSync(aside);
}

/** 退避したものが読んだものと違う (相手の新しいロック) なら元の場所へ戻す。 */
function putBackIfReplaced(
  file: string,
  aside: string,
  expected: string | null,
): void {
  const moved = lockTokenOrUnreadable(aside);
  if (expected === null ? typeof moved !== "string" : moved === expected) {
    return;
  }
  try {
    linkSync(aside, file);
  } catch (error) {
    throw errorWithCauses(
      `the lock ${file} was replaced by another owner while taking over a stale one, and could not be put back`,
      typeof moved === "string" ? [error] : [error, moved.unreadable],
    );
  }
}

/**
 * 失敗した処理の後の片付け。片付けも失敗したら、元の失敗と両方を持つ error を
 * 投げる (片付けの失敗で元の失敗を上書きしない)。成功したら何もしない。
 */
export function cleanUpAfterFailure(
  cleanUp: () => void,
  error: unknown,
  what: string,
): void {
  try {
    cleanUp();
  } catch (cleanUpError) {
    throw errorWithCauses(`${what} failed, and cleaning up also failed`, [
      error,
      cleanUpError,
    ]);
  }
}

/**
 * 読めないロックが staleMs より古ければ、理由を出して消す (奪う)。消したら
 * true。新しい (書きかけかもしれない) か、もう無いなら false。
 */
function takeOverUnreadableLock(
  file: string,
  cause: unknown,
  now: number,
  staleMs: number,
  token: string,
): boolean {
  let mtimeMs: number;
  try {
    mtimeMs = statSync(file).mtimeMs;
  } catch (error) {
    if (errno(error) === "ENOENT") return true;
    throw errorWithCause(`failed to stat unreadable lock ${file}`, error);
  }
  if (now - mtimeMs <= staleMs) return false;
  console.error(
    `[code-viewer] removing unreadable lock ${file} (last written ${new Date(mtimeMs).toISOString()}):`,
    cause,
  );
  removeStaleLock(file, null, token);
  return true;
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
  let placed: boolean;
  try {
    linkSync(temp, file);
    placed = true;
  } catch (error) {
    if (errno(error) !== "EEXIST") {
      cleanUpAfterFailure(
        () => unlinkSync(temp),
        error,
        `placing the lock ${file}`,
      );
      throw error;
    }
    placed = false;
  }
  unlinkSync(temp);
  return placed;
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
    let current: FileLockEntry | null;
    try {
      current = readFileLock(file);
    } catch (error) {
      // 読めないロック (空・壊れた JSON・欄が無い)。link で置く前の版が
      // 書きかけのまま落ちると残る。放っておくと、このロックを使う経路が
      // ずっと失敗し続けるので、staleMs より古ければ理由を出して奪う。
      // 新しいものは、書きかけかもしれないので今までどおり投げる。
      // 権限・I/O で読めないものは中身が壊れているとは限らないので奪わない。
      if (
        !(error instanceof BrokenLockError) ||
        !takeOverUnreadableLock(file, error, now, options.staleMs, token)
      ) {
        throw error;
      }
      continue;
    }
    if (!current) continue;
    const stale =
      now - current.createdAt > options.staleMs || !processAlive(current.pid);
    if (!stale) return null;
    removeStaleLock(file, current.token, token);
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
    cleanUpAfterFailure(
      () => lock.release(),
      error,
      `the work under the lock ${file}`,
    );
    throw error;
  }
  lock.release();
  return result;
}
