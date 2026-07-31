// ブラウザ向けバンドルを焼く。定義は scripts/bundles.mjs 側にある。

import { buildWebBundle, WEB_BUNDLES } from "./bundles.mjs";

for (const bundle of WEB_BUNDLES) {
  await buildWebBundle(bundle);
}
