import { describe, expect, test } from "vitest";
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

  test("stops the child when the caller aborts", async () => {
    const controller = new AbortController();
    const child = runAsync(
      [process.execPath, "-e", "setInterval(() => {}, 1000)"],
      process.cwd(),
      { signal: controller.signal },
    );

    controller.abort();

    const result = await child;
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/abort/i);
  });
});
