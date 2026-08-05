import { describe, expect, test } from "vitest";
import { orderedInsertOptionCount } from "../server/ordered-insert";

describe("orderedInsertOptionCount", () => {
  test.each([
    { input: {}, expected: 0 },
    { input: { before_id: "item-1" }, expected: 1 },
    { input: { after_id: "item-1" }, expected: 1 },
    { input: { position: 1 }, expected: 1 },
    { input: { position: 0 }, expected: 1 },
    {
      input: { before_id: "item-1", after_id: "item-2" },
      expected: 2,
    },
    {
      input: { before_id: "item-1", after_id: "item-2", position: 3 },
      expected: 3,
    },
  ])("counts $expected specified options", ({ input, expected }) => {
    expect(orderedInsertOptionCount(input)).toBe(expected);
  });
});
