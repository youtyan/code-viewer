import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// テストは web-src/test/ に集約している。DOM が要るテストは各ファイルの中で
// @happy-dom/global-registrator を明示的に登録しているので、ここでは環境を
// node のままにする (全ファイルに DOM を被せると、node 側のテストが本来
// 存在しないはずのグローバルを掴んでしまう)。
export default defineConfig({
  resolve: {
    // ブラウザでは preview server が配る実行時URL。Vitestではソースまたは
    // 専用stubへ向け、UIテストが別バンドル読込を実行しても未処理拒否にしない。
    alias: [
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
  },
});
