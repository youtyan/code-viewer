import { describe, expect, test } from "vitest";
import { createBundleLoader } from "../core/lazy-bundle";

describe("createBundleLoader", () => {
  test("returns one shared promise and exposes the complete import failure", async () => {
    const load = createBundleLoader<unknown>("missing-test-bundle.js");

    const first = load();
    const second = load();

    expect(second).toBe(first);
    await expect(first).rejects.toMatchObject({
      name: "Error",
      message: expect.stringContaining("missing-test-bundle.js"),
    });
  });
});
