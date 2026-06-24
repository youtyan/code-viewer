import { describe, expect, test } from "bun:test";
import { isImeComposing } from "../core/keyboard";

describe("IME keyboard handling", () => {
  test("detects modern and fallback composition markers", () => {
    expect(isImeComposing({ isComposing: true })).toBe(true);
    expect(isImeComposing({ keyCode: 229 })).toBe(true);
    expect(isImeComposing({ isComposing: false, keyCode: 13 })).toBe(false);
  });
});
