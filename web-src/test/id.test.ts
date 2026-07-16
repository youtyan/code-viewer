import { describe, expect, test } from "bun:test";
import { makeTimedId } from "../core/id";

describe("makeTimedId", () => {
  test.each([
    { prefix: "s", now: 0, expected: "s-0zzzzzz" },
    { prefix: "a", now: 35, expected: "a-zzzzzzz" },
    { prefix: "j", now: 36, expected: "j-10zzzzzz" },
    { prefix: "t", now: 71, expected: "t-1zzzzzzz" },
    { prefix: "n", now: 1295, expected: "n-zzzzzzzz" },
  ])("keeps the historical format for $prefix", ({ prefix, now, expected }) => {
    const originalNow = Date.now;
    const originalRandom = Math.random;
    Date.now = () => now;
    Math.random = () => 1 - Number.EPSILON;
    try {
      expect(makeTimedId(prefix)).toBe(expected);
    } finally {
      Date.now = originalNow;
      Math.random = originalRandom;
    }
  });
});
