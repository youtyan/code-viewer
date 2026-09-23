// pnpm dev (server/dev.ts) が入口を起こし直すきっかけ。一時フォルダにだけ書く。
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, test } from "vitest";
import { devWatchSignature } from "../server/dev-watch";

const FILES = [
  "package.json",
  "web-src/server/sample.ts",
  "web-src/core/nested/sample.ts",
  "web-src/views/sample.ts",
  "web-src/app.ts",
  "web/style.css",
];

test.each([
  ["a server source", "web-src/server/sample.ts", true],
  ["a core source in a subfolder", "web-src/core/nested/sample.ts", true],
  // 版を上げたら入口も起こし直す (古い入口は新しい版の裏に断られる)。
  ["package.json", "package.json", true],
  ["a view (esbuild rebuilds it)", "web-src/views/sample.ts", false],
  ["app.ts (esbuild rebuilds it)", "web-src/app.ts", false],
  ["style.css (the page reloads)", "web/style.css", false],
])("editing %s (%s) restarts the entry: %s", (_label, edited, restarts) => {
  const root = mkdtempSync(join(tmpdir(), "cv-dev-watch-"));
  try {
    for (const file of FILES) {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      writeFileSync(join(root, file), "sample\n");
      utimesSync(join(root, file), 1_000_000, 1_000_000);
    }
    const before = devWatchSignature(root);
    utimesSync(join(root, edited), 2_000_000, 2_000_000);
    expect(devWatchSignature(root) !== before).toBe(restarts);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
