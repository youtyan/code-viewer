import { describe, expect, test } from "bun:test";
import { runAsync } from "../server/runtime";

describe("runAsync", () => {
  test("does not block the parent event loop while a child process is running", async () => {
    let ticked = false;
    const child = runAsync(
      [process.execPath, "-e", "setTimeout(() => {}, 200)"],
      process.cwd(),
      { timeout: 2000 },
    );

    await new Promise<void>((resolve) => {
      setTimeout(() => {
        ticked = true;
        resolve();
      }, 25);
    });

    expect(ticked).toBe(true);
    const result = await child;
    expect(result.code).toBe(0);
  });
});
