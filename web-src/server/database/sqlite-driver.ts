// better-sqlite3 (任意依存) を動的に読み込んで SQLite Database constructor を
// 返す。共通実装。adapters/sqlite.ts と snapshot-store.ts の両方から使う
// (内部で持つ DbHandle の型は呼び出し側ごとに少しずつ違うため generic で受ける)。
//
// import は静的に解決させない。任意依存なので、入っていない環境でもサーバ自体
// は起動できる必要がある。バンドル側では external にしてある。

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
  } catch {
    // not installed
  }
  throw new Error(
    "No SQLite driver available. Install better-sqlite3 to use SQLite features.",
  );
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
    await import("better-sqlite3");
    return { kind: "ok", driver: "better-sqlite3" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
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
      hint: INSTALL_GUIDE,
    };
  }
}
