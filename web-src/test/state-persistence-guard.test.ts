import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const appSource = readFileSync(new URL("../app.ts", import.meta.url), "utf8");

describe("viewer state persistence error handling", () => {
  test("does not discard rejected background saves", () => {
    expect(appSource).not.toContain(".catch(() => undefined)");
    expect(appSource).toContain(
      "pendingSettingsPatch = {\n        ...patch,\n        ...(pendingSettingsPatch || {}),\n      };",
    );
    expect(appSource).toContain(
      "pendingViewPatch = mergeViewPatch(patch, pendingViewPatch || {});",
    );
  });

  test.each([
    "save viewer settings",
    "save viewer state",
  ])("%s preserves the HTTP response and reports the failure", (operation) => {
    expect(appSource).toContain(
      `await responseErrorMessage(response, "${operation}")`,
    );
    expect(appSource).toContain(
      `reportPersistenceError("${operation}", error)`,
    );
  });
});
