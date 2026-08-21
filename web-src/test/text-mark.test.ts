import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  findTextRange,
  markNeedleInCell,
  markTextRange,
} from "../views/text-mark";

beforeAll(() => {
  GlobalRegistrator.register();
});

afterAll(() => {
  GlobalRegistrator.unregister();
});

describe("findTextRange", () => {
  test.each([
    {
      name: "case-insensitive by default",
      line: "const Token = token;",
      needle: "token",
      options: {},
      expected: { start: 6, end: 11 },
    },
    {
      name: "case-sensitive skips a different casing",
      line: "const Token = token;",
      needle: "token",
      options: { caseSensitive: true },
      expected: { start: 14, end: 19 },
    },
    {
      name: "picks the occurrence nearest to the reported column",
      line: "a b a b a",
      needle: "a",
      options: { nearColumn: 5 },
      expected: { start: 4, end: 5 },
    },
    {
      name: "missing needle",
      line: "nothing here",
      needle: "zzz",
      options: {},
      expected: null,
    },
    {
      name: "empty needle",
      line: "abc",
      needle: "",
      options: {},
      expected: null,
    },
  ])("$name", ({ line, needle, options, expected }) => {
    expect(findTextRange(line, needle, options)).toEqual(expected);
  });
});

describe("markTextRange", () => {
  test("wraps a range that spans several highlight spans", () => {
    const cell = document.createElement("td");
    cell.innerHTML =
      '<span class="k">const</span> <span class="v">needle</span>;';
    // "const needle;" -> mark "t nee" (offsets 4..9)
    markTextRange(cell, 4, 9, "hit");
    const marks = Array.from(cell.querySelectorAll("mark.hit"));
    expect(marks.map((mark) => mark.textContent)).toEqual(["t", " ", "nee"]);
    expect(cell.textContent).toBe("const needle;");
  });

  test("markNeedleInCell is a no-op when the needle is absent", () => {
    const cell = document.createElement("td");
    cell.textContent = "plain text";
    expect(markNeedleInCell(cell, "plain text", "zzz", "hit")).toBe(false);
    expect(cell.querySelector("mark")).toBeNull();
  });

  test("markNeedleInCell marks the needle inside plain text", () => {
    const cell = document.createElement("td");
    cell.textContent = "export const sample = 1;";
    expect(
      markNeedleInCell(cell, "export const sample = 1;", "SAMPLE", "hit"),
    ).toBe(true);
    expect(cell.querySelector("mark.hit")?.textContent).toBe("sample");
  });
});
