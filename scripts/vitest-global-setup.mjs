// CLI を起動して確かめるテストは、TypeScript を都度変換する tsx ではなく
// 配布物と同じバンドルを起動する。起動が 3 倍以上速く、実際に配られるものを
// そのまま検証できる。テスト全体で 1 回だけ焼く。

import { buildServerBundle } from "./bundles.mjs";

export default async function setup() {
  await buildServerBundle();
}
