// 同じ入力から 2 回焼いて、バイト単位で一致することを見る。
//
// 出力が実行ごとに変わると、配布物の差分がレビューできず、npm に上げた版と
// 手元の版が同じか確かめられなくなる。バンドラの設定やプラグインを足したとき
// に非決定性が混ざっていないかを、ここで機械的に落とす。

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { buildServerBundle, buildWebBundle, WEB_BUNDLES } from "./bundles.mjs";

const dirs = [
  mkdtempSync(join(tmpdir(), "code-viewer-bundle-a-")),
  mkdtempSync(join(tmpdir(), "code-viewer-bundle-b-")),
];

/** 出力名だけを取り出す (WEB_BUNDLES の outfile はディレクトリを含む)。 */
const outputs = [
  ...WEB_BUNDLES.map((bundle) => basename(bundle.outfile)),
  "code-viewer.js",
];

async function buildAll(dir) {
  for (const bundle of WEB_BUNDLES) {
    await buildWebBundle(bundle, join(dir, basename(bundle.outfile)));
  }
  await buildServerBundle(join(dir, "code-viewer.js"));
}

try {
  await buildAll(dirs[0]);
  await buildAll(dirs[1]);

  for (const name of outputs) {
    const firstPath = join(dirs[0], name);
    const secondPath = join(dirs[1], name);
    if (!existsSync(firstPath) || !existsSync(secondPath)) {
      throw new Error(`missing bundle output: ${name}`);
    }
    if (!readFileSync(firstPath).equals(readFileSync(secondPath))) {
      throw new Error(`non-deterministic bundle output: ${name}`);
    }
  }
} finally {
  for (const dir of dirs) {
    rmSync(dir, { recursive: true, force: true });
  }
}
