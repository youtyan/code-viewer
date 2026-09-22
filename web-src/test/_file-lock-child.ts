// file-lock.test.ts が起こす子プロセス。同じロックを別プロセスと取り合いながら、
// 数えるファイルを「読んで・足して・書く」を繰り返す。
// 使い方: node --import tsx _file-lock-child.ts <lock file> <counter file> <回数>

import { readFileSync, writeFileSync } from "node:fs";
import { withFileLock } from "../server/file-lock";

const [lockFile, counterFile, rounds] = process.argv.slice(2);
if (!lockFile || !counterFile || !rounds) {
  throw new Error(
    "usage: _file-lock-child.ts <lock file> <counter file> <rounds>",
  );
}

for (let round = 0; round < Number(rounds); round += 1) {
  await withFileLock(
    lockFile,
    () => {
      const current = Number(readFileSync(counterFile, "utf8"));
      writeFileSync(counterFile, String(current + 1));
    },
    { timeoutMs: 20_000 },
  );
}
