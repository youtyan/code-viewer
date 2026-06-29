// bun:sqlite (Bun ランタイム) と better-sqlite3 (Node 任意依存) のどちらかを
// 動的に読み込んで SQLite Database constructor を返す。共通実装。
// adapters/sqlite.ts と snapshot-store.ts の両方から使う (内部で持つ DbHandle
// の型は呼び出し側ごとに少しずつ違うため generic で受ける)。

export type SqliteOpenOptions = {
  readonly?: boolean;
  create?: boolean;
};

export type SqliteClassCtor<T = unknown> = new (
  path: string,
  options?: SqliteOpenOptions,
) => T;

// Bun と Node のどちらでも constructor をプロセス内 1 度だけ load する。
let cachedDbClass: unknown = null;

export async function loadSqliteClass<T = unknown>(): Promise<
  SqliteClassCtor<T>
> {
  if (cachedDbClass) return cachedDbClass as SqliteClassCtor<T>;
  try {
    const mod = await import("bun:sqlite");
    cachedDbClass = mod.Database as unknown as SqliteClassCtor<T>;
    return cachedDbClass as SqliteClassCtor<T>;
  } catch {
    // not running in Bun
  }
  try {
    // Keep this opaque to Bun's bundler; better-sqlite3 is a Node-only optional dependency.
    const mod = await (Function(
      'return import("better-sqlite3")',
    )() as Promise<{ default?: unknown }>);
    cachedDbClass = (mod.default || mod) as unknown as SqliteClassCtor<T>;
    return cachedDbClass as SqliteClassCtor<T>;
  } catch {
    // not installed
  }
  throw new Error(
    "No SQLite driver available. Install better-sqlite3 or use the bun runtime.",
  );
}

export type SqliteDriverStatus =
  | {
      kind: "ok";
      driver: "bun:sqlite" | "better-sqlite3";
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
  "Install with `npm i better-sqlite3`, or run code-viewer under Bun (which provides bun:sqlite).";

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
  if (typeof process !== "undefined" && process.versions?.bun) {
    try {
      await import("bun:sqlite");
      return { kind: "ok", driver: "bun:sqlite" };
    } catch {
      // Bun reported but module load failed; fall through.
    }
  }
  try {
    await (Function('return import("better-sqlite3")')() as Promise<unknown>);
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
