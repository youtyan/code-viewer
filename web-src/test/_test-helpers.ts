// 複数テストで重複していた汎用ヘルパを集約。
//
// - q(root, sel): querySelector + missing チェック (4 explorer / grid テスト
//   で同形だった)
// - deferred<T>(): resolve/reject を外から触れる Promise (history /
//   network-activity / repo-view-race / file-shell-view で同形だった)
// - makeDiffMeta(files): files から totals を集計した DiffMeta を作る
//   (diff-view-fast-path / ai-context-copy で同形だった)
// - captureErrorAsync(fn): 投げられたエラーのメッセージを取り出す
//   (プロジェクトの bun:test 型は toThrow / rejects を持たないため)

import type { DiffMeta, FileMeta } from "../core/types";

// 同期・非同期どちらの throw も拾う。呼び出しが投げなければテストを失敗させる。
export async function captureErrorAsync(fn: () => unknown): Promise<string> {
  try {
    await fn();
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
  throw new Error("expected function to throw, but it did not");
}

export function makeDiffMeta(
  files: FileMeta[],
  overrides?: Partial<DiffMeta>,
): DiffMeta {
  return {
    files,
    totals: {
      files: files.length,
      additions: files.reduce((sum, f) => sum + (f.additions || 0), 0),
      deletions: files.reduce((sum, f) => sum + (f.deletions || 0), 0),
    },
    ...overrides,
  };
}

export function q<T extends Element>(root: ParentNode, sel: string): T {
  const el = root.querySelector<T>(sel);
  if (!el) throw new Error(`missing element: ${sel}`);
  return el;
}

export type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

// ai-dup-check: allow -- fp:this IS the shared implementation; network-activity.test.ts imports it rather than redefining it, so the reported "duplicate" is this same function seen via its caller.
export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// predicate が true を返すまで定期 poll する。timeout 内に成立しなければ throw。
// file-shell-view.test.ts と s3-explorer-ui.test.ts で同形実装になっていた
// (await 名引数の差だけ) のを統合。
export async function waitFor(
  predicate: () => boolean,
  timeoutMs = 2000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error("waitFor timed out");
}

// mkdtempSync + try/finally rmSync の頻出パターン。snapshot-runner /
// snapshot-store 等で同形ヘルパが並んでいたので集約。
// prefix は os.tmpdir() 直下に作るディレクトリ名の接頭辞 (末尾 "-" 推奨)。
// run の戻り値はそのまま返し、finally で rmSync する。
export async function withTempDir<T>(
  prefix: string,
  run: (dir: string) => Promise<T>,
): Promise<T> {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), prefix));
  try {
    return await run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
