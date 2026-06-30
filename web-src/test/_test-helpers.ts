// 複数テストで重複していた汎用ヘルパを集約。
//
// - q(root, sel): querySelector + missing チェック (4 explorer / grid テスト
//   で同形だった)
// - deferred<T>(): resolve/reject を外から触れる Promise (history /
//   network-activity / repo-view-race / file-shell-view で同形だった)

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
