// バンドルの定義と、それを esbuild で焼く手順。
//
// ビルド (build-web / build-server) と、二重ビルドの一致を見る検査
// (check-bundle) が同じ定義を参照するために切り出してある。片方だけ設定が
// ずれると「検査は通るが配布物は違う」状態になるので、必ずここを通す。

import { build } from "esbuild";

/** ブラウザに配るバンドル。outfile はリポジトリルートからの相対。 */
export const WEB_BUNDLES = [
  { entry: "web-src/app.ts", format: "iife", outfile: "web/app.js" },
  {
    entry: "web-src/mermaid-entry.ts",
    format: "esm",
    outfile: "web/mermaid.js",
  },
  { entry: "web-src/shiki-entry.ts", format: "esm", outfile: "web/shiki.js" },
  { entry: "web-src/yaml-entry.ts", format: "esm", outfile: "web/yaml.js" },
  { entry: "web-src/xterm-entry.ts", format: "esm", outfile: "web/xterm.js" },
  {
    entry: "web-src/highlight-entry.ts",
    format: "iife",
    outfile: "web/vendor/highlight.js/highlight.min.js",
  },
];

/**
 * CLI 兼サーバ。ネイティブ依存とドライバは束ねずに実行時解決へ回す
 * (任意依存なので、入っていない環境でも起動できる必要がある)。
 */
export const SERVER_BUNDLE = {
  entry: "web-src/server/cli.ts",
  outfile: "dist/code-viewer.js",
  // better-sqlite3 と @lydell/node-pty はネイティブモジュールなので束ねられ
  // ない。他も任意依存 / 実行時解決なので、いずれも実行環境の解決に任せる。
  external: [
    "pg",
    "mysql2/promise",
    "@redis/client",
    "better-sqlite3",
    "@lydell/node-pty",
  ],
};

/** 全バンドル共通。日本語をエスケープに潰さない。 */
const SHARED_OPTIONS = {
  bundle: true,
  charset: "utf8",
};

export function buildWebBundle(bundle, outfile = bundle.outfile) {
  return build({
    ...SHARED_OPTIONS,
    entryPoints: [bundle.entry],
    platform: "browser",
    format: bundle.format,
    outfile,
  });
}

export function buildServerBundle(outfile = SERVER_BUNDLE.outfile) {
  return build({
    ...SHARED_OPTIONS,
    entryPoints: [SERVER_BUNDLE.entry],
    platform: "node",
    format: "esm",
    outfile,
    external: SERVER_BUNDLE.external,
  });
}
