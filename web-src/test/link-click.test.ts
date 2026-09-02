import { describe, expect, test } from "vitest";
import { isNativeLinkClick } from "../core/link-click";

describe("isNativeLinkClick", () => {
  test.each([
    ["plain primary click", {}, false],
    ["meta", { metaKey: true }, true],
    ["ctrl", { ctrlKey: true }, true],
    ["shift", { shiftKey: true }, true],
    ["alt", { altKey: true }, true],
    ["middle button", { button: 1 }, true],
    ["secondary button", { button: 2 }, true],
  ])("%s", (_label, init, expected) => {
    expect(
      isNativeLinkClick({
        metaKey: false,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
        button: 0,
        ...init,
      }),
    ).toBe(expected);
  });
});
