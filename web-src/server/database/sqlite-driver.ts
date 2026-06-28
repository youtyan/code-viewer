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
