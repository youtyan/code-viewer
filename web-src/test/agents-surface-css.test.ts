import { describe, expect, test } from "vitest";
import {
  baseRules,
  cascadedDeclarations,
  loadStyleSheet,
} from "./_css-fixture";

const rules = baseRules(loadStyleSheet());

function declarations(selector: string): Map<string, string> {
  return cascadedDeclarations(rules, (candidate) => candidate === selector);
}

describe("the agents surfaces", () => {
  test.each([
    ["--ui-row-h", "var(--ui-control-sm)"],
    ["--ui-table-row-h", "var(--ui-control-md)"],
  ])("keeps %s on the matching density token", (property, expected) => {
    expect(declarations(".agents-page").get(property)).toBe(expected);
  });

  test("uses the section gap below the account cards", () => {
    expect(declarations(".agents-accounts").get("margin-bottom")).toBe(
      "var(--space-5)",
    );
  });

  test("uses the standard surface radius for account cards", () => {
    expect(declarations(".agents-account-card").get("border-radius")).toBe(
      "var(--radius-md)",
    );
  });

  test.each([
    ".usage-popover-head",
    ".usage-popover-account",
  ])("%s uses the popover content inset", (selector) => {
    expect(declarations(selector).get("padding")).toBe("var(--space-4)");
  });
});
