// CLI 兼サーバのバンドルを焼く。定義は scripts/bundles.mjs 側にある。

import { buildServerBundle } from "./bundles.mjs";

await buildServerBundle();
