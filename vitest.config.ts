import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// lit-html の置き場所 (lit が依存として持つ。pnpm なので lit から辿る)。
const LIT_HTML_ENTRY = createRequire(
  createRequire(import.meta.url).resolve("lit"),
).resolve("lit-html");
const LIT_HTML_ROOT = LIT_HTML_ENTRY.slice(
  0,
  LIT_HTML_ENTRY.lastIndexOf("/lit-html/") + "/lit-html".length,
);

export default defineConfig({
  resolve: {
    // ブラウザでは preview server が配る実行時URL。Vitestではソースまたは
    // 専用stubへ向け、UIテストが別バンドル読込を実行しても未処理拒否にしない。
    alias: [
      {
        // 配るバンドルと同じく本番用の lit-html を読む。テストの既定の条件
        // (development) だと開発用の版を読み、読んだ時に "Lit is in dev mode" の
        // 警告を出す (console.warn の数を見るテストに混ざる)。node 向けの版は
        // document が無い間に読まれても落ちない。
        find: /^lit-html$/,
        replacement: `${LIT_HTML_ROOT}/node/lit-html.js`,
      },
      {
        find: /^lit-html\/(.+)$/,
        replacement: `${LIT_HTML_ROOT}/node/$1`,
      },
      {
        find: /^\/mermaid\.js$/,
        replacement: fileURLToPath(
          new URL("./web-src/mermaid-entry.ts", import.meta.url),
        ),
      },
      {
        find: /^\/shiki\.js$/,
        replacement: fileURLToPath(
          new URL("./web-src/test/shiki-entry-stub.ts", import.meta.url),
        ),
      },
      {
        find: /^\/yaml\.js$/,
        replacement: fileURLToPath(
          new URL("./web-src/yaml-entry.ts", import.meta.url),
        ),
      },
      {
        find: /^\/xterm\.js$/,
        replacement: fileURLToPath(
          new URL("./web-src/xterm-entry.ts", import.meta.url),
        ),
      },
    ],
  },
  test: {
    reporters:
      process.env.GITHUB_ACTIONS === "true"
        ? ["default", "github-actions"]
        : ["default"],
    include: ["web-src/test/**/*.test.ts"],
    environment: "node",
    // CLI を起動するテストが使う dist/code-viewer.js を先に焼く。
    globalSetup: ["./scripts/vitest-global-setup.mjs"],
    // docker やサーバを立てるテストがあるので、既定の 5s では足りない。
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // 実プロセス (preview サーバ / git / docker CLI) を起動するテストが多く、
    // ファイルを並列に走らせると起動と応答が互いに遅れて、時間で待っている
    // テストがランダムに落ちる。どのテストが落ちるかは実行ごとに変わるので、
    // 閾値を個別に緩めても解決しない。並列をやめて安定を取る。
    fileParallelism: false,
    server: {
      deps: {
        // lit-html は読み込んだ時点の document を掴む。テストごとに窓を作り直す
        // テストは vi.resetModules() の後に読み込み直して新しい窓で描くので、
        // node_modules から一度だけ読む扱い (external) にしない。
        inline: [/[\\/]lit-html[\\/]/, /[\\/]lit[\\/]/],
      },
    },
  },
});
