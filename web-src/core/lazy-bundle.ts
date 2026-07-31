// 別バンドル (web/*.js) を lazy import する共通ローダ生成器。
//
// mermaid / shiki / yaml / xterm は重いので app.js には焼き込まず、独立した
// バンドルとして build:web が出力している。それを「初回呼び出しで 1 度だけ
// import し、以後は同じ Promise を返し、失敗したら null」という同じ形で読む
// ローダが並ぶので、その形をここに 1 つだけ持つ。
//
// import specifier をテンプレートリテラル経由にしているのは bundler に静的
// 解決させないため。ここを素の文字列リテラルにすると bun build が対象を
// app.js へ巻き込み、分割した意味がなくなる。

/** バンドルを読み込む関数。失敗時は null (呼び出し側で fallback)。 */
export type BundleLoader<T> = () => Promise<T | null>;

/**
 * `web/<bundleFile>` を動的 import するローダを作る。
 *
 * @param bundleFile web/ 直下に build:web が出力するファイル名 (例 "yaml.js")
 * @param init モジュールを公開型へ変換する。初期化が要るバンドルはここで行う。
 *   省略時は module をそのまま T として扱う。
 */
export function createBundleLoader<T>(
  bundleFile: string,
  init?: (mod: unknown) => T | Promise<T>,
): BundleLoader<T> {
  let pending: Promise<T | null> | null = null;
  return () => {
    if (!pending) {
      pending = import(`/${bundleFile}`)
        .then((mod: unknown) => (init ? init(mod) : (mod as T)))
        .catch(() => null);
    }
    return pending;
  };
}
