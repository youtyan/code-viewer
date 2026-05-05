import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { sourceFixture } from "./source-fixture";

describe("asset version polling removal", () => {
  test("does not ship the browser poller or endpoint handler", () => {
    const app = sourceFixture(readFileSync("web-src/app.ts", "utf8"));
    const builtApp = readFileSync("web/app.js", "utf8");
    const preview = sourceFixture(
      readFileSync("web-src/server/preview.ts", "utf8"),
    );
    const types = readFileSync("web-src/types.ts", "utf8");

    for (const source of [app, builtApp, preview, types]) {
      expect(source.includes("_asset_version")).toBe(false);
      expect(source.includes("AssetVersionResponse")).toBe(false);
      expect(source.includes("pollAssetVersion")).toBe(false);
    }
  });
});
