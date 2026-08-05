import { describe, expect, test } from "vitest";
import { terminateChild } from "../server/dev-process";
import { deferred } from "./_test-helpers";

describe("dev process shutdown", () => {
  test("terminates a child with SIGTERM without escalating after it exits", async () => {
    const exit = deferred<number>();
    const signals: string[] = [];
    let scheduled: (() => void) | null = null;
    let cleared = 0;

    const done = terminateChild(
      {
        kill(signal) {
          signals.push(signal || "SIGTERM");
        },
        exited: exit.promise,
      },
      {
        setTimeoutFn: ((callback: () => void) => {
          scheduled = callback;
          return 1;
        }) as typeof setTimeout,
        clearTimeoutFn: (() => {
          cleared++;
        }) as typeof clearTimeout,
      },
    );

    expect(signals).toEqual(["SIGTERM"]);
    expect(scheduled).toBeTruthy();
    exit.resolve(0);
    expect(await done).toBe(0);
    expect(cleared).toBe(1);
    expect(signals).toEqual(["SIGTERM"]);
  });

  test("escalates a stuck child to SIGKILL after the grace period", async () => {
    const originalWarn = console.warn;
    console.warn = () => undefined;
    const exit = deferred<number>();
    const signals: string[] = [];
    let scheduled: (() => void) | null = null;

    try {
      const done = terminateChild(
        {
          kill(signal) {
            signals.push(signal || "SIGTERM");
          },
          exited: exit.promise,
        },
        {
          setTimeoutFn: ((callback: () => void) => {
            scheduled = callback;
            return 1;
          }) as typeof setTimeout,
          clearTimeoutFn: (() => undefined) as typeof clearTimeout,
        },
      );

      expect(signals).toEqual(["SIGTERM"]);
      scheduled?.();
      expect(signals).toEqual(["SIGTERM", "SIGKILL"]);
      exit.resolve(1);
      expect(await done).toBe(1);
    } finally {
      console.warn = originalWarn;
    }
  });
});
