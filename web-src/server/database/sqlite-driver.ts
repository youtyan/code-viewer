// better-sqlite3 (任意依存) を動的に読み込んで SQLite Database constructor を
// 返す。共通実装。adapters/sqlite.ts と snapshot-store.ts の両方から使う
// (内部で持つ DbHandle の型は呼び出し側ごとに少しずつ違うため generic で受ける)。
//
// import は静的に解決させない。任意依存なので、入っていない環境でもサーバ自体
// は起動できる必要がある。バンドル側では external にしてある。

import {
  errorWithCause,
  errorWithCauses,
  formatErrorDetail,
} from "../../core/error-detail";

export type SqliteOpenOptions = {
  readonly?: boolean;
  create?: boolean;
};

export type SqliteClassCtor<T = unknown> = new (
  path: string,
  options?: SqliteOpenOptions,
) => T;

// constructor はプロセス内で 1 度だけ load する。
let cachedDbClass: unknown = null;

export async function loadSqliteClass<T = unknown>(): Promise<
  SqliteClassCtor<T>
> {
  if (cachedDbClass) return cachedDbClass as SqliteClassCtor<T>;
  try {
    const mod = (await import("better-sqlite3")) as { default?: unknown };
    cachedDbClass = (mod.default || mod) as unknown as SqliteClassCtor<T>;
    return cachedDbClass as SqliteClassCtor<T>;
  } catch (error) {
    throw errorWithCause(
      "No SQLite driver available. Install better-sqlite3 to use SQLite features.",
      error,
    );
  }
}

/**
 * 失敗した transaction を戻す。SQLite が先に自分で戻した後の「no transaction is
 * active」だけは戻す物が無いので黙る。ほかの失敗は元の失敗と並べて投げる。
 */
export function rollbackAfter(rollback: () => void, failure: unknown): void {
  try {
    rollback();
  } catch (rollbackError) {
    if (/no transaction is active/i.test(formatErrorDetail(rollbackError))) {
      return;
    }
    throw errorWithCauses(
      "the transaction failed, and rolling it back also failed",
      [failure, rollbackError],
    );
  }
}

export type SqliteDriverStatus =
  | {
      kind: "ok";
      driver: "better-sqlite3";
    }
  | {
      kind: "abi-mismatch";
      driver: "better-sqlite3";
      compiledAbi: number;
      runtimeAbi: number;
      modulePath?: string;
      message: string;
      hint: string;
    }
  | {
      kind: "unavailable";
      driver: "better-sqlite3";
      message: string;
      hint: string;
    };

const NPX_CACHE_GUIDE =
  "Stale npx cache likely contains a binary compiled for a different Node.js version. " +
  "Fix: `rm -rf ~/.npm/_npx` (macOS / Linux) " +
  'or `Remove-Item -Recurse -Force "$(npm config get cache)\\_npx"` (Windows), ' +
  "then re-run `npx -y @youtyan/code-viewer@latest …`.";

const INSTALL_GUIDE =
  "better-sqlite3 is an optional dependency required for SQLite features (data viewer / snapshot). " +
  "Install it with `npm i better-sqlite3`.";

const MISSING_BUILD_GUIDE =
  "better-sqlite3 is installed, but its native build is missing: its install script did not run " +
  "(npm --ignore-scripts, or npm's allow-scripts left it unapproved). " +
  "Run `npm rebuild better-sqlite3` where code-viewer is installed " +
  "(or `npm approve-scripts better-sqlite3` and install again).";

/**
 * better-sqlite3 を読めなかった・開けなかった理由から、状態と直し方を決める。
 * ネイティブの部品が無いのは import では分からず、DB を開いたときに
 * 「Could not locate the bindings file」で分かる。
 */
export function _classifySqliteLoadError(
  message: string,
): Exclude<SqliteDriverStatus, { kind: "ok" }> {
  const abi = parseAbiMismatch(message);
  if (abi) {
    return {
      kind: "abi-mismatch",
      driver: "better-sqlite3",
      compiledAbi: abi.compiledAbi,
      runtimeAbi: abi.runtimeAbi,
      ...(abi.modulePath ? { modulePath: abi.modulePath } : {}),
      message,
      hint: NPX_CACHE_GUIDE,
    };
  }
  return {
    kind: "unavailable",
    driver: "better-sqlite3",
    message,
    hint: /Could not locate the bindings file/.test(message)
      ? MISSING_BUILD_GUIDE
      : INSTALL_GUIDE,
  };
}

export function _parseSqliteAbiMismatchMessage(message: string): {
  compiledAbi: number;
  runtimeAbi: number;
  modulePath?: string;
} | null {
  return parseAbiMismatch(message);
}

function parseAbiMismatch(message: string): {
  compiledAbi: number;
  runtimeAbi: number;
  modulePath?: string;
} | null {
  const versions = Array.from(message.matchAll(/NODE_MODULE_VERSION\s+(\d+)/g));
  if (versions.length < 2) return null;
  const compiledAbi = Number(versions[0]?.[1]);
  const runtimeAbi = Number(versions[1]?.[1]);
  if (!Number.isFinite(compiledAbi) || !Number.isFinite(runtimeAbi))
    return null;
  const modulePathMatch = /The module ['"]([^'"]+)['"]/.exec(message);
  return {
    compiledAbi,
    runtimeAbi,
    ...(modulePathMatch ? { modulePath: modulePathMatch[1] } : {}),
  };
}

export async function describeSqliteDriver(): Promise<SqliteDriverStatus> {
  try {
    const mod = (await import("better-sqlite3")) as { default?: unknown };
    const Database = (mod.default || mod) as SqliteClassCtor<{
      close(): void;
    }>;
    // ネイティブの部品は DB を開くときに初めて読むので、import だけでは
    // 部品が無い・Node.js と合わないのを見逃す。実際に 1 度開いて閉じる。
    new Database(":memory:").close();
    return { kind: "ok", driver: "better-sqlite3" };
  } catch (err) {
    return _classifySqliteLoadError(formatErrorDetail(err));
  }
}
