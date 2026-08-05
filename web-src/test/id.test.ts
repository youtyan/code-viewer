import { describe, expect, test } from "vitest";
import { makeTimedId } from "../core/id";

// globalThis.crypto は Node では getter だけを持つ。代入では差し替えられない
// ので、プロパティごと定義し直して元に戻す。
function setCrypto(value: unknown): void {
  Object.defineProperty(globalThis, "crypto", {
    value,
    configurable: true,
    writable: true,
  });
}

function withMockedCrypto<T>(bytes: number[], fn: () => T): T {
  const original = globalThis.crypto;
  const fake = {
    ...original,
    getRandomValues: <A extends ArrayBufferView>(arr: A): A => {
      const view = arr as unknown as Uint8Array;
      view.set(bytes.slice(0, view.length));
      return arr;
    },
  };
  try {
    setCrypto(fake);
    return fn();
  } finally {
    setCrypto(original);
  }
}

function withMockedNow<T>(now: number, fn: () => T): T {
  const originalNow = Date.now;
  Date.now = () => now;
  try {
    return fn();
  } finally {
    Date.now = originalNow;
  }
}

describe("makeTimedId", () => {
  test.each([
    { prefix: "s", now: 0, bytes: [0, 0, 0, 0, 0, 0], expected: "s-0000000" },
    { prefix: "a", now: 1, bytes: [1, 2, 3, 4, 5, 6], expected: "a-1123456" },
    { prefix: "j", now: 36, bytes: [9, 8, 7, 6, 5, 4], expected: "j-10987654" },
    { prefix: "t", now: 71, bytes: [0, 1, 2, 3, 4, 5], expected: "t-1z012345" },
    {
      prefix: "n",
      now: 1295,
      bytes: [9, 9, 9, 9, 9, 9],
      expected: "n-zz999999",
    },
  ])("combines base36 timestamp and crypto-sourced base36 suffix for $prefix", ({
    prefix,
    now,
    bytes,
    expected,
  }) => {
    const id = withMockedNow(now, () =>
      withMockedCrypto(bytes, () => makeTimedId(prefix)),
    );
    expect(id).toBe(expected);
  });

  test("draws the random suffix from crypto.getRandomValues, not Math.random", () => {
    const originalRandom = Math.random;
    let mathRandomCalls = 0;
    Math.random = () => {
      mathRandomCalls++;
      return originalRandom();
    };
    try {
      withMockedCrypto([1, 2, 3, 4, 5, 6], () => makeTimedId("s"));
    } finally {
      Math.random = originalRandom;
    }
    expect(mathRandomCalls).toBe(0);
  });

  test("falls back to Math.random when crypto.getRandomValues is unavailable", () => {
    const original = globalThis.crypto;
    try {
      setCrypto(undefined);
      const id = withMockedNow(0, () => makeTimedId("s"));
      expect(id).toMatch(/^s-0[0-9a-z]{6}$/);
    } finally {
      setCrypto(original);
    }
  });

  test("produces distinct suffixes across successive real calls", () => {
    const ids = new Set(Array.from({ length: 20 }, () => makeTimedId("s")));
    expect(ids.size).toBe(20);
  });
});
