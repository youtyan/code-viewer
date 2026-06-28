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
